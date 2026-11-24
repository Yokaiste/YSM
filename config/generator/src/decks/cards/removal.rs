use super::coverage::coverage_target;
use super::*;

#[derive(Default)]
pub(super) struct Removal {
    similarity: HashMap<String, usize>,
    pub(super) entities: HashMap<EntityId, usize>,
    ground: HashMap<EntityId, HashMap<EntityId, usize>>,
    providers: IndexMap<String, HashMap<EntityId, usize>>,
}
impl Removal {
    pub(super) fn new(cards: &[Card], entities: &[Entity]) -> Self {
        let mut s = Self::default();
        let mut roles = Vec::new();
        for c in cards {
            *s.similarity.entry(c.similarity_key.clone()).or_default() += 1;
            *s.entities.entry(c.entity).or_default() += 1;
            roles.extend(c.coverage().iter().cloned());
            if let Some(t) = c.transport.filter(|id| !rules::air(&entities[*id])) {
                *s.ground.entry(c.entity).or_default().entry(t).or_default() += 1;
            }
        }
        for role in unique(roles) {
            let mut providers = HashMap::new();
            for c in cards {
                if provides(c, &role) {
                    *providers.entry(c.entity).or_default() += 1;
                }
            }
            s.providers.insert(role, providers);
        }
        s
    }
    pub(super) fn remove(&mut self, c: &Card, entities: &[Entity]) {
        fn decrement<K: Eq + std::hash::Hash>(map: &mut HashMap<K, usize>, key: &K) {
            if let Some(count) = map.get_mut(key) {
                *count -= 1;
                if *count == 0 {
                    map.remove(key);
                }
            }
        }
        decrement(&mut self.similarity, &c.similarity_key);
        decrement(&mut self.entities, &c.entity);
        if let Some(t) = c.transport.filter(|id| !rules::air(&entities[*id]))
            && let Some(transports) = self.ground.get_mut(&c.entity)
        {
            decrement(transports, &t);
            if transports.is_empty() {
                self.ground.remove(&c.entity);
            }
        }
        for (role, providers) in &mut self.providers {
            if provides(c, role) {
                decrement(providers, &c.entity);
            }
        }
    }
    pub(super) fn provider_count(&self, role: &str) -> usize {
        self.providers.get(role).map_or(0, HashMap::len)
    }
    pub(super) fn score(&self, c: &Card, entities: &[Entity], diversity: f64) -> f64 {
        let same_ground = c.transport.is_some()
            && self
                .ground
                .get(&c.entity)
                .is_some_and(|t| t.keys().any(|id| Some(*id) != c.transport));
        let air = c.transport.is_some_and(|id| rules::air(&entities[id]));
        let sellable = self.entities.get(&c.entity).copied().unwrap_or(0) > 1
            && c.transport.is_some_and(|id| entities[id].is_sellable);
        let mut protection = 0.;
        for role in c.coverage() {
            let count = self.provider_count(role);
            let target = coverage_target(role, count);
            if target > 1 && count <= target {
                protection += (target + 1 - count) as f64 * 2500.;
            } else if role.starts_with("capability:") && count == 1 {
                protection += 2000.;
            } else if role.starts_with("trait:") && count == 1 {
                protection += 800.;
            }
        }
        c.keep_priority + c.role_score * 0.04
            - self.similarity.get(&c.similarity_key).copied().unwrap_or(0) as f64 * 420.
            - if c.kind == SelectionKind::Filler {
                700.
            } else {
                0.
            }
            - if same_ground && air { 1500. } else { 0. }
            + if sellable { 4000. } else { 0. }
            + protection
            + diversity
    }
    pub(super) fn removable(&self, c: &Card, targets: &IndexMap<String, usize>) -> bool {
        c.coverage().iter().all(|role| {
            let wanted = targets.get(role).copied().unwrap_or(0);
            if wanted == 0 {
                return true;
            }
            let providers = self.providers.get(role);
            let count = providers
                .and_then(|p| p.get(&c.entity))
                .copied()
                .unwrap_or(0);
            providers
                .map_or(0, HashMap::len)
                .saturating_sub(usize::from(count == 1))
                >= wanted
        })
    }
}
