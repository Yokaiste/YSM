import type { BuildScriptContext } from 'ymb/api';
import {
  parseLocalisation,
  renderLocalisation,
  upsertLocalisationRow,
} from './patch/shared/localisation.ts';

/** Seed shared dictionaries and mod identity before selected features contribute their text. */
export default function localisation(
  context: Pick<BuildScriptContext, 'tools' | 'variables' | 'mod'>,
) {
  const modTag = context.tools.values.string(context.variables.modTag, 'modTag');
  return ['UNITS', 'INTERFACE_OUTGAME'].map((name) => {
    const state = parseLocalisation('');
    if (name === 'INTERFACE_OUTGAME') upsertLocalisationRow(state, modTag, context.mod.name);
    return {
      targetRelativePath: `GameData/Localisation/${context.variables.modRootName}/${name}.csv`,
      content: renderLocalisation(state),
    };
  });
}
