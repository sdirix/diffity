import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseDiff } from '../../parser/src/index.js';
import { getBaseFileContent, getDiffFiles, getFileLineCounts, resolveBaseRef, resolveRef } from '../src/diff.js';
import { InputError } from '../src/errors.js';
import { isValidGitRef } from '../src/repo.js';
import { createRepo, type TempRepo } from './helpers.js';

let repo: TempRepo;
let origCwd: string;
let root: string;

beforeAll(() => {
  origCwd = process.cwd();
  repo = createRepo();
  repo.write('a.txt', 'one\ntwo\n');
  repo.commit('root');
  root = repo.git('rev-parse', 'HEAD').trim();
  repo.write('a.txt', 'one\n');
  repo.commit('second');
  repo.write('untracked.txt', 'new\n');
  process.chdir(repo.dir);
});

afterAll(() => {
  process.chdir(origCwd);
  repo.remove();
});

describe('the parent range of a root commit', () => {
  it('diffs the commit against the empty tree', () => {
    for (const ref of [`${root}~1..${root}`, `${root}^..${root}`, `${root.slice(0, 7)}~1..${root.slice(0, 7)}`]) {
      const diff = parseDiff(resolveRef(ref));
      expect(diff.files.map((file) => [file.newPath, file.status])).toEqual([['a.txt', 'added']]);
      expect(getDiffFiles(ref)).toEqual(['a.txt']);
    }
  });

  it('has an empty old side', () => {
    const base = resolveBaseRef(`${root}~1..${root}`);
    expect(base).toEqual({ type: 'empty' });
    expect(getFileLineCounts(['a.txt'], base)).toEqual([null]);
    expect(() => getBaseFileContent('a.txt', base)).toThrow(InputError);
  });

  it('still rejects a parent range that does not end at the commit', () => {
    expect(() => resolveRef(`${root}~1..HEAD`)).toThrow(InputError);
    expect(() => resolveBaseRef(`${root}~1..HEAD`)).toThrow(InputError);
  });

  it('is a valid ref exactly when it can be diffed', () => {
    expect(isValidGitRef(`${root}~1..${root}`)).toBe(true);
    expect(isValidGitRef(`${root}^..${root}`)).toBe(true);
    expect(isValidGitRef(`${root}..HEAD`)).toBe(true);
    expect(isValidGitRef(`${root}~1..HEAD`)).toBe(false);
    expect(isValidGitRef(`${root}~1`)).toBe(false);
  });
});
