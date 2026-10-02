import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getDiffFiles, getFileContent, getUntrackedFiles, resolveRef, revertFile } from '../src/diff.js';
import { getRepoRoot } from '../src/exec.js';
import { getStagedFiles, getUnstagedFiles } from '../src/status.js';
import { getTree, getWorkingTreeFileContent } from '../src/tree.js';
import { createRepo, type TempRepo } from './helpers.js';

let repo: TempRepo;
let origCwd: string;

beforeAll(() => {
  origCwd = process.cwd();
  repo = createRepo();
  repo.write('README.md', 'root\n');
  repo.write('sub/inner.txt', 'inner\n');
  repo.commit('initial');
  repo.write('README.md', 'root changed\n');
  repo.write('sub/inner.txt', 'inner changed\n');
  repo.write('top-new.txt', 'new\n');
  repo.write('sub/sub-new.txt', 'new\n');
  repo.write('sub/staged.txt', 'staged\n');
  repo.git('add', 'sub/staged.txt');
  process.chdir(join(repo.dir, 'sub'));
});

afterAll(() => {
  process.chdir(origCwd);
  repo.remove();
});

describe('running from a subdirectory', () => {
  it('resolves the repo root', () => {
    expect(getRepoRoot()).toBe(repo.git('rev-parse', '--show-toplevel').trim());
  });

  it('lists untracked files of the whole repo relative to the root', () => {
    expect(getUntrackedFiles().sort()).toEqual(['sub/sub-new.txt', 'top-new.txt']);
  });

  it('lists the whole tree relative to the root', () => {
    expect(getTree()).toEqual(['README.md', 'sub/inner.txt', 'sub/staged.txt', 'sub/sub-new.txt', 'top-new.txt']);
  });

  it('diffs the whole repo', () => {
    const raw = resolveRef('work');
    expect(raw).toContain('+++ b/README.md');
    expect(raw).toContain('+++ b/sub/inner.txt');
    expect(raw).toContain('+++ b/top-new.txt');
    expect(raw).toContain('+++ b/sub/sub-new.txt');
    expect(getDiffFiles('work').sort()).toEqual(['README.md', 'sub/inner.txt', 'sub/staged.txt', 'sub/sub-new.txt', 'top-new.txt']);
    expect(getStagedFiles()).toEqual(['sub/staged.txt']);
    expect(getUnstagedFiles().sort()).toEqual(['README.md', 'sub/inner.txt']);
  });

  it('reads and reverts files by root relative path', () => {
    expect(getFileContent('sub/inner.txt', 'HEAD')).toBe('inner\n');
    expect(getWorkingTreeFileContent('README.md')).toBe('root changed\n');
    revertFile('README.md');
    revertFile('top-new.txt');
    expect(repo.read('README.md')).toBe('root\n');
    expect(existsSync(join(repo.dir, 'top-new.txt'))).toBe(false);
  });
});
