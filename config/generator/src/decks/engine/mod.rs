use super::{
    analysis::Factory,
    combat,
    config::Config,
    contexts,
    data::*,
    parse, premade, render, rules, serializer,
    store::{self, Store},
};
use crate::localisation::{self, Localisation};
use indexmap::IndexMap;
use std::{
    collections::{HashMap, HashSet, hash_map::DefaultHasher},
    hash::{Hash, Hasher},
    sync::Arc,
};
use ymb_sdk::{Context as Host, GeneratedFile, Result, ensure, generated, ndf};
pub fn generate(ctx: &mut Host) -> Result<Vec<GeneratedFile>> {
    let tag: String = ctx.value("modTag")?;
    let generation = ctx
        .variables
        .get("deckGeneration")
        .cloned()
        .ok_or_else(|| {
            ymb_sdk::failure(
                "deckGeneration settings are missing.",
                "Enable the deck-generation patch.",
            )
        })?;
    let configs = [
        Config::parse(&generation, &tag)?,
        Config::parse(&crate::zombies::deck_config(&generation, &tag), &tag)?,
    ];
    let source_id = ctx.generator_id().to_owned();
    let paths: Vec<_> = INPUTS.iter().map(|(_, path)| *path).collect();
    let mut files = ctx.read_targets_with_hashes(&paths)?;
    let plan_seed = if ctx.cache_enabled() {
        let hashes: Vec<_> = INPUTS
            .iter()
            .map(|(key, path)| (*key, files[*path].1.as_str()))
            .collect();
        Some(ctx.cache_key(&(&ctx.variables, hashes))?)
    } else {
        None
    };
    let mut raw: HashMap<&str, String> = INPUTS
        .iter()
        .map(|(key, path)| {
            (
                *key,
                files
                    .remove(*path)
                    .map(|(text, _)| text)
                    .unwrap_or_default(),
            )
        })
        .collect();
    let csv = localisation::target(ctx, "UNITS")?;
    let original_names = ctx.read_target(&csv)?;
    ensure(
        original_names.is_empty() || original_names.contains(';'),
        "UNITS.csv is not a semicolon-separated dictionary.",
        "Run the localisation initializer before deck generation.",
    )?;
    let mut names = Localisation::parse(&original_names);
    let store_paths = inputs::store_paths(&generation)?;
    let mut stores = Vec::new();
    for path in &store_paths {
        stores.push(Store::parse(&ctx.read_persistent_text(path)?)?)
    }
    store::validate_stores(&stores)?;
    let mut registry = serializer::Registry::new(&stores)?;
    let source_rules = generated::strip(&raw["rules"])?;
    let source_divisions = generated::strip(&raw["divisions"])?;
    let cached = match &plan_seed {
        Some(key) => ctx.cache_read::<super::cache::Inputs>("deck-inputs", key)?,
        None => None,
    };
    let uncached = cached.is_none();
    let parsed = match cached {
        Some(parsed) => parsed,
        None => inputs::parse_inputs(&mut raw, &configs, &source_rules, &source_divisions)?,
    };
    parsed.validate()?;
    for warning in &parsed.warnings {
        ctx.warning(warning)?;
    }
    if uncached && let Some(key) = &plan_seed {
        ctx.cache_write("deck-inputs", key, &parsed)?;
    }
    raw.retain(|key, _| OUTPUT_KEYS.contains(key));
    let super::cache::Inputs {
        entities,
        weapons,
        ammo,
        passes,
        ..
    } = parsed;
    let transports = rules::legal_transports(&entities);
    let factory = Factory::new(&entities, &weapons, &ammo);
    let mut required = HashSet::new();
    let mut rule_passes = Vec::new();
    for (pass, (config, prepared)) in configs.iter().zip(passes).enumerate() {
        store::reserve(&mut stores);
        let super::cache::Pass { eligible, balanced } = prepared;
        let mut packs = IndexMap::new();
        let plan_key = plan_seed
            .as_ref()
            .map(|seed| ctx.cache_key(&(seed, pass)))
            .transpose()?;
        let cached = if let Some(key) = &plan_key {
            ctx.cache_read("decks", key)?
        } else {
            None
        };
        let (divisions, cache_changed) = variants(
            &eligible,
            &factory,
            &balanced,
            &transports,
            config,
            &tag,
            &mut stores[pass],
            &mut names,
            &mut packs,
            cached,
        )?;
        let referenced: HashSet<_> = divisions
            .iter()
            .flat_map(|d| d.cards.iter().map(|c| c.pack.as_str()))
            .collect();
        packs.retain(|name, _| referenced.contains(name.as_str()));
        integrity(&divisions, &packs, &entities, config)?;
        if let Some(key) = &plan_key
            && cache_changed
        {
            ctx.cache_write(
                "decks",
                key,
                &super::cache::Plan::capture(&divisions, &packs),
            )?;
        }
        for d in &divisions {
            required.extend([
                d.metadata.division_name_token.clone(),
                d.metadata.deck_name_token.clone(),
                d.summary.clone(),
            ]);
        }
        let unit_names = unique(
            divisions
                .iter()
                .flat_map(|d| d.entries.iter())
                .flat_map(|r| std::iter::once(r.entity).chain(r.transports.iter().copied()))
                .chain(
                    packs
                        .values()
                        .flat_map(|p| std::iter::once(p.unit).chain(p.transport)),
                )
                .map(|id| entities[id].name.clone()),
        );
        let points = config.slots
            * eligible
                .iter()
                .filter_map(|id| entities[*id].factory_type.as_deref())
                .collect::<HashSet<_>>()
                .len()
                .max(CATEGORIES.len());
        let owner = OWNERS[pass];
        rule_passes.push(render::RulesPass::new(owner, &divisions));
        let output = render::divisions(
            &raw["divisions"],
            &divisions,
            points,
            &entities,
            &tag,
            owner,
            &source_id,
        )?;
        raw.insert("divisions", output);
        let output = serializer::render(
            &raw["serializer"],
            &divisions,
            unit_names,
            owner,
            &source_id,
            &mut stores[pass].serializer,
            &mut registry,
        )?;
        raw.insert("serializer", output);
        let output = render::packs(
            &raw["packs"],
            &packs.values().collect::<Vec<_>>(),
            &entities,
            owner,
            &source_id,
        )?;
        raw.insert("packs", output);
        let output = render::decks(&raw["decks"], &divisions, owner, &source_id)?;
        raw.insert("decks", output);
        ensure(
            raw["divisions"].contains(&format!("Descriptor_Deck_Division_{}_", sanitize(&tag))),
            "Deck generation produced no divisions.",
            "Enable a viable country, coalition or custom division.",
        )?;
    }
    store::reserve(&mut stores);
    let names = names.render();
    store::validate_names(&names, &stores, Some(&required))?;
    for (path, store) in store_paths.iter().zip(&stores) {
        ctx.write_persistent_text(path, &store.render()?)?;
    }
    let mut outputs = Vec::new();
    for key in OUTPUT_KEYS {
        let path = INPUTS.iter().find(|(name, _)| *name == key).unwrap().1;
        if key == "rules" {
            let rules = raw.remove(key).unwrap();
            let mut output = ctx.output_stream(path, ymb_sdk::ContentKind::Text, |writer| {
                render::rules_stream(writer, &rules, &rule_passes, &entities, &source_id)
            })?;
            output.generated_block_owners = vec![source_id.clone()];
            outputs.push(output);
        } else {
            outputs.push(ctx.output_generated(path, raw.remove(key).unwrap())?);
        }
    }
    outputs.push(ctx.output_text(&csv, names)?);
    Ok(outputs)
}

mod checks;
mod inputs;
mod variants;
pub use checks::integrity;
use inputs::{INPUTS, OUTPUT_KEYS, OWNERS};
use variants::variants;
