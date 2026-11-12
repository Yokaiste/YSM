import { upsertLocalisationRow } from '../../shared/localisation.ts';
import {
  buildDivisionContexts,
  buildDivisionTags,
  buildGeneratedDeckName,
  buildGeneratedDivisionName,
  buildGeneratedDivisionSummaryText,
  resolveDivisionEmblemTexture,
} from './contexts.ts';
import { createEntityAnalysisFactory, type EntityAnalysisFactory } from './generator/analysis.ts';
import {
  applyDamageResistanceProfiles,
  applyPersistentFireProfiles,
} from './generator/combat-data.ts';
import {
  createDeckGenerationConfig,
  type DeckGenerationConfig,
  shouldIncludeEntityInPremade,
  shouldIncludeEntityInVariant,
} from './generator/config.ts';
import {
  haveEqualArrays,
  isCommandEntity,
  resolveDeckMaxActivationPointsFromCategories,
  resolvePackCount,
  sanitizeIdentifier,
} from './generator/helpers.ts';
import { analyzeHiddenUnits, isHiddenEntity } from './generator/hidden-units.ts';
import {
  applyCapacityEffectProfiles,
  applyInferredCoalitions,
  buildTransportMap,
  ensurePersistentDivisionMetadata,
  parseAmmunition,
  parseCapacityEffectProfiles,
  parseDivisionCoalitionsByUnit,
  parseDivisionCostMatrices,
  parseDivisionDescriptors,
  parseDivisionRuleData,
  parseEntities,
  parseLocalisation,
  parsePersistentStore,
  parseSellableOrderAvailabilityNames,
  parseWeaponDescriptors,
  renderLocalisation,
} from './generator/parsers.ts';
import { getDivisionSummaryToken } from './generator/persistent-store.ts';
import { buildPremadeCards } from './generator/premade.ts';
import { buildRuleEntries, createBalancedRuleResolver } from './generator/rules.ts';
import type {
  DeckGenerationInput,
  DeckGenerationResult,
  DivisionContext,
  EntityData,
  GeneratedDivisionVariant,
  GeneratedPack,
} from './generator/types.ts';
import {
  injectDeckSerializerEntries,
  renderDeckPacksOutput,
  renderDecksOutput,
  renderDivisionRulesOutput,
  renderDivisionsOutput,
} from './render.ts';
import { TARGET_PATHS } from './sources.ts';

export interface DeckGenerationSourceAnalysis {
  entityByName: Map<string, EntityData>;
  transportMap: Map<string, string[]>;
  deckableEntities: EntityData[];
  weaponDescriptors: ReturnType<typeof parseWeaponDescriptors>;
  ammunition: ReturnType<typeof parseAmmunition>;
  sourceDivisionRulesContent: string;
  sourceDivisionsContent: string;
  analysisFactory: EntityAnalysisFactory;
}

export function createDeckGenerationSourceAnalysis(
  input: DeckGenerationInput,
): DeckGenerationSourceAnalysis {
  const { ndf } = input;
  const config = createDeckGenerationConfig(input.generationConfig, input.modTag, input.values);
  const sourceDivisionRulesContent = ndf.stripGeneratedBlocks(input.divisionRulesContent);
  const sourceDivisionsContent = ndf.stripGeneratedBlocks(input.divisionsContent);
  const buildings = parseEntities(input.buildingsContent, 'building', ndf, {
    commentDirectives: config.commentDirectives,
  });
  const units = parseEntities(input.unitsContent, 'unit', ndf, {
    commentDirectives: config.commentDirectives,
  });
  const weaponDescriptors = parseWeaponDescriptors(input.weaponDescriptorsContent, ndf);
  const ammunition = parseAmmunition(input.ammunitionContent, ndf);
  const entities = [...buildings, ...units];
  if (input.damageResistanceContent !== undefined) {
    applyDamageResistanceProfiles(ammunition, entities, input.damageResistanceContent, ndf);
  }
  if (input.fireDescriptorsContent !== undefined) {
    applyPersistentFireProfiles(ammunition, input.fireDescriptorsContent, ndf);
  }
  for (const entity of entities) {
    for (const name of entity.weaponDescriptorNames) {
      if (!weaponDescriptors.has(name))
        throw new Error(`Unit ${entity.name} references missing weapon manager ${name}.`);
    }
  }
  for (const weapon of weaponDescriptors.values()) {
    for (const name of weapon.ammunitionNames) {
      if (!ammunition.has(name))
        throw new Error(`Weapon manager ${weapon.name} references missing ammunition ${name}.`);
    }
  }
  applyInferredCoalitions(
    entities,
    parseDivisionCoalitionsByUnit(
      parseDivisionDescriptors(
        sourceDivisionRulesContent,
        sourceDivisionsContent,
        config.ignoredDivisionRuleNamePatterns,
        ndf,
      ),
    ),
  );
  applyCapacityEffectProfiles(
    entities,
    parseCapacityEffectProfiles(input.capacitiesContent, input.effectsContent, ndf),
  );
  const sellableOrderNames = parseSellableOrderAvailabilityNames(input.orderAvailabilityContent);
  for (const entity of entities) {
    entity.isSellable = Boolean(
      entity.orderAvailabilityName && sellableOrderNames.has(entity.orderAvailabilityName),
    );
  }
  const entityByName = new Map(entities.map((entity) => [entity.name, entity] as const));
  const transportMap = buildTransportMap(entities);
  const deckableEntities = entities.filter((entity) => isDeckableEntity(entity));
  return {
    entityByName,
    transportMap,
    deckableEntities,
    weaponDescriptors,
    ammunition,
    sourceDivisionRulesContent,
    sourceDivisionsContent,
    analysisFactory: createEntityAnalysisFactory(weaponDescriptors, ammunition),
  };
}

