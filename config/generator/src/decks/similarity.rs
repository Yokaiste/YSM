use super::{
    analysis::Profile,
    data::*,
    metrics::{ALL, M, Metrics, SIMILARITY},
};
use std::{cmp::Ordering, collections::BTreeSet};
#[derive(Clone, Copy)]
pub struct View<'a> {
    pub entity: &'a Entity,
    pub vector: &'a Metrics,
    pub profile: &'a Profile,
    pub transported: bool,
    pub length: usize,
}
pub fn jaccard<T: Ord>(a: &BTreeSet<T>, b: &BTreeSet<T>) -> f64 {
    if a.is_empty() || b.is_empty() {
        0.
    } else {
        let common = a.intersection(b).count();
        common as f64 / (a.len() + b.len() - common) as f64
    }
}
pub fn platform_regression(a: &Entity, b: &Entity) -> bool {
    if b.front_armor.unwrap_or(0.) >= 1. && a.front_armor.unwrap_or(0.) < 1. {
        return true;
    }
    let speed = a.max_speed_kmph.unwrap_or(0.).max(1.);
    let reference = b.max_speed_kmph.unwrap_or(0.).max(1.);
    if reference > speed * 1.2 && reference - speed >= 15. {
        return true;
    }
    let endurance = a
        .fuel_move_duration
        .unwrap_or(0.)
        .max(a.fuel_capacity.unwrap_or(0.));
    let reference = b
        .fuel_move_duration
        .unwrap_or(0.)
        .max(b.fuel_capacity.unwrap_or(0.));
    if reference > endurance * 1.35 && reference - endurance >= 150. {
        return true;
    }
    b.deployment_shift_gru.unwrap_or(0.) - a.deployment_shift_gru.unwrap_or(0.) >= 700.
}
fn dominates(a: View<'_>, b: View<'_>) -> bool {
    if platform_regression(a.entity, b.entity) || !b.profile.effects.is_subset(&a.profile.effects) {
        return false;
    }
    if a.entity
        .negative_effect_tokens
        .iter()
        .any(|t| !b.entity.negative_effect_tokens.contains(t))
    {
        return false;
    }
    let mut better = b
        .entity
        .negative_effect_tokens
        .iter()
        .any(|t| !a.entity.negative_effect_tokens.contains(t));
    for m in ALL.into_iter().filter(|m| {
        !matches!(
            m,
            M::Amphibious | M::Availability | M::Command | M::Supply | M::Value | M::WeaponVariety
        )
    }) {
        let difference = a.vector[m] - b.vector[m];
        if difference < -100. {
            return false;
        }
        if difference >= 35. {
            better = true
        }
    }
    better
}
fn equivalent(mut differences: Vec<f64>, mean: f64, quartile: f64, max: f64) -> bool {
    if differences.is_empty() {
        return false;
    }
    differences.sort_by(f64::total_cmp);
    differences.iter().sum::<f64>() / differences.len() as f64 <= mean
        && differences[(differences.len() * 3 / 4).min(differences.len() - 1)] <= quartile
        && differences[differences.len() - 1] <= max
}
pub fn near(a: View<'_>, b: View<'_>) -> bool {
    let e = a.entity;
    let f = b.entity;
    if e.name == f.name {
        return true;
    }
    if e.kind != f.kind
        || e.factory_type != f.factory_type
        || a.profile.duplicate_purpose != b.profile.duplicate_purpose
    {
        return false;
    }
    if a.transported != b.transported
        && (e.max_speed_kmph.unwrap_or(0.).max(0.) - f.max_speed_kmph.unwrap_or(0.).max(0.)).abs()
            >= 15.
    {
        return false;
    }
    if !a.profile.payload.is_empty()
        && !b.profile.payload.is_empty()
        && !a.profile.payload.is_subset(&b.profile.full_payload)
        && !b.profile.payload.is_subset(&a.profile.full_payload)
    {
        return false;
    }
    if a.length == 0 || a.length != b.length {
        return false;
    }
    let weapons = jaccard(&a.profile.weapon, &b.profile.weapon);
    if a.profile.is_command && b.profile.is_command {
        if (e.deployment_shift_gru.unwrap_or(0.) - f.deployment_shift_gru.unwrap_or(0.)).abs()
            >= 700.
        {
            return false;
        }
        if weapons >= 0.35 {
            return true;
        }
    }
    if (dominates(a, b) || dominates(b, a)) && weapons >= 0.45 {
        return true;
    }
    if a.profile.reserves.iter().any(|(s, left)| {
        b.profile.reserves.get(s).is_some_and(|right| {
            let small = left.min(*right);
            let large = left.max(*right);
            large - small >= 2. && large >= small * 1.25
        })
    }) {
        return false;
    }
    for (channel, metric, range) in [
        ("armor", M::AntiArmor, M::RangeArmor),
        ("ground", M::AntiGround, M::RangeGround),
        ("helo", M::AntiHelo, M::RangeHelo),
        ("plane", M::AntiPlane, M::RangePlane),
        ("indirect", M::Indirect, M::RangeGround),
    ] {
        let channel = format!("channel:{channel}");
        let left = a.profile.tokens.contains(&channel);
        let right = b.profile.tokens.contains(&channel);
        if left != right {
            if a.vector[metric].max(b.vector[metric]) >= 400. {
                return false;
            }
        } else if left {
            let small = a.vector[range].min(b.vector[range]);
            let large = a.vector[range].max(b.vector[range]);
            if small > 0. && large - small >= 35. && large >= small * 1.15 {
                return false;
            }
        }
    }
    if [M::Stealth, M::Optics, M::Ammo, M::WeaponVariety]
        .iter()
        .any(|m| (a.vector[*m] - b.vector[*m]).abs() >= 200.)
    {
        return false;
    }
    if a.profile.tokens.is_empty() || b.profile.tokens.is_empty() {
        if a.profile.tokens.len() != b.profile.tokens.len() {
            return false;
        }
    } else if jaccard(&a.profile.tokens, &b.profile.tokens) < 0.5 {
        return false;
    }
    if !a.profile.weapon.is_empty()
        && a.profile.weapon == b.profile.weapon
        && !(platform_regression(e, f) && platform_regression(f, e))
        && equivalent(
            SIMILARITY
                .iter()
                .take(a.length)
                .filter(|m| {
                    !matches!(
                        m,
                        M::Initiative | M::Mobility | M::Survivability | M::Availability
                    )
                })
                .map(|m| (a.vector[*m] - b.vector[*m]).abs())
                .collect(),
            12.,
            30.,
            75.,
        )
    {
        return true;
    }
    let differences: Vec<_> = SIMILARITY
        .iter()
        .take(a.length)
        .map(|m| (a.vector[*m] - b.vector[*m]).abs())
        .collect();
    equivalent(differences, 55., 90., 125.)
}

