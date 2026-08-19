import { type DeckGenerationConfig, shouldCreateCountryContext } from './generator/config.ts';
import { sanitizeIdentifier } from './generator/helpers.ts';
import type { Coalition, DivisionContext, DivisionMode, EntityData } from './generator/types.ts';

const TEMPLATE_WHITESPACE = /\s+/gu;

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
      ...(customDivision.emblemTexture ? { emblemTexture: customDivision.emblemTexture } : {}),
      ruleFilter: (entity) =>
        customDivision.unitPatterns.some((pattern) => pattern.test(entity.name)),
    });
  }

  assertUniqueContextCodes(contexts);
  return contexts;
}

function assertUniqueContextCodes(contexts: readonly DivisionContext[]): void {
  const contextByCode = new Map<string, DivisionContext>();
  for (const context of contexts) {
    const existing = contextByCode.get(context.code);
    if (existing) {
      throw new Error(
        `Division contexts \`${describeContext(existing)}\` and \`${describeContext(context)}\` both resolve to descriptor code \`${context.code}\`. Rename the custom division code or country/coalition identifier so every generated descriptor remains unique.`,
      );
    }
    contextByCode.set(context.code, context);
  }
}

function describeContext(context: DivisionContext): string {
  return context.scope === 'custom'
    ? (context.nameLabel ?? context.code)
    : `${context.scope}:${context.countryId}`;
}

export function buildGeneratedDivisionName(
  context: DivisionContext,
  mode: DivisionMode,
  modTag: string,
  config: DeckGenerationConfig,
): string {
  return renderContextTemplate(config.naming.divisionName, context, mode, modTag, config);
}

export function buildGeneratedDeckName(
  context: DivisionContext,
  mode: DivisionMode,
  modTag: string,
  config: DeckGenerationConfig,
): string {
  return renderContextTemplate(config.naming.deckName, context, mode, modTag, config);
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
  context: DivisionContext,
  mode: DivisionMode,
  modTag: string,
  config: DeckGenerationConfig,
): string {
  const template =
    context.emblemTexture ??
    (context.coalition.toUpperCase() === 'PACT'
      ? mode === 'Unlimited'
        ? config.emblems.pactUnlimited
        : config.emblems.pactBalanced
      : mode === 'Unlimited'
        ? config.emblems.natoUnlimited
        : config.emblems.natoBalanced);
  return renderContextTemplate(template, context, mode, modTag, config);
}

/** `{label}` expands first. An unknown placeholder is left as-is so typos stay visible. */
function renderContextTemplate(
  template: string,
  context: DivisionContext,
  mode: DivisionMode,
  modTag: string,
  config: DeckGenerationConfig,
): string {
  const substitutions = buildTemplateSubstitutions(context, mode, modTag);
  const withLabel = template.replaceAll('{label}', () =>
    applyTemplateSubstitutions(resolveContextLabelTemplate(context, config), substitutions),
  );
  return applyTemplateSubstitutions(withLabel, substitutions)
    .replaceAll(TEMPLATE_WHITESPACE, ' ')
    .trim();
}

function resolveContextLabelTemplate(
  context: DivisionContext,
  config: DeckGenerationConfig,
): string {
  switch (context.scope) {
    case 'country':
      return config.naming.countryLabel;
    case 'side':
      return config.naming.sideLabel;
    case 'all-side':
      return config.naming.allSideLabel;
    case 'custom':
      return config.naming.customLabel;
  }
}

/** Every value goes in as authored; only `{mode}` is cased, to match `UNLIMITED`. */
function buildTemplateSubstitutions(
  context: DivisionContext,
  mode: DivisionMode,
  modTag: string,
): Record<string, string> {
  return {
    '{modTag}': modTag,
    '{mode}': mode.toUpperCase(),
    '{coalition}': context.coalition,
    '{country}': context.countryId,
    '{name}': context.nameLabel ?? context.code,
    '{code}': context.code,
  };
}

function applyTemplateSubstitutions(
  template: string,
  substitutions: Record<string, string>,
): string {
  let rendered = template;
  for (const [placeholder, replacement] of Object.entries(substitutions)) {
    rendered = rendered.replaceAll(placeholder, () => replacement);
  }
  return rendered;
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
