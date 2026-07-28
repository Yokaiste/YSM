import {
  areNearDuplicateProfiles,
  buildCategoryAnalyses,
  compareNearDuplicateProfileQuality,
  deriveSelectionPurposeGroupKey,
  deriveTransportGroup,
  type EntityAnalysis,
  type EntityAnalysisFactory,
  type RoleDefinition,
  resolveSelectionPurposeGroupLimit,
  scoreAnalysisAsFiller,
  scoreAnalysisForPerspective,
} from './analysis.ts';
import {
  type DeckGenerationConfig,
  shouldForceEntityInPremade,
  shouldIncludeEntityInPremade,
} from './config.ts';
import {
  buildForcedCards,
  buildSelectionCards,
  normalizePremadeCards,
  sortPremadeCards,
  trimCategoryCards,
} from './premade-cards.ts';
import {
  buildRoleSelections,
  type PremadeSelection,
  resolveCoverageRoleKey,
} from './premade-selection.ts';
import type {
  AmmunitionData,
  DivisionContext,
  DivisionMode,
  EntityData,
  GeneratedPack,
  GeneratedRuleEntry,
  PremadeCard,
  WeaponDescriptorData,
} from './types.ts';

export function buildPremadeCards(args: {
  context: DivisionContext;
  mode: DivisionMode;
  ruleEntries: GeneratedRuleEntry[];
  entityByName: Map<string, EntityData>;
  generatedPacks: Map<string, GeneratedPack>;
  weaponDescriptors: Map<string, WeaponDescriptorData>;
  ammunition: Map<string, AmmunitionData>;
  analysisFactory?: EntityAnalysisFactory;
  modTag: string;
  contextCode: string;
  config: DeckGenerationConfig;
}): PremadeCard[] {
  const {
    context,
    mode,
    ruleEntries,
    entityByName,
    generatedPacks,
    weaponDescriptors,
    ammunition,
    analysisFactory,
    modTag,
    contextCode,
    config,
  } = args;
  const premadeEntries = ruleEntries.filter((entry) =>
    shouldIncludeEntityInPremade(entry.entity, context, mode, config),
  );
  const groupedEntries = new Map<string, GeneratedRuleEntry[]>();

  for (const entry of premadeEntries) {
    const categoryKey = entry.entity.factoryType ?? 'Unknown';
    const entries = groupedEntries.get(categoryKey) ?? [];
    entries.push(entry);
    groupedEntries.set(categoryKey, entries);
  }

  const cards = [...groupedEntries.entries()].flatMap(([categoryKey, entries]) =>
    buildPremadeCategoryCards({
      categoryKey,
      entries,
      ruleEntries,
      context,
      mode,
      entityByName,
      generatedPacks,
      weaponDescriptors,
      ammunition,
      ...(analysisFactory ? { analysisFactory } : {}),
      modTag,
      contextCode,
      config,
    }),
  );
  return sortPremadeCards(
    normalizePremadeCards({
      cards,
      mode,
      ruleEntries,
      entityByName,
      generatedPacks,
      modTag,
      contextCode,
    }),
    entityByName,
  );
}

