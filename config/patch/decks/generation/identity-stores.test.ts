import type { BuildScriptTest, ScriptTestResult } from 'ymb/api';

const STORE_RELATIVE_PATHS = [
  'generated-decks.core.store.json',
  'generated-decks.horde.store.json',
] as const;
const EXPECTED_STORE_VERSION = 2;
// Literal on purpose: the folder really is named `${modRootName}`, and the
// builder resolves it when the replace file is materialized.
const LOCALISATION_RELATIVE_PATH = 'replace/GameData/Localisation/${modRootName}/UNITS.csv';
const TOKEN_PATTERN = /^Y[DK](\d{8})$/;
const GUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

interface DivisionEntry {
  guid: string;
  divisionNameToken: string;
  deckNameToken: string;
}

interface DeckIdentityStore {
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

function check(storePath: string, name: string, failure: string | undefined): ScriptTestResult {
  const qualifiedName = `${storePath} :: ${name}`;
  return failure === undefined
    ? { name: qualifiedName, status: 'passed' }
    : {
        name: qualifiedName,
        status: 'failed',
        reason: failure,
        suggestion: `Restore \`${storePath}\` from version control rather than editing it by hand. It maps divisions to the ids players already have in saved decks.`,
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

function checkStore(storePath: string, raw: string): ScriptTestResult[] {
  // Generation writes both stores on every run, so by the time this runs a
  // missing file means the write itself did not happen - never that someone
  // cleared it, which the run before this one has already made good.
  if (raw.trim().length === 0) {
    return [
      {
        name: `${storePath} :: the identity store was written`,
        status: 'failed',
        reason: 'The store is missing or empty after generation ran.',
        suggestion:
          'Check that the generation script completed and could write to its patch folder.',
      },
    ];
  }

  let store: DeckIdentityStore;
  try {
    store = JSON.parse(raw) as DeckIdentityStore;
  } catch (error) {
    return [
      check(
        storePath,
        'the identity store is valid JSON',
        `The store did not parse: ${error instanceof Error ? error.message : String(error)}`,
      ),
    ];
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

  return [
    check(
      storePath,
      'the store is the version this mod writes',
      store.version === EXPECTED_STORE_VERSION
        ? undefined
        : `Expected version ${EXPECTED_STORE_VERSION}, found ${String(store.version)}.`,
    ),
    // An empty store is legitimate -- the horde pass writes nothing when the zombie
    // patches are off. What matters is that whatever ids are there are safe to hand out.
    check(
      storePath,
      'every division has a well-formed guid and tokens',
      malformed === undefined
        ? undefined
        : `Division \`${malformed[0]}\` has a malformed guid or name token.`,
    ),
    check(
      storePath,
      'no two divisions share a name token',
      findDuplicate(allocatedTokens) === undefined
        ? undefined
        : `Name token \`${findDuplicate(allocatedTokens)}\` is used twice. A saved deck would resolve to the wrong division.`,
    ),
    check(
      storePath,
      'the next token counters are ahead of every allocated token',
      store.nextDivisionNameToken > highestDivisionToken &&
        store.nextDeckNameToken > highestDeckToken
        ? undefined
        : `A counter is not ahead of the tokens already handed out (divisions up to ${highestDivisionToken}, decks up to ${highestDeckToken}). The next division generated would reuse one.`,
    ),
    check(
      storePath,
      'no two divisions share a serializer id',
      findDuplicate(serializerIds.map(String)) === undefined
        ? undefined
        : `Serializer division id \`${findDuplicate(serializerIds.map(String))}\` is used twice.`,
    ),
    check(
      storePath,
      'the serializer counter is ahead of every allocated id',
      store.serializer?.nextDivisionId > Math.max(-1, ...serializerIds)
        ? undefined
        : 'The serializer division counter would hand out an id that is already in use.',
    ),
  ];
}

/**
 * A token with no row shows a division with no name; a row with no token is a
 * leftover from replaced ids. Rows outside the generated shape are hand-written.
 */
function checkLocalisationMatchesStores(
  localisation: string,
  storeContents: string[],
): ScriptTestResult[] {
  const storedTokens = new Set(
    storeContents.flatMap((raw) => {
      if (raw.trim().length === 0) return [];
      try {
        const store = JSON.parse(raw) as DeckIdentityStore;
        return Object.values(store.divisions ?? {}).flatMap((entry) => [
          entry.divisionNameToken,
          entry.deckNameToken,
        ]);
      } catch {
        // A store that did not parse is already a failure of its own check.
        return [];
      }
    }),
  );
  const rowTokens = new Set(
    localisation
      .split(/\r?\n/)
      .map((line) => /^"([^"]*)";/.exec(line)?.[1])
      .filter((token): token is string => token !== undefined),
  );
  const missingRow = [...storedTokens].find((token) => !rowTokens.has(token));
  const staleRow = [...rowTokens].find(
    (token) => TOKEN_PATTERN.test(token) && !storedTokens.has(token),
  );

  return [
    check(
      LOCALISATION_RELATIVE_PATH,
      'every stored token has a localisation row',
      missingRow === undefined
        ? undefined
        : `Token \`${missingRow}\` is in a store but has no row, so its division would show no name.`,
    ),
    check(
      LOCALISATION_RELATIVE_PATH,
      'no generated row outlives the token it was written for',
      staleRow === undefined
        ? undefined
        : `Row \`${staleRow}\` is not in any store. Generated rows are replaced wholesale, so this one is a leftover.`,
    ),
  ];
}

/**
 * A player's saved decks reference these ids, so a reused token or a rolled-back
 * counter silently points an existing deck at the wrong division. Runs `when: after`
 * because the stores are written by the run it grades.
 */
const test: BuildScriptTest = async (context) => {
  const stores = await Promise.all(
    STORE_RELATIVE_PATHS.map(async (storePath) => ({
      storePath,
      raw: await context.readOwnedTextIfExists(storePath),
    })),
  );
  const localisation = await context.readModTextIfExists(LOCALISATION_RELATIVE_PATH);

  return {
    results: [
      ...stores.flatMap(({ storePath, raw }) => checkStore(storePath, raw)),
      ...checkLocalisationMatchesStores(
        localisation,
        stores.map(({ raw }) => raw),
      ),
    ],
  };
};

export default test;
