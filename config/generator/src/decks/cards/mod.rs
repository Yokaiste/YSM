use super::{
    analysis::{Analysis, Profile},
    data::*,
    metrics::Metrics,
    scoring::Perspective,
    similarity,
};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
#[derive(Clone, Copy, Debug, Eq, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum SelectionKind {
    Forced,
    TypeRecommended,
    TypeBest,
    TypeCheap,
    RoleRecommended,
    RoleBest,
    RoleCheap,
    Filler,
}
impl SelectionKind {
    pub fn role(primary: bool, p: Perspective) -> Self {
        match (primary, p) {
            (true, Perspective::Recommended) => Self::TypeRecommended,
            (true, Perspective::Best) => Self::TypeBest,
            (true, Perspective::Cheap) => Self::TypeCheap,
            (false, Perspective::Recommended) => Self::RoleRecommended,
            (false, Perspective::Best) => Self::RoleBest,
            (false, Perspective::Cheap) => Self::RoleCheap,
        }
    }
    pub fn cheap(self) -> bool {
        matches!(self, Self::TypeCheap | Self::RoleCheap)
    }
    pub fn order(self) -> usize {
        match self {
            Self::TypeBest | Self::RoleBest => 0,
            Self::TypeRecommended | Self::RoleRecommended => 1,
            Self::TypeCheap | Self::RoleCheap => 2,
            _ => 3,
        }
    }
}
#[derive(Clone, Debug)]
pub struct Card {
    pub entity: EntityId,
    pub category_order: usize,
    pub type_key: String,
    pub roles: Vec<String>,
    pub coverage: Option<Vec<String>>,
    pub kind: SelectionKind,
    pub forced: bool,
    pub max_count: usize,
    pub role_score: f64,
    pub keep_priority: f64,
    pub similarity_key: String,
    pub vector: Metrics,
    pub vector_len: usize,
    pub profile: Arc<Profile>,
    pub pack: String,
    pub transport: Option<EntityId>,
}
impl Card {
    pub fn view<'a>(&'a self, entities: &'a [Entity]) -> similarity::View<'a> {
        similarity::View {
            entity: &entities[self.entity],
            vector: &self.vector,
            profile: &self.profile,
            transported: self.transport.is_some(),
            length: self.vector_len,
        }
    }
    pub fn coverage(&self) -> &[String] {
        self.coverage.as_deref().unwrap_or(&self.roles)
    }
    pub fn purpose(&self) -> (&str, usize) {
        (&self.profile.purpose_key, self.profile.purpose_limit)
    }
}
use super::{config::Config, rules, selection::Selection, transport};
use indexmap::IndexMap;
use std::collections::{HashMap, HashSet};
use ymb_sdk::{Result, ensure, failure};
pub struct Build<'a> {
    pub entities: &'a [Entity],
    pub config: &'a Config,
    pub mode: Mode,
    pub context: &'a Context,
    pub tag: &'a str,
    pub entries: &'a HashMap<EntityId, RuleEntry>,
    pub packs: &'a mut IndexMap<String, Pack>,
}
impl Build<'_> {
    fn pack(
        &mut self,
        entity: EntityId,
        transport: Option<EntityId>,
        xp: usize,
        number: usize,
    ) -> String {
        let name = &self.entities[entity].name;
        let unit = sanitize(name.strip_prefix("Descriptor_Unit_").unwrap_or(name));
        let transport_name = transport
            .map(|id| {
                let n = &self.entities[id].name;
                sanitize(n.strip_prefix("Descriptor_Unit_").unwrap_or(n))
            })
            .unwrap_or("NoTransport".into());
        let name = format!(
            "Descriptor_Deck_Pack_{}_{}_{unit}_{transport_name}_{}_{xp}_{number}",
            sanitize(self.tag),
            self.context.code,
            self.mode.suffix()
        );
        self.packs.entry(name.clone()).or_insert_with(|| Pack {
            descriptor_name: name.clone(),
            unit: entity,
            transport,
            xp,
            number,
        });
        name
    }
    fn entry_cards(
        &mut self,
        entry: &RuleEntry,
        prototype: Card,
        analyses: &HashMap<EntityId, &Analysis>,
    ) -> Vec<Card> {
        let Some((xp, number, max_count)) = rules::pack_profile(&entry.rule, self.config.veterancy)
        else {
            return Vec::new();
        };
        let transports =
            transport::selected(entry, prototype.kind, self.entities, analyses, self.config);
        let ground = transports
            .iter()
            .flatten()
            .any(|id| !rules::air(&self.entities[*id]));
        transports
            .into_iter()
            .map(|transport| {
                let mut card = prototype.clone();
                card.max_count = max_count;
                card.pack = self.pack(entry.entity, transport, xp, number);
                card.transport = transport;
                if ground && transport.is_some_and(|id| rules::air(&self.entities[id])) {
                    card.keep_priority -= 120.;
                }
                card
            })
            .collect()
    }
    pub fn selection_cards(
        &mut self,
        a: &Analysis,
        s: &Selection,
        analyses: &HashMap<EntityId, &Analysis>,
    ) -> Vec<Card> {
        let e = &self.entities[a.entity];
        let prototype = Card {
            entity: a.entity,
            category_order: category_order(e),
            type_key: a.type_key.clone(),
            roles: vec![s.role.clone()],
            coverage: Some(a.coverage.clone()),
            kind: s.kind,
            forced: false,
            max_count: 0,
            role_score: s.score,
            keep_priority: s.priority,
            similarity_key: a.similarity_key.clone(),
            vector: a.vector,
            vector_len: a.vector_len,
            profile: a.profile.clone(),
            pack: String::new(),
            transport: None,
        };
        let entry = RuleEntry {
            entity: a.entity,
            rule: a.rule.clone(),
            transports: a.transports.clone(),
        };
        self.entry_cards(&entry, prototype, analyses)
    }
    pub fn forced_cards(
        &mut self,
        entry: &RuleEntry,
        analyses: &HashMap<EntityId, &Analysis>,
    ) -> Vec<Card> {
        let e = &self.entities[entry.entity];
        let card = Card {
            entity: entry.entity,
            category_order: category_order(e),
            type_key: type_key(e),
            roles: vec!["forced".into()],
            coverage: None,
            kind: SelectionKind::Forced,
            forced: true,
            max_count: 0,
            role_score: 0.,
            keep_priority: 0.,
            similarity_key: format!("forced:{}", e.name),
            vector: Metrics::default(),
            vector_len: 0,
            profile: Arc::new(Profile::new(e, &type_key(e), Vec::new())),
            pack: String::new(),
            transport: None,
        };
        self.entry_cards(entry, card, analyses)
    }
    pub fn normalize(&mut self, cards: Vec<Card>) -> Vec<Card> {
        let mut normalized = Vec::with_capacity(cards.len());
        for mut card in cards {
            let Some(entry) = self.entries.get(&card.entity) else {
                continue;
            };
            let Some((xp, number, max_count)) =
                rules::pack_profile(&entry.rule, self.config.veterancy)
            else {
                continue;
            };
            card.transport =
                transport::normalize(card.transport, entry, card.kind, self.entities, self.config);
            card.pack = self.pack(card.entity, card.transport, xp, number);
            card.max_count = max_count;
            normalized.push(card);
        }
        enforce_limits(dedupe(normalized), self.entities)
    }
}
fn dedupe(cards: Vec<Card>) -> Vec<Card> {
    let mut by_key: IndexMap<(EntityId, Option<EntityId>), Card> = IndexMap::new();
    for card in cards {
        let key = (card.entity, card.transport);
        if let Some(existing) = by_key.get_mut(&key) {
            let roles = unique(existing.roles.iter().chain(&card.roles).cloned());
            let prefer = if card.forced != existing.forced {
                card.forced
            } else {
                card.keep_priority > existing.keep_priority
                    || (card.keep_priority == existing.keep_priority
                        && card.role_score > existing.role_score)
            };
            if prefer {
                *existing = card
            }
            existing.roles = roles;
        } else {
            by_key.insert(key, card);
        }
    }
    by_key.into_values().collect()
}
pub fn sort(cards: &mut [Card], entities: &[Entity]) {
    cards.sort_by(|a, b| {
        b.forced
            .cmp(&a.forced)
            .then(a.category_order.cmp(&b.category_order))
            .then_with(|| name_cmp(&a.type_key, &b.type_key))
            .then(entities[b.entity].cost.total_cmp(&entities[a.entity].cost))
            .then(a.kind.order().cmp(&b.kind.order()))
            .then_with(|| name_cmp(&entities[a.entity].name, &entities[b.entity].name))
            .then(
                transport::rank(a.transport, entities).cmp(&transport::rank(b.transport, entities)),
            )
    });
}

mod coverage;
mod removal;
mod trim;
pub use coverage::provides;
use removal::Removal;
use trim::enforce_limits;
pub use trim::trim;