function buildPremadeCategoryCards(args: {
  categoryKey: string;
  entries: GeneratedRuleEntry[];
  ruleEntries: GeneratedRuleEntry[];
  context: DivisionContext;
  mode: DivisionMode;
  entityByName: Map<string, EntityData>;
  generatedPacks: Map<string, GeneratedPack>;
  weaponDescriptors: Map<string, WeaponDescriptorData>;
  ammunition: Map<string, AmmunitionData>;
  analysisFactory?: EntityAnalysisFactory;
  modTag: string;
  contextCode: string;
  config: DeckGenerationConfig;
}): PremadeCard[] {
  const {
    categoryKey,
    entries,
    context,
    mode,
    ruleEntries,
    entityByName,
    generatedPacks,
    weaponDescriptors,
    ammunition,
    analysisFactory,
    modTag,
    contextCode,
    config,
  } = args;
  const forcedEntries: GeneratedRuleEntry[] = [];
  const competitiveEntries: GeneratedRuleEntry[] = [];
  for (const entry of entries) {
    if (shouldForceEntityInPremade(entry.entity, context, mode, config)) {
      forcedEntries.push(entry);
    } else {
      competitiveEntries.push(entry);
    }
  }
  const {
    analyses: competitiveAnalyses,
    roleDefinitions,
    stats,
  } = buildCategoryAnalyses({
    entries: competitiveEntries,
    weaponDescriptors,
    ammunition,
    ...(analysisFactory ? { analysisFactory } : {}),
  });
  const analysisByName = new Map(
    competitiveAnalyses.map((analysis) => [analysis.entity.name, analysis] as const),
  );
  const backfillScoreByName = new Map(
    competitiveAnalyses.map(
      (analysis) =>
        [analysis.entity.name, scoreAnalysisForBackfill(analysis, roleDefinitions, stats)] as const,
    ),
  );
  const forcedCards = sortPremadeCards(
    normalizePremadeCards({
      cards: buildForcedCards({
        entries: forcedEntries,
        categoryKey,
        mode,
        entityByName,
        generatedPacks,
        modTag,
        contextCode,
      }),
      mode,
      ruleEntries,
      entityByName,
      generatedPacks,
      modTag,
      contextCode,
    }),
    entityByName,
  ).slice(0, config.deckSlotCount);
  const competitiveSlotLimit = Math.max(0, config.deckSlotCount - forcedCards.length);
  if (competitiveSlotLimit === 0) {
    return forcedCards;
  }
  const selections: PremadeSelection[] = [];

  for (const roleDefinition of roleDefinitions) {
    const roleSelections = buildRoleSelections({
      roleDefinition,
      analyses: competitiveAnalyses,
      stats,
      context,
      config,
    });
    for (const roleSelection of roleSelections) {
      selections.push(roleSelection);
    }
  }

  const fillerLimit = Math.max(
    1,
    Math.ceil(Math.sqrt(Math.min(roleDefinitions.length, competitiveSlotLimit)) / 2),
  );
  const fillerSelections = competitiveAnalyses
    .map((analysis) => ({
      analysis,
      score: backfillScoreByName.get(analysis.entity.name) ?? 0,
    }))
    .filter((candidate) => candidate.score > 2_500)
    .sort((left, right) => right.score - left.score)
    .slice(0, fillerLimit)
    .map((candidate): PremadeSelection => {
      return {
        analysis: candidate.analysis,
        roleKey: 'filler',
        selectionKind: 'filler',
        roleScore: candidate.score,
        keepPriority: 1_000,
      };
    });
  selections.push(...fillerSelections);

  const cards = selections.flatMap((selection) =>
    buildSelectionCards({
      selection,
      categoryKey,
      mode,
      entityByName,
      analysisByName,
      generatedPacks,
      modTag,
      contextCode,
    }),
  );
  const normalizedCompetitiveCards = normalizePremadeCards({
    cards,
    mode,
    ruleEntries,
    entityByName,
    generatedPacks,
    modTag,
    contextCode,
  });
  const minimumMainRoleCoverage = Math.max(
    1,
    roleDefinitions
      .filter((role) => role.kind === 'primary' || role.kind === 'type')
      .reduce((total, role) => total + role.optionCount, 0),
  );
  const backfillTarget = Math.min(
    competitiveSlotLimit,
    Math.max(
      minimumMainRoleCoverage,
      resolvePremadeBackfillTarget(
        normalizedCompetitiveCards.length,
        roleDefinitions.length,
        competitiveSlotLimit,
      ),
    ),
  );
  const trimmedCompetitiveCards = trimCategoryCards({
    cards: normalizedCompetitiveCards,
    limit: backfillTarget,
    entityByName,
    context,
    config,
  });
  const competitiveCards = backfillDistinctPremadeCards({
    cards: trimmedCompetitiveCards,
    target: backfillTarget,
    analyses: competitiveAnalyses,
    roleDefinitions,
    scoreByName: backfillScoreByName,
    categoryKey,
    mode,
    ruleEntries,
    entityByName,
    analysisByName,
    generatedPacks,
    modTag,
    contextCode,
  });

  return [...forcedCards, ...competitiveCards];
}

