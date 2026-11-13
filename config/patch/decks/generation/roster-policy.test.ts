import assert from 'node:assert/strict';
import type { BuildScriptTest } from 'ymb/api';
import {
  createDeckGenerationConfig,
  shouldIncludeEntityInPremade,
  shouldIncludeEntityInVariant,
} from './generator/config.ts';
import { parseEntities } from './generator/parsers.ts';
import { buildPremadeCards } from './generator/premade.ts';
import { createUnlimitedRule, type DivisionContext } from './generator/types.ts';

const test: BuildScriptTest = ({ tools: { ndf, values } }) => {
  const [base] = parseEntities(
    `Example is TEntityDescriptor(
    MotherCountry = "MOD" Coalition = TWargameCoalition/NATO
    FactoryType = Factory/Infantry UnitRole = 'infantry' MaxPhysicalDamages = 10
  )`,
    'unit',
    ndf,
  );
  assert.ok(base);
  const special = { ...base, name: 'Special', cost: 20 };
  const creature = { ...special, name: 'Creature' };
  const regular = { ...special, name: 'Regular', country: 'NATIVE', isTransportable: true };
  const limited: DivisionContext = {
    code: 'LIMITED',
    scope: 'country',
    countryId: 'NATIVE',
    coalition: 'NATO',
    ruleFilter: (entity) => entity.name === regular.name,
  };
  const policy = {
    deckSlotCount: 5,
    unlimitedPackUnitCount: 10,
    divisionPolicies: {
      default: { includeModUnits: true, includeModSupply: true, modUnitsIgnoreContext: true },
    },
    deckPolicies: { default: { includeModUnits: false, includeModSupply: false } },
    deckIgnoredUnitPatterns: ['^Creature$'],
    deckForcedUnitPatterns: {
      countryUnlimited: ['^Special$'],
      sideUnlimited: ['^Special$'],
      allSideUnlimited: ['^Special$'],
    },
  };
  const config = createDeckGenerationConfig(policy, 'MOD', values);
  for (const scope of ['country', 'side', 'all-side', 'custom'] as const) {
    for (const mode of ['Unlimited', 'Balanced', 'StaticBalanced'] as const) {
      const context = { ...limited, scope };
      for (const entity of [special, creature]) {
        assert.equal(
          shouldIncludeEntityInVariant(entity, context, mode, config),
          true,
          `${scope}/${mode}: mod unit missing from division`,
        );
        if (mode !== 'Unlimited' || entity === creature) {
          assert.equal(
            shouldIncludeEntityInPremade(entity, context, mode, config),
            false,
            `${scope}/${mode}: excluded unit entered premade`,
          );
        }
      }
      assert.equal(shouldIncludeEntityInPremade(regular, context, mode, config), true);
    }
  }
  assert.equal(shouldIncludeEntityInPremade(special, limited, 'Unlimited', config), true);

  const hordeContext = {
    ...limited,
    scope: 'custom' as const,
    ruleFilter: (entity: typeof base) => entity.name === creature.name,
  };
  const hordeConfig = createDeckGenerationConfig(
    {
      deckSlotCount: 5,
      unlimitedPackUnitCount: 10,
    },
    'MOD',
    values,
  );
  assert.equal(
    shouldIncludeEntityInVariant(special, hordeContext, 'Unlimited', hordeConfig),
    false,
  );
  assert.equal(
    shouldIncludeEntityInVariant(creature, hordeContext, 'Unlimited', hordeConfig),
    true,
  );
  assert.equal(
    shouldIncludeEntityInPremade(special, hordeContext, 'Unlimited', hordeConfig),
    false,
  );
  assert.equal(
    shouldIncludeEntityInPremade(creature, hordeContext, 'Unlimited', hordeConfig),
    true,
  );

  const restricted = createDeckGenerationConfig(
    {
      ...policy,
      divisionPolicies: {
        ...policy.divisionPolicies,
        customBalanced: { modUnitsIgnoreContext: false },
        countryBalanced: { ignoredUnitPatterns: ['^Special$'] },
      },
    },
    'MOD',
    values,
  );
  assert.equal(
    shouldIncludeEntityInVariant(special, { ...limited, scope: 'custom' }, 'Balanced', restricted),
    false,
  );
  assert.equal(shouldIncludeEntityInVariant(special, limited, 'Balanced', restricted), false);
  assert.equal(shouldIncludeEntityInVariant(creature, limited, 'Balanced', restricted), true);
  assert.equal(shouldIncludeEntityInVariant(special, limited, 'Unlimited', restricted), true);

  const scoped = createDeckGenerationConfig(
    {
      ...policy,
      deckIgnoredUnitPatterns: [],
      deckPolicies: {
        default: { includeModUnits: true, ignoredUnitPatterns: ['^Creature$'] },
        customUnlimited: { ignoredUnitPatterns: [] },
      },
    },
    'MOD',
    values,
  );
  assert.equal(shouldIncludeEntityInPremade(creature, limited, 'Unlimited', scoped), false);
  assert.equal(shouldIncludeEntityInPremade(creature, hordeContext, 'Unlimited', scoped), true);
  const forced = createDeckGenerationConfig(
    {
      ...policy,
      divisionIgnoredUnitPatterns: ['^Special$'],
      divisionForcedUnitPatterns: { default: ['^Special$'], customBalanced: [] },
    },
    'MOD',
    values,
  );
  assert.equal(
    shouldIncludeEntityInVariant(special, { ...limited, scope: 'custom' }, 'Unlimited', forced),
    true,
  );
  assert.equal(
    shouldIncludeEntityInVariant(special, { ...limited, scope: 'custom' }, 'Balanced', forced),
    false,
  );
  assert.equal(
    shouldIncludeEntityInPremade(special, { ...limited, scope: 'custom' }, 'Unlimited', forced),
    false,
  );

  for (const invalid of [
    { divisionPolicies: { default: { modUnitsIgnoreContext: 'yes' } } },
    { deckPolicies: { customBalanced: { ignoredUnitPatterns: 'Special' } } },
    { divisionForcedUnitPatterns: { default: 'Special' } },
  ]) {
    assert.throws(() => createDeckGenerationConfig({ ...policy, ...invalid }, 'MOD', values));
  }

  const truck = {
    ...special,
    name: 'ModTruck',
    factoryType: 'Tanks',
    cost: 5,
    transportableTags: ['infantry'],
  };
  const ruleEntries = [regular, truck].map((entity) => ({
    entity,
    rule: { ...createUnlimitedRule(5, 10), unitName: entity.name },
    transportNames: entity === regular ? [truck.name] : [],
  }));
  const buildCards = (includeModUnits: boolean) =>
    buildPremadeCards({
      context: limited,
      mode: 'Balanced',
      ruleEntries,
      entityByName: new Map([regular, truck].map((entity) => [entity.name, entity])),
      generatedPacks: new Map(),
      weaponDescriptors: new Map(),
      ammunition: new Map(),
      modTag: 'MOD',
      contextCode: limited.code,
      config: createDeckGenerationConfig(
        {
          ...policy,
          deckPolicies: { countryBalanced: { includeModUnits, includeModSupply: false } },
          deckForcedUnitPatterns: { countryBalanced: ['^Regular$'] },
        },
        'MOD',
        values,
      ),
    });
  const withoutMod = buildCards(false);
  assert.equal(withoutMod.length, 1);
  assert.equal(withoutMod[0]?.entity.name, regular.name);
  assert.equal(
    withoutMod[0]?.transportName,
    undefined,
    'Excluded units must not enter as transports.',
  );
  assert.ok(
    buildCards(true).some(
      (card) => card.entity.name === regular.name && card.transportName === truck.name,
    ),
  );
  assert.deepEqual(
    ruleEntries[0]?.transportNames,
    [truck.name],
    'Premade filtering must preserve division transport choices.',
  );

  return {
    results: [
      {
        name: 'Division availability, scoped policies and premade exclusions are independent',
        status: 'passed',
      },
    ],
  };
};

export default test;
