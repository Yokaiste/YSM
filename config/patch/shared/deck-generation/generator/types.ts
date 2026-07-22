import type {
  BuildScriptNdfBlock,
  BuildScriptNdfTools,
  BuildScriptTextTools,
  BuildScriptValueTools,
} from 'ymb/api';

export type Coalition = string;
export type EntityKind = 'building' | 'unit';
export type DivisionMode = 'Unlimited' | 'Balanced';
export type DivisionScope = 'country' | 'side' | 'all-side' | 'custom';
export type VariantKey =
  | 'countryBalanced'
  | 'countryUnlimited'
  | 'sideBalanced'
  | 'sideUnlimited'
  | 'allSideBalanced'
  | 'allSideUnlimited';

interface GenerationOutput {
  targetRelativePath: string;
  content: string;
}

export type NdfBlock = BuildScriptNdfBlock;
export type NdfReaders = Pick<
  BuildScriptNdfTools,
  | 'findTopLevelBlocks'
  | 'extractBody'
  | 'readField'
  | 'readFields'
  | 'readFieldDeep'
  | 'readFieldsDeep'
  | 'findCollectionEntries'
  | 'readPath'
  | 'parseList'
  | 'primaryTypeName'
  | 'stripGeneratedBlocks'
  | 'generatedBlockMarkers'
  | 'renderGeneratedBlock'
  | 'upsertGeneratedBlock'
>;

export interface DeckGenerationInput {
  ndf: NdfReaders;
  values: BuildScriptValueTools;
  text: BuildScriptTextTools;
  modTag: string;
  scriptSourcePath: string;
  generationConfig?: unknown;
  buildingsContent: string;
  unitsContent: string;
  weaponDescriptorsContent: string;
  ammunitionContent: string;
  capacitiesContent: string;
  effectsContent: string;
  orderAvailabilityContent: string;
  divisionRulesContent: string;
  divisionsContent: string;
  deckSerializerContent: string;
  deckPacksContent: string;
  decksContent: string;
  localisationContent: string;
  persistentStoreContent: string;
}

export interface DeckGenerationResult {
  outputs: GenerationOutput[];
  localisationContent: string;
  persistentStoreContent: string;
}

export interface PersistentStore {
  version: 2;
  nextDivisionNameToken: number;
  nextDeckNameToken: number;
  divisions: Record<string, PersistentDivisionMetadata>;
  serializer: PersistentSerializerState;
}

export interface PersistentSerializerState {
  nextDivisionId: number;
  nextUnitId: number;
  divisionIds: Record<string, number>;
  unitIds: Record<string, number>;
}

export interface PersistentDivisionMetadata {
  guid: string;
  divisionNameToken: string;
  deckNameToken: string;
}

export interface EntityData {
  name: string;
  kind: EntityKind;
  tags: string[];
  specialties: string[];
  transportableTags: string[];
  weaponDescriptorNames: string[];
  capacityNames: string[];
  positiveCapacityNames: string[];
  negativeCapacityNames: string[];
  effectTokens: string[];
  positiveEffectTokens: string[];
  negativeEffectTokens: string[];
  effectUtility: number;
  isTransportable: boolean;
  orderAvailabilityName?: string;
  isSellable?: boolean;
  country?: string;
  coalition?: Coalition;
  factoryType?: string;
  unitRole?: string;
  priceCategory?: string;
  strategicType?: string;
  menuIconTexture?: string;
  spawnType?: string;
  pathfindType?: string;
  movingType?: string;
  concealmentBonus?: number;
  identifyBaseProbability?: number;
  hitRollEcm?: number;
  maxPhysicalDamages?: number;
  maxSpeedKmph?: number;
  speedBonusFactorOnRoad?: number;
  fuelCapacity?: number;
  fuelMoveDuration?: number;
  productionTime?: number;
  deploymentShiftGru?: number;
  weaponDeploymentTime?: number;
  travelDuration?: number;
  evacuationTime?: number;
  agilityRadiusGru?: number;
  visionRange?: number;
  opticalStrength?: number;
  frontArmor?: number;
  sideArmor?: number;
  rearArmor?: number;
  topArmor?: number;
  unitAttackValue?: number;
  unitDefenseValue?: number;
  upkeepPercentage?: number;
  canAssist?: boolean;
  supplyCapacity?: number;
  supplyPriority?: number;
  cost: number;
  hasSupplyModule: boolean;
}

