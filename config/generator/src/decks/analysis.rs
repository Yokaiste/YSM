use super::{
    data::*,
    focus::focus,
    metrics::{ALL, M, Metrics, SIMILARITY},
    weapons,
};
use std::{
    collections::{BTreeSet, HashMap, HashSet},
    sync::{Arc, OnceLock},
};
pub const WEAPON_PREFIXES: [&str; 9] = [
    "ammo:",
    "ammo_loadout:",
    "channel:",
    "effect:",
    "effect_range:",
    "loadout:",
    "mechanic:",
    "range_band:",
    "range_class:",
];
#[derive(Clone, Debug, Default)]
pub struct Profile {
    pub duplicate_purpose: String,
    pub purpose_key: String,
    pub purpose_limit: usize,
    pub is_command: bool,
    pub platform: &'static str,
    pub mobility: &'static str,
    pub tokens: BTreeSet<String>,
    pub effects: BTreeSet<String>,
    pub weapon: BTreeSet<String>,
    pub diversity: BTreeSet<String>,
    pub payload: BTreeSet<String>,
    pub full_payload: BTreeSet<String>,
    pub reserves: HashMap<String, f64>,
}
impl Profile {
    pub fn new(e: &Entity, type_key: &str, tokens: impl IntoIterator<Item = String>) -> Self {
        let mut p = Self::default();
        for t in tokens {
            if ["scope:", "effect:", "mechanic:"]
                .iter()
                .any(|prefix| t.starts_with(prefix))
            {
                p.effects.insert(t.clone());
            }
            if let Some(c) = t
                .strip_prefix("ammo:")
                .filter(|s| s.starts_with("family_") || s.starts_with("trait_"))
            {
                p.payload.insert(c.into());
                p.full_payload.insert(c.into());
            }
            if let Some(c) = t
                .strip_prefix("ammo_all:")
                .filter(|s| s.starts_with("family_") || s.starts_with("trait_"))
            {
                p.full_payload.insert(c.into());
            }
            if let Some((signature, amount)) = t
                .strip_prefix("ammo_reserve:")
                .and_then(|s| s.rsplit_once(':'))
                && let Ok(amount) = amount.parse::<f64>()
                && !signature.is_empty()
                && amount.is_finite()
            {
                p.reserves.insert(signature.into(), amount);
            }
            if WEAPON_PREFIXES.iter().any(|prefix| t.starts_with(prefix)) {
                p.weapon.insert(t.clone());
            }
            if t.starts_with("scope:") || WEAPON_PREFIXES.iter().any(|prefix| t.starts_with(prefix))
            {
                p.diversity.insert(t.clone());
            }
            p.tokens.insert(t);
        }
        p.platform = platform(e);
        p.mobility = mobility(e);
        p.is_command = command(e);
        p.duplicate_purpose = format!(
            "{}|{}|{}",
            weapons::normalize(e.factory_type.as_deref().unwrap_or("unknown")),
            weapons::normalize(
                e.unit_role
                    .as_deref()
                    .or(e.strategic_type.as_deref())
                    .unwrap_or("unknown")
            ),
            p.platform
        );
        (p.purpose_key, p.purpose_limit) = build_purpose(e, type_key, &p);
        p
    }
}
#[derive(Clone, Debug)]
pub struct Analysis {
    pub entity: EntityId,
    pub rule: Rule,
    pub transports: Vec<EntityId>,
    pub type_key: String,
    pub similarity_key: String,
    pub vector: Metrics,
    pub vector_len: usize,
    pub roles: Vec<String>,
    pub exact: HashSet<String>,
    pub coverage: Vec<String>,
    pub profile: Arc<Profile>,
    pub metrics: Metrics,
    pub relative: Metrics,
}
impl Analysis {
    pub fn add_role(&mut self, token: String) {
        if self.exact.insert(token.clone()) {
            self.roles.push(token)
        }
    }
    pub fn view<'a>(&'a self, entities: &'a [Entity]) -> super::similarity::View<'a> {
        super::similarity::View {
            entity: &entities[self.entity],
            vector: &self.vector,
            profile: &self.profile,
            transported: !self.transports.is_empty(),
            length: self.vector_len,
        }
    }
}
pub struct Factory<'a> {
    pub entities: &'a [Entity],
    pub weapons: &'a Weapons,
    pub ammo: &'a Ammunition,
    base: Vec<OnceLock<Analysis>>,
}

