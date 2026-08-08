import {
  type DeckGenerationScriptContext,
  runDeckGenerationBatch,
} from '../../shared/deck-generation/run-patch.ts';

const SCRIPT_SOURCE_PATH = 'mods/YSM/config/patch/decks/generation/generate-decks.ts';

/**
 * Both passes run here so the shared WARNO sources are parsed once and the horde
 * sees the roster pass's divisions. Each keeps its own identity store: saved decks
 * point at those ids, so the two must never be merged or renumbered.
 */
export default async function generateDecks(context: DeckGenerationScriptContext) {
  return runDeckGenerationBatch(context, [
    {
      generationConfig: context.variables.deckGeneration,
      persistentStorePath: 'generated-decks.core.store.json',
      scriptSourcePath: SCRIPT_SOURCE_PATH,
      blockOwnerId: `${SCRIPT_SOURCE_PATH} | roster`,
    },
    {
      generationConfig: context.variables.hordeDeckGeneration,
      persistentStorePath: 'generated-decks.horde.store.json',
      scriptSourcePath: SCRIPT_SOURCE_PATH,
      blockOwnerId: `${SCRIPT_SOURCE_PATH} | horde`,
    },
  ]);
}
