use super::*;

pub fn entities(source: &str, kind: Kind, directives: &[String; 3]) -> Result<Vec<Entity>> {
    let lines: Vec<_> = source.split_inclusive('\n').collect();
    let comments: Vec<_> = lines
        .iter()
        .map(|line| {
            line.split_once("//")
                .map(|(_, c)| c.trim().to_lowercase())
                .unwrap_or_default()
        })
        .collect();
    let below = comments.iter().position(|c| c.contains(&directives[1]));
    let mut line_index = 0;
    let mut line_start = 0;
    let mut seen = HashSet::new();
    let mut selected = Vec::new();
    for b in ndf::scan(source)?
        .into_iter()
        .filter(|b| b.type_name.split_whitespace().next() == Some("TEntityDescriptor"))
    {
        let Some(name) = b.name else { continue };
        while line_index + 1 < lines.len() && line_start + lines[line_index].len() <= b.span.start {
            line_start += lines[line_index].len();
            line_index += 1;
        }
        let here = |d: &str| {
            comments.get(line_index).is_some_and(|c| c.contains(d))
                || line_index
                    .checked_sub(1)
                    .and_then(|i| comments.get(i))
                    .is_some_and(|c| c.contains(d))
        };
        if !here(&directives[2]) && (below.is_some_and(|i| line_index >= i) || here(&directives[0]))
        {
            continue;
        }
        if !seen.insert(name) {
            continue;
        }
        selected.push((name, &source[b.span]));
    }
    parallel::map(
        &selected,
        parallel::Limits::from_env(),
        |(_, text)| text.len().saturating_mul(8),
        |(name, text)| entity(name, text, kind),
    )
    .into_iter()
    .collect()
}

