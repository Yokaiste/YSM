import { type BuildScriptValueTools, ScriptToolError } from 'ymb/api';
import { createEmptyRecord } from './helpers.ts';
import {
  type Coalition,
  type CustomDivisionConfig,
  DEFAULT_DIVISION_MODES,
  type DivisionContext,
  type DivisionMode,
  type DivisionScope,
  type EntityData,
  type VariantKey,
} from './types.ts';

interface VariantPolicy {
  includeModUnits: boolean;
  includeModSupply: boolean;
}

interface ContextGenerationPolicy {
  countries: boolean;
  coalitions: boolean;
  allSides: boolean;
}

interface CommentDirectiveConfig {
  ignore: string;
  everythingBelow: string;
  forceInclude: string;
}

/**
 * Placeholders: `{label}`, `{modTag}`, `{mode}`, `{coalition}`, `{country}`,
 * `{name}`, `{code}`. Filled by `renderNamingTemplate` in `../../contexts.ts`.
 */
export interface NamingConfig {
  divisionName: string;
  deckName: string;
  countryLabel: string;
  sideLabel: string;
  allSideLabel: string;
  customLabel: string;
}

/** Division emblem textures per side and mode. `{modTag}` is the placeholder. */
export interface EmblemConfig {
  natoUnlimited: string;
  natoBalanced: string;
  pactUnlimited: string;
  pactBalanced: string;
}

/**
 * Plain names shape the run, `division*` the pool, `deck*` the premades. Nested:
 * a division ignore empties the decks; a deck force fills the division.
 */
export interface DeckGenerationConfig {
  deckSlotCount: number;
  unlimitedPackUnitCount: number;
  /** Also drops units no division fields. Blocked categories go either way. */
  excludeHidden: boolean;
  /** A context whose roster is smaller than this generates nothing. 0 disables. */
  minimumContextUnitCount: number;
  /** A context with no command unit generates nothing. */
  requireCommandUnitInContext: boolean;
  contextGeneration: ContextGenerationPolicy;
  commentDirectives: CommentDirectiveConfig;
  naming: NamingConfig;
  emblems: EmblemConfig;
  modCountryIds: Set<string>;
  ignoredDivisionRuleNamePatterns: RegExp[];
  extraSupplyUnitPatterns: RegExp[];
  customDivisions: CustomDivisionConfig[];

  /** Their units join no other division, and their decks go with them. */
  divisionIgnoredCountryIds: Set<string>;
  /** Usually empty: a division keeps every unit. Anything here leaves the decks too. */
  divisionIgnoredUnitPatterns: RegExp[];
  /** Division only; `deckForcedUnitPatterns` is what also fills the deck. */
  divisionForcedUnitPatterns: Partial<Record<VariantKey, RegExp[]>>;
  divisionPolicies: Record<VariantKey, VariantPolicy>;

  /** Their divisions still field them. */
  deckIgnoredCountryIds: Set<string>;
  /** What the generator declines to recommend, not what exists. */
  deckIgnoredUnitPatterns: RegExp[];
  /** Units pulled into a deck, and so into its division, whatever scoring says. */
  deckForcedUnitPatterns: Partial<Record<VariantKey, RegExp[]>>;
  deckPolicies: Record<VariantKey, VariantPolicy>;
  /** When several nations field the same unit, whose copy a deck recommends. */
  deckPreferredCountryIdsByCoalition: Record<string, string[]>;
  /** A card rides nothing when no transport is cheap enough. 0 disables. */
  deckMaxTransportCostRatio: number;
}

const DEFAULT_VARIANT_POLICIES: Record<VariantKey, VariantPolicy> = {
  countryBalanced: { includeModUnits: false, includeModSupply: false },
  countryUnlimited: { includeModUnits: false, includeModSupply: true },
  sideBalanced: { includeModUnits: false, includeModSupply: false },
  sideUnlimited: { includeModUnits: false, includeModSupply: true },
  allSideBalanced: { includeModUnits: false, includeModSupply: false },
  allSideUnlimited: { includeModUnits: true, includeModSupply: true },
};

const VARIANT_KEYS: VariantKey[] = [
  'countryBalanced',
  'countryUnlimited',
  'sideBalanced',
  'sideUnlimited',
  'allSideBalanced',
  'allSideUnlimited',
];

