use super::*;

pub(super) fn payload_token(role: &str) -> Option<String> {
    let r = role
        .strip_prefix("pair:")
        .or_else(|| role.strip_prefix("triple:"))
        .unwrap_or(role);
    r.strip_prefix("capability:ammo_family_")
        .map(|s| format!("ammo:family_{s}"))
        .or_else(|| {
            r.strip_prefix("capability:ammo_trait_")
                .map(|s| format!("ammo:trait_{s}"))
        })
}
pub fn provides(card: &Card, role: &str) -> bool {
    if let Some(coverage) = &card.coverage {
        return coverage.iter().any(|r| r == role);
    }
    card.roles.iter().any(|r| r == role)
        || payload_token(role).is_some_and(|t| card.profile.tokens.contains(&t))
}
pub(super) fn coverage_role(role: &str) -> bool {
    [
        "main:",
        "pair:",
        "triple:",
        "primary:",
        "type:",
        "role:",
        "trait:",
        "capability:",
    ]
    .iter()
    .any(|p| role.starts_with(p))
}
pub(super) fn coverage_target(role: &str, available: usize) -> usize {
    available.min(if role.contains("command") {
        2
    } else if role.starts_with("main:") || role.starts_with("triple:") {
        3
    } else if role.starts_with("pair:") {
        2
    } else {
        1
    })
}
pub(super) fn priorities(cards: &[Card]) -> HashMap<String, f64> {
    let mut p = HashMap::new();
    for c in cards {
        for role in c.coverage() {
            let value = p.entry(role.clone()).or_insert(0f64);
            *value = value.max(c.keep_priority);
        }
    }
    p
}
pub(super) fn role_priority(role: &str, p: &HashMap<String, f64>) -> f64 {
    p.get(role).copied().unwrap_or(0.) + if role.contains("command") { 350. } else { 0. }
}
pub(super) fn coverage_floor(
    roles: &IndexMap<EntityId, HashSet<String>>,
    targets: &IndexMap<String, usize>,
    entities: &[Entity],
) -> usize {
    let mut remaining = targets.clone();
    let mut available: HashSet<_> = roles.keys().copied().collect();
    let mut count = 0;
    while remaining.values().any(|n| *n > 0) {
        let best = available
            .iter()
            .map(|id| {
                (
                    *id,
                    roles[id]
                        .iter()
                        .filter(|r| remaining.get(*r).copied().unwrap_or(0) > 0)
                        .count(),
                )
            })
            .min_by(|(a, av), (b, bv)| {
                bv.cmp(av)
                    .then_with(|| name_cmp(&entities[*a].name, &entities[*b].name))
            });
        let Some((id, _)) = best.filter(|(_, n)| *n > 0) else {
            break;
        };
        available.remove(&id);
        count += 1;
        for role in &roles[&id] {
            if let Some(n) = remaining.get_mut(role) {
                *n = n.saturating_sub(1);
            }
        }
    }
    count
}
pub(super) fn coverage_targets(
    cards: &[Card],
    limit: usize,
    entities: &[Entity],
) -> IndexMap<String, usize> {
    let context = Removal::new(cards, entities);
    let priority = priorities(cards);
    let mut roles: IndexMap<EntityId, HashSet<String>> = IndexMap::new();
    for c in cards {
        roles
            .entry(c.entity)
            .or_default()
            .extend(c.coverage().iter().cloned());
    }
    let mut keys: Vec<_> = unique(
        cards
            .iter()
            .flat_map(|c| c.coverage())
            .filter(|r| coverage_role(r))
            .cloned(),
    );
    keys.sort_by(|a, b| {
        role_priority(b, &priority)
            .total_cmp(&role_priority(a, &priority))
            .then_with(|| name_cmp(a, b))
    });
    let mut targets = IndexMap::new();
    for count in 1..=3 {
        for role in &keys {
            if coverage_target(role, context.provider_count(role)) < count {
                continue;
            }
            let mut candidate = targets.clone();
            candidate.insert(role.clone(), count);
            if coverage_floor(&roles, &candidate, entities) <= limit {
                targets.insert(role.clone(), count);
            }
        }
    }
    targets
}
