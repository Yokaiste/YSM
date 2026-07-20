import {
  type DeckGenerationScriptContext,
  runDeckGenerationPatch,
} from '../../../../../shared/deck-generation/run-patch.ts';

const SCRIPT_SOURCE_PATH =
  'mods/YSM/config/patch/features/sandbox/gameplay/deck-generation/core/generate-sandbox-decks.ts';

export default async function generateSandboxDecks(context: DeckGenerationScriptContext) {
  return runDeckGenerationPatch(context, {
    persistentStoreFileName: 'generated-decks.core.store.json',
    scriptSourcePath: SCRIPT_SOURCE_PATH,
  });
}
