import {
  areNearDuplicateProfiles,
  type buildCategoryAnalyses,
  type EntityAnalysis,
  type RoleDefinition,
  scoreAnalysisForPerspective,
  scoreAnalysisForRole,
} from './analysis.ts';
import { compareCountryPreference, type DeckGenerationConfig } from './config.ts';
import { compareEntityPriority, derivePlatformForm } from './helpers.ts';
import type { DivisionContext, PremadeCard } from './types.ts';

export interface PremadeSelection {
  analysis: EntityAnalysis;
  roleKey: string;
  selectionKind: PremadeCard['selectionKind'];
  roleScore: number;
  keepPriority: number;
}

type SelectionPerspective = 'recommended' | 'best' | 'cheap';
const perspectiveScoresByRole = new WeakMap<
  RoleDefinition,
  WeakMap<EntityAnalysis, Partial<Record<SelectionPerspective, number>>>
>();

export function buildRoleSelections(args: {
  roleDefinition: RoleDefinition;
  analyses: EntityAnalysis[];
  stats: ReturnType<typeof buildCategoryAnalyses>['stats'];
  context: DivisionContext;
  config: DeckGenerationConfig;
}): PremadeSelection[] {
  const { roleDefinition, analyses, stats, context, config } = args;
  const ranked = analyses
    .map((analysis) => {
      // Candidate eligibility is a pure role-fit check. Economy is applied only
      // later for the recommended/cheap perspectives of three-option main roles.
      const { fitScore, exactMatch } = scoreAnalysisForRole(analysis, roleDefinition, 'best');
      return { analysis, fitScore, exactMatch };
    })
    .filter(({ fitScore, exactMatch }) => {
      if (isPrimarySelectionRole(roleDefinition.kind)) {
        return exactMatch;
      }
      return exactMatch || fitScore > 500;
    });

  if (ranked.length === 0) {
    return [];
  }

  const chosenNames = new Set<string>();
  const chosenAnalyses: EntityAnalysis[] = [];
  const selections: PremadeSelection[] = [];
  const exactRanked = ranked.filter((entry) => entry.exactMatch);
  // Only sufficiently broad main roles need economy perspectives. Secondary,
  // unique, trait, and scarce roles always keep the strongest distinct options.
  const perspectives = isPriceSensitiveMainRole(roleDefinition)
    ? (['best', 'recommended', 'cheap'] as const)
    : Array.from(
        { length: roleDefinition.optionCount },
        (): 'best' | 'recommended' | 'cheap' => 'best',
      );
  let recommendedCost: number | undefined;
  for (const perspective of perspectives) {
    const preferredPool = exactRanked.length > 0 ? exactRanked : ranked;
    const distinctUnusedPool = preferredPool.filter(
      (candidate) =>
        !chosenNames.has(candidate.analysis.entity.name) &&
        chosenAnalyses.every(
          (chosenAnalysis) =>
            !areRedundantRoleOptions(candidate.analysis, chosenAnalysis, roleDefinition),
        ),
    );
    if (distinctUnusedPool.length === 0) {
      continue;
    }
    const filteredPool = filterCandidatesByFitFloor(
      distinctUnusedPool,
      roleDefinition,
      perspective,
    );
    const qualityPool =
      filterCandidatesByStrengthFloor({
        candidates: filteredPool.length > 0 ? filteredPool : distinctUnusedPool,
        referenceCandidates: perspective === 'cheap' ? preferredPool : distinctUnusedPool,
        roleDefinition,
        stats,
        perspective,
      }) || (filteredPool.length > 0 ? filteredPool : distinctUnusedPool);
    let candidatePool = qualityPool;
    if (perspective === 'recommended') {
      candidatePool = filterRolePriceFrontier(candidatePool, roleDefinition, stats);
    }
    if (perspective === 'cheap') {
      candidatePool = filterAffordableCandidates(qualityPool, chosenNames, recommendedCost);
      if (candidatePool.length === 0) {
        const strongestScore = Math.max(
          ...distinctUnusedPool.map((candidate) =>
            resolveRoleStrengthScore(candidate.analysis, roleDefinition, stats),
          ),
          0,
        );
        const relaxedQualityPool = filteredPool.filter(
          (candidate) =>
            strongestScore <= 0 ||
            resolveRoleStrengthScore(candidate.analysis, roleDefinition, stats) >=
              strongestScore * 0.65,
        );
        candidatePool = filterAffordableCandidates(
          relaxedQualityPool,
          chosenNames,
          recommendedCost,
        );
      }
    }
    const diversityScores = buildSelectionDiversityScores(
      candidatePool.map((entry) => entry.analysis),
      chosenAnalyses,
      preferredPool.map((entry) => entry.analysis),
    );
    const orderedCandidates = [...candidatePool].sort((left, right) => {
      const leftScore = resolvePerspectiveScore(left.analysis, roleDefinition, stats, perspective);
      const rightScore = resolvePerspectiveScore(
        right.analysis,
        roleDefinition,
        stats,
        perspective,
      );
      const leftCombinedScore = leftScore + (diversityScores.get(left.analysis.entity.name) ?? 0);
      const rightCombinedScore =
        rightScore + (diversityScores.get(right.analysis.entity.name) ?? 0);
      if (leftCombinedScore !== rightCombinedScore) {
        return rightCombinedScore - leftCombinedScore;
      }
      if (shouldApplyCountryPreferenceTieBreak(left.analysis, right.analysis)) {
        const countryCompare = compareCountryPreference(
          left.analysis.entity,
          right.analysis.entity,
          context.coalition,
          config,
        );
        if (countryCompare !== 0) {
          return countryCompare;
        }
      }
      return compareEntityPriority(left.analysis.entity, right.analysis.entity);
    });
    const candidate = orderedCandidates.find((entry) =>
      isUsefulEconomyOption({
        candidate: entry.analysis,
        chosen: chosenAnalyses,
        roleDefinition,
        perspective,
      }),
    );
    if (!candidate) {
      continue;
    }
    chosenNames.add(candidate.analysis.entity.name);
    chosenAnalyses.push(candidate.analysis);
    if (perspective === 'recommended') {
      recommendedCost = candidate.analysis.entity.cost;
    }
    const scarcityBonus = resolveRoleScarcityBonus({
      roleDefinition,
      supportCount: ranked.length,
      exactMatch: candidate.exactMatch,
    });
    selections.push({
      analysis: candidate.analysis,
      roleKey: resolveCoverageRoleKey(roleDefinition),
      selectionKind: resolveSelectionKind(roleDefinition.kind, perspective),
      roleScore: resolvePerspectiveScore(candidate.analysis, roleDefinition, stats, perspective),
      keepPriority: resolveKeepPriority(roleDefinition.kind, perspective) + scarcityBonus,
    });
  }

  return selections;
}

