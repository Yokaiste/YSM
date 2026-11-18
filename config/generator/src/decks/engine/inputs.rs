use super::*;

pub(super) fn parse_inputs(
    raw: &mut HashMap<&str, String>,
    configs: &[Config; 2],
    source_rules: &str,
    source_divisions: &str,
) -> Result<super::super::cache::Inputs> {
    let config = &configs[0];
    for result in ymb_sdk::parallel::map(
        &INPUTS,
        ymb_sdk::parallel::Limits::from_env(),
        |(key, _)| raw[key].len().saturating_mul(2),
        |(key, _)| validate_input(key, &raw[key]),
    ) {
        result?;
    }
    let mut entities = parse::entities(
        &raw.remove("buildings").unwrap(),
        Kind::Building,
        &config.directives,
    )?;
    entities.extend(parse::entities(
        &raw.remove("units").unwrap(),
        Kind::Unit,
        &config.directives,
    )?);
    let (weapons, mut ammo) = parse::weapon_data(&raw.remove("weapons").unwrap())?;
    ammo.extend(parse::ammunition(&raw.remove("ammunition").unwrap())?);
    for key in ["missiles", "missile_descriptors"] {
        for (name, entry) in parse::ammunition(&raw.remove(key).unwrap())? {
            ammo.entry(name).or_insert(entry);
        }
    }
    let warnings = combat::damage_profiles(
        &mut ammo,
        &entities,
        &raw.remove("damage").unwrap(),
        &raw.remove("families").unwrap(),
    )?;
    combat::fire_profiles(&mut ammo, &raw.remove("fire").unwrap())?;
    let descriptors = parse::divisions(source_rules, source_divisions, &config.ignored_rules)?;
    parse::infer_coalitions(&mut entities, &descriptors);
    combat::capacity_profiles(
        &mut entities,
        &raw.remove("capacities").unwrap(),
        &raw.remove("effects").unwrap(),
    )?;
    parse::sellable(&mut entities, &raw.remove("orders").unwrap())?;
    let matrices = parse::matrices(&raw.remove("matrix").unwrap())?;
    let deckable: Vec<_> = entities
        .iter()
        .enumerate()
        .filter(|(_, e)| {
            e.factory_type.as_ref().is_some_and(|s| !s.is_empty())
                && e.country.as_ref().is_some_and(|s| !s.is_empty())
                && e.coalition.as_ref().is_some_and(|s| !s.is_empty())
        })
        .map(|(id, _)| id)
        .collect();
    let mut passes = Vec::new();
    for (pass, config) in configs.iter().enumerate() {
        let alternate;
        let descriptors = if pass == 0 {
            &descriptors
        } else {
            alternate = parse::divisions(source_rules, source_divisions, &config.ignored_rules)?;
            &alternate
        };
        let vanilla = parse::rules(source_rules, descriptors, &config.ignored_rules)?;
        let hidden = parse::hidden(&entities, descriptors, &matrices, config);
        let eligible: Vec<_> = deckable
            .iter()
            .copied()
            .filter(|id| !hidden.contains(id))
            .collect();
        let balanced = rules::balanced(&entities, &eligible, &vanilla);
        passes.push(super::super::cache::Pass { eligible, balanced });
    }
    Ok(super::super::cache::Inputs {
        warnings,
        entities,
        weapons,
        ammo,
        passes: passes
            .try_into()
            .unwrap_or_else(|_| unreachable!("two configurations")),
    })
}

pub(super) const INPUTS: [(&str, &str); 18] = [
    ("buildings", crate::entities::BUILDINGS),
    ("units", crate::entities::UNITS),
    (
        "weapons",
        "GameData/Generated/Gameplay/Gfx/WeaponDescriptor.ndf",
    ),
    (
        "ammunition",
        "GameData/Generated/Gameplay/Gfx/Ammunition.ndf",
    ),
    (
        "missiles",
        "GameData/Generated/Gameplay/Gfx/AmmunitionMissiles.ndf",
    ),
    (
        "missile_descriptors",
        "GameData/Generated/Gameplay/Gfx/MissileDescriptors.ndf",
    ),
    (
        "damage",
        "GameData/Generated/Gameplay/Gfx/DamageResistance.ndf",
    ),
    (
        "families",
        "GameData/Generated/Gameplay/Gfx/DamageResistanceFamilyList.ndf",
    ),
    ("fire", crate::entities::FIRE),
    (
        "capacities",
        "GameData/Generated/Gameplay/Gfx/CapaciteList.ndf",
    ),
    (
        "effects",
        "GameData/Generated/Gameplay/Effects/EffetsSurUnite.ndf",
    ),
    (
        "orders",
        "GameData/Generated/Gameplay/Gfx/OrderAvailability_Tactic.ndf",
    ),
    (
        "rules",
        "GameData/Generated/Gameplay/Decks/DivisionRules.ndf",
    ),
    (
        "divisions",
        "GameData/Generated/Gameplay/Decks/Divisions.ndf",
    ),
    (
        "matrix",
        "GameData/Generated/Gameplay/Decks/DivisionCostMatrix.ndf",
    ),
    (
        "serializer",
        "GameData/Generated/Gameplay/Decks/DeckSerializer.ndf",
    ),
    ("packs", "GameData/Generated/Gameplay/Decks/DeckPacks.ndf"),
    ("decks", "GameData/Generated/Gameplay/Decks/Decks.ndf"),
];
pub(super) const OUTPUT_KEYS: [&str; 5] = ["rules", "divisions", "serializer", "packs", "decks"];
pub(super) const STORES: [&str; 2] = [
    "generated-decks.core.store.json",
    "generated-decks.horde.store.json",
];

