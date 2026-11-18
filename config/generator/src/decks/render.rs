use super::data::*;
use std::{collections::HashSet, fmt::Write};
use ymb_sdk::{Result, generated};
pub fn float(v: f64) -> String {
    if v.fract() == 0. {
        format!("{v:.1}")
    } else {
        v.to_string()
    }
}
fn quote(s: &str, q: char) -> String {
    format!(
        "{q}{}{q}",
        s.replace('\\', "\\\\").replace(q, &format!("\\{q}"))
    )
}
fn region(
    source: &str,
    blocks: Vec<String>,
    owner: &str,
    source_id: &str,
    title: &str,
) -> Result<String> {
    let block = generated::render(owner, &blocks, Some(title), Some(source_id))?;
    generated::upsert(source, &block, owner)
}

struct RuleGroup {
    name: String,
    entries: std::sync::Arc<[RuleEntry]>,
}
pub struct RulesPass {
    owner: String,
    groups: Vec<RuleGroup>,
}
impl RulesPass {
    pub fn new(owner: &str, divisions: &[Variant]) -> Self {
        let mut seen = HashSet::new();
        let groups = divisions
            .iter()
            .filter(|d| seen.insert(&d.rule_name))
            .map(|d| RuleGroup {
                name: d.rule_name.clone(),
                entries: d.entries.clone(),
            })
            .collect();
        Self {
            owner: owner.into(),
            groups,
        }
    }
}
fn write_rules_region(
    writer: &mut dyn std::io::Write,
    pass: &RulesPass,
    entities: &[Entity],
    source_id: &str,
) -> std::io::Result<()> {
    writeln!(
        writer,
        "// YMB GENERATED BLOCK START | {}\n// Generated division rules\n// Source: {source_id}\n",
        pass.owner
    )?;
    for group in &pass.groups {
        writeln!(
            writer,
            "export {} is TDeckDivisionRule\n(\n    UnitRuleList =\n    [",
            group.name
        )?;
        for (i, r) in group.entries.iter().enumerate() {
            if i > 0 {
                writeln!(writer, ",")?;
            }
            write!(
                writer,
                "        TDeckUniteRule\n        (\n            UnitDescriptor = $/GFX/Unit/{}\n            AvailableWithoutTransport = True",
                entities[r.entity].name
            )?;
            if !r.transports.is_empty() {
                write!(writer, "\n        AvailableTransportList = [ ")?;
                for (i, id) in r.transports.iter().enumerate() {
                    if i > 0 {
                        write!(writer, ", ")?;
                    }
                    write!(writer, "$/GFX/Unit/{}", entities[*id].name)?;
                }
                write!(writer, " ]")?;
            }
            write!(
                writer,
                "\n            MaxPackNumber = {}\n            NumberOfUnitInPack = {}\n            NumberOfUnitInPackXPMultiplier = [",
                r.rule.max_pack_number, r.rule.number_of_unit_in_pack
            )?;
            for (i, n) in r.rule.multipliers.iter().enumerate() {
                if i > 0 {
                    write!(writer, ", ")?;
                }
                if n.fract() == 0. {
                    write!(writer, "{n:.1}")?;
                } else {
                    write!(writer, "{n}")?;
                }
            }
            write!(writer, "]\n        )")?;
        }
        writeln!(writer, "\n    ]\n)")?;
    }
    writeln!(writer, "// YMB GENERATED BLOCK END | {}", pass.owner)
}
pub fn rules_stream(
    writer: &mut dyn std::io::Write,
    source: &str,
    passes: &[RulesPass],
    entities: &[Entity],
    source_id: &str,
) -> std::io::Result<()> {
    if source_id.contains(['\r', '\n']) || passes.iter().any(|p| p.owner.contains(['\r', '\n'])) {
        return Err(std::io::Error::other(
            "Generated-region identity must occupy one line.",
        ));
    }
    let regions = generated::regions(source).map_err(std::io::Error::other)?;
    let mut emitted = vec![false; passes.len()];
    let mut cursor = 0;
    for region in regions {
        writer.write_all(&source.as_bytes()[cursor..region.full.start])?;
        if let Some((i, pass)) = passes
            .iter()
            .enumerate()
            .find(|(_, p)| p.owner == region.id)
        {
            write_rules_region(writer, pass, entities, source_id)?;
            emitted[i] = true;
        } else {
            writer.write_all(source[region.full.clone()].as_bytes())?;
        }
        cursor = region.full.end;
    }
    writer.write_all(&source.as_bytes()[cursor..])?;
    for (i, pass) in passes.iter().enumerate() {
        if !emitted[i] {
            writeln!(writer)?;
            write_rules_region(writer, pass, entities, source_id)?;
        }
    }
    Ok(())
}
pub fn rules(
    source: &str,
    divisions: &[Variant],
    entities: &[Entity],
    owner: &str,
    source_id: &str,
) -> Result<String> {
    let mut buffer = Vec::new();
    rules_stream(
        &mut buffer,
        source,
        &[RulesPass::new(owner, divisions)],
        entities,
        source_id,
    )
    .map_err(|e| ymb_sdk::failure(e.to_string(), "Check generated division rules."))?;
    Ok(String::from_utf8(buffer).expect("NDF writer emits UTF-8"))
}
pub fn divisions(
    source: &str,
    divisions: &[Variant],
    max_points: usize,
    entities: &[Entity],
    tag: &str,
    owner: &str,
    source_id: &str,
) -> Result<String> {
    let blocks=divisions.iter().map(|d|{
        let m=&d.metadata;
        let mut text=format!("export {} is TDeckDivisionDescriptor\n(\n    DescriptorId = GUID:{{{}}}\n    CfgName = {}\n    DivisionName = {}\n    DescriptionHintTitleToken = {}\n    SummaryTextToken = {}\n    InterfaceOrder = {}\n    DivisionCoalition = TWargameCoalition/{}\n    DivisionTags = [{}]\n    MaxActivationPoints = {max_points}\n    DivisionRule = {}\n    CostMatrix = MatrixCostName_{tag}\n    EmblemTexture     = {}\n    TypeToken        = {}\n    CountryId = {}\n    StandoutUnits =\n    [",d.descriptor,m.guid,quote(&d.cfg_name,'\''),quote(&m.division_name_token,'\''),quote(&m.division_name_token,'\''),quote(&d.summary,'\''),float(d.order),d.context.coalition,d.tags.iter().map(|t|quote(t,'\'')).collect::<Vec<_>>().join(", "),d.rule_name,quote(&d.emblem,'"'),quote(tag,'"'),quote(&d.context.country_id,'"'));
        if !d.standout.is_empty(){text.push('\n');for id in &d.standout{writeln!(text,"        $/GFX/Unit/{},",entities[*id].name).unwrap();}text.push_str("    ")}
        text.push_str("]\n)");text
    }).collect();
    region(source, blocks, owner, source_id, "Generated divisions")
}
pub fn packs(
    source: &str,
    packs: &[&Pack],
    entities: &[Entity],
    owner: &str,
    source_id: &str,
) -> Result<String> {
    let mut packs = packs.to_vec();
    packs.sort_by(|a, b| name_cmp(&a.descriptor_name, &b.descriptor_name));
    let blocks = packs
        .iter()
        .map(|p| {
            let mut text = format!("{} is DeckPackDescriptor\n(\n", p.descriptor_name);
            if p.xp > 0 {
                writeln!(text, "    Xp = {}", p.xp).unwrap();
            }
            if let Some(t) = p.transport {
                writeln!(text, "    Transport = $/GFX/Unit/{}", entities[t].name).unwrap();
            }
            write!(
                text,
                "    Unit = $/GFX/Unit/{}\n    Number = {}\n)",
                entities[p.unit].name, p.number
            )
            .unwrap();
            text
        })
        .collect();
    region(
        source,
        blocks,
        owner,
        source_id,
        "Generated premade deck packs",
    )
}
pub fn decks(source: &str, divisions: &[Variant], owner: &str, source_id: &str) -> Result<String> {
    let blocks=divisions.iter().map(|d|{
        let mut text=format!("export {} is TDeckDescriptor\n(\n    DeckDivision = $/GFX/Division/{}\n    DeckName = {}\n    DeckPackList =\n    [\n",d.deck,d.descriptor,quote(&d.metadata.deck_name_token,'"'));
        for c in &d.cards{writeln!(text,"        ~/{},",c.pack).unwrap();}text.push_str("    ]\n)");text
    }).collect();
    region(source, blocks, owner, source_id, "Generated premade decks")
}