export { buildGeneratedDivisionSummaryText } from './contexts.ts';

export function generateDeckOutputsFromSources(
  input: DeckGenerationInput,
  sources: DeckGenerationSourceAnalysis,
): DeckGenerationResult {
  const { ndf } = input;
  const config = createDeckGenerationConfig(input.generationConfig, input.modTag, input.values);
  const {
    ammunition,
    analysisFactory,
    deckableEntities,
    entityByName,
    sourceDivisionRulesContent,
    sourceDivisionsContent,
    transportMap,
    weaponDescriptors,
  } = sources;
  // Each batch entry brings its own ignore patterns, so this is parsed per entry.
  const divisionDescriptors = parseDivisionDescriptors(
    sourceDivisionRulesContent,
    sourceDivisionsContent,
    config.ignoredDivisionRuleNamePatterns,
    ndf,
  );
  const vanillaRules = parseDivisionRuleData(
    sourceDivisionRulesContent,
    divisionDescriptors,
    config.ignoredDivisionRuleNamePatterns,
    ndf,
  );
  const hiddenUnits = analyzeHiddenUnits(
    divisionDescriptors,
    parseDivisionCostMatrices(input.divisionCostMatrixContent, ndf),
    entityByName,
  );
  const eligibleDeckableEntities = deckableEntities.filter(
    (entity) => !isHiddenEntity(entity, hiddenUnits, config),
  );
  const sortedEligibleDeckableEntities = [...eligibleDeckableEntities].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const maxActivationPoints = resolveDeckMaxActivationPointsFromCategories(
    config.deckSlotCount,
    eligibleDeckableEntities.map((entity) => entity.factoryType),
  );
  const contexts = buildDivisionContexts(eligibleDeckableEntities, input.modTag, config);
  const persistentStore = parsePersistentStore(input.persistentStoreContent);
  const localisationState = parseLocalisation(input.localisationContent);
  const generatedPacks = new Map<string, GeneratedPack>();
  const variantBuildContext: DivisionVariantBuildContext = {
    modTag: input.modTag,
    deckableEntities: sortedEligibleDeckableEntities,
    entityByName,
    transportMap,
    weaponDescriptors,
    ammunition,
    analysisFactory,
    balancedRuleFor: createBalancedRuleResolver(sortedEligibleDeckableEntities, vanillaRules),
    generatedPacks,
    persistentStore,
    localisationState,
    config,
  };
  const divisions = contexts.flatMap((context, index) =>
    buildDivisionVariants(context, index, variantBuildContext),
  );
  dedupeIdenticalDivisionRules(divisions);
  pruneGeneratedPacks(generatedPacks, divisions);
  assertGeneratedDeckIntegrity(divisions, generatedPacks, config);

  const referencedUnitNames = collectReferencedUnitNames(divisions, generatedPacks);
  const outputs = [
    {
      targetRelativePath: TARGET_PATHS.divisionRulesContent,
      content: renderDivisionRulesOutput(
        ndf,
        input.divisionRulesContent,
        divisions,
        input.blockOwnerId,
        input.scriptSourcePath,
      ),
    },
    {
      targetRelativePath: TARGET_PATHS.divisionsContent,
      content: renderDivisionsOutput(
        ndf,
        input.divisionsContent,
        divisions,
        maxActivationPoints,
        input.blockOwnerId,
        input.scriptSourcePath,
        input.modTag,
      ),
    },
    {
      targetRelativePath: TARGET_PATHS.deckSerializerContent,
      content: injectDeckSerializerEntries(
        ndf,
        input.text.escapeRegExp,
        input.deckSerializerContent,
        divisions,
        referencedUnitNames,
        input.blockOwnerId,
        input.scriptSourcePath,
        persistentStore.serializer,
      ),
    },
    {
      targetRelativePath: TARGET_PATHS.deckPacksContent,
      content: renderDeckPacksOutput(
        ndf,
        input.deckPacksContent,
        [...generatedPacks.values()],
        input.blockOwnerId,
        input.scriptSourcePath,
      ),
    },
    {
      targetRelativePath: TARGET_PATHS.decksContent,
      content: renderDecksOutput(
        ndf,
        input.decksContent,
        divisions,
        input.blockOwnerId,
        input.scriptSourcePath,
      ),
    },
  ];

  return {
    outputs,
    localisationContent: renderLocalisation(localisationState),
    persistentStoreContent: `${JSON.stringify(persistentStore, null, 2)}\n`,
  };
}

