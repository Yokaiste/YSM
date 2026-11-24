use super::coverage::*;
use super::*;

fn diversity(cards: &[Card]) -> Vec<f64> {
    let groups: Vec<_> = cards.iter().map(|c| c.purpose().0).collect();
    cards
        .iter()
        .enumerate()
        .map(|(i, c)| {
            if c.vector_len == 0 {
                return 0.;
            }
            let nearest = cards
                .iter()
                .enumerate()
                .filter(|(j, p)| {
                    i != *j
                        && groups[i] == groups[*j]
                        && c.entity != p.entity
                        && c.vector_len == p.vector_len
                })
                .map(|(_, p)| {
                    (super::super::metrics::SIMILARITY
                        .iter()
                        .take(c.vector_len)
                        .map(|m| (c.vector[*m] - p.vector[*m]).powi(2))
                        .sum::<f64>()
                        / c.vector_len as f64)
                        .sqrt()
                })
                .fold(f64::INFINITY, f64::min);
            if nearest.is_finite() {
                (nearest * 6.).min(1500.)
            } else {
                0.
            }
        })
        .collect()
}
pub(super) fn enforce_limits(mut cards: Vec<Card>, entities: &[Entity]) -> Vec<Card> {
    let mut context = Removal::new(&cards, entities);
    loop {
        let remove = cards
            .iter()
            .enumerate()
            .filter(|(_, c)| context.entities.get(&c.entity).copied().unwrap_or(0) > c.max_count)
            .min_by(|(i, a), (j, b)| {
                context
                    .score(a, entities, 0.)
                    .total_cmp(&context.score(b, entities, 0.))
                    .then(i.cmp(j))
            })
            .map(|(i, _)| i);
        let Some(i) = remove else { break };
        let card = cards.remove(i);
        context.remove(&card, entities);
    }
    cards
}
fn prune_purposes(mut cards: Vec<Card>, entities: &[Entity]) -> Vec<Card> {
    loop {
        let score = Removal::new(&cards, entities);
        let removable: HashSet<_> = cards
            .iter()
            .filter(|c| {
                c.coverage
                    .as_deref()
                    .unwrap_or(&[])
                    .iter()
                    .all(|r| score.provider_count(r) > 1)
            })
            .map(|c| c.entity)
            .collect();
        let purposes: Vec<_> = cards
            .iter()
            .map(|c| {
                let (key, limit) = c.purpose();
                (key.to_owned(), limit)
            })
            .collect();
        let mut groups: IndexMap<String, HashSet<EntityId>> = IndexMap::new();
        for (c, (purpose, _)) in cards.iter().zip(&purposes) {
            if !c.forced {
                groups.entry(purpose.clone()).or_default().insert(c.entity);
            }
        }
        let over = groups
            .iter()
            .filter(|(purpose, units)| {
                let limit = purposes
                    .iter()
                    .find(|(p, _)| p == *purpose)
                    .map_or(0, |(_, l)| *l);
                units.len() > limit && units.iter().any(|id| removable.contains(id))
            })
            .min_by(|(a, av), (b, bv)| bv.len().cmp(&av.len()).then_with(|| name_cmp(a, b)));
        let Some((purpose, units)) = over else {
            return cards;
        };
        let remove = units
            .iter()
            .copied()
            .filter(|id| removable.contains(id))
            .map(|id| {
                let keep = cards
                    .iter()
                    .zip(&purposes)
                    .filter(|(c, (p, _))| c.entity == id && p == purpose)
                    .map(|(c, _)| score.score(c, entities, 0.))
                    .fold(f64::NEG_INFINITY, f64::max);
                (id, keep)
            })
            .min_by(|(a, av), (b, bv)| {
                av.total_cmp(bv)
                    .then_with(|| name_cmp(&entities[*a].name, &entities[*b].name))
            })
            .map(|(id, _)| id);
        let Some(remove) = remove else { return cards };
        let purpose = purpose.clone();
        cards = cards
            .into_iter()
            .zip(purposes)
            .filter(|(c, (p, _))| c.forced || c.entity != remove || *p != purpose)
            .map(|(c, _)| c)
            .collect();
    }
}
fn priority(
    a: &Card,
    b: &Card,
    entities: &[Entity],
    context: &Context,
    config: &Config,
) -> std::cmp::Ordering {
    similarity::compare(a.view(entities), b.view(entities))
        .then(b.keep_priority.total_cmp(&a.keep_priority))
        .then(b.role_score.total_cmp(&a.role_score))
        .then(
            config
                .country_rank(&entities[a.entity], &context.coalition)
                .cmp(&config.country_rank(&entities[b.entity], &context.coalition)),
        )
        .then_with(|| name_cmp(&entities[a.entity].name, &entities[b.entity].name))
}
fn prune_similar(
    cards: Vec<Card>,
    entities: &[Entity],
    context: &Context,
    config: &Config,
) -> Vec<Card> {
    let mut near = vec![vec![false; cards.len()]; cards.len()];
    for i in 0..cards.len() {
        if cards[i].forced {
            continue;
        }
        for j in i + 1..cards.len() {
            if !cards[j].forced
                && cards[i].entity != cards[j].entity
                && similarity::near(cards[i].view(entities), cards[j].view(entities))
            {
                near[i][j] = true;
                near[j][i] = true;
            }
        }
    }
    let mut selected: Vec<_> = cards.into_iter().enumerate().collect();
    loop {
        let mut consolidation = None;
        for (i, (original, candidate)) in selected.iter().enumerate() {
            if candidate.forced {
                continue;
            }
            let representative = selected
                .iter()
                .enumerate()
                .filter(|(_, (peer, _))| near[*original][*peer])
                .min_by(|(_, (_, a)), (_, (_, b))| priority(a, b, entities, context, config))
                .map(|(j, _)| j);
            let Some(j) = representative else { continue };
            if priority(candidate, &selected[j].1, entities, context, config).is_lt() {
                continue;
            }
            if candidate.coverage.as_ref().is_some_and(|roles| {
                roles.iter().any(|r| {
                    !selected
                        .iter()
                        .any(|(_, c)| c.entity != candidate.entity && provides(c, r))
                })
            }) {
                continue;
            }
            consolidation = Some((
                i,
                j,
                unique(selected[j].1.roles.iter().chain(&candidate.roles).cloned()),
            ));
            break;
        }
        let Some((i, j, roles)) = consolidation else {
            return selected.into_iter().map(|(_, c)| c).collect();
        };
        selected[j].1.roles = roles;
        selected.remove(i);
    }
}
pub fn trim(
    cards: Vec<Card>,
    limit: usize,
    entities: &[Entity],
    context: &Context,
    config: &Config,
) -> Result<Vec<Card>> {
    let mut selected = enforce_limits(dedupe(cards), entities);
    let mut scores = Removal::new(&selected, entities);
    while selected.len() > limit {
        let mut groups = [0usize; 2];
        for c in &selected {
            if let Some(t) = c.transport {
                groups[usize::from(rules::air(&entities[t]))] += 1;
            }
        }
        let remove = selected
            .iter()
            .enumerate()
            .filter(|(_, c)| !c.forced && scores.entities.get(&c.entity).copied().unwrap_or(0) > 1)
            .map(|(i, c)| {
                let penalty = c.transport.map_or(0., |t| {
                    let group = usize::from(rules::air(&entities[t]));
                    groups[group].saturating_sub(groups[1 - group]) as f64 * 120.
                });
                (i, scores.score(c, entities, 0.) - penalty)
            })
            .min_by(|(i, a), (j, b)| a.total_cmp(b).then(i.cmp(j)))
            .map(|(i, _)| i);
        let Some(i) = remove else { break };
        let card = selected.remove(i);
        scores.remove(&card, entities);
    }
    selected = prune_purposes(selected, entities);
    selected = prune_similar(selected, entities, context, config);
    let forced = selected.iter().filter(|c| c.forced).count();
    ensure(
        forced <= limit,
        format!("Forced premade cards exceed the category limit: {forced}/{limit}."),
        "Narrow deckForcedUnitPatterns or raise deckSlotCount.",
    )?;
    if selected.len() <= limit {
        return Ok(selected);
    }
    let mut targets = coverage_targets(&selected, limit - forced, entities);
    let mut scores = Removal::new(&selected, entities);
    while selected.len() > limit {
        let protections = diversity(&selected);
        let remove = selected
            .iter()
            .enumerate()
            .filter(|(_, c)| !c.forced && scores.removable(c, &targets))
            .min_by(|(i, a), (j, b)| {
                scores
                    .score(a, entities, protections[*i])
                    .total_cmp(&scores.score(b, entities, protections[*j]))
                    .then(i.cmp(j))
            })
            .map(|(i, _)| i);
        if let Some(i) = remove {
            let card = selected.remove(i);
            scores.remove(&card, entities);
            continue;
        }
        let p = priorities(&selected);
        let reducible = targets.values().any(|n| *n > 1);
        let role = targets
            .iter()
            .filter(|(_, n)| !reducible || **n > 1)
            .min_by(|(a, _), (b, _)| {
                role_priority(a, &p)
                    .total_cmp(&role_priority(b, &p))
                    .then_with(|| name_cmp(a, b))
            })
            .map(|(r, _)| r.clone())
            .ok_or_else(|| {
                failure(
                    "Deck category cannot fit its card limit.",
                    "Check deckGeneration settings.",
                )
            })?;
        let count = targets[&role];
        if count <= 1 {
            targets.shift_remove(&role);
        } else {
            targets.insert(role, count - 1);
        }
    }
    Ok(selected)
}
