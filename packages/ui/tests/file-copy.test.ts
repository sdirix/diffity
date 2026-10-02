import { describe, expect, it } from 'vitest';
import { absolutePath, lineCount } from '../src/lib/file-copy';

describe('absolutePath', () => {
  it('joins the repository root and a relative path', () => {
    expect(absolutePath('/work/repo', 'src/app.ts')).toBe('/work/repo/src/app.ts');
    expect(absolutePath('/work/repo/', 'src')).toBe('/work/repo/src');
  });

  it('returns the root for the empty path', () => {
    expect(absolutePath('/work/repo/', '')).toBe('/work/repo');
  });
});

describe('lineCount', () => {
  it('does not count the empty line after a final newline', () => {
    expect(lineCount('a\nb\n')).toBe(2);
    expect(lineCount('a\nb')).toBe(2);
    expect(lineCount('\n')).toBe(1);
    expect(lineCount('')).toBe(0);
  });
});
