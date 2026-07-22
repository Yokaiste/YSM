import { type DeckGenerationConfig, shouldCreateCountryContext } from './generator/config.ts';
import { sanitizeIdentifier } from './generator/helpers.ts';
import type { Coalition, DivisionContext, DivisionMode, EntityData } from './generator/types.ts';

export function buildDivisionContexts(
  entities: EntityData[],
  modTag: string,
  config: DeckGenerationConfig,
): DivisionContext[] {
  const observedCoalitions = resolveObservedCoalitions(entities);
  const countryContexts = new Map<string, DivisionContext>();

  if (config.contextGeneration.countries) {
    for (const entity of entities) {
      if (
        !entity.country ||
        !entity.coalition ||
        !shouldCreateCountryContext(entity.country, config)
      ) {
        continue;
      }

      if (!countryContexts.has(entity.country)) {
        const country = entity.country;
        const coalition = entity.coalition;
        countryContexts.set(country, {
          code: `COUNTRY_${sanitizeIdentifier(country)}`,
          scope: 'country',
          coalition,
          countryId: country,
          ruleFilter: (candidate) => candidate.country === country,
        });
      }
    }
  }

  const contexts = [...countryContexts.values()].sort((left, right) =>
    left.countryId.localeCompare(right.countryId),
  );

  if (config.contextGeneration.coalitions) {
    for (const coalition of observedCoalitions) {
      contexts.push({
        code: `SIDE_${coalition}`,
        scope: 'side',
        coalition,
        countryId: modTag,
        ruleFilter: (entity) => entity.coalition === coalition,
      });
    }
  }

  if (config.contextGeneration.allSides) {
    for (const coalition of observedCoalitions) {
      contexts.push({
        code: buildAllSideContextCode(coalition),
        scope: 'all-side',
        coalition,
        countryId: modTag,
        ruleFilter: () => true,
      });
    }
  }

  for (const customDivision of config.customDivisions) {
    if (!customDivision.enabled) {
      continue;
    }
    if (
      customDivision.skipIfEmpty &&
      !entities.some((entity) =>
        customDivision.unitPatterns.some((pattern) => pattern.test(entity.name)),
      )
    ) {
      continue;
    }

    contexts.push({
      code: sanitizeIdentifier(customDivision.code),
      scope: 'custom',
      coalition: customDivision.coalition,
      countryId: customDivision.countryId,
      nameLabel: customDivision.name,
      tags: customDivision.tags,
      allowedModes: customDivision.modes,
      ruleFilter: (entity) =>
        customDivision.unitPatterns.some((pattern) => pattern.test(entity.name)),
    });
  }

  return contexts;
}

export function buildGeneratedDivisionName(
  context: DivisionContext,
  mode: DivisionMode,
  modTag: string,
): string {
  return `${buildContextNameLabel(context)} ${modTag.toUpperCase()} ${mode.toUpperCase()} DIVISION`;
}

export function buildGeneratedDeckName(
  context: DivisionContext,
  mode: DivisionMode,
  modTag: string,
): string {
  return `${buildContextNameLabel(context)} ${modTag.toUpperCase()} ${mode.toUpperCase()} DECK`;
}

export function buildDivisionTags(context: DivisionContext, modTag: string): string[] {
  if (context.scope === 'custom') {
    return ['DEFAULT', modTag, context.coalition, ...(context.tags ?? ['CUSTOM']), 'SANDBOX'];
  }

  const scopeTag =
    context.scope === 'country'
      ? context.countryId
      : context.scope === 'side'
        ? `${context.coalition}_ONLY`
        : 'ALL_UNITS';
  return ['DEFAULT', modTag, context.coalition, scopeTag, 'SANDBOX'];
}

export function resolveDivisionEmblemTexture(
  modTag: string,
  coalition: Coalition,
  mode: DivisionMode,
): string {
  const textureCoalition = coalition.toUpperCase() === 'PACT' ? 'PACT' : 'NATO';
  if (textureCoalition === 'NATO') {
    return mode === 'Unlimited'
      ? `Texture${modTag}_Division_NATO`
      : `Texture${modTag}_Division_NATO_Balanced`;
  }
  return mode === 'Unlimited'
    ? `Texture${modTag}_Division_PACT`
    : `Texture${modTag}_Division_PACT_Balanced`;
}

function buildContextNameLabel(context: DivisionContext): string {
  switch (context.scope) {
    case 'country':
      return `[${context.countryId.toUpperCase()} UNITS ONLY]`;
    case 'side':
      return `[${context.coalition.toUpperCase()} UNITS ONLY]`;
    case 'all-side':
      return '[ALL UNITS]';
    case 'custom':
      return `[${context.nameLabel ?? context.code}]`;
  }
}

function buildAllSideContextCode(coalition: Coalition): string {
  const normalized = coalition.toUpperCase();
  if (normalized === 'NATO') {
    return 'ALL_BLUE';
  }
  if (normalized === 'PACT') {
    return 'ALL_RED';
  }
  return `ALL_${sanitizeIdentifier(coalition)}`;
}

function resolveObservedCoalitions(entities: EntityData[]): Coalition[] {
  return [
    ...new Set(
      entities
        .map((entity) => entity.coalition)
        .filter((coalition): coalition is Coalition => coalition !== undefined),
    ),
  ].sort((left, right) => left.localeCompare(right));
}
