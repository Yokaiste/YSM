use serde_json::{Map, Value, json};
use ymb_sdk::{Context, GeneratedFile, Result, TestResult, ensure, generated, ndf, values};

const TARGET: &str = "GameData/UserInterface/Style/DefaultStyle/DefaultStyleGuides.ndf";
const OWNER: &str = "ysm.ui.ingame.dark-theme.style";
const STYLE: &str = "YSMInGameStyleGuide";
type Color = [u8; 4];
type States = Map<String, Value>;
type Palette = Vec<(&'static str, Vec<Group>)>;
struct Group {
    tokens: &'static [&'static str],
    states: States,
}

fn color(value: &Value, label: &str) -> Result<Color> {
    let channels = value
        .as_array()
        .filter(|values| values.len() == 4)
        .and_then(|values| {
            values
                .iter()
                .map(|value| {
                    value
                        .as_f64()
                        .filter(|v| v.is_finite() && v.fract() == 0.0 && (0.0..=255.0).contains(v))
                        .map(|v| v as u8)
                })
                .collect::<Option<Vec<_>>>()
        });
    channels
        .map(|values| values.try_into().unwrap())
        .ok_or_else(|| {
            ymb_sdk::failure(
                format!("{label} needs four integer RGBA channels from 0 to 255."),
                "Use a list such as [24, 25, 28, 240] in hudPalette.",
            )
        })
}

fn states(settings: &Value, name: &str) -> Result<States> {
    let label = format!("hudPalette.{name}");
    let entries = values::record(&settings[name], &label)?;
    ensure(
        entries.contains_key("Normal"),
        format!("{label} needs a Normal color."),
        "Keep Normal and override individual interaction states.",
    )?;
    let mut result = Map::new();
    for (state, rgba) in entries {
        ensure(
            [
                "Normal",
                "Highlighted",
                "Clicked",
                "Toggled",
                "ToggleHighlighted",
                "ToggleClicked",
                "Grayed",
            ]
            .contains(&state.as_str()),
            format!("Unknown {label} state: {state}."),
            "Use a supported component interaction state.",
        )?;
        result.insert(
            state.clone(),
            json!(color(rgba, &format!("{label}.{state}"))?),
        );
    }
    Ok(result)
}

