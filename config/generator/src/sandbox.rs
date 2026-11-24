use crate::{entities, localisation};
use ymb_sdk::{Context, GeneratedFile, Result};

pub fn cheat_units(ctx: &mut Context) -> Result<Vec<GeneratedFile>> {
    entities::validate(ctx, &[entities::UNITS], |name| {
        name.starts_with("Descriptor_Unit_YC_")
    })?;
    localisation::merge_feature(ctx, "UNITS")
}

pub fn supply_units(ctx: &mut Context) -> Result<Vec<GeneratedFile>> {
    entities::validate(ctx, &[entities::UNITS], |name| {
        name.starts_with("Descriptor_Unit_YS_")
    })?;
    localisation::merge_feature(ctx, "UNITS")
}

pub fn supply_buildings(ctx: &mut Context) -> Result<Vec<GeneratedFile>> {
    entities::validate(ctx, &[entities::BUILDINGS], |name| {
        name.starts_with("Descriptor_Unit_YS_")
    })?;
    localisation::merge_feature(ctx, "UNITS")
}

pub fn nuclear_planes(ctx: &mut Context) -> Result<Vec<GeneratedFile>> {
    entities::validate(ctx, &[entities::UNITS, entities::FIRE], |name| {
        name.starts_with("Descriptor_Unit_YN_") || name.starts_with("Descriptor_Fire_YN_")
    })?;
    localisation::merge_feature(ctx, "UNITS")
}
