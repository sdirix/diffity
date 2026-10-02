import type { DiffFile, DiffHunk } from '@diffity/parser';
import type { CommentSide } from '../components/comments/types';

export type ViewMode = 'unified' | 'split';

const WORKING_TREE_REFS = new Set(['work', 'staged', 'unstaged']);

export function isWorkingTreeRef(ref?: string): boolean {
  return !!ref && WORKING_TREE_REFS.has(ref);
}

export function getFilePath(file: DiffFile): string {
  if (file.status === 'deleted') {
    return file.oldPath;
  }
  return file.newPath;
}

export function getLineBg(type: string): string {
  switch (type) {
    case 'add':
      return 'bg-diff-add-bg';
    case 'delete':
      return 'bg-diff-del-bg';
    default:
      return 'bg-bg';
  }
}

const LOCK_FILES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'pnpm-lock.yml',
  'bun.lock',
  'bun.lockb',
  'yarn.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'composer.lock',
  'poetry.lock',
  'Pipfile.lock',
  'go.sum',
  'flake.lock',
  'pubspec.lock',
  'Podfile.lock',
  'packages.lock.json',
  'project.assets.json',
  'paket.lock',
  'pnpm-workspace.yaml',
  'shrinkwrap.yaml',
]);

const MINIFIED_PATH = /\.min\.(js|mjs|cjs|css)$/i;

const GENERATED_EXTENSIONS = [
  '.bundle.js',
  '.bundle.css',
  '.chunk.js',
  '.chunk.css',
  '.generated.ts',
  '.generated.js',
  '.g.dart',
  '.freezed.dart',
  '.pb.go',
  '.pb.ts',
  '.pb.js',
];

const GENERATED_PATTERNS = [
  /\.d\.ts$/,
  /\.map$/,
  /\.snap$/,
  /dist\//,
  /build\//,
  /generated\//,
  /__generated__\//,
];

const AUTO_COLLAPSE_LINE_THRESHOLD = 1000;

/** Lines of the new version of a modified file, from the old version's and the changed lines. 0 when the old count is unknown. */
export function newFileLineCount(file: DiffFile): number {
  return file.oldFileLineCount === undefined ? 0 : file.oldFileLineCount + file.additions - file.deletions;
}

/** Lines of the file's hunks, or its changed lines when it came without hunks (`trimmed`). */
export function getRowCount(file: DiffFile): number {
  if (file.trimmed) {
    return file.additions + file.deletions;
  }
  let count = 0;
  for (const hunk of file.hunks) {
    count += hunk.lines.length;
  }
  return count;
}

/** Files with at least this many lines wait for "Load diff". */
export const DEFER_ROW_THRESHOLD = 200;
/** Lines this long on average mark minified code. */
export const MINIFIED_AVERAGE_LINE_LENGTH = 500;

function averageLineLength(file: DiffFile): number {
  let lines = 0;
  let length = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      lines++;
      length += line.content.length;
    }
  }
  return lines === 0 ? 0 : length / lines;
}

function isGeneratedPath(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return GENERATED_EXTENSIONS.some((ext) => lowerPath.endsWith(ext)) || GENERATED_PATTERNS.some((pattern) => pattern.test(path));
}

const reasons = new WeakMap<DiffFile, string | null>();

function findDeferReason(file: DiffFile): string | null {
  if (file.isBinary || (!file.trimmed && file.hunks.length === 0)) {
    return null;
  }
  const path = getFilePath(file);
  const fileName = path.split('/').pop() || '';
  if (LOCK_FILES.has(fileName) || fileName.endsWith('.lock')) {
    return 'Lock file';
  }
  if (MINIFIED_PATH.test(path) || averageLineLength(file) >= MINIFIED_AVERAGE_LINE_LENGTH) {
    return 'Minified';
  }
  if (isGeneratedPath(path)) {
    return 'Generated';
  }
  if (file.trimmed || getRowCount(file) >= DEFER_ROW_THRESHOLD) {
    return 'Large diff';
  }
  return null;
}

/**
 * Why a file waits for "Load diff": a lock, minified or generated file
 * whatever its size, or any other file with many lines. `null` renders it
 * right away.
 */
export function deferReason(file: DiffFile): string | null {
  let reason = reasons.get(file);
  if (reason === undefined) {
    reason = findDeferReason(file);
    reasons.set(file, reason);
  }
  return reason;
}

function isAutoCollapsible(file: DiffFile): boolean {
  return file.status === 'deleted' || file.status === 'renamed' || getRowCount(file) >= AUTO_COLLAPSE_LINE_THRESHOLD;
}

export function getAutoCollapsedPaths(files: DiffFile[]): Set<string> {
  const paths = new Set<string>();
  for (const file of files) {
    if (isAutoCollapsible(file)) {
      paths.add(getFilePath(file));
    }
  }
  return paths;
}

