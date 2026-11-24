use std::collections::{HashMap, HashSet};
use ymb_sdk::{Context, GeneratedFile, Result, ensure, ndf};

const SPECIALTIES: &str = "GameData/Generated/UserInterface/UnitSpecialties.ndf";

pub(crate) fn resistance_warning(
    unit: &str,
    field: &str,
    family: &str,
    index: usize,
) -> Option<String> {
    // Keep the exception scoped to the reported FALSEPROSPERITY descriptor.
    (unit == "Descriptor_Unit_HQ45E_LY1_CN"
        && field == "ResistanceTop"
        && family == "vehicule"
        && index == 4)
        .then(|| format!(
            "Compatibility: unit {unit} has unknown {field} resistance {family}:{index}; that profile is omitted from damage scoring."
        ))
}

#[test]
fn resistance_compatibility_matches_only_the_reported_modded_profile() {
    assert!(
        resistance_warning(
            "Descriptor_Unit_HQ45E_LY1_CN",
            "ResistanceTop",
            "vehicule",
            4
        )
        .is_some()
    );
    for (unit, field, family, index) in [
        ("Fixture_Vanilla", "ResistanceTop", "vehicule", 4),
        (
            "Descriptor_Unit_HQ45E_LY1_CN",
            "ResistanceFront",
            "vehicule",
            4,
        ),
        (
            "Descriptor_Unit_HQ45E_LY1_CN",
            "ResistanceTop",
            "blindage",
            4,
        ),
        (
            "Descriptor_Unit_HQ45E_LY1_CN",
            "ResistanceTop",
            "vehicule",
            3,
        ),
    ] {
        assert!(resistance_warning(unit, field, family, index).is_none());
    }
}

fn vocabulary(source: &str) -> Result<(std::ops::Range<usize>, HashMap<String, String>)> {
    let fields: Vec<_> = ndf::read::fields(source)?
        .into_iter()
        .filter(|f| f.name == "Descriptors")
        .collect();
    ensure(
        fields.len() == 1,
        "Specialty vocabulary needs one Descriptors map.",
        "Check UnitSpecialties.ndf.",
    )?;
    let range = fields[0].value.clone();
    let mut entries = HashMap::new();
    for entry in ndf::read::entries(&source[range.clone()])? {
        let mut lexer = ndf::lexer::Lexer::new(entry.text, 0);
        lexer.next_token()?;
        let token = lexer.next_token()?;
        if let Some(key) = ndf::values::parse_scalar(token.text).value.as_str() {
            ensure(
                entries
                    .insert(key.to_owned(), entry.text.to_owned())
                    .is_none(),
                "Duplicate specialty key.",
                "Keep one definition per specialty.",
            )?;
        }
    }
    Ok((range, entries))
}

fn restore(source: &str, fallback: &str, needed: &HashSet<String>) -> Result<Option<String>> {
    let (range, current) = vocabulary(source)?;
    let (_, fallback) = vocabulary(fallback)?;
    let mut missing: Vec<_> = needed
        .iter()
        .filter(|key| !current.contains_key(*key))
        .collect();
    missing.sort();
    let entries: Vec<_> = missing
        .into_iter()
        .filter_map(|key| fallback.get(key))
        .cloned()
        .collect();
    if entries.is_empty() {
        return Ok(None);
    }
    let next = ndf::patch::insert_collection(&source[range.clone()], &entries.join(",\n"), None)?;
    let mut output = source.to_owned();
    output.replace_range(range, &next);
    Ok(Some(output))
}

pub fn specialties(ctx: &mut Context) -> Result<Vec<GeneratedFile>> {
    let tag: String = ctx.value("modTag")?;
    let files = ctx.read_targets(&[
        crate::entities::UNITS,
        crate::entities::BUILDINGS,
        SPECIALTIES,
    ])?;
    let mut needed = HashSet::new();
    for path in [crate::entities::UNITS, crate::entities::BUILDINGS] {
        let source = &files[path];
        for block in ndf::scan(source)?
            .into_iter()
            .filter(|b| b.type_name == "TEntityDescriptor")
        {
            let text = &source[block.span];
            let fields = ndf::read::fields(text)?;
            if !fields.iter().any(|f| {
                f.name == "MotherCountry"
                    && ndf::values::parse_scalar(&text[f.value.clone()]).value == tag
            }) {
                continue;
            }
            for field in fields.iter().filter(|f| f.name == "SpecialtiesList") {
                for entry in ndf::read::entries(&text[field.value.clone()])? {
                    if let Some(key) = ndf::values::parse_scalar(entry.text).value.as_str() {
                        needed.insert(key.to_owned());
                    }
                }
            }
        }
    }
    let fallback = ctx.read_owned_text("definitions.ndf")?;
    match restore(&files[SPECIALTIES], &fallback, &needed)? {
        Some(output) => {
            ctx.notice(
                "Compatibility restored missing specialty vocabulary referenced by YSM units.",
            )?;
            Ok(vec![ctx.output_text(SPECIALTIES, output)?])
        }
        None => Ok(Vec::new()),
    }
}

#[test]
fn specialties_restore_only_missing_referenced_entries() {
    let current = "V is T(Descriptors = MAP [('existing', T(Value = 9))])";
    let fallback = "V is T(Descriptors = MAP [('existing', T(Value = 1)), ('needed', T(Value = 2)), ('unused', T(Value = 3))])";
    let needed = HashSet::from(["existing".into(), "needed".into()]);
    let changed = restore(current, fallback, &needed).unwrap().unwrap();
    assert!(changed.contains("Value = 9") && changed.contains("'needed'"));
    assert!(!changed.contains("'unused'"));
    assert!(restore(&changed, fallback, &needed).unwrap().is_none());
}
