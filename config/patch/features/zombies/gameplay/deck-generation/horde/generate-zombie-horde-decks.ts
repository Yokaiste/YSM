import {
  type DeckGenerationScriptContext,
  runDeckGenerationPatch,
} from '../../../../../shared/deck-generation/run-patch.ts';

const SCRIPT_SOURCE_PATH =
  'mods/YSM/config/patch/features/zombies/gameplay/deck-generation/horde/generate-zombie-horde-decks.ts';

export default async function generateZombieHordeDecks(context: DeckGenerationScriptContext) {
  return runDeckGenerationPatch(context, {
    persistentStoreFileName: 'generated-decks.zombie-horde.store.json',
    scriptSourcePath: SCRIPT_SOURCE_PATH,
  });
}
