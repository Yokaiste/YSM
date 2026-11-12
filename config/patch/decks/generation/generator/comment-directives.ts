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
  return matchesDirectiveHere(lines, index, comment, directives.forceInclude);
}

export function shouldIgnoreEntity(
  lines: string[],
  index: number,
  comment: string,
  directives: CommentDirectives,
): boolean {
  return matchesDirectiveHere(lines, index, comment, directives.ignore);
}

export function matchesIgnoreBelow(comment: string, directives: CommentDirectives): boolean {
  return matchesDirective(comment, directives.everythingBelow);
}

/** A directive counts when it sits on the block's own line or the line right above it. */
function matchesDirectiveHere(
  lines: string[],
  index: number,
  comment: string,
  directive: string,
): boolean {
  if (matchesDirective(comment, directive)) {
    return true;
  }
  const previousLine = index > 0 ? (lines[index - 1] ?? '') : '';
  return matchesDirective(previousLine.split('//').slice(1).join('//'), directive);
}

function matchesDirective(comment: string, directive: string): boolean {
  return normalizeCommentDirectiveValue(comment).includes(
    normalizeCommentDirectiveValue(directive),
  );
}

function normalizeCommentDirectiveValue(value: string): string {
  return value.trim().toLowerCase();
}
