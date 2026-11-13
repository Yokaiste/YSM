import type { BuildScriptContext, BuildScriptNdfTools } from 'ymb/api';

export function findDuplicateModules(
  ndf: BuildScriptNdfTools,
  content: string,
  matches: (name: string) => boolean,
  weaponTypes: ReadonlyMap<string, string> = new Map(),
): string[] {
  const blocks = ndf.findTopLevelBlocks(content);
  const localTypes = new Map(blocks.map((block) => [block.name, block.typeName]));
  const duplicates: string[] = [];
  for (const block of blocks) {
    if (!matches(block.name ?? '')) continue;
    const modules = ndf.readField(block.text, 'ModulesDescriptors');
    if (!modules) continue;
    const seen = new Set<string>();
    for (const entry of ndf.findCollectionEntries(ndf.stripComments(modules))) {
      const reference = entry.text.trim();
      const type =
        entry.typeName ??
        (reference.startsWith('~/')
          ? localTypes.get(reference.slice(2))
          : weaponTypes.get(reference));
      const key = type ? ndf.primaryTypeName(type) : reference;
      if (seen.has(key)) duplicates.push(`${block.name}: ${key}`);
      seen.add(key);
    }
  }
  return duplicates;
}

export async function validateEntityModules(
  context: BuildScriptContext,
  files: readonly string[],
  matches: (name: string) => boolean,
) {
  const weapons = await context.readTarget('GameData/Generated/Gameplay/Gfx/WeaponDescriptor.ndf');
  const weaponTypes = new Map(
    context.tools.ndf
      .findTopLevelBlocks(weapons)
      .filter((block) => block.name)
      .map((block) => [`$/GFX/Weapon/${block.name}`, block.typeName]),
  );
  const contents = await context.readTargets([...files]);
  const duplicates = Object.values(contents).flatMap((content) =>
    findDuplicateModules(context.tools.ndf, content, matches, weaponTypes),
  );
  context.tools.assert.ok(duplicates.length === 0, {
    reason: 'Generated units or buildings contain duplicate modules.',
    suggestion:
      'If you edited their scripts, remove the inherited module before adding its replacement. Otherwise report this output to YSM Community troubleshooting: https://discord.gg/33Sqn6dTjf.',
    details: duplicates,
  });
}
