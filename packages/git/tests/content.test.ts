import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getFileContent, getFileLineCounts, getIndexFileContent } from '../src/diff.js';
import { countLines } from '../src/text.js';
import { getWorkingTreeFileContent } from '../src/tree.js';
import { createRepo, type TempRepo } from './helpers.js';

const CONTENT = '\n\n    indented first line\n\ttabbed\n\n\n';

let repo: TempRepo;
let origCwd: string;

beforeAll(() => {
  origCwd = process.cwd();
  repo = createRepo();
  repo.write('spaced.py', CONTENT);
  repo.write('no-eol.txt', 'a\nb');
  repo.write('binary.bin', Buffer.from([0, 1, 2]));
  repo.write('dir/file.txt', 'x\n');
  repo.write('sp ace.txt', 'x\n');
  repo.write('new\nline.txt', 'x\n');
  repo.commit('initial');
  process.chdir(repo.dir);
});

afterAll(() => {
  process.chdir(origCwd);
  repo.remove();
});

describe('file content', () => {
  it('keeps leading and trailing whitespace', () => {
    expect(getFileContent('spaced.py', 'HEAD')).toBe(CONTENT);
    expect(getIndexFileContent('spaced.py')).toBe(CONTENT);
    expect(getWorkingTreeFileContent('spaced.py')).toBe(CONTENT);
  });

  it('counts lines including trailing blank ones', () => {
    const head = { type: 'ref', ref: 'HEAD' } as const;
    expect(getFileLineCounts(['spaced.py', 'missing.txt', 'no-eol.txt', 'binary.bin', 'dir', 'sp ace.txt', 'new\nline.txt'], head))
      .toEqual([6, null, 2, null, null, 1, null]);
    expect(getFileLineCounts([], head)).toEqual([]);
    expect(countLines('')).toBe(0);
    expect(countLines(Buffer.from('a\n\nb'))).toBe(3);
  });
});