const DECK_GENERATION_KEYS = new Set([
  'deckSlotCount',
  'unlimitedPackUnitCount',
  'excludeHidden',
  'minimumContextUnitCount',
  'requireCommandUnitInContext',
  'contextGeneration',
  'commentDirectives',
  'naming',
  'emblems',
  'modCountryIds',
  'ignoredDivisionRuleNamePatterns',
  'extraSupplyUnitPatterns',
  'customDivisions',
  'divisionIgnoredCountryIds',
  'divisionIgnoredUnitPatterns',
  'divisionForcedUnitPatterns',
  'divisionPolicies',
  'deckIgnoredCountryIds',
  'deckIgnoredUnitPatterns',
  'deckForcedUnitPatterns',
  'deckPolicies',
  'deckPreferredCountryIdsByCoalition',
  'deckMaxTransportCostRatio',
]);

const CUSTOM_DIVISION_KEYS = new Set([
  'code',
  'name',
  'coalition',
  'countryId',
  'unitPatterns',
  'tags',
  'modes',
  'enabled',
  'skipIfEmpty',
  'emblemTexture',
]);

const NAMING_KEYS = new Set([
  'divisionName',
  'deckName',
  'countryLabel',
  'sideLabel',
  'allSideLabel',
  'customLabel',
]);

const EMBLEM_KEYS = new Set(['natoUnlimited', 'natoBalanced', 'pactUnlimited', 'pactBalanced']);

const DEFAULT_DECK_POLICIES = createVariantPolicyDefaults({
  allSideUnlimited: { includeModUnits: false, includeModSupply: true },
});

const DEFAULT_NAMING: NamingConfig = {
  divisionName: '{label} {modTag} {mode} DIVISION',
  deckName: '{label} {modTag} {mode} DECK',
  countryLabel: '[{country} UNITS ONLY]',
  sideLabel: '[{coalition} UNITS ONLY]',
  allSideLabel: '[ALL UNITS]',
  customLabel: '[{name}]',
};

const DEFAULT_EMBLEMS: EmblemConfig = {
  natoUnlimited: 'Texture{modTag}_Division_NATO',
  natoBalanced: 'Texture{modTag}_Division_NATO_Balanced',
  pactUnlimited: 'Texture{modTag}_Division_PACT',
  pactBalanced: 'Texture{modTag}_Division_PACT_Balanced',
};

const DEFAULT_MINIMUM_CONTEXT_UNIT_COUNT = 3;
const DEFAULT_DECK_MAX_TRANSPORT_COST_RATIO = 2;

const DEFAULT_CONTEXT_GENERATION: ContextGenerationPolicy = {
  countries: true,
  coalitions: true,
  allSides: true,
};

const DEFAULT_PREFERRED_UNIT_COUNTRY_IDS_BY_COALITION: Record<string, string[]> = {
  NATO: ['US'],
  PACT: ['SOV'],
};

/** The two targets differ only in which ignore list applies. */
type InclusionTarget = 'division' | 'deck';

