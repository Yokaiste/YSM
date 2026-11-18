use crate::localisation::Localisation;
use indexmap::IndexMap;
use regex::Regex;
use serde::Serialize;
use serde_json::Value;
use std::{collections::HashSet, sync::LazyLock};
use ymb_sdk::{Context, Result, TestResult, ensure};

pub const DIVISION_LAST: u32 = (1 << 11) - 1;
pub const UNIT_LAST: u32 = (1 << 14) - 1;
const TOKEN_LAST: u32 = 99_999_999;
static GUID: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")
        .unwrap()
});

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    pub guid: String,
    pub division_name_token: String,
    pub deck_name_token: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Serializer {
    pub next_division_id: u32,
    pub next_unit_id: u32,
    pub division_ids: IndexMap<String, u32>,
    pub unit_ids: IndexMap<String, u32>,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Store {
    version: u32,
    pub next_division_name_token: u32,
    pub next_deck_name_token: u32,
    pub divisions: IndexMap<String, Metadata>,
    pub serializer: Serializer,
}

fn integer(value: &Value, label: &str, first: u32, last: u32) -> Result<u32> {
    value
        .as_f64()
        .filter(|value| {
            value.is_finite()
                && value.fract() == 0.0
                && *value >= f64::from(first)
                && *value <= f64::from(last)
        })
        .map(|value| value as u32)
        .ok_or_else(|| {
            ymb_sdk::failure(
                format!("{label} must be an integer from {first} through {last}."),
                "Restore the identity store from a trusted backup.",
            )
        })
}

fn string(value: &Value, label: &str) -> Result<String> {
    value
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .ok_or_else(|| {
            ymb_sdk::failure(
                format!("{label} must be nonempty text."),
                "Restore the saved identity; do not allocate a replacement.",
            )
        })
}

fn token_number(token: &str, prefix: &str) -> Result<u32> {
    let suffix = token
        .strip_prefix(prefix)
        .filter(|suffix| suffix.len() == 8 && suffix.bytes().all(|byte| byte.is_ascii_digit()));
    suffix
        .and_then(|suffix| suffix.parse().ok())
        .ok_or_else(|| {
            ymb_sdk::failure(
                format!("Invalid identity token {token:?}."),
                "Keep the token prefix and eight decimal digits.",
            )
        })
}

fn id_map(value: &Value, label: &str, first: u32, last: u32) -> Result<IndexMap<String, u32>> {
    let object = ymb_sdk::values::record(value, label)?;
    let mut result = IndexMap::new();
    let mut used = HashSet::new();
    for (name, value) in object {
        ensure(
            !name.is_empty()
                && name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_'),
            format!("Invalid descriptor name in {label}: {name:?}."),
            "Restore the saved descriptor name.",
        )?;
        let id = integer(value, &format!("{label}.{name}"), first, last)?;
        ensure(
            used.insert(id),
            format!("Duplicate ID {id} in {label}."),
            "Restore the identity store; do not renumber saved IDs.",
        )?;
        result.insert(name.clone(), id);
    }
    Ok(result)
}

impl Default for Store {
    fn default() -> Self {
        Self {
            version: 2,
            next_division_name_token: 1,
            next_deck_name_token: 1,
            divisions: IndexMap::new(),
            serializer: Serializer {
                next_division_id: 0,
                next_unit_id: 0,
                division_ids: IndexMap::new(),
                unit_ids: IndexMap::new(),
            },
        }
    }
}

impl Store {
    pub fn parse(source: &str) -> Result<Self> {
        if source.trim().is_empty() {
            return Ok(Self::default());
        }
        let value: Value = serde_json::from_str(source).map_err(|error| {
            ymb_sdk::failure(
                format!("Damaged deck identity store: {error}."),
                "Restore a known-good copy from Git or backup.",
            )
        })?;
        ymb_sdk::values::record(&value, "identity store")?;
        ensure(
            value["version"].as_f64() == Some(2.0),
            "Unsupported deck identity store version.",
            "Restore the version 2 store and retain all saved IDs and tokens.",
        )?;
        let next_division_name_token = integer(
            &value["nextDivisionNameToken"],
            "nextDivisionNameToken",
            1,
            TOKEN_LAST + 1,
        )?;
        let next_deck_name_token = integer(
            &value["nextDeckNameToken"],
            "nextDeckNameToken",
            1,
            TOKEN_LAST + 1,
        )?;
        let mut divisions = IndexMap::new();
        let mut guids = HashSet::new();
        let mut division_tokens = HashSet::new();
        let mut deck_tokens = HashSet::new();
        let mut max_division_token = 0;
        let mut max_deck_token = 0;
        for (key, raw) in ymb_sdk::values::record(&value["divisions"], "divisions")? {
            let metadata = Metadata {
                guid: string(&raw["guid"], "guid")?,
                division_name_token: string(&raw["divisionNameToken"], "divisionNameToken")?,
                deck_name_token: string(&raw["deckNameToken"], "deckNameToken")?,
            };
            ensure(
                GUID.is_match(&metadata.guid),
                format!("Division {key:?} has an invalid GUID."),
                "Restore its saved version 1-5 RFC GUID.",
            )?;
            let division_number = token_number(&metadata.division_name_token, "YD")?;
            let deck_number = token_number(&metadata.deck_name_token, "YK")?;
            ensure(
                guids.insert(metadata.guid.to_ascii_lowercase())
                    && division_tokens.insert(metadata.division_name_token.clone())
                    && deck_tokens.insert(metadata.deck_name_token.clone()),
                format!("Duplicate persistent identity for {key:?}."),
                "Restore the store; do not regenerate saved identities.",
            )?;
            max_division_token = max_division_token.max(division_number);
            max_deck_token = max_deck_token.max(deck_number);
            divisions.insert(key.clone(), metadata);
        }
        ensure(
            next_division_name_token > max_division_token && next_deck_name_token > max_deck_token,
            "Next-token counters overlap saved tokens.",
            "Restore counters greater than every stored token number.",
        )?;
        let raw = &value["serializer"];
        ymb_sdk::values::record(raw, "serializer")?;
        let next_division_id = integer(
            &raw["nextDivisionId"],
            "serializer.nextDivisionId",
            0,
            DIVISION_LAST + 1,
        )?;
        let next_unit_id = integer(
            &raw["nextUnitId"],
            "serializer.nextUnitId",
            0,
            UNIT_LAST + 1,
        )?;
        let division_ids = id_map(
            &raw["divisionIds"],
            "serializer.divisionIds",
            0,
            DIVISION_LAST,
        )?;
        let unit_ids = id_map(&raw["unitIds"], "serializer.unitIds", 0, UNIT_LAST)?;
        ensure(
            division_ids.values().all(|id| *id < next_division_id)
                && unit_ids.values().all(|id| *id < next_unit_id),
            "Serializer counters overlap saved IDs.",
            "Restore counters greater than every stored ID.",
        )?;
        Ok(Self {
            version: 2,
            next_division_name_token,
            next_deck_name_token,
            divisions,
            serializer: Serializer {
                next_division_id,
                next_unit_id,
                division_ids,
                unit_ids,
            },
        })
    }

    pub fn render(&self) -> Result<String> {
        serde_json::to_string_pretty(self)
            .map(|value| value + "\n")
            .map_err(|error| {
                ymb_sdk::failure(error.to_string(), "Keep the identity store serializable.")
            })
    }

    pub fn metadata(
        &mut self,
        names: &mut Localisation,
        key: &str,
        division: &str,
        deck: &str,
    ) -> Result<Metadata> {
        let metadata = if let Some(metadata) = self.divisions.get(key) {
            metadata.clone()
        } else {
            let metadata = Metadata {
                guid: uuid::Uuid::new_v4().to_string(),
                division_name_token: allocate_token(
                    names,
                    &mut self.next_division_name_token,
                    "YD",
                )?,
                deck_name_token: allocate_token(names, &mut self.next_deck_name_token, "YK")?,
            };
            self.divisions.insert(key.into(), metadata.clone());
            metadata
        };
        names.upsert(&metadata.division_name_token, division);
        names.upsert(&metadata.deck_name_token, deck);
        Ok(metadata)
    }

    pub fn tokens(&self) -> impl Iterator<Item = String> + '_ {
        self.divisions.values().flat_map(|metadata| {
            [
                metadata.division_name_token.clone(),
                metadata.deck_name_token.clone(),
                summary_token(&metadata.division_name_token),
            ]
        })
    }
}

