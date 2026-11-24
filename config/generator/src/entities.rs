use std::collections::{HashMap, HashSet};
use ymb_sdk::{Context, Result, TestResult, ensure, ndf};

pub const UNITS: &str = "GameData/Generated/Gameplay/TacticalUnits.ndf";
const WEAPONS: &str = "GameData/Generated/Gameplay/Gfx/WeaponDescriptor.ndf";
pub const BUILDINGS: &str = "GameData/Generated/Gameplay/Gfx/BuildingDescriptors.ndf";
pub const FIRE: &str = "GameData/Generated/Gameplay/Gfx/FireDescriptor.ndf";

fn duplicates(
    source: &str,
    matches: &impl Fn(&str) -> bool,
    weapons: &HashMap<String, &str>,
) -> Result<Vec<String>> {
    let blocks = ndf::scan(source)?;
    let local: HashMap<_, _> = blocks
        .iter()
        .filter_map(|block| block.name.map(|name| (name, block.type_name)))
        .collect();
    let mut duplicates = Vec::new();
    for block in blocks
        .iter()
        .filter(|block| matches(block.name.unwrap_or("")))
    {
        let text = &source[block.span.clone()];
        let fields = ndf::read::direct_fields(text)?;
        let Some(field) = fields
            .iter()
            .find(|field| field.name == "ModulesDescriptors")
        else {
            continue;
        };
        let mut seen = HashSet::new();
        for entry in ndf::read::entries(&text[field.value.clone()])? {
            let reference = entry.text.trim();
            let type_name = entry.type_name.or_else(|| {
                if let Some(name) = reference.strip_prefix("~/") {
                    local.get(name).copied()
                } else {
                    weapons.get(reference).copied()
                }
            });
            let key = type_name
                .and_then(|name| name.split_whitespace().next())
                .unwrap_or(reference);
            if !seen.insert(key) {
                duplicates.push(format!("{}: {key}", block.name.unwrap_or("")));
            }
        }
    }
    Ok(duplicates)
}

pub fn validate(ctx: &mut Context, files: &[&str], matches: impl Fn(&str) -> bool) -> Result<()> {
    let mut paths = Vec::with_capacity(files.len() + 1);
    paths.push(WEAPONS);
    paths.extend_from_slice(files);
    let sources = ctx.read_targets(&paths)?;
    let weapons: HashMap<_, _> = ndf::scan(&sources[WEAPONS])?
        .into_iter()
        .filter_map(|block| {
            block
                .name
                .map(|name| (format!("$/GFX/Weapon/{name}"), block.type_name))
        })
        .collect();
    let mut found = Vec::new();
    for path in files {
        found.extend(duplicates(&sources[*path], &matches, &weapons)?);
    }
    ensure(
        found.is_empty(),
        format!(
            "Generated entities contain duplicate modules: {}",
            found.join(", ")
        ),
        "Remove the inherited module before adding its replacement.",
    )
}

pub fn check() -> Result<()> {
    let source = r#"
Capacity is TCapaciteModuleDescriptor()
export Entity_Example is TEntityDescriptor(
    ModulesDescriptors = [
        TCapaciteModuleDescriptor(),
        ~/Capacity,
        TDeploymentShiftModuleDescriptor(),
        TDeploymentShiftModuleDescriptor(),
        $/GFX/Weapon/BaseWeapon,
        $/GFX/Weapon/YsmWeapon,
    ]
)
export Descriptor_Unit_Base is TEntityDescriptor(
    ModulesDescriptors = [TCapaciteModuleDescriptor(), TCapaciteModuleDescriptor()]
)
"#;
    let weapons = HashMap::from([
        (
            "$/GFX/Weapon/BaseWeapon".into(),
            "TWeaponManagerModuleDescriptor",
        ),
        (
            "$/GFX/Weapon/YsmWeapon".into(),
            "TWeaponManagerModuleDescriptor",
        ),
    ]);
    let found = duplicates(source, &|name| name.starts_with("Entity_"), &weapons)?;
    ensure(
        found
            == [
                "Entity_Example: TCapaciteModuleDescriptor",
                "Entity_Example: TDeploymentShiftModuleDescriptor",
                "Entity_Example: TWeaponManagerModuleDescriptor",
            ],
        "Module uniqueness check missed a resolved reference.",
        "Resolve local and weapon references before comparing types.",
    )?;
    let valid = r#"
export Entity_Valid is TEntityDescriptor(
    ModulesDescriptors = [
        TCapaciteModuleDescriptor(),
        // TCapaciteModuleDescriptor(),
        TDeploymentShiftModuleDescriptor(),
        ~/FacingInfosModuleDescriptor,
    ]
)
"#;
    ensure(
        duplicates(valid, &|name| name.starts_with("Entity_"), &weapons)?.is_empty(),
        "Comments created a duplicate module.",
        "Use the shared NDF grammar.",
    )
}

pub fn checks(_: &mut Context) -> Result<Vec<TestResult>> {
    check()?;
    Ok(vec![TestResult::passed(
        "Entity module uniqueness includes resolved references",
    )])
}

#[test]
fn resolved_module_uniqueness() {
    check().unwrap();
}