export function createDeckGenerationConfig(
  rawConfig: unknown,
  modTag: string,
  values: BuildScriptValueTools,
): DeckGenerationConfig {
  const config = values.record(rawConfig, 'deckGeneration');
  assertKnownKeys(config, 'deckGeneration', DECK_GENERATION_KEYS);
  const deckSlotCount = values.positiveInteger(
    config.deckSlotCount,
    'deckGeneration.deckSlotCount',
  );

  return {
    deckSlotCount,
    unlimitedPackUnitCount: values.positiveInteger(
      config.unlimitedPackUnitCount,
      'deckGeneration.unlimitedPackUnitCount',
    ),
    excludeHidden:
      config.excludeHidden === undefined
        ? false
        : values.boolean(config.excludeHidden, 'deckGeneration.excludeHidden'),
    minimumContextUnitCount: readNonNegativeNumber(
      config.minimumContextUnitCount,
      'deckGeneration.minimumContextUnitCount',
      DEFAULT_MINIMUM_CONTEXT_UNIT_COUNT,
      { integer: true },
    ),
    requireCommandUnitInContext:
      config.requireCommandUnitInContext === undefined
        ? true
        : values.boolean(
            config.requireCommandUnitInContext,
            'deckGeneration.requireCommandUnitInContext',
          ),
    contextGeneration: readContextGeneration(config.contextGeneration, values),
    commentDirectives: readCommentDirectives(config.commentDirectives, modTag, values),
    naming: readNaming(config.naming, values),
    emblems: readEmblems(config.emblems, values),
    modCountryIds: new Set(
      readStringArray(config.modCountryIds, 'deckGeneration.modCountryIds', values, [modTag]).map(
        (countryId) => normalizeCountryId(countryId),
      ),
    ),
    ignoredDivisionRuleNamePatterns: compilePatterns(
      readStringArray(
        config.ignoredDivisionRuleNamePatterns,
        'deckGeneration.ignoredDivisionRuleNamePatterns',
        values,
      ),
    ),
    extraSupplyUnitPatterns: compilePatterns(
      readStringArray(
        config.extraSupplyUnitPatterns,
        'deckGeneration.extraSupplyUnitPatterns',
        values,
      ),
    ),
    customDivisions: readCustomDivisions(config.customDivisions, modTag, values),
    divisionIgnoredCountryIds: readCountryIdSet(
      config.divisionIgnoredCountryIds,
      'deckGeneration.divisionIgnoredCountryIds',
      values,
    ),
    divisionIgnoredUnitPatterns: compilePatterns(
      readStringArray(
        config.divisionIgnoredUnitPatterns,
        'deckGeneration.divisionIgnoredUnitPatterns',
        values,
      ),
    ),
    divisionForcedUnitPatterns: readVariantPatternMap(
      config.divisionForcedUnitPatterns,
      'deckGeneration.divisionForcedUnitPatterns',
      values,
    ),
    divisionPolicies: readVariantPolicies(
      config.divisionPolicies,
      'deckGeneration.divisionPolicies',
      values,
    ),
    deckIgnoredCountryIds: readCountryIdSet(
      config.deckIgnoredCountryIds,
      'deckGeneration.deckIgnoredCountryIds',
      values,
    ),
    deckIgnoredUnitPatterns: compilePatterns(
      readStringArray(
        config.deckIgnoredUnitPatterns,
        'deckGeneration.deckIgnoredUnitPatterns',
        values,
      ),
    ),
    deckForcedUnitPatterns: readVariantPatternMap(
      config.deckForcedUnitPatterns,
      'deckGeneration.deckForcedUnitPatterns',
      values,
    ),
    deckPolicies: readVariantPolicies(
      config.deckPolicies,
      'deckGeneration.deckPolicies',
      values,
      DEFAULT_DECK_POLICIES,
    ),
    deckPreferredCountryIdsByCoalition: readPreferredCountryIdsByCoalition(
      config.deckPreferredCountryIdsByCoalition,
      values,
    ),
    deckMaxTransportCostRatio: readNonNegativeNumber(
      config.deckMaxTransportCostRatio,
      'deckGeneration.deckMaxTransportCostRatio',
      DEFAULT_DECK_MAX_TRANSPORT_COST_RATIO,
    ),
  };
}

function resolveVariantKey(scope: DivisionScope, mode: DivisionMode): VariantKey {
  if (scope === 'country') {
    return mode === 'Unlimited' ? 'countryUnlimited' : 'countryBalanced';
  }
  if (scope === 'side') {
    return mode === 'Unlimited' ? 'sideUnlimited' : 'sideBalanced';
  }
  return mode === 'Unlimited' ? 'allSideUnlimited' : 'allSideBalanced';
}

export function shouldCreateCountryContext(
  countryId: string | undefined,
  config: DeckGenerationConfig,
): boolean {
  if (!countryId) {
    return false;
  }
  // Either ignore list stops the country context: without a deck there is no
  // point generating the division, and without a division there is no deck.
  const normalizedCountryId = normalizeCountryId(countryId);
  return (
    !config.modCountryIds.has(normalizedCountryId) &&
    !config.divisionIgnoredCountryIds.has(normalizedCountryId) &&
    !config.deckIgnoredCountryIds.has(normalizedCountryId)
  );
}

export function shouldIncludeEntityInVariant(
  entity: EntityData,
  context: DivisionContext,
  mode: DivisionMode,
  config: DeckGenerationConfig,
): boolean {
  return shouldIncludeEntityWithPolicy(
    entity,
    context,
    resolveVariantKey(context.scope, mode),
    config,
    config.divisionPolicies,
    'division',
  );
}

