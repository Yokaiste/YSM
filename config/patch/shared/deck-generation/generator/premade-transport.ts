import {
  deriveTransportGroup,
  type EntityAnalysis,
  resolveEntityAmphibiousBonus,
  resolveEntityMobility,
  resolveEntityStealth,
  resolveEntitySurvivability,
  scoreTransportAnalysis,
} from './analysis.ts';
import type { DeckGenerationConfig } from './config.ts';
import type { EntityData, GeneratedRuleEntry, PremadeCard } from './types.ts';

/** An empty result means the card rides nothing, never that the card is dropped. */
export function resolveAffordableTransportNames(
  transportNames: readonly string[],
  unit: EntityData,
  entityByName: ReadonlyMap<string, EntityData>,
  config: DeckGenerationConfig,
): string[] {
  const available = transportNames.filter((transportName) => entityByName.has(transportName));
  if (config.deckMaxTransportCostRatio <= 0) {
    return available;
  }
  // The division still offers it, so a player can still pair them by hand.
  const costLimit = Math.max(1, unit.cost) * config.deckMaxTransportCostRatio;
  return available.filter(
    (transportName) => (entityByName.get(transportName)?.cost ?? 0) <= costLimit,
  );
}

export function resolveSelectedTransportNames(args: {
  entry: GeneratedRuleEntry;
  entity: EntityData;
  selectionKind: PremadeCard['selectionKind'];
  entityByName: Map<string, EntityData>;
  analysisByName: Map<string, EntityAnalysis>;
  config: DeckGenerationConfig;
}): Array<string | undefined> {
  const { entry, entity, selectionKind, entityByName, analysisByName, config } = args;
  const candidateTransportNames = resolveAffordableTransportNames(
    entry.transportNames,
    entity,
    entityByName,
    config,
  );
  if (candidateTransportNames.length === 0) {
    return [undefined];
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
    const bestTransport = pickBestTransportName({
      transportNames: grouped.get(group) ?? [],
      unit: entity,
      selectionKind,
      entityByName,
      analysisByName,
    });
    if (bestTransport) {
      selected.push(bestTransport);
    }
  }

  const allowedVariantCount = Math.max(1, entry.rule.maxPackNumber);
  if (selected.length === 0) {
    return [undefined];
  }
  const scored = selected.map((transportName) => ({
    transportName,
    score: scoreTransportChoice(transportName, entity, selectionKind, entityByName, analysisByName),
  }));
  return scored
    .sort((left, right) =>
      compareTransportScores(left.score, left.transportName, right.score, right.transportName),
    )
    .slice(0, allowedVariantCount)
    .map((candidate) => candidate.transportName);
}

