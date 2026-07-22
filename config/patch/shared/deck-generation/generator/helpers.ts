import { CATEGORY_ORDER, type EntityData } from './types.ts';

const mobilityKeyCache = new WeakMap<EntityData, string>();
const platformFormCache = new WeakMap<EntityData, PlatformForm>();
const premadeTypeKeyCache = new WeakMap<EntityData, string>();
const commandEntityCache = new WeakMap<EntityData, boolean>();
const sanitizedIdentifierCache = new Map<string, string>();

export function compareEntityPriority(left: EntityData, right: EntityData): number {
  return left.name.localeCompare(right.name);
}

export function deriveMobilityKey(entity: EntityData): string {
  const cached = mobilityKeyCache.get(entity);
  if (cached !== undefined) {
    return cached;
  }

  const mobilityFields = [
    entity.spawnType,
    entity.movingType,
    entity.pathfindType,
    entity.factoryType,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => value.toLowerCase());
  if (
    mobilityFields.some((value) => matchesMobilityValue(value, ['helicopter', 'heli', 'rotary']))
  ) {
    return cacheMobilityKey(entity, 'Helicopter');
  }
  if (
    mobilityFields.some((value) =>
      matchesMobilityValue(value, ['plane', 'aircraft', 'airborne', 'fixedwing', 'jet', 'vtol']),
    )
  ) {
    return cacheMobilityKey(entity, 'Plane');
  }
  if (
    mobilityFields.some((value) =>
      matchesMobilityValue(value, ['ship', 'boat', 'naval', 'marine', 'sea', 'submarine']),
    )
  ) {
    return cacheMobilityKey(entity, 'Naval');
  }
  if (mobilityFields.some((value) => matchesMobilityValue(value, ['hover', 'hovercraft']))) {
    return cacheMobilityKey(entity, 'Hover');
  }
  if (entity.factoryType === 'Helis') {
    return cacheMobilityKey(entity, 'Helicopter');
  }
  if (entity.factoryType === 'Planes') {
    return cacheMobilityKey(entity, 'Plane');
  }
  if (entity.kind === 'building') {
    return cacheMobilityKey(entity, 'Building');
  }
  return cacheMobilityKey(entity, 'Ground');
}

export type PlatformForm =
  | 'building'
  | 'dismounted_infantry'
  | 'fixed_wing'
  | 'naval'
  | 'rotary_wing'
  | 'tracked_vehicle'
  | 'towable'
  | 'wheeled_vehicle';

export function derivePlatformForm(entity: EntityData): PlatformForm {
  const cached = platformFormCache.get(entity);
  if (cached !== undefined) {
    return cached;
  }
  if (entity.kind === 'building') return cachePlatformForm(entity, 'building');
  if (entity.isTransportable && isInfantryPlatform(entity)) {
    return cachePlatformForm(entity, 'dismounted_infantry');
  }
  if (entity.isTransportable) return cachePlatformForm(entity, 'towable');
  const mobility = deriveMobilityKey(entity);
  if (mobility === 'Plane') return cachePlatformForm(entity, 'fixed_wing');
  if (mobility === 'Helicopter') return cachePlatformForm(entity, 'rotary_wing');
  if (mobility === 'Naval') return cachePlatformForm(entity, 'naval');
  if (isWheeledGroundPlatform(entity)) return cachePlatformForm(entity, 'wheeled_vehicle');
  if (isTrackedGroundPlatform(entity)) return cachePlatformForm(entity, 'tracked_vehicle');
  return cachePlatformForm(entity, 'tracked_vehicle');
}

function isInfantryPlatform(entity: EntityData): boolean {
  return [entity.spawnType, entity.movingType, entity.pathfindType, ...entity.tags].some(
    (value) => {
      const normalized = value?.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '') ?? '';
      return normalized.includes('infantry') || normalized.includes('infanterie');
    },
  );
}

function isWheeledGroundPlatform(entity: EntityData): boolean {
  return [entity.movingType, entity.pathfindType, entity.spawnType, ...entity.tags].some(
    (value) => {
      const normalized = value?.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '') ?? '';
      return normalized.includes('wheel') || normalized.includes('roue');
    },
  );
}