function shouldIncludeEntityWithPolicy(
  entity: EntityData,
  context: DivisionContext,
  variantKey: VariantKey,
  config: DeckGenerationConfig,
  policyMap: Record<VariantKey, VariantPolicy>,
  target: InclusionTarget,
): boolean {
  if (!entity.country) {
    return false;
  }

  if (context.scope === 'custom') {
    if (isEntityIgnored(entity, config, target)) {
      return false;
    }
    return context.ruleFilter(entity);
  }

  if (isForcedEntityForVariant(entity, variantKey, config, target)) {
    return true;
  }

  if (isEntityIgnored(entity, config, target)) {
    return false;
  }

  if (isModCountryEntity(entity, config)) {
    const policy = policyMap[variantKey];
    return policy.includeModUnits || (policy.includeModSupply && isSupplyEntity(entity, config));
  }

  return context.ruleFilter(entity);
}

export function shouldForceEntityInPremade(
  entity: EntityData,
  context: DivisionContext,
  mode: DivisionMode,
  config: DeckGenerationConfig,
): boolean {
  if (context.scope === 'custom') {
    return false;
  }
  return isForcedEntityForVariant(entity, resolveVariantKey(context.scope, mode), config, 'deck');
}

export function shouldIncludeEntityInPremade(
  entity: EntityData,
  context: DivisionContext,
  mode: DivisionMode,
  config: DeckGenerationConfig,
): boolean {
  if (shouldForceEntityInPremade(entity, context, mode, config)) {
    return true;
  }
  return shouldIncludeEntityWithPolicy(
    entity,
    context,
    resolveVariantKey(context.scope, mode),
    config,
    config.deckPolicies,
    'deck',
  );
}

export function compareCountryPreference(
  left: EntityData,
  right: EntityData,
  coalition: Coalition,
  config: DeckGenerationConfig,
): number {
  const preferences = config.deckPreferredCountryIdsByCoalition[coalition] ?? [];
  const leftRank = resolvePreferredCountryRank(left.country, preferences);
  const rightRank = resolvePreferredCountryRank(right.country, preferences);
  return leftRank - rightRank;
}

/** Division lists apply to both targets, deck lists only to decks. */
function isEntityIgnored(
  entity: EntityData,
  config: DeckGenerationConfig,
  target: InclusionTarget,
): boolean {
  if (!entity.country) {
    return true;
  }
  const countryId = normalizeCountryId(entity.country);
  if (
    config.divisionIgnoredCountryIds.has(countryId) ||
    matchesPatterns(entity.name, config.divisionIgnoredUnitPatterns)
  ) {
    return true;
  }
  if (target === 'division') {
    return false;
  }

  return (
    config.deckIgnoredCountryIds.has(countryId) ||
    matchesPatterns(entity.name, config.deckIgnoredUnitPatterns)
  );
}

export function isModCountryEntity(entity: EntityData, config: DeckGenerationConfig): boolean {
  return Boolean(entity.country && config.modCountryIds.has(normalizeCountryId(entity.country)));
}

function isSupplyEntity(entity: EntityData, config: DeckGenerationConfig): boolean {
  return entity.hasSupplyModule || matchesPatterns(entity.name, config.extraSupplyUnitPatterns);
}

/** A deck force is also a division force; a division force is not a deck force. */
function isForcedEntityForVariant(
  entity: EntityData,
  variantKey: VariantKey,
  config: DeckGenerationConfig,
  target: InclusionTarget,
): boolean {
  if (matchesPatterns(entity.name, config.deckForcedUnitPatterns[variantKey] ?? [])) {
    return true;
  }
  return (
    target === 'division' &&
    matchesPatterns(entity.name, config.divisionForcedUnitPatterns[variantKey] ?? [])
  );
}

