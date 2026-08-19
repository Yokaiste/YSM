import type { BuildScriptContext, GeneratedScriptFile } from 'ymb/api';
import { parseLocalisation, removeLocalisationRow, renderLocalisation } from '../localisation.ts';
import { createDeckGenerationSourceAnalysis, generateDeckOutputsFromSources } from './engine.ts';
import {
  collectStoredIdentityTokens,
  isGeneratedIdentityToken,
  parsePersistentStore,
} from './generator/persistent-store.ts';
import { readDeckGenerationSources } from './sources.ts';

export type DeckGenerationScriptContext = Pick<
  BuildScriptContext,
  | 'mod'
  | 'patch'
  | 'tools'
  | 'variables'
  | 'readModTextIfExists'
  | 'writeModTextIfChanged'
  | 'readOwnedTextIfExists'
  | 'writeOwnedTextIfChanged'
  | 'readTargets'
>;

interface CachedDeckGenerationResult {
  outputs: Array<{ targetRelativePath: string; content: string }>;
  localisationContent: string;
  persistentStoreContent: string;
}

// Bump whenever generation output can change for unchanged sources and config.
const DECK_GENERATION_CACHE_VERSION = 8;

export interface DeckGenerationBatchEntry {
  generationConfig: unknown;
  persistentStorePath: string;
  scriptSourcePath: string;
  /** Passes share the target files, so each needs its own id or one overwrites the other. */
  blockOwnerId: string;
}

export async function runDeckGenerationBatch(
  context: DeckGenerationScriptContext,
  entries: readonly [DeckGenerationBatchEntry, ...DeckGenerationBatchEntry[]],
): Promise<GeneratedScriptFile[]> {
  const firstEntry = entries[0];
  const firstPersistentStore = await readPersistentStore(context, firstEntry);
  const initialSources = await readDeckGenerationSources(context, firstEntry.persistentStorePath);
  initialSources.persistentStoreContent = firstPersistentStore;
  const modTag = String(context.variables.modTag ?? context.variables.modId ?? 'MOD');
  const persistentStores = await Promise.all(
    entries.map((entry, index) =>
      index === 0 ? firstPersistentStore : readPersistentStore(context, entry),
    ),
  );
  // Stores are the only source of truth for identity, so the localisation file is
  // aligned to them before a token is minted -- otherwise the minter numbers around
  // rows nobody owns.
  initialSources.localisationContent = pruneUnclaimedGeneratedRows(
    initialSources.localisationContent,
    persistentStores,
  );
  const cacheKey = !context.tools.cache.enabled
    ? undefined
    : await context.tools.cache.createKey({
        version: DECK_GENERATION_CACHE_VERSION,
        modTag,
        entries: entries.map((entry, index) => ({
          generationConfig: entry.generationConfig,
          persistentStorePath: entry.persistentStorePath,
          persistentStore: context.tools.cache.hash(persistentStores[index] ?? ''),
          scriptSourcePath: entry.scriptSourcePath,
          blockOwnerId: entry.blockOwnerId,
        })),
        sources: Object.fromEntries(
          Object.entries(initialSources)
            .filter(([key]) => key !== 'persistentStoreContent')
            .map(([key, value]) => [key, context.tools.cache.hash(value)]),
        ),
      });
  const cachedResults = cacheKey
    ? await context.tools.cache.readJson(
        'deck-generation-batch',
        cacheKey,
        isCachedDeckGenerationResultArray,
      )
    : undefined;
  const results =
    cachedResults ??
    generateDeckGenerationBatchResults(context, entries, initialSources, persistentStores, modTag);

  for (const result of results) await validateGeneratedResult(context, result, modTag);
  if (!cachedResults && cacheKey) {
    await context.tools.cache.writeJson('deck-generation-batch', cacheKey, results);
  }

  const finalResult = results.at(-1);
  await Promise.all([
    ...entries.map((entry, index) =>
      writePersistentStore(context, entry, results[index]?.persistentStoreContent ?? ''),
    ),
    context.writeModTextIfChanged(
      'replace/GameData/Localisation/${modRootName}/UNITS.csv',
      finalResult?.localisationContent ?? initialSources.localisationContent,
    ),
  ]);

  const generatedBlockOwnerPaths = [...new Set(entries.map((entry) => entry.scriptSourcePath))];
  return (finalResult?.outputs ?? []).map((output) => ({
    ...output,
    generatedBlockOwnerPaths,
  }));
}

