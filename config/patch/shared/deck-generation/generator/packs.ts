import { sanitizeIdentifier } from './helpers.ts';
import type { DivisionMode, DivisionRuleData, EntityData, GeneratedPack } from './types.ts';

interface PackProfile {
  xp: number;
  number: number;
  maxUnitCardCount: number;
}

export function resolvePackProfile(rule: DivisionRuleData): PackProfile | undefined {
  const xp = resolvePreferredXp(rule);
  const number = resolvePackNumber(rule, xp);
  if (number <= 0) {
    return undefined;
  }
  return {
    xp,
    number,
    maxUnitCardCount: Math.max(1, rule.maxPackNumber),
  };
}

export function ensureGeneratedPackDescriptor(args: {
  entity: EntityData;
  transportName?: string;
  mode: DivisionMode;
  generatedPacks: Map<string, GeneratedPack>;
  modTag: string;
  contextCode: string;
  xp: number;
  number: number;
}): string {
  const { entity, transportName, mode, generatedPacks, modTag, contextCode, xp, number } = args;
  const descriptorName = [
    'Descriptor_Deck_Pack',
    sanitizeIdentifier(modTag),
    contextCode,
    sanitizeIdentifier(entity.name.replace(/^Descriptor_Unit_/, '')),
    transportName
      ? sanitizeIdentifier(transportName.replace(/^Descriptor_Unit_/, ''))
      : 'NoTransport',
    mode === 'Unlimited' ? 'UNL' : 'BAL',
    xp,
    number,
  ].join('_');
  const generatedPack = generatedPacks.get(descriptorName);
  if (generatedPack) {
    return generatedPack.descriptorName;
  }

  generatedPacks.set(descriptorName, {
    descriptorName,
    unitName: entity.name,
    xp,
    number,
    ...(transportName ? { transportName } : {}),
  });
  return descriptorName;
}

function resolvePreferredXp(rule: DivisionRuleData): number {
  for (const xp of [1, 2, 0, 3]) {
    if ((rule.multipliers[xp] ?? 0) > 0) {
      return xp;
    }
  }
  return 1;
}

function resolvePackNumber(rule: DivisionRuleData, xp: number): number {
  const multiplier = rule.multipliers[xp] ?? 0;
  if (multiplier <= 0) {
    return Math.max(1, rule.numberOfUnitInPack);
  }
  const resolved = Math.round(rule.numberOfUnitInPack * multiplier);
  return resolved > 0 ? resolved : rule.numberOfUnitInPack;
}
