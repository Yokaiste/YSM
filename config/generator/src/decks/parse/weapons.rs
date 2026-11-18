use super::*;

pub fn weapon_data(source: &str) -> Result<(Weapons, Ammunition)> {
    let mut seen = HashSet::new();
    let mut selected = Vec::new();
    for b in ndf::scan(source)?
        .into_iter()
        .filter(|b| b.type_name == "TWeaponManagerModuleDescriptor")
    {
        let Some(name) = b.name else { continue };
        if !seen.insert(name) {
            continue;
        }
        selected.push((name, &source[b.span]));
    }
    let mut result = HashMap::new();
    let mut inline = ammunition(source)?;
    for parsed in parallel::map(
        &selected,
        parallel::Limits::from_env(),
        |(_, text)| text.len().saturating_mul(8),
        |(name, text)| weapon(name, text),
    ) {
        let (weapon, ammunition) = parsed?;
        result.insert(weapon.name.clone(), weapon);
        inline.extend(ammunition);
    }
    Ok((result, inline))
}

fn weapon(name: &str, source: &str) -> Result<(Weapon, Ammunition)> {
    let mut inline = HashMap::new();
    let f = Fields::new(source)?;
    let mut weapon = Weapon {
        name: name.into(),
        salves: numbers(f.get("Salves"))?,
        ..Weapon::default()
    };
    for (turret_index, turret) in ndf::read::entries(f.get("TurretDescriptorList").unwrap_or("[]"))?
        .into_iter()
        .enumerate()
    {
        let t = Fields::new(turret.text)?;
        for (mount_index, mount) in
            ndf::read::entries(t.get("MountedWeaponDescriptorList").unwrap_or("[]"))?
                .into_iter()
                .enumerate()
        {
            let m = Fields::new(mount.text)?;
            let value = m.get("Ammunition");
            let ammunition_name = if let Some(value) =
                value.filter(|value| value.trim_start().starts_with("TAmmunitionDescriptor"))
            {
                // compatibility: synthetic names identify analysis records, never game objects.
                let name = format!("{name}__inline_{turret_index}_{mount_index}");
                inline.insert(name.clone(), parse_ammo(&name, value)?);
                Some(name)
            } else {
                reference(value, "$/GFX/Weapon/")
            };
            if let Some(ammunition_name) = ammunition_name {
                weapon.mounted_weapons.push(Mount {
                    ammunition_name,
                    ammo_box_index: m.num("AmmoBoxIndex").unwrap_or(0.).max(0.) as usize,
                    weapon_count: m.num("NbWeapons").unwrap_or(1.),
                    traits: m
                        .list("TraitsToken")?
                        .iter()
                        .map(|v| v.to_lowercase())
                        .collect(),
                });
            }
        }
    }
    weapon.ammunition_names = unique(
        weapon
            .mounted_weapons
            .iter()
            .map(|m| m.ammunition_name.clone()),
    );
    Ok((weapon, inline))
}
pub fn ammunition(source: &str) -> Result<Ammunition> {
    let mut seen = HashSet::new();
    let mut selected = Vec::new();
    for b in ndf::read::objects(source)?
        .into_iter()
        .filter(|b| b.type_name == "TAmmunitionDescriptor")
    {
        let Some(name) = b.name else { continue };
        if !seen.insert(name) {
            continue;
        }
        selected.push((name, &source[b.span]));
    }
    parallel::map(
        &selected,
        parallel::Limits::from_env(),
        |(_, text)| text.len().saturating_mul(8),
        |(name, text)| Ok(((*name).to_owned(), parse_ammo(name, text)?)),
    )
    .into_iter()
    .collect()
}