#[test]
fn parallel_analyses_share_one_base_profile_and_keep_rule_values_separate() {
    let entities = vec![Entity {
        name: "Sample".into(),
        cost: 10.,
        ..Entity::default()
    }];
    let weapons = Weapons::new();
    let ammo = Ammunition::new();
    let factory = Factory::new(&entities, &weapons, &ammo);
    let entries: Vec<_> = [1., 2.]
        .into_iter()
        .map(|count| RuleEntry {
            entity: 0,
            rule: Rule {
                number_of_unit_in_pack: count,
                ..Rule::fallback()
            },
            transports: Vec::new(),
        })
        .collect();
    let paired = std::sync::Barrier::new(2);
    let analyses = ymb_sdk::parallel::map(
        &entries,
        ymb_sdk::parallel::Limits {
            threads: 2,
            memory_bytes: 4 << 20,
        },
        |_| 1usize << 20,
        |entry| {
            paired.wait();
            factory.analyze(entry)
        },
    );
    assert!(Arc::ptr_eq(&analyses[0].profile, &analyses[1].profile));
    assert_eq!(analyses[0].rule.number_of_unit_in_pack, 1.);
    assert_eq!(analyses[1].rule.number_of_unit_in_pack, 2.);
    assert_eq!(
        analyses[1].metrics[M::Availability],
        analyses[0].metrics[M::Availability] * 2.
    );
}
impl<'a> Factory<'a> {
    pub fn new(entities: &'a [Entity], weapons: &'a Weapons, ammo: &'a Ammunition) -> Self {
        Self {
            entities,
            weapons,
            ammo,
            base: (0..entities.len()).map(|_| OnceLock::new()).collect(),
        }
    }
    pub fn analyze(&self, entry: &RuleEntry) -> Analysis {
        let id = entry.entity;
        let mut a = self.base[id]
            .get_or_init(|| base(id, &self.entities[id], self.weapons, self.ammo))
            .clone();
        a.rule = entry.rule.clone();
        a.transports = entry.transports.clone();
        a.metrics[M::Availability] = (entry.rule.peak() * entry.rule.max_pack_number) as f64;
        a.relative = a.metrics;
        a
    }
}
pub fn category_analyses(
    entries: &[RuleEntry],
    factory: &Factory<'_>,
    xp: Option<usize>,
) -> (Vec<Analysis>, Vec<super::roles::Role>, f64) {
    let entities = factory.entities;
    let mut analyses: Vec<_> = entries.iter().map(|e| factory.analyze(e)).collect();
    let average = if analyses.is_empty() {
        0.
    } else {
        analyses
            .iter()
            .map(|a| entities[a.entity].cost)
            .sum::<f64>()
            / analyses.len() as f64
    };
    for a in &mut analyses {
        if let Some(xp) = xp {
            a.metrics[M::Availability] =
                super::rules::pack_profile(&a.rule, xp).map_or(0., |(_, n, max)| (n * max) as f64)
        }
        let utility = a.metrics.score(&[
            (M::AntiArmor, 1.),
            (M::AntiGround, 1.),
            (M::AntiHelo, 1.),
            (M::AntiPlane, 1.),
            (M::Indirect, 1.),
            (M::Optics, 1.),
            (M::Precision, 1.),
            (M::Supply, 1.),
            (M::Command, 1.),
            (M::Survivability, 1.),
            (M::Suppression, 0.2),
            (M::Mobility, 0.1),
            (M::FireOnMove, 0.18),
            (M::Initiative, 0.12),
            (M::WeaponVariety, 0.35),
            (M::AreaDenial, 1.),
            (M::Sead, 1.),
        ]);
        let cost = entities[a.entity].cost;
        a.metrics[M::Value] = if cost > 0. { utility / cost } else { utility };
    }
    super::roles::capabilities(&mut analyses, entities);
    super::roles::platform_variants(&mut analyses, entities);
    relative(&mut analyses);
    let mut maximum = Metrics::default();
    for a in &analyses {
        for m in SIMILARITY {
            maximum[m] = maximum[m].max(a.metrics[m]);
        }
    }
    for a in &mut analyses {
        a.vector_len = SIMILARITY.len();
        for m in SIMILARITY {
            a.vector[m] = if maximum[m] > 0. {
                a.metrics[m].max(0.) / maximum[m] * 1000.
            } else {
                0.
            };
        }
    }
    let definitions = super::roles::discover(&mut analyses, entities);
    (analyses, definitions, average)
}
pub fn agility(e: &Entity) -> f64 {
    let r = e.agility_radius_gru.unwrap_or(0.);
    if r > 0. { 100000. / r.max(1.) } else { 0. }
}
pub fn stealth(e: &Entity) -> f64 {
    e.concealment_bonus.unwrap_or(0.) * 180.
}
pub fn amphibious(e: &Entity) -> f64 {
    if e.pathfind_type
        .iter()
        .chain(e.moving_type.iter())
        .any(|s| s.to_ascii_lowercase().contains("amphibious"))
    {
        180.
    } else {
        0.
    }
}
pub fn survivability(e: &Entity) -> f64 {
    e.max_physical_damages.unwrap_or(0.).max(0.).powf(1.18) * 75.
        + (e.front_armor.unwrap_or(0.).max(0.).powf(1.3) * 72.
            + e.side_armor.unwrap_or(0.).max(0.).powf(1.22) * 52.
            + e.rear_armor.unwrap_or(0.).max(0.).powf(1.16) * 30.
            + e.top_armor.unwrap_or(0.).max(0.).powf(1.2) * 40.)
        + (-e.hit_roll_ecm.unwrap_or(0.)).max(0.) * 1250.
        + agility(e) * 1.5
}
pub fn mobility_score(e: &Entity) -> f64 {
    let speed = e.max_speed_kmph.unwrap_or(0.);
    speed * 20.
        + speed * e.speed_bonus_factor_on_road.unwrap_or(1.) * 4.
        + e.fuel_capacity.unwrap_or(0.) * 0.18
        + e.fuel_move_duration.unwrap_or(0.) * 0.42
        + agility(e) * 1.2
        + amphibious(e)
        + if mobility(e) == "Helicopter" {
            220.
        } else {
            0.
        }
}
fn capacity_label(s: &str) -> String {
    let s = weapons::normalize(s);
    s.strip_prefix("capacite")
        .or_else(|| s.strip_prefix("capacity"))
        .map(|s| s.strip_prefix('_').unwrap_or(s).to_string())
        .unwrap_or(s)
}
fn base(id: EntityId, e: &Entity, weapons: &Weapons, ammo: &Ammunition) -> Analysis {
    let type_key = type_key(e);
    let (mut metrics, mut tokens) = weapons::analyze(e, weapons, ammo);
    let agility = agility(e);
    let response = (30. - e.travel_duration.unwrap_or(30.).max(0.)).max(0.) * 32.
        + (25. - e.evacuation_time.unwrap_or(25.).max(0.)).max(0.) * 20.;
    let optics = e.optical_strength.unwrap_or(0.) / 12.
        + e.vision_range.unwrap_or(0.) * 0.045
        + e.identify_base_probability.unwrap_or(0.) * 480.;
    metrics[M::AirOptics] =
        e.air_optical_strength.unwrap_or(0.) / 12. + e.air_vision_range.unwrap_or(0.) * 0.045;
    metrics[M::Amphibious] = amphibious(e);
    metrics[M::Command] = if command(e) {
        1600. + if e.can_assist == Some(true) { 240. } else { 0. }
    } else {
        0.
    };
    metrics[M::Effect] = e.effect_utility.max(0.) * 240.;
    metrics[M::Initiative] = e.deployment_shift_gru.unwrap_or(0.) * 1.2
        + e.max_speed_kmph.unwrap_or(0.) * 12.
        + optics * 0.18
        + metrics[M::FireOnMove] * 0.12
        - e.weapon_deployment_time.unwrap_or(0.) * 90.
        + response
        + agility * 2.;
    metrics[M::Mobility] = mobility_score(e);
    metrics[M::Optics] = optics;
    metrics[M::Stealth] = stealth(e);
    metrics[M::Supply] = if e.has_supply_module {
        e.supply_capacity.unwrap_or(0.)
            + e.supply_priority.map_or(0., |p| (10. - p).max(0.) * 120.)
            + 400.
    } else {
        0.
    };
    metrics[M::Survivability] = survivability(e);
    let negative: Vec<_> = e
        .negative_capacity_names
        .iter()
        .map(|s| capacity_label(s))
        .collect();
    let specialties: Vec<_> = e
        .specialties
        .iter()
        .map(|s| weapons::normalize(s))
        .filter(|s| !s.is_empty() && !negative.iter().any(|n| n.contains(s) || s.contains(n)))
        .collect();
    for s in &specialties {
        if focus(&format!("trait:{s}"), false)
            .0
            .iter()
            .any(|v| *v != 0.)
        {
            tokens.push(format!("effect:trait_{s}"));
        }
    }
    tokens.extend(e.positive_effect_tokens.clone());
    let mut roles = vec![format!("type:{}", weapons::normalize(&type_key))];
    if let Some(role) = e.unit_role.as_deref().filter(|s| !s.is_empty()) {
        roles.push(format!("primary:{}", weapons::normalize(role)));
    }
    if let Some(strategy) = e.strategic_type.as_deref().filter(|s| *s != "NotCounted") {
        let role = weapons::normalize(strategy);
        if e.unit_role.as_deref().is_none_or(|s| s.is_empty()) {
            roles.push(format!("primary:{role}"));
        } else if e.unit_role.as_deref().map(weapons::normalize).as_deref() != Some(&role) {
            roles.push(format!("role:{role}"));
        }
    }
    roles.extend(specialties.iter().map(|s| format!("trait:{s}")));
    roles.extend(
        e.positive_capacity_names
            .iter()
            .map(|s| format!("trait:effect_{}", capacity_label(s))),
    );
    let roles = unique(roles);
    let exact = roles.iter().cloned().collect();
    let bucket = |v: f64| {
        if v <= 0. {
            "0"
        } else if v < 200. {
            "1"
        } else if v < 800. {
            "2"
        } else if v < 2400. {
            "3"
        } else {
            "4"
        }
    };
    let similarity_key = [
        sanitize(category(e)),
        sanitize(
            e.unit_role
                .as_deref()
                .or(e.strategic_type.as_deref())
                .unwrap_or("Unknown"),
        ),
        sanitize(e.menu_icon_texture.as_deref().unwrap_or("Unknown")),
        bucket(metrics[M::AntiArmor]).into(),
        bucket(metrics[M::AntiGround]).into(),
        bucket(metrics[M::AntiPlane] + metrics[M::AntiHelo]).into(),
        bucket(metrics[M::FireOnMove]).into(),
        bucket(metrics[M::Initiative]).into(),
        bucket(metrics[M::Mobility]).into(),
        bucket(metrics[M::Survivability]).into(),
        bucket(e.cost).into(),
    ]
    .join("|");
    let profile = Arc::new(Profile::new(e, &type_key, tokens));
    Analysis {
        entity: id,
        rule: Rule::default(),
        transports: Vec::new(),
        type_key,
        similarity_key,
        vector: Metrics::default(),
        vector_len: 0,
        roles,
        exact,
        coverage: Vec::new(),
        profile,
        metrics,
        relative: metrics,
    }
}
fn relative(a: &mut [Analysis]) {
    for m in ALL {
        let mut ranked: Vec<_> = (0..a.len()).collect();
        ranked.sort_by(|i, j| a[*i].metrics[m].total_cmp(&a[*j].metrics[m]));
        let max_rank = ranked.len().saturating_sub(1).max(1) as f64;
        let maximum = ranked.iter().map(|i| a[*i].metrics[m]).fold(0., f64::max);
        let mut i = 0;
        while i < ranked.len() {
            let value = a[ranked[i]].metrics[m];
            let mut end = i + 1;
            while end < ranked.len() && a[ranked[end]].metrics[m] == value {
                end += 1
            }
            let percentile = (i + end - 1) as f64 / 2. / max_rank * 1000.;
            let magnitude = if value > 0. && maximum > 0. {
                (value / maximum).sqrt() * 1000.
            } else {
                0.
            };
            for n in &ranked[i..end] {
                a[*n].relative[m] = if value > 0. {
                    magnitude * 0.8 + percentile * 0.2
                } else {
                    0.
                };
            }
            i = end;
        }
    }
}
fn build_purpose(e: &Entity, type_key: &str, p: &Profile) -> (String, usize) {
    let semantic = weapons::normalize(
        e.unit_role
            .as_deref()
            .or(e.strategic_type.as_deref())
            .unwrap_or(type_key),
    );
    let mechanics: Vec<_> = p
        .tokens
        .iter()
        .filter(|t| t.starts_with("mechanic:trait_"))
        .filter(|t| {
            let mechanic = weapons::normalize(t.trim_start_matches("mechanic:trait_"));
            mechanic == semantic || mechanic.contains(&semantic) || semantic.contains(&mechanic)
        })
        .cloned()
        .collect();
    let has_mechanic = !mechanics.is_empty();
    let tactical = if has_mechanic {
        mechanics
    } else {
        p.tokens
            .iter()
            .filter(|t| {
                ["channel:", "ammo:projectile_", "ammo:trait_"]
                    .iter()
                    .any(|prefix| t.starts_with(prefix))
            })
            .cloned()
            .collect()
    };
    let tactical = if tactical.is_empty() {
        "unarmed".into()
    } else {
        tactical.join("|")
    };
    let aura = if p
        .tokens
        .iter()
        .any(|t| t.contains("ennemi") || t.contains("enemy"))
    {
        "|enemy_aura"
    } else {
        ""
    };
    (
        format!(
            "{}|{semantic}|{}|{tactical}{aura}",
            category(e),
            platform(e)
        ),
        if has_mechanic { 3 } else { 5 },
    )
}
pub fn median(values: &[f64]) -> f64 {
    if values.is_empty() {
        return 0.;
    }
    let mut v = values.to_vec();
    v.sort_by(f64::total_cmp);
    let mid = v.len() / 2;
    if v.len().is_multiple_of(2) {
        (v[mid - 1] + v[mid]) / 2.
    } else {
        v[mid]
    }
}
