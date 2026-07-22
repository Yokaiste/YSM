import type { BuildScriptContext, GeneratedScriptFile } from 'ymb/api';
import {
  createDeckGenerationSourceAnalysis,
  generateDeckOutputs,
  generateDeckOutputsFromSources,
} from './engine.ts';
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

interface DeckGenerationPatchOptions {
  persistentStoreFileName: string;
  scriptSourcePath: string;
}

interface CachedDeckGenerationResult {
  outputs: Array<{ targetRelativePath: string; content: string }>;
  localisationContent: string;
  persistentStoreContent: string;
}

const DECK_GENERATION_CACHE_VERSION = 6;

export interface DeckGenerationBatchEntry {
  generationConfig: unknown;
  persistentStorePath: string;
  persistentStoreScope: 'owned' | 'mod';
  scriptSourcePath: string;
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
  const cacheKey = !context.tools.cache.enabled
    ? undefined
    : await context.tools.cache.createKey({
        version: DECK_GENERATION_CACHE_VERSION + 1,
        modTag,
        entries: entries.map((entry, index) => ({
          generationConfig: entry.generationConfig,
          persistentStorePath: entry.persistentStorePath,
          persistentStore: context.tools.cache.hash(persistentStores[index] ?? ''),
          scriptSourcePath: entry.scriptSourcePath,
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

  const generatedBlockOwnerPaths = entries.map((entry) => entry.scriptSourcePath);
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

async function readPersistentStore(
  context: DeckGenerationScriptContext,
  entry: DeckGenerationBatchEntry,
): Promise<string> {
  return entry.persistentStoreScope === 'owned'
    ? context.readOwnedTextIfExists(entry.persistentStorePath)
    : context.readModTextIfExists(entry.persistentStorePath);
}

async function writePersistentStore(
  context: DeckGenerationScriptContext,
  entry: DeckGenerationBatchEntry,
  content: string,
): Promise<boolean> {
  return entry.persistentStoreScope === 'owned'
    ? context.writeOwnedTextIfChanged(entry.persistentStorePath, content)
    : context.writeModTextIfChanged(entry.persistentStorePath, content);
}

export async function runDeckGenerationPatch(
  context: DeckGenerationScriptContext,
  options: DeckGenerationPatchOptions,
): Promise<Array<{ targetRelativePath: string; content: string }>> {
  const sources = await readDeckGenerationSources(context, options.persistentStoreFileName);
  const modTag = String(context.variables.modTag ?? context.variables.modId ?? 'MOD');
  const cacheKey = !context.tools.cache.enabled
    ? undefined
    : await context.tools.cache.createKey({
        version: DECK_GENERATION_CACHE_VERSION,
        persistentStoreFileName: options.persistentStoreFileName,
        modTag,
        generationConfig: context.variables.deckGeneration ?? null,
        sources: Object.fromEntries(
          Object.entries(sources).map(([key, value]) => [key, context.tools.cache.hash(value)]),
        ),
      });
  const cachedResult = cacheKey
    ? await context.tools.cache.readJson('deck-generation', cacheKey, isCachedDeckGenerationResult)
    : undefined;

  const result =
    cachedResult ??
    generateDeckOutputs({
      ndf: context.tools.ndf,
      values: context.tools.values,
      text: context.tools.text,
      modTag,
      scriptSourcePath: options.scriptSourcePath,
      generationConfig: context.variables.deckGeneration,
      ...sources,
    });

  await validateGeneratedResult(context, result, modTag);

  if (!cachedResult && cacheKey) {
    await context.tools.cache.writeJson('deck-generation', cacheKey, result);
  }

  await Promise.all([
    context.writeOwnedTextIfChanged(options.persistentStoreFileName, result.persistentStoreContent),
    context.writeModTextIfChanged(
      'replace/GameData/Localisation/${modRootName}/UNITS.csv',
      result.localisationContent,
    ),
  ]);

  return result.outputs;
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

function isCachedDeckGenerationResultArray(value: unknown): value is CachedDeckGenerationResult[] {
  return Array.isArray(value) && value.length > 0 && value.every(isCachedDeckGenerationResult);
}