fn allocate_token(names: &Localisation, next: &mut u32, prefix: &str) -> Result<String> {
    loop {
        ensure(
            *next <= TOKEN_LAST,
            format!("No {prefix} identity tokens remain."),
            "Keep the identity store and report the exhausted range.",
        )?;
        let token = format!("{prefix}{:08}", *next);
        *next += 1;
        if !names.contains(&token) {
            return Ok(token);
        }
    }
}

pub fn summary_token(division_name_token: &str) -> String {
    format!("YT{}", &division_name_token[2..])
}

pub fn validate_stores(stores: &[Store]) -> Result<()> {
    let mut names = HashSet::new();
    let mut guids = HashSet::new();
    let mut tokens = HashSet::new();
    for store in stores {
        for (name, identity) in &store.divisions {
            ensure(
                names.insert(name)
                    && guids.insert(identity.guid.to_ascii_lowercase())
                    && tokens.insert(&identity.division_name_token)
                    && tokens.insert(&identity.deck_name_token),
                format!("Identity {name} is duplicated across deck stores."),
                "Restore both identity stores from a consistent backup.",
            )?;
        }
    }
    Ok(())
}
pub fn reserve(stores: &mut [Store]) {
    let division_token = stores
        .iter()
        .map(|store| store.next_division_name_token)
        .max()
        .unwrap_or(1);
    let deck_token = stores
        .iter()
        .map(|store| store.next_deck_name_token)
        .max()
        .unwrap_or(1);
    let division_id = stores
        .iter()
        .map(|store| store.serializer.next_division_id)
        .max()
        .unwrap_or(0);
    let unit_id = stores
        .iter()
        .map(|store| store.serializer.next_unit_id)
        .max()
        .unwrap_or(0);
    for store in stores {
        store.next_division_name_token = division_token;
        store.next_deck_name_token = deck_token;
        store.serializer.next_division_id = division_id;
        store.serializer.next_unit_id = unit_id;
    }
}

