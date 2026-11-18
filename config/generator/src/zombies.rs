use crate::{entities, localisation};
use serde_json::Value;
use ymb_sdk::{Context, GeneratedFile, Result, TestResult, ensure};

const ZOMBIE_UNITS: &[(&str, bool)] = &[
    ("zombieHealthMultiplier", true),
    ("zombieSpeedMultiplier", true),
    ("zombieCostMultiplier", false),
];
const ZOMBIE_AMMUNITION: &[(&str, bool)] = &[
    ("zombieDamageMultiplier", false),
    ("zombieRangeMultiplier", false),
];

fn tuning(variables: &Value, settings: &[(&str, bool)]) -> Result<()> {
    for &(key, positive) in settings {
        let valid = variables
            .get(key)
            .and_then(Value::as_f64)
            .is_some_and(|value| value.is_finite() && value >= 0.0 && (!positive || value > 0.0));
        ensure(
            valid,
            format!("Invalid zombie setting: {key}."),
            if positive {
                "Use a finite number greater than zero."
            } else {
                "Use a finite number zero or greater."
            },
        )?;
    }
    Ok(())
}

pub fn units(ctx: &mut Context) -> Result<Vec<GeneratedFile>> {
    tuning(&ctx.variables, ZOMBIE_UNITS)?;
    entities::validate(ctx, &[entities::UNITS], |name| {
        name.starts_with("Descriptor_Unit_YZ_")
    })?;
    localisation::merge_feature(ctx, "UNITS")
}

pub fn ammunition(ctx: &mut Context) -> Result<Vec<GeneratedFile>> {
    tuning(&ctx.variables, ZOMBIE_AMMUNITION)?;
    localisation::merge_feature(ctx, "UNITS")
}

fn check_tuning(settings: &[(&str, bool)]) -> Result<()> {
    let mut variables = serde_json::json!({});
    for &(key, _) in settings {
        variables[key] = serde_json::json!(1);
    }
    tuning(&variables, settings)?;
    for &(key, positive) in settings {
        for invalid in [
            Value::Null,
            serde_json::json!(-1),
            serde_json::json!("1"),
            serde_json::json!(true),
        ] {
            let mut sample = variables.clone();
            sample[key] = invalid;
            ensure(
                tuning(&sample, settings).is_err(),
                format!("Invalid {key} accepted."),
                "Require a finite numeric multiplier.",
            )?;
        }
        let mut sample = variables.clone();
        sample[key] = serde_json::json!(0);
        ensure(
            tuning(&sample, settings).is_ok() != positive,
            format!("Wrong zero boundary for {key}."),
            "Keep positive and nonnegative settings distinct.",
        )?;
    }
    Ok(())
}

pub fn unit_checks(ctx: &mut Context) -> Result<Vec<TestResult>> {
    check_tuning(ZOMBIE_UNITS)?;
    let mut results = entities::checks(ctx)?;
    results.push(TestResult::passed(
        "Zombie health, speed, and cost boundaries",
    ));
    Ok(results)
}

pub fn ammunition_checks(_: &mut Context) -> Result<Vec<TestResult>> {
    check_tuning(ZOMBIE_AMMUNITION)?;
    Ok(vec![TestResult::passed(
        "Zombie damage and range boundaries",
    )])
}

#[test]
fn zombie_multiplier_boundaries() {
    check_tuning(ZOMBIE_UNITS).unwrap();
    check_tuning(ZOMBIE_AMMUNITION).unwrap();
}

pub fn deck_config(shared: &Value, tag: &str) -> Value {
    let mut config = serde_json::Map::new();
    for key in [
        "deckSlotCount",
        "unlimitedPackUnitCount",
        "staticPackCounts",
        "deckVeterancy",
        "minimumContextUnitCount",
        "requireCommandUnitInContext",
        "commentDirectives",
        "deckMaxTransportCostRatio",
        "naming",
        "modCountryIds",
    ] {
        if let Some(v) = shared.get(key) {
            config.insert(key.into(), v.clone());
        }
    }
    config.insert(
        "contextGeneration".into(),
        serde_json::json!({"countries":false,"coalitions":false,"allSides":false}),
    );
    let divisions:Vec<_>=["NATO","PACT"].iter().enumerate().map(|(index,coalition)|serde_json::json!({
        "code":if index==0{"ZOMBIE_HORDE_BLUE"}else{"ZOMBIE_HORDE_RED"},
        "name":format!("{tag} Zombie Horde"),"divisionName":"{name}","deckName":"{name}",
        "description":"Overrun the front with an undead army. Keep the pressure on and close the distance.",
        "countryId":tag,"coalition":coalition,"skipIfEmpty":true,"tags":["ZOMBIES","HORDE"],"modes":["Unlimited"],
        "emblemTexture":format!("Texture{tag}_Division_HORDE"),"unitPatterns":["^Descriptor_Unit_YZ_"]
    })).collect();
    config.insert("customDivisions".into(), Value::Array(divisions));
    Value::Object(config)
}
