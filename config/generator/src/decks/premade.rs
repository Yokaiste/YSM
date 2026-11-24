use super::{
    analysis::{self, Analysis, Factory},
    cards::{self, Build, Card, SelectionKind},
    config::Config,
    data::*,
    roles::{Role, RoleKind},
    rules,
    scoring::{self, Perspective},
    selection::{self, Selection},
    similarity,
};
use indexmap::IndexMap;
use std::collections::{HashMap, HashSet};
use ymb_sdk::{Result, ensure};
pub fn build(
    context: &Context,
    mode: Mode,
    entries: &[RuleEntry],
    factory: &Factory<'_>,
    packs: &mut IndexMap<String, Pack>,
    tag: &str,
    config: &Config,
) -> Result<Vec<Card>> {
    let entities = factory.entities;
    let premade: Vec<_> = entries
        .iter()
        .filter(|r| config.includes(&entities[r.entity], context, mode, true))
        .map(|r| {
            let mut r = r.clone();
            r.transports
                .retain(|id| config.includes(&entities[*id], context, mode, true));
            r
        })
        .collect();
    let by_entity: HashMap<_, _> = premade.iter().map(|r| (r.entity, r.clone())).collect();
    let transports: HashMap<_, _> = premade
        .iter()
        .filter(|r| !entities[r.entity].transportable_tags.is_empty())
        .map(|r| (r.entity, factory.analyze(r)))
        .collect();
    let transport_refs: HashMap<_, _> = transports.iter().map(|(id, a)| (*id, a)).collect();
    let mut groups: IndexMap<&str, Vec<RuleEntry>> = IndexMap::new();
    for r in premade {
        groups
            .entry(category(&entities[r.entity]))
            .or_default()
            .push(r);
    }
    let mut builder = Build {
        entities,
        config,
        mode,
        context,
        tag,
        entries: &by_entity,
        packs,
    };
    let mut cards = Vec::new();
    for entries in groups.values() {
        let forced: Vec<_> = entries
            .iter()
            .filter(|r| config.forced(&entities[r.entity], context, mode))
            .cloned()
            .collect();
        let competitive: Vec<_> = entries
            .iter()
            .filter(|r| !config.forced(&entities[r.entity], context, mode))
            .cloned()
            .collect();
        let (mut analyses, roles, average) =
            analysis::category_analyses(&competitive, factory, Some(config.veterancy));
        for a in &mut analyses {
            a.coverage = roles
                .iter()
                .filter(|r| a.exact.contains(&r.key))
                .map(selection::coverage)
                .collect();
        }
        let analysis_by_id: HashMap<_, _> = transport_refs
            .iter()
            .map(|(id, a)| (*id, *a))
            .chain(analyses.iter().map(|a| (a.entity, a)))
            .collect();
        let backfill_scores: Vec<_> = analyses
            .iter()
            .map(|a| backfill_score(a, &roles, entities, average))
            .collect();
        let mut forced_cards = Vec::new();
        for r in &forced {
            forced_cards.extend(builder.forced_cards(r, &transport_refs))
        }
        let mut forced_cards = builder.normalize(forced_cards);
        cards::sort(&mut forced_cards, entities);
        ensure(
            forced_cards.len() <= config.slots,
            format!(
                "Forced premade cards exceed the {} category limit: {}/{}.",
                entries
                    .first()
                    .map_or("Unknown", |r| category(&entities[r.entity])),
                forced_cards.len(),
                config.slots
            ),
            "Narrow deckForcedUnitPatterns or raise deckSlotCount.",
        )?;
        let limit = config.slots - forced_cards.len();
        if limit == 0 {
            cards.extend(forced_cards);
            continue;
        }
        let mut selections = Vec::new();
        for role in &roles {
            selections.extend(selection::selections(
                role, &analyses, entities, average, context, config,
            ));
        }
        let filler_limit = ((roles.len().min(limit) as f64).sqrt() / 2.).ceil().max(1.) as usize;
        let mut filler: Vec<_> = backfill_scores
            .iter()
            .enumerate()
            .filter(|(_, s)| **s > 2500.)
            .map(|(i, s)| (i, *s))
            .collect();
        filler.sort_by(|(_, a), (_, b)| b.total_cmp(a));
        filler.truncate(filler_limit);
        selections.extend(filler.into_iter().map(|(i, s)| Selection {
            analysis: i,
            role: "filler".into(),
            kind: SelectionKind::Filler,
            score: s,
            priority: 1000.,
        }));
        let mut candidates = Vec::new();
        for s in selections {
            candidates.extend(builder.selection_cards(&analyses[s.analysis], &s, &analysis_by_id));
        }
        let candidates = builder.normalize(candidates);
        let main_coverage = roles
            .iter()
            .filter(|r| matches!(r.kind, RoleKind::Primary | RoleKind::Type))
            .map(|r| r.options)
            .sum::<usize>()
            .max(1);
        let density = backfill_target(candidates.len(), roles.len(), limit);
        let target = limit.min(main_coverage.max(density));
        let selected = cards::trim(candidates, target, entities, context, config)?;
        let selected = backfill(
            selected,
            target,
            &analyses,
            &roles,
            &backfill_scores,
            &analysis_by_id,
            &mut builder,
        );
        cards.extend(forced_cards);
        cards.extend(selected);
    }
    let mut cards = builder.normalize(cards);
    cards::sort(&mut cards, entities);
    Ok(cards)
}
pub fn backfill_target(selected: usize, roles: usize, limit: usize) -> usize {
    if selected == 0 || roles == 0 || limit == 0 {
        0
    } else {
        limit.min(((selected + roles) * 3).div_ceil(10).max(1))
    }
}
fn backfill_score(a: &Analysis, roles: &[Role], entities: &[Entity], average: f64) -> f64 {
    let mut role_scores: Vec<_> = roles
        .iter()
        .filter(|r| a.exact.contains(&r.key))
        .map(|r| scoring::perspective(a, &entities[a.entity], r, average, Perspective::Best))
        .collect();
    role_scores.sort_by(|a, b| b.total_cmp(a));
    let first = role_scores.first().copied().unwrap_or(0.);
    let second = role_scores.get(1).copied().unwrap_or(0.);
    let general = scoring::filler(a);
    general.max(first + second * 0.15) + general * 0.2
}
fn backfill(
    mut selected: Vec<Card>,
    target: usize,
    analyses: &[Analysis],
    roles: &[Role],
    scores: &[f64],
    by_id: &HashMap<EntityId, &Analysis>,
    builder: &mut Build<'_>,
) -> Vec<Card> {
    let entities = builder.entities;
    let meaningful: HashSet<_> = roles.iter().map(|r| r.key.as_str()).collect();
    let mut support: HashMap<&str, usize> = HashMap::new();
    for a in analyses {
        for token in &a.profile.tokens {
            *support.entry(token.as_str()).or_default() += 1;
        }
    }
    let names: HashSet<_> = selected.iter().map(|c| c.entity).collect();
    let mut remaining: Vec<_> = (0..analyses.len())
        .filter(|i| !names.contains(&analyses[*i].entity))
        .collect();
    let top = remaining.iter().map(|i| scores[*i]).fold(0., f64::max);
    remaining.retain(|i| scores[*i] >= top * 0.25);
    remaining.sort_by(|i, j| {
        scores[*j].total_cmp(&scores[*i]).then_with(|| {
            name_cmp(
                &entities[analyses[*i].entity].name,
                &entities[analyses[*j].entity].name,
            )
        })
    });
    remaining.truncate((target * 2).max(roles.len() * 2));
    let replacement_limit = (target as f64).sqrt().ceil().max(1.) as usize;
    let mut replacements = 0;
    while !remaining.is_empty() {
        let selected_names: HashSet<_> = selected.iter().map(|c| c.entity).collect();
        let mut covered_roles = HashSet::new();
        let mut covered_profile = HashSet::new();
        for id in &selected_names {
            if let Some(a) = by_id.get(id) {
                covered_roles.extend(
                    a.exact
                        .iter()
                        .filter(|r| meaningful.contains(r.as_str()))
                        .map(String::as_str),
                );
                covered_profile.extend(a.profile.tokens.iter().map(String::as_str));
            }
        }
        let mut eligible = Vec::new();
        for i in &remaining {
            let a = &analyses[*i];
            let purpose = &a.profile.purpose_key;
            let limit = a.profile.purpose_limit;
            let matching: HashSet<_> = selected
                .iter()
                .filter(|c| {
                    by_id
                        .get(&c.entity)
                        .is_some_and(|p| p.profile.purpose_key == *purpose)
                })
                .map(|c| c.entity)
                .collect();
            let uncovered = a
                .exact
                .iter()
                .any(|r| meaningful.contains(r.as_str()) && !covered_roles.contains(r.as_str()));
            if !matching.contains(&a.entity) && matching.len() >= limit && !uncovered {
                continue;
            }
            let conflicts = unique(
                selected
                    .iter()
                    .filter(|c| {
                        c.entity != a.entity && similarity::near(a.view(entities), c.view(entities))
                    })
                    .map(|c| c.entity),
            );
            if conflicts.is_empty() && selected.len() >= target {
                continue;
            }
            if conflicts.len() > 1 || (!conflicts.is_empty() && replacements >= replacement_limit) {
                continue;
            }
            let improves = conflicts.iter().all(|id| {
                let Some(incumbent) = by_id.get(id) else {
                    return false;
                };
                let incumbent_roles: HashSet<_> = selected
                    .iter()
                    .filter(|c| c.entity == *id)
                    .flat_map(|c| c.roles.iter())
                    .filter(|r| !["filler", "backfill"].contains(&r.as_str()))
                    .collect();
                if incumbent_roles.iter().any(|key| {
                    !roles
                        .iter()
                        .any(|r| selection::coverage(r) == ***key && a.exact.contains(&r.key))
                }) {
                    return false;
                }
                let quality = similarity::compare(a.view(entities), incumbent.view(entities));
                if !quality.is_eq() {
                    return quality.is_lt();
                }
                let old = analyses
                    .iter()
                    .position(|a| a.entity == *id)
                    .map_or(0., |i| scores[i]);
                scores[*i] > old * 1.05
            });
            if !conflicts.is_empty() && !improves {
                continue;
            }
            let role_novelty = (a
                .exact
                .iter()
                .filter(|r| meaningful.contains(r.as_str()) && !covered_roles.contains(r.as_str()))
                .count() as f64
                * 180.)
                .min(800.);
            let profile_novelty = a
                .profile
                .tokens
                .iter()
                .filter(|t| !covered_profile.contains(t.as_str()))
                .map(|t| {
                    (1. - support.get(t.as_str()).copied().unwrap_or(analyses.len()) as f64
                        / analyses.len().max(1) as f64)
                        * 150.
                })
                .sum::<f64>()
                .min(900.);
            eligible.push((*i, conflicts, scores[*i] + role_novelty + profile_novelty));
        }
        eligible.sort_by(|(i, _, a), (j, _, b)| {
            b.total_cmp(a).then_with(|| {
                name_cmp(
                    &entities[analyses[*i].entity].name,
                    &entities[analyses[*j].entity].name,
                )
            })
        });
        let Some((i, conflicts, marginal)) = eligible.into_iter().next() else {
            break;
        };
        remaining.retain(|j| *j != i);
        let mut merged = vec!["backfill".to_string()];
        if !conflicts.is_empty() {
            replacements += 1;
            for c in &selected {
                if conflicts.contains(&c.entity) {
                    merged.extend(c.roles.clone());
                }
            }
            merged = unique(merged);
            selected.retain(|c| !conflicts.contains(&c.entity));
        }
        let s = Selection {
            analysis: i,
            role: "backfill".into(),
            kind: SelectionKind::Filler,
            score: marginal,
            priority: 900.,
        };
        let candidates = builder.selection_cards(&analyses[i], &s, by_id);
        let candidates = builder.normalize(candidates);
        let mut groups = [0usize; 2];
        for c in &selected {
            if let Some(t) = c.transport {
                groups[usize::from(rules::air(&entities[t]))] += 1;
            }
        }
        let candidate = candidates.into_iter().min_by(|a, b| {
            let count = |c: &Card| {
                c.transport.map_or(-1isize, |t| {
                    groups[usize::from(rules::air(&entities[t]))] as isize
                })
            };
            count(a)
                .cmp(&count(b))
                .then_with(|| name_cmp(&a.pack, &b.pack))
        });
        if let Some(mut c) = candidate {
            c.roles = merged;
            selected.push(c)
        }
    }
    selected
}
