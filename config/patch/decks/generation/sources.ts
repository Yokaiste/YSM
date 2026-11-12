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
      name: 'target files still exist and look compatible',
      suggestion:
        'Review the referenced WARNO files and update the deck-generation source paths or parser anchors after the game update.',
      run: () => validateDeckGenerationTargets(context, targets),
    },
    {
      name: 'authored localisation is readable',
      suggestion: 'Keep the mod dictionary initializer enabled before deck generation.',
      run: () => {
        if (localisationContent.length === 0) {
          return;
        }
        context.tools.assert.textIncludes(localisationContent, ';', {
          reason: 'Deck-generation localisation input no longer looks like a CSV file.',
          suggestion: 'Check the dictionary initializer and earlier feature localisation outputs.',
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
      reason: `Required deck-generation source "${rule.label}" was empty or missing: \`${relativePath}\`.`,
      suggestion: rule.suggestion,
      absolutePath: context.mod.rootPath,
      details: ['A WARNO update likely moved, renamed, or removed this file.'],
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
          reason: `Required deck-generation source "${rule.label}" no longer contains ${rule.expectedTopLevelType} blocks: \`${relativePath}\`.`,
          suggestion: rule.suggestion,
          absolutePath: context.mod.rootPath,
        },
      );
    }
    if (rule.expectedFragment) {
      context.tools.assert.textIncludes(content, rule.expectedFragment, {
        reason: `Required deck-generation source "${rule.label}" no longer contains its expected anchor text: \`${relativePath}\`.`,
        suggestion: rule.suggestion,
        absolutePath: context.mod.rootPath,
      });
    }
    if (rule.expectedPattern) {
      context.tools.assert.textMatches(content, rule.expectedPattern, {
        reason: `Required deck-generation source "${rule.label}" no longer matches the expected structure: \`${relativePath}\`.`,
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
    suggestion: 'Update the damage matrix parser or source path for the current game data.',
  },
  fireDescriptorsContent: {
    label: 'persistent fire descriptors',
    expectedTopLevelType: 'TEntityDescriptor',
    suggestion: 'Update the persistent fire parser or source path for the current game data.',
  },
  buildingsContent: {
    label: 'building descriptors',
    expectedTopLevelType: 'TEntityDescriptor',
    suggestion:
      'Update the building descriptor parser or source path so it matches the current `BuildingDescriptors.ndf` layout.',
  },
  unitsContent: {
    label: 'unit descriptors',
    expectedTopLevelType: 'TEntityDescriptor',
    suggestion:
      'Update the unit descriptor parser or source path so it matches the current `TacticalUnits.ndf` layout.',
  },
  weaponDescriptorsContent: {
    label: 'weapon descriptors',
    expectedTopLevelType: 'TWeaponManagerModuleDescriptor',
    suggestion:
      'Update the weapon descriptor parser or source path so it matches the current `WeaponDescriptor.ndf` layout.',
  },
  ammunitionContent: {
    label: 'ammunition descriptors',
    expectedTopLevelType: 'TAmmunitionDescriptor',
    suggestion:
      'Update the ammunition source path or parser so it matches the current `Ammunition.ndf` layout.',
  },
  ammunitionMissilesContent: {
    label: 'missile ammunition descriptors',
    expectedTopLevelType: 'TAmmunitionDescriptor',
    suggestion:
      'Update the missile ammunition source path or parser so it matches the current `AmmunitionMissiles.ndf` layout.',
  },
  capacitiesContent: {
    label: 'capacity descriptors',
    expectedTopLevelType: 'TCapaciteDescriptor',
    suggestion:
      'Update the capacity source path or parser so premade selection can resolve current trait effects.',
  },
  effectsContent: {
    label: 'unit effect descriptors',
    expectedTopLevelType: 'TEffectsPackDescriptor',
    suggestion:
      'Update the effect source path or parser so premade selection can compare trait effects.',
  },
  orderAvailabilityContent: {
    label: 'tactical order availability',
    expectedPattern: /^Descriptor_OrderAvailability_[A-Za-z0-9_]+\s+is\s+\[/m,
    suggestion:
      'Update the order-availability source path or parser so transport sellability can still be detected.',
  },
  divisionRulesContent: {
    label: 'division rules',
    expectedFragment: 'TDeckUniteRule',
    suggestion:
      'Update the division rules parser or source path so it matches the current `DivisionRules.ndf` layout.',
  },
  divisionsContent: {
    label: 'division descriptors',
    expectedFragment: 'TDeckDivisionDescriptor',
    suggestion:
      'Update the division output target or parser assumptions so they match the current `Divisions.ndf` layout.',
  },
  divisionCostMatrixContent: {
    label: 'division cost matrices',
    expectedPattern: /^[A-Za-z0-9_]+\s+is\s+MAP\s*$/m,
    suggestion:
      'Update the cost matrix source path or parser so hidden-unit detection can still read what a division charges.',
  },
  deckSerializerContent: {
    label: 'deck serializer map',
    expectedPattern: /DivisionIds\s*=\s*MAP\s*\[[\s\S]*UnitIds\s*=\s*MAP\s*\[/m,
    suggestion:
      'Update the deck serializer injection logic so it matches the current `DeckSerializer.ndf` map names and formatting.',
  },
  deckPacksContent: {
    label: 'deck packs',
    expectedFragment: 'DeckPackDescriptor',
    suggestion:
      'Update the premade pack output target or parser assumptions so they match the current `DeckPacks.ndf` layout.',
  },
  decksContent: {
    label: 'deck descriptors',
    expectedFragment: 'TDeckDescriptor',
    suggestion:
      'Update the deck output target or parser assumptions so they match the current `Decks.ndf` layout.',
  },
};
