use super::{
    analysis, config::Config, contexts, data::*, engine, parse, premade, render, rules, serializer,
    store,
};
use crate::localisation::Localisation;
use std::{collections::HashMap, sync::Arc};
use ymb_sdk::{Context as Host, Result, TestResult, ensure, ndf};
fn fixture() -> Result<(Vec<Entity>, Vec<RuleEntry>, Config, Context)> {
    let config = Config::parse(
        &serde_json::json!({"deckSlotCount":3,"unlimitedPackUnitCount":10}),
        "TEST",
    )?;
    let mut entities = Vec::new();
    for (name, role, cost, health, speed) in [
        ("Command", "command", 70., 10., 30.),
        ("Infantry", "infantry", 30., 20., 20.),
        ("Carrier", "transport", 20., 5., 55.),
    ] {
        entities.push(Entity {
            name: format!("Descriptor_Unit_{name}"),
            country: Some("US".into()),
            coalition: Some("NATO".into()),
            factory_type: Some("Infantry".into()),
            unit_role: Some(role.into()),
            cost,
            max_physical_damages: Some(health),
            max_speed_kmph: Some(speed),
            ..Entity::default()
        });
    }
    entities[1].tags = vec!["infantry".into()];
    entities[1].is_transportable = true;
    entities[1].pathfind_type = Some("Infantry".into());
    entities[2].transportable_tags = vec!["infantry".into()];
    entities[2].pathfind_type = Some("Wheels".into());
    entities[2].is_sellable = true;
    let entries = (0..3)
        .map(|id| RuleEntry {
            entity: id,
            rule: Rule {
                unit_name: entities[id].name.clone(),
                max_pack_number: 3,
                ..Rule::fallback()
            },
            transports: if id == 1 { vec![2] } else { Vec::new() },
        })
        .collect();
    let context = Context {
        code: "ALL_BLUE".into(),
        scope: Scope::AllSide,
        coalition: "NATO".into(),
        country_id: "TEST".into(),
        name_label: None,
        division_name: None,
        deck_name: None,
        description: None,
        interface_order: None,
        tags: Vec::new(),
        allowed_modes: Vec::new(),
        emblem_texture: None,
        filter: Filter::All,
    };
    Ok((entities, entries, config, context))
}
fn roster_check() -> Result<()> {
    let (entities, _, config, mut context) = fixture()?;
    ensure(
        contexts::viable(&[0, 1, 2], &entities, &config)
            && !contexts::viable(&[1, 2], &entities, &config),
        "Roster viability changed.",
        "Keep minimum size and command requirements independent.",
    )?;
    context.scope = Scope::Country;
    context.country_id = "US".into();
    context.filter = Filter::Country("US".into());
    let mut raw = serde_json::json!({"deckSlotCount":3,"unlimitedPackUnitCount":10,"divisionIgnoredCountryIds":["US"],"deckForcedUnitPatterns":{"countryUnlimited":["^Descriptor_Unit_Infantry$"]}});
    let config = Config::parse(&raw, "TEST")?;
    ensure(
        config.includes(&entities[1], &context, Mode::Unlimited, false)
            && config.includes(&entities[1], &context, Mode::Unlimited, true)
            && !config.includes(&entities[0], &context, Mode::Unlimited, false),
        "Forced inclusion no longer overrides exclusions.",
        "Apply force rules to both the division and its premade.",
    )?;
    raw["deckForcedUnitPatterns"] =
        serde_json::json!({"default":["Infantry"],"countryUnlimited":[]});
    let config = Config::parse(&raw, "TEST")?;
    ensure(
        !config.forced(&entities[1], &context, Mode::Unlimited),
        "An empty variant override did not clear default force patterns.",
        "Replace pattern lists rather than merging them.",
    )?;
    let source = "Ignored is TEntityDescriptor(MotherCountry = 'X') // skip\nKept is TEntityDescriptor(MotherCountry = 'X') // keep\n// below\nOmitted is TEntityDescriptor(MotherCountry = 'X')\n// keep\nForced is TEntityDescriptor(MotherCountry = 'X')";
    let parsed = parse::entities(
        source,
        Kind::Unit,
        &["skip".into(), "below".into(), "keep".into()],
    )?;
    ensure(
        parsed.iter().map(|e| e.name.as_str()).collect::<Vec<_>>() == ["Kept", "Forced"],
        "Entity comment directives changed.",
        "Keep explicit force markers above file-wide exclusion.",
    )?;
    Ok(())
}
fn scoring_check() -> Result<()> {
    let (entities, _, _, _) = fixture()?;
    let mut e = entities[1].clone();
    e.weapon_descriptor_names = vec!["Manager".into()];
    let ammo = HashMap::from([(
        "Shot".into(),
        Ammo {
            name: "Shot".into(),
            physical_damages: Some(2.),
            maximum_range_gru: Some(1500.),
            accuracy_stationary: Some(50.),
            shots_count_per_salvo: Some(2.),
            ..Ammo::default()
        },
    )]);
    let mount = Mount {
        ammunition_name: "Shot".into(),
        weapon_count: 1.,
        ..Mount::default()
    };
    let mut weapons = HashMap::from([(
        "Manager".into(),
        Weapon {
            name: "Manager".into(),
            salves: vec![4., 4.],
            mounted_weapons: vec![mount.clone()],
            ammunition_names: vec!["Shot".into()],
        },
    )]);
    let (single, _) = super::weapons::analyze(&e, &weapons, &ammo);
    weapons
        .get_mut("Manager")
        .unwrap()
        .mounted_weapons
        .push(mount.clone());
    let (shared, _) = super::weapons::analyze(&e, &weapons, &ammo);
    weapons.get_mut("Manager").unwrap().mounted_weapons[1].ammo_box_index = 1;
    let (independent, _) = super::weapons::analyze(&e, &weapons, &ammo);
    use super::metrics::M;
    ensure(
        single[M::AntiGround] > 0.
            && single == shared
            && independent[M::AntiGround] > single[M::AntiGround]
            && single[M::AntiArmor] == 0.,
        "Shared ammunition boxes or combat scoring changed.",
        "Count alternate ammunition as one box and independent boxes separately.",
    )?;
    ensure(
        pack_count(5., 0.699999988) == 4,
        "Float32 availability rounding changed.",
        "Round the product to four decimals before rounding a pack count.",
    )?;
    Ok(())
}
fn deck_check() -> Result<()> {
    let (entities, entries, config, context) = fixture()?;
    let weapons = Weapons::new();
    let ammo = Ammunition::new();
    let factory = analysis::Factory::new(&entities, &weapons, &ammo);
    let mut packs = indexmap::IndexMap::new();
    let cards = premade::build(
        &context,
        Mode::Unlimited,
        &entries,
        &factory,
        &mut packs,
        "TEST",
        &config,
    )?;
    ensure(
        cards.len() <= config.slots && cards.iter().any(|c| command(&entities[c.entity])),
        "Synthetic deck lost its command card or exceeded capacity.",
        "Preserve card coverage while trimming.",
    )?;
    for c in &cards {
        let p = &packs[&c.pack];
        ensure(
            p.unit == c.entity
                && p.transport == c.transport
                && p.number == entries[c.entity].rule.count(p.xp),
            "Synthetic card and pack disagree.",
            "Keep availability and pack rendering aligned.",
        )?;
    }
    ensure(
        rules::pack_profile(
            &Rule {
                max_pack_number: 0,
                ..Rule::fallback()
            },
            1,
        )
        .is_none(),
        "A zero-card rule remained buyable.",
        "Keep unavailable units out of premade decks.",
    )?;
    Ok(())
}
fn render_check() -> Result<()> {
    let (entities, entries, config, context) = fixture()?;
    let weapons = Weapons::new();
    let ammo = Ammunition::new();
    let factory = analysis::Factory::new(&entities, &weapons, &ammo);
    let mut packs = indexmap::IndexMap::new();
    let cards = premade::build(
        &context,
        Mode::Unlimited,
        &entries,
        &factory,
        &mut packs,
        "TEST",
        &config,
    )?;
    let used: std::collections::HashSet<_> = cards.iter().map(|c| c.pack.as_str()).collect();
    packs.retain(|name, _| used.contains(name.as_str()));
    let mut saved = store::Store::parse("")?;
    let mut names = Localisation::parse("");
    let metadata = saved.metadata(
        &mut names,
        "TEST_ALL_BLUE_UNLIMITED",
        "Fixture division",
        "Fixture deck",
    )?;
    let d = Variant {
        context: Arc::new(context),
        descriptor: "Descriptor_Deck_Division_TEST_ALL_BLUE_UNLIMITED".into(),
        rule_name: "Descriptor_Deck_Division_TEST_ALL_BLUE_UNLIMITED_Rule".into(),
        deck: "Descriptor_Deck_TEST_ALL_BLUE_UNLIMITED_Premade".into(),
        cfg_name: "TEST_ALL_BLUE_UNLIMITED".into(),
        emblem: "TextureTEST_Division_NATO".into(),
        summary: store::summary_token(&metadata.division_name_token),
        metadata,
        order: -8000.,
        tags: vec!["DEFAULT".into(), "TEST".into()],
        standout: Vec::new(),
        entries: Arc::from(entries),
        cards: cards.into_iter().map(DeckCard::from).collect(),
    };
    let divisions = [d];
    engine::integrity(&divisions, &packs, &entities, &config)?;
    let mut shared = [divisions[0].clone(), divisions[0].clone()];
    engine::integrity(&shared, &packs, &entities, &config)?;
    shared[1].entries = Arc::from(shared[1].entries.to_vec());
    engine::integrity(&shared, &packs, &entities, &config)?;
    let mut changed = shared[1].entries.to_vec();
    changed[0].rule.max_pack_number += 1;
    shared[1].entries = Arc::from(changed);
    ensure(
        engine::integrity(&shared, &packs, &entities, &config).is_err(),
        "Divisions with the same rule name accepted different rules.",
        "Compare shared and independently allocated rule lists.",
    )?;
    let plan = super::cache::Plan::capture(&divisions, &packs);
    let bytes = serde_json::to_vec(&plan)
        .map_err(|e| ymb_sdk::failure(e.to_string(), "Keep deck plans serializable."))?;
    let decoded: super::cache::Plan = serde_json::from_slice(&bytes)
        .map_err(|e| ymb_sdk::failure(e.to_string(), "Keep deck plans readable."))?;
    ensure(
        decoded.valid(
            entities.len(),
            &[(*divisions[0].context).clone()],
            "TEST",
            &config,
        ),
        "Cached plan has invalid references.",
        "Check the plan before restoring it.",
    )?;
    let (restored, _) = decoded.restore();
    ensure(
        restored[&divisions[0].cfg_name].0.as_ref() == divisions[0].entries.as_ref(),
        "Cached rules changed during round trip.",
        "Keep card selection independent from persistent identities.",
    )?;
    let encoded = String::from_utf8(bytes).unwrap();
    ensure(
        !encoded.contains("guid") && !encoded.contains("division_name_token"),
        "A cached plan contains persistent identities.",
        "Allocate identities from the current stores on every build.",
    )?;

    let owner = "fixture.deck";
    let source = "fixture.deck.generator";
    for text in [
        render::rules("", &divisions, &entities, owner, source)?,
        render::divisions("", &divisions, 27, &entities, "TEST", owner, source)?,
        render::packs(
            "",
            &packs.values().collect::<Vec<_>>(),
            &entities,
            owner,
            source,
        )?,
        render::decks("", &divisions, owner, source)?,
    ] {
        ndf::validate(&text)?;
    }
    let base = "unnamed TDeckSerializerEntries(DivisionIds = MAP [(Vanilla, 7)] UnitIds = MAP [($/GFX/Unit/Descriptor_Unit_Command, 9)])";
    let units = entities.iter().map(|e| e.name.clone()).collect::<Vec<_>>();
    let first = serializer::render(
        base,
        &divisions,
        units.clone(),
        owner,
        source,
        &mut saved.serializer,
        &mut serializer::Registry::default(),
    )?;
    let serialized = saved.render()?;
    let second = serializer::render(
        &first,
        &divisions,
        units,
        owner,
        source,
        &mut saved.serializer,
        &mut serializer::Registry::default(),
    )?;
    ensure(
        first == second && serialized == saved.render()?,
        "Serializer rendering is not idempotent.",
        "Keep ids and unrelated map entries unchanged across builds.",
    )?;
    ndf::validate(&second)?;
    ensure(
        !saved
            .serializer
            .unit_ids
            .contains_key("Descriptor_Unit_Command")
            && second.contains("(Vanilla, 7)"),
        "Serializer claimed an existing descriptor or removed another entry.",
        "Preserve base entries.",
    )?;
    Ok(())
}
pub fn roster(_: &mut Host) -> Result<Vec<TestResult>> {
    roster_check()?;
    Ok(vec![TestResult::passed(
        "Roster forces, filters, viability and descriptor directives",
    )])
}
pub fn scoring(_: &mut Host) -> Result<Vec<TestResult>> {
    scoring_check()?;
    Ok(vec![TestResult::passed(
        "Weapon metrics, shared magazines and float32 pack counts",
    )])
}
pub fn decks(_: &mut Host) -> Result<Vec<TestResult>> {
    deck_check()?;
    Ok(vec![TestResult::passed(
        "Premade capacity, command coverage and pack integrity",
    )])
}
pub fn render(_: &mut Host) -> Result<Vec<TestResult>> {
    render_check()?;
    Ok(vec![TestResult::passed(
        "NDF rendering, serializer preservation and idempotence",
    )])
}
#[test]
fn roster_policy() {
    roster_check().unwrap()
}
#[test]
fn weapon_scoring() {
    scoring_check().unwrap()
}
#[test]
fn deck_composition() {
    deck_check().unwrap()
}
#[test]
fn deck_rendering() {
    render_check().unwrap()
}
