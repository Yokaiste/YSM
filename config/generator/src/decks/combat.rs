use super::{
    data::*,
    parse::{Fields, capture, number, numbers},
    weapons::normalize,
};
use std::collections::HashMap;
use ymb_sdk::{Result, ensure, failure, ndf};

type FamilyOffsets = HashMap<String, (usize, usize)>;

pub fn damage_profiles(
    ammo: &mut Ammunition,
    entities: &[Entity],
    source: &str,
    definitions: &str,
) -> Result<Vec<String>> {
    let b = ndf::scan(source)?
        .into_iter()
        .find(|b| b.type_name == "TGameplayDamageResistanceContainer")
        .ok_or_else(|| {
            failure(
                "DamageResistance.ndf has no damage matrix.",
                "Update the mod for this WARNO version.",
            )
        })?;
    let f = Fields::new(&source[b.span])?;
    fn families(value: Option<&str>, prefix: &str) -> Result<(FamilyOffsets, usize)> {
        let mut offset = 0usize;
        let mut result = HashMap::new();
        let pattern =
            regex::Regex::new(&format!(r"^\(\s*{prefix}_([A-Za-z0-9_]+),\s*(\d+)\s*\)$")).unwrap();
        for entry in ndf::read::entries(value.unwrap_or("[]"))? {
            let c = pattern.captures(entry.text).ok_or_else(|| {
                failure(
                    "Invalid damage/resistance family count.",
                    "Check DamageResistance.ndf.",
                )
            })?;
            let count = c[2].parse::<usize>().map_err(|_| {
                failure(
                    "Family count is too large.",
                    "Correct DamageResistance.ndf.",
                )
            })?;
            ensure(
                result.insert(c[1].to_string(), (offset, count)).is_none(),
                "Duplicate damage/resistance family.",
                "Check DamageResistance.ndf.",
            )?;
            offset = offset.checked_add(count).ok_or_else(|| {
                failure("Family counts overflow.", "Correct DamageResistance.ndf.")
            })?;
        }
        Ok((result, offset))
    }
    let (damage, damage_size) = families(f.get("DamageFamilyCounts"), "DamageFamily")?;
    let (resistance, resistance_size) =
        families(f.get("ResistanceFamilyCounts"), "ResistanceFamily")?;
    let rows = ndf::read::entries(f.get("Values").unwrap_or("[]"))?
        .iter()
        .map(|e| numbers(Some(e.text)))
        .collect::<Result<Vec<_>>>()?;
    ensure(
        rows.len() == damage_size
            && rows
                .iter()
                .all(|r| r.len() == resistance_size && r.iter().all(|v| v.is_finite() && *v >= 0.)),
        "Invalid damage table dimensions or values.",
        "Check DamageResistance.ndf.",
    )?;
    let valid_resistance = |r: &Resistance| {
        resistance
            .get(&r.family)
            .is_some_and(|(_, count)| r.index >= 1 && r.index <= *count)
    };
    let mut warnings = Vec::new();
    let mut targets: HashMap<&str, Vec<&Resistance>> = HashMap::new();
    let mut armored = indexmap::IndexMap::new();
    for e in entities {
        let mut omit_top = false;
        if let Some(profile) = e.top_resistance.as_ref().filter(|r| !valid_resistance(r))
            && let Some(warning) = crate::compatibility::resistance_warning(
                &e.name,
                "ResistanceTop",
                &profile.family,
                profile.index,
            )
        {
            warnings.push(warning);
            omit_top = true;
        }
        if let Some(front) = &e.front_resistance {
            let t = targets.entry(&front.family).or_default();
            if !t.iter().any(|r| r.index == front.index) {
                t.push(front)
            }
            if front.family == "blindage" && e.front_armor.unwrap_or(0.) > 0. {
                armored.insert(
                    (
                        front.index,
                        e.top_resistance
                            .as_ref()
                            .map(|r| (r.family.as_str(), r.index)),
                        omit_top,
                    ),
                    (e, omit_top),
                );
            }
        }
    }
    let definitions = ndf::read::numeric_definitions(definitions)?;
    for a in ammo.values_mut() {
        // compatibility: omitted Family is enum zero; flattened indices can cross a family boundary.
        let raw_family = a.damage_family.as_deref().unwrap_or("0");
        let family_name = if let Ok(value) = raw_family.parse::<f64>() {
            let mut candidates = definitions.iter().filter(|(name, number)| {
                name.starts_with("DamageFamily_")
                    && **number == value
                    && damage.contains_key(&name[13..])
            });
            let name = candidates.next().map(|(name, _)| &name[13..]);
            ensure(
                candidates.next().is_none(),
                "Ambiguous numeric damage family.",
                "Keep damage-family enum values unambiguous.",
            )?;
            name
        } else {
            Some(raw_family)
        };
        let family = family_name.and_then(|name| damage.get(name));
        let raw_index = a.damage_index.unwrap_or(0.);
        let index = raw_index as usize;
        let Some(&(offset, _)) = family.filter(|(offset, _)| {
            raw_index.is_finite()
                && raw_index.fract() == 0.
                && raw_index >= 1.
                && offset
                    .checked_add(index - 1)
                    .is_some_and(|index| index < rows.len())
        }) else {
            return Err(failure(
                format!(
                    "Ammunition {} has an unknown damage family or index.",
                    a.name
                ),
                "Check its Arme field and DamageResistance.ndf.",
            ));
        };
        let row = &rows[offset + index - 1];
        let multiplier = |r: &Resistance| -> Result<f64> {
            let Some(&(offset, _)) = resistance
                .get(&r.family)
                .filter(|(_, c)| r.index >= 1 && r.index <= *c)
            else {
                return Err(failure(
                    format!("Unknown resistance {}:{}.", r.family, r.index),
                    "Check the unit and damage table.",
                ));
            };
            Ok(row[offset + r.index - 1])
        };
        let average = |name: &str| -> Result<f64> {
            let profiles = targets.get(name).map(Vec::as_slice).unwrap_or(&[]);
            Ok(if profiles.is_empty() {
                0.
            } else {
                profiles
                    .iter()
                    .try_fold(0., |sum, r| multiplier(r).map(|value| sum + value))?
                    / profiles.len() as f64
            })
        };
        let mut armor_damage = 0.;
        let mut weight_sum = 0.;
        let mut reach: f64 = 0.;
        for (e, omit_top) in armored.values() {
            if *omit_top && a.force_hit_top_armor_on_success == Some(true) {
                continue;
            }
            let front = e.front_resistance.as_ref().unwrap();
            let hit = multiplier(if a.force_hit_top_armor_on_success == Some(true) {
                e.top_resistance.as_ref().unwrap_or(front)
            } else {
                front
            })?;
            let weight = e.front_armor.unwrap_or(0.);
            armor_damage += hit * weight;
            weight_sum += weight;
            if hit > 1. {
                reach = reach.max(weight)
            }
        }
        a.damage_multipliers = Some(Damage {
            ground: average("infanterie")?,
            armor: if weight_sum > 0. {
                armor_damage / weight_sum
            } else {
                0.
            },
            helo: average("helico")?,
            plane: average("avion")?,
        });
        a.armor_penetration = Some(reach);
    }
    Ok(warnings)
}
#[cfg(test)]
mod tests;
pub fn fire_profiles(ammo: &mut Ammunition, source: &str) -> Result<()> {
    let fires: HashMap<_, _> = ndf::scan(source)?
        .into_iter()
        .filter_map(|b| b.name.map(|name| (name, &source[b.span])))
        .collect();
    let mut profiles = Vec::new();
    for (name, a) in ammo.iter() {
        let Some(fire_name) = &a.fire_descriptor_name else {
            continue;
        };
        let error = || {
            failure(
                format!("Ammunition {name} cannot use fire {fire_name}."),
                "Check the fire definition, burn ammunition and positive TimeBetweenBurns.",
            )
        };
        let f = Fields::new(fires.get(fire_name.as_str()).ok_or_else(error)?)?;
        let burn_name = super::parse::reference(f.get("AmmunitionForBurn"), "$/GFX/Weapon/")
            .ok_or_else(error)?;
        let burn = ammo.get(&burn_name).ok_or_else(error)?;
        let interval = f
            .num("TimeBetweenBurns")
            .filter(|v| *v > 0.)
            .ok_or_else(error)?;
        profiles.push((
            name.clone(),
            burn.physical_damages.unwrap_or(0.).max(0.)
                * burn.damage_multipliers.map_or(1., |m| m.ground)
                / interval,
            f.num("RadiusGRU").unwrap_or(0.).max(0.),
            f.num("TimeToLive").unwrap_or(0.).max(0.),
        ));
    }
    for (name, damage, radius, duration) in profiles {
        let a = ammo.get_mut(&name).unwrap();
        a.fire_damage_per_second = Some(damage);
        a.fire_radius_gru = Some(radius);
        a.fire_duration = Some(duration);
    }
    Ok(())
}
#[derive(Default)]
struct Effects {
    entries: Vec<(String, f64)>,
}
#[derive(Default)]
struct Capacity {
    tokens: Vec<String>,
    positive: Vec<String>,
    negative: Vec<String>,
    utility: f64,
}
fn bucket(v: f64) -> String {
    format!(
        "{}_{}",
        if v < 0. {
            "negative"
        } else if v > 0. {
            "positive"
        } else {
            "neutral"
        },
        if v.abs() >= 50. {
            "xl"
        } else if v.abs() >= 10. {
            "large"
        } else if v.abs() >= 1. {
            "medium"
        } else {
            "small"
        }
    )
}
fn utility(kind: &str, value: f64) -> f64 {
    if kind.contains("makeunitvisible") {
        return -1.;
    }
    if value == 0. {
        return 0.;
    }
    let magnitude = value.signum() * (1. + value.abs()).log2();
    if [
        "aimingtime",
        "aimtime",
        "reloadtime",
        "tempsentredeuxsalves",
        "tempsentredeuxtirs",
        "dispersion",
        "damagesreceived",
        "receiveddamage",
        "suppressiondamage",
        "stundamage",
        "damagetaken",
        "hitrollecm",
        "precisionwhentargeted",
    ]
    .iter()
    .any(|k| kind.contains(k))
    {
        return -magnitude;
    }
    if [
        "precision",
        "accuracy",
        "optical",
        "vision",
        "conceal",
        "speed",
        "regeneration",
        "regen",
        "heal",
        "resistance",
        "armor",
        "veteran",
        "experiencelevel",
        "maxrange",
        "physicaldamages",
        "detection",
    ]
    .iter()
    .any(|k| kind.contains(k))
    {
        magnitude
    } else {
        0.
    }
}
fn value_field(kind: &str) -> &str {
    match kind {
        "TUnitEffectIncreaseDamageTakenDescriptor" => "BonusDamage",
        "TUnitEffectIncreaseSpeedDescriptor" => "BonusSpeedBaseInPercent",
        "TUnitEffectIncreaseChassisRotationSpeedDescriptor" => "BonusChassisRotationSpeed",
        "TUnitEffectIncreaseTurretRotationSpeedDescriptor" => "BonusTurretRotationSpeed",
        "TUnitEffectBonusExperienceLevelDescriptor" => "ExperienceLevelModifier",
        "TUnitEffectHealOverTimeDescriptor" => "HealUnitsPerSecond",
        "TUnitEffectBonusHitRollECMDescriptor" => "BonusHitRollECM",
        "TUnitEffectBonusPrecisionWhenTargetedDescriptor" => "BonusPrecisionWhenTargeted",
        "TUnitEffectIncreaseVisionDescriptor" => "BonusVisionBase",
        "TUnitEffectIncreaseOpticalStrengthDescriptor" => "BonusOpticalStrength",
        "TUnitEffectIncreaseConcealmentBonusDescriptor" => "BonusConcealmentBonus",
        "TUnitEffectIncreaseSpecializedDetectionDescriptor" => "BonusValueGRU",
        _ => "ModifierValue",
    }
}
pub fn capacity_profiles(entities: &mut [Entity], capacities: &str, source: &str) -> Result<()> {
    let mut effects = HashMap::new();
    for b in ndf::scan(source)?
        .into_iter()
        .filter(|b| b.type_name == "TEffectsPackDescriptor")
    {
        let Some(name) = b.name else { continue };
        let f = Fields::new(&source[b.span])?;
        let mut profile = Effects::default();
        for entry in ndf::read::entries(f.get("EffectsDescriptors").unwrap_or("[]"))? {
            let kind = entry
                .type_name
                .unwrap_or("")
                .split_whitespace()
                .next()
                .unwrap_or("");
            let normalized = normalize(kind);
            if normalized.is_empty()
                || ["raisetag", "removetag", "revealtag", "feedback"]
                    .iter()
                    .any(|t| normalized.contains(t))
            {
                continue;
            }
            let f = Fields::new(entry.text)?;
            let modifier = f.suffix("ModifierType", "~/").unwrap_or("presence".into());
            let value =
                number(f.get(value_field(kind)).or(f.get("ModifierValueGRU"))).unwrap_or(0.);
            let value = if modifier.to_lowercase().contains("multiplic") {
                value - 1.
            } else if modifier.to_lowercase().contains("pourcentage") {
                value / 100.
            } else {
                value
            };
            let damage = capture(f.get("DamageType"), r"EDamageType/([A-Za-z]+)")
                .map(|s| format!(":{}", s.to_lowercase()))
                .unwrap_or_default();
            profile.entries.push((
                format!(
                    "effect:{normalized}:{}:{}{damage}",
                    normalize(&modifier),
                    bucket(value)
                ),
                utility(&normalized, value),
            ));
        }
        effects.insert(name, profile);
    }
    let mut profiles = HashMap::new();
    for b in ndf::scan(capacities)?
        .into_iter()
        .filter(|b| b.type_name == "TCapaciteDescriptor")
    {
        let Some(name) = b.name else { continue };
        let f = Fields::new(&capacities[b.span])?;
        let target = f.suffix("TargetEffect", "~/");
        let own = f.suffix("SelfEffect", "~/");
        let team = normalize(&f.suffix("TargetTeamFilter", "~/").unwrap_or("self".into()));
        let enemy = team.contains("ennemi") || team.contains("enemy");
        let range = f.num("RangeGRU").unwrap_or(0.);
        let mut p = Capacity::default();
        for (effect, scope, polarity) in [
            (
                target.as_deref(),
                format!("scope:{team}"),
                if enemy { -1. } else { 1. },
            ),
            (own.as_deref(), "scope:self".into(), 1.),
        ] {
            if let Some(effect) = effect.and_then(|n| effects.get(n)) {
                for (token, u) in &effect.entries {
                    let token = format!("{scope}:{token}");
                    p.tokens.push(token.clone());
                    let contribution = u * polarity;
                    if contribution > 0. {
                        p.positive.push(token.clone())
                    }
                    if contribution < 0. {
                        p.negative.push(token)
                    }
                    p.utility += contribution;
                }
            }
        }
        if enemy
            && target.is_none()
            && range > 0.
            && f.boolean("CheckVisibility") == Some(false)
            && own
                .as_deref()
                .and_then(|n| effects.get(n))
                .is_some_and(|e| e.entries.iter().any(|(t, _)| t.contains("showlabelicon")))
        {
            let t = format!("scope:{team}:effect:proximity_detection");
            p.tokens.push(t.clone());
            p.positive.push(t);
            p.utility += (1. + range / 1000.).log2();
        }
        if !p.tokens.is_empty() && range > 0. {
            let t = format!(
                "effect_range:{}",
                if range >= 5000. {
                    "very_long"
                } else if range >= 2500. {
                    "long"
                } else if range >= 1000. {
                    "medium"
                } else {
                    "local"
                }
            );
            p.tokens.push(t.clone());
            if !p.positive.is_empty() {
                p.positive.push(t.clone())
            }
            if !p.negative.is_empty() {
                p.negative.push(t)
            }
            p.utility *= 1. + (range / 10000.).min(0.5);
        }
        profiles.insert(name, p);
    }
    for e in entities {
        for name in &e.capacity_names {
            if let Some(p) = profiles.get(name.as_str()) {
                e.effect_tokens.extend(p.tokens.clone());
                e.positive_effect_tokens.extend(p.positive.clone());
                e.negative_effect_tokens.extend(p.negative.clone());
                e.effect_utility += p.utility;
                if !p.positive.is_empty() {
                    e.positive_capacity_names.push(name.clone())
                }
                if !p.negative.is_empty() {
                    e.negative_capacity_names.push(name.clone())
                }
            }
        }
        for values in [
            &mut e.effect_tokens,
            &mut e.positive_effect_tokens,
            &mut e.negative_effect_tokens,
            &mut e.positive_capacity_names,
            &mut e.negative_capacity_names,
        ] {
            values.sort();
            values.dedup();
        }
    }
    Ok(())
}