export function resolvePremadeBackfillTarget(
  roleSelectedCardCount: number,
  meaningfulRoleCount: number,
  slotLimit: number,
): number {
  if (roleSelectedCardCount <= 0 || meaningfulRoleCount <= 0 || slotLimit <= 0) {
    return 0;
  }
  // Role selection deliberately overlaps: one strong multi-role unit may be
  // emitted by several role aliases, and transport variants inflate the raw
  // card count further. Blend both signals at a conservative density instead
  // of treating every removed overlap as a slot that must be refilled. This
  // restores useful deck breadth without pushing large categories to the cap.
  const usefulDensityTarget = Math.ceil(((roleSelectedCardCount + meaningfulRoleCount) * 3) / 10);
  return Math.min(slotLimit, Math.max(1, usefulDensityTarget));
}

function backfillDistinctPremadeCards(args: {
  cards: PremadeCard[];
  target: number;
  analyses: EntityAnalysis[];
  roleDefinitions: RoleDefinition[];
  scoreByName: ReadonlyMap<string, number>;
  categoryKey: string;
  mode: DivisionMode;
  ruleEntries: GeneratedRuleEntry[];
  entityByName: Map<string, EntityData>;
  analysisByName: Map<string, EntityAnalysis>;
  generatedPacks: Map<string, GeneratedPack>;
  modTag: string;
  contextCode: string;
}): PremadeCard[] {
  const {
    target,
    analyses,
    roleDefinitions,
    scoreByName,
    categoryKey,
    mode,
    ruleEntries,
    entityByName,
    analysisByName,
    generatedPacks,
    modTag,
    contextCode,
  } = args;
  let selected = [...args.cards];

  const selectedNames = new Set(selected.map((card) => card.entity.name));
  const meaningfulRoleKeys = new Set(roleDefinitions.map((role) => role.key));
  const coveredRoleKeys = new Set<string>();
  const coveredProfileTokens = new Set<string>();
  const profileSupport = new Map<string, number>();
  for (const analysis of analyses) {
    for (const token of analysis.profileTokens) {
      profileSupport.set(token, (profileSupport.get(token) ?? 0) + 1);
    }
  }
  const recordCoverage = (analysis: EntityAnalysis): void => {
    for (const token of analysis.exactRoleTokens) {
      if (meaningfulRoleKeys.has(token)) coveredRoleKeys.add(token);
    }
    for (const token of analysis.profileTokens) coveredProfileTokens.add(token);
  };
  const rebuildCoverage = (): void => {
    coveredRoleKeys.clear();
    coveredProfileTokens.clear();
    for (const name of selectedNames) {
      const analysis = analysisByName.get(name);
      if (analysis) recordCoverage(analysis);
    }
  };
  rebuildCoverage();

  const scored = analyses
    .filter((analysis) => !selectedNames.has(analysis.entity.name))
    .map((analysis) => ({
      analysis,
      baseScore: scoreByName.get(analysis.entity.name) ?? 0,
    }));
  const topScore = Math.max(...scored.map((candidate) => candidate.baseScore), 0);
  const minimumScore = topScore * 0.25;
  const candidateFrontierSize = Math.max(target * 2, roleDefinitions.length * 2);
  const remaining = scored
    .filter((candidate) => candidate.baseScore >= minimumScore)
    .sort(
      (left, right) =>
        right.baseScore - left.baseScore ||
        left.analysis.entity.name.localeCompare(right.analysis.entity.name),
    )
    .slice(0, candidateFrontierSize);
  const replacementLimit = Math.max(1, Math.ceil(Math.sqrt(target)));
  let replacementCount = 0;

  while (remaining.length > 0) {
    const canAddCard = selected.length < target;
    const eligible = remaining
      .flatMap((candidate) => {
        if (wouldOverrepresentPurposeGroup(candidate.analysis, selected, analysisByName)) {
          return [];
        }
        const conflictingNames = [
          ...new Set(
            selected
              .filter(
                (card) =>
                  card.entity.name !== candidate.analysis.entity.name &&
                  areNearDuplicateProfiles(candidate.analysis, card),
              )
              .map((card) => card.entity.name),
          ),
        ];
        if (conflictingNames.length === 0 && !canAddCard) {
          return [];
        }
        // Similarity is intentionally tolerant and therefore non-transitive.
        // A candidate close to two mutually distinct cards is ambiguous; it
        // must not collapse both into one and silently shrink role coverage.
        if (conflictingNames.length > 1) {
          return [];
        }
        if (conflictingNames.length > 0 && replacementCount >= replacementLimit) {
          return [];
        }
        const improvesEveryConflict = conflictingNames.every((name) => {
          const incumbent = analysisByName.get(name);
          if (!incumbent) return false;
          const incumbentRoleKeys = new Set(
            selected
              .filter((card) => card.entity.name === name)
              .flatMap((card) => card.roleKeys)
              .filter((roleKey) => roleKey !== 'filler' && roleKey !== 'backfill'),
          );
          if (
            [...incumbentRoleKeys].some(
              (roleKey) =>
                !roleDefinitions.some(
                  (role) =>
                    resolveCoverageRoleKey(role) === roleKey &&
                    candidate.analysis.exactRoleTokens.has(role.key),
                ),
            )
          ) {
            return false;
          }
          const qualityCompare = compareNearDuplicateProfileQuality(candidate.analysis, incumbent);
          if (qualityCompare !== 0) return qualityCompare < 0;
          return candidate.baseScore > (scoreByName.get(name) ?? 0) * 1.05;
        });
        if (conflictingNames.length > 0 && !improvesEveryConflict) {
          return [];
        }
        return [
          {
            ...candidate,
            conflictingNames,
            marginalScore:
              candidate.baseScore +
              resolveBackfillRoleNovelty(candidate.analysis, meaningfulRoleKeys, coveredRoleKeys) +
              resolveBackfillProfileNovelty(
                candidate.analysis,
                analyses.length,
                profileSupport,
                coveredProfileTokens,
              ),
          },
        ];
      })
      .sort(
        (left, right) =>
          right.marginalScore - left.marginalScore ||
          left.analysis.entity.name.localeCompare(right.analysis.entity.name),
      );
    const next = eligible[0];
    if (!next) {
      break;
    }
    const remainingIndex = remaining.findIndex(
      (candidate) => candidate.analysis.entity.name === next.analysis.entity.name,
    );
    if (remainingIndex >= 0) remaining.splice(remainingIndex, 1);

    const mergedRoleKeys = new Set<string>(['backfill']);
    if (next.conflictingNames.length > 0) {
      replacementCount += 1;
      const conflicts = new Set(next.conflictingNames);
      for (const card of selected) {
        if (conflicts.has(card.entity.name)) {
          for (const roleKey of card.roleKeys) mergedRoleKeys.add(roleKey);
        }
      }
      selected = selected.filter((card) => !conflicts.has(card.entity.name));
      for (const name of conflicts) selectedNames.delete(name);
    }

    const candidateCards = normalizePremadeCards({
      cards: buildSelectionCards({
        selection: {
          analysis: next.analysis,
          roleKey: 'backfill',
          selectionKind: 'filler',
          roleScore: next.marginalScore,
          keepPriority: 900,
        },
        categoryKey,
        mode,
        entityByName,
        analysisByName,
        generatedPacks,
        modTag,
        contextCode,
      }),
      mode,
      ruleEntries,
      entityByName,
      generatedPacks,
      modTag,
      contextCode,
    });
    const card = selectBackfillTransportCard(candidateCards, selected, entityByName);
    if (!card) {
      continue;
    }
    selected.push({ ...card, roleKeys: [...mergedRoleKeys] });
    selectedNames.add(next.analysis.entity.name);
    rebuildCoverage();
  }

  return selected;
}

