use super::qr;
use crate::localisation::{self, Localisation};
use regex::Regex;
use serde::Deserialize;
use serde_json::Value;
use std::{collections::HashSet, sync::LazyLock};
use ymb_sdk::{Context, GeneratedFile, Result, TestResult, ensure, generated, ndf, values};

const TARGET: &str = "GameData/UserInterface/Use/OutGame/UISpecificOutGameWelcomeView.ndf";
const OWNER: &str = "ysm.ui.welcome-screen.component";
const COMPONENTS: &str = "UISpecificOutGameWelcomeDescriptor.Components";
const TOP: &str = "AlignementToAnchor = [0.5, 0.0]\nAlignementToFather = [0.5, 0.0]";
static PARAMETERS: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"@(tag|number|label|url)@").unwrap());

#[derive(Clone, Deserialize)]
struct Link {
    #[serde(default)]
    name: String,
    #[serde(default)]
    url: String,
}
struct Alert {
    title: String,
    text: String,
    close_label: String,
}
struct Welcome {
    tag: String,
    version: String,
    author: String,
    links: Vec<Link>,
    alert: Option<Alert>,
}

fn string<'a>(value: &'a Value, key: &str, fallback: &'a str) -> Result<&'a str> {
    values::optional_string(value.get(key), key).map(|value| value.unwrap_or(fallback))
}

impl Welcome {
    fn parse(variables: &Value) -> Result<Self> {
        let version = values::string(
            &variables["config"]["mod"]["release"]["version"],
            "config.mod.release.version",
        )?;
        let links = variables
            .get("links")
            .map(|value| serde_json::from_value(value.clone()))
            .transpose()
            .map_err(|error| {
                ymb_sdk::failure(
                    format!("Invalid links: {error}."),
                    "Use a list of name and url mappings.",
                )
            })?
            .unwrap_or_default();
        let alert = if let Some(value) = variables.get("alert") {
            values::record(value, "alert")?;
            let text = string(value, "text", "")?.trim();
            if text.is_empty() {
                None
            } else {
                let close = string(value, "closeLabel", "OK")?.trim();
                Some(Alert {
                    title: string(value, "title", "")?.trim().into(),
                    text: text.into(),
                    close_label: if close.is_empty() { "OK" } else { close }.into(),
                })
            }
        } else {
            None
        };
        let result = Self {
            tag: string(variables, "modTag", "MOD")?.into(),
            version: version.split('.').take(2).collect::<Vec<_>>().join("."),
            author: string(variables, "author", "")?.into(),
            links,
            alert,
        };
        ensure(
            !result.tag.trim().is_empty() && result.tag.encode_utf16().count() <= 7,
            "Welcome modTag must contain 1 to 7 characters.",
            "Use a short stable modTag, such as YSM.",
        )?;
        for (index, link) in result.links.iter().enumerate() {
            ensure(
                !link.name.trim().is_empty() && !link.url.trim().is_empty(),
                format!("Welcome link #{} needs a name and URL.", index + 1),
                "Set nonempty name and url values for each link.",
            )?;
            ensure(
                link.url.len() <= qr::MAX_URL_BYTES,
                format!("Welcome link #{} exceeds the QR capacity.", index + 1),
                "Use at most 106 UTF-8 bytes for a URL.",
            )?;
            result.token(&format!("L{}", base36(index + 1)))?;
            result.token(&format!("U{}", base36(index + 1)))?;
        }
        if let Some(alert) = &result.alert {
            ensure(
                !alert.title.is_empty(),
                "alert.title is required when alert.text is set.",
                "Give the alert a nonempty title.",
            )?;
        }
        Ok(result)
    }

    fn token(&self, suffix: &str) -> Result<String> {
        let token = format!("{}{suffix}", self.tag);
        ensure(
            token.encode_utf16().count() <= 10,
            format!("Welcome token {token:?} exceeds ten characters."),
            "Shorten modTag or reduce the link count.",
        )?;
        Ok(token)
    }

