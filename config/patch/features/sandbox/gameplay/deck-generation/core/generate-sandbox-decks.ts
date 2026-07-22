import {
  type DeckGenerationScriptContext,
  runDeckGenerationBatch,
} from '../../../../../shared/deck-generation/run-patch.ts';

const SCRIPT_SOURCE_PATH =
  'mods/YSM/config/patch/features/sandbox/gameplay/deck-generation/core/generate-sandbox-decks.ts';
const HORDE_SCRIPT_SOURCE_PATH =
  'mods/YSM/config/patch/features/zombies/gameplay/deck-generation/horde/generate-zombie-horde-decks.ts';
const HORDE_STORE_PATH =
  'patch/features/zombies/gameplay/deck-generation/horde/generated-decks.zombie-horde.store.json';

export default async function generateSandboxDecks(context: DeckGenerationScriptContext) {
  return runDeckGenerationBatch(context, [
    {
      generationConfig: context.variables.deckGeneration,
      persistentStorePath: 'generated-decks.core.store.json',
      persistentStoreScope: 'owned',
      scriptSourcePath: SCRIPT_SOURCE_PATH,
    },
    {
      generationConfig: context.variables.hordeDeckGeneration,
      persistentStorePath: HORDE_STORE_PATH,
      persistentStoreScope: 'mod',
      scriptSourcePath: HORDE_SCRIPT_SOURCE_PATH,
    },
  ]);
}
