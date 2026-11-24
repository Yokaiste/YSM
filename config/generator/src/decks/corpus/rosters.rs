use super::*;

#[test]
fn original_premade_composition_contract() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("../../../tests/fixtures/contracts.json")).unwrap();
    let mut count = 0;
    for (i, c) in cases
        .iter()
        .enumerate()
        .filter(|(_, c)| c["name"] == "buildPremadeCards")
    {
        let args = &c["args"][0];
        let mut entities = Vec::new();
        let mut index = HashMap::new();
        for e in args["entityByName"].as_object().unwrap().values().chain(
            args["ruleEntries"]
                .as_array()
                .unwrap()
                .iter()
                .map(|r| &r["entity"]),
        ) {
            let e: Entity = serde_json::from_value(e.clone()).unwrap();
            if !index.contains_key(&e.name) {
                index.insert(e.name.clone(), entities.len());
                entities.push(e);
            }
        }
        let rules: Vec<_> = args["ruleEntries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| {
                let rule: RawEntry = serde_json::from_value(v.clone()).unwrap();
                RuleEntry {
                    entity: index[&rule.entity.name],
                    rule: rule.rule,
                    transports: rule
                        .transport_names
                        .iter()
                        .filter_map(|n| index.get(n).copied())
                        .collect(),
                }
            })
            .collect();
        let weapons: Weapons = serde_json::from_value(args["weaponDescriptors"].clone()).unwrap();
        let ammunition: Ammunition = serde_json::from_value(args["ammunition"].clone()).unwrap();
        let config =
            super::super::config::Config::parse(&args["config"], args["modTag"].as_str().unwrap())
                .unwrap();
        let factory = analysis::Factory::new(&entities, &weapons, &ammunition);
        let mut packs = indexmap::IndexMap::new();
        let result = super::super::premade::build(
            &context_value(&args["context"]),
            serde_json::from_value(args["mode"].clone()).unwrap(),
            &rules,
            &factory,
            &mut packs,
            args["modTag"].as_str().unwrap(),
            &config,
        );
        assert_eq!(
            result.is_err(),
            c["result"]["error"] == true,
            "case {i} {result:?}"
        );
        if let Ok(result) = result {
            let actual = Value::Array(result.iter().map(|c| card_json(c, &entities)).collect());
            let expected = Value::Array(
                c["result"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(expected_card_json)
                    .collect(),
            );
            json_matches(&actual, &expected, &format!("case {i} composition"));
        }
        count += 1;
    }
    assert_eq!(count, 10);
}

#[test]
fn original_roster_policy_contract() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("../../../tests/fixtures/contracts.json")).unwrap();
    let mut count = 0;
    for (i, c) in cases.iter().enumerate() {
        let name = c["name"].as_str().unwrap();
        let a = &c["args"];
        let result = match name {
            "shouldCreateCountryContext" => super::super::config::Config::parse(&a[1], "TEST")
                .unwrap()
                .country_context(a[0].as_str().unwrap()),
            "shouldIncludeEntityInVariant" | "shouldIncludeEntityInPremade" => {
                let config = super::super::config::Config::parse(&a[3], "TEST").unwrap();
                config.includes(
                    &serde_json::from_value(a[0].clone()).unwrap(),
                    &context_value(&a[1]),
                    serde_json::from_value(a[2].clone()).unwrap(),
                    name == "shouldIncludeEntityInPremade",
                )
            }
            _ => continue,
        };
        assert_eq!(result, c["result"].as_bool().unwrap(), "case {i} {name}");
        count += 1;
    }
    assert_eq!(count, 148);
}

#[test]
fn original_context_and_naming_contract() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("../../../tests/fixtures/contracts.json")).unwrap();
    let mut count = 0;
    for (i, c) in cases.iter().enumerate() {
        let name = c["name"].as_str().unwrap();
        let a = &c["args"];
        let result = if name == "buildDivisionContexts" {
            let entities: Vec<Entity> = serde_json::from_value(a[0].clone()).unwrap();
            super::super::contexts::build(
                &entities,
                &(0..entities.len()).collect::<Vec<_>>(),
                a[1].as_str().unwrap(),
                &super::super::config::Config::parse(&a[2], a[1].as_str().unwrap()).unwrap(),
            )
            .map(|v| Value::Array(v.iter().map(context_json).collect()))
        } else if [
            "buildGeneratedDivisionName",
            "buildGeneratedDeckName",
            "buildGeneratedDivisionSummaryText",
            "resolveDivisionEmblemTexture",
        ]
        .contains(&name)
        {
            let context = context_value(&a[0]);
            let mode: Mode = serde_json::from_value(a[1].clone()).unwrap();
            let tag = a[2].as_str().unwrap();
            let config = super::super::config::Config::parse(&a[3], tag).unwrap();
            let f = match name {
                "buildGeneratedDivisionName" => super::super::contexts::division_name,
                "buildGeneratedDeckName" => super::super::contexts::deck_name,
                "buildGeneratedDivisionSummaryText" => super::super::contexts::summary,
                _ => super::super::contexts::emblem,
            };
            f(&context, mode, tag, &config).map(Value::String)
        } else {
            continue;
        };
        assert_eq!(
            result.is_err(),
            c["result"]["error"] == true,
            "case {i} {name}: {result:?}"
        );
        if let Ok(v) = result {
            json_matches(&v, &c["result"], &format!("case {i} {name}"))
        }
        count += 1;
    }
    assert_eq!(count, 31);
}
