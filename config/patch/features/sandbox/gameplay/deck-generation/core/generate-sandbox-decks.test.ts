import { buildDivisionContexts } from '../../../../../shared/deck-generation/contexts.ts';
import { resolveStandoutUnits } from '../../../../../shared/deck-generation/engine.ts';
import {
  areNearDuplicateProfiles,
  buildCategoryAnalyses,
  compareNearDuplicateProfileQuality,
  createEntityAnalysisFactory,
  deriveSelectionPurposeGroupKey,
  deriveTransportGroup,
} from '../../../../../shared/deck-generation/generator/analysis.ts';
import {
  createDeckGenerationConfig,
  shouldIncludeEntityInGenerationPool,
  shouldIncludeEntityInVariant,
} from '../../../../../shared/deck-generation/generator/config.ts';
import {
  deriveMobilityKey,
  isCommandEntity,
  resolveDeckMaxActivationPointsFromCategories,
  resolvePackCount,
} from '../../../../../shared/deck-generation/generator/helpers.ts';
import { resolvePackProfile } from '../../../../../shared/deck-generation/generator/packs.ts';
import {
  ensurePersistentDivisionMetadata,
  parseAmmunition,
  parseDivisionRuleData,
  parseEntities,
  parseLocalisation,
  parsePersistentStore,
  parseSellableOrderAvailabilityNames,
  parseWeaponDescriptors,
} from '../../../../../shared/deck-generation/generator/parsers.ts';
import {
  buildPremadeCards,
  resolvePremadeBackfillTarget,
} from '../../../../../shared/deck-generation/generator/premade.ts';
import { trimCategoryCards } from '../../../../../shared/deck-generation/generator/premade-cards.ts';
import { buildRoleSelections } from '../../../../../shared/deck-generation/generator/premade-selection.ts';
import { buildRuleEntries } from '../../../../../shared/deck-generation/generator/rules.ts';
import {
  createUnlimitedRule,
  type DivisionRuleData,
  type EntityData,
  FALLBACK_BALANCED_RULE,
  type GeneratedDivisionVariant,
  type PremadeCard,
} from '../../../../../shared/deck-generation/generator/types.ts';
import { injectDeckSerializerEntries } from '../../../../../shared/deck-generation/render.ts';
import type generateSandboxDecks from './generate-sandbox-decks.ts';

const DEFAULT_TEST_CONFIG = {
  deckSlotCount: 80,
  unlimitedPackUnitCount: 999,
};

function createSupplyBuildingFixture() {
  return [
    'export Descriptor_Unit_YS_Supply_Base is TEntityDescriptor',
    '(',
    '    ModulesDescriptors = [',
    '        TTypeUnitModuleDescriptor',
    '        (',
    '            Coalition = TWargameCoalition/NATO',
    '            // YMB-MODIFY-START {"id":"field","patchId":"ysm.descriptors.buildings"}',
    '            // YMB-ORIGINAL',
    "            //     MotherCountry = 'US'",
    "            MotherCountry = 'YSM'",
    '',
    '            // YMB-MODIFY-END {"id":"field","patchId":"ysm.descriptors.buildings"}',
    '        ),',
    '        TSupplyModuleDescriptor',
    '        (',
    '            SupplyCapacity = 2000000.0',
    '            SupplyPriority = 0',
    '        ),',
    '        TProductionModuleDescriptor',
    '        (',
    '            FactoryType = Factory/Logistic',
    '            ProductionRessourcesNeeded = MAP [',
    '                (Resource_CommandPoints, 175)',
    '            ]',
    '        ),',
    '    ]',
    ')',
  ].join('\n');
}

