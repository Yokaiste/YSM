import assert from 'node:assert/strict';
import { validateTuning } from './build.ts';
export default function test() {
  const valid = { zombieDamageMultiplier: 1, zombieRangeMultiplier: 1 };
  validateTuning(valid);
  for (const [key, positive] of Object.entries({
    zombieDamageMultiplier: false,
    zombieRangeMultiplier: false,
  })) {
    for (const value of [-1, NaN, Infinity, '1', undefined, ...(positive ? [0] : [])])
      assert.throws(() => validateTuning({ ...valid, [key]: value }), new RegExp(key));
    if (!positive) validateTuning({ ...valid, [key]: 0 });
  }
  return {
    results: [
      {
        name: 'Zombie tuning accepts supported numbers and rejects invalid inputs',
        status: 'passed' as const,
      },
    ],
  };
}