function areRedundantRoleOptions(
  left: EntityAnalysis,
  right: EntityAnalysis,
  roleDefinition: RoleDefinition,
): boolean {
  if (shouldSeparateGroundPlatformCompetition(left, right)) {
    return false;
  }
  if (areNearDuplicateProfiles(left, right)) {
    return true;
  }
  const leftPurpose = collectSelectionPurposeTokens(left);
  const rightPurpose = collectSelectionPurposeTokens(right);
  if (tokenSimilarity(leftPurpose, rightPurpose) < 0.8) {
    return false;
  }
  const importantMetrics = Object.entries(roleDefinition.focus)
    .filter(([metric, weight]) => metric !== 'value' && (weight ?? 0) >= 0.5)
    .map(([metric]) => metric as keyof EntityAnalysis['relativeMetrics']);
  if (importantMetrics.length === 0) {
    return false;
  }
  const differences = importantMetrics
    .map((metric) => Math.abs(left.relativeMetrics[metric] - right.relativeMetrics[metric]))
    .sort((first, second) => first - second);
  const average =
    differences.reduce((total, difference) => total + difference, 0) / differences.length;
  const maximum = differences[differences.length - 1] ?? 0;
  return average <= 65 && maximum <= 125;
}

function isUsefulEconomyOption(args: {
  candidate: EntityAnalysis;
  chosen: readonly EntityAnalysis[];
  roleDefinition: RoleDefinition;
  perspective: 'recommended' | 'best' | 'cheap';
}): boolean {
  const { candidate, chosen, roleDefinition, perspective } = args;
  if (perspective === 'best' || !isPriceSensitiveMainRole(roleDefinition) || chosen.length === 0) {
    return true;
  }
  // Every economy perspective serves the same main role. It must therefore
  // save a meaningful amount against every stronger selection even when its
  // weapon profile is cosmetically different. A genuinely different weapon
  // niche can still win its own non-main, price-independent capability role.
  return chosen.every((selection) => {
    if (shouldSeparateGroundPlatformCompetition(candidate, selection)) {
      return true;
    }
    const requiredSaving = Math.max(5, selection.entity.cost * 0.125);
    return selection.entity.cost - candidate.entity.cost >= requiredSaving;
  });
}

