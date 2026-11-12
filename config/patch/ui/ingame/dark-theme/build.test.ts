import assert from 'node:assert/strict';
import type { BuildScriptTestContext } from 'ymb/api';
import { renderTheme } from './build.ts';
import { makePalette, type Palette, readColor } from './palette.ts';

export default async function test({ tools }: BuildScriptTestContext) {
  // Invented colors exercise the public settings without pinning the shipped palette.
  const custom = [31, 42, 53, 164];
  const settings: Record<string, unknown> = Object.fromEntries(
    [
      'panel',
      'panelTranslucent',
      'raised',
      'border',
      'text',
      'textMuted',
      'textFaint',
      'weaponInset',
      'transparent',
      'tooltip',
      'alertFade',
      'alertBackground',
    ].map((key) => [key, custom]),
  );
  for (const key of ['button', 'buttonLine', 'buttonText', 'medium', 'weaponOverlay']) {
    settings[key] = { Normal: custom, Highlighted: [64, 75, 86, 197] };
  }
  const customPalette = makePalette(settings, tools);
  const fixture = `DefaultStyleGuide is TUIStyleGuide (
    ${Object.entries(customPalette)
      .map(
        ([field, groups]) => `${field} = MAP [
      ${groups
        .flatMap(({ tokens }) =>
          tokens.map(
            (token) =>
              `("${token}", MAP [(~/ComponentState/Normal, TColorRTTI(Color = [1, 2, 3, 4])),]),`,
          ),
        )
        .join('\n')}
    ]`,
      )
      .join('\n')}
  )`;
  const customResult = await renderTheme(fixture, tools, customPalette);
  const customStyle = tools.ndf.findNamedBlock(customResult, 'YSMInGameStyleGuide')?.text ?? '';
  assert.match(customStyle, /31, 42, 53, 164/);
  assert.match(customStyle, /64, 75, 86, 197/);
  assert.doesNotMatch(customStyle, /1, 2, 3, 4/);
  assert.deepEqual(readColor([0, 255, 24, 128], 'custom', tools), [0, 255, 24, 128]);
  for (const invalid of [[1, 2, 3], [1, 2, 3, 256], [1, -2, 3, 4], [1.5, 2, 3, 4], 'red']) {
    assert.throws(() => readColor(invalid, 'custom', tools), /four integer RGBA channels/);
  }
  assert.throws(() =>
    makePalette({ ...settings, button: { Normal: custom, Hover: custom } }, tools),
  );

  const source = `DefaultStyleGuide is TUIStyleGuide (
    BlockColorsMap = MAP [
      ("Frame", MAP [(~/ComponentState/Normal, TColorRTTI(Color = [1, 2, 3, 255])),]),
      ("Alert", MAP [(~/ComponentState/Normal, TColorRTTI(Color = [255, 0, 0, 255])),]),
    ]
    LineColorsMap = MAP [("Frame", MAP [(~/ComponentState/Normal, TColorRTTI(Color = [4, 5, 6, 255])),]),]
    TextSizesMap = MAP [("Small", MAP [(~/ComponentState/Normal, TFloatRTTI(Value = 17)),]),]
  )`;
  const colors: Palette = {
    BlockColorsMap: [
      {
        tokens: ['Frame'],
        states: {
          Normal: [20, 20, 20, 230],
          Highlighted: [60, 60, 60, 255],
          Grayed: [15, 15, 15, 180],
        },
      },
    ],
    LineColorsMap: [{ tokens: ['Frame'], states: { Normal: [210, 210, 210, 255] } }],
  };
  const result = await renderTheme(source, tools, colors);
  const clone = tools.ndf.findNamedBlock(result, 'YSMInGameStyleGuide')?.text ?? '';
  assert.equal(tools.ndf.findNamedBlock(result, 'DefaultStyleGuide')?.text, source);
  assert.match(tools.ndf.readField(clone, 'BlockColorsMap') ?? '', /20, 20, 20, 230/);
  assert.match(tools.ndf.readField(clone, 'LineColorsMap') ?? '', /210, 210, 210, 255/);
  assert.match(clone, /255, 0, 0, 255/);
  assert.match(clone, /ComponentState\/Highlighted/);
  assert.match(clone, /ComponentState\/Grayed/);
  assert.equal(
    tools.ndf.readField(clone, 'TextSizesMap'),
    tools.ndf.readField(source, 'TextSizesMap'),
  );
  tools.ndf.assertValid(result);
  assert.equal(await renderTheme(result, tools, colors), result);
  await assert.rejects(
    () =>
      renderTheme(source, tools, {
        BlockColorsMap: [{ tokens: ['Missing'], states: { Normal: [1, 1, 1, 255] } }],
      }),
    /changed 0 value\(s\).*expects at least 1/,
  );
  return {
    results: [
      {
        name: 'Dark HUD applies configurable RGBA states, preserves the default style and gameplay colors, and rejects invalid colors and missing tokens',
        status: 'passed' as const,
      },
    ],
  };
}
