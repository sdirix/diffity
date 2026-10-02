import { GitHubError } from './errors.js';
import { gh, graphql } from './exec.js';
import {
  ADD_REVIEW_MUTATION,
  ADD_THREAD_MUTATION,
  DELETE_REVIEW_MUTATION,
  PENDING_REVIEWS_QUERY,
  PR_QUERY,
  REPLY_MUTATION,
  RESOLVE_MUTATION,
  SUBMIT_REVIEW_MUTATION,
  THREADS_QUERY,
  THREAD_COMMENTS_QUERY,
  UNRESOLVE_MUTATION,
  addReviewInput,
  addThreadInput,
  nextCursor,
  nodes,
  replyInput,
  submitReviewInput,
  type Connection,
  type PendingReviewNode,
  type PrNode,
  type RemoteComment,
  type RemoteThread,
  type RemoteThreadNode,
  type ReviewDraft,
  type ReviewEvent,
} from './graphql.js';
import { parseGitHubPrUrl } from './pr-url.js';
import type { PostedThread } from './review.js';
import type { PullRequest, RepoSlug } from './types.js';

interface RepositoryData<T> {
  repository: T | null;
}

function toPullRequest(slug: RepoSlug, node: PrNode, viewerLogin: string | null): PullRequest {
  return {
    slug,
    id: node.id,
    number: node.number,
    title: node.title,
    url: node.url,
    state: node.state,
    isDraft: node.isDraft,
    body: node.body ?? '',
    createdAt: node.createdAt,
    author: node.author?.login ?? 'ghost',
    authorAvatarUrl: node.author?.avatarUrl ?? null,
    baseRefName: node.baseRefName,
    baseRefOid: node.baseRefOid,
    headRefName: node.headRefName,
    headRefOid: node.headRefOid,
    reviewDecision: node.reviewDecision,
    additions: node.additions,
    deletions: node.deletions,
    changedFiles: node.changedFiles,
    reviewThreadCount: node.reviewThreads?.totalCount ?? 0,
    viewerLogin,
  };
}

export function fetchPullRequest(slug: RepoSlug, number: number): PullRequest {
  const data = graphql<RepositoryData<{ pullRequest: PrNode | null }> & { viewer: { login: string } | null }>(
    PR_QUERY,
    { owner: slug.owner, name: slug.name, number },
  );
  const node = data.repository?.pullRequest;
  if (!node) {
    throw new GitHubError(`Pull request #${number} not found in ${slug.owner}/${slug.name}`);
  }
  return toPullRequest(slug, node, data.viewer?.login ?? null);
}

/**
 * The pull request of the checked out branch as `gh pr view` finds it, looked
 * up in the repository its URL names, which is the base repository of a fork.
 * `null` when there is none or gh cannot tell.
 */
export function findPullRequest(): PullRequest | null {
  let found: { url?: string };
  try {
    found = JSON.parse(gh(['pr', 'view', '--json', 'number,url']));
  } catch {
    return null;
  }
  const parsed = found.url ? parseGitHubPrUrl(found.url) : null;
  if (!parsed) {
    return null;
  }
  return fetchPullRequest({ owner: parsed.owner, name: parsed.repo }, parsed.number);
}

function fetchMoreComments(threadId: string, after: string): Connection<RemoteComment> {
  const data = graphql<{ node: { comments?: Connection<RemoteComment> } | null }>(THREAD_COMMENTS_QUERY, { id: threadId, after });
  const comments = data.node?.comments;
  if (!comments) {
    throw new GitHubError('Review thread not found');
  }
  return comments;
}

/** Every review thread of the pull request with all of its comments. */
export function fetchReviewThreads(slug: RepoSlug, number: number): RemoteThread[] {
  const threads: RemoteThread[] = [];
  let after: string | null = null;
  do {
    const data: RepositoryData<{ pullRequest: { reviewThreads: Connection<RemoteThreadNode> } | null }> = graphql(
      THREADS_QUERY,
      { owner: slug.owner, name: slug.name, number, after },
    );
    const connection = data.repository?.pullRequest?.reviewThreads;
    if (!connection) {
      throw new GitHubError(`Pull request #${number} not found in ${slug.owner}/${slug.name}`);
    }
    for (const { root, comments: page, ...thread } of nodes(connection)) {
      const comments = nodes(page);
      let cursor = nextCursor(page);
      while (cursor) {
        const more = fetchMoreComments(thread.id, cursor);
        comments.push(...nodes(more));
        cursor = nextCursor(more);
      }
      threads.push({ ...thread, diffHunk: nodes(root)[0]?.diffHunk ?? null, comments });
    }
    after = nextCursor(connection);
  } while (after);
  return threads;
}

export interface PendingReview {
  id: string;
  commentCount: number;
}

