import { describe, expect, it } from 'vitest';
import { fuzzyMatch, highlightSegments } from '../src/lib/fuzzy';

function best(query: string, texts: string[]): string | undefined {
  return texts
    .map((text) => ({ text, match: fuzzyMatch(query, text) }))
    .filter((entry) => entry.match)
    .sort((a, b) => b.match!.score - a.match!.score)[0]?.text;
}

describe('fuzzyMatch', () => {
  it('matches everything for an empty query', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, positions: [] });
    expect(fuzzyMatch('   ', 'anything')).toEqual({ score: 0, positions: [] });
  });

  it('returns null when the characters are missing or out of order', () => {
    expect(fuzzyMatch('xyz', 'diff-view.tsx')).toBeNull();
    expect(fuzzyMatch('vd', 'vd')).not.toBeNull();
    expect(fuzzyMatch('wv', 'view')).toBeNull();
  });

  it('ignores case', () => {
    expect(fuzzyMatch('README', 'readme.md')?.positions).toEqual([0, 1, 2, 3, 4, 5]);
    expect(fuzzyMatch('readme', 'README.md')?.positions).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('marks a contiguous occurrence', () => {
    expect(fuzzyMatch('view', 'src/diff-view.tsx')?.positions).toEqual([9, 10, 11, 12]);
  });

  it('prefers the occurrence at a word start', () => {
    expect(fuzzyMatch('bar', 'foobar/bar.ts')?.positions).toEqual([7, 8, 9]);
  });

  it('matches a query with spaces against words in between', () => {
    expect(fuzzyMatch('dark theme', 'Switch to dark theme')?.positions).toEqual(
      Array.from({ length: 10 }, (_, i) => 10 + i),
    );
    expect(fuzzyMatch('sw theme', 'Switch to dark theme')?.positions).toEqual([0, 1, 15, 16, 17, 18, 19]);
  });

  it('matches scattered characters in order', () => {
    expect(fuzzyMatch('fb', 'find-bar.tsx')?.positions).toEqual([0, 5]);
  });

  it('prefers characters within the file name over the folders', () => {
    expect(fuzzyMatch('cp', 'components/command-palette.tsx')?.positions).toEqual([11, 19]);
  });

  it('falls back to the whole path when the file name alone does not match', () => {
    expect(fuzzyMatch('uidv', 'packages/ui/diff-view.tsx')?.positions).toEqual([9, 10, 12, 17]);
  });

  it('ranks word starts above characters inside words', () => {
    expect(best('dv', ['src/advance.ts', 'src/diff-view.ts'])).toBe('src/diff-view.ts');
  });

  it('ranks camelCase humps as word starts', () => {
    expect(best('dp', ['deep.ts', 'diffPage.ts'])).toBe('diffPage.ts');
  });

  it('ranks file name matches above folder matches', () => {
    expect(best('find', ['finder/index.ts', 'lib/find.ts'])).toBe('lib/find.ts');
  });

  it('ranks shorter texts higher for the same match', () => {
    expect(best('find', ['lib/find-highlight.ts', 'lib/find.ts'])).toBe('lib/find.ts');
  });

  it('ranks a contiguous match above a scattered one', () => {
    expect(best('pal', ['p-a-l.ts', 'palette.ts'])).toBe('palette.ts');
  });

  it('keeps positions valid when lower casing changes the length', () => {
    const text = 'İstanbul';
    const match = fuzzyMatch('stan', text);
    expect(match?.positions).toEqual([1, 2, 3, 4]);
    expect(match!.positions.map((index) => text[index]).join('')).toBe('stan');
  });
});

describe('highlightSegments', () => {
  it('splits the text into matched and unmatched runs', () => {
    expect(highlightSegments('diff-view', [0, 1, 5])).toEqual([
      { text: 'di', match: true },
      { text: 'ff-', match: false },
      { text: 'v', match: true },
      { text: 'iew', match: false },
    ]);
  });

  it('returns one unmatched run without positions', () => {
    expect(highlightSegments('abc', [])).toEqual([{ text: 'abc', match: false }]);
  });

  it('returns nothing for empty text', () => {
    expect(highlightSegments('', [])).toEqual([]);
  });
});
