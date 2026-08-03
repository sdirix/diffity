import { describe, it, expect } from 'vitest';
import { resolveHeadRef } from '../src/diff.js';

describe('resolveHeadRef', () => {
  it('reads the index for staged diffs', () => {
    expect(resolveHeadRef('staged')).toEqual({ type: 'index' });
  });

  it('reads the working tree for working-tree refs', () => {
    expect(resolveHeadRef('work')).toEqual({ type: 'worktree' });
    expect(resolveHeadRef('.')).toEqual({ type: 'worktree' });
    expect(resolveHeadRef('unstaged')).toEqual({ type: 'worktree' });
  });

  it('reads the working tree for a single ref, which git diffs against it', () => {
    expect(resolveHeadRef('HEAD~3')).toEqual({ type: 'worktree' });
    expect(resolveHeadRef('main')).toEqual({ type: 'worktree' });
  });

  it('reads the right end of a range', () => {
    expect(resolveHeadRef('main..feature')).toEqual({ type: 'ref', ref: 'feature' });
    expect(resolveHeadRef('main...feature')).toEqual({ type: 'ref', ref: 'feature' });
    expect(resolveHeadRef('HEAD~5..HEAD~2')).toEqual({ type: 'ref', ref: 'HEAD~2' });
  });

  it('defaults an omitted right end to HEAD, matching git', () => {
    expect(resolveHeadRef('main..')).toEqual({ type: 'ref', ref: 'HEAD' });
    expect(resolveHeadRef('main...')).toEqual({ type: 'ref', ref: 'HEAD' });
  });
});
