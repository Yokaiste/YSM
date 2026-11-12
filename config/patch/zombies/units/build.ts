import { type BuildScript, ScriptToolError } from 'ymb/api';
import { validateEntityModules } from '../../shared/entity-modules.ts';
import { mergeFeatureLocalisation } from '../../shared/localisation.ts';
export function validateTuning(variables: Record<string, unknown>): void {
  for (const [key, positive] of Object.entries({
    zombieHealthMultiplier: true,
    zombieSpeedMultiplier: true,
    zombieCostMultiplier: false,
  })) {
    const value = variables[key];
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      (positive && value === 0)
    ) {
      throw new ScriptToolError({
        reason: `Invalid zombie setting: ${key}.`,
        suggestion: `Use a finite number ${positive ? 'greater than zero.' : 'zero or greater.'}`,
      });
    }
  }
}
const build: BuildScript = async (context) => {
  validateTuning(context.variables);
  await validateEntityModules(context, ['GameData/Generated/Gameplay/TacticalUnits.ndf'], (name) =>
    /^Descriptor_Unit_YZ_/.test(name),
  );
  return mergeFeatureLocalisation(context, 'UNITS');
};
export default build;