function readVariantPolicies(
  rawValue: unknown,
  label: string,
  values: BuildScriptValueTools,
  defaults: Record<VariantKey, VariantPolicy> = DEFAULT_VARIANT_POLICIES,
): Record<VariantKey, VariantPolicy> {
  const rawPolicies = optionalRecord(rawValue, label, values);
  assertKnownKeys(rawPolicies, label, new Set(VARIANT_KEYS));
  const policies = Object.fromEntries(
    VARIANT_KEYS.map((variantKey) => [variantKey, { ...defaults[variantKey] }]),
  ) as Record<VariantKey, VariantPolicy>;

  for (const variantKey of VARIANT_KEYS) {
    const rawPolicy = optionalRecord(rawPolicies[variantKey], `${label}.${variantKey}`, values);
    assertKnownKeys(
      rawPolicy,
      `${label}.${variantKey}`,
      new Set(['includeModUnits', 'includeModSupply']),
    );
    if (rawPolicy.includeModUnits !== undefined) {
      policies[variantKey].includeModUnits = values.boolean(
        rawPolicy.includeModUnits,
        `${label}.${variantKey}.includeModUnits`,
      );
    }
    if (rawPolicy.includeModSupply !== undefined) {
      policies[variantKey].includeModSupply = values.boolean(
        rawPolicy.includeModSupply,
        `${label}.${variantKey}.includeModSupply`,
      );
    }
  }

  return policies;
}

function readContextGeneration(
  rawValue: unknown,
  values: BuildScriptValueTools,
): ContextGenerationPolicy {
  const rawPolicy = optionalRecord(rawValue, 'deckGeneration.contextGeneration', values);
  assertKnownKeys(
    rawPolicy,
    'deckGeneration.contextGeneration',
    new Set(['countries', 'coalitions', 'allSides']),
  );
  return {
    countries:
      rawPolicy.countries === undefined
        ? DEFAULT_CONTEXT_GENERATION.countries
        : values.boolean(rawPolicy.countries, 'contextGeneration.countries'),
    coalitions:
      rawPolicy.coalitions === undefined
        ? DEFAULT_CONTEXT_GENERATION.coalitions
        : values.boolean(rawPolicy.coalitions, 'contextGeneration.coalitions'),
    allSides:
      rawPolicy.allSides === undefined
        ? DEFAULT_CONTEXT_GENERATION.allSides
        : values.boolean(rawPolicy.allSides, 'contextGeneration.allSides'),
  };
}

function readNaming(rawValue: unknown, values: BuildScriptValueTools): NamingConfig {
  const rawNaming = optionalRecord(rawValue, 'deckGeneration.naming', values);
  assertKnownKeys(rawNaming, 'deckGeneration.naming', NAMING_KEYS);
  return Object.fromEntries(
    Object.entries(DEFAULT_NAMING).map(([key, fallback]) => [
      key,
      readOptionalString(rawNaming[key], `deckGeneration.naming.${key}`, values) ?? fallback,
    ]),
  ) as unknown as NamingConfig;
}

function readEmblems(rawValue: unknown, values: BuildScriptValueTools): EmblemConfig {
  const rawEmblems = optionalRecord(rawValue, 'deckGeneration.emblems', values);
  assertKnownKeys(rawEmblems, 'deckGeneration.emblems', EMBLEM_KEYS);
  return Object.fromEntries(
    Object.entries(DEFAULT_EMBLEMS).map(([key, fallback]) => [
      key,
      readOptionalString(rawEmblems[key], `deckGeneration.emblems.${key}`, values) ?? fallback,
    ]),
  ) as unknown as EmblemConfig;
}

function readCountryIdSet(
  rawValue: unknown,
  label: string,
  values: BuildScriptValueTools,
): Set<string> {
  return new Set(
    readStringArray(rawValue, label, values).map((countryId) => normalizeCountryId(countryId)),
  );
}

function readPreferredCountryIdsByCoalition(
  rawValue: unknown,
  values: BuildScriptValueTools,
): Record<Coalition, string[]> {
  const rawConfig = optionalRecord(
    rawValue,
    'deckGeneration.deckPreferredCountryIdsByCoalition',
    values,
  );
  const preferredByCoalition = createEmptyRecord<string[]>();
  for (const [coalition, countryIds] of Object.entries(
    DEFAULT_PREFERRED_UNIT_COUNTRY_IDS_BY_COALITION,
  )) {
    preferredByCoalition[coalition] = countryIds.map((countryId) => normalizeCountryId(countryId));
  }
  for (const [coalition, value] of Object.entries(rawConfig)) {
    const countryIds = readStringArray(
      value,
      `deckGeneration.deckPreferredCountryIdsByCoalition.${coalition}`,
      values,
    );
    preferredByCoalition[coalition] = countryIds.map((countryId) => normalizeCountryId(countryId));
  }
  return preferredByCoalition;
}

