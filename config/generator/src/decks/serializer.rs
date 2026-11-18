use super::{data::*, parse, store};
use indexmap::IndexMap;
use std::{collections::HashMap, ops::Range};
use ymb_sdk::{Result, ensure, failure, generated, ndf};
// Inactive saved ids remain reserved when a unit moves between roster owners.
#[derive(Default)]
pub struct Registry {
    divisions: IndexMap<String, u32>,
    units: IndexMap<String, u32>,
}
impl Registry {
    pub fn new(stores: &[store::Store]) -> Result<Self> {
        let mut registry = Self::default();
        for store in stores {
            merge_ids(&mut registry.divisions, &store.serializer.division_ids)?;
            merge_ids(&mut registry.units, &store.serializer.unit_ids)?;
        }
        Ok(registry)
    }
}
fn merge_ids(target: &mut IndexMap<String, u32>, saved: &IndexMap<String, u32>) -> Result<()> {
    let mut used: HashMap<_, _> = target
        .iter()
        .map(|(name, id)| (*id, name.clone()))
        .collect();
    for (name, id) in saved {
        ensure(
            target.get(name).is_none_or(|old| old == id)
                && used.get(id).is_none_or(|old| old == name),
            format!(
                "Identity stores contain conflicting serializer assignments for {name} or id {id}."
            ),
            "Restore both stores from a consistent backup; do not allocate replacement ids.",
        )?;
        target.insert(name.clone(), *id);
        used.insert(*id, name.clone());
    }
    Ok(())
}
fn map_ranges(source: &str, name: &str) -> Result<Vec<Range<usize>>> {
    let fields: Vec<_> = ndf::read::fields(source)?
        .into_iter()
        .filter(|f| f.name == name)
        .collect();
    ensure(
        !fields.is_empty(),
        format!("DeckSerializer needs at least one {name} map."),
        "Check the selected mods and WARNO version.",
    )?;
    fields
        .into_iter()
        .map(|field| {
            ensure(
                source[field.value.clone()].trim_start().starts_with("MAP"),
                format!("DeckSerializer.{name} is not a MAP."),
                "Restore its map structure.",
            )?;
            Ok(field.value)
        })
        .collect()
}
fn entries(source: &str, map: &str, unit: bool) -> Result<IndexMap<String, u32>> {
    let mut result = IndexMap::new();
    let mut ids = HashMap::new();
    for range in map_ranges(source, map)? {
        for entry in ndf::read::entries(&source[range])? {
            let t = parse::tokens(entry.text)?;
            ensure(
                t.len() == 5 && t[0] == "(" && t[2] == "," && t[4] == ")",
                format!("Invalid {map} serializer entry: {}", entry.text),
                "Keep each entry as a descriptor and integer id pair.",
            )?;
            let name = if unit {
                t[1].strip_prefix("$/GFX/Unit/")
            } else {
                Some(t[1])
            }
            .filter(|s| !s.is_empty())
            .ok_or_else(|| {
                failure(
                    "Invalid serializer descriptor reference.",
                    "Check DeckSerializer.ndf.",
                )
            })?;
            let id = t[3]
                .parse::<u32>()
                .map_err(|_| failure("Invalid serializer id.", "Use a nonnegative integer id."))?;
            ensure(
                result.get(name).is_none_or(|old| *old == id),
                format!("DeckSerializer assigns {name} to multiple ids."),
                "Keep the stores and resolve the conflicting mods.",
            )?;
            ensure(
                ids.get(&id).is_none_or(|old: &String| old == name),
                format!("DeckSerializer assigns id {id} to multiple names."),
                "Keep the stores and resolve the conflicting mods.",
            )?;
            result.insert(name.to_string(), id);
            ids.insert(id, name.to_string());
        }
    }
    Ok(result)
}
fn resolve(
    names: Vec<String>,
    all: &IndexMap<String, u32>,
    base: &IndexMap<String, u32>,
    saved: &mut IndexMap<String, u32>,
    next: &mut u32,
    reserved: &mut IndexMap<String, u32>,
    last: u32,
) -> Result<Vec<String>> {
    let mut used: HashMap<u32, String> = base.iter().map(|(n, id)| (*id, n.clone())).collect();
    for (name, id) in reserved.iter().chain(saved.iter()) {
        ensure(
            base.get(name).is_none_or(|base_id| base_id == id),
            format!("The target changes saved serializer identity for {name}."),
            "Keep the saved ids and resolve the conflicting mod.",
        )?;
        ensure(
            used.get(id)
                .is_none_or(|used| used.as_str() == name.as_str()),
            format!("Saved serializer id {id} for {name} conflicts with the target."),
            "Keep both identity stores and resolve the conflicting mod.",
        )?;
        used.insert(*id, name.clone());
    }
    let mut candidate = (*next).max(
        saved
            .values()
            .map(|id| id.saturating_add(1))
            .max()
            .unwrap_or(0),
    );
    // A saved counter may be at the format limit while lower ids are still free.
    let mut candidates = (candidate..=last).chain(0..candidate.min(last + 1));
    let mut active = unique(names);
    active.sort_by(|a, b| name_cmp(a, b));
    let mut result = Vec::new();
    let mut assignments = Vec::new();
    for name in active {
        if base.contains_key(&name) {
            continue;
        }
        let id = if let Some(id) = saved
            .get(&name)
            .or_else(|| reserved.get(&name))
            .or_else(|| all.get(&name))
        {
            *id
        } else {
            candidates.find(|id| !used.contains_key(id)).ok_or_else(|| {
                failure(
                    format!("Serializer ids exhausted for {name}; all ids from 0 through {last} are reserved."),
                    "Keep both identity stores and reduce the combination's serialized descriptors.",
                )
            })?
        };
        ensure(
            id <= last,
            format!("Serializer id {id} for {name} is outside 0 through {last}."),
            "Keep the identity stores and report the exhausted or invalid range.",
        )?;
        ensure(
            used.get(&id)
                .is_none_or(|used| used.as_str() == name.as_str()),
            format!("Serializer id {id} is already assigned to another descriptor."),
            "Keep the identity stores and resolve the conflicting mod.",
        )?;
        used.insert(id, name.clone());
        candidate = candidate.max(id + 1);
        result.push(format!("({name}, {id}),"));
        assignments.push((name, id));
    }

    for (name, id) in assignments {
        if !reserved.contains_key(&name) || saved.contains_key(&name) {
            saved.insert(name.clone(), id);
        }
        reserved.insert(name, id);
    }
    *next = (*next).max(candidate);
    Ok(result)
}
fn strip_owner(source: &str, owner: &str) -> Result<String> {
    let ids = [
        format!("{owner} | DeckSerializer:DivisionIds"),
        format!("{owner} | DeckSerializer:UnitIds"),
    ];
    let mut result = source.to_string();
    for region in generated::regions(source)?.into_iter().rev() {
        if ids.iter().any(|id| id == region.id) {
            result.replace_range(region.full, "");
        }
    }
    Ok(result)
}
fn inject(
    source: &str,
    map: &str,
    owner: &str,
    source_id: &str,
    lines: &[String],
) -> Result<String> {
    let id = format!("{owner} | DeckSerializer:{map}");
    let existing = generated::regions(source)?.into_iter().find(|r| r.id == id);
    if lines.is_empty() {
        let mut result = source.to_string();
        if let Some(r) = existing {
            result.replace_range(r.full, "");
        }
        return Ok(result);
    }
    let block = generated::render(&id, lines, None, Some(source_id))?;
    if let Some(r) = &existing {
        let indent: String = source[r.full.clone()]
            .chars()
            .take_while(|c| *c == ' ' || *c == '\t')
            .collect();
        let block = block
            .lines()
            .map(|l| format!("{indent}{l}"))
            .collect::<Vec<_>>()
            .join("\n")
            + "\n";
        return generated::upsert(source, &block, &id);
    }
    let range = map_ranges(source, map)?.pop().unwrap();
    let next = ndf::patch::insert_collection(&source[range.clone()], &block, None)?;
    let mut result = source.to_string();
    result.replace_range(range, &next);
    Ok(result)
}
pub fn render(
    source: &str,
    divisions: &[Variant],
    units: Vec<String>,
    owner: &str,
    source_id: &str,
    state: &mut store::Serializer,
    registry: &mut Registry,
) -> Result<String> {
    let base = strip_owner(source, owner)?;
    let all_divisions = entries(source, "DivisionIds", false)?;
    let base_divisions = entries(&base, "DivisionIds", false)?;
    let all_units = entries(source, "UnitIds", true)?;
    let base_units = entries(&base, "UnitIds", true)?;
    let division_lines = resolve(
        divisions.iter().map(|d| d.descriptor.clone()).collect(),
        &all_divisions,
        &base_divisions,
        &mut state.division_ids,
        &mut state.next_division_id,
        &mut registry.divisions,
        store::DIVISION_LAST,
    )?;
    let unit_lines = resolve(
        units,
        &all_units,
        &base_units,
        &mut state.unit_ids,
        &mut state.next_unit_id,
        &mut registry.units,
        store::UNIT_LAST,
    )?
    .iter()
    .map(|s| s.replacen('(', "($/GFX/Unit/", 1))
    .collect::<Vec<_>>();
    let result = inject(source, "DivisionIds", owner, source_id, &division_lines)?;
    inject(&result, "UnitIds", owner, source_id, &unit_lines)
}