function wouldOverrepresentPurposeGroup(
  candidate: EntityAnalysis,
  selected: readonly PremadeCard[],
  analysisByName: ReadonlyMap<string, EntityAnalysis>,
): boolean {
  const candidateKey = deriveSelectionPurposeGroupKey(candidate);
  const matchingNames = new Set(
    selected
      .filter((card) => {
        const analysis = analysisByName.get(card.entity.name);
        return analysis && deriveSelectionPurposeGroupKey(analysis) === candidateKey;
      })
      .map((card) => card.entity.name),
  );
  return (
    !matchingNames.has(candidate.entity.name) &&
    matchingNames.size >= resolveSelectionPurposeGroupLimit(candidate)
  );
}

function scoreAnalysisForBackfill(
  analysis: EntityAnalysis,
  roleDefinitions: readonly RoleDefinition[],
  stats: ReturnType<typeof buildCategoryAnalyses>['stats'],
): number {
  const roleScores = roleDefinitions
    .filter((role) => analysis.exactRoleTokens.has(role.key))
    .map((role) => scoreAnalysisForPerspective({ analysis, role, stats, perspective: 'best' }))
    .sort((left, right) => right - left);
  const strongestRoleScore = roleScores[0] ?? 0;
  const secondaryRoleScore = roleScores[1] ?? 0;
  const generalQuality = scoreAnalysisAsFiller(analysis);
  return (
    Math.max(generalQuality, strongestRoleScore + secondaryRoleScore * 0.15) + generalQuality * 0.2
  );
}

