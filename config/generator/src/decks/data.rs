use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};

pub type EntityId = usize;
pub const CATEGORIES: [&str; 9] = [
    "Logistic", "Infantry", "Art", "Tanks", "Recons", "DCA", "Helis", "Planes", "Defense",
];
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Building,
    #[default]
    Unit,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Entity {
    pub name: String,
    pub kind: Kind,
    pub tags: Vec<String>,
    pub specialties: Vec<String>,
    pub transportable_tags: Vec<String>,
    pub weapon_descriptor_names: Vec<String>,
    pub capacity_names: Vec<String>,
    pub positive_capacity_names: Vec<String>,
    pub negative_capacity_names: Vec<String>,
    pub effect_tokens: Vec<String>,
    pub positive_effect_tokens: Vec<String>,
    pub negative_effect_tokens: Vec<String>,
    pub effect_utility: f64,
    pub is_transportable: bool,
    pub is_sellable: bool,
    pub has_supply_module: bool,
    pub order_availability_name: Option<String>,
    pub country: Option<String>,
    pub coalition: Option<String>,
    pub factory_type: Option<String>,
    pub unit_role: Option<String>,
    pub strategic_type: Option<String>,
    pub menu_icon_texture: Option<String>,
    pub spawn_type: Option<String>,
    pub pathfind_type: Option<String>,
    pub moving_type: Option<String>,
    pub front_resistance: Option<Resistance>,
    pub top_resistance: Option<Resistance>,
    pub can_assist: Option<bool>,
    pub cost: f64,
    pub concealment_bonus: Option<f64>,
    pub identify_base_probability: Option<f64>,
    pub hit_roll_ecm: Option<f64>,
    pub max_physical_damages: Option<f64>,
    pub max_speed_kmph: Option<f64>,
    pub speed_bonus_factor_on_road: Option<f64>,
    pub fuel_capacity: Option<f64>,
    pub fuel_move_duration: Option<f64>,
    pub production_time: Option<f64>,
    pub deployment_shift_gru: Option<f64>,
    pub weapon_deployment_time: Option<f64>,
    pub travel_duration: Option<f64>,
    pub evacuation_time: Option<f64>,
    pub agility_radius_gru: Option<f64>,
    pub vision_range: Option<f64>,
    pub optical_strength: Option<f64>,
    pub air_vision_range: Option<f64>,
    pub air_optical_strength: Option<f64>,
    pub front_armor: Option<f64>,
    pub side_armor: Option<f64>,
    pub rear_armor: Option<f64>,
    pub top_armor: Option<f64>,
    pub upkeep_percentage: Option<f64>,
    pub supply_capacity: Option<f64>,
    pub supply_priority: Option<f64>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Resistance {
    pub family: String,
    pub index: usize,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Weapon {
    pub name: String,
    pub ammunition_names: Vec<String>,
    pub salves: Vec<f64>,
    pub mounted_weapons: Vec<Mount>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Mount {
    pub ammunition_name: String,
    pub ammo_box_index: usize,
    pub weapon_count: f64,
    pub traits: Vec<String>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Ammo {
    pub name: String,
    pub damage_family: Option<String>,
    pub min_max_category: Option<String>,
    pub weapon_cursor_type: Option<String>,
    pub projectile_type: Option<String>,
    pub guidance: Option<String>,
    pub fire_descriptor_name: Option<String>,
    pub damage_multipliers: Option<Damage>,
    pub armor_penetration: Option<f64>,
    pub damage_index: Option<f64>,
    pub accuracy_stationary: Option<f64>,
    pub accuracy_moving: Option<f64>,
    pub minimum_range_gru: Option<f64>,
    pub minimum_range_helicopter_gru: Option<f64>,
    pub minimum_range_airplane_gru: Option<f64>,
    pub maximum_range_gru: Option<f64>,
    pub maximum_range_helicopter_gru: Option<f64>,
    pub maximum_range_airplane_gru: Option<f64>,
    pub physical_damages: Option<f64>,
    pub suppress_damages: Option<f64>,
    pub radius_splash_physical_damages_gru: Option<f64>,
    pub radius_splash_suppress_damages_gru: Option<f64>,
    pub shots_count_per_salvo: Option<f64>,
    pub simultaneous_shots_count: Option<f64>,
    pub fire_damage_per_second: Option<f64>,
    pub fire_radius_gru: Option<f64>,
    pub fire_duration: Option<f64>,
    pub aiming_time: Option<f64>,
    pub time_between_two_shots: Option<f64>,
    pub time_between_two_salvos: Option<f64>,
    pub projectile_speed_gru: Option<f64>,
    pub dispersion_at_max_range_gru: Option<f64>,
    pub supply_cost: Option<f64>,
    pub has_smoke: Option<bool>,
    pub can_shoot_on_position: Option<bool>,
    pub can_shoot_while_moving: Option<bool>,
    pub is_fire_and_forget: Option<bool>,
    pub tir_indirect: Option<bool>,
    pub force_hit_top_armor_on_success: Option<bool>,
    pub compute_armor_from_impact_location: Option<bool>,
    pub piercing_weapon: Option<bool>,
    pub tandem_charge: Option<bool>,
}
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct Damage {
    pub ground: f64,
    pub armor: f64,
    pub helo: f64,
    pub plane: f64,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Rule {
    pub unit_name: String,
    pub max_pack_number: usize,
    pub number_of_unit_in_pack: f64,
    pub multipliers: Vec<f64>,
}
impl Rule {
    pub fn fallback() -> Self {
        Self {
            max_pack_number: 10,
            number_of_unit_in_pack: 10.,
            multipliers: vec![1., 0.6, 0.4, 0.1],
            ..Self::default()
        }
    }
    pub fn count(&self, xp: usize) -> usize {
        pack_count(
            self.number_of_unit_in_pack,
            self.multipliers.get(xp).copied().unwrap_or(0.),
        )
    }
    pub fn peak(&self) -> usize {
        (0..self.multipliers.len())
            .map(|xp| self.count(xp))
            .max()
            .unwrap_or(0)
    }
}
pub type Matrix = IndexMap<String, Vec<f64>>;
#[derive(Clone, Debug, Default)]
pub struct Division {
    pub coalition: Option<String>,
    pub max_activation_points: Option<f64>,
    pub cost_matrix_name: Option<String>,
    pub inline_cost_matrix: Matrix,
    pub members: Vec<(String, Vec<String>)>,
    pub inline_rules: Vec<Rule>,
}
#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq, Serialize, Deserialize)]
pub enum Mode {
    Unlimited,
    Balanced,
    StaticBalanced,
}
impl Mode {
    pub const ALL: [Self; 3] = [Self::Unlimited, Self::Balanced, Self::StaticBalanced];
    pub fn name(self) -> &'static str {
        match self {
            Self::Unlimited => "Unlimited",
            Self::Balanced => "Balanced",
            Self::StaticBalanced => "StaticBalanced",
        }
    }
    pub fn suffix(self) -> &'static str {
        match self {
            Self::Unlimited => "UNL",
            Self::Balanced => "BAL",
            Self::StaticBalanced => "STB",
        }
    }
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Scope {
    Country,
    Side,
    AllSide,
    Custom,
}
#[derive(Clone, Debug)]
pub enum Filter {
    Country(String),
    Coalition(String),
    All,
    Patterns(Vec<regex::Regex>),
}
#[derive(Clone, Debug)]
pub struct Context {
    pub code: String,
    pub scope: Scope,
    pub coalition: String,
    pub country_id: String,
    pub name_label: Option<String>,
    pub division_name: Option<String>,
    pub deck_name: Option<String>,
    pub description: Option<String>,
    pub interface_order: Option<f64>,
    pub tags: Vec<String>,
    pub allowed_modes: Vec<Mode>,
    pub emblem_texture: Option<String>,
    pub filter: Filter,
}
impl Context {
    pub fn matches(&self, e: &Entity) -> bool {
        match &self.filter {
            Filter::Country(country) => e.country.as_ref() == Some(country),
            Filter::Coalition(coalition) => e.coalition.as_ref() == Some(coalition),
            Filter::All => true,
            Filter::Patterns(patterns) => matches(patterns, &e.name),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RuleEntry {
    pub entity: EntityId,
    pub rule: Rule,
    pub transports: Vec<EntityId>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pack {
    pub descriptor_name: String,
    pub unit: EntityId,
    pub transport: Option<EntityId>,
    pub xp: usize,
    pub number: usize,
}
pub type Weapons = HashMap<String, Weapon>;
pub type Ammunition = HashMap<String, Ammo>;
pub fn matches(patterns: &[regex::Regex], value: &str) -> bool {
    patterns.iter().any(|p| p.is_match(value))
}
pub fn sanitize(value: &str) -> String {
    let mut result = String::new();
    let mut separator = false;
    for c in value.chars() {
        if c.is_ascii_alphanumeric() {
            if separator && !result.is_empty() {
                result.push('_')
            }
            result.push(c);
            separator = false
        } else {
            separator = true
        }
    }
    result
}
pub fn command(e: &Entity) -> bool {
    std::iter::once(&e.name)
        .chain(e.strategic_type.iter())
        .chain(e.unit_role.iter())
        .chain(&e.tags)
        .chain(&e.specialties)
        .any(|s| {
            s.split(|c: char| !c.is_ascii_alphanumeric()).any(|word| {
                [
                    "cmd",
                    "command",
                    "commander",
                    "hq",
                    "headquarters",
                    "leader",
                ]
                .contains(&word.to_ascii_lowercase().as_str())
            })
        })
}
fn platform_keyword(e: &Entity, words: &[&str]) -> bool {
    e.spawn_type
        .iter()
        .chain(e.moving_type.iter())
        .chain(e.pathfind_type.iter())
        .chain(&e.tags)
        .any(|v| {
            let v: String = v
                .to_ascii_lowercase()
                .chars()
                .filter(char::is_ascii_alphanumeric)
                .collect();
            words.iter().any(|w| v.contains(w))
        })
}
pub fn mobility(e: &Entity) -> &'static str {
    let fields: Vec<_> = e
        .spawn_type
        .iter()
        .chain(e.moving_type.iter())
        .chain(e.pathfind_type.iter())
        .chain(e.factory_type.iter())
        .map(|v| v.to_ascii_lowercase())
        .collect();
    for (key, words) in [
        ("Helicopter", &["helicopter", "heli", "rotary"][..]),
        (
            "Plane",
            &["plane", "aircraft", "airborne", "fixedwing", "jet", "vtol"][..],
        ),
        (
            "Naval",
            &["ship", "boat", "naval", "marine", "sea", "submarine"][..],
        ),
        ("Hover", &["hover", "hovercraft"][..]),
    ] {
        if fields.iter().any(|v| words.iter().any(|w| v.contains(w))) {
            return key;
        }
    }
    match e.factory_type.as_deref() {
        Some("Helis") => "Helicopter",
        Some("Planes") => "Plane",
        _ => {
            if e.kind == Kind::Building {
                "Building"
            } else {
                "Ground"
            }
        }
    }
}
pub fn platform(e: &Entity) -> &'static str {
    if e.kind == Kind::Building {
        return "building";
    }
    if e.is_transportable {
        return if platform_keyword(e, &["infantry", "infanterie"]) {
            "dismounted_infantry"
        } else {
            "towable"
        };
    }
    match mobility(e) {
        "Plane" => "fixed_wing",
        "Helicopter" => "rotary_wing",
        "Naval" => "naval",
        _ => {
            if platform_keyword(e, &["wheel", "roue"]) {
                "wheeled_vehicle"
            } else {
                "tracked_vehicle"
            }
        }
    }
}
pub fn semantic_type(e: &Entity) -> &str {
    e.strategic_type
        .as_deref()
        .filter(|s| *s != "NotCounted")
        .or(e.unit_role.as_deref().filter(|s| !s.is_empty()))
        .unwrap_or_else(|| category(e))
}
pub fn type_key(e: &Entity) -> String {
    if e.kind == Kind::Building {
        return format!(
            "{}_{}",
            if e.has_supply_module {
                "Supply"
            } else {
                "Building"
            },
            mobility(e)
        );
    }
    let t = e
        .strategic_type
        .as_deref()
        .filter(|s| *s != "NotCounted")
        .or(e.unit_role.as_deref().filter(|s| !s.is_empty()))
        .unwrap_or_else(|| {
            if e.has_supply_module {
                "Supply"
            } else {
                category(e)
            }
        });
    format!("{}_{}_{}", sanitize(t), mobility(e), platform(e))
}
pub fn category(e: &Entity) -> &str {
    e.factory_type.as_deref().unwrap_or("Unknown")
}
pub fn category_order(e: &Entity) -> usize {
    CATEGORIES
        .iter()
        .position(|c| *c == category(e))
        .unwrap_or(CATEGORIES.len() + 1)
}
pub fn unique<T: Eq + std::hash::Hash + Clone>(values: impl IntoIterator<Item = T>) -> Vec<T> {
    let mut seen = HashSet::new();
    values
        .into_iter()
        .filter(|x| seen.insert(x.clone()))
        .collect()
}
// NDF identifiers are ASCII. Compare the same punctuation/case levels as the game's tooling.
pub fn name_cmp(a: &str, b: &str) -> Ordering {
    let weight = |c: char| {
        if c == '_' {
            '\0'
        } else {
            c.to_ascii_lowercase()
        }
    };
    a.chars()
        .map(weight)
        .cmp(b.chars().map(weight))
        .then_with(|| b.cmp(a))
}
pub fn pack_count(count: f64, multiplier: f64) -> usize {
    let rounded = format!("{:.4}", count * multiplier)
        .parse::<f64>()
        .unwrap_or(0.);
    (rounded + 0.5).floor().max(0.) as usize
}
#[derive(Clone, Debug)]
pub struct Variant {
    pub context: std::sync::Arc<Context>,
    pub descriptor: String,
    pub rule_name: String,
    pub deck: String,
    pub cfg_name: String,
    pub emblem: String,
    pub metadata: super::store::Metadata,
    pub summary: String,
    pub order: f64,
    pub tags: Vec<String>,
    pub standout: Vec<EntityId>,
    pub entries: std::sync::Arc<[RuleEntry]>,
    pub cards: Vec<DeckCard>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DeckCard {
    pub entity: EntityId,
    pub transport: Option<EntityId>,
    pub pack: String,
    pub forced: bool,
}
impl From<super::cards::Card> for DeckCard {
    fn from(card: super::cards::Card) -> Self {
        Self {
            entity: card.entity,
            transport: card.transport,
            pack: card.pack,
            forced: card.kind == super::cards::SelectionKind::Forced,
        }
    }
}