    fn template(&self, source: &str, index: usize) -> Result<String> {
        let number = (index + 1).to_string();
        let label = self.token(&format!("L{}", base36(index + 1)))?;
        let url = self.token(&format!("U{}", base36(index + 1)))?;
        Ok(PARAMETERS
            .replace_all(source.trim_end(), |capture: &regex::Captures<'_>| {
                let value = match &capture[1] {
                    "tag" => &self.tag,
                    "number" => &number,
                    "label" => &label,
                    "url" => &url,
                    _ => unreachable!(),
                };
                value.replace('\\', "\\\\").replace('"', "\\\"")
            })
            .into_owned())
    }

    fn component(&self) -> Result<String> {
        let mut title_elements = vec![self.template(include_str!("welcome/title.ndf"), 0)?];
        if !self.links.is_empty() {
            let buttons = (0..self.links.len())
                .map(|index| self.template(include_str!("welcome/link.ndf"), index))
                .collect::<Result<Vec<_>>>()?;
            title_elements.push(list(
                &format!("MainMenuLinks{}", self.tag),
                "Horizontal",
                TOP,
                "InterItemMargin = TRTTILength(Magnifiable = 10.0)",
                &buttons,
            ));
            let reveals = (0..self.links.len())
                .map(|index| self.template(include_str!("welcome/reveal.ndf"), index))
                .collect::<Result<Vec<_>>>()?;
            title_elements.push(container(
                &format!("MainMenuLinkRevealSlot{}", self.tag),
                TOP,
                &reveals,
            ));
        }
        let frame = format!("MagnifiableOffset = [0.0, 175.0]\n{TOP}");
        let mut components = vec![list(
            &format!("MainMenuTitleBlock{}", self.tag),
            "Vertical",
            &frame,
            "",
            &title_elements,
        )];
        if self.alert.is_some() {
            components.push(self.template(include_str!("welcome/alert.ndf"), 0)?);
        }
        Ok(container(
            &format!("MainMenuWelcomeRoot{}", self.tag),
            "RelativeWidthHeight = [1.0, 1.0]",
            &components,
        ))
    }

    fn localisation(&self, source: &str, mod_name: &str) -> Result<String> {
        let mut state = Localisation::parse(source);
        let managed = Regex::new(&format!(
            r"^{}(?:TIT|MT|MI|ALT|ALB|ALC|L[0-9A-Z]{{1,5}}|U[0-9A-Z]{{1,5}})$",
            ymb_sdk::text::escape_regex(&self.tag)
        ))
        .unwrap();
        let stale: HashSet<_> = state
            .tokens()
            .filter(|token| managed.is_match(token))
            .map(str::to_owned)
            .collect();
        state.remove(&stale);
        state.upsert(
            &self.token("TIT")?,
            format!("{mod_name} {}", self.version).trim(),
        );
        state.upsert(
            &self.token("MT")?,
            format!("Created by {}", self.author).trim(),
        );
        for (index, link) in self.links.iter().enumerate() {
            state.upsert(&self.token(&format!("L{}", base36(index + 1)))?, &link.name);
            state.upsert(&self.token(&format!("U{}", base36(index + 1)))?, &link.url);
        }
        if let Some(alert) = &self.alert {
            state.upsert(&self.token("ALT")?, &alert.title);
            state.upsert(&self.token("ALB")?, &alert.text);
            state.upsert(&self.token("ALC")?, &alert.close_label);
        }
        Ok(state.render())
    }
}

