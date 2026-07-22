import {
  areNearDuplicateProfiles,
  compareNearDuplicateProfileQuality,
  deriveSelectionPurposeGroupKey,
  deriveTransportGroup,
  type EntityAnalysis,
  resolveSelectionPurposeGroupLimit,
} from './analysis.ts';
import { compareCountryPreference, type DeckGenerationConfig } from './config.ts';
import { compareEntityPriority, derivePremadeTypeKey, resolveCategoryOrder } from './helpers.ts';
import { ensureGeneratedPackDescriptor, resolvePackProfile } from './packs.ts';
import type { PremadeSelection } from './premade-selection.ts';
import {
  normalizeTransportName,
  resolveSelectedTransportNames,
  resolveTransportRank,
} from './premade-transport.ts';
import type {
  DivisionContext,
  DivisionMode,
  EntityData,
  GeneratedPack,
  GeneratedRuleEntry,
  PremadeCard,
} from './types.ts';

export function buildSelectionCards(args: {
  selection: PremadeSelection;
  categoryKey: string;
  mode: DivisionMode;
  entityByName: Map<string, EntityData>;
  analysisByName: Map<string, EntityAnalysis>;
  generatedPacks: Map<string, GeneratedPack>;
  modTag: string;
  contextCode: string;
}): PremadeCard[] {
  const {
    selection,
    categoryKey,
    mode,
    entityByName,
    analysisByName,
    generatedPacks,
    modTag,
    contextCode,
  } = args;
  return buildEntryCards({
    entry: selection.analysis.entry,
    entity: selection.analysis.entity,
    categoryKey,
    mode,
    entityByName,
    analysisByName,
    generatedPacks,
    modTag,
    contextCode,
    selectionKind: selection.selectionKind,
    typeKey: selection.analysis.typeKey,
    roleKeys: [selection.roleKey],
    roleScore: selection.roleScore,
    keepPriority: selection.keepPriority,
    similarityKey: selection.analysis.similarityKey,
    similarityVector: selection.analysis.similarityVector,
    profileTokens: selection.analysis.profileTokens,
  });
}

export function buildForcedCards(args: {
  entries: GeneratedRuleEntry[];
  categoryKey: string;
  mode: DivisionMode;
  entityByName: Map<string, EntityData>;
  generatedPacks: Map<string, GeneratedPack>;
  modTag: string;
  contextCode: string;
}): PremadeCard[] {
  const { entries, categoryKey, mode, entityByName, generatedPacks, modTag, contextCode } = args;
  const noScoredAnalyses = new Map<string, EntityAnalysis>();
  return entries.flatMap((entry) =>
    buildEntryCards({
      entry,
      entity: entry.entity,
      categoryKey,
      mode,
      entityByName,
      analysisByName: noScoredAnalyses,
      generatedPacks,
      modTag,
      contextCode,
      selectionKind: 'forced',
      typeKey: derivePremadeTypeKey(entry.entity),
      roleKeys: ['forced'],
      roleScore: 0,
      keepPriority: 0,
      similarityKey: `forced:${entry.entity.name}`,
      similarityVector: [],
    }),
  );
}

function buildEntryCards(args: {
  entry: GeneratedRuleEntry;
  entity: EntityData;
  categoryKey: string;
  mode: DivisionMode;
  entityByName: Map<string, EntityData>;
  analysisByName: Map<string, EntityAnalysis>;
  generatedPacks: Map<string, GeneratedPack>;
  modTag: string;
  contextCode: string;
  selectionKind: PremadeCard['selectionKind'];
  typeKey: string;
  roleKeys: string[];
  roleScore: number;
  keepPriority: number;
  similarityKey: string;
  similarityVector: number[];
  profileTokens?: readonly string[];
}): PremadeCard[] {
  const {
    entry,
    entity,
    categoryKey,
    mode,
    entityByName,
    analysisByName,
    generatedPacks,
    modTag,
    contextCode,
    selectionKind,
    typeKey,
    roleKeys,
    roleScore,
    keepPriority,
    similarityKey,
    similarityVector,
    profileTokens,
  } = args;
  const profile = resolvePackProfile(entry.rule);
  if (!profile) {
    return [];
  }
  const transportNames = resolveSelectedTransportNames({
    entry,
    entity,
    selectionKind,
    entityByName,
    analysisByName,
  });

  return transportNames.flatMap((transportName) => {
    const packDescriptorName = ensureGeneratedPackDescriptor({
      entity,
      mode,
      generatedPacks,
      modTag,
      contextCode,
      xp: profile.xp,
      number: profile.number,
      ...(transportName ? { transportName } : {}),
    });

    const transportEntity = transportName ? entityByName.get(transportName) : undefined;
    const airPenalty =
      transportEntity &&
      deriveTransportGroup(transportEntity) === 'Air' &&
      transportNames.some((name) => {
        const sibling = name ? entityByName.get(name) : undefined;
        return sibling && deriveTransportGroup(sibling) === 'Ground';
      })
        ? 120
        : 0;

    return {
      entity,
      categoryKey,
      categoryOrder: resolveCategoryOrder(entity.factoryType),
      typeKey,
      roleKeys,
      selectionKind,
      forcedInPremade: selectionKind === 'forced',
      maxUnitCardCount: profile.maxUnitCardCount,
      roleScore,
      keepPriority: keepPriority - airPenalty,
      similarityKey,
      similarityVector,
      ...(profileTokens ? { profileTokens } : {}),
      packDescriptorName,
      ...(transportName ? { transportName } : {}),
    };
  });
}

