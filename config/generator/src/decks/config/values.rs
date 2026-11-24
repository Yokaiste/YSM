use super::*;

pub(super) fn invalid(label: &str) -> Box<ymb_sdk::Diagnostic> {
    failure(
        format!("Invalid deckGeneration.{label}."),
        "Check the value and supported fields in the deck-generation patch.",
    )
}
pub(super) fn object<'a>(value: Option<&'a Value>, label: &str) -> Result<Option<&'a Object>> {
    value
        .map(|v| v.as_object().ok_or_else(|| invalid(label)))
        .transpose()
}
pub(super) fn known(obj: Option<&Object>, allowed: &[&str], label: &str) -> Result<()> {
    if let Some(obj) = obj {
        for key in obj.keys() {
            ensure(
                allowed.contains(&key.as_str()),
                format!("Unsupported deckGeneration.{label} field: {key}."),
                "Correct or remove the field.",
            )?;
        }
    }
    Ok(())
}
pub(super) fn get<'a>(obj: Option<&'a Object>, key: &str) -> Option<&'a Value> {
    obj.and_then(|o| o.get(key))
}
pub(super) fn text(value: Option<&Value>, label: &str) -> Result<Option<String>> {
    value
        .map(|v| {
            v.as_str()
                .ok_or_else(|| invalid(label))
                .map(str::trim)
                .map(str::to_string)
        })
        .transpose()
        .map(|s| s.filter(|s| !s.is_empty()))
}
pub(super) fn strings(value: Option<&Value>, label: &str) -> Result<Vec<String>> {
    let Some(value) = value else {
        return Ok(Vec::new());
    };
    value
        .as_array()
        .ok_or_else(|| invalid(label))?
        .iter()
        .map(|v| {
            v.as_str()
                .map(|v| v.trim().to_string())
                .ok_or_else(|| invalid(label))
        })
        .filter(|s| s.as_ref().is_err() || s.as_ref().is_ok_and(|v| !v.is_empty()))
        .collect()
}
pub(super) fn boolean(value: Option<&Value>, fallback: bool, label: &str) -> Result<bool> {
    value.map_or(Ok(fallback), |v| v.as_bool().ok_or_else(|| invalid(label)))
}
pub(super) fn numeric(
    value: Option<&Value>,
    fallback: Option<f64>,
    min: f64,
    integer: bool,
    coerce: bool,
    label: &str,
) -> Result<f64> {
    let n = match value {
        None => fallback,
        Some(v) => v.as_f64().or_else(|| {
            if coerce {
                v.as_str().and_then(|s| s.trim().parse().ok())
            } else {
                None
            }
        }),
    };
    n.filter(|n| {
        n.is_finite()
            && *n >= min
            && (!integer || (n.fract() == 0. && n.abs() <= 9_007_199_254_740_991.))
    })
    .ok_or_else(|| invalid(label))
}
pub fn patterns(value: Option<&Value>, label: &str) -> Result<Vec<Regex>> {
    strings(value, label)?
        .iter()
        .map(|p| {
            RegexBuilder::new(p)
                .case_insensitive(true)
                .build()
                .map_err(|e| {
                    failure(
                        format!("Invalid {label} pattern {p:?}: {e}"),
                        "Correct the regular expression.",
                    )
                })
        })
        .collect()
}
pub(super) fn country_set(
    value: Option<&Value>,
    fallback: &[&str],
    label: &str,
) -> Result<HashSet<String>> {
    let values = if value.is_some() {
        strings(value, label)?
    } else {
        fallback.iter().map(|s| s.to_string()).collect()
    };
    Ok(values.iter().map(|s| s.to_uppercase()).collect())
}
pub(super) fn modes(value: Option<&Value>) -> Result<Vec<Mode>> {
    if value.is_none() {
        return Ok(Mode::ALL.to_vec());
    }
    let modes = strings(value, "modes")?;
    ensure(
        !modes.is_empty(),
        "Deck modes cannot be empty.",
        "Choose Unlimited, Balanced or StaticBalanced.",
    )?;
    Ok(unique(
        modes
            .iter()
            .map(|s| match s.to_lowercase().as_str() {
                "unlimited" => Ok(Mode::Unlimited),
                "balanced" => Ok(Mode::Balanced),
                "staticbalanced" => Ok(Mode::StaticBalanced),
                _ => Err(invalid("modes")),
            })
            .collect::<Result<Vec<_>>>()?,
    ))
}
pub(super) fn policies(value: Option<&Value>, deck: bool) -> Result<[Policy; 8]> {
    let obj = object(value, "policies")?;
    let mut keys = vec!["default"];
    keys.extend(VARIANTS);
    known(obj, &keys, "policies")?;
    let mut result = std::array::from_fn(|i| Policy {
        mod_units: i >= 6 || (!deck && i == 5),
        mod_supply: i % 2 == 1 || i >= 6,
        ignore_context: None,
        ignored: Vec::new(),
    });
    for key in keys {
        let p = object(get(obj, key), key)?;
        known(
            p,
            &[
                "includeModUnits",
                "includeModSupply",
                "modUnitsIgnoreContext",
                "ignoredUnitPatterns",
            ],
            key,
        )?;
        for (_, item) in result
            .iter_mut()
            .enumerate()
            .filter(|(i, _)| key == "default" || key == VARIANTS[*i])
        {
            if get(p, "includeModUnits").is_some() {
                item.mod_units = boolean(get(p, "includeModUnits"), false, key)?
            }
            if get(p, "includeModSupply").is_some() {
                item.mod_supply = boolean(get(p, "includeModSupply"), false, key)?
            }
            if get(p, "modUnitsIgnoreContext").is_some() {
                item.ignore_context = Some(boolean(get(p, "modUnitsIgnoreContext"), false, key)?)
            }
            if get(p, "ignoredUnitPatterns").is_some() {
                item.ignored = patterns(get(p, "ignoredUnitPatterns"), key)?
            }
        }
    }
    Ok(result)
}
pub(super) fn forced(value: Option<&Value>) -> Result<[Vec<Regex>; 8]> {
    let obj = object(value, "forcedUnitPatterns")?;
    let mut keys = vec!["default"];
    keys.extend(VARIANTS);
    known(obj, &keys, "forcedUnitPatterns")?;
    let default = patterns(get(obj, "default"), "forcedUnitPatterns.default")?;
    let mut result = std::array::from_fn(|_| default.clone());
    for (i, k) in VARIANTS.iter().enumerate() {
        if get(obj, k).is_some() {
            result[i] = patterns(get(obj, k), k)?
        }
    }
    Ok(result)
}
pub(super) fn templates(
    value: Option<&Value>,
    defaults: &[(&str, &str)],
    label: &str,
) -> Result<HashMap<String, String>> {
    let obj = object(value, label)?;
    known(
        obj,
        &defaults.iter().map(|(k, _)| *k).collect::<Vec<_>>(),
        label,
    )?;
    defaults
        .iter()
        .map(|(k, v)| {
            Ok((
                k.to_string(),
                text(get(obj, k), k)?.unwrap_or_else(|| v.to_string()),
            ))
        })
        .collect()
}
