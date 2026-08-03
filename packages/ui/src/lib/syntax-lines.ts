import type { DiffHunk, DiffLine } from '@diffity/parser';
import type { GrammarState } from 'shiki';
import type { SyntaxToken } from './syntax-token';

export type SyntaxSide = 'old' | 'new';

/** Consecutive lines of one side of a file, highlighted in one pass so multi-line constructs keep their colour. */
export interface SyntaxSource {
  side: SyntaxSide;
  numbers: number[];
  lines: string[];
}

export interface SideTokens {
  old: Map<number, SyntaxToken[]>;
  new: Map<number, SyntaxToken[]>;
}

export interface FileVersionLines {
  oldLines: string[] | null;
  newLines: string[] | null;
}

export type ChunkTokenizer = (code: string, state?: GrammarState) => { lines: SyntaxToken[][]; state: GrammarState | undefined } | null;

function onSide(line: DiffLine, side: SyntaxSide): boolean {
  return side === 'old' ? line.type !== 'add' : line.type !== 'delete';
}

function lineNumber(line: DiffLine, side: SyntaxSide): number | null {
  return side === 'old' ? line.oldLineNumber : line.newLineNumber;
}

function sideLines(hunks: DiffHunk[], side: SyntaxSide): { num: number; content: string }[] {
  const lines: { num: number; content: string }[] = [];
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      const num = lineNumber(line, side);
      if (onSide(line, side) && num !== null) {
        lines.push({ num, content: line.content });
      }
    }
  }
  return lines;
}

/** Which sides the diff shows: deleted lines need the old side, added and context lines the new one. */
export function sidesShown(hunks: DiffHunk[]): Record<SyntaxSide, boolean> {
  const shown = { old: false, new: false };
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'delete') {
        shown.old = true;
      } else {
        shown.new = true;
      }
    }
  }
  return shown;
}

/** Each hunk's old side (context + deleted) and new side (context + added), in order: the fallback without full files. */
export function hunkSources(hunks: DiffHunk[], sides: SyntaxSide[] = ['old', 'new']): SyntaxSource[] {
  const sources: SyntaxSource[] = [];
  for (const hunk of hunks) {
    for (const side of sides) {
      const source: SyntaxSource = { side, numbers: [], lines: [] };
      for (const line of hunk.lines) {
        const num = lineNumber(line, side);
        if (!onSide(line, side) || num === null) {
          continue;
        }
        source.numbers.push(num);
        source.lines.push(line.content);
      }
      if (source.lines.length > 0) {
        sources.push(source);
      }
    }
  }
  return sources;
}

export function fileSource(side: SyntaxSide, fileLines: string[]): SyntaxSource {
  return { side, numbers: fileLines.map((_, index) => index + 1), lines: fileLines };
}

function lineMatches(fileLines: string[], index: number, content: string): boolean {
  if (index < 0 || index >= fileLines.length) {
    return content.trim() === '';
  }
  const fileLine = fileLines[index];
  if (fileLine === content) {
    return true;
  }
  let trimmed = content;
  if (index === 0) {
    trimmed = trimmed.trimStart();
  }
  if (index === fileLines.length - 1) {
    trimmed = trimmed.trimEnd();
  }
  return fileLine === trimmed;
}

/**
 * `fileLines` numbered like the diff's `side`, with the diff's own text on its lines, or null when they do not match.
 * Tolerates trimmed content that lost its leading blank lines, the first line's indentation or trailing blank lines.
 */
export function alignFileLines(hunks: DiffHunk[], side: SyntaxSide, fileLines: string[]): string[] | null {
  const lines = sideLines(hunks, side);
  const probe = lines.find((line) => line.content.trim() !== '') ?? lines[0];
  if (!probe) {
    return fileLines;
  }
  for (let skipped = 0; skipped < probe.num; skipped++) {
    if (!lineMatches(fileLines, probe.num - 1 - skipped, probe.content)) {
      continue;
    }
    if (!lines.every((line) => lineMatches(fileLines, line.num - 1 - skipped, line.content))) {
      continue;
    }
    const aligned = [...Array<string>(skipped).fill(''), ...fileLines];
    for (const line of lines) {
      aligned[line.num - 1] = line.content;
    }
    return Array.from(aligned, (line) => line ?? '');
  }
  return null;
}

