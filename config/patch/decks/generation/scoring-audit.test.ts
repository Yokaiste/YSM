import assert from 'node:assert/strict';
import type { BuildScriptTest } from 'ymb/api';
import {
  buildDivisionContexts,
  buildGeneratedDeckName,
  buildGeneratedDivisionName,
  buildGeneratedDivisionSummaryText,
} from './contexts.ts';
import {
  buildCategoryAnalyses,
  compareNearDuplicateProfileQuality,
  createEntityAnalysisFactory,
  scoreAnalysisForRole,
} from './generator/analysis.ts';
import {
  applyDamageResistanceProfiles,
  applyPersistentFireProfiles,
} from './generator/combat-data.ts';
import { compareCountryPreference, createDeckGenerationConfig } from './generator/config.ts';
import { renderNumberArray, resolvePackCount } from './generator/helpers.ts';
import { resolvePackProfile } from './generator/packs.ts';
import {
  applyCapacityEffectProfiles,
  parseAmmunition,
  parseCapacityEffectProfiles,
  parseEntities,
  parseSellableOrderAvailabilityNames,
  parseWeaponDescriptors,
} from './generator/parsers.ts';
import { buildPremadeCards } from './generator/premade.ts';
import { trimCategoryCards } from './generator/premade-cards.ts';
import { buildRoleSelections } from './generator/premade-selection.ts';
import { buildRuleEntries, createBalancedRuleResolver } from './generator/rules.ts';
import { createUnlimitedRule, type EntityData } from './generator/types.ts';