#[test]
fn set_similarity_preserves_empty_disjoint_and_overlapping_cases() {
    let sets: Vec<BTreeSet<_>> = [vec![], vec![1, 2, 3], vec![2, 3, 4], vec![8, 9]]
        .into_iter()
        .map(|values| values.into_iter().collect())
        .collect();
    for left in &sets {
        for right in &sets {
            let expected = if left.is_empty() || right.is_empty() {
                0.
            } else {
                left.intersection(right).count() as f64 / left.union(right).count() as f64
            };
            assert_eq!(jaccard(left, right), expected);
        }
    }
}
fn command_quality(v: &Metrics) -> f64 {
    v.score(&[
        (M::Survivability, 1.6),
        (M::AntiArmor, 1.15),
        (M::RangeArmor, 0.9),
        (M::OneShotArmor, 0.65),
        (M::AntiGround, 0.3),
        (M::Optics, 0.45),
        (M::Effect, 0.55),
    ])
}
fn quality(v: &Metrics) -> f64 {
    v.score(&[
        (M::AreaDenial, 0.75),
        (M::Sead, 0.85),
        (M::AirOptics, 0.15),
        (M::SmokeSupport, 0.25),
        (M::AlphaArmor, 0.55),
        (M::AlphaGround, 0.55),
        (M::AlphaHelo, 0.55),
        (M::AlphaPlane, 0.55),
        (M::AntiArmor, 0.85),
        (M::AntiGround, 0.75),
        (M::AntiHelo, 0.85),
        (M::AntiPlane, 0.9),
        (M::ArmorPenetration, 0.55),
        (M::BurstDps, 0.55),
        (M::DirectFire, 0.3),
        (M::Effect, 0.65),
        (M::FireOnMove, 0.35),
        (M::Indirect, 0.8),
        (M::Initiative, 0.35),
        (M::Mobility, 0.6),
        (M::OneShotArmor, 0.45),
        (M::OneShotGround, 0.45),
        (M::OneShotHelo, 0.45),
        (M::OneShotPlane, 0.45),
        (M::Optics, 0.3),
        (M::Precision, 0.65),
        (M::RangeArmor, 1.15),
        (M::RangeGround, 1.05),
        (M::RangeHelo, 1.15),
        (M::RangePlane, 1.25),
        (M::Response, 0.5),
        (M::Splash, 0.35),
        (M::Stealth, 0.35),
        (M::Suppression, 0.25),
        (M::SustainedDps, 0.5),
        (M::Survivability, 0.55),
        (M::WeaponVariety, 0.25),
    ])
}
pub fn compare(a: View<'_>, b: View<'_>) -> Ordering {
    if a.profile.is_command && b.profile.is_command {
        let (left, right) = (command_quality(a.vector), command_quality(b.vector));
        if (left - right).abs() >= 20. {
            return right.total_cmp(&left);
        }
    }
    let (left, right) = (dominates(a, b), dominates(b, a));
    if left != right {
        return right.cmp(&left);
    }
    let (left, right) = (quality(a.vector), quality(b.vector));
    if (left - right).abs() >= 35. {
        return right.total_cmp(&left);
    }
    a.entity.cost.total_cmp(&b.entity.cost)
}
