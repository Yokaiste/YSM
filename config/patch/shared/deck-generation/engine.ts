import {
  buildDivisionContexts,
  buildDivisionTags,
  buildGeneratedDeckName,
  buildGeneratedDivisionName,
  resolveDivisionEmblemTexture,
} from './contexts.ts';
import { createEntityAnalysisFactory, type EntityAnalysisFactory } from './generator/analysis.ts';
import {
  createDeckGenerationConfig,
  shouldIncludeEntityInGenerationPool,
  shouldIncludeEntityInVariant,
} from './generator/config.ts';
import {
  resolveDeckMaxActivationPointsFromCategories,
  sanitizeIdentifier,
} from './generator/helpers.ts';
import {
  applyCapacityEffectProfiles,
  applyInferredCoalitions,
  buildTransportMap,
  ensurePersistentDivisionMetadata,
  parseAmmunition,
  parseCapacityEffectProfiles,
  parseDivisionCoalitionsByUnit,
  parseDivisionRuleData,
  parseEntities,
  parseLocalisation,
  parsePersistentStore,
  parseSellableOrderAvailabilityNames,
  parseWeaponDescriptors,
  prunePersistentStore,
  renderLocalisation,
} from './generator/parsers.ts';
import { buildPremadeCards } from './generator/premade.ts';
import { buildRuleEntries } from './generator/rules.ts';
import {
  DEFAULT_DIVISION_MODES,
  type DeckGenerationInput,
  type DeckGenerationResult,
  type DivisionContext,
  type DivisionRuleData,
  type EntityData,
  type GeneratedDivisionVariant,
  type GeneratedPack,
} from './generator/types.ts';
import {
  injectDeckSerializerEntries,
  renderDeckPacksOutput,
  renderDecksOutput,
  renderDivisionRulesOutput,
  renderDivisionsOutput,
} from './render.ts';

export function generateDeckOutputs(input: DeckGenerationInput): DeckGenerationResult {
  return generateDeckOutputsFromSources(input, createDeckGenerationSourceAnalysis(input));
}

export interface DeckGenerationSourceAnalysis {
  entities: EntityData[];
  entityByName: Map<string, EntityData>;
  transportMap: Map<string, string[]>;
  deckableEntities: EntityData[];
  weaponDescriptors: ReturnType<typeof parseWeaponDescriptors>;
  ammunition: ReturnType<typeof parseAmmunition>;
  sourceDivisionRulesContent: string;
  sourceDivisionsContent: string;
  analysisFactory: EntityAnalysisFactory;
  divisionRuleDataByIgnoreKey: Map<string, ReturnType<typeof parseDivisionRuleData>>;
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
  applyInferredCoalitions(
    entities,
    parseDivisionCoalitionsByUnit(
      sourceDivisionRulesContent,
      sourceDivisionsContent,
      config.ignoredDivisionRuleNamePatterns,
      ndf,
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
    entities,
    entityByName,
    transportMap,
    deckableEntities,
    weaponDescriptors,
    ammunition,
    sourceDivisionRulesContent,
    sourceDivisionsContent,
    analysisFactory: createEntityAnalysisFactory(weaponDescriptors, ammunition),
    divisionRuleDataByIgnoreKey: new Map(),
  };
}

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
  const ignoreKey = config.ignoredDivisionRuleNamePatterns
    .map((pattern) => pattern.source)
    .join('\0');
  let divisionRuleData = sources.divisionRuleDataByIgnoreKey.get(ignoreKey);
  if (!divisionRuleData) {
    divisionRuleData = parseDivisionRuleData(
      sourceDivisionRulesContent,
      config.ignoredDivisionRuleNamePatterns,
      ndf,
      sourceDivisionsContent,
    );
    sources.divisionRuleDataByIgnoreKey.set(ignoreKey, divisionRuleData);
  }
  const vanillaRules = divisionRuleData.rules;
  const divisionMemberNames = divisionRuleData.memberNames;
  const eligibleDeckableEntities = deckableEntities.filter((entity) =>
    shouldIncludeEntityInGenerationPool(entity, divisionMemberNames, config),
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
  const divisions = contexts.flatMap((context, index) =>
    buildDivisionVariants({
      context,
      contextIndex: index,
      modTag: input.modTag,
      deckableEntities: sortedEligibleDeckableEntities,
      entityByName,
      transportMap,
      weaponDescriptors,
      ammunition,
      analysisFactory,
      vanillaRules,
      generatedPacks,
      persistentStore,
      localisationState,
      config,
    }),
  );
  dedupeIdenticalDivisionRules(divisions);
  pruneGeneratedPacks(generatedPacks, divisions);
  assertGeneratedDeckIntegrity(divisions, generatedPacks, config);

  prunePersistentStore(
    persistentStore,
    divisions.map((division) => division.cfgName),
  );

  const referencedUnitNames = collectReferencedUnitNames(divisions, generatedPacks);
  const outputs = [
    {
      targetRelativePath: 'GameData/Generated/Gameplay/Decks/DivisionRules.ndf',
      content: renderDivisionRulesOutput(
        ndf,
        input.divisionRulesContent,
        divisions,
        input.scriptSourcePath,
      ),
    },
    {
      targetRelativePath: 'GameData/Generated/Gameplay/Decks/Divisions.ndf',
      content: renderDivisionsOutput(
        ndf,
        input.divisionsContent,
        divisions,
        maxActivationPoints,
        input.scriptSourcePath,
        input.modTag,
      ),
    },
    {
      targetRelativePath: 'GameData/Generated/Gameplay/Decks/DeckSerializer.ndf',
      content: injectDeckSerializerEntries(
        ndf,
        input.text.escapeRegExp,
        input.deckSerializerContent,
        divisions,
        referencedUnitNames,
        input.scriptSourcePath,
        persistentStore.serializer,
      ),
    },
    {
      targetRelativePath: 'GameData/Generated/Gameplay/Decks/DeckPacks.ndf',
      content: renderDeckPacksOutput(
        ndf,
        input.deckPacksContent,
        [...generatedPacks.values()],
        input.scriptSourcePath,
      ),
    },
    {
      targetRelativePath: 'GameData/Generated/Gameplay/Decks/Decks.ndf',
      content: renderDecksOutput(ndf, input.decksContent, divisions, input.scriptSourcePath),
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
      haveEqualStringArrays(leftEntry.transportNames, rightEntry.transportNames) &&
      haveEqualNumberArrays(leftEntry.rule.multipliers, rightEntry.rule.multipliers)
    );
  });
}

