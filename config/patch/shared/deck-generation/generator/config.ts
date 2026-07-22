import type { BuildScriptValueTools } from 'ymb/api';
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

export interface DeckGenerationConfig {
  deckSlotCount: number;
  unlimitedPackUnitCount: number;
  excludeUnitsNotInAnyDivision: boolean;
  contextGeneration: ContextGenerationPolicy;
  commentDirectives: CommentDirectiveConfig;
  preferredUnitCountryIdsByCoalition: Record<string, string[]>;
  modCountryIds: Set<string>;
  ignoredCountryIds: Set<string>;
  ignoredUnitPatterns: RegExp[];
  ignoredDivisionRuleNamePatterns: RegExp[];
  extraSupplyUnitPatterns: RegExp[];
  forcedPremadeUnitPatterns: Partial<Record<VariantKey, RegExp[]>>;
  variantPolicies: Record<VariantKey, VariantPolicy>;
  premadePolicies: Record<VariantKey, VariantPolicy>;
  customDivisions: CustomDivisionConfig[];
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

const DEFAULT_PREMADE_POLICIES = createVariantPolicyDefaults({
  allSideUnlimited: { includeModUnits: false, includeModSupply: true },
});

const DEFAULT_CONTEXT_GENERATION: ContextGenerationPolicy = {
  countries: true,
  coalitions: true,
  allSides: true,
};

const DEFAULT_PREFERRED_UNIT_COUNTRY_IDS_BY_COALITION: Record<string, string[]> = {
  NATO: ['US'],
  PACT: ['SOV'],
};

export function createDeckGenerationConfig(
  rawConfig: unknown,
  modTag: string,
  values: BuildScriptValueTools,
): DeckGenerationConfig {
  const config = values.record(rawConfig, 'deckGeneration');
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
    excludeUnitsNotInAnyDivision:
      config.excludeUnitsNotInAnyDivision === undefined
        ? false
        : values.boolean(
            config.excludeUnitsNotInAnyDivision,
            'deckGeneration.excludeUnitsNotInAnyDivision',
          ),
    contextGeneration: readContextGeneration(config.contextGeneration, values),
    commentDirectives: readCommentDirectives(config.commentDirectives, modTag, values),
    preferredUnitCountryIdsByCoalition: readPreferredCountryIdsByCoalition(
      config.preferredUnitCountryIdsByCoalition,
      values,
    ),
    modCountryIds: new Set(
      readStringArray(config.modCountryIds, 'deckGeneration.modCountryIds', values, [modTag]).map(
        (countryId) => normalizeCountryId(countryId),
      ),
    ),
    ignoredCountryIds: new Set(
      readStringArray(config.ignoredCountryIds, 'deckGeneration.ignoredCountryIds', values).map(
        (countryId) => normalizeCountryId(countryId),
      ),
    ),
    ignoredUnitPatterns: compilePatterns(
      readStringArray(config.ignoredUnitPatterns, 'deckGeneration.ignoredUnitPatterns', values),
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
    forcedPremadeUnitPatterns: readVariantPatternMap(config.forcedPremadeUnitPatterns, values),
    variantPolicies: readVariantPolicies(config.variantPolicies, values),
    premadePolicies: readVariantPolicies(config.premadePolicies, values, DEFAULT_PREMADE_POLICIES),
    customDivisions: readCustomDivisions(config.customDivisions, modTag, values),
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
  const normalizedCountryId = normalizeCountryId(countryId);
  return (
    !config.modCountryIds.has(normalizedCountryId) &&
    !config.ignoredCountryIds.has(normalizedCountryId)
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
    config.variantPolicies,
  );
}

export function shouldIncludeEntityInGenerationPool(
  entity: EntityData,
  divisionMemberNames: ReadonlySet<string>,
  config: DeckGenerationConfig,
): boolean {
  if (!config.excludeUnitsNotInAnyDivision) {
    return true;
  }
  return divisionMemberNames.has(entity.name) || isModCountryEntity(entity, config);
}

function shouldIncludeEntityWithPolicy(
  entity: EntityData,
  context: DivisionContext,
  variantKey: VariantKey,
  config: DeckGenerationConfig,
  policyMap: Record<VariantKey, VariantPolicy>,
): boolean {
  if (!entity.country) {
    return false;
  }

  if (context.scope === 'custom') {
    if (isEntityGloballyIgnored(entity, config)) {
      return false;
    }
    return context.ruleFilter(entity);
  }

  if (isForcedPremadeEntityForVariant(entity, variantKey, config)) {
    return true;
  }

  if (isEntityGloballyIgnored(entity, config)) {
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
  return isForcedPremadeEntity(entity, context, mode, config);
}

function isForcedPremadeEntity(
  entity: EntityData,
  context: DivisionContext,
  mode: DivisionMode,
  config: DeckGenerationConfig,
): boolean {
  if (context.scope === 'custom') {
    return false;
  }
  return isForcedPremadeEntityForVariant(entity, resolveVariantKey(context.scope, mode), config);
}

export function shouldIncludeEntityInPremade(
  entity: EntityData,
  context: DivisionContext,
  mode: DivisionMode,
  config: DeckGenerationConfig,
): boolean {
  if (isForcedPremadeEntity(entity, context, mode, config)) {
    return true;
  }
  return shouldIncludeEntityWithPolicy(
    entity,
    context,
    resolveVariantKey(context.scope, mode),
    config,
    config.premadePolicies,
  );
}

export function compareCountryPreference(
  left: EntityData,
  right: EntityData,
  coalition: Coalition,
  config: DeckGenerationConfig,
): number {
  const preferences = config.preferredUnitCountryIdsByCoalition[coalition] ?? [];
  const leftRank = resolvePreferredCountryRank(left.country, preferences);
  const rightRank = resolvePreferredCountryRank(right.country, preferences);
  return leftRank - rightRank;
}

function isEntityGloballyIgnored(entity: EntityData, config: DeckGenerationConfig): boolean {
  if (!entity.country) {
    return true;
  }

  if (config.ignoredCountryIds.has(normalizeCountryId(entity.country))) {
    return true;
  }

  if (matchesPatterns(entity.name, config.ignoredUnitPatterns)) {
    return true;
  }

  return false;
}

function isModCountryEntity(entity: EntityData, config: DeckGenerationConfig): boolean {
  return Boolean(entity.country && config.modCountryIds.has(normalizeCountryId(entity.country)));
}

function isSupplyEntity(entity: EntityData, config: DeckGenerationConfig): boolean {
  return entity.hasSupplyModule || matchesPatterns(entity.name, config.extraSupplyUnitPatterns);
}

function isForcedPremadeEntityForVariant(
  entity: EntityData,
  variantKey: VariantKey,
  config: DeckGenerationConfig,
): boolean {
  const forcedPatterns = config.forcedPremadeUnitPatterns[variantKey] ?? [];
  return matchesPatterns(entity.name, forcedPatterns);
}

function readVariantPolicies(
  rawValue: unknown,
  values: BuildScriptValueTools,
  defaults: Record<VariantKey, VariantPolicy> = DEFAULT_VARIANT_POLICIES,
): Record<VariantKey, VariantPolicy> {
  const rawPolicies = optionalRecord(rawValue, 'deckGeneration.variantPolicies', values);
  const policies = Object.fromEntries(
    VARIANT_KEYS.map((variantKey) => [variantKey, { ...defaults[variantKey] }]),
  ) as Record<VariantKey, VariantPolicy>;

  for (const variantKey of VARIANT_KEYS) {
    const rawPolicy = optionalRecord(
      rawPolicies[variantKey],
      `deckGeneration.variantPolicies.${variantKey}`,
      values,
    );
    if (rawPolicy.includeModUnits !== undefined) {
      policies[variantKey].includeModUnits = values.boolean(
        rawPolicy.includeModUnits,
        `variantPolicies.${variantKey}.includeModUnits`,
      );
    }
    if (rawPolicy.includeModSupply !== undefined) {
      policies[variantKey].includeModSupply = values.boolean(
        rawPolicy.includeModSupply,
        `variantPolicies.${variantKey}.includeModSupply`,
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

function readPreferredCountryIdsByCoalition(
  rawValue: unknown,
  values: BuildScriptValueTools,
): Record<Coalition, string[]> {
  const rawConfig = optionalRecord(
    rawValue,
    'deckGeneration.preferredUnitCountryIdsByCoalition',
    values,
  );
  const preferredByCoalition: Record<string, string[]> = Object.fromEntries(
    Object.entries(DEFAULT_PREFERRED_UNIT_COUNTRY_IDS_BY_COALITION).map(
      ([coalition, countryIds]) => [
        coalition,
        countryIds.map((countryId) => normalizeCountryId(countryId)),
      ],
    ),
  );
  for (const [coalition, value] of Object.entries(rawConfig)) {
    const countryIds = readStringArray(
      value,
      `deckGeneration.preferredUnitCountryIdsByCoalition.${coalition}`,
      values,
    );
    if (countryIds.length > 0) {
      preferredByCoalition[coalition] = countryIds.map((countryId) =>
        normalizeCountryId(countryId),
      );
    }
  }
  return preferredByCoalition;
}

function readCustomDivisions(
  rawValue: unknown,
  modTag: string,
  values: BuildScriptValueTools,
): CustomDivisionConfig[] {
  if (!Array.isArray(rawValue)) {
    return [];
  }

  const divisions: CustomDivisionConfig[] = [];
  for (const [index, rawEntry] of rawValue.entries()) {
    const entry = values.record(rawEntry, `deckGeneration.customDivisions[${index}]`);
    const code = readOptionalString(entry.code, `customDivisions[${index}].code`, values);
    const name = readOptionalString(entry.name, `customDivisions[${index}].name`, values);
    const unitPatterns = compilePatterns(
      readStringArray(entry.unitPatterns, `customDivisions[${index}].unitPatterns`, values),
    );
    if (!code || !name || unitPatterns.length === 0) {
      continue;
    }

    divisions.push({
      code,
      name,
      coalition: readCoalition(entry.coalition, `customDivisions[${index}].coalition`, values),
      countryId:
        readOptionalString(entry.countryId, `customDivisions[${index}].countryId`, values) ??
        modTag,
      unitPatterns,
      tags: readStringArray(entry.tags, `customDivisions[${index}].tags`, values, ['CUSTOM']),
      modes: readDivisionModes(entry.modes, `customDivisions[${index}].modes`, values),
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
  valueTools: BuildScriptValueTools,
  defaults: Partial<Record<VariantKey, string[]>> = {},
): Partial<Record<VariantKey, RegExp[]>> {
  const rawMap = optionalRecord(rawValue, 'deckGeneration.forcedPremadeUnitPatterns', valueTools);
  const compiled: Partial<Record<VariantKey, RegExp[]>> = {};

  for (const variantKey of VARIANT_KEYS) {
    const patterns = readStringArray(
      rawMap[variantKey],
      `forcedPremadeUnitPatterns.${variantKey}`,
      valueTools,
      defaults[variantKey] ?? [],
    );
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

function readDivisionModes(
  value: unknown,
  label: string,
  values: BuildScriptValueTools,
): DivisionMode[] {
  const modes = readStringArray(value, label, values)
    .map((mode) => mode.toLowerCase())
    .flatMap((mode): DivisionMode[] => {
      if (mode === 'unlimited') {
        return ['Unlimited'];
      }
      if (mode === 'balanced') {
        return ['Balanced'];
      }
      return [];
    });

  return modes.length > 0 ? [...new Set(modes)] : [...DEFAULT_DIVISION_MODES];
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
