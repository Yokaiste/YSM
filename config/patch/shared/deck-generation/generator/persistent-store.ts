import { randomUUID } from 'node:crypto';
import { type LocalisationState, upsertLocalisationRow } from '../../localisation.ts';
import { SERIALIZER_ID_LIMITS } from './serializer-ids.ts';
import type { PersistentDivisionMetadata, PersistentStore } from './types.ts';

export function parsePersistentStore(content: string): PersistentStore {
  if (!content.trim()) {
    return createDefaultPersistentStore();
  }

  try {
    return validatePersistentStore(JSON.parse(content));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Persistent deck identity store is invalid; refusing to regenerate stable GUIDs or localisation tokens. Restore the tracked store from Git or a backup before building. ${detail}`,
    );
  }
}

export function ensurePersistentDivisionMetadata(
  store: PersistentStore,
  localisationState: LocalisationState,
  metadataKey: string,
  divisionName: string,
  deckName: string,
): PersistentDivisionMetadata {
  let metadata = store.divisions[metadataKey];
  if (!metadata) {
    metadata = {
      guid: randomUUID(),
      divisionNameToken: generateUniqueToken(localisationState, () => {
        const token = `YD${String(store.nextDivisionNameToken).padStart(8, '0')}`;
        store.nextDivisionNameToken += 1;
        return token;
      }),
      deckNameToken: generateUniqueToken(localisationState, () => {
        const token = `YK${String(store.nextDeckNameToken).padStart(8, '0')}`;
        store.nextDeckNameToken += 1;
        return token;
      }),
    };
  } else {
    validatePersistentDivisionMetadata(metadataKey, metadata);
  }
  store.divisions[metadataKey] = metadata;

  ensureLocalisationRow(localisationState, metadata.divisionNameToken, divisionName);
  ensureLocalisationRow(localisationState, metadata.deckNameToken, deckName);
  return metadata;
}

export function prunePersistentStore(store: PersistentStore, activeKeys: string[]): void {
  const activeKeySet = new Set(activeKeys);
  for (const key of Object.keys(store.divisions)) {
    if (!activeKeySet.has(key)) {
      delete store.divisions[key];
    }
  }
}

function createDefaultPersistentStore(): PersistentStore {
  return {
    version: 2,
    nextDivisionNameToken: 1,
    nextDeckNameToken: 1,
    divisions: {},
    serializer: createDefaultPersistentSerializer(),
  };
}

function createDefaultPersistentSerializer(): PersistentStore['serializer'] {
  return {
    nextDivisionId: SERIALIZER_ID_LIMITS.division.start,
    nextUnitId: SERIALIZER_ID_LIMITS.unit.start,
    divisionIds: {},
    unitIds: {},
  };
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validatePersistentStore(value: unknown): PersistentStore {
  if (!isRecord(value)) {
    throw new Error('Expected a JSON object.');
  }
  if (value.version !== 2) {
    throw new Error(`Unsupported store version: ${String(value.version)}.`);
  }
  const nextDivisionNameToken = readPositiveInteger(
    value.nextDivisionNameToken,
    'nextDivisionNameToken',
  );
  const nextDeckNameToken = readPositiveInteger(value.nextDeckNameToken, 'nextDeckNameToken');
  if (!isRecord(value.divisions)) {
    throw new Error('`divisions` must be an object.');
  }

  const divisions: Record<string, PersistentDivisionMetadata> = {};
  const guids = new Set<string>();
  const divisionTokens = new Set<string>();
  const deckTokens = new Set<string>();
  let maxDivisionToken = 0;
  let maxDeckToken = 0;
  for (const [key, rawMetadata] of Object.entries(value.divisions)) {
    if (!isRecord(rawMetadata)) {
      throw new Error(`Division metadata \`${key}\` must be an object.`);
    }
    const metadata = {
      guid: rawMetadata.guid,
      divisionNameToken: rawMetadata.divisionNameToken,
      deckNameToken: rawMetadata.deckNameToken,
    };
    validatePersistentDivisionMetadata(key, metadata);
    assertUniquePersistentValue(guids, metadata.guid, `GUID for \`${key}\``);
    assertUniquePersistentValue(
      divisionTokens,
      metadata.divisionNameToken,
      `division token for \`${key}\``,
    );
    assertUniquePersistentValue(deckTokens, metadata.deckNameToken, `deck token for \`${key}\``);
    maxDivisionToken = Math.max(
      maxDivisionToken,
      readTokenNumber(metadata.divisionNameToken, 'YD'),
    );
    maxDeckToken = Math.max(maxDeckToken, readTokenNumber(metadata.deckNameToken, 'YK'));
    divisions[key] = metadata;
  }

  if (nextDivisionNameToken <= maxDivisionToken || nextDeckNameToken <= maxDeckToken) {
    throw new Error('Next-token counters must be greater than every stored token number.');
  }
  const serializer = validatePersistentSerializer(value.serializer);
  return { version: 2, nextDivisionNameToken, nextDeckNameToken, divisions, serializer };
}

