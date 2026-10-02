import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { getWorkingTreeStatus } from '../src/status.js';
import { createRepo, type TempRepo } from './helpers.js';

let repo: TempRepo;
let origCwd: string;

beforeAll(() => {
  origCwd = process.cwd();
  repo = createRepo();
  repo.write('modified.txt', 'one\n');
  repo.write('staged.txt', 'one\n');
  repo.write('old name.txt', 'renamed content\nthat git can match\n');
  repo.write('deleted.txt', 'gone\n');
  repo.write('conflict.txt', 'base\n');
  repo.write('same.txt', 'same\n');
  repo.commit('initial');

  repo.git('checkout', '-q', '-b', 'other');
  repo.write('conflict.txt', 'other\n');
  repo.commit('other');
  repo.git('checkout', '-q', 'main');
  repo.write('conflict.txt', 'main\n');
  repo.commit('main');
  try {
    repo.git('merge', '-q', 'other');
  } catch {
    // Conflicts on purpose
  }

  repo.write('modified.txt', 'two\n');
  repo.write('staged.txt', 'two\n');
  repo.git('add', 'staged.txt');
  repo.git('mv', 'old name.txt', 'new name.txt');
  repo.write('added.txt', 'new\n');
  repo.git('add', 'added.txt');
  repo.git('rm', '-q', 'deleted.txt');
  repo.write('new dir/deep/untracked.txt', 'u\n');
  process.chdir(join(repo.dir, 'new dir'));
});

afterAll(() => {
  process.chdir(origCwd);
  repo.remove();
});

describe('getWorkingTreeStatus', () => {
  it('reports each changed path relative to the root', () => {
    expect(getWorkingTreeStatus()).toEqual({
      'modified.txt': 'modified',
      'staged.txt': 'modified',
      'new name.txt': 'renamed',
      'added.txt': 'added',
      'deleted.txt': 'deleted',
      'conflict.txt': 'conflicted',
      'new dir/deep/untracked.txt': 'untracked',
    });
  });
});