#[test]
fn fresh_stores_avoid_occupied_ids_without_renumbering_the_base() {
    let base = "Serializer is TSerializer(DivisionIds = MAP [(Other, 1600)] UnitIds = MAP [($/GFX/Unit/Other, 16000)])";
    let mut saved = store::Store::default();
    let output = render(
        base,
        &[],
        vec!["New".into()],
        "fixture",
        "fixture",
        &mut saved.serializer,
        &mut Registry::default(),
    )
    .unwrap();
    assert!(output.contains("($/GFX/Unit/Other, 16000)"));
    assert_eq!(saved.serializer.unit_ids["New"], 0);
}

#[test]
fn inactive_unit_ids_survive_roster_owner_changes() {
    let mut stores = [store::Store::default(), store::Store::default()];
    stores[0].serializer.unit_ids.insert("Zombie".into(), 16000);
    stores[0].serializer.next_unit_id = 16001;
    store::reserve(&mut stores);
    let mut registry = Registry::new(&stores).unwrap();
    let base = "Serializer is TSerializer(DivisionIds = MAP [] UnitIds = MAP [])";
    let first = render(
        base,
        &[],
        Vec::new(),
        "core",
        "fixture",
        &mut stores[0].serializer,
        &mut registry,
    )
    .unwrap();
    let horde = render(
        &first,
        &[],
        vec!["Zombie".into()],
        "horde",
        "fixture",
        &mut stores[1].serializer,
        &mut registry,
    )
    .unwrap();
    assert!(horde.contains("($/GFX/Unit/Zombie, 16000)"), "{horde}");
    assert!(stores[1].serializer.unit_ids.is_empty());
    assert!(render("Serializer is TSerializer(DivisionIds = MAP [] UnitIds = MAP [($/GFX/Unit/Zombie, 7)])",
        &[],vec!["Zombie".into()],"horde","fixture",&mut stores[1].serializer,&mut registry).is_err());
    stores[1].serializer.unit_ids.insert("Other".into(), 16000);
    assert!(Registry::new(&stores).is_err());
    stores[1].serializer.unit_ids.clear();
    stores[1].serializer.unit_ids.insert("Zombie".into(), 16001);
    assert!(Registry::new(&stores).is_err());
}

