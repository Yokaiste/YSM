use super::*;

#[test]
fn original_rules_capacity_and_serialization_contract() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("../../../tests/fixtures/contracts.json")).unwrap();
    let mut count = 0;
    for (i, c) in cases.iter().enumerate() {
        let a = &c["args"];
        let expected = &c["result"];
        let name = c["name"].as_str().unwrap();
        let result = match name {
            "parseDivisionCostMatrices" => {
                serde_json::to_value(super::super::parse::matrices(a[0].as_str().unwrap()).unwrap())
                    .unwrap()
            }
            "parseDivisionRuleData" => {
                let divisions: Vec<_> = a[1]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(division_value)
                    .collect();
                let patterns = super::super::config::patterns(Some(&a[2]), "fixture").unwrap();
                serde_json::to_value(
                    super::super::parse::rules(a[0].as_str().unwrap(), &divisions, &patterns)
                        .unwrap(),
                )
                .unwrap()
            }
            "parseDivisionDescriptors" => {
                let patterns = super::super::config::patterns(Some(&a[2]), "fixture").unwrap();
                let divisions = super::super::parse::divisions(
                    a[0].as_str().unwrap(),
                    a[1].as_str().unwrap(),
                    &patterns,
                )
                .unwrap();
                let mut expected = expected.clone();
                for v in expected.as_array_mut().unwrap() {
                    v.as_object_mut().unwrap().remove("name");
                }
                let actual=Value::Array(divisions.iter().map(|d|serde_json::json!({"coalition":d.coalition,"maxActivationPoints":d.max_activation_points,"costMatrixName":d.cost_matrix_name,"inlineCostMatrix":d.inline_cost_matrix,"members":d.members.iter().map(|(n,t)|serde_json::json!({"unitName":n,"transportNames":t})).collect::<Vec<_>>(),"inlineUnitRules":d.inline_rules})).collect());
                json_matches(&actual, &expected, &format!("case {i} divisions"));
                count += 1;
                continue;
            }
            "parseCapacityEffectProfiles" => {
                let mut entities: Vec<_> = expected
                    .as_object()
                    .unwrap()
                    .keys()
                    .map(|n| Entity {
                        name: n.clone(),
                        capacity_names: vec![n.clone()],
                        ..Entity::default()
                    })
                    .collect();
                super::super::combat::capacity_profiles(
                    &mut entities,
                    a[0].as_str().unwrap(),
                    a[1].as_str().unwrap(),
                )
                .unwrap();
                Value::Object(entities.iter().map(|e|(e.name.clone(),serde_json::json!({"tokens":e.effect_tokens,"positiveTokens":e.positive_effect_tokens,"negativeTokens":e.negative_effect_tokens,"utility":e.effect_utility}))).collect())
            }
            "injectDeckSerializerEntries" => {
                let divisions: Vec<_> =
                    a[3].as_array().unwrap().iter().map(empty_variant).collect();
                let s = &a[7];
                let mut state = super::super::store::Serializer {
                    next_division_id: s["nextDivisionId"].as_u64().unwrap() as u32,
                    next_unit_id: s["nextUnitId"].as_u64().unwrap() as u32,
                    division_ids: serde_json::from_value(s["divisionIds"].clone()).unwrap(),
                    unit_ids: serde_json::from_value(s["unitIds"].clone()).unwrap(),
                };
                let source = a[2].as_str().unwrap();
                let fragment = source.trim_start().starts_with("DivisionIds");
                let source = if fragment {
                    format!("Serializer is TSerializer(\n{source}\n)")
                } else {
                    source.to_string()
                };
                let expected = if fragment {
                    format!(
                        "Serializer is TSerializer(\n{}\n)",
                        expected.as_str().unwrap()
                    )
                } else {
                    expected.as_str().unwrap().to_string()
                };
                let actual = super::super::serializer::render(
                    &source,
                    &divisions,
                    text_list(&a[4]),
                    a[5].as_str().unwrap(),
                    a[6].as_str().unwrap(),
                    &mut state,
                    &mut super::super::serializer::Registry::default(),
                )
                .unwrap();
                assert_eq!(
                    ndf_tokens(&actual),
                    ndf_tokens(&expected),
                    "case {i} serializer"
                );
                assert!(
                    actual.contains(a[6].as_str().unwrap()),
                    "literal source label"
                );
                count += 1;
                continue;
            }
            "renderDivisionRulesOutput" => {
                let divisions: Vec<_> =
                    a[2].as_array().unwrap().iter().map(empty_variant).collect();
                let actual = super::super::render::rules(
                    a[1].as_str().unwrap(),
                    &divisions,
                    &[],
                    a[3].as_str().unwrap(),
                    a[4].as_str().unwrap(),
                )
                .unwrap();
                assert_eq!(
                    ndf_tokens(&actual),
                    ndf_tokens(expected.as_str().unwrap()),
                    "case {i} rules"
                );
                count += 1;
                continue;
            }
            _ => continue,
        };
        json_matches(&result, expected, &format!("case {i} {name}"));
        count += 1;
    }
    assert_eq!(count, 14);
}
