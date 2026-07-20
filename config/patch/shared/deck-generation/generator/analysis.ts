import {
  deriveMobilityKey,
  derivePlatformForm,
  derivePremadeTypeKey,
  isCommandEntity,
  type PlatformForm,
  sanitizeIdentifier,
} from './helpers.ts';
import type {
  AmmunitionData,
  EntityData,
  GeneratedRuleEntry,
  WeaponDescriptorData,
} from './types.ts';

type MetricKey =
  | 'alphaArmor'
  | 'alphaGround'
  | 'alphaHelo'
  | 'alphaPlane'
  | 'antiArmor'
  | 'antiGround'
  | 'antiHelo'
  | 'antiPlane'
  | 'ammo'
  | 'amphibious'
  | 'armorPenetration'
  | 'availability'
  | 'burstDps'
  | 'closeCombat'
  | 'command'
  | 'directFire'
  | 'effect'
  | 'fireOnMove'
  | 'indirect'
  | 'initiative'
  | 'mobility'
  | 'optics'
  | 'oneShotArmor'
  | 'oneShotGround'
  | 'oneShotHelo'
  | 'oneShotPlane'
  | 'precision'
  | 'rangeArmor'
  | 'rangeGround'
  | 'rangeHelo'
  | 'rangePlane'
  | 'response'
  | 'splash'
  | 'stealth'
  | 'supply'
  | 'suppression'
  | 'sustainedDps'
  | 'survivability'
  | 'value'
  | 'weaponVariety';

const METRIC_KEYS: MetricKey[] = [
  'alphaArmor',
  'alphaGround',
  'alphaHelo',
  'alphaPlane',
  'antiArmor',
  'antiGround',
  'antiHelo',
  'antiPlane',
  'ammo',
  'amphibious',
  'armorPenetration',
  'availability',
  'burstDps',
  'closeCombat',
  'command',
  'directFire',
  'effect',
  'fireOnMove',
  'indirect',
  'initiative',
  'mobility',
  'optics',
  'oneShotArmor',
  'oneShotGround',
  'oneShotHelo',
  'oneShotPlane',
  'precision',
  'rangeArmor',
  'rangeGround',
  'rangeHelo',
  'rangePlane',
  'response',
  'splash',
  'stealth',
  'supply',
  'suppression',
  'sustainedDps',
  'survivability',
  'value',
  'weaponVariety',
];

// Keep this order stable: premade cards persist these values without their keys.
// Platform metrics describe the chassis rather than the unit's tactical payload.
const SIMILARITY_METRIC_KEYS: MetricKey[] = [
  'antiArmor',
  'antiGround',
  'antiHelo',
  'antiPlane',
  'armorPenetration',
  'closeCombat',
  'directFire',
  'fireOnMove',
  'indirect',
  'initiative',
  'mobility',
  'optics',
  'precision',
  'rangeArmor',
  'rangeGround',
  'rangeHelo',
  'rangePlane',
  'splash',
  'stealth',
  'supply',
  'suppression',
  'survivability',
  'availability',
  'ammo',
  'weaponVariety',
  'alphaArmor',
  'alphaGround',
  'alphaHelo',
  'alphaPlane',
  'burstDps',
  'response',
  'sustainedDps',
  'effect',
  'oneShotArmor',
  'oneShotGround',
  'oneShotHelo',
  'oneShotPlane',
];

const PLATFORM_SIMILARITY_METRICS = new Set<MetricKey>([
  'initiative',
  'mobility',
  'survivability',
  'availability',
]);

const TACTICAL_DOMINANCE_METRICS: MetricKey[] = [
  'alphaArmor',
  'alphaGround',
  'alphaHelo',
  'alphaPlane',
  'antiArmor',
  'antiGround',
  'antiHelo',
  'antiPlane',
  'ammo',
  'armorPenetration',
  'burstDps',
  'closeCombat',
  'directFire',
  'effect',
  'fireOnMove',
  'indirect',
  'initiative',
  'mobility',
  'oneShotArmor',
  'oneShotGround',
  'oneShotHelo',
  'oneShotPlane',
  'optics',
  'precision',
  'rangeArmor',
  'rangeGround',
  'rangeHelo',
  'rangePlane',
  'response',
  'splash',
  'stealth',
  'suppression',
  'sustainedDps',
  'survivability',
];

const WEAPON_PROFILE_TOKEN_PREFIXES = [
  'ammo:',
  'ammo_loadout:',
  'channel:',
  'effect:',
  'effect_range:',
  'loadout:',
  'mechanic:',
  'range_band:',
  'range_class:',
];

export interface EntityAnalysis {
  entry: GeneratedRuleEntry;
  entity: EntityData;
  typeKey: string;
  similarityKey: string;
  similarityVector: number[];
  roleTokens: string[];
  exactRoleTokens: Set<string>;
  profileTokens: string[];
  metrics: Record<MetricKey, number>;
  relativeMetrics: Record<MetricKey, number>;
}

interface CategoryAnalysisStats {
  averageCost: number;
}

export interface RoleDefinition {
  key: string;
  kind: 'primary' | 'type' | 'role' | 'trait' | 'capability';
  optionCount: 1 | 2 | 3 | 4 | 5;
  priority: number;
  focus: Partial<Record<MetricKey, number>>;
}

interface SelectionPurposeProfile {
  entity: EntityData;
  typeKey: string;
  profileTokens?: readonly string[];
}

const selectionPurposeGroupKeyCache = new WeakMap<SelectionPurposeProfile, string>();
const matchingRoleMechanicsCache = new WeakMap<SelectionPurposeProfile, string[]>();

export function deriveSelectionPurposeGroupKey(profile: SelectionPurposeProfile): string {
  const cached = selectionPurposeGroupKeyCache.get(profile);
  if (cached !== undefined) {
    return cached;
  }
  const semanticRole = normalizeRoleToken(
    profile.entity.unitRole ?? profile.entity.strategicType ?? profile.typeKey,
  );
  const tokens = profile.profileTokens ?? [];
  const matchingRoleMechanics = collectMatchingRoleMechanics(profile);
  const tacticalProfile = (
    matchingRoleMechanics.length > 0
      ? matchingRoleMechanics
      : tokens.filter(
          (token) =>
            token.startsWith('channel:') ||
            token.startsWith('ammo:projectile_') ||
            token.startsWith('ammo:trait_'),
        )
  )
    .sort()
    .join('|');
  // An enemy-affecting aura (jammer, SIGINT) makes a combo platform a
  // different job from its aura-less twins, so it must not consume their cap.
  const enemyAura = tokens.some((token) => token.includes('ennemi')) ? '|enemy_aura' : '';
  const key =
    [
      profile.entity.factoryType ?? 'Unknown',
      semanticRole,
      derivePlatformForm(profile.entity),
      tacticalProfile || 'unarmed',
    ].join('|') + enemyAura;
  selectionPurposeGroupKeyCache.set(profile, key);
  return key;
}

export function resolveSelectionPurposeGroupLimit(profile: SelectionPurposeProfile): number {
  // A named weapon mechanic is one exact job and follows the three-option
  // contract. Broader roles can contain additional non-dominated payload,
  // range, mobility, or stealth specialists without becoming duplicates.
  return collectMatchingRoleMechanics(profile).length > 0 ? 3 : 5;
}

function collectMatchingRoleMechanics(profile: SelectionPurposeProfile): string[] {
  const cached = matchingRoleMechanicsCache.get(profile);
  if (cached !== undefined) {
    return cached;
  }
  const semanticRole = normalizeRoleToken(
    profile.entity.unitRole ?? profile.entity.strategicType ?? profile.typeKey,
  );
  const mechanics = (profile.profileTokens ?? [])
    .filter((token) => token.startsWith('mechanic:trait_'))
    .filter((token) => {
      const mechanic = normalizeRoleToken(token.slice('mechanic:trait_'.length));
      return (
        mechanic === semanticRole ||
        mechanic.includes(semanticRole) ||
        semanticRole.includes(mechanic)
      );
    })
    .sort();
  matchingRoleMechanicsCache.set(profile, mechanics);
  return mechanics;
}

export function buildCategoryAnalyses(args: {
  entries: GeneratedRuleEntry[];
  weaponDescriptors: Map<string, WeaponDescriptorData>;
  ammunition: Map<string, AmmunitionData>;
}): {
  analyses: EntityAnalysis[];
  roleDefinitions: RoleDefinition[];
  stats: CategoryAnalysisStats;
} {
  const analyses = args.entries.map((entry) =>
    analyzeEntry(entry, args.weaponDescriptors, args.ammunition),
  );
  const stats = buildCategoryAnalysisStats(analyses);
  for (const analysis of analyses) {
    analysis.metrics.value =
      analysis.entity.cost > 0
        ? (analysis.metrics.antiArmor +
            analysis.metrics.antiGround +
            analysis.metrics.antiHelo +
            analysis.metrics.antiPlane +
            analysis.metrics.indirect +
            analysis.metrics.optics +
            analysis.metrics.precision +
            analysis.metrics.supply +
            analysis.metrics.command +
            analysis.metrics.survivability +
            analysis.metrics.suppression * 0.2 +
            analysis.metrics.mobility * 0.1 +
            analysis.metrics.fireOnMove * 0.18 +
            analysis.metrics.initiative * 0.12 +
            analysis.metrics.weaponVariety * 0.35) /
          analysis.entity.cost
        : analysis.metrics.antiArmor +
          analysis.metrics.antiGround +
          analysis.metrics.antiHelo +
          analysis.metrics.antiPlane +
          analysis.metrics.indirect +
          analysis.metrics.optics +
          analysis.metrics.precision +
          analysis.metrics.supply +
          analysis.metrics.command +
          analysis.metrics.survivability +
          analysis.metrics.suppression * 0.2 +
          analysis.metrics.mobility * 0.1 +
          analysis.metrics.fireOnMove * 0.18 +
          analysis.metrics.initiative * 0.12 +
          analysis.metrics.weaponVariety * 0.35;
  }
  applyCapabilityTokens(analyses);
  applyPlatformVariantTokens(analyses);
  applyRelativeMetrics(analyses);
  const similarityMaximums = new Map<MetricKey, number>(
    SIMILARITY_METRIC_KEYS.map((metric) => [
      metric,
      Math.max(...analyses.map((analysis) => analysis.metrics[metric]), 0),
    ]),
  );
  for (const analysis of analyses) {
    analysis.similarityVector = buildSimilarityVector(analysis, similarityMaximums);
  }
  return {
    analyses,
    roleDefinitions: discoverRoleDefinitions(analyses),
    stats,
  };
}

export function scoreAnalysisForRole(
  analysis: EntityAnalysis,
  role: RoleDefinition,
  perspective?: 'recommended' | 'best' | 'cheap',
): { fitScore: number; exactMatch: boolean } {
  const fitScore = Object.entries(role.focus).reduce((total, [metricKey, weight]) => {
    if (metricKey === 'value') {
      if (perspective === 'best') {
        return total;
      }
      const economyWeight =
        perspective === 'recommended' ? 0.25 : perspective === 'cheap' ? 0.5 : 1;
      return (
        total +
        (analysis.relativeMetrics[metricKey as MetricKey] ?? 0) * (weight ?? 0) * economyWeight
      );
    }
    return total + (analysis.relativeMetrics[metricKey as MetricKey] ?? 0) * (weight ?? 0);
  }, 0);
  const roleInteractionScore = deriveRoleInteractionScore(analysis, role.focus);
  const exactMatch = analysis.exactRoleTokens.has(role.key);
  return {
    fitScore: fitScore + roleInteractionScore + (exactMatch ? 600 : 0),
    exactMatch,
  };
}

function deriveRoleInteractionScore(
  analysis: EntityAnalysis,
  focus: Partial<Record<MetricKey, number>>,
): number {
  const fragility = 1 - Math.min(1, analysis.relativeMetrics.survivability / 1_000);
  let score = 0;
  if ((focus.antiArmor ?? 0) >= 1.5 && (focus.rangeArmor ?? 0) >= 0.5) {
    score +=
      analysis.relativeMetrics.rangeArmor *
      Math.min(1.5, focus.rangeArmor ?? 0) *
      (0.35 + fragility * 0.65) *
      0.75;
  }
  if ((focus.antiPlane ?? 0) >= 1.5 && (focus.rangePlane ?? 0) >= 0.5) {
    score +=
      analysis.relativeMetrics.rangePlane *
      Math.min(1.5, focus.rangePlane ?? 0) *
      (0.35 + fragility * 0.65) *
      0.65;
  }
  if ((focus.antiHelo ?? 0) >= 1.5 && (focus.rangeHelo ?? 0) >= 0.5) {
    score +=
      analysis.relativeMetrics.rangeHelo *
      Math.min(1.25, focus.rangeHelo ?? 0) *
      (0.4 + fragility * 0.6) *
      0.5;
  }
  return score;
}

export function scoreAnalysisForPerspective(args: {
  analysis: EntityAnalysis;
  role: RoleDefinition;
  stats: CategoryAnalysisStats;
  perspective: 'recommended' | 'best' | 'cheap';
}): number {
  const { analysis, role, stats, perspective } = args;
  const effectivePerspective = isPriceSensitiveMainRole(role) ? perspective : 'best';
  const { fitScore, exactMatch } = scoreAnalysisForRole(analysis, role, effectivePerspective);
  const costPenalty = stats.averageCost > 0 ? analysis.entity.cost / stats.averageCost : 1;
  const roleStrength = Math.max(0, fitScore - (exactMatch ? 600 : 0));
  const roleEfficiency = roleStrength / Math.max(0.25, costPenalty);
  const mobilityKind = deriveMobilityKey(analysis.entity);
  const deliveryReliabilityWeight =
    mobilityKind === 'Plane' ? 0.75 : mobilityKind === 'Helicopter' ? 0.3 : 0;
  const belowAverageBonus =
    analysis.entity.cost <= stats.averageCost ? 150 : Math.max(0, 150 - (costPenalty - 1) * 150);
  const capabilityFitMultiplier = role.kind === 'capability' ? 1.18 : 1;
  const recommendedEfficiencyWeight = role.kind === 'capability' ? 0.16 : 0.2;
  const cheapEfficiencyWeight = role.kind === 'capability' ? 0.55 : 0.72;
  const recommendedCostPenalty = role.kind === 'capability' ? 45 : 65;

  if (effectivePerspective === 'best') {
    return (
      fitScore * capabilityFitMultiplier +
      analysis.relativeMetrics.survivability * 0.38 +
      analysis.relativeMetrics.ammo * 0.12 +
      analysis.relativeMetrics.fireOnMove * 0.12 +
      analysis.relativeMetrics.initiative * 0.12 +
      analysis.relativeMetrics.survivability * deliveryReliabilityWeight
    );
  }

  if (effectivePerspective === 'cheap') {
    const aboveAveragePenalty =
      analysis.entity.cost > stats.averageCost ? Math.max(0, costPenalty - 1) * 600 : 0;
    return (
      fitScore * (role.kind === 'capability' ? 0.9 : 0.7) +
      roleEfficiency * cheapEfficiencyWeight +
      analysis.relativeMetrics.survivability * deliveryReliabilityWeight * 0.75 +
      belowAverageBonus * (role.kind === 'capability' ? 0.7 : 1) -
      aboveAveragePenalty +
      (exactMatch ? (role.kind === 'capability' ? 180 : 250) : 0)
    );
  }

  return (
    fitScore * capabilityFitMultiplier +
    roleEfficiency * recommendedEfficiencyWeight +
    analysis.relativeMetrics.survivability * 0.2 +
    analysis.relativeMetrics.fireOnMove * 0.08 +
    analysis.relativeMetrics.initiative * 0.08 +
    analysis.relativeMetrics.survivability * deliveryReliabilityWeight * 0.9 +
    belowAverageBonus * (role.kind === 'capability' ? 0.7 : 1) +
    analysis.relativeMetrics.ammo * 0.15 +
    analysis.relativeMetrics.availability * 0.18 -
    costPenalty * recommendedCostPenalty
  );
}

function isPriceSensitiveMainRole(role: RoleDefinition): boolean {
  return (role.kind === 'primary' || role.kind === 'type') && role.optionCount === 3;
}

