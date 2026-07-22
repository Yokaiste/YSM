import { formatNumber, renderNumberArray } from './generator/helpers.ts';
import { SERIALIZER_ID_LIMITS } from './generator/serializer-ids.ts';
import type {
  GeneratedDivisionVariant,
  GeneratedPack,
  NdfReaders,
  PersistentSerializerState,
} from './generator/types.ts';

export function renderDivisionRulesOutput(
  ndf: NdfReaders,
  content: string,
  divisions: GeneratedDivisionVariant[],
  scriptSourcePath: string,
): string {
  return ndf.upsertGeneratedBlock(
    content,
    renderDivisionRulesBlock(ndf, divisions, scriptSourcePath),
    scriptSourcePath,
  );
}

export function renderDivisionsOutput(
  ndf: NdfReaders,
  content: string,
  divisions: GeneratedDivisionVariant[],
  maxActivationPoints: number,
  scriptSourcePath: string,
  modTag: string,
): string {
  return ndf.upsertGeneratedBlock(
    content,
    renderDivisionsBlock(ndf, divisions, maxActivationPoints, scriptSourcePath, modTag),
    scriptSourcePath,
  );
}

export function renderDeckPacksOutput(
  ndf: NdfReaders,
  content: string,
  packs: GeneratedPack[],
  scriptSourcePath: string,
): string {
  return ndf.upsertGeneratedBlock(
    content,
    renderGeneratedPacksBlock(ndf, packs, scriptSourcePath),
    scriptSourcePath,
  );
}

export function renderDecksOutput(
  ndf: NdfReaders,
  content: string,
  divisions: GeneratedDivisionVariant[],
  scriptSourcePath: string,
): string {
  return ndf.upsertGeneratedBlock(
    content,
    renderDecksBlock(ndf, divisions, scriptSourcePath),
    scriptSourcePath,
  );
}

export function injectDeckSerializerEntries(
  ndf: NdfReaders,
  escapeRegExp: (value: string) => string,
  content: string,
  divisions: GeneratedDivisionVariant[],
  referencedUnitNames: string[],
  scriptSourcePath: string,
  persistentState: PersistentSerializerState,
): string {
  const mergeBaseContent = stripCurrentScriptDeckSerializerBlocks(
    ndf,
    escapeRegExp,
    content,
    scriptSourcePath,
  );
  const allDivisionEntries = parseSerializerEntries(
    content,
    /\((Descriptor_Deck_Division_[A-Za-z0-9_]+),\s*(\d+)\)/g,
    'division',
  );
  const baseDivisionEntries = parseSerializerEntries(
    mergeBaseContent,
    /\((Descriptor_Deck_Division_[A-Za-z0-9_]+),\s*(\d+)\)/g,
    'division',
  );
  const allUnitEntries = parseSerializerEntries(
    content,
    /\(\$\/GFX\/Unit\/([A-Za-z0-9_]+),\s*(\d+)\)/g,
    'unit',
  );
  const baseUnitEntries = parseSerializerEntries(
    mergeBaseContent,
    /\(\$\/GFX\/Unit\/([A-Za-z0-9_]+),\s*(\d+)\)/g,
    'unit',
  );

  const divisionIds = resolvePersistentSerializerIds({
    activeNames: divisions.map((division) => division.descriptorName),
    allEntries: allDivisionEntries,
    baseEntries: baseDivisionEntries,
    storedIds: persistentState.divisionIds,
    nextId: persistentState.nextDivisionId,
    minimumId: SERIALIZER_ID_LIMITS.division.start,
    maximumId: SERIALIZER_ID_LIMITS.division.maximum,
    label: 'division',
  });
  persistentState.nextDivisionId = divisionIds.nextId;
  const unitIds = resolvePersistentSerializerIds({
    activeNames: referencedUnitNames,
    allEntries: allUnitEntries,
    baseEntries: baseUnitEntries,
    storedIds: persistentState.unitIds,
    nextId: persistentState.nextUnitId,
    minimumId: SERIALIZER_ID_LIMITS.unit.start,
    maximumId: SERIALIZER_ID_LIMITS.unit.maximum,
    label: 'unit',
  });
  persistentState.nextUnitId = unitIds.nextId;

  const divisionLines = divisionIds.entries.map(([name, id]) => `        (${name}, ${id}),`);
  const unitLines = unitIds.entries.map(([name, id]) => `        ($/GFX/Unit/${name}, ${id}),`);

  let updated = content;
  updated = injectMapEntries(
    ndf,
    escapeRegExp,
    updated,
    'DivisionIds',
    divisionLines,
    scriptSourcePath,
  );
  updated = injectMapEntries(ndf, escapeRegExp, updated, 'UnitIds', unitLines, scriptSourcePath);
  return updated;
}