function generateDeckGenerationBatchResults(
  context: DeckGenerationScriptContext,
  entries: readonly DeckGenerationBatchEntry[],
  initialSources: Awaited<ReturnType<typeof readDeckGenerationSources>>,
  persistentStores: readonly string[],
  modTag: string,
): CachedDeckGenerationResult[] {
  const sourceAnalysis = createDeckGenerationSourceAnalysis({
    ndf: context.tools.ndf,
    values: context.tools.values,
    text: context.tools.text,
    modTag,
    scriptSourcePath: entries[0]?.scriptSourcePath ?? '',
    blockOwnerId: entries[0]?.blockOwnerId ?? '',
    generationConfig: entries[0]?.generationConfig,
    ...initialSources,
  });
  let sources = initialSources;
  const results: CachedDeckGenerationResult[] = [];
  for (const [index, entry] of entries.entries()) {
    const result = generateDeckOutputsFromSources(
      {
        ndf: context.tools.ndf,
        values: context.tools.values,
        text: context.tools.text,
        modTag,
        scriptSourcePath: entry.scriptSourcePath,
        blockOwnerId: entry.blockOwnerId,
        generationConfig: entry.generationConfig,
        ...sources,
        persistentStoreContent: persistentStores[index] ?? '',
      },
      sourceAnalysis,
    );
    results.push(result);
    sources = applyGeneratedSources(sources, result);
  }
  return results;
}

function applyGeneratedSources(
  sources: Awaited<ReturnType<typeof readDeckGenerationSources>>,
  result: CachedDeckGenerationResult,
): Awaited<ReturnType<typeof readDeckGenerationSources>> {
  const contentByTarget = new Map(
    result.outputs.map((output) => [output.targetRelativePath, output.content] as const),
  );
  return {
    ...sources,
    divisionRulesContent:
      contentByTarget.get('GameData/Generated/Gameplay/Decks/DivisionRules.ndf') ??
      sources.divisionRulesContent,
    divisionsContent:
      contentByTarget.get('GameData/Generated/Gameplay/Decks/Divisions.ndf') ??
      sources.divisionsContent,
    deckSerializerContent:
      contentByTarget.get('GameData/Generated/Gameplay/Decks/DeckSerializer.ndf') ??
      sources.deckSerializerContent,
    deckPacksContent:
      contentByTarget.get('GameData/Generated/Gameplay/Decks/DeckPacks.ndf') ??
      sources.deckPacksContent,
    decksContent:
      contentByTarget.get('GameData/Generated/Gameplay/Decks/Decks.ndf') ?? sources.decksContent,
    localisationContent: result.localisationContent,
  };
}

/**
 * A `YD`/`YK` row nothing claims means its store is gone and its ids are free
 * again, which is what lets a removed store start over from the first number.
 * Every other row is hand-authored: read, kept, never rewritten.
 */
function pruneUnclaimedGeneratedRows(content: string, storeContents: readonly string[]): string {
  const storedTokens = new Set(
    storeContents.flatMap((storeContent) =>
      collectStoredIdentityTokens(parsePersistentStore(storeContent)),
    ),
  );
  const localisationState = parseLocalisation(content);
  const staleTokens = [...localisationState.lineIndexByToken.keys()].filter(
    (token) => isGeneratedIdentityToken(token) && !storedTokens.has(token),
  );
  for (const token of staleTokens) {
    removeLocalisationRow(localisationState, token);
  }
  return renderLocalisation(localisationState);
}

async function readPersistentStore(
  context: DeckGenerationScriptContext,
  entry: DeckGenerationBatchEntry,
): Promise<string> {
  return context.readOwnedTextIfExists(entry.persistentStorePath);
}

