import type { DiffFile, DiffLine } from '@diffity/parser';
import { getFilePath } from './diff-utils';

/** One searchable line. `scope` is the file (`data-find-scope`), `key` the rendered line (`data-find-line`). */
export interface FindLine {
  scope: string;
  key: string;
  text: string;
}

export interface FindMatch {
  /** Index into the searched lines. */
  line: number;
  scope: string;
  key: string;
  start: number;
  end: number;
}

export interface FindResult {
  matches: FindMatch[];
  truncated: boolean;
}

export const FIND_MATCH_LIMIT = 5000;

/** Deleted lines are keyed by their old number, the rest by their new one, like the syntax map. */
export function diffLineKey(line: DiffLine): string {
  return `${line.type}-${line.type === 'delete' ? line.oldLineNumber : line.newLineNumber}`;
}

/** Every hunk line of every file in diff order, whether the file is rendered or not. */
export function diffFindLines(files: DiffFile[]): FindLine[] {
  const lines: FindLine[] = [];
  for (const file of files) {
    const scope = getFilePath(file);
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        lines.push({ scope, key: diffLineKey(line), text: line.content });
      }
    }
  }
  return lines;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const lowered = new WeakMap<FindLine, string>();

function lowerText(line: FindLine): string {
  let lower = lowered.get(line);
  if (lower === undefined) {
    lower = line.text.toLowerCase();
    lowered.set(line, lower);
  }
  return lower;
}

/** Plain text search, case-insensitive unless asked, stopping at `limit` matches. */
export function searchLines(lines: FindLine[], query: string, caseSensitive: boolean, limit = FIND_MATCH_LIMIT): FindResult {
  const matches: FindMatch[] = [];
  if (!query) {
    return { matches, truncated: false };
  }
  const needle = caseSensitive ? query : query.toLowerCase();
  const pattern = caseSensitive ? null : new RegExp(escapeRegExp(query), 'gi');

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const push = (start: number, end: number) => {
      matches.push({ line: index, scope: line.scope, key: line.key, start, end });
      return matches.length >= limit;
    };

    if (caseSensitive) {
      let from = line.text.indexOf(needle);
      while (from >= 0) {
        if (push(from, from + needle.length)) {
          return { matches, truncated: true };
        }
        from = line.text.indexOf(needle, from + needle.length);
      }
      continue;
    }

    const lower = lowerText(line);
    if (lower.length !== line.text.length && pattern) {
      // Lowercasing changed the length, so offsets into `lower` would be off.
      for (const found of line.text.matchAll(pattern)) {
        if (push(found.index, found.index + found[0].length)) {
          return { matches, truncated: true };
        }
      }
      continue;
    }
    let from = lower.indexOf(needle);
    while (from >= 0) {
      if (push(from, from + needle.length)) {
        return { matches, truncated: true };
      }
      from = lower.indexOf(needle, from + needle.length);
    }
  }
  return { matches, truncated: false };
}

/** Index of the first match in `scope` or after it, 0 when the scope is unknown or nothing follows. */
export function firstMatchFrom(lines: FindLine[], matches: FindMatch[], scope: string | null): number {
  if (!scope || matches.length === 0) {
    return 0;
  }
  const lineIndex = lines.findIndex((line) => line.scope === scope);
  if (lineIndex < 0) {
    return 0;
  }
  const index = matches.findIndex((match) => match.line >= lineIndex);
  return index < 0 ? 0 : index;
}

/** Index of the same match in a fresh result, so a refreshed diff keeps the place. -1 when it is gone. */
export function carryCurrent(previous: FindMatch | null, matches: FindMatch[]): number {
  if (!previous) {
    return -1;
  }
  return matches.findIndex((match) => match.scope === previous.scope && match.key === previous.key && match.start === previous.start);
}

/** The next match index in `direction`, wrapping around. */
export function stepIndex(current: number, count: number, direction: 1 | -1): number {
  if (count === 0) {
    return -1;
  }
  if (current < 0) {
    return direction > 0 ? 0 : count - 1;
  }
  return (current + direction + count) % count;
}
