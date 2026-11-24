use super::data::*;
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Division {
    cfg_name: String,
    rules: usize,
    cards: Vec<DeckCard>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Plan {
    rule_groups: Vec<Vec<RuleEntry>>,
    divisions: Vec<Division>,
    packs: Vec<Pack>,
}
pub type Selections = HashMap<String, (Arc<[RuleEntry]>, Vec<DeckCard>)>;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Inputs {
    pub warnings: Vec<String>,
    pub entities: Vec<Entity>,
    pub weapons: Weapons,
    pub ammo: Ammunition,
    pub passes: [Pass; 2],
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pass {
    pub eligible: Vec<EntityId>,
    pub balanced: Vec<Rule>,
}
impl Inputs {
    pub fn validate(&self) -> ymb_sdk::Result<()> {
        ymb_sdk::ensure(
            self.passes.iter().all(|pass| {
                pass.balanced.len() == self.entities.len()
                    && pass.eligible.iter().all(|id| *id < self.entities.len())
            }),
            "Cached deck rules do not match the unit index.",
            "Rebuild without this disposable cache entry.",
        )?;
        for entity in &self.entities {
            for name in &entity.weapon_descriptor_names {
                ymb_sdk::ensure(
                    self.weapons.contains_key(name),
                    format!(
                        "Unit {} references missing weapon manager {name}.",
                        entity.name
                    ),
                    "Enable the mod that defines its weapons.",
                )?;
            }
        }
        for weapon in self.weapons.values() {
            for name in &weapon.ammunition_names {
                ymb_sdk::ensure(
                    self.ammo.contains_key(name),
                    format!(
                        "Weapon {} references missing ammunition {name}.",
                        weapon.name
                    ),
                    "Enable the mod that defines its ammunition.",
                )?;
            }
        }
        Ok(())
    }
}

#[test]
fn parsed_inputs_preserve_numeric_bits_and_contain_no_allocated_identities() {
    let value = f64::from_bits(0x3fd3333333333334);
    let inputs = Inputs {
        warnings: vec!["Unit Fixture has an unknown resistance.".into()],
        entities: vec![Entity {
            name: "Sample".into(),
            cost: value,
            ..Entity::default()
        }],
        weapons: HashMap::new(),
        ammo: HashMap::new(),
        passes: std::array::from_fn(|_| Pass {
            eligible: vec![0],
            balanced: vec![Rule::fallback()],
        }),
    };
    let encoded = serde_json::to_vec(&inputs).unwrap();
    let restored: Inputs = serde_json::from_slice(&encoded).unwrap();
    assert_eq!(restored.entities[0].cost.to_bits(), value.to_bits());
    assert_eq!(restored.entities[0].name, "Sample");
    assert_eq!(restored.warnings, inputs.warnings);
    assert!(restored.validate().is_ok());
    let mut invalid_index: Inputs = serde_json::from_slice(&encoded).unwrap();
    invalid_index.passes[0].eligible.push(1);
    assert!(invalid_index.validate().is_err());
    let mut invalid = restored;
    invalid.entities[0]
        .weapon_descriptor_names
        .push("Missing".into());
    assert!(invalid.validate().is_err());
    let fields: serde_json::Value = serde_json::from_slice(&encoded).unwrap();
    assert!(fields.get("stores").is_none() && fields.get("registry").is_none());
}
impl Plan {
    pub fn capture(divisions: &[Variant], packs: &IndexMap<String, Pack>) -> Self {
        let mut rule_groups = Vec::new();
        let mut groups = HashMap::new();
        let mut rows = Vec::new();
        for d in divisions {
            let pointer = (
                Arc::as_ptr(&d.entries) as *const () as usize,
                d.entries.len(),
            );
            let rules = *groups.entry(pointer).or_insert_with(|| {
                let i = rule_groups.len();
                rule_groups.push(d.entries.to_vec());
                i
            });
            rows.push(Division {
                cfg_name: d.cfg_name.clone(),
                rules,
                cards: d.cards.clone(),
            });
        }
        Self {
            rule_groups,
            divisions: rows,
            packs: packs.values().cloned().collect(),
        }
    }
    pub fn valid(
        &self,
        entities: usize,
        contexts: &[Context],
        tag: &str,
        config: &super::config::Config,
    ) -> bool {
        let mut allowed = HashSet::new();
        for c in contexts {
            let modes = if c.allowed_modes.is_empty() {
                &config.modes
            } else {
                &c.allowed_modes
            };
            for m in modes {
                allowed.insert(format!(
                    "{}_{}_{}",
                    sanitize(tag),
                    c.code,
                    m.name().to_ascii_uppercase()
                ));
            }
        }
        let mut names = HashSet::new();
        self.divisions.iter().all(|d| {
            allowed.contains(&d.cfg_name)
                && names.insert(d.cfg_name.as_str())
                && d.rules < self.rule_groups.len()
                && d.cards
                    .iter()
                    .all(|c| c.entity < entities && c.transport.is_none_or(|t| t < entities))
        }) && self.rule_groups.iter().all(|g| {
            g.iter()
                .all(|r| r.entity < entities && r.transports.iter().all(|id| *id < entities))
        }) && self.packs.iter().all(|p| {
            p.unit < entities
                && p.transport.is_none_or(|t| t < entities)
                && p.xp <= 3
                && p.number > 0
        })
    }
    pub fn restore(self) -> (Selections, IndexMap<String, Pack>) {
        let groups: Vec<Arc<[RuleEntry]>> = self.rule_groups.into_iter().map(Arc::from).collect();
        let divisions = self
            .divisions
            .into_iter()
            .map(|d| (d.cfg_name, (groups[d.rules].clone(), d.cards)))
            .collect();
        let packs = self
            .packs
            .into_iter()
            .map(|p| (p.descriptor_name.clone(), p))
            .collect();
        (divisions, packs)
    }
}