export function scoreAnalysisAsFiller(analysis: EntityAnalysis): number {
  const standoutMetrics = [
    analysis.relativeMetrics.antiArmor,
    analysis.relativeMetrics.antiGround,
    analysis.relativeMetrics.antiPlane,
    analysis.relativeMetrics.antiHelo,
    analysis.relativeMetrics.indirect,
    analysis.relativeMetrics.precision,
    analysis.relativeMetrics.optics,
    analysis.relativeMetrics.supply,
    analysis.relativeMetrics.survivability,
    analysis.relativeMetrics.stealth,
    analysis.relativeMetrics.weaponVariety,
  ].sort((left, right) => right - left);
  const standoutPrimary = standoutMetrics[0] ?? 0;
  const standoutSecondary = standoutMetrics[1] ?? 0;
  return (
    standoutPrimary * 1.05 +
    standoutSecondary * 0.55 +
    analysis.relativeMetrics.rangeGround * 0.4 +
    Math.max(analysis.relativeMetrics.rangeHelo, analysis.relativeMetrics.rangePlane) * 0.35 +
    analysis.relativeMetrics.weaponVariety * 0.22 +
    analysis.relativeMetrics.amphibious * 0.2 +
    analysis.relativeMetrics.fireOnMove * 0.18 +
    analysis.relativeMetrics.initiative * 0.2 +
    analysis.relativeMetrics.availability * 0.2
  );
}

export function scoreTransportAnalysis(analysis: EntityAnalysis): number {
  const isAir = deriveTransportGroup(analysis.entity) === 'Air';
  return (
    analysis.metrics.mobility * 1.6 +
    analysis.metrics.stealth * 0.7 +
    analysis.metrics.survivability * 0.45 +
    analysis.metrics.amphibious * 0.9 +
    (analysis.metrics.antiGround + analysis.metrics.antiArmor) * 0.12 -
    (isAir ? 90 : 0)
  );
}

export function deriveTransportGroup(entity: EntityData): 'Ground' | 'Air' {
  const mobilityKey = deriveMobilityKey(entity);
  return mobilityKey === 'Helicopter' || mobilityKey === 'Plane' ? 'Air' : 'Ground';
}

function analyzeEntry(
  entry: GeneratedRuleEntry,
  weaponDescriptors: Map<string, WeaponDescriptorData>,
  ammunition: Map<string, AmmunitionData>,
): EntityAnalysis {
  const entity = entry.entity;
  const typeKey = derivePremadeTypeKey(entity);
  const weaponStats = collectWeaponStats(entity, weaponDescriptors, ammunition);
  const agility =
    (entity.agilityRadiusGru ?? 0) > 0 ? 100_000 / Math.max(1, entity.agilityRadiusGru ?? 1) : 0;
  const responseTime =
    Math.max(0, 30 - Math.max(0, entity.travelDuration ?? 30)) * 32 +
    Math.max(0, 25 - Math.max(0, entity.evacuationTime ?? 25)) * 20;
  // UnitAttackValue/UnitDefenseValue are showroom menu bars with no gameplay
  // effect; mixing them in here inverted real chassis comparisons.
  const survivability =
    Math.max(0, entity.maxPhysicalDamages ?? 0) ** 1.18 * 75 +
    (Math.max(0, entity.frontArmor ?? 0) ** 1.3 * 72 +
      Math.max(0, entity.sideArmor ?? 0) ** 1.22 * 52 +
      Math.max(0, entity.rearArmor ?? 0) ** 1.16 * 30 +
      Math.max(0, entity.topArmor ?? 0) ** 1.2 * 40) +
    Math.abs(entity.hitRollEcm ?? 0) * 1_250 +
    agility * 1.5;
  const mobilityBase = entity.maxSpeedKmph ?? 0;
  const mobilityRoadBonus = entity.speedBonusFactorOnRoad ?? 1;
  const endurance = (entity.fuelCapacity ?? 0) * 0.18 + (entity.fuelMoveDuration ?? 0) * 0.42;
  const amphibious = isAmphibiousEntity(entity) ? 180 : 0;
  const stealth = (entity.concealmentBonus ?? 0) * 180;
  const optics =
    (entity.opticalStrength ?? 0) / 12 +
    (entity.visionRange ?? 0) * 0.045 +
    (entity.identifyBaseProbability ?? 0) * 480;
  const supply = entity.hasSupplyModule
    ? (entity.supplyCapacity ?? 0) +
      (entity.supplyPriority !== undefined ? Math.max(0, 10 - entity.supplyPriority) * 120 : 0) +
      400
    : 0;
  const command = isCommandEntity(entity) ? 1600 + (entity.canAssist === true ? 240 : 0) : 0;
  const mobility =
    mobilityBase * 20 +
    mobilityBase * mobilityRoadBonus * 4 +
    endurance +
    agility * 1.2 +
    amphibious +
    (deriveMobilityKey(entity) === 'Helicopter' ? 220 : 0);
  const initiative =
    (entity.deploymentShiftGru ?? 0) * 1.2 +
    mobilityBase * 12 +
    optics * 0.18 +
    weaponStats.fireOnMove * 0.12 -
    (entity.weaponDeploymentTime ?? 0) * 90 +
    responseTime +
    agility * 2;
  const availability =
    Math.max(0, entry.rule.maxPackNumber) *
    Math.max(0, entry.rule.numberOfUnitInPack) *
    Math.max(0.1, Math.max(...entry.rule.multipliers, 1));
  const metrics: Record<MetricKey, number> = {
    alphaArmor: weaponStats.alphaArmor,
    alphaGround: weaponStats.alphaGround,
    alphaHelo: weaponStats.alphaHelo,
    alphaPlane: weaponStats.alphaPlane,
    antiArmor: weaponStats.antiArmor,
    antiGround: weaponStats.antiGround,
    antiHelo: weaponStats.antiHelo,
    antiPlane: weaponStats.antiPlane,
    ammo: weaponStats.ammo,
    amphibious,
    armorPenetration: weaponStats.armorPenetration,
    availability,
    burstDps: weaponStats.burstDps,
    closeCombat: weaponStats.closeCombat,
    command,
    directFire: weaponStats.directFire,
    effect: Math.max(0, entity.effectUtility) * 240,
    fireOnMove: weaponStats.fireOnMove,
    indirect: weaponStats.indirect,
    initiative,
    mobility,
    optics,
    oneShotArmor: weaponStats.oneShotArmor,
    oneShotGround: weaponStats.oneShotGround,
    oneShotHelo: weaponStats.oneShotHelo,
    oneShotPlane: weaponStats.oneShotPlane,
    precision: weaponStats.precision,
    rangeArmor: weaponStats.rangeArmor,
    rangeGround: weaponStats.rangeGround,
    rangeHelo: weaponStats.rangeHelo,
    rangePlane: weaponStats.rangePlane,
    response: weaponStats.response,
    splash: weaponStats.splash,
    stealth,
    supply,
    suppression: weaponStats.suppression,
    sustainedDps: weaponStats.sustainedDps,
    survivability,
    value: 0,
    weaponVariety: weaponStats.weaponVariety,
  };
  const roleTokens = deriveBaseRoleTokens(entity, typeKey);
  const profileTokens = [
    ...new Set([
      ...collectWeaponProfileTokens(entity, weaponDescriptors, ammunition, weaponStats),
      ...collectSemanticSpecialtyProfileTokens(entity),
      ...entity.positiveEffectTokens,
    ]),
  ].sort();

  return {
    entry,
    entity,
    typeKey,
    similarityKey: buildSimilarityKey(entity, metrics),
    similarityVector: [],
    roleTokens,
    exactRoleTokens: new Set(roleTokens),
    profileTokens,
    metrics,
    relativeMetrics: { ...metrics },
  };
}

function collectSemanticSpecialtyProfileTokens(entity: EntityData): string[] {
  const negativeCapacityLabels = entity.negativeCapacityNames.map(normalizeCapacityLabel);
  return entity.specialties
    .map(normalizeRoleToken)
    .filter(
      (specialty) =>
        specialty.length > 0 &&
        Object.keys(inferRoleFocus(`trait:${specialty}`, false)).length > 0 &&
        !negativeCapacityLabels.some(
          (negative) => negative.includes(specialty) || specialty.includes(negative),
        ),
    )
    .map((specialty) => `effect:trait_${specialty}`);
}

interface SimilarityProfile {
  entity: EntityData;
  entry?: Pick<GeneratedRuleEntry, 'transportNames'>;
  transportName?: string;
  typeKey: string;
  similarityKey: string;
  similarityVector: number[];
  profileTokens?: readonly string[];
}

interface CachedProfileTokens {
  source: readonly string[];
  effectTokens: ReadonlySet<string>;
  tokenSet: ReadonlySet<string>;
  ammunitionPayload: ReadonlySet<string>;
  fullAmmunitionPayload: ReadonlySet<string>;
  ammunitionReserves: ReadonlyMap<string, number>;
  weaponPurposeTokens: readonly string[];
}

const EMPTY_PROFILE_TOKENS: readonly string[] = [];
const profileTokenCache = new WeakMap<SimilarityProfile, CachedProfileTokens>();
const duplicatePurposeKeyCache = new WeakMap<EntityData, string>();
const normalizedRoleTokenCache = new Map<string, string>();

export function areNearDuplicateProfiles(
  left: SimilarityProfile,
  right: SimilarityProfile,
): boolean {
  if (left.entity.name === right.entity.name) {
    return true;
  }
  if (
    left.entity.kind !== right.entity.kind ||
    left.entity.factoryType !== right.entity.factoryType ||
    deriveDuplicatePurposeKey(left.entity) !== deriveDuplicatePurposeKey(right.entity)
  ) {
    return false;
  }
  if (haveMaterialDeploymentFormDifference(left, right)) {
    return false;
  }
  if (haveDifferentAmmunitionLoadouts(left, right)) {
    return false;
  }
  if (
    left.similarityVector.length === 0 ||
    left.similarityVector.length !== right.similarityVector.length
  ) {
    return false;
  }

  const differences = left.similarityVector
    .map((value, index) => Math.abs(value - (right.similarityVector[index] ?? 0)))
    .sort((first, second) => first - second);
  const leftWeaponProfile = getCachedProfileTokens(left).weaponPurposeTokens;
  const rightWeaponProfile = getCachedProfileTokens(right).weaponPurposeTokens;
  if (
    isCommandEntity(left.entity) &&
    isCommandEntity(right.entity) &&
    haveMaterialDeploymentDifference(left.entity, right.entity)
  ) {
    return false;
  }
  if (
    isCommandEntity(left.entity) &&
    isCommandEntity(right.entity) &&
    tokenSetSimilarity(leftWeaponProfile, rightWeaponProfile) >= 0.35 &&
    !haveMaterialDeploymentDifference(left.entity, right.entity)
  ) {
    // Command vehicles fill the same deck function. A slightly different roof
    // gun or chassis speed does not justify another card; only a genuinely
    // different deployment envelope does. Quality selection below retains the
    // strongest combat-capable and survivable representative.
    return true;
  }
  if (
    (doesTacticalProfileDominate(left, right) || doesTacticalProfileDominate(right, left)) &&
    tokenSetSimilarity(leftWeaponProfile, rightWeaponProfile) >= 0.45
  ) {
    // Checked before the tradeoff escapes below: extra reserves, a longer
    // envelope, or a rare specialization must not rescue a one-sided downgrade.
    return true;
  }
  if (haveMaterialAmmunitionReserveDifference(left, right)) {
    return false;
  }
  if (haveMaterialEngagementEnvelopeDifference(left, right)) {
    return false;
  }
  if (haveMaterialSpecializationDifference(left, right)) {
    return false;
  }
  if (!haveCompatibleProfileTokens(left.profileTokens ?? [], right.profileTokens ?? [])) {
    return false;
  }
  if (
    leftWeaponProfile.length > 0 &&
    haveEqualTokens(leftWeaponProfile, rightWeaponProfile) &&
    !haveMaterialPlatformTradeoff(left.entity, right.entity) &&
    areStatisticallyEquivalent(
      left.similarityVector
        .map((value, index) => ({
          difference: Math.abs(value - (right.similarityVector[index] ?? 0)),
          metric: SIMILARITY_METRIC_KEYS[index],
        }))
        .filter(({ metric }) => metric && !PLATFORM_SIMILARITY_METRICS.has(metric))
        .map(({ difference }) => difference),
      12,
      30,
      75,
    )
  ) {
    // A different chassis must not make an old/new vehicle pair look like two
    // tactical choices when its weapons, ranges, optics, and effects are the same.
    return true;
  }
  const averageDifference =
    differences.reduce((total, difference) => total + difference, 0) / differences.length;
  const upperQuartileDifference =
    differences[Math.min(differences.length - 1, Math.floor(differences.length * 0.75))] ?? 0;
  const maximumDifference = differences[differences.length - 1] ?? 0;
  // Price never creates a tactical purpose: statistically equivalent profiles
  // remain duplicates even when different countries assigned different costs.
  if (averageDifference <= 12 && upperQuartileDifference <= 30 && maximumDifference <= 75) {
    return true;
  }
  return averageDifference <= 55 && upperQuartileDifference <= 90 && maximumDifference <= 125;
}

export function compareNearDuplicateProfileQuality(
  left: SimilarityProfile,
  right: SimilarityProfile,
): number {
  if (isCommandEntity(left.entity) && isCommandEntity(right.entity)) {
    const leftQuality = resolveCommandProfileQuality(left);
    const rightQuality = resolveCommandProfileQuality(right);
    if (Math.abs(leftQuality - rightQuality) >= 20) {
      return rightQuality - leftQuality;
    }
  }
  const leftDominates = doesTacticalProfileDominate(left, right);
  const rightDominates = doesTacticalProfileDominate(right, left);
  if (leftDominates !== rightDominates) {
    return leftDominates ? -1 : 1;
  }
  const leftQuality = resolveTacticalProfileQuality(left);
  const rightQuality = resolveTacticalProfileQuality(right);
  if (Math.abs(leftQuality - rightQuality) >= 35) {
    return rightQuality - leftQuality;
  }
  return 0;
}

function resolveTacticalProfileQuality(profile: SimilarityProfile): number {
  const weights: Partial<Record<MetricKey, number>> = {
    alphaArmor: 0.55,
    alphaGround: 0.55,
    alphaHelo: 0.55,
    alphaPlane: 0.55,
    antiArmor: 0.85,
    antiGround: 0.75,
    antiHelo: 0.85,
    antiPlane: 0.9,
    armorPenetration: 0.55,
    burstDps: 0.55,
    directFire: 0.3,
    effect: 0.65,
    fireOnMove: 0.35,
    indirect: 0.8,
    initiative: 0.35,
    mobility: 0.6,
    oneShotArmor: 0.45,
    oneShotGround: 0.45,
    oneShotHelo: 0.45,
    oneShotPlane: 0.45,
    optics: 0.3,
    precision: 0.65,
    rangeArmor: 1.15,
    rangeGround: 1.05,
    rangeHelo: 1.15,
    rangePlane: 1.25,
    response: 0.5,
    splash: 0.35,
    stealth: 0.35,
    suppression: 0.25,
    sustainedDps: 0.5,
    survivability: 0.55,
    weaponVariety: 0.25,
  };
  return Object.entries(weights).reduce(
    (total, [metric, weight]) =>
      total + readSimilarityMetric(profile, metric as MetricKey) * (weight ?? 0),
    0,
  );
}

function resolveCommandProfileQuality(profile: SimilarityProfile): number {
  return (
    readSimilarityMetric(profile, 'survivability') * 1.6 +
    readSimilarityMetric(profile, 'antiArmor') * 1.15 +
    readSimilarityMetric(profile, 'rangeArmor') * 0.9 +
    readSimilarityMetric(profile, 'oneShotArmor') * 0.65 +
    readSimilarityMetric(profile, 'antiGround') * 0.3 +
    readSimilarityMetric(profile, 'optics') * 0.45 +
    readSimilarityMetric(profile, 'effect') * 0.55
  );
}