function isTrackedGroundPlatform(entity: EntityData): boolean {
  return [entity.movingType, entity.pathfindType, entity.spawnType, ...entity.tags].some(
    (value) => {
      const normalized = value?.toLowerCase().replaceAll(/[^a-z0-9]+/gu, '') ?? '';
      return normalized.includes('track') || normalized.includes('chenille');
    },
  );
}

export function derivePremadeTypeKey(entity: EntityData): string {
  const cached = premadeTypeKeyCache.get(entity);
  if (cached !== undefined) {
    return cached;
  }
  const mobility = deriveMobilityKey(entity);
  if (entity.kind === 'building') {
    const key = entity.hasSupplyModule ? `Supply_${mobility}` : `Building_${mobility}`;
    premadeTypeKeyCache.set(entity, key);
    return key;
  }

  const explicitType =
    entity.strategicType && entity.strategicType !== 'NotCounted'
      ? entity.strategicType
      : entity.unitRole && entity.unitRole.length > 0
        ? entity.unitRole
        : entity.hasSupplyModule
          ? 'Supply'
          : (entity.factoryType ?? 'Unknown');

  const key = `${sanitizeIdentifier(explicitType)}_${mobility}_${derivePlatformForm(entity)}`;
  premadeTypeKeyCache.set(entity, key);
  return key;
}

export function deriveSimilarityTypeKey(entity: EntityData): string {
  return sanitizeIdentifier(
    entity.strategicType && entity.strategicType !== 'NotCounted'
      ? entity.strategicType
      : entity.unitRole && entity.unitRole.length > 0
        ? entity.unitRole
        : (entity.factoryType ?? 'Unknown'),
  );
}

export function formatNumber(value: number): string {
  if (Number.isInteger(value)) {
    return `${value}.0`;
  }
  return value.toFixed(2).replace(/0+$/u, '').replace(/\.$/u, '.0');
}

export function renderNumberArray(values: number[]): string {
  return `[${values.map((value) => formatNumber(value)).join(', ')}]`;
}

export function resolveCategoryOrder(factoryType: string | undefined): number {
  if (!factoryType) {
    return CATEGORY_ORDER.length + 1;
  }
  const index = CATEGORY_ORDER.indexOf(factoryType as (typeof CATEGORY_ORDER)[number]);
  return index >= 0 ? index : CATEGORY_ORDER.length + 1;
}

export function resolveDeckMaxActivationPointsFromCategories(
  deckSlotCount: number,
  factoryTypes: Iterable<string | undefined>,
): number {
  const categoryCount = new Set(
    [...factoryTypes].filter((factoryType): factoryType is string => Boolean(factoryType)),
  ).size;
  return deckSlotCount * Math.max(CATEGORY_ORDER.length, categoryCount);
}

export function isCommandEntity(entity: EntityData): boolean {
  const cached = commandEntityCache.get(entity);
  if (cached !== undefined) {
    return cached;
  }
  const fields = [
    entity.name,
    entity.strategicType,
    entity.unitRole,
    ...entity.tags,
    ...entity.specialties,
  ]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => value.toLowerCase().replaceAll(/[^a-z0-9]+/g, ' '));
  const result = fields.some((value) =>
    /\b(cmd|command|commander|hq|headquarters|leader)\b/.test(value),
  );
  commandEntityCache.set(entity, result);
  return result;
}

function matchesMobilityValue(value: string, needles: string[]): boolean {
  return needles.some((needle) => value.includes(needle));
}

export function sanitizeIdentifier(value: string): string {
  const cached = sanitizedIdentifierCache.get(value);
  if (cached !== undefined) {
    return cached;
  }
  const sanitized = value.replaceAll(/[^A-Za-z0-9]+/g, '_').replaceAll(/^_+|_+$/g, '');
  sanitizedIdentifierCache.set(value, sanitized);
  return sanitized;
}

function cacheMobilityKey(entity: EntityData, value: string): string {
  mobilityKeyCache.set(entity, value);
  return value;
}

function cachePlatformForm(entity: EntityData, value: PlatformForm): PlatformForm {
  platformFormCache.set(entity, value);
  return value;
}
