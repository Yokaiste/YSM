import { deriveTransportGroup } from './analysis.ts';
import type { DeckGenerationConfig } from './config.ts';
import { deriveSimilarityTypeKey, isCommandEntity } from './helpers.ts';
import {
  createUnlimitedRule,
  type DivisionMode,
  type DivisionRuleData,
  type EntityData,
  FALLBACK_BALANCED_RULE,
  type GeneratedRuleEntry,
} from './types.ts';

const MAX_SIMILAR_RULE_SAMPLES = 5;

export function buildRuleEntries(args: {
  entities: EntityData[];
  mode: DivisionMode;
  deckableEntities: EntityData[];
  transportMap: Map<string, string[]>;
  entityByName: Map<string, EntityData>;
  availableEntityNames?: ReadonlySet<string>;
  vanillaRules: Map<string, DivisionRuleData>;
  config: DeckGenerationConfig;
}): GeneratedRuleEntry[] {
  const {
    entities,
    mode,
    deckableEntities,
    transportMap,
    entityByName,
    availableEntityNames,
    vanillaRules,
    config,
  } = args;
  const ruleCandidates = collectBalancedRuleCandidates(deckableEntities, vanillaRules);
  const visibleEntityNames = availableEntityNames ?? new Set(entities.map((entity) => entity.name));
  return entities.map((entity) => ({
    entity,
    rule:
      mode === 'Unlimited'
        ? {
            ...createUnlimitedRule(config.deckSlotCount, config.unlimitedPackUnitCount),
            unitName: entity.name,
          }
        : {
            ...resolveBalancedRule(entity, vanillaRules, ruleCandidates),
            maxPackNumber: config.deckSlotCount,
          },
    transportNames: collectAvailableTransportNames(
      entity,
      transportMap,
      entityByName,
      visibleEntityNames,
    ),
  }));
}

interface BalancedRuleCandidate {
  name: string;
  factoryType?: string;
  similarityTypeKey: string;
  kind: EntityData['kind'];
  isCommand: boolean;
  cost: number;
  rule: DivisionRuleData;
}

function resolveBalancedRule(
  entity: EntityData,
  vanillaRules: Map<string, DivisionRuleData>,
  ruleCandidates: BalancedRuleCandidate[],
): DivisionRuleData {
  const exactRule = vanillaRules.get(entity.name);
  if (exactRule && isReasonableBalancedRule(exactRule)) {
    return exactRule;
  }

  const entitySimilarityTypeKey = deriveSimilarityTypeKey(entity);
  const entityIsCommand = isCommandEntity(entity);
  const tierMatches: BalancedRuleCandidate[][] = [[], [], [], [], []];

  for (const candidate of ruleCandidates) {
    if (candidate.name === entity.name) {
      continue;
    }
    const tier = resolveBalancedRuleTier(
      candidate,
      entity,
      entitySimilarityTypeKey,
      entityIsCommand,
    );
    appendBestSimilarRuleCandidate(tierMatches[tier] ?? [], candidate, entity.cost);
  }

  for (const matchedRules of tierMatches) {
    if (matchedRules.length > 0) {
      return deriveRepresentativeRule(
        entity.name,
        matchedRules.map((candidate) => candidate.rule),
      );
    }
  }

  return { ...FALLBACK_BALANCED_RULE, unitName: entity.name };
}

function collectBalancedRuleCandidates(
  deckableEntities: EntityData[],
  vanillaRules: Map<string, DivisionRuleData>,
): BalancedRuleCandidate[] {
  const candidates: BalancedRuleCandidate[] = [];
  for (const candidate of deckableEntities) {
    const rule = vanillaRules.get(candidate.name);
    if (!rule || !isReasonableBalancedRule(rule)) {
      continue;
    }
    candidates.push({
      name: candidate.name,
      similarityTypeKey: deriveSimilarityTypeKey(candidate),
      kind: candidate.kind,
      isCommand: isCommandEntity(candidate),
      cost: candidate.cost,
      rule,
      ...(candidate.factoryType ? { factoryType: candidate.factoryType } : {}),
    });
  }
  return candidates;
}

function resolveBalancedRuleTier(
  candidate: BalancedRuleCandidate,
  entity: EntityData,
  entitySimilarityTypeKey: string,
  entityIsCommand: boolean,
): number {
  if (candidate.factoryType !== entity.factoryType) {
    return 4;
  }
  if (candidate.similarityTypeKey !== entitySimilarityTypeKey) {
    return 3;
  }
  if (candidate.kind !== entity.kind) {
    return 2;
  }
  return candidate.isCommand === entityIsCommand ? 0 : 1;
}

function appendBestSimilarRuleCandidate(
  candidates: BalancedRuleCandidate[],
  candidate: BalancedRuleCandidate,
  targetCost: number,
): void {
  candidates.push(candidate);
  candidates.sort((left, right) => compareSimilarRuleCandidates(left, right, targetCost));
  if (candidates.length > MAX_SIMILAR_RULE_SAMPLES) {
    candidates.length = MAX_SIMILAR_RULE_SAMPLES;
  }
}

