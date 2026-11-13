import { type DeckGenerationConfig, isModCountryEntity } from './config.ts';
import type { DivisionCostMatrix, DivisionDescriptorData, EntityData } from './types.ts';

/**
 * Units a mod ships but parks out of reach. Nothing marks a division private; its
 * cost matrix does, per category. A row with no slots cannot be picked from, and a
 * free row in a division whose activation limit is far above playable is a shelf.
 */
export interface HiddenUnitAnalysis {
  /** Units at least one division actually puts on offer. */
  visibleUnitNames: ReadonlySet<string>;
  /** Units some division lists behind a category it blocks. */
  shelvedUnitNames: ReadonlySet<string>;
}

/** Guards only the free-row shape: vanilla writes `(Factory/Defense, [0])` and means it. */
const SHOWCASE_MINIMUM_ACTIVATION_POINTS = 90;

export function analyzeHiddenUnits(
  descriptors: readonly DivisionDescriptorData[],
  costMatricesByName: ReadonlyMap<string, DivisionCostMatrix>,
  entityByName: ReadonlyMap<string, EntityData>,
): HiddenUnitAnalysis {
  const visibleUnitNames = new Set<string>();
  const shelvedUnitNames = new Set<string>();

  for (const descriptor of descriptors) {
    const costMatrix = descriptor.costMatrixName
      ? costMatricesByName.get(descriptor.costMatrixName)
      : descriptor.inlineCostMatrix;
    for (const member of descriptor.members) {
      // A transport rides on its passenger's card and spends no slot of its
      // own, so it is reachable exactly when that card is.
      const reached = offersCategory(
        descriptor,
        costMatrix,
        entityByName.get(member.unitName)?.factoryType,
      )
        ? visibleUnitNames
        : shelvedUnitNames;
      reached.add(member.unitName);
      for (const transportName of member.transportNames) {
        reached.add(transportName);
      }
    }
  }

  return { visibleUnitNames, shelvedUnitNames };
}

/** Mod units are never hidden: they have no vanilla division by design. */
export function isHiddenEntity(
  entity: EntityData,
  analysis: HiddenUnitAnalysis,
  config: DeckGenerationConfig,
): boolean {
  if (isModCountryEntity(entity, config)) {
    return false;
  }
  // One division offering it is enough, however many others block it.
  if (analysis.visibleUnitNames.has(entity.name)) {
    return false;
  }
  // Blocked is proof the author parked it; division-less is WARNO's own leftovers.
  return config.excludeHidden || analysis.shelvedUnitNames.has(entity.name);
}

function offersCategory(
  descriptor: DivisionDescriptorData,
  costMatrix: DivisionCostMatrix | undefined,
  factoryType: string | undefined,
): boolean {
  const costs = factoryType === undefined ? undefined : costMatrix?.get(factoryType);
  if (costs === undefined) {
    // No matrix, no row, or a unit this build does not ship. Nothing to read is
    // not evidence of anything, so the division is taken at face value.
    return true;
  }
  if (costs.length === 0) {
    return false;
  }
  return (
    (descriptor.maxActivationPoints ?? 0) < SHOWCASE_MINIMUM_ACTIVATION_POINTS ||
    costs.some((cost) => cost !== 0)
  );
}