export function normalizePremadeCards(args: {
  cards: PremadeCard[];
  mode: DivisionMode;
  ruleEntries: GeneratedRuleEntry[];
  entityByName: Map<string, EntityData>;
  generatedPacks: Map<string, GeneratedPack>;
  modTag: string;
  contextCode: string;
}): PremadeCard[] {
  const { cards, mode, ruleEntries, entityByName, generatedPacks, modTag, contextCode } = args;
  const ruleEntryByUnitName = new Map(
    ruleEntries.map((entry) => [entry.entity.name, entry] as const),
  );
  const normalizedCards = cards.flatMap((card): PremadeCard[] => {
    const entry = ruleEntryByUnitName.get(card.entity.name);
    if (!entry) {
      return [];
    }
    const profile = resolvePackProfile(entry.rule);
    if (!profile) {
      return [];
    }
    const transportName = normalizeTransportName({ card, entry, entityByName });
    const packDescriptorName = ensureGeneratedPackDescriptor({
      entity: card.entity,
      mode,
      generatedPacks,
      modTag,
      contextCode,
      xp: profile.xp,
      number: profile.number,
      ...(transportName ? { transportName } : {}),
    });
    const { transportName: _previousTransportName, ...rest } = card;
    return [
      {
        ...rest,
        maxUnitCardCount: profile.maxUnitCardCount,
        packDescriptorName,
        ...(transportName ? { transportName } : {}),
      },
    ];
  });
  return enforceUnitPackLimits(dedupeCards(normalizedCards), entityByName);
}

export function trimCategoryCards(args: {
  cards: PremadeCard[];
  limit: number;
  entityByName: Map<string, EntityData>;
  context: DivisionContext;
  config: DeckGenerationConfig;
}): PremadeCard[] {
  const { cards, limit, entityByName, context, config } = args;
  let selected = enforceUnitPackLimits(dedupeCards(cards), entityByName);
  const duplicateScoreContext = buildRemovalScoreContext(selected, entityByName);
  // A second transport is useful variety, but it is the first optional card
  // to surrender when the category is full.
  while (selected.length > limit) {
    const duplicateIndex = findLowestPriorityDuplicateUnitCard(
      selected,
      entityByName,
      duplicateScoreContext,
    );
    if (duplicateIndex < 0) {
      break;
    }
    const [removedCard] = selected.splice(duplicateIndex, 1);
    if (removedCard) removeCardFromScoreContext(duplicateScoreContext, removedCard, entityByName);
  }
  selected = pruneOverrepresentedPurposeGroups(selected, entityByName);
  selected = pruneSimilarityCards({ cards: selected, entityByName, context, config });
  const forcedCount = selected.filter((card) => card.forcedInPremade).length;
  if (forcedCount > limit) {
    throw new Error(`Forced premade cards exceed the category limit: ${forcedCount}/${limit}.`);
  }
  const coverageTargets = buildRoleCoverageTargets(selected, limit - forcedCount);
  const coverageScoreContext = buildRemovalScoreContext(selected, entityByName);
  while (selected.length > limit) {
    const removeIndex = findLowestPriorityRemovableCard({
      cards: selected,
      entityByName,
      coverageTargets,
      scoreContext: coverageScoreContext,
    });
    if (removeIndex < 0) {
      const relaxedRole = findLowestPriorityCoveredRole(coverageTargets, selected);
      if (!relaxedRole) {
        throw new Error(`Unable to trim premade category to its ${limit}-card limit.`);
      }
      const target = coverageTargets.get(relaxedRole) ?? 0;
      if (target <= 1) {
        coverageTargets.delete(relaxedRole);
      } else {
        coverageTargets.set(relaxedRole, target - 1);
      }
      continue;
    }
    const [removedCard] = selected.splice(removeIndex, 1);
    if (removedCard) removeCardFromScoreContext(coverageScoreContext, removedCard, entityByName);
  }
  return selected;
}