export function buildHunkPatch(file: DiffFile, hunk: DiffHunk): string {
  const oldPath = file.status === 'added' ? '/dev/null' : `a/${file.oldPath}`;
  const newPath = file.status === 'deleted' ? '/dev/null' : `b/${file.newPath}`;
  const lines: string[] = [
    `--- ${oldPath}`,
    `+++ ${newPath}`,
    hunk.header,
  ];
  for (const line of hunk.lines) {
    const prefix = line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' ';
    lines.push(`${prefix}${line.content}`);
    if (line.noNewline) {
      lines.push('\\ No newline at end of file');
    }
  }
  return lines.join('\n') + '\n';
}

export interface ChangeGroup {
  startIndex: number;
  endIndex: number;
}

export function getChangeGroups(lines: { type: string }[]): ChangeGroup[] {
  const groups: ChangeGroup[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].type !== 'context') {
      const start = i;
      while (i < lines.length && lines[i].type !== 'context') {
        i++;
      }
      groups.push({ startIndex: start, endIndex: i - 1 });
    } else {
      i++;
    }
  }
  return groups;
}

export function buildChangeGroupPatch(file: DiffFile, hunk: DiffHunk, startIndex: number, endIndex: number): string {
  const CONTEXT = 3;
  const lines = hunk.lines;

  const contextBefore: typeof lines = [];
  for (let i = startIndex - 1; i >= Math.max(0, startIndex - CONTEXT); i--) {
    if (lines[i].type === 'context') {
      contextBefore.unshift(lines[i]);
    } else {
      break;
    }
  }

  const changeLines = lines.slice(startIndex, endIndex + 1);

  const contextAfter: typeof lines = [];
  for (let i = endIndex + 1; i < Math.min(lines.length, endIndex + 1 + CONTEXT); i++) {
    if (lines[i].type === 'context') {
      contextAfter.push(lines[i]);
    } else {
      break;
    }
  }

  const allLines = [...contextBefore, ...changeLines, ...contextAfter];

  let oldStart = 0;
  let oldCount = 0;
  let newStart = 0;
  let newCount = 0;

  for (const line of allLines) {
    if (line.oldLineNumber !== null && oldStart === 0) {
      oldStart = line.oldLineNumber;
    }
    if (line.newLineNumber !== null && newStart === 0) {
      newStart = line.newLineNumber;
    }
    if (line.type === 'context' || line.type === 'delete') {
      oldCount++;
    }
    if (line.type === 'context' || line.type === 'add') {
      newCount++;
    }
  }

  if (oldStart === 0) {
    oldStart = hunk.oldStart;
  }
  if (newStart === 0) {
    newStart = hunk.newStart;
  }

  const oldPath = file.status === 'added' ? '/dev/null' : `a/${file.oldPath}`;
  const newPath = file.status === 'deleted' ? '/dev/null' : `b/${file.newPath}`;
  const header = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;

  const patchLines: string[] = [
    `--- ${oldPath}`,
    `+++ ${newPath}`,
    header,
  ];

  for (const line of allLines) {
    const prefix = line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' ';
    patchLines.push(`${prefix}${line.content}`);
    if (line.noNewline) {
      patchLines.push('\\ No newline at end of file');
    }
  }

  return patchLines.join('\n') + '\n';
}


export function extractLinesFromDiff(
  hunks: DiffHunk[],
  side: CommentSide,
  startLine: number,
  endLine: number,
): string {
  const result: string[] = [];
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      const lineNum = side === 'old' ? line.oldLineNumber : line.newLineNumber;
      if (lineNum === null || lineNum < startLine || lineNum > endLine) {
        continue;
      }
      if (side === 'old' && (line.type === 'delete' || line.type === 'context')) {
        result.push(line.content);
      } else if (side === 'new' && (line.type === 'add' || line.type === 'context')) {
        result.push(line.content);
      }
    }
  }
  return result.join('\n');
}

export function extractLinesFromExpandedLines(
  lines: { type: string; content: string; oldLineNumber: number | null; newLineNumber: number | null }[],
  side: CommentSide,
  startLine: number,
  endLine: number,
): string {
  const result: string[] = [];
  for (const line of lines) {
    const lineNum = side === 'old' ? line.oldLineNumber : line.newLineNumber;
    if (lineNum === null || lineNum < startLine || lineNum > endLine) {
      continue;
    }
    result.push(line.content);
  }
  return result.join('\n');
}

export function getStatusColor(status: string): string {
  switch (status) {
    case 'added':
      return 'bg-diff-added/15 text-diff-added';
    case 'deleted':
      return 'bg-diff-deleted/15 text-diff-deleted';
    case 'renamed':
      return 'bg-diff-renamed/15 text-diff-renamed';
    default:
      return 'bg-modified/15 text-modified';
  }
}