function parseSerializerEntries(
  content: string,
  pattern: RegExp,
  label: string,
): Map<string, number> {
  const entries = new Map<string, number>();
  const namesById = new Map<number, string>();
  for (const match of content.matchAll(pattern)) {
    const name = match[1];
    const id = Number(match[2]);
    if (!name || !Number.isSafeInteger(id)) {
      continue;
    }
    const previousId = entries.get(name);
    if (previousId !== undefined && previousId !== id) {
      throw new Error(`DeckSerializer assigns ${label} \`${name}\` to multiple IDs.`);
    }
    const previousName = namesById.get(id);
    if (previousName !== undefined && previousName !== name) {
      throw new Error(
        `DeckSerializer assigns ${label} ID ${id} to both \`${previousName}\` and \`${name}\`.`,
      );
    }
    entries.set(name, id);
    namesById.set(id, name);
  }
  return entries;
}

function resolvePersistentSerializerIds(args: {
  activeNames: string[];
  allEntries: ReadonlyMap<string, number>;
  baseEntries: ReadonlyMap<string, number>;
  storedIds: Record<string, number>;
  nextId: number;
  minimumId: number;
  maximumId: number;
  label: string;
}): { entries: Array<[string, number]>; nextId: number } {
  const usedNamesById = new Map<number, string>();
  for (const [name, id] of args.baseEntries) {
    usedNamesById.set(id, name);
  }
  for (const [name, id] of Object.entries(args.storedIds)) {
    const usedName = usedNamesById.get(id);
    if (usedName !== undefined && usedName !== name) {
      throw new Error(
        `Persistent ${args.label} ID ${id} for \`${name}\` conflicts with DeckSerializer entry \`${usedName}\`.`,
      );
    }
    usedNamesById.set(id, name);
  }

  let nextId = Math.max(
    args.minimumId,
    args.nextId,
    ...Object.values(args.storedIds).map((id) => id + 1),
  );
  const generatedEntries: Array<[string, number]> = [];
  for (const name of [...new Set(args.activeNames)].sort((left, right) =>
    left.localeCompare(right),
  )) {
    if (args.baseEntries.has(name)) {
      continue;
    }
    let id = args.storedIds[name] ?? args.allEntries.get(name);
    if (id === undefined) {
      while (usedNamesById.has(nextId)) {
        nextId += 1;
      }
      if (nextId > args.maximumId) {
        throw new Error(
          `No safe DeckSerializer ${args.label} IDs remain in the reserved range ${args.minimumId}-${args.maximumId}.`,
        );
      }
      id = nextId;
      nextId += 1;
    }
    if (id < args.minimumId || id > args.maximumId) {
      throw new Error(
        `DeckSerializer ${args.label} ID ${id} for \`${name}\` is outside the safe encoded range ${args.minimumId}-${args.maximumId}.`,
      );
    }
    const usedName = usedNamesById.get(id);
    if (usedName !== undefined && usedName !== name) {
      throw new Error(
        `Cannot preserve ${args.label} ID ${id} for \`${name}\`; it is already used by \`${usedName}\`.`,
      );
    }
    args.storedIds[name] = id;
    usedNamesById.set(id, name);
    nextId = Math.max(nextId, id + 1);
    generatedEntries.push([name, id]);
  }

  return { entries: generatedEntries, nextId: Math.max(nextId, args.nextId) };
}

