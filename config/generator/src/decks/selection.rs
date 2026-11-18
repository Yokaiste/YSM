use super::{
    analysis::{Analysis, median},
    cards::SelectionKind,
    config::Config,
    data::*,
    metrics::{ALL, M},
    roles::{Role, RoleKind},
    scoring::{self, Perspective},
    similarity,
};
use std::collections::{HashMap, HashSet};
#[derive(Clone, Debug)]
pub struct Selection {
    pub analysis: usize,
    pub role: String,
    pub kind: SelectionKind,
    pub score: f64,
    pub priority: f64,
}
pub fn coverage(role: &Role) -> String {
    if matches!(role.kind, RoleKind::Primary | RoleKind::Type) {
        return format!(
            "{}:{}",
            if role.options >= 3 { "main" } else { "pair" },
            role.key.split_once(':').map_or("", |(_, s)| s)
        );
    }
    match role.options {
        2 => format!("pair:{}", role.key),
        3 => format!("triple:{}", role.key),
        _ => role.key.clone(),
    }
}
fn split_platform(a: &str, b: &str) -> bool {
    ["wheeled_vehicle", "tracked_vehicle"].contains(&a)
        && ["wheeled_vehicle", "tracked_vehicle"].contains(&b)
        && a != b
}
fn group(a: &Analysis) -> usize {
    match a.profile.platform {
        "wheeled_vehicle" => 1,
        "tracked_vehicle" => 2,
        _ => 0,
    }
}
pub fn selections(
    role: &Role,
    a: &[Analysis],
    entities: &[Entity],
    average: f64,
    context: &Context,
    config: &Config,
) -> Vec<Selection> {
    let fit: Vec<_> = a
        .iter()
        .map(|a| scoring::role_score(a, &entities[a.entity], role, Some(Perspective::Best)))
        .collect();
    let primary = matches!(role.kind, RoleKind::Primary | RoleKind::Type);
    let ranked: Vec<_> = (0..a.len())
        .filter(|i| {
            if primary {
                fit[*i].1
            } else {
                fit[*i].1 || fit[*i].0 > 500.
            }
        })
        .collect();
    if ranked.is_empty() {
        return Vec::new();
    }
    let exact: Vec<_> = ranked.iter().copied().filter(|i| fit[*i].1).collect();
    let preferred = if exact.is_empty() { &ranked } else { &exact };
    let mut scores = vec![[0.; 3]; a.len()];
    for i in preferred {
        let analysis = &a[*i];
        let entity = &entities[analysis.entity];
        let best = scoring::perspective(analysis, entity, role, average, Perspective::Best);
        scores[*i] = if role.price_sensitive() {
            [
                scoring::perspective(analysis, entity, role, average, Perspective::Recommended),
                best,
                scoring::perspective(analysis, entity, role, average, Perspective::Cheap),
            ]
        } else {
            [best; 3]
        };
    }
    let strength = |i: usize| scores[i][1] - if fit[i].1 { 600. } else { 0. };
    let perspectives = if role.price_sensitive() {
        vec![
            Perspective::Best,
            Perspective::Recommended,
            Perspective::Cheap,
        ]
    } else {
        vec![Perspective::Best; role.options]
    };
    let purposes: Vec<_> = a.iter().map(|a| &a.profile.diversity).collect();
    let redundant = |i: usize, j: usize| {
        if split_platform(a[i].profile.platform, a[j].profile.platform) {
            return false;
        }
        if similarity::near(a[i].view(entities), a[j].view(entities)) {
            return true;
        }
        if similarity::jaccard(purposes[i], purposes[j]) < 0.8 {
            return false;
        }
        let differences: Vec<_> = ALL
            .iter()
            .filter(|m| **m != M::Value && role.focus[**m] >= 0.5)
            .map(|m| (a[i].relative[*m] - a[j].relative[*m]).abs())
            .collect();
        !differences.is_empty()
            && differences.iter().sum::<f64>() / differences.len() as f64 <= 65.
            && differences.iter().copied().fold(0., f64::max) <= 125.
    };
    let mut chosen: Vec<usize> = Vec::new();
    let mut result = Vec::new();
    let mut recommended_cost = None;
    for p in perspectives {
        let unused: Vec<_> = preferred
            .iter()
            .copied()
            .filter(|i| {
                !chosen.iter().any(|j| a[*j].entity == a[*i].entity)
                    && chosen.iter().all(|j| !redundant(*i, *j))
            })
            .collect();
        if unused.is_empty() {
            continue;
        }
        let mut best = [0f64; 3];
        for i in &unused {
            let g = group(&a[*i]);
            best[g] = best[g].max(fit[*i].0);
        }
        let floor = match (p, role.kind == RoleKind::Capability) {
            (Perspective::Best, true) => 0.72,
            (Perspective::Best, false) => 0.6,
            (Perspective::Recommended, true) => 0.58,
            (Perspective::Recommended, false) => 0.45,
            (Perspective::Cheap, true) => 0.48,
            (Perspective::Cheap, false) => 0.35,
        };
        let filtered: Vec<_> = unused
            .iter()
            .copied()
            .filter(|i| {
                unused.len() <= 1
                    || best[group(&a[*i])] <= 0.
                    || fit[*i].0 >= best[group(&a[*i])] * floor
            })
            .collect();
        let initial = if filtered.is_empty() {
            &unused
        } else {
            &filtered
        };
        let mut quality = initial.clone();
        if p != Perspective::Best && initial.len() > 1 {
            let reference = if p == Perspective::Cheap {
                preferred
            } else {
                &unused
            };
            let mut strongest = [0f64; 3];
            for i in reference {
                let g = group(&a[*i]);
                strongest[g] = strongest[g].max(strength(*i));
            }
            if strongest.iter().any(|s| *s > 0.) {
                let floor = if p == Perspective::Cheap {
                    if primary { 0.72 } else { 0.58 }
                } else if primary {
                    0.82
                } else {
                    0.58
                };
                quality.retain(|i| {
                    let best = strongest[group(&a[*i])];
                    best <= 0. || strength(*i) >= best * floor
                });
            }
        }
        let affordable = |pool: &[usize]| {
            if pool.len() <= 1 {
                return pool.to_vec();
            }
            let median = median(
                &pool
                    .iter()
                    .map(|i| entities[a[*i].entity].cost)
                    .collect::<Vec<_>>(),
            );
            let ceiling = median.min(recommended_cost.map_or(median, |cost: f64| cost * 0.9));
            pool.iter()
                .copied()
                .filter(|i| entities[a[*i].entity].cost <= ceiling)
                .collect::<Vec<_>>()
        };
        let mut pool = quality.clone();
        if p == Perspective::Recommended {
            pool.retain(|i| {
                quality.iter().all(|j| {
                    i == j
                        || split_platform(a[*i].profile.platform, a[*j].profile.platform)
                        || !(entities[a[*j].entity].cost <= entities[a[*i].entity].cost
                            && strength(*j) >= strength(*i) * 0.995
                            && (entities[a[*j].entity].cost < entities[a[*i].entity].cost
                                || strength(*j) > strength(*i) * 1.005))
                })
            });
        }
        if p == Perspective::Cheap {
            pool = affordable(&quality);
            if pool.is_empty() {
                let strongest = unused.iter().map(|i| strength(*i)).fold(0., f64::max);
                let relaxed: Vec<_> = filtered
                    .iter()
                    .copied()
                    .filter(|i| strongest <= 0. || strength(*i) >= strongest * 0.65)
                    .collect();
                pool = affordable(&relaxed);
            }
        }
        let mut support: HashMap<&str, usize> = HashMap::new();
        let mut covered = HashSet::new();
        let mut platforms = HashSet::new();
        if !chosen.is_empty() && preferred.len() >= 2 {
            for i in preferred {
                for token in purposes[*i] {
                    *support.entry(token.as_str()).or_default() += 1;
                }
            }
            for i in &chosen {
                covered.extend(a[*i].profile.tokens.iter().map(String::as_str));
                platforms.insert(platform(&entities[a[*i].entity]));
            }
        }
        let diversity = |i: usize| {
            if chosen.is_empty() || preferred.len() < 2 {
                return 0.;
            }
            let novel = purposes[i]
                .iter()
                .filter(|t| !covered.contains(t.as_str()))
                .map(|t| {
                    let ratio = support.get(t.as_str()).copied().unwrap_or(preferred.len()) as f64
                        / preferred.len() as f64;
                    if ratio <= 0.8 {
                        (1. - ratio) * 180.
                    } else {
                        0.
                    }
                })
                .sum::<f64>();
            novel.min(900.)
                + if platforms.contains(platform(&entities[a[i].entity])) {
                    0.
                } else {
                    320.
                }
        };
        let p_index = match p {
            Perspective::Recommended => 0,
            Perspective::Best => 1,
            Perspective::Cheap => 2,
        };
        pool.sort_by(|i, j| {
            (scores[*j][p_index] + diversity(*j))
                .total_cmp(&(scores[*i][p_index] + diversity(*i)))
                .then(
                    config
                        .country_rank(&entities[a[*i].entity], &context.coalition)
                        .cmp(&config.country_rank(&entities[a[*j].entity], &context.coalition)),
                )
                .then(
                    entities[a[*i].entity]
                        .cost
                        .total_cmp(&entities[a[*j].entity].cost),
                )
                .then_with(|| name_cmp(&entities[a[*i].entity].name, &entities[a[*j].entity].name))
        });
        let candidate = pool.into_iter().find(|i| {
            p == Perspective::Best
                || !role.price_sensitive()
                || chosen.is_empty()
                || chosen.iter().all(|j| {
                    let e = &entities[a[*i].entity];
                    let f = &entities[a[*j].entity];
                    split_platform(a[*i].profile.platform, a[*j].profile.platform)
                        || f.cost - e.cost >= 5f64.max(f.cost * 0.125)
                })
        });
        let Some(i) = candidate else { continue };
        chosen.push(i);
        if p == Perspective::Recommended {
            recommended_cost = Some(entities[a[i].entity].cost)
        }
        let rarity = if matches!(role.kind, RoleKind::Capability | RoleKind::Role) {
            3usize.saturating_sub(ranked.len()) as f64 * 160.
        } else {
            0.
        } + if fit[i].1 && role.kind == RoleKind::Capability {
            120.
        } else {
            0.
        };
        let priority = match role.kind {
            RoleKind::Primary => 7000.,
            RoleKind::Type => 6000.,
            RoleKind::Role => 5800.,
            RoleKind::Capability => 4800.,
            RoleKind::Trait => 4000.,
        } + match p {
            Perspective::Best => 320.,
            Perspective::Recommended => 220.,
            Perspective::Cheap => 80.,
        } + rarity;
        result.push(Selection {
            analysis: i,
            role: coverage(role),
            kind: SelectionKind::role(primary, p),
            score: scores[i][p_index],
            priority,
        });
    }
    result
}
