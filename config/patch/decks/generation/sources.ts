import type { BuildScriptContext } from 'ymb/api';
import type { DeckGenerationInput } from './generator/types.ts';

export const TARGET_PATHS = {
  buildingsContent: 'GameData/Generated/Gameplay/Gfx/BuildingDescriptors.ndf',
  unitsContent: 'GameData/Generated/Gameplay/TacticalUnits.ndf',
  weaponDescriptorsContent: 'GameData/Generated/Gameplay/Gfx/WeaponDescriptor.ndf',
  ammunitionContent: 'GameData/Generated/Gameplay/Gfx/Ammunition.ndf',
  ammunitionMissilesContent: 'GameData/Generated/Gameplay/Gfx/AmmunitionMissiles.ndf',
  damageResistanceContent: 'GameData/Generated/Gameplay/Gfx/DamageResistance.ndf',
  fireDescriptorsContent: 'GameData/Generated/Gameplay/Gfx/FireDescriptor.ndf',
  capacitiesContent: 'GameData/Generated/Gameplay/Gfx/CapaciteList.ndf',
  effectsContent: 'GameData/Generated/Gameplay/Effects/EffetsSurUnite.ndf',
  orderAvailabilityContent: 'GameData/Generated/Gameplay/Gfx/OrderAvailability_Tactic.ndf',
  divisionRulesContent: 'GameData/Generated/Gameplay/Decks/DivisionRules.ndf',
  divisionsContent: 'GameData/Generated/Gameplay/Decks/Divisions.ndf',
  divisionCostMatrixContent: 'GameData/Generated/Gameplay/Decks/DivisionCostMatrix.ndf',
  deckSerializerContent: 'GameData/Generated/Gameplay/Decks/DeckSerializer.ndf',
  deckPacksContent: 'GameData/Generated/Gameplay/Decks/DeckPacks.ndf',
  decksContent: 'GameData/Generated/Gameplay/Decks/Decks.ndf',
} satisfies Record<string, string>;

type DeckGenerationSourceKey = keyof typeof TARGET_PATHS;

type DeckGenerationSourceContext = Pick<
  BuildScriptContext,
  'mod' | 'patch' | 'tools' | 'readTargets' | 'readTarget' | 'variables' | 'readOwnedTextIfExists'
>;

interface TargetValidationRule {
  label: string;
  expectedTopLevelType?: string;
  expectedFragment?: string;
  expectedPattern?: RegExp;
  suggestion: string;
}

type DeckGenerationSources = Pick<
  DeckGenerationInput,
  | 'buildingsContent'
  | 'unitsContent'
  | 'weaponDescriptorsContent'
  | 'ammunitionContent'
  | 'damageResistanceContent'
  | 'fireDescriptorsContent'
  | 'capacitiesContent'
  | 'effectsContent'
  | 'orderAvailabilityContent'
  | 'divisionRulesContent'
  | 'divisionsContent'
  | 'divisionCostMatrixContent'
  | 'deckSerializerContent'
  | 'deckPacksContent'
  | 'decksContent'
  | 'localisationContent'
  | 'persistentStoreContent'
>;

