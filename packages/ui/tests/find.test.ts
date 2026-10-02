import { describe, expect, it } from 'vitest';
import type { DiffFile, DiffLine } from '@diffity/parser';
import { carryCurrent, diffFindLines, fetchWindow, firstMatchFrom, searchLines, stepIndex, type FindLine } from '../src/lib/find';

function line(type: DiffLine['type'], content: string, oldLineNumber: number | null, newLineNumber: number | null): DiffLine {
  return { type, content, oldLineNumber, newLineNumber };
}

function file(path: string, lines: DiffLine[], extra: Partial<DiffFile> = {}): DiffFile {
  return {
    oldPath: path,
    newPath: path,
    status: 'modified',
    hunks: [{ header: '', oldStart: 1, oldCount: 0, newStart: 1, newCount: 0, lines }],
    additions: 0,
    deletions: 0,
    isBinary: false,
    ...extra,
  };
}

function plainLines(scope: string, texts: string[]): FindLine[] {
  return texts.map((text, index) => ({ scope, key: String(index + 1), text }));
}

const files = [
  file('a.ts', [line('context', 'const Foo = 1;', 1, 1), line('delete', 'foo(foo)', 2, null), line('add', 'bar()', null, 2)]),
  file('b.ts', [line('add', 'FOO', null, 1)]),
  file('gone.ts', [line('delete', 'foo', 1, null)], { status: 'deleted', newPath: '' }),
];

describe('diffFindLines', () => {
  it('indexes every hunk line with its file and rendered line key, in diff order', () => {
    expect(diffFindLines(files)).toEqual([
      { scope: 'a.ts', key: 'context-1', text: 'const Foo = 1;' },
      { scope: 'a.ts', key: 'delete-2', text: 'foo(foo)' },
      { scope: 'a.ts', key: 'add-2', text: 'bar()' },
      { scope: 'b.ts', key: 'add-1', text: 'FOO' },
      { scope: 'gone.ts', key: 'delete-1', text: 'foo' },
    ]);
  });

  it('includes files that are collapsed or not rendered', () => {
    const lockFile = file('package-lock.json', [line('add', 'foo@1.0.0', null, 1)]);
    expect(searchLines(diffFindLines([lockFile]), 'foo', false).matches).toHaveLength(1);
  });
});

describe('searchLines', () => {
  const lines = diffFindLines(files);

  it('is case-insensitive by default and finds every occurrence on a line', () => {
    const { matches, truncated } = searchLines(lines, 'foo', false);
    expect(truncated).toBe(false);
    expect(matches.map((m) => [m.scope, m.key, m.start, m.end])).toEqual([
      ['a.ts', 'context-1', 6, 9],
      ['a.ts', 'delete-2', 0, 3],
      ['a.ts', 'delete-2', 4, 7],
      ['b.ts', 'add-1', 0, 3],
      ['gone.ts', 'delete-1', 0, 3],
    ]);
  });

  it('matches case when asked', () => {
    expect(searchLines(lines, 'FOO', true).matches.map((m) => m.scope)).toEqual(['b.ts']);
  });

  it('treats the query as plain text', () => {
    expect(searchLines(lines, 'foo(', false).matches).toHaveLength(1);
    expect(searchLines(lines, '.*', false).matches).toHaveLength(0);
  });

  it('returns nothing for an empty query', () => {
    expect(searchLines(lines, '', false).matches).toEqual([]);
  });

  it('caps the matches and says so', () => {
    const many = plainLines('big.txt', Array.from({ length: 100 }, () => 'aaaa'));
    const result = searchLines(many, 'a', false, 50);
    expect(result.matches).toHaveLength(50);
    expect(result.truncated).toBe(true);
  });

  it('keeps offsets right when lowercasing changes the length of a line', () => {
    const tricky = plainLines('x', ['İstanbul foo']);
    const [match] = searchLines(tricky, 'FOO', false).matches;
    expect(tricky[0].text.slice(match.start, match.end)).toBe('foo');
  });
});

describe('position helpers', () => {
  const lines = diffFindLines(files);
  const { matches } = searchLines(lines, 'foo', false);

  it('starts from the file being read', () => {
    expect(firstMatchFrom(lines, matches, 'b.ts')).toBe(3);
    expect(firstMatchFrom(lines, matches, null)).toBe(0);
    expect(firstMatchFrom(lines, matches, 'missing.ts')).toBe(0);
  });

  it('keeps the current match across a refreshed result', () => {
    const refreshed = searchLines(diffFindLines(files.slice(1)), 'foo', false).matches;
    expect(carryCurrent(matches[3], refreshed)).toBe(0);
    expect(carryCurrent(matches[0], refreshed)).toBe(-1);
    expect(carryCurrent(null, refreshed)).toBe(-1);
  });

  it('steps through the matches and wraps around', () => {
    expect(stepIndex(-1, 5, 1)).toBe(0);
    expect(stepIndex(-1, 5, -1)).toBe(4);
    expect(stepIndex(4, 5, 1)).toBe(0);
    expect(stepIndex(0, 5, -1)).toBe(4);
    expect(stepIndex(2, 5, 1)).toBe(3);
    expect(stepIndex(0, 0, 1)).toBe(-1);
  });
});

describe('fetchWindow', () => {
  it('fetches the first files that are not settled, up to the limit', () => {
    expect(fetchWindow([false, false, false, false], 2)).toEqual([true, true, false, false]);
  });

  it('moves on as files settle', () => {
    expect(fetchWindow([true, false, true, false, false], 2)).toEqual([true, true, true, true, false]);
  });
});
