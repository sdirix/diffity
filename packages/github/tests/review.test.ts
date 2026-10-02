import { describe, it, expect } from 'vitest';
import type { RemoteThread } from '../src/graphql.js';
import { anchorFromDiffHunk, buildReviewPlan, composeReviewBody, mapRemoteThread, matchPostedThreads } from '../src/review.js';

const HUNK = [
  '@@ -10,5 +10,6 @@ function f() {',
  ' ctx10',
  '-old11',
  '-old12',
  '+new11',
  '+new12',
  '+new13',
  ' ctx13',
].join('\n');

function remote(overrides: Partial<RemoteThread>): RemoteThread {
  return {
    id: 'T1',
    isResolved: false,
    isOutdated: false,
    path: 'src/a.ts',
    line: 13,
    startLine: 12,
    originalLine: 13,
    originalStartLine: 12,
    diffSide: 'RIGHT',
    subjectType: 'LINE',
    diffHunk: HUNK,
    comments: [],
    ...overrides,
  };
}

describe('anchorFromDiffHunk', () => {
  it('reads the lines of either side', () => {
    expect(anchorFromDiffHunk(HUNK, 'new', 12, 13)).toBe('new12\nnew13');
    expect(anchorFromDiffHunk(HUNK, 'new', 10, 10)).toBe('ctx10');
    expect(anchorFromDiffHunk(HUNK, 'old', 11, 12)).toBe('old11\nold12');
    expect(anchorFromDiffHunk(HUNK, 'old', 13, 13)).toBe('ctx13');
  });

  it('gives up on lines the hunk does not hold', () => {
    expect(anchorFromDiffHunk(HUNK, 'new', 15, 16)).toBeNull();
    expect(anchorFromDiffHunk('not a hunk', 'new', 1, 1)).toBeNull();
  });

  it('skips the no newline marker', () => {
    expect(anchorFromDiffHunk('@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b', 'new', 1, 1)).toBe('b');
  });
});

describe('mapRemoteThread', () => {
  it('keeps a current thread on the lines GitHub moved it to', () => {
    expect(mapRemoteThread(remote({ line: 23, startLine: 22, isResolved: true }))).toEqual({
      filePath: 'src/a.ts',
      side: 'new',
      startLine: 22,
      endLine: 23,
      resolved: true,
      anchorContent: 'new12\nnew13',
    });
  });

  it('files an outdated thread on its original lines', () => {
    expect(mapRemoteThread(remote({ line: null, startLine: null, isOutdated: true, diffSide: 'LEFT', originalLine: 12, originalStartLine: 11 })))
      .toMatchObject({ side: 'old', startLine: 11, endLine: 12, anchorContent: 'old11\nold12' });
  });

  it('maps single lines and whole file threads', () => {
    expect(mapRemoteThread(remote({ startLine: null, originalStartLine: null }))).toMatchObject({ startLine: 13, endLine: 13, anchorContent: 'new13' });
    expect(mapRemoteThread(remote({ subjectType: 'FILE', line: null, originalLine: null })))
      .toEqual({ filePath: 'src/a.ts', side: 'new', startLine: 0, endLine: 0, resolved: false, anchorContent: null });
  });

  it('skips a line thread without lines', () => {
    expect(mapRemoteThread(remote({ line: null, originalLine: null }))).toBeNull();
  });
});

describe('buildReviewPlan', () => {
  const candidate = (threadId: string, filePath: string, side: string, startLine: number, endLine: number, body = 'fix this') =>
    ({ threadId, filePath, side, startLine, endLine, body });

  it('splits line, file and general threads', () => {
    const plan = buildReviewPlan([
      candidate('range', 'a.ts', 'new', 3, 7),
      candidate('old', 'a.ts', 'old', 5, 5),
      candidate('file', 'b.ts', 'new', 0, 0, '  whole file  '),
      candidate('general', '__general__', 'new', 0, 0, 'Looks good overall'),
      candidate('empty', 'a.ts', 'new', 1, 1, '  '),
    ]);
    expect(plan.drafts).toEqual([
      { threadId: 'range', path: 'a.ts', body: 'fix this', side: 'RIGHT', startLine: 3, line: 7 },
      { threadId: 'old', path: 'a.ts', body: 'fix this', side: 'LEFT', startLine: 5, line: 5 },
      { threadId: 'file', path: 'b.ts', body: 'whole file', side: 'RIGHT', startLine: 0, line: 0 },
    ]);
    expect(plan.bodySections).toEqual(['Looks good overall']);
    expect(plan.inBody).toEqual(['general']);
  });

  it('puts the summary before the general comments', () => {
    expect(composeReviewBody(' summary ', ['a', ' ', 'b'])).toBe('summary\n\na\n\nb');
    expect(composeReviewBody('', [])).toBe('');
  });
});

describe('matchPostedThreads', () => {
  const posted = (id: string, path: string, line: number | null, body: string, review = 'R1') => remote({
    id, path, line, originalLine: line, subjectType: line === null ? 'FILE' : 'LINE',
    comments: [{ databaseId: Number(id.slice(1)), body, createdAt: '', author: null, pullRequestReview: { id: review } }],
  });

  it('finds the threads of the review by path, line and text', () => {
    const drafts = [
      { threadId: 'a', path: 'a.ts', body: 'same', side: 'RIGHT' as const, startLine: 2, line: 2 },
      { threadId: 'b', path: 'a.ts', body: 'same', side: 'RIGHT' as const, startLine: 9, line: 9 },
      { threadId: 'c', path: 'b.ts', body: 'gone', side: 'RIGHT' as const, startLine: 1, line: 1 },
    ];
    const result = matchPostedThreads(drafts, [
      posted('T1', 'a.ts', 9, 'same'),
      posted('T2', 'a.ts', 2, 'same\r\n'),
      posted('T3', 'b.ts', 1, 'gone', 'R0'),
    ], 'R1');
    expect(result.posted).toEqual([
      { threadId: 'a', githubThreadId: 'T2', commentId: 2 },
      { threadId: 'b', githubThreadId: 'T1', commentId: 1 },
    ]);
    expect(result.unmatched.map((d) => d.threadId)).toEqual(['c']);
  });
});