fn base36(mut value: usize) -> String {
    let mut digits = Vec::new();
    loop {
        digits.push(b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"[value % 36] as char);
        value /= 36;
        if value == 0 {
            break;
        }
    }
    digits.into_iter().rev().collect()
}

fn indent(text: &str, size: usize) -> String {
    let prefix = " ".repeat(size);
    text.split('\n')
        .map(|line| {
            if line.is_empty() {
                String::new()
            } else {
                format!("{prefix}{line}")
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn frame(properties: &str) -> String {
    format!(
        "ComponentFrame = TUIFramePropertyRTTI\n(\n{}\n)",
        indent(properties, 4)
    )
}

fn collection(name: &str, blocks: &[String]) -> String {
    let entries = blocks
        .iter()
        .map(|block| format!("{},", block.trim_end()))
        .collect::<Vec<_>>()
        .join("\n");
    format!("{name} =\n[\n{}\n]", indent(&entries, 4))
}

fn list(name: &str, axis: &str, properties: &str, margins: &str, elements: &[String]) -> String {
    let elements = elements
        .iter()
        .map(|element| {
            let (head, rest) = element.split_once('\n').unwrap_or((element, ""));
            format!(
                "BUCKListElementDescriptor\n(\n    ComponentDescriptor = {head}\n{}\n)",
                indent(rest, 4)
            )
        })
        .collect::<Vec<_>>();
    let body = [
        format!("ElementName = \"{name}\""),
        frame(properties),
        format!("Axis = ~/ListAxis/{axis}"),
        "BreadthComputationMode = ~/BreadthComputationMode/ComputeBreadthFromLargestChild".into(),
        "ChildFitToContent = true".into(),
        margins.into(),
        collection("Elements", &elements),
    ]
    .into_iter()
    .filter(|line| !line.is_empty())
    .collect::<Vec<_>>()
    .join("\n");
    format!("BUCKListDescriptor\n(\n{}\n)", indent(&body, 4))
}

fn container(name: &str, properties: &str, components: &[String]) -> String {
    let body = format!(
        "ElementName = \"{name}\"\n{}\n{}",
        frame(properties),
        collection("Components", components)
    );
    format!("BUCKContainerDescriptor\n(\n{}\n)", indent(&body, 4))
}

fn render(source: &str, welcome: &Welcome, owner: &str) -> Result<String> {
    let component = format!("{},", welcome.component()?);
    let region = generated::render(
        OWNER,
        &[component],
        Some("YSM welcome screen component"),
        Some(owner),
    )?;
    let region = format!("{}\n", indent(region.trim_end(), 8));
    let current = if generated::regions(source)?
        .iter()
        .any(|region| region.id == OWNER)
    {
        source.to_owned()
    } else {
        let range = ndf::read::path_range(source, COMPONENTS)?;
        let next = ndf::patch::insert_collection(&source[range.clone()], &region, None)?;
        let mut current = source.to_owned();
        current.replace_range(range, &next);
        current
    };
    let output = generated::upsert(&current, &region, OWNER)?;
    ndf::validate(&output)?;
    Ok(output)
}

pub fn generate(ctx: &mut Context) -> Result<Vec<GeneratedFile>> {
    let welcome = Welcome::parse(&ctx.variables)?;
    let locale_path = localisation::target(ctx, "INTERFACE_OUTGAME")?;
    let sources = ctx.read_targets(&[TARGET, &locale_path])?;
    let view = render(&sources[TARGET], &welcome, ctx.generator_id())?;
    let locale = welcome.localisation(&sources[&locale_path], &ctx.info.r#mod.name)?;
    let mut outputs = vec![
        ctx.output_generated(TARGET, view)?,
        ctx.output_text(&locale_path, locale)?,
    ];
    for (index, link) in welcome.links.iter().enumerate() {
        let path = format!("GameData/Assets/2D/Interface/Common/y-qr-{}.png", index + 1);
        outputs.push(ctx.output_binary(&path, qr::image(&link.url)?)?);
    }
    Ok(outputs)
}

fn check() -> Result<()> {
    let variables = serde_json::json!({
        "config":{"mod":{"release":{"version":"9.12.3-preview.4+build.5"}}},
        "modTag":"TEST","author":"Author",
        "links":[{"name":"First","url":"https://example.com/a"},{"name":"Second","url":"https://example.com/b"}]
    });
    let mut welcome = Welcome::parse(&variables)?;
    let source = r#"private UISpecificOutGameWelcomeDescriptor is BUCKContainerDescriptor(
    Components = [
        BUCKTextDescriptor(Text = "]") // Brackets in strings are not list boundaries.
    ]
)
UISpecificOutGameWelcomeViewDescriptor is TUISpecificOutGameWelcomeViewDescriptor()
"#;
    let output = render(source, &welcome, "sample:welcome:view")?;
    ensure(
        render(&output, &welcome, "sample:welcome:view")? == output,
        "Welcome rendering is not idempotent.",
        "Preserve the generated region.",
    )?;
    let original_entries = ndf::read::entries(&source[ndf::read::path_range(source, COMPONENTS)?])?;
    let entries = ndf::read::entries(&output[ndf::read::path_range(&output, COMPONENTS)?])?;
    ensure(
        entries.len() == original_entries.len() + 1 && entries[0].text == original_entries[0].text,
        "Welcome insertion changed the original components.",
        "Use the shared collection reader.",
    )?;
    ensure(
        generated::regions(&output)?.len() == 1 && output.contains("TextureTEST_QR2"),
        "Welcome ownership or QR texture reference changed.",
        "Keep one owned region and one texture per link.",
    )?;
    let locale = "\"TOKEN\";\"REFTEXT\"\n\"UNRELATED\";\"Keep this row\"\n\"TESTL9\";\"Stale\"\n\"TESTL9\";\"Stale\"\n\"TESTALT\";\"Stale\"\n";
    let translated = welcome.localisation(locale, "Sample")?;
    ensure(
        translated.contains("\"UNRELATED\";\"Keep this row\"")
            && translated.contains("\"TESTL1\"")
            && translated.contains("\"TESTTIT\";\"Sample 9.12\"")
            && !translated.contains("Stale"),
        "Welcome localisation pruning changed unrelated rows.",
        "Remove only managed tokens and retain all other rows.",
    )?;
    let plain_component = welcome.component()?;
    ensure(
        !plain_component.contains("MagnifiableWidthHeight"),
        "Welcome layout has a fixed size.",
        "Size titles and link panels from content.",
    )?;
    welcome.alert = Some(Alert {
        title: "Notice".into(),
        text: "Line one\nLine two".into(),
        close_label: "OK".into(),
    });
    let alert = welcome.component()?;
    let translated = welcome.localisation(locale, "Sample")?;
    ensure(
        alert.matches("MagnifiableWidthHeight").count() == 1
            && alert.contains("MagnifiableWidthHeight = [300.0, 0.0]")
            && alert.contains("MaxBetweenUserDefinedAndContent")
            && translated.contains("Line one\\nLine two"),
        "Alert layout or multiline text changed.",
        "Keep a minimum width and content-driven height.",
    )?;
    welcome.alert.as_mut().unwrap().text = "A much longer message".repeat(50);
    ensure(
        welcome.component()? == alert,
        "Alert text length changed layout geometry.",
        "Keep text content in localisation.",
    )?;
    let objects = ndf::read::objects(&alert)?;
    for object in &objects {
        let body = &alert[object.span.clone()];
        if object.type_name == "BUCKListElementDescriptor" {
            let range = ndf::read::path_range(body, "ComponentDescriptor.ComponentFrame")?;
            ensure(
                !body[range].contains("MagnifiableOffset"),
                "A list child claims the layout axis.",
                "Leave child positions to the list.",
            )?;
        }
    }
    for name in ["MainMenuAlertPanelTEST", "MainMenuLinkRevealPanel1TEST"] {
        let correct = objects.iter().any(|object| {
            let body = &alert[object.span.clone()];
            object.type_name == "BUCKContainerDescriptor"
                && body.contains(&format!("ElementName = \"{name}\""))
        });
        ensure(
            correct,
            "A welcome panel has button hover state.",
            "Keep panel frames as plain containers.",
        )?;
    }
    for invalid in [
        serde_json::json!({"modTag":"TOO_LONG_TAG"}),
        serde_json::json!({"links":[{"name":"","url":"https://example.com"}]}),
        serde_json::json!({"links":[{"name":"Link","url":"é".repeat(54)}]}),
        serde_json::json!({"alert":{"text":"Notice"}}),
    ] {
        let mut settings = variables.clone();
        ymb_sdk::core::templates::merge(&mut settings, &invalid);
        ensure(
            Welcome::parse(&settings).is_err(),
            "Invalid welcome settings accepted.",
            "Check token lengths, links, capacity, and alert titles.",
        )?;
    }
    Ok(())
}

pub fn checks(_: &mut Context) -> Result<Vec<TestResult>> {
    check()?;
    Ok(vec![TestResult::passed(
        "Welcome insertion, identity, localisation, links, alerts, and content sizing",
    )])
}

#[test]
fn welcome_contract() {
    check().unwrap();
}
