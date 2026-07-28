import type { BuildScriptTest, ScriptTestResult } from 'ymb/api';

const STORE_RELATIVE_PATH = 'generated-decks.zombie-horde.store.json';
const EXPECTED_STORE_VERSION = 2;
const TOKEN_PATTERN = /^Y[DK](\d{8})$/;
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface DivisionEntry {
  guid: string;
  divisionNameToken: string;
  deckNameToken: string;
}

interface HordeStore {
  version: number;
  nextDivisionNameToken: number;
  nextDeckNameToken: number;
  divisions: Record<string, DivisionEntry>;
  serializer: {
    nextDivisionId: number;
    nextUnitId: number;
    divisionIds: Record<string, number>;
  };
}

function tokenNumber(token: string): number | undefined {
  const digits = TOKEN_PATTERN.exec(token)?.[1];
  return digits === undefined ? undefined : Number(digits);
}

function check(name: string, failure: string | undefined): ScriptTestResult {
  return failure === undefined
    ? { name, status: 'passed' }
    : {
        name,
        status: 'failed',
        reason: failure,
        suggestion: `Restore \`${STORE_RELATIVE_PATH}\` from version control rather than editing it by hand. It maps divisions to the ids players already have in saved decks.`,
      };
}

function findDuplicate(values: string[]): string | undefined {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return undefined;
}

/**
 * The horde generation itself is coordinated by the sandbox core script, so this
 * covers what belongs to this patch alone: the persistent identity store.
 *
 * These ids are not derived data. A player's saved decks reference them, so a
 * reused token or a rolled-back counter silently points an existing deck at the
 * wrong division - which no NDF validation would catch.
 */
const test: BuildScriptTest = async (context) => {
  const raw = await context.readOwnedTextIfExists(STORE_RELATIVE_PATH);
  if (raw.trim().length === 0) {
    return {
      results: [
        check('the identity store exists', `\`${STORE_RELATIVE_PATH}\` is missing or empty.`),
      ],
    };
  }

  let store: HordeStore;
  try {
    store = JSON.parse(raw) as HordeStore;
  } catch (error) {
    return {
      results: [
        check(
          'the identity store is valid JSON',
          `\`${STORE_RELATIVE_PATH}\` did not parse: ${error instanceof Error ? error.message : String(error)}`,
        ),
      ],
    };
  }

  const divisions = Object.entries(store.divisions ?? {});
  const divisionTokens = divisions.map(([, entry]) => entry.divisionNameToken);
  const deckTokens = divisions.map(([, entry]) => entry.deckNameToken);
  const allocatedTokens = [...divisionTokens, ...deckTokens];

  const malformed = divisions.find(
    ([, entry]) =>
      !GUID_PATTERN.test(entry.guid ?? '') ||
      tokenNumber(entry.divisionNameToken ?? '') === undefined ||
      tokenNumber(entry.deckNameToken ?? '') === undefined,
  );

  const highestDivisionToken = Math.max(
    -1,
    ...divisionTokens.map((token) => tokenNumber(token) ?? -1),
  );
  const highestDeckToken = Math.max(-1, ...deckTokens.map((token) => tokenNumber(token) ?? -1));
  const serializerIds = Object.values(store.serializer?.divisionIds ?? {});

  return {
    results: [
      check(
        'the store is the version this mod writes',
        store.version === EXPECTED_STORE_VERSION
          ? undefined
          : `Expected version ${EXPECTED_STORE_VERSION}, found ${String(store.version)}.`,
      ),
      check(
        'every division is registered',
        divisions.length > 0 ? undefined : 'The store lists no divisions.',
      ),
      check(
        'every division has a well-formed guid and tokens',
        malformed === undefined
          ? undefined
          : `Division \`${malformed[0]}\` has a malformed guid or name token.`,
      ),
      check(
        'no two divisions share a name token',
        findDuplicate(allocatedTokens) === undefined
          ? undefined
          : `Name token \`${findDuplicate(allocatedTokens)}\` is used twice. A saved deck would resolve to the wrong division.`,
      ),
      check(
        'the next token counters are ahead of every allocated token',
        store.nextDivisionNameToken > highestDivisionToken &&
          store.nextDeckNameToken > highestDeckToken
          ? undefined
          : `A counter is not ahead of the tokens already handed out (divisions up to ${highestDivisionToken}, decks up to ${highestDeckToken}). The next division generated would reuse one.`,
      ),
      check(
        'no two divisions share a serializer id',
        findDuplicate(serializerIds.map(String)) === undefined
          ? undefined
          : `Serializer division id \`${findDuplicate(serializerIds.map(String))}\` is used twice.`,
      ),
      check(
        'the serializer counter is ahead of every allocated id',
        store.serializer?.nextDivisionId > Math.max(-1, ...serializerIds)
          ? undefined
          : 'The serializer division counter would hand out an id that is already in use.',
      ),
    ],
  };
};

export default test;