function filterRolePriceFrontier<T extends { analysis: EntityAnalysis }>(
  candidates: T[],
  roleDefinition: RoleDefinition,
  stats: ReturnType<typeof buildCategoryAnalyses>['stats'],
): T[] {
  const scored = candidates.map((candidate) => ({
    candidate,
    strength: resolveRoleStrengthScore(candidate.analysis, roleDefinition, stats),
  }));
  return scored
    .filter(({ candidate, strength }) =>
      scored.every((other) => {
        if (other.candidate === candidate) {
          return true;
        }
        if (shouldSeparateGroundPlatformCompetition(candidate.analysis, other.candidate.analysis)) {
          return true;
        }
        const noMoreExpensive =
          other.candidate.analysis.entity.cost <= candidate.analysis.entity.cost;
        const noWeaker = other.strength >= strength * 0.995;
        const strictlyBetter =
          other.candidate.analysis.entity.cost < candidate.analysis.entity.cost ||
          other.strength > strength * 1.005;
        return !(noMoreExpensive && noWeaker && strictlyBetter);
      }),
    )
    .map(({ candidate }) => candidate);
}

const selectionPurposeTokensCache = new WeakMap<EntityAnalysis, string[]>();
const diversityProfileTokenCache = new Map<string, boolean>();
const tokenSetCache = new WeakMap<readonly string[], ReadonlySet<string>>();

function collectSelectionPurposeTokens(analysis: EntityAnalysis): string[] {
  const cached = selectionPurposeTokensCache.get(analysis);
  if (cached !== undefined) {
    return cached;
  }
  const tokens = analysis.profileTokens.filter(isDiversityProfileToken);
  selectionPurposeTokensCache.set(analysis, tokens);
  return tokens;
}

function tokenSimilarity(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const leftSet = toCachedTokenSet(left);
  const rightSet = toCachedTokenSet(right);
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }
  return intersection / (leftSet.size + rightSet.size - intersection);
}

const DIVERSITY_PROFILE_PREFIXES = [
  'ammo:',
  'ammo_loadout:',
  'channel:',
  'effect:',
  'effect_range:',
  'loadout:',
  'mechanic:',
  'range_band:',
  'range_class:',
  'scope:',
];

function buildSelectionDiversityScores(
  candidates: readonly EntityAnalysis[],
  chosen: readonly EntityAnalysis[],
  peers: readonly EntityAnalysis[],
): Map<string, number> {
  const scores = new Map<string, number>();
  if (chosen.length === 0 || peers.length < 2) {
    return scores;
  }
  const tokenSupport = new Map<string, number>();
  for (const peer of peers) {
    for (const token of collectSelectionPurposeTokens(peer)) {
      tokenSupport.set(token, (tokenSupport.get(token) ?? 0) + 1);
    }
  }
  const coveredTokens = new Set(chosen.flatMap((analysis) => analysis.profileTokens));
  const chosenPlatforms = new Set(chosen.map((analysis) => derivePlatformForm(analysis.entity)));
  for (const candidate of candidates) {
    const novelWeaponScore = collectSelectionPurposeTokens(candidate)
      .filter((token) => !coveredTokens.has(token))
      .reduce((total, token) => {
        const supportRatio = (tokenSupport.get(token) ?? peers.length) / peers.length;
        return supportRatio <= 0.8 ? total + (1 - supportRatio) * 180 : total;
      }, 0);
    const platformBonus = chosenPlatforms.has(derivePlatformForm(candidate.entity)) ? 0 : 320;
    scores.set(candidate.entity.name, Math.min(900, novelWeaponScore) + platformBonus);
  }
  return scores;
}

