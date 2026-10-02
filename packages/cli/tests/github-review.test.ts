import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parseDiff } from '@diffity/parser';
import type { PullRequest } from '@diffity/github';
import { fakeGh, type FakeGh } from '../../github/tests/fake-gh.js';
import { postableReason, postReview, REASONS, reviewCandidates, sessionAnchor, type PrDiff, type SessionAnchor } from '../src/github-review.js';
import { findOrCreateSession } from '../src/session.js';
import { addReply, createThread, getThreadsForSession } from '../src/threads.js';
import { indexDiff } from '../src/thread-location.js';
import { createRepo, type TempRepo } from './helpers.js';

const PATCH = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -10,4 +10,5 @@ fn
 ctx10
-old11
+new11
+new12
 ctx12
 ctx13
diff --git a/src/b.ts b/src/b.ts
new file mode 100644
--- /dev/null
+++ b/src/b.ts
@@ -0,0 +1 @@
+b
`;

const thread = (filePath: string, side: string, startLine: number, endLine: number) => ({ filePath, side, startLine, endLine });

describe('postableReason', () => {
  const pr: PrDiff = { index: indexDiff(parseDiff(PATCH)), locallyChanged: new Set() };
  const prView: SessionAnchor = { newMatches: true, oldMatches: true, isPrSession: true, newIsLocal: true };
  const work: SessionAnchor = { newMatches: true, oldMatches: false, isPrSession: false, newIsLocal: true };
  const commit: SessionAnchor = { newMatches: true, oldMatches: true, isPrSession: false, newIsLocal: false };
  const stale: SessionAnchor = { newMatches: false, oldMatches: false, isPrSession: false, newIsLocal: false };

  it('maps lines against the PR diff', () => {
    expect(postableReason(thread('src/a.ts', 'new', 11, 12), prView, pr)).toBeNull();
    expect(postableReason(thread('src/a.ts', 'new', 10, 14), prView, pr)).toBeNull();
    expect(postableReason(thread('src/a.ts', 'old', 11, 11), prView, pr)).toBeNull();
    expect(postableReason(thread('src/a.ts', 'new', 14, 16), prView, pr)).toBe(REASONS.outsideDiff);
    expect(postableReason(thread('src/a.ts', 'new', 3, 3), prView, pr)).toBe(REASONS.outsideDiff);
    expect(postableReason(thread('src/c.ts', 'new', 3, 3), prView, pr)).toBe(REASONS.notInPr);
    expect(postableReason(thread('src/b.ts', 'new', 0, 0), prView, pr)).toBeNull();
    expect(postableReason(thread('__general__', 'new', 0, 0), prView, pr)).toBeNull();
    expect(postableReason(thread('src/a.ts', 'new', 11, 11), null, pr)).toBe(REASONS.noView);
  });

  it('checks the side and local edits of the view', () => {
    const dirty: PrDiff = { ...pr, locallyChanged: new Set(['src/a.ts']) };
    expect(postableReason(thread('src/a.ts', 'new', 12, 12), work, pr)).toBeNull();
    expect(postableReason(thread('src/a.ts', 'new', 12, 12), work, dirty)).toBe(REASONS.localChanges);
    expect(postableReason(thread('src/a.ts', 'new', 12, 12), commit, dirty)).toBeNull();
    expect(postableReason(thread('src/a.ts', 'old', 11, 11), work, pr)).toBe(REASONS.otherBase);
    expect(postableReason(thread('src/a.ts', 'new', 11, 11), stale, pr)).toBe(REASONS.otherCommit);
    expect(postableReason(thread('__general__', 'new', 0, 0), stale, pr)).toBe(REASONS.otherCommit);
    expect(postableReason(thread('src/a.ts', 'new', 0, 0), stale, pr)).toBe(REASONS.otherCommit);
  });
});

describe('with a pull request', () => {
  let repo: TempRepo;
  let gh: FakeGh | null = null;
  let pr: PullRequest;
  let prPatch: string;
  const you = { name: 'You', type: 'user' as const };

  beforeEach(() => {
    repo = createRepo();
    repo.write('a.txt', Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
    repo.write('b.txt', 'b\n');
    repo.commit('base');
    repo.git('update-ref', 'refs/remotes/origin/main', 'HEAD');
    const base = repo.git('rev-parse', 'HEAD').trim();
    repo.git('checkout', '-q', '-b', 'feat');
    repo.write('a.txt', Array.from({ length: 10 }, (_, i) => (i === 4 ? 'line five' : `line ${i + 1}`)).join('\n') + '\n');
    repo.commit('change');
    prPatch = repo.git('diff', 'origin/main...HEAD');
    pr = {
      slug: { owner: 'o', name: 'r' }, id: 'PR_1', number: 1, title: 'Change', url: 'https://github.com/o/r/pull/1', state: 'OPEN',
      isDraft: false, body: '', createdAt: '', author: 'grace', authorAvatarUrl: null, baseRefName: 'main', baseRefOid: base,
      headRefName: 'feat', headRefOid: repo.git('rev-parse', 'HEAD').trim(), reviewDecision: null, additions: 1, deletions: 1,
      changedFiles: 1, reviewThreadCount: 0, viewerLogin: 'me',
    };
  });

  afterEach(() => {
    gh?.restore();
    gh = null;
    repo.remove();
  });

  it('anchors views to the PR head and base', () => {
    const base = pr.baseRefOid;
    expect(sessionAnchor('origin/main', 'origin/main', pr.headRefOid, base)).toEqual({ newMatches: true, oldMatches: true, isPrSession: true, newIsLocal: true });
    expect(sessionAnchor('work', 'origin/main', pr.headRefOid, base)).toEqual({ newMatches: true, oldMatches: false, isPrSession: false, newIsLocal: true });
    expect(sessionAnchor('main..feat', 'origin/main', pr.headRefOid, base)).toEqual({ newMatches: true, oldMatches: true, isPrSession: false, newIsLocal: false });
    expect(sessionAnchor('HEAD~1..HEAD~1', 'origin/main', pr.headRefOid, base)!.newMatches).toBe(false);
    expect(sessionAnchor('gone..feat', 'origin/main', pr.headRefOid, base)).toBeNull();
  });

  it('lists postable threads first with the reasons of the others', () => {
    const prView = findOrCreateSession('origin/main');
    const work = findOrCreateSession('work');
    const line = createThread(prView.id, 'a.txt', 'new', 5, 5, 'why five', you);
    createThread(prView.id, 'a.txt', 'new', 1, 1, 'far away', you);
    createThread(work.id, 'b.txt', 'new', 1, 1, 'not in pr', you);
    createThread(work.id, 'a.txt', 'old', 5, 5, 'old side', you);
    gh = fakeGh([{ stdout: prPatch }]);

    const context = reviewCandidates(pr, 'origin/main');
    expect(context.blocker).toBeNull();
    expect(context.candidates.map((c) => [c.thread.comments[0].body, c.ref, c.reason])).toEqual([
      ['why five', 'origin/main', null],
      ['far away', 'origin/main', REASONS.outsideDiff],
      ['not in pr', 'work', REASONS.notInPr],
      ['old side', 'work', REASONS.otherBase],
    ]);
    expect(gh.calls()[0].args).toEqual(['pr', 'diff', '1', '--repo', 'o/r', '--color', 'never']);
    expect(line.id).toBe(context.candidates[0].thread.id);
  });

  it('blocks posting when HEAD is not the PR head', () => {
    gh = fakeGh([{ stdout: prPatch }]);
    expect(reviewCandidates({ ...pr, headRefOid: 'f'.repeat(40) }, 'origin/main').blocker).toMatch(/^Local HEAD \w{7} is not the PR head ffffff/);
  });

  it('posts a review and links the threads it created', () => {
    const prView = findOrCreateSession('origin/main');
    const line = createThread(prView.id, 'a.txt', 'new', 5, 5, 'why five', you);
    addReply(line.id, 'and a follow up', you);
    const file = createThread(prView.id, 'a.txt', 'new', 0, 0, 'whole file', you);
    const general = createThread(prView.id, '__general__', 'new', 0, 0, 'nice work', you);
    const outside = createThread(prView.id, 'a.txt', 'new', 1, 1, 'far away', you);
    const reviewThreads = {
      data: { repository: { pullRequest: { reviewThreads: { pageInfo: null, nodes: [{
        id: 'T_line', isResolved: false, isOutdated: false, path: 'a.txt', line: 5, startLine: null, originalLine: 5, originalStartLine: null,
        diffSide: 'RIGHT', subjectType: 'LINE', root: { nodes: [] },
        comments: { nodes: [{ databaseId: 101, body: 'why five', createdAt: '', author: null, pullRequestReview: { id: 'R1' } }] },
      }] } } } },
    };
    gh = fakeGh([
      { stdout: prPatch },
      { data: { repository: { pullRequest: { reviews: { nodes: [] } } } } },
      { data: { addPullRequestReview: { pullRequestReview: { id: 'R1', url: 'https://github.com/o/r/pull/1#R1' } } } },
      { data: { addPullRequestReviewThread: { thread: { id: 'T_file', comments: { nodes: [{ databaseId: 102 }] } } } } },
      { data: { submitPullRequestReview: { pullRequestReview: { id: 'R1', url: 'https://github.com/o/r/pull/1#R1' } } } },
      reviewThreads,
      { data: { addPullRequestReviewThreadReply: { comment: { databaseId: 103 } } } },
    ]);

    const result = postReview(pr, 'origin/main', {
      event: 'REQUEST_CHANGES',
      body: 'Summary',
      threadIds: [line.id, file.id, general.id, outside.id],
      pendingAction: null,
    });
    expect(result).toEqual({ posted: 3, skipped: [`a.txt:1: ${REASONS.outsideDiff}`], errors: [], url: 'https://github.com/o/r/pull/1#R1' });

    const inputs = gh.graphqlCalls().map((c) => c.variables.input).filter(Boolean);
    expect(inputs[0]).toEqual({ pullRequestId: 'PR_1', commitOID: pr.headRefOid, threads: [{ path: 'a.txt', body: 'why five', line: 5, side: 'RIGHT' }] });
    expect(inputs[1]).toEqual({ pullRequestReviewId: 'R1', path: 'a.txt', body: 'whole file', subjectType: 'FILE' });
    expect(inputs[2]).toEqual({ pullRequestReviewId: 'R1', event: 'REQUEST_CHANGES', body: 'Summary\n\nnice work' });
    expect(inputs[3]).toEqual({ pullRequestReviewThreadId: 'T_line', body: 'and a follow up' });

    const threads = new Map(getThreadsForSession(prView.id).map((t) => [t.id, t]));
    expect(threads.get(line.id)!.githubThreadId).toBe('T_line');
    expect(threads.get(line.id)!.comments.map((c) => c.githubCommentId)).toEqual([101, 103]);
    expect(threads.get(file.id)!.githubThreadId).toBe('T_file');
    expect(threads.get(outside.id)!.githubThreadId).toBeNull();

    gh.restore();
    gh = fakeGh([{ stdout: prPatch }]);
    expect(reviewCandidates(pr, 'origin/main').candidates.map((c) => c.thread.id)).toEqual([outside.id]);
  });

  it('asks what to do with a pending review', () => {
    const prView = findOrCreateSession('origin/main');
    const line = createThread(prView.id, 'a.txt', 'new', 5, 5, 'why five', you);
    gh = fakeGh([
      { stdout: prPatch },
      { data: { repository: { pullRequest: { reviews: { nodes: [{ id: 'P1', url: null, viewerDidAuthor: true, comments: { totalCount: 2 } }] } } } } },
    ]);
    expect(() => postReview(pr, 'origin/main', { event: 'COMMENT', body: '', threadIds: [line.id], pendingAction: null }))
      .toThrow('You have a pending review on #1 with 2 comments. Add to it or discard it.');
  });
});