function pruneOverrepresentedPurposeGroups(
  cards: PremadeCard[],
  entityByName: Map<string, EntityData>,
): PremadeCard[] {
  let selected = [...cards];
  while (true) {
    const unitsByPurpose = new Map<string, Set<string>>();
    for (const card of selected) {
      if (card.forcedInPremade) continue;
      const purposeKey = deriveSelectionPurposeGroupKey(card);
      const units = unitsByPurpose.get(purposeKey) ?? new Set<string>();
      units.add(card.entity.name);
      unitsByPurpose.set(purposeKey, units);
    }
    const overrepresented = [...unitsByPurpose.entries()]
      .filter(([purposeKey, units]) => {
        const representative = selected.find(
          (card) => deriveSelectionPurposeGroupKey(card) === purposeKey,
        );
        return (
          representative !== undefined &&
          units.size > resolveSelectionPurposeGroupLimit(representative)
        );
      })
      .sort((left, right) => right[1].size - left[1].size || left[0].localeCompare(right[0]))[0];
    if (!overrepresented) break;

    const [purposeKey, unitNames] = overrepresented;
    const scoreContext = buildRemovalScoreContext(selected, entityByName);
    const unitToRemove = [...unitNames]
      .map((unitName) => ({
        unitName,
        score: Math.max(
          ...selected
            .filter(
              (card) =>
                card.entity.name === unitName &&
                deriveSelectionPurposeGroupKey(card) === purposeKey,
            )
            .map((card) => resolveRemovalScore(card, selected, entityByName, false, scoreContext)),
          Number.NEGATIVE_INFINITY,
        ),
      }))
      .sort(
        (left, right) => left.score - right.score || left.unitName.localeCompare(right.unitName),
      )[0]?.unitName;
    if (!unitToRemove) break;
    selected = selected.filter(
      (card) =>
        card.forcedInPremade ||
        card.entity.name !== unitToRemove ||
        deriveSelectionPurposeGroupKey(card) !== purposeKey,
    );
  }
  return selected;
}

function findLowestPriorityDuplicateUnitCard(
  cards: PremadeCard[],
  entityByName: Map<string, EntityData>,
  scoreContext = buildRemovalScoreContext(cards, entityByName),
): number {
  const counts = new Map<string, number>();
  for (const card of cards) {
    counts.set(card.entity.name, (counts.get(card.entity.name) ?? 0) + 1);
  }
  let removeIndex = -1;
  let removalScore = Number.POSITIVE_INFINITY;
  const transportGroupCounts = { Ground: 0, Air: 0 };
  for (const card of cards) {
    const transport = card.transportName ? entityByName.get(card.transportName) : undefined;
    if (transport) {
      transportGroupCounts[deriveTransportGroup(transport)] += 1;
    }
  }
  for (const [index, card] of cards.entries()) {
    if (card.forcedInPremade || (counts.get(card.entity.name) ?? 0) <= 1) {
      continue;
    }
    const transport = card.transportName ? entityByName.get(card.transportName) : undefined;
    const group = transport ? deriveTransportGroup(transport) : undefined;
    const otherGroup = group === 'Air' ? 'Ground' : 'Air';
    const overrepresentationPenalty = group
      ? Math.max(0, transportGroupCounts[group] - transportGroupCounts[otherGroup]) * 120
      : 0;
    const score =
      resolveRemovalScore(card, cards, entityByName, false, scoreContext) -
      overrepresentationPenalty;
    if (score < removalScore) {
      removeIndex = index;
      removalScore = score;
    }
  }
  return removeIndex;
}

