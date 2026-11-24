use super::data::*;
use regex::{Regex, RegexBuilder};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};
use ymb_sdk::{Context as Host, Result, TestResult, ensure, failure};

const VARIANTS: [&str; 8] = [
    "countryBalanced",
    "countryUnlimited",
    "sideBalanced",
    "sideUnlimited",
    "allSideBalanced",
    "allSideUnlimited",
    "customBalanced",
    "customUnlimited",
];
pub const NAMING: [(&str, &str); 13] = [
    ("divisionName", "{modTag} {label} - {mode}"),
    ("deckName", "{modTag} {label} - {mode}"),
    ("countryLabel", "{country}"),
    ("sideLabel", "{coalition}"),
    ("allSideLabel", "All"),
    ("customLabel", "{name}"),
    ("unlimitedLabel", "Unlimited"),
    ("balancedLabel", "Dynamic"),
    ("staticBalancedLabel", "Static"),
    ("description", "{divisionName}"),
    ("unlimitedDescription", ""),
    ("balancedDescription", ""),
    ("staticBalancedDescription", ""),
];
const EMBLEMS: [(&str, &str); 4] = [
    ("natoUnlimited", "Texture{modTag}_Division_NATO"),
    ("natoBalanced", "Texture{modTag}_Division_NATO_Balanced"),
    ("pactUnlimited", "Texture{modTag}_Division_PACT"),
    ("pactBalanced", "Texture{modTag}_Division_PACT_Balanced"),
];
#[derive(Clone, Debug)]
pub struct Policy {
    pub mod_units: bool,
    pub mod_supply: bool,
    pub ignore_context: Option<bool>,
    pub ignored: Vec<Regex>,
}
#[derive(Clone, Debug)]
pub struct Custom {
    pub context: Context,
    pub enabled: bool,
    pub skip_if_empty: bool,
}
#[derive(Clone, Debug)]
pub struct Config {
    pub slots: usize,
    pub unlimited_count: usize,
    pub static_counts: [f64; 4],
    pub veterancy: usize,
    pub modes: Vec<Mode>,
    pub exclude_hidden: bool,
    pub minimum: usize,
    pub require_command: bool,
    pub contexts: [bool; 3],
    pub directives: [String; 3],
    pub naming: HashMap<String, String>,
    pub emblems: HashMap<String, String>,
    pub mod_countries: HashSet<String>,
    pub ignored_rules: Vec<Regex>,
    pub supply_patterns: Vec<Regex>,
    pub custom: Vec<Custom>,
    pub division_ignored_countries: HashSet<String>,
    pub division_ignored: Vec<Regex>,
    pub division_forced: [Vec<Regex>; 8],
    pub division_policies: [Policy; 8],
    pub deck_ignored_countries: HashSet<String>,
    pub deck_ignored: Vec<Regex>,
    pub deck_forced: [Vec<Regex>; 8],
    pub deck_policies: [Policy; 8],
    pub preferred: HashMap<String, Vec<String>>,
    pub transport_cost_ratio: f64,
}
type Object = Map<String, Value>;
impl Config {
    pub fn parse(raw: &Value, tag: &str) -> Result<Self> {
        let obj = object(Some(raw), "configuration")?;
        known(
            obj,
            &[
                "deckSlotCount",
                "compatibility",
                "unlimitedPackUnitCount",
                "staticPackCounts",
                "deckVeterancy",
                "modes",
                "excludeHidden",
                "minimumContextUnitCount",
                "requireCommandUnitInContext",
                "contextGeneration",
                "commentDirectives",
                "naming",
                "emblems",
                "modCountryIds",
                "ignoredDivisionRuleNamePatterns",
                "extraSupplyUnitPatterns",
                "customDivisions",
                "divisionIgnoredCountryIds",
                "divisionIgnoredUnitPatterns",
                "divisionForcedUnitPatterns",
                "divisionPolicies",
                "deckIgnoredCountryIds",
                "deckIgnoredUnitPatterns",
                "deckForcedUnitPatterns",
                "deckPolicies",
                "deckPreferredCountryIdsByCoalition",
                "deckMaxTransportCostRatio",
            ],
            "configuration",
        )?;
        let value = |key| get(obj, key);
        let contexts = object(value("contextGeneration"), "contextGeneration")?;
        known(
            contexts,
            &["countries", "coalitions", "allSides"],
            "contextGeneration",
        )?;
        let d = object(value("commentDirectives"), "commentDirectives")?;
        known(
            d,
            &["ignore", "everythingBelow", "forceInclude"],
            "commentDirectives",
        )?;
        let mut directives = Vec::new();
        for (key, suffix) in [
            ("ignore", "ignore"),
            ("everythingBelow", "ignore-everything-below"),
            ("forceInclude", "force-include"),
        ] {
            directives.push(
                text(get(d, key), key)?
                    .unwrap_or_else(|| format!("{tag}-{suffix}"))
                    .to_lowercase(),
            );
        }
        ensure(
            directives.iter().collect::<HashSet<_>>().len() == 3,
            "Deck comment directives must differ.",
            "Choose a distinct marker for each action.",
        )?;
        let mut counts = [10., 6., 3., 1.];
        if let Some(v) = value("staticPackCounts") {
            let values = v
                .as_array()
                .filter(|v| v.len() == 4)
                .ok_or_else(|| invalid("staticPackCounts"))?;
            for (i, n) in values.iter().enumerate() {
                counts[i] = numeric(Some(n), None, 0., true, false, "staticPackCounts")?
            }
            ensure(
                counts.iter().any(|n| *n > 0.),
                "Static pack counts cannot all be zero.",
                "Enable at least one veterancy rank.",
            )?;
        }
        let veterancy = numeric(
            value("deckVeterancy"),
            Some(1.),
            0.,
            true,
            false,
            "deckVeterancy",
        )? as usize;
        ensure(
            veterancy <= 3,
            "Deck veterancy must be 0 through 3.",
            "Choose a supported rank.",
        )?;
        let mut preferred = HashMap::from([
            ("NATO".into(), vec!["US".into()]),
            ("PACT".into(), vec!["SOV".into()]),
        ]);
        if let Some(p) = object(
            value("deckPreferredCountryIdsByCoalition"),
            "deckPreferredCountryIdsByCoalition",
        )? {
            for (key, v) in p {
                preferred.insert(
                    key.clone(),
                    strings(Some(v), key)?
                        .iter()
                        .map(|s| s.to_uppercase())
                        .collect(),
                );
            }
        }
        let mut custom = Vec::new();
        if let Some(raw) = value("customDivisions") {
            let entries: Vec<(Option<&str>, &Value)> = if let Some(a) = raw.as_array() {
                a.iter().map(|v| (None, v)).collect()
            } else {
                raw.as_object()
                    .ok_or_else(|| invalid("customDivisions"))?
                    .iter()
                    .map(|(k, v)| (Some(k.as_str()), v))
                    .collect()
            };
            for (key, raw) in entries {
                let c = object(Some(raw), "customDivisions")?;
                known(
                    c,
                    &[
                        "code",
                        "name",
                        "coalition",
                        "countryId",
                        "unitPatterns",
                        "tags",
                        "modes",
                        "enabled",
                        "skipIfEmpty",
                        "emblemTexture",
                        "divisionName",
                        "deckName",
                        "description",
                        "interfaceOrder",
                    ],
                    "customDivisions",
                )?;
                if let (Some(key), Some(authored)) = (key, get(c, "code")) {
                    ensure(
                        authored.as_str() == Some(key),
                        "Custom division code differs from its object key.",
                        "Use the same code.",
                    )?
                }
                let code = key
                    .map(str::to_string)
                    .or(text(get(c, "code"), "customDivisions.code")?)
                    .ok_or_else(|| invalid("customDivisions.code"))?;
                let name = text(get(c, "name"), "customDivisions.name")?
                    .ok_or_else(|| invalid("customDivisions.name"))?;
                let patterns = patterns(get(c, "unitPatterns"), "customDivisions.unitPatterns")?;
                ensure(
                    !patterns.is_empty(),
                    "Custom division has no unit patterns.",
                    "Add at least one nonempty pattern.",
                )?;
                let interface_order = get(c, "interfaceOrder")
                    .map(|v| {
                        numeric(
                            Some(v),
                            None,
                            -9_007_199_254_740_991.,
                            true,
                            false,
                            "interfaceOrder",
                        )
                    })
                    .transpose()?;
                custom.push(Custom {
                    context: Context {
                        code: sanitize(&code),
                        scope: Scope::Custom,
                        coalition: text(get(c, "coalition"), "coalition")?.unwrap_or("NATO".into()),
                        country_id: text(get(c, "countryId"), "countryId")?.unwrap_or(tag.into()),
                        name_label: Some(name),
                        division_name: text(get(c, "divisionName"), "divisionName")?,
                        deck_name: text(get(c, "deckName"), "deckName")?,
                        description: text(get(c, "description"), "description")?,
                        interface_order,
                        tags: if get(c, "tags").is_some() {
                            strings(get(c, "tags"), "tags")?
                        } else {
                            vec!["CUSTOM".into()]
                        },
                        allowed_modes: modes(get(c, "modes"))?,
                        emblem_texture: text(get(c, "emblemTexture"), "emblemTexture")?,
                        filter: Filter::Patterns(patterns),
                    },
                    enabled: boolean(get(c, "enabled"), true, "enabled")?,
                    skip_if_empty: boolean(get(c, "skipIfEmpty"), false, "skipIfEmpty")?,
                });
            }
        }
        Ok(Self {
            slots: numeric(
                value("deckSlotCount"),
                None,
                1.,
                true,
                true,
                "deckSlotCount",
            )? as usize,
            unlimited_count: numeric(
                value("unlimitedPackUnitCount"),
                None,
                1.,
                true,
                true,
                "unlimitedPackUnitCount",
            )? as usize,
            static_counts: counts,
            veterancy,
            modes: modes(value("modes"))?,
            exclude_hidden: boolean(value("excludeHidden"), false, "excludeHidden")?,
            minimum: numeric(
                value("minimumContextUnitCount"),
                Some(3.),
                0.,
                true,
                false,
                "minimumContextUnitCount",
            )? as usize,
            require_command: boolean(
                value("requireCommandUnitInContext"),
                true,
                "requireCommandUnitInContext",
            )?,
            contexts: [
                boolean(get(contexts, "countries"), true, "countries")?,
                boolean(get(contexts, "coalitions"), true, "coalitions")?,
                boolean(get(contexts, "allSides"), true, "allSides")?,
            ],
            directives: directives.try_into().unwrap(),
            naming: templates(value("naming"), &NAMING, "naming")?,
            emblems: templates(value("emblems"), &EMBLEMS, "emblems")?,
            mod_countries: country_set(value("modCountryIds"), &[tag], "modCountryIds")?,
            ignored_rules: patterns(
                value("ignoredDivisionRuleNamePatterns"),
                "ignoredDivisionRuleNamePatterns",
            )?,
            supply_patterns: patterns(value("extraSupplyUnitPatterns"), "extraSupplyUnitPatterns")?,
            custom,
            division_ignored_countries: country_set(
                value("divisionIgnoredCountryIds"),
                &[],
                "divisionIgnoredCountryIds",
            )?,
            division_ignored: patterns(
                value("divisionIgnoredUnitPatterns"),
                "divisionIgnoredUnitPatterns",
            )?,
            division_forced: forced(value("divisionForcedUnitPatterns"))?,
            division_policies: policies(value("divisionPolicies"), false)?,
            deck_ignored_countries: country_set(
                value("deckIgnoredCountryIds"),
                &[],
                "deckIgnoredCountryIds",
            )?,
            deck_ignored: patterns(value("deckIgnoredUnitPatterns"), "deckIgnoredUnitPatterns")?,
            deck_forced: forced(value("deckForcedUnitPatterns"))?,
            deck_policies: policies(value("deckPolicies"), true)?,
            preferred,
            transport_cost_ratio: numeric(
                value("deckMaxTransportCostRatio"),
                Some(2.),
                0.,
                false,
                false,
                "deckMaxTransportCostRatio",
            )?,
        })
    }
    pub fn variant(scope: Scope, mode: Mode) -> usize {
        (match scope {
            Scope::Country => 0,
            Scope::Side => 2,
            Scope::AllSide => 4,
            Scope::Custom => 6,
        }) + usize::from(mode == Mode::Unlimited)
    }
    pub fn is_mod(&self, e: &Entity) -> bool {
        e.country
            .as_ref()
            .is_some_and(|c| self.mod_countries.contains(&c.trim().to_uppercase()))
    }
    pub fn country_context(&self, c: &str) -> bool {
        let c = c.trim().to_uppercase();
        !c.is_empty()
            && !self.mod_countries.contains(&c)
            && !self.division_ignored_countries.contains(&c)
            && !self.deck_ignored_countries.contains(&c)
    }
    pub fn forced(&self, e: &Entity, c: &Context, m: Mode) -> bool {
        matches(&self.deck_forced[Self::variant(c.scope, m)], &e.name)
    }
    pub fn includes(&self, e: &Entity, c: &Context, m: Mode, deck: bool) -> bool {
        let Some(country) = e.country.as_ref().filter(|s| !s.is_empty()) else {
            return false;
        };
        let v = Self::variant(c.scope, m);
        if matches(&self.deck_forced[v], &e.name)
            || (!deck && matches(&self.division_forced[v], &e.name))
        {
            return true;
        }
        let country = country.trim().to_uppercase();
        if self.division_ignored_countries.contains(&country)
            || matches(&self.division_ignored, &e.name)
            || matches(&self.division_policies[v].ignored, &e.name)
        {
            return false;
        }
        if deck
            && (self.deck_ignored_countries.contains(&country)
                || matches(&self.deck_ignored, &e.name)
                || matches(&self.deck_policies[v].ignored, &e.name))
        {
            return false;
        }
        if self.mod_countries.contains(&country) {
            let p = if deck {
                &self.deck_policies[v]
            } else {
                &self.division_policies[v]
            };
            return (p.mod_units
                || (p.mod_supply
                    && (e.has_supply_module || matches(&self.supply_patterns, &e.name))))
                && (p.ignore_context.unwrap_or(c.scope != Scope::Custom) || c.matches(e));
        }
        c.matches(e)
    }
    pub fn country_rank(&self, e: &Entity, coalition: &str) -> usize {
        let Some(pref) = self.preferred.get(coalition) else {
            return 0;
        };
        let Some(country) = &e.country else {
            return pref.len() + 1;
        };
        pref.iter()
            .position(|s| *s == country.trim().to_uppercase())
            .unwrap_or(pref.len())
    }
}
pub fn check() -> Result<()> {
    let base = serde_json::json!({"deckSlotCount":12,"unlimitedPackUnitCount":999});
    let c = Config::parse(&base, "YSM")?;
    assert_eq!(c.static_counts, [10., 6., 3., 1.]);
    assert_eq!(c.modes.len(), 3);
    for bad in [
        serde_json::json!({"deckVeterancy":null}),
        serde_json::json!({"modes":[]}),
        serde_json::json!({"modes":["invented"]}),
        serde_json::json!({"contextGeneration":{"country":true}}),
        serde_json::json!({"deckPolicies":{"countryBalanced":{"includeModUnits":null}}}),
        serde_json::json!({"staticPackCounts":[0,0,0,0]}),
        serde_json::json!({"minimumContextUnitCount":1.5}),
        serde_json::json!({"customDivisions":{"A":{"code":"B","name":"X","unitPatterns":["x"]}}}),
    ] {
        let mut v = base.clone();
        for (k, x) in bad.as_object().unwrap() {
            v[k] = x.clone()
        }
        assert!(Config::parse(&v, "YSM").is_err(), "{v}");
    }
    Ok(())
}
pub fn checks(_: &mut Host) -> Result<Vec<TestResult>> {
    check()?;
    Ok(vec![TestResult::passed(
        "Deck configuration, defaults and invalid values",
    )])
}

mod values;
pub use values::patterns;
use values::*;
