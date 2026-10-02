import { describe, expect, it } from 'vitest';
import { commitRef, isBranchRef, looksLikeRef, parseCommitRef, refLabel, shortRef, uncommittedTwins } from '../src/lib/refs';

const SHA = '19545978b56d2f86c08422e9461b70bfd00c2f54';

describe('commit refs', () => {
  it('round trip through the parent range', () => {
    expect(commitRef(SHA)).toBe(`${SHA}~1..${SHA}`);
    expect(parseCommitRef(commitRef(SHA))).toBe(SHA);
    expect(parseCommitRef('1954597~1..1954597')).toBe('1954597');
  });

  it('are only parent ranges of one commit', () => {
    expect(parseCommitRef(`${SHA}~1..HEAD`)).toBeNull();
    expect(parseCommitRef('main~1..main')).toBeNull();
    expect(parseCommitRef(SHA)).toBeNull();
  });
});

describe('uncommittedTwins', () => {
  it('pairs a single ref with its committed range', () => {
    expect(uncommittedTwins('origin/main')).toEqual({ all: 'origin/main', committed: 'origin/main...HEAD' });
    expect(uncommittedTwins('origin/main...HEAD')).toEqual({ all: 'origin/main', committed: 'origin/main...HEAD' });
    expect(uncommittedTwins('HEAD~3')).toEqual({ all: 'HEAD~3', committed: 'HEAD~3...HEAD' });
  });

  it('has nothing for the working tree, other ranges and commits', () => {
    expect(uncommittedTwins('work')).toBeNull();
    expect(uncommittedTwins('staged')).toBeNull();
    expect(uncommittedTwins('main..feature')).toBeNull();
    expect(uncommittedTwins('main...feature')).toBeNull();
    expect(uncommittedTwins('...HEAD')).toBeNull();
    expect(uncommittedTwins(commitRef(SHA))).toBeNull();
  });
});

describe('refLabel', () => {
  it('names the working tree refs', () => {
    expect(refLabel('work', 'feature', 'origin/main')).toEqual({ kind: 'work', label: 'Uncommitted changes' });
    expect(refLabel('staged', null, null).label).toBe('Staged changes');
    expect(refLabel('unstaged', null, null).label).toBe('Unstaged changes');
  });

  it('compares the branch with its base, with or without uncommitted changes', () => {
    expect(refLabel('origin/main', 'feature', 'origin/main')).toEqual({ kind: 'branch', label: 'feature vs main' });
    expect(refLabel('origin/main...HEAD', 'feature', 'origin/main').label).toBe('feature vs main');
    expect(isBranchRef('main', 'origin/main')).toBe(false);
  });

  it('names commits, ranges and single refs', () => {
    expect(refLabel(commitRef(SHA), null, null)).toEqual({ kind: 'commit', label: 'Commit 1954597' });
    expect(refLabel('main..feature', null, null)).toEqual({ kind: 'range', label: 'main → feature' });
    expect(refLabel('main...', null, null).label).toBe('main → HEAD');
    expect(refLabel(`${SHA}~2..${SHA}`, null, null).label).toBe('1954597~2 → 1954597');
    expect(refLabel('HEAD~3', null, null)).toEqual({ kind: 'ref', label: 'Changes since HEAD~3' });
  });
});

describe('shortRef', () => {
  it('cuts a leading long hash only', () => {
    expect(shortRef(SHA)).toBe('1954597');
    expect(shortRef(`${SHA}^`)).toBe('1954597^');
    expect(shortRef('deadbeefcafe-branch')).toBe('deadbeefcafe-branch');
  });
});

describe('looksLikeRef', () => {
  it('tells refs from search words', () => {
    for (const text of ['main..feature', 'a...b', '1954597', SHA, 'HEAD~3', 'main^', 'HEAD']) {
      expect(looksLikeRef(text), text).toBe(true);
    }
    for (const text of ['fix login', 'main', 'cafe', 'feature/x', 'v1.0']) {
      expect(looksLikeRef(text), text).toBe(false);
    }
  });
});
