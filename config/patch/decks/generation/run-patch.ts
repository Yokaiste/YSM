import type { BuildScriptContext, GeneratedScriptFile } from 'ymb/api';
import { parseLocalisation } from '../../shared/localisation.ts';
import { createDeckGenerationSourceAnalysis, generateDeckOutputsFromSources } from './engine.ts';
import { sanitizeIdentifier } from './generator/helpers.ts';
import {
  collectStoredIdentityTokens,
  isGeneratedIdentityToken,
  parsePersistentStore,
  reserveIdentityCounters,
} from './generator/persistent-store.ts';
import { readDeckGenerationSources, TARGET_PATHS } from './sources.ts';

export type DeckGenerationScriptContext = Pick<
  BuildScriptContext,
  | 'mod'
  | 'builder'
  | 'patch'
  | 'tools'
  | 'variables'
  | 'readTarget'
  | 'readOwnedTextIfExists'
  | 'writeOwnedTextIfChanged'
  | 'readTargets'
>;

interface CachedDeckGenerationResult {
  outputs: Array<{ targetRelativePath: string; content: string }>;
  localisationContent: string;
  persistentStoreContent: string;
}

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
  const initialSources = await readDeckGenerationSources(context, firstEntry.persistentStorePath);
  const modTag = String(context.variables.modTag ?? context.variables.modId ?? 'MOD');
  const persistentStores = await Promise.all(
    entries.map((entry, index) =>
      index === 0
        ? initialSources.persistentStoreContent
        : context.readOwnedTextIfExists(entry.persistentStorePath),
    ),
  );
  const cacheKey = !context.tools.cache.enabled
    ? undefined
    : await context.tools.cache.createKey({
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
        (value): value is CachedDeckGenerationResult[] =>
          isCachedDeckGenerationResults(value, entries.length),
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
  validateIdentityLocalisation(
    finalResult?.localisationContent ?? initialSources.localisationContent,
    results.map((result) => result.persistentStoreContent),
    (finalResult?.outputs ?? []).flatMap((output) =>
      [...output.content.matchAll(/['"](Y[DKT]\d{8})['"]/g)].map((match) => match[1] as string),
    ),
  );
  await Promise.all(
    entries.map((entry, index) => {
      const result = results[index];
      if (!result)
        throw new Error(`Missing deck-generation result for ${entry.persistentStorePath}.`);
      return context.writeOwnedTextIfChanged(
        entry.persistentStorePath,
        result.persistentStoreContent,
      );
    }),
  );

  const generatedBlockOwnerPaths = [...new Set(entries.map((entry) => entry.scriptSourcePath))];
  return [
    ...(finalResult?.outputs ?? []).map((output) => ({ ...output, generatedBlockOwnerPaths })),
    {
      targetRelativePath: `GameData/Localisation/${context.variables.modRootName}/UNITS.csv`,
      content: finalResult?.localisationContent ?? initialSources.localisationContent,
    },
  ];
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
  const stores = persistentStores.map(parsePersistentStore);
  const results: CachedDeckGenerationResult[] = [];
  for (const [index, entry] of entries.entries()) {
    reserveIdentityCounters(stores);
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
        persistentStoreContent: JSON.stringify(stores[index]),
      },
      sourceAnalysis,
    );
    results.push(result);
    stores[index] = parsePersistentStore(result.persistentStoreContent);
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
      contentByTarget.get(TARGET_PATHS.divisionRulesContent) ?? sources.divisionRulesContent,
    divisionsContent:
      contentByTarget.get(TARGET_PATHS.divisionsContent) ?? sources.divisionsContent,
    deckSerializerContent:
      contentByTarget.get(TARGET_PATHS.deckSerializerContent) ?? sources.deckSerializerContent,
    deckPacksContent:
      contentByTarget.get(TARGET_PATHS.deckPacksContent) ?? sources.deckPacksContent,
    decksContent: contentByTarget.get(TARGET_PATHS.decksContent) ?? sources.decksContent,
    localisationContent: result.localisationContent,
  };
}

export function validateIdentityLocalisation(
  content: string,
  storeContents: readonly string[],
  requiredTokens?: readonly string[],
): void {
  const expected = new Set(
    storeContents.flatMap((raw) => collectStoredIdentityTokens(parsePersistentStore(raw))),
  );
  const actual = new Set(parseLocalisation(content).lineIndexByToken.keys());
  const missing = [...(requiredTokens ?? expected)].filter((token) => !actual.has(token));
  const stale = [...actual].filter(
    (token) => isGeneratedIdentityToken(token) && !expected.has(token),
  );
  if (missing.length || stale.length) {
    throw new Error(
      `Generated deck names do not match their identity stores. Missing: ${missing.join(', ')}; unclaimed: ${stale.join(', ')}. Check deck generation before writing these files.`,
    );
  }
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
          TARGET_PATHS.divisionRulesContent,
          TARGET_PATHS.divisionsContent,
          TARGET_PATHS.deckSerializerContent,
          TARGET_PATHS.deckPacksContent,
          TARGET_PATHS.decksContent,
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
      name: 'configured division contexts produce output',
      suggestion: 'Check the division filters if no context remains active.',
      run: () => {
        const divisionsOutput = result.outputs.find(
          (output) => output.targetRelativePath === TARGET_PATHS.divisionsContent,
        );
        const safeModTag = sanitizeIdentifier(modTag);
        context.tools.assert.ok(
          Boolean(divisionsOutput?.content.includes(`Descriptor_Deck_Division_${safeModTag}_`)),
          {
            reason: 'Deck generation produced no division descriptors for the configured mod tag.',
            suggestion:
              'Check country/coalition filters and ensure at least one configured division context remains active.',
          },
        );
      },
    },
  ]);
}

export function isCachedDeckGenerationResults(
  value: unknown,
  count: number,
): value is CachedDeckGenerationResult[] {
  return (
    Array.isArray(value) && value.length === count && value.every(isCachedDeckGenerationResult)
  );
}

function isCachedDeckGenerationResult(value: unknown): value is CachedDeckGenerationResult {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<CachedDeckGenerationResult>;
  if (!(
    typeof candidate.localisationContent === 'string' &&
    typeof candidate.persistentStoreContent === 'string' &&
    candidate.persistentStoreContent.trim().length > 0 &&
    Array.isArray(candidate.outputs) &&
    candidate.outputs.every(
      (output) =>
        Boolean(output) &&
        typeof output === 'object' &&
        typeof output.targetRelativePath === 'string' &&
        typeof output.content === 'string',
    )
  ))
    return false;
  try {
    parsePersistentStore(candidate.persistentStoreContent);
    return true;
  } catch {
    return false;
  }
}
