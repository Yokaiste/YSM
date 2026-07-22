export interface CommentDirectives {
  ignore: string;
  everythingBelow: string;
  forceInclude: string;
}

export function normalizeCommentDirectives(
  directives: Partial<CommentDirectives> | undefined,
): CommentDirectives {
  const normalized = {
    ignore: normalizeCommentDirectiveValue(directives?.ignore ?? 'ysm-ignore'),
    everythingBelow: normalizeCommentDirectiveValue(
      directives?.everythingBelow ?? 'ysm-ignore-everything-below',
    ),
    forceInclude: normalizeCommentDirectiveValue(directives?.forceInclude ?? 'ysm-force-include'),
  };
  const entries = Object.entries(normalized);
  const emptyEntry = entries.find(([, value]) => value.length === 0);
  if (emptyEntry) {
    throw new Error(`Comment directive \`${emptyEntry[0]}\` must not be empty.`);
  }
  if (new Set(entries.map(([, value]) => value)).size !== entries.length) {
    throw new Error('Comment directives must use distinct values.');
  }
  return normalized;
}

export function shouldForceIncludeEntity(
  lines: string[],
  index: number,
  comment: string,
  directives: CommentDirectives,
): boolean {
  if (matchesForceIncludeEntity(comment, directives)) {
    return true;
  }

  const previousLine = index > 0 ? (lines[index - 1] ?? '') : '';
  const previousComment = previousLine.split('//').slice(1).join('//').trim();
  return matchesForceIncludeEntity(previousComment, directives);
}

export function shouldIgnoreEntity(
  lines: string[],
  index: number,
  comment: string,
  directives: CommentDirectives,
): boolean {
  if (matchesIgnoreEntity(comment, directives)) {
    return true;
  }

  const previousLine = index > 0 ? (lines[index - 1] ?? '') : '';
  const previousComment = previousLine.split('//').slice(1).join('//').trim();
  return matchesIgnoreEntity(previousComment, directives);
}

export function matchesIgnoreBelow(comment: string, directives: CommentDirectives): boolean {
  const receivedLine = normalizeCommentDirectiveValue(comment);
  const configuredExpectedLine = normalizeCommentDirectiveValue(directives.everythingBelow);
  return receivedLine.includes(configuredExpectedLine);
}

function matchesIgnoreEntity(comment: string, directives: CommentDirectives): boolean {
  const expectedLine = normalizeCommentDirectiveValue(directives.ignore);
  const receivedLine = normalizeCommentDirectiveValue(comment);
  return receivedLine.includes(expectedLine);
}

function matchesForceIncludeEntity(comment: string, directives: CommentDirectives): boolean {
  const expectedLine = normalizeCommentDirectiveValue(directives.forceInclude);
  const receivedLine = normalizeCommentDirectiveValue(comment);
  return receivedLine.includes(expectedLine);
}

function normalizeCommentDirectiveValue(value: string): string {
  return value.trim().toLowerCase();
}