function doesTacticalProfileDominate(
  candidate: SimilarityProfile,
  reference: SimilarityProfile,
): boolean {
  if (hasMaterialPlatformRegression(candidate.entity, reference.entity)) {
    return false;
  }
  const candidateEffects = getCachedProfileTokens(candidate).effectTokens;
  const referenceEffects = getCachedProfileTokens(reference).effectTokens;
  if (![...referenceEffects].every((token) => candidateEffects.has(token))) {
    return false;
  }
  const candidateNegativeEffects = new Set(candidate.entity.negativeEffectTokens);
  const referenceNegativeEffects = new Set(reference.entity.negativeEffectTokens);
  if ([...candidateNegativeEffects].some((token) => !referenceNegativeEffects.has(token))) {
    return false;
  }
  let improvement = [...referenceNegativeEffects].some(
    (token) => !candidateNegativeEffects.has(token),
  );
  for (const metric of TACTICAL_DOMINANCE_METRICS) {
    const candidateValue = readSimilarityMetric(candidate, metric);
    const referenceValue = readSimilarityMetric(reference, metric);
    if (referenceValue - candidateValue > 100) {
      return false;
    }
    if (candidateValue - referenceValue >= 35) {
      improvement = true;
    }
  }
  return improvement;
}

function readSimilarityMetric(profile: SimilarityProfile, metric: MetricKey): number {
  const index = SIMILARITY_METRIC_KEYS.indexOf(metric);
  return index < 0 ? 0 : (profile.similarityVector[index] ?? 0);
}

function haveMaterialEngagementEnvelopeDifference(
  left: SimilarityProfile,
  right: SimilarityProfile,
): boolean {
  const channels: Array<[string, MetricKey, MetricKey]> = [
    ['armor', 'antiArmor', 'rangeArmor'],
    ['ground', 'antiGround', 'rangeGround'],
    ['helo', 'antiHelo', 'rangeHelo'],
    ['plane', 'antiPlane', 'rangePlane'],
    ['indirect', 'indirect', 'rangeGround'],
  ];
  const leftTokens = getCachedProfileTokens(left).tokenSet;
  const rightTokens = getCachedProfileTokens(right).tokenSet;
  return channels.some(([channel, metric, rangeMetric]) => {
    const leftHasChannel = leftTokens.has(`channel:${channel}`);
    const rightHasChannel = rightTokens.has(`channel:${channel}`);
    if (leftHasChannel !== rightHasChannel) {
      const maximum = Math.max(
        readSimilarityMetric(left, metric),
        readSimilarityMetric(right, metric),
      );
      return maximum >= 400;
    }
    if (!leftHasChannel) return false;
    const leftRange = readSimilarityMetric(left, rangeMetric);
    const rightRange = readSimilarityMetric(right, rangeMetric);
    const shorter = Math.min(leftRange, rightRange);
    const longer = Math.max(leftRange, rightRange);
    return shorter > 0 && longer - shorter >= 35 && longer >= shorter * 1.15;
  });
}

function haveMaterialSpecializationDifference(
  left: SimilarityProfile,
  right: SimilarityProfile,
): boolean {
  // Exceptional concealment and sensors create distinct deployment/use cases
  // even when another platform carries a statistically stronger payload.
  // Compare category-relative values so the threshold adapts to each pool.
  return (['stealth', 'optics', 'ammo', 'weaponVariety'] as const).some(
    (metric) =>
      Math.abs(readSimilarityMetric(left, metric) - readSimilarityMetric(right, metric)) >= 200,
  );
}

function haveDifferentAmmunitionLoadouts(
  left: SimilarityProfile,
  right: SimilarityProfile,
): boolean {
  const leftTokens = getCachedProfileTokens(left);
  const rightTokens = getCachedProfileTokens(right);
  const leftPayload = leftTokens.ammunitionPayload;
  const rightPayload = rightTokens.ammunitionPayload;
  if (leftPayload.size === 0 || rightPayload.size === 0) return false;
  const isSubset = (candidate: ReadonlySet<string>, reference: ReadonlySet<string>): boolean => {
    for (const token of candidate) {
      if (!reference.has(token)) return false;
    }
    return true;
  };
  // A strict payload superset is an upgrade/multirole opportunity, not a new
  // reason to preserve the weaker subset. Incomparable payloads (for example
  // HE versus cluster) remain tactically distinct. Each side's significant
  // payload is checked against the other's full set: the significance cutoff
  // is relative to each unit's own strongest weapon, so twins may straddle it.
  return (
    !isSubset(leftPayload, rightTokens.fullAmmunitionPayload) &&
    !isSubset(rightPayload, leftTokens.fullAmmunitionPayload)
  );
}

function deriveDuplicatePurposeKey(entity: EntityData): string {
  const cached = duplicatePurposeKeyCache.get(entity);
  if (cached !== undefined) {
    return cached;
  }
  const key = [
    normalizeRoleToken(entity.factoryType ?? 'unknown'),
    normalizeRoleToken(entity.unitRole ?? entity.strategicType ?? 'unknown'),
    derivePlatformForm(entity),
  ].join('|');
  duplicatePurposeKeyCache.set(entity, key);
  return key;
}

function haveMaterialAmmunitionReserveDifference(
  left: SimilarityProfile,
  right: SimilarityProfile,
): boolean {
  const leftReserves = getCachedProfileTokens(left).ammunitionReserves;
  const rightReserves = getCachedProfileTokens(right).ammunitionReserves;
  if (leftReserves.size === 0 || rightReserves.size === 0) return false;
  for (const [signature, leftAmount] of leftReserves) {
    const rightAmount = rightReserves.get(signature);
    if (rightAmount === undefined) continue;
    const smaller = Math.min(leftAmount, rightAmount);
    const larger = Math.max(leftAmount, rightAmount);
    if (larger - smaller >= 2 && larger >= smaller * 1.25) return true;
  }
  return false;
}

function haveMaterialPlatformTradeoff(left: EntityData, right: EntityData): boolean {
  return hasMaterialPlatformRegression(left, right) && hasMaterialPlatformRegression(right, left);
}

function haveMaterialDeploymentDifference(left: EntityData, right: EntityData): boolean {
  return Math.abs((left.deploymentShiftGru ?? 0) - (right.deploymentShiftGru ?? 0)) >= 700;
}

function haveMaterialDeploymentFormDifference(
  left: SimilarityProfile,
  right: SimilarityProfile,
): boolean {
  const leftTransportable =
    Boolean(left.transportName) || (left.entry?.transportNames.length ?? 0) > 0;
  const rightTransportable =
    Boolean(right.transportName) || (right.entry?.transportNames.length ?? 0) > 0;
  if (leftTransportable === rightTransportable) {
    return false;
  }
  const leftSpeed = Math.max(0, left.entity.maxSpeedKmph ?? 0);
  const rightSpeed = Math.max(0, right.entity.maxSpeedKmph ?? 0);
  return Math.abs(leftSpeed - rightSpeed) >= 15;
}

function hasMaterialPlatformRegression(candidate: EntityData, reference: EntityData): boolean {
  // Armored versus soft chassis is a class line, not a stat delta: a truck
  // must not consume an armored twin no matter how strong its payload is.
  if ((reference.frontArmor ?? 0) >= 1 && (candidate.frontArmor ?? 0) < 1) {
    return true;
  }
  const candidateSpeed = Math.max(1, candidate.maxSpeedKmph ?? 0);
  const referenceSpeed = Math.max(1, reference.maxSpeedKmph ?? 0);
  if (referenceSpeed > candidateSpeed * 1.2 && referenceSpeed - candidateSpeed >= 15) {
    return true;
  }
  const candidateEndurance = Math.max(candidate.fuelMoveDuration ?? 0, candidate.fuelCapacity ?? 0);
  const referenceEndurance = Math.max(reference.fuelMoveDuration ?? 0, reference.fuelCapacity ?? 0);
  if (
    referenceEndurance > candidateEndurance * 1.35 &&
    referenceEndurance - candidateEndurance >= 150
  ) {
    return true;
  }
  const candidateDeployment = candidate.deploymentShiftGru ?? 0;
  const referenceDeployment = reference.deploymentShiftGru ?? 0;
  return referenceDeployment - candidateDeployment >= 700;
}

function haveEqualTokens(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((token, index) => token === right[index]);
}

function getCachedProfileTokens(profile: SimilarityProfile): CachedProfileTokens {
  const source = profile.profileTokens ?? EMPTY_PROFILE_TOKENS;
  const cached = profileTokenCache.get(profile);
  if (cached?.source === source) {
    return cached;
  }

  const effectTokens = new Set<string>();
  const tokenSet = new Set<string>();
  const ammunitionPayload = new Set<string>();
  const fullAmmunitionPayload = new Set<string>();
  const ammunitionReserves = new Map<string, number>();
  const weaponPurposeTokens: string[] = [];

  for (const token of source) {
    tokenSet.add(token);
    if (
      token.startsWith('scope:') ||
      token.startsWith('effect:') ||
      token.startsWith('mechanic:')
    ) {
      effectTokens.add(token);
    }
    if (token.startsWith('ammo:family_') || token.startsWith('ammo:trait_')) {
      const component = token.slice('ammo:'.length);
      ammunitionPayload.add(component);
      fullAmmunitionPayload.add(component);
    } else if (token.startsWith('ammo_all:family_') || token.startsWith('ammo_all:trait_')) {
      fullAmmunitionPayload.add(token.slice('ammo_all:'.length));
    }
    if (token.startsWith('ammo_reserve:')) {
      const separator = token.lastIndexOf(':');
      const signature = token.slice('ammo_reserve:'.length, separator);
      const amount = Number(token.slice(separator + 1));
      if (signature && Number.isFinite(amount)) ammunitionReserves.set(signature, amount);
    }
    if (WEAPON_PROFILE_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix))) {
      weaponPurposeTokens.push(token);
    }
  }
  weaponPurposeTokens.sort();

  const result: CachedProfileTokens = {
    source,
    effectTokens,
    tokenSet,
    ammunitionPayload,
    fullAmmunitionPayload,
    ammunitionReserves,
    weaponPurposeTokens,
  };
  profileTokenCache.set(profile, result);
  return result;
}

function tokenSetSimilarity(left: readonly string[], right: readonly string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }
  return intersection / (leftSet.size + rightSet.size - intersection);
}

function areStatisticallyEquivalent(
  differences: readonly number[],
  maximumAverage: number,
  maximumUpperQuartile: number,
  maximumDifference: number,
): boolean {
  if (differences.length === 0) {
    return false;
  }
  const sortedDifferences = [...differences].sort((first, second) => first - second);
  const average =
    sortedDifferences.reduce((total, difference) => total + difference, 0) /
    sortedDifferences.length;
  const upperQuartile =
    sortedDifferences[
      Math.min(sortedDifferences.length - 1, Math.floor(sortedDifferences.length * 0.75))
    ] ?? 0;
  const maximum = sortedDifferences[sortedDifferences.length - 1] ?? 0;
  return (
    average <= maximumAverage &&
    upperQuartile <= maximumUpperQuartile &&
    maximum <= maximumDifference
  );
}

function haveCompatibleProfileTokens(left: readonly string[], right: readonly string[]): boolean {
  if (left.length === 0 || right.length === 0) {
    return left.length === right.length;
  }
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      intersection += 1;
    }
  }
  const union = leftSet.size + rightSet.size - intersection;
  return union > 0 && intersection / union >= 0.5;
}

function buildSimilarityVector(
  analysis: EntityAnalysis,
  maximums: ReadonlyMap<MetricKey, number>,
): number[] {
  return SIMILARITY_METRIC_KEYS.map((metric) => {
    const maximum = maximums.get(metric) ?? 0;
    return maximum > 0 ? (Math.max(0, analysis.metrics[metric]) / maximum) * 1_000 : 0;
  });
}

type WeaponMetricKey = Exclude<
  MetricKey,
  | 'amphibious'
  | 'availability'
  | 'command'
  | 'effect'
  | 'initiative'
  | 'mobility'
  | 'optics'
  | 'supply'
  | 'survivability'
  | 'value'
>;

const WEAPON_METRIC_KEYS: WeaponMetricKey[] = [
  'alphaArmor',
  'alphaGround',
  'alphaHelo',
  'alphaPlane',
  'antiArmor',
  'antiGround',
  'antiHelo',
  'antiPlane',
  'ammo',
  'armorPenetration',
  'burstDps',
  'closeCombat',
  'directFire',
  'fireOnMove',
  'indirect',
  'oneShotArmor',
  'oneShotGround',
  'oneShotHelo',
  'oneShotPlane',
  'precision',
  'rangeArmor',
  'rangeGround',
  'rangeHelo',
  'rangePlane',
  'response',
  'splash',
  'stealth',
  'suppression',
  'sustainedDps',
  'weaponVariety',
];

const MAXIMUM_WEAPON_METRICS = new Set<WeaponMetricKey>([
  'armorPenetration',
  'rangeArmor',
  'rangeGround',
  'rangeHelo',
  'rangePlane',
  'response',
  'oneShotArmor',
  'oneShotGround',
  'oneShotHelo',
  'oneShotPlane',
]);

function createWeaponMetrics(): Record<WeaponMetricKey, number> {
  return Object.fromEntries(WEAPON_METRIC_KEYS.map((key) => [key, 0])) as Record<
    WeaponMetricKey,
    number
  >;
}

