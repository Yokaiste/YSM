import type { BuildScript } from 'ymb/api';
import { validateEntityModules } from '../../shared/entity-modules.ts';
import { mergeFeatureLocalisation } from '../../shared/localisation.ts';

const build: BuildScript = async (context) => {
  await validateEntityModules(
    context,
    [
      'GameData/Generated/Gameplay/TacticalUnits.ndf',
      'GameData/Generated/Gameplay/Gfx/FireDescriptor.ndf',
    ],
    (name) => /^Descriptor_(?:Unit|Fire)_YN_/.test(name),
  );
  return mergeFeatureLocalisation(context, 'UNITS');
};
export default build;
