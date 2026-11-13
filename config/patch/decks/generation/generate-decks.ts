import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hordeDivisions } from '../../zombies/divisions.ts';
import { type DeckGenerationScriptContext, runDeckGenerationBatch } from './run-patch.ts';

const BLOCK_OWNER_PREFIX = 'mods/YSM/config/patch/decks/generation/generate-decks.ts';

/**
 * Both passes run here so the shared WARNO sources are parsed once and the horde
 * sees the roster pass's divisions. Each keeps its own identity store: saved decks
 * point at those ids, so the two must never be merged or renumbered.
 */
export default async function generateDecks(context: DeckGenerationScriptContext) {
  const scriptSourcePath = path
    .relative(context.builder.ymbRoot, fileURLToPath(import.meta.url))
    .replaceAll('\\', '/');
  const generation = context.tools.values.record(
    context.variables.deckGeneration,
    'deckGeneration',
  );
  const {
    deckSlotCount,
    unlimitedPackUnitCount,
    staticPackCounts,
    deckVeterancy,
    minimumContextUnitCount,
    requireCommandUnitInContext,
    commentDirectives,
    deckMaxTransportCostRatio,
    naming,
    modCountryIds,
  } = generation;
  return runDeckGenerationBatch(context, [
    {
      generationConfig: generation,
      persistentStorePath: 'generated-decks.core.store.json',
      scriptSourcePath,
      blockOwnerId: `${BLOCK_OWNER_PREFIX} | roster`,
    },
    {
      generationConfig: {
        deckSlotCount,
        unlimitedPackUnitCount,
        staticPackCounts,
        deckVeterancy,
        minimumContextUnitCount,
        requireCommandUnitInContext,
        commentDirectives,
        deckMaxTransportCostRatio,
        naming,
        modCountryIds,
        // Horde availability and picks both stay inside its zombie-only context.
        contextGeneration: { countries: false, coalitions: false, allSides: false },
        customDivisions: hordeDivisions(String(context.variables.modTag)),
      },
      persistentStorePath: 'generated-decks.horde.store.json',
      scriptSourcePath,
      blockOwnerId: `${BLOCK_OWNER_PREFIX} | horde`,
    },
  ]);
}