/** Your pending review of the pull request, GitHub allows one. */
export function fetchPendingReview(pr: PullRequest): PendingReview | null {
  const data = graphql<RepositoryData<{ pullRequest: { reviews: Connection<PendingReviewNode> } | null }>>(
    PENDING_REVIEWS_QUERY,
    { owner: pr.slug.owner, name: pr.slug.name, number: pr.number },
  );
  const review = nodes(data.repository?.pullRequest?.reviews).find((r) => r.viewerDidAuthor);
  return review ? { id: review.id, commentCount: review.comments.totalCount } : null;
}

/** The pull request's diff as GitHub shows it. */
export function fetchPrDiff(pr: PullRequest): string {
  return gh(['pr', 'diff', String(pr.number), '--repo', `${pr.slug.owner}/${pr.slug.name}`, '--color', 'never']);
}

function mutate<T>(query: string, input: Record<string, unknown>): T {
  try {
    return graphql<T>(query, { input });
  } catch (err) {
    throw new GitHubError(`GitHub rejected the review: ${err instanceof Error ? err.message : err}`);
  }
}

interface ReviewNode {
  id: string;
  url: string | null;
}

function addThread(reviewId: string, draft: ReviewDraft): PostedThread {
  const data = mutate<{ addPullRequestReviewThread: { thread: { id: string; comments: Connection<{ databaseId: number | null }> } | null } }>(
    ADD_THREAD_MUTATION,
    addThreadInput(reviewId, draft),
  );
  const thread = data.addPullRequestReviewThread.thread;
  if (!thread) {
    throw new GitHubError(`GitHub rejected the review: no thread for ${draft.path}`);
  }
  return { threadId: draft.threadId, githubThreadId: thread.id, commentId: nodes(thread.comments)[0]?.databaseId ?? null };
}

function submitPending(reviewId: string, event: ReviewEvent, body: string): ReviewNode {
  const data = mutate<{ submitPullRequestReview: { pullRequestReview: ReviewNode | null } }>(SUBMIT_REVIEW_MUTATION, submitReviewInput(reviewId, event, body));
  return data.submitPullRequestReview.pullRequestReview ?? { id: reviewId, url: null };
}

function addReview(input: Record<string, unknown>): ReviewNode {
  const data = mutate<{ addPullRequestReview: { pullRequestReview: ReviewNode | null } }>(ADD_REVIEW_MUTATION, input);
  const review = data.addPullRequestReview.pullRequestReview;
  if (!review) {
    throw new GitHubError('GitHub did not return a review');
  }
  return review;
}

function deleteReview(reviewId: string): void {
  mutate(DELETE_REVIEW_MUTATION, { pullRequestReviewId: reviewId });
}

export interface ReviewSubmission {
  event: ReviewEvent;
  body: string;
  drafts: ReviewDraft[];
  /** Your pending review on GitHub and whether to add to it or discard it first. */
  pending: { id: string; action: 'add' | 'discard' } | null;
}

export interface SubmittedReview {
  id: string;
  url: string | null;
  /** The drafts GitHub answered with a thread for, the others need `matchPostedThreads`. */
  threads: PostedThread[];
}

/**
 * Posts `drafts` as one review. Line threads go in with the review, so GitHub
 * takes all or none of them. `addPullRequestReview` cannot take whole file
 * threads, so with those the review starts pending, gets them added and is
 * then submitted, or deleted again when that fails.
 */
export function submitReview(pr: PullRequest, submission: ReviewSubmission): SubmittedReview {
  const { event, body, drafts, pending } = submission;
  if (pending?.action === 'add') {
    const threads = drafts.map((draft) => addThread(pending.id, draft));
    const review = submitPending(pending.id, event, body);
    return { ...review, threads };
  }
  if (pending?.action === 'discard') {
    deleteReview(pending.id);
  }
  const lines = drafts.filter((draft) => draft.line > 0);
  const files = drafts.filter((draft) => draft.line === 0);
  const base = { pullRequestId: pr.id, commitOID: pr.headRefOid, threads: lines };
  if (files.length === 0) {
    return { ...addReview(addReviewInput({ ...base, event, body })), threads: [] };
  }
  const started = addReview(addReviewInput(base));
  try {
    const threads = files.map((draft) => addThread(started.id, draft));
    const review = submitPending(started.id, event, body);
    return { id: review.id, url: review.url ?? started.url, threads };
  } catch (err) {
    try {
      deleteReview(started.id);
    } catch {
      // The pending review stays on GitHub, the next submit offers to discard it
    }
    throw err;
  }
}

/** Replies on a review thread and returns the id of the new comment. */
export function replyToThread(githubThreadId: string, body: string): number | null {
  const data = graphql<{ addPullRequestReviewThreadReply: { comment: { databaseId: number | null } | null } }>(
    REPLY_MUTATION,
    { input: replyInput(githubThreadId, body) },
  );
  return data.addPullRequestReviewThreadReply.comment?.databaseId ?? null;
}

export function setThreadResolved(githubThreadId: string, resolved: boolean): void {
  graphql(resolved ? RESOLVE_MUTATION : UNRESOLVE_MUTATION, { id: githubThreadId });
}