function isDiversityProfileToken(token: string): boolean {
  const cached = diversityProfileTokenCache.get(token);
  if (cached !== undefined) {
    return cached;
  }
  const result = DIVERSITY_PROFILE_PREFIXES.some((prefix) => token.startsWith(prefix));
  diversityProfileTokenCache.set(token, result);
  return result;
}

function toCachedTokenSet(tokens: readonly string[]): ReadonlySet<string> {
  const cached = tokenSetCache.get(tokens);
  if (cached !== undefined) {
    return cached;
  }
  const tokenSet = new Set(tokens);
  tokenSetCache.set(tokens, tokenSet);
  return tokenSet;
}

export function resolveCoverageRoleKey(roleDefinition: RoleDefinition): string {
  if (isPrimarySelectionRole(roleDefinition.kind)) {
    const roleName = roleDefinition.key.slice(roleDefinition.key.indexOf(':') + 1);
    return roleDefinition.optionCount >= 3 ? `main:${roleName}` : `pair:${roleName}`;
  }
  if (roleDefinition.optionCount === 1) {
    return roleDefinition.key;
  }
  if (roleDefinition.optionCount === 2) {
    return `pair:${roleDefinition.key}`;
  }
  if (roleDefinition.optionCount === 3) {
    return `triple:${roleDefinition.key}`;
  }
  return roleDefinition.key;
}

function filterCandidatesByStrengthFloor(args: {
  candidates: Array<{ analysis: EntityAnalysis; fitScore: number; exactMatch: boolean }>;
  referenceCandidates?: Array<{
    analysis: EntityAnalysis;
    fitScore: number;
    exactMatch: boolean;
  }>;
  roleDefinition: RoleDefinition;
  stats: ReturnType<typeof buildCategoryAnalyses>['stats'];
  perspective: 'recommended' | 'best' | 'cheap';
}): Array<{ analysis: EntityAnalysis; fitScore: number; exactMatch: boolean }> | undefined {
  const { candidates, referenceCandidates = candidates, roleDefinition, stats, perspective } = args;
  if (perspective === 'best' || candidates.length <= 1) {
    return undefined;
  }
  const scoredCandidates = candidates.map((candidate) => ({
    candidate,
    strengthScore: resolveRoleStrengthScore(candidate.analysis, roleDefinition, stats),
  }));
  const strengthFloor =
    perspective === 'cheap'
      ? isPrimarySelectionRole(roleDefinition.kind)
        ? 0.72
        : 0.58
      : isPrimarySelectionRole(roleDefinition.kind)
        ? 0.82
        : 0.58;
  const strongestScoreByGroup = new Map<string, number>();
  for (const candidate of referenceCandidates) {
    const groupKey = deriveCompetitionGroupKey(candidate.analysis);
    const strengthScore = resolveRoleStrengthScore(candidate.analysis, roleDefinition, stats);
    const strongest = strongestScoreByGroup.get(groupKey) ?? 0;
    if (strengthScore > strongest) {
      strongestScoreByGroup.set(groupKey, strengthScore);
    }
  }
  if ([...strongestScoreByGroup.values()].every((score) => score <= 0)) {
    return undefined;
  }
  const strengthFiltered = scoredCandidates.filter((entry) => {
    const strongestScore =
      strongestScoreByGroup.get(deriveCompetitionGroupKey(entry.candidate.analysis)) ?? 0;
    return strongestScore <= 0 || entry.strengthScore >= strongestScore * strengthFloor;
  });
  if (strengthFiltered.length === 0) {
    return [];
  }
  return strengthFiltered.map((entry) => entry.candidate);
}