function findLowestPriorityRemovableCard(args: {
  cards: PremadeCard[];
  entityByName: Map<string, EntityData>;
  coverageTargets: ReadonlyMap<string, number>;
  scoreContext?: RemovalScoreContext;
}): number {
  const { cards, entityByName, coverageTargets } = args;
  const scoreContext = args.scoreContext ?? buildRemovalScoreContext(cards, entityByName);
  let removeIndex = -1;
  let removalScore = Number.POSITIVE_INFINITY;
  for (const [index, card] of cards.entries()) {
    if (
      card.forcedInPremade ||
      !canRemoveCardWithoutLosingCoverage(card, coverageTargets, scoreContext)
    ) {
      continue;
    }
    const score = resolveRemovalScore(card, cards, entityByName, true, scoreContext);
    if (score < removalScore) {
      removeIndex = index;
      removalScore = score;
    }
  }
  return removeIndex;
}

function canRemoveCardWithoutLosingCoverage(
  removedCard: PremadeCard,
  coverageTargets: ReadonlyMap<string, number>,
  scoreContext: RemovalScoreContext,
): boolean {
  for (const roleKey of removedCard.roleKeys) {
    const requiredCount = coverageTargets.get(roleKey) ?? 0;
    if (requiredCount === 0) {
      continue;
    }
    const providers = scoreContext.roleProviderCounts.get(roleKey);
    const entityProviderCount = providers?.get(removedCard.entity.name) ?? 0;
    const remainingEntityCount = (providers?.size ?? 0) - (entityProviderCount === 1 ? 1 : 0);
    if (remainingEntityCount < requiredCount) {
      return false;
    }
  }
  return true;
}

// Payload roles are covered by every selected carrier of the ammo, else a
// weak sole role-winner holds a fake coverage monopoly.
function cardProvidesRoleKey(card: PremadeCard, roleKey: string): boolean {
  if (card.roleKeys.includes(roleKey)) {
    return true;
  }
  const payloadToken = resolveAmmoPayloadProfileToken(roleKey);
  return payloadToken !== undefined && (card.profileTokens ?? []).includes(payloadToken);
}

function resolveAmmoPayloadProfileToken(roleKey: string): string | undefined {
  const bareKey = roleKey.replace(/^(?:pair|triple):/, '');
  if (bareKey.startsWith('capability:ammo_family_')) {
    return `ammo:family_${bareKey.slice('capability:ammo_family_'.length)}`;
  }
  if (bareKey.startsWith('capability:ammo_trait_')) {
    return `ammo:trait_${bareKey.slice('capability:ammo_trait_'.length)}`;
  }
  return undefined;
}

function buildRoleCoverageTargets(cards: PremadeCard[], limit: number): Map<string, number> {
  const entitiesByRole = collectEntitiesByRole(cards);
  const rolesByEntity = new Map<string, Set<string>>();
  const priorityByRole = buildRolePriorityMap(cards);
  for (const card of cards) {
    const roles = rolesByEntity.get(card.entity.name) ?? new Set<string>();
    for (const roleKey of card.roleKeys) {
      roles.add(roleKey);
    }
    rolesByEntity.set(card.entity.name, roles);
  }
  const rolesByPriority = [...entitiesByRole.keys()].sort(
    (left, right) =>
      resolveCoverageRolePriority(right, priorityByRole) -
        resolveCoverageRolePriority(left, priorityByRole) || left.localeCompare(right),
  );
  const targets = new Map<string, number>();
  for (let requestedCount = 1; requestedCount <= 3; requestedCount += 1) {
    for (const roleKey of rolesByPriority) {
      const availableCount = entitiesByRole.get(roleKey)?.size ?? 0;
      if (resolveRoleCoverageTarget(roleKey, availableCount) < requestedCount) {
        continue;
      }
      const candidateTargets = new Map(targets).set(roleKey, requestedCount);
      if (resolveCoverageFloor(rolesByEntity, candidateTargets) <= limit) {
        targets.set(roleKey, requestedCount);
      }
    }
  }
  return targets;
}

function collectEntitiesByRole(cards: PremadeCard[]): Map<string, Set<string>> {
  const entitiesByRole = new Map<string, Set<string>>();
  const roleKeys = new Set(cards.flatMap((card) => card.roleKeys.filter(isCoverageRoleKey)));
  for (const roleKey of roleKeys) {
    const entityNames = new Set(
      cards.filter((card) => cardProvidesRoleKey(card, roleKey)).map((card) => card.entity.name),
    );
    entitiesByRole.set(roleKey, entityNames);
  }
  return entitiesByRole;
}

