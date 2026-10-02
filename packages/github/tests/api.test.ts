import { describe, it, expect, afterEach } from 'vitest';
import { fetchReviewThreads, findPullRequest, replyToThread, setThreadResolved, submitReview } from '../src/api.js';
import { fakeGh, type FakeGh } from './fake-gh.js';

let gh: FakeGh | null = null;

afterEach(() => {
  gh?.restore();
  gh = null;
});

const comment = (id: number, body: string, typename = 'User') => ({
  databaseId: id,
  body,
  createdAt: '2026-01-01T00:00:00Z',
  author: { login: `user${id}`, avatarUrl: null, __typename: typename },
  pullRequestReview: { id: 'R1' },
});

const thread = (id: string, comments: object[], hasMore = false) => ({
  id,
  isResolved: false,
  isOutdated: false,
  path: 'a.txt',
  line: 1,
  startLine: null,
  originalLine: 1,
  originalStartLine: null,
  diffSide: 'RIGHT',
  subjectType: 'LINE',
  root: { nodes: [{ diffHunk: '@@ -1 +1 @@\n-x\n+y' }] },
  comments: { pageInfo: { hasNextPage: hasMore, endCursor: hasMore ? 'C2' : null }, nodes: comments },
});

const threadsPage = (threads: object[], cursor: string | null) => ({
  data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: !!cursor, endCursor: cursor }, nodes: threads } } } },
});

describe('findPullRequest', () => {
  it('looks the pull request up in the repository of its URL', () => {
    gh = fakeGh([
      { number: 7, url: 'https://github.com/base/repo/pull/7' },
      {
        data: {
          viewer: { login: 'me' },
          repository: {
            pullRequest: {
              id: 'PR_7', number: 7, title: 'Add x', url: 'https://github.com/base/repo/pull/7', state: 'OPEN', isDraft: false,
              body: null, createdAt: '2026-01-01T00:00:00Z', author: null, baseRefName: 'main', baseRefOid: 'b'.repeat(40),
              headRefName: 'feat', headRefOid: 'h'.repeat(40), reviewDecision: null, additions: 1, deletions: 2, changedFiles: 3,
              reviewThreads: { totalCount: 4 },
            },
          },
        },
      },
    ]);
    const pr = findPullRequest()!;
    expect(pr).toMatchObject({ slug: { owner: 'base', name: 'repo' }, number: 7, author: 'ghost', body: '', reviewThreadCount: 4, viewerLogin: 'me' });
    expect(gh.calls()[0].args).toEqual(['pr', 'view', '--json', 'number,url']);
    expect(gh.calls()[1].args).toEqual(['api', 'graphql', '--input', '-']);
    expect(gh.graphqlCalls()[0].variables).toEqual({ owner: 'base', name: 'repo', number: 7 });
  });

  it('is null without a pull request', () => {
    gh = fakeGh([{ stderr: 'no pull requests found for branch "x"', code: 1 }]);
    expect(findPullRequest()).toBeNull();
  });
});

describe('fetchReviewThreads', () => {
  it('pages through threads and their comments', () => {
    gh = fakeGh([
      threadsPage([thread('T1', [comment(1, 'first')], true)], 'P2'),
      { data: { node: { comments: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [comment(2, 'reply', 'Bot')] } } } },
      threadsPage([thread('T2', [comment(3, 'other')])], null),
    ]);
    const threads = fetchReviewThreads({ owner: 'o', name: 'r' }, 5);
    expect(threads.map((t) => [t.id, t.comments.map((c) => c.body)])).toEqual([['T1', ['first', 'reply']], ['T2', ['other']]]);
    expect(threads[0].diffHunk).toBe('@@ -1 +1 @@\n-x\n+y');
    const variables = gh.graphqlCalls().map((c) => c.variables);
    expect(variables).toEqual([
      { owner: 'o', name: 'r', number: 5, after: null },
      { id: 'T1', after: 'C2' },
      { owner: 'o', name: 'r', number: 5, after: 'P2' },
    ]);
  });

  it('reports GraphQL errors gh exits with', () => {
    gh = fakeGh([{ stdout: '{"data":null,"errors":[{"message":"Resource not accessible"}]}', stderr: 'gh: Resource not accessible', code: 1 }]);
    expect(() => fetchReviewThreads({ owner: 'o', name: 'r' }, 5)).toThrow('Resource not accessible');
  });
});