function collectWeaponStats(
  entity: EntityData,
  weaponDescriptors: Map<string, WeaponDescriptorData>,
  ammunition: Map<string, AmmunitionData>,
): Record<WeaponMetricKey, number> {
  const stats = createWeaponMetrics();
  const tacticalChannels = new Set<string>();
  const tacticalMechanics = new Set<string>();
  const tacticalPayloadStrengths = new Map<string, number>();
  const allWeaponBoxes: Array<Record<WeaponMetricKey, number>> = [];
  let independentWeaponBoxes = 0;

  for (const weaponDescriptorName of entity.weaponDescriptorNames) {
    const descriptor = weaponDescriptors.get(weaponDescriptorName);
    if (!descriptor) {
      continue;
    }
    const boxMetrics = new Map<number, Record<WeaponMetricKey, number>>();
    for (const mountedWeapon of descriptor.mountedWeapons) {
      const ammo = ammunition.get(mountedWeapon.ammunitionName);
      if (!ammo || isDefensiveOrUtilityAmmunition(ammo)) {
        continue;
      }
      const ammunitionSignature = deriveAmmunitionProfile(ammo).signature;
      const contribution = createWeaponMetrics();
      const shotsPerSalvo = Math.max(1, ammo.shotsCountPerSalvo ?? 1);
      const reserveSalvos = Math.max(1, descriptor.salves[mountedWeapon.ammoBoxIndex] ?? 1);
      const weaponCount = Math.max(1, mountedWeapon.weaponCount);
      const volleyProjectiles = shotsPerSalvo * weaponCount;
      const totalProjectiles = reserveSalvos * volleyProjectiles;
      const stationaryAccuracy = clampAccuracy(
        ammo.accuracyStationary ?? ammo.accuracyMoving ?? 25,
      );
      const movingAccuracy = clampAccuracy(ammo.accuracyMoving ?? 0);
      const aimTime =
        Math.max(0, ammo.aimingTime ?? 1.5) + Math.max(0, entity.weaponDeploymentTime ?? 0);
      const shotInterval = Math.max(0.05, ammo.timeBetweenTwoShots ?? 0.45);
      const reloadTime = Math.max(0.1, ammo.timeBetweenTwoSalvos ?? 1.6);
      const volleyDuration = Math.max(0.1, (shotsPerSalvo - 1) * shotInterval);
      const firstVolleyTime = Math.max(0.25, aimTime + volleyDuration);
      const fullFireTime = Math.max(
        firstVolleyTime,
        aimTime + reserveSalvos * volleyDuration + Math.max(0, reserveSalvos - 1) * reloadTime,
      );
      const response = 1_000 / Math.max(0.5, 0.5 + aimTime);
      const physicalPerShot = Math.max(0, ammo.physicalDamages ?? 0) * stationaryAccuracy;
      const suppressionPerShot = Math.max(0, ammo.suppressDamages ?? 0) * stationaryAccuracy;
      const volleyPhysical = physicalPerShot * volleyProjectiles;
      const volleySuppression = suppressionPerShot * volleyProjectiles;
      const burstPhysicalDps = volleyPhysical / firstVolleyTime;
      const sustainedPhysicalDps = (physicalPerShot * totalProjectiles) / fullFireTime;
      const groundRange = Math.max(0, ammo.maximumRangeGru ?? 0);
      const heloRange = Math.max(0, ammo.maximumRangeHelicopterGru ?? 0);
      const planeRange = Math.max(0, ammo.maximumRangeAirplaneGru ?? 0);
      const minimumGroundRange = Math.max(0, ammo.minimumRangeGru ?? 0);
      const rangeFlexibility =
        groundRange > 0 ? Math.max(0.35, 1 - minimumGroundRange / groundRange) : 1;
      const splashArea =
        Math.max(0, ammo.radiusSplashPhysicalDamagesGru ?? 0) ** 0.8 +
        Math.max(0, ammo.radiusSplashSuppressDamagesGru ?? 0) ** 0.76;
      const armorPenetration = Math.max(0, ammo.armorPenetration ?? 0);
      const isAntiArmor = isEffectiveAntiArmorAmmunition(ammo);
      const isIndirect = deriveMobilityKey(entity) !== 'Plane' && isIndirectFireAmmunition(ammo);
      const tandemFactor = ammo.tandemCharge === true ? 1.18 : 1;
      const armorPerShot = isAntiArmor
        ? resolveArmorLethality(armorPenetration) * stationaryAccuracy * tandemFactor
        : 0;
      const armorVolley = armorPerShot * volleyProjectiles;
      const armorBurstDps = armorVolley / firstVolleyTime;
      const armorSustainedDps = (armorPerShot * totalProjectiles) / fullFireTime;
      const speed = Math.max(0, ammo.projectileSpeedGru ?? 0);

      contribution.ammo = totalProjectiles;
      contribution.rangeGround = groundRange;
      contribution.rangeHelo = heloRange;
      contribution.rangePlane = planeRange;
      contribution.response = response;
      contribution.splash = splashArea * Math.sqrt(volleyProjectiles) + volleySuppression * 0.18;
      contribution.suppression =
        volleySuppression * 0.75 +
        (suppressionPerShot * totalProjectiles * 0.25) / Math.max(1, fullFireTime / 10);
      contribution.burstDps = Math.max(burstPhysicalDps * 100, armorBurstDps * 9);
      contribution.sustainedDps = Math.max(sustainedPhysicalDps * 120, armorSustainedDps * 11);

      if (groundRange > 0) {
        tacticalChannels.add('ground');
        contribution.alphaGround = volleyPhysical;
        contribution.oneShotGround = physicalPerShot;
        contribution.antiGround =
          physicalPerShot * 120 +
          volleyPhysical * 70 +
          burstPhysicalDps * 110 +
          sustainedPhysicalDps * 150 +
          volleySuppression * 0.5 +
          splashArea * 16 +
          groundRange * 0.055 +
          response * 0.45;
        if (!isIndirect) {
          contribution.directFire = contribution.antiGround * rangeFlexibility;
        }
        if (isAntiArmor) {
          tacticalChannels.add('armor');
          contribution.alphaArmor = armorVolley;
          contribution.oneShotArmor = armorPerShot;
          contribution.armorPenetration = armorPenetration;
          contribution.rangeArmor = groundRange;
          // Sustained DPS cannot see magazine depth (the window scales with the
          // reserve); sqrt keeps huge autocannon belts from beating tank guns.
          contribution.antiArmor =
            armorPerShot * 42 +
            armorVolley * 24 +
            armorBurstDps * 34 +
            armorSustainedDps * 52 +
            armorPerShot * Math.sqrt(totalProjectiles) * 30 +
            groundRange * Math.max(1, armorPenetration - 7) * 0.11 +
            speed * Math.max(1, armorPenetration - 7) * 0.01 +
            response * 0.5;
        }
        const closeCombatFactor = inferCloseCombatFactor(ammo);
        if (closeCombatFactor > 0) {
          contribution.closeCombat =
            (contribution.antiGround + volleySuppression + splashArea * 15) *
            Math.max(0, 1 - groundRange / 1_800) *
            closeCombatFactor;
        }
      }
      if (heloRange > 0) {
        tacticalChannels.add('helo');
        contribution.alphaHelo = volleyPhysical;
        contribution.oneShotHelo = physicalPerShot;
        contribution.antiHelo =
          physicalPerShot * 160 +
          volleyPhysical * 115 +
          burstPhysicalDps * 125 +
          sustainedPhysicalDps * 95 +
          heloRange * 0.24 +
          speed * 0.04 +
          response * 0.55;
      }
      if (planeRange > 0) {
        tacticalChannels.add('plane');
        contribution.alphaPlane = volleyPhysical;
        contribution.oneShotPlane = physicalPerShot;
        contribution.antiPlane =
          physicalPerShot * 180 +
          volleyPhysical * 125 +
          burstPhysicalDps * 135 +
          sustainedPhysicalDps * 85 +
          planeRange * 0.28 +
          speed * 0.05 +
          response * 0.55;
      }
      if (isIndirect) {
        tacticalChannels.add('indirect');
        contribution.indirect =
          physicalPerShot * 120 +
          volleyPhysical * 95 +
          burstPhysicalDps * 90 +
          sustainedPhysicalDps * 80 +
          volleySuppression * 0.9 +
          splashArea * 24 +
          groundRange * 0.16 +
          response * 0.7;
      }
      if (groundRange > 0 && inferPrecisionFactor(ammo) > 0) {
        const dispersionFactor = 1 / (1 + Math.max(0, ammo.dispersionAtMaxRangeGru ?? 0) / 350);
        contribution.precision =
          (physicalPerShot * 130 + armorPerShot * 25 + groundRange * 0.09 + speed * 0.025) *
          inferPrecisionFactor(ammo) *
          dispersionFactor;
      }
      if (ammo.canShootWhileMoving === true || movingAccuracy > 0) {
        contribution.fireOnMove =
          (contribution.directFire + contribution.antiArmor * 0.5) *
          Math.max(0.15, movingAccuracy / Math.max(0.01, stationaryAccuracy));
        tacticalMechanics.add('fire_on_move');
      }
      if (ammo.tandemCharge === true) tacticalMechanics.add('tandem');
      if (ammo.isFireAndForget === true) tacticalMechanics.add('fire_and_forget');
      if (ammo.forceHitTopArmorOnSuccess === true && !isIndirect) {
        tacticalMechanics.add('top_attack');
      }

      tacticalPayloadStrengths.set(
        ammunitionSignature,
        Math.max(
          tacticalPayloadStrengths.get(ammunitionSignature) ?? 0,
          resolveWeaponBoxStrength(contribution),
        ),
      );

      const existing = boxMetrics.get(mountedWeapon.ammoBoxIndex) ?? createWeaponMetrics();
      for (const key of WEAPON_METRIC_KEYS) {
        existing[key] = Math.max(existing[key], contribution[key]);
      }
      boxMetrics.set(mountedWeapon.ammoBoxIndex, existing);
    }

    independentWeaponBoxes += boxMetrics.size;
    for (const box of boxMetrics.values()) {
      allWeaponBoxes.push(box);
      for (const key of WEAPON_METRIC_KEYS) {
        if (key === 'ammo') continue;
        stats[key] = MAXIMUM_WEAPON_METRICS.has(key)
          ? Math.max(stats[key], box[key])
          : stats[key] + box[key];
      }
    }
  }

  const strongestBox = Math.max(...allWeaponBoxes.map(resolveWeaponBoxStrength), 0);
  stats.ammo = allWeaponBoxes.reduce((total, box) => {
    const relevance = strongestBox > 0 ? resolveWeaponBoxStrength(box) / strongestBox : 0;
    return total + box.ammo * relevance ** 2;
  }, 0);
  const strongestPayload = Math.max(...tacticalPayloadStrengths.values(), 0);
  const meaningfulPayloadCount = [...tacticalPayloadStrengths.values()].filter(
    (strength) => strongestPayload <= 0 || strength >= strongestPayload * 0.12,
  ).length;

  stats.weaponVariety =
    tacticalChannels.size * 420 +
    tacticalMechanics.size * 180 +
    meaningfulPayloadCount * 240 +
    independentWeaponBoxes * 90;
  return stats;
}

function resolveWeaponBoxStrength(metrics: Readonly<Record<WeaponMetricKey, number>>): number {
  return Math.max(
    metrics.antiArmor,
    metrics.antiGround,
    metrics.antiHelo,
    metrics.antiPlane,
    metrics.indirect,
  );
}

function clampAccuracy(value: number): number {
  return Math.max(0.05, Math.min(1, value / 100));
}

function resolveArmorLethality(armorPenetration: number): number {
  if (armorPenetration <= 0) {
    return 0;
  }
  // Samples light, medium, heavy, and super-heavy armor. This rewards actual
  // penetration breakpoints and prevents low-AP volume from masquerading as a
  // premier anti-tank weapon.
  return [5, 10, 15, 20].reduce(
    (total, armor, index) =>
      total + Math.max(0, armorPenetration - armor + 1) ** 1.35 * (1 + index * 0.25),
    0,
  );
}

function isDefensiveOrUtilityAmmunition(ammo: AmmunitionData): boolean {
  const semanticText = [ammo.name, ammo.damageFamily, ...ammo.traits].join(' ').toLowerCase();
  if (/smoke|fumig|decoy|flare/u.test(semanticText)) {
    return true;
  }
  return (
    (ammo.physicalDamages ?? 0) <= 0.25 &&
    (ammo.suppressDamages ?? 0) <= 10 &&
    (ammo.armorPenetration ?? 0) <= 0 &&
    (ammo.maximumRangeGru ?? 0) <= 700 &&
    ammo.canShootOnPosition === true
  );
}

function collectWeaponProfileTokens(
  entity: EntityData,
  weaponDescriptors: Map<string, WeaponDescriptorData>,
  ammunition: Map<string, AmmunitionData>,
  weaponStats: Record<WeaponMetricKey, number>,
): string[] {
  const tokens = new Set<string>();
  const channels = new Set<string>();
  const ammunitionLoadout = new Set<string>();
  const payloads: Array<{
    components: string[];
    reserve: number;
    signature: string;
    strength: number;
  }> = [];
  for (const descriptorName of entity.weaponDescriptorNames) {
    const descriptor = weaponDescriptors.get(descriptorName);
    if (!descriptor) {
      continue;
    }
    for (const mountedWeapon of descriptor.mountedWeapons) {
      const ammo = ammunition.get(mountedWeapon.ammunitionName);
      if (!ammo || isDefensiveOrUtilityAmmunition(ammo)) {
        continue;
      }
      const ammunitionProfile = deriveAmmunitionProfile(ammo);
      payloads.push({
        ...ammunitionProfile,
        reserve:
          Math.max(1, descriptor.salves[mountedWeapon.ammoBoxIndex] ?? 1) *
          Math.max(1, ammo.shotsCountPerSalvo ?? 1) *
          Math.max(1, mountedWeapon.weaponCount),
        strength: resolveAmmunitionProfileStrength(ammo, mountedWeapon.weaponCount),
      });
      if ((ammo.maximumRangeGru ?? 0) > 0) channels.add('ground');
      if (isEffectiveAntiArmorAmmunition(ammo)) channels.add('armor');
      if ((ammo.maximumRangeHelicopterGru ?? 0) > 0) channels.add('helo');
      if ((ammo.maximumRangeAirplaneGru ?? 0) > 0) channels.add('plane');
      if (deriveMobilityKey(entity) !== 'Plane' && isIndirectFireAmmunition(ammo)) {
        channels.add('indirect');
      }
      addRangeProfileToken(tokens, 'ground', ammo.maximumRangeGru);
      addRangeProfileToken(tokens, 'helo', ammo.maximumRangeHelicopterGru);
      addRangeProfileToken(tokens, 'plane', ammo.maximumRangeAirplaneGru);
      if (ammo.canShootWhileMoving === true) tokens.add('mechanic:shoot_while_moving');
      if (ammo.isFireAndForget === true) tokens.add('mechanic:fire_and_forget');
      if (ammo.piercingWeapon === true) tokens.add('mechanic:piercing');
      if (ammo.tandemCharge === true) tokens.add('mechanic:tandem');
      if (ammo.forceHitTopArmorOnSuccess === true && !isIndirectFireAmmunition(ammo)) {
        tokens.add('mechanic:top_attack');
      }
      for (const trait of ammo.traits) {
        const normalizedTrait = normalizeRoleToken(trait);
        if (normalizedTrait && !['ap', 'he', 'ind'].includes(normalizedTrait)) {
          tokens.add(`mechanic:trait_${normalizedTrait}`);
        }
      }
    }
  }
  const strongestPayload = Math.max(...payloads.map((payload) => payload.strength), 0);
  const reserveBySignature = new Map<string, number>();
  for (const payload of payloads) {
    // Insignificant payloads still register under `ammo_all:` so that twin
    // units straddling the significance cutoff stay loadout-comparable.
    for (const component of payload.components) tokens.add(`ammo_all:${component}`);
    if (strongestPayload > 0 && payload.strength < strongestPayload * 0.12) continue;
    ammunitionLoadout.add(payload.signature);
    for (const component of payload.components) tokens.add(`ammo:${component}`);
    reserveBySignature.set(
      payload.signature,
      Math.max(reserveBySignature.get(payload.signature) ?? 0, payload.reserve),
    );
  }
  for (const [signature, reserve] of reserveBySignature) {
    tokens.add(`ammo_reserve:${signature}:${reserve}`);
  }
  if (ammunitionLoadout.size > 0) {
    tokens.add(`ammo_loadout:${[...ammunitionLoadout].sort().join('|')}`);
  }
  const strongestPurpose = Math.max(
    weaponStats.antiArmor,
    weaponStats.antiGround,
    weaponStats.antiHelo,
    weaponStats.antiPlane,
    weaponStats.indirect,
  );
  const channelMetrics: Array<[string, number]> = [
    ['armor', weaponStats.antiArmor],
    ['ground', weaponStats.antiGround],
    ['helo', weaponStats.antiHelo],
    ['plane', weaponStats.antiPlane],
    ['indirect', weaponStats.indirect],
  ];
  for (const [channel, score] of channelMetrics) {
    if (strongestPurpose > 0 && score < strongestPurpose * 0.12) {
      channels.delete(channel);
      for (const token of tokens) {
        if (token.startsWith(`range_class:${channel}_`)) {
          tokens.delete(token);
        }
      }
    }
  }
  for (const channel of channels) {
    tokens.add(`channel:${channel}`);
  }
  if (channels.size > 0) {
    tokens.add(`loadout:${[...channels].sort().join('+')}`);
  }
  if (tokens.has('mechanic:tandem') || tokens.has('mechanic:trait_tandem')) {
    // Tandem implies HEAT, or the effect-superset dominance test breaks.
    tokens.add('mechanic:trait_heat');
  }
  return [...tokens].sort();
}

function resolveAmmunitionProfileStrength(
  ammo: AmmunitionData,
  mountedWeaponCount: number,
): number {
  const accuracy = clampAccuracy(ammo.accuracyStationary ?? ammo.accuracyMoving ?? 25);
  const volleyProjectiles =
    Math.max(1, ammo.shotsCountPerSalvo ?? 1) * Math.max(1, mountedWeaponCount);
  const impact =
    Math.max(0, ammo.physicalDamages ?? 0) * 120 +
    Math.max(0, ammo.suppressDamages ?? 0) * 0.8 +
    Math.max(0, ammo.armorPenetration ?? 0) * 75;
  const range = Math.max(
    0,
    ammo.maximumRangeGru ?? 0,
    ammo.maximumRangeHelicopterGru ?? 0,
    ammo.maximumRangeAirplaneGru ?? 0,
  );
  return impact * volleyProjectiles * accuracy + range * 0.1;
}

