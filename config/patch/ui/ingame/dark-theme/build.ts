import type { BuildScriptContext, BuildScriptTools } from 'ymb/api';
import { makePalette, type Palette } from './palette.ts';

const TARGET = 'GameData/UserInterface/Style/DefaultStyle/DefaultStyleGuides.ndf';
const OWNER = 'ysm.ui.ingame.dark-theme.style';
const STYLE = 'YSMInGameStyleGuide';

export async function renderTheme(
  source: string,
  tools: BuildScriptTools,
  colors: Palette,
): Promise<string> {
  const original = tools.ndf.findNamedBlock(source, 'DefaultStyleGuide');
  tools.assert.ok(original, {
    reason: 'The match theme needs DefaultStyleGuide.',
    suggestion: 'Check the current WARNO style guide before rebuilding the dark HUD.',
  });
  const changes: Record<string, { $raw: string }> = {};
  for (const [field, groups] of Object.entries(colors)) {
    const value = tools.ndf.readField(original.text, field);
    tools.assert.ok(value, {
      reason: `DefaultStyleGuide is missing ${field}.`,
      suggestion: 'Update the dark HUD palette to match the current WARNO style guide.',
    });
    // Isolate each map: a token can mean a dark fill in one map and a light border in another.
    const scoped = await tools.patch(`ThemeColors is TUIStyleGuide (${field} = ${value})`, {
      file: TARGET,
      operations: [
        {
          op: 'bulk',
          match: { conditions: [{ on: 'name', is: 'equals', value: 'ThemeColors' }] },
          edits: groups.flatMap(({ tokens, states }) =>
            tokens.map((token) => ({
              mapEntry: JSON.stringify(token),
              set: {
                $raw: `MAP [${Object.entries(states)
                  .map(
                    ([state, rgba]) =>
                      `(~/ComponentState/${state}, TColorRTTI(Color = [${rgba.join(', ')}]))`,
                  )
                  .join(', ')},]`,
              },
              minChanges: 1,
            })),
          ),
          expect: { minBlocks: 1 },
        },
      ],
    });
    const updated = tools.ndf.readField(scoped, field);
    tools.assert.ok(updated, {
      reason: `The dark HUD is missing its generated ${field}.`,
      suggestion: 'Check the theme build output.',
    });
    changes[field] = { $raw: updated };
  }
  const themed = await tools.patch(original.text, {
    file: TARGET,
    operations: [
      {
        op: 'copy',
        selector: { kind: 'object', by: 'name', value: 'DefaultStyleGuide' },
        destination: { name: STYLE },
      },
      { op: 'modify', selector: { kind: 'object', by: 'name', value: STYLE }, changes },
    ],
  });
  const clone = tools.ndf.findNamedBlock(themed, STYLE);
  tools.assert.ok(clone, {
    reason: 'The dark HUD style was not generated.',
    suggestion: 'Check the theme build output.',
  });
  return tools.ndf.upsertGeneratedBlock(
    source,
    tools.ndf.renderGeneratedBlock({
      ownerId: OWNER,
      blocks: [clone.text],
    }),
    OWNER,
  );
}

export default async function build(context: BuildScriptContext) {
  return {
    targetRelativePath: TARGET,
    content: await renderTheme(
      await context.readTarget(TARGET),
      context.tools,
      makePalette(context.variables.hudPalette, context.tools),
    ),
  };
}