describe('submitReview', () => {
  const pr = {
    slug: { owner: 'o', name: 'r' }, id: 'PR_1', number: 1, headRefOid: 'abc',
  } as Parameters<typeof submitReview>[0];
  const line = { threadId: 't1', path: 'a.ts', body: 'fix', side: 'RIGHT' as const, startLine: 2, line: 4 };
  const file = { threadId: 't2', path: 'b.ts', body: 'whole', side: 'RIGHT' as const, startLine: 0, line: 0 };
  const review = (key: string, id: string) => ({ data: { [key]: { pullRequestReview: { id, url: `https://github.com/o/r/pull/1#${id}` } } } });
  const thread = (id: string, commentId: number) => ({ data: { addPullRequestReviewThread: { thread: { id, comments: { nodes: [{ databaseId: commentId }] } } } } });
  const mutations = () => gh!.graphqlCalls().map((c) => [c.query.match(/\{(\w+)\(/)![1], c.variables.input]);

  it('posts line threads with the review in one call', () => {
    gh = fakeGh([review('addPullRequestReview', 'R1')]);
    const posted = submitReview(pr, { event: 'REQUEST_CHANGES', body: 'please', drafts: [line], pending: null });
    expect(posted).toEqual({ id: 'R1', url: 'https://github.com/o/r/pull/1#R1', threads: [] });
    expect(mutations()).toEqual([[
      'addPullRequestReview',
      {
        pullRequestId: 'PR_1', commitOID: 'abc', event: 'REQUEST_CHANGES', body: 'please',
        threads: [{ path: 'a.ts', body: 'fix', line: 4, side: 'RIGHT', startLine: 2, startSide: 'RIGHT' }],
      },
    ]]);
  });

  it('adds whole file threads to a pending review before submitting it', () => {
    gh = fakeGh([review('addPullRequestReview', 'R1'), thread('T2', 22), review('submitPullRequestReview', 'R1')]);
    const posted = submitReview(pr, { event: 'COMMENT', body: '', drafts: [line, file], pending: null });
    expect(posted.threads).toEqual([{ threadId: 't2', githubThreadId: 'T2', commentId: 22 }]);
    expect(mutations()).toEqual([
      ['addPullRequestReview', { pullRequestId: 'PR_1', commitOID: 'abc', threads: [{ path: 'a.ts', body: 'fix', line: 4, side: 'RIGHT', startLine: 2, startSide: 'RIGHT' }] }],
      ['addPullRequestReviewThread', { pullRequestReviewId: 'R1', path: 'b.ts', body: 'whole', subjectType: 'FILE' }],
      ['submitPullRequestReview', { pullRequestReviewId: 'R1', event: 'COMMENT' }],
    ]);
  });

  it('deletes the review it started when a file thread fails', () => {
    gh = fakeGh([
      review('addPullRequestReview', 'R1'),
      { stdout: '{"data":null,"errors":[{"message":"path is invalid"}]}', code: 1 },
      { data: { deletePullRequestReview: { pullRequestReview: { id: 'R1' } } } },
    ]);
    expect(() => submitReview(pr, { event: 'COMMENT', body: '', drafts: [file], pending: null })).toThrow('GitHub rejected the review: path is invalid');
    expect(mutations().map(([name]) => name)).toEqual(['addPullRequestReview', 'addPullRequestReviewThread', 'deletePullRequestReview']);
  });

  it('adds to your pending review or discards it first', () => {
    gh = fakeGh([thread('T1', 11), thread('T2', 22), review('submitPullRequestReview', 'P1')]);
    const added = submitReview(pr, { event: 'APPROVE', body: 'ok', drafts: [line, file], pending: { id: 'P1', action: 'add' } });
    expect(added.threads.map((t) => t.githubThreadId)).toEqual(['T1', 'T2']);
    expect(mutations().map(([name, input]) => [name, (input as { pullRequestReviewId?: string }).pullRequestReviewId])).toEqual([
      ['addPullRequestReviewThread', 'P1'],
      ['addPullRequestReviewThread', 'P1'],
      ['submitPullRequestReview', 'P1'],
    ]);
    gh.restore();

    gh = fakeGh([{ data: { deletePullRequestReview: { pullRequestReview: { id: 'P1' } } } }, review('addPullRequestReview', 'R2')]);
    expect(submitReview(pr, { event: 'COMMENT', body: 'x', drafts: [line], pending: { id: 'P1', action: 'discard' } }).id).toBe('R2');
    expect(mutations()[0]).toEqual(['deletePullRequestReview', { pullRequestReviewId: 'P1' }]);
  });
});

describe('thread actions', () => {
  it('replies and resolves through GraphQL', () => {
    gh = fakeGh([
      { data: { addPullRequestReviewThreadReply: { comment: { databaseId: 42 } } } },
      { data: { resolveReviewThread: { thread: { id: 'T1', isResolved: true } } } },
      { data: { unresolveReviewThread: { thread: { id: 'T1', isResolved: false } } } },
    ]);
    expect(replyToThread('T1', 'thanks')).toBe(42);
    setThreadResolved('T1', true);
    setThreadResolved('T1', false);
    const calls = gh.graphqlCalls();
    expect(calls[0].variables).toEqual({ input: { pullRequestReviewThreadId: 'T1', body: 'thanks' } });
    expect(calls[1].query).toMatch(/^mutation\(\$id:ID!\)\{resolveReviewThread/);
    expect(calls[2].query).toMatch(/^mutation\(\$id:ID!\)\{unresolveReviewThread/);
    expect(calls.slice(1).map((c) => c.variables)).toEqual([{ id: 'T1' }, { id: 'T1' }]);
  });

  it('fails with the GraphQL error', () => {
    gh = fakeGh([{ stdout: '{"data":null,"errors":[{"message":"Resource not accessible by integration"}]}', code: 1 }]);
    expect(() => setThreadResolved('T1', true)).toThrow('Resource not accessible by integration');
  });
});