function deriveAmmunitionProfile(ammo: AmmunitionData): {
  components: string[];
  signature: string;
} {
  const components = new Set<string>();
  const damageFamily = normalizeRoleToken(ammo.damageFamily ?? '');
  if (damageFamily) components.add(`family_${damageFamily}`);
  const minMaxCategory = normalizeRoleToken(ammo.minMaxCategory ?? '');
  if (minMaxCategory) components.add(`class_${minMaxCategory}`);
  const projectileType = normalizeRoleToken(ammo.projectileType ?? '');
  if (projectileType) components.add(`projectile_${projectileType}`);
  for (const trait of ammo.traits) {
    const normalized = normalizeRoleToken(trait);
    if (normalized && !['ap', 'ind', 'stat'].includes(normalized)) {
      components.add(`trait_${normalized}`);
    }
  }
  if (ammo.tandemCharge === true) components.add('trait_tandem');
  // Tandem = HEAT + ERA defeat: a strict payload superset, so a plain-HEAT
  // twin must not escape consolidation as an "incomparable loadout".
  if (components.has('trait_tandem')) components.add('trait_heat');
  if (components.size === 0) components.add('family_unspecified');
  const sorted = [...components].sort();
  return { components: sorted, signature: sorted.join('+') };
}

function addRangeProfileToken(
  tokens: Set<string>,
  target: string,
  value: number | undefined,
): void {
  if (!value || value <= 0) {
    return;
  }
  const tier = Math.max(0, Math.round(Math.log2(Math.max(1, value) / 700)));
  tokens.add(`range_class:${target}_${tier}`);
  tokens.add(`range_band:${target}_${resolveRangeBand(value)}`);
}

function resolveRangeBand(value: number): number {
  return Math.max(0, Math.round(Math.log(Math.max(1, value) / 700) / Math.log(1.2)));
}

function discoverRoleDefinitions(analyses: EntityAnalysis[]): RoleDefinition[] {
  const support = new Map<string, { kind: RoleDefinition['kind']; count: number }>();

  for (const analysis of analyses) {
    for (const token of analysis.roleTokens) {
      const kindText = token.split(':')[0] ?? '';
      const kind = normalizeRoleKind(kindText);
      if (!kind) {
        continue;
      }
      const current = support.get(token);
      support.set(token, {
        kind,
        count: (current?.count ?? 0) + 1,
      });
    }
  }

  const definitions = [...support.entries()]
    .filter(([token, value]) => {
      if (value.kind === 'trait') {
        const hasUsefulMeaning =
          token.startsWith('trait:effect_') ||
          Object.keys(inferRoleFocus(token, false)).length > 0 ||
          Object.keys(deriveEmpiricalRoleFocus(token, analyses)).length > 0;
        return (
          hasUsefulMeaning &&
          (token.startsWith('trait:effect_') ||
            token.includes('sf') ||
            analyses.length === 0 ||
            value.count / Math.max(1, analyses.length) <= 0.8)
        );
      }
      if (value.kind === 'capability') {
        return analyses.length === 0 || value.count / analyses.length <= 0.65;
      }
      return true;
    })
    .map(([token, value]) => {
      const semanticFocus = inferRoleFocus(token, false);
      const empiricalFocus = deriveEmpiricalRoleFocus(token, analyses);
      const focus = mergeRoleFocus(semanticFocus, empiricalFocus);
      return {
        key: token,
        kind: value.kind,
        optionCount: resolveRoleOptionCount(
          value.kind,
          analyses.filter((analysis) => analysis.exactRoleTokens.has(token)),
          token,
        ),
        priority:
          (value.kind === 'capability'
            ? Math.min(value.count, Math.max(1, analyses.length - value.count))
            : value.count) *
            100 +
          resolveRoleKindPriority(value.kind),
        focus: Object.keys(focus).length > 0 ? focus : inferRoleFocus(token),
      };
    });
  return consolidateEquivalentRoleDefinitions(definitions, analyses).sort(
    (left, right) => right.priority - left.priority || left.key.localeCompare(right.key),
  );
}

function consolidateEquivalentRoleDefinitions(
  definitions: RoleDefinition[],
  analyses: EntityAnalysis[],
): RoleDefinition[] {
  const definitionKeys = new Set(definitions.map((definition) => definition.key));
  const supportByKey = new Map<string, Set<string>>();
  for (const analysis of analyses) {
    for (const key of analysis.exactRoleTokens) {
      if (!definitionKeys.has(key)) {
        continue;
      }
      const support = supportByKey.get(key) ?? new Set<string>();
      support.add(analysis.entity.name);
      supportByKey.set(key, support);
    }
  }
  const parents = definitions.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) {
      root = parents[root] ?? root;
    }
    while (parents[index] !== index) {
      const next = parents[index] ?? root;
      parents[index] = root;
      index = next;
    }
    return root;
  };
  const union = (left: number, right: number): void => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) {
      parents[rightRoot] = leftRoot;
    }
  };

  const exactSupportBuckets = new Map<string, number[]>();
  const semanticBuckets = new Map<string, number[]>();
  for (const [index, definition] of definitions.entries()) {
    const support = supportByKey.get(definition.key) ?? new Set<string>();
    const supportSignature = [
      definition.key.startsWith('capability:platform_')
        ? deriveRoleSemanticKey(definition.key)
        : '',
      [...support].sort().join('\u0000'),
    ].join('\u0000');
    const exactBucket = exactSupportBuckets.get(supportSignature) ?? [];
    exactBucket.push(index);
    exactSupportBuckets.set(supportSignature, exactBucket);
    const semanticKey = deriveRoleSemanticKey(definition.key);
    const semanticBucket = semanticBuckets.get(semanticKey) ?? [];
    semanticBucket.push(index);
    semanticBuckets.set(semanticKey, semanticBucket);
  }
  for (const bucket of exactSupportBuckets.values()) {
    const first = bucket[0];
    if (first === undefined) {
      continue;
    }
    for (const index of bucket.slice(1)) {
      union(first, index);
    }
  }
  for (const bucket of semanticBuckets.values()) {
    if (bucket.length < 2) {
      continue;
    }
    for (let leftOffset = 0; leftOffset < bucket.length; leftOffset += 1) {
      const leftIndex = bucket[leftOffset];
      const left = leftIndex === undefined ? undefined : definitions[leftIndex];
      if (leftIndex === undefined || !left) {
        continue;
      }
      const leftSupport = supportByKey.get(left.key) ?? new Set<string>();
      for (const rightIndex of bucket.slice(leftOffset + 1)) {
        const right = definitions[rightIndex];
        if (!right) {
          continue;
        }
        const rightSupport = supportByKey.get(right.key) ?? new Set<string>();
        if (resolveSetJaccard(leftSupport, rightSupport) >= 0.6) {
          union(leftIndex, rightIndex);
        }
      }
    }
  }

  const groups = new Map<number, RoleDefinition[]>();
  for (const [index, definition] of definitions.entries()) {
    const root = find(index);
    const group = groups.get(root) ?? [];
    group.push(definition);
    groups.set(root, group);
  }

  return [...groups.values()].map((group) => {
    const canonical = [...group].sort(
      (left, right) =>
        resolveCanonicalRoleKindOrder(left.kind) - resolveCanonicalRoleKindOrder(right.kind) ||
        right.priority - left.priority ||
        left.key.localeCompare(right.key),
    )[0];
    if (!canonical) {
      throw new Error('Role consolidation produced an empty definition group.');
    }
    if (group.length === 1) {
      return canonical;
    }
    const aliasKeys = new Set(group.map((definition) => definition.key));
    const matching = analyses.filter((analysis) =>
      [...aliasKeys].some((key) => analysis.exactRoleTokens.has(key)),
    );
    for (const analysis of matching) {
      addRoleToken(analysis, canonical.key);
    }
    const focus: Partial<Record<MetricKey, number>> = {};
    for (const definition of group) {
      for (const [metric, weight] of Object.entries(definition.focus)) {
        const metricKey = metric as MetricKey;
        focus[metricKey] = Math.max(focus[metricKey] ?? 0, weight ?? 0);
      }
    }
    return {
      ...canonical,
      optionCount: resolveRoleOptionCount(canonical.kind, matching, canonical.key),
      priority: Math.max(...group.map((definition) => definition.priority)),
      focus,
    };
  });
}

function resolveSetJaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  const intersection = [...left].filter((value) => right.has(value)).length;
  return intersection / (left.size + right.size - intersection);
}

function deriveRoleSemanticKey(key: string): string {
  const label = key.slice(key.indexOf(':') + 1).toLowerCase();
  const semantic = label
    .replace(/^(?:aircraft|air|avion)+/u, '')
    .replace(
      /(?:fixed_wing|rotary_wing|helicopter|plane|ground_vehicle|ground|vehicle|veh|hel)+$/u,
      '',
    )
    .replaceAll(/[^a-z0-9]+/gu, '');
  return semantic === 'aa' || semantic === 'antiplane'
    ? 'antiair'
    : semantic === 'at' || semantic === 'antitank'
      ? 'antiarmor'
      : semantic;
}

function resolveCanonicalRoleKindOrder(kind: RoleDefinition['kind']): number {
  return kind === 'primary'
    ? 0
    : kind === 'type'
      ? 1
      : kind === 'role'
        ? 2
        : kind === 'capability'
          ? 3
          : kind === 'trait'
            ? 4
            : 5;
}

function applyPlatformVariantTokens(analyses: EntityAnalysis[]): void {
  const baseRoles = new Map<string, EntityAnalysis[]>();
  for (const analysis of analyses) {
    // Loadout roles split by platform form too: a self-propelled plane-only
    // SAM and a towed one are different tools even with similar envelopes.
    for (const token of analysis.roleTokens.filter(
      (roleToken) =>
        roleToken.startsWith('primary:') ||
        roleToken.startsWith('type:') ||
        roleToken.startsWith('role:') ||
        roleToken.startsWith('capability:'),
    )) {
      const matches = baseRoles.get(token) ?? [];
      matches.push(analysis);
      baseRoles.set(token, matches);
    }
  }

  for (const [roleToken, matching] of baseRoles) {
    if (matching.length < 2) {
      continue;
    }
    const byPlatform = new Map<PlatformForm, EntityAnalysis[]>();
    for (const analysis of matching) {
      const platform = derivePlatformForm(analysis.entity);
      const platformMatches = byPlatform.get(platform) ?? [];
      platformMatches.push(analysis);
      byPlatform.set(platform, platformMatches);
    }
    if (byPlatform.size < 2) {
      continue;
    }
    if (shouldAlwaysSplitGroundPlatformRoles(byPlatform)) {
      const roleName = normalizeRoleToken(roleToken.slice(roleToken.indexOf(':') + 1));
      for (const [platform, platformMatches] of byPlatform) {
        for (const analysis of platformMatches) {
          addRoleToken(analysis, `capability:platform_${platform}_${roleName}`);
        }
      }
      continue;
    }
    // Minority is measured in distinct stat profiles: four country clones of
    // one vehicle must not turn its platform form into the "majority".
    const countClusters = (group: EntityAnalysis[]): number =>
      new Set(group.map((analysis) => analysis.similarityKey)).size;
    const totalClusters = countClusters(matching);
    const groupStrength = Math.max(...matching.map(resolveStrongestPurposeStrength), 0);
    for (const [platform, platformMatches] of byPlatform) {
      if (countClusters(platformMatches) > totalClusters / 2) {
        continue;
      }
      // Platform coverage is not an excuse for a drastically weaker tool: the
      // minority form must stay competitive with the group's best.
      const platformStrength = Math.max(...platformMatches.map(resolveStrongestPurposeStrength), 0);
      if (groupStrength > 0 && platformStrength < groupStrength * 0.55) {
        continue;
      }
      const roleName = normalizeRoleToken(roleToken.slice(roleToken.indexOf(':') + 1));
      for (const analysis of platformMatches) {
        addRoleToken(analysis, `capability:platform_${platform}_${roleName}`);
      }
    }
  }
}

function shouldAlwaysSplitGroundPlatformRoles(
  byPlatform: ReadonlyMap<PlatformForm, EntityAnalysis[]>,
): boolean {
  return (
    byPlatform.has('wheeled_vehicle') &&
    byPlatform.has('tracked_vehicle') &&
    [...byPlatform.keys()].every(
      (platform) => platform === 'wheeled_vehicle' || platform === 'tracked_vehicle',
    )
  );
}

function resolveStrongestPurposeStrength(analysis: EntityAnalysis): number {
  return Math.max(
    analysis.metrics.antiArmor,
    analysis.metrics.antiGround,
    analysis.metrics.antiHelo,
    analysis.metrics.antiPlane,
    analysis.metrics.indirect,
  );
}

function resolveRoleOptionCount(
  kind: RoleDefinition['kind'],
  matching: EntityAnalysis[],
  roleKey?: string,
): RoleDefinition['optionCount'] {
  const maximum =
    roleKey === 'capability:command'
      ? 3
      : kind === 'primary' || kind === 'type'
        ? 3
        : roleKey?.startsWith('capability:indirect_delivery')
          ? 5
          : roleKey === 'capability:stealth' || roleKey === 'capability:mobile_area_air_defense'
            ? 3
            : kind === 'role' || kind === 'trait' || kind === 'capability'
              ? 2
              : 1;
  const representatives: EntityAnalysis[] = [];
  for (const analysis of matching) {
    if (
      representatives.every((representative) => !areNearDuplicateProfiles(analysis, representative))
    ) {
      representatives.push(analysis);
      if (representatives.length >= maximum) {
        return maximum as RoleDefinition['optionCount'];
      }
    }
  }
  return Math.max(1, representatives.length) as RoleDefinition['optionCount'];
}

function deriveBaseRoleTokens(entity: EntityData, typeKey: string): string[] {
  const tokens = new Set<string>();
  tokens.add(`type:${normalizeRoleToken(typeKey)}`);

  if (entity.unitRole) {
    tokens.add(`primary:${normalizeRoleToken(entity.unitRole)}`);
  }
  if (entity.strategicType && entity.strategicType !== 'NotCounted') {
    const strategicRole = normalizeRoleToken(entity.strategicType);
    const primaryRole = entity.unitRole ? normalizeRoleToken(entity.unitRole) : undefined;
    if (!primaryRole) {
      tokens.add(`primary:${strategicRole}`);
    } else if (strategicRole !== primaryRole) {
      tokens.add(`role:${strategicRole}`);
    }
  }
  const negativeCapacityLabels = entity.negativeCapacityNames.map(normalizeCapacityLabel);
  for (const specialty of entity.specialties) {
    const normalized = normalizeRoleToken(specialty);
    if (
      normalized.length > 0 &&
      !negativeCapacityLabels.some(
        (negative) => negative.includes(normalized) || normalized.includes(negative),
      )
    ) {
      tokens.add(`trait:${normalized}`);
    }
  }
  for (const capacityName of entity.positiveCapacityNames) {
    tokens.add(`trait:effect_${normalizeCapacityLabel(capacityName)}`);
  }
  return [...tokens];
}

function normalizeRoleToken(value: string): string {
  const cached = normalizedRoleTokenCache.get(value);
  if (cached !== undefined) {
    return cached;
  }
  const normalized = sanitizeIdentifier(value).toLowerCase();
  normalizedRoleTokenCache.set(value, normalized);
  return normalized;
}

function normalizeCapacityLabel(value: string): string {
  return normalizeRoleToken(value).replace(/^(?:capacite|capacity)_?/u, '');
}

