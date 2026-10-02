import type {
  DiffFile,
  DiffHunk,
  DiffLineType,
  FileStatus,
  ParsedDiff,
} from './types.js';
import { computeWordDiff } from './word-diff.js';

const DIFF_HEADER_PREFIX = 'diff --git ';
const DIFF_HEADER_RE = /^a\/(.*) b\/(.*)$/;
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;
const OLD_FILE_RE = /^--- (.+)$/;
const NEW_FILE_RE = /^\+\+\+ (.+)$/;
const SIMILARITY_RE = /^similarity index (\d+)%$/;
const RENAME_FROM_RE = /^rename from (.+)$/;
const RENAME_TO_RE = /^rename to (.+)$/;
const COPY_FROM_RE = /^copy from (.+)$/;
const COPY_TO_RE = /^copy to (.+)$/;
const OLD_MODE_RE = /^old mode (\d+)$/;
const NEW_MODE_RE = /^new mode (\d+)$/;
const NEW_FILE_MODE_RE = /^new file mode (\d+)$/;
const DELETED_FILE_MODE_RE = /^deleted file mode (\d+)$/;
const BINARY_RE = /^Binary files (.+) and (.+) differ$/;
const NO_NEWLINE_RE = /^\\ No newline at end of file$/;
/** Lines that belong to a hunk. An empty line is a blank context line under `diff.suppressBlankEmpty`. */
const HUNK_LINE_RE = /^([-+ ]|$)/;

function stripPrefix(path: string): string {
  if (path === '/dev/null') {
    return path;
  }
  if (path.startsWith('a/') || path.startsWith('b/')) {
    return path.slice(2);
  }
  return path;
}

const C_ESCAPES: Record<string, number> = {
  a: 0x07, b: 0x08, t: 0x09, n: 0x0a, v: 0x0b, f: 0x0c, r: 0x0d, '"': 0x22, '\\': 0x5c,
};

const utf8Encoder = new TextEncoder();
const utf8Decoder = new TextDecoder();

/**
 * Reads the C-style quoted name starting at `start`, as git writes names that
 * contain `"`, `\` or control characters, and non-ASCII ones unless
 * `core.quotepath` is off. Returns the name and the index after the quote.
 */
function readQuoted(text: string, start: number): { value: string; end: number } | null {
  const bytes: number[] = [];
  let i = start + 1;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      return { value: utf8Decoder.decode(new Uint8Array(bytes)), end: i + 1 };
    }
    if (ch === '\\') {
      const next = text[i + 1];
      if (next in C_ESCAPES) {
        bytes.push(C_ESCAPES[next]);
        i += 2;
        continue;
      }
      const octal = text.slice(i + 1, i + 4);
      if (/^[0-3][0-7]{2}$/.test(octal)) {
        bytes.push(parseInt(octal, 8));
        i += 4;
        continue;
      }
      return null;
    }
    const codePoint = text.codePointAt(i)!;
    const char = String.fromCodePoint(codePoint);
    bytes.push(...utf8Encoder.encode(char));
    i += char.length;
  }
  return null;
}

/** A path from a `---`/`+++`, rename or copy line. Git ends unquoted names containing a space with a tab. */
function parsePath(text: string): string {
  if (text.startsWith('"')) {
    const quoted = readQuoted(text, 0);
    if (quoted) {
      return quoted.value;
    }
  }
  const tab = text.indexOf('\t');
  return tab === -1 ? text : text.slice(0, tab);
}

/**
 * Splits the two names of a `diff --git` line. Either may be quoted. Two
 * unquoted names are ambiguous when they contain spaces, so like git this
 * prefers the split where both sides name the same file. Renames and copies
 * correct the names from their `rename`/`copy` lines afterwards.
 */
