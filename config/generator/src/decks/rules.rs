use super::{config::Config, data::*};
use std::{cmp::Ordering, collections::HashMap};
pub fn pack_profile(rule: &Rule, preferred: usize) -> Option<(usize, usize, usize)> {
    if rule.max_pack_number == 0 {
        return None;
    }
    for xp in unique([preferred, 1, 2, 0, 3]) {
        let number = rule.count(xp);
        if number > 0 {
            return Some((xp, number, rule.max_pack_number));
        }
    }
    None
}
fn reasonable(r: &Rule) -> bool {
    r.max_pack_number > 0 && r.peak() > 0
}
pub fn balanced(
    entities: &[Entity],
    deckable: &[EntityId],
    vanilla: &HashMap<String, Rule>,
) -> Vec<Rule> {
    let types: Vec<_> = entities
        .iter()
        .map(|e| sanitize(semantic_type(e)))
        .collect();
    let commands: Vec<_> = entities.iter().map(command).collect();
    let candidates: Vec<_> = deckable
        .iter()
        .filter_map(|id| {
            vanilla
                .get(&entities[*id].name)
                .filter(|r| reasonable(r))
                .map(|r| (*id, r))
        })
        .collect();
    entities
        .iter()
        .enumerate()
        .map(|(entity_id, e)| {
            if let Some(r) = vanilla.get(&e.name).filter(|r| reasonable(r)) {
                return r.clone();
            }
            let mut tiers: [Vec<(EntityId, &Rule)>; 5] = std::array::from_fn(|_| Vec::new());
            for (id, r) in &candidates {
                let c = &entities[*id];
                if c.name == e.name {
                    continue;
                }
                let tier = if c.factory_type != e.factory_type {
                    4
                } else if types[*id] != types[entity_id] {
                    3
                } else if c.kind != e.kind {
                    2
                } else if commands[*id] != commands[entity_id] {
                    1
                } else {
                    0
                };
                let t = &mut tiers[tier];
                t.push((*id, *r));
                t.sort_by(|(a, _), (b, _)| {
                    (entities[*a].cost - e.cost)
                        .abs()
                        .total_cmp(&(entities[*b].cost - e.cost).abs())
                        .then_with(|| name_cmp(&entities[*a].name, &entities[*b].name))
                });
                t.truncate(5);
            }
            for t in tiers {
                if let Some((_, r)) = t.into_iter().min_by(|(_, a), (_, b)| {
                    for xp in 0..4 {
                        let c = b.count(xp).cmp(&a.count(xp));
                        if c != Ordering::Equal {
                            return c;
                        }
                    }
                    b.max_pack_number
                        .cmp(&a.max_pack_number)
                        .then_with(|| name_cmp(&a.unit_name, &b.unit_name))
                }) {
                    let mut counts = [0.; 4];
                    let mut last = 0.;
                    for (xp, n) in counts.iter_mut().enumerate() {
                        let count = r.count(xp) as f64;
                        if count > 0. {
                            *n = if last > 0. && count > last {
                                last
                            } else {
                                count
                            };
                            last = *n;
                        }
                    }
                    if counts.iter().all(|n| *n <= 0.) {
                        return Rule {
                            unit_name: e.name.clone(),
                            max_pack_number: r.max_pack_number.max(1),
                            ..Rule::fallback()
                        };
                    }
                    let max = counts.into_iter().fold(1., f64::max);
                    return Rule {
                        unit_name: e.name.clone(),
                        max_pack_number: r.max_pack_number.max(1),
                        number_of_unit_in_pack: max,
                        multipliers: counts
                            .iter()
                            .map(|c| if *c <= 0. { 0. } else { c / max })
                            .collect(),
                    };
                }
            }
            Rule {
                unit_name: e.name.clone(),
                ..Rule::fallback()
            }
        })
        .collect()
}
pub fn entries(
    pool: &[EntityId],
    entities: &[Entity],
    mode: Mode,
    balanced: &[Rule],
    legal_transports: &[Vec<EntityId>],
    config: &Config,
) -> Vec<RuleEntry> {
    let available: std::collections::HashSet<_> = pool.iter().copied().collect();
    let max = config.static_counts.into_iter().fold(0., f64::max);
    pool.iter()
        .map(|id| {
            let e = &entities[*id];
            let rule = match mode {
                Mode::Unlimited => Rule {
                    unit_name: e.name.clone(),
                    max_pack_number: config.slots,
                    number_of_unit_in_pack: config.unlimited_count as f64,
                    multipliers: vec![1.; 4],
                },
                Mode::StaticBalanced => Rule {
                    unit_name: e.name.clone(),
                    max_pack_number: config.slots,
                    number_of_unit_in_pack: max,
                    multipliers: config.static_counts.iter().map(|n| n / max).collect(),
                },
                Mode::Balanced => Rule {
                    max_pack_number: config.slots,
                    ..balanced[*id].clone()
                },
            };
            let transports = legal_transports[*id]
                .iter()
                .copied()
                .filter(|id| available.contains(id))
                .collect();
            RuleEntry {
                entity: *id,
                rule,
                transports,
            }
        })
        .collect()
}
pub fn air(e: &Entity) -> bool {
    matches!(mobility(e), "Helicopter" | "Plane")
}

pub fn legal_transports(entities: &[Entity]) -> Vec<Vec<EntityId>> {
    let is_air: Vec<_> = entities.iter().map(air).collect();
    let mut order: Vec<_> = (0..entities.len()).collect();
    order.sort_by(|a, b| {
        (!is_air[*a])
            .cmp(&(!is_air[*b]))
            .then(entities[*b].cost.total_cmp(&entities[*a].cost))
            .then_with(|| name_cmp(&entities[*a].name, &entities[*b].name))
    });
    let mut rank = vec![0; entities.len()];
    let mut by_tag: HashMap<&str, Vec<EntityId>> = HashMap::new();
    for (position, id) in order.into_iter().enumerate() {
        rank[id] = position;
        for tag in &entities[id].transportable_tags {
            by_tag.entry(tag).or_default().push(id);
        }
    }
    entities
        .iter()
        .map(|e| {
            if !e.is_transportable {
                return Vec::new();
            }
            let mut legal = unique(
                e.tags
                    .iter()
                    .flat_map(|tag| by_tag.get(tag.as_str()).into_iter().flatten())
                    .copied(),
            );
            legal.sort_by_key(|id| rank[*id]);
            legal
        })
        .collect()
}
