import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getCommit, getRecentCommits } from '../src/commits.js';
import { createRepo, type TempRepo } from './helpers.js';

const SUBJECTS = ['first | with pipe', 'second [bracket( $(touch pwned)', 'third'];

let repo: TempRepo;
let origCwd: string;

beforeAll(() => {
  origCwd = process.cwd();
  repo = createRepo();
  for (const [i, subject] of SUBJECTS.entries()) {
    repo.write('file.txt', `${i}\n`);
    repo.commit(subject);
  }
  process.chdir(repo.dir);
});

afterAll(() => {
  process.chdir(origCwd);
  repo.remove();
});

describe('getRecentCommits', () => {
  it('keeps subjects with separators intact', () => {
    const commits = getRecentCommits({ count: 10 });
    expect(commits.map((c) => c.message)).toEqual([...SUBJECTS].reverse());
    expect(commits[2].hash).toBe(repo.git('rev-parse', 'HEAD~2').trim());
    expect(commits[2].shortHash).toMatch(/^[0-9a-f]{7,}$/);
    expect(commits[2].relativeDate).toMatch(/ago$/);
  });

  it('reads the author', () => {
    const [commit] = getRecentCommits({ count: 1 });
    expect(commit.authorName).toBe(repo.git('log', '-1', '--format=%an').trim());
    expect(commit.authorEmail).toBe(repo.git('log', '-1', '--format=%ae').trim());
    expect(commit.authorEmail).toContain('@');
  });

  it('pages with count and skip', () => {
    expect(getRecentCommits({ count: 1, skip: 1 }).map((c) => c.message)).toEqual([SUBJECTS[1]]);
    expect(getRecentCommits({ count: NaN }).length).toBe(3);
  });

  it('searches for the literal text, case-insensitively', () => {
    expect(getRecentCommits({ count: 10, search: 'WITH PIPE' }).map((c) => c.message)).toEqual([SUBJECTS[0]]);
    expect(getRecentCommits({ count: 10, search: '[bracket(' }).map((c) => c.message)).toEqual([SUBJECTS[1]]);
    expect(getRecentCommits({ count: 10, search: 'nothing' })).toEqual([]);
  });
});

describe('getCommit', () => {
  it('reads the commit a rev names', () => {
    const commit = getCommit('HEAD~1');
    expect(commit?.hash).toBe(repo.git('rev-parse', 'HEAD~1').trim());
    expect(commit?.message).toBe(SUBJECTS[1]);
    expect(getCommit(commit!.shortHash)?.hash).toBe(commit!.hash);
  });

  it('is null for anything else', () => {
    expect(getCommit('nope')).toBeNull();
    expect(getCommit('HEAD~9')).toBeNull();
    expect(getCommit('--all')).toBeNull();
  });
});