export async function readDeckGenerationSources(
  context: DeckGenerationSourceContext,
  persistentStoreFileName: string,
): Promise<DeckGenerationSources> {
  const [targets, localisationContent, persistentStoreContent] = await Promise.all([
    context.readTargets(Object.values(TARGET_PATHS)),
    context.readTarget(`GameData/Localisation/${context.variables.modRootName}/UNITS.csv`),
    context.readOwnedTextIfExists(persistentStoreFileName),
  ]);

  await context.tools.assert.all([
    {
      name: 'game files are ready for deck generation',
      suggestion:
        'Check the named game file and update YSM. If it still fails, report the error with your WARNO version and selected mods.',
      run: () => validateDeckGenerationTargets(context, targets),
    },
    {
      name: 'unit names are readable',
      suggestion:
        'Keep the localisation script in config/ymb.mod.yaml enabled before building decks.',
      run: () => {
        if (localisationContent.length === 0) {
          return;
        }
        context.tools.assert.textIncludes(localisationContent, ';', {
          reason: 'The unit-name dictionary is not a semicolon-separated CSV file.',
          suggestion:
            'Check the UNITS.csv output from the localisation script and any earlier patches.',
          absolutePath: context.mod.rootPath,
        });
      },
    },
  ]);

  return {
    buildingsContent: readTarget(targets, 'buildingsContent'),
    unitsContent: readTarget(targets, 'unitsContent'),
    weaponDescriptorsContent: readTarget(targets, 'weaponDescriptorsContent'),
    ammunitionContent: [
      readTarget(targets, 'ammunitionContent'),
      readTarget(targets, 'ammunitionMissilesContent'),
    ]
      .filter((content) => content.length > 0)
      .join('\n'),
    capacitiesContent: readTarget(targets, 'capacitiesContent'),
    damageResistanceContent: readTarget(targets, 'damageResistanceContent'),
    fireDescriptorsContent: readTarget(targets, 'fireDescriptorsContent'),
    effectsContent: readTarget(targets, 'effectsContent'),
    orderAvailabilityContent: readTarget(targets, 'orderAvailabilityContent'),
    divisionRulesContent: readTarget(targets, 'divisionRulesContent'),
    divisionsContent: readTarget(targets, 'divisionsContent'),
    divisionCostMatrixContent: readTarget(targets, 'divisionCostMatrixContent'),
    deckSerializerContent: readTarget(targets, 'deckSerializerContent'),
    deckPacksContent: readTarget(targets, 'deckPacksContent'),
    decksContent: readTarget(targets, 'decksContent'),
    localisationContent,
    persistentStoreContent,
  };
}

function readTarget(targets: Record<string, string>, key: DeckGenerationSourceKey): string {
  return targets[TARGET_PATHS[key]] ?? '';
}

function validateDeckGenerationTargets(
  context: DeckGenerationSourceContext,
  targets: Record<string, string>,
): void {
  for (const [key, rule] of Object.entries(TARGET_VALIDATION_RULES) as Array<
    [DeckGenerationSourceKey, TargetValidationRule]
  >) {
    const relativePath = TARGET_PATHS[key];
    const content = readTarget(targets, key);
    context.tools.assert.textPresent(content, {
      reason: `Deck generation needs "${rule.label}", but this file is empty or missing: \`${relativePath}\`.`,
      suggestion: rule.suggestion,
      absolutePath: context.mod.rootPath,
      details: ['Check the game file path and whether your WARNO version includes this data.'],
    });
    if (rule.expectedTopLevelType) {
      context.tools.assert.ok(
        context.tools.ndf
          .findTopLevelBlocks(content)
          .some(
            (block) =>
              context.tools.ndf.primaryTypeName(block.typeName) === rule.expectedTopLevelType,
          ),
        {
          reason: `Deck input "${rule.label}" has no ${rule.expectedTopLevelType} blocks: \`${relativePath}\`.`,
          suggestion: rule.suggestion,
          absolutePath: context.mod.rootPath,
        },
      );
    }
    if (rule.expectedFragment) {
      context.tools.assert.textIncludes(content, rule.expectedFragment, {
        reason: `Deck input "${rule.label}" is missing its expected anchor: \`${relativePath}\`.`,
        suggestion: rule.suggestion,
        absolutePath: context.mod.rootPath,
      });
    }
    if (rule.expectedPattern) {
      context.tools.assert.textMatches(content, rule.expectedPattern, {
        reason: `Deck input "${rule.label}" has an unsupported structure: \`${relativePath}\`.`,
        suggestion: rule.suggestion,
        absolutePath: context.mod.rootPath,
      });
    }
  }
}

