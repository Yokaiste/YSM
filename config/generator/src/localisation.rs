use std::collections::{HashMap, HashSet};
use ymb_sdk::localisation::cell;
pub use ymb_sdk::localisation::row;
use ymb_sdk::{Context, GeneratedFile, Result, TestResult, ensure};

pub struct Localisation {
    lines: Vec<String>,
    newline: &'static str,
    index: HashMap<String, usize>,
}

fn validate_token(token: &str) -> Result<()> {
    ensure(
        !token.trim().is_empty() && token.encode_utf16().count() <= 10,
        format!("Localisation token {token:?} must contain 1 to 10 characters."),
        "Shorten the token or modTag, keeping references to the same token together.",
    )
}

impl Localisation {
    pub fn parse(content: &str) -> Self {
        let normalized = content.replace("\r\n", "\n");
        let mut lines: Vec<String> = normalized.split('\n').map(str::to_owned).collect();
        if lines.last().is_some_and(String::is_empty) {
            lines.pop();
        }
        if lines.is_empty() {
            lines.push("\"TOKEN\";\"REFTEXT\"".into());
        }
        let index = lines
            .iter()
            .enumerate()
            .filter_map(|(index, line)| row(line).map(|(token, _)| (token, index)))
            .collect();
        Self {
            lines,
            index,
            newline: if content.contains("\r\n") {
                "\r\n"
            } else {
                "\n"
            },
        }
    }

    pub fn upsert(&mut self, token: &str, text: &str) {
        let line = format!("{};{}", cell(token), cell(text));
        if let Some(index) = self.index.get(token) {
            self.lines[*index] = line;
        } else {
            self.index.insert(token.to_owned(), self.lines.len());
            self.lines.push(line);
        }
    }

    pub fn remove(&mut self, tokens: &HashSet<String>) {
        if tokens.is_empty() {
            return;
        }
        self.lines
            .retain(|line| row(line).is_none_or(|(token, _)| !tokens.contains(&token)));
        self.index = self
            .lines
            .iter()
            .enumerate()
            .filter_map(|(index, line)| row(line).map(|(token, _)| (token, index)))
            .collect();
    }

    pub fn contains(&self, token: &str) -> bool {
        self.index.contains_key(token)
    }

    pub fn tokens(&self) -> impl Iterator<Item = &str> {
        self.index.keys().map(String::as_str)
    }

    pub fn render(&self) -> String {
        let mut content = self.lines.join(self.newline);
        content.push_str(self.newline);
        content
    }

    pub fn merge(&mut self, source: &str, mod_tag: &str) -> Result<()> {
        ensure(
            !source.trim().is_empty(),
            "Missing localisation.csv.",
            "Restore localisation.csv beside the owning patch.",
        )?;
        let mut seen = HashSet::new();
        for line in source.replace("${modTag}", mod_tag).lines() {
            if line.trim().is_empty() {
                continue;
            }
            let (token, text) = row(line).ok_or_else(|| {
                ymb_sdk::failure(
                    format!("Localisation row needs two quoted CSV fields: {line}"),
                    "Separate the fields with a semicolon and double embedded quotes.",
                )
            })?;
            if token != "TOKEN" {
                validate_token(&token)?;
                ensure(
                    seen.insert(token.clone()),
                    format!("Duplicate localisation token {token:?}."),
                    "Keep one row per token in this feature's localisation.csv.",
                )?;
                self.upsert(&token, &text);
            }
        }
        Ok(())
    }
}

pub fn target(ctx: &Context, dictionary: &str) -> Result<String> {
    let root: String = ctx.value("modRootName")?;
    Ok(format!("GameData/Localisation/{root}/{dictionary}.csv"))
}

pub fn seed(ctx: &mut Context) -> Result<Vec<GeneratedFile>> {
    let tag: String = ctx.value("modTag")?;
    validate_token(&tag)?;
    let mut outputs = Vec::with_capacity(2);
    for dictionary in ["UNITS", "INTERFACE_OUTGAME"] {
        let mut state = Localisation::parse("");
        if dictionary == "INTERFACE_OUTGAME" {
            state.upsert(&tag, &ctx.info.r#mod.name);
        }
        outputs.push(ctx.output_text(&target(ctx, dictionary)?, state.render())?);
    }
    Ok(outputs)
}

pub fn merge_feature(ctx: &mut Context, dictionary: &str) -> Result<Vec<GeneratedFile>> {
    let path = target(ctx, dictionary)?;
    let current = ctx.read_target(&path)?;
    let source = ctx.read_owned_text("localisation.csv")?;
    let tag: String = ctx.value("modTag")?;
    let mut state = Localisation::parse(&current);
    state.merge(&source, &tag)?;
    Ok(vec![ctx.output_text(&path, state.render())?])
}

pub fn match_constants(ctx: &mut Context) -> Result<Vec<GeneratedFile>> {
    merge_feature(ctx, "INTERFACE_OUTGAME")
}

fn check() -> Result<()> {
    let mut state = Localisation::parse("");
    state.upsert("SAMPLE", "Sample \"Army\"");
    state.merge(
        "\"TOKEN\";\"REFTEXT\"\n\"${modTag}_OPT\";\"Keep\"\n",
        "SAMPLE",
    )?;
    let text = state.render();
    ensure(
        text.contains("\"SAMPLE\";\"Sample \"\"Army\"\"\"")
            && text.contains("\"SAMPLE_OPT\";\"Keep\""),
        "Localisation escaping or merge failed.",
        "Preserve quoted CSV and existing rows.",
    )?;
    state.merge(
        "\"TOKEN\";\"REFTEXT\"\n\"${modTag}_OPT\";\"Keep\"\n",
        "SAMPLE",
    )?;
    ensure(
        state.render() == text,
        "Localisation merge was not idempotent.",
        "Upsert by token.",
    )?;
    for invalid in [
        "",
        "bad row",
        "\"A\";\"B\";\"C\"",
        "\"\";\"Empty token\"",
        "\"TOO_LONG_TOKEN\";\"Text\"",
        "\"A\";\"First\"\n\"A\";\"Second\"",
        "\"${modTag}_OPT\";\"Text\"",
    ] {
        ensure(
            state.merge(invalid, "TOO_LONG").is_err(),
            "Invalid localisation accepted.",
            "Require two quoted fields.",
        )?;
    }
    let mut crlf = Localisation::parse("\"TOKEN\";\"REFTEXT\"\r\n\"A\";\"old\"\r\n");
    crlf.upsert("A", "new\nline");
    ensure(
        crlf.render() == "\"TOKEN\";\"REFTEXT\"\r\n\"A\";\"new\\nline\"\r\n",
        "CSV newline handling changed.",
        "Keep file line endings and escape cell newlines.",
    )?;
    crlf.remove(&HashSet::from(["A".into()]));
    ensure(
        !crlf.render().contains("new"),
        "CSV row removal failed.",
        "Rebuild the token index after removal.",
    )
}

pub fn checks(_: &mut Context) -> Result<Vec<TestResult>> {
    check()?;
    Ok(vec![TestResult::passed(
        "Localisation identity, escaping, merging, and line endings",
    )])
}

#[test]
fn localisation_contract() {
    check().unwrap();
}
