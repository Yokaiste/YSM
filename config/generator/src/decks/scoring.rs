use super::{
    analysis::Analysis,
    data::*,
    metrics::M,
    roles::{Role, RoleKind},
};
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Perspective {
    Recommended,
    Best,
    Cheap,
}
pub fn role_score(
    a: &Analysis,
    e: &Entity,
    role: &Role,
    perspective: Option<Perspective>,
) -> (f64, bool) {
    let mut fit = 0.;
    for m in super::metrics::ALL {
        if m == M::Value {
            fit += a.relative[m]
                * role.focus[m]
                * match perspective {
                    Some(Perspective::Best) => 0.,
                    Some(Perspective::Recommended) => 0.25,
                    Some(Perspective::Cheap) => 0.5,
                    None => 1.,
                };
        } else {
            fit += a.relative[m] * role.focus[m];
        }
    }
    let fragility = 1. - (a.relative[M::Survivability] / 1000.).min(1.);
    for (attack, range, cap, base, fragile, weight) in [
        (M::AntiArmor, M::RangeArmor, 1.5, 0.35, 0.65, 0.75),
        (M::AntiPlane, M::RangePlane, 1.5, 0.35, 0.65, 0.65),
        (M::AntiHelo, M::RangeHelo, 1.25, 0.4, 0.6, 0.5),
    ] {
        if role.focus[attack] >= 1.5 && role.focus[range] >= 0.5 {
            fit += a.relative[range]
                * role.focus[range].min(cap)
                * (base + fragility * fragile)
                * weight;
        }
    }
    let exact = a.exact.contains(&role.key);
    (
        fit + if exact { 600. } else { 0. } - (-e.effect_utility).max(0.) * 120.,
        exact,
    )
}
pub fn perspective(a: &Analysis, e: &Entity, role: &Role, average: f64, p: Perspective) -> f64 {
    let p = if role.price_sensitive() {
        p
    } else {
        Perspective::Best
    };
    let (fit, exact) = role_score(a, e, role, Some(p));
    let cost = if average > 0. { e.cost / average } else { 1. };
    let strength = (fit - if exact { 600. } else { 0. }).max(0.);
    let efficiency = strength / cost.max(0.25);
    let reliability = match a.profile.mobility {
        "Plane" => 0.75,
        "Helicopter" => 0.3,
        _ => 0.,
    };
    let below = if e.cost <= average {
        150.
    } else {
        (150. - (cost - 1.) * 150.).max(0.)
    };
    let capability = role.kind == RoleKind::Capability;
    let fit_multiplier = if capability { 1.18 } else { 1. };
    match p {
        Perspective::Best => {
            fit * fit_multiplier
                + a.relative[M::Survivability] * 0.38
                + a.relative[M::Ammo] * 0.12
                + a.relative[M::FireOnMove] * 0.12
                + a.relative[M::Initiative] * 0.12
                + a.relative[M::Survivability] * reliability
        }
        Perspective::Cheap => {
            fit * if capability { 0.9 } else { 0.7 }
                + efficiency * if capability { 0.55 } else { 0.72 }
                + a.relative[M::Survivability] * reliability * 0.75
                + below * if capability { 0.7 } else { 1. }
                - if e.cost > average {
                    (cost - 1.).max(0.) * 600.
                } else {
                    0.
                }
                + if exact {
                    if capability { 180. } else { 250. }
                } else {
                    0.
                }
        }
        Perspective::Recommended => {
            fit * fit_multiplier
                + efficiency * if capability { 0.16 } else { 0.2 }
                + a.relative[M::Survivability] * 0.2
                + a.relative[M::FireOnMove] * 0.08
                + a.relative[M::Initiative] * 0.08
                + a.relative[M::Survivability] * reliability * 0.9
                + below * if capability { 0.7 } else { 1. }
                + a.relative[M::Ammo] * 0.15
                + a.relative[M::Availability] * 0.18
                - cost * if capability { 45. } else { 65. }
        }
    }
}
pub fn filler(a: &Analysis) -> f64 {
    let r = a.relative;
    let mut standout = [
        M::AntiArmor,
        M::AntiGround,
        M::AntiPlane,
        M::AntiHelo,
        M::Indirect,
        M::Precision,
        M::Optics,
        M::Supply,
        M::Survivability,
        M::Stealth,
        M::WeaponVariety,
        M::AreaDenial,
        M::Sead,
    ]
    .map(|m| r[m]);
    standout.sort_by(|a, b| b.total_cmp(a));
    standout[0] * 1.05
        + standout[1] * 0.55
        + r[M::RangeGround] * 0.4
        + r[M::RangeHelo].max(r[M::RangePlane]) * 0.35
        + r[M::WeaponVariety] * 0.22
        + r[M::Amphibious] * 0.2
        + r[M::FireOnMove] * 0.18
        + r[M::Initiative] * 0.2
        + r[M::Availability] * 0.2
}
pub fn transport(a: &Analysis, e: &Entity) -> f64 {
    a.metrics[M::Mobility] * 1.6
        + a.metrics[M::Stealth] * 0.7
        + a.metrics[M::Survivability] * 0.45
        + a.metrics[M::Amphibious] * 0.9
        + (a.metrics[M::AntiGround] + a.metrics[M::AntiArmor]) * 0.12
        - if super::rules::air(e) { 90. } else { 0. }
}
