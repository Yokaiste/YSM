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
      ...(customDivision.divisionName ? { divisionName: customDivision.divisionName } : {}),
      ...(customDivision.deckName ? { deckName: customDivision.deckName } : {}),
      ...(customDivision.description ? { description: customDivision.description } : {}),
      ...(customDivision.interfaceOrder === undefined
        ? {}
        : { interfaceOrder: customDivision.interfaceOrder }),
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
  return renderContextTemplate(
    context.divisionName ?? config.naming.divisionName,
    context,
    mode,
    modTag,
    config,
  );
}

export function buildGeneratedDeckName(
  context: DivisionContext,
  mode: DivisionMode,
  modTag: string,
  config: DeckGenerationConfig,
): string {
  return renderContextTemplate(
    context.deckName ?? config.naming.deckName,
    context,
    mode,
    modTag,
    config,
  );
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

/** Expand labels before the surrounding content; unresolved placeholders must not reach players. */
function renderContextTemplate(
  template: string,
  context: DivisionContext,
  mode: DivisionMode,
  modTag: string,
  config: DeckGenerationConfig,
): string {
  const substitutions = buildTemplateSubstitutions(context, mode, modTag, config);
  const withLabel = template.replaceAll('{label}', () =>
    applyTemplateSubstitutions(resolveContextLabelTemplate(context, config), substitutions),
  );
  const rendered = applyTemplateSubstitutions(withLabel, substitutions)
    .replaceAll(TEMPLATE_WHITESPACE, ' ')
    .trim();
  const unresolved = rendered.match(/\{[A-Za-z_][A-Za-z0-9_]*\}/);
  if (unresolved) {
    throw new Error(
      `Unknown division text placeholder ${unresolved[0]}. Check deckGeneration.naming or the custom division text.`,
    );
  }
  return rendered;
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

function buildTemplateSubstitutions(
  context: DivisionContext,
  mode: DivisionMode,
  modTag: string,
  config: DeckGenerationConfig,
): Record<string, string> {
  const substitutions = {
    '{modTag}': modTag,
    '{mode}':
      mode === 'StaticBalanced'
        ? config.naming.staticBalancedLabel
        : mode === 'Balanced'
          ? config.naming.balancedLabel
          : config.naming.unlimitedLabel,
    '{coalition}': context.coalition,
    '{country}': context.countryId,
    '{code}': context.code,
  };
  return {
    ...substitutions,
    '{name}': applyTemplateSubstitutions(context.nameLabel ?? context.code, substitutions),
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

export function buildGeneratedDivisionSummaryText(
  context: DivisionContext,
  mode: DivisionMode,
  modTag: string,
  config: DeckGenerationConfig,
): string {
  const modeDescription =
    mode === 'Unlimited'
      ? config.naming.unlimitedDescription
      : mode === 'Balanced'
        ? config.naming.balancedDescription
        : config.naming.staticBalancedDescription;
  const template = (
    context.description ??
    (modeDescription || config.naming.description)
  ).replaceAll('{divisionName}', () => buildGeneratedDivisionName(context, mode, modTag, config));
  return renderContextTemplate(template, context, mode, modTag, config);
}
