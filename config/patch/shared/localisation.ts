export interface LocalisationState {
  lines: string[];
  newline: string;
  endedWithNewline: boolean;
  lineIndexByToken: Map<string, number>;
}

interface LocalisationRow {
  token: string;
  refText: string;
}

export function parseLocalisation(content: string): LocalisationState {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const endedWithNewline =
    content.length === 0 ? true : content.endsWith('\r\n') || content.endsWith('\n');
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

  return { lines, newline, endedWithNewline, lineIndexByToken };
}

export function renderLocalisation(state: LocalisationState): string {
  const rendered = state.lines.join(state.newline);
  return state.endedWithNewline || rendered.length > 0 ? `${rendered}${state.newline}` : rendered;
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

export function removeLocalisationRow(state: LocalisationState, token: string): void {
  const lineIndex = state.lineIndexByToken.get(token);
  if (lineIndex === undefined) return;

  state.lines.splice(lineIndex, 1);
  state.lineIndexByToken.delete(token);
  for (const [currentToken, currentIndex] of state.lineIndexByToken) {
    if (currentIndex > lineIndex) state.lineIndexByToken.set(currentToken, currentIndex - 1);
  }
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
