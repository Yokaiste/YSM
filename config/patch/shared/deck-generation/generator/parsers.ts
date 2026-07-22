import {
  type CommentDirectives,
  matchesIgnoreBelow,
  normalizeCommentDirectives,
  shouldForceIncludeEntity,
  shouldIgnoreEntity,
} from './comment-directives.ts';
import {
  type AmmunitionData,
  type Coalition,
  type DivisionRuleData,
  type EntityData,
  type EntityKind,
  FALLBACK_BALANCED_RULE,
  type NdfBlock,
  type NdfReaders,
  type WeaponDescriptorData,
  type WeaponMountData,
} from './types.ts';

export { parseLocalisation, renderLocalisation } from '../../localisation.ts';

export function parseSellableOrderAvailabilityNames(content: string): Set<string> {
  const sellable = new Set<string>();
  for (const line of content.split(/\r?\n/u)) {
    if (!line.includes('EOrderType/Sell')) {
      continue;
    }
    const name = line.match(/^\s*([A-Za-z0-9_]+)\s+is\s+\[/u)?.[1];
    if (name) {
      sellable.add(name);
    }
  }
  return sellable;
}

interface ParseEntityOptions {
  commentDirectives?: Partial<CommentDirectives>;
}

const DECIMAL_PATTERN = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
const INTEGER_PATTERN = String.raw`[-+]?\d+`;
const ENTITY_FIELD_NAMES = [
  'AgilityRadiusGRU',
  'CanAssist',
  'Coalition',
  'DeploymentShiftGRU',
  'EvacuationTime',
  'FactoryType',
  'FuelCapacity',
  'FuelMoveDuration',
  'HitRollECM',
  'IdentifyBaseProbability',
  'MaxPhysicalDamages',
  'MaxSpeedInKmph',
  'MenuIconTexture',
  'MotherCountry',
  'OpticalStrength',
  'OpticalStrengths',
  'PathfindType',
  'PriceCategory',
  'ProductionRessourcesNeeded',
  'ProductionTime',
  'ResistanceFront',
  'ResistanceRear',
  'ResistanceSides',
  'ResistanceTop',
  'SpawnType',
  'SpecialtiesList',
  'SpeedBonusFactorOnRoad',
  'SupplyCapacity',
  'SupplyPriority',
  'TagSet',
  'TimeForWeaponDeployment',
  'TransportableTagSet',
  'TravelDuration',
  'TypeStrategicCount',
  'UnitAttackValue',
  'UnitConcealmentBonus',
  'UnitDefenseValue',
  'UnitMovingType',
  'UnitRole',
  'UpkeepPercentage',
  'ValidOrders',
  'VisionRange',
  'VisionRangesGRU',
] as const;

function collectTopLevelBlocksByType(
  content: string,
  typeName: string,
  ndf: NdfReaders,
): NdfBlock[] {
  return ndf
    .findTopLevelBlocks(content)
    .filter((block) => ndf.primaryTypeName(block.typeName) === typeName);
}

function splitCodeAndComment(line: string): { code: string; comment: string } {
  const [codePart, ...commentParts] = line.split('//');
  return {
    code: codePart?.trim() ?? '',
    comment: commentParts.join('//').trim(),
  };
}

function buildLineStartOffsets(lines: string[]): number[] {
  const offsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    offsets.push(offset);
    offset += line.length + 1;
  }
  return offsets;
}

function findLineIndexAtOffset(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const start = lineStarts[middle] ?? 0;
    const nextStart = lineStarts[middle + 1] ?? Number.POSITIVE_INFINITY;
    if (offset < start) {
      high = middle - 1;
      continue;
    }
    if (offset >= nextStart) {
      low = middle + 1;
      continue;
    }
    return middle;
  }
  return Math.max(0, Math.min(lineStarts.length - 1, low));
}

function resolveIgnoreEverythingBelowLineIndex(
  lines: string[],
  directives: CommentDirectives,
): number | undefined {
  for (const [index, line] of lines.entries()) {
    const { comment } = splitCodeAndComment(line);
    if (matchesIgnoreBelow(comment, directives)) {
      return index;
    }
  }
  return undefined;
}

function getBlockBodyText(block: NdfBlock, ndf: NdfReaders): string {
  return ndf.extractBody(block.text)?.text ?? block.text;
}

function createEntityFieldReader(
  block: NdfBlock,
  ndf: NdfReaders,
): (fieldName: string) => string | undefined {
  const blockBody = getBlockBodyText(block, ndf);
  const directFields = ndf.readFields(blockBody, ENTITY_FIELD_NAMES);
  const missingFieldNames = ENTITY_FIELD_NAMES.filter(
    (fieldName) => directFields[fieldName] === undefined,
  );
  const nestedFields = ndf.readFieldsDeep(block.text, missingFieldNames);
  return (fieldName: string) => directFields[fieldName] ?? nestedFields[fieldName];
}

function readInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.match(new RegExp(`^${INTEGER_PATTERN}$`));
  return match ? Number(match[0]) : undefined;
}

function readNumber(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.match(new RegExp(`^${DECIMAL_PATTERN}$`));
  return match ? Number(match[0]) : undefined;
}

function readBoolean(value: string | undefined): boolean | undefined {
  if (!value) {
    return undefined;
  }
  if (/^true$/i.test(value)) {
    return true;
  }
  if (/^false$/i.test(value)) {
    return false;
  }
  return undefined;
}

function readQuotedString(value: string | undefined): string | undefined {
  const match = value?.match(/^'([^']+)'$/);
  return match?.[1];
}

