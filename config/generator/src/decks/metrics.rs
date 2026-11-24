use std::ops::{Index, IndexMut};
#[derive(Clone, Copy, Debug, Eq, PartialEq, Hash)]
#[repr(usize)]
pub enum M {
    AirOptics,
    SmokeSupport,
    AlphaArmor,
    AlphaGround,
    AlphaHelo,
    AlphaPlane,
    AntiArmor,
    AntiGround,
    AntiHelo,
    AntiPlane,
    Ammo,
    Amphibious,
    ArmorPenetration,
    Availability,
    BurstDps,
    CloseCombat,
    Command,
    DirectFire,
    Effect,
    FireOnMove,
    Indirect,
    Initiative,
    Mobility,
    Optics,
    OneShotArmor,
    OneShotGround,
    OneShotHelo,
    OneShotPlane,
    Precision,
    RangeArmor,
    RangeGround,
    RangeHelo,
    RangePlane,
    Response,
    Splash,
    Stealth,
    Supply,
    Suppression,
    SustainedDps,
    Survivability,
    Value,
    WeaponVariety,
    AreaDenial,
    Sead,
}
pub const ALL: [M; 44] = [
    M::AirOptics,
    M::SmokeSupport,
    M::AlphaArmor,
    M::AlphaGround,
    M::AlphaHelo,
    M::AlphaPlane,
    M::AntiArmor,
    M::AntiGround,
    M::AntiHelo,
    M::AntiPlane,
    M::Ammo,
    M::Amphibious,
    M::ArmorPenetration,
    M::Availability,
    M::BurstDps,
    M::CloseCombat,
    M::Command,
    M::DirectFire,
    M::Effect,
    M::FireOnMove,
    M::Indirect,
    M::Initiative,
    M::Mobility,
    M::Optics,
    M::OneShotArmor,
    M::OneShotGround,
    M::OneShotHelo,
    M::OneShotPlane,
    M::Precision,
    M::RangeArmor,
    M::RangeGround,
    M::RangeHelo,
    M::RangePlane,
    M::Response,
    M::Splash,
    M::Stealth,
    M::Supply,
    M::Suppression,
    M::SustainedDps,
    M::Survivability,
    M::Value,
    M::WeaponVariety,
    M::AreaDenial,
    M::Sead,
];
pub const SIMILARITY: [M; 41] = [
    M::AntiArmor,
    M::AntiGround,
    M::AntiHelo,
    M::AntiPlane,
    M::ArmorPenetration,
    M::CloseCombat,
    M::DirectFire,
    M::FireOnMove,
    M::Indirect,
    M::Initiative,
    M::Mobility,
    M::Optics,
    M::Precision,
    M::RangeArmor,
    M::RangeGround,
    M::RangeHelo,
    M::RangePlane,
    M::Splash,
    M::Stealth,
    M::Supply,
    M::Suppression,
    M::Survivability,
    M::Availability,
    M::Ammo,
    M::WeaponVariety,
    M::AlphaArmor,
    M::AlphaGround,
    M::AlphaHelo,
    M::AlphaPlane,
    M::BurstDps,
    M::Response,
    M::SustainedDps,
    M::Effect,
    M::OneShotArmor,
    M::OneShotGround,
    M::OneShotHelo,
    M::OneShotPlane,
    M::AirOptics,
    M::SmokeSupport,
    M::AreaDenial,
    M::Sead,
];
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Metrics(pub [f64; 44]);
impl Default for Metrics {
    fn default() -> Self {
        Self([0.; 44])
    }
}
impl Index<M> for Metrics {
    type Output = f64;
    fn index(&self, k: M) -> &f64 {
        &self.0[k as usize]
    }
}
impl IndexMut<M> for Metrics {
    fn index_mut(&mut self, k: M) -> &mut f64 {
        &mut self.0[k as usize]
    }
}
impl Metrics {
    pub fn add(&mut self, weights: &[(M, f64)]) {
        for (m, w) in weights {
            self[*m] += w;
        }
    }
    pub fn score(&self, weights: &[(M, f64)]) -> f64 {
        weights.iter().map(|(m, w)| self[*m] * w).sum()
    }
    pub fn strongest(self) -> f64 {
        [
            M::AntiArmor,
            M::AntiGround,
            M::AntiHelo,
            M::AntiPlane,
            M::Indirect,
            M::Sead,
        ]
        .iter()
        .map(|m| self[*m])
        .fold(0., f64::max)
    }
}

#[cfg(test)]
pub const NAMES: [&str; 44] = [
    "airOptics",
    "smokeSupport",
    "alphaArmor",
    "alphaGround",
    "alphaHelo",
    "alphaPlane",
    "antiArmor",
    "antiGround",
    "antiHelo",
    "antiPlane",
    "ammo",
    "amphibious",
    "armorPenetration",
    "availability",
    "burstDps",
    "closeCombat",
    "command",
    "directFire",
    "effect",
    "fireOnMove",
    "indirect",
    "initiative",
    "mobility",
    "optics",
    "oneShotArmor",
    "oneShotGround",
    "oneShotHelo",
    "oneShotPlane",
    "precision",
    "rangeArmor",
    "rangeGround",
    "rangeHelo",
    "rangePlane",
    "response",
    "splash",
    "stealth",
    "supply",
    "suppression",
    "sustainedDps",
    "survivability",
    "value",
    "weaponVariety",
    "areaDenial",
    "sead",
];
