use super::*;

pub fn material(a: &Analysis, m: M) -> bool {
    let score = a.metrics[m];
    score > 0. && (a.metrics.strongest() <= 0. || score >= a.metrics.strongest() * 0.12)
}
fn max(values: &[f64]) -> f64 {
    values.iter().copied().fold(f64::NEG_INFINITY, f64::max)
}
fn standout(
    a: &mut [Analysis],
    entities: &[Entity],
    token: &str,
    ratios: [f64; 3],
    eligible: fn(&Analysis, &Entity) -> bool,
    score: fn(&Analysis, &Entity) -> f64,
) {
    let mut scored: Vec<_> = a
        .iter()
        .enumerate()
        .filter(|(_, a)| eligible(a, &entities[a.entity]))
        .map(|(i, a)| (i, score(a, &entities[a.entity])))
        .filter(|(_, s)| s.is_finite() && *s > 0.)
        .collect();
    scored.sort_by(|(_, a), (_, b)| b.total_cmp(a));
    let Some((_, top)) = scored.first().copied() else {
        return;
    };
    if scored.len() > 1 && top - scored.last().unwrap().1 <= 1f64.max(top * 0.03) {
        return;
    }
    let threshold = if scored.len() >= 3 {
        (top * ratios[0])
            .max(median(&scored.iter().map(|(_, s)| *s).collect::<Vec<_>>()) * ratios[1])
    } else {
        top * ratios[0]
    };
    let count = ((scored.len() as f64 * ratios[2]).ceil() as usize).max(1);
    let eligible: Vec<_> = scored
        .into_iter()
        .filter(|(_, s)| *s >= threshold)
        .collect();
    let Some((_, cutoff)) = eligible.get(eligible.len().min(count).wrapping_sub(1)) else {
        return;
    };
    for (i, _) in eligible.iter().filter(|(_, s)| s >= cutoff) {
        a[*i].add_role(token.into())
    }
}
pub fn capabilities(a: &mut [Analysis], entities: &[Entity]) {
    for a in a.iter_mut() {
        let e = &entities[a.entity];
        for (yes, name) in [
            (a.metrics[M::Supply] > 0., "supply"),
            (a.metrics[M::Command] > 0., "command"),
            (a.metrics[M::Amphibious] > 0., "amphibious"),
            (e.deployment_shift_gru.unwrap_or(0.) > 0., "forward_deploy"),
            (
                mobility(e) == "Helicopter"
                    && !e.weapon_descriptor_names.is_empty()
                    && a.metrics[M::AntiGround] + a.metrics[M::AntiArmor] > 0.,
                "gunship",
            ),
        ] {
            if yes {
                a.add_role(format!("capability:{name}"))
            }
        }
        let mut additions = Vec::new();
        for (name, required) in [
            ("smoke_support", &["mechanic:smoke_support"][..]),
            ("area_denial", &["mechanic:area_denial"][..]),
            ("radar_guided", &["mechanic:trait_radar"][..]),
            ("sead", &["mechanic:trait_sead"][..]),
            (
                "napalm",
                &["mechanic:trait_napalm", "mechanic:damage_napalm"][..],
            ),
            (
                "cluster",
                &["mechanic:trait_cluster", "mechanic:damage_cluster"][..],
            ),
            ("close_quarters", &["mechanic:trait_cac"][..]),
            (
                "fire_and_forget",
                &["mechanic:fire_and_forget", "mechanic:trait_f_f"][..],
            ),
            ("tandem", &["mechanic:tandem", "mechanic:trait_tandem"][..]),
            ("high_off_boresight", &["mechanic:trait_f_f_boresight"][..]),
        ] {
            if required.iter().any(|t| a.profile.tokens.contains(*t)) {
                additions.push(format!("capability:{name}"));
            }
        }
        if a.metrics[M::Precision] > 0. && a.profile.tokens.contains("mechanic:top_attack") {
            additions.push("capability:top_attack".into())
        }
        let channels: HashSet<_> = a
            .profile
            .tokens
            .iter()
            .filter_map(|t| t.strip_prefix("channel:"))
            .collect();
        for token in &a.profile.tokens {
            if token.starts_with("ammo:family_")
                || token.starts_with("ammo:trait_")
                || token.starts_with("loadout:")
            {
                additions.push(format!("capability:{}", token.replacen(':', "_", 1)));
            }
            if let Some(range) = token.strip_prefix("range_class:") {
                let target = range.split('_').next().unwrap_or("");
                if channels.contains(target) {
                    additions.push(format!("capability:envelope_{range}"))
                }
                if target == "ground" && channels.contains("indirect") {
                    additions.push(format!("capability:envelope_indirect_{range}"))
                }
            }
        }
        for token in additions {
            a.add_role(token)
        }
    }
    standout(
        a,
        entities,
        "capability:anti_tank",
        [0.5, 1.45, 0.4],
        |a, _e| material(a, M::AntiArmor),
        |a, _e| {
            a.metrics[M::AntiArmor]
                + a.metrics[M::AlphaArmor] * 90.0
                + a.metrics[M::ArmorPenetration] * 120.0
                + a.metrics[M::RangeArmor] * 0.45
                + a.metrics[M::SustainedDps] * 0.15
                + a.metrics[M::DirectFire] * 0.15
        },
    );
    standout(
        a,
        entities,
        "capability:anti_infantry",
        [0.52, 1.35, 0.32],
        |a, _e| material(a, M::AntiGround),
        |a, _e| {
            a.metrics[M::AntiGround]
                + a.metrics[M::AlphaGround] * 70.0
                + a.metrics[M::Suppression] * 0.45
                + a.metrics[M::Splash] * 0.75
                + a.metrics[M::DirectFire] * 0.12
        },
    );
    standout(
        a,
        entities,
        "capability:anti_plane",
        [0.52, 1.35, 0.35],
        |a, _e| material(a, M::AntiPlane),
        |a, _e| {
            a.metrics[M::AntiPlane]
                + a.metrics[M::AlphaPlane] * 90.0
                + a.metrics[M::RangePlane] * 0.55
                + a.metrics[M::RangeHelo] * 0.12
        },
    );
    standout(
        a,
        entities,
        "capability:anti_helo",
        [0.52, 1.35, 0.35],
        |a, _e| material(a, M::AntiHelo),
        |a, _e| {
            a.metrics[M::AntiHelo] + a.metrics[M::AlphaHelo] * 90.0 + a.metrics[M::RangeHelo] * 0.45
        },
    );
    standout(
        a,
        entities,
        "capability:indirect_fire",
        [0.5, 1.4, 0.35],
        |a, _e| a.metrics[M::Indirect] > 0.0,
        |a, _e| {
            a.metrics[M::Indirect]
                + a.metrics[M::AlphaGround] * 80.0
                + a.metrics[M::Splash] * 0.35
                + a.metrics[M::RangeGround] * 0.25
        },
    );
    standout(
        a,
        entities,
        "capability:counter_battery",
        [0.68, 1.65, 0.2],
        |a, _e| a.metrics[M::Indirect] > 0.0,
        |a, _e| {
            if a.metrics[M::Indirect] > 0.0 {
                a.metrics[M::RangeGround] * 1.3
                    + a.metrics[M::Splash] * 0.35
                    + a.metrics[M::Mobility] * 0.08
            } else {
                0.0
            }
        },
    );
    standout(
        a,
        entities,
        "capability:indirect_saturation",
        [0.55, 1.45, 0.25],
        |a, _e| a.metrics[M::Indirect] > 0.0,
        |a, _e| {
            a.metrics[M::BurstDps] * 1.5
                + a.metrics[M::AlphaGround] * 90.0
                + a.metrics[M::Suppression] * 0.7
                + a.metrics[M::Splash] * 0.8
        },
    );
    standout(
        a,
        entities,
        "capability:indirect_heavy_shot",
        [0.58, 1.45, 0.22],
        |a, _e| a.metrics[M::Indirect] > 0.0,
        |a, _e| {
            a.metrics[M::OneShotGround] * 2.0
                + a.metrics[M::AlphaGround] * 100.0
                + a.metrics[M::RangeGround] * 0.65
                + a.metrics[M::Precision] * 0.45
        },
    );
    standout(
        a,
        entities,
        "capability:precision_strike",
        [0.58, 1.45, 0.2],
        |a, _e| a.metrics[M::Precision] > 0.0,
        |a, _e| {
            if a.metrics[M::Precision] > 0.0 {
                a.metrics[M::Precision]
                    + a.metrics[M::RangeGround] * 0.28
                    + a.metrics[M::Stealth] * 0.45
                    + a.metrics[M::Survivability] * 0.04
            } else {
                0.0
            }
        },
    );
    standout(
        a,
        entities,
        "capability:long_range",
        [0.58, 1.25, 0.3],
        |_a, _e| true,
        |a, _e| {
            a.metrics[M::RangeGround]
                + max(&[a.metrics[M::RangeHelo], a.metrics[M::RangePlane]]) * 0.95
                + a.metrics[M::AntiPlane] * 0.08
                + a.metrics[M::AntiArmor] * 0.08
        },
    );
    standout(
        a,
        entities,
        "capability:stealth",
        [0.56, 1.3, 0.25],
        |_a, _e| true,
        |a, _e| {
            a.metrics[M::Stealth] * 8.0
                + a.metrics[M::AntiGround] * 0.02
                + a.metrics[M::AntiArmor] * 0.02
                + a.metrics[M::Indirect] * 0.02
                + a.metrics[M::Survivability] * 0.02
                + a.metrics[M::Mobility] * 0.01
        },
    );
    standout(
        a,
        entities,
        "capability:durable",
        [0.56, 1.3, 0.28],
        |_a, _e| true,
        |a, _e| {
            a.metrics[M::Survivability]
                + a.metrics[M::AntiGround] * 0.06
                + a.metrics[M::AntiArmor] * 0.08
        },
    );
    standout(
        a,
        entities,
        "capability:fast",
        [0.58, 1.2, 0.28],
        |_a, _e| true,
        |a, _e| a.metrics[M::Mobility] + a.metrics[M::Stealth] * 0.15,
    );
    standout(
        a,
        entities,
        "capability:fire_on_move",
        [0.55, 1.3, 0.28],
        |_a, _e| true,
        |a, _e| a.metrics[M::FireOnMove],
    );
    standout(
        a,
        entities,
        "capability:initiative",
        [0.58, 1.3, 0.28],
        |_a, _e| true,
        |a, _e| a.metrics[M::Initiative],
    );
    standout(
        a,
        entities,
        "capability:optics",
        [0.6, 1.25, 0.28],
        |_a, _e| true,
        |a, _e| a.metrics[M::Optics] + a.metrics[M::Stealth] * 0.18 + a.metrics[M::Mobility] * 0.05,
    );
    standout(
        a,
        entities,
        "capability:weapon_variety",
        [0.6, 1.2, 0.28],
        |_a, _e| true,
        |a, _e| {
            a.metrics[M::WeaponVariety]
                + a.metrics[M::AntiGround] * 0.08
                + a.metrics[M::AntiArmor] * 0.1
                + a.metrics[M::AntiPlane] * 0.08
                + a.metrics[M::AntiHelo] * 0.08
        },
    );
    standout(
        a,
        entities,
        "capability:endurance",
        [0.58, 1.2, 0.3],
        |a, e| a.metrics[M::SustainedDps] > 0.0 || e.fuel_move_duration.unwrap_or(0.0) > 0.0,
        |a, _e| {
            a.metrics[M::SustainedDps] * 2.5
                + a.metrics[M::Mobility]
                + a.metrics[M::Survivability] * 0.05
        },
    );
    standout(
        a,
        entities,
        "capability:suppression",
        [0.55, 1.3, 0.3],
        |_a, _e| true,
        |a, _e| {
            a.metrics[M::Suppression] + a.metrics[M::Splash] * 0.7 + a.metrics[M::RangeGround] * 0.2
        },
    );
    standout(
        a,
        entities,
        "capability:heavy_alpha",
        [0.62, 1.45, 0.22],
        |a, _e| {
            max(&[
                a.metrics[M::AlphaArmor],
                a.metrics[M::AlphaGround],
                a.metrics[M::AlphaHelo],
                a.metrics[M::AlphaPlane],
            ]) > 0.0
        },
        |a, _e| {
            max(&[
                a.metrics[M::AlphaArmor] * 9.0,
                a.metrics[M::AlphaGround] * 100.0,
                a.metrics[M::AlphaHelo] * 100.0,
                a.metrics[M::AlphaPlane] * 100.0,
            ]) + a.metrics[M::Response] * 0.4
        },
    );
    standout(
        a,
        entities,
        "capability:rapid_response",
        [0.6, 1.4, 0.22],
        |a, _e| a.metrics[M::BurstDps] > 0.0,
        |a, _e| a.metrics[M::BurstDps] + a.metrics[M::Response] * 1.8,
    );
    standout(
        a,
        entities,
        "capability:sustained_fire",
        [0.6, 1.4, 0.22],
        |a, _e| a.metrics[M::SustainedDps] > 0.0,
        |a, _e| a.metrics[M::SustainedDps],
    );
    standout(
        a,
        entities,
        "capability:positive_effect",
        [0.5, 1.2, 0.35],
        |a, _e| a.metrics[M::Effect] > 0.0,
        |a, _e| a.metrics[M::Effect],
    );
    standout(
        a,
        entities,
        "capability:armed_positive_effect",
        [0.55, 1.3, 0.15],
        |a, e| {
            a.metrics[M::Effect] > 0.0
                && e.positive_effect_tokens
                    .iter()
                    .any(|token| token.contains("ennemi"))
                && a.metrics.strongest() > 0.0
        },
        |a, _e| a.metrics[M::Effect] + a.metrics.strongest() * 0.2,
    );
    standout(
        a,
        entities,
        "capability:high_availability",
        [0.6, 1.35, 0.25],
        |_a, _e| true,
        |a, _e| a.metrics[M::Availability],
    );
    pareto(
        a,
        entities,
        "capability:anti_tank_frontier",
        &[
            M::RangeArmor,
            M::AntiArmor,
            M::ArmorPenetration,
            M::Mobility,
            M::Stealth,
            M::Response,
        ],
        [0.005, 0.0025],
        |a, _| material(a, M::AntiArmor),
        |a, e| {
            format!(
                "{}_range_{}",
                platform(e),
                range_band(a.metrics[M::RangeArmor])
            )
        },
    );
    pareto(
        a,
        entities,
        "capability:mobile_area_air_defense",
        &[
            M::RangePlane,
            M::RangeHelo,
            M::AntiPlane,
            M::AntiHelo,
            M::AlphaPlane,
            M::Response,
            M::Survivability,
            M::Mobility,
        ],
        [0.03, 0.01],
        |a, _| {
            material(a, M::AntiPlane)
                && material(a, M::AntiHelo)
                && a.metrics[M::AntiPlane].max(a.metrics[M::AntiHelo])
                    >= a.metrics[M::AntiArmor]
                        .max(a.metrics[M::AntiGround])
                        .max(a.metrics[M::Indirect])
        },
        |a, e| {
            format!(
                "{}_plane_{}_helo_{}",
                platform(e),
                range_band(a.metrics[M::RangePlane]),
                range_band(a.metrics[M::RangeHelo])
            )
        },
    );
    pareto(
        a,
        entities,
        "capability:indirect_delivery",
        &[
            M::Indirect,
            M::RangeGround,
            M::AlphaGround,
            M::BurstDps,
            M::Suppression,
            M::Response,
            M::Mobility,
            M::Ammo,
        ],
        [0.005, 0.0025],
        |a, _| a.metrics[M::Indirect] > 0.,
        |a, _| {
            let families = a
                .profile
                .tokens
                .iter()
                .filter_map(|t| {
                    t.strip_prefix("ammo:family_")
                        .map(|s| format!("family_{s}"))
                })
                .collect::<Vec<_>>()
                .join("_");
            format!(
                "{}_{}_range_{}",
                a.type_key,
                if families.is_empty() {
                    "unspecified"
                } else {
                    &families
                },
                range_band(a.metrics[M::RangeGround])
            )
        },
    );
}
fn pareto(
    a: &mut [Analysis],
    entities: &[Entity],
    token: &str,
    metrics: &[M],
    ratios: [f64; 2],
    eligible: fn(&Analysis, &Entity) -> bool,
    variant: fn(&Analysis, &Entity) -> String,
) {
    let candidates: Vec<_> = a
        .iter()
        .enumerate()
        .filter(|(_, a)| eligible(a, &entities[a.entity]))
        .map(|(i, _)| i)
        .collect();
    let mut maximum = Metrics::default();
    for i in &candidates {
        for m in metrics {
            maximum[*m] = maximum[*m].max(a[*i].metrics[*m]);
        }
    }
    let mut additions = Vec::new();
    for i in &candidates {
        let dominated = candidates.iter().any(|j| {
            if i == j {
                return false;
            }
            let mut better = false;
            for m in metrics {
                if a[*j].metrics[*m] + maximum[*m] * ratios[1] < a[*i].metrics[*m] {
                    return false;
                }
                if a[*j].metrics[*m] > a[*i].metrics[*m] + maximum[*m] * ratios[0] {
                    better = true
                }
            }
            better
        });
        if !dominated {
            additions.push((*i, token.to_string()));
            let v = variant(&a[*i], &entities[a[*i].entity]);
            if !v.is_empty() {
                additions.push((*i, format!("{token}_{}", normalize(&v))))
            }
        }
    }
    for (i, t) in additions {
        a[i].add_role(t)
    }
}
