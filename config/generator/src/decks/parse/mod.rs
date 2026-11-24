use super::data::*;
use ndf::lexer::{Kind as TokenKind, Lexer};
use std::collections::{HashMap, HashSet};
use ymb_sdk::{Result, ndf, parallel};

pub struct Fields<'a> {
    values: HashMap<&'a str, &'a str>,
}
impl<'a> Fields<'a> {
    pub fn new(text: &'a str) -> Result<Self> {
        let mut values = HashMap::new();
        for f in ndf::read::fields(text)? {
            values.entry(f.name).or_insert(&text[f.value]);
        }
        for f in ndf::read::direct_fields(text)? {
            values.insert(f.name, &text[f.value]);
        }
        Ok(Self { values })
    }
    pub fn get(&self, key: &str) -> Option<&'a str> {
        self.values.get(key).copied().map(str::trim)
    }
    pub fn num(&self, key: &str) -> Option<f64> {
        number(self.get(key))
    }
    pub fn boolean(&self, key: &str) -> Option<bool> {
        match self.get(key)?.to_ascii_lowercase().as_str() {
            "true" => Some(true),
            "false" => Some(false),
            _ => None,
        }
    }
    pub fn string(&self, key: &str) -> Option<String> {
        self.get(key).and_then(ndf::values::unquote)
    }
    pub fn suffix(&self, key: &str, prefix: &str) -> Option<String> {
        self.get(key)?.strip_prefix(prefix).map(str::to_string)
    }
    pub fn list(&self, key: &str) -> Result<Vec<String>> {
        list(self.get(key))
    }
}
// compatibility: decooked references may be local to their cluster.
pub fn reference(value: Option<&str>, cluster: &str) -> Option<String> {
    let clean = ndf::values::strip_comments(value?);
    let raw = clean.trim();
    if raw == "nil" {
        return None;
    }
    let name = raw
        .strip_prefix(cluster)
        .or_else(|| raw.strip_prefix("~/"))
        .unwrap_or(raw);
    let mut chars = name.chars();
    (chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_'))
    .then(|| name.to_owned())
}
pub fn number(value: Option<&str>) -> Option<f64> {
    value?.trim().parse::<f64>().ok().filter(|v| v.is_finite())
}
pub fn list(value: Option<&str>) -> Result<Vec<String>> {
    let Some(v) = value else {
        return Ok(Vec::new());
    };
    if !v.trim().starts_with('[') || !v.trim().ends_with(']') {
        return Ok(Vec::new());
    }
    Ok(ndf::read::entries(v)?
        .into_iter()
        .map(|e| ndf::values::unquote(e.text.trim()).unwrap_or_else(|| e.text.trim().to_string()))
        .collect())
}
pub fn numbers(value: Option<&str>) -> Result<Vec<f64>> {
    Ok(list(value)?
        .iter()
        .filter_map(|v| number(Some(v)))
        .collect())
}
fn tags(value: Option<&str>) -> Result<Vec<String>> {
    Ok(list(value)?
        .iter()
        .map(|v| {
            v.chars()
                .filter(char::is_ascii_alphanumeric)
                .collect::<String>()
                .to_ascii_lowercase()
        })
        .filter(|v| !v.is_empty())
        .collect())
}
thread_local! {static PATTERNS:std::cell::RefCell<HashMap<String,regex::Regex>>=std::cell::RefCell::new(HashMap::new());}
static COMPILED_PATTERNS: std::sync::LazyLock<std::sync::Mutex<HashMap<String, regex::Regex>>> =
    std::sync::LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));
fn with_pattern<T>(pattern: &str, read: impl FnOnce(&regex::Regex) -> T) -> T {
    PATTERNS.with(|patterns| {
        let mut patterns = patterns.borrow_mut();
        let pattern = patterns.entry(pattern.into()).or_insert_with(|| {
            let mut compiled = COMPILED_PATTERNS.lock().unwrap_or_else(|e| e.into_inner());
            compiled
                .entry(pattern.into())
                .or_insert_with(|| regex::Regex::new(pattern).expect("internal parser pattern"))
                .clone()
        });
        read(pattern)
    })
}
pub fn capture(value: Option<&str>, pattern: &str) -> Option<String> {
    let value = value?;
    with_pattern(pattern, |p| {
        p.captures(value)?.get(1).map(|v| v.as_str().to_string())
    })
}
fn metric(value: Option<&str>, prefix: &str, standard: bool) -> Option<f64> {
    let pattern = format!(r"\(\s*{prefix}/([A-Za-z0-9_]+),\s*([-+0-9.eE]+)\s*\)");
    let value = value?;
    let entries: Vec<_> = with_pattern(&pattern, |regex| {
        regex
            .captures_iter(value)
            .filter_map(|c| Some((c[1].to_string(), c[2].parse::<f64>().ok()?)))
            .collect()
    });
    if standard && let Some((_, v)) = entries.iter().find(|(k, _)| k == "Standard") {
        return Some(*v);
    }
    entries
        .iter()
        .filter(|(k, _)| standard || k == "LowAltitude" || k == "HighAltitude")
        .map(|(_, v)| *v)
        .reduce(f64::max)
}
fn resistance(value: Option<&str>) -> Option<Resistance> {
    Some(Resistance {
        family: capture(value, r"\bFamily\s*=\s*ResistanceFamily_([A-Za-z0-9_]+)")?,
        index: capture(value, r"\bIndex\s*=\s*([0-9]+)")?.parse().ok()?,
    })
}
pub fn tokens(source: &str) -> Result<Vec<&str>> {
    let mut lexer = Lexer::new(source, 0);
    let mut result = Vec::new();
    loop {
        let token = lexer.next_token()?;
        if token.kind == TokenKind::Eof {
            break;
        }
        result.push(token.text);
    }
    Ok(result)
}

mod divisions;
mod units;
mod weapons;
pub use divisions::{divisions, infer_coalitions, matrices, rules};
pub use units::{entities, hidden, sellable};
pub use weapons::{ammunition, weapon_data};

#[test]
fn quoted_fields_and_lists_decode_ndf_escapes() {
    let fields =
        Fields::new(r#"Unit is T(Label = 'Pilot\'s \\ kit' Tags = ['air\'s', "a\\b"])"#).unwrap();
    assert_eq!(fields.string("Label").as_deref(), Some("Pilot's \\ kit"));
    assert_eq!(fields.list("Tags").unwrap(), ["air's", "a\\b"]);
    assert_eq!(fields.string("Missing"), None);
}
