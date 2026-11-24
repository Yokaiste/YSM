use super::{
    analysis::{self, Profile},
    data::*,
    metrics::{ALL, Metrics, NAMES, SIMILARITY},
    similarity,
};
use serde::Deserialize;
use serde_json::Value;
use std::collections::{BTreeSet, HashMap};
fn near_number(actual: f64, expected: f64, label: &str) {
    assert!(
        (actual - expected).abs() <= 1e-7f64.max(expected.abs() * 1e-10),
        "{label}: {actual} != {expected}"
    );
}
fn metrics(actual: Metrics, expected: &Value, label: &str) {
    for (m, name) in ALL.iter().zip(NAMES) {
        near_number(
            actual[*m],
            expected[name].as_f64().unwrap_or(0.),
            &format!("{label}.{name}"),
        )
    }
}
fn set(value: &Value) -> BTreeSet<String> {
    value
        .as_array()
        .map(|v| {
            v.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawEntry {
    entity: Entity,
    rule: Rule,
    #[serde(default)]
    transport_names: Vec<String>,
}
fn read_view(value: &Value) -> (Entity, Metrics, Profile, bool, usize) {
    let entity: Entity = serde_json::from_value(value["entity"].clone()).unwrap();
    let mut vector = Metrics::default();
    let values = value["similarityVector"]
        .as_array()
        .cloned()
        .unwrap_or_default();
    for (m, v) in SIMILARITY.iter().zip(&values) {
        vector[*m] = v.as_f64().unwrap();
    }
    let profile = Profile::new(
        &entity,
        value["typeKey"].as_str().unwrap_or(""),
        set(&value["profileTokens"]),
    );
    let transported = value["transportName"]
        .as_str()
        .is_some_and(|s| !s.is_empty())
        || value["entry"]["transportNames"]
            .as_array()
            .is_some_and(|v| !v.is_empty());
    (entity, vector, profile, transported, values.len())
}
fn json_matches(actual: &Value, expected: &Value, label: &str) {
    match (actual, expected) {
        (Value::Object(a), Value::Object(e)) => {
            for (key, value) in e {
                json_matches(
                    a.get(key).unwrap_or(&Value::Null),
                    value,
                    &format!("{label}.{key}"),
                )
            }
        }
        (Value::Array(a), Value::Array(e)) => {
            assert_eq!(a.len(), e.len(), "{label}.length");
            for (i, (a, e)) in a.iter().zip(e).enumerate() {
                json_matches(a, e, &format!("{label}[{i}]"))
            }
        }
        (Value::Number(a), Value::Number(e)) => {
            near_number(a.as_f64().unwrap(), e.as_f64().unwrap(), label)
        }
        _ => assert_eq!(actual, expected, "{label}"),
    }
}
fn text_list(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| a.iter().map(|s| s.as_str().unwrap().to_string()).collect())
        .unwrap_or_default()
}
fn metric_value(v: &Value) -> Metrics {
    let mut m = Metrics::default();
    for (k, name) in ALL.iter().zip(NAMES) {
        m[*k] = v[name].as_f64().unwrap_or(0.)
    }
    m
}
fn analysis_value(v: &Value, index: &HashMap<String, usize>) -> analysis::Analysis {
    let (_, vector, profile, _, length) = read_view(v);
    let entity = index[v["entity"]["name"].as_str().unwrap()];
    analysis::Analysis {
        entity,
        rule: if v["entry"]["rule"].is_object() {
            serde_json::from_value(v["entry"]["rule"].clone()).unwrap()
        } else {
            Rule::default()
        },
        transports: text_list(&v["entry"]["transportNames"])
            .iter()
            .filter_map(|n| index.get(n).copied())
            .collect(),
        type_key: v["typeKey"].as_str().unwrap_or("").to_string(),
        similarity_key: v["similarityKey"].as_str().unwrap_or("").to_string(),
        vector,
        vector_len: length,
        roles: text_list(&v["roleTokens"]),
        exact: text_list(&v["exactRoleTokens"]).into_iter().collect(),
        coverage: text_list(&v["coverageRoleKeys"]),
        profile: std::sync::Arc::new(profile),
        metrics: metric_value(&v["metrics"]),
        relative: metric_value(&v["relativeMetrics"]),
    }
}
fn context_value(v: &Value) -> Context {
    Context {
        code: v["code"].as_str().unwrap_or("TEST").into(),
        scope: match v["scope"].as_str().unwrap_or("all-side") {
            "country" => Scope::Country,
            "side" => Scope::Side,
            "custom" => Scope::Custom,
            _ => Scope::AllSide,
        },
        coalition: v["coalition"].as_str().unwrap_or("NATO").into(),
        country_id: v["countryId"].as_str().unwrap_or("TEST").into(),
        name_label: v["nameLabel"].as_str().map(str::to_string),
        division_name: v["divisionName"].as_str().map(str::to_string),
        deck_name: v["deckName"].as_str().map(str::to_string),
        description: v["description"].as_str().map(str::to_string),
        interface_order: v["interfaceOrder"].as_f64(),
        tags: text_list(&v["tags"]),
        allowed_modes: v
            .get("allowedModes")
            .map(|v| serde_json::from_value(v.clone()).unwrap())
            .unwrap_or_else(|| Mode::ALL.to_vec()),
        emblem_texture: v["emblemTexture"].as_str().map(str::to_string),
        filter: if v["acceptedEntityNames"].is_array() {
            Filter::Patterns(
                text_list(&v["acceptedEntityNames"])
                    .iter()
                    .map(|s| regex::Regex::new(&format!("^{}$", regex::escape(s))).unwrap())
                    .collect(),
            )
        } else {
            match v["scope"].as_str() {
                Some("country") => {
                    Filter::Country(v["countryId"].as_str().unwrap_or("TEST").into())
                }
                Some("side") => Filter::Coalition(v["coalition"].as_str().unwrap_or("NATO").into()),
                _ => Filter::All,
            }
        },
    }
}
fn role_value(v: &Value) -> super::roles::Role {
    super::roles::Role {
        key: v["key"].as_str().unwrap().into(),
        kind: match v["kind"].as_str().unwrap() {
            "primary" => super::roles::RoleKind::Primary,
            "type" => super::roles::RoleKind::Type,
            "role" => super::roles::RoleKind::Role,
            "capability" => super::roles::RoleKind::Capability,
            _ => super::roles::RoleKind::Trait,
        },
        options: v["optionCount"].as_u64().unwrap() as usize,
        priority: v["priority"].as_f64().unwrap_or(0.),
        focus: metric_value(&v["focus"]),
    }
}
fn card_value(v: &Value, index: &HashMap<String, usize>) -> super::cards::Card {
    let (_, vector, profile, _, length) = read_view(v);
    super::cards::Card {
        entity: index[v["entity"]["name"].as_str().unwrap()],
        category_order: v["categoryOrder"].as_u64().unwrap_or(10) as usize,
        type_key: v["typeKey"].as_str().unwrap().into(),
        roles: text_list(&v["roleKeys"]),
        coverage: v.get("coverageRoleKeys").map(text_list),
        kind: serde_json::from_value(v["selectionKind"].clone()).unwrap(),
        forced: v["forcedInPremade"].as_bool().unwrap_or(false),
        max_count: v["maxUnitCardCount"].as_u64().unwrap() as usize,
        role_score: v["roleScore"].as_f64().unwrap(),
        keep_priority: v["keepPriority"].as_f64().unwrap(),
        similarity_key: v["similarityKey"].as_str().unwrap_or("").into(),
        vector,
        vector_len: length,
        profile: std::sync::Arc::new(profile),
        pack: v["packDescriptorName"].as_str().unwrap_or("").into(),
        transport: v["transportName"]
            .as_str()
            .and_then(|n| index.get(n))
            .copied(),
    }
}
fn card_json(c: &super::cards::Card, entities: &[Entity]) -> Value {
    serde_json::json!({"entity":entities[c.entity].name,"categoryOrder":c.category_order,"typeKey":c.type_key,"roleKeys":c.roles,"coverageRoleKeys":c.coverage,"selectionKind":c.kind,"forcedInPremade":c.forced,"maxUnitCardCount":c.max_count,"roleScore":c.role_score,"keepPriority":c.keep_priority,"packDescriptorName":c.pack,"transportName":c.transport.map(|id|&entities[id].name)})
}
// Card category is derived from its entity; synthetic fixtures can retain stale display metadata.
fn expected_card_json(v: &Value) -> Value {
    serde_json::json!({"entity":v["entity"]["name"],"categoryOrder":v["categoryOrder"],"typeKey":v["typeKey"],"roleKeys":v["roleKeys"],"coverageRoleKeys":v["coverageRoleKeys"],"selectionKind":v["selectionKind"],"forcedInPremade":v["forcedInPremade"],"maxUnitCardCount":v["maxUnitCardCount"],"roleScore":v["roleScore"],"keepPriority":v["keepPriority"],"packDescriptorName":v["packDescriptorName"],"transportName":v["transportName"]})
}
fn context_json(c: &Context) -> Value {
    serde_json::json!({"code":c.code,"scope":match c.scope {Scope::Country=>"country",Scope::Side=>"side",Scope::AllSide=>"all-side",Scope::Custom=>"custom"},"coalition":c.coalition,"countryId":c.country_id,"nameLabel":c.name_label,"divisionName":c.division_name,"deckName":c.deck_name,"description":c.description,"interfaceOrder":c.interface_order,"tags":c.tags,"allowedModes":c.allowed_modes,"emblemTexture":c.emblem_texture})
}
fn division_value(v: &Value) -> Division {
    Division {
        coalition: v["coalition"].as_str().map(str::to_string),
        max_activation_points: v["maxActivationPoints"].as_f64(),
        cost_matrix_name: v["costMatrixName"].as_str().map(str::to_string),
        inline_cost_matrix: v
            .get("inlineCostMatrix")
            .map(|v| serde_json::from_value(v.clone()).unwrap())
            .unwrap_or_default(),
        members: v["members"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|m| {
                (
                    m["unitName"].as_str().unwrap().into(),
                    text_list(&m["transportNames"]),
                )
            })
            .collect(),
        inline_rules: v
            .get("inlineUnitRules")
            .map(|v| serde_json::from_value(v.clone()).unwrap())
            .unwrap_or_default(),
    }
}
fn empty_variant(v: &Value) -> Variant {
    Variant {
        context: std::sync::Arc::new(context_value(&Value::Null)),
        descriptor: v["descriptorName"].as_str().unwrap_or("").into(),
        rule_name: v["ruleName"].as_str().unwrap_or("").into(),
        deck: String::new(),
        cfg_name: String::new(),
        emblem: String::new(),
        metadata: super::store::Metadata {
            guid: String::new(),
            division_name_token: String::new(),
            deck_name_token: String::new(),
        },
        summary: String::new(),
        order: 0.,
        tags: Vec::new(),
        standout: Vec::new(),
        entries: std::sync::Arc::from([]),
        cards: Vec::new(),
    }
}
fn ndf_tokens(source: &str) -> Vec<String> {
    use ymb_sdk::ndf::lexer::{Kind, Lexer};
    let mut lexer = Lexer::new(source, 0);
    let mut out = Vec::new();
    loop {
        let token = lexer.next_token().unwrap();
        if token.kind == Kind::Eof {
            return out;
        }
        out.push(token.text.to_string())
    }
}

mod analysis_cases;
mod parsing;
mod rosters;
mod selection;
mod serialization;