async function writePersistentStore(
  context: DeckGenerationScriptContext,
  entry: DeckGenerationBatchEntry,
  content: string,
): Promise<boolean> {
  return context.writeOwnedTextIfChanged(entry.persistentStorePath, content);
}

async function validateGeneratedResult(
  context: DeckGenerationScriptContext,
  result: CachedDeckGenerationResult,
  modTag: string,
): Promise<void> {
  await context.tools.assert.all([
    {
      name: 'generated output set is complete',
      suggestion:
        'Inspect the deck-generation filters/configuration and update the script if WARNO changed the deck data format.',
      run: () => {
        const requiredTargets = [
          'GameData/Generated/Gameplay/Decks/DivisionRules.ndf',
          'GameData/Generated/Gameplay/Decks/Divisions.ndf',
          'GameData/Generated/Gameplay/Decks/DeckSerializer.ndf',
          'GameData/Generated/Gameplay/Decks/DeckPacks.ndf',
          'GameData/Generated/Gameplay/Decks/Decks.ndf',
        ];
        const generatedTargets = new Set(result.outputs.map((output) => output.targetRelativePath));
        const missingTargets = requiredTargets.filter((target) => !generatedTargets.has(target));
        context.tools.assert.ok(missingTargets.length === 0, {
          reason: 'Deck generation did not return every required output file.',
          suggestion:
            'Ensure the script produces DivisionRules, Divisions, DeckSerializer, DeckPacks, and Decks outputs.',
          details: missingTargets.map((target) => `Missing output: ${target}`),
        });
      },
    },
    {
      name: 'generated divisions and balanced rules stay semantically safe',
      suggestion:
        'Inspect division filtering and balanced availability derivation before publishing these generated decks.',
      run: () => {
        const divisionsOutput = result.outputs.find(
          (output) =>
            output.targetRelativePath === 'GameData/Generated/Gameplay/Decks/Divisions.ndf',
        );
        const divisionRulesOutput = result.outputs.find(
          (output) =>
            output.targetRelativePath === 'GameData/Generated/Gameplay/Decks/DivisionRules.ndf',
        );
        const safeModTag = modTag.replaceAll(/[^A-Za-z0-9]+/g, '_').replaceAll(/^_+|_+$/g, '');
        context.tools.assert.ok(
          Boolean(divisionsOutput?.content.includes(`Descriptor_Deck_Division_${safeModTag}_`)),
          {
            reason: 'Deck generation produced no division descriptors for the configured mod tag.',
            suggestion:
              'Check country/coalition filters and ensure at least one configured division context remains active.',
          },
        );
        const unsafeBalancedRule = divisionRulesOutput?.content.match(
          /export Descriptor_Deck_Division_[A-Za-z0-9_]+_BALANCED_Rule[\s\S]*?(?:MaxPackNumber\s*=\s*(?:100|999)|NumberOfUnitInPack\s*=\s*100)/,
        );
        context.tools.assert.ok(!unsafeBalancedRule, {
          reason: 'Generated balanced division rules contain 100/999-style availability values.',
          suggestion:
            'Keep special vanilla rules filtered and derive bounded representative availability for balanced decks.',
          details: unsafeBalancedRule ? [unsafeBalancedRule[0].slice(0, 500)] : [],
        });
      },
    },
  ]);
}

function isCachedDeckGenerationResultArray(value: unknown): value is CachedDeckGenerationResult[] {
  return Array.isArray(value) && value.length > 0 && value.every(isCachedDeckGenerationResult);
}

function isCachedDeckGenerationResult(value: unknown): value is CachedDeckGenerationResult {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<CachedDeckGenerationResult>;
  return (
    typeof candidate.localisationContent === 'string' &&
    typeof candidate.persistentStoreContent === 'string' &&
    Array.isArray(candidate.outputs) &&
    candidate.outputs.every(
      (output) =>
        Boolean(output) &&
        typeof output === 'object' &&
        typeof output.targetRelativePath === 'string' &&
        typeof output.content === 'string',
    )
  );
}