fn palette(settings: &Value) -> Result<Palette> {
    values::record(settings, "hudPalette")?;
    let normal = |name: &str| -> Result<States> {
        Ok(Map::from_iter([(
            "Normal".into(),
            json!(color(&settings[name], &format!("hudPalette.{name}"))?),
        )]))
    };
    let group = |tokens, name| -> Result<Group> {
        Ok(Group {
            tokens,
            states: normal(name)?,
        })
    };
    let button = states(settings, "button")?;
    let button_line = states(settings, "buttonLine")?;
    let button_text = states(settings, "buttonText")?;
    let mut vignette = button_line.clone();
    vignette.insert(
        "Normal".into(),
        json!(color(&settings["transparent"], "hudPalette.transparent")?),
    );
    vignette.insert(
        "Grayed".into(),
        json!(color(&settings["transparent"], "hudPalette.transparent")?),
    );
    Ok(vec![
        (
            "BlockColorsMap",
            vec![
                group(&["AlertPanel/Gradient0"], "alertFade")?,
                group(&["AlertPanel/Gradient1"], "alertBackground")?,
                group(
                    &["H2_bleu_2", "H2_bleu_2_235", "TacticPanel", "H2_bleu_4"],
                    "panel",
                )?,
                group(
                    &["H2_bleu_2_60p", "H2_bleu_2_40p", "H2_bleu_2_30p"],
                    "panelTranslucent",
                )?,
                group(
                    &[
                        "H2_bleu_1",
                        "H2_bleu_1_hint",
                        "H2_bleu_2_hint",
                        "H2_bleu_3_hint",
                        "H2_bleu_4_hint",
                    ],
                    "raised",
                )?,
                Group {
                    tokens: &[
                        "BoutonTemps_Background",
                        "BoutonTemps_pawn",
                        "BoutonBeacons",
                        "BoutonSelectionMultiple",
                        "OffMapUnitButtonName",
                        "H2_bleu_5",
                        "TacticButton_highlightable",
                    ],
                    states: button.clone(),
                },
                Group {
                    tokens: &["H2_bleu_3"],
                    states: states(settings, "medium")?,
                },
            ],
        ),
        (
            "LineColorsMap",
            vec![
                group(
                    &[
                        "H2_bleu_2",
                        "H2_bleu_2_40p",
                        "H2_bleu_3",
                        "LigneSeparatricePanelRessources",
                        "TacticPanel",
                    ],
                    "border",
                )?,
                Group {
                    tokens: &["BoutonTemps_Line", "TacticButton_highlightable"],
                    states: button_line.clone(),
                },
                Group {
                    tokens: &["ArmoryUnitButtonName"],
                    states: button.clone(),
                },
                Group {
                    tokens: &["BoutonVignetteAchat"],
                    states: vignette,
                },
            ],
        ),
        (
            "TextColorsMap",
            vec![
                group(
                    &["hint_fond_meilleureLecture", "hint_fond", "Hint_fond"],
                    "tooltip",
                )?,
                group(
                    &["hint_titre_meilleureLecture", "Hint_titre", "Hint_main"],
                    "text",
                )?,
                group(&["Hint_ligne"], "border")?,
                group(&["TypeA", "TypeB", "TypeB_alpha", "TypeE"], "panel")?,
                group(&["TypeC"], "raised")?,
                group(&["TypeD"], "weaponInset")?,
                Group {
                    tokens: &["LigneA", "LigneB", "CouleurBordure_boutonShortcuts"],
                    states: button_line,
                },
                group(
                    &["CyanChrono", "BlancEquipe", "TacticPanel", "H2_bleu_1"],
                    "text",
                )?,
                group(&["CyanChrono_180", "BlancEquipe_alpha"], "textMuted")?,
                group(&["CyanChrono_120"], "textFaint")?,
                Group {
                    tokens: &[
                        "BoutonTemps_Text",
                        "ButtonHUD/Text2",
                        "ButtonHUD/Text2_pawn",
                        "TacticButton_highlightable",
                        "CouleurTexture_boutonShortcuts",
                        "BoutonUnitPatternClair",
                        "BoutonXP_deck_chevron",
                    ],
                    states: button_text,
                },
                Group {
                    tokens: &["CouleurFond_boutonShortcuts"],
                    states: button,
                },
                Group {
                    tokens: &["WeaponButton/Overblock"],
                    states: states(settings, "weaponOverlay")?,
                },
            ],
        ),
    ])
}

fn render(
    source: &str,
    palette: &Palette,
    identity: &ndf::operation::Identity,
    owner: &str,
) -> Result<String> {
    let blocks = ndf::scan(source)?;
    let original = ndf::read::select_block(&blocks, "DefaultStyleGuide")?;
    let original = &source[original.span.clone()];
    let apply = |source: &str, operations: &[Value]| -> Result<String> {
        Ok(ndf::patch::apply(
            source,
            &ndf::operation::expand(operations, &json!({}))?,
            identity,
        )?
        .text)
    };
    let mut changes = Map::new();
    for (field, groups) in palette {
        let value = &original[ndf::read::path_range(original, field)?];
        let mut edits = Vec::new();
        for group in groups {
            let mut states = Vec::new();
            for (state, rgba) in &group.states {
                let rgba: Color = color(rgba, state)?;
                states.push(format!(
                    "(~/ComponentState/{state}, TColorRTTI(Color = [{}, {}, {}, {}]))",
                    rgba[0], rgba[1], rgba[2], rgba[3]
                ));
            }
            let value = format!("MAP [{},]", states.join(", "));
            for token in group.tokens {
                edits.push(json!({"mapEntry":serde_json::to_string(token).unwrap(),"set":{"$raw":value},"minChanges":1}));
            }
        }
        // Scope each map because the same token can name a fill and a border.
        let scoped = apply(
            &format!("ThemeColors is TUIStyleGuide ({field} = {value})"),
            &[
                json!({"op":"bulk","match":{"conditions":[{"on":"name","is":"equals","value":"ThemeColors"}]},"edits":edits,"expect":{"minBlocks":1}}),
            ],
        )?;
        changes.insert(
            (*field).into(),
            json!({"$raw":&scoped[ndf::read::path_range(&scoped,field)?]}),
        );
    }
    let themed = apply(
        original,
        &[
            json!({"op":"copy","selector":{"kind":"object","by":"name","value":"DefaultStyleGuide"},"destination":{"name":STYLE}}),
            json!({"op":"modify","selector":{"kind":"object","by":"name","value":STYLE},"changes":changes}),
        ],
    )?;
    let blocks = ndf::scan(&themed)?;
    let clone = ndf::read::select_block(&blocks, STYLE)?;
    let region = generated::render(
        OWNER,
        &[themed[clone.span.clone()].to_owned()],
        None,
        Some(owner),
    )?;
    generated::upsert(source, &region, OWNER)
}

