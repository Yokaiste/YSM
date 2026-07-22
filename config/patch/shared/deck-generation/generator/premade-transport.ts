import { deriveTransportGroup, type EntityAnalysis, scoreTransportAnalysis } from './analysis.ts';
import { deriveMobilityKey } from './helpers.ts';
import type { EntityData, GeneratedRuleEntry, PremadeCard } from './types.ts';

export function resolveSelectedTransportNames(args: {
  entry: GeneratedRuleEntry;
  entity: EntityData;
  selectionKind: PremadeCard['selectionKind'];
  entityByName: Map<string, EntityData>;
  analysisByName: Map<string, EntityAnalysis>;
}): Array<string | undefined> {
  const { entry, entity, selectionKind, entityByName, analysisByName } = args;
  if (entry.transportNames.length === 0) {
    return [undefined];
  }

  const candidateTransportNames = entry.transportNames.filter((transportName) =>
    entityByName.has(transportName),
  );
  if (candidateTransportNames.length === 0) {
    return [];
  }

  const grouped = new Map<'Ground' | 'Air', string[]>();
  for (const transportName of candidateTransportNames) {
    const transportEntity = entityByName.get(transportName);
    if (!transportEntity) {
      continue;
    }
    const group = deriveTransportGroup(transportEntity);
    const entriesInGroup = grouped.get(group) ?? [];
    entriesInGroup.push(transportName);
    grouped.set(group, entriesInGroup);
  }

  const selected: string[] = [];
  for (const group of ['Ground', 'Air'] as const) {
    const transportNames = grouped.get(group) ?? [];
    if (transportNames.length === 0) {
      continue;
    }
    const bestTransport = [...transportNames].sort((left, right) => {
      const sellableCompare =
        Number(entityByName.get(right)?.isSellable === true) -
        Number(entityByName.get(left)?.isSellable === true);
      if (sellableCompare !== 0) {
        return sellableCompare;
      }
      if (selectionKind.endsWith('cheap')) {
        const leftCheapScore = scoreCheapTransportChoice(
          left,
          entity,
          entityByName,
          analysisByName,
        );
        const rightCheapScore = scoreCheapTransportChoice(
          right,
          entity,
          entityByName,
          analysisByName,
        );
        if (leftCheapScore !== rightCheapScore) {
          return rightCheapScore - leftCheapScore;
        }
        return left.localeCompare(right);
      }
      const leftAnalysis = analysisByName.get(left);
      const rightAnalysis = analysisByName.get(right);
      const leftScore = leftAnalysis
        ? scoreTransportAnalysis(leftAnalysis)
        : scoreTransportEntity(entityByName.get(left));
      const rightScore = rightAnalysis
        ? scoreTransportAnalysis(rightAnalysis)
        : scoreTransportEntity(entityByName.get(right));
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }
      return left.localeCompare(right);
    })[0];
    if (bestTransport) {
      selected.push(bestTransport);
    }
  }

  const allowedVariantCount = Math.max(1, entry.rule.maxPackNumber);
  return (selected.length > 0 ? selected : [undefined])
    .sort((left, right) =>
      compareTransportPreference(left, right, entity, selectionKind, entityByName, analysisByName),
    )
    .slice(0, allowedVariantCount);
}

export function normalizeTransportName(args: {
  card: PremadeCard;
  entry: GeneratedRuleEntry;
  entityByName: Map<string, EntityData>;
}): string | undefined {
  const { card, entry, entityByName } = args;
  if (entry.transportNames.length === 0) {
    return undefined;
  }
  if (card.transportName && entry.transportNames.includes(card.transportName)) {
    return card.transportName;
  }
  if (card.selectionKind.endsWith('cheap')) {
    return resolveBestCheapTransportName(
      card.entity,
      entry.transportNames,
      entityByName,
      new Map(),
    );
  }
  const originalTransportEntity = card.transportName
    ? entityByName.get(card.transportName)
    : undefined;
  const originalGroup = originalTransportEntity
    ? deriveTransportGroup(originalTransportEntity)
    : undefined;
  const sameGroupTransportNames =
    originalGroup === undefined
      ? []
      : entry.transportNames.filter((transportName) => {
          const transportEntity = entityByName.get(transportName);
          return transportEntity && deriveTransportGroup(transportEntity) === originalGroup;
        });
  const candidateTransportNames =
    sameGroupTransportNames.length > 0 ? sameGroupTransportNames : entry.transportNames;
  return [...candidateTransportNames].sort((left, right) => {
    const leftEntity = entityByName.get(left);
    const rightEntity = entityByName.get(right);
    const sellableCompare =
      Number(rightEntity?.isSellable === true) - Number(leftEntity?.isSellable === true);
    if (sellableCompare !== 0) {
      return sellableCompare;
    }
    const leftScore = scoreTransportEntity(leftEntity);
    const rightScore = scoreTransportEntity(rightEntity);
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    const leftCost = entityByName.get(left)?.cost ?? Number.POSITIVE_INFINITY;
    const rightCost = entityByName.get(right)?.cost ?? Number.POSITIVE_INFINITY;
    if (leftCost !== rightCost) {
      return leftCost - rightCost;
    }
    return left.localeCompare(right);
  })[0];
}