function applyCapabilityTokens(analyses: EntityAnalysis[]): void {
  for (const analysis of analyses) {
    if (analysis.metrics.supply > 0) {
      addRoleToken(analysis, 'capability:supply');
    }
    if (analysis.metrics.command > 0) {
      addRoleToken(analysis, 'capability:command');
    }
    if (analysis.metrics.amphibious > 0) {
      addRoleToken(analysis, 'capability:amphibious');
    }
    if ((analysis.entity.deploymentShiftGru ?? 0) > 0) {
      addRoleToken(analysis, 'capability:forward_deploy');
    }
    if (
      deriveMobilityKey(analysis.entity) === 'Helicopter' &&
      analysis.entity.weaponDescriptorNames.length > 0 &&
      analysis.metrics.antiGround + analysis.metrics.antiArmor > 0
    ) {
      addRoleToken(analysis, 'capability:gunship');
    }
    addWeaponProfileCapability(analysis, 'radar_guided', ['mechanic:trait_radar']);
    addWeaponProfileCapability(analysis, 'sead', ['mechanic:trait_sead']);
    addWeaponProfileCapability(analysis, 'napalm', [
      'mechanic:trait_napalm',
      'mechanic:damage_napalm',
    ]);
    addWeaponProfileCapability(analysis, 'cluster', [
      'mechanic:trait_cluster',
      'mechanic:damage_cluster',
    ]);
    addWeaponProfileCapability(analysis, 'close_quarters', ['mechanic:trait_cac']);
    addWeaponProfileCapability(analysis, 'fire_and_forget', [
      'mechanic:fire_and_forget',
      'mechanic:trait_f_f',
    ]);
    addWeaponProfileCapability(analysis, 'tandem', ['mechanic:tandem', 'mechanic:trait_tandem']);
    addWeaponProfileCapability(analysis, 'high_off_boresight', ['mechanic:trait_f_f_boresight']);
    for (const ammunitionToken of analysis.profileTokens.filter(
      (token) => token.startsWith('ammo:family_') || token.startsWith('ammo:trait_'),
    )) {
      addRoleToken(analysis, `capability:${ammunitionToken.replace(':', '_')}`);
    }
    if (analysis.metrics.precision > 0) {
      addWeaponProfileCapability(analysis, 'top_attack', ['mechanic:top_attack']);
    }
    for (const loadout of analysis.profileTokens.filter((token) => token.startsWith('loadout:'))) {
      addRoleToken(analysis, `capability:${loadout.replace(':', '_')}`);
    }
    const rangeTokens = analysis.profileTokens.filter((token) => token.startsWith('range_class:'));
    for (const rangeToken of rangeTokens) {
      const rangeSignature = rangeToken.slice('range_class:'.length);
      const target = rangeSignature.split('_')[0] ?? '';
      const channels = new Set(
        analysis.profileTokens
          .filter((token) => token.startsWith('channel:'))
          .map((token) => token.slice('channel:'.length)),
      );
      if (channels.has(target)) {
        addRoleToken(analysis, `capability:envelope_${rangeSignature}`);
      }
      if (target === 'ground' && channels.has('indirect')) {
        addRoleToken(analysis, `capability:envelope_indirect_${rangeSignature}`);
      }
    }
  }

  markStandoutCapability(analyses, 'capability:anti_tank', {
    topScoreRatio: 0.5,
    medianMultiplier: 1.45,
    maxShare: 0.4,
    eligible: (analysis) => hasMaterialCombatChannel(analysis, 'antiArmor'),
    score: (analysis) =>
      analysis.metrics.antiArmor +
      analysis.metrics.alphaArmor * 90 +
      analysis.metrics.armorPenetration * 120 +
      analysis.metrics.rangeArmor * 0.45 +
      analysis.metrics.sustainedDps * 0.15 +
      analysis.metrics.directFire * 0.15,
  });
  markParetoCapability(analyses, 'capability:anti_tank_frontier', {
    eligible: (analysis) => hasMaterialCombatChannel(analysis, 'antiArmor'),
    metrics: ['rangeArmor', 'antiArmor', 'armorPenetration', 'mobility', 'stealth', 'response'],
    improvementRatio: 0.005,
    toleranceRatio: 0.0025,
    variant: (analysis) =>
      [
        derivePlatformForm(analysis.entity),
        `range_${resolveRangeBand(analysis.metrics.rangeArmor)}`,
      ].join('_'),
  });
  markStandoutCapability(analyses, 'capability:anti_infantry', {
    topScoreRatio: 0.52,
    medianMultiplier: 1.35,
    maxShare: 0.32,
    eligible: (analysis) => hasMaterialCombatChannel(analysis, 'antiGround'),
    score: (analysis) =>
      analysis.metrics.antiGround +
      analysis.metrics.alphaGround * 70 +
      analysis.metrics.suppression * 0.45 +
      analysis.metrics.splash * 0.75 +
      analysis.metrics.directFire * 0.12,
  });
  markStandoutCapability(analyses, 'capability:anti_plane', {
    topScoreRatio: 0.52,
    medianMultiplier: 1.35,
    maxShare: 0.35,
    eligible: (analysis) => hasMaterialCombatChannel(analysis, 'antiPlane'),
    score: (analysis) =>
      analysis.metrics.antiPlane +
      analysis.metrics.alphaPlane * 90 +
      analysis.metrics.rangePlane * 0.55 +
      analysis.metrics.rangeHelo * 0.12,
  });
  markStandoutCapability(analyses, 'capability:anti_helo', {
    topScoreRatio: 0.52,
    medianMultiplier: 1.35,
    maxShare: 0.35,
    eligible: (analysis) => hasMaterialCombatChannel(analysis, 'antiHelo'),
    score: (analysis) =>
      analysis.metrics.antiHelo +
      analysis.metrics.alphaHelo * 90 +
      analysis.metrics.rangeHelo * 0.45,
  });
  markParetoCapability(analyses, 'capability:mobile_area_air_defense', {
    // Self-defense missiles must not put strike platforms on the AA frontier.
    eligible: (analysis) =>
      hasMaterialCombatChannel(analysis, 'antiPlane') &&
      hasMaterialCombatChannel(analysis, 'antiHelo') &&
      Math.max(analysis.metrics.antiPlane, analysis.metrics.antiHelo) >=
        Math.max(
          analysis.metrics.antiArmor,
          analysis.metrics.antiGround,
          analysis.metrics.indirect,
        ),
    metrics: [
      'rangePlane',
      'rangeHelo',
      'antiPlane',
      'antiHelo',
      'alphaPlane',
      'response',
      'survivability',
      'mobility',
    ],
    variant: (analysis) =>
      [
        derivePlatformForm(analysis.entity),
        `plane_${resolveRangeBand(analysis.metrics.rangePlane)}`,
        `helo_${resolveRangeBand(analysis.metrics.rangeHelo)}`,
      ].join('_'),
  });
  markParetoCapability(analyses, 'capability:indirect_delivery', {
    eligible: (analysis) => analysis.metrics.indirect > 0,
    metrics: [
      'indirect',
      'rangeGround',
      'alphaGround',
      'burstDps',
      'suppression',
      'response',
      'mobility',
      'ammo',
    ],
    improvementRatio: 0.005,
    toleranceRatio: 0.0025,
    variant: (analysis) => {
      const payloadFamilies = analysis.profileTokens
        .filter((token) => token.startsWith('ammo:family_'))
        .map((token) => token.slice('ammo:'.length))
        .sort()
        .join('_');
      return [
        analysis.typeKey,
        payloadFamilies || 'unspecified',
        `range_${resolveRangeBand(analysis.metrics.rangeGround)}`,
      ].join('_');
    },
  });
  markStandoutCapability(analyses, 'capability:indirect_fire', {
    topScoreRatio: 0.5,
    medianMultiplier: 1.4,
    maxShare: 0.35,
    eligible: (analysis) => analysis.metrics.indirect > 0,
    score: (analysis) =>
      analysis.metrics.indirect +
      analysis.metrics.alphaGround * 80 +
      analysis.metrics.splash * 0.35 +
      analysis.metrics.rangeGround * 0.25,
  });
  markStandoutCapability(analyses, 'capability:counter_battery', {
    topScoreRatio: 0.68,
    medianMultiplier: 1.65,
    maxShare: 0.2,
    eligible: (analysis) => analysis.metrics.indirect > 0,
    score: (analysis) =>
      analysis.metrics.indirect > 0
        ? analysis.metrics.rangeGround * 1.3 +
          analysis.metrics.splash * 0.35 +
          analysis.metrics.mobility * 0.08
        : 0,
  });
  markStandoutCapability(analyses, 'capability:indirect_saturation', {
    topScoreRatio: 0.55,
    medianMultiplier: 1.45,
    maxShare: 0.25,
    eligible: (analysis) => analysis.metrics.indirect > 0,
    score: (analysis) =>
      analysis.metrics.burstDps * 1.5 +
      analysis.metrics.alphaGround * 90 +
      analysis.metrics.suppression * 0.7 +
      analysis.metrics.splash * 0.8,
  });
  markStandoutCapability(analyses, 'capability:indirect_heavy_shot', {
    topScoreRatio: 0.58,
    medianMultiplier: 1.45,
    maxShare: 0.22,
    eligible: (analysis) => analysis.metrics.indirect > 0,
    score: (analysis) =>
      analysis.metrics.oneShotGround * 2 +
      analysis.metrics.alphaGround * 100 +
      analysis.metrics.rangeGround * 0.65 +
      analysis.metrics.precision * 0.45,
  });
  markStandoutCapability(analyses, 'capability:precision_strike', {
    topScoreRatio: 0.58,
    medianMultiplier: 1.45,
    maxShare: 0.2,
    eligible: (analysis) => analysis.metrics.precision > 0,
    score: (analysis) =>
      analysis.metrics.precision > 0
        ? analysis.metrics.precision +
          analysis.metrics.rangeGround * 0.28 +
          analysis.metrics.stealth * 0.45 +
          analysis.metrics.survivability * 0.04
        : 0,
  });
  markStandoutCapability(analyses, 'capability:long_range', {
    topScoreRatio: 0.58,
    medianMultiplier: 1.25,
    maxShare: 0.3,
    score: (analysis) =>
      analysis.metrics.rangeGround +
      Math.max(analysis.metrics.rangeHelo, analysis.metrics.rangePlane) * 0.95 +
      analysis.metrics.antiPlane * 0.08 +
      analysis.metrics.antiArmor * 0.08,
  });
  markStandoutCapability(analyses, 'capability:stealth', {
    topScoreRatio: 0.56,
    medianMultiplier: 1.3,
    maxShare: 0.25,
    score: (analysis) =>
      analysis.metrics.stealth * 8 +
      analysis.metrics.antiGround * 0.02 +
      analysis.metrics.antiArmor * 0.02 +
      analysis.metrics.indirect * 0.02 +
      analysis.metrics.survivability * 0.02 +
      analysis.metrics.mobility * 0.01,
  });
  markStandoutCapability(analyses, 'capability:durable', {
    topScoreRatio: 0.56,
    medianMultiplier: 1.3,
    maxShare: 0.28,
    score: (analysis) =>
      analysis.metrics.survivability +
      analysis.metrics.antiGround * 0.06 +
      analysis.metrics.antiArmor * 0.08,
  });
  markStandoutCapability(analyses, 'capability:fast', {
    topScoreRatio: 0.58,
    medianMultiplier: 1.2,
    maxShare: 0.28,
    score: (analysis) => analysis.metrics.mobility + analysis.metrics.stealth * 0.15,
  });
  markStandoutCapability(analyses, 'capability:fire_on_move', {
    topScoreRatio: 0.55,
    medianMultiplier: 1.3,
    maxShare: 0.28,
    score: (analysis) => analysis.metrics.fireOnMove,
  });
  markStandoutCapability(analyses, 'capability:initiative', {
    topScoreRatio: 0.58,
    medianMultiplier: 1.3,
    maxShare: 0.28,
    score: (analysis) => analysis.metrics.initiative,
  });
  markStandoutCapability(analyses, 'capability:optics', {
    topScoreRatio: 0.6,
    medianMultiplier: 1.25,
    maxShare: 0.28,
    score: (analysis) =>
      analysis.metrics.optics + analysis.metrics.stealth * 0.18 + analysis.metrics.mobility * 0.05,
  });
  markStandoutCapability(analyses, 'capability:weapon_variety', {
    topScoreRatio: 0.6,
    medianMultiplier: 1.2,
    maxShare: 0.28,
    score: (analysis) =>
      analysis.metrics.weaponVariety +
      analysis.metrics.antiGround * 0.08 +
      analysis.metrics.antiArmor * 0.1 +
      analysis.metrics.antiPlane * 0.08 +
      analysis.metrics.antiHelo * 0.08,
  });
  markStandoutCapability(analyses, 'capability:endurance', {
    topScoreRatio: 0.58,
    medianMultiplier: 1.2,
    maxShare: 0.3,
    eligible: (analysis) =>
      analysis.metrics.sustainedDps > 0 || (analysis.entity.fuelMoveDuration ?? 0) > 0,
    score: (analysis) =>
      analysis.metrics.sustainedDps * 2.5 +
      analysis.metrics.mobility +
      analysis.metrics.survivability * 0.05,
  });
  markStandoutCapability(analyses, 'capability:suppression', {
    topScoreRatio: 0.55,
    medianMultiplier: 1.3,
    maxShare: 0.3,
    score: (analysis) =>
      analysis.metrics.suppression +
      analysis.metrics.splash * 0.7 +
      analysis.metrics.rangeGround * 0.2,
  });
  markStandoutCapability(analyses, 'capability:heavy_alpha', {
    topScoreRatio: 0.62,
    medianMultiplier: 1.45,
    maxShare: 0.22,
    eligible: (analysis) =>
      Math.max(
        analysis.metrics.alphaArmor,
        analysis.metrics.alphaGround,
        analysis.metrics.alphaHelo,
        analysis.metrics.alphaPlane,
      ) > 0,
    score: (analysis) =>
      Math.max(
        analysis.metrics.alphaArmor * 9,
        analysis.metrics.alphaGround * 100,
        analysis.metrics.alphaHelo * 100,
        analysis.metrics.alphaPlane * 100,
      ) +
      analysis.metrics.response * 0.4,
  });
  markStandoutCapability(analyses, 'capability:rapid_response', {
    topScoreRatio: 0.6,
    medianMultiplier: 1.4,
    maxShare: 0.22,
    eligible: (analysis) => analysis.metrics.burstDps > 0,
    score: (analysis) => analysis.metrics.burstDps + analysis.metrics.response * 1.8,
  });
  markStandoutCapability(analyses, 'capability:sustained_fire', {
    topScoreRatio: 0.6,
    medianMultiplier: 1.4,
    maxShare: 0.22,
    eligible: (analysis) => analysis.metrics.sustainedDps > 0,
    score: (analysis) => analysis.metrics.sustainedDps,
  });
  markStandoutCapability(analyses, 'capability:positive_effect', {
    topScoreRatio: 0.5,
    medianMultiplier: 1.2,
    maxShare: 0.35,
    eligible: (analysis) => analysis.metrics.effect > 0,
    score: (analysis) => analysis.metrics.effect,
  });
  markStandoutCapability(analyses, 'capability:armed_positive_effect', {
    // A debuff aura combined with a real payload (e.g. jammer + SEAD missiles)
    // is a distinct tool from either a pure jammer or a pure strike platform.
    topScoreRatio: 0.55,
    medianMultiplier: 1.3,
    maxShare: 0.15,
    eligible: (analysis) =>
      analysis.metrics.effect > 0 &&
      analysis.entity.positiveEffectTokens.some((token) => token.includes('ennemi')) &&
      resolveStrongestPurposeStrength(analysis) > 0,
    score: (analysis) => analysis.metrics.effect + resolveStrongestPurposeStrength(analysis) * 0.2,
  });
  markStandoutCapability(analyses, 'capability:high_availability', {
    topScoreRatio: 0.6,
    medianMultiplier: 1.35,
    maxShare: 0.25,
    score: (analysis) => analysis.metrics.availability,
  });
}

function addWeaponProfileCapability(
  analysis: EntityAnalysis,
  name: string,
  profileTokens: string[],
): void {
  const normalizedTokens = new Set(analysis.profileTokens.map((token) => token.toLowerCase()));
  if (profileTokens.some((token) => normalizedTokens.has(token))) {
    addRoleToken(analysis, `capability:${name}`);
  }
}

function hasMaterialCombatChannel(
  analysis: EntityAnalysis,
  metric: 'antiArmor' | 'antiGround' | 'antiHelo' | 'antiPlane',
): boolean {
  const score = analysis.metrics[metric];
  if (score <= 0) {
    return false;
  }
  const strongestPurpose = Math.max(
    analysis.metrics.antiArmor,
    analysis.metrics.antiGround,
    analysis.metrics.antiHelo,
    analysis.metrics.antiPlane,
    analysis.metrics.indirect,
  );
  return strongestPurpose <= 0 || score >= strongestPurpose * 0.12;
}

