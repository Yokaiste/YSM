use super::metrics::{M, Metrics};
pub fn focus(token: &str, fallback: bool) -> Metrics {
    let normalized = token.to_ascii_lowercase();
    let terms: std::collections::HashSet<_> = normalized
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|s| !s.is_empty())
        .collect();
    let mut focus = Metrics::default();
    let wheeled = normalized.contains("platform_wheeled_vehicle_");
    let tracked = normalized.contains("platform_tracked_vehicle_");
    if normalized.contains("area_denial") || normalized.contains("napalm") {
        focus[M::AreaDenial] = 4.0;
        focus[M::AntiGround] = 1.0;
        focus[M::Splash] = 0.5;
    }

    if normalized.contains("loadout_armor") {
        focus[M::AntiArmor] += 2.8;
        focus[M::RangeArmor] += 0.8;
        focus[M::OneShotArmor] += 0.45;
    }
    if normalized.contains("loadout_ground") {
        focus[M::AntiGround] += 2.6;
        focus[M::AlphaGround] += 0.55;
        focus[M::Suppression] += 0.45;
    }
    if normalized.contains("loadout_helo") {
        focus[M::AntiHelo] += 2.8;
        focus[M::RangeHelo] += 0.8;
        focus[M::OneShotHelo] += 0.45;
    }
    if normalized.contains("loadout_plane") {
        focus[M::AntiPlane] += 2.8;
        focus[M::RangePlane] += 0.8;
        focus[M::OneShotPlane] += 0.45;
    }
    if normalized.contains("loadout_indirect") {
        focus[M::Indirect] += 2.8;
        focus[M::RangeGround] += 0.8;
        focus[M::AlphaGround] += 0.45;
    }

    if normalized.contains("anti_tank")
        || normalized.contains("tankdestroyer")
        || normalized.contains("tank_destroyer")
        || normalized.contains("chasseurdechar")
        || terms.contains(&"at")
        || terms.contains(&"td")
    {
        focus[M::AntiArmor] += 3.8;
        focus[M::AlphaArmor] += 1.1;
        focus[M::OneShotArmor] += 0.8;
        focus[M::BurstDps] += 0.45;
        focus[M::SustainedDps] += 0.55;
        focus[M::Response] += 0.35;
        focus[M::ArmorPenetration] += 1.5;
        focus[M::RangeArmor] += 1.1;
        focus[M::Ammo] += 0.6;
        if wheeled {
            focus[M::RangeArmor] += 1.7;
            focus[M::AntiArmor] += 1.35;
            focus[M::AlphaArmor] += 1.15;
            focus[M::ArmorPenetration] += 1.1;
            focus[M::Mobility] += 0.55;
            focus[M::Stealth] += 0.4;
            focus[M::Response] += 0.2;
        }
        if tracked {
            focus[M::Survivability] += 0.9;
            focus[M::FireOnMove] += 0.2;
        }
    }
    if normalized.contains("anti_plane")
        || terms.contains(&"aa")
        || terms.contains(&"manpad")
        || terms.contains(&"sam")
        || terms.contains(&"dca")
    {
        focus[M::AirOptics] += 0.4;
        focus[M::AntiPlane] += 3.4;
        focus[M::AlphaPlane] += 1.0;
        focus[M::OneShotPlane] += 0.8;
        focus[M::BurstDps] += 0.55;
        focus[M::Response] += 0.45;
        focus[M::AntiHelo] += 1.2;
        focus[M::RangePlane] += 1.1;
        focus[M::RangeHelo] += 0.45;
        focus[M::Mobility] += 0.4;
        focus[M::Survivability] += 0.3;
    }
    if normalized.contains("anti_helo") {
        focus[M::AntiHelo] += 3.1;
        focus[M::AlphaHelo] += 0.8;
        focus[M::OneShotHelo] += 0.65;
        focus[M::RangeHelo] += 1.0;
    }
    if normalized.contains("mobile_area_air_defense") {
        focus[M::AntiPlane] += 2.6;
        focus[M::AntiHelo] += 2.0;
        focus[M::RangePlane] += 1.5;
        focus[M::RangeHelo] += 1.0;
        focus[M::Survivability] += 0.65;
        focus[M::Mobility] += 0.65;
    }
    if normalized.contains("envelope_plane") {
        focus[M::AntiPlane] += 2.8;
        focus[M::RangePlane] += 2.4;
        focus[M::OneShotPlane] += 0.55;
    }
    if normalized.contains("envelope_helo") {
        focus[M::AntiHelo] += 2.8;
        focus[M::RangeHelo] += 2.4;
        focus[M::OneShotHelo] += 0.55;
    }
    if normalized.contains("envelope_armor") {
        focus[M::AntiArmor] += 2.8;
        focus[M::RangeArmor] += 2.4;
        focus[M::OneShotArmor] += 0.55;
    }
    if normalized.contains("envelope_indirect") {
        focus[M::Indirect] += 3.0;
        focus[M::RangeGround] += 2.4;
        focus[M::AlphaGround] += 0.6;
    }
    if normalized.contains("anti_infantry") {
        focus[M::AntiGround] += 3.4;
        focus[M::AlphaGround] += 0.8;
        focus[M::OneShotGround] += 0.45;
        focus[M::Suppression] += 1.5;
        focus[M::Splash] += 1.2;
    }
    if normalized.contains("mortar")
        || normalized.contains("howitzer")
        || normalized.contains("mlrs")
        || normalized.contains("indirect")
    {
        focus[M::Indirect] += 3.8;
        focus[M::AlphaGround] += 0.8;
        focus[M::OneShotGround] += 0.65;
        focus[M::BurstDps] += 0.55;
        focus[M::Response] += 0.5;
        focus[M::RangeGround] += 0.9;
        focus[M::Splash] += 1.2;
        focus[M::Ammo] += 0.5;
        focus[M::Mobility] += 0.45;
        focus[M::Initiative] += 0.3;
    }
    if normalized.contains("counter_battery") {
        focus[M::Indirect] += 3.2;
        focus[M::RangeGround] += 1.8;
        focus[M::Mobility] += 0.5;
        focus[M::AlphaGround] += 0.8;
        focus[M::Response] += 0.35;
    }
    if normalized.contains("indirect_delivery") {
        focus[M::Indirect] += 3.0;
        focus[M::AlphaGround] += 1.7;
        focus[M::Ammo] += 1.5;
        focus[M::BurstDps] += 1.2;
        focus[M::Suppression] += 1.0;
        focus[M::RangeGround] += 0.8;
        focus[M::Response] += 0.55;
        focus[M::Mobility] += 0.35;
    }
    if normalized.contains("indirect_saturation") {
        focus[M::Indirect] += 2.8;
        focus[M::BurstDps] += 2.0;
        focus[M::Suppression] += 1.6;
        focus[M::Splash] += 1.2;
    }
    if normalized.contains("indirect_heavy_shot") {
        focus[M::Indirect] += 2.8;
        focus[M::OneShotGround] += 2.2;
        focus[M::AlphaGround] += 1.6;
        focus[M::RangeGround] += 1.2;
    }
    if normalized.contains("precision_strike") || normalized.contains("top_attack") {
        focus[M::Precision] += 4.2;
        focus[M::RangeGround] += 0.7;
        focus[M::Stealth] += 1.1;
        focus[M::Survivability] += 0.6;
    }
    if normalized.contains("reco") || normalized.contains("recon") || normalized.contains("scout") {
        focus[M::Optics] += 3.4;
        focus[M::Stealth] += 2.2;
        focus[M::Mobility] += 1.1;
    }
    if normalized.contains("optics") || normalized.contains("radar") {
        focus[M::Optics] += 3.2;
        focus[M::RangePlane] += 0.2;
        focus[M::RangeHelo] += 0.1;
        focus[M::Stealth] += 0.4;
    }
    if normalized.contains("jammer")
        || normalized.contains("sigint")
        || normalized.contains("singint")
        || normalized.contains("electronic_warfare")
        || terms.contains(&"ew")
    {
        focus[M::Effect] += 2.6;
        focus[M::Optics] += 2.4;
        focus[M::Stealth] += 1.2;
        focus[M::Survivability] += 0.6;
    }
    if normalized.contains("command") || terms.contains(&"cmd") {
        focus[M::Command] += 4.2;
        focus[M::Survivability] += 1.0;
    }
    if normalized.contains("supply") || normalized.contains("logistic") {
        focus[M::Supply] += 4.2;
        focus[M::Mobility] += 1.3;
    }
    if normalized.contains("long_range") || normalized.contains("range") {
        focus[M::RangeGround] += 1.4;
        focus[M::RangePlane] += 0.65;
        focus[M::RangeHelo] += 0.65;
        focus[M::AntiPlane] += 0.35;
        focus[M::AntiArmor] += 0.35;
    }
    if normalized.contains("shock")
        || normalized.contains("choc")
        || normalized.contains("engineer")
        || normalized.contains("assault")
    {
        focus[M::CloseCombat] += 2.5;
        focus[M::AntiGround] += 1.4;
        focus[M::Survivability] += 2.2;
        focus[M::Suppression] += 0.6;
    }
    if normalized.contains("sf") || normalized.contains("special_forces") {
        focus[M::Stealth] += 2.8;
        focus[M::Mobility] += 1.1;
        focus[M::AntiGround] += 1.6;
    }
    if normalized.contains("forward_deploy") || normalized.contains("initiative") {
        focus[M::Initiative] += 3.8;
        focus[M::Mobility] += 0.8;
        focus[M::Optics] += 0.4;
    }
    if normalized.contains("gunship") {
        focus[M::AntiGround] += 2.4;
        focus[M::AntiArmor] += 1.8;
        focus[M::Optics] += 0.8;
        focus[M::Mobility] += 0.6;
    }
    if normalized.contains("fire_on_move") {
        focus[M::FireOnMove] += 4.0;
        focus[M::Mobility] += 0.7;
    }
    if normalized.contains("radar_guided") {
        focus[M::AntiPlane] += 2.6;
        focus[M::RangePlane] += 1.5;
        focus[M::RangeHelo] += 0.5;
    }
    if normalized.contains("sead") {
        focus[M::Sead] += 4.0;
        focus[M::RangeGround] += 1.3;
        focus[M::Mobility] += 0.5;
    }
    if normalized.contains("smoke") {
        focus[M::SmokeSupport] += 3.0;
        focus[M::Mobility] += 0.4;
    }
    if normalized.contains("napalm") {
        focus[M::AntiGround] += 2.4;
        focus[M::Suppression] += 1.5;
        focus[M::Splash] += 0.8;
    }
    if normalized.contains("cluster") {
        focus[M::AntiArmor] += 2.2;
        focus[M::Splash] += 1.4;
        focus[M::RangeGround] += 0.5;
    }
    if normalized.contains("fire_and_forget")
        || normalized.contains("tandem")
        || normalized.contains("high_off_boresight")
    {
        focus[M::AntiArmor] += 1.8;
        focus[M::ArmorPenetration] += 0.6;
        focus[M::AntiPlane] += 1.2;
        focus[M::AntiHelo] += 1.2;
        focus[M::RangeGround] += 0.5;
    }
    if normalized.contains("close_quarters") {
        focus[M::CloseCombat] += 3.2;
        focus[M::AntiGround] += 0.8;
        focus[M::Suppression] += 1.2;
    }
    if normalized.contains("amphib") {
        focus[M::Amphibious] += 3.5;
        focus[M::Mobility] += 0.8;
    }
    if normalized.contains("durable") || normalized.contains("armor") {
        focus[M::Survivability] += 3.5;
        focus[M::AntiArmor] += 1.1;
        focus[M::ArmorPenetration] += 0.55;
    }
    if normalized.contains("fast") {
        focus[M::Mobility] += 3.3;
        focus[M::Stealth] += 0.4;
    }
    if normalized.contains("stealth") {
        focus[M::Stealth] += 13.0;
        focus[M::Survivability] += 0.5;
        focus[M::Precision] += 0.35;
    }
    if normalized.contains("weapon_variety") {
        focus[M::WeaponVariety] += 3.8;
        focus[M::AntiGround] += 0.7;
        focus[M::AntiArmor] += 0.7;
        focus[M::AntiPlane] += 0.7;
        focus[M::AntiHelo] += 0.7;
    }
    if normalized.contains("heavy_alpha") {
        focus[M::AlphaArmor] += 1.6;
        focus[M::AlphaGround] += 1.6;
        focus[M::AlphaHelo] += 1.6;
        focus[M::AlphaPlane] += 1.6;
        focus[M::Response] += 0.4;
    }
    if normalized.contains("rapid_response") {
        focus[M::Response] += 3.2;
        focus[M::BurstDps] += 2.2;
    }
    if normalized.contains("sustained_fire") {
        focus[M::SustainedDps] += 3.8;
    }
    if normalized.contains("positive_effect") || normalized.contains("effect_") {
        focus[M::Effect] += 3.5;
    }
    if normalized.contains("infantry") {
        focus[M::Survivability] += 3.2;
        focus[M::AntiGround] += 1.7;
        focus[M::AntiArmor] += 0.35;
        focus[M::CloseCombat] += 0.7;
        focus[M::WeaponVariety] += 0.35;
    }
    if normalized.contains("transport") {
        focus[M::Mobility] += 3.0;
        focus[M::Survivability] += 1.3;
        focus[M::FireOnMove] += 0.35;
        focus[M::WeaponVariety] += 0.2;
    }
    if normalized.contains("appui")
        || normalized.contains("air_support")
        || normalized.contains("hel_support")
    {
        focus[M::AntiGround] += 2.7;
        focus[M::AntiArmor] += 1.5;
        focus[M::Survivability] += 1.2;
        focus[M::WeaponVariety] += 0.45;
    }
    if normalized.contains("ifv") {
        focus[M::AntiGround] += 1.8;
        focus[M::AntiArmor] += 1.5;
        focus[M::Survivability] += 1.0;
        focus[M::Mobility] += 0.5;
        focus[M::WeaponVariety] += 0.45;
    }
    if terms.contains(&"hq") || normalized.contains("headquarters") {
        focus[M::Command] += 4.0;
        focus[M::Survivability] += 1.0;
        focus[M::Mobility] += 0.45;
    }
    if normalized.contains("endurance") {
        focus[M::Mobility] += 1.2;
        focus[M::Survivability] += 0.5;
    }
    if normalized.contains("suppression") {
        focus[M::Suppression] += 3.4;
        focus[M::Splash] += 1.2;
        focus[M::RangeGround] += 0.4;
    }
    if normalized.contains("high_availability") {
        focus[M::Availability] += 3.8;
    }

    if fallback && focus.0.iter().all(|v| *v == 0.) {
        focus.add(&[
            (M::Value, 1.1),
            (M::DirectFire, 1.),
            (M::Survivability, 0.9),
        ]);
    }
    focus
}