export interface WeaponDescriptorData {
  name: string;
  ammunitionNames: string[];
  salves: number[];
  mountedWeapons: WeaponMountData[];
}

export interface WeaponMountData {
  ammunitionName: string;
  ammoBoxIndex: number;
  weaponCount: number;
}

export interface AmmunitionData {
  name: string;
  traits: string[];
  damageFamily?: string;
  minMaxCategory?: string;
  weaponCursorType?: string;
  projectileType?: string;
  armorPenetration?: number;
  accuracyStationary?: number;
  accuracyMoving?: number;
  minimumRangeGru?: number;
  minimumRangeHelicopterGru?: number;
  minimumRangeAirplaneGru?: number;
  maximumRangeGru?: number;
  maximumRangeHelicopterGru?: number;
  maximumRangeAirplaneGru?: number;
  physicalDamages?: number;
  suppressDamages?: number;
  radiusSplashPhysicalDamagesGru?: number;
  radiusSplashSuppressDamagesGru?: number;
  shotsCountPerSalvo?: number;
  aimingTime?: number;
  timeBetweenTwoShots?: number;
  timeBetweenTwoSalvos?: number;
  projectileSpeedGru?: number;
  dispersionAtMaxRangeGru?: number;
  supplyCost?: number;
  canShootOnPosition?: boolean;
  canShootWhileMoving?: boolean;
  isFireAndForget?: boolean;
  tirIndirect?: boolean;
  forceHitTopArmorOnSuccess?: boolean;
  computeArmorFromImpactLocation?: boolean;
  piercingWeapon?: boolean;
  tandemCharge?: boolean;
}

export interface DivisionRuleData {
  unitName: string;
  maxPackNumber: number;
  numberOfUnitInPack: number;
  multipliers: number[];
}

export interface DivisionContext {
  code: string;
  scope: DivisionScope;
  coalition: Coalition;
  countryId: string;
  nameLabel?: string;
  tags?: string[];
  allowedModes?: DivisionMode[];
  ruleFilter: (entity: EntityData) => boolean;
}

export interface CustomDivisionConfig {
  code: string;
  name: string;
  coalition: Coalition;
  countryId: string;
  unitPatterns: RegExp[];
  tags: string[];
  modes: DivisionMode[];
  enabled: boolean;
  skipIfEmpty: boolean;
}

export interface GeneratedRuleEntry {
  entity: EntityData;
  rule: DivisionRuleData;
  transportNames: string[];
}

export interface GeneratedPack {
  descriptorName: string;
  unitName: string;
  transportName?: string;
  xp: number;
  number: number;
}

export interface PremadeCard {
  entity: EntityData;
  categoryKey: string;
  categoryOrder: number;
  typeKey: string;
  roleKeys: string[];
  selectionKind:
    | 'forced'
    | 'type-recommended'
    | 'type-best'
    | 'type-cheap'
    | 'role-recommended'
    | 'role-best'
    | 'role-cheap'
    | 'filler';
  forcedInPremade: boolean;
  maxUnitCardCount: number;
  roleScore: number;
  keepPriority: number;
  similarityKey: string;
  similarityVector: number[];
  profileTokens?: readonly string[];
  packDescriptorName: string;
  transportName?: string;
}

export interface GeneratedDivisionVariant {
  context: DivisionContext;
  mode: DivisionMode;
  descriptorName: string;
  ruleName: string;
  deckDescriptorName: string;
  cfgName: string;
  emblemTexture: string;
  guid: string;
  divisionNameToken: string;
  deckNameToken: string;
  interfaceOrder: number;
  tags: string[];
  standoutUnits: string[];
  ruleEntries: GeneratedRuleEntry[];
  premadeCards: PremadeCard[];
}

export const CATEGORY_ORDER = [
  'Logistic',
  'Infantry',
  'Art',
  'Tanks',
  'Recons',
  'DCA',
  'Helis',
  'Planes',
  'Defense',
] as const;

export const DEFAULT_DIVISION_MODES: DivisionMode[] = ['Unlimited', 'Balanced'];

export function createUnlimitedRule(
  maxPackNumber: number,
  numberOfUnitInPack: number,
): DivisionRuleData {
  return {
    unitName: '',
    maxPackNumber,
    numberOfUnitInPack,
    multipliers: [1, 1, 1, 1],
  };
}

export const FALLBACK_BALANCED_RULE: DivisionRuleData = {
  unitName: '',
  maxPackNumber: 10,
  numberOfUnitInPack: 10,
  multipliers: [1, 0.6, 0.4, 0.1],
};
