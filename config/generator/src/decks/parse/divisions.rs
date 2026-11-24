use super::*;

pub fn cost_matrix(value: Option<&str>) -> Result<Matrix> {
    let mut result = Matrix::new();
    for entry in ndf::read::entries(value.unwrap_or("[]"))? {
        if let Some(factory) = capture(Some(entry.text), r"Factory/([A-Za-z0-9_]+)") {
            result.insert(
                factory,
                numbers(capture(Some(entry.text), r"(\[[^\[\]]*\])").as_deref())?,
            );
        }
    }
    Ok(result)
}
fn unit_ref(value: Option<&str>) -> Option<String> {
    capture(value, r"\$/GFX/Unit/([A-Za-z0-9_]+)")
}
fn unit_rules(value: Option<&str>) -> Result<Vec<(Rule, Vec<String>)>> {
    let mut result = Vec::new();
    for entry in ndf::read::entries(value.unwrap_or("[]"))?
        .iter()
        .filter(|e| e.type_name == Some("TDeckUniteRule"))
    {
        let f = Fields::new(entry.text)?;
        let Some(unit_name) = unit_ref(f.get("UnitDescriptor")) else {
            continue;
        };
        let mut multipliers = numbers(f.get("NumberOfUnitInPackXPMultiplier"))?;
        if multipliers.is_empty() {
            multipliers = Rule::fallback().multipliers
        }
        let transports = f
            .list("AvailableTransportList")?
            .iter()
            .filter_map(|v| unit_ref(Some(v)))
            .collect();
        result.push((
            Rule {
                unit_name,
                max_pack_number: f.num("MaxPackNumber").unwrap_or(0.).max(0.) as usize,
                number_of_unit_in_pack: f.num("NumberOfUnitInPack").unwrap_or(0.),
                multipliers,
            },
            transports,
        ));
    }
    Ok(result)
}
pub fn divisions(rules: &str, source: &str, ignored: &[regex::Regex]) -> Result<Vec<Division>> {
    let mut named = HashMap::new();
    for b in ndf::scan(rules)?
        .into_iter()
        .filter(|b| b.type_name == "TDeckDivisionRule")
    {
        if let Some(name) = b.name {
            let f = Fields::new(&rules[b.span])?;
            if let Some(list) = f.get("UnitRuleList") {
                named.insert(name, list);
            }
        }
    }
    let blocks = ndf::scan(source)?;
    let mut coalitions = HashMap::new();
    for b in blocks
        .iter()
        .filter(|b| b.type_name == "TDeckDivisionDescriptor")
    {
        if let Some(coalition) =
            Fields::new(&source[b.span.clone()])?.suffix("DivisionCoalition", "TWargameCoalition/")
        {
            coalitions.insert(coalition.to_lowercase(), coalition);
        }
    }
    let mut result = Vec::new();
    for b in blocks
        .into_iter()
        .filter(|b| b.type_name == "TDeckDivisionDescriptor")
    {
        let Some(name) = b.name else { continue };
        if matches(ignored, &format!("{name}_Rule")) {
            continue;
        }
        let f = Fields::new(&source[b.span])?;
        let coalition =
            f.suffix("DivisionCoalition", "TWargameCoalition/")
                .or(tags(f.get("DivisionTags"))?
                    .iter()
                    .find_map(|t| coalitions.get(t).cloned()));
        let division_rule = f.get("DivisionRule");
        let inline = division_rule
            .filter(|s| s.contains('('))
            .map(Fields::new)
            .transpose()?;
        let list = inline
            .as_ref()
            .and_then(|f| f.get("UnitRuleList"))
            .or_else(|| division_rule.and_then(|r| named.get(r).copied()));
        let entries = unit_rules(list)?;
        let matrix = f.get("CostMatrix").unwrap_or("");
        let cost_matrix_name = if !matrix.is_empty()
            && matrix
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_')
        {
            Some(matrix.to_string())
        } else {
            None
        };
        result.push(Division {
            coalition,
            max_activation_points: f.num("MaxActivationPoints"),
            inline_cost_matrix: if cost_matrix_name.is_none() {
                cost_matrix(Some(matrix))?
            } else {
                Matrix::new()
            },
            cost_matrix_name,
            members: entries
                .iter()
                .map(|(r, t)| (r.unit_name.clone(), t.clone()))
                .collect(),
            inline_rules: if inline.is_some() {
                entries.into_iter().map(|(r, _)| r).collect()
            } else {
                Vec::new()
            },
        });
    }
    Ok(result)
}
pub fn matrices(source: &str) -> Result<HashMap<String, Matrix>> {
    ndf::scan(source)?
        .into_iter()
        .filter(|b| b.type_name == "MAP" && b.name.is_some())
        .map(|b| {
            Ok((
                b.name.unwrap().to_string(),
                cost_matrix(Some(&source[b.span]))?,
            ))
        })
        .collect()
}
pub fn rules(
    source: &str,
    descriptors: &[Division],
    ignored: &[regex::Regex],
) -> Result<HashMap<String, Rule>> {
    let mut candidates: HashMap<String, Vec<Rule>> = HashMap::new();
    for b in ndf::scan(source)?
        .into_iter()
        .filter(|b| b.type_name == "TDeckDivisionRule")
    {
        let Some(name) = b.name else { continue };
        if matches(ignored, name) {
            continue;
        }
        for (r, _) in unit_rules(Fields::new(&source[b.span])?.get("UnitRuleList"))? {
            candidates.entry(r.unit_name.clone()).or_default().push(r);
        }
    }
    for d in descriptors {
        for r in &d.inline_rules {
            candidates
                .entry(r.unit_name.clone())
                .or_default()
                .push(r.clone());
        }
    }
    Ok(candidates
        .into_iter()
        .filter_map(|(name, mut rules)| {
            rules.retain(|r| {
                r.max_pack_number < 50 && r.number_of_unit_in_pack < 50. && r.peak() < 50
            });
            rules.sort_by(|a, b| {
                b.peak()
                    .cmp(&a.peak())
                    .then(b.max_pack_number.cmp(&a.max_pack_number))
                    .then(
                        b.number_of_unit_in_pack
                            .total_cmp(&a.number_of_unit_in_pack),
                    )
            });
            rules.into_iter().next().map(|r| (name, r))
        })
        .collect())
}
pub fn infer_coalitions(entities: &mut [Entity], divisions: &[Division]) {
    fn winner(votes: &HashMap<String, usize>) -> Option<String> {
        votes
            .iter()
            .min_by(|(a, av), (b, bv)| bv.cmp(av).then_with(|| name_cmp(a, b)))
            .map(|(k, _)| k.clone())
    }
    let mut by_country: HashMap<String, HashMap<String, usize>> = HashMap::new();
    for e in entities.iter() {
        if let (Some(country), Some(coalition)) = (&e.country, &e.coalition) {
            *by_country
                .entry(country.clone())
                .or_default()
                .entry(coalition.clone())
                .or_default() += 1;
        }
    }
    let mut seeded: HashMap<String, String> = by_country
        .iter()
        .filter_map(|(k, v)| winner(v).map(|w| (k.clone(), w)))
        .collect();
    let mut by_unit: HashMap<&str, HashMap<String, usize>> = HashMap::new();
    for d in divisions {
        if let Some(coalition) = &d.coalition {
            for (unit, transports) in &d.members {
                for name in std::iter::once(unit).chain(transports) {
                    *by_unit
                        .entry(name)
                        .or_default()
                        .entry(coalition.clone())
                        .or_default() += 1;
                }
            }
        }
    }
    by_country.clear();
    for e in entities.iter() {
        if let Some(country) = e.country.as_ref().filter(|c| !seeded.contains_key(*c))
            && let Some(c) = by_unit.get(e.name.as_str()).and_then(winner)
        {
            *by_country
                .entry(country.clone())
                .or_default()
                .entry(c)
                .or_default() += 1
        }
    }
    seeded.extend(
        by_country
            .iter()
            .filter_map(|(k, v)| winner(v).map(|w| (k.clone(), w))),
    );
    for e in entities {
        if e.coalition.is_none() {
            e.coalition = e.country.as_ref().and_then(|c| seeded.get(c)).cloned()
        }
    }
}