const test: BuildScriptTest = ({ tools: { ndf, values } }) => {
  const [entity] = parseEntities(
    `export Example is TEntityDescriptor(
    MotherCountry = "TEST" Coalition = TWargameCoalition/NATO FactoryType = Factory/Infantry
    UnitRole = 'infantry' MaxPhysicalDamages = 10
    VisionRangesGRU = MAP [(EVisionRange/Standard, 1000), (EVisionRange/HighAltitude, 9000)]
    OpticalStrengths = MAP [(EOpticalStrength/Standard, 100), (EOpticalStrength/HighAltitude, 900)]
    ModulesDescriptors = [$/GFX/Weapon/Manager, TDeathModuleDescriptor(Ammunition = $/GFX/Weapon/DeathExplosion)]
    DefaultSkillList = [$/GFX/EffectCapacity/First, $/GFX/EffectCapacity/Second]
  )`,
    'unit',
    ndf,
  );
  assert.ok(entity);
  assert.equal(entity.country, 'TEST');
  assert.equal(entity.visionRange, 1000);
  assert.equal(entity.opticalStrength, 100);
  assert.equal(entity.airVisionRange, 9000);
  assert.equal(entity.airOpticalStrength, 900);
  assert.deepEqual(entity.weaponDescriptorNames, ['Manager']);
  assert.deepEqual(entity.capacityNames, ['First', 'Second']);
  assert.deepEqual(
    [
      ...parseSellableOrderAvailabilityNames(`Orders is [
    EOrderType/Move,
    EOrderType/Sell,
  ] Hidden is [EOrderType/Move // EOrderType/Sell
  ]`),
    ],
    ['Orders'],
  );

  const manager = `export Manager is TWeaponManagerModuleDescriptor(
    Salves = [2, 3] TurretDescriptorList = [TTurretUnitDescriptor(
      MountedWeaponDescriptorList = [
        TMountedWeaponDescriptor(NbWeapons = 2 Ammunition = $/GFX/Weapon/Shot TraitsToken = ["KINETIC", "F&F_BORESIGHT"]),
        TMountedWeaponDescriptor(AmmoBoxIndex = 1 Ammunition = $/GFX/Weapon/Other NbWeapons = 1)
      ]
    )]
  )`;
  const weapons = parseWeaponDescriptors(manager, ndf);
  assert.deepEqual(weapons.get('Manager')?.mountedWeapons, [
    {
      ammunitionName: 'Shot',
      ammoBoxIndex: 0,
      weaponCount: 2,
      traits: ['kinetic', 'f&f_boresight'],
    },
    { ammunitionName: 'Other', ammoBoxIndex: 1, weaponCount: 1, traits: [] },
  ]);
  const ammunition = parseAmmunition(
    `Shot is TAmmunitionDescriptor(
    MaximumRangeGRU = 1000 PhysicalDamages = 5 ShotsCountPerSalvo = 4
    TimeBetweenTwoShots = 1 TimeBetweenTwoSalvos = 99
    TimeBetweenTwoSalvos_Min = 2 TimeBetweenTwoSalvos_Max = 4
    HitRollRuleDescriptor = TDiceHitRollRuleDescriptor(BaseHitValueModifiers = [
      (EBaseHitValueModifier/Base, 10), (EBaseHitValueModifier/Idling, 40), (EBaseHitValueModifier/Moving, -10)
    ]) CanShootWhileMoving = False
  )`,
    ndf,
  );
  const shot = ammunition.get('Shot');
  assert.ok(shot);
  assert.equal(shot.accuracyStationary, 50);
  assert.equal(shot.accuracyMoving, 0);
  assert.equal(shot.timeBetweenTwoSalvos, 3);
  const rule = { ...createUnlimitedRule(5, 8), unitName: entity.name };
  const entry = { entity, rule, transportNames: [] };
  const analyze = (overrides: Partial<typeof shot>) =>
    createEntityAnalysisFactory(weapons, new Map([['Shot', { ...shot, ...overrides }]])).analyze(
      entry,
    );
  const stationary = analyze({});
  assert.ok(stationary.profileTokens.includes('mechanic:trait_kinetic'));
  assert.ok(stationary.profileTokens.includes('mechanic:trait_f_f_boresight'));
  const unmarkedWeapons = parseWeaponDescriptors(
    manager.replace('TraitsToken = ["KINETIC", "F&F_BORESIGHT"]', ''),
    ndf,
  );
  assert.equal(
    createEntityAnalysisFactory(unmarkedWeapons, ammunition)
      .analyze(entry)
      .profileTokens.includes('mechanic:trait_kinetic'),
    false,
  );
  assert.equal(Object.hasOwn(shot, 'traits'), false, 'A mount must not change shared ammunition.');
  const infantryRole = {
    key: 'primary:infantry',
    kind: 'primary',
    optionCount: 3,
    priority: 1,
    focus: { antiGround: 1 },
  } as const;
  assert.ok(
    scoreAnalysisForRole(stationary, infantryRole).fitScore >
      scoreAnalysisForRole(
        { ...stationary, entity: { ...entity, effectUtility: -5 } },
        infantryRole,
      ).fitScore,
  );
  assert.equal(stationary.metrics.fireOnMove, 0);
  assert.equal(analyze({ accuracyMoving: 50, canShootWhileMoving: false }).metrics.fireOnMove, 0);
  assert.ok(analyze({ accuracyMoving: 50, canShootWhileMoving: true }).metrics.fireOnMove > 0);
  assert.equal(analyze({ accuracyStationary: 0 }).metrics.alphaGround, 0);
  const simultaneous = analyze({ simultaneousShotsCount: 4 });
  assert.equal(simultaneous.metrics.alphaGround, stationary.metrics.alphaGround);
  assert.ok(simultaneous.metrics.burstDps > stationary.metrics.burstDps);
  assert.equal(analyze({ computeArmorFromImpactLocation: true }).metrics.precision, 0);
  assert.ok(analyze({ forceHitTopArmorOnSuccess: true }).metrics.precision > 0);
  assert.ok(analyze({ minimumRangeGru: 900 }).metrics.antiGround < stationary.metrics.antiGround);
  const smoke = analyze({
    name: 'Smoke',
    physicalDamages: 0,
    suppressDamages: 0,
    hasSmoke: true,
    maximumRangeGru: 2000,
  });
  assert.ok(smoke.metrics.smokeSupport > 0);
  assert.equal(smoke.metrics.antiGround, 0);
  assert.equal(
    analyze({ name: 'RenamedCombatFlare', hasSmoke: false }).metrics.alphaGround,
    stationary.metrics.alphaGround,
  );
  const emptyWeapons = parseWeaponDescriptors(
    manager.replace('Salves = [2, 3]', 'Salves = [0, 0]'),
    ndf,
  );
  assert.equal(
    createEntityAnalysisFactory(emptyWeapons, ammunition).analyze(entry).metrics.antiGround,
    0,
  );

  const targets = parseEntities(
    `
    Foot is TEntityDescriptor(ResistanceFront = TResistanceTypeRTTI(Family=ResistanceFamily_infanterie Index=1))
    Air is TEntityDescriptor(ResistanceFront = TResistanceTypeRTTI(Family=ResistanceFamily_avion Index=1))
    Helo is TEntityDescriptor(ResistanceFront = TResistanceTypeRTTI(Family=ResistanceFamily_helico Index=1))
    Light is TEntityDescriptor(ResistanceFront = TResistanceTypeRTTI(Family=ResistanceFamily_blindage Index=1)
      ResistanceTop = TResistanceTypeRTTI(Family=ResistanceFamily_blindage Index=1))
    Heavy is TEntityDescriptor(ResistanceFront = TResistanceTypeRTTI(Family=ResistanceFamily_blindage Index=2)
      ResistanceTop = TResistanceTypeRTTI(Family=ResistanceFamily_blindage Index=1))
  `,
    'unit',
    ndf,
  );
  assert.equal(
    targets[0]?.frontArmor,
    0,
    'A resistance-family index is not armor on a soft target.',
  );
  const matrix = `Matrix is TGameplayDamageResistanceContainer(
    ResistanceFamilyCounts = [(ResistanceFamily_infanterie, 1), (ResistanceFamily_avion, 1),
      (ResistanceFamily_helico, 1), (ResistanceFamily_blindage, 2)]
    DamageFamilyCounts = [(DamageFamily_invented, 2), (DamageFamily_other, 1)]
    Values = [[0, 2, 3, 6, 0], [4, 0, 0, 1, 1], [1, 1, 1, 2, 2]]
  )`;
  const matrixAmmo = parseAmmunition(
    `
    Shot is TAmmunitionDescriptor(Arme = TDamageTypeRTTI(Family=DamageFamily_invented Index=1)
      MaximumRangeGRU = 1000 MaximumRangeHelicopterGRU = 1000 MaximumRangeAirplaneGRU = 1000
      PhysicalDamages = 2 ShotsCountPerSalvo = 1
      HitRollRuleDescriptor = TDiceHitRollRuleDescriptor(BaseHitValueModifiers = [(EBaseHitValueModifier/Base, 100)]))
    Top is TAmmunitionDescriptor(Arme = TDamageTypeRTTI(Family=DamageFamily_invented Index=1)
      ForceHitTopArmorOnSuccess = True)
    Burn is TAmmunitionDescriptor(Arme = TDamageTypeRTTI(Family=DamageFamily_other Index=1)
      PhysicalDamages = 2)
    Fire is TAmmunitionDescriptor(Arme = TDamageTypeRTTI(Family=DamageFamily_invented Index=2)
      FireDescriptor = $/GFX/Weapon/FireArea MaximumRangeGRU = 1000 PhysicalDamages = 0)
  `,
    ndf,
  );
  applyDamageResistanceProfiles(matrixAmmo, targets, matrix, ndf);
  assert.deepEqual(matrixAmmo.get('Shot')?.damageMultipliers, {
    ground: 0,
    plane: 2,
    helo: 3,
    armor: 2,
  });
  assert.equal(matrixAmmo.get('Top')?.damageMultipliers?.armor, 6);
  assert.equal(
    matrixAmmo.get('Burn')?.damageMultipliers?.ground,
    1,
    'Family offsets are independent of RTTI indices.',
  );
  assert.equal(
    matrixAmmo.get('Shot')?.accuracyStationary,
    100,
    'Base-only hit rules retain their accuracy.',
  );
  const matrixAnalysis = createEntityAnalysisFactory(weapons, matrixAmmo).analyze(entry);
  assert.equal(matrixAnalysis.metrics.alphaGround, 0);
  assert.ok(matrixAnalysis.metrics.alphaHelo > matrixAnalysis.metrics.alphaPlane);
  assert.ok(matrixAnalysis.metrics.antiArmor > 0, 'Low family indices can still damage armor.');
  const radarAmmo = new Map(matrixAmmo);
  const radarShot = radarAmmo.get('Shot');
  assert.ok(radarShot);
  radarAmmo.set('Shot', { ...radarShot, guidance: 'AntiRadar' });
  const radarAnalysis = createEntityAnalysisFactory(weapons, radarAmmo).analyze(entry);
  assert.ok(radarAnalysis.metrics.sead > 0);
  assert.equal(
    radarAnalysis.metrics.antiArmor,
    0,
    'Anti-radar guidance is not a general anti-tank weapon.',
  );
  assert.ok(!radarAnalysis.profileTokens.includes('channel:armor'));
  assert.throws(
    () =>
      applyDamageResistanceProfiles(
        matrixAmmo,
        targets,
        matrix.replace('[1, 1, 1, 2, 2]', '[1]'),
        ndf,
      ),
    /damage table with the wrong size/,
  );
  assert.throws(
    () =>
      applyDamageResistanceProfiles(
        new Map([['Bad', { name: 'Bad', damageFamily: 'missing', damageIndex: 1 }]]),
        targets,
        matrix,
        ndf,
      ),
    /damage family or index missing/,
  );
  applyPersistentFireProfiles(
    matrixAmmo,
    `FireArea is TEntityDescriptor(ModulesDescriptors = [
    TFireModuleDescriptor(AmmunitionForBurn = $/GFX/Weapon/Burn TimeBetweenBurns = 2 RadiusGRU = 100 TimeToLive = 30)
  ])`,
    ndf,
  );
  assert.equal(matrixAmmo.get('Fire')?.fireDamagePerSecond, 1);
  const fireWeapons = parseWeaponDescriptors(
    manager.replaceAll('$/GFX/Weapon/Shot', '$/GFX/Weapon/Fire'),
    ndf,
  );
  const fireAnalysis = createEntityAnalysisFactory(fireWeapons, matrixAmmo).analyze(entry);
  assert.ok(
    fireAnalysis.metrics.areaDenial > 0,
    'Fire with no impact damage still provides area denial.',
  );
  assert.equal(fireAnalysis.metrics.alphaGround, 0);
  const accurateBomb = analyze({
    projectileType: 'Bombe',
    radiusSplashPhysicalDamagesGru: 100,
    dispersionAtMaxRangeGru: 10,
  });
  const scatteredBomb = analyze({
    projectileType: 'Bombe',
    radiusSplashPhysicalDamagesGru: 100,
    dispersionAtMaxRangeGru: 200,
  });
  assert.ok(accurateBomb.metrics.alphaGround > scatteredBomb.metrics.alphaGround);

  const effects = parseCapacityEffectProfiles(
    `
    Steady is TCapaciteDescriptor(TargetEffect = ~/SteadyEffect)
    Mixed is TCapaciteDescriptor(TargetEffect = ~/MixedEffect)
    Jammer is TCapaciteDescriptor(TargetEffect = ~/MixedEffect TargetTeamFilter = ~/Filter_enemy)
    Detector is TCapaciteDescriptor(SelfEffect = ~/Indicator TargetTeamFilter = ~/Filter_enemy RangeGRU = 2000 CheckVisibility = False)
    ShortDetector is TCapaciteDescriptor(SelfEffect = ~/Indicator TargetTeamFilter = ~/Filter_enemy RangeGRU = 1000 CheckVisibility = False)
  `,
    `
    SteadyEffect is TEffectsPackDescriptor(EffectsDescriptors = [
      TUnitEffectIncreaseDamageTakenDescriptor(ModifierType = ~/ModifierType_Pourcentage BonusDamage = -20 DamageType = EDamageType/Suppress),
      TUnitEffectHealOverTimeDescriptor(HealUnitsPerSecond = 0.5),
      TBonusWeaponAimtimeEffectDescriptor(ModifierType = ~/ModifierType_Multiplicatif ModifierValue = 0.8),
      TUnitEffectAlterWeaponTempsEntreDeuxSalvesDescriptor(ModifierType = ~/ModifierType_Multiplicatif ModifierValue = 0.8),
      TUnitEffectBonusExperienceLevelDescriptor(ExperienceLevelModifier = 1),
      TUnitEffectBonusHitRollECMDescriptor(BonusHitRollECM = -0.1)
    ])
    MixedEffect is TEffectsPackDescriptor(EffectsDescriptors = [
      TUnitEffectIncreaseWeaponPrecisionArretDescriptor(ModifierValue = 5),
      TUnitEffectIncreaseWeaponPrecisionMouvementDescriptor(ModifierValue = -5)
    ])
    Indicator is TEffectsPackDescriptor(EffectsDescriptors = [TUnitEffectShowLabelIconDescriptor(TextureToken = "invented")])
  `,
    ndf,
  );
  assert.equal(effects.get('Steady')?.positiveTokens.length, 6);
  assert.equal(effects.get('Steady')?.negativeTokens.length, 0);
  assert.ok((effects.get('Detector')?.utility ?? 0) > (effects.get('ShortDetector')?.utility ?? 0));
  assert.ok(
    effects.get('Detector')?.positiveTokens.some((token) => token.includes('proximity_detection')),
  );
  assert.equal(effects.get('Mixed')?.positiveTokens.length, 1);
  assert.equal(
    effects.get('Mixed')?.negativeTokens.length,
    1,
    'A mixed trait retains both effects even when net utility is zero.',
  );
  assert.ok(effects.get('Jammer')?.positiveTokens.some((token) => token.includes('mouvement')));
  const mixedEntity = { ...entity, capacityNames: ['Mixed'] };
  applyCapacityEffectProfiles([mixedEntity], effects);
  assert.deepEqual(mixedEntity.positiveCapacityNames, ['Mixed']);
  assert.deepEqual(mixedEntity.negativeCapacityNames, ['Mixed']);

  const rankedAvailability = buildCategoryAnalyses({
    entries: [
      {
        ...entry,
        rule: {
          ...rule,
          numberOfUnitInPack: 8,
          maxPackNumber: 2,
          multipliers: [1, 0.5, 0.25, 0.125],
        },
      },
    ],
    weaponDescriptors: weapons,
    ammunition,
    deckVeterancy: 2,
  });
  assert.equal(rankedAvailability.analyses[0]?.metrics.availability, 4);
  const counts = [999, 555, 333, 1];
  const rendered = ndf.parseList(renderNumberArray(counts.map((count) => count / 999)));
  assert.deepEqual(
    rendered.map((m) => resolvePackCount(999, Number(m.value))),
    counts,
  );

  const lowRank = createEntityAnalysisFactory(weapons, ammunition).analyze({
    ...entry,
    rule: { ...rule, multipliers: [0, 0.25, 0, 0] },
  });
  assert.equal(lowRank.metrics.availability, 10);
  assert.equal(resolvePackProfile({ ...rule, maxPackNumber: 0 }), undefined);
  assert.equal(resolvePackProfile({ ...rule, multipliers: [0, 0, 0, 0] }), undefined);
  assert.equal(resolvePackProfile(rule, 3)?.xp, 3);
  assert.equal(resolvePackProfile({ ...rule, multipliers: [0, 0, 1, 0] }, 3)?.xp, 2);

  const config = createDeckGenerationConfig(
    {
      deckSlotCount: 5,
      unlimitedPackUnitCount: 40,
      staticPackCounts: [7, 4, 0, 1],
      naming: {
        balancedLabel: 'Adaptive',
        description: 'Forces of {label}',
      },
      contextGeneration: { countries: false, coalitions: false, allSides: false },
      customDivisions: {
        EXAMPLE: {
          name: 'Example group',
          unitPatterns: ['Example'],
          divisionName: '{name} / {mode}',
          deckName: 'Ready: {label}',
          description: 'Forces of {divisionName}',
          interfaceOrder: -123,
        },
      },
    },
    'TEST',
    values,
  );
  const [context] = buildDivisionContexts([entity], 'TEST', config);
  assert.ok(context);
  assert.equal(context.code, 'EXAMPLE');
  assert.equal(context.interfaceOrder, -123);
  assert.equal(
    buildGeneratedDivisionName(
      { ...context, nameLabel: '{modTag} group', divisionName: '{name}' },
      'Unlimited',
      'TEST',
      config,
    ),
    'TEST group',
  );
  assert.equal(
    buildGeneratedDeckName(
      { ...context, nameLabel: '{modTag} group', deckName: '{name}' },
      'Unlimited',
      'TEST',
      config,
    ),
    'TEST group',
  );
  assert.equal(
    buildGeneratedDivisionName(context, 'Balanced', 'TEST', config),
    'Example group / Adaptive',
  );
  assert.equal(buildGeneratedDeckName(context, 'Balanced', 'TEST', config), 'Ready: Example group');
  assert.equal(
    buildGeneratedDivisionSummaryText(context, 'StaticBalanced', 'TEST', config),
    'Forces of Example group / Static',
  );
  const genericContext = { ...context };
  delete genericContext.description;
  assert.equal(
    buildGeneratedDivisionSummaryText(genericContext, 'Unlimited', 'TEST', config),
    'Forces of Example group',
  );
  const modeTextConfig = createDeckGenerationConfig(
    {
      deckSlotCount: 5,
      unlimitedPackUnitCount: 40,
      naming: {
        unlimitedDescription: 'Open: {label}',
        balancedDescription: 'Adaptive: {divisionName}',
        staticBalancedDescription: 'Fixed: {mode}',
      },
    },
    'TEST',
    values,
  );
  assert.deepEqual(
    (['Unlimited', 'Balanced', 'StaticBalanced'] as const).map((mode) =>
      buildGeneratedDivisionSummaryText(genericContext, mode, 'TEST', modeTextConfig),
    ),
    ['Open: Example group', 'Adaptive: Example group / Dynamic', 'Fixed: Static'],
  );
  assert.equal(
    buildGeneratedDivisionSummaryText(context, 'StaticBalanced', 'TEST', modeTextConfig),
    'Forces of Example group / Static',
  );
  assert.throws(
    () =>
      buildGeneratedDivisionSummaryText(
        { ...context, description: '{typo}' },
        'Unlimited',
        'TEST',
        config,
      ),
    /Unknown division text placeholder/,
  );
  const [fixed] = buildRuleEntries({
    entities: [entity],
    mode: 'StaticBalanced',
    transportMap: new Map(),
    entityByName: new Map([[entity.name, entity]]),
    balancedRuleFor: createBalancedRuleResolver([entity], new Map()),
    config,
  });
  assert.ok(fixed);
  assert.deepEqual(
    fixed.rule.multipliers.map((m) => Math.round(m * fixed.rule.numberOfUnitInPack)),
    [7, 4, 0, 1],
  );
  for (const invalid of [
    { naming: { description: 123 } },
    { naming: { unlimitedDescription: 123 } },
    { naming: { balancedDescription: 123 } },
    { naming: { staticBalancedDescription: 123 } },
    { staticPackCounts: [0, 0, 0, 0] },
    { staticPackCounts: [3, 2] },
    { deckVeterancy: 4 },
    { customDivisions: { EXAMPLE: { name: 'Broken', unitPatterns: ['X'], interfaceOrder: 1.5 } } },
  ]) {
    assert.throws(() =>
      createDeckGenerationConfig(
        { deckSlotCount: 5, unlimitedPackUnitCount: 40, ...invalid },
        'TEST',
        values,
      ),
    );
  }

  const cheap: EntityData = { ...entity, name: 'Cheap', cost: 10 };
  const command: EntityData = {
    ...entity,
    name: 'Command',
    unitRole: 'hq_inf',
    supplyCapacity: 9999,
    hasSupplyModule: true,
  };
  const commandRoles = buildCategoryAnalyses({
    entries: [entity, command].map((e) => ({ ...entry, entity: e })),
    weaponDescriptors: weapons,
    ammunition,
  }).roleDefinitions;
  const commandRole = commandRoles.find((role) => role.key === 'primary:hq_inf');
  assert.ok(commandRole);
  assert.equal(
    commandRole.focus.supply,
    undefined,
    'A coincident supply capability must not redefine a known command role.',
  );
  const expensive: EntityData = { ...entity, name: 'Expensive', cost: 50 };
  const { analyses } = buildCategoryAnalyses({
    entries: [cheap, expensive].map((e) => ({ ...entry, entity: e })),
    weaponDescriptors: weapons,
    ammunition,
  });
  assert.ok(analyses[0] && analyses[1]);
  assert.ok(
    compareNearDuplicateProfileQuality(analyses[0], analyses[1]) < 0,
    'An otherwise equivalent unit should not cost more.',
  );
  const peers = buildCategoryAnalyses({
    entries: [
      { ...entry, entity: { ...entity, name: 'AlphaExpensive', cost: 50, country: 'FIRST' } },
      { ...entry, entity: { ...entity, name: 'ZuluAffordable', cost: 10, country: 'SECOND' } },
    ],
    weaponDescriptors: weapons,
    ammunition,
  });
  const primary = peers.roleDefinitions.find((role) => role.kind === 'primary');
  assert.ok(primary);
  const choices = buildRoleSelections({
    roleDefinition: primary,
    ...peers,
    context: { ...context, coalition: 'NATO' },
    config,
  });
  assert.equal(choices[0]?.analysis.entity.name, 'ZuluAffordable');
  const passenger = { ...entity, name: 'Passenger', isTransportable: true, cost: 30 };
  const weakCarrier = {
    ...entity,
    name: 'AlphaCarrier',
    factoryType: 'Tanks',
    cost: 10,
    transportableTags: ['infantry'],
    weaponDescriptorNames: ['WeakManager'],
  };
  const strongCarrier = { ...weakCarrier, name: 'ZuluCarrier', weaponDescriptorNames: ['Manager'] };
  const transportConfig = createDeckGenerationConfig(
    {
      deckSlotCount: 5,
      unlimitedPackUnitCount: 10,
      deckForcedUnitPatterns: { sideUnlimited: ['^Passenger$'] },
      deckPolicies: { sideUnlimited: { includeModUnits: true } },
    },
    'TEST',
    values,
  );
  const transportWeapons = new Map(weapons);
  assert.equal(
    compareCountryPreference(
      { ...entity, country: 'FIRST' },
      { ...entity, country: 'SECOND' },
      'NATO',
      transportConfig,
    ),
    0,
  );
  const preferredConfig = createDeckGenerationConfig(
    {
      deckSlotCount: 5,
      unlimitedPackUnitCount: 10,
      deckPreferredCountryIdsByCoalition: { NATO: ['SECOND'] },
    },
    'TEST',
    values,
  );
  assert.ok(
    compareCountryPreference(
      { ...entity, country: 'FIRST' },
      { ...entity, country: 'SECOND' },
      'NATO',
      preferredConfig,
    ) > 0,
  );
  const tiedProfiles = ['FIRST', 'SECOND'].map((country, index) => ({
    ...stationary,
    entity: { ...entity, name: country, country, cost: index === 0 ? 10 : 50 },
    similarityKey: `DistinctProfile${index}`,
  }));
  const tieRole = { ...primary, optionCount: 1 } as const;
  const chooseTiedProfile = (candidates: typeof tiedProfiles) =>
    buildRoleSelections({
      roleDefinition: tieRole,
      analyses: candidates,
      stats: peers.stats,
      context: { ...context, coalition: 'NATO' },
      config: preferredConfig,
    })[0]?.analysis.entity.name;
  assert.equal(
    chooseTiedProfile(tiedProfiles),
    'SECOND',
    'Equal scores prefer the configured country before cost, even across different profiles.',
  );
  assert.equal(
    chooseTiedProfile(
      tiedProfiles.map((analysis) => ({
        ...analysis,
        relativeMetrics: {
          ...analysis.relativeMetrics,
          antiGround:
            analysis.relativeMetrics.antiGround + (analysis.entity.country === 'FIRST' ? 1000 : 0),
        },
      })),
    ),
    'FIRST',
    'A higher score takes precedence over country preference.',
  );
  transportWeapons.set('WeakManager', {
    name: 'WeakManager',
    ammunitionNames: [],
    salves: [],
    mountedWeapons: [],
  });
  const transportCards = buildPremadeCards({
    context: {
      code: 'SIDE_NATO',
      scope: 'side',
      countryId: 'TEST',
      coalition: 'NATO',
      ruleFilter: () => true,
    },
    mode: 'Unlimited',
    ruleEntries: [passenger, weakCarrier, strongCarrier].map((e) => ({
      ...entry,
      entity: e,
      transportNames: e === passenger ? [weakCarrier.name, strongCarrier.name] : [],
    })),
    entityByName: new Map([passenger, weakCarrier, strongCarrier].map((e) => [e.name, e])),
    generatedPacks: new Map(),
    modTag: 'TEST',
    contextCode: 'SIDE_NATO',
    config: transportConfig,
    weaponDescriptors: transportWeapons,
    ammunition,
  });
  assert.equal(
    transportCards.find((card) => card.entity.name === passenger.name)?.transportName,
    'ZuluCarrier',
    'Forced passengers also compare real transport weapons across categories.',
  );
  const coverageBase = transportCards[0];
  assert.ok(coverageBase);
  const coverageCards = [
    {
      ...coverageBase,
      entity: { ...entity, name: 'ExpensiveNominee' },
      forcedInPremade: false,
      similarityKey: 'a',
      similarityVector: [],
      roleKeys: ['capability:smoke_support'],
      coverageRoleKeys: ['capability:smoke_support'],
      keepPriority: 10,
      roleScore: 0,
    },
    {
      ...coverageBase,
      entity: { ...entity, name: 'UsefulCarrier' },
      forcedInPremade: false,
      similarityKey: 'b',
      similarityVector: [],
      roleKeys: ['main:infantry'],
      coverageRoleKeys: ['main:infantry', 'capability:smoke_support'],
      keepPriority: 10000,
      roleScore: 1000,
    },
  ];
  const coverageTrimmed = trimCategoryCards({
    cards: coverageCards,
    limit: 1,
    entityByName: new Map(coverageCards.map((card) => [card.entity.name, card.entity])),
    context: {
      code: 'TEST',
      scope: 'side',
      countryId: 'TEST',
      coalition: 'NATO',
      ruleFilter: () => true,
    },
    config: transportConfig,
  });
  assert.deepEqual(
    coverageTrimmed.map((card) => card.entity.name),
    ['UsefulCarrier'],
    'Coverage follows the real capability, not the original role nominee.',
  );
  const forcedConfig = createDeckGenerationConfig(
    {
      deckSlotCount: 1,
      unlimitedPackUnitCount: 10,
      deckForcedUnitPatterns: { sideUnlimited: ['^(Cheap|Expensive)$'] },
    },
    'TEST',
    values,
  );
  assert.throws(
    () =>
      buildPremadeCards({
        context: {
          code: 'SIDE_NATO',
          scope: 'side',
          countryId: 'TEST',
          coalition: 'NATO',
          ruleFilter: () => true,
        },
        mode: 'Unlimited',
        ruleEntries: [cheap, expensive].map((e) => ({ ...entry, entity: e })),
        entityByName: new Map([
          [cheap.name, cheap],
          [expensive.name, expensive],
        ]),
        generatedPacks: new Map(),
        modTag: 'TEST',
        contextCode: 'SIDE_NATO',
        config: forcedConfig,
        weaponDescriptors: weapons,
        ammunition,
      }),
    /Forced premade cards exceed/,
  );
  return {
    results: [
      {
        name: 'Scoring, parsing, availability and custom presentation regressions',
        status: 'passed',
      },
    ],
  };
};

export default test;