function validatePersistentSerializer(value: unknown): PersistentStore['serializer'] {
  if (!isRecord(value)) {
    throw new Error('`serializer` must be an object.');
  }
  const nextDivisionId = readSerializerId(
    value.nextDivisionId,
    'serializer.nextDivisionId',
    SERIALIZER_ID_LIMITS.division.start,
    SERIALIZER_ID_LIMITS.division.maximum + 1,
  );
  const nextUnitId = readSerializerId(
    value.nextUnitId,
    'serializer.nextUnitId',
    SERIALIZER_ID_LIMITS.unit.start,
    SERIALIZER_ID_LIMITS.unit.maximum + 1,
  );
  const divisionIds = validateSerializerIdMap(
    value.divisionIds,
    'serializer.divisionIds',
    SERIALIZER_ID_LIMITS.division.start,
    SERIALIZER_ID_LIMITS.division.maximum,
  );
  const unitIds = validateSerializerIdMap(
    value.unitIds,
    'serializer.unitIds',
    SERIALIZER_ID_LIMITS.unit.start,
    SERIALIZER_ID_LIMITS.unit.maximum,
  );
  const maxDivisionId = Math.max(
    SERIALIZER_ID_LIMITS.division.start - 1,
    ...Object.values(divisionIds),
  );
  const maxUnitId = Math.max(SERIALIZER_ID_LIMITS.unit.start - 1, ...Object.values(unitIds));
  if (nextDivisionId <= maxDivisionId || nextUnitId <= maxUnitId) {
    throw new Error('Serializer next-ID counters must be greater than every stored ID.');
  }
  return { nextDivisionId, nextUnitId, divisionIds, unitIds };
}

function validateSerializerIdMap(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
): Record<string, number> {
  if (!isRecord(value)) {
    throw new Error(`\`${label}\` must be an object.`);
  }
  const result: Record<string, number> = {};
  const usedIds = new Set<number>();
  for (const [name, rawId] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_]+$/.test(name)) {
      throw new Error(`\`${label}\` contains an invalid descriptor name: ${name}.`);
    }
    const id = readSerializerId(rawId, `${label}.${name}`, minimum, maximum);
    if (usedIds.has(id)) {
      throw new Error(`\`${label}\` contains duplicate ID ${id}.`);
    }
    usedIds.add(id);
    result[name] = id;
  }
  return result;
}

function readSerializerId(value: unknown, label: string, minimum: number, maximum: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(`\`${label}\` must be a safe integer from ${minimum} through ${maximum}.`);
  }
  return value;
}

function validatePersistentDivisionMetadata(
  key: string,
  metadata: { guid: unknown; divisionNameToken: unknown; deckNameToken: unknown },
): asserts metadata is PersistentDivisionMetadata {
  if (
    !isNonEmptyString(metadata.guid) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      metadata.guid,
    )
  ) {
    throw new Error(`Division \`${key}\` has an invalid GUID.`);
  }
  if (
    !isNonEmptyString(metadata.divisionNameToken) ||
    !/^YD\d{8}$/.test(metadata.divisionNameToken)
  ) {
    throw new Error(`Division \`${key}\` has an invalid division-name token.`);
  }
  if (!isNonEmptyString(metadata.deckNameToken) || !/^YK\d{8}$/.test(metadata.deckNameToken)) {
    throw new Error(`Division \`${key}\` has an invalid deck-name token.`);
  }
}

function readPositiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`\`${label}\` must be a positive integer.`);
  }
  return value;
}

function readTokenNumber(token: string, prefix: 'YD' | 'YK'): number {
  return Number(token.slice(prefix.length));
}

function assertUniquePersistentValue(values: Set<string>, value: string, label: string): void {
  if (values.has(value)) {
    throw new Error(`Duplicate ${label}: ${value}.`);
  }
  values.add(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function generateUniqueToken(
  localisationState: LocalisationState,
  createCandidate: () => string,
): string {
  let token = createCandidate();
  while (localisationState.lineIndexByToken.has(token)) {
    token = createCandidate();
  }
  return token;
}

function ensureLocalisationRow(
  localisationState: LocalisationState,
  token: string,
  refText: string,
): void {
  upsertLocalisationRow(localisationState, token, refText);
}