function markStandoutCapability(
  analyses: EntityAnalysis[],
  token: string,
  options: {
    topScoreRatio: number;
    medianMultiplier: number;
    maxShare: number;
    eligible?: (analysis: EntityAnalysis) => boolean;
    score: (analysis: EntityAnalysis) => number;
  },
): void {
  const scored = analyses
    .map((analysis) => ({
      analysis,
      score: options.eligible?.(analysis) === false ? 0 : options.score(analysis),
    }))
    .filter((entry) => Number.isFinite(entry.score) && entry.score > 0)
    .sort((left, right) => right.score - left.score);
  if (scored.length === 0) {
    return;
  }

  const topScore = scored[0]?.score ?? 0;
  if (topScore <= 0) {
    return;
  }
  const bottomScore = scored[scored.length - 1]?.score ?? topScore;
  if (scored.length > 1 && topScore - bottomScore <= Math.max(1, topScore * 0.03)) {
    // A tied or practically flat metric has no standouts. In particular, all
    // unlimited cards have identical availability and must not receive an
    // arbitrary role based on lexical order.
    return;
  }

  const medianScore = resolveMedian(scored.map((entry) => entry.score));
  // With 1-2 candidates the median tracks the top and would veto a specialist.
  const threshold =
    scored.length >= 3
      ? Math.max(topScore * options.topScoreRatio, medianScore * options.medianMultiplier)
      : topScore * options.topScoreRatio;
  const maxCount = Math.max(1, Math.ceil(scored.length * options.maxShare));
  const eligible = scored.filter((entry) => entry.score >= threshold);
  const cutoffScore = eligible[Math.min(eligible.length, maxCount) - 1]?.score;
  if (cutoffScore === undefined) {
    // No one clears the threshold: promoting a top-1 would fabricate a role.
    return;
  }

  for (const entry of eligible.filter((candidate) => candidate.score >= cutoffScore)) {
    addRoleToken(entry.analysis, token);
  }
}

function markParetoCapability(
  analyses: EntityAnalysis[],
  token: string,
  options: {
    eligible: (analysis: EntityAnalysis) => boolean;
    improvementRatio?: number;
    metrics: MetricKey[];
    toleranceRatio?: number;
    variant?: (analysis: EntityAnalysis) => string | undefined;
  },
): void {
  const candidates = analyses.filter(options.eligible);
  const maximums = new Map(
    options.metrics.map((metric) => [
      metric,
      Math.max(...candidates.map((analysis) => analysis.metrics[metric]), 0),
    ]),
  );
  for (const candidate of candidates) {
    const dominated = candidates.some((other) => {
      if (other === candidate) {
        return false;
      }
      let materiallyBetter = false;
      for (const metric of options.metrics) {
        const maximum = maximums.get(metric) ?? 0;
        const tolerance = maximum * (options.toleranceRatio ?? 0.01);
        const improvement = maximum * (options.improvementRatio ?? 0.03);
        if (other.metrics[metric] + tolerance < candidate.metrics[metric]) {
          return false;
        }
        if (other.metrics[metric] > candidate.metrics[metric] + improvement) {
          materiallyBetter = true;
        }
      }
      return materiallyBetter;
    });
    if (!dominated) {
      addRoleToken(candidate, token);
      const variant = options.variant?.(candidate);
      if (variant) addRoleToken(candidate, `${token}_${normalizeRoleToken(variant)}`);
    }
  }
}

function addRoleToken(analysis: EntityAnalysis, token: string): void {
  if (analysis.exactRoleTokens.has(token)) {
    return;
  }
  analysis.roleTokens.push(token);
  analysis.exactRoleTokens.add(token);
}

function applyRelativeMetrics(analyses: EntityAnalysis[]): void {
  for (const metricKey of METRIC_KEYS) {
    const ranked = [...analyses].sort(
      (left, right) => left.metrics[metricKey] - right.metrics[metricKey],
    );
    const maximumRank = Math.max(1, ranked.length - 1);
    const maximumValue = Math.max(...ranked.map((analysis) => analysis.metrics[metricKey]), 0);
    let index = 0;
    while (index < ranked.length) {
      const value = ranked[index]?.metrics[metricKey] ?? 0;
      let end = index + 1;
      while (end < ranked.length && ranked[end]?.metrics[metricKey] === value) {
        end += 1;
      }
      const percentile = ((index + end - 1) / 2 / maximumRank) * 1_000;
      const magnitude = value > 0 && maximumValue > 0 ? Math.sqrt(value / maximumValue) * 1_000 : 0;
      for (let rankedIndex = index; rankedIndex < end; rankedIndex += 1) {
        const analysis = ranked[rankedIndex];
        if (analysis) {
          analysis.relativeMetrics[metricKey] = value > 0 ? magnitude * 0.8 + percentile * 0.2 : 0;
        }
      }
      index = end;
    }
  }
}

function buildSimilarityKey(entity: EntityData, metrics: Record<MetricKey, number>): string {
  return [
    sanitizeIdentifier(entity.factoryType ?? 'Unknown'),
    sanitizeIdentifier(entity.unitRole ?? entity.strategicType ?? 'Unknown'),
    sanitizeIdentifier(entity.menuIconTexture ?? 'Unknown'),
    bucket(metrics.antiArmor),
    bucket(metrics.antiGround),
    bucket(metrics.antiPlane + metrics.antiHelo),
    bucket(metrics.fireOnMove),
    bucket(metrics.initiative),
    bucket(metrics.mobility),
    bucket(metrics.survivability),
    bucket(entity.cost),
  ].join('|');
}

function buildCategoryAnalysisStats(analyses: EntityAnalysis[]): CategoryAnalysisStats {
  const costs = analyses.map((analysis) => analysis.entity.cost);
  const sum = costs.reduce((total, value) => total + value, 0);
  return {
    averageCost: costs.length > 0 ? sum / costs.length : 0,
  };
}