function readCustomDivisions(
  rawValue: unknown,
  modTag: string,
  values: BuildScriptValueTools,
): CustomDivisionConfig[] {
  if (rawValue === undefined) {
    return [];
  }
  if (!Array.isArray(rawValue)) {
    throw invalidConfigValue(
      'deckGeneration.customDivisions',
      'an array of custom division objects',
      rawValue,
    );
  }

  const divisions: CustomDivisionConfig[] = [];
  for (const [index, rawEntry] of rawValue.entries()) {
    const entry = values.record(rawEntry, `deckGeneration.customDivisions[${index}]`);
    const entryLabel = `deckGeneration.customDivisions[${index}]`;
    assertKnownKeys(entry, entryLabel, CUSTOM_DIVISION_KEYS);
    const code = readRequiredString(entry.code, `${entryLabel}.code`, values);
    const name = readRequiredString(entry.name, `${entryLabel}.name`, values);
    const unitPatterns = compilePatterns(
      readRequiredStringArray(entry.unitPatterns, `${entryLabel}.unitPatterns`, values),
    );

    const emblemTexture = readOptionalString(
      entry.emblemTexture,
      `${entryLabel}.emblemTexture`,
      values,
    );

    divisions.push({
      code,
      name,
      coalition: readCoalition(entry.coalition, `${entryLabel}.coalition`, values),
      countryId: readOptionalString(entry.countryId, `${entryLabel}.countryId`, values) ?? modTag,
      unitPatterns,
      ...(emblemTexture ? { emblemTexture } : {}),
      tags: readStringArray(entry.tags, `${entryLabel}.tags`, values, ['CUSTOM']),
      modes: readDivisionModes(entry.modes, `${entryLabel}.modes`, values),
      enabled:
        entry.enabled === undefined ? true : values.boolean(entry.enabled, `${code}.enabled`),
      skipIfEmpty:
        entry.skipIfEmpty === undefined
          ? false
          : values.boolean(entry.skipIfEmpty, `${code}.skipIfEmpty`),
    });
  }

  return divisions;
}

function readCommentDirectives(
  rawValue: unknown,
  modTag: string,
  values: BuildScriptValueTools,
): CommentDirectiveConfig {
  const rawConfig = optionalRecord(rawValue, 'deckGeneration.commentDirectives', values);
  assertKnownKeys(
    rawConfig,
    'deckGeneration.commentDirectives',
    new Set(['ignore', 'everythingBelow', 'forceInclude']),
  );
  return {
    ignore:
      readOptionalString(rawConfig.ignore, 'commentDirectives.ignore', values) ??
      `${modTag}-ignore`,
    everythingBelow:
      readOptionalString(rawConfig.everythingBelow, 'commentDirectives.everythingBelow', values) ??
      `${modTag}-ignore-everything-below`,
    forceInclude:
      readOptionalString(rawConfig.forceInclude, 'commentDirectives.forceInclude', values) ??
      `${modTag}-force-include`,
  };
}

function readVariantPatternMap(
  rawValue: unknown,
  label: string,
  valueTools: BuildScriptValueTools,
): Partial<Record<VariantKey, RegExp[]>> {
  const rawMap = optionalRecord(rawValue, label, valueTools);
  assertKnownKeys(rawMap, label, new Set(VARIANT_KEYS));
  const compiled: Partial<Record<VariantKey, RegExp[]>> = {};

  for (const variantKey of VARIANT_KEYS) {
    const patterns = readStringArray(rawMap[variantKey], `${label}.${variantKey}`, valueTools);
    if (patterns.length > 0) {
      compiled[variantKey] = compilePatterns(patterns);
    }
  }

  return compiled;
}

function readStringArray(
  value: unknown,
  label: string,
  values: BuildScriptValueTools,
  fallback: string[] = [],
): string[] {
  if (value === undefined) return [...fallback];
  return values
    .stringArray(value, label)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** Accepts 0, which `values.positiveInteger` rejects, because 0 disables the check. */
function readNonNegativeNumber(
  value: unknown,
  label: string,
  fallback: number,
  options: { integer?: boolean } = {},
): number {
  if (value === undefined) {
    return fallback;
  }
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    (options.integer === true && !Number.isInteger(value))
  ) {
    throw invalidConfigValue(
      label,
      options.integer === true ? 'a whole number of 0 or more' : 'a number of 0 or more',
      value,
    );
  }
  return value;
}