fn parse_ammo(name: &str, source: &str) -> Result<Ammo> {
    let f = Fields::new(source)?;
    let arme = f.get("Arme").map(Fields::new).transpose()?;

    let mut a = Ammo {
        name: name.into(),
        damage_family: arme
            .as_ref()
            .and_then(|arme| arme.get("Family"))
            .map(|raw| {
                let raw = raw.trim().rsplit('/').next().unwrap();
                raw.strip_prefix("DamageFamily_").unwrap_or(raw).to_owned()
            }),
        damage_index: arme.as_ref().and_then(|arme| arme.num("Index")),
        min_max_category: f.get("MinMaxCategory").map(str::to_string),
        weapon_cursor_type: f.get("WeaponCursorType").map(str::to_string),
        projectile_type: f.suffix("ProjectileType", "EProjectileType/"),
        guidance: f.suffix("Guidance", "Guidance_"),
        fire_descriptor_name: reference(f.get("FireDescriptor"), "$/GFX/Weapon/"),
        has_smoke: Some(f.get("SmokeDescriptor").unwrap_or("nil") != "nil"),
        ..Ammo::default()
    };
    a.armor_penetration = a.damage_index;
    a.minimum_range_gru = f.num("MinimumRangeGRU");
    a.minimum_range_helicopter_gru = f.num("MinimumRangeHelicopterGRU");
    a.minimum_range_airplane_gru = f.num("MinimumRangeAirplaneGRU");
    a.maximum_range_gru = f.num("MaximumRangeGRU");
    a.maximum_range_helicopter_gru = f.num("MaximumRangeHelicopterGRU");
    a.maximum_range_airplane_gru = f.num("MaximumRangeAirplaneGRU");
    a.physical_damages = f.num("PhysicalDamages");
    a.suppress_damages = f.num("SuppressDamages");
    a.radius_splash_physical_damages_gru = f.num("RadiusSplashPhysicalDamagesGRU");
    a.radius_splash_suppress_damages_gru = f.num("RadiusSplashSuppressDamagesGRU");
    a.shots_count_per_salvo = f.num("ShotsCountPerSalvo");
    a.simultaneous_shots_count = f.num("SimultaneousShotsCount");
    a.aiming_time = f.num("AimingTime");
    a.time_between_two_shots = f.num("TimeBetweenTwoShots");
    a.time_between_two_salvos = f.num("TimeBetweenTwoSalvos");
    a.projectile_speed_gru = f.num("ProjectileSpeedGRU");
    a.dispersion_at_max_range_gru = f.num("DispersionAtMaxRangeGRU");
    a.supply_cost = f.num("SupplyCost");
    a.can_shoot_on_position = f.boolean("CanShootOnPosition");
    a.can_shoot_while_moving = f.boolean("CanShootWhileMoving");
    a.is_fire_and_forget = f.boolean("IsFireAndForget");
    a.tir_indirect = f.boolean("TirIndirect");
    a.force_hit_top_armor_on_success = f.boolean("ForceHitTopArmorOnSuccess");
    a.compute_armor_from_impact_location = f.boolean("ComputeArmorFromImpactLocation");
    a.piercing_weapon = f.boolean("PiercingWeapon");
    a.tandem_charge = f.boolean("TandemCharge");
    if let Some(modifiers) = f.get("BaseHitValueModifiers") {
        let read = |name| {
            capture(
                Some(modifiers),
                &format!(r"\(\s*EBaseHitValueModifier/{name},\s*([-+0-9.eE]+)\s*\)"),
            )
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(0.)
        };
        a.accuracy_stationary = Some(read("Base") + read("Idling"));
        a.accuracy_moving = Some(read("Base") + read("Moving"));
    }
    if let (Some(min), Some(max)) = (
        f.num("TimeBetweenTwoSalvos_Min"),
        f.num("TimeBetweenTwoSalvos_Max"),
    ) && min >= 0.
        && max >= min
    {
        a.time_between_two_salvos = Some((min + max) / 2.);
    }

    Ok(a)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_and_inline_ammunition_share_the_weapon_analysis() {
        let source = "Gun is TWeaponManagerModuleDescriptor(Salves = [4,5] TurretDescriptorList = [TTurret(MountedWeaponDescriptorList = [TMountedWeaponDescriptor(AmmoBoxIndex = 0 Ammunition = ~/Local), TMountedWeaponDescriptor(AmmoBoxIndex = 1 Ammunition = TAmmunitionDescriptor(Arme = TDamageTypeRTTI(Index = 1) PhysicalDamages = 3.0))])])\nLocal is TAmmunitionDescriptor(PhysicalDamages = 4.0)";
        let (weapons, inline) = weapon_data(source).unwrap();
        let gun = &weapons["Gun"];
        assert_eq!(gun.mounted_weapons[0].ammunition_name, "Local");
        assert_eq!(inline["Local"].physical_damages, Some(4.));
        let ammo = &inline[&gun.mounted_weapons[1].ammunition_name];
        assert_eq!(ammo.physical_damages, Some(3.));
        assert_eq!(ammo.damage_family, None);
        assert_eq!(ammo.damage_index, Some(1.));
        assert!(reference(Some("$/Other/Local"), "$/GFX/Weapon/").is_none());
        assert!(reference(Some("nil"), "$/GFX/Weapon/").is_none());
        assert!(
            parse_ammo("fixture", "TAmmunitionDescriptor(FireDescriptor = nil)")
                .unwrap()
                .fire_descriptor_name
                .is_none()
        );
    }
}
