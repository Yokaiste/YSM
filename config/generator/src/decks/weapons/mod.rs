use super::{
    data::*,
    metrics::{M, Metrics},
};
use indexmap::IndexMap;
use std::collections::{BTreeSet, HashSet};
fn maximum_metric(m: M) -> bool {
    matches!(
        m,
        M::ArmorPenetration
            | M::RangeArmor
            | M::RangeGround
            | M::RangeHelo
            | M::RangePlane
            | M::Response
            | M::OneShotArmor
            | M::OneShotGround
            | M::OneShotHelo
            | M::OneShotPlane
    )
}
fn accuracy(v: f64) -> f64 {
    (v / 100.).clamp(0., 1.)
}
pub fn analyze(e: &Entity, weapons: &Weapons, ammo: &Ammunition) -> (Metrics, Vec<String>) {
    let mut stats = Metrics::default();
    let mut channels = BTreeSet::new();
    let mut mechanics = HashSet::new();
    let mut payload_strengths: IndexMap<String, f64> = IndexMap::new();
    let mut boxes = Vec::new();
    let mut independent = 0;
    let mut profile = BTreeSet::new();
    let mut profile_channels = BTreeSet::new();
    let mut payloads = Vec::new();
    for descriptor_name in &e.weapon_descriptor_names {
        let Some(d) = weapons.get(descriptor_name) else {
            continue;
        };
        let mut box_metrics: IndexMap<usize, Metrics> = IndexMap::new();
        for mount in &d.mounted_weapons {
            if d.salves.get(mount.ammo_box_index).copied().unwrap_or(1.) <= 0.
                || mount.weapon_count <= 0.
            {
                continue;
            }
            let Some(a) = ammo.get(&mount.ammunition_name) else {
                continue;
            };
            let traits = &mount.traits;
            let reserve = d
                .salves
                .get(mount.ammo_box_index)
                .copied()
                .unwrap_or(1.)
                .max(1.);
            if a.fire_damage_per_second.unwrap_or(0.) > 0. {
                profile.insert("mechanic:area_denial".into());
            }
            if a.has_smoke == Some(true) && a.maximum_range_gru.unwrap_or(0.) > 700. {
                stats[M::SmokeSupport] =
                    stats[M::SmokeSupport].max(a.maximum_range_gru.unwrap_or(0.) * reserve.sqrt());
                profile.insert("mechanic:smoke_support".into());
            }
            if utility(a) {
                continue;
            }
            let (components, signature) = ammunition_profile(a, traits);
            let shots = a.shots_count_per_salvo.unwrap_or(1.).max(1.);
            let weapon_count = mount.weapon_count.max(1.);
            let volley_projectiles = shots * weapon_count;
            let total_projectiles = reserve * volley_projectiles;
            let stationary = accuracy(a.accuracy_stationary.or(a.accuracy_moving).unwrap_or(25.));
            let moving = accuracy(a.accuracy_moving.unwrap_or(0.));
            let aim = a.aiming_time.unwrap_or(1.5).max(0.)
                + e.weapon_deployment_time.unwrap_or(0.).max(0.);
            let shot_interval = a.time_between_two_shots.unwrap_or(0.45).max(0.05);
            let reload = a.time_between_two_salvos.unwrap_or(1.6).max(0.1);
            let firing_steps = (shots / a.simultaneous_shots_count.unwrap_or(1.).max(1.)).ceil();
            let volley_duration = ((firing_steps - 1.) * shot_interval).max(0.1);
            let first = (aim + volley_duration).max(0.25);
            let full = first.max(aim + reserve * volley_duration + (reserve - 1.).max(0.) * reload);
            let response = 1000. / (0.5 + aim).max(0.5);
            let is_indirect = mobility(e) != "Plane" && indirect(a, traits);
            // shortcut: dispersion uses maximum range; simulate terrain only if it changes deck choices.
            let dispersion = if is_indirect
                || a.projectile_type
                    .as_deref()
                    .is_some_and(|s| s.eq_ignore_ascii_case("bombe"))
            {
                a.dispersion_at_max_range_gru.unwrap_or(0.).max(0.)
                    / a.radius_splash_physical_damages_gru
                        .unwrap_or(0.)
                        .max(a.radius_splash_suppress_damages_gru.unwrap_or(0.))
                        .max(1.)
            } else {
                0.
            };
            let area_accuracy = 1. / (1. + dispersion.powi(2));
            let raw = a.physical_damages.unwrap_or(0.).max(0.) * stationary * area_accuracy;
            let physical = raw * a.damage_multipliers.map_or(1., |d| d.ground);
            let suppression = a.suppress_damages.unwrap_or(0.).max(0.) * stationary * area_accuracy;
            let volley = physical * volley_projectiles;
            let volley_suppression = suppression * volley_projectiles;
            let burst = volley / first;
            let sustained = physical * total_projectiles / full;
            let ground = a.maximum_range_gru.unwrap_or(0.).max(0.);
            let helo = a.maximum_range_helicopter_gru.unwrap_or(0.).max(0.);
            let plane = a.maximum_range_airplane_gru.unwrap_or(0.).max(0.);
            let flexible = if ground > 0. {
                (1. - a.minimum_range_gru.unwrap_or(0.).max(0.) / ground).max(0.35)
            } else {
                1.
            };
            let splash = a
                .radius_splash_physical_damages_gru
                .unwrap_or(0.)
                .max(0.)
                .powf(0.8)
                + a.radius_splash_suppress_damages_gru
                    .unwrap_or(0.)
                    .max(0.)
                    .powf(0.76);
            let penetration = a.armor_penetration.unwrap_or(0.).max(0.);
            let is_at = anti_armor(a, traits);
            let armor = if is_at {
                a.damage_multipliers.map_or_else(
                    || {
                        [5., 10., 15., 20.]
                            .iter()
                            .enumerate()
                            .map(|(i, v)| {
                                (penetration - v + 1.).max(0.).powf(1.35) * (1. + i as f64 * 0.25)
                            })
                            .sum::<f64>()
                            * stationary
                    },
                    |d| raw * d.armor,
                ) * (if a.tandem_charge == Some(true) {
                    1.18
                } else {
                    1.
                })
            } else {
                0.
            };
            let armor_volley = armor * volley_projectiles;
            let armor_burst = armor_volley / first;
            let armor_sustained = armor * total_projectiles / full;
            let speed = a.projectile_speed_gru.unwrap_or(0.).max(0.);
            let mut c = Metrics::default();
            c[M::Ammo] = total_projectiles;
            c[M::RangeGround] = ground;
            c[M::RangeHelo] = helo;
            c[M::RangePlane] = plane;
            c[M::Response] = response;
            c[M::Splash] = splash * volley_projectiles.sqrt() + volley_suppression * 0.18;
            c[M::Suppression] = volley_suppression * 0.75
                + suppression * total_projectiles * 0.25 / (full / 10.).max(1.);
            c[M::BurstDps] = (burst * 100.).max(armor_burst * 9.);
            c[M::SustainedDps] = (sustained * 120.).max(armor_sustained * 11.);
            c[M::AreaDenial] = a.fire_damage_per_second.unwrap_or(0.)
                * (a.fire_radius_gru.unwrap_or(0.).max(0.) * a.fire_duration.unwrap_or(0.).max(0.))
                    .sqrt()
                * volley_projectiles.sqrt();
            if ground > 0. {
                channels.insert("ground");
                c[M::AlphaGround] = volley;
                c[M::OneShotGround] = physical;
                c[M::AntiGround] = physical * 120.
                    + volley * 70.
                    + burst * 110.
                    + sustained * 150.
                    + volley_suppression * 0.5
                    + splash * 16.
                    + ground * 0.055
                    + response * 0.45;
                if !is_indirect {
                    c[M::DirectFire] = c[M::AntiGround] * flexible
                }
                if is_at {
                    channels.insert("armor");
                    c[M::AlphaArmor] = armor_volley;
                    c[M::OneShotArmor] = armor;
                    c[M::ArmorPenetration] = penetration;
                    c[M::RangeArmor] = ground;
                    c[M::AntiArmor] = (armor * 42.
                        + armor_volley * 24.
                        + armor_burst * 34.
                        + armor_sustained * 52.
                        + armor * total_projectiles.sqrt() * 30.
                        + ground * (penetration - 7.).max(1.) * 0.11
                        + speed * (penetration - 7.).max(1.) * 0.01
                        + response * 0.5)
                        * flexible;
                }
                c[M::AntiGround] *= flexible;
                c[M::CloseCombat] = (c[M::AntiGround] + volley_suppression + splash * 15.)
                    * (1. - ground / 1800.).max(0.)
                    * close_combat(a, traits);
            }
            for (
                range,
                minimum,
                multiplier,
                alpha,
                one,
                anti,
                hit_weight,
                volley_weight,
                burst_weight,
                sustained_weight,
                range_weight,
                speed_weight,
                channel,
            ) in [
                (
                    helo,
                    a.minimum_range_helicopter_gru,
                    a.damage_multipliers.map_or(1., |d| d.helo),
                    M::AlphaHelo,
                    M::OneShotHelo,
                    M::AntiHelo,
                    160.,
                    115.,
                    125.,
                    95.,
                    0.24,
                    0.04,
                    "helo",
                ),
                (
                    plane,
                    a.minimum_range_airplane_gru,
                    a.damage_multipliers.map_or(1., |d| d.plane),
                    M::AlphaPlane,
                    M::OneShotPlane,
                    M::AntiPlane,
                    180.,
                    125.,
                    135.,
                    85.,
                    0.28,
                    0.05,
                    "plane",
                ),
            ] {
                if range <= 0. {
                    continue;
                }
                let hit = raw * multiplier;
                let volley = hit * volley_projectiles;
                channels.insert(channel);
                c[alpha] = volley;
                c[one] = hit;
                c[M::BurstDps] = c[M::BurstDps].max(volley / first * 100.);
                c[M::SustainedDps] = c[M::SustainedDps].max(hit * total_projectiles / full * 120.);
                c[anti] = (hit * hit_weight
                    + volley * volley_weight
                    + volley / first * burst_weight
                    + hit * total_projectiles / full * sustained_weight
                    + range * range_weight
                    + speed * speed_weight
                    + response * 0.55)
                    * (1. - minimum.unwrap_or(0.).max(0.) / range).max(0.35);
            }
            if is_indirect {
                channels.insert("indirect");
                c[M::Indirect] = physical * 120.
                    + volley * 95.
                    + burst * 90.
                    + sustained * 80.
                    + volley_suppression * 0.9
                    + splash * 24.
                    + ground * 0.16
                    + response * 0.7;
            }
            if ground > 0. && precision(a, traits) > 0. {
                c[M::Precision] = (physical * 130. + armor * 25. + ground * 0.09 + speed * 0.025)
                    * precision(a, traits)
                    / (1. + a.dispersion_at_max_range_gru.unwrap_or(0.).max(0.) / 350.);
            }
            if a.can_shoot_while_moving != Some(false) && moving > 0. {
                c[M::FireOnMove] = (c[M::DirectFire] + c[M::AntiArmor] * 0.5)
                    * (moving / stationary.max(0.01)).min(2.);
                mechanics.insert("fire_on_move");
            }
            if a.tandem_charge == Some(true) {
                mechanics.insert("tandem");
            }
            if a.is_fire_and_forget == Some(true) {
                mechanics.insert("fire_and_forget");
            }
            if a.force_hit_top_armor_on_success == Some(true) && !is_indirect {
                mechanics.insert("top_attack");
            }
            let radar = anti_radar(a, traits);
            if radar {
                c[M::Sead] = c[M::AntiArmor] + c[M::AntiGround];
                for key in [
                    M::AntiArmor,
                    M::AntiGround,
                    M::DirectFire,
                    M::RangeArmor,
                    M::ArmorPenetration,
                    M::AlphaArmor,
                    M::AlphaGround,
                    M::OneShotArmor,
                    M::OneShotGround,
                    M::Precision,
                    M::FireOnMove,
                ] {
                    c[key] = 0.;
                }
            }
            let strongest = c.strongest();
            let entry = payload_strengths.entry(signature.clone()).or_default();
            *entry = entry.max(strongest);
            let existing = box_metrics.entry(mount.ammo_box_index).or_default();
            for (dst, v) in existing.0.iter_mut().zip(c.0) {
                *dst = dst.max(v);
            }
            let strength = (a.physical_damages.unwrap_or(0.).max(0.) * 120.
                + a.suppress_damages.unwrap_or(0.).max(0.) * 0.8
                + penetration * 75.)
                * volley_projectiles
                * stationary
                + ground.max(helo).max(plane) * 0.1;
            payloads.push((components, signature, total_projectiles, strength));
            if radar {
                profile.insert("mechanic:trait_sead".into());
            }
            if ground > 0. && !radar {
                profile_channels.insert("ground");
            }
            if is_at && !radar {
                profile_channels.insert("armor");
            }
            if helo > 0. {
                profile_channels.insert("helo");
            }
            if plane > 0. {
                profile_channels.insert("plane");
            }
            if is_indirect {
                profile_channels.insert("indirect");
            }
            for (target, range) in [
                (if radar { "radar" } else { "ground" }, ground),
                ("helo", helo),
                ("plane", plane),
            ] {
                if range > 0. {
                    let tier = ((range.max(1.) / 700.).log2() + 0.5).floor().max(0.) as i32;
                    profile.insert(format!("range_class:{target}_{tier}"));
                    profile.insert(format!("range_band:{target}_{}", range_band(range)));
                }
            }
            for (flag, token) in [
                (a.can_shoot_while_moving, "shoot_while_moving"),
                (a.is_fire_and_forget, "fire_and_forget"),
                (a.piercing_weapon, "piercing"),
                (a.tandem_charge, "tandem"),
            ] {
                if flag == Some(true) {
                    profile.insert(format!("mechanic:{token}"));
                }
            }
            if a.force_hit_top_armor_on_success == Some(true) && !indirect(a, traits) {
                profile.insert("mechanic:top_attack".into());
            }
            for t in traits {
                let t = normalize(t);
                if !t.is_empty() && !["ap", "he", "ind"].contains(&t.as_str()) {
                    profile.insert(format!("mechanic:trait_{t}"));
                }
            }
        }
        independent += box_metrics.len();
        for c in box_metrics.into_values() {
            for m in super::metrics::ALL {
                if m == M::Ammo {
                    continue;
                }
                stats[m] = if maximum_metric(m) {
                    stats[m].max(c[m])
                } else {
                    stats[m] + c[m]
                };
            }
            boxes.push(c);
        }
    }
    let strongest = boxes.iter().map(|b| b.strongest()).fold(0., f64::max);
    stats[M::Ammo] = boxes
        .iter()
        .map(|b| {
            b[M::Ammo]
                * (if strongest > 0. {
                    b.strongest() / strongest
                } else {
                    0.
                })
                .powi(2)
        })
        .sum();
    let strongest = payload_strengths.values().copied().fold(0., f64::max);
    let meaningful = payload_strengths
        .values()
        .filter(|v| strongest <= 0. || **v >= strongest * 0.12)
        .count();
    stats[M::WeaponVariety] = channels.len() as f64 * 420.
        + mechanics.len() as f64 * 180.
        + meaningful as f64 * 240.
        + independent as f64 * 90.;
    let strongest = payloads.iter().map(|(_, _, _, s)| *s).fold(0., f64::max);
    let mut loadout = BTreeSet::new();
    let mut reserves: IndexMap<String, f64> = IndexMap::new();
    for (components, signature, reserve, strength) in payloads {
        for c in &components {
            profile.insert(format!("ammo_all:{c}"));
        }
        if strongest > 0. && strength < strongest * 0.12 {
            continue;
        }
        loadout.insert(signature.clone());
        for c in components {
            profile.insert(format!("ammo:{c}"));
        }
        let value = reserves.entry(signature).or_default();
        *value = value.max(reserve);
    }
    for (signature, reserve) in reserves {
        profile.insert(format!("ammo_reserve:{signature}:{reserve}"));
    }
    if !loadout.is_empty() {
        profile.insert(format!(
            "ammo_loadout:{}",
            loadout.into_iter().collect::<Vec<_>>().join("|")
        ));
    }
    let strongest = stats.strongest();
    for (channel, m) in [
        ("armor", M::AntiArmor),
        ("ground", M::AntiGround),
        ("helo", M::AntiHelo),
        ("plane", M::AntiPlane),
        ("indirect", M::Indirect),
    ] {
        if strongest > 0. && stats[m] < strongest * 0.12 {
            profile_channels.remove(channel);
            profile.retain(|t| !t.starts_with(&format!("range_class:{channel}_")));
        }
    }
    for channel in &profile_channels {
        profile.insert(format!("channel:{channel}"));
    }
    if !profile_channels.is_empty() {
        profile.insert(format!(
            "loadout:{}",
            profile_channels.into_iter().collect::<Vec<_>>().join("+")
        ));
    }
    if profile.contains("mechanic:tandem") || profile.contains("mechanic:trait_tandem") {
        profile.insert("mechanic:trait_heat".into());
    }
    (stats, profile.into_iter().collect())
}

mod profile;
use profile::*;
pub use profile::{normalize, range_band};