function resolveCoverageFloor(
  rolesByEntity: ReadonlyMap<string, ReadonlySet<string>>,
  coverageTargets: ReadonlyMap<string, number>,
): number {
  const remainingByRole = new Map(coverageTargets);
  const availableEntities = new Set(rolesByEntity.keys());
  let selectedCount = 0;
  while ([...remainingByRole.values()].some((remaining) => remaining > 0)) {
    const nextEntity = [...availableEntities]
      .map((entityName) => {
        const contribution = [...(rolesByEntity.get(entityName) ?? [])].reduce(
          (total, roleKey) => total + ((remainingByRole.get(roleKey) ?? 0) > 0 ? 1 : 0),
          0,
        );
        return { entityName, contribution };
      })
      .sort(
        (left, right) =>
          right.contribution - left.contribution || left.entityName.localeCompare(right.entityName),
      )[0];
    if (!nextEntity || nextEntity.contribution <= 0) {
      break;
    }
    availableEntities.delete(nextEntity.entityName);
    selectedCount += 1;
    for (const roleKey of rolesByEntity.get(nextEntity.entityName) ?? []) {
      const remaining = remainingByRole.get(roleKey) ?? 0;
      if (remaining > 0) {
        remainingByRole.set(roleKey, remaining - 1);
      }
    }
  }
  return selectedCount;
}

function findLowestPriorityCoveredRole(
  coverageTargets: ReadonlyMap<string, number>,
  cards: PremadeCard[],
): string | undefined {
  const priorityByRole = buildRolePriorityMap(cards);
  const entries = [...coverageTargets.entries()];
  const reducibleEntries = entries.some(([, target]) => target > 1)
    ? entries.filter(([, target]) => target > 1)
    : entries;
  return reducibleEntries
    .map(([roleKey]) => roleKey)
    .sort(
      (left, right) =>
        resolveCoverageRolePriority(left, priorityByRole) -
          resolveCoverageRolePriority(right, priorityByRole) || left.localeCompare(right),
    )[0];
}

function resolveCoverageRolePriority(
  roleKey: string,
  priorityByRole: ReadonlyMap<string, number>,
): number {
  return (priorityByRole.get(roleKey) ?? 0) + (isCommandCoverageRoleKey(roleKey) ? 350 : 0);
}

function buildRolePriorityMap(cards: readonly PremadeCard[]): Map<string, number> {
  const priorityByRole = new Map<string, number>();
  for (const card of cards) {
    for (const roleKey of card.roleKeys) {
      priorityByRole.set(roleKey, Math.max(priorityByRole.get(roleKey) ?? 0, card.keepPriority));
    }
  }
  return priorityByRole;
}

export function sortPremadeCards(
  cards: PremadeCard[],
  entityByName: Map<string, EntityData>,
): PremadeCard[] {
  // Cards group by unit type first so that similar units sit next to each
  // other in the UI row, regardless of which selection path picked them.
  return [...cards].sort((left, right) => {
    if (left.forcedInPremade !== right.forcedInPremade) {
      return left.forcedInPremade ? -1 : 1;
    }
    if (left.categoryOrder !== right.categoryOrder) {
      return left.categoryOrder - right.categoryOrder;
    }
    if (left.typeKey !== right.typeKey) {
      return left.typeKey.localeCompare(right.typeKey);
    }
    if (left.entity.cost !== right.entity.cost) {
      return right.entity.cost - left.entity.cost;
    }
    const perspectiveOrder =
      resolveSelectionPerspectiveOrder(left.selectionKind) -
      resolveSelectionPerspectiveOrder(right.selectionKind);
    if (perspectiveOrder !== 0) {
      return perspectiveOrder;
    }
    if (left.entity.name !== right.entity.name) {
      return compareEntityPriority(left.entity, right.entity);
    }
    return (
      resolveTransportRank(left.transportName, entityByName) -
      resolveTransportRank(right.transportName, entityByName)
    );
  });
}

function resolveSelectionPerspectiveOrder(kind: PremadeCard['selectionKind']): number {
  return kind.endsWith('-best')
    ? 0
    : kind.endsWith('-recommended')
      ? 1
      : kind.endsWith('-cheap')
        ? 2
        : 3;
}