function parseGitHeader(rest: string): { oldPath: string; newPath: string } | null {
  let oldName: string;
  let newName: string;

  if (rest.startsWith('"')) {
    const quoted = readQuoted(rest, 0);
    if (!quoted || rest[quoted.end] !== ' ') {
      return null;
    }
    oldName = quoted.value;
    newName = parsePath(rest.slice(quoted.end + 1));
  } else if (rest.endsWith('"') && rest.includes(' "')) {
    const split = rest.indexOf(' "');
    const quoted = readQuoted(rest, split + 1);
    if (!quoted) {
      return null;
    }
    oldName = rest.slice(0, split);
    newName = quoted.value;
  } else {
    const mid = (rest.length - 1) / 2;
    if (Number.isInteger(mid) && rest[mid] === ' ' && rest.slice(2, mid) === rest.slice(mid + 3)) {
      oldName = rest.slice(0, mid);
      newName = rest.slice(mid + 1);
    } else {
      const match = rest.match(DIFF_HEADER_RE);
      if (!match) {
        return null;
      }
      return { oldPath: match[1], newPath: match[2] };
    }
  }

  if (!oldName.startsWith('a/') || !newName.startsWith('b/')) {
    return null;
  }
  return { oldPath: oldName.slice(2), newPath: newName.slice(2) };
}

/** Word diffs are skipped for longer lines, like minified code, where tokenizing and the LCS take seconds. */
export const WORD_DIFF_MAX_LINE_LENGTH = 1000;

function attachWordDiffs(hunk: DiffHunk): void {
  const lines = hunk.lines;
  let i = 0;

  while (i < lines.length) {
    if (lines[i].type === 'delete') {
      const deleteStart = i;
      while (i < lines.length && lines[i].type === 'delete') {
        i++;
      }
      const deleteEnd = i;

      const addStart = i;
      while (i < lines.length && lines[i].type === 'add') {
        i++;
      }
      const addEnd = i;

      const deleteCount = deleteEnd - deleteStart;
      const addCount = addEnd - addStart;

      if (deleteCount > 0 && addCount > 0) {
        const pairCount = Math.min(deleteCount, addCount);
        for (let p = 0; p < pairCount; p++) {
          const delLine = lines[deleteStart + p];
          const addLine = lines[addStart + p];
          if (delLine.content.length > WORD_DIFF_MAX_LINE_LENGTH || addLine.content.length > WORD_DIFF_MAX_LINE_LENGTH) {
            continue;
          }
          const segments = computeWordDiff(delLine.content, addLine.content);
          delLine.wordDiff = segments;
          addLine.wordDiff = segments;
        }
      }
    } else {
      i++;
    }
  }
}

