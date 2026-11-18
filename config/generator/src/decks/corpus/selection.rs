use super::*;

#[test]
fn original_selection_and_transport_contract() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("../../../tests/fixtures/contracts.json")).unwrap();
    let mut checked = 0;
    for (i, c) in cases.iter().enumerate() {
        let name = c["name"].as_str().unwrap();
        let args = &c["args"][0];
        if ![
            "resolveSelectedTransportNames",
            "normalizeTransportName",
            "buildRoleSelections",
        ]
        .contains(&name)
        {
            continue;
        }
        let mut entities = Vec::new();
        let mut index = HashMap::new();
        for (_, e) in args["entityByName"].as_object().into_iter().flatten() {
            let e: Entity = serde_json::from_value(e.clone()).unwrap();
            if !index.contains_key(&e.name) {
                index.insert(e.name.clone(), entities.len());
                entities.push(e);
            }
        }
        for a in args["analyses"].as_array().into_iter().flatten().chain(
            args["analysisByName"]
                .as_object()
                .into_iter()
                .flatten()
                .map(|(_, v)| v),
        ) {
            let e: Entity = serde_json::from_value(a["entity"].clone()).unwrap();
            if !index.contains_key(&e.name) {
                index.insert(e.name.clone(), entities.len());
                entities.push(e);
            }
        }
        let config = super::super::config::Config::parse(&args["config"], "TEST").unwrap();
        if name == "buildRoleSelections" {
            let analyses: Vec<_> = args["analyses"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| analysis_value(v, &index))
                .collect();
            let result = super::super::selection::selections(
                &role_value(&args["roleDefinition"]),
                &analyses,
                &entities,
                args["stats"]["averageCost"].as_f64().unwrap(),
                &context_value(&args["context"]),
                &config,
            );
            let actual:Vec<_>=result.iter().map(|s|serde_json::json!({"entity":entities[analyses[s.analysis].entity].name,"roleKey":s.role,"selectionKind":s.kind,"roleScore":s.score,"keepPriority":s.priority})).collect();

            let expected:Vec<_>=c["result"].as_array().unwrap().iter().map(|s|serde_json::json!({"entity":s["analysis"]["entity"]["name"],"roleKey":s["roleKey"],"selectionKind":s["selectionKind"],"roleScore":s["roleScore"],"keepPriority":s["keepPriority"]})).collect();
            json_matches(
                &serde_json::to_value(actual).unwrap(),
                &serde_json::to_value(expected).unwrap(),
                &format!("case {i} {name}"),
            );
        } else {
            let e: Entity = serde_json::from_value(args["entry"]["entity"].clone()).unwrap();
            let id = *index.entry(e.name.clone()).or_insert_with(|| {
                let id = entities.len();
                entities.push(e);
                id
            });
            let entry = RuleEntry {
                entity: id,
                rule: serde_json::from_value(args["entry"]["rule"].clone()).unwrap(),
                transports: text_list(&args["entry"]["transportNames"])
                    .iter()
                    .filter_map(|n| index.get(n).copied())
                    .collect(),
            };
            let kind = serde_json::from_value(if name == "normalizeTransportName" {
                args["card"]["selectionKind"].clone()
            } else {
                args["selectionKind"].clone()
            })
            .unwrap();
            let actual = if name == "normalizeTransportName" {
                let old = args["card"]["transportName"]
                    .as_str()
                    .and_then(|n| index.get(n))
                    .copied();
                super::super::transport::normalize(old, &entry, kind, &entities, &config)
                    .map_or(Value::Null, |id| Value::String(entities[id].name.clone()))
            } else {
                let analyses: HashMap<_, _> = args["analysisByName"]
                    .as_object()
                    .into_iter()
                    .flatten()
                    .map(|(name, v)| (index[name], analysis_value(v, &index)))
                    .collect();
                let refs = analyses.iter().map(|(id, a)| (*id, a)).collect();
                Value::Array(
                    super::super::transport::selected(&entry, kind, &entities, &refs, &config)
                        .iter()
                        .map(|id| {
                            id.map_or(Value::Null, |id| Value::String(entities[id].name.clone()))
                        })
                        .collect(),
                )
            };
            json_matches(
                &actual,
                c.get("result").unwrap_or(&Value::Null),
                &format!("case {i} {name}"),
            );
        }
        checked += 1;
    }
    assert_eq!(checked, 133);
}

#[test]
fn original_card_trimming_contract() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("../../../tests/fixtures/contracts.json")).unwrap();
    let mut count = 0;
    for (i, c) in cases
        .iter()
        .enumerate()
        .filter(|(_, c)| c["name"] == "trimCategoryCards")
    {
        let args = &c["args"][0];
        let mut entities = Vec::new();
        let mut index = HashMap::new();
        for e in args["entityByName"]
            .as_object()
            .into_iter()
            .flatten()
            .map(|(_, v)| v)
            .chain(
                args["cards"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|c| &c["entity"]),
            )
        {
            let e: Entity = serde_json::from_value(e.clone()).unwrap();
            if !index.contains_key(&e.name) {
                index.insert(e.name.clone(), entities.len());
                entities.push(e);
            }
        }
        // Some original role fixtures retain a transport name from another case.
        for c in args["cards"].as_array().unwrap() {
            if let Some(name) = c["transportName"].as_str()
                && !index.contains_key(name)
            {
                index.insert(name.into(), entities.len());
                entities.push(Entity {
                    name: name.into(),
                    ..Entity::default()
                });
            }
        }
        let cards: Vec<_> = args["cards"]
            .as_array()
            .unwrap()
            .iter()
            .map(|c| card_value(c, &index))
            .collect();
        let config = super::super::config::Config::parse(&args["config"], "TEST").unwrap();
        let result = super::super::cards::trim(
            cards,
            args["limit"].as_u64().unwrap() as usize,
            &entities,
            &context_value(&args["context"]),
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
            json_matches(&actual, &expected, &format!("case {i} trimming"));
        }
        count += 1;
    }
    assert_eq!(count, 16);
}