function dedupeIdenticalDivisionRules(divisions: GeneratedDivisionVariant[]): void {
  const canonicalByHash = new Map<number | bigint, GeneratedDivisionVariant[]>();

  for (const division of divisions) {
    const signatureHash = Bun.hash(
      division.ruleEntries
        .map((entry) =>
          [
            entry.entity.name,
            entry.transportNames.join(','),
            entry.rule.maxPackNumber,
            entry.rule.numberOfUnitInPack,
            entry.rule.multipliers.join(','),
          ].join('|'),
        )
        .join('\n'),
    );
    const candidates = canonicalByHash.get(signatureHash) ?? [];
    const canonical = candidates.find((candidate) =>
      haveIdenticalRuleEntries(candidate.ruleEntries, division.ruleEntries),
    );
    if (canonical) {
      division.ruleName = canonical.ruleName;
      division.ruleEntries = canonical.ruleEntries;
      continue;
    }
    candidates.push(division);
    canonicalByHash.set(signatureHash, candidates);
  }
}

function haveIdenticalRuleEntries(
  left: GeneratedDivisionVariant['ruleEntries'],
  right: GeneratedDivisionVariant['ruleEntries'],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((leftEntry, index) => {
    const rightEntry = right[index];
    return (
      rightEntry !== undefined &&
      leftEntry.entity.name === rightEntry.entity.name &&
      leftEntry.rule.maxPackNumber === rightEntry.rule.maxPackNumber &&
      leftEntry.rule.numberOfUnitInPack === rightEntry.rule.numberOfUnitInPack &&
      haveEqualArrays(leftEntry.transportNames, rightEntry.transportNames) &&
      haveEqualArrays(leftEntry.rule.multipliers, rightEntry.rule.multipliers)
    );
  });
}

function pruneGeneratedPacks(
  generatedPacks: Map<string, GeneratedPack>,
  divisions: GeneratedDivisionVariant[],
): void {
  const usedPackNames = new Set(
    divisions.flatMap((division) => division.premadeCards.map((card) => card.packDescriptorName)),
  );
  for (const packName of generatedPacks.keys()) {
    if (!usedPackNames.has(packName)) {
      generatedPacks.delete(packName);
    }
  }
}

