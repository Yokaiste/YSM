use super::{config::Config, data::*};
use std::collections::{HashMap, HashSet};
use ymb_sdk::{Result, ensure};
fn context(
    code: String,
    scope: Scope,
    coalition: String,
    country_id: String,
    filter: Filter,
) -> Context {
    Context {
        code,
        scope,
        coalition,
        country_id,
        name_label: None,
        division_name: None,
        deck_name: None,
        description: None,
        interface_order: None,
        tags: Vec::new(),
        allowed_modes: Vec::new(),
        emblem_texture: None,
        filter,
    }
}
pub fn build(
    entities: &[Entity],
    pool: &[EntityId],
    tag: &str,
    config: &Config,
) -> Result<Vec<Context>> {
    let mut countries = HashMap::new();
    let mut coalitions = HashSet::new();
    for id in pool {
        let e = &entities[*id];
        let (Some(country), Some(coalition)) = (&e.country, &e.coalition) else {
            continue;
        };
        coalitions.insert(coalition.clone());
        if config.contexts[0] && config.country_context(country) {
            countries.entry(country.clone()).or_insert_with(|| {
                context(
                    format!("COUNTRY_{}", sanitize(country)),
                    Scope::Country,
                    coalition.clone(),
                    country.clone(),
                    Filter::Country(country.clone()),
                )
            });
        }
    }
    let mut result: Vec<_> = countries.into_values().collect();
    result.sort_by(|a, b| name_cmp(&a.country_id, &b.country_id));
    let mut coalitions: Vec<_> = coalitions.into_iter().collect();
    coalitions.sort_by(|a, b| name_cmp(a, b));
    if config.contexts[1] {
        for c in &coalitions {
            result.push(context(
                format!("SIDE_{c}"),
                Scope::Side,
                c.clone(),
                tag.into(),
                Filter::Coalition(c.clone()),
            ))
        }
    }
    if config.contexts[2] {
        for c in &coalitions {
            let code = match c.to_uppercase().as_str() {
                "NATO" => "ALL_BLUE".into(),
                "PACT" => "ALL_RED".into(),
                _ => format!("ALL_{}", sanitize(c)),
            };
            result.push(context(
                code,
                Scope::AllSide,
                c.clone(),
                tag.into(),
                Filter::All,
            ));
        }
    }
    for c in &config.custom {
        if !c.enabled
            || (c.skip_if_empty && !pool.iter().any(|id| c.context.matches(&entities[*id])))
        {
            continue;
        }
        result.push(c.context.clone());
    }
    let mut seen = HashSet::new();
    for c in &result {
        ensure(
            !c.code.is_empty() && seen.insert(&c.code),
            format!("Division context code {} is empty or duplicated.", c.code),
            "Choose distinct country, coalition and custom division identifiers.",
        )?
    }
    Ok(result)
}
fn substitutions(
    context: &Context,
    mode: Mode,
    tag: &str,
    config: &Config,
) -> Vec<(&'static str, String)> {
    let mode = match mode {
        Mode::Unlimited => "unlimitedLabel",
        Mode::Balanced => "balancedLabel",
        Mode::StaticBalanced => "staticBalancedLabel",
    };
    let mut values = vec![
        ("{modTag}", tag.into()),
        ("{mode}", config.naming[mode].clone()),
        ("{coalition}", context.coalition.clone()),
        ("{country}", context.country_id.clone()),
        ("{code}", context.code.clone()),
    ];
    let name = replace(
        context.name_label.as_deref().unwrap_or(&context.code),
        &values,
    );
    values.push(("{name}", name));
    values
}
fn replace(text: &str, substitutions: &[(&str, String)]) -> String {
    let mut text = text.to_string();
    for (key, value) in substitutions {
        text = text.replace(key, value)
    }
    text
}
pub fn template(text: &str, c: &Context, m: Mode, tag: &str, config: &Config) -> Result<String> {
    let s = substitutions(c, m, tag, config);
    let label = match c.scope {
        Scope::Country => "countryLabel",
        Scope::Side => "sideLabel",
        Scope::AllSide => "allSideLabel",
        Scope::Custom => "customLabel",
    };
    let text = text.replace("{label}", &replace(&config.naming[label], &s));
    let text = replace(&text, &s)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let unresolved = regex::Regex::new(r"\{[A-Za-z_][A-Za-z0-9_]*\}").unwrap();
    ensure(
        !unresolved.is_match(&text),
        format!("Unknown division text placeholder in {text:?}."),
        "Check deckGeneration.naming and custom division text.",
    )?;
    Ok(text)
}
pub fn division_name(c: &Context, m: Mode, tag: &str, config: &Config) -> Result<String> {
    template(
        c.division_name
            .as_deref()
            .unwrap_or(&config.naming["divisionName"]),
        c,
        m,
        tag,
        config,
    )
}
pub fn deck_name(c: &Context, m: Mode, tag: &str, config: &Config) -> Result<String> {
    template(
        c.deck_name.as_deref().unwrap_or(&config.naming["deckName"]),
        c,
        m,
        tag,
        config,
    )
}
pub fn summary(c: &Context, m: Mode, tag: &str, config: &Config) -> Result<String> {
    let key = match m {
        Mode::Unlimited => "unlimitedDescription",
        Mode::Balanced => "balancedDescription",
        Mode::StaticBalanced => "staticBalancedDescription",
    };
    let text = c.description.as_deref().unwrap_or_else(|| {
        if config.naming[key].is_empty() {
            &config.naming["description"]
        } else {
            &config.naming[key]
        }
    });
    template(
        &text.replace("{divisionName}", &division_name(c, m, tag, config)?),
        c,
        m,
        tag,
        config,
    )
}
pub fn emblem(c: &Context, m: Mode, tag: &str, config: &Config) -> Result<String> {
    let key = match (
        c.coalition.eq_ignore_ascii_case("PACT"),
        m == Mode::Unlimited,
    ) {
        (true, true) => "pactUnlimited",
        (true, false) => "pactBalanced",
        (false, true) => "natoUnlimited",
        (false, false) => "natoBalanced",
    };
    template(
        c.emblem_texture.as_deref().unwrap_or(&config.emblems[key]),
        c,
        m,
        tag,
        config,
    )
}
pub fn tags(c: &Context, tag: &str) -> Vec<String> {
    let mut tags = vec!["DEFAULT".into(), tag.into(), c.coalition.clone()];
    match c.scope {
        Scope::Custom => tags.extend(c.tags.clone()),
        Scope::Country => tags.push(c.country_id.clone()),
        Scope::Side => tags.push(format!("{}_ONLY", c.coalition)),
        Scope::AllSide => tags.push("ALL_UNITS".into()),
    }
    tags.push("SANDBOX".into());
    tags
}
pub fn viable(pool: &[EntityId], entities: &[Entity], config: &Config) -> bool {
    pool.len() >= config.minimum
        && (!config.require_command || pool.iter().any(|id| command(&entities[*id])))
}