function inferRoleFocus(token: string, includeFallback = true): Partial<Record<MetricKey, number>> {
  const normalized = token.toLowerCase();
  const terms = new Set(normalized.split(/[^a-z0-9]+/u).filter(Boolean));
  const focus: Partial<Record<MetricKey, number>> = {};
  const isWheeledPlatformRole = normalized.includes('platform_wheeled_vehicle_');
  const isTrackedPlatformRole = normalized.includes('platform_tracked_vehicle_');

  if (normalized.includes('loadout_armor')) {
    focus.antiArmor = (focus.antiArmor ?? 0) + 2.8;
    focus.rangeArmor = (focus.rangeArmor ?? 0) + 0.8;
    focus.oneShotArmor = (focus.oneShotArmor ?? 0) + 0.45;
  }
  if (normalized.includes('loadout_ground')) {
    focus.antiGround = (focus.antiGround ?? 0) + 2.6;
    focus.alphaGround = (focus.alphaGround ?? 0) + 0.55;
    focus.suppression = (focus.suppression ?? 0) + 0.45;
  }
  if (normalized.includes('loadout_helo')) {
    focus.antiHelo = (focus.antiHelo ?? 0) + 2.8;
    focus.rangeHelo = (focus.rangeHelo ?? 0) + 0.8;
    focus.oneShotHelo = (focus.oneShotHelo ?? 0) + 0.45;
  }
  if (normalized.includes('loadout_plane')) {
    focus.antiPlane = (focus.antiPlane ?? 0) + 2.8;
    focus.rangePlane = (focus.rangePlane ?? 0) + 0.8;
    focus.oneShotPlane = (focus.oneShotPlane ?? 0) + 0.45;
  }
  if (normalized.includes('loadout_indirect')) {
    focus.indirect = (focus.indirect ?? 0) + 2.8;
    focus.rangeGround = (focus.rangeGround ?? 0) + 0.8;
    focus.alphaGround = (focus.alphaGround ?? 0) + 0.45;
  }

  if (
    normalized.includes('anti_tank') ||
    normalized.includes('tankdestroyer') ||
    normalized.includes('tank_destroyer') ||
    normalized.includes('chasseurdechar') ||
    terms.has('at') ||
    terms.has('td')
  ) {
    focus.antiArmor = (focus.antiArmor ?? 0) + 3.8;
    focus.alphaArmor = (focus.alphaArmor ?? 0) + 1.1;
    focus.oneShotArmor = (focus.oneShotArmor ?? 0) + 0.8;
    focus.burstDps = (focus.burstDps ?? 0) + 0.45;
    focus.sustainedDps = (focus.sustainedDps ?? 0) + 0.55;
    focus.response = (focus.response ?? 0) + 0.35;
    focus.armorPenetration = (focus.armorPenetration ?? 0) + 1.5;
    focus.rangeArmor = (focus.rangeArmor ?? 0) + 1.1;
    focus.ammo = (focus.ammo ?? 0) + 0.6;
    if (isWheeledPlatformRole) {
      focus.rangeArmor = (focus.rangeArmor ?? 0) + 1.7;
      focus.antiArmor = (focus.antiArmor ?? 0) + 1.35;
      focus.alphaArmor = (focus.alphaArmor ?? 0) + 1.15;
      focus.armorPenetration = (focus.armorPenetration ?? 0) + 1.1;
      focus.mobility = (focus.mobility ?? 0) + 0.55;
      focus.stealth = (focus.stealth ?? 0) + 0.4;
      focus.response = (focus.response ?? 0) + 0.2;
    }
    if (isTrackedPlatformRole) {
      focus.survivability = (focus.survivability ?? 0) + 0.9;
      focus.fireOnMove = (focus.fireOnMove ?? 0) + 0.2;
    }
  }
  if (
    normalized.includes('anti_plane') ||
    terms.has('aa') ||
    terms.has('manpad') ||
    terms.has('sam') ||
    terms.has('dca')
  ) {
    focus.antiPlane = (focus.antiPlane ?? 0) + 3.4;
    focus.alphaPlane = (focus.alphaPlane ?? 0) + 1;
    focus.oneShotPlane = (focus.oneShotPlane ?? 0) + 0.8;
    focus.burstDps = (focus.burstDps ?? 0) + 0.55;
    focus.response = (focus.response ?? 0) + 0.45;
    focus.antiHelo = (focus.antiHelo ?? 0) + 1.2;
    focus.rangePlane = (focus.rangePlane ?? 0) + 1.1;
    focus.rangeHelo = (focus.rangeHelo ?? 0) + 0.45;
    focus.mobility = (focus.mobility ?? 0) + 0.4;
    focus.survivability = (focus.survivability ?? 0) + 0.3;
  }
  if (normalized.includes('anti_helo')) {
    focus.antiHelo = (focus.antiHelo ?? 0) + 3.1;
    focus.alphaHelo = (focus.alphaHelo ?? 0) + 0.8;
    focus.oneShotHelo = (focus.oneShotHelo ?? 0) + 0.65;
    focus.rangeHelo = (focus.rangeHelo ?? 0) + 1;
  }
  if (normalized.includes('mobile_area_air_defense')) {
    focus.antiPlane = (focus.antiPlane ?? 0) + 2.6;
    focus.antiHelo = (focus.antiHelo ?? 0) + 2;
    focus.rangePlane = (focus.rangePlane ?? 0) + 1.5;
    focus.rangeHelo = (focus.rangeHelo ?? 0) + 1;
    focus.survivability = (focus.survivability ?? 0) + 0.65;
    focus.mobility = (focus.mobility ?? 0) + 0.65;
  }
  if (normalized.includes('envelope_plane')) {
    focus.antiPlane = (focus.antiPlane ?? 0) + 2.8;
    focus.rangePlane = (focus.rangePlane ?? 0) + 2.4;
    focus.oneShotPlane = (focus.oneShotPlane ?? 0) + 0.55;
  }
  if (normalized.includes('envelope_helo')) {
    focus.antiHelo = (focus.antiHelo ?? 0) + 2.8;
    focus.rangeHelo = (focus.rangeHelo ?? 0) + 2.4;
    focus.oneShotHelo = (focus.oneShotHelo ?? 0) + 0.55;
  }
  if (normalized.includes('envelope_armor')) {
    focus.antiArmor = (focus.antiArmor ?? 0) + 2.8;
    focus.rangeArmor = (focus.rangeArmor ?? 0) + 2.4;
    focus.oneShotArmor = (focus.oneShotArmor ?? 0) + 0.55;
  }
  if (normalized.includes('envelope_indirect')) {
    focus.indirect = (focus.indirect ?? 0) + 3;
    focus.rangeGround = (focus.rangeGround ?? 0) + 2.4;
    focus.alphaGround = (focus.alphaGround ?? 0) + 0.6;
  }
  if (normalized.includes('anti_infantry')) {
    focus.antiGround = (focus.antiGround ?? 0) + 3.4;
    focus.alphaGround = (focus.alphaGround ?? 0) + 0.8;
    focus.oneShotGround = (focus.oneShotGround ?? 0) + 0.45;
    focus.suppression = (focus.suppression ?? 0) + 1.5;
    focus.splash = (focus.splash ?? 0) + 1.2;
  }
  if (
    normalized.includes('mortar') ||
    normalized.includes('howitzer') ||
    normalized.includes('mlrs') ||
    normalized.includes('indirect')
  ) {
    focus.indirect = (focus.indirect ?? 0) + 3.8;
    focus.alphaGround = (focus.alphaGround ?? 0) + 0.8;
    focus.oneShotGround = (focus.oneShotGround ?? 0) + 0.65;
    focus.burstDps = (focus.burstDps ?? 0) + 0.55;
    focus.response = (focus.response ?? 0) + 0.5;
    focus.rangeGround = (focus.rangeGround ?? 0) + 0.9;
    focus.splash = (focus.splash ?? 0) + 1.2;
    focus.ammo = (focus.ammo ?? 0) + 0.5;
    focus.mobility = (focus.mobility ?? 0) + 0.45;
    focus.initiative = (focus.initiative ?? 0) + 0.3;
  }
  if (normalized.includes('counter_battery')) {
    focus.indirect = (focus.indirect ?? 0) + 3.2;
    focus.rangeGround = (focus.rangeGround ?? 0) + 1.8;
    focus.mobility = (focus.mobility ?? 0) + 0.5;
    focus.alphaGround = (focus.alphaGround ?? 0) + 0.8;
    focus.response = (focus.response ?? 0) + 0.35;
  }
  if (normalized.includes('indirect_delivery')) {
    focus.indirect = (focus.indirect ?? 0) + 3;
    focus.alphaGround = (focus.alphaGround ?? 0) + 1.7;
    focus.ammo = (focus.ammo ?? 0) + 1.5;
    focus.burstDps = (focus.burstDps ?? 0) + 1.2;
    focus.suppression = (focus.suppression ?? 0) + 1;
    focus.rangeGround = (focus.rangeGround ?? 0) + 0.8;
    focus.response = (focus.response ?? 0) + 0.55;
    focus.mobility = (focus.mobility ?? 0) + 0.35;
  }
  if (normalized.includes('indirect_saturation')) {
    focus.indirect = (focus.indirect ?? 0) + 2.8;
    focus.burstDps = (focus.burstDps ?? 0) + 2;
    focus.suppression = (focus.suppression ?? 0) + 1.6;
    focus.splash = (focus.splash ?? 0) + 1.2;
  }
  if (normalized.includes('indirect_heavy_shot')) {
    focus.indirect = (focus.indirect ?? 0) + 2.8;
    focus.oneShotGround = (focus.oneShotGround ?? 0) + 2.2;
    focus.alphaGround = (focus.alphaGround ?? 0) + 1.6;
    focus.rangeGround = (focus.rangeGround ?? 0) + 1.2;
  }
  if (normalized.includes('precision_strike') || normalized.includes('top_attack')) {
    focus.precision = (focus.precision ?? 0) + 4.2;
    focus.rangeGround = (focus.rangeGround ?? 0) + 0.7;
    focus.stealth = (focus.stealth ?? 0) + 1.1;
    focus.survivability = (focus.survivability ?? 0) + 0.6;
  }
  if (normalized.includes('reco') || normalized.includes('recon') || normalized.includes('scout')) {
    focus.optics = (focus.optics ?? 0) + 3.4;
    focus.stealth = (focus.stealth ?? 0) + 2.2;
    focus.mobility = (focus.mobility ?? 0) + 1.1;
  }
  if (normalized.includes('optics') || normalized.includes('radar')) {
    focus.optics = (focus.optics ?? 0) + 3.2;
    focus.rangePlane = (focus.rangePlane ?? 0) + 0.2;
    focus.rangeHelo = (focus.rangeHelo ?? 0) + 0.1;
    focus.stealth = (focus.stealth ?? 0) + 0.4;
  }
  if (
    normalized.includes('jammer') ||
    normalized.includes('sigint') ||
    normalized.includes('singint') ||
    normalized.includes('electronic_warfare') ||
    terms.has('ew')
  ) {
    focus.effect = (focus.effect ?? 0) + 2.6;
    focus.optics = (focus.optics ?? 0) + 2.4;
    focus.stealth = (focus.stealth ?? 0) + 1.2;
    focus.survivability = (focus.survivability ?? 0) + 0.6;
  }
  if (normalized.includes('command') || terms.has('cmd')) {
    focus.command = (focus.command ?? 0) + 4.2;
    focus.survivability = (focus.survivability ?? 0) + 1;
  }
  if (normalized.includes('supply') || normalized.includes('logistic')) {
    focus.supply = (focus.supply ?? 0) + 4.2;
    focus.mobility = (focus.mobility ?? 0) + 1.3;
  }
  if (normalized.includes('long_range') || normalized.includes('range')) {
    focus.rangeGround = (focus.rangeGround ?? 0) + 1.4;
    focus.rangePlane = (focus.rangePlane ?? 0) + 0.65;
    focus.rangeHelo = (focus.rangeHelo ?? 0) + 0.65;
    focus.antiPlane = (focus.antiPlane ?? 0) + 0.35;
    focus.antiArmor = (focus.antiArmor ?? 0) + 0.35;
  }
  if (
    normalized.includes('shock') ||
    normalized.includes('choc') ||
    normalized.includes('engineer') ||
    normalized.includes('assault')
  ) {
    focus.closeCombat = (focus.closeCombat ?? 0) + 2.5;
    focus.antiGround = (focus.antiGround ?? 0) + 1.4;
    focus.survivability = (focus.survivability ?? 0) + 2.2;
    focus.suppression = (focus.suppression ?? 0) + 0.6;
  }
  if (normalized.includes('sf') || normalized.includes('special_forces')) {
    focus.stealth = (focus.stealth ?? 0) + 2.8;
    focus.mobility = (focus.mobility ?? 0) + 1.1;
    focus.antiGround = (focus.antiGround ?? 0) + 1.6;
  }
  if (normalized.includes('forward_deploy') || normalized.includes('initiative')) {
    focus.initiative = (focus.initiative ?? 0) + 3.8;
    focus.mobility = (focus.mobility ?? 0) + 0.8;
    focus.optics = (focus.optics ?? 0) + 0.4;
  }
  if (normalized.includes('gunship')) {
    focus.antiGround = (focus.antiGround ?? 0) + 2.4;
    focus.antiArmor = (focus.antiArmor ?? 0) + 1.8;
    focus.optics = (focus.optics ?? 0) + 0.8;
    focus.mobility = (focus.mobility ?? 0) + 0.6;
  }
  if (normalized.includes('fire_on_move')) {
    focus.fireOnMove = (focus.fireOnMove ?? 0) + 4;
    focus.mobility = (focus.mobility ?? 0) + 0.7;
  }
  if (normalized.includes('radar_guided')) {
    focus.antiPlane = (focus.antiPlane ?? 0) + 2.6;
    focus.rangePlane = (focus.rangePlane ?? 0) + 1.5;
    focus.rangeHelo = (focus.rangeHelo ?? 0) + 0.5;
  }
  if (normalized.includes('sead')) {
    focus.rangeGround = (focus.rangeGround ?? 0) + 1.3;
    focus.mobility = (focus.mobility ?? 0) + 0.5;
  }
  if (normalized.includes('smoke')) {
    focus.indirect = (focus.indirect ?? 0) + 1.8;
    focus.ammo = (focus.ammo ?? 0) + 1.2;
  }
  if (normalized.includes('napalm')) {
    focus.antiGround = (focus.antiGround ?? 0) + 2.4;
    focus.suppression = (focus.suppression ?? 0) + 1.5;
    focus.splash = (focus.splash ?? 0) + 0.8;
  }
  if (normalized.includes('cluster')) {
    focus.antiArmor = (focus.antiArmor ?? 0) + 2.2;
    focus.splash = (focus.splash ?? 0) + 1.4;
    focus.rangeGround = (focus.rangeGround ?? 0) + 0.5;
  }
  if (
    normalized.includes('fire_and_forget') ||
    normalized.includes('tandem') ||
    normalized.includes('high_off_boresight')
  ) {
    focus.antiArmor = (focus.antiArmor ?? 0) + 1.8;
    focus.armorPenetration = (focus.armorPenetration ?? 0) + 0.6;
    focus.antiPlane = (focus.antiPlane ?? 0) + 1.2;
    focus.antiHelo = (focus.antiHelo ?? 0) + 1.2;
    focus.rangeGround = (focus.rangeGround ?? 0) + 0.5;
  }
  if (normalized.includes('close_quarters')) {
    focus.closeCombat = (focus.closeCombat ?? 0) + 3.2;
    focus.antiGround = (focus.antiGround ?? 0) + 0.8;
    focus.suppression = (focus.suppression ?? 0) + 1.2;
  }
  if (normalized.includes('amphib')) {
    focus.amphibious = (focus.amphibious ?? 0) + 3.5;
    focus.mobility = (focus.mobility ?? 0) + 0.8;
  }
  if (normalized.includes('durable') || normalized.includes('armor')) {
    focus.survivability = (focus.survivability ?? 0) + 3.5;
    focus.antiArmor = (focus.antiArmor ?? 0) + 1.1;
    focus.armorPenetration = (focus.armorPenetration ?? 0) + 0.55;
  }
  if (normalized.includes('fast')) {
    focus.mobility = (focus.mobility ?? 0) + 3.3;
    focus.stealth = (focus.stealth ?? 0) + 0.4;
  }
  if (normalized.includes('stealth')) {
    focus.stealth = (focus.stealth ?? 0) + 13;
    focus.survivability = (focus.survivability ?? 0) + 0.5;
    focus.precision = (focus.precision ?? 0) + 0.35;
  }
  if (normalized.includes('weapon_variety')) {
    focus.weaponVariety = (focus.weaponVariety ?? 0) + 3.8;
    focus.antiGround = (focus.antiGround ?? 0) + 0.7;
    focus.antiArmor = (focus.antiArmor ?? 0) + 0.7;
    focus.antiPlane = (focus.antiPlane ?? 0) + 0.7;
    focus.antiHelo = (focus.antiHelo ?? 0) + 0.7;
  }
  if (normalized.includes('heavy_alpha')) {
    focus.alphaArmor = (focus.alphaArmor ?? 0) + 1.6;
    focus.alphaGround = (focus.alphaGround ?? 0) + 1.6;
    focus.alphaHelo = (focus.alphaHelo ?? 0) + 1.6;
    focus.alphaPlane = (focus.alphaPlane ?? 0) + 1.6;
    focus.response = (focus.response ?? 0) + 0.4;
  }
  if (normalized.includes('rapid_response')) {
    focus.response = (focus.response ?? 0) + 3.2;
    focus.burstDps = (focus.burstDps ?? 0) + 2.2;
  }
  if (normalized.includes('sustained_fire')) {
    focus.sustainedDps = (focus.sustainedDps ?? 0) + 3.8;
  }
  if (normalized.includes('positive_effect') || normalized.includes('effect_')) {
    focus.effect = (focus.effect ?? 0) + 3.5;
  }
  if (normalized.includes('infantry')) {
    focus.survivability = (focus.survivability ?? 0) + 3.2;
    focus.antiGround = (focus.antiGround ?? 0) + 1.7;
    focus.antiArmor = (focus.antiArmor ?? 0) + 0.35;
    focus.closeCombat = (focus.closeCombat ?? 0) + 0.7;
    focus.weaponVariety = (focus.weaponVariety ?? 0) + 0.35;
  }
  if (normalized.includes('transport')) {
    focus.mobility = (focus.mobility ?? 0) + 3;
    focus.survivability = (focus.survivability ?? 0) + 1.3;
    focus.fireOnMove = (focus.fireOnMove ?? 0) + 0.35;
    focus.weaponVariety = (focus.weaponVariety ?? 0) + 0.2;
  }
  if (
    normalized.includes('appui') ||
    normalized.includes('air_support') ||
    normalized.includes('hel_support')
  ) {
    focus.antiGround = (focus.antiGround ?? 0) + 2.7;
    focus.antiArmor = (focus.antiArmor ?? 0) + 1.5;
    focus.survivability = (focus.survivability ?? 0) + 1.2;
    focus.weaponVariety = (focus.weaponVariety ?? 0) + 0.45;
  }
  if (normalized.includes('ifv')) {
    focus.antiGround = (focus.antiGround ?? 0) + 1.8;
    focus.antiArmor = (focus.antiArmor ?? 0) + 1.5;
    focus.survivability = (focus.survivability ?? 0) + 1;
    focus.mobility = (focus.mobility ?? 0) + 0.5;
    focus.weaponVariety = (focus.weaponVariety ?? 0) + 0.45;
  }
  if (terms.has('hq') || normalized.includes('headquarters')) {
    focus.command = (focus.command ?? 0) + 4;
    focus.survivability = (focus.survivability ?? 0) + 1;
    focus.mobility = (focus.mobility ?? 0) + 0.45;
  }
  if (normalized.includes('endurance')) {
    focus.mobility = (focus.mobility ?? 0) + 1.2;
    focus.survivability = (focus.survivability ?? 0) + 0.5;
  }
  if (normalized.includes('suppression')) {
    focus.suppression = (focus.suppression ?? 0) + 3.4;
    focus.splash = (focus.splash ?? 0) + 1.2;
    focus.rangeGround = (focus.rangeGround ?? 0) + 0.4;
  }
  if (normalized.includes('high_availability')) {
    focus.availability = (focus.availability ?? 0) + 3.8;
  }

  if (includeFallback && Object.keys(focus).length === 0) {
    focus.value = 1.1;
    focus.directFire = 1;
    focus.survivability = 0.9;
  }

  return focus;
}

function deriveEmpiricalRoleFocus(
  token: string,
  analyses: EntityAnalysis[],
): Partial<Record<MetricKey, number>> {
  const matching = analyses.filter((analysis) => analysis.exactRoleTokens.has(token));
  if (matching.length === 0 || matching.length === analyses.length) {
    return {};
  }
  const focus: Partial<Record<MetricKey, number>> = {};
  for (const metricKey of METRIC_KEYS) {
    if (metricKey === 'value' || metricKey === 'availability') {
      continue;
    }
    const matchingAverage = resolveAverage(
      matching.map((analysis) => analysis.relativeMetrics[metricKey]),
    );
    const categoryAverage = resolveAverage(
      analyses.map((analysis) => analysis.relativeMetrics[metricKey]),
    );
    const advantage = matchingAverage - categoryAverage;
    if (advantage >= 150) {
      focus[metricKey] = Math.min(3, advantage / 180);
    }
  }
  return focus;
}

function mergeRoleFocus(
  semantic: Partial<Record<MetricKey, number>>,
  empirical: Partial<Record<MetricKey, number>>,
): Partial<Record<MetricKey, number>> {
  const merged = { ...semantic };
  // Empirical correlations discover unknown/modded roles. When the token already
  // identifies a well-understood purpose, keep correlations as supporting
  // evidence so incidental traits cannot outweigh the role-defining metrics.
  const empiricalWeight = Object.keys(semantic).length > 0 ? 0.35 : 1;
  for (const [metricKey, weight] of Object.entries(empirical)) {
    const key = metricKey as MetricKey;
    merged[key] = (merged[key] ?? 0) + (weight ?? 0) * empiricalWeight;
  }
  return merged;
}

function resolveAverage(values: number[]): number {
  return values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function isEffectiveAntiArmorAmmunition(ammo: AmmunitionData): boolean {
  if ((ammo.armorPenetration ?? 0) < 8) {
    return false;
  }
  const tokens = collectAmmunitionTokens(ammo);
  return (
    ammo.piercingWeapon === true ||
    tokens.has('ap') ||
    tokens.has('heat') ||
    tokens.has('kinetic') ||
    tokens.has('topattack') ||
    tokens.has('cluster')
  );
}

function isIndirectFireAmmunition(ammo: AmmunitionData): boolean {
  const tokens = collectAmmunitionTokens(ammo);
  return (
    ammo.tirIndirect !== false &&
    ammo.canShootOnPosition === true &&
    (ammo.maximumRangeGru ?? 0) >= 1_400 &&
    (tokens.has('ind') ||
      tokens.has('indirect') ||
      ammo.projectileType?.toLowerCase() === 'artillerie')
  );
}

function inferPrecisionFactor(ammo: AmmunitionData): number {
  const projectileType = ammo.projectileType?.toLowerCase();
  const guided = projectileType === 'guidedmissile' || ammo.isFireAndForget === true;
  const topAttack =
    ammo.forceHitTopArmorOnSuccess === true || ammo.computeArmorFromImpactLocation === true;
  const deliberateTopAttack = topAttack && !isIndirectFireAmmunition(ammo);
  if (!guided && !deliberateTopAttack && (ammo.accuracyStationary ?? 0) < 75) {
    return 0;
  }
  return (guided ? 1.45 : 1) * (deliberateTopAttack ? 1.55 : 1);
}

function inferCloseCombatFactor(ammo: AmmunitionData): number {
  const tokens = collectAmmunitionTokens(ammo);
  if (tokens.has('napalm') || tokens.has('incendiary') || tokens.has('satchel')) {
    return 2;
  }
  if (tokens.has('rpo') || tokens.has('flamethrower') || tokens.has('thermobaric')) {
    return 1.7;
  }
  if (
    tokens.has('cac') &&
    (ammo.maximumRangeGru ?? 0) <= 250 &&
    (ammo.radiusSplashPhysicalDamagesGru ?? 0) >= 50
  ) {
    return 1.8;
  }
  if (tokens.has('cac') || ammo.minMaxCategory?.toLowerCase().includes('smg') === true) {
    return 1;
  }
  return 0;
}

function collectAmmunitionTokens(ammo: AmmunitionData): Set<string> {
  return new Set(
    [
      ammo.damageFamily,
      ammo.projectileType,
      ammo.weaponCursorType,
      ammo.minMaxCategory,
      ...ammo.traits,
    ]
      .filter((value): value is string => Boolean(value))
      .flatMap((value) => value.toLowerCase().split(/[^a-z0-9]+/u))
      .filter(Boolean),
  );
}

function normalizeRoleKind(value: string): RoleDefinition['kind'] | undefined {
  if (
    value === 'primary' ||
    value === 'type' ||
    value === 'role' ||
    value === 'trait' ||
    value === 'capability'
  ) {
    return value;
  }
  return undefined;
}

function resolveRoleKindPriority(kind: RoleDefinition['kind']): number {
  switch (kind) {
    case 'primary':
      return 50;
    case 'type':
      return 40;
    case 'role':
      return 30;
    case 'capability':
      return 20;
    case 'trait':
      return 10;
  }
}

function isAmphibiousEntity(entity: EntityData): boolean {
  return (
    entity.pathfindType?.toLowerCase().includes('amphibious') === true ||
    entity.movingType?.toLowerCase().includes('amphibious') === true
  );
}

function bucket(value: number): string {
  if (value <= 0) {
    return '0';
  }
  if (value < 200) {
    return '1';
  }
  if (value < 800) {
    return '2';
  }
  if (value < 2400) {
    return '3';
  }
  return '4';
}

function resolveMedian(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middleIndex = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middleIndex - 1] ?? 0) + (sorted[middleIndex] ?? 0)) / 2
    : (sorted[middleIndex] ?? 0);
}