function assertGeneratedDeckIntegrity(
  divisions: GeneratedDivisionVariant[],
  generatedPacks: ReadonlyMap<string, GeneratedPack>,
  config: ReturnType<typeof createDeckGenerationConfig>,
): void {
  const referencedPackNames = new Set<string>();
  const ruleEntriesByName = new Map<string, GeneratedDivisionVariant['ruleEntries']>();
  for (const division of divisions) {
    const existingRuleEntries = ruleEntriesByName.get(division.ruleName);
    if (existingRuleEntries && existingRuleEntries !== division.ruleEntries) {
      throw new Error(
        `Generated divisions reuse rule name \`${division.ruleName}\` for non-identical rule lists.`,
      );
    }
    ruleEntriesByName.set(division.ruleName, division.ruleEntries);
    const ruleEntryByUnit = new Map(
      division.ruleEntries.map((entry) => [entry.entity.name, entry] as const),
    );
    const cardKeys = new Set<string>();
    const categoryCounts = new Map<string, number>();
    for (const card of division.premadeCards) {
      const cardKey = `${card.entity.name}|${card.transportName ?? ''}`;
      if (cardKeys.has(cardKey)) {
        throw new Error(
          `Generated premade deck \`${division.deckDescriptorName}\` contains duplicate card \`${cardKey}\`.`,
        );
      }
      cardKeys.add(cardKey);
      categoryCounts.set(card.categoryKey, (categoryCounts.get(card.categoryKey) ?? 0) + 1);

      const ruleEntry = ruleEntryByUnit.get(card.entity.name);
      if (!ruleEntry) {
        throw new Error(
          `Generated premade card \`${cardKey}\` has no matching division rule in \`${division.ruleName}\`.`,
        );
      }
      if (card.transportName && !ruleEntry.transportNames.includes(card.transportName)) {
        throw new Error(
          `Generated premade card \`${cardKey}\` uses a transport absent from its division rule.`,
        );
      }

      const pack = generatedPacks.get(card.packDescriptorName);
      if (
        !pack ||
        pack.unitName !== card.entity.name ||
        pack.transportName !== card.transportName
      ) {
        throw new Error(
          `Generated premade card \`${cardKey}\` does not resolve to a matching pack descriptor.`,
        );
      }
      if (
        pack.xp < 0 ||
        pack.xp > 3 ||
        !Number.isInteger(pack.xp) ||
        pack.number <= 0 ||
        pack.number !==
          resolvePackCount(
            ruleEntry.rule.numberOfUnitInPack,
            ruleEntry.rule.multipliers[pack.xp] ?? 0,
          )
      ) {
        throw new Error(
          'Generated pack ' +
            pack.descriptorName +
            ' has unavailable veterancy or an incorrect unit count.',
        );
      }
      referencedPackNames.add(card.packDescriptorName);
    }

    if (
      config.requireCommandUnitInContext &&
      !division.premadeCards.some((card) => isCommandEntity(card.entity))
    ) {
      throw new Error(
        'Generated deck ' +
          division.deckDescriptorName +
          ' has no command card. Raise deckSlotCount or narrow forced units.',
      );
    }
    for (const [categoryKey, cardCount] of categoryCounts) {
      if (cardCount > config.deckSlotCount) {
        throw new Error(
          `Generated premade deck \`${division.deckDescriptorName}\` has ${cardCount} ${categoryKey} cards; the category limit is ${config.deckSlotCount}.`,
        );
      }
    }
  }

  for (const packName of generatedPacks.keys()) {
    if (!referencedPackNames.has(packName)) {
      throw new Error(`Generated deck pack \`${packName}\` is not referenced by any premade deck.`);
    }
  }
}

interface DivisionVariantBuildContext {
  modTag: string;
  deckableEntities: EntityData[];
  entityByName: Map<string, EntityData>;
  transportMap: Map<string, string[]>;
  weaponDescriptors: ReturnType<typeof parseWeaponDescriptors>;
  ammunition: ReturnType<typeof parseAmmunition>;
  analysisFactory: EntityAnalysisFactory;
  balancedRuleFor: ReturnType<typeof createBalancedRuleResolver>;
  generatedPacks: Map<string, GeneratedPack>;
  persistentStore: ReturnType<typeof parsePersistentStore>;
  localisationState: ReturnType<typeof parseLocalisation>;
  config: ReturnType<typeof createDeckGenerationConfig>;
}

