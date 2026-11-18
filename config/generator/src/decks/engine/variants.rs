use super::*;

struct Job {
    context: Arc<Context>,
    mode: Mode,
    cfg_name: String,
    order: f64,
    roster: Vec<EntityId>,
    cached: Option<(Arc<[RuleEntry]>, Vec<DeckCard>)>,
}

fn signature(entries: &[RuleEntry]) -> u64 {
    let mut h = DefaultHasher::new();
    for e in entries {
        e.entity.hash(&mut h);
        e.transports.hash(&mut h);
        e.rule.max_pack_number.hash(&mut h);
        for v in std::iter::once(&e.rule.number_of_unit_in_pack).chain(&e.rule.multipliers) {
            (if *v == 0. { 0. } else { *v }).to_bits().hash(&mut h);
        }
    }
    h.finish()
}
#[expect(
    clippy::too_many_arguments,
    reason = "Each pass borrows shared indexes and transactional outputs."
)]
pub(super) fn variants(
    pool: &[EntityId],
    factory: &Factory<'_>,
    balanced: &[Rule],
    transports: &[Vec<EntityId>],
    config: &Config,
    tag: &str,
    store: &mut Store,
    names: &mut Localisation,
    packs: &mut IndexMap<String, Pack>,
    cached: Option<super::super::cache::Plan>,
) -> Result<(Vec<Variant>, bool)> {
    let entities = factory.entities;
    let contexts = contexts::build(entities, pool, tag, config)?;
    let mut cached = cached
        .filter(|p| p.valid(entities.len(), &contexts, tag, config))
        .map(super::super::cache::Plan::restore);
    if let Some((_, saved_packs)) = &mut cached {
        *packs = std::mem::take(saved_packs);
    }
    let mut cache_changed = cached.is_none();
    let mut sorted = pool.to_vec();
    sorted.sort_by(|a, b| name_cmp(&entities[*a].name, &entities[*b].name));
    let mut jobs = Vec::new();
    for (context_index, c) in contexts.into_iter().enumerate() {
        let c = Arc::new(c);
        let rank = match c.scope {
            Scope::Custom => 0,
            Scope::AllSide => 1,
            Scope::Side => 2,
            Scope::Country => 3,
        };
        let order = c
            .interface_order
            .unwrap_or(-10000. + rank as f64 * 2000. + context_index as f64 * 4.);
        let modes = if c.allowed_modes.is_empty() {
            &config.modes
        } else {
            &c.allowed_modes
        };
        for (mode_index, m) in modes.iter().copied().enumerate() {
            let roster: Vec<_> = sorted
                .iter()
                .copied()
                .filter(|id| config.includes(&entities[*id], &c, m, false))
                .collect();
            if !contexts::viable(&roster, entities, config) {
                continue;
            }
            let premade_roster: Vec<_> = roster
                .iter()
                .copied()
                .filter(|id| config.includes(&entities[*id], &c, m, true))
                .collect();
            if !contexts::viable(&premade_roster, entities, config) {
                continue;
            }
            let cfg_name = format!(
                "{}_{}_{}",
                sanitize(tag),
                c.code,
                m.name().to_ascii_uppercase()
            );
            let row = cached.as_mut().and_then(|(rows, _)| rows.remove(&cfg_name));
            jobs.push(Job {
                context: c.clone(),
                mode: m,
                order: order + mode_index as f64,
                cfg_name,
                roster,
                cached: row,
            });
        }
    }
    let missing: Vec<_> = jobs.iter().filter(|job| job.cached.is_none()).collect();
    let mut limits = ymb_sdk::parallel::Limits::from_env();
    // Keep room for parsed inputs, shared analysis profiles, and completed plans.
    limits.memory_bytes /= 2;
    let mut prepared = ymb_sdk::parallel::map(
        &missing,
        limits,
        |job| ymb_sdk::parallel::Cost {
            memory_bytes: job.roster.len().saturating_mul(8 << 10),
            work_bytes: job.roster.len().saturating_mul(128 << 10),
        },
        |job| -> Result<_> {
            let entries = rules::entries(
                &job.roster,
                entities,
                job.mode,
                balanced,
                transports,
                config,
            );
            let mut local_packs = IndexMap::new();
            let cards = premade::build(
                &job.context,
                job.mode,
                &entries,
                factory,
                &mut local_packs,
                tag,
                config,
            )?;
            Ok((
                Arc::<[RuleEntry]>::from(entries),
                cards.into_iter().map(DeckCard::from).collect::<Vec<_>>(),
                local_packs,
            ))
        },
    )
    .into_iter();
    let mut result: Vec<Variant> = Vec::new();
    let mut canonical: HashMap<u64, Vec<usize>> = HashMap::new();
    for job in jobs {
        let Job {
            context: c,
            mode: m,
            cfg_name,
            order,
            cached,
            ..
        } = job;
        let (entries, cards) = match cached {
            Some(row) => row,
            None => {
                cache_changed = true;
                let (entries, cards, local_packs) =
                    prepared.next().expect("missing parallel roster plan")?;
                for (name, pack) in local_packs {
                    packs.entry(name).or_insert(pack);
                }
                (entries, cards)
            }
        };
        let metadata = store.metadata(
            names,
            &cfg_name,
            &contexts::division_name(&c, m, tag, config)?,
            &contexts::deck_name(&c, m, tag, config)?,
        )?;
        let summary = store::summary_token(&metadata.division_name_token);
        names.upsert(&summary, &contexts::summary(&c, m, tag, config)?);
        let mut rule_name = format!("Descriptor_Deck_Division_{cfg_name}_Rule");
        let hash = signature(&entries);
        let existing = canonical.get(&hash).and_then(|ids| {
            ids.iter()
                .find(|id| result[**id].entries.as_ref() == entries.as_ref())
        });
        let entries = if let Some(id) = existing {
            rule_name = result[*id].rule_name.clone();
            result[*id].entries.clone()
        } else {
            canonical.entry(hash).or_default().push(result.len());
            entries
        };
        let standout = unique(cards.iter().filter(|c| c.forced).map(|c| c.entity))
            .into_iter()
            .take(5)
            .collect();
        result.push(Variant {
            context: c.clone(),
            descriptor: format!("Descriptor_Deck_Division_{cfg_name}"),
            rule_name,
            deck: format!("Descriptor_Deck_{cfg_name}_Premade"),
            cfg_name,
            emblem: contexts::emblem(&c, m, tag, config)?,
            metadata,
            summary,
            order,
            tags: contexts::tags(&c, tag),
            standout,
            entries,
            cards,
        });
    }
    Ok((result, cache_changed))
}
