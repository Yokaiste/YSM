import type { LocalisationRow, LocalisationState } from './types.ts';

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
    if (!row) {
      continue;
    }
    lineIndexByToken.set(row.token, index);
  }

  return {
    lines,
    newline,
    endedWithNewline,
    lineIndexByToken,
  };
}

export function renderLocalisation(localisationState: LocalisationState): string {
  const rendered = localisationState.lines.join(localisationState.newline);
  if (localisationState.endedWithNewline || rendered.length > 0) {
    return `${rendered}${localisationState.newline}`;
  }
  return rendered;
}

export function upsertLocalisationRow(
  localisationState: LocalisationState,
  token: string,
  refText: string,
): void {
  const renderedLine = renderLocalisationLine({ token, refText });
  const lineIndex = localisationState.lineIndexByToken.get(token);
  if (lineIndex !== undefined) {
    localisationState.lines[lineIndex] = renderedLine;
    return;
  }

  localisationState.lineIndexByToken.set(token, localisationState.lines.length);
  localisationState.lines.push(renderedLine);
}

export function removeLocalisationRow(localisationState: LocalisationState, token: string): void {
  const lineIndex = localisationState.lineIndexByToken.get(token);
  if (lineIndex === undefined) {
    return;
  }

  localisationState.lines.splice(lineIndex, 1);
  localisationState.lineIndexByToken.delete(token);
  for (const [currentToken, currentIndex] of localisationState.lineIndexByToken.entries()) {
    if (currentIndex > lineIndex) {
      localisationState.lineIndexByToken.set(currentToken, currentIndex - 1);
    }
  }
}

function parseLocalisationLine(line: string): LocalisationRow | undefined {
  const match = line.match(/^"((?:[^"]|"")*)";"((?:[^"]|"")*)"$/);
  if (!match) {
    return undefined;
  }
  return {
    token: unescapeCsvValue(match[1] ?? ''),
    refText: unescapeCsvValue(match[2] ?? ''),
  };
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