export function resolveTransportRank(
  transportName: string | undefined,
  entityByName: Map<string, EntityData>,
): number {
  if (!transportName) {
    return 0;
  }
  const transportEntity = entityByName.get(transportName);
  return transportEntity && deriveTransportGroup(transportEntity) === 'Air' ? 2 : 1;
}

function resolveBestCheapTransportName(
  unit: EntityData,
  transportNames: Array<string | undefined>,
  entityByName: Map<string, EntityData>,
  analysisByName: Map<string, EntityAnalysis>,
): string | undefined {
  const candidates: string[] = [];
  for (const transportName of transportNames) {
    if (!transportName || !entityByName.has(transportName)) {
      continue;
    }
    candidates.push(transportName);
  }
  return [...new Set(candidates)].sort((left, right) => {
    const sellableCompare =
      Number(entityByName.get(right)?.isSellable === true) -
      Number(entityByName.get(left)?.isSellable === true);
    if (sellableCompare !== 0) {
      return sellableCompare;
    }
    const leftScore = scoreCheapTransportChoice(left, unit, entityByName, analysisByName);
    const rightScore = scoreCheapTransportChoice(right, unit, entityByName, analysisByName);
    if (leftScore !== rightScore) {
      return rightScore - leftScore;
    }
    return left.localeCompare(right);
  })[0];
}

function compareTransportPreference(
  left: string | undefined,
  right: string | undefined,
  unit: EntityData,
  selectionKind: PremadeCard['selectionKind'],
  entityByName: Map<string, EntityData>,
  analysisByName: Map<string, EntityAnalysis>,
): number {
  if (!left || !right) {
    return left ? -1 : right ? 1 : 0;
  }
  const leftEntity = entityByName.get(left);
  const rightEntity = entityByName.get(right);
  const sellableCompare =
    Number(rightEntity?.isSellable === true) - Number(leftEntity?.isSellable === true);
  if (sellableCompare !== 0) {
    return sellableCompare;
  }
  const score = (transportName: string, transportEntity: EntityData | undefined): number => {
    if (selectionKind.endsWith('cheap')) {
      return scoreCheapTransportChoice(transportName, unit, entityByName, analysisByName);
    }
    const analysis = analysisByName.get(transportName);
    return analysis ? scoreTransportAnalysis(analysis) : scoreTransportEntity(transportEntity);
  };
  return score(right, rightEntity) - score(left, leftEntity) || left.localeCompare(right);
}

function scoreCheapTransportChoice(
  transportName: string,
  unit: EntityData,
  entityByName: Map<string, EntityData>,
  analysisByName: Map<string, EntityAnalysis>,
): number {
  const transportEntity = entityByName.get(transportName);
  if (!transportEntity) {
    return Number.NEGATIVE_INFINITY;
  }
  const transportAnalysis = analysisByName.get(transportName);
  const utilityScore = transportAnalysis
    ? scoreTransportAnalysis(transportAnalysis)
    : scoreTransportEntity(transportEntity);
  const unitCost = Math.max(1, unit.cost);
  const relativeCostPenalty = Math.max(0, transportEntity.cost - unitCost * 0.65) * 42;
  const costSharePenalty = Math.max(0, transportEntity.cost / unitCost - 0.9) * 750;
  const airPenalty = deriveTransportGroup(transportEntity) === 'Air' ? 180 : 0;
  const affordabilityBonus =
    transportEntity.cost <= unitCost * 0.5 ? 160 : transportEntity.cost <= unitCost ? 60 : 0;
  return (
    utilityScore * 0.22 -
    transportEntity.cost * 24 -
    relativeCostPenalty -
    costSharePenalty -
    airPenalty +
    affordabilityBonus
  );
}

function scoreTransportEntity(entity: EntityData | undefined): number {
  if (!entity) {
    return Number.NEGATIVE_INFINITY;
  }
  const mobility =
    (entity.maxSpeedKmph ?? 0) * 20 + (deriveMobilityKey(entity) === 'Helicopter' ? 220 : 0);
  const stealth = (entity.concealmentBonus ?? 0) * 180;
  const survivability =
    (entity.maxPhysicalDamages ?? 0) * 90 +
    ((entity.frontArmor ?? 0) * 100 + (entity.sideArmor ?? 0) * 60 + (entity.topArmor ?? 0) * 40);
  const amphibious =
    entity.pathfindType?.toLowerCase().includes('amphibious') === true ||
    entity.movingType?.toLowerCase().includes('amphibious') === true
      ? 180
      : 0;
  const weaponUtility =
    entity.weaponDescriptorNames.length * 320 +
    (entity.unitAttackValue ?? 0) * 180 +
    (entity.unitDefenseValue ?? 0) * 90;
  const initiative =
    (entity.deploymentShiftGru ?? 0) * 0.25 - (entity.weaponDeploymentTime ?? 0) * 40;
  return (
    mobility * 1.6 +
    stealth * 0.7 +
    survivability * 0.45 +
    amphibious * 0.9 +
    weaponUtility +
    initiative
  );
}
