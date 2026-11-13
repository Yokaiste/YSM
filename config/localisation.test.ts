import assert from 'node:assert/strict';
import type { BuildScriptTestContext } from 'ymb/api';
import localisation from './localisation.ts';
import { mergeFeatureLocalisation } from './patch/shared/localisation.ts';

export default async function test({ tools }: BuildScriptTestContext) {
  const source = '"TOKEN";"REFTEXT"\n"${modTag}_OPTION";"Keep this text"\n';
  const context: Parameters<typeof localisation>[0] = {
    tools,
    mod: { id: 'sample', name: 'Sample "Army"', rootPath: '.', configPath: '.' },
    variables: { modTag: 'SAMPLE', modRootName: 'Example' },
  };
  const files = localisation(context);
  const menu = files.find((file) => file.targetRelativePath.endsWith('/INTERFACE_OUTGAME.csv'));
  assert.ok(menu);
  assert.ok(menu.content.includes('"SAMPLE";"Sample ""Army"""'));
  for (const file of files) {
    assert.ok(file.targetRelativePath.startsWith('GameData/Localisation/Example/'));
    assert.ok(!file.content.includes('${modTag}'));
  }
  assert.deepEqual(localisation(context), files);
  const input = {
    ...context,
    readTarget: async () => menu.content,
    readOwnedTextIfExists: async () => source,
  };
  const [merged] = await mergeFeatureLocalisation(input, 'INTERFACE_OUTGAME');
  assert.ok(merged);
  assert.ok(merged.content.includes('"SAMPLE_OPTION";"Keep this text"'));
  assert.ok(merged.content.includes('"SAMPLE";"Sample ""Army"""'));
  assert.deepEqual(
    await mergeFeatureLocalisation(
      { ...input, readTarget: async () => merged.content },
      'INTERFACE_OUTGAME',
    ),
    [merged],
  );
  for (const invalid of ['', 'bad row']) {
    await assert.rejects(
      mergeFeatureLocalisation({ ...input, readOwnedTextIfExists: async () => invalid }, 'UNITS'),
    );
  }
  return {
    results: [
      {
        name: 'Authored translations and faction identity render independently of the menu',
        status: 'passed' as const,
      },
    ],
  };
}
