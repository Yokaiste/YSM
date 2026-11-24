use super::*;

#[test]
fn original_analysis_contract() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("../../../tests/fixtures/analysis.json")).unwrap();
    let mut count = 0;
    for (index, case) in cases.iter().enumerate() {
        let name = case["name"].as_str().unwrap();
        if name == "buildCategoryAnalyses" {
            let args = &case["args"];
            let entries: Vec<RawEntry> = serde_json::from_value(args["entries"].clone()).unwrap();
            let weapons: Weapons =
                serde_json::from_value(args["weaponDescriptors"].clone()).unwrap();
            let ammunition: Ammunition =
                serde_json::from_value(args["ammunition"].clone()).unwrap();
            let mut entities: Vec<_> = entries.iter().map(|e| e.entity.clone()).collect();
            let mut by_name: HashMap<_, _> = entities
                .iter()
                .enumerate()
                .map(|(i, e)| (e.name.clone(), i))
                .collect();
            for e in &entries {
                for t in &e.transport_names {
                    if !by_name.contains_key(t) {
                        by_name.insert(t.clone(), entities.len());
                        entities.push(Entity {
                            name: t.clone(),
                            ..Entity::default()
                        });
                    }
                }
            }
            let rules: Vec<_> = entries
                .iter()
                .enumerate()
                .map(|(i, e)| RuleEntry {
                    entity: i,
                    rule: e.rule.clone(),
                    transports: e.transport_names.iter().map(|n| by_name[n]).collect(),
                })
                .collect();
            let factory = analysis::Factory::new(&entities, &weapons, &ammunition);
            let (actual, roles, average) = analysis::category_analyses(
                &rules,
                &factory,
                args["deckVeterancy"].as_u64().map(|v| v as usize),
            );
            let expected = &case["result"];
            assert_eq!(
                actual.len(),
                expected["analyses"].as_array().unwrap().len(),
                "case {index}"
            );
            near_number(
                average,
                expected["stats"]["averageCost"].as_f64().unwrap(),
                &format!("case {index}.average"),
            );
            for (i, a) in actual.iter().enumerate() {
                let e = &expected["analyses"][i];
                let label = format!("case {index}.{}", entities[a.entity].name);
                metrics(a.metrics, &e["metrics"], &format!("{label}.metrics"));
                metrics(
                    a.relative,
                    &e["relativeMetrics"],
                    &format!("{label}.relative"),
                );
                for (m, v) in SIMILARITY
                    .iter()
                    .zip(e["similarityVector"].as_array().unwrap())
                {
                    near_number(
                        a.vector[*m],
                        v.as_f64().unwrap(),
                        &format!("{label}.vector.{m:?}"),
                    )
                }
                assert_eq!(a.type_key, e["typeKey"].as_str().unwrap(), "{label}.type");
                assert_eq!(
                    a.similarity_key,
                    e["similarityKey"].as_str().unwrap(),
                    "{label}.similarity"
                );
                assert_eq!(
                    a.exact.iter().cloned().collect::<BTreeSet<_>>(),
                    set(&e["exactRoleTokens"]),
                    "{label}.roles"
                );
                assert_eq!(
                    a.profile.tokens,
                    set(&e["profileTokens"]),
                    "{label}.profile"
                );
            }
            let expected_roles = expected["roleDefinitions"].as_array().unwrap();
            assert_eq!(
                roles.len(),
                expected_roles.len(),
                "case {index}.roles: {:?}",
                roles.iter().map(|r| &r.key).collect::<Vec<_>>()
            );
            for (r, e) in roles.iter().zip(expected_roles) {
                let label = format!("case {index}.role.{}", r.key);
                assert_eq!(r.key, e["key"].as_str().unwrap(), "{label}.key");
                assert_eq!(
                    r.options,
                    e["optionCount"].as_u64().unwrap() as usize,
                    "{label}.options"
                );
                near_number(r.priority, e["priority"].as_f64().unwrap(), &label);
                metrics(r.focus, &e["focus"], &label);
            }
        } else {
            let a = read_view(&case["args"][0]);
            let b = read_view(&case["args"][1]);
            let left = similarity::View {
                entity: &a.0,
                vector: &a.1,
                profile: &a.2,
                transported: a.3,
                length: a.4,
            };
            let right = similarity::View {
                entity: &b.0,
                vector: &b.1,
                profile: &b.2,
                transported: b.3,
                length: b.4,
            };
            if name == "areNearDuplicateProfiles" {
                assert_eq!(
                    similarity::near(left, right),
                    case["result"].as_bool().unwrap(),
                    "case {index} {} / {}",
                    a.0.name,
                    b.0.name
                );
            } else {
                let expected = case["result"].as_f64().unwrap();
                assert_eq!(
                    similarity::compare(left, right),
                    expected.total_cmp(&0.),
                    "case {index} {} / {}",
                    a.0.name,
                    b.0.name
                );
            }
        }
        count += 1;
    }
    assert_eq!(count, 263);
}
