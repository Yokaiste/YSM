use super::{
    analysis::{Analysis, median},
    data::*,
    focus::focus,
    metrics::{ALL, M, Metrics},
    similarity,
    weapons::{normalize, range_band},
};
use indexmap::IndexMap;
use std::collections::{BTreeSet, HashMap, HashSet};
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub enum RoleKind {
    Primary,
    Type,
    Role,
    Capability,
    Trait,
}
#[derive(Clone, Debug)]
pub struct Role {
    pub key: String,
    pub kind: RoleKind,
    pub options: usize,
    pub priority: f64,
    pub focus: Metrics,
}
impl Role {
    pub fn price_sensitive(&self) -> bool {
        matches!(self.kind, RoleKind::Primary | RoleKind::Type) && self.options == 3
    }
}
fn kind(s: &str) -> Option<RoleKind> {
    match s {
        "primary" => Some(RoleKind::Primary),
        "type" => Some(RoleKind::Type),
        "role" => Some(RoleKind::Role),
        "capability" => Some(RoleKind::Capability),
        "trait" => Some(RoleKind::Trait),
        _ => None,
    }
}
fn options(
    kind: RoleKind,
    matching: &[usize],
    a: &[Analysis],
    entities: &[Entity],
    key: &str,
) -> usize {
    let max = if key == "capability:command" || matches!(kind, RoleKind::Primary | RoleKind::Type) {
        3
    } else if key.starts_with("capability:indirect_delivery") {
        5
    } else if ["capability:stealth", "capability:mobile_area_air_defense"].contains(&key) {
        3
    } else {
        2
    };
    let mut representatives: Vec<usize> = Vec::new();
    for i in matching {
        if representatives
            .iter()
            .all(|j| !similarity::near(a[*i].view(entities), a[*j].view(entities)))
        {
            representatives.push(*i);
            if representatives.len() >= max {
                return max;
            }
        }
    }
    representatives.len().max(1)
}
fn empirical(token: &str, a: &[Analysis]) -> Metrics {
    let matching: Vec<_> = a.iter().filter(|a| a.exact.contains(token)).collect();
    let mut focus = Metrics::default();
    if matching.is_empty() || matching.len() == a.len() {
        return focus;
    }
    for m in ALL {
        if matches!(m, M::Value | M::Availability) {
            continue;
        }
        let advantage = matching.iter().map(|a| a.relative[m]).sum::<f64>() / matching.len() as f64
            - a.iter().map(|a| a.relative[m]).sum::<f64>() / a.len() as f64;
        if advantage >= 150. {
            focus[m] = (advantage / 180.).min(3.);
        }
    }
    focus
}
fn semantic(key: &str) -> String {
    let label = key
        .split_once(':')
        .map_or(key, |(_, s)| s)
        .to_ascii_lowercase();
    static PREFIX: std::sync::LazyLock<regex::Regex> =
        std::sync::LazyLock::new(|| regex::Regex::new(r"^(?:aircraft|air|avion)+").unwrap());
    static SUFFIX: std::sync::LazyLock<regex::Regex> = std::sync::LazyLock::new(|| {
        regex::Regex::new(
            r"(?:fixed_wing|rotary_wing|helicopter|plane|ground_vehicle|ground|vehicle|veh|hel)+$",
        )
        .unwrap()
    });
    let label = PREFIX.replace(&label, "");
    let label = SUFFIX.replace(&label, "");
    let s: String = label.chars().filter(char::is_ascii_alphanumeric).collect();
    match s.as_str() {
        "aa" | "antiplane" => "antiair".into(),
        "at" | "antitank" => "antiarmor".into(),
        _ => s,
    }
}
pub fn discover(a: &mut [Analysis], entities: &[Entity]) -> Vec<Role> {
    let mut support: IndexMap<String, (RoleKind, usize)> = IndexMap::new();
    for analysis in a.iter() {
        for token in &analysis.roles {
            if let Some(k) = kind(token.split(':').next().unwrap_or("")) {
                let entry = support.entry(token.clone()).or_insert((k, 0));
                entry.1 += 1;
            }
        }
    }
    let mut definitions = Vec::new();
    for (token, (kind, count)) in support {
        let semantic_focus = focus(&token, false);
        let learned = empirical(&token, a);
        if kind == RoleKind::Trait {
            let useful = token.starts_with("trait:effect_")
                || semantic_focus.0.iter().any(|v| *v != 0.)
                || learned.0.iter().any(|v| *v != 0.);
            if !useful
                || (!token.starts_with("trait:effect_")
                    && !token.contains("sf")
                    && !a.is_empty()
                    && count as f64 / a.len() as f64 > 0.8)
            {
                continue;
            }
        }
        if kind == RoleKind::Capability && !a.is_empty() && count as f64 / a.len() as f64 > 0.65 {
            continue;
        }
        let f = if semantic_focus.0.iter().any(|v| *v != 0.) {
            semantic_focus
        } else {
            learned
        };
        let matching: Vec<_> = a
            .iter()
            .enumerate()
            .filter(|(_, a)| a.exact.contains(&token))
            .map(|(i, _)| i)
            .collect();
        let options = options(kind, &matching, a, entities, &token);
        let priority = if kind == RoleKind::Capability {
            count.min(a.len().saturating_sub(count).max(1))
        } else {
            count
        } as f64
            * 100.
            + match kind {
                RoleKind::Primary => 50.,
                RoleKind::Type => 40.,
                RoleKind::Role => 30.,
                RoleKind::Capability => 20.,
                RoleKind::Trait => 10.,
            };
        definitions.push(Role {
            key: token.clone(),
            kind,
            options,
            priority,
            focus: if f.0.iter().any(|v| *v != 0.) {
                f
            } else {
                focus(&token, true)
            },
        });
    }
    let support: Vec<BTreeSet<_>> = definitions
        .iter()
        .map(|d| {
            a.iter()
                .filter(|a| a.exact.contains(&d.key))
                .map(|a| a.entity)
                .collect()
        })
        .collect();
    let mut parents: Vec<_> = (0..definitions.len()).collect();
    fn root(parents: &mut [usize], mut i: usize) -> usize {
        while parents[i] != i {
            parents[i] = parents[parents[i]];
            i = parents[i]
        }
        i
    }
    fn union(parents: &mut [usize], i: usize, j: usize) {
        let left = root(parents, i);
        let right = root(parents, j);
        parents[right] = left;
    }
    let mut exact: HashMap<(String, Vec<usize>), usize> = HashMap::new();
    let mut sem: IndexMap<String, Vec<usize>> = IndexMap::new();
    for (i, d) in definitions.iter().enumerate() {
        let key = (
            if d.key.starts_with("capability:platform_") {
                semantic(&d.key)
            } else {
                String::new()
            },
            support[i].iter().copied().collect(),
        );
        if let Some(j) = exact.get(&key) {
            union(&mut parents, *j, i)
        } else {
            exact.insert(key, i);
        }
        sem.entry(semantic(&d.key)).or_default().push(i);
    }
    for bucket in sem.values() {
        for (offset, i) in bucket.iter().enumerate() {
            for j in &bucket[offset + 1..] {
                if similarity::jaccard(&support[*i], &support[*j]) >= 0.6 {
                    union(&mut parents, *i, *j)
                }
            }
        }
    }
    let mut groups: IndexMap<usize, Vec<usize>> = IndexMap::new();
    for i in 0..definitions.len() {
        let r = root(&mut parents, i);
        groups.entry(r).or_default().push(i);
    }
    let mut result = Vec::new();
    for group in groups.values() {
        let canonical = *group
            .iter()
            .min_by(|i, j| {
                definitions[**i]
                    .kind
                    .cmp(&definitions[**j].kind)
                    .then(
                        definitions[**j]
                            .priority
                            .total_cmp(&definitions[**i].priority),
                    )
                    .then_with(|| name_cmp(&definitions[**i].key, &definitions[**j].key))
            })
            .unwrap();
        let mut d = definitions[canonical].clone();
        if group.len() > 1 {
            let matching: Vec<_> = a
                .iter()
                .enumerate()
                .filter(|(_, a)| group.iter().any(|i| a.exact.contains(&definitions[*i].key)))
                .map(|(i, _)| i)
                .collect();
            for i in &matching {
                a[*i].add_role(d.key.clone())
            }
            d.options = options(d.kind, &matching, a, entities, &d.key);
            d.priority = group
                .iter()
                .map(|i| definitions[*i].priority)
                .fold(0., f64::max);
            if !matches!(d.kind, RoleKind::Primary | RoleKind::Type) {
                for m in ALL {
                    d.focus[m] = group
                        .iter()
                        .map(|i| definitions[*i].focus[m])
                        .fold(0., f64::max);
                }
            }
        }
        result.push(d);
    }
    result.sort_by(|a, b| {
        b.priority
            .total_cmp(&a.priority)
            .then_with(|| name_cmp(&a.key, &b.key))
    });
    result
}

mod capabilities;
mod platforms;
pub use capabilities::capabilities;
pub use platforms::platform_variants;
