use super::*;

pub fn normalize(s: &str) -> String {
    sanitize(s).to_ascii_lowercase()
}
pub fn range_band(v: f64) -> i32 {
    ((v.max(1.) / 700.).ln() / 1.2f64.ln() + 0.5)
        .floor()
        .max(0.) as i32
}
pub fn tokens(a: &Ammo, traits: &[String]) -> HashSet<String> {
    a.damage_family
        .iter()
        .chain(a.projectile_type.iter())
        .chain(a.weapon_cursor_type.iter())
        .chain(a.min_max_category.iter())
        .chain(traits)
        .flat_map(|s| s.split(|c: char| !c.is_ascii_alphanumeric()))
        .filter(|s| !s.is_empty())
        .map(str::to_ascii_lowercase)
        .collect()
}
pub fn indirect(a: &Ammo, traits: &[String]) -> bool {
    let t = tokens(a, traits);
    a.tir_indirect != Some(false)
        && a.can_shoot_on_position == Some(true)
        && a.maximum_range_gru.unwrap_or(0.) >= 1400.
        && (t.contains("ind")
            || t.contains("indirect")
            || a.projectile_type
                .as_deref()
                .is_some_and(|t| t.eq_ignore_ascii_case("artillerie")))
}
pub(super) fn anti_radar(a: &Ammo, traits: &[String]) -> bool {
    a.guidance
        .as_deref()
        .is_some_and(|s| s.eq_ignore_ascii_case("antiradar"))
        || traits.iter().any(|s| s == "sead")
}
pub(super) fn anti_armor(a: &Ammo, traits: &[String]) -> bool {
    if let Some(d) = a.damage_multipliers {
        return d.armor > 0. && a.physical_damages.unwrap_or(0.) > 0.;
    }
    if a.armor_penetration.unwrap_or(0.) < 8. {
        return false;
    }
    let t = tokens(a, traits);
    a.piercing_weapon == Some(true)
        || ["ap", "heat", "kinetic", "topattack", "cluster"]
            .iter()
            .any(|k| t.contains(*k))
}
pub(super) fn precision(a: &Ammo, traits: &[String]) -> f64 {
    let guided = a
        .projectile_type
        .as_deref()
        .is_some_and(|t| t.eq_ignore_ascii_case("guidedmissile"))
        || a.is_fire_and_forget == Some(true);
    let top = a.force_hit_top_armor_on_success == Some(true) && !indirect(a, traits);
    if !guided && !top && a.accuracy_stationary.unwrap_or(0.) < 75. {
        0.
    } else {
        (if guided { 1.45 } else { 1. }) * (if top { 1.55 } else { 1. })
    }
}
pub(super) fn close_combat(a: &Ammo, traits: &[String]) -> f64 {
    let t = tokens(a, traits);
    if ["napalm", "incendiary", "satchel"]
        .iter()
        .any(|s| t.contains(*s))
    {
        return 2.;
    }
    if ["rpo", "flamethrower", "thermobaric"]
        .iter()
        .any(|s| t.contains(*s))
    {
        return 1.7;
    }
    if t.contains("cac")
        && a.maximum_range_gru.unwrap_or(0.) <= 250.
        && a.radius_splash_physical_damages_gru.unwrap_or(0.) >= 50.
    {
        return 1.8;
    }
    if t.contains("cac")
        || a.min_max_category
            .as_deref()
            .is_some_and(|s| s.to_ascii_lowercase().contains("smg"))
    {
        1.
    } else {
        0.
    }
}
pub(super) fn utility(a: &Ammo) -> bool {
    if a.fire_damage_per_second.unwrap_or(0.) > 0. {
        return false;
    }
    (a.has_smoke == Some(true)
        && a.physical_damages.unwrap_or(0.) == 0.
        && a.suppress_damages.unwrap_or(0.) == 0.)
        || (a.physical_damages.unwrap_or(0.) <= 0.25
            && a.suppress_damages.unwrap_or(0.) <= 10.
            && a.armor_penetration.unwrap_or(0.) <= 0.
            && a.maximum_range_gru.unwrap_or(0.) <= 700.
            && a.can_shoot_on_position == Some(true))
}
pub(super) fn ammunition_profile(a: &Ammo, traits: &[String]) -> (Vec<String>, String) {
    let mut c = BTreeSet::new();
    for (kind, s) in [
        ("family", a.damage_family.as_deref()),
        ("class", a.min_max_category.as_deref()),
        ("projectile", a.projectile_type.as_deref()),
    ] {
        if let Some(s) = s {
            let s = normalize(s);
            if !s.is_empty() {
                c.insert(format!("{kind}_{s}"));
            }
        }
    }
    for t in traits {
        let t = normalize(t);
        if !t.is_empty() && !["ap", "ind", "stat"].contains(&t.as_str()) {
            c.insert(format!("trait_{t}"));
        }
    }
    if a.tandem_charge == Some(true) {
        c.insert("trait_tandem".into());
    }
    if c.contains("trait_tandem") {
        c.insert("trait_heat".into());
    }
    if c.is_empty() {
        c.insert("family_unspecified".into());
    }
    let c: Vec<_> = c.into_iter().collect();
    let signature = c.join("+");
    (c, signature)
}
