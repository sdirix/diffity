import type { DiffFile, DiffHunk, DiffLine } from '@diffity/parser';
import { getRowCount } from './diff-utils';
import { diffLineKey } from './find';

/** Files with more rows than this render their hunks in slices that mount only near the viewport. */
export const SLICE_ROW_THRESHOLD = 400;
export const SLICE_SIZE = 120;

function sliceOf(hunk: DiffHunk, lines: DiffLine[], first: boolean): DiffHunk {
  if (first) {
    return { ...hunk, lines };
  }
  let oldCount = 0;
  let newCount = 0;
  for (const line of lines) {
    if (line.type !== 'add') {
      oldCount++;
    }
    if (line.type !== 'delete') {
      newCount++;
    }
  }
  const oldStart = lines.find((line) => line.oldLineNumber !== null)?.oldLineNumber ?? hunk.oldStart;
  const newStart = lines.find((line) => line.newLineNumber !== null)?.newLineNumber ?? hunk.newStart;
  return { header: '', oldStart, oldCount, newStart, newCount, lines };
}

/**
 * Splits a long hunk into slices of about `size` lines. The first slice keeps
 * the header, the others have an empty one, which renders no header row. A
 * cut never falls inside a delete and add run, so split view still pairs its
 * lines, unless the run is over four slices long.
 */
export function sliceHunk(hunk: DiffHunk, size = SLICE_SIZE): DiffHunk[] {
  const lines = hunk.lines;
  if (lines.length <= size * 1.5) {
    return [hunk];
  }
  const slices: DiffHunk[] = [];
  let start = 0;
  let runHasDelete = false;
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    if (prev.type === 'context') {
      runHasDelete = false;
    }
    if (prev.type === 'delete') {
      runHasDelete = true;
    }
    if (i - start < size) {
      continue;
    }
    if (runHasDelete && lines[i].type !== 'context' && i - start < size * 4) {
      continue;
    }
    slices.push(sliceOf(hunk, lines.slice(start, i), start === 0));
    start = i;
  }
  slices.push(sliceOf(hunk, lines.slice(start), start === 0));
  return slices;
}

/** Rows a slice takes: every line in unified view, context plus the longer side of each change run in split view. */
export function sliceRowCount(lines: DiffLine[], split: boolean): number {
  if (!split) {
    return lines.length;
  }
  let rows = 0;
  let dels = 0;
  let adds = 0;
  for (const line of lines) {
    if (line.type === 'context') {
      rows += Math.max(dels, adds) + 1;
      dels = 0;
      adds = 0;
      continue;
    }
    if (line.type === 'delete') {
      dels++;
    } else {
      adds++;
    }
  }
  return rows + Math.max(dels, adds);
}

export interface HunkUnit {
  hunk: DiffHunk;
  /** Index of the hunk the unit belongs to. */
  index: number;
  /** The unit that starts the hunk and carries its header. */
  first: boolean;
  key: string;
}

/** The hunks of `file`, sliced when it has more than `SLICE_ROW_THRESHOLD` rows. */
export function hunkUnits(file: DiffFile): { sliced: boolean; units: HunkUnit[] } {
  const sliced = getRowCount(file) > SLICE_ROW_THRESHOLD;
  const units = file.hunks.flatMap((hunk, index) =>
    (sliced ? sliceHunk(hunk) : [hunk]).map((part, n) => ({ hunk: part, index, first: n === 0, key: `${index}-${n}` })),
  );
  return { sliced, units };
}

/**
 * Whether a slice must stay mounted: it holds a line in `pins` (`old:12`,
 * `new:12`), where a thread or the comment form sits, or one of `lineKeys`
 * (`add-12`), like the find match line.
 */
export function isPinnedSlice(lines: DiffLine[], pins: Set<string>, lineKeys: string[] = []): boolean {
  if (pins.size === 0 && lineKeys.length === 0) {
    return false;
  }
  return lines.some((line) =>
    (line.oldLineNumber !== null && pins.has(`old:${line.oldLineNumber}`))
    || (line.newLineNumber !== null && pins.has(`new:${line.newLineNumber}`))
    || (lineKeys.length > 0 && lineKeys.includes(diffLineKey(line))));
}
