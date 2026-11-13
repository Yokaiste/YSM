import assert from 'node:assert/strict';
import {
  parseLocalisation,
  renderLocalisation,
  upsertLocalisationRow,
} from '../../shared/localisation.ts';
import {
  ensurePersistentDivisionMetadata,
  getDivisionSummaryToken,
  parsePersistentStore,
} from './generator/persistent-store.ts';
import { validateIdentityLocalisation } from './run-patch.ts';

export default function test() {
  const store = parsePersistentStore('');
  const names = parseLocalisation('"MANUAL";"Keep this row"\n');
  const identity = ensurePersistentDivisionMetadata(
    store,
    names,
    'fixture',
    'First division',
    'First deck',
  );
  upsertLocalisationRow(names, getDivisionSummaryToken(identity.divisionNameToken), 'Summary');
  const stored = JSON.stringify(store);
  const content = renderLocalisation(names);
  assert.doesNotThrow(() => validateIdentityLocalisation(content, [stored]));
  assert.throws(() => validateIdentityLocalisation('', [stored], [identity.divisionNameToken]));
  assert.doesNotThrow(() => validateIdentityLocalisation('', [stored], [])); // Disabled divisions keep their ids, not obsolete text.
  assert.throws(() => validateIdentityLocalisation(content, []));
  assert.throws(() => validateIdentityLocalisation(content, ['{broken']));
  const reloaded = parsePersistentStore(stored);
  assert.deepEqual(
    ensurePersistentDivisionMetadata(
      reloaded,
      names,
      'fixture',
      'Renamed division',
      'Renamed deck',
    ),
    identity,
  );
  assert.equal(JSON.stringify(reloaded), stored);
  assert.ok(renderLocalisation(names).includes('"MANUAL";"Keep this row"'));
  assert.ok(renderLocalisation(names).includes('Renamed division'));
  return {
    results: [
      { name: 'Names remain aligned with stable deck identities', status: 'passed' as const },
    ],
  };
}