function resolveRoleStrengthScore(
  analysis: EntityAnalysis,
  roleDefinition: RoleDefinition,
  stats: ReturnType<typeof buildCategoryAnalyses>['stats'],
): number {
  const bestScore = resolvePerspectiveScore(analysis, roleDefinition, stats, 'best');
  return bestScore - (analysis.exactRoleTokens.has(roleDefinition.key) ? 600 : 0);
}

function resolvePerspectiveScore(
  analysis: EntityAnalysis,
  roleDefinition: RoleDefinition,
  stats: ReturnType<typeof buildCategoryAnalyses>['stats'],
  perspective: SelectionPerspective,
): number {
  let scoresByAnalysis = perspectiveScoresByRole.get(roleDefinition);
  if (!scoresByAnalysis) {
    scoresByAnalysis = new WeakMap();
    perspectiveScoresByRole.set(roleDefinition, scoresByAnalysis);
  }
  const cached = scoresByAnalysis.get(analysis)?.[perspective];
  if (cached !== undefined) {
    return cached;
  }
  const score = scoreAnalysisForPerspective({
    analysis,
    role: roleDefinition,
    stats,
    perspective,
  });
  const scores = scoresByAnalysis.get(analysis) ?? {};
  scores[perspective] = score;
  scoresByAnalysis.set(analysis, scores);
  return score;
}

function filterAffordableCandidates<T extends { analysis: EntityAnalysis }>(
  candidates: T[],
  chosenNames: ReadonlySet<string>,
  recommendedCost: number | undefined,
): T[] {
  const unused = candidates.filter((candidate) => !chosenNames.has(candidate.analysis.entity.name));
  if (unused.length <= 1) {
    return unused;
  }
  const medianCost = resolveMedianCost(unused);
  const meaningfulBudgetCeiling = Math.min(
    medianCost,
    recommendedCost === undefined ? medianCost : recommendedCost * 0.9,
  );
  const meaningfulBudget = unused.filter(
    (candidate) => candidate.analysis.entity.cost <= meaningfulBudgetCeiling,
  );
  if (meaningfulBudget.length > 0) {
    return meaningfulBudget;
  }
  if (recommendedCost !== undefined) {
    return [];
  }
  const fallbackCeiling = medianCost;
  const fallback = unused.filter((candidate) => candidate.analysis.entity.cost <= fallbackCeiling);
  if (fallback.length > 0) {
    return fallback;
  }
  const minimumCost = Math.min(...unused.map((candidate) => candidate.analysis.entity.cost));
  return unused.filter((candidate) => candidate.analysis.entity.cost === minimumCost);
}

function filterCandidatesByFitFloor(
  candidates: Array<{ analysis: EntityAnalysis; fitScore: number; exactMatch: boolean }>,
  roleDefinition: RoleDefinition,
  perspective: 'recommended' | 'best' | 'cheap',
): Array<{ analysis: EntityAnalysis; fitScore: number; exactMatch: boolean }> {
  if (candidates.length <= 1) {
    return candidates;
  }

  const bestFitScoreByGroup = new Map<string, number>();
  for (const candidate of candidates) {
    const groupKey = deriveCompetitionGroupKey(candidate.analysis);
    const bestFitScore = bestFitScoreByGroup.get(groupKey) ?? 0;
    if (candidate.fitScore > bestFitScore) {
      bestFitScoreByGroup.set(groupKey, candidate.fitScore);
    }
  }
  if ([...bestFitScoreByGroup.values()].every((score) => score <= 0)) {
    return candidates;
  }

  const fitFloorRatio =
    perspective === 'best'
      ? roleDefinition.kind === 'capability'
        ? 0.72
        : 0.6
      : perspective === 'recommended'
        ? roleDefinition.kind === 'capability'
          ? 0.58
          : 0.45
        : roleDefinition.kind === 'capability'
          ? 0.48
          : 0.35;
  return candidates.filter((candidate) => {
    const bestFitScore =
      bestFitScoreByGroup.get(deriveCompetitionGroupKey(candidate.analysis)) ?? 0;
    return bestFitScore <= 0 || candidate.fitScore >= bestFitScore * fitFloorRatio;
  });
}