pub fn generate(ctx: &mut Context) -> Result<Vec<GeneratedFile>> {
    let palette = palette(&ctx.variables["hudPalette"])?;
    let source = ctx.read_target(TARGET)?;
    let identity = ctx.patch_identity(TARGET);
    let content = render(&source, &palette, &identity, ctx.generator_id())?;
    Ok(vec![ctx.output_generated(TARGET, content)?])
}

fn check() -> Result<()> {
    let source = r#"DefaultStyleGuide is TUIStyleGuide (
    BlockColorsMap = MAP [
        ("Frame", MAP [(~/ComponentState/Normal, TColorRTTI(Color = [1, 2, 3, 255])),]),
        ("Alert", MAP [(~/ComponentState/Normal, TColorRTTI(Color = [255, 0, 0, 255])),]),
    ]
    LineColorsMap = MAP [("Frame", MAP [(~/ComponentState/Normal, TColorRTTI(Color = [4, 5, 6, 255])),]),]
    TextSizesMap = MAP [("Small", MAP [(~/ComponentState/Normal, TFloatRTTI(Value = 17)),]),]
)"#;
    let colors = vec![
        (
            "BlockColorsMap",
            vec![Group {
                tokens: &["Frame"],
                states: Map::from_iter([
                    ("Normal".into(), json!([20, 20, 20, 230])),
                    ("Highlighted".into(), json!([60, 60, 60, 255])),
                    ("Grayed".into(), json!([15, 15, 15, 180])),
                ]),
            }],
        ),
        (
            "LineColorsMap",
            vec![Group {
                tokens: &["Frame"],
                states: Map::from_iter([("Normal".into(), json!([210, 210, 210, 255]))]),
            }],
        ),
    ];
    let identity = ndf::operation::Identity::default();
    let output = render(source, &colors, &identity, "sample:theme:colors")?;
    let blocks = ndf::scan(&output)?;
    let original = ndf::read::select_block(&blocks, "DefaultStyleGuide")?;
    let clone = ndf::read::select_block(&blocks, STYLE)?;
    let clone = &output[clone.span.clone()];
    ensure(
        &output[original.span.clone()] == source
            && clone.contains("20, 20, 20, 230")
            && clone.contains("210, 210, 210, 255")
            && clone.contains("255, 0, 0, 255")
            && clone.contains("Value = 17"),
        "HUD changes affected unrelated colors or the default style.",
        "Scope palette edits to the cloned style.",
    )?;
    ensure(
        render(&output, &colors, &identity, "sample:theme:colors")? == output,
        "HUD rendering is not idempotent.",
        "Keep the generated region identity.",
    )?;
    for invalid in [
        json!([1, 2, 3]),
        json!([1, 2, 3, 256]),
        json!([1, -2, 3, 4]),
        json!([1.5, 2, 3, 4]),
        json!("red"),
    ] {
        ensure(
            color(&invalid, "custom").is_err(),
            "Invalid RGBA accepted.",
            "Validate channel count and range.",
        )?;
    }
    ensure(
        color(&json!([0.0, 255, 24, 128]), "custom")? == [0, 255, 24, 128],
        "Integral RGBA rejected.",
        "Allow integral numeric channel values.",
    )?;
    let missing = vec![(
        "BlockColorsMap",
        vec![Group {
            tokens: &["Missing"],
            states: Map::from_iter([("Normal".into(), json!([1, 1, 1, 255]))]),
        }],
    )];
    ensure(
        render(source, &missing, &identity, "sample:theme:colors").is_err(),
        "Missing HUD token was ignored.",
        "Require every configured token.",
    )
}

pub fn checks(_: &mut Context) -> Result<Vec<TestResult>> {
    check()?;
    Ok(vec![TestResult::passed(
        "HUD map scope, original style, states, valid RGBA, and missing tokens",
    )])
}

#[test]
fn theme_contract() {
    check().unwrap();
}