function haveEqualStringArrays(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function haveEqualNumberArrays(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
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
      referencedPackNames.add(card.packDescriptorName);
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

function buildDivisionVariants(args: {
  context: DivisionContext;
  contextIndex: number;
  modTag: string;
  deckableEntities: EntityData[];
  entityByName: Map<string, EntityData>;
  transportMap: Map<string, string[]>;
  weaponDescriptors: ReturnType<typeof parseWeaponDescriptors>;
  ammunition: ReturnType<typeof parseAmmunition>;
  analysisFactory: EntityAnalysisFactory;
  vanillaRules: Map<string, DivisionRuleData>;
  generatedPacks: Map<string, GeneratedPack>;
  persistentStore: ReturnType<typeof parsePersistentStore>;
  localisationState: ReturnType<typeof parseLocalisation>;
  config: ReturnType<typeof createDeckGenerationConfig>;
}): GeneratedDivisionVariant[] {
  const {
    context,
    contextIndex,
    modTag,
    deckableEntities,
    entityByName,
    transportMap,
    weaponDescriptors,
    ammunition,
    analysisFactory,
    vanillaRules,
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
  const baseOrder = -10_000 + scopeRank * 2_000 + contextIndex * 4;
  const modes = context.allowedModes ?? DEFAULT_DIVISION_MODES;

  for (const [modeIndex, mode] of modes.entries()) {
    const variantFilter = (entity: EntityData) =>
      shouldIncludeEntityInVariant(entity, context, mode, config);
    const contextEntities = deckableEntities.filter(variantFilter);
    const availableEntityNames = new Set(contextEntities.map((entity) => entity.name));

    const ruleEntries = buildRuleEntries({
      entities: contextEntities,
      mode,
      deckableEntities,
      transportMap,
      entityByName,
      availableEntityNames,
      vanillaRules,
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
      buildGeneratedDivisionName(context, mode, modTag),
      buildGeneratedDeckName(context, mode, modTag),
    );

    variants.push({
      context,
      mode,
      descriptorName: `Descriptor_Deck_Division_${descriptorBase}`,
      ruleName: `Descriptor_Deck_Division_${descriptorBase}_Rule`,
      deckDescriptorName: `Descriptor_Deck_${descriptorBase}_Premade`,
      cfgName: descriptorBase,
      emblemTexture: resolveDivisionEmblemTexture(modTag, context.coalition, mode),
      guid: metadata.guid,
      divisionNameToken: metadata.divisionNameToken,
      deckNameToken: metadata.deckNameToken,
      interfaceOrder: baseOrder - modeIndex,
      tags: buildDivisionTags(context, modTag),
      standoutUnits: resolveStandoutUnits(premadeCards),
      ruleEntries,
      premadeCards,
    });
  }

  return variants;
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
