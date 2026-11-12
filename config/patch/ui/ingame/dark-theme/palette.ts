import type { BuildScriptTools } from 'ymb/api';

type Color = readonly [number, number, number, number];
type States = Readonly<Record<string, Color>>;
export type Palette = Readonly<
  Record<string, readonly { tokens: readonly string[]; states: States }[]>
>;

export function readColor(value: unknown, label: string, tools: BuildScriptTools): Color {
  tools.assert.ok(
    Array.isArray(value) &&
      value.length === 4 &&
      value.every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255),
    {
      reason: `${label} must contain four integer RGBA channels from 0 to 255.`,
      suggestion: 'Set an RGBA list such as [24, 25, 28, 240] in hudPalette.',
    },
  );
  return value as unknown as Color;
}

export function makePalette(value: unknown, tools: BuildScriptTools): Palette {
  const settings = tools.values.record(value, 'hudPalette');
  const color = (name: string) => readColor(settings[name], `hudPalette.${name}`, tools);
  const states = (name: string): States => {
    const entries = tools.values.record(settings[name], `hudPalette.${name}`);
    tools.assert.ok('Normal' in entries, {
      reason: `hudPalette.${name} needs a Normal color.`,
      suggestion: 'Keep Normal and override individual interaction states.',
    });
    return Object.fromEntries(
      Object.entries(entries).map(([state, rgba]) => [
        tools.values.oneOf(state, `hudPalette.${name} state`, [
          'Normal',
          'Highlighted',
          'Clicked',
          'Toggled',
          'ToggleHighlighted',
          'ToggleClicked',
          'Grayed',
        ]),
        readColor(rgba, `hudPalette.${name}.${state}`, tools),
      ]),
    );
  };
  const button = states('button');
  const buttonLine = states('buttonLine');
  const buttonText = states('buttonText');
  // Only HUD chrome: faction colors, targeting, health, supply and alert states retain WARNO's palette.
  // Some background/line tokens live in TextColorsMap because BUCK falls back to that map.
  return {
    BlockColorsMap: [
      { tokens: ['AlertPanel/Gradient0'], states: { Normal: color('alertFade') } },
      { tokens: ['AlertPanel/Gradient1'], states: { Normal: color('alertBackground') } },
      {
        tokens: ['H2_bleu_2', 'H2_bleu_2_235', 'TacticPanel', 'H2_bleu_4'],
        states: { Normal: color('panel') },
      },
      {
        tokens: ['H2_bleu_2_60p', 'H2_bleu_2_40p', 'H2_bleu_2_30p'],
        states: { Normal: color('panelTranslucent') },
      },
      {
        tokens: [
          'H2_bleu_1',
          'H2_bleu_1_hint',
          'H2_bleu_2_hint',
          'H2_bleu_3_hint',
          'H2_bleu_4_hint',
        ],
        states: { Normal: color('raised') },
      },
      {
        tokens: [
          'BoutonTemps_Background',
          'BoutonTemps_pawn',
          'BoutonBeacons',
          'BoutonSelectionMultiple',
          'OffMapUnitButtonName',
          'H2_bleu_5',
          'TacticButton_highlightable',
        ],
        states: button,
      },
      {
        tokens: ['H2_bleu_3'],
        states: states('medium'),
      },
    ],
    LineColorsMap: [
      {
        tokens: [
          'H2_bleu_2',
          'H2_bleu_2_40p',
          'H2_bleu_3',
          'LigneSeparatricePanelRessources',
          'TacticPanel',
        ],
        states: { Normal: color('border') },
      },
      { tokens: ['BoutonTemps_Line', 'TacticButton_highlightable'], states: buttonLine },
      { tokens: ['ArmoryUnitButtonName'], states: button },
      {
        tokens: ['BoutonVignetteAchat'],
        states: {
          ...buttonLine,
          Normal: color('transparent'),
          Grayed: color('transparent'),
        },
      },
    ],
    TextColorsMap: [
      {
        tokens: ['hint_fond_meilleureLecture', 'hint_fond', 'Hint_fond'],
        states: { Normal: color('tooltip') },
      },
      {
        tokens: ['hint_titre_meilleureLecture', 'Hint_titre', 'Hint_main'],
        states: { Normal: color('text') },
      },
      { tokens: ['Hint_ligne'], states: { Normal: color('border') } },
      { tokens: ['TypeA', 'TypeB', 'TypeB_alpha', 'TypeE'], states: { Normal: color('panel') } },
      { tokens: ['TypeC'], states: { Normal: color('raised') } },
      { tokens: ['TypeD'], states: { Normal: color('weaponInset') } },
      {
        tokens: ['LigneA', 'LigneB', 'CouleurBordure_boutonShortcuts'],
        states: buttonLine,
      },
      {
        tokens: ['CyanChrono', 'BlancEquipe', 'TacticPanel', 'H2_bleu_1'],
        states: { Normal: color('text') },
      },
      { tokens: ['CyanChrono_180', 'BlancEquipe_alpha'], states: { Normal: color('textMuted') } },
      { tokens: ['CyanChrono_120'], states: { Normal: color('textFaint') } },
      {
        tokens: [
          'BoutonTemps_Text',
          'ButtonHUD/Text2',
          'ButtonHUD/Text2_pawn',
          'TacticButton_highlightable',
          'CouleurTexture_boutonShortcuts',
          'BoutonUnitPatternClair',
          'BoutonXP_deck_chevron',
        ],
        states: buttonText,
      },
      { tokens: ['CouleurFond_boutonShortcuts'], states: button },
      {
        tokens: ['WeaponButton/Overblock'],
        states: states('weaponOverlay'),
      },
    ],
  };
}