function renderDivisionRulesBlock(
  ndf: NdfReaders,
  divisions: GeneratedDivisionVariant[],
  scriptSourcePath: string,
): string {
  const renderedRuleNames = new Set<string>();
  return ndf.renderGeneratedBlock({
    ownerId: scriptSourcePath,
    title: 'Generated division rules',
    sourcePath: scriptSourcePath,
    blocks: divisions.flatMap((division) => {
      if (renderedRuleNames.has(division.ruleName)) {
        return [];
      }
      renderedRuleNames.add(division.ruleName);
      return [
        [
          `export ${division.ruleName} is TDeckDivisionRule`,
          '(',
          '    UnitRuleList =',
          '    [',
          division.ruleEntries.map((entry) => renderDivisionRuleEntry(entry)).join(',\n'),
          '    ]',
          ')',
        ].join('\n'),
      ];
    }),
  });
}

function renderDivisionsBlock(
  ndf: NdfReaders,
  divisions: GeneratedDivisionVariant[],
  maxActivationPoints: number,
  scriptSourcePath: string,
  modTag: string,
): string {
  return ndf.renderGeneratedBlock({
    ownerId: scriptSourcePath,
    title: 'Generated divisions',
    sourcePath: scriptSourcePath,
    blocks: divisions.map((division) =>
      renderDivisionDescriptor(division, maxActivationPoints, modTag),
    ),
  });
}

function renderGeneratedPacksBlock(
  ndf: NdfReaders,
  packs: GeneratedPack[],
  scriptSourcePath: string,
): string {
  return ndf.renderGeneratedBlock({
    ownerId: scriptSourcePath,
    title: 'Generated premade deck packs',
    sourcePath: scriptSourcePath,
    blocks: packs
      .sort((left, right) => left.descriptorName.localeCompare(right.descriptorName))
      .map((pack) => renderGeneratedPack(pack)),
  });
}

function renderDecksBlock(
  ndf: NdfReaders,
  divisions: GeneratedDivisionVariant[],
  scriptSourcePath: string,
): string {
  return ndf.renderGeneratedBlock({
    ownerId: scriptSourcePath,
    title: 'Generated premade decks',
    sourcePath: scriptSourcePath,
    blocks: divisions.map((division) => renderDeckDescriptor(division)),
  });
}

function renderDivisionRuleEntry(entry: GeneratedDivisionVariant['ruleEntries'][number]): string {
  const transportLines =
    entry.transportNames.length > 0
      ? `\n        AvailableTransportList = [ ${entry.transportNames
          .map((transportName) => `$/GFX/Unit/${transportName}`)
          .join(', ')} ]`
      : '';

  return [
    '        TDeckUniteRule',
    '        (',
    `            UnitDescriptor = $/GFX/Unit/${entry.entity.name}`,
    `            AvailableWithoutTransport = True${transportLines}`,
    `            MaxPackNumber = ${entry.rule.maxPackNumber}`,
    `            NumberOfUnitInPack = ${entry.rule.numberOfUnitInPack}`,
    `            NumberOfUnitInPackXPMultiplier = ${renderNumberArray(entry.rule.multipliers)}`,
    '        )',
  ].join('\n');
}

function renderDivisionDescriptor(
  division: GeneratedDivisionVariant,
  maxActivationPoints: number,
  modTag: string,
): string {
  return [
    `export ${division.descriptorName} is TDeckDivisionDescriptor`,
    '(',
    `    DescriptorId = GUID:{${division.guid}}`,
    `    CfgName = '${division.cfgName}'`,
    `    DivisionName = '${division.divisionNameToken}'`,
    `    InterfaceOrder = ${formatNumber(division.interfaceOrder)}`,
    `    DivisionCoalition = TWargameCoalition/${division.context.coalition}`,
    `    DivisionTags = [${division.tags.map((tag) => `'${tag}'`).join(', ')}]`,
    `    MaxActivationPoints = ${Math.trunc(maxActivationPoints)}`,
    `    DivisionRule = ${division.ruleName}`,
    `    CostMatrix = MatrixCostName_${modTag}`,
    `    EmblemTexture     = "${division.emblemTexture}"`,
    `    TypeToken        = "${modTag}"`,
    `    CountryId = "${division.context.countryId}"`,
    renderStandoutUnits(division.standoutUnits),
    ')',
  ].join('\n');
}

