import { type BuildScript, ScriptToolError } from 'ymb/api';
import { mergeFeatureLocalisation } from '../../shared/localisation.ts';
export function validateTuning(variables: Record<string, unknown>): void {
  for (const key of ['zombieDamageMultiplier', 'zombieRangeMultiplier']) {
    const value = variables[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      throw new ScriptToolError({
        reason: `Invalid zombie setting: ${key}.`,
        suggestion: 'Use a finite number zero or greater.',
      });
    }
  }
}
const build: BuildScript = async (context) => {
  validateTuning(context.variables);
  return mergeFeatureLocalisation(context, 'UNITS');
};
export default build;
