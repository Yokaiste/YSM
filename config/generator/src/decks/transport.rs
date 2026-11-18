use super::{
    analysis::{self, Analysis},
    cards::SelectionKind,
    config::Config,
    data::*,
    rules::air,
    scoring,
};
use std::{cmp::Ordering, collections::HashMap};
pub fn affordable(
    entry: &RuleEntry,
    unit: &Entity,
    entities: &[Entity],
    config: &Config,
) -> Vec<EntityId> {
    let limit = unit.cost.max(1.) * config.transport_cost_ratio;
    entry
        .transports
        .iter()
        .copied()
        .filter(|id| config.transport_cost_ratio <= 0. || entities[*id].cost <= limit)
        .collect()
}
fn chassis(e: &Entity) -> f64 {
    let initiative =
        e.deployment_shift_gru.unwrap_or(0.) * 0.25 - e.weapon_deployment_time.unwrap_or(0.) * 40.;
    analysis::mobility_score(e) * 1.6
        + analysis::stealth(e) * 0.7
        + analysis::survivability(e) * 0.45
        + analysis::amphibious(e) * 0.9
        + e.weapon_descriptor_names.len() as f64 * 320.
        + initiative
        - if air(e) { 90. } else { 0. }
}
#[derive(Clone, Copy)]
struct Score {
    sellable: bool,
    utility: f64,
    cost: f64,
}
fn score(
    id: EntityId,
    unit: &Entity,
    kind: SelectionKind,
    entities: &[Entity],
    analyses: &HashMap<EntityId, &Analysis>,
) -> Score {
    let e = &entities[id];
    let mut utility = analyses
        .get(&id)
        .map_or_else(|| chassis(e), |a| scoring::transport(a, e));
    if kind.cheap() {
        let cost = unit.cost.max(1.);
        let relative = (e.cost - cost * 0.65).max(0.) * 42.;
        let share = (e.cost / cost - 0.9).max(0.) * 750.;
        let bonus = if e.cost <= cost * 0.5 {
            160.
        } else if e.cost <= cost {
            60.
        } else {
            0.
        };
        utility = utility * 0.22 - e.cost * 24. - relative - share - if air(e) { 180. } else { 0. }
            + bonus;
    }
    Score {
        sellable: e.is_sellable,
        utility,
        cost: e.cost,
    }
}
fn compare(a: (EntityId, Score), b: (EntityId, Score), entities: &[Entity]) -> Ordering {
    b.1.sellable
        .cmp(&a.1.sellable)
        .then(b.1.utility.total_cmp(&a.1.utility))
        .then(a.1.cost.total_cmp(&b.1.cost))
        .then_with(|| name_cmp(&entities[a.0].name, &entities[b.0].name))
}
fn best(
    ids: &[EntityId],
    unit: &Entity,
    kind: SelectionKind,
    entities: &[Entity],
    analyses: &HashMap<EntityId, &Analysis>,
) -> Option<(EntityId, Score)> {
    ids.iter()
        .map(|id| (*id, score(*id, unit, kind, entities, analyses)))
        .min_by(|a, b| compare(*a, *b, entities))
}
pub fn selected(
    entry: &RuleEntry,
    kind: SelectionKind,
    entities: &[Entity],
    analyses: &HashMap<EntityId, &Analysis>,
    config: &Config,
) -> Vec<Option<EntityId>> {
    let unit = &entities[entry.entity];
    let available = affordable(entry, unit, entities, config);
    let mut selected = Vec::new();
    for group in [false, true] {
        let ids: Vec<_> = available
            .iter()
            .copied()
            .filter(|id| air(&entities[*id]) == group)
            .collect();
        if let Some(best) = best(&ids, unit, kind, entities, analyses) {
            selected.push(best);
        }
    }
    if selected.is_empty() {
        return vec![None];
    }
    selected.sort_by(|a, b| compare(*a, *b, entities));
    selected.truncate(entry.rule.max_pack_number.max(1));
    selected.into_iter().map(|(id, _)| Some(id)).collect()
}
pub fn normalize(
    current: Option<EntityId>,
    entry: &RuleEntry,
    kind: SelectionKind,
    entities: &[Entity],
    config: &Config,
) -> Option<EntityId> {
    let unit = &entities[entry.entity];
    let available = affordable(entry, unit, entities, config);
    if available.is_empty() {
        return None;
    }
    if current.is_some_and(|id| available.contains(&id)) {
        return current;
    }
    if kind.cheap() {
        return best(&available, unit, kind, entities, &HashMap::new()).map(|(id, _)| id);
    }
    let same: Vec<_> = available
        .iter()
        .copied()
        .filter(|id| current.is_some_and(|c| air(&entities[c]) == air(&entities[*id])))
        .collect();
    let candidates = if same.is_empty() { &available } else { &same };
    candidates.iter().copied().min_by(|a, b| {
        entities[*b]
            .is_sellable
            .cmp(&entities[*a].is_sellable)
            .then(chassis(&entities[*b]).total_cmp(&chassis(&entities[*a])))
            .then(entities[*a].cost.total_cmp(&entities[*b].cost))
            .then_with(|| name_cmp(&entities[*a].name, &entities[*b].name))
    })
}
pub fn rank(id: Option<EntityId>, entities: &[Entity]) -> usize {
    id.map_or(0, |id| if air(&entities[id]) { 2 } else { 1 })
}
