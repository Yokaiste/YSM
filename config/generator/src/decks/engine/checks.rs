use super::*;

pub fn integrity(
    divisions: &[Variant],
    packs: &IndexMap<String, Pack>,
    entities: &[Entity],
    config: &Config,
) -> Result<()> {
    let mut referenced = HashSet::new();
    let mut rules = HashMap::new();
    for d in divisions {
        let (previous, by_entity) = rules.entry(d.rule_name.as_str()).or_insert_with(|| {
            (
                &d.entries,
                d.entries
                    .iter()
                    .map(|r| (r.entity, r))
                    .collect::<HashMap<_, _>>(),
            )
        });
        ensure(
            Arc::ptr_eq(previous, &d.entries) || previous.as_ref() == d.entries.as_ref(),
            "Two divisions assign different rule lists to the same name.",
            "Keep the identity stores and report the build output.",
        )?;
        let mut keys = HashSet::new();
        let mut categories = HashMap::new();
        for c in &d.cards {
            ensure(
                keys.insert((c.entity, c.transport)),
                format!("Deck {} contains a duplicate card.", d.deck),
                "Report the generator output.",
            )?;
            *categories
                .entry(category(&entities[c.entity]))
                .or_insert(0usize) += 1;
            let r = by_entity.get(&c.entity).ok_or_else(|| {
                ymb_sdk::failure(
                    "A deck card has no division rule.",
                    "Report the generator output.",
                )
            })?;
            ensure(
                c.transport.is_none_or(|t| r.transports.contains(&t)),
                "A deck card uses an unavailable transport.",
                "Report the generator output.",
            )?;
            let p = packs.get(&c.pack).ok_or_else(|| {
                ymb_sdk::failure(
                    "A deck card has no generated pack.",
                    "Report the generator output.",
                )
            })?;
            ensure(
                p.unit == c.entity
                    && p.transport == c.transport
                    && p.xp <= 3
                    && p.number > 0
                    && p.number == r.rule.count(p.xp),
                "A generated pack has an incorrect unit, transport, veterancy or count.",
                "Report the generator output.",
            )?;
            referenced.insert(c.pack.as_str());
        }
        ensure(
            !config.require_command || d.cards.iter().any(|c| command(&entities[c.entity])),
            format!("Deck {} has no command card.", d.deck),
            "Raise deckSlotCount or narrow forced units.",
        )?;
        ensure(
            categories.values().all(|n| *n <= config.slots),
            format!("Deck {} exceeds its category limit.", d.deck),
            "Check deckSlotCount and forced units.",
        )?;
    }
    ensure(
        packs.keys().all(|n| referenced.contains(n.as_str())),
        "An unused generated pack remains.",
        "Report the generator output.",
    )
}
