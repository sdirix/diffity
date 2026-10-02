import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getBranchReflog, getHeadHash, isAncestor } from '../src/refs.js';
import { createRepo, type TempRepo } from './helpers.js';

let repo: TempRepo;
let origCwd: string;
let first: string;
let amended: string;

beforeAll(() => {
  origCwd = process.cwd();
  repo = createRepo();
  process.chdir(repo.dir);
  repo.write('a.txt', 'one\n');
  repo.commit('first');
  first = getHeadHash()!;
  repo.write('a.txt', 'two\n');
  repo.commit('second');
  amended = getHeadHash()!;
  repo.git('commit', '-q', '--amend', '-m', 'second, amended');
});

afterAll(() => {
  process.chdir(origCwd);
  repo.remove();
});

describe('isAncestor', () => {
  it('holds for a commit and its history only', () => {
    expect(isAncestor(first, 'HEAD')).toBe(true);
    expect(isAncestor('HEAD', 'HEAD')).toBe(true);
    expect(isAncestor(amended, 'HEAD')).toBe(false);
    expect(isAncestor('no-such-commit', 'HEAD')).toBe(false);
  });
});

describe('getBranchReflog', () => {
  it('lists commits the branch pointed to, amended ones included', () => {
    expect(getBranchReflog('main')).toEqual([getHeadHash(), amended, first]);
  });

  it('is empty for an unknown branch', () => {
    expect(getBranchReflog('nope')).toEqual([]);
  });
});
