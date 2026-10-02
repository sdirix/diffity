import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getRecentCommits } from '../src/commits.js';
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
