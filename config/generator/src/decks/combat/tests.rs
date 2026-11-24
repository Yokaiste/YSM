use super::*;

#[test]
fn unknown_unit_resistances_warn_once_and_leave_known_profiles_usable() {
    let table = "D is TGameplayDamageResistanceContainer(DamageFamilyCounts = [(DamageFamily_test, 1)] ResistanceFamilyCounts = [(ResistanceFamily_vehicule, 3), (ResistanceFamily_blindage, 1), (ResistanceFamily_infanterie, 1)] Values = [[1,2,3,10,7]])";
    let mut ammo = Ammunition::from([
        (
            "normal".into(),
            Ammo {
                name: "normal".into(),
                damage_family: Some("test".into()),
                damage_index: Some(1.),
                ..Default::default()
            },
        ),
        (
            "top".into(),
            Ammo {
                name: "top".into(),
                damage_family: Some("test".into()),
                damage_index: Some(1.),
                force_hit_top_armor_on_success: Some(true),
                ..Default::default()
            },
        ),
    ]);
    let entities = [
        Entity {
            name: "Descriptor_Unit_HQ45E_LY1_CN".into(),
            front_armor: Some(1.),
            front_resistance: Some(Resistance {
                family: "blindage".into(),
                index: 1,
            }),
            top_resistance: Some(Resistance {
                family: "vehicule".into(),
                index: 4,
            }),
            ..Default::default()
        },
        Entity {
            name: "Fixture_Infantry".into(),
            front_resistance: Some(Resistance {
                family: "infanterie".into(),
                index: 1,
            }),
            ..Default::default()
        },
    ];
    let warnings = damage_profiles(&mut ammo, &entities, table, "").unwrap();
    assert_eq!(warnings.len(), 1);
    assert!(
        warnings[0].contains("Descriptor_Unit_HQ45E_LY1_CN")
            && warnings[0].contains("ResistanceTop")
            && warnings[0].contains("vehicule:4")
    );
    assert_eq!(ammo["normal"].damage_multipliers.unwrap().armor, 10.);
    assert_eq!(ammo["top"].damage_multipliers.unwrap().armor, 0.);
    assert_eq!(ammo["top"].damage_multipliers.unwrap().ground, 7.);
    let mut vanilla = entities[0].clone();
    vanilla.name = "Fixture_Vanilla".into();
    for targets in [
        vec![vanilla.clone()],
        vec![vanilla.clone(), entities[0].clone()],
        vec![entities[0].clone(), vanilla],
    ] {
        assert!(damage_profiles(&mut ammo, &targets, table, "").is_err());
    }
    let valid_table = table
        .replace(
            "(ResistanceFamily_vehicule, 3)",
            "(ResistanceFamily_vehicule, 4)",
        )
        .replace("[[1,2,3,10,7]]", "[[1,2,3,4,10,7]]");
    assert!(
        damage_profiles(&mut ammo, &entities, &valid_table, "")
            .unwrap()
            .is_empty()
    );
    assert_eq!(ammo["top"].damage_multipliers.unwrap().armor, 4.);
}

#[test]
fn enum_defaults_and_flat_addresses_preserve_damage_table_bounds() {
    let table = "D is TGameplayDamageResistanceContainer(DamageFamilyCounts = [(DamageFamily_first, 1), (DamageFamily_second, 1)] ResistanceFamilyCounts = [(ResistanceFamily_infanterie, 1)] Values = [[2], [7]])";
    let mut ammo = Ammunition::from([(
        "fixture".into(),
        Ammo {
            name: "fixture".into(),
            damage_index: Some(2.),
            ..Default::default()
        },
    )]);
    let unit = Entity {
        front_resistance: Some(Resistance {
            family: "infanterie".into(),
            index: 1,
        }),
        ..Default::default()
    };
    damage_profiles(
        &mut ammo,
        &[unit],
        table,
        "DamageFamily_first is 0\nDamageFamily_second is 1",
    )
    .unwrap();
    assert_eq!(ammo["fixture"].damage_multipliers.unwrap().ground, 7.);
    ammo.get_mut("fixture").unwrap().damage_index = Some(3.);
    assert!(damage_profiles(&mut ammo, &[], table, "DamageFamily_first is 0").is_err());
}

#[test]
fn damage_matrix_rejects_fractional_indices_and_invalid_family_counts() {
    let source = "Damage is TGameplayDamageResistanceContainer(\nDamageFamilyCounts = [(DamageFamily_test, 1)]\nResistanceFamilyCounts = [(ResistanceFamily_test, 1)]\nValues = [[1]]\n)";
    let mut ammo = Ammunition::from([(
        "fixture".into(),
        Ammo {
            name: "fixture".into(),
            damage_family: Some("test".into()),
            damage_index: Some(1.),
            ..Default::default()
        },
    )]);
    damage_profiles(&mut ammo, &[], source, "").unwrap();
    for index in [1.5, 0., -1., 2., f64::INFINITY, f64::NAN] {
        ammo.get_mut("fixture").unwrap().damage_index = Some(index);
        assert!(
            damage_profiles(&mut ammo, &[], source, "").is_err(),
            "{index}"
        );
    }
    for counts in [
        "[(DamageFamily_test, 1), (DamageFamily_test, 1)]".to_owned(),
        format!(
            "[(DamageFamily_test, {}), (DamageFamily_other, 1)]",
            usize::MAX
        ),
    ] {
        let invalid = source.replace("[(DamageFamily_test, 1)]", &counts);
        assert!(damage_profiles(&mut Ammunition::new(), &[], &invalid, "").is_err());
    }
}