export function normalizeTransportName(args: {
  card: PremadeCard;
  entry: GeneratedRuleEntry;
  entityByName: Map<string, EntityData>;
  config: DeckGenerationConfig;
}): string | undefined {
  const { card, entry, entityByName, config } = args;
  const affordableTransportNames = resolveAffordableTransportNames(
    entry.transportNames,
    card.entity,
    entityByName,
    config,
  );
  if (affordableTransportNames.length === 0) {
    return undefined;
  }
  if (card.transportName && affordableTransportNames.includes(card.transportName)) {
    return card.transportName;
  }
  if (card.selectionKind.endsWith('cheap')) {
    return pickBestTransportName({
      transportNames: affordableTransportNames,
      unit: card.entity,
      selectionKind: card.selectionKind,
      entityByName,
    });
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
      : affordableTransportNames.filter((transportName) => {
          const transportEntity = entityByName.get(transportName);
          return transportEntity && deriveTransportGroup(transportEntity) === originalGroup;
        });
  const candidateTransportNames =
    sameGroupTransportNames.length > 0 ? sameGroupTransportNames : affordableTransportNames;
  // No analyses are available here, so this ranks on the chassis alone and adds a
  // cost tiebreak that the analysis-backed comparator does not need.
  return [...candidateTransportNames].sort((left, right) => {
    const leftEntity = entityByName.get(left);
    const rightEntity = entityByName.get(right);
    return (
      compareSellableFirst(leftEntity, rightEntity) ||
      scoreTransportEntity(rightEntity) - scoreTransportEntity(leftEntity) ||
      (leftEntity?.cost ?? Number.POSITIVE_INFINITY) -
        (rightEntity?.cost ?? Number.POSITIVE_INFINITY) ||
      left.localeCompare(right)
    );
  })[0];
}

/** Sellable transports come first everywhere: they can be resold after unloading. */
function compareSellableFirst(left: EntityData | undefined, right: EntityData | undefined): number {
  return Number(right?.isSellable === true) - Number(left?.isSellable === true);
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

/** Best transport for one unit, by the single preference order below. */
function pickBestTransportName(args: {
  transportNames: ReadonlyArray<string | undefined>;
  unit: EntityData;
  selectionKind: PremadeCard['selectionKind'];
  entityByName: Map<string, EntityData>;
  analysisByName?: Map<string, EntityAnalysis>;
}): string | undefined {
  const { transportNames, unit, selectionKind, entityByName } = args;
  const analysisByName = args.analysisByName ?? new Map();
  const candidates = [
    ...new Set(
      transportNames.filter(
        (transportName): transportName is string =>
          transportName !== undefined && entityByName.has(transportName),
      ),
    ),
  ];
  // Only the winner is wanted, and scoring a transport is expensive, so each
  // candidate is scored once instead of once per comparison in a sort.
  let best: string | undefined;
  let bestScore: TransportScore | undefined;
  for (const candidate of candidates) {
    const score = scoreTransportChoice(
      candidate,
      unit,
      selectionKind,
      entityByName,
      analysisByName,
    );
    if (!bestScore || compareTransportScores(score, candidate, bestScore, best ?? '') < 0) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

interface TransportScore {
  sellable: boolean;
  utility: number;
}

function scoreTransportChoice(
  transportName: string,
  unit: EntityData,
  selectionKind: PremadeCard['selectionKind'],
  entityByName: Map<string, EntityData>,
  analysisByName: Map<string, EntityAnalysis>,
): TransportScore {
  const transportEntity = entityByName.get(transportName);
  if (selectionKind.endsWith('cheap')) {
    return {
      sellable: transportEntity?.isSellable === true,
      utility: scoreCheapTransportChoice(transportName, unit, entityByName, analysisByName),
    };
  }
  const analysis = analysisByName.get(transportName);
  return {
    sellable: transportEntity?.isSellable === true,
    utility: analysis ? scoreTransportAnalysis(analysis) : scoreTransportEntity(transportEntity),
  };
}

/** Sellable first, then the higher utility, then the name for a stable order. */
function compareTransportScores(
  left: TransportScore,
  leftName: string,
  right: TransportScore,
  rightName: string,
): number {
  return (
    Number(right.sellable) - Number(left.sellable) ||
    right.utility - left.utility ||
    leftName.localeCompare(rightName)
  );
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

/**
 * Mirrors {@link scoreTransportAnalysis} term for term so analysed and unanalysed
 * transports stay comparable. With no weapon analysis, descriptor count stands in.
 */
function scoreTransportEntity(entity: EntityData | undefined): number {
  if (!entity) {
    return Number.NEGATIVE_INFINITY;
  }
  const initiative =
    (entity.deploymentShiftGru ?? 0) * 0.25 - (entity.weaponDeploymentTime ?? 0) * 40;
  return (
    resolveEntityMobility(entity) * 1.6 +
    resolveEntityStealth(entity) * 0.7 +
    resolveEntitySurvivability(entity) * 0.45 +
    resolveEntityAmphibiousBonus(entity) * 0.9 +
    entity.weaponDescriptorNames.length * 320 +
    initiative -
    (deriveTransportGroup(entity) === 'Air' ? 90 : 0)
  );
}