function readReferenceSuffix(value: string | undefined, pattern: RegExp): string | undefined {
  const match = value?.match(pattern);
  return match?.[1];
}

function readTagArrayValue(value: string | undefined, ndf: NdfReaders): string[] {
  if (!value) {
    return [];
  }
  const trimmed = value.trim();
  if (!(trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return [];
  }
  return ndf
    .parseList(trimmed)
    .map((entry) =>
      String(entry.value)
        .replaceAll(/[^A-Za-z0-9]/g, '')
        .toLowerCase(),
    )
    .filter((entry) => entry.length > 0);
}

function readTupleMetricValue(
  value: string | undefined,
  prefixPattern: RegExp,
): number | undefined {
  if (!value) {
    return undefined;
  }
  const match = value.match(
    new RegExp(String.raw`\(\s*${prefixPattern.source},\s*(${DECIMAL_PATTERN})\s*\)`),
  );
  return match ? Number(match[1]) : undefined;
}

function readMaximumTupleMetricValue(
  value: string | undefined,
  prefixPattern: RegExp,
): number | undefined {
  if (!value) {
    return undefined;
  }
  const matches = [
    ...value.matchAll(
      new RegExp(String.raw`\(\s*${prefixPattern.source},\s*(${DECIMAL_PATTERN})\s*\)`, 'g'),
    ),
  ];
  const values = matches.map((match) => Number(match[1])).filter(Number.isFinite);
  return values.length > 0 ? Math.max(...values) : undefined;
}

function normalizeNumberArrayValue(value: string | undefined, ndf: NdfReaders): number[] {
  if (!value) {
    return [];
  }
  const trimmed = value.trim();
  if (!(trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return [];
  }
  return ndf
    .parseList(trimmed)
    .map((entry) => Number(entry.value))
    .filter((entry) => Number.isFinite(entry));
}

function extractUnitDescriptorName(value: string | undefined): string | undefined {
  const match = value?.match(/\$\/GFX\/Unit\/([A-Za-z0-9_]+)/);
  return match?.[1];
}

function parseEntityBlock(block: NdfBlock, kind: EntityKind, ndf: NdfReaders): EntityData {
  const lines = block.text.split('\n');
  const readEntityFieldValue = createEntityFieldReader(block, ndf);
  const tags = readTagArrayValue(readEntityFieldValue('TagSet'), ndf);
  const specialties = readTagArrayValue(readEntityFieldValue('SpecialtiesList'), ndf);
  const transportableTags = readTagArrayValue(readEntityFieldValue('TransportableTagSet'), ndf);
  const weaponDescriptorNames = new Set<string>();
  const capacityNames = new Set<string>();
  const country = readQuotedString(readEntityFieldValue('MotherCountry'));
  const coalition = readReferenceSuffix(
    readEntityFieldValue('Coalition'),
    /^TWargameCoalition\/([A-Za-z0-9_]+)$/,
  );
  const factoryType = readReferenceSuffix(
    readEntityFieldValue('FactoryType'),
    /^Factory\/([A-Za-z0-9_]+)$/,
  );
  const unitRole = readQuotedString(readEntityFieldValue('UnitRole'));
  const priceCategory = readQuotedString(readEntityFieldValue('PriceCategory'));
  const strategicType = readReferenceSuffix(
    readEntityFieldValue('TypeStrategicCount'),
    /^ETypeStrategicDetailedCount\/([A-Za-z0-9_]+)$/,
  );
  const menuIconTexture = readQuotedString(readEntityFieldValue('MenuIconTexture'));
  const spawnType = readReferenceSuffix(
    readEntityFieldValue('SpawnType'),
    /^EShowroomSpawnType\/([A-Za-z0-9_]+)$/,
  );
  const pathfindType = readReferenceSuffix(
    readEntityFieldValue('PathfindType'),
    /^\$\/Pathfind\/PathfindTypes\/([A-Za-z0-9_]+)$/,
  );
  const movingType = readReferenceSuffix(
    readEntityFieldValue('UnitMovingType'),
    /^EUnitMovingType\/([A-Za-z0-9_]+)$/,
  );
  const orderAvailabilityName = readReferenceSuffix(
    readEntityFieldValue('ValidOrders'),
    /^~\/([A-Za-z0-9_]+)$/,
  );
  const concealmentBonus = readNumber(readEntityFieldValue('UnitConcealmentBonus'));
  const identifyBaseProbability = readNumber(readEntityFieldValue('IdentifyBaseProbability'));
  const hitRollEcm = readNumber(readEntityFieldValue('HitRollECM'));
  const maxPhysicalDamages = readNumber(readEntityFieldValue('MaxPhysicalDamages'));
  const maxSpeedKmph = readNumber(readEntityFieldValue('MaxSpeedInKmph'));
  const speedBonusFactorOnRoad = readNumber(readEntityFieldValue('SpeedBonusFactorOnRoad'));
  const fuelCapacity = readInteger(readEntityFieldValue('FuelCapacity'));
  const fuelMoveDuration = readNumber(readEntityFieldValue('FuelMoveDuration'));
  const productionTime = readInteger(readEntityFieldValue('ProductionTime'));
  const deploymentShiftGru = readNumber(readEntityFieldValue('DeploymentShiftGRU'));
  const weaponDeploymentTime = readNumber(readEntityFieldValue('TimeForWeaponDeployment'));
  const travelDuration = readNumber(readEntityFieldValue('TravelDuration'));
  const evacuationTime = readNumber(readEntityFieldValue('EvacuationTime'));
  const agilityRadiusGru = readNumber(readEntityFieldValue('AgilityRadiusGRU'));
  const visionRange =
    readMaximumTupleMetricValue(
      readEntityFieldValue('VisionRange') ?? readEntityFieldValue('VisionRangesGRU'),
      /EVisionRange\/[A-Za-z0-9_]+/,
    ) ?? undefined;
  const opticalStrength =
    readMaximumTupleMetricValue(
      readEntityFieldValue('OpticalStrength') ?? readEntityFieldValue('OpticalStrengths'),
      /EOpticalStrength\/[A-Za-z0-9_]+/,
    ) ?? undefined;
  // Only the `blindage` resistance family is real armor: `vehicule` and other
  // soft families share index numbers while dying to small arms and splash.
  const readArmorValue = (fieldName: string): number | undefined => {
    const rawValue = readEntityFieldValue(fieldName);
    const index = readInteger(readReferenceSuffix(rawValue, /\bIndex\s*=\s*([0-9]+)/));
    if (index === undefined) {
      return undefined;
    }
    const family = readReferenceSuffix(rawValue, /\bFamily\s*=\s*ResistanceFamily_([A-Za-z0-9_]+)/);
    return family === 'blindage' ? index : index * 0.5;
  };
  const frontArmor = readArmorValue('ResistanceFront');
  const sideArmor = readArmorValue('ResistanceSides');
  const rearArmor = readArmorValue('ResistanceRear');
  const topArmor = readArmorValue('ResistanceTop');
  const unitAttackValue = readInteger(readEntityFieldValue('UnitAttackValue'));
  const unitDefenseValue = readInteger(readEntityFieldValue('UnitDefenseValue'));
  const upkeepPercentage = readNumber(readEntityFieldValue('UpkeepPercentage'));
  const canAssist = readBoolean(readEntityFieldValue('CanAssist'));
  const supplyCapacity = readNumber(readEntityFieldValue('SupplyCapacity'));
  const supplyPriority = readInteger(readEntityFieldValue('SupplyPriority'));
  const cost =
    readInteger(
      readReferenceSuffix(
        readEntityFieldValue('ProductionRessourcesNeeded'),
        new RegExp(String.raw`Resource_CommandPoints,\s*(${INTEGER_PATTERN})`),
      ),
    ) ?? 0;
  let hasSupplyModule = false;
  let isTransportable = false;

  for (const originalLine of lines) {
    const { code: lineCode } = splitCodeAndComment(originalLine);
    if (!lineCode) {
      continue;
    }

    if (lineCode.includes('TTransportableModuleDescriptor')) {
      isTransportable = true;
    }
    if (lineCode.includes('TSupplyModuleDescriptor')) {
      hasSupplyModule = true;
    }

    const weaponDescriptorMatch = lineCode.match(/\$\/GFX\/Weapon\/([A-Za-z0-9_]+)/);
    const weaponDescriptorName = weaponDescriptorMatch?.[1];
    if (weaponDescriptorName) {
      weaponDescriptorNames.add(weaponDescriptorName);
    }
    const capacityMatch = lineCode.match(/\$\/GFX\/EffectCapacity\/([A-Za-z0-9_]+)/);
    const capacityName = capacityMatch?.[1];
    if (capacityName) {
      capacityNames.add(capacityName);
    }
  }

  return {
    name: block.name ?? '',
    kind,
    tags,
    specialties,
    transportableTags,
    weaponDescriptorNames: [...weaponDescriptorNames],
    capacityNames: [...capacityNames],
    positiveCapacityNames: [],
    negativeCapacityNames: [],
    effectTokens: [],
    positiveEffectTokens: [],
    negativeEffectTokens: [],
    effectUtility: 0,
    isTransportable,
    ...(orderAvailabilityName ? { orderAvailabilityName } : {}),
    isSellable: false,
    ...(country ? { country } : {}),
    ...(coalition ? { coalition } : {}),
    ...(factoryType ? { factoryType } : {}),
    ...(unitRole ? { unitRole } : {}),
    ...(priceCategory ? { priceCategory } : {}),
    ...(strategicType ? { strategicType } : {}),
    ...(menuIconTexture ? { menuIconTexture } : {}),
    ...(spawnType ? { spawnType } : {}),
    ...(pathfindType ? { pathfindType } : {}),
    ...(movingType ? { movingType } : {}),
    ...(concealmentBonus !== undefined ? { concealmentBonus } : {}),
    ...(identifyBaseProbability !== undefined ? { identifyBaseProbability } : {}),
    ...(hitRollEcm !== undefined ? { hitRollEcm } : {}),
    ...(maxPhysicalDamages !== undefined ? { maxPhysicalDamages } : {}),
    ...(maxSpeedKmph !== undefined ? { maxSpeedKmph } : {}),
    ...(speedBonusFactorOnRoad !== undefined ? { speedBonusFactorOnRoad } : {}),
    ...(fuelCapacity !== undefined ? { fuelCapacity } : {}),
    ...(fuelMoveDuration !== undefined ? { fuelMoveDuration } : {}),
    ...(productionTime !== undefined ? { productionTime } : {}),
    ...(deploymentShiftGru !== undefined ? { deploymentShiftGru } : {}),
    ...(weaponDeploymentTime !== undefined ? { weaponDeploymentTime } : {}),
    ...(travelDuration !== undefined ? { travelDuration } : {}),
    ...(evacuationTime !== undefined ? { evacuationTime } : {}),
    ...(agilityRadiusGru !== undefined ? { agilityRadiusGru } : {}),
    ...(visionRange !== undefined ? { visionRange } : {}),
    ...(opticalStrength !== undefined ? { opticalStrength } : {}),
    ...(frontArmor !== undefined ? { frontArmor } : {}),
    ...(sideArmor !== undefined ? { sideArmor } : {}),
    ...(rearArmor !== undefined ? { rearArmor } : {}),
    ...(topArmor !== undefined ? { topArmor } : {}),
    ...(unitAttackValue !== undefined ? { unitAttackValue } : {}),
    ...(unitDefenseValue !== undefined ? { unitDefenseValue } : {}),
    ...(upkeepPercentage !== undefined ? { upkeepPercentage } : {}),
    ...(canAssist !== undefined ? { canAssist } : {}),
    ...(supplyCapacity !== undefined ? { supplyCapacity } : {}),
    ...(supplyPriority !== undefined ? { supplyPriority } : {}),
    cost,
    hasSupplyModule,
  };
}
export function parseEntities(
  content: string,
  kind: EntityKind,
  ndf: NdfReaders,
  options: ParseEntityOptions = {},
): EntityData[] {
  const directives = normalizeCommentDirectives(options.commentDirectives);
  const lines = content.split('\n');
  const lineStarts = buildLineStartOffsets(lines);
  const ignoreEverythingBelowLineIndex = resolveIgnoreEverythingBelowLineIndex(lines, directives);
  const entities: EntityData[] = [];
  const processedNames = new Set<string>();

  for (const block of collectTopLevelBlocksByType(content, 'TEntityDescriptor', ndf)) {
    if (!block.name || processedNames.has(block.name)) {
      continue;
    }

    const lineIndex = findLineIndexAtOffset(lineStarts, block.start);
    const { comment } = splitCodeAndComment(lines[lineIndex] ?? '');
    const isForceIncluded = shouldForceIncludeEntity(lines, lineIndex, comment, directives);
    if (
      !isForceIncluded &&
      ignoreEverythingBelowLineIndex !== undefined &&
      lineIndex >= ignoreEverythingBelowLineIndex
    ) {
      continue;
    }

    if (!isForceIncluded && shouldIgnoreEntity(lines, lineIndex, comment, directives)) {
      continue;
    }

    processedNames.add(block.name);
    entities.push(parseEntityBlock(block, kind, ndf));
  }

  return entities;
}

export function parseDivisionRules(
  content: string,
  ignoredRuleNamePatterns: RegExp[],
  ndf: NdfReaders,
): Map<string, DivisionRuleData> {
  return parseDivisionRuleData(content, ignoredRuleNamePatterns, ndf).rules;
}

export function parseDivisionMemberNames(
  content: string,
  ignoredRuleNamePatterns: RegExp[],
  ndf: NdfReaders,
): Set<string> {
  return parseDivisionRuleData(content, ignoredRuleNamePatterns, ndf).memberNames;
}

export function parseDivisionRuleData(
  content: string,
  ignoredRuleNamePatterns: RegExp[],
  ndf: NdfReaders,
): { rules: Map<string, DivisionRuleData>; memberNames: Set<string> } {
  const candidatesByUnit = new Map<string, DivisionRuleData[]>();
  const memberNames = new Set<string>();
  for (const block of collectTopLevelBlocksByType(content, 'TDeckDivisionRule', ndf)) {
    if (
      !block.name ||
      ignoredRuleNamePatterns.some((pattern) => {
        pattern.lastIndex = 0;
        return pattern.test(block.name ?? '');
      })
    ) {
      continue;
    }

    const unitRuleListValue = ndf.readField(getBlockBodyText(block, ndf), 'UnitRuleList');
    if (!unitRuleListValue) {
      continue;
    }

    for (const entry of ndf.findCollectionEntries(unitRuleListValue)) {
      if (entry.typeName !== 'TDeckUniteRule') {
        continue;
      }

      const unitName = extractUnitDescriptorName(ndf.readPath(entry.text, ['UnitDescriptor']));
      if (!unitName) {
        continue;
      }
      memberNames.add(unitName);

      const availableTransportListValue = ndf.readPath(entry.text, ['AvailableTransportList']);
      for (const transportName of extractUnitDescriptorNames(availableTransportListValue, ndf)) {
        memberNames.add(transportName);
      }

      const multipliers = normalizeNumberArrayValue(
        ndf.readPath(entry.text, ['NumberOfUnitInPackXPMultiplier']),
        ndf,
      );
      const rule = {
        unitName,
        maxPackNumber: readInteger(ndf.readPath(entry.text, ['MaxPackNumber'])) ?? 0,
        numberOfUnitInPack: readInteger(ndf.readPath(entry.text, ['NumberOfUnitInPack'])) ?? 0,
        multipliers: multipliers.length > 0 ? multipliers : [...FALLBACK_BALANCED_RULE.multipliers],
      };
      const candidates = candidatesByUnit.get(unitName) ?? [];
      candidates.push(rule);
      candidatesByUnit.set(unitName, candidates);
    }
  }

  const rules = new Map(
    [...candidatesByUnit].flatMap(([unitName, candidates]) => {
      const usableRules = candidates.filter((rule) => !isCheatDivisionRule(rule));
      if (usableRules.length === 0) {
        return [];
      }
      usableRules.sort(compareRulesByGenerosity);
      return [[unitName, usableRules[0] as DivisionRuleData]];
    }),
  );
  return { rules, memberNames };
}

/** Challenge/solo rules ship 100-per-pack x999-cards availability. */
const CHEAT_RULE_COUNT_THRESHOLD = 50;

function isCheatDivisionRule(rule: DivisionRuleData): boolean {
  return (
    rule.maxPackNumber >= CHEAT_RULE_COUNT_THRESHOLD ||
    rule.numberOfUnitInPack >= CHEAT_RULE_COUNT_THRESHOLD ||
    resolvePeakRuleUnitCount(rule) >= CHEAT_RULE_COUNT_THRESHOLD
  );
}

function extractUnitDescriptorNames(value: string | undefined, ndf: NdfReaders): string[] {
  if (!value) {
    return [];
  }
  const trimmed = value.trim();
  if (!(trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    return [];
  }
  return ndf
    .parseList(trimmed)
    .map((entry) => extractUnitDescriptorName(String(entry.value)))
    .filter((name): name is string => Boolean(name));
}

function compareRulesByGenerosity(left: DivisionRuleData, right: DivisionRuleData): number {
  const peakDifference = resolvePeakRuleUnitCount(right) - resolvePeakRuleUnitCount(left);
  if (peakDifference !== 0) {
    return peakDifference;
  }
  if (left.maxPackNumber !== right.maxPackNumber) {
    return right.maxPackNumber - left.maxPackNumber;
  }
  return right.numberOfUnitInPack - left.numberOfUnitInPack;
}

function resolvePeakRuleUnitCount(rule: DivisionRuleData): number {
  return Math.max(
    0,
    ...rule.multipliers
      .filter((multiplier) => multiplier > 0)
      .map((multiplier) => Math.round(rule.numberOfUnitInPack * multiplier)),
  );
}

function parseWeaponDescriptorBlock(block: NdfBlock, ndf: NdfReaders): WeaponDescriptorData {
  const lines = block.text.split('\n');
  const ammunitionNames = new Set<string>();
  const salves = normalizeNumberArrayValue(
    ndf.readField(getBlockBodyText(block, ndf), 'Salves'),
    ndf,
  );
  const mountedWeapons: WeaponMountData[] = [];
  let currentMountedAmmunitionName: string | undefined;
  let currentMountedAmmoBoxIndex: number | undefined;
  let currentMountedWeaponCount = 1;

  const commitMountedWeapon = () => {
    if (!currentMountedAmmunitionName) {
      return;
    }
    mountedWeapons.push({
      ammunitionName: currentMountedAmmunitionName,
      // Missile mounts routinely omit AmmoBoxIndex, which means box 0.
      ammoBoxIndex: currentMountedAmmoBoxIndex ?? 0,
      weaponCount: currentMountedWeaponCount,
    });
    currentMountedAmmunitionName = undefined;
    currentMountedAmmoBoxIndex = undefined;
    currentMountedWeaponCount = 1;
  };

  for (const rawLine of lines) {
    const { code: line } = splitCodeAndComment(rawLine);

    if (line === 'TMountedWeaponDescriptor') {
      commitMountedWeapon();
      continue;
    }

    const ammunitionMatch = line.match(/^Ammunition\s*=\s*\$\/GFX\/Weapon\/([A-Za-z0-9_]+)/);
    const ammunitionName = ammunitionMatch?.[1];
    if (ammunitionName) {
      ammunitionNames.add(ammunitionName);
    }

    if (ammunitionName) {
      currentMountedAmmunitionName = ammunitionName;
    }

    const ammoBoxIndexMatch = line.match(
      new RegExp(String.raw`^AmmoBoxIndex\s*=\s*(${INTEGER_PATTERN})`),
    );
    if (ammoBoxIndexMatch) {
      currentMountedAmmoBoxIndex = Number(ammoBoxIndexMatch[1]);
    }

    const weaponCountMatch = line.match(
      new RegExp(String.raw`^NbWeapons\s*=\s*(${INTEGER_PATTERN})`),
    );
    if (weaponCountMatch) {
      currentMountedWeaponCount = Number(weaponCountMatch[1]);
    }
  }

  commitMountedWeapon();
  return {
    name: block.name ?? '',
    ammunitionNames: [...ammunitionNames],
    salves,
    mountedWeapons,
  };
}

function parseAmmunitionBlock(block: NdfBlock, ndf: NdfReaders): AmmunitionData {
  const blockBody = getBlockBodyText(block, ndf);
  const traits = readTagArrayValue(ndf.readField(blockBody, 'TraitsToken'), ndf);
  const damageFamily = readReferenceSuffix(
    ndf.readField(blockBody, 'Arme'),
    /\bFamily\s*=\s*DamageFamily_([A-Za-z0-9_]+)/,
  );
  const minMaxCategory = readReferenceSuffix(
    ndf.readField(blockBody, 'MinMaxCategory'),
    /^([A-Za-z0-9_]+)$/,
  );
  const weaponCursorType = readReferenceSuffix(
    ndf.readField(blockBody, 'WeaponCursorType'),
    /^([A-Za-z0-9_]+)$/,
  );
  const projectileType = readReferenceSuffix(
    ndf.readField(blockBody, 'ProjectileType'),
    /^EProjectileType\/([A-Za-z0-9_]+)$/,
  );
  const armorPenetration = readInteger(
    readReferenceSuffix(ndf.readField(blockBody, 'Arme'), /\bIndex\s*=\s*([0-9]+)/),
  );
  const hitValueModifiers = ndf.readFieldDeep(blockBody, 'BaseHitValueModifiers');
  const accuracyStationary = readTupleMetricValue(
    hitValueModifiers,
    /EBaseHitValueModifier\/Idling/,
  );
  const accuracyMoving = readTupleMetricValue(hitValueModifiers, /EBaseHitValueModifier\/Moving/);
  const minimumRangeGru = readNumber(ndf.readField(blockBody, 'MinimumRangeGRU'));
  const minimumRangeHelicopterGru = readNumber(
    ndf.readField(blockBody, 'MinimumRangeHelicopterGRU'),
  );
  const minimumRangeAirplaneGru = readNumber(ndf.readField(blockBody, 'MinimumRangeAirplaneGRU'));
  const maximumRangeGru = readNumber(ndf.readField(blockBody, 'MaximumRangeGRU'));
  const maximumRangeHelicopterGru = readNumber(
    ndf.readField(blockBody, 'MaximumRangeHelicopterGRU'),
  );
  const maximumRangeAirplaneGru = readNumber(ndf.readField(blockBody, 'MaximumRangeAirplaneGRU'));
  const physicalDamages = readNumber(ndf.readField(blockBody, 'PhysicalDamages'));
  const suppressDamages = readNumber(ndf.readField(blockBody, 'SuppressDamages'));
  const radiusSplashPhysicalDamagesGru = readNumber(
    ndf.readField(blockBody, 'RadiusSplashPhysicalDamagesGRU'),
  );
  const radiusSplashSuppressDamagesGru = readNumber(
    ndf.readField(blockBody, 'RadiusSplashSuppressDamagesGRU'),
  );
  const shotsCountPerSalvo = readInteger(ndf.readField(blockBody, 'ShotsCountPerSalvo'));
  const aimingTime = readNumber(ndf.readField(blockBody, 'AimingTime'));
  const timeBetweenTwoShots = readNumber(ndf.readField(blockBody, 'TimeBetweenTwoShots'));
  const timeBetweenTwoSalvos = readNumber(ndf.readField(blockBody, 'TimeBetweenTwoSalvos'));
  const projectileSpeedGru = readNumber(ndf.readField(blockBody, 'ProjectileSpeedGRU'));
  const dispersionAtMaxRangeGru = readNumber(ndf.readField(blockBody, 'DispersionAtMaxRangeGRU'));
  const supplyCost = readNumber(ndf.readField(blockBody, 'SupplyCost'));
  const canShootOnPosition = readBoolean(ndf.readField(blockBody, 'CanShootOnPosition'));
  const canShootWhileMoving = readBoolean(ndf.readField(blockBody, 'CanShootWhileMoving'));
  const isFireAndForget = readBoolean(ndf.readField(blockBody, 'IsFireAndForget'));
  const tirIndirect = readBoolean(ndf.readField(blockBody, 'TirIndirect'));
  const forceHitTopArmorOnSuccess = readBoolean(
    ndf.readField(blockBody, 'ForceHitTopArmorOnSuccess'),
  );
  const computeArmorFromImpactLocation = readBoolean(
    ndf.readField(blockBody, 'ComputeArmorFromImpactLocation'),
  );
  const piercingWeapon = readBoolean(ndf.readField(blockBody, 'PiercingWeapon'));
  const tandemCharge = readBoolean(ndf.readField(blockBody, 'TandemCharge'));

  return {
    name: block.name ?? '',
    traits,
    ...(damageFamily ? { damageFamily } : {}),
    ...(minMaxCategory ? { minMaxCategory } : {}),
    ...(weaponCursorType ? { weaponCursorType } : {}),
    ...(projectileType ? { projectileType } : {}),
    ...(armorPenetration !== undefined ? { armorPenetration } : {}),
    ...(accuracyStationary !== undefined ? { accuracyStationary } : {}),
    ...(accuracyMoving !== undefined ? { accuracyMoving } : {}),
    ...(minimumRangeGru !== undefined ? { minimumRangeGru } : {}),
    ...(minimumRangeHelicopterGru !== undefined ? { minimumRangeHelicopterGru } : {}),
    ...(minimumRangeAirplaneGru !== undefined ? { minimumRangeAirplaneGru } : {}),
    ...(maximumRangeGru !== undefined ? { maximumRangeGru } : {}),
    ...(maximumRangeHelicopterGru !== undefined ? { maximumRangeHelicopterGru } : {}),
    ...(maximumRangeAirplaneGru !== undefined ? { maximumRangeAirplaneGru } : {}),
    ...(physicalDamages !== undefined ? { physicalDamages } : {}),
    ...(suppressDamages !== undefined ? { suppressDamages } : {}),
    ...(radiusSplashPhysicalDamagesGru !== undefined ? { radiusSplashPhysicalDamagesGru } : {}),
    ...(radiusSplashSuppressDamagesGru !== undefined ? { radiusSplashSuppressDamagesGru } : {}),
    ...(shotsCountPerSalvo !== undefined ? { shotsCountPerSalvo } : {}),
    ...(aimingTime !== undefined ? { aimingTime } : {}),
    ...(timeBetweenTwoShots !== undefined ? { timeBetweenTwoShots } : {}),
    ...(timeBetweenTwoSalvos !== undefined ? { timeBetweenTwoSalvos } : {}),
    ...(projectileSpeedGru !== undefined ? { projectileSpeedGru } : {}),
    ...(dispersionAtMaxRangeGru !== undefined ? { dispersionAtMaxRangeGru } : {}),
    ...(supplyCost !== undefined ? { supplyCost } : {}),
    ...(canShootOnPosition !== undefined ? { canShootOnPosition } : {}),
    ...(canShootWhileMoving !== undefined ? { canShootWhileMoving } : {}),
    ...(isFireAndForget !== undefined ? { isFireAndForget } : {}),
    ...(tirIndirect !== undefined ? { tirIndirect } : {}),
    ...(forceHitTopArmorOnSuccess !== undefined ? { forceHitTopArmorOnSuccess } : {}),
    ...(computeArmorFromImpactLocation !== undefined ? { computeArmorFromImpactLocation } : {}),
    ...(piercingWeapon !== undefined ? { piercingWeapon } : {}),
    ...(tandemCharge !== undefined ? { tandemCharge } : {}),
  };
}

export function parseWeaponDescriptors(
  content: string,
  ndf: NdfReaders,
): Map<string, WeaponDescriptorData> {
  const descriptors = new Map<string, WeaponDescriptorData>();
  for (const block of collectTopLevelBlocksByType(content, 'TWeaponManagerModuleDescriptor', ndf)) {
    if (!block.name || descriptors.has(block.name)) {
      continue;
    }
    descriptors.set(block.name, parseWeaponDescriptorBlock(block, ndf));
  }
  return descriptors;
}

export function parseAmmunition(content: string, ndf: NdfReaders): Map<string, AmmunitionData> {
  const ammunition = new Map<string, AmmunitionData>();
  for (const block of collectTopLevelBlocksByType(content, 'TAmmunitionDescriptor', ndf)) {
    if (!block.name || ammunition.has(block.name)) {
      continue;
    }
    ammunition.set(block.name, parseAmmunitionBlock(block, ndf));
  }

  return ammunition;
}

interface EffectProfile {
  tokens: string[];
  utility: number;
}

export interface CapacityEffectProfile {
  tokens: string[];
  positiveTokens: string[];
  negativeTokens: string[];
  utility: number;
}

/**
 * Resolves capacity implementations instead of assigning value to localized
 * trait names. The resulting signatures remain stable across renamed units and
 * let selection compare effect supersets and reject harmful-only "variety".
 */
export function parseCapacityEffectProfiles(
  capacitiesContent: string,
  effectsContent: string,
  ndf: NdfReaders,
): Map<string, CapacityEffectProfile> {
  const effects = new Map<string, EffectProfile>();
  for (const block of collectTopLevelBlocksByType(effectsContent, 'TEffectsPackDescriptor', ndf)) {
    if (!block.name) {
      continue;
    }
    const body = getBlockBodyText(block, ndf);
    const descriptorList = ndf.readField(body, 'EffectsDescriptors');
    const tokens = new Set<string>();
    let utility = 0;
    if (descriptorList) {
      for (const entry of ndf.findCollectionEntries(descriptorList)) {
        const type = ndf.primaryTypeName(entry.typeName ?? '');
        const normalizedType = normalizeEffectToken(type);
        if (!normalizedType || isAdministrativeEffect(normalizedType)) {
          continue;
        }
        const modifierType = readReferenceSuffix(
          ndf.readFieldDeep(entry.text, 'ModifierType'),
          /^~\/([A-Za-z0-9_]+)$/,
        );
        const rawValue = readNumber(ndf.readFieldDeep(entry.text, 'ModifierValue'));
        const normalizedValue = normalizeEffectModifier(rawValue, modifierType);
        const effectUtility = resolveEffectUtility(normalizedType, normalizedValue);
        utility += effectUtility;
        tokens.add(
          `effect:${normalizedType}:${normalizeEffectToken(modifierType ?? 'presence')}:${bucketEffectMagnitude(normalizedValue)}`,
        );
      }
    }
    effects.set(block.name, { tokens: [...tokens].sort(), utility });
  }

  const capacities = new Map<string, CapacityEffectProfile>();
  for (const block of collectTopLevelBlocksByType(capacitiesContent, 'TCapaciteDescriptor', ndf)) {
    if (!block.name) {
      continue;
    }
    const body = getBlockBodyText(block, ndf);
    const targetEffectName = readReferenceSuffix(
      ndf.readField(body, 'TargetEffect'),
      /^~\/([A-Za-z0-9_]+)$/,
    );
    const selfEffectName = readReferenceSuffix(
      ndf.readField(body, 'SelfEffect'),
      /^~\/([A-Za-z0-9_]+)$/,
    );
    const targetTeam = normalizeEffectToken(
      readReferenceSuffix(ndf.readField(body, 'TargetTeamFilter'), /^~\/([A-Za-z0-9_]+)$/) ??
        'self',
    );
    const range = readNumber(ndf.readField(body, 'RangeGRU')) ?? 0;
    const tokens = new Set<string>();
    let utility = 0;
    const addEffect = (effectName: string | undefined, scope: string, polarity: number): void => {
      const effect = effectName ? effects.get(effectName) : undefined;
      if (!effect) {
        return;
      }
      for (const token of effect.tokens) {
        tokens.add(`${scope}:${token}`);
      }
      utility += effect.utility * polarity;
    };
    const targetPolarity = targetTeam.includes('ennemi') || targetTeam.includes('enemy') ? -1 : 1;
    addEffect(targetEffectName, `scope:${targetTeam}`, targetPolarity);
    addEffect(selfEffectName, 'scope:self', 1);
    if (tokens.size > 0 && range > 0) {
      tokens.add(`effect_range:${bucketRange(range)}`);
      utility *= 1 + Math.min(0.5, range / 10_000);
    }
    const sortedTokens = [...tokens].sort();
    capacities.set(block.name, {
      tokens: sortedTokens,
      positiveTokens: utility > 0 ? sortedTokens : [],
      negativeTokens: utility < 0 ? sortedTokens : [],
      utility,
    });
  }
  return capacities;
}

export function applyCapacityEffectProfiles(
  entities: EntityData[],
  profiles: ReadonlyMap<string, CapacityEffectProfile>,
): void {
  for (const entity of entities) {
    const tokens = new Set<string>();
    const positiveTokens = new Set<string>();
    const negativeTokens = new Set<string>();
    const positiveCapacityNames: string[] = [];
    const negativeCapacityNames: string[] = [];
    let utility = 0;
    for (const capacityName of entity.capacityNames) {
      const profile = profiles.get(capacityName);
      if (!profile) {
        continue;
      }
      for (const token of profile.tokens) tokens.add(token);
      for (const token of profile.positiveTokens) positiveTokens.add(token);
      for (const token of profile.negativeTokens) negativeTokens.add(token);
      if (profile.utility > 0) positiveCapacityNames.push(capacityName);
      if (profile.utility < 0) negativeCapacityNames.push(capacityName);
      utility += profile.utility;
    }
    entity.effectTokens = [...tokens].sort();
    entity.positiveCapacityNames = positiveCapacityNames.sort();
    entity.negativeCapacityNames = negativeCapacityNames.sort();
    entity.positiveEffectTokens = [...positiveTokens].sort();
    entity.negativeEffectTokens = [...negativeTokens].sort();
    entity.effectUtility = utility;
  }
}

function normalizeEffectModifier(
  value: number | undefined,
  modifierType: string | undefined,
): number {
  if (value === undefined) {
    return 0;
  }
  const normalizedType = modifierType?.toLowerCase() ?? '';
  return normalizedType.includes('multiplic') ? value - 1 : value;
}

function resolveEffectUtility(type: string, value: number): number {
  if (value === 0) {
    return 0;
  }
  const magnitude = Math.sign(value) * Math.log2(1 + Math.abs(value));
  const lowerIsBetter = [
    'aimingtime',
    'reloadtime',
    'dispersion',
    'damagesreceived',
    'receiveddamage',
    'suppressiondamage',
    'stundamage',
  ].some((token) => type.includes(token));
  const higherIsBetter = [
    'precision',
    'accuracy',
    'optical',
    'vision',
    'conceal',
    'speed',
    'regeneration',
    'regen',
    'heal',
    'resistance',
    'armor',
    'veteran',
  ].some((token) => type.includes(token));
  if (lowerIsBetter) {
    return -magnitude;
  }
  return higherIsBetter ? magnitude : 0;
}

function normalizeEffectToken(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, '_')
    .replaceAll(/^_+|_+$/gu, '');
}

function isAdministrativeEffect(type: string): boolean {
  return ['raisetag', 'removetag', 'revealtag', 'feedback'].some((token) => type.includes(token));
}

function bucketEffectMagnitude(value: number): string {
  const magnitude = Math.abs(value);
  const sign = value < 0 ? 'negative' : value > 0 ? 'positive' : 'neutral';
  const size =
    magnitude >= 50 ? 'xl' : magnitude >= 10 ? 'large' : magnitude >= 1 ? 'medium' : 'small';
  return `${sign}_${size}`;
}

function bucketRange(range: number): string {
  return range >= 5_000
    ? 'very_long'
    : range >= 2_500
      ? 'long'
      : range >= 1_000
        ? 'medium'
        : 'local';
}

/** Vanilla declares Coalition on well under half its units; the rest only carry MotherCountry. */
export function applyInferredCoalitions(entities: EntityData[]): void {
  const coalitionVotesByCountry = new Map<string, Map<Coalition, number>>();
  for (const entity of entities) {
    if (!entity.country || !entity.coalition) {
      continue;
    }
    const votes = coalitionVotesByCountry.get(entity.country) ?? new Map<Coalition, number>();
    votes.set(entity.coalition, (votes.get(entity.coalition) ?? 0) + 1);
    coalitionVotesByCountry.set(entity.country, votes);
  }

  const coalitionByCountry = new Map<string, Coalition>(
    [...coalitionVotesByCountry].flatMap(([country, votes]) => {
      const [winner] = [...votes].sort(
        ([leftCoalition, leftVotes], [rightCoalition, rightVotes]) =>
          rightVotes - leftVotes || leftCoalition.localeCompare(rightCoalition),
      );
      return winner ? [[country, winner[0]] as const] : [];
    }),
  );

  for (const entity of entities) {
    if (entity.coalition || !entity.country) {
      continue;
    }
    const inferredCoalition = coalitionByCountry.get(entity.country);
    if (inferredCoalition) {
      entity.coalition = inferredCoalition;
    }
  }
}

export function buildTransportMap(entities: EntityData[]): Map<string, string[]> {
  const transportMap = new Map<string, Set<string>>();
  for (const entity of entities) {
    for (const tag of entity.transportableTags) {
      let transports = transportMap.get(tag);
      if (!transports) {
        transports = new Set<string>();
        transportMap.set(tag, transports);
      }
      transports.add(entity.name);
    }
  }
  return new Map(
    [...transportMap.entries()].map(([tag, transports]) => [tag, [...transports].sort()]),
  );
}

export {
  ensurePersistentDivisionMetadata,
  parsePersistentStore,
  prunePersistentStore,
} from './persistent-store.ts';
