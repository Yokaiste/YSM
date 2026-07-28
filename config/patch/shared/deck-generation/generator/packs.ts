import { sanitizeIdentifier } from './helpers.ts';
import type { DivisionMode, DivisionRuleData, EntityData, GeneratedPack } from './types.ts';

interface PackProfile {
  xp: number;
  number: number;
  maxUnitCardCount: number;
}

export function resolvePackProfile(rule: DivisionRuleData): PackProfile | undefined {
  const xp = resolvePreferredXp(rule);
  if (xp === undefined) {
    return undefined;
  }
  const number = resolvePackNumber(rule, xp);
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

function resolvePreferredXp(rule: DivisionRuleData): number | undefined {
  for (const xp of [1, 2, 0, 3]) {
    if (resolvePackNumber(rule, xp) > 0) {
      return xp;
    }
  }
  return undefined;
}

function resolvePackNumber(rule: DivisionRuleData, xp: number): number {
  const multiplier = rule.multipliers[xp] ?? 0;
  if (multiplier <= 0) {
    return 0;
  }
  return Math.round(rule.numberOfUnitInPack * multiplier);
}