pub(super) fn store_paths(generation: &serde_json::Value) -> Result<[String; 2]> {
    let compatibility = generation.get("compatibility");
    if let Some(value) = compatibility {
        let record = ymb_sdk::values::record(value, "deckGeneration.compatibility")?;
        ensure(
            record.keys().all(|key| key == "identityProfile"),
            "Unknown deck compatibility setting.",
            "Use compatibility.identityProfile.",
        )?;
    }
    let profile = ymb_sdk::values::optional_string(
        compatibility.and_then(|value| value.get("identityProfile")),
        "identityProfile",
    )?
    .unwrap_or("");
    if profile.is_empty() {
        return Ok(STORES.map(|name| format!("decks/{name}")));
    }
    ymb_sdk::core::paths::identifier(profile)?;
    Ok(STORES.map(|name| format!("decks/compatibility/{profile}/{name}")))
}

#[test]
fn combination_identity_profiles_are_explicit_and_contained() {
    assert_eq!(
        store_paths(&serde_json::json!({})).unwrap(),
        STORES.map(|name| format!("decks/{name}"))
    );
    assert!(
        store_paths(&serde_json::json!({"compatibility":{"identityProfile":"../escape"}})).is_err()
    );
    let paths =
        store_paths(&serde_json::json!({"compatibility":{"identityProfile":"combination"}}))
            .unwrap();
    assert!(
        paths
            .iter()
            .all(|path| path.starts_with("decks/compatibility/combination/"))
    );
}
pub(super) const OWNERS: [&str; 2] = [
    // Existing generated regions use these stable owner ids.
    "mods/YSM/config/patch/decks/generation/generate-decks.ts | roster",
    "mods/YSM/config/patch/decks/generation/generate-decks.ts | horde",
];
pub(super) fn validate_input(key: &str, source: &str) -> Result<()> {
    if matches!(key, "ammunition" | "missiles" | "missile_descriptors") {
        return ndf::validate(source);
    }
    ensure(
        !source.trim().is_empty(),
        format!("Deck input {key} is empty."),
        "Check the selected mods and update game files.",
    )?;
    let blocks = ndf::scan(source)?;
    let expected = match key {
        "buildings" | "units" | "fire" => Some("TEntityDescriptor"),
        "weapons" => Some("TWeaponManagerModuleDescriptor"),
        "damage" => Some("TGameplayDamageResistanceContainer"),
        "capacities" => Some("TCapaciteDescriptor"),
        "effects" => Some("TEffectsPackDescriptor"),
        "rules" => Some("TDeckDivisionRule"),
        "divisions" => Some("TDeckDivisionDescriptor"),
        "matrix" => Some("MAP"),
        "packs" => Some("DeckPackDescriptor"),
        "decks" => Some("TDeckDescriptor"),
        _ => None,
    };
    if let Some(expected) = expected {
        ensure(
            blocks
                .iter()
                .any(|b| b.type_name.split_whitespace().next() == Some(expected)),
            format!("Deck input {key} has no {expected} definitions."),
            "Check the WARNO version and selected mods.",
        )?
    }
    if key == "orders" {
        ensure(
            blocks.iter().any(|b| {
                b.name
                    .is_some_and(|n| n.starts_with("Descriptor_OrderAvailability_"))
            }),
            "Tactical order availability definitions are missing.",
            "Check OrderAvailability_Tactic.ndf.",
        )?
    }
    Ok(())
}

#[test]
fn ammunition_definitions_can_move_between_cluster_files() {
    for key in ["ammunition", "missiles", "missile_descriptors"] {
        assert!(validate_input(key, "").is_ok());
        assert!(validate_input(key, "Ammo is TAmmunitionDescriptor(PhysicalDamages = 4)").is_ok());
        assert!(validate_input(key, "Ammo is TAmmunitionDescriptor(").is_err());
    }
    assert!(validate_input("weapons", "").is_err());
    assert!(validate_input("units", "Ammo is TAmmunitionDescriptor()").is_err());
}