fn entity(name: &str, text: &str, kind: Kind) -> Result<Entity> {
    let f = Fields::new(text)?;
    let mut e = Entity {
        name: name.to_string(),
        kind,
        tags: tags(f.get("TagSet"))?,
        specialties: tags(f.get("SpecialtiesList"))?,
        transportable_tags: tags(f.get("TransportableTagSet"))?,
        country: f.string("MotherCountry"),
        coalition: f.suffix("Coalition", "TWargameCoalition/"),
        factory_type: f.suffix("FactoryType", "Factory/"),
        unit_role: f.string("UnitRole"),
        strategic_type: f.suffix("TypeStrategicCount", "ETypeStrategicDetailedCount/"),
        menu_icon_texture: f.string("MenuIconTexture"),
        spawn_type: f.suffix("SpawnType", "EShowroomSpawnType/"),
        pathfind_type: f.suffix("PathfindType", "$/Pathfind/PathfindTypes/"),
        moving_type: f.suffix("UnitMovingType", "EUnitMovingType/"),
        order_availability_name: f.suffix("ValidOrders", "~/"),
        cost: capture(
            f.get("ProductionRessourcesNeeded"),
            r"Resource_CommandPoints,\s*([-+]?[0-9]+)",
        )
        .and_then(|v| v.parse().ok())
        .unwrap_or(0.),
        can_assist: f.boolean("CanAssist"),
        ..Entity::default()
    };
    e.concealment_bonus = f.num("UnitConcealmentBonus");
    e.identify_base_probability = f.num("IdentifyBaseProbability");
    e.hit_roll_ecm = f.num("HitRollECM");
    e.max_physical_damages = f.num("MaxPhysicalDamages");
    e.max_speed_kmph = f.num("MaxSpeedInKmph");
    e.speed_bonus_factor_on_road = f.num("SpeedBonusFactorOnRoad");
    e.fuel_capacity = f.num("FuelCapacity");
    e.fuel_move_duration = f.num("FuelMoveDuration");
    e.production_time = f.num("ProductionTime");
    e.deployment_shift_gru = f.num("DeploymentShiftGRU");
    e.weapon_deployment_time = f.num("TimeForWeaponDeployment");
    e.travel_duration = f.num("TravelDuration");
    e.evacuation_time = f.num("EvacuationTime");
    e.agility_radius_gru = f.num("AgilityRadiusGRU");
    e.upkeep_percentage = f.num("UpkeepPercentage");
    e.supply_capacity = f.num("SupplyCapacity");
    e.supply_priority = f.num("SupplyPriority");
    let vision = f.get("VisionRange").or(f.get("VisionRangesGRU"));
    let optics = f.get("OpticalStrength").or(f.get("OpticalStrengths"));
    e.vision_range = metric(vision, "EVisionRange", true);
    e.air_vision_range = metric(vision, "EVisionRange", false);
    e.optical_strength = metric(optics, "EOpticalStrength", true);
    e.air_optical_strength = metric(optics, "EOpticalStrength", false);
    for (key, dst) in [
        ("ResistanceFront", &mut e.front_armor),
        ("ResistanceSides", &mut e.side_armor),
        ("ResistanceRear", &mut e.rear_armor),
        ("ResistanceTop", &mut e.top_armor),
    ] {
        *dst = resistance(f.get(key)).map(|r| {
            if r.family == "blindage" {
                r.index as f64
            } else {
                0.
            }
        });
    }
    e.front_resistance = resistance(f.get("ResistanceFront"));
    e.top_resistance = resistance(f.get("ResistanceTop"));
    if let Some(modules) = f.get("ModulesDescriptors") {
        e.weapon_descriptor_names = unique(ndf::read::entries(modules)?.iter().filter_map(|e| {
            e.text
                .trim()
                .strip_prefix("$/GFX/Weapon/")
                .filter(|n| n.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'))
                .map(str::to_string)
        }));
    }
    for token in tokens(text)? {
        if token == "TTransportableModuleDescriptor" {
            e.is_transportable = true
        }
        if token == "TSupplyModuleDescriptor" {
            e.has_supply_module = true
        }
        if let Some(n) = token.strip_prefix("$/GFX/EffectCapacity/") {
            e.capacity_names.push(n.to_string())
        }
    }
    e.capacity_names = unique(e.capacity_names);
    Ok(e)
}
pub fn hidden(
    entities: &[Entity],
    divisions: &[Division],
    matrices: &HashMap<String, Matrix>,
    config: &super::super::config::Config,
) -> HashSet<EntityId> {
    let index: HashMap<_, _> = entities.iter().map(|e| (e.name.as_str(), e)).collect();
    let mut visible = HashSet::new();
    let mut shelved = HashSet::new();
    for d in divisions {
        let matrix = d
            .cost_matrix_name
            .as_ref()
            .and_then(|n| matrices.get(n))
            .unwrap_or(&d.inline_cost_matrix);
        for (unit, transports) in &d.members {
            let costs = index
                .get(unit.as_str())
                .and_then(|e| e.factory_type.as_ref())
                .and_then(|f| matrix.get(f));
            let offers = costs.is_none_or(|c| {
                !c.is_empty()
                    && (d.max_activation_points.unwrap_or(0.) < 90. || c.iter().any(|v| *v != 0.))
            });
            let target = if offers { &mut visible } else { &mut shelved };
            target.insert(unit.as_str());
            target.extend(transports.iter().map(String::as_str));
        }
    }
    entities
        .iter()
        .enumerate()
        .filter(|(_, e)| {
            !config.is_mod(e)
                && !visible.contains(e.name.as_str())
                && (config.exclude_hidden || shelved.contains(e.name.as_str()))
        })
        .map(|(id, _)| id)
        .collect()
}
pub fn sellable(entities: &mut [Entity], source: &str) -> Result<()> {
    let mut names = HashSet::new();
    for b in ndf::scan(source)? {
        if let Some(name) = b.name
            && tokens(&source[b.span])?.contains(&"EOrderType/Sell")
        {
            names.insert(name);
        }
    }
    for e in entities {
        e.is_sellable = e
            .order_availability_name
            .as_deref()
            .is_some_and(|n| names.contains(n));
    }
    Ok(())
}