export default async function test(context: Parameters<typeof generateSandboxDecks>[0]) {
  const ndf = context.tools.ndf;
  const modTag = String(context.variables.modTag ?? 'MOD');
  const testConfig = createDeckGenerationConfig(
    {
      ...DEFAULT_TEST_CONFIG,
      commentDirectives: context.variables.commentDirectives,
    },
    modTag,
    context.tools.values,
  );
  const commentDirectives = testConfig.commentDirectives;
  const parserOptions = {
    commentDirectives,
  };
  const ignoredEntities = parseEntities(
    [
      `export Descriptor_Unit_${modTag}_Ignored is TEntityDescriptor // ${commentDirectives.ignore}`,
      '(',
      `    MotherCountry = '${modTag}'`,
      '    Coalition = TWargameCoalition/NATO',
      '    FactoryType = Factory/Infantry',
      ')',
      `export Descriptor_Unit_${modTag}_Kept is TEntityDescriptor`,
      '(',
      `    MotherCountry = '${modTag}'`,
      '    Coalition = TWargameCoalition/NATO',
      '    FactoryType = Factory/Infantry',
      ')',
    ].join('\n'),
    'unit',
    ndf,
    parserOptions,
  );
  const parsedNames = ignoredEntities.map((entity) => entity.name);
  const ignoreFailures: string[] = [];

  if (parsedNames.includes(`Descriptor_Unit_${modTag}_Ignored`)) {
    ignoreFailures.push('The parser still kept an entity marked with the configured ignore line.');
  }
  if (!parsedNames.includes(`Descriptor_Unit_${modTag}_Kept`)) {
    ignoreFailures.push(
      'The parser did not keep the entity that should remain after the ignore line.',
    );
  }

  const forceIncludedEntities = parseEntities(
    [
      `export Descriptor_Unit_${modTag}_BeforeIgnore is TEntityDescriptor`,
      '(',
      `    MotherCountry = '${modTag}'`,
      '    Coalition = TWargameCoalition/NATO',
      '    FactoryType = Factory/Infantry',
      ')',
      `// ${commentDirectives.everythingBelow}`,
      `// ${commentDirectives.forceInclude}`,
      `export Descriptor_Unit_${modTag}_Forced is TEntityDescriptor`,
      '(',
      `    MotherCountry = '${modTag}'`,
      '    Coalition = TWargameCoalition/NATO',
      '    FactoryType = Factory/Infantry',
      ')',
      `export Descriptor_Unit_${modTag}_IgnoredBelow is TEntityDescriptor`,
      '(',
      `    MotherCountry = '${modTag}'`,
      '    Coalition = TWargameCoalition/NATO',
      '    FactoryType = Factory/Infantry',
      ')',
    ].join('\n'),
    'unit',
    ndf,
    parserOptions,
  );
  const forcedNames = forceIncludedEntities.map((entity) => entity.name);
  const forceIncludeFailures: string[] = [];
  if (!forcedNames.includes(`Descriptor_Unit_${modTag}_BeforeIgnore`)) {
    forceIncludeFailures.push(
      'The parser unexpectedly dropped the entity before the ignore-below line.',
    );
  }
  if (!forcedNames.includes(`Descriptor_Unit_${modTag}_Forced`)) {
    forceIncludeFailures.push(
      'The parser did not keep the force-included entity placed below the ignore-below line.',
    );
  }
  if (forcedNames.includes(`Descriptor_Unit_${modTag}_IgnoredBelow`)) {
    forceIncludeFailures.push(
      'The parser still kept unrelated entities that appear below the ignore-below line.',
    );
  }

  const { rules: specialRuleRules } = parseDivisionRuleData(
    [
      'Descriptor_Deck_Division_Normal_Rule is TDeckDivisionRule',
      '(',
      '    UnitRuleList =',
      '    [',
      '        TDeckUniteRule',
      '        (',
      '            UnitDescriptor = $/GFX/Unit/Descriptor_Unit_Normal',
      '            MaxPackNumber = 2',
      '            NumberOfUnitInPack = 4',
      '            NumberOfUnitInPackXPMultiplier = [1.0, 0.6, 0.4, 0.1]',
      '        ),',
      '    ]',
      ')',
      'Descriptor_Deck_Division_Normal_Alternate_Rule is TDeckDivisionRule',
      '(',
      '    UnitRuleList =',
      '    [',
      '        TDeckUniteRule',
      '        (',
      '            UnitDescriptor = $/GFX/Unit/Descriptor_Unit_Normal',
      '            MaxPackNumber = 4',
      '            NumberOfUnitInPack = 8',
      '            NumberOfUnitInPackXPMultiplier = [1.0, 0.6, 0.4, 0.1]',
      '        ),',
      '    ]',
      ')',
      'Descriptor_Deck_Division_SOV_57_GMRD_challenge_Sledgehammer_Rule is TDeckDivisionRule',
      '(',
      '    UnitRuleList =',
      '    [',
      '        TDeckUniteRule',
      '        (',
      '            UnitDescriptor = $/GFX/Unit/Descriptor_Unit_Challenge_Only',
      '            MaxPackNumber = 999',
      '            NumberOfUnitInPack = 4',
      '            NumberOfUnitInPackXPMultiplier = [1.0, 1.0, 1.0, 1.0]',
      '        ),',
      '    ]',
      ')',
    ].join('\n'),
    [/_challenge_/i],
    ndf,
  );
  const ignoredRuleFailures: string[] = [];

  if (!specialRuleRules.has('Descriptor_Unit_Normal')) {
    ignoredRuleFailures.push('The normal rule block was unexpectedly ignored.');
  }
  const representativeNormalRule = specialRuleRules.get('Descriptor_Unit_Normal');
  if (
    representativeNormalRule?.maxPackNumber !== 4 ||
    representativeNormalRule.numberOfUnitInPack !== 8
  ) {
    ignoredRuleFailures.push(
      `Duplicate normal rules did not resolve to the most generous rule: ${JSON.stringify(representativeNormalRule)}.`,
    );
  }

  if (specialRuleRules.has('Descriptor_Unit_Challenge_Only')) {
    ignoredRuleFailures.push('A challenge-only division rule block was not filtered out.');
  }

  const { memberNames: divisionMemberNamesFromRules } = parseDivisionRuleData(
    [
      'Descriptor_Deck_Division_Transport_Test_Rule is TDeckDivisionRule',
      '(',
      '    UnitRuleList =',
      '    [',
      '        TDeckUniteRule',
      '        (',
      '            UnitDescriptor = $/GFX/Unit/Descriptor_Unit_Test_Infantry',
      '            AvailableTransportList = [ $/GFX/Unit/Descriptor_Unit_Test_Ground_Transport, $/GFX/Unit/Descriptor_Unit_Test_Air_Transport ]',
      '            MaxPackNumber = 2',
      '            NumberOfUnitInPack = 4',
      '            NumberOfUnitInPackXPMultiplier = [1.0, 0.6, 0.4, 0.1]',
      '        ),',
      '    ]',
      ')',
    ].join('\n'),
    [],
    ndf,
  );
  if (
    !divisionMemberNamesFromRules.has('Descriptor_Unit_Test_Infantry') ||
    !divisionMemberNamesFromRules.has('Descriptor_Unit_Test_Ground_Transport') ||
    !divisionMemberNamesFromRules.has('Descriptor_Unit_Test_Air_Transport')
  ) {
    ignoredRuleFailures.push(
      `Division membership parsing did not include transport options: ${JSON.stringify([...divisionMemberNamesFromRules])}.`,
    );
  }

  const divisionMembershipConfig = createDeckGenerationConfig(
    {
      ...DEFAULT_TEST_CONFIG,
      excludeUnitsNotInAnyDivision: true,
    },
    modTag,
    context.tools.values,
  );
  const divisionMemberEntity = createEntity('Descriptor_Unit_US_In_Division', {
    country: 'US',
    coalition: 'NATO',
    factoryType: 'Infantry',
  });
  const divisionOrphanEntity = createEntity('Descriptor_Unit_US_Orphan', {
    country: 'US',
    coalition: 'NATO',
    factoryType: 'Infantry',
  });
  const modOrphanEntity = createEntity(`Descriptor_Unit_${modTag}_Sandbox`, {
    country: modTag,
    coalition: 'NATO',
    factoryType: 'Infantry',
  });
  const divisionTransportOnlyEntity = createEntity('Descriptor_Unit_US_Transport_Only', {
    country: 'US',
    coalition: 'NATO',
    factoryType: 'Infantry',
  });
  const divisionMemberNames = new Set<string>([
    divisionMemberEntity.name,
    divisionTransportOnlyEntity.name,
  ]);
  const divisionMembershipFailures: string[] = [];
  if (!shouldIncludeEntityInGenerationPool(divisionOrphanEntity, divisionMemberNames, testConfig)) {
    divisionMembershipFailures.push(
      'Units outside every division are still excluded even when the new flag is disabled.',
    );
  }
  if (
    !shouldIncludeEntityInGenerationPool(
      divisionMemberEntity,
      divisionMemberNames,
      divisionMembershipConfig,
    )
  ) {
    divisionMembershipFailures.push(
      'A unit with a vanilla division rule was unexpectedly filtered.',
    );
  }
  if (
    !shouldIncludeEntityInGenerationPool(
      divisionTransportOnlyEntity,
      divisionMemberNames,
      divisionMembershipConfig,
    )
  ) {
    divisionMembershipFailures.push(
      'A unit that exists only as a division transport option was unexpectedly filtered.',
    );
  }
  if (
    shouldIncludeEntityInGenerationPool(
      divisionOrphanEntity,
      divisionMemberNames,
      divisionMembershipConfig,
    )
  ) {
    divisionMembershipFailures.push(
      'The new division-membership filter still keeps a non-YSM unit with no division rule.',
    );
  }
  if (
    !shouldIncludeEntityInGenerationPool(
      modOrphanEntity,
      divisionMemberNames,
      divisionMembershipConfig,
    )
  ) {
    divisionMembershipFailures.push(
      'The new division-membership filter dropped a YSM-country unit with no division rule.',
    );
  }

  const targetEntity = createEntity('Descriptor_Unit_Target_Reco', {
    cost: 55,
    factoryType: 'Recons',
    unitRole: 'Reco',
    strategicType: 'Reco',
  });
  const candidateA = createEntity('Descriptor_Unit_Candidate_A', {
    cost: 50,
    factoryType: 'Recons',
    unitRole: 'Reco',
    strategicType: 'Reco',
  });
  const candidateB = createEntity('Descriptor_Unit_Candidate_B', {
    cost: 60,
    factoryType: 'Recons',
    unitRole: 'Reco',
    strategicType: 'Reco',
  });
  const exactRuleEntries = buildRuleEntries({
    entities: [targetEntity],
    mode: 'Balanced',
    deckableEntities: [targetEntity, candidateA, candidateB],
    transportMap: new Map(),
    entityByName: new Map(
      [targetEntity, candidateA, candidateB].map((entity) => [entity.name, entity] as const),
    ),
    vanillaRules: new Map<string, DivisionRuleData>([
      [
        targetEntity.name,
        {
          unitName: targetEntity.name,
          maxPackNumber: 100,
          numberOfUnitInPack: 100,
          multipliers: [0, 1, 0.68, 0.49],
        },
      ],
      [
        candidateA.name,
        {
          unitName: candidateA.name,
          maxPackNumber: 2,
          numberOfUnitInPack: 8,
          multipliers: [1, 0.75, 0.5, 0.125],
        },
      ],
      [
        candidateB.name,
        {
          unitName: candidateB.name,
          maxPackNumber: 4,
          numberOfUnitInPack: 10,
          multipliers: [1, 0.6, 0.3, 0.1],
        },
      ],
    ]),
    availableEntityNames: new Set([targetEntity.name, candidateA.name, candidateB.name]),
    config: testConfig,
  });
  const exactRuleFailures: string[] = [];

  if (exactRuleEntries.length !== 1) {
    exactRuleFailures.push('The balanced rule resolver did not return exactly one entry.');
  } else {
    const exactRule = exactRuleEntries[0]?.rule;
    if (
      exactRule?.maxPackNumber !== testConfig.deckSlotCount ||
      exactRule.numberOfUnitInPack !== 100 ||
      JSON.stringify(exactRule.multipliers) !== JSON.stringify([0, 1, 0.68, 0.49])
    ) {
      exactRuleFailures.push(`Unexpected exact balanced rule: ${JSON.stringify(exactRule)}`);
    }
  }

  const similarFallbackEntity = createEntity('Descriptor_Unit_Target_Similar_Reco', {
    cost: 57,
    factoryType: 'Recons',
    unitRole: 'Reco',
    strategicType: 'Reco',
  });
  const similarRuleEntries = buildRuleEntries({
    entities: [similarFallbackEntity],
    mode: 'Balanced',
    deckableEntities: [similarFallbackEntity, candidateA, candidateB],
    transportMap: new Map(),
    entityByName: new Map(
      [similarFallbackEntity, candidateA, candidateB].map(
        (entity) => [entity.name, entity] as const,
      ),
    ),
    vanillaRules: new Map<string, DivisionRuleData>([
      [
        candidateA.name,
        {
          unitName: candidateA.name,
          maxPackNumber: 2,
          numberOfUnitInPack: 8,
          multipliers: [1, 0.75, 0.5, 0.125],
        },
      ],
      [
        candidateB.name,
        {
          unitName: candidateB.name,
          maxPackNumber: 4,
          numberOfUnitInPack: 10,
          multipliers: [1, 0.6, 0.3, 0.1],
        },
      ],
    ]),
    availableEntityNames: new Set([similarFallbackEntity.name, candidateA.name, candidateB.name]),
    config: testConfig,
  });
  const similarRuleFailures: string[] = [];

  if (similarRuleEntries.length !== 1) {
    similarRuleFailures.push('The similar-rule resolver did not return exactly one entry.');
  } else {
    const similarRule = similarRuleEntries[0]?.rule;
    if (
      similarRule?.maxPackNumber !== testConfig.deckSlotCount ||
      similarRule.numberOfUnitInPack !== 10 ||
      JSON.stringify(similarRule.multipliers) !== JSON.stringify([1, 0.6, 0.3, 0.1])
    ) {
      similarRuleFailures.push(
        `Similar sane rules no longer resolve to the most generous values: ${JSON.stringify(similarRule)}.`,
      );
    }
  }

  const fallbackEntity = createEntity('Descriptor_Unit_Fallback_Only', {
    cost: 90,
    factoryType: 'Tanks',
    unitRole: 'Tank',
    strategicType: 'Tank',
  });
  const fallbackEntries = buildRuleEntries({
    entities: [fallbackEntity],
    mode: 'Balanced',
    deckableEntities: [fallbackEntity],
    transportMap: new Map(),
    entityByName: new Map([[fallbackEntity.name, fallbackEntity]]),
    vanillaRules: new Map(),
    availableEntityNames: new Set([fallbackEntity.name]),
    config: testConfig,
  });
  const fallbackRuleFailures: string[] = [];

  if (
    fallbackEntries.length !== 1 ||
    JSON.stringify(fallbackEntries[0]?.rule) !==
      JSON.stringify({
        ...FALLBACK_BALANCED_RULE,
        unitName: 'Descriptor_Unit_Fallback_Only',
        maxPackNumber: testConfig.deckSlotCount,
      })
  ) {
    fallbackRuleFailures.push(
      'The default balanced fallback no longer matches the expected curve.',
    );
  }

  const packProfileFailures: string[] = [];
  const fractionalSingleUnitProfile = resolvePackProfile({
    unitName: 'Descriptor_Unit_Test_Fractional_Single',
    maxPackNumber: 80,
    numberOfUnitInPack: 1,
    multipliers: [1, 0.4, 0, 0],
  });
  if (
    fractionalSingleUnitProfile?.xp !== 0 ||
    fractionalSingleUnitProfile.number !== 1 ||
    fractionalSingleUnitProfile.maxUnitCardCount !== 80
  ) {
    packProfileFailures.push(
      `Single-unit fractional rules should fall back to rookie availability, got ${JSON.stringify(fractionalSingleUnitProfile)}.`,
    );
  }
  const roundedVeterancyProfile = resolvePackProfile({
    unitName: 'Descriptor_Unit_Test_Fractional_Multi',
    maxPackNumber: 80,
    numberOfUnitInPack: 2,
    multipliers: [1, 0.4, 0, 0],
  });
  if (roundedVeterancyProfile?.xp !== 1 || roundedVeterancyProfile.number !== 1) {
    packProfileFailures.push(
      `Two-unit fractional rules should still keep their rounded veteran pack, got ${JSON.stringify(roundedVeterancyProfile)}.`,
    );
  }

  // A decooked file prints the float32 the multiplier rounds to, so an authored
  // 0.7 arrives as 0.699999988 and 5 x it lands a hair under 3.5. Rounding that
  // down gives the game a pack count it did not compute, and it answers with
  // "Following packs have an invalid unit amount" and refuses the whole deck.
  const float32PackFailures: string[] = [];
  for (const [numberOfUnitInPack, authoredMultiplier, expected] of [
    [5, 0.7, 4],
    [10, 0.35, 4],
    [2, 0.25, 1],
    // Products that never sit on a .5 boundary must be left exactly as they were.
    [5, 0.6, 3],
    [10, 0.68, 7],
    [7, 0.5, 4],
    [3, 0.5, 2],
  ] as const) {
    const actual = resolvePackCount(numberOfUnitInPack, Math.fround(authoredMultiplier));
    if (actual !== expected) {
      float32PackFailures.push(
        `${numberOfUnitInPack} x ${authoredMultiplier} should hold ${expected} units, got ${actual}.`,
      );
    }
  }
  const float32Profile = resolvePackProfile({
    unitName: 'Descriptor_Unit_Test_Float32_Pack',
    maxPackNumber: 80,
    numberOfUnitInPack: 5,
    multipliers: [0, Math.fround(0.7), 0, 0],
  });
  if (float32Profile?.number !== 4) {
    float32PackFailures.push(
      `A pack read back from a decooked multiplier should hold 4 units, got ${JSON.stringify(float32Profile)}.`,
    );
  }

  const forcedPremadeVariantConfig = createDeckGenerationConfig(
    {
      ...DEFAULT_TEST_CONFIG,
      ignoredCountryIds: [modTag],
      forcedPremadeUnitPatterns: {
        countryUnlimited: ['^Descriptor_Unit_YC_'],
      },
    },
    modTag,
    context.tools.values,
  );
  const forcedPremadeEntity = createEntity('Descriptor_Unit_YC_Illegal', {
    country: modTag,
    cost: 9999,
    factoryType: 'Tanks',
    unitRole: 'Tank',
    strategicType: 'Tank',
    hasSupplyModule: false,
  });
  const forcedPremadeVariantFailures: string[] = [];
  if (
    !shouldIncludeEntityInVariant(
      forcedPremadeEntity,
      {
        code: 'COUNTRY_TEST',
        nameLabel: 'Country Test',
        scope: 'country',
        coalition: 'NATO',
        countryId: 'US',
        tags: [],
        ruleFilter: () => false,
      },
      'Unlimited',
      forcedPremadeVariantConfig,
    )
  ) {
    forcedPremadeVariantFailures.push(
      'Forced-premade unlimited units are still excluded from variant rule generation when the YSM country is globally ignored.',
    );
  }

  const forcedSlotConfig = createDeckGenerationConfig(
    {
      deckSlotCount: 1,
      unlimitedPackUnitCount: 999,
      forcedPremadeUnitPatterns: {
        countryUnlimited: ['^Descriptor_Unit_YC_'],
      },
    },
    modTag,
    context.tools.values,
  );
  const competitivePremadeEntity = createEntity('Descriptor_Unit_US_Competitive_Tank', {
    country: 'US',
    coalition: 'NATO',
    cost: 120,
    factoryType: 'Tanks',
    unitRole: 'Tank',
    strategicType: 'Tank',
  });
  const forcedSlotPacks = new Map();
  const forcedSlotCards = buildPremadeCards({
    context: {
      code: 'COUNTRY_TEST',
      nameLabel: 'Country Test',
      scope: 'country',
      coalition: 'NATO',
      countryId: 'US',
      tags: [],
      ruleFilter: () => true,
    },
    mode: 'Unlimited',
    ruleEntries: [
      {
        entity: forcedPremadeEntity,
        rule: {
          ...createUnlimitedRule(1, 999),
          unitName: forcedPremadeEntity.name,
        },
        transportNames: [],
      },
      {
        entity: competitivePremadeEntity,
        rule: {
          ...createUnlimitedRule(1, 999),
          unitName: competitivePremadeEntity.name,
        },
        transportNames: [],
      },
    ],
    entityByName: new Map(
      [forcedPremadeEntity, competitivePremadeEntity].map(
        (entity) => [entity.name, entity] as const,
      ),
    ),
    generatedPacks: forcedSlotPacks,
    weaponDescriptors: new Map(),
    ammunition: new Map(),
    modTag,
    contextCode: 'COUNTRY_TEST',
    config: forcedSlotConfig,
  });
  const forcedSlotFailures: string[] = [];
  if (
    forcedSlotCards.length !== 1 ||
    forcedSlotCards[0]?.entity.name !== forcedPremadeEntity.name ||
    forcedSlotPacks.size !== 1
  ) {
    forcedSlotFailures.push(
      'Forced premade slots still allow competitive cards or packs to consume reserved capacity.',
    );
  }

  const scoringContext = {
    code: 'SCORING_TEST',
    nameLabel: 'Scoring Test',
    scope: 'country' as const,
    coalition: 'NATO',
    countryId: 'US',
    tags: [],
    ruleFilter: () => true,
  };
  const scoringEntities = [
    createEntity('Descriptor_Unit_Scoring_Cheap', {
      country: 'US',
      coalition: 'NATO',
      cost: 20,
      factoryType: 'Tanks',
      unitRole: 'Tank',
      strategicType: 'Tank',
      maxPhysicalDamages: 5,
      maxSpeedKmph: 40,
    }),
    createEntity('Descriptor_Unit_Scoring_Value', {
      country: 'US',
      coalition: 'NATO',
      cost: 45,
      factoryType: 'Tanks',
      unitRole: 'Tank',
      strategicType: 'Tank',
      maxPhysicalDamages: 12,
      maxSpeedKmph: 48,
    }),
    createEntity('Descriptor_Unit_Scoring_Balanced', {
      country: 'US',
      coalition: 'NATO',
      cost: 80,
      factoryType: 'Tanks',
      unitRole: 'Tank',
      strategicType: 'Tank',
      maxPhysicalDamages: 24,
      maxSpeedKmph: 55,
    }),
    createEntity('Descriptor_Unit_Scoring_Heavy', {
      country: 'US',
      coalition: 'NATO',
      cost: 140,
      factoryType: 'Tanks',
      unitRole: 'Tank',
      strategicType: 'Tank',
      maxPhysicalDamages: 45,
      maxSpeedKmph: 62,
    }),
    createEntity('Descriptor_Unit_Scoring_Elite', {
      country: 'US',
      coalition: 'NATO',
      cost: 230,
      factoryType: 'Tanks',
      unitRole: 'Tank',
      strategicType: 'Tank',
      maxPhysicalDamages: 80,
      maxSpeedKmph: 70,
    }),
    createEntity('Descriptor_Unit_Scoring_Strongest', {
      country: 'US',
      coalition: 'NATO',
      cost: 360,
      factoryType: 'Tanks',
      unitRole: 'Tank',
      strategicType: 'Tank',
      maxPhysicalDamages: 140,
      maxSpeedKmph: 78,
    }),
  ];
  for (const entity of scoringEntities) {
    entity.strategicType = 'Armor';
    entity.specialties = ['WidelySharedSpecialty'];
  }
  const scoringRuleEntries = scoringEntities.map((entity) => ({
    entity,
    rule: { ...createUnlimitedRule(3, 10), unitName: entity.name },
    transportNames: [],
  }));
  const scoringEntityByName = new Map(
    scoringEntities.map((entity) => [entity.name, entity] as const),
  );
  const scoringConfig = createDeckGenerationConfig(
    { deckSlotCount: 12, unlimitedPackUnitCount: 999 },
    modTag,
    context.tools.values,
  );
  const scoringCards = buildPremadeCards({
    context: scoringContext,
    mode: 'Unlimited',
    ruleEntries: scoringRuleEntries,
    entityByName: scoringEntityByName,
    generatedPacks: new Map(),
    weaponDescriptors: new Map(),
    ammunition: new Map(),
    modTag,
    contextCode: scoringContext.code,
    config: scoringConfig,
  });
  const scoringAnalysisData = buildCategoryAnalyses({
    entries: scoringRuleEntries,
    weaponDescriptors: new Map(),
    ammunition: new Map(),
  });
  const analysisFactory = createEntityAnalysisFactory(new Map(), new Map());
  const cachedAnalysis = buildCategoryAnalyses({
    entries: scoringRuleEntries,
    weaponDescriptors: new Map(),
    ammunition: new Map(),
    analysisFactory,
  });
  cachedAnalysis.analyses[0]?.roleTokens.push('mutation-probe');
  if (cachedAnalysis.analyses[0]) cachedAnalysis.analyses[0].metrics.antiArmor = -1;
  const cachedAnalysisAfterMutation = buildCategoryAnalyses({
    entries: scoringRuleEntries,
    weaponDescriptors: new Map(),
    ammunition: new Map(),
    analysisFactory,
  });
  const directAnalysis = buildCategoryAnalyses({
    entries: scoringRuleEntries,
    weaponDescriptors: new Map(),
    ammunition: new Map(),
  });
  const analysisSnapshot = (analysis: typeof directAnalysis) =>
    analysis.analyses.map(({ metrics, profileTokens, roleTokens, similarityVector, typeKey }) => ({
      metrics,
      profileTokens,
      roleTokens,
      similarityVector,
      typeKey,
    }));
  const analysisCacheFailures: string[] = [];
  if (
    JSON.stringify(analysisSnapshot(cachedAnalysisAfterMutation)) !==
    JSON.stringify(analysisSnapshot(directAnalysis))
  ) {
    analysisCacheFailures.push('Cached entity analysis differs from direct analysis.');
  }
  if (cachedAnalysisAfterMutation.analyses[0]?.roleTokens.includes('mutation-probe')) {
    analysisCacheFailures.push('A mutated category analysis contaminated a later analysis.');
  }
  const mainRoleFailures: string[] = [];
  const tankTypeCards = scoringCards.filter((card) => card.roleKeys.includes('main:tank'));
  const tankTypeNames = new Set(tankTypeCards.map((card) => card.entity.name));
  const tankPerspectiveKinds = new Set(tankTypeCards.map((card) => card.selectionKind));
  if (tankTypeNames.size < 3) {
    mainRoleFailures.push(`Tank type kept only ${tankTypeNames.size} distinct unit options.`);
  }
  for (const perspective of ['type-recommended', 'type-best', 'type-cheap'] as const) {
    if (!tankPerspectiveKinds.has(perspective)) {
      mainRoleFailures.push(`Tank type lost its ${perspective} option.`);
    }
  }
  const recommendedTank = tankTypeCards.find((card) => card.selectionKind === 'type-recommended');
  const cheapTank = tankTypeCards.find((card) => card.selectionKind === 'type-cheap');
  if (recommendedTank && cheapTank && cheapTank.entity.cost > recommendedTank.entity.cost) {
    mainRoleFailures.push(
      `Tank budget option costs ${cheapTank.entity.cost}, above the ${recommendedTank.entity.cost} best-overall option.`,
    );
  }
  const strongestCard = scoringCards.find(
    (card) => card.entity.name === 'Descriptor_Unit_Scoring_Strongest',
  );
  if (strongestCard?.selectionKind !== 'type-best') {
    mainRoleFailures.push(
      `The price-independent strongest tank was not retained as type-best: ${strongestCard?.selectionKind ?? 'missing'}.`,
    );
  }
  if (
    scoringAnalysisData.roleDefinitions.some(
      (role) => role.key === 'role:armor' || role.key === 'trait:widelysharedspecialty',
    )
  ) {
    mainRoleFailures.push(
      'Equivalent all-roster role/trait aliases still received independent selection budgets.',
    );
  }

  const optionAdmissionFailures: string[] = [];
  const optionBase = scoringAnalysisData.analyses[0];
  const atRole = {
    key: 'primary:at',
    kind: 'primary' as const,
    optionCount: 3 as const,
    priority: 10_000,
    focus: { antiArmor: 3.8, rangeArmor: 2, precision: 1 },
  };
  const buildAtOption = (
    name: string,
    cost: number,
    antiArmor: number,
    rangeArmor: number,
    survivability: number,
    profileTokens: string[],
    extraTokens: string[] = [],
  ) =>
    optionBase && {
      ...optionBase,
      entity: { ...optionBase.entity, name, cost },
      roleTokens: ['primary:at', ...extraTokens],
      exactRoleTokens: new Set(['primary:at', ...extraTokens]),
      profileTokens,
      similarityVector: [],
      relativeMetrics: {
        ...optionBase.relativeMetrics,
        antiArmor,
        rangeArmor,
        precision: 850,
        survivability,
      },
    };
  const guidedProfile = [
    'cursor:antitank',
    'damage:heat',
    'projectile:missile',
    'range_class:long',
  ];
  const alternateGuidedProfile = [
    'cursor:antitank',
    'damage:heat',
    'mechanic:fire_and_forget',
    'projectile:missile',
  ];
  const directFireProfile = [
    'cursor:antitank',
    'damage:kinetic',
    'projectile:shell',
    'range_class:medium',
  ];
  const atOptions = [
    buildAtOption('Descriptor_Unit_AT_Long_Range_Best', 200, 1_000, 1_000, 150, guidedProfile),
    buildAtOption('Descriptor_Unit_AT_Short_Range_Clone', 190, 1_000, 700, 200, guidedProfile),
    buildAtOption('Descriptor_Unit_AT_Recommended', 150, 870, 860, 220, alternateGuidedProfile),
    buildAtOption('Descriptor_Unit_AT_Close_Budget', 140, 840, 720, 220, alternateGuidedProfile),
    buildAtOption('Descriptor_Unit_AT_Real_Budget', 80, 680, 650, 180, directFireProfile),
  ].filter(Boolean) as NonNullable<ReturnType<typeof buildAtOption>>[];
  const atSelections = buildRoleSelections({
    roleDefinition: atRole,
    analyses: atOptions,
    stats: scoringAnalysisData.stats,
    context: scoringContext,
    config: scoringConfig,
  });
  const atSelectionNames = atSelections.map((selection) => selection.analysis.entity.name);
  if (atSelectionNames[0] !== 'Descriptor_Unit_AT_Long_Range_Best') {
    optionAdmissionFailures.push(
      `Fragile AT best ignored standoff range: ${atSelectionNames[0] ?? 'missing'}.`,
    );
  }
  if (
    atSelectionNames.includes('Descriptor_Unit_AT_Short_Range_Clone') ||
    atSelectionNames.includes('Descriptor_Unit_AT_Close_Budget')
  ) {
    optionAdmissionFailures.push(
      `A redundant or weakly discounted AT option survived: ${atSelectionNames.join(', ')}.`,
    );
  }
  if (
    !atSelectionNames.includes('Descriptor_Unit_AT_Recommended') ||
    !atSelectionNames.includes('Descriptor_Unit_AT_Real_Budget')
  ) {
    optionAdmissionFailures.push(
      `Meaningfully different economy choices were lost: ${atSelectionNames.join(', ')}.`,
    );
  }
  const cheaperGeneralist = buildAtOption(
    'Descriptor_Unit_AT_Cheaper_Generalist',
    80,
    900,
    900,
    220,
    alternateGuidedProfile,
    ['capability:standoff'],
  );
  const marginalSpecialist = buildAtOption(
    'Descriptor_Unit_AT_Stronger_Specialist',
    240,
    930,
    930,
    220,
    directFireProfile,
    ['capability:standoff'],
  );
  if (cheaperGeneralist && marginalSpecialist) {
    const specialistSelections = buildRoleSelections({
      roleDefinition: {
        key: 'capability:standoff',
        kind: 'capability',
        optionCount: 1,
        priority: 5_000,
        focus: { antiArmor: 3, rangeArmor: 2 },
      },
      analyses: [cheaperGeneralist, marginalSpecialist],
      stats: scoringAnalysisData.stats,
      context: scoringContext,
      config: scoringConfig,
    });
    if (specialistSelections[0]?.analysis.entity.name !== marginalSpecialist.entity.name) {
      optionAdmissionFailures.push(
        'A non-main role preferred a cheaper generalist over the stronger specialist.',
      );
    }
  }

  const forcedScoringEntity = createEntity('Descriptor_Unit_Forced_Scoring_Outlier', {
    country: 'US',
    coalition: 'NATO',
    cost: 99999,
    factoryType: 'Planes',
    unitRole: 'Bomber',
    strategicType: 'Bomber',
    maxPhysicalDamages: 99999,
    maxSpeedKmph: 99999,
  });
  const forcedIsolationConfig = createDeckGenerationConfig(
    {
      deckSlotCount: 16,
      unlimitedPackUnitCount: 999,
      forcedPremadeUnitPatterns: {
        countryUnlimited: ['^Descriptor_Unit_Forced_Scoring_Outlier$'],
      },
    },
    modTag,
    context.tools.values,
  );
  const buildScoringFixture = (includeForced: boolean): PremadeCard[] =>
    buildPremadeCards({
      context: scoringContext,
      mode: 'Unlimited',
      ruleEntries: [
        ...scoringRuleEntries,
        ...(includeForced
          ? [
              {
                entity: forcedScoringEntity,
                rule: {
                  ...createUnlimitedRule(1, 1),
                  unitName: forcedScoringEntity.name,
                },
                transportNames: [],
              },
            ]
          : []),
      ],
      entityByName: new Map(
        [...scoringEntities, ...(includeForced ? [forcedScoringEntity] : [])].map(
          (entity) => [entity.name, entity] as const,
        ),
      ),
      generatedPacks: new Map(),
      weaponDescriptors: new Map(),
      ammunition: new Map(),
      modTag,
      contextCode: scoringContext.code,
      config: forcedIsolationConfig,
    });
  const cardsWithoutForced = buildScoringFixture(false);
  const cardsWithForced = buildScoringFixture(true);
  const forcedIsolationFailures: string[] = [];
  const competitiveSignature = (cards: PremadeCard[]): string =>
    JSON.stringify(
      cards
        .filter((card) => !card.forcedInPremade)
        .map((card) => [card.entity.name, card.selectionKind, [...card.roleKeys].sort()]),
    );
  if (competitiveSignature(cardsWithForced) !== competitiveSignature(cardsWithoutForced)) {
    forcedIsolationFailures.push('Adding a forced outlier changed competitive scoring or picks.');
  }
  const firstForcedCard = cardsWithForced[0];
  if (
    firstForcedCard?.entity !== forcedScoringEntity ||
    firstForcedCard.selectionKind !== 'forced' ||
    firstForcedCard.roleScore !== 0 ||
    firstForcedCard.keepPriority !== 0 ||
    firstForcedCard.similarityVector.length !== 0 ||
    JSON.stringify(firstForcedCard.roleKeys) !== JSON.stringify(['forced'])
  ) {
    forcedIsolationFailures.push('Forced units are not plain, unscored cards at the deck front.');
  }

  const duplicateEntities = [
    createEntity('Descriptor_Unit_Duplicate_A', {
      country: 'US',
      coalition: 'NATO',
      cost: 100,
      factoryType: 'Tanks',
      unitRole: 'Tank',
      strategicType: 'Tank',
      maxPhysicalDamages: 20,
      maxSpeedKmph: 60,
    }),
    createEntity('Descriptor_Unit_Duplicate_B', {
      country: 'US',
      coalition: 'NATO',
      cost: 105,
      factoryType: 'Tanks',
      unitRole: 'Tank',
      strategicType: 'Tank',
      maxPhysicalDamages: 20,
      maxSpeedKmph: 60,
    }),
    createEntity('Descriptor_Unit_Distinct', {
      country: 'US',
      coalition: 'NATO',
      cost: 220,
      factoryType: 'Tanks',
      unitRole: 'Tank',
      strategicType: 'Tank',
      maxPhysicalDamages: 80,
      maxSpeedKmph: 90,
    }),
  ];
  const duplicateAnalyses = buildCategoryAnalyses({
    entries: duplicateEntities.map((entity) => ({
      entity,
      rule: { ...createUnlimitedRule(1, 10), unitName: entity.name },
      transportNames: [],
    })),
    weaponDescriptors: new Map(),
    ammunition: new Map(),
  }).analyses;
  const [duplicateA, duplicateB, distinctAnalysis] = duplicateAnalyses;
  const duplicateFailures: string[] = [];
  const commandEntities = [
    createEntity('Descriptor_Unit_Command_Legacy', {
      factoryType: 'Logistic',
      unitRole: 'Command',
      strategicType: 'Command',
      maxPhysicalDamages: 6,
      frontArmor: 1,
    }),
    createEntity('Descriptor_Unit_Command_Upgrade', {
      factoryType: 'Logistic',
      unitRole: 'Command',
      strategicType: 'Command',
      maxPhysicalDamages: 12,
      frontArmor: 6,
    }),
    createEntity('Descriptor_Unit_Command_Forward', {
      factoryType: 'Logistic',
      unitRole: 'Command',
      strategicType: 'Command',
      maxPhysicalDamages: 12,
      frontArmor: 6,
      deploymentShiftGru: 1_000,
    }),
  ];
  const commandAnalyses = buildCategoryAnalyses({
    entries: commandEntities.map((entity) => ({
      entity,
      rule: { ...createUnlimitedRule(1, 10), unitName: entity.name },
      transportNames: [],
    })),
    weaponDescriptors: new Map(),
    ammunition: new Map(),
  }).analyses.map((analysis) => ({
    ...analysis,
    profileTokens: ['channel:armor', 'range_class:armor_2'],
  }));
  if (
    !commandAnalyses[0] ||
    !commandAnalyses[1] ||
    !commandAnalyses[2] ||
    !areNearDuplicateProfiles(commandAnalyses[0], commandAnalyses[1]) ||
    areNearDuplicateProfiles(commandAnalyses[1], commandAnalyses[2])
  ) {
    duplicateFailures.push(
      'Command upgrades were not consolidated, or a materially forward-deployed command option was lost.',
    );
  }
  const sharedWeaponProfile = [
    'channel:ground',
    'channel:indirect',
    'loadout:ground+indirect',
    'mechanic:damage_explosive',
    'range_class:ground_5',
  ];
  const chassisVariantA = duplicateA && {
    ...duplicateA,
    profileTokens: sharedWeaponProfile,
  };
  const chassisVariantB = duplicateB &&
    duplicateA && {
      ...duplicateB,
      profileTokens: sharedWeaponProfile,
      similarityVector: duplicateA.similarityVector.map((value, index) =>
        index === 8 ? value + 663 : index === 9 ? value + 105 : index === 20 ? value + 85 : value,
      ),
    };
  const dominatedLegacy = duplicateA && {
    ...duplicateA,
    profileTokens: sharedWeaponProfile,
  };
  const dominatingUpgrade = duplicateB &&
    duplicateA && {
      ...duplicateB,
      profileTokens: [...sharedWeaponProfile, 'mechanic:fire_and_forget'],
      similarityVector: duplicateA.similarityVector.map((value, index) =>
        index === 0 ? value + 200 : value,
      ),
    };
  const harmfulVariant = duplicateA && {
    ...duplicateA,
    entity: {
      ...duplicateA.entity,
      negativeEffectTokens: ['scope:self:effect:received_damage:multiplicative:positive_small'],
    },
    profileTokens: sharedWeaponProfile,
  };
  const cleanedVariant = duplicateB &&
    duplicateA && {
      ...duplicateB,
      similarityVector: [...duplicateA.similarityVector],
      profileTokens: sharedWeaponProfile,
    };
  const stealthSpecialist = duplicateB &&
    duplicateA && {
      ...duplicateB,
      similarityVector: duplicateA.similarityVector.map((value, index) =>
        index === 18 ? value + 250 : value,
      ),
      profileTokens: sharedWeaponProfile,
    };
  const transportedSpecialist = duplicateB && {
    ...duplicateB,
    entry: { ...duplicateB.entry, transportNames: ['Descriptor_Unit_Test_Transport'] },
    entity: { ...duplicateB.entity, maxSpeedKmph: 5 },
    similarityVector: duplicateA ? [...duplicateA.similarityVector] : duplicateB.similarityVector,
    profileTokens: sharedWeaponProfile,
  };
  const hePayloadVariant = duplicateA && {
    ...duplicateA,
    profileTokens: [
      ...sharedWeaponProfile,
      'ammo:family_he',
      'ammo:trait_he',
      'ammo_loadout:family_he+trait_he',
    ],
  };
  const clusterPayloadVariant = duplicateB &&
    duplicateA && {
      ...duplicateB,
      similarityVector: [...duplicateA.similarityVector],
      profileTokens: [
        ...sharedWeaponProfile,
        'ammo:family_cluster',
        'ammo:trait_cluster',
        'ammo_loadout:family_cluster+trait_cluster',
      ],
    };
  const payloadSupersetVariant = duplicateB &&
    duplicateA && {
      ...duplicateB,
      similarityVector: [...duplicateA.similarityVector],
      profileTokens: [
        ...sharedWeaponProfile,
        'ammo:family_cluster',
        'ammo:family_he',
        'ammo:trait_cluster',
        'ammo:trait_he',
        'ammo_loadout:family_cluster+trait_cluster|family_he+trait_he',
      ],
    };
  const strategicLabelVariant = duplicateB &&
    duplicateA && {
      ...duplicateB,
      entity: { ...duplicateB.entity, strategicType: 'AlternateStrategicLabel' },
      typeKey: 'AlternateStrategicLabel_Ground_ground_vehicle',
      similarityVector: [...duplicateA.similarityVector],
      profileTokens: [
        ...sharedWeaponProfile,
        'ammo:family_he',
        'ammo:trait_he',
        'ammo_loadout:family_he+trait_he',
      ],
    };
  if (
    !duplicateA ||
    !duplicateB ||
    !distinctAnalysis ||
    !areNearDuplicateProfiles(duplicateA, duplicateB) ||
    areNearDuplicateProfiles(duplicateA, distinctAnalysis) ||
    !chassisVariantA ||
    !chassisVariantB ||
    !areNearDuplicateProfiles(chassisVariantA, chassisVariantB) ||
    !dominatedLegacy ||
    !dominatingUpgrade ||
    !areNearDuplicateProfiles(dominatedLegacy, dominatingUpgrade) ||
    !harmfulVariant ||
    !cleanedVariant ||
    !areNearDuplicateProfiles(harmfulVariant, cleanedVariant) ||
    compareNearDuplicateProfileQuality(cleanedVariant, harmfulVariant) >= 0 ||
    !stealthSpecialist ||
    areNearDuplicateProfiles(duplicateA, stealthSpecialist) ||
    !transportedSpecialist ||
    areNearDuplicateProfiles(duplicateA, transportedSpecialist) ||
    !hePayloadVariant ||
    !clusterPayloadVariant ||
    areNearDuplicateProfiles(hePayloadVariant, clusterPayloadVariant) ||
    !payloadSupersetVariant ||
    !areNearDuplicateProfiles(hePayloadVariant, payloadSupersetVariant) ||
    !strategicLabelVariant ||
    !areNearDuplicateProfiles(hePayloadVariant, strategicLabelVariant)
  ) {
    duplicateFailures.push('Data-relative near-duplicate classification is incorrect.');
  } else {
    const duplicateCards = trimCategoryCards({
      cards: [
        {
          entity: chassisVariantA.entity,
          categoryKey: 'Tanks',
          categoryOrder: 2,
          typeKey: chassisVariantA.typeKey,
          roleKeys: ['main:tank', 'capability:alpha'],
          selectionKind: 'role-recommended',
          forcedInPremade: false,
          maxUnitCardCount: 1,
          roleScore: 900,
          keepPriority: 5_000,
          similarityKey: chassisVariantA.similarityKey,
          similarityVector: chassisVariantA.similarityVector,
          profileTokens: chassisVariantA.profileTokens,
          packDescriptorName: 'Duplicate_A_Pack',
        },
        {
          entity: chassisVariantB.entity,
          categoryKey: 'Tanks',
          categoryOrder: 2,
          typeKey: chassisVariantB.typeKey,
          roleKeys: ['main:tank', 'capability:beta'],
          selectionKind: 'role-recommended',
          forcedInPremade: false,
          maxUnitCardCount: 1,
          roleScore: 800,
          keepPriority: 4_900,
          similarityKey: chassisVariantB.similarityKey,
          similarityVector: chassisVariantB.similarityVector,
          profileTokens: chassisVariantB.profileTokens,
          packDescriptorName: 'Duplicate_B_Pack',
        },
      ],
      limit: 12,
      entityByName: new Map(duplicateEntities.map((entity) => [entity.name, entity] as const)),
      context: scoringContext,
      config: scoringConfig,
    });
    if (
      duplicateCards.length !== 1 ||
      duplicateCards[0]?.entity.name !== 'Descriptor_Unit_Duplicate_B' ||
      !duplicateCards[0]?.roleKeys.includes('main:tank') ||
      !duplicateCards[0]?.roleKeys.includes('capability:alpha') ||
      !duplicateCards[0]?.roleKeys.includes('capability:beta')
    ) {
      duplicateFailures.push(
        'Near-duplicate cards selected for different secondary purposes were not consolidated with merged coverage.',
      );
    }
  }

  const roleDiversityFailures: string[] = [];
  const seadPurposeEntity = createEntity('Descriptor_Unit_SEAD_Purpose', {
    country: 'US',
    coalition: 'NATO',
    factoryType: 'Planes',
    unitRole: 'sead',
    strategicType: 'SEAD',
  });
  const firstSeadPurpose = deriveSelectionPurposeGroupKey({
    entity: seadPurposeEntity,
    typeKey: 'SEAD_Plane_fixed_wing',
    profileTokens: ['mechanic:trait_sead', 'channel:ground', 'ammo:projectile_missile'],
  });
  const secondSeadPurpose = deriveSelectionPurposeGroupKey({
    entity: seadPurposeEntity,
    typeKey: 'SEAD_Plane_fixed_wing',
    profileTokens: [
      'mechanic:trait_sead',
      'channel:armor',
      'channel:ground',
      'ammo:projectile_rocket',
    ],
  });
  const aaPurposeEntity = createEntity('Descriptor_Unit_AA_Purpose', {
    country: 'US',
    coalition: 'NATO',
    factoryType: 'DCA',
    unitRole: 'AA',
    strategicType: 'AA',
  });
  const missileAaPurpose = deriveSelectionPurposeGroupKey({
    entity: aaPurposeEntity,
    typeKey: 'AA_Ground_ground_vehicle',
    profileTokens: ['channel:helo', 'channel:plane', 'ammo:projectile_missile'],
  });
  const gunAaPurpose = deriveSelectionPurposeGroupKey({
    entity: aaPurposeEntity,
    typeKey: 'AA_Ground_ground_vehicle',
    profileTokens: ['channel:helo', 'channel:plane', 'ammo:projectile_shell'],
  });
  if (firstSeadPurpose !== secondSeadPurpose || missileAaPurpose === gunAaPurpose) {
    roleDiversityFailures.push(
      'Purpose grouping either split one explicit role mechanic or collapsed distinct projectile classes.',
    );
  }
  const aliasPlaneEntities = Array.from({ length: 4 }, (_, index) =>
    createEntity(`Descriptor_Unit_Alias_SEAD_${index}`, {
      country: 'US',
      coalition: 'NATO',
      cost: 120 + index * 30,
      factoryType: 'Planes',
      unitRole: 'sead',
      strategicType: 'Air_Sead',
      tags: ['Air', 'Avion', 'Avion_SEAD'],
      maxPhysicalDamages: 6 + index * 4,
      maxSpeedKmph: 500 + index * 220,
      hitRollEcm: -0.1 * index,
    }),
  );
  const aliasPlaneAnalysis = buildCategoryAnalyses({
    entries: aliasPlaneEntities.map((entity) => ({
      entity,
      rule: { ...createUnlimitedRule(1, 10), unitName: entity.name },
      transportNames: [],
    })),
    weaponDescriptors: new Map(),
    ammunition: new Map(),
  });
  const seadRoles = aliasPlaneAnalysis.roleDefinitions.filter((role) =>
    role.key.toLowerCase().includes('sead'),
  );
  const canonicalSeadRole = seadRoles.find((role) => role.key === 'primary:sead');
  const canonicalSeadSelections = canonicalSeadRole
    ? buildRoleSelections({
        roleDefinition: canonicalSeadRole,
        analyses: aliasPlaneAnalysis.analyses,
        stats: aliasPlaneAnalysis.stats,
        context: scoringContext,
        config: scoringConfig,
      })
    : [];
  if (seadRoles.length !== 1 || canonicalSeadSelections.length !== 3) {
    roleDiversityFailures.push(
      `Equivalent SEAD labels produced ${seadRoles.length} roles and ${canonicalSeadSelections.length} selections instead of one three-option role.`,
    );
  }
  if (
    aliasPlaneAnalysis.roleDefinitions.some(
      (role) => role.key === 'trait:air' || role.key === 'trait:avion',
    )
  ) {
    roleDiversityFailures.push(
      'Category-wide platform tags still became independent selection roles.',
    );
  }

  const platformAaEntities = [
    ...Array.from({ length: 4 }, (_, index) =>
      createEntity(`Descriptor_Unit_Platform_AA_Vehicle_${index}`, {
        country: 'US',
        coalition: 'NATO',
        cost: 80 + index * 20,
        factoryType: 'DCA',
        unitRole: 'AA',
        strategicType: 'AA',
        maxPhysicalDamages: 8 + index * 3,
        maxSpeedKmph: 45 + index * 12,
      }),
    ),
    ...Array.from({ length: 2 }, (_, index) =>
      createEntity(`Descriptor_Unit_Platform_AA_Infantry_${index}`, {
        country: 'US',
        coalition: 'NATO',
        cost: 45 + index * 15,
        factoryType: 'DCA',
        unitRole: 'AA',
        strategicType: 'AA',
        tags: ['Infanterie', 'Infanterie_AA'],
        isTransportable: true,
        maxPhysicalDamages: 2 + index * 3,
        maxSpeedKmph: 20 + index * 10,
      }),
    ),
  ];
  const platformAaAnalysis = buildCategoryAnalyses({
    entries: platformAaEntities.map((entity) => ({
      entity,
      rule: { ...createUnlimitedRule(1, 10), unitName: entity.name },
      transportNames: [],
    })),
    weaponDescriptors: new Map(),
    ammunition: new Map(),
  });
  const dismountedAaRole = platformAaAnalysis.roleDefinitions.find((role) =>
    role.key.includes('dismounted_infantry'),
  );
  const dismountedAaSelections = dismountedAaRole
    ? buildRoleSelections({
        roleDefinition: dismountedAaRole,
        analyses: platformAaAnalysis.analyses,
        stats: platformAaAnalysis.stats,
        context: scoringContext,
        config: scoringConfig,
      })
    : [];
  if (
    new Set(platformAaAnalysis.analyses.map((analysis) => analysis.typeKey)).size < 2 ||
    dismountedAaSelections.length === 0 ||
    dismountedAaSelections.some((selection) => !selection.analysis.entity.isTransportable)
  ) {
    roleDiversityFailures.push(
      'A minority transportable infantry platform did not receive role-specific AA coverage.',
    );
  }
  const platformAtEntities = [
    ...Array.from({ length: 3 }, (_, index) =>
      createEntity(`Descriptor_Unit_Platform_AT_Tracked_${index}`, {
        country: 'US',
        coalition: 'NATO',
        cost: 65 + index * 15,
        factoryType: 'Tanks',
        unitRole: 'TankDestroyer',
        strategicType: 'TankDestroyer',
        movingType: 'Track',
        maxPhysicalDamages: 10 + index * 2,
      }),
    ),
    ...Array.from({ length: 2 }, (_, index) =>
      createEntity(`Descriptor_Unit_Platform_AT_Wheeled_${index}`, {
        country: 'US',
        coalition: 'NATO',
        cost: 55 + index * 20,
        factoryType: 'Tanks',
        unitRole: 'TankDestroyer',
        strategicType: 'TankDestroyer',
        movingType: 'Wheel',
        maxPhysicalDamages: 5 + index * 2,
        concealmentBonus: 2 + index,
        maxSpeedKmph: 75 + index * 5,
      }),
    ),
  ];
  const platformAtAnalysis = buildCategoryAnalyses({
    entries: platformAtEntities.map((entity) => ({
      entity,
      rule: { ...createUnlimitedRule(1, 10), unitName: entity.name },
      transportNames: [],
    })),
    weaponDescriptors: new Map(),
    ammunition: new Map(),
  });
  const wheeledAtRole = platformAtAnalysis.roleDefinitions.find((role) =>
    role.key.includes('platform_wheeled_vehicle_tankdestroyer'),
  );
  const trackedAtRole = platformAtAnalysis.roleDefinitions.find((role) =>
    role.key.includes('platform_tracked_vehicle_tankdestroyer'),
  );
  const wheeledAtSelections = wheeledAtRole
    ? buildRoleSelections({
        roleDefinition: wheeledAtRole,
        analyses: platformAtAnalysis.analyses,
        stats: platformAtAnalysis.stats,
        context: scoringContext,
        config: scoringConfig,
      })
    : [];
  const trackedAtSelections = trackedAtRole
    ? buildRoleSelections({
        roleDefinition: trackedAtRole,
        analyses: platformAtAnalysis.analyses,
        stats: platformAtAnalysis.stats,
        context: scoringContext,
        config: scoringConfig,
      })
    : [];
  if (
    !trackedAtRole ||
    trackedAtSelections.length === 0 ||
    trackedAtSelections.some((selection) => selection.analysis.entity.movingType !== 'Track') ||
    !wheeledAtRole ||
    wheeledAtSelections.length === 0 ||
    wheeledAtSelections.some((selection) => selection.analysis.entity.movingType !== 'Wheel')
  ) {
    roleDiversityFailures.push(
      'Mixed tracked and wheeled tank-destroyer platforms did not become separate platform-specific anti-tank roles.',
    );
  }

  const compositionEntities = Array.from({ length: 20 }, (_, index) =>
    createEntity(`Descriptor_Unit_Composition_${index}`, {
      country: 'US',
      coalition: 'NATO',
      cost: 20 + index * 5,
      factoryType: index < 10 ? 'Tanks' : 'Recons',
      unitRole: index < 10 ? 'Armor' : 'Reco',
      strategicType: index < 10 ? 'Armor' : 'Reco',
      maxPhysicalDamages: 5 + index,
      maxSpeedKmph: 40 + index,
    }),
  );
  const buildCompositionCards = (deckSlotCount: number): PremadeCard[] =>
    buildPremadeCards({
      context: {
        code: 'COMPOSITION_TEST',
        scope: 'country',
        coalition: 'NATO',
        countryId: 'US',
        ruleFilter: () => true,
      },
      mode: 'Unlimited',
      ruleEntries: compositionEntities.map((entity) => ({
        entity,
        rule: { ...createUnlimitedRule(3, 10), unitName: entity.name },
        transportNames: [],
      })),
      entityByName: new Map(compositionEntities.map((entity) => [entity.name, entity])),
      generatedPacks: new Map(),
      weaponDescriptors: new Map(),
      ammunition: new Map(),
      modTag,
      contextCode: 'COMPOSITION_TEST',
      config: createDeckGenerationConfig(
        { deckSlotCount, unlimitedPackUnitCount: 999 },
        modTag,
        context.tools.values,
      ),
    });
  const compositionCards = buildCompositionCards(6);
  const compositionFailures: string[] = [];
  if (
    resolvePremadeBackfillTarget(101, 65, 80) !== 50 ||
    resolvePremadeBackfillTarget(35, 39, 60) !== 23 ||
    resolvePremadeBackfillTarget(4, 3, 2) > 2
  ) {
    compositionFailures.push(
      'Distinct-card backfill does not preserve useful role density while respecting the category limit.',
    );
  }
  const compositionCategoryCounts = Map.groupBy(compositionCards, (card) => card.categoryKey);
  for (const [categoryKey, categoryCards] of compositionCategoryCounts) {
    if (categoryCards.length > 6) {
      compositionFailures.push(
        `${categoryKey} exceeded its 6-card category limit: ${categoryCards.length}.`,
      );
    }
  }
  if (compositionCards.length < 6) {
    compositionFailures.push(
      `Independent category budgets were collapsed into a deck-wide limit: ${compositionCards.length} total cards.`,
    );
  }
  if (new Set(compositionCards.map((card) => card.categoryKey)).size !== 2) {
    compositionFailures.push('Per-category selection dropped an available category completely.');
  }
  if (!compositionCards.some((card) => card.roleKeys.length > 1)) {
    compositionFailures.push('Deduplication discarded multi-role coverage metadata.');
  }
  const commandTrimCards = trimCategoryCards({
    cards: [
      {
        ...createPremadeCard(
          createEntity('Descriptor_Unit_Command_Trim_A', {
            country: 'US',
            coalition: 'NATO',
            factoryType: 'Logistic',
            unitRole: 'Command',
            strategicType: 'Command',
            cost: 120,
          }),
          undefined,
          2_800,
        ),
        roleKeys: ['capability:command'],
      },
      {
        ...createPremadeCard(
          createEntity('Descriptor_Unit_Command_Trim_B', {
            country: 'US',
            coalition: 'NATO',
            factoryType: 'Logistic',
            unitRole: 'Command',
            strategicType: 'Command',
            cost: 95,
          }),
          undefined,
          2_700,
        ),
        roleKeys: ['capability:command'],
      },
      {
        ...createPremadeCard(
          createEntity('Descriptor_Unit_Command_Trim_Filler', {
            country: 'US',
            coalition: 'NATO',
            factoryType: 'Logistic',
            unitRole: 'Support',
            strategicType: 'Support',
            cost: 140,
          }),
          undefined,
          4_500,
        ),
        roleKeys: ['filler'],
      },
    ],
    limit: 2,
    entityByName: new Map(),
    context: scoringContext,
    config: scoringConfig,
  });
  if (
    commandTrimCards.length !== 2 ||
    commandTrimCards.some((card) => !card.roleKeys.includes('capability:command'))
  ) {
    compositionFailures.push(
      'Category trimming did not preserve distinct command coverage before removing non-coverage filler.',
    );
  }
  const homeTransport = createEntity('Descriptor_Unit_Transport_Home', {
    country: 'US',
    coalition: 'NATO',
    factoryType: 'Infantry',
    unitRole: 'transport',
    strategicType: 'Transport',
    cost: 20,
    isSellable: false,
  });
  const sellableGroundTransport = createEntity('Descriptor_Unit_Transport_Sellable_Ground', {
    country: 'US',
    coalition: 'NATO',
    factoryType: 'Infantry',
    unitRole: 'transport',
    strategicType: 'Transport',
    cost: 30,
    isSellable: true,
  });
  const foreignTransport = createEntity('Descriptor_Unit_Transport_Foreign', {
    country: 'BEL',
    coalition: 'NATO',
    factoryType: 'Infantry',
    unitRole: 'transport',
    strategicType: 'Transport',
    movingType: 'Helicopter',
    cost: 5,
    isSellable: true,
  });
  const transportedUnit = createEntity('Descriptor_Unit_Transported_Test', {
    country: 'US',
    coalition: 'NATO',
    factoryType: 'Infantry',
    unitRole: 'Infantry',
    strategicType: 'Infantry',
    cost: 40,
  });
  const transportEntities = [
    transportedUnit,
    homeTransport,
    sellableGroundTransport,
    foreignTransport,
  ];
  const transportCards = buildPremadeCards({
    context: {
      code: 'TRANSPORT_TEST',
      scope: 'country',
      coalition: 'NATO',
      countryId: 'US',
      ruleFilter: () => true,
    },
    mode: 'Unlimited',
    ruleEntries: transportEntities.map((entity) => ({
      entity,
      rule: {
        ...createUnlimitedRule(entity === transportedUnit ? 2 : 1, 10),
        unitName: entity.name,
      },
      transportNames:
        entity === transportedUnit
          ? [foreignTransport.name, homeTransport.name, sellableGroundTransport.name]
          : [],
    })),
    entityByName: new Map(transportEntities.map((entity) => [entity.name, entity])),
    generatedPacks: new Map(),
    weaponDescriptors: new Map(),
    ammunition: new Map(),
    modTag,
    contextCode: 'TRANSPORT_TEST',
    config: testConfig,
  });
  if (!transportCards.some((card) => card.entity.unitRole?.toLowerCase() === 'transport')) {
    compositionFailures.push('Dedicated transport units were blanket-excluded from selection.');
  }
  if (!transportCards.some((card) => card.entity === transportedUnit)) {
    compositionFailures.push('The transported combat unit disappeared from its premade deck.');
  }
  const transportedCards = transportCards.filter((card) => card.entity === transportedUnit);
  if (!transportedCards.some((card) => card.transportName === sellableGroundTransport.name)) {
    compositionFailures.push('Transport selection ignored an available sellable ground carrier.');
  }
  if (!transportedCards.some((card) => card.transportName === foreignTransport.name)) {
    compositionFailures.push('Transport affinity filtering erased a distinct air transport role.');
  }
  if (transportedCards.some((card) => card.transportName === homeTransport.name)) {
    compositionFailures.push('A non-sellable ground carrier displaced a sellable alternative.');
  }

  const sellableOrderNames = parseSellableOrderAvailabilityNames(
    [
      'Descriptor_OrderAvailability_Sellable is [EOrderType/Stop, EOrderType/Sell]',
      'Descriptor_OrderAvailability_Permanent is [EOrderType/Stop, EOrderType/Move]',
    ].join('\n'),
  );
  if (
    !sellableOrderNames.has('Descriptor_OrderAvailability_Sellable') ||
    sellableOrderNames.has('Descriptor_OrderAvailability_Permanent')
  ) {
    compositionFailures.push('Sellability parsing did not follow EOrderType/Sell exactly.');
  }

  const duplicateVariantCards = trimCategoryCards({
    cards: [
      createPremadeCard(transportedUnit, homeTransport.name, 9_000),
      createPremadeCard(transportedUnit, foreignTransport.name, 8_000),
      createPremadeCard(createEntity('Descriptor_Unit_Unique_Transport_Test'), undefined, 100),
    ],
    limit: 2,
    entityByName: new Map(transportEntities.map((entity) => [entity.name, entity])),
    context: {
      code: 'TRANSPORT_TRIM_TEST',
      scope: 'country',
      coalition: 'NATO',
      countryId: 'US',
      ruleFilter: () => true,
    },
    config: testConfig,
  });
  if (new Set(duplicateVariantCards.map((card) => card.entity.name)).size !== 2) {
    compositionFailures.push(
      'Capacity trimming removed a distinct unit before a duplicate card variant.',
    );
  }
  if (!duplicateVariantCards.some((card) => card.transportName === foreignTransport.name)) {
    compositionFailures.push('Capacity trimming discarded a sellable transport variant first.');
  }

  const ordinaryDistinctEntries = Array.from({ length: 8 }, (_, index) => ({
    entity: createEntity(`Descriptor_Unit_Ordinary_${index}`, {
      factoryType: 'Planes',
      unitRole: 'support',
      strategicType: 'Air_Support',
      cost: 100,
      concealmentBonus: 0.1,
    }),
    rule: createUnlimitedRule(2, 4),
    transportNames: [],
  }));
  const distinctEntity = createEntity('Descriptor_Unit_Data_Derived_Outlier', {
    factoryType: 'Planes',
    unitRole: 'support',
    strategicType: 'Air_Support',
    cost: 100,
    concealmentBonus: 3,
    opticalStrength: 10_000,
  });
  const weakDistinctEntity = createEntity('Descriptor_Unit_Weak_Data_Derived_Outlier', {
    factoryType: 'Planes',
    unitRole: 'support',
    strategicType: 'Air_Support',
    cost: 100,
    concealmentBonus: 3,
    maxSpeedKmph: 2_000,
  });
  const distinctAnalyses = buildCategoryAnalyses({
    entries: [
      ...ordinaryDistinctEntries,
      { entity: distinctEntity, rule: createUnlimitedRule(2, 4), transportNames: [] },
      { entity: weakDistinctEntity, rule: createUnlimitedRule(2, 4), transportNames: [] },
    ],
    weaponDescriptors: new Map(),
    ammunition: new Map(),
  }).analyses;
  if (
    !distinctAnalyses
      .find((analysis) => analysis.entity === distinctEntity)
      ?.roleTokens.some((token) => token === 'capability:optics' || token === 'capability:stealth')
  ) {
    compositionFailures.push(
      'A tactically useful optics/stealth outlier was not preserved through its actual capability.',
    );
  }
  const standoutCard = (
    name: string,
    selectionKind: PremadeCard['selectionKind'],
  ): PremadeCard => ({
    entity: createEntity(name),
    categoryKey: 'Tanks',
    categoryOrder: 0,
    typeKey: 'tank',
    roleKeys: ['type:tank'],
    selectionKind,
    forcedInPremade: selectionKind === 'forced',
    maxUnitCardCount: 1,
    roleScore: selectionKind === 'forced' ? 100 : 999,
    keepPriority: 0,
    similarityKey: name,
    similarityVector: [],
    packDescriptorName: `${name}_Pack`,
  });
  const forcedOnlyStandoutUnits = resolveStandoutUnits([
    standoutCard('Descriptor_Unit_Forced_A', 'forced'),
    standoutCard('Descriptor_Unit_Competitive_A', 'role-best'),
    standoutCard('Descriptor_Unit_Forced_A', 'forced'),
    standoutCard('Descriptor_Unit_Forced_B', 'forced'),
  ]);
  const competitiveOnlyStandoutUnits = resolveStandoutUnits([
    standoutCard('Descriptor_Unit_Competitive_B', 'role-best'),
    standoutCard('Descriptor_Unit_Competitive_C', 'filler'),
  ]);
  const standoutUnitFailures: string[] = [];
  if (
    forcedOnlyStandoutUnits.length !== 2 ||
    forcedOnlyStandoutUnits[0] !== 'Descriptor_Unit_Forced_A' ||
    forcedOnlyStandoutUnits[1] !== 'Descriptor_Unit_Forced_B'
  ) {
    standoutUnitFailures.push(
      `Standout units did not stay restricted to forced cards: ${forcedOnlyStandoutUnits.join(', ')}`,
    );
  }
  if (competitiveOnlyStandoutUnits.length !== 0) {
    standoutUnitFailures.push(
      `Competitive-only premade cards still produced standout units: ${competitiveOnlyStandoutUnits.join(', ')}`,
    );
  }

  const persistentStoreFailures: string[] = [];
  let corruptStoreRejected = false;
  try {
    parsePersistentStore(
      JSON.stringify({
        version: 1,
        nextDivisionNameToken: 'NaN',
        nextDeckNameToken: 0,
        divisions: {
          broken: { guid: '', divisionNameToken: '   ', deckNameToken: null },
        },
      }),
    );
  } catch (error) {
    corruptStoreRejected = String(error).includes('refusing to regenerate stable GUIDs');
  }
  if (!corruptStoreRejected) {
    persistentStoreFailures.push('Corrupt persistent identity data did not fail closed.');
  }

  let legacyStoreRejected = false;
  try {
    parsePersistentStore(
      JSON.stringify({
        version: 1,
        nextDivisionNameToken: 1,
        nextDeckNameToken: 1,
        divisions: {},
      }),
    );
  } catch (error) {
    legacyStoreRejected = String(error).includes('Unsupported store version');
  }
  if (!legacyStoreRejected) {
    persistentStoreFailures.push('Legacy version 1 stores must be rejected.');
  }

  let duplicateSerializerIdRejected = false;
  try {
    parsePersistentStore(
      JSON.stringify({
        version: 2,
        nextDivisionNameToken: 1,
        nextDeckNameToken: 1,
        divisions: {},
        serializer: {
          nextDivisionId: 1602,
          nextUnitId: 16000,
          divisionIds: { Division_A: 1600, Division_B: 1600 },
          unitIds: {},
        },
      }),
    );
  } catch (error) {
    duplicateSerializerIdRejected = String(error).includes('duplicate ID');
  }
  if (!duplicateSerializerIdRejected) {
    persistentStoreFailures.push('A duplicate persistent DeckSerializer ID was not rejected.');
  }

  let serializerOverflowRejected = false;
  try {
    parsePersistentStore(
      JSON.stringify({
        version: 2,
        nextDivisionNameToken: 1,
        nextDeckNameToken: 1,
        divisions: {},
        serializer: {
          nextDivisionId: 1600,
          nextUnitId: 16385,
          divisionIds: {},
          unitIds: {},
        },
      }),
    );
  } catch (error) {
    serializerOverflowRejected = String(error).includes('16384');
  }
  if (!serializerOverflowRejected) {
    persistentStoreFailures.push('An out-of-range DeckSerializer counter was not rejected.');
  }

  const newStore = parsePersistentStore('');
  const localisationState = parseLocalisation('"TOKEN";"REFTEXT"\n');
  const newMetadata = ensurePersistentDivisionMetadata(
    newStore,
    localisationState,
    'new-division',
    'New Division',
    'New Deck',
  );
  if (
    !/^YD\d{8}$/.test(newMetadata.divisionNameToken) ||
    !/^YK\d{8}$/.test(newMetadata.deckNameToken)
  ) {
    persistentStoreFailures.push('A new persistent store did not allocate valid stable tokens.');
  }

  const serializerBase = [
    'DivisionIds = MAP [',
    '    (Descriptor_Deck_Division_Vanilla, 100),',
    ']',
    'UnitIds = MAP [',
    '    ($/GFX/Unit/Descriptor_Unit_Vanilla, 1000),',
    ']',
  ].join('\n');
  const coreSerializerStore = parsePersistentStore('');
  const hordeSerializerStore = parsePersistentStore('');
  const coreDivision = [
    { descriptorName: 'Descriptor_Deck_Division_YSM_CORE' },
  ] as GeneratedDivisionVariant[];
  const hordeDivision = [
    { descriptorName: 'Descriptor_Deck_Division_YSM_HORDE' },
  ] as GeneratedDivisionVariant[];
  const firstCoreSerializer = injectDeckSerializerEntries(
    ndf,
    context.tools.text.escapeRegExp,
    serializerBase,
    coreDivision,
    ['Descriptor_Unit_YSM_Core'],
    'core-generator.ts',
    coreSerializerStore.serializer,
  );
  const firstLayeredSerializer = injectDeckSerializerEntries(
    ndf,
    context.tools.text.escapeRegExp,
    firstCoreSerializer,
    hordeDivision,
    ['Descriptor_Unit_YSM_Horde'],
    'horde-generator.ts',
    hordeSerializerStore.serializer,
  );
  const secondCoreSerializer = injectDeckSerializerEntries(
    ndf,
    context.tools.text.escapeRegExp,
    firstLayeredSerializer,
    coreDivision,
    ['Descriptor_Unit_YSM_Core'],
    'core-generator.ts',
    coreSerializerStore.serializer,
  );
  const secondLayeredSerializer = injectDeckSerializerEntries(
    ndf,
    context.tools.text.escapeRegExp,
    secondCoreSerializer,
    hordeDivision,
    ['Descriptor_Unit_YSM_Horde'],
    'horde-generator.ts',
    hordeSerializerStore.serializer,
  );
  if (firstLayeredSerializer !== secondLayeredSerializer) {
    persistentStoreFailures.push(
      'Layered DeckSerializer IDs or generated blocks changed across an identical second run.',
    );
  }

  const nonVanillaEntities = parseEntities(
    [
      'export Descriptor_Unit_Test_Alien is TEntityDescriptor',
      '(',
      "    MotherCountry = 'MARS'",
      '    Coalition = TWargameCoalition/ALIEN',
      '    FactoryType = Factory/Robots',
      ')',
    ].join('\n'),
    'unit',
    ndf,
    parserOptions,
  );
  const nonVanillaCoalitionFailures: string[] = [];
  if (
    nonVanillaEntities[0]?.coalition !== 'ALIEN' ||
    nonVanillaEntities[0]?.factoryType !== 'Robots'
  ) {
    nonVanillaCoalitionFailures.push(
      `Expected arbitrary coalition/category parsing to preserve ALIEN/Robots, got ${JSON.stringify(nonVanillaEntities[0])}.`,
    );
  }

  const hardeningConfig = createDeckGenerationConfig(
    DEFAULT_TEST_CONFIG,
    modTag,
    context.tools.values,
  );
  const dynamicContexts = buildDivisionContexts(
    [
      createEntity('Descriptor_Unit_Test_US', {
        country: 'US',
        coalition: 'NATO',
        factoryType: 'Infantry',
      }),
      createEntity('Descriptor_Unit_Test_Alien', {
        country: 'MARS',
        coalition: 'ALIEN',
        factoryType: 'Robots',
      }),
    ],
    modTag,
    hardeningConfig,
  );
  const dynamicContextFailures: string[] = [];
  if (!dynamicContexts.some((context) => context.code === 'SIDE_ALIEN')) {
    dynamicContextFailures.push('Expected a side context for coalition `ALIEN`.');
  }
  if (!dynamicContexts.some((context) => context.code === 'ALL_ALIEN')) {
    dynamicContextFailures.push('Expected an all-side context for coalition `ALIEN`.');
  }

  const maxActivationPoints = resolveDeckMaxActivationPointsFromCategories(80, [
    'Logistic',
    'Infantry',
    'Art',
    'Tanks',
    'Recons',
    'DCA',
    'Helis',
    'Planes',
    'Defense',
    'Robots',
    'Naval',
  ]);
  const activationPointFailures: string[] = [];
  if (maxActivationPoints !== 880) {
    activationPointFailures.push(
      `Expected activation points to scale to 880 for 11 categories, got ${maxActivationPoints}.`,
    );
  }

  const vtolEntity = createEntity('Descriptor_Unit_Test_VTOL', {
    spawnType: 'VTOL_Aircraft',
    movingType: 'Air',
  });
  const navalEntity = createEntity('Descriptor_Unit_Test_Naval', {
    movingType: 'NavalSurface',
  });
  const movementFailures: string[] = [];
  if (deriveMobilityKey(vtolEntity) !== 'Plane' || deriveTransportGroup(vtolEntity) !== 'Air') {
    movementFailures.push(
      `Expected VTOL aircraft to resolve as Plane/Air, got ${deriveMobilityKey(vtolEntity)}/${deriveTransportGroup(vtolEntity)}.`,
    );
  }
  if (deriveMobilityKey(navalEntity) !== 'Naval') {
    movementFailures.push(
      `Expected naval movement to resolve as Naval, got ${deriveMobilityKey(navalEntity)}.`,
    );
  }

  const headquartersEntity = createEntity('Descriptor_Unit_Test_HQ_Leader', {
    unitRole: 'Headquarters',
    strategicType: 'CommandVehicle',
    tags: ['Leader'],
  });
  const headquartersAnalyses = buildCategoryAnalyses({
    entries: [
      {
        entity: headquartersEntity,
        rule: {
          ...createUnlimitedRule(1, 1),
          unitName: headquartersEntity.name,
        },
        transportNames: [],
      },
    ],
    weaponDescriptors: new Map(),
    ammunition: new Map(),
  });
  const commandInferenceFailures: string[] = [];
  if (!isCommandEntity(headquartersEntity)) {
    commandInferenceFailures.push(
      'Expected `Headquarters`/`Leader` style units to count as command units.',
    );
  }
  if ((headquartersAnalyses.analyses[0]?.metrics.command ?? 0) <= 0) {
    commandInferenceFailures.push(
      'Expected command-style units to receive a positive command metric.',
    );
  }

  const { rules: multilineRuleMap } = parseDivisionRuleData(
    [
      'Descriptor_Deck_Division_Test_Rule is TDeckDivisionRule',
      '(',
      '    UnitRuleList =',
      '    [',
      '        TDeckUniteRule',
      '        (',
      '            UnitDescriptor = $/GFX/Unit/Descriptor_Unit_Test_Multiline',
      '            MaxPackNumber = 3',
      '            NumberOfUnitInPack = 6',
      '            NumberOfUnitInPackXPMultiplier =',
      '            [',
      '                1.0,',
      '                0.75,',
      '                0.5,',
      '                0.25',
      '            ]',
      '        )',
      '    ]',
      ')',
    ].join('\n'),
    [],
    ndf,
  );
  const multilineRuleFailures: string[] = [];
  const multilineRule = multilineRuleMap.get('Descriptor_Unit_Test_Multiline');
  if (
    multilineRule?.maxPackNumber !== 3 ||
    multilineRule.numberOfUnitInPack !== 6 ||
    JSON.stringify(multilineRule.multipliers) !== JSON.stringify([1, 0.75, 0.5, 0.25])
  ) {
    multilineRuleFailures.push(
      `Expected multiline XP multipliers to parse correctly, got ${JSON.stringify(multilineRule)}.`,
    );
  }

  const genericWeaponEntities = parseEntities(
    [
      'export Descriptor_Unit_Test_GenericWeapon is TEntityDescriptor',
      '(',
      "    MotherCountry = 'US'",
      '    Coalition = TWargameCoalition/NATO',
      '    FactoryType = Factory/Infantry',
      '    ModulesDescriptors = [ $/GFX/Weapon/CustomDescriptor_Laser ]',
      ')',
    ].join('\n'),
    'unit',
    ndf,
    parserOptions,
  );
  const genericWeaponFailures: string[] = [];
  if (genericWeaponEntities[0]?.weaponDescriptorNames[0] !== 'CustomDescriptor_Laser') {
    genericWeaponFailures.push(
      `Expected generic weapon descriptor names to be preserved, got ${JSON.stringify(genericWeaponEntities[0]?.weaponDescriptorNames)}.`,
    );
  }

  const weaponDescriptors = parseWeaponDescriptors(
    [
      'CustomDescriptor_Laser is TWeaponManagerModuleDescriptor',
      '(',
      '    Salves =',
      '    [',
      '      2,',
      '      4',
      '    ]',
      '    TMountedWeaponDescriptor',
      '    (',
      '        Ammunition = $/GFX/Weapon/Ammo_Custom_Laser',
      '        AmmoBoxIndex = 0',
      '        NbWeapons = 3',
      '    )',
      ')',
    ].join('\n'),
    ndf,
  );
  const weaponDescriptorFailures: string[] = [];
  const genericWeaponDescriptor = weaponDescriptors.get('CustomDescriptor_Laser');
  if (
    genericWeaponDescriptor?.ammunitionNames[0] !== 'Ammo_Custom_Laser' ||
    genericWeaponDescriptor?.salves[1] !== 4 ||
    genericWeaponDescriptor.mountedWeapons[0]?.weaponCount !== 3
  ) {
    weaponDescriptorFailures.push(
      `Expected non-export weapon descriptors to parse correctly, got ${JSON.stringify(genericWeaponDescriptor)}.`,
    );
  }

  const numericEntities = parseEntities(
    [
      'export Descriptor_Unit_Test_Numeric is TEntityDescriptor',
      '(',
      "    MotherCountry = 'US'",
      '    Coalition = TWargameCoalition/NATO',
      '    FactoryType = Factory/Recons',
      '    UnitConcealmentBonus = 1.5e1',
      '    FuelMoveDuration = -2.5',
      '    VisionRange = (EVisionRange/Advanced, 2.5e3)',
      '    OpticalStrength = (EOpticalStrength/Advanced, 1.2e2)',
      '    CanAssist = true',
      '    TravelDuration = 11',
      '    EvacuationTime = 12',
      '    AgilityRadiusGRU = 1050',
      '    ProductionRessourcesNeeded = MAP [ (Resource_CommandPoints, -35) ]',
      ')',
    ].join('\n'),
    'unit',
    ndf,
    parserOptions,
  );
  const numericAmmunition = parseAmmunition(
    [
      'Ammo_Custom_Sci is TAmmunitionDescriptor',
      '(',
      '    MaximumRangeGRU = 1.5e3',
      '    MinimumRangeGRU = 2.5e2',
      '    Arme = TDamageTypeRTTI(Family=DamageFamily_ap Index=17)',
      '    HitRollRuleDescriptor = TDiceHitRollRuleDescriptor',
      '    (',
      '      BaseHitValueModifiers = [',
      '        (EBaseHitValueModifier/Idling, 65),',
      '        (EBaseHitValueModifier/Moving, 40),',
      '      ]',
      '    )',
      '    PhysicalDamages = 2.4e1',
      '    DispersionAtMaxRangeGRU = 187',
      '    CanShootOnPosition = true',
      '    TirIndirect = false',
      '    ForceHitTopArmorOnSuccess = true',
      '    ComputeArmorFromImpactLocation = true',
      '    TandemCharge = false',
      ')',
    ].join('\n'),
    ndf,
  );
  const numericParsingFailures: string[] = [];
  const numericEntity = numericEntities[0];
  const numericAmmo = numericAmmunition.get('Ammo_Custom_Sci');
  if (
    numericEntity?.concealmentBonus !== 15 ||
    numericEntity.fuelMoveDuration !== -2.5 ||
    numericEntity.visionRange !== 2500 ||
    numericEntity.opticalStrength !== 120 ||
    numericEntity.canAssist !== true ||
    numericEntity.travelDuration !== 11 ||
    numericEntity.evacuationTime !== 12 ||
    numericEntity.agilityRadiusGru !== 1050 ||
    numericEntity.cost !== -35
  ) {
    numericParsingFailures.push(
      `Expected scientific/signed entity values to parse correctly, got ${JSON.stringify(numericEntity)}.`,
    );
  }
  if (
    numericAmmo?.maximumRangeGru !== 1500 ||
    numericAmmo.minimumRangeGru !== 250 ||
    numericAmmo.armorPenetration !== 17 ||
    numericAmmo.accuracyStationary !== 65 ||
    numericAmmo.accuracyMoving !== 40 ||
    numericAmmo.physicalDamages !== 24 ||
    numericAmmo.dispersionAtMaxRangeGru !== 187 ||
    numericAmmo.canShootOnPosition !== true ||
    numericAmmo.tirIndirect !== false ||
    numericAmmo.forceHitTopArmorOnSuccess !== true ||
    numericAmmo.computeArmorFromImpactLocation !== true ||
    numericAmmo.tandemCharge !== false
  ) {
    numericParsingFailures.push(
      `Expected scientific/signed ammunition values to parse correctly, got ${JSON.stringify(numericAmmo)}.`,
    );
  }

  const structuralEntities = parseEntities(
    [
      'export Descriptor_Unit_Test_Structural is TEntityDescriptor',
      '(',
      "    MotherCountry = 'US'",
      '    Coalition = TWargameCoalition/NATO',
      '    FactoryType = Factory/Support',
      '    TagSet = [',
      '      elite,',
      '      support',
      '    ]',
      '    SpecialtiesList = [',
      '      stealth,',
      '      veteran',
      '    ]',
      '    TransportableTagSet = [',
      '      trooptransport',
      '    ]',
      '    VisionRangesGRU = MAP [',
      '      (EVisionRange/Advanced, 4200.0)',
      '    ]',
      '    OpticalStrengths = MAP [',
      '      (EOpticalStrength/Advanced, 3300.0)',
      '    ]',
      '    ProductionRessourcesNeeded = MAP [',
      '      (Resource_CommandPoints, 55)',
      '    ]',
      ')',
    ].join('\n'),
    'unit',
    ndf,
    parserOptions,
  );
  const structuralAmmunition = parseAmmunition(
    [
      'Ammo_Custom_Traits is TAmmunitionDescriptor',
      '(',
      '    TraitsToken = [',
      '      fireandforget,',
      '      topattack',
      '    ]',
      '    MaximumRangeGRU = 2100',
      '    CanShootWhileMoving = True',
      ')',
    ].join('\n'),
    ndf,
  );
  const structuralFieldFailures: string[] = [];
  const structuralEntity = structuralEntities[0];
  const structuralAmmo = structuralAmmunition.get('Ammo_Custom_Traits');
  if (
    JSON.stringify(structuralEntity?.tags) !== JSON.stringify(['elite', 'support']) ||
    JSON.stringify(structuralEntity?.specialties) !== JSON.stringify(['stealth', 'veteran']) ||
    JSON.stringify(structuralEntity?.transportableTags) !== JSON.stringify(['trooptransport']) ||
    structuralEntity?.visionRange !== 4200 ||
    structuralEntity.opticalStrength !== 3300 ||
    structuralEntity.cost !== 55
  ) {
    structuralFieldFailures.push(
      `Expected builder field readers to preserve multiline entity arrays/maps, got ${JSON.stringify(structuralEntity)}.`,
    );
  }
  if (
    JSON.stringify(structuralAmmo?.traits) !== JSON.stringify(['fireandforget', 'topattack']) ||
    structuralAmmo?.maximumRangeGru !== 2100 ||
    structuralAmmo?.canShootWhileMoving !== true
  ) {
    structuralFieldFailures.push(
      `Expected builder field readers to preserve multiline ammunition arrays/direct fields, got ${JSON.stringify(structuralAmmo)}.`,
    );
  }

  const supplyBuildingEntities = parseEntities(
    createSupplyBuildingFixture(),
    'building',
    ndf,
    parserOptions,
  );
  const supplyBuilding = supplyBuildingEntities[0];
  if (
    supplyBuilding?.country !== 'YSM' ||
    supplyBuilding.coalition !== 'NATO' ||
    supplyBuilding.factoryType !== 'Logistic' ||
    supplyBuilding.supplyCapacity !== 2000000 ||
    supplyBuilding.supplyPriority !== 0 ||
    supplyBuilding.hasSupplyModule !== true
  ) {
    structuralFieldFailures.push(
      `Expected YMB-marked nested supply building fields to parse cleanly, got ${JSON.stringify(supplyBuilding)}.`,
    );
  }

  const roleMetricEntities = [
    createEntity('Descriptor_Unit_Test_LowPenetration', {
      country: 'US',
      coalition: 'NATO',
      factoryType: 'Tanks',
      unitRole: 'AT',
      strategicType: 'AT_Veh',
      weaponDescriptorNames: ['Weapon_Test_LowPenetration'],
    }),
    createEntity('Descriptor_Unit_Test_HighPenetration', {
      country: 'US',
      coalition: 'NATO',
      factoryType: 'Tanks',
      unitRole: 'AT',
      strategicType: 'AT_Veh',
      weaponDescriptorNames: ['Weapon_Test_HighPenetration'],
    }),
    createEntity('Descriptor_Unit_Test_DirectFire', {
      country: 'US',
      coalition: 'NATO',
      factoryType: 'Tanks',
      unitRole: 'Armor',
      strategicType: 'Armor',
      weaponDescriptorNames: ['Weapon_Test_DirectFire'],
    }),
    createEntity('Descriptor_Unit_Test_Artillery', {
      country: 'US',
      coalition: 'NATO',
      factoryType: 'Art',
      unitRole: 'Howitzer',
      strategicType: 'Howitzer',
      weaponDescriptorNames: ['Weapon_Test_Artillery'],
    }),
    createEntity('Descriptor_Unit_Test_SmallSalvoArtillery', {
      country: 'US',
      coalition: 'NATO',
      cost: 240,
      factoryType: 'Art',
      unitRole: 'Howitzer',
      strategicType: 'Howitzer',
      weaponDescriptorNames: ['Weapon_Test_SmallSalvoArtillery'],
    }),
    createEntity('Descriptor_Unit_Test_LargeSalvoArtillery', {
      country: 'US',
      coalition: 'NATO',
      cost: 260,
      factoryType: 'Art',
      unitRole: 'Howitzer',
      strategicType: 'Howitzer',
      weaponDescriptorNames: ['Weapon_Test_LargeSalvoArtillery'],
    }),
    createEntity('Descriptor_Unit_Test_NoEcm', {
      country: 'US',
      coalition: 'NATO',
      factoryType: 'Planes',
      unitRole: 'AA',
      strategicType: 'Air_AA',
      maxPhysicalDamages: 10,
      hitRollEcm: 0,
    }),
    createEntity('Descriptor_Unit_Test_Ecm', {
      country: 'US',
      coalition: 'NATO',
      factoryType: 'Planes',
      unitRole: 'AA',
      strategicType: 'Air_AA',
      maxPhysicalDamages: 10,
      hitRollEcm: -0.3,
    }),
    createEntity('Descriptor_Unit_Test_PrecisionStealth', {
      country: 'US',
      coalition: 'NATO',
      factoryType: 'Planes',
      unitRole: 'Appui',
      strategicType: 'Air_Support',
      concealmentBonus: 3,
      weaponDescriptorNames: ['Weapon_Test_PrecisionStealth'],
    }),
  ];
  const roleMetricWeapons = new Map([
    [
      'Weapon_Test_LowPenetration',
      {
        name: 'Weapon_Test_LowPenetration',
        ammunitionNames: ['Ammo_Test_LowPenetration'],
        salves: [100],
        mountedWeapons: [
          { ammunitionName: 'Ammo_Test_LowPenetration', ammoBoxIndex: 0, weaponCount: 1 },
        ],
      },
    ],
    [
      'Weapon_Test_HighPenetration',
      {
        name: 'Weapon_Test_HighPenetration',
        ammunitionNames: ['Ammo_Test_HighPenetration'],
        salves: [6],
        mountedWeapons: [
          { ammunitionName: 'Ammo_Test_HighPenetration', ammoBoxIndex: 0, weaponCount: 1 },
        ],
      },
    ],
    [
      'Weapon_Test_DirectFire',
      {
        name: 'Weapon_Test_DirectFire',
        ammunitionNames: ['Ammo_Test_DirectFire'],
        salves: [40],
        mountedWeapons: [
          { ammunitionName: 'Ammo_Test_DirectFire', ammoBoxIndex: 0, weaponCount: 1 },
        ],
      },
    ],
    [
      'Weapon_Test_Artillery',
      {
        name: 'Weapon_Test_Artillery',
        ammunitionNames: ['Ammo_Test_Artillery'],
        salves: [12],
        mountedWeapons: [
          { ammunitionName: 'Ammo_Test_Artillery', ammoBoxIndex: 0, weaponCount: 1 },
        ],
      },
    ],
    [
      'Weapon_Test_SmallSalvoArtillery',
      {
        name: 'Weapon_Test_SmallSalvoArtillery',
        ammunitionNames: ['Ammo_Test_SmallSalvoHE', 'Ammo_Test_SmallSalvoSmoke'],
        salves: [4],
        mountedWeapons: [
          { ammunitionName: 'Ammo_Test_SmallSalvoHE', ammoBoxIndex: 0, weaponCount: 1 },
          { ammunitionName: 'Ammo_Test_SmallSalvoSmoke', ammoBoxIndex: 0, weaponCount: 1 },
        ],
      },
    ],
    [
      'Weapon_Test_LargeSalvoArtillery',
      {
        name: 'Weapon_Test_LargeSalvoArtillery',
        ammunitionNames: ['Ammo_Test_LargeSalvoHE', 'Ammo_Test_LargeSalvoSmoke'],
        salves: [6],
        mountedWeapons: [
          { ammunitionName: 'Ammo_Test_LargeSalvoHE', ammoBoxIndex: 0, weaponCount: 1 },
          { ammunitionName: 'Ammo_Test_LargeSalvoSmoke', ammoBoxIndex: 0, weaponCount: 1 },
        ],
      },
    ],
    [
      'Weapon_Test_PrecisionStealth',
      {
        name: 'Weapon_Test_PrecisionStealth',
        ammunitionNames: ['Ammo_Test_PrecisionStealth'],
        salves: [2],
        mountedWeapons: [
          { ammunitionName: 'Ammo_Test_PrecisionStealth', ammoBoxIndex: 0, weaponCount: 1 },
        ],
      },
    ],
  ]);
  const roleMetricAmmunition = new Map([
    [
      'Ammo_Test_LowPenetration',
      {
        name: 'Ammo_Test_LowPenetration',
        traits: ['kinetic'],
        armorPenetration: 11,
        piercingWeapon: true,
        maximumRangeGru: 1500,
        physicalDamages: 1,
        accuracyStationary: 50,
        shotsCountPerSalvo: 8,
        timeBetweenTwoShots: 0.1,
        timeBetweenTwoSalvos: 1,
      },
    ],
    [
      'Ammo_Test_HighPenetration',
      {
        name: 'Ammo_Test_HighPenetration',
        traits: ['kinetic'],
        armorPenetration: 30,
        piercingWeapon: true,
        maximumRangeGru: 2275,
        physicalDamages: 1,
        accuracyStationary: 55,
        shotsCountPerSalvo: 1,
        timeBetweenTwoShots: 1,
        timeBetweenTwoSalvos: 7,
      },
    ],
    [
      'Ammo_Test_DirectFire',
      {
        name: 'Ammo_Test_DirectFire',
        traits: ['he'],
        projectileType: 'Obus',
        maximumRangeGru: 2275,
        physicalDamages: 1.2,
        canShootOnPosition: true,
      },
    ],
    [
      'Ammo_Test_Artillery',
      {
        name: 'Ammo_Test_Artillery',
        traits: ['he', 'ind'],
        projectileType: 'Artillerie',
        maximumRangeGru: 12000,
        physicalDamages: 2,
        canShootOnPosition: true,
        forceHitTopArmorOnSuccess: true,
        computeArmorFromImpactLocation: true,
      },
    ],
    [
      'Ammo_Test_SmallSalvoHE',
      {
        name: 'Ammo_Test_SmallSalvoHE',
        traits: ['he', 'ind'],
        projectileType: 'Artillerie',
        maximumRangeGru: 35000,
        minimumRangeGru: 7000,
        physicalDamages: 4.5675,
        radiusSplashPhysicalDamagesGru: 122,
        radiusSplashSuppressDamagesGru: 255,
        suppressDamages: 304,
        shotsCountPerSalvo: 2,
        timeBetweenTwoShots: 5,
        timeBetweenTwoSalvos: 81,
        aimingTime: 30,
        supplyCost: 80,
        canShootOnPosition: true,
        forceHitTopArmorOnSuccess: true,
        computeArmorFromImpactLocation: true,
      },
    ],
    [
      'Ammo_Test_SmallSalvoSmoke',
      {
        name: 'Ammo_Test_SmallSalvoSmoke',
        traits: ['he', 'ind'],
        projectileType: 'Artillerie',
        maximumRangeGru: 35000,
        minimumRangeGru: 7000,
        physicalDamages: 0.132,
        suppressDamages: 7,
        shotsCountPerSalvo: 2,
        timeBetweenTwoShots: 5,
        timeBetweenTwoSalvos: 81,
        aimingTime: 30,
        supplyCost: 2,
        canShootOnPosition: true,
      },
    ],
    [
      'Ammo_Test_LargeSalvoHE',
      {
        name: 'Ammo_Test_LargeSalvoHE',
        traits: ['he', 'ind'],
        projectileType: 'Artillerie',
        maximumRangeGru: 35000,
        minimumRangeGru: 7000,
        physicalDamages: 4.5675,
        radiusSplashPhysicalDamagesGru: 122,
        radiusSplashSuppressDamagesGru: 255,
        suppressDamages: 304,
        shotsCountPerSalvo: 3,
        timeBetweenTwoShots: 5,
        timeBetweenTwoSalvos: 81,
        aimingTime: 30,
        supplyCost: 120,
        canShootOnPosition: true,
        forceHitTopArmorOnSuccess: true,
        computeArmorFromImpactLocation: true,
      },
    ],
    [
      'Ammo_Test_LargeSalvoSmoke',
      {
        name: 'Ammo_Test_LargeSalvoSmoke',
        traits: ['he', 'ind'],
        projectileType: 'Artillerie',
        maximumRangeGru: 35000,
        minimumRangeGru: 7000,
        physicalDamages: 0.132,
        suppressDamages: 7,
        shotsCountPerSalvo: 3,
        timeBetweenTwoShots: 5,
        timeBetweenTwoSalvos: 81,
        aimingTime: 30,
        supplyCost: 3,
        canShootOnPosition: true,
      },
    ],
    [
      'Ammo_Test_PrecisionStealth',
      {
        name: 'Ammo_Test_PrecisionStealth',
        traits: ['he'],
        projectileType: 'GuidedMissile',
        maximumRangeGru: 2975,
        physicalDamages: 25,
        accuracyStationary: 90,
        canShootOnPosition: true,
        forceHitTopArmorOnSuccess: true,
        computeArmorFromImpactLocation: true,
        dispersionAtMaxRangeGru: 187,
      },
    ],
  ]);
  const roleMetricAnalyses = buildCategoryAnalyses({
    entries: roleMetricEntities.map((entity) => ({
      entity,
      rule: { ...createUnlimitedRule(1, 10), unitName: entity.name },
      transportNames: [],
    })),
    weaponDescriptors: roleMetricWeapons,
    ammunition: roleMetricAmmunition,
  }).analyses;
  const roleMetricByName = new Map(
    roleMetricAnalyses.map((analysis) => [analysis.entity.name, analysis]),
  );
  const roleMetricFailures: string[] = [];
  if (
    (roleMetricByName.get('Descriptor_Unit_Test_HighPenetration')?.metrics.antiArmor ?? 0) <=
    (roleMetricByName.get('Descriptor_Unit_Test_LowPenetration')?.metrics.antiArmor ?? 0)
  ) {
    roleMetricFailures.push(
      'High-volume low-penetration fire still outranks a genuinely tank-killing weapon.',
    );
  }
  if (
    (roleMetricByName.get('Descriptor_Unit_Test_DirectFire')?.metrics.indirect ?? 0) !== 0 ||
    (roleMetricByName.get('Descriptor_Unit_Test_Artillery')?.metrics.indirect ?? 0) <= 0
  ) {
    roleMetricFailures.push(
      'Direct-fire shoot-on-position ammunition is still being confused with indirect artillery.',
    );
  }
  const conventionalArtillery = roleMetricByName.get('Descriptor_Unit_Test_Artillery');
  if (
    (conventionalArtillery?.metrics.precision ?? 0) !== 0 ||
    conventionalArtillery?.exactRoleTokens.has('capability:top_attack') ||
    conventionalArtillery?.exactRoleTokens.has('capability:precision_strike')
  ) {
    roleMetricFailures.push(
      'Conventional indirect shells that hit top armor are still being mislabeled as precision top-attack weapons.',
    );
  }
  const smallSalvoArtillery = roleMetricByName.get('Descriptor_Unit_Test_SmallSalvoArtillery');
  const largeSalvoArtillery = roleMetricByName.get('Descriptor_Unit_Test_LargeSalvoArtillery');
  if (
    smallSalvoArtillery?.metrics.ammo !== 8 ||
    largeSalvoArtillery?.metrics.ammo !== 18 ||
    (largeSalvoArtillery?.metrics.indirect ?? 0) <= (smallSalvoArtillery?.metrics.indirect ?? 0)
  ) {
    roleMetricFailures.push(
      `Shared alternate ammo boxes or proportional supply costs distort artillery strength: small=${JSON.stringify(smallSalvoArtillery?.metrics)}, large=${JSON.stringify(largeSalvoArtillery?.metrics)}.`,
    );
  }
  if (
    !smallSalvoArtillery?.profileTokens.some((token) => token === 'ammo:trait_he') ||
    !smallSalvoArtillery.profileTokens.some((token) => token.startsWith('ammo_loadout:'))
  ) {
    roleMetricFailures.push(
      `Ammunition family/loadout identity is missing from the tactical profile: ${JSON.stringify(smallSalvoArtillery?.profileTokens)}.`,
    );
  }
  if (
    (roleMetricByName.get('Descriptor_Unit_Test_Ecm')?.metrics.survivability ?? 0) <=
    (roleMetricByName.get('Descriptor_Unit_Test_NoEcm')?.metrics.survivability ?? 0)
  ) {
    roleMetricFailures.push(
      'Negative hit-roll ECM modifiers are still treated as survivability penalties.',
    );
  }
  const precisionStealth = roleMetricByName.get('Descriptor_Unit_Test_PrecisionStealth');
  if (
    (precisionStealth?.metrics.precision ?? 0) <= 0 ||
    !precisionStealth?.exactRoleTokens.has('capability:top_attack') ||
    !precisionStealth.exactRoleTokens.has('capability:precision_strike') ||
    !precisionStealth.exactRoleTokens.has('capability:stealth')
  ) {
    roleMetricFailures.push(
      'A stealthy guided top-attack platform is not protected as a unique precision-strike role.',
    );
  }

  return {
    results: [
      ignoreFailures.length === 0
        ? {
            name: 'sandbox deck parser honors the configured modTag ignore line',
            status: 'passed' as const,
            details: parsedNames,
          }
        : {
            name: 'sandbox deck parser honors the configured modTag ignore line',
            status: 'failed' as const,
            reason:
              'The sandbox deck parser no longer respects the configured `${modTag}-ignore` directive.',
            suggestion:
              'Keep the parser directive handling aligned with the patch config so ignored descriptors stay excluded.',
            details: ignoreFailures,
          },
      forceIncludeFailures.length === 0
        ? {
            name: 'sandbox deck parser honors force-included entities below the ignore marker',
            status: 'passed' as const,
            details: forcedNames,
          }
        : {
            name: 'sandbox deck parser honors force-included entities below the ignore marker',
            status: 'failed' as const,
            reason:
              'The sandbox deck parser no longer allows the configured `${modTag}-force-include` directive to restore specific entities below the ignore-below marker.',
            suggestion:
              'Honor the force-include directive for the exact descriptor it annotates while still ignoring unrelated later descriptors.',
            details: forceIncludeFailures,
          },
      ignoredRuleFailures.length === 0
        ? {
            name: 'sandbox deck parser ignores configured special vanilla rule blocks',
            status: 'passed' as const,
            details: [...specialRuleRules.keys()].sort((left, right) => left.localeCompare(right)),
          }
        : {
            name: 'sandbox deck parser ignores configured special vanilla rule blocks',
            status: 'failed' as const,
            reason:
              'The sandbox deck parser no longer filters special-case vanilla rule blocks before balanced rule lookup.',
            suggestion:
              'Keep the ignored division rule name regex list aligned with known challenge or alternate vanilla rule sets.',
            details: ignoredRuleFailures,
          },
      divisionMembershipFailures.length === 0
        ? {
            name: 'sandbox generation can exclude non-division units while keeping YSM units',
            status: 'passed' as const,
            details: [
              'The new division-membership filter stays opt-in and still allows YSM-country units.',
            ],
          }
        : {
            name: 'sandbox generation can exclude non-division units while keeping YSM units',
            status: 'failed' as const,
            reason:
              'The new generation-pool filter did not match the requested division-membership behavior.',
            suggestion:
              'Only exclude units missing every vanilla division rule when the new flag is enabled, and always preserve mod-country units.',
            details: divisionMembershipFailures,
          },
      exactRuleFailures.length === 0
        ? {
            name: 'sandbox balanced resolver preserves exact rules after blacklist filtering',
            status: 'passed' as const,
            details: ['Large exact rules are no longer rejected by a hard numeric cap.'],
          }
        : {
            name: 'sandbox balanced resolver preserves exact rules after blacklist filtering',
            status: 'failed' as const,
            reason:
              'The balanced resolver still overrides exact rules because of a hard numeric sanity cap.',
            suggestion:
              'Only filter cheat-like rule sets through the blacklist, then preserve the remaining exact rule values.',
            details: exactRuleFailures,
          },
      similarRuleFailures.length === 0
        ? {
            name: 'sandbox balanced resolver prefers the most generous sane similar rules',
            status: 'passed' as const,
            details: ['Similar-unit fallback now keeps the highest sane availability values.'],
          }
        : {
            name: 'sandbox balanced resolver prefers the most generous sane similar rules',
            status: 'failed' as const,
            reason:
              'The balanced resolver still averages similar sane rules instead of preserving the strongest sane fallback values.',
            suggestion:
              'When exact rules are missing, derive fallback availability from the most generous sane similar rules rather than a median blend.',
            details: similarRuleFailures,
          },
      fallbackRuleFailures.length === 0
        ? {
            name: 'sandbox balanced fallback keeps the default safety curve',
            status: 'passed' as const,
            details: [JSON.stringify(FALLBACK_BALANCED_RULE)],
          }
        : {
            name: 'sandbox balanced fallback keeps the default safety curve',
            status: 'failed' as const,
            reason:
              'The default balanced fallback no longer preserves the expected 10-to-1 style availability curve.',
            suggestion:
              'If no similar sane rule exists, fall back to the capped default balanced availability profile.',
            details: fallbackRuleFailures,
          },
      packProfileFailures.length === 0
        ? {
            name: 'sandbox premade pack selection skips fractional veteran dead cards',
            status: 'passed' as const,
            details: [
              'Single-unit 0.4x cards now use rookie packs instead of invalid veteran ones.',
            ],
          }
        : {
            name: 'sandbox premade pack selection skips fractional veteran dead cards',
            status: 'failed' as const,
            reason:
              'Premade pack generation still picks veterancy levels whose rounded pack size collapses to zero.',
            suggestion:
              'Only emit premade packs for XP levels that resolve to a real positive rounded card size, then fall back to the next valid XP.',
            details: packProfileFailures,
          },
      float32PackFailures.length === 0
        ? {
            name: 'pack counts survive a multiplier read back from float32',
            status: 'passed' as const,
            details: ['5 x 0.7 resolves to 4 units, as the game computes it.'],
          }
        : {
            name: 'pack counts survive a multiplier read back from float32',
            status: 'failed' as const,
            reason:
              'A pack multiplier that NDF rounded to float32 resolves to a different unit count than the game computes, which makes the cook reject the deck as having an invalid unit amount.',
            suggestion:
              'Round pack counts through `resolvePackCount`, which drops the float32 error before rounding, at every site that multiplies `numberOfUnitInPack` by a multiplier.',
            details: float32PackFailures,
          },
      forcedPremadeVariantFailures.length === 0
        ? {
            name: 'sandbox unlimited forced-premade units survive variant filtering',
            status: 'passed' as const,
            details: [
              'Forced unlimited units can now reach rule generation for premade deck output.',
            ],
          }
        : {
            name: 'sandbox unlimited forced-premade units survive variant filtering',
            status: 'failed' as const,
            reason:
              'Forced-premade unlimited units are still dropped before rule generation, so they never appear in the final deck cards.',
            suggestion:
              'Treat forced-premade matches as variant-included for the configured unlimited variants.',
            details: forcedPremadeVariantFailures,
          },
      forcedSlotFailures.length === 0
        ? {
            name: 'sandbox forced premade cards consume only final slot capacity',
            status: 'passed' as const,
            details: ['Forced cards consume the final limit without entering role scoring.'],
          }
        : {
            name: 'sandbox forced premade cards consume only final slot capacity',
            status: 'failed' as const,
            reason:
              'Forced premade cards did not consume the final slot capacity deterministically.',
            suggestion:
              'Insert unscored forced cards first, then apply the remaining final capacity to competitive cards.',
            details: forcedSlotFailures,
          },
      forcedIsolationFailures.length === 0
        ? {
            name: 'sandbox forced units are isolated from competitive scoring',
            status: 'passed' as const,
            details: ['An extreme forced outlier left every competitive pick unchanged.'],
          }
        : {
            name: 'sandbox forced units are isolated from competitive scoring',
            status: 'failed' as const,
            reason:
              'Forced units still influenced competitive analysis, ranking, or card metadata.',
            suggestion:
              'Materialize forced cards directly and exclude them from every competitive statistic, role, and coverage-budget input.',
            details: forcedIsolationFailures,
          },
      mainRoleFailures.length === 0
        ? {
            name: 'sandbox discovered purposes retain all supported selection perspectives',
            status: 'passed' as const,
            details: [...tankPerspectiveKinds].sort(),
          }
        : {
            name: 'sandbox discovered purposes retain all supported selection perspectives',
            status: 'failed' as const,
            reason: 'A discovered type, role, or trait lost a supported selection perspective.',
            suggestion:
              'Protect up to three distinct candidates per discovered purpose through diversity selection and per-category trimming, reserving the price-independent optimum first.',
            details: mainRoleFailures,
          },
      analysisCacheFailures.length === 0
        ? {
            name: 'sandbox entity analysis cache is equivalent and mutation-isolated',
            status: 'passed' as const,
            details: ['Cached and direct analysis match after an isolated mutation probe.'],
          }
        : {
            name: 'sandbox entity analysis cache is equivalent and mutation-isolated',
            status: 'failed' as const,
            reason: 'Cached analysis changed results or leaked mutable category state.',
            suggestion:
              'Cache only immutable entity-level facts and clone every mutable analysis collection per category.',
            details: analysisCacheFailures,
          },
      optionAdmissionFailures.length === 0
        ? {
            name: 'sandbox role options respect tactical range, distinctness, and meaningful savings',
            status: 'passed' as const,
            details: atSelectionNames,
          }
        : {
            name: 'sandbox role options respect tactical range, distinctness, and meaningful savings',
            status: 'failed' as const,
            reason:
              'A role option ignored its tactical priorities, duplicated another perspective, or saved too little to justify a card.',
            suggestion:
              'Score role interactions explicitly, keep the price-independent optimum first, and admit economy perspectives only when they add purpose or meaningful savings.',
            details: optionAdmissionFailures,
          },
      duplicateFailures.length === 0
        ? {
            name: 'sandbox near-duplicate choices consolidate without losing role coverage',
            status: 'passed' as const,
            details: ['Data-relative duplicate profiles merge secondary role coverage.'],
          }
        : {
            name: 'sandbox near-duplicate choices consolidate without losing role coverage',
            status: 'failed' as const,
            reason: 'Near-identical units remained duplicated or lost their covered purposes.',
            suggestion:
              'Consolidate similar profiles across roles only when every allocated one-, two-, or three-card coverage target survives.',
            details: duplicateFailures,
          },
      roleDiversityFailures.length === 0
        ? {
            name: 'sandbox role aliases and platform forms preserve useful composition diversity',
            status: 'passed' as const,
            details: [
              'Equivalent role labels share one selection budget.',
              'Minority dismounted role variants retain transportable infantry coverage.',
            ],
          }
        : {
            name: 'sandbox role aliases and platform forms preserve useful composition diversity',
            status: 'failed' as const,
            reason:
              'Equivalent role labels inflated one specialization or minority platform forms disappeared.',
            suggestion:
              'Consolidate roles by semantic support and preserve minority platform forms within broad combat roles.',
            details: roleDiversityFailures,
          },
      compositionFailures.length === 0
        ? {
            name: 'sandbox premade decks enforce independent per-category limits',
            status: 'passed' as const,
            details: [
              `${compositionCards.length} cards`,
              `${new Set(compositionCards.flatMap((card) => card.roleKeys)).size} covered roles`,
            ],
          }
        : {
            name: 'sandbox premade decks enforce independent per-category limits',
            status: 'failed' as const,
            reason:
              'Premade deck trimming exceeded a per-category limit, collapsed independent category capacity, erased a category, or lost merged role coverage.',
            suggestion:
              'Enforce deckSlotCount independently for every observed category and merge role coverage when duplicate cards collapse.',
            details: compositionFailures,
          },
      standoutUnitFailures.length === 0
        ? {
            name: 'sandbox standout units only list forced config units',
            status: 'passed' as const,
            details: [
              'Generated division standout units stay empty unless config forced-premade units exist.',
            ],
          }
        : {
            name: 'sandbox standout units only list forced config units',
            status: 'failed' as const,
            reason:
              'Division standout units still include heuristically selected cards instead of only config-forced premade units.',
            suggestion:
              'Restrict StandoutUnits generation to unique forced-premade cards so balanced divisions stay empty.',
            details: standoutUnitFailures,
          },
      persistentStoreFailures.length === 0
        ? {
            name: 'sandbox persistent store fails closed and allocates new identities safely',
            status: 'passed' as const,
            details: [
              newMetadata.divisionNameToken,
              newMetadata.deckNameToken,
              `guid:${newMetadata.guid.length}`,
            ],
          }
        : {
            name: 'sandbox persistent store fails closed and allocates new identities safely',
            status: 'failed' as const,
            reason:
              'Deck-generation persistent store handling did not reject corruption or allocate valid new identity metadata.',
            suggestion:
              'Reject corrupt tracked stores and create GUID/token metadata only for genuinely new divisions.',
            details: persistentStoreFailures,
          },
      nonVanillaCoalitionFailures.length === 0
        ? {
            name: 'sandbox parser preserves arbitrary coalition and category identifiers',
            status: 'passed' as const,
            details: ['ALIEN coalition and Robots category stayed intact during parsing.'],
          }
        : {
            name: 'sandbox parser preserves arbitrary coalition and category identifiers',
            status: 'failed' as const,
            reason:
              'The parser still hardcodes vanilla coalition/category identifiers and drops unknown values.',
            suggestion:
              'Parse coalition/category strings generically so total-conversion mods keep their own side and category names.',
            details: nonVanillaCoalitionFailures,
          },
      dynamicContextFailures.length === 0
        ? {
            name: 'sandbox context generation adapts to observed coalition names',
            status: 'passed' as const,
            details: dynamicContexts.map((context) => context.code),
          }
        : {
            name: 'sandbox context generation adapts to observed coalition names',
            status: 'failed' as const,
            reason:
              'Context generation still assumes a fixed NATO/PACT side list instead of using observed coalition ids.',
            suggestion:
              'Generate side and all-side contexts from the parsed coalition set rather than a hardcoded coalition pair.',
            details: dynamicContextFailures,
          },
      activationPointFailures.length === 0
        ? {
            name: 'sandbox max activation points scale with discovered category count',
            status: 'passed' as const,
            details: [`maxActivationPoints=${maxActivationPoints}`],
          }
        : {
            name: 'sandbox max activation points scale with discovered category count',
            status: 'failed' as const,
            reason:
              'Activation points still assume the vanilla category count even when extra factory categories exist.',
            suggestion:
              'Scale activation points from the discovered category set so extra categories do not lose slot budget.',
            details: activationPointFailures,
          },
      movementFailures.length === 0
        ? {
            name: 'sandbox movement inference handles broader transport and air-mobility patterns',
            status: 'passed' as const,
            details: [
              `VTOL=${deriveMobilityKey(vtolEntity)}/${deriveTransportGroup(vtolEntity)}`,
              `Naval=${deriveMobilityKey(navalEntity)}`,
            ],
          }
        : {
            name: 'sandbox movement inference handles broader transport and air-mobility patterns',
            status: 'failed' as const,
            reason:
              'Movement inference still depends too heavily on vanilla helicopter/plane labels.',
            suggestion:
              'Use broader movement/spawn/pathfinding hints so transport grouping works in heavy overhauls.',
            details: movementFailures,
          },
      commandInferenceFailures.length === 0
        ? {
            name: 'sandbox command inference recognizes broader command vocabulary',
            status: 'passed' as const,
            details: ['Headquarters and leader-style labels produce command scoring.'],
          }
        : {
            name: 'sandbox command inference recognizes broader command vocabulary',
            status: 'failed' as const,
            reason: 'Command inference still depends on narrow CMD-only naming assumptions.',
            suggestion:
              'Accept broader command vocabulary so total-conversion command units still get command treatment.',
            details: commandInferenceFailures,
          },
      multilineRuleFailures.length === 0
        ? {
            name: 'sandbox parser accepts multiline XP multiplier arrays',
            status: 'passed' as const,
            details: [JSON.stringify(multilineRule?.multipliers ?? [])],
          }
        : {
            name: 'sandbox parser accepts multiline XP multiplier arrays',
            status: 'failed' as const,
            reason:
              'Division rule parsing still assumes XP multiplier arrays stay inline on one line.',
            suggestion:
              'Use the shared numeric-array parser so multiline XP multiplier blocks survive formatting changes.',
            details: multilineRuleFailures,
          },
      genericWeaponFailures.length === 0
        ? {
            name: 'sandbox entity parser keeps generic weapon descriptor references',
            status: 'passed' as const,
            details: genericWeaponEntities[0]?.weaponDescriptorNames ?? [],
          }
        : {
            name: 'sandbox entity parser keeps generic weapon descriptor references',
            status: 'failed' as const,
            reason:
              'Entity parsing still assumes weapon descriptor names must start with the vanilla `WeaponDescriptor_` prefix.',
            suggestion:
              'Capture any `$/GFX/Weapon/<name>` descriptor reference so overhaul mods can rename weapon managers freely.',
            details: genericWeaponFailures,
          },
      weaponDescriptorFailures.length === 0
        ? {
            name: 'sandbox weapon descriptor parser tolerates non-export descriptors',
            status: 'passed' as const,
            details: [JSON.stringify(genericWeaponDescriptor)],
          }
        : {
            name: 'sandbox weapon descriptor parser tolerates non-export descriptors',
            status: 'failed' as const,
            reason:
              'Weapon descriptor parsing still expects exported vanilla-style manager blocks only.',
            suggestion:
              'Allow descriptor parsing without a mandatory `export` keyword and keep multiline salve arrays working.',
            details: weaponDescriptorFailures,
          },
      numericParsingFailures.length === 0
        ? {
            name: 'sandbox numeric parsing tolerates scientific notation, signs, and lowercase booleans',
            status: 'passed' as const,
            details: [JSON.stringify(numericEntity), JSON.stringify(numericAmmo)],
          }
        : {
            name: 'sandbox numeric parsing tolerates scientific notation, signs, and lowercase booleans',
            status: 'failed' as const,
            reason:
              'Parser numeric handling still assumes simple unsigned decimals and title-case booleans.',
            suggestion:
              'Accept scientific notation, signed numbers, and case-insensitive booleans so formatting-heavy mods still parse cleanly.',
            details: numericParsingFailures,
          },
      roleMetricFailures.length === 0
        ? {
            name: 'sandbox role metrics respect combat breakpoints and delivery reliability',
            status: 'passed' as const,
            details: [
              'High penetration beats low-caliber volume for anti-tank scoring.',
              'Only actual indirect ammunition receives artillery score.',
              'Negative hit-roll ECM modifiers improve survivability.',
            ],
          }
        : {
            name: 'sandbox role metrics respect combat breakpoints and delivery reliability',
            status: 'failed' as const,
            reason: 'One or more role-specific scoring fundamentals regressed.',
            suggestion:
              'Keep penetration, indirect-fire mechanics, and ECM direction explicit in the data-derived metrics.',
            details: roleMetricFailures,
          },
      structuralFieldFailures.length === 0
        ? {
            name: 'sandbox parser reuses builder field readers for multiline arrays and maps',
            status: 'passed' as const,
            details: [JSON.stringify(structuralEntity), JSON.stringify(structuralAmmo)],
          }
        : {
            name: 'sandbox parser reuses builder field readers for multiline arrays and maps',
            status: 'failed' as const,
            reason:
              'The parser no longer preserves multiline direct-field arrays or map-backed scalar fields after the builder scanner refactor.',
            suggestion:
              'Keep direct field extraction routed through the builder NDF field readers so multiline arrays and maps do not depend on local line-state parsing.',
            details: structuralFieldFailures,
          },
    ],
  };
}

function createEntity(name: string, overrides: Partial<EntityData> = {}): EntityData {
  return {
    name,
    kind: 'unit',
    tags: [],
    specialties: [],
    transportableTags: [],
    weaponDescriptorNames: [],
    capacityNames: [],
    positiveCapacityNames: [],
    negativeCapacityNames: [],
    effectTokens: [],
    positiveEffectTokens: [],
    negativeEffectTokens: [],
    effectUtility: 0,
    isTransportable: false,
    cost: 0,
    hasSupplyModule: false,
    ...overrides,
  };
}

function createPremadeCard(
  entity: EntityData,
  transportName: string | undefined,
  keepPriority: number,
): PremadeCard {
  return {
    entity,
    categoryKey: entity.factoryType ?? 'Infantry',
    categoryOrder: 0,
    typeKey: entity.strategicType ?? 'test',
    roleKeys: ['type:test'],
    selectionKind: 'type-best',
    forcedInPremade: false,
    maxUnitCardCount: 2,
    roleScore: keepPriority,
    keepPriority,
    similarityKey: entity.name,
    similarityVector: [],
    packDescriptorName: `${entity.name}_${transportName ?? 'none'}`,
    ...(transportName ? { transportName } : {}),
  };
}
