import assert from 'node:assert/strict';
import type { BuildScriptTestContext } from 'ymb/api';
import { SERIALIZER_ID_LIMITS } from './generator/types.ts';
import { injectDeckSerializerEntries } from './render.ts';

export default function test({ tools }: BuildScriptTestContext) {
  const sourcePath = 'mods/$&-$1/config/generate.ts';
  const input = 'Serializer is TSerializer(\nDivisionIds = MAP [\n]\nUnitIds = MAP [\n]\n)\n';
  const state = {
    nextDivisionId: SERIALIZER_ID_LIMITS.division.start,
    nextUnitId: SERIALIZER_ID_LIMITS.unit.start,
    divisionIds: {},
    unitIds: {},
  };
  const generate = (content: string) =>
    injectDeckSerializerEntries(
      tools.ndf,
      tools.text.escapeRegExp,
      content,
      [],
      ['Fixture'],
      'fixture-owner',
      sourcePath,
      state,
    );
  const output = generate(input);
  assert.ok(output.includes(`// Source: ${sourcePath}\n`));
  assert.equal(tools.ndf.findTopLevelBlocks(output).length, 1);
  assert.equal(generate(output), output);
  assert.ok(output.includes(`($/GFX/Unit/Fixture, ${SERIALIZER_ID_LIMITS.unit.start})`));
  return { results: [{ name: 'Literal serializer source paths', status: 'passed' as const }] };
}
