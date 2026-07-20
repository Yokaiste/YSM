import type { BuildScriptContext } from '../../../../../../src/types.ts';
import type { DeckGenerationInput } from './generator/types.ts';

const TARGET_PATHS = {
  buildingsContent: 'GameData/Generated/Gameplay/Gfx/BuildingDescriptors.ndf',
  unitsContent: 'GameData/Generated/Gameplay/Gfx/UniteDescriptor.ndf',
  weaponDescriptorsContent: 'GameData/Generated/Gameplay/Gfx/WeaponDescriptor.ndf',
  ammunitionContent: 'GameData/Generated/Gameplay/Gfx/Ammunition.ndf',
  ammunitionMissilesContent: 'GameData/Generated/Gameplay/Gfx/AmmunitionMissiles.ndf',
  capacitiesContent: 'GameData/Generated/Gameplay/Gfx/CapaciteList.ndf',
  effectsContent: 'GameData/Generated/Gameplay/Effects/EffetsSurUnite.ndf',
  orderAvailabilityContent: 'GameData/Generated/Gameplay/Gfx/OrderAvailability_Tactic.ndf',
  divisionRulesContent: 'GameData/Generated/Gameplay/Decks/DivisionRules.ndf',
  divisionsContent: 'GameData/Generated/Gameplay/Decks/Divisions.ndf',
  deckSerializerContent: 'GameData/Generated/Gameplay/Decks/DeckSerializer.ndf',
  deckPacksContent: 'GameData/Generated/Gameplay/Decks/DeckPacks.ndf',
  decksContent: 'GameData/Generated/Gameplay/Decks/Decks.ndf',
} satisfies Record<string, string>;

type DeckGenerationSourceKey = keyof typeof TARGET_PATHS;

type DeckGenerationSourceContext = Pick<
  BuildScriptContext,
  'mod' | 'patch' | 'tools' | 'readTargets' | 'readModTextIfExists' | 'readOwnedTextIfExists'
>;