function deriveCompetitionGroupKey(analysis: EntityAnalysis): string {
  const platform = derivePlatformForm(analysis.entity);
  return platform === 'wheeled_vehicle' || platform === 'tracked_vehicle' ? platform : 'shared';
}

function shouldSeparateGroundPlatformCompetition(
  left: Pick<EntityAnalysis, 'entity'>,
  right: Pick<EntityAnalysis, 'entity'>,
): boolean {
  const leftPlatform = derivePlatformForm(left.entity);
  const rightPlatform = derivePlatformForm(right.entity);
  return (
    (leftPlatform === 'wheeled_vehicle' || leftPlatform === 'tracked_vehicle') &&
    (rightPlatform === 'wheeled_vehicle' || rightPlatform === 'tracked_vehicle') &&
    leftPlatform !== rightPlatform
  );
}

function resolveMedianCost(candidates: Array<{ analysis: EntityAnalysis }>): number {
  if (candidates.length === 0) {
    return 0;
  }
  const sortedCosts = candidates
    .map((candidate) => candidate.analysis.entity.cost)
    .sort((left, right) => left - right);
  const middleIndex = Math.floor(sortedCosts.length / 2);
  return sortedCosts.length % 2 === 0
    ? ((sortedCosts[middleIndex - 1] ?? 0) + (sortedCosts[middleIndex] ?? 0)) / 2
    : (sortedCosts[middleIndex] ?? 0);
}

function resolveSelectionKind(
  kind: RoleDefinition['kind'],
  perspective: 'recommended' | 'best' | 'cheap',
): PremadeCard['selectionKind'] {
  if (isPrimarySelectionRole(kind)) {
    return `type-${perspective}`;
  }
  return `role-${perspective}`;
}

function resolveKeepPriority(
  kind: RoleDefinition['kind'],
  perspective: 'recommended' | 'best' | 'cheap',
): number {
  const kindBase =
    kind === 'primary'
      ? 7_000
      : kind === 'type'
        ? 6_000
        : kind === 'role'
          ? 5_800
          : kind === 'capability'
            ? 4_800
            : 4_000;
  const perspectiveOffset = perspective === 'best' ? 320 : perspective === 'recommended' ? 220 : 80;
  return kindBase + perspectiveOffset;
}

function isPrimarySelectionRole(kind: RoleDefinition['kind']): boolean {
  return kind === 'primary' || kind === 'type';
}

function isPriceSensitiveMainRole(roleDefinition: RoleDefinition): boolean {
  return isPrimarySelectionRole(roleDefinition.kind) && roleDefinition.optionCount === 3;
}

function resolveRoleScarcityBonus(args: {
  roleDefinition: RoleDefinition;
  supportCount: number;
  exactMatch: boolean;
}): number {
  const { roleDefinition, supportCount, exactMatch } = args;
  // Scarcity is a weak tie-break, never a guarantee: a capability carried by a
  // single unit must not outrank genuine main-role selections during trimming.
  const rarity =
    roleDefinition.kind === 'capability' || roleDefinition.kind === 'role'
      ? Math.max(0, 3 - supportCount) * 160
      : 0;
  return rarity + (exactMatch && roleDefinition.kind === 'capability' ? 120 : 0);
}

function shouldApplyCountryPreferenceTieBreak(
  left: EntityAnalysis,
  right: EntityAnalysis,
): boolean {
  return (
    left.similarityKey === right.similarityKey ||
    (left.entity.kind === 'building' &&
      right.entity.kind === 'building' &&
      left.typeKey === right.typeKey)
  );
}