function renderStandoutUnits(unitNames: string[]): string {
  if (unitNames.length === 0) {
    return ['    StandoutUnits =', '    []'].join('\n');
  }

  return [
    '    StandoutUnits =',
    '    [',
    unitNames.map((unitName) => `        $/GFX/Unit/${unitName},`).join('\n'),
    '    ]',
  ].join('\n');
}

function renderGeneratedPack(pack: GeneratedPack): string {
  return [
    `${pack.descriptorName} is DeckPackDescriptor`,
    '(',
    ...(pack.xp > 0 ? [`    Xp = ${pack.xp}`] : []),
    ...(pack.transportName ? [`    Transport = $/GFX/Unit/${pack.transportName}`] : []),
    `    Unit = $/GFX/Unit/${pack.unitName}`,
    `    Number = ${pack.number}`,
    ')',
  ].join('\n');
}

function renderDeckDescriptor(division: GeneratedDivisionVariant): string {
  return [
    `export ${division.deckDescriptorName} is TDeckDescriptor`,
    '(',
    `    DeckDivision = $/GFX/Division/${division.descriptorName}`,
    `    DeckName = "${division.deckNameToken}"`,
    '    DeckPackList =',
    '    [',
    division.premadeCards.map((card) => `        ~/${card.packDescriptorName},`).join('\n'),
    '    ]',
    ')',
  ].join('\n');
}

function injectMapEntries(
  ndf: NdfReaders,
  escapeRegExp: (value: string) => string,
  content: string,
  mapName: string,
  entryLines: string[],
  scriptSourcePath: string,
): string {
  const pattern = new RegExp(`(${mapName}\\s*=\\s*MAP\\s*\\[)([\\s\\S]*?)(\\n\\s*\\])`);
  const match = content.match(pattern);
  if (!match) {
    return content;
  }

  const start = match[1] ?? '';
  const body = match[2] ?? '';
  const end = match[3] ?? '';
  const blockId = buildDeckSerializerBlockId(scriptSourcePath, mapName);
  const markers = ndf.generatedBlockMarkers(blockId);
  const startMarker = `        ${markers.start}`;
  const endMarker = `        ${markers.end}`;
  const blockPattern = new RegExp(
    `${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}`,
  );
  const generatedBlock =
    entryLines.length > 0
      ? [startMarker, `        // Source: ${scriptSourcePath}`, ...entryLines, endMarker].join('\n')
      : '';

  if (blockPattern.test(body)) {
    const replacedBody = generatedBlock
      ? body.replace(blockPattern, generatedBlock)
      : body.replace(blockPattern, '');
    return content.replace(pattern, `${start}${replacedBody}${end}`);
  }

  const trimmedBody = body.trimEnd();
  if (!generatedBlock) {
    return content;
  }
  const nextBody = trimmedBody ? `${trimmedBody}\n${generatedBlock}` : `\n${generatedBlock}`;
  return content.replace(pattern, `${start}${nextBody}${end}`);
}

function stripCurrentScriptDeckSerializerBlocks(
  ndf: NdfReaders,
  escapeRegExp: (value: string) => string,
  content: string,
  scriptSourcePath: string,
): string {
  return ['DivisionIds', 'UnitIds'].reduce((current, mapName) => {
    const blockId = buildDeckSerializerBlockId(scriptSourcePath, mapName);
    const markers = ndf.generatedBlockMarkers(blockId);
    const startMarker = `        ${markers.start}`;
    const endMarker = `        ${markers.end}`;
    const blockPattern = new RegExp(
      `${escapeRegExp(startMarker)}[\\s\\S]*?${escapeRegExp(endMarker)}\\r?\\n?`,
      'g',
    );
    return current.replace(blockPattern, '');
  }, content);
}

function buildDeckSerializerBlockId(scriptSourcePath: string, mapName: string): string {
  return `${scriptSourcePath} | DeckSerializer:${mapName}`;
}
