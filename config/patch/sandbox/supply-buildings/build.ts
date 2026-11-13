import type { BuildScript } from 'ymb/api';
import { validateEntityModules } from '../../shared/entity-modules.ts';
import { mergeFeatureLocalisation } from '../../shared/localisation.ts';

const build: BuildScript = async (context) => {
  await validateEntityModules(
    context,
    ['GameData/Generated/Gameplay/Gfx/BuildingDescriptors.ndf'],
    (name) => /^Descriptor_Unit_YS_/.test(name),
  );
  return mergeFeatureLocalisation(context, 'UNITS');
};
export default build;