interface TargetValidationRule {
  label: string;
  relativePath: string;
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
  | 'capacitiesContent'
  | 'effectsContent'
  | 'orderAvailabilityContent'
  | 'divisionRulesContent'
  | 'divisionsContent'
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
    context.readModTextIfExists('replace/GameData/Localisation/${modRootName}/UNITS.csv'),
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
      name: 'localisation file is writable',
      suggestion:
        'Restore or recreate `replace/GameData/Localisation/${modRootName}/UNITS.csv` if this script should preserve existing localisation rows.',
      run: () => {
        if (localisationContent.length === 0) {
          return;
        }
        context.tools.assert.textIncludes(localisationContent, ';', {
          reason: 'Deck-generation localisation input no longer looks like a CSV file.',
          suggestion:
            'Open `replace/GameData/Localisation/${modRootName}/UNITS.csv` and restore the expected CSV format.',
          absolutePath: context.mod.absolutePath,
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
    effectsContent: readTarget(targets, 'effectsContent'),
    orderAvailabilityContent: readTarget(targets, 'orderAvailabilityContent'),
    divisionRulesContent: readTarget(targets, 'divisionRulesContent'),
    divisionsContent: readTarget(targets, 'divisionsContent'),
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
    const content = readTarget(targets, key);
    context.tools.assert.textPresent(content, {
      reason: `Required deck-generation source "${rule.label}" was empty or missing: \`${rule.relativePath}\`.`,
      suggestion: rule.suggestion,
      absolutePath: context.mod.absolutePath,
      details: ['A WARNO update likely moved, renamed, or removed this file.'],
    });
    if (rule.expectedTopLevelType) {
      assertContainsTopLevelType(context, content, {
        ...rule,
        expectedTopLevelType: rule.expectedTopLevelType,
      });
    }
    if (rule.expectedFragment) {
      context.tools.assert.textIncludes(content, rule.expectedFragment, {
        reason: `Required deck-generation source "${rule.label}" no longer contains its expected anchor text: \`${rule.relativePath}\`.`,
        suggestion: rule.suggestion,
        absolutePath: context.mod.absolutePath,
      });
    }
    if (rule.expectedPattern) {
      context.tools.assert.textMatches(content, rule.expectedPattern, {
        reason: `Required deck-generation source "${rule.label}" no longer matches the expected structure: \`${rule.relativePath}\`.`,
        suggestion: rule.suggestion,
        absolutePath: context.mod.absolutePath,
      });
    }
  }
}

function assertContainsTopLevelType(
  context: DeckGenerationSourceContext,
  content: string,
  rule: TargetValidationRule & { expectedTopLevelType: string },
): void {
  const matchingBlocks = context.tools.ndf
    .findTopLevelBlocks(content)
    .filter(
      (block) => context.tools.ndf.primaryTypeName(block.typeName) === rule.expectedTopLevelType,
    );
  context.tools.assert.textPresent(matchingBlocks.length > 0 ? 'ok' : '', {
    reason: `Required deck-generation source "${rule.label}" no longer contains ${rule.expectedTopLevelType} blocks: \`${rule.relativePath}\`.`,
    suggestion: rule.suggestion,
    absolutePath: context.mod.absolutePath,
  });
}

const TARGET_VALIDATION_RULES: Record<DeckGenerationSourceKey, TargetValidationRule> = {
  buildingsContent: {
    label: 'building descriptors',
    relativePath: TARGET_PATHS.buildingsContent,
    expectedTopLevelType: 'TEntityDescriptor',
    suggestion:
      'Update the building descriptor parser or source path so it matches the current `BuildingDescriptors.ndf` layout.',
  },
  unitsContent: {
    label: 'unit descriptors',
    relativePath: TARGET_PATHS.unitsContent,
    expectedTopLevelType: 'TEntityDescriptor',
    suggestion:
      'Update the unit descriptor parser or source path so it matches the current `UniteDescriptor.ndf` layout.',
  },
  weaponDescriptorsContent: {
    label: 'weapon descriptors',
    relativePath: TARGET_PATHS.weaponDescriptorsContent,
    expectedTopLevelType: 'TWeaponManagerModuleDescriptor',
    suggestion:
      'Update the weapon descriptor parser or source path so it matches the current `WeaponDescriptor.ndf` layout.',
  },
  ammunitionContent: {
    label: 'ammunition descriptors',
    relativePath: TARGET_PATHS.ammunitionContent,
    expectedTopLevelType: 'TAmmunitionDescriptor',
    suggestion:
      'Update the ammunition source path or parser so it matches the current `Ammunition.ndf` layout.',
  },
  ammunitionMissilesContent: {
    label: 'missile ammunition descriptors',
    relativePath: TARGET_PATHS.ammunitionMissilesContent,
    expectedTopLevelType: 'TAmmunitionDescriptor',
    suggestion:
      'Update the missile ammunition source path or parser so it matches the current `AmmunitionMissiles.ndf` layout.',
  },
  capacitiesContent: {
    label: 'capacity descriptors',
    relativePath: TARGET_PATHS.capacitiesContent,
    expectedTopLevelType: 'TCapaciteDescriptor',
    suggestion:
      'Update the capacity source path or parser so premade selection can resolve current trait effects.',
  },
  effectsContent: {
    label: 'unit effect descriptors',
    relativePath: TARGET_PATHS.effectsContent,
    expectedTopLevelType: 'TEffectsPackDescriptor',
    suggestion:
      'Update the effect source path or parser so premade selection can compare trait effects.',
  },
  orderAvailabilityContent: {
    label: 'tactical order availability',
    relativePath: TARGET_PATHS.orderAvailabilityContent,
    expectedPattern: /^Descriptor_OrderAvailability_[A-Za-z0-9_]+\s+is\s+\[/m,
    suggestion:
      'Update the order-availability source path or parser so transport sellability can still be detected.',
  },
  divisionRulesContent: {
    label: 'division rules',
    relativePath: TARGET_PATHS.divisionRulesContent,
    expectedFragment: 'TDeckUniteRule',
    suggestion:
      'Update the division rules parser or source path so it matches the current `DivisionRules.ndf` layout.',
  },
  divisionsContent: {
    label: 'division descriptors',
    relativePath: TARGET_PATHS.divisionsContent,
    expectedFragment: 'TDeckDivisionDescriptor',
    suggestion:
      'Update the division output target or parser assumptions so they match the current `Divisions.ndf` layout.',
  },
  deckSerializerContent: {
    label: 'deck serializer map',
    relativePath: TARGET_PATHS.deckSerializerContent,
    expectedPattern: /DivisionIds\s*=\s*MAP\s*\[[\s\S]*UnitIds\s*=\s*MAP\s*\[/m,
    suggestion:
      'Update the deck serializer injection logic so it matches the current `DeckSerializer.ndf` map names and formatting.',
  },
  deckPacksContent: {
    label: 'deck packs',
    relativePath: TARGET_PATHS.deckPacksContent,
    expectedFragment: 'DeckPackDescriptor',
    suggestion:
      'Update the premade pack output target or parser assumptions so they match the current `DeckPacks.ndf` layout.',
  },
  decksContent: {
    label: 'deck descriptors',
    relativePath: TARGET_PATHS.decksContent,
    expectedFragment: 'TDeckDescriptor',
    suggestion:
      'Update the deck output target or parser assumptions so they match the current `Decks.ndf` layout.',
  },
};