#[test]
fn full_bit_range_preserves_inactive_stores_and_base_ids() {
    let entries = (0..3000)
        .chain(16000..=store::UNIT_LAST)
        .map(|id| format!("($/GFX/Unit/Base{id}, {id})"))
        .collect::<Vec<_>>()
        .join(",");
    let base =
        format!("unnamed TDeckSerializerEntries(DivisionIds = MAP [] UnitIds = MAP [{entries}])");
    let mut stores = [store::Store::default(), store::Store::default()];
    stores[0]
        .serializer
        .unit_ids
        .insert("InactiveCore".into(), 3000);
    stores[1]
        .serializer
        .unit_ids
        .insert("InactiveHorde".into(), 3001);
    stores[0].serializer.next_unit_id = 3001;
    stores[1].serializer.next_unit_id = 3002;
    let mut registry = Registry::new(&stores).unwrap();
    let units: Vec<_> = (0..400).map(|id| format!("New{id:03}")).collect();
    let output = render(
        &base,
        &[],
        units.clone(),
        "core",
        "fixture",
        &mut stores[0].serializer,
        &mut registry,
    )
    .unwrap();
    assert_eq!(stores[0].serializer.unit_ids["New000"], 3002);
    assert_eq!(stores[0].serializer.unit_ids["New399"], 3401);
    for store in &stores {
        assert_eq!(
            store::Store::parse(&store.render().unwrap()).unwrap(),
            *store
        );
    }
    let saved = stores[0].clone();
    assert_eq!(
        render(
            &output,
            &[],
            units,
            "core",
            "fixture",
            &mut stores[0].serializer,
            &mut registry
        )
        .unwrap(),
        output
    );
    assert_eq!(stores[0], saved);
    assert!(output.contains("($/GFX/Unit/Base16383, 16383)"));
}