function buildDivisionVariants(
  context: DivisionContext,
  contextIndex: number,
  args: DivisionVariantBuildContext,
): GeneratedDivisionVariant[] {
  const {
    modTag,
    deckableEntities,
    entityByName,
    transportMap,
    weaponDescriptors,
    ammunition,
    analysisFactory,
    balancedRuleFor,
    generatedPacks,
    persistentStore,
    localisationState,
    config,
  } = args;

  const variants: GeneratedDivisionVariant[] = [];
  // Negative orders keep every generated division above the vanilla list
  // (lower shows first): custom -> all-units -> side -> country.
  const scopeRank =
    context.scope === 'custom'
      ? 0
      : context.scope === 'all-side'
        ? 1
        : context.scope === 'side'
          ? 2
          : 3;
  const baseOrder = context.interfaceOrder ?? -10_000 + scopeRank * 2_000 + contextIndex * 4;
  const modes = context.allowedModes ?? config.modes;

  for (const [modeIndex, mode] of modes.entries()) {
    const variantFilter = (entity: EntityData) =>
      shouldIncludeEntityInVariant(entity, context, mode, config);
    const contextEntities = deckableEntities.filter(variantFilter);
    // Both rosters have to stand on their own, so failing either drops the mode.
    if (
      !isViableRoster(contextEntities, config) ||
      !isViableRoster(
        contextEntities.filter((entity) =>
          shouldIncludeEntityInPremade(entity, context, mode, config),
        ),
        config,
      )
    ) {
      continue;
    }
    const availableEntityNames = new Set(contextEntities.map((entity) => entity.name));

    const ruleEntries = buildRuleEntries({
      entities: contextEntities,
      mode,
      transportMap,
      entityByName,
      availableEntityNames,
      balancedRuleFor,
      config,
    });

    const premadeCards = buildPremadeCards({
      context,
      mode,
      ruleEntries,
      entityByName,
      generatedPacks,
      weaponDescriptors,
      ammunition,
      analysisFactory,
      modTag,
      contextCode: context.code,
      config,
    });

    const descriptorBase = `${sanitizeIdentifier(modTag)}_${context.code}_${mode.toUpperCase()}`;
    const metadata = ensurePersistentDivisionMetadata(
      persistentStore,
      localisationState,
      descriptorBase,
      buildGeneratedDivisionName(context, mode, modTag, config),
      buildGeneratedDeckName(context, mode, modTag, config),
    );
    const summaryTextToken = getDivisionSummaryToken(metadata.divisionNameToken);
    upsertLocalisationRow(
      localisationState,
      summaryTextToken,
      buildGeneratedDivisionSummaryText(context, mode, modTag, config),
    );

    variants.push({
      context,
      mode,
      descriptorName: `Descriptor_Deck_Division_${descriptorBase}`,
      ruleName: `Descriptor_Deck_Division_${descriptorBase}_Rule`,
      deckDescriptorName: `Descriptor_Deck_${descriptorBase}_Premade`,
      cfgName: descriptorBase,
      emblemTexture: resolveDivisionEmblemTexture(context, mode, modTag, config),
      guid: metadata.guid,
      divisionNameToken: metadata.divisionNameToken,
      deckNameToken: metadata.deckNameToken,
      summaryTextToken,
      interfaceOrder: baseOrder + modeIndex,
      tags: buildDivisionTags(context, modTag),
      standoutUnits: resolveStandoutUnits(premadeCards),
      ruleEntries,
      premadeCards,
    });
  }

  return variants;
}

export function isViableRoster(
  entities: readonly EntityData[],
  config: DeckGenerationConfig,
): boolean {
  if (entities.length < config.minimumContextUnitCount) {
    return false;
  }
  return !config.requireCommandUnitInContext || entities.some((entity) => isCommandEntity(entity));
}

export function resolveStandoutUnits(
  premadeCards: GeneratedDivisionVariant['premadeCards'],
): string[] {
  const selected = new Set<string>();
  for (const card of premadeCards) {
    if (card.selectionKind !== 'forced' || selected.has(card.entity.name)) {
      continue;
    }
    selected.add(card.entity.name);
    if (selected.size >= 5) {
      break;
    }
  }
  return [...selected];
}

function collectReferencedUnitNames(
  divisions: GeneratedDivisionVariant[],
  generatedPacks: Map<string, GeneratedPack>,
): string[] {
  const unitNames = new Set<string>();

  for (const division of divisions) {
    for (const entry of division.ruleEntries) {
      unitNames.add(entry.entity.name);
      for (const transportName of entry.transportNames) {
        unitNames.add(transportName);
      }
    }
  }

  for (const pack of generatedPacks.values()) {
    unitNames.add(pack.unitName);
    if (pack.transportName) {
      unitNames.add(pack.transportName);
    }
  }

  return [...unitNames];
}

function isDeckableEntity(entity: EntityData): boolean {
  return Boolean(entity.factoryType && entity.country && entity.coalition);
}
