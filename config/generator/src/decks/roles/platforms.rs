use super::*;

pub fn platform_variants(a: &mut [Analysis], entities: &[Entity]) {
    let mut roles: IndexMap<String, Vec<usize>> = IndexMap::new();
    for (i, a) in a.iter().enumerate() {
        for token in &a.roles {
            if ["primary:", "type:", "role:", "capability:"]
                .iter()
                .any(|p| token.starts_with(p))
            {
                roles.entry(token.clone()).or_default().push(i);
            }
        }
    }
    for (role, matching) in roles {
        if matching.len() < 2 {
            continue;
        }
        let mut platforms: IndexMap<&str, Vec<usize>> = IndexMap::new();
        for i in &matching {
            platforms
                .entry(platform(&entities[a[*i].entity]))
                .or_default()
                .push(*i);
        }
        if platforms.len() < 2 {
            continue;
        }
        let always = platforms.contains_key("wheeled_vehicle")
            && platforms.contains_key("tracked_vehicle")
            && platforms
                .keys()
                .all(|p| ["wheeled_vehicle", "tracked_vehicle"].contains(p));
        let clusters = |indices: &[usize]| {
            indices
                .iter()
                .map(|i| a[*i].similarity_key.as_str())
                .collect::<HashSet<_>>()
                .len()
        };
        let total = clusters(&matching);
        let strength = matching
            .iter()
            .map(|i| a[*i].metrics.strongest())
            .fold(0., f64::max);
        let mut additions = Vec::new();
        for (platform, indices) in platforms {
            if !always {
                if clusters(&indices) > total / 2 {
                    continue;
                }
                let platform_strength = indices
                    .iter()
                    .map(|i| a[*i].metrics.strongest())
                    .fold(0., f64::max);
                if strength > 0. && platform_strength < strength * 0.55 {
                    continue;
                }
            }
            let name = normalize(role.split_once(':').map_or("", |(_, s)| s));
            for i in indices {
                additions.push((i, format!("capability:platform_{platform}_{name}")))
            }
        }
        for (i, t) in additions {
            a[i].add_role(t)
        }
    }
}
