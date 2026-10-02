import { describe, it, expect } from 'vitest';
import type { DiffFile, DiffHunk, DiffLine } from '@diffity/parser';
import { hunkUnits, isPinnedSlice, sliceHunk, sliceRowCount } from '../src/lib/hunk-slices';

/** Context, delete and add lines in turn, `groups` times. */
function alternating(groups: number): DiffLine[] {
  const lines: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (let i = 0; i < groups; i++) {
    lines.push({ type: 'context', content: 'c', oldLineNumber: oldLine++, newLineNumber: newLine++ });
    lines.push({ type: 'delete', content: 'd', oldLineNumber: oldLine++, newLineNumber: null });
    lines.push({ type: 'add', content: 'a', oldLineNumber: null, newLineNumber: newLine++ });
  }
  return lines;
}

function hunkOf(lines: DiffLine[]): DiffHunk {
  return { header: '@@ -1,600 +1,600 @@', oldStart: 1, oldCount: 600, newStart: 1, newCount: 600, lines };
}

function fileOf(hunks: DiffHunk[]): DiffFile {
  return { oldPath: 'a.ts', newPath: 'a.ts', status: 'modified', hunks, additions: 0, deletions: 0, isBinary: false };
}

describe('sliceHunk', () => {
  it('keeps short hunks whole and never cuts a delete and add run', () => {
    const lines = alternating(300);
    const hunk = hunkOf(lines);
    expect(sliceHunk({ ...hunk, lines: lines.slice(0, 30) }, 120)).toHaveLength(1);
    const slices = sliceHunk(hunk, 120);
    expect(slices.length).toBeGreaterThan(5);
    expect(slices[0].header).toBe(hunk.header);
    expect(slices.slice(1).every((slice) => slice.header === '')).toBe(true);
    expect(slices.flatMap((slice) => slice.lines)).toEqual(lines);
    for (const slice of slices.slice(1)) {
      expect(slice.lines[0].type).not.toBe('add');
    }
  });

  it('numbers each slice from its first lines', () => {
    const [, second] = sliceHunk(hunkOf(alternating(300)), 120);
    const firstOld = second.lines.find((line) => line.oldLineNumber !== null)!.oldLineNumber;
    const firstNew = second.lines.find((line) => line.newLineNumber !== null)!.newLineNumber;
    expect(second.oldStart).toBe(firstOld);
    expect(second.newStart).toBe(firstNew);
    expect(second.oldCount).toBe(second.lines.filter((line) => line.type !== 'add').length);
    expect(second.newCount).toBe(second.lines.filter((line) => line.type !== 'delete').length);
  });
});

describe('sliceRowCount', () => {
  it('counts lines in unified view and paired rows in split view', () => {
    const lines: DiffLine[] = [
      { type: 'context', content: '', oldLineNumber: 1, newLineNumber: 1 },
      { type: 'delete', content: '', oldLineNumber: 2, newLineNumber: null },
      { type: 'delete', content: '', oldLineNumber: 3, newLineNumber: null },
      { type: 'add', content: '', oldLineNumber: null, newLineNumber: 2 },
      { type: 'context', content: '', oldLineNumber: 4, newLineNumber: 3 },
      { type: 'add', content: '', oldLineNumber: null, newLineNumber: 4 },
    ];
    expect(sliceRowCount(lines, false)).toBe(6);
    expect(sliceRowCount(lines, true)).toBe(5);
  });
});

describe('hunkUnits', () => {
  it('slices only files over the threshold', () => {
    const small = hunkUnits(fileOf([hunkOf(alternating(10))]));
    expect(small.sliced).toBe(false);
    expect(small.units.map((unit) => unit.key)).toEqual(['0-0']);

    const big = hunkUnits(fileOf([hunkOf(alternating(10)), hunkOf(alternating(150))]));
    expect(big.sliced).toBe(true);
    expect(big.units.filter((unit) => unit.index === 1).length).toBeGreaterThan(1);
    expect(big.units.filter((unit) => unit.first).map((unit) => unit.index)).toEqual([0, 1]);
  });
});

describe('isPinnedSlice', () => {
  const lines = alternating(3);

  it('pins slices with a thread or form line or a kept line', () => {
    expect(isPinnedSlice(lines, new Set())).toBe(false);
    expect(isPinnedSlice(lines, new Set(['old:2']))).toBe(true);
    expect(isPinnedSlice(lines, new Set(['new:6']))).toBe(true);
    expect(isPinnedSlice(lines, new Set(['new:60']))).toBe(false);
    expect(isPinnedSlice(lines, new Set(), ['add-2'])).toBe(true);
    expect(isPinnedSlice(lines, new Set(), ['add-1'])).toBe(false);
    expect(isPinnedSlice(lines, new Set(), ['add-1', 'context-1'])).toBe(true);
  });
});
