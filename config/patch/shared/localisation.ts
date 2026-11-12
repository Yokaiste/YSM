import type { BuildScriptContext } from 'ymb/api';

export interface LocalisationState {
  lines: string[];
  newline: string;
  lineIndexByToken: Map<string, number>;
}

interface LocalisationRow {
  token: string;
  refText: string;
}

/** Features contribute their own text to WARNO's shared dictionaries. */
export async function mergeFeatureLocalisation(
  context: Pick<BuildScriptContext, 'tools' | 'variables' | 'readTarget' | 'readOwnedTextIfExists'>,
  dictionary: 'UNITS' | 'INTERFACE_OUTGAME',
) {
  const targetRelativePath = `GameData/Localisation/${context.variables.modRootName}/${dictionary}.csv`;
  const [current, source] = await Promise.all([
    context.readTarget(targetRelativePath),
    context.readOwnedTextIfExists('localisation.csv'),
  ]);
  context.tools.assert.textPresent(source, {
    reason: 'Missing feature localisation.csv.',
    suggestion: 'Restore the authored translation file beside the patch.',
  });
  const modTag = context.tools.values.string(context.variables.modTag, 'modTag');
  const state = parseLocalisation(current);
  for (const line of source.replaceAll('${modTag}', modTag).split(/\r?\n/)) {
    if (!line.trim()) continue;
    const row = parseLocalisationLine(line);
    context.tools.assert.ok(row, {
      reason: 'Invalid row in feature localisation.csv.',
      suggestion: 'Use two quoted CSV fields separated by a semicolon; double embedded quotes.',
      details: [line],
    });
    if (row.token !== 'TOKEN') upsertLocalisationRow(state, row.token, row.refText);
  }
  return [{ targetRelativePath, content: renderLocalisation(state) }];
}

export function parseLocalisation(content: string): LocalisationState {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const normalized = content.replaceAll('\r\n', '\n');
  const lines = normalized.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  if (lines.length === 0) {
    lines.push('"TOKEN";"REFTEXT"');
  }

  const lineIndexByToken = new Map<string, number>();
  for (const [index, line] of lines.entries()) {
    const row = parseLocalisationLine(line);
    if (row) lineIndexByToken.set(row.token, index);
  }

  return { lines, newline, lineIndexByToken };
}

export function renderLocalisation(state: LocalisationState): string {
  return `${state.lines.join(state.newline)}${state.newline}`;
}

export function upsertLocalisationRow(
  state: LocalisationState,
  token: string,
  refText: string,
): void {
  const renderedLine = renderLocalisationLine({ token, refText });
  const lineIndex = state.lineIndexByToken.get(token);
  if (lineIndex !== undefined) {
    state.lines[lineIndex] = renderedLine;
    return;
  }

  state.lineIndexByToken.set(token, state.lines.length);
  state.lines.push(renderedLine);
}

export function removeLocalisationRows(
  state: LocalisationState,
  tokens: ReadonlySet<string>,
): void {
  if (tokens.size === 0) return;
  state.lineIndexByToken.clear();
  const lines: string[] = [];
  for (const line of state.lines) {
    const row = parseLocalisationLine(line);
    if (row && tokens.has(row.token)) continue;
    if (row) state.lineIndexByToken.set(row.token, lines.length);
    lines.push(line);
  }
  state.lines = lines;
}

function parseLocalisationLine(line: string): LocalisationRow | undefined {
  const match = line.match(/^"((?:[^"]|"")*)";"((?:[^"]|"")*)"$/);
  if (!match) return undefined;
  return { token: unescapeCsvValue(match[1] ?? ''), refText: unescapeCsvValue(match[2] ?? '') };
}

function renderLocalisationLine(row: LocalisationRow): string {
  return `"${escapeCsvValue(row.token)}";"${escapeCsvValue(row.refText)}"`;
}

function escapeCsvValue(value: string): string {
  return value
    .replaceAll('\r\n', '\\n')
    .replaceAll('\r', '\\n')
    .replaceAll('\n', '\\n')
    .replaceAll('"', '""');
}

function unescapeCsvValue(value: string): string {
  return value.replaceAll('""', '"');
}