export function parseDiff(raw: string): ParsedDiff {
  const lines = raw.split('\n');
  const files: DiffFile[] = [];
  let currentFile: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLineNum = 0;
  let newLineNum = 0;
  let oldRemaining = 0;
  let newRemaining = 0;
  let i = 0;

  function addHunkLine(hunk: DiffHunk, file: DiffFile, line: string): void {
    const prefix = line[0];
    const content = line.slice(1);

    if (prefix === '+') {
      hunk.lines.push({
        type: 'add',
        content,
        oldLineNumber: null,
        newLineNumber: newLineNum,
      });
      file.additions++;
      newLineNum++;
      newRemaining--;
    } else if (prefix === '-') {
      hunk.lines.push({
        type: 'delete',
        content,
        oldLineNumber: oldLineNum,
        newLineNumber: null,
      });
      file.deletions++;
      oldLineNum++;
      oldRemaining--;
    } else {
      hunk.lines.push({
        type: 'context',
        content,
        oldLineNumber: oldLineNum,
        newLineNumber: newLineNum,
      });
      oldLineNum++;
      newLineNum++;
      oldRemaining--;
      newRemaining--;
    }
  }

  while (i < lines.length) {
    const line = lines[i];

    // Inside a hunk its line counts decide, so content like `--- x` is not read as a header.
    if (currentFile && currentHunk && (oldRemaining > 0 || newRemaining > 0) && HUNK_LINE_RE.test(line)) {
      addHunkLine(currentHunk, currentFile, line);
      i++;
      continue;
    }

    const header = line.startsWith(DIFF_HEADER_PREFIX)
      ? parseGitHeader(line.slice(DIFF_HEADER_PREFIX.length))
      : null;
    if (header) {
      if (currentFile) {
        files.push(currentFile);
      }
      currentFile = {
        oldPath: header.oldPath,
        newPath: header.newPath,
        status: 'modified',
        hunks: [],
        additions: 0,
        deletions: 0,
        isBinary: false,
      };
      currentHunk = null;
      i++;
      continue;
    }

    if (!currentFile) {
      i++;
      continue;
    }

    const oldModeMatch = line.match(OLD_MODE_RE);
    if (oldModeMatch) {
      currentFile.oldMode = oldModeMatch[1];
      i++;
      continue;
    }

    const newModeMatch = line.match(NEW_MODE_RE);
    if (newModeMatch) {
      currentFile.newMode = newModeMatch[1];
      i++;
      continue;
    }

    const newFileModeMatch = line.match(NEW_FILE_MODE_RE);
    if (newFileModeMatch) {
      currentFile.newMode = newFileModeMatch[1];
      currentFile.status = 'added';
      i++;
      continue;
    }

    const deletedFileModeMatch = line.match(DELETED_FILE_MODE_RE);
    if (deletedFileModeMatch) {
      currentFile.oldMode = deletedFileModeMatch[1];
      currentFile.status = 'deleted';
      i++;
      continue;
    }

    const similarityMatch = line.match(SIMILARITY_RE);
    if (similarityMatch) {
      currentFile.similarityIndex = parseInt(similarityMatch[1], 10);
      i++;
      continue;
    }

    const renameFromMatch = line.match(RENAME_FROM_RE);
    if (renameFromMatch) {
      currentFile.oldPath = parsePath(renameFromMatch[1]);
      currentFile.status = 'renamed';
      i++;
      continue;
    }

    const renameToMatch = line.match(RENAME_TO_RE);
    if (renameToMatch) {
      currentFile.newPath = parsePath(renameToMatch[1]);
      currentFile.status = 'renamed';
      i++;
      continue;
    }

    const copyFromMatch = line.match(COPY_FROM_RE);
    if (copyFromMatch) {
      currentFile.oldPath = parsePath(copyFromMatch[1]);
      currentFile.status = 'copied';
      i++;
      continue;
    }

    const copyToMatch = line.match(COPY_TO_RE);
    if (copyToMatch) {
      currentFile.newPath = parsePath(copyToMatch[1]);
      currentFile.status = 'copied';
      i++;
      continue;
    }

    const oldFileMatch = line.match(OLD_FILE_RE);
    if (oldFileMatch) {
      const path = stripPrefix(parsePath(oldFileMatch[1]));
      currentFile.oldPath = path;
      if (path === '/dev/null') {
        currentFile.status = 'added';
      }
      i++;
      continue;
    }

    const newFileMatch = line.match(NEW_FILE_RE);
    if (newFileMatch) {
      const path = stripPrefix(parsePath(newFileMatch[1]));
      currentFile.newPath = path;
      if (path === '/dev/null') {
        currentFile.status = 'deleted';
      }
      i++;
      continue;
    }

    const binaryMatch = line.match(BINARY_RE);
    if (binaryMatch) {
      currentFile.isBinary = true;
      i++;
      continue;
    }

    const hunkMatch = line.match(HUNK_HEADER_RE);
    if (hunkMatch) {
      currentHunk = {
        header: line,
        oldStart: parseInt(hunkMatch[1], 10),
        oldCount: hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1,
        newStart: parseInt(hunkMatch[3], 10),
        newCount: hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1,
        context: hunkMatch[5]?.trim() || undefined,
        lines: [],
      };
      currentFile.hunks.push(currentHunk);
      oldLineNum = currentHunk.oldStart;
      newLineNum = currentHunk.newStart;
      oldRemaining = currentHunk.oldCount;
      newRemaining = currentHunk.newCount;
      i++;
      continue;
    }

    if (NO_NEWLINE_RE.test(line)) {
      if (currentHunk && currentHunk.lines.length > 0) {
        currentHunk.lines[currentHunk.lines.length - 1].noNewline = true;
      }
      i++;
      continue;
    }

    if (currentHunk && line !== '' && HUNK_LINE_RE.test(line)) {
      addHunkLine(currentHunk, currentFile, line);
    }

    i++;
  }

  if (currentFile) {
    files.push(currentFile);
  }

  for (const file of files) {
    for (const hunk of file.hunks) {
      attachWordDiffs(hunk);
    }
  }

  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const file of files) {
    totalAdditions += file.additions;
    totalDeletions += file.deletions;
  }

  return {
    files,
    stats: {
      totalAdditions,
      totalDeletions,
      filesChanged: files.length,
    },
  };
}