fn generated_token(token: &str) -> bool {
    token.len() == 10
        && ["YD", "YK", "YT", "YH"]
            .iter()
            .any(|prefix| token.starts_with(prefix))
        && token.as_bytes()[2..].iter().all(u8::is_ascii_digit)
}

pub fn validate_names(
    content: &str,
    stores: &[Store],
    required: Option<&HashSet<String>>,
) -> Result<()> {
    let expected: HashSet<_> = stores.iter().flat_map(Store::tokens).collect();
    let state = Localisation::parse(content);
    let actual: HashSet<_> = state.tokens().map(str::to_owned).collect();
    let needed = required.unwrap_or(&expected);
    let mut missing: Vec<_> = needed.difference(&actual).cloned().collect();
    let mut unclaimed: Vec<_> = actual
        .iter()
        .filter(|token| generated_token(token) && !expected.contains(*token))
        .cloned()
        .collect();
    missing.sort();
    unclaimed.sort();
    ensure(
        missing.is_empty() && unclaimed.is_empty(),
        format!(
            "Deck names disagree with identity stores. Missing: {}; unclaimed: {}.",
            missing.join(", "),
            unclaimed.join(", ")
        ),
        "Keep both stores and restore the missing localisation or identities.",
    )
}

fn check() -> Result<()> {
    let mut store = Store::default();
    let mut names = Localisation::parse("\"MANUAL\";\"Keep this row\"\n");
    let identity = store.metadata(&mut names, "fixture", "First division", "First deck")?;
    names.upsert(&summary_token(&identity.division_name_token), "Summary");
    let saved = store.render()?;
    ensure(
        validate_stores(&[store.clone(), store.clone()]).is_err(),
        "Cross-store duplicate identities were accepted.",
        "Keep GUIDs and localisation tokens unique across both stores.",
    )?;
    validate_names(&names.render(), &[store.clone()], None)?;
    let mut reloaded = Store::parse(&saved)?;
    ensure(
        reloaded.metadata(&mut names, "fixture", "Renamed division", "Renamed deck")? == identity
            && reloaded.render()? == saved
            && names.render().contains("Keep this row"),
        "Renaming changed persistent identities.",
        "Update text without allocating new IDs.",
    )?;
    let required = HashSet::from([identity.division_name_token.clone()]);
    ensure(
        validate_names("", &[store.clone()], Some(&required)).is_err()
            && validate_names("", &[store.clone()], Some(&HashSet::new())).is_ok()
            && validate_names(&names.render(), &[], None).is_err(),
        "Disabled-division or unclaimed-token validation changed.",
        "Retain inactive identities without requiring obsolete text.",
    )?;
    for invalid in ["{broken", "{}"] {
        ensure(
            Store::parse(invalid).is_err(),
            "Damaged store accepted.",
            "Validate the persistent format.",
        )?;
    }
    let mut damaged = serde_json::to_value(&store).unwrap();
    damaged["nextDivisionNameToken"] = serde_json::json!(1);
    ensure(
        Store::parse(&damaged.to_string()).is_err(),
        "Overlapping token counter accepted.",
        "Keep counters ahead of saved tokens.",
    )?;
    damaged = serde_json::to_value(&store).unwrap();
    damaged["serializer"]["unitIds"] = serde_json::json!({"One":16000,"Two":16000});
    damaged["serializer"]["nextUnitId"] = serde_json::json!(16001);
    ensure(
        Store::parse(&damaged.to_string()).is_err(),
        "Duplicate serializer IDs accepted.",
        "Preserve unique saved IDs.",
    )?;
    let mut exhausted = Store {
        next_division_name_token: TOKEN_LAST + 1,
        ..Store::default()
    };
    ensure(
        exhausted
            .metadata(&mut names, "new", "Division", "Deck")
            .is_err(),
        "Exhausted token counter was reused.",
        "Fail before replacing a saved identity.",
    )?;
    let mut colliding = Localisation::parse("\"YD00000001\";\"Another project\"\n");
    let mut fresh = Store::default();
    let allocated = fresh.metadata(&mut colliding, "new", "Division", "Deck")?;
    ensure(
        allocated.division_name_token == "YD00000002",
        "Allocated token replaced existing localisation.",
        "Skip tokens already present in the shared dictionary.",
    )?;
    let mut stores = [store, Store::default()];
    reserve(&mut stores);
    let second = stores[1].metadata(&mut names, "horde", "Horde", "Horde deck")?;
    ensure(
        second.division_name_token != identity.division_name_token
            && second.deck_name_token != identity.deck_name_token,
        "Batch stores allocated overlapping tokens.",
        "Reserve counters across every store before each pass.",
    )?;
    Ok(())
}

pub fn checks(_: &mut Context) -> Result<Vec<TestResult>> {
    check()?;
    Ok(vec![TestResult::passed(
        "Stable deck identities, names, counters, corruption checks, and batch reservation",
    )])
}

#[test]
fn persistent_identity_contract() {
    check().unwrap();
}