#[test]
fn serializer_maps_merge_without_rewriting_base_blocks() {
    let base = "unnamed TDeckSerializerEntries(DivisionIds = MAP [(BaseA, 1)] UnitIds = MAP [($/GFX/Unit/One, 1)])\n\
                unnamed TDeckSerializerEntries(DivisionIds = MAP [(BaseB, 2)] UnitIds = MAP [($/GFX/Unit/Two, 2)])";
    let mut saved = store::Store::default();
    let output = render(
        base,
        &[],
        vec!["One".into(), "Two".into(), "New".into()],
        "core",
        "fixture",
        &mut saved.serializer,
        &mut Registry::default(),
    )
    .unwrap();
    assert_eq!(entries(&output, "DivisionIds", false).unwrap().len(), 2);
    assert_eq!(entries(&output, "UnitIds", true).unwrap().len(), 3);
    assert_eq!(saved.serializer.unit_ids.len(), 1);
    assert_eq!(ndf::scan(&output).unwrap().len(), 2);
    assert!(output.starts_with(base.lines().next().unwrap()));
    for conflicting in [
        base.replace("Two, 2", "Two, 1"),
        base.replace("Two, 2", "One, 2"),
        base.replace("MAP [(BaseB, 2)]", "[]"),
    ] {
        assert!(
            entries(&conflicting, "UnitIds", true).is_err()
                || entries(&conflicting, "DivisionIds", false).is_err()
        );
    }
}

#[test]
fn full_serializer_range_fails_without_committing_assignments() {
    let base = (0..=3).map(|id| (format!("Base{id}"), id)).collect();
    let mut saved = IndexMap::new();
    let mut reserved = IndexMap::new();
    let mut next = 2;
    let error = resolve(
        vec!["New".into()],
        &base,
        &base,
        &mut saved,
        &mut next,
        &mut reserved,
        3,
    )
    .unwrap_err();
    assert!(error.reason.contains("exhausted"));
    assert!(saved.is_empty() && reserved.is_empty());
    assert_eq!(next, 2);
}

#[test]
fn saved_counter_at_the_format_limit_reuses_only_free_ids() {
    let base = IndexMap::from([("Base".into(), 1)]);
    let mut saved = IndexMap::from([("Inactive".into(), 3)]);
    let mut reserved = IndexMap::new();
    let mut next = 4;
    resolve(
        vec!["NewB".into(), "NewA".into()],
        &base,
        &base,
        &mut saved,
        &mut next,
        &mut reserved,
        3,
    )
    .unwrap();
    assert_eq!(saved["Inactive"], 3);
    assert_eq!(saved["NewA"], 0);
    assert_eq!(saved["NewB"], 2);
    assert_eq!(next, 4);
}
