import type { AmmunitionData, EntityData, NdfReaders } from './types.ts';

/** NDF family counts define matrix offsets; neither row numbers nor unit names are stable. */
export function applyDamageResistanceProfiles(
  ammunition: Map<string, AmmunitionData>,
  entities: readonly EntityData[],
  content: string,
  ndf: NdfReaders,
): void {
  const block = ndf
    .findTopLevelBlocks(content)
    .find((entry) => ndf.primaryTypeName(entry.typeName) === 'TGameplayDamageResistanceContainer');
  if (!block)
    throw new Error(
      'DamageResistance.ndf has no damage matrix. Update YSM for your WARNO version; report this output if it still fails.',
    );
  const families = (field: string, prefix: string) => {
    let offset = 0;
    const result = new Map<string, { offset: number; count: number }>();
    for (const entry of ndf.findCollectionEntries(ndf.readField(block.text, field) ?? '[]')) {
      const match = entry.text.match(
        new RegExp(`^\\(\\s*${prefix}_([A-Za-z0-9_]+),\\s*(\\d+)\\s*\\)$`),
      );
      if (!match)
        throw new Error(
          `Invalid ${field} entry in DamageResistance.ndf: ${entry.text}. Check edits to this file, or report this output if it is unchanged.`,
        );
      const count = Number(match[2]);
      result.set(match[1] as string, { offset, count });
      offset += count;
    }
    return { entries: result, size: offset };
  };
  const damage = families('DamageFamilyCounts', 'DamageFamily');
  const resistance = families('ResistanceFamilyCounts', 'ResistanceFamily');
  const rows = ndf
    .findCollectionEntries(ndf.readField(block.text, 'Values') ?? '[]')
    .map((entry) => ndf.parseList(entry.text).map((value) => Number(value.value)));
  if (
    rows.length !== damage.size ||
    rows.some(
      (row) => row.length !== resistance.size || row.some((v) => !Number.isFinite(v) || v < 0),
    )
  ) {
    throw new Error(
      'DamageResistance.ndf has a damage table with the wrong size or invalid values. Check edits to this file, or report this output if it is unchanged.',
    );
  }
  const targets = new Map<string, EntityData['frontResistance'][]>();
  for (const entity of entities) {
    const front = entity.frontResistance;
    if (!front) continue;
    const profile = targets.get(front.family) ?? [];
    if (!profile.some((value) => value?.index === front.index)) profile.push(front);
    targets.set(front.family, profile);
  }
  const armoredTargets = [
    ...new Map(
      entities
        .filter(
          (entity) => entity.frontResistance?.family === 'blindage' && (entity.frontArmor ?? 0) > 0,
        )
        .map((entity) => [
          `${entity.frontResistance?.index}:${entity.topResistance?.family}:${entity.topResistance?.index}`,
          entity,
        ]),
    ).values(),
  ];
  for (const ammo of ammunition.values()) {
    const family = ammo.damageFamily ? damage.entries.get(ammo.damageFamily) : undefined;
    const index = ammo.damageIndex;
    if (!family || index === undefined || index < 1 || index > family.count) {
      throw new Error(
        `Ammunition ${ammo.name} names a damage family or index missing from DamageResistance.ndf. Check its Arme field and damage table; include both in a YSM troubleshooting report if you need help.`,
      );
    }
    // RTTI indices are one-based within each family, including single-row families.
    const row = rows[family.offset + index - 1] as number[];
    const multiplier = (target: EntityData['frontResistance']): number => {
      const family = target ? resistance.entries.get(target.family) : undefined;
      if (!family || !target || target.index < 1 || target.index > family.count) {
        throw new Error(
          `Resistance ${JSON.stringify(target)} is missing from DamageResistance.ndf. Check the unit's resistance values and damage table, or report this output to YSM Community troubleshooting: https://discord.gg/33Sqn6dTjf.`,
        );
      }
      return row[family.offset + target.index - 1] as number;
    };
    const average = (family: string): number => {
      const profiles = targets.get(family) ?? [];
      return profiles.length
        ? profiles.reduce((sum, target) => sum + multiplier(target), 0) / profiles.length
        : 0;
    };
    let armorDamage = 0;
    let armorWeight = 0;
    let armorReach = 0;
    for (const target of armoredTargets) {
      const weight = target.frontArmor ?? 0;
      const hit = multiplier(
        ammo.forceHitTopArmorOnSuccess
          ? (target.topResistance ?? target.frontResistance)
          : target.frontResistance,
      );
      armorDamage += hit * weight;
      armorWeight += weight;
      if (hit > 1) armorReach = Math.max(armorReach, weight);
    }
    ammo.damageMultipliers = {
      ground: average('infanterie'),
      armor: armorWeight > 0 ? armorDamage / armorWeight : 0,
      helo: average('helico'),
      plane: average('avion'),
    };
    // This is armor the weapon can hurt, not the ordinal of an unrelated damage family.
    ammo.armorPenetration = armorReach;
  }
}

/** Fire contributes area denial, not fictitious instant damage for its entire lifetime. */
export function applyPersistentFireProfiles(
  ammunition: Map<string, AmmunitionData>,
  content: string,
  ndf: NdfReaders,
): void {
  const fires = new Map(ndf.findTopLevelBlocks(content).map((block) => [block.name, block.text]));
  for (const ammo of ammunition.values()) {
    if (!ammo.fireDescriptorName) continue;
    const fire = fires.get(ammo.fireDescriptorName);
    const burnName =
      fire &&
      ndf.readFieldDeep(fire, 'AmmunitionForBurn')?.match(/\$\/GFX\/Weapon\/([A-Za-z0-9_]+)/u)?.[1];
    const burn = burnName ? ammunition.get(burnName) : undefined;
    const interval = fire ? Number(ndf.readFieldDeep(fire, 'TimeBetweenBurns')) : 0;
    if (!fire || !burn || !(interval > 0)) {
      throw new Error(
        `Ammunition ${ammo.name} cannot use fire ${ammo.fireDescriptorName}: its fire definition, burn ammunition, or positive TimeBetweenBurns value is missing. Check FireDescriptor.ndf and the ammunition definitions.`,
      );
    }
    ammo.fireDamagePerSecond =
      (Math.max(0, burn.physicalDamages ?? 0) * (burn.damageMultipliers?.ground ?? 1)) / interval;
    ammo.fireRadiusGru = Math.max(0, Number(ndf.readFieldDeep(fire, 'RadiusGRU')) || 0);
    ammo.fireDuration = Math.max(0, Number(ndf.readFieldDeep(fire, 'TimeToLive')) || 0);
  }
}