function resolveBackfillRoleNovelty(
  analysis: EntityAnalysis,
  meaningfulRoleKeys: ReadonlySet<string>,
  coveredRoleKeys: ReadonlySet<string>,
): number {
  const uncovered = [...analysis.exactRoleTokens].filter(
    (token) => meaningfulRoleKeys.has(token) && !coveredRoleKeys.has(token),
  ).length;
  return Math.min(800, uncovered * 180);
}

function resolveBackfillProfileNovelty(
  analysis: EntityAnalysis,
  analysisCount: number,
  profileSupport: ReadonlyMap<string, number>,
  coveredProfileTokens: ReadonlySet<string>,
): number {
  return Math.min(
    900,
    analysis.profileTokens
      .filter((token) => !coveredProfileTokens.has(token))
      .reduce(
        (total, token) =>
          total +
          (1 - (profileSupport.get(token) ?? analysisCount) / Math.max(1, analysisCount)) * 150,
        0,
      ),
  );
}

function selectBackfillTransportCard(
  cards: PremadeCard[],
  selected: PremadeCard[],
  entityByName: Map<string, EntityData>,
): PremadeCard | undefined {
  if (cards.length <= 1) {
    return cards[0];
  }
  const transportCounts = { Ground: 0, Air: 0 };
  for (const card of selected) {
    const transport = card.transportName ? entityByName.get(card.transportName) : undefined;
    if (transport) transportCounts[deriveTransportGroup(transport)] += 1;
  }
  return [...cards].sort((left, right) => {
    const leftTransport = left.transportName ? entityByName.get(left.transportName) : undefined;
    const rightTransport = right.transportName ? entityByName.get(right.transportName) : undefined;
    const leftCount = leftTransport
      ? transportCounts[deriveTransportGroup(leftTransport)]
      : Number.NEGATIVE_INFINITY;
    const rightCount = rightTransport
      ? transportCounts[deriveTransportGroup(rightTransport)]
      : Number.NEGATIVE_INFINITY;
    return (
      leftCount - rightCount || left.packDescriptorName.localeCompare(right.packDescriptorName)
    );
  })[0];
}