function readOptionalString(
  value: unknown,
  label: string,
  values: BuildScriptValueTools,
): string | undefined {
  const parsed = values.optionalString(value, label);
  if (parsed === undefined) return undefined;
  const trimmed = parsed.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function readRequiredString(value: unknown, label: string, values: BuildScriptValueTools): string {
  const parsed = values.string(value, label).trim();
  if (parsed.length === 0) {
    throw invalidConfigValue(label, 'a non-empty string', value);
  }
  return parsed;
}

function readRequiredStringArray(
  value: unknown,
  label: string,
  values: BuildScriptValueTools,
): string[] {
  const parsed = readStringArray(value, label, values);
  if (parsed.length === 0) {
    throw invalidConfigValue(label, 'an array containing at least one non-empty string', value);
  }
  return parsed;
}

function readDivisionModes(
  value: unknown,
  label: string,
  values: BuildScriptValueTools,
): DivisionMode[] {
  if (value === undefined) {
    return [...DEFAULT_DIVISION_MODES];
  }

  const authoredModes = readRequiredStringArray(value, label, values);
  const modes = authoredModes.map((mode, index): DivisionMode => {
    if (mode.toLowerCase() === 'unlimited') return 'Unlimited';
    if (mode.toLowerCase() === 'balanced') return 'Balanced';
    throw new ScriptToolError({
      reason: `Expected \`${label}[${index}]\` to name a supported division mode.`,
      suggestion: 'Use `Unlimited` or `Balanced`.',
      details: [`Received: ${JSON.stringify(mode)}`],
    });
  });

  return [...new Set(modes)];
}

function readCoalition(value: unknown, label: string, values: BuildScriptValueTools): Coalition {
  return readOptionalString(value, label, values) ?? 'NATO';
}

function compilePatterns(patterns: string[]): RegExp[] {
  return patterns.map((pattern) => {
    try {
      return new RegExp(pattern, 'i');
    } catch (error) {
      throw new Error(
        `Invalid deck-generation regular expression \`${pattern}\`: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });
}

function matchesPatterns(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function normalizeCountryId(countryId: string): string {
  return countryId.trim().toUpperCase();
}

function resolvePreferredCountryRank(countryId: string | undefined, preferences: string[]): number {
  if (!countryId) {
    return preferences.length + 1;
  }
  const normalizedCountryId = normalizeCountryId(countryId);
  const index = preferences.indexOf(normalizedCountryId);
  return index >= 0 ? index : preferences.length;
}

function createVariantPolicyDefaults(
  overrides: Partial<Record<VariantKey, VariantPolicy>> = {},
): Record<VariantKey, VariantPolicy> {
  return Object.fromEntries(
    VARIANT_KEYS.map((variantKey) => [
      variantKey,
      { ...DEFAULT_VARIANT_POLICIES[variantKey], ...overrides[variantKey] },
    ]),
  ) as Record<VariantKey, VariantPolicy>;
}

function optionalRecord(
  value: unknown,
  label: string,
  values: BuildScriptValueTools,
): Record<string, unknown> {
  return value === undefined ? {} : values.record(value, label);
}

function assertKnownKeys(
  value: Record<string, unknown>,
  label: string,
  allowedKeys: ReadonlySet<string>,
): void {
  const unknownKeys = Object.keys(value).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length === 0) return;

  throw new ScriptToolError({
    reason: `Unsupported ${label} ${unknownKeys.length === 1 ? 'field' : 'fields'}: ${unknownKeys.join(', ')}.`,
    suggestion: `Remove ${unknownKeys.map((key) => `\`${key}\``).join(', ')} or correct the field name.`,
    details: [`Supported fields: ${[...allowedKeys].join(', ')}`],
  });
}

function invalidConfigValue(label: string, expected: string, value: unknown): ScriptToolError {
  return new ScriptToolError({
    reason: `Expected \`${label}\` to be ${expected}.`,
    suggestion: `Set \`${label}\` to ${expected}.`,
    details: [`Received: ${describeConfigValue(value)}`],
  });
}

function describeConfigValue(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