function enforceUnitPackLimits(
  cards: PremadeCard[],
  entityByName: Map<string, EntityData>,
): PremadeCard[] {
  const selected = [...cards];
  while (true) {
    const counts = new Map<string, number>();
    for (const card of selected) {
      counts.set(card.entity.name, (counts.get(card.entity.name) ?? 0) + 1);
    }

    let removeIndex = -1;
    let removalScore = Number.POSITIVE_INFINITY;
    for (const [index, card] of selected.entries()) {
      const selectedCount = counts.get(card.entity.name) ?? 0;
      if (selectedCount <= card.maxUnitCardCount) {
        continue;
      }
      const score = resolveRemovalScore(card, selected, entityByName, false);
      if (score < removalScore) {
        removeIndex = index;
        removalScore = score;
      }
    }

    if (removeIndex < 0) {
      break;
    }
    selected.splice(removeIndex, 1);
  }
  return selected;
}

interface SimilarityConsolidation {
  removeIndex: number;
  representativeIndex: number;
  mergedRoleKeys: string[];
}

function pruneSimilarityCards(args: {
  cards: PremadeCard[];
  entityByName: Map<string, EntityData>;
  context: DivisionContext;
  config: DeckGenerationConfig;
}): PremadeCard[] {
  const { cards, context, config } = args;
  const nearDuplicateIndexes = cards.map((candidate, candidateIndex) => {
    const matches = new Set<number>();
    if (candidate.forcedInPremade) {
      return matches;
    }
    for (const [peerIndex, peer] of cards.entries()) {
      if (
        peerIndex !== candidateIndex &&
        !peer.forcedInPremade &&
        peer.entity.name !== candidate.entity.name &&
        areNearDuplicateProfiles(candidate, peer)
      ) {
        matches.add(peerIndex);
      }
    }
    return matches;
  });
  const selected = cards.map((card, originalIndex) => ({ card, originalIndex }));
  while (true) {
    let consolidation: SimilarityConsolidation | undefined;
    for (const [candidateIndex, candidateNode] of selected.entries()) {
      const candidate = candidateNode.card;
      if (candidate.forcedInPremade) {
        continue;
      }
      const nearDuplicates = selected
        .map((node, index) => ({ node, index }))
        .filter(({ node }) =>
          nearDuplicateIndexes[candidateNode.originalIndex]?.has(node.originalIndex),
        )
        .sort((left, right) =>
          comparePremadeCardPriority(left.node.card, right.node.card, context, config),
        );
      const representative = nearDuplicates[0];
      if (
        !representative ||
        comparePremadeCardPriority(candidate, representative.node.card, context, config) < 0
      ) {
        continue;
      }
      const mergedRoleKeys = [
        ...new Set([...representative.node.card.roleKeys, ...candidate.roleKeys]),
      ];
      consolidation = {
        removeIndex: candidateIndex,
        representativeIndex: representative.index,
        mergedRoleKeys,
      };
      break;
    }
    if (!consolidation) {
      return selected.map((node) => node.card);
    }
    const representativeNode = selected[consolidation.representativeIndex];
    if (representativeNode) {
      selected[consolidation.representativeIndex] = {
        ...representativeNode,
        card: {
          ...representativeNode.card,
          roleKeys: consolidation.mergedRoleKeys,
        },
      };
    }
    selected.splice(consolidation.removeIndex, 1);
  }
}

function comparePremadeCardPriority(
  left: PremadeCard,
  right: PremadeCard,
  context: DivisionContext,
  config: DeckGenerationConfig,
): number {
  const qualityCompare = compareNearDuplicateProfileQuality(left, right);
  if (qualityCompare !== 0) {
    return qualityCompare;
  }
  if (left.keepPriority !== right.keepPriority) {
    return right.keepPriority - left.keepPriority;
  }
  if (left.roleScore !== right.roleScore) {
    return right.roleScore - left.roleScore;
  }
  const countryCompare = compareCountryPreference(
    left.entity,
    right.entity,
    context.coalition,
    config,
  );
  if (countryCompare !== 0) {
    return countryCompare;
  }
  return compareEntityPriority(left.entity, right.entity);
}

