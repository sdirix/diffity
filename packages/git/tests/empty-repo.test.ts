import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseDiff } from '../../parser/src/index.js';
import { getRecentCommits } from '../src/commits.js';
import {
  getBaseFileContent,
  getDiffFiles,
  getDiffStatForRef,
  getFileLineCounts,
  resolveBaseRef,
  resolveRef,
} from '../src/diff.js';
import { InputError } from '../src/errors.js';
import { getHeadHash } from '../src/refs.js';
import { getCurrentBranch, getRepoInfo } from '../src/repo.js';
import { getStagedFiles, getUnstagedFiles } from '../src/status.js';
import { createRepo, type TempRepo } from './helpers.js';

let repo: TempRepo;
let origCwd: string;

beforeAll(() => {
  origCwd = process.cwd();
  repo = createRepo();
  repo.write('staged.txt', 'staged\n');
  repo.git('add', 'staged.txt');
  repo.write('untracked.txt', 'untracked\n');
  process.chdir(repo.dir);
});

afterAll(() => {
  process.chdir(origCwd);
  repo.remove();
});

describe('repository without commits', () => {
  it('reports the unborn branch and no HEAD', () => {
    expect(getHeadHash()).toBeNull();
    expect(getCurrentBranch()).toBe('main');
    expect(getRepoInfo().branch).toBe('main');
    expect(getRecentCommits({ count: 10 })).toEqual([]);
  });

  it('diffs working tree refs against the empty tree', () => {
    const work = parseDiff(resolveRef('work')).files;
    expect(work.map((f) => [f.newPath, f.status])).toEqual([
      ['staged.txt', 'added'],
      ['untracked.txt', 'added'],
    ]);
    expect(parseDiff(resolveRef('staged')).files.map((f) => f.newPath)).toEqual(['staged.txt']);
    expect(getDiffFiles('work').sort()).toEqual(['staged.txt', 'untracked.txt']);
    expect(getDiffStatForRef('work')).toContain('staged.txt');
    expect(getStagedFiles()).toEqual(['staged.txt']);
    expect(getUnstagedFiles()).toEqual([]);
  });

  it('has no old side', () => {
    const base = resolveBaseRef('work');
    expect(base).toEqual({ type: 'empty' });
    expect(() => getBaseFileContent('staged.txt', base)).toThrow(InputError);
    expect(getFileLineCounts(['staged.txt'], base)).toEqual([null]);
    expect(resolveBaseRef('unstaged')).toEqual({ type: 'index' });
  });

  it('rejects other refs', () => {
    expect(() => resolveRef('main')).toThrow(InputError);
    expect(() => resolveRef('HEAD~1..HEAD')).toThrow(InputError);
  });
});

describe('unstaged changes', () => {
  it('read their old side from the index', () => {
    repo.commit('initial');
    repo.write('staged.txt', 'staged\nindex\n');
    repo.git('add', 'staged.txt');
    repo.write('staged.txt', 'staged\nindex\nworktree\n');

    const base = resolveBaseRef('unstaged');
    expect(getBaseFileContent('staged.txt', base)).toBe('staged\nindex\n');
    expect(getFileLineCounts(['staged.txt'], base)).toEqual([2]);
    expect(getBaseFileContent('staged.txt', resolveBaseRef('work'))).toBe('staged\n');
  });
});