function compareSimilarRuleCandidates(
  left: BalancedRuleCandidate,
  right: BalancedRuleCandidate,
  targetCost: number,
): number {
  const leftDistance = Math.abs(left.cost - targetCost);
  const rightDistance = Math.abs(right.cost - targetCost);
  if (leftDistance !== rightDistance) {
    return leftDistance - rightDistance;
  }
  return left.name.localeCompare(right.name);
}

function deriveRepresentativeRule(
  unitName: string,
  similarRules: DivisionRuleData[],
): DivisionRuleData {
  const representative = resolveMostGenerousRule(similarRules);
  const countsByXp = [0, 1, 2, 3].map((xp) => resolveRuleCountAtXp(representative, xp));
  const normalizedCounts = normalizeRankCounts(countsByXp);
  const maxPackNumber = Math.max(1, representative.maxPackNumber);
  // Buyable at no XP at all: resolvePreferredXp then defaults to 1 and the cook rejects the whole deck.
  if (!normalizedCounts.some((count) => count > 0)) {
    return { ...FALLBACK_BALANCED_RULE, unitName, maxPackNumber };
  }
  const numberOfUnitInPack = Math.max(...normalizedCounts, 1);

  return {
    unitName,
    maxPackNumber,
    numberOfUnitInPack,
    multipliers: normalizedCounts.map((count) =>
      count <= 0 ? 0 : roundToTwoDecimals(count / numberOfUnitInPack),
    ),
  };
}

function resolveMostGenerousRule(similarRules: DivisionRuleData[]): DivisionRuleData {
  return similarRules.reduce((best, candidate) =>
    compareRuleGenerosity(candidate, best) < 0 ? candidate : best,
  );
}

function compareRuleGenerosity(left: DivisionRuleData, right: DivisionRuleData): number {
  const leftCounts = [0, 1, 2, 3].map((xp) => resolveRuleCountAtXp(left, xp));
  const rightCounts = [0, 1, 2, 3].map((xp) => resolveRuleCountAtXp(right, xp));
  for (let index = 0; index < leftCounts.length; index += 1) {
    const difference = (rightCounts[index] ?? 0) - (leftCounts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  if (left.maxPackNumber !== right.maxPackNumber) {
    return right.maxPackNumber - left.maxPackNumber;
  }
  return left.unitName.localeCompare(right.unitName);
}

function normalizeRankCounts(counts: number[]): number[] {
  const normalized = [...counts];
  let lastAvailableCount = 0;

  for (let index = 0; index < normalized.length; index += 1) {
    const count = normalized[index] ?? 0;
    if (count <= 0) {
      continue;
    }
    if (lastAvailableCount > 0 && count > lastAvailableCount) {
      normalized[index] = lastAvailableCount;
    }
    lastAvailableCount = normalized[index] ?? count;
  }

  return normalized;
}

function resolveRuleCountAtXp(rule: DivisionRuleData, xp: number): number {
  const multiplier = rule.multipliers[xp] ?? 0;
  if (multiplier <= 0) {
    return 0;
  }
  return Math.max(1, Math.round(rule.numberOfUnitInPack * multiplier));
}

function isReasonableBalancedRule(rule: DivisionRuleData): boolean {
  const countsByXp = rule.multipliers.map((_, xp) => resolveRuleCountAtXp(rule, xp));
  const highestCount = Math.max(rule.numberOfUnitInPack, ...countsByXp);
  return rule.maxPackNumber > 0 && highestCount > 0;
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

function collectAvailableTransportNames(
  entity: EntityData,
  transportMap: Map<string, string[]>,
  entityByName: Map<string, EntityData>,
  availableEntityNames: ReadonlySet<string>,
): string[] {
  if (!entity.isTransportable) {
    return [];
  }

  const availableTransportNames = [
    ...new Set(
      entity.tags
        .flatMap((tag) => transportMap.get(tag) ?? [])
        .filter((transportName) => availableEntityNames.has(transportName)),
    ),
  ];

  return availableTransportNames.sort((left, right) =>
    compareTransportNamesByDivisionOrder(left, right, entityByName),
  );
}

function compareTransportNamesByDivisionOrder(
  left: string,
  right: string,
  entityByName: Map<string, EntityData>,
): number {
  const leftTransport = entityByName.get(left);
  const rightTransport = entityByName.get(right);
  const leftGroupOrder = resolveTransportDivisionGroupOrder(leftTransport);
  const rightGroupOrder = resolveTransportDivisionGroupOrder(rightTransport);
  if (leftGroupOrder !== rightGroupOrder) {
    return leftGroupOrder - rightGroupOrder;
  }
  const leftCost = leftTransport?.cost ?? Number.NEGATIVE_INFINITY;
  const rightCost = rightTransport?.cost ?? Number.NEGATIVE_INFINITY;
  if (leftCost !== rightCost) {
    return rightCost - leftCost;
  }
  return left.localeCompare(right);
}

function resolveTransportDivisionGroupOrder(entity: EntityData | undefined): number {
  return entity && deriveTransportGroup(entity) === 'Air' ? 0 : 1;
}
