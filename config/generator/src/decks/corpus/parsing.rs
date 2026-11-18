use super::*;

#[test]
fn original_parser_and_config_contract() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("../../../tests/fixtures/contracts.json")).unwrap();
    let mut checked = 0;
    for (i, c) in cases.iter().enumerate() {
        let name = c["name"].as_str().unwrap();
        let args = &c["args"];
        let expected = &c["result"];
        if name == "createDeckGenerationConfig" {
            let result = super::super::config::Config::parse(&args[0], args[1].as_str().unwrap());
            assert_eq!(
                result.is_err(),
                expected["error"] == true,
                "case {i} {name}: {result:?}"
            );
            checked += 1;
            continue;
        }
        let source = args[0].as_str();
        let result = match name {
            "parseEntities" => {
                let d = &args[3]["commentDirectives"];
                let directives = [
                    ("ignore", "ysm-ignore"),
                    ("everythingBelow", "ysm-ignore-everything-below"),
                    ("forceInclude", "ysm-force-include"),
                ]
                .map(|(key, default)| d[key].as_str().unwrap_or(default).trim().to_lowercase());
                super::super::parse::entities(
                    source.unwrap(),
                    if args[1] == "building" {
                        Kind::Building
                    } else {
                        Kind::Unit
                    },
                    &directives,
                )
                .map(|v| serde_json::to_value(v).unwrap())
            }
            "parseWeaponDescriptors" => super::super::parse::weapon_data(source.unwrap())
                .map(|v| serde_json::to_value(v.0).unwrap()),
            "parseAmmunition" => super::super::parse::ammunition(source.unwrap())
                .map(|v| serde_json::to_value(v).unwrap()),
            _ => continue,
        };
        assert_eq!(
            result.is_err(),
            expected["error"] == true,
            "case {i} {name}: {result:?}"
        );
        if let Ok(actual) = result {
            json_matches(&actual, expected, &format!("case {i} {name}"))
        }
        checked += 1;
    }
    assert_eq!(checked, 66);
}
