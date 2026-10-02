import type { DiffFile, ParsedDiff } from '@diffity/parser';
import { PATH_THREAD_PREFIX } from './agent-comment.js';

export const GENERAL_THREAD_PATH = '__general__';

/**
 * Where a thread stands in its view:
 * - `current`: its lines are in the diff and read as they did when it was left
 * - `outdated`: its file is in the diff, but its lines are not or they changed
 * - `file_gone`: its file is no longer part of the diff
 * - `view_empty`: the view has no changes left
 * - `unknown`: the view cannot be diffed here, it belongs to another branch or its ref is gone
 */
export type ThreadLocation = 'current' | 'outdated' | 'file_gone' | 'view_empty' | 'unknown';

export interface LocatableThread {
  filePath: string;
  side: string;
  startLine: number;
  endLine: number;
  anchorContent: string | null;
}

type SideLines = Map<number, string>;

interface FileLines {
  old: SideLines;
  new: SideLines;
}

/** A view's diff reduced to the text of each line its hunks show, per file and side. */
export interface ViewIndex {
  files: Map<string, FileLines>;
  empty: boolean;
}

function indexFile(file: DiffFile): FileLines {
  const lines: FileLines = { old: new Map(), new: new Map() };
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.oldLineNumber !== null) {
        lines.old.set(line.oldLineNumber, line.content);
      }
      if (line.newLineNumber !== null) {
        lines.new.set(line.newLineNumber, line.content);
      }
    }
  }
  return lines;
}

/** Files are keyed by the path the UI files their threads under, a renamed file also by its old path for the old side. */
export function indexDiff(diff: ParsedDiff): ViewIndex {
  const files = new Map<string, FileLines>();
  for (const file of diff.files) {
    const lines = indexFile(file);
    const path = file.status === 'deleted' ? file.oldPath : file.newPath;
    files.set(path, lines);
    if (file.status === 'renamed' && file.oldPath !== path && !files.has(file.oldPath)) {
      files.set(file.oldPath, { old: lines.old, new: new Map() });
    }
  }
  return { files, empty: diff.files.length === 0 };
}

/**
 * Whether some of the thread's lines are shown and none of them changed. An
 * anchor taken from part of the range is only compared when the same number
 * of lines is shown, otherwise it cannot be lined up.
 */
function readsAnchor(lines: SideLines, thread: LocatableThread): boolean {
  const shown: number[] = [];
  for (let n = thread.startLine; n <= thread.endLine; n++) {
    if (lines.has(n)) {
      shown.push(n);
    }
  }
  if (shown.length === 0) {
    return false;
  }
  const anchor = thread.anchorContent;
  if (!anchor) {
    return true;
  }
  const texts = shown.map((n) => lines.get(n)!);
  if (texts.join('\n') === anchor) {
    return true;
  }
  const anchorLines = anchor.split('\n');
  if (anchorLines.length === thread.endLine - thread.startLine + 1) {
    return shown.every((n) => lines.get(n) === anchorLines[n - thread.startLine]);
  }
  return anchorLines.length !== texts.length;
}

function sideLines(file: FileLines, side: string): SideLines {
  return side === 'old' ? file.old : file.new;
}

export function locateThread(index: ViewIndex, thread: LocatableThread): ThreadLocation {
  if (index.empty) {
    return 'view_empty';
  }
  if (thread.filePath === GENERAL_THREAD_PATH) {
    return 'current';
  }
  const file = index.files.get(thread.filePath);
  if (!file) {
    return 'file_gone';
  }
  if (thread.startLine === 0) {
    return 'current';
  }
  return readsAnchor(sideLines(file, thread.side), thread) ? 'current' : 'outdated';
}

/** Whether the diff shows every line of the thread as it read when the thread was left. */
export function showsThread(index: ViewIndex, thread: LocatableThread): boolean {
  if (thread.filePath === GENERAL_THREAD_PATH || thread.startLine === 0) {
    return false;
  }
  const file = index.files.get(thread.filePath);
  if (!file) {
    return false;
  }
  const lines = sideLines(file, thread.side);
  if (!thread.anchorContent) {
    return readsAnchor(lines, thread);
  }
  const texts: string[] = [];
  for (let n = thread.startLine; n <= thread.endLine; n++) {
    const text = lines.get(n);
    if (text === undefined) {
      return false;
    }
    texts.push(text);
  }
  return texts.join('\n') === thread.anchorContent;
}

/** The path a file browser thread is on, `''` for the repository root. */
export function treeThreadPath(thread: LocatableThread): string {
  if (!thread.filePath.startsWith(PATH_THREAD_PREFIX)) {
    return thread.filePath;
  }
  const path = thread.filePath.slice(PATH_THREAD_PREFIX.length);
  return path === '__root__' ? '' : path;
}

/**
 * A file browser thread against its path as it reads now: `content` is the
 * file's text, any string for a folder, `null` when the path is gone.
 */
export function locateTreeThread(thread: LocatableThread, content: string | null): ThreadLocation {
  if (thread.filePath === GENERAL_THREAD_PATH) {
    return 'current';
  }
  if (content === null) {
    return 'file_gone';
  }
  if (thread.filePath.startsWith(PATH_THREAD_PREFIX) || thread.startLine === 0 || !thread.anchorContent) {
    return 'current';
  }
  const lines = content.split('\n').slice(thread.startLine - 1, thread.endLine);
  return lines.join('\n') === thread.anchorContent ? 'current' : 'outdated';
}