/**
 * What to highlight for a file: each side the diff shows as the whole file when it is available, matches the diff
 * and has at most `maxFileLines` lines, otherwise that side's hunk lines.
 */
export function planSyntaxSources(
  hunks: DiffHunk[],
  versions: FileVersionLines | null,
  maxFileLines: number,
): { sources: SyntaxSource[]; full: Record<SyntaxSide, boolean> } {
  const shown = sidesShown(hunks);
  const sources: SyntaxSource[] = [];
  const fallback: SyntaxSide[] = [];
  const full = { old: false, new: false };
  const plan = (side: SyntaxSide, fileLines: string[] | null | undefined) => {
    const aligned = fileLines && fileLines.length <= maxFileLines ? alignFileLines(hunks, side, fileLines) : null;
    if (aligned && aligned.length <= maxFileLines) {
      sources.push(fileSource(side, aligned));
      full[side] = true;
      return;
    }
    fallback.push(side);
  };
  if (shown.old) {
    plan('old', versions?.oldLines);
  }
  if (shown.new) {
    plan('new', versions?.newLines);
  }
  if (fallback.length > 0) {
    sources.push(...hunkSources(hunks, fallback));
  }
  return { sources, full };
}

/**
 * Tokenizes the sources into `into`, `chunkLines` lines per step, carrying the grammar state across steps. Yields
 * after each step so a caller can spread the work over idle time. `into` holds every finished line meanwhile.
 */
export function* tokenizeSources(sources: SyntaxSource[], tokenize: ChunkTokenizer, into: SideTokens, chunkLines = 100): Generator<void, void> {
  for (const source of sources) {
    const target = into[source.side];
    let state: GrammarState | undefined;
    for (let start = 0; start < source.lines.length; start += chunkLines) {
      const end = Math.min(start + chunkLines, source.lines.length);
      const result = tokenize(source.lines.slice(start, end).join('\n'), state);
      if (!result) {
        return;
      }
      for (let i = start; i < end; i++) {
        const tokens = result.lines[i - start];
        if (tokens) {
          target.set(source.numbers[i], tokens);
        }
      }
      state = result.state;
      yield;
    }
  }
}

/**
 * The per-row syntax map the diff renders from (`type-number`, deleted rows by old number, the rest by new). Context
 * rows prefer the side highlighted as a whole file. With a whole new file, every new line is also keyed as a context
 * row, so expanded context reuses them.
 */
export function buildSyntaxMap(hunks: DiffHunk[], tokens: SideTokens, full: Record<SyntaxSide, boolean>): Map<string, SyntaxToken[]> {
  const map = new Map<string, SyntaxToken[]>();
  if (full.new) {
    for (const [num, lineTokens] of tokens.new) {
      map.set(`context-${num}`, lineTokens);
    }
  }
  const oldFirst = full.old && !full.new;
  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (line.type === 'delete') {
        const found = line.oldLineNumber !== null ? tokens.old.get(line.oldLineNumber) : undefined;
        if (found) {
          map.set(`delete-${line.oldLineNumber}`, found);
        }
        continue;
      }
      const fromNew = line.newLineNumber !== null ? tokens.new.get(line.newLineNumber) : undefined;
      const fromOld = line.type === 'context' && line.oldLineNumber !== null ? tokens.old.get(line.oldLineNumber) : undefined;
      const found = oldFirst ? fromOld ?? fromNew : fromNew ?? fromOld;
      if (found) {
        map.set(`${line.type}-${line.newLineNumber}`, found);
      }
    }
  }
  return map;
}
