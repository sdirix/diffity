import type { DiffFile, DiffHunk, ParsedDiff } from '@diffity/parser';

export type Side = 'old' | 'new';

export interface CommentRequest {
  path: string;
  side: Side;
  startLine: number;
  endLine: number;
}

export interface CommentTarget {
  filePath: string;
  side: Side;
  startLine: number;
  endLine: number;
  anchorContent?: string;
}

/** A comment that cannot be placed, with hints for a retry. `file` when the file itself is not in the diff. */
export class CommentTargetError extends Error {
  constructor(message: string, readonly hints: string[] = [], readonly kind: 'file' | 'lines' = 'lines') {
    super(message);
    this.name = 'CommentTargetError';
  }
}

/** The tree view's file comments live on this prefix plus the path, at line 0. */
export const PATH_THREAD_PREFIX = '__path__:';

export const SEVERITIES = ['must-fix', 'suggestion', 'nit', 'question'] as const;
export type Severity = (typeof SEVERITIES)[number];

const SEVERITY_TAG = new RegExp(`^\\s*\\[(${SEVERITIES.join('|')})\\]`, 'i');

/** Accepts `must-fix` as well as `[Must_Fix]` or `mustfix`. */
export function parseSeverity(raw: string): Severity | null {
  const normalized = raw.trim().replace(/^\[|\]$/g, '').toLowerCase().replace(/[_ ]/g, '-');
  const severity = normalized === 'mustfix' ? 'must-fix' : normalized;
  return SEVERITIES.includes(severity as Severity) ? (severity as Severity) : null;
}

/** Prefixes `body` with the `[severity]` tag the review skills write by hand. */
export function withSeverity(body: string, severity: Severity | undefined): string {
  if (!severity) {
    return body;
  }
  const tagged = body.match(SEVERITY_TAG);
  if (!tagged) {
    return `[${severity}] ${body.trimStart()}`;
  }
  if (tagged[1].toLowerCase() !== severity) {
    throw new CommentTargetError(`The body starts with [${tagged[1]}], which contradicts --severity ${severity}`);
  }
  return body;
}

/** The path the UI files a diff's threads under. */
function diffFilePath(file: DiffFile): string {
  return file.status === 'deleted' ? file.oldPath : file.newPath;
}

function hunkRange(hunk: DiffHunk, side: Side): [number, number] | null {
  const start = side === 'old' ? hunk.oldStart : hunk.newStart;
  const count = side === 'old' ? hunk.oldCount : hunk.newCount;
  return count > 0 ? [start, start + count - 1] : null;
}

function formatRange(start: number, end: number): string {
  return start === end ? `${start}` : `${start}-${end}`;
}

function describeLines(start: number, end: number): string {
  return start === end ? `Line ${start} is` : `Lines ${start}-${end} are`;
}

/**
 * The text of lines `start` to `end` on `side`, joined like the UI's
 * `extractLinesFromDiff`, so the thread does not show as outdated.
 */
function anchorText(hunk: DiffHunk, side: Side, start: number, end: number): string {
  const lines: string[] = [];
  for (const line of hunk.lines) {
    const number = side === 'old' ? line.oldLineNumber : line.newLineNumber;
    if (number !== null && number >= start && number <= end) {
      lines.push(line.content);
    }
  }
  return lines.join('\n');
}

/**
 * Places a comment in the diff of `ref`. Line 0 makes a comment on the whole
 * file, other lines have to lie within one hunk on the requested side.
 */
export function resolveDiffTarget(diff: ParsedDiff, ref: string, request: CommentRequest): CommentTarget {
  const { path, side, startLine, endLine } = request;
  const file = diff.files.find((f) => diffFilePath(f) === path || f.newPath === path || f.oldPath === path);
  if (!file) {
    const paths = diff.files.map(diffFilePath);
    throw new CommentTargetError(`File "${path}" is not in the current diff.`, [
      `The diff for ref "${ref}" contains ${paths.length} file(s):`,
      ...paths.slice(0, 20).map((p) => `  ${p}`),
      ...(paths.length > 20 ? [`  ... and ${paths.length - 20} more`] : []),
    ], 'file');
  }
  const filePath = diffFilePath(file);
  if (startLine === 0) {
    return { filePath, side, startLine: 0, endLine: 0 };
  }

  const fileHint = 'Use --line 0 to comment on the whole file.';
  const ranges = file.hunks.flatMap((hunk) => {
    const range = hunkRange(hunk, side);
    return range ? [{ hunk, range }] : [];
  });
  if (ranges.length === 0) {
    const other = side === 'old' ? 'new' : 'old';
    const why = file.isBinary ? 'is a binary file' : `has no ${side} side lines in this diff`;
    throw new CommentTargetError(`"${filePath}" ${why}.`, file.isBinary ? [fileHint] : [`Use --side ${other} or --line 0.`]);
  }

  const match = ranges.find(({ range: [lo, hi] }) => startLine >= lo && endLine <= hi);
  if (!match) {
    throw new CommentTargetError(
      `${describeLines(startLine, endLine)} outside the diff of "${filePath}" on the ${side} side.`,
      [
        `Lines on the ${side} side of the diff: ${ranges.map(({ range: [lo, hi] }) => formatRange(lo, hi)).join(', ')}`,
        'A comment has to stay within one of these ranges.',
        fileHint,
      ],
    );
  }
  return { filePath, side, startLine, endLine, anchorContent: anchorText(match.hunk, side, startLine, endLine) };
}

/**
 * Places a comment in the file browser on a file that reads `content`.
 * Line 0 makes a comment on the whole file.
 */
export function resolveTreeTarget(content: string, request: CommentRequest): CommentTarget {
  const { path, startLine, endLine } = request;
  if (startLine === 0) {
    return { filePath: `${PATH_THREAD_PREFIX}${path}`, side: 'new', startLine: 0, endLine: 0 };
  }
  const lines = content.split('\n');
  const lineCount = content.endsWith('\n') ? lines.length - 1 : lines.length;
  if (endLine > lineCount) {
    throw new CommentTargetError(
      `${describeLines(startLine, endLine)} outside "${path}", which has ${lineCount} line(s).`,
      ['Use --line 0 to comment on the whole file.'],
    );
  }
  return {
    filePath: path,
    side: 'new',
    startLine,
    endLine,
    anchorContent: lines.slice(startLine - 1, endLine).join('\n'),
  };
}