function dedupeCards(cards: PremadeCard[]): PremadeCard[] {
  const byKey = new Map<string, PremadeCard>();
  for (const card of cards) {
    const key = `${card.entity.name}|${card.transportName ?? ''}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, card);
      continue;
    }
    const preferred =
      card.forcedInPremade !== existing.forcedInPremade
        ? card.forcedInPremade
          ? card
          : existing
        : card.keepPriority > existing.keepPriority ||
            (card.keepPriority === existing.keepPriority && card.roleScore > existing.roleScore)
          ? card
          : existing;
    byKey.set(key, {
      ...preferred,
      roleKeys: [...new Set([...existing.roleKeys, ...card.roleKeys])],
    });
  }
  return [...byKey.values()];
}

function resolveRemovalScore(
  card: PremadeCard,
  selected: PremadeCard[],
  entityByName: Map<string, EntityData>,
  includePurposeDiversity = true,
  scoreContext = buildRemovalScoreContext(selected, entityByName),
): number {
  const similarityCount = scoreContext.similarityCounts.get(card.similarityKey) ?? 0;
  const sameUnitGroundVariantExists =
    Boolean(card.transportName) &&
    [...(scoreContext.groundTransportCountsByEntity.get(card.entity.name)?.keys() ?? [])].some(
      (transportName) => transportName !== card.transportName,
    );
  const isAirTransport =
    Boolean(card.transportName) &&
    (() => {
      const transportEntity = entityByName.get(card.transportName ?? '');
      return transportEntity ? deriveTransportGroup(transportEntity) === 'Air' : false;
    })();
  const hasSameUnitVariant = (scoreContext.entityCounts.get(card.entity.name) ?? 0) > 1;
  // Same-unit variants only: a cross-unit sellable bonus would shield every
  // transported card against vehicles in mixed categories.
  const transportIsSellable =
    hasSameUnitVariant &&
    Boolean(card.transportName) &&
    entityByName.get(card.transportName ?? '')?.isSellable === true;
  const roleCoverageProtection = card.roleKeys.reduce((total, roleKey) => {
    const coverageCount = scoreContext.roleProviderCounts.get(roleKey)?.size ?? 0;
    const coverageTarget = resolveRoleCoverageTarget(roleKey, coverageCount);
    if (coverageTarget > 1 && coverageCount <= coverageTarget) {
      return total + (coverageTarget + 1 - coverageCount) * 2_500;
    }
    if (roleKey.startsWith('capability:') && coverageCount === 1) {
      return total + 2_000;
    }
    if (roleKey.startsWith('trait:') && coverageCount === 1) {
      return total + 800;
    }
    return total;
  }, 0);
  const purposeDiversityProtection = includePurposeDiversity
    ? resolvePurposeDiversityProtection(card, selected)
    : 0;

  return (
    card.keepPriority +
    card.roleScore * 0.04 -
    similarityCount * 420 -
    (card.selectionKind === 'filler' ? 700 : 0) -
    (sameUnitGroundVariantExists && isAirTransport ? 1_500 : 0) +
    (transportIsSellable ? 4_000 : 0) +
    roleCoverageProtection +
    purposeDiversityProtection
  );
}

interface RemovalScoreContext {
  similarityCounts: Map<string, number>;
  entityCounts: Map<string, number>;
  groundTransportCountsByEntity: Map<string, Map<string, number>>;
  roleProviderCounts: Map<string, Map<string, number>>;
}

function buildRemovalScoreContext(
  cards: PremadeCard[],
  entityByName: ReadonlyMap<string, EntityData>,
): RemovalScoreContext {
  const similarityCounts = new Map<string, number>();
  const entityCounts = new Map<string, number>();
  const groundTransportCountsByEntity = new Map<string, Map<string, number>>();
  const roleKeys = new Set<string>();
  for (const card of cards) {
    similarityCounts.set(card.similarityKey, (similarityCounts.get(card.similarityKey) ?? 0) + 1);
    entityCounts.set(card.entity.name, (entityCounts.get(card.entity.name) ?? 0) + 1);
    for (const roleKey of card.roleKeys) roleKeys.add(roleKey);
    const transport = card.transportName ? entityByName.get(card.transportName) : undefined;
    if (card.transportName && transport && deriveTransportGroup(transport) === 'Ground') {
      const transports = groundTransportCountsByEntity.get(card.entity.name) ?? new Map();
      transports.set(card.transportName, (transports.get(card.transportName) ?? 0) + 1);
      groundTransportCountsByEntity.set(card.entity.name, transports);
    }
  }
  const roleProviderCounts = new Map<string, Map<string, number>>();
  for (const roleKey of roleKeys) {
    const providers = new Map<string, number>();
    for (const card of cards) {
      if (cardProvidesRoleKey(card, roleKey)) {
        providers.set(card.entity.name, (providers.get(card.entity.name) ?? 0) + 1);
      }
    }
    roleProviderCounts.set(roleKey, providers);
  }
  return { similarityCounts, entityCounts, groundTransportCountsByEntity, roleProviderCounts };
}

function removeCardFromScoreContext(
  context: RemovalScoreContext,
  card: PremadeCard,
  entityByName: ReadonlyMap<string, EntityData>,
): void {
  decrementCount(context.similarityCounts, card.similarityKey);
  decrementCount(context.entityCounts, card.entity.name);
  const transport = card.transportName ? entityByName.get(card.transportName) : undefined;
  if (card.transportName && transport && deriveTransportGroup(transport) === 'Ground') {
    const transports = context.groundTransportCountsByEntity.get(card.entity.name);
    if (transports) {
      decrementCount(transports, card.transportName);
      if (transports.size === 0) context.groundTransportCountsByEntity.delete(card.entity.name);
    }
  }
  for (const [roleKey, providers] of context.roleProviderCounts) {
    if (cardProvidesRoleKey(card, roleKey)) {
      decrementCount(providers, card.entity.name);
    }
  }
}

function decrementCount(map: Map<string, number>, key: string): void {
  const next = (map.get(key) ?? 0) - 1;
  if (next > 0) map.set(key, next);
  else map.delete(key);
}

const purposeDiversityCache = new WeakMap<PremadeCard[], ReadonlyMap<PremadeCard, number>>();

function resolvePurposeDiversityProtection(card: PremadeCard, selected: PremadeCard[]): number {
  let protections = purposeDiversityCache.get(selected);
  if (!protections) {
    protections = buildPurposeDiversityProtections(selected);
    purposeDiversityCache.set(selected, protections);
  }
  return protections.get(card) ?? 0;
}

function buildPurposeDiversityProtections(cards: PremadeCard[]): ReadonlyMap<PremadeCard, number> {
  const groups = Map.groupBy(cards, deriveSelectionPurposeGroupKey);
  const protections = new Map<PremadeCard, number>();
  for (const groupCards of groups.values()) {
    for (const card of groupCards) {
      if (card.similarityVector.length === 0) continue;
      let nearestDistance = Number.POSITIVE_INFINITY;
      for (const peer of groupCards) {
        if (
          peer.entity.name === card.entity.name ||
          peer.similarityVector.length !== card.similarityVector.length
        ) {
          continue;
        }
        const meanSquareDifference =
          card.similarityVector.reduce((total, value, index) => {
            const difference = value - (peer.similarityVector[index] ?? 0);
            return total + difference * difference;
          }, 0) / card.similarityVector.length;
        nearestDistance = Math.min(nearestDistance, Math.sqrt(meanSquareDifference));
      }
      if (Number.isFinite(nearestDistance)) {
        // Nearest-neighbour distance rewards a genuinely different envelope
        // but cannot overpower main-role and forced-card ordering by itself.
        protections.set(card, Math.min(1_500, nearestDistance * 6));
      }
    }
  }
  return protections;
}

function isMainRoleKey(roleKey: string): boolean {
  return roleKey.startsWith('main:');
}

function isSecondaryRoleKey(roleKey: string): boolean {
  return (
    roleKey.startsWith('pair:') ||
    roleKey.startsWith('triple:') ||
    roleKey.startsWith('primary:') ||
    roleKey.startsWith('type:') ||
    roleKey.startsWith('role:') ||
    roleKey.startsWith('trait:') ||
    roleKey.startsWith('capability:')
  );
}

function isCoverageRoleKey(roleKey: string): boolean {
  return isMainRoleKey(roleKey) || isSecondaryRoleKey(roleKey);
}

function resolveRoleCoverageTarget(roleKey: string, availableEntityCount: number): number {
  const requestedCount = isCommandCoverageRoleKey(roleKey)
    ? 2
    : isMainRoleKey(roleKey) || roleKey.startsWith('triple:')
      ? 3
      : roleKey.startsWith('pair:')
        ? 2
        : 1;
  return Math.min(requestedCount, availableEntityCount);
}

function isCommandCoverageRoleKey(roleKey: string): boolean {
  return roleKey.includes('command');
}