const TARGET_VALIDATION_RULES: Record<DeckGenerationSourceKey, TargetValidationRule> = {
  damageResistanceContent: {
    label: 'damage/resistance multipliers',
    expectedTopLevelType: 'TGameplayDamageResistanceContainer',
    suggestion: 'Check DamageResistance.ndf and update YSM for your game version.',
  },
  fireDescriptorsContent: {
    label: 'persistent fire descriptors',
    expectedTopLevelType: 'TEntityDescriptor',
    suggestion: 'Check FireDescriptor.ndf and update YSM for your game version.',
  },
  buildingsContent: {
    label: 'building descriptors',
    expectedTopLevelType: 'TEntityDescriptor',
    suggestion: 'Check BuildingDescriptors.ndf and update YSM for your game version.',
  },
  unitsContent: {
    label: 'unit descriptors',
    expectedTopLevelType: 'TEntityDescriptor',
    suggestion: 'Check TacticalUnits.ndf and update YSM for your game version.',
  },
  weaponDescriptorsContent: {
    label: 'weapon descriptors',
    expectedTopLevelType: 'TWeaponManagerModuleDescriptor',
    suggestion: 'Check WeaponDescriptor.ndf and update YSM for your game version.',
  },
  ammunitionContent: {
    label: 'ammunition descriptors',
    expectedTopLevelType: 'TAmmunitionDescriptor',
    suggestion: 'Check Ammunition.ndf and update YSM for your game version.',
  },
  ammunitionMissilesContent: {
    label: 'missile ammunition descriptors',
    expectedTopLevelType: 'TAmmunitionDescriptor',
    suggestion: 'Check AmmunitionMissiles.ndf and update YSM for your game version.',
  },
  capacitiesContent: {
    label: 'capacity descriptors',
    expectedTopLevelType: 'TCapaciteDescriptor',
    suggestion: 'Check CapaciteList.ndf; deck selection needs the trait effects defined there.',
  },
  effectsContent: {
    label: 'unit effect descriptors',
    expectedTopLevelType: 'TEffectsPackDescriptor',
    suggestion: 'Check EffetsSurUnite.ndf; deck selection needs the unit effects defined there.',
  },
  orderAvailabilityContent: {
    label: 'tactical order availability',
    expectedPattern: /^Descriptor_OrderAvailability_[A-Za-z0-9_]+\s+is\s+\[/m,
    suggestion:
      'Check OrderAvailability_Tactic.ndf so deck selection can find sellable transports.',
  },
  divisionRulesContent: {
    label: 'division rules',
    expectedFragment: 'TDeckUniteRule',
    suggestion: 'Check DivisionRules.ndf and update YSM for your game version.',
  },
  divisionsContent: {
    label: 'division descriptors',
    expectedFragment: 'TDeckDivisionDescriptor',
    suggestion: 'Check Divisions.ndf and update YSM for your game version.',
  },
  divisionCostMatrixContent: {
    label: 'division cost matrices',
    expectedPattern: /^[A-Za-z0-9_]+\s+is\s+MAP\s*$/m,
    suggestion: "Check DivisionCostMatrix.ndf; deck selection needs each division's slot costs.",
  },
  deckSerializerContent: {
    label: 'deck serializer map',
    expectedPattern: /DivisionIds\s*=\s*MAP\s*\[[\s\S]*UnitIds\s*=\s*MAP\s*\[/m,
    suggestion:
      'Check DivisionIds and UnitIds in DeckSerializer.ndf. Keep the identity stores; report a changed game format.',
  },
  deckPacksContent: {
    label: 'deck packs',
    expectedFragment: 'DeckPackDescriptor',
    suggestion: 'Check DeckPacks.ndf and update YSM for your game version.',
  },
  decksContent: {
    label: 'deck descriptors',
    expectedFragment: 'TDeckDescriptor',
    suggestion: 'Check Decks.ndf and update YSM for your game version.',
  },
};
