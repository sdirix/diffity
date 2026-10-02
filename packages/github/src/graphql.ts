import { GitHubError } from './errors.js';

export interface PageInfo {
  hasNextPage: boolean;
  endCursor: string | null;
}

export interface Connection<T> {
  nodes: (T | null)[];
  pageInfo?: PageInfo | null;
}

export interface Actor {
  login: string;
  avatarUrl?: string | null;
  __typename?: string;
}

export interface PrNode {
  id: string;
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  body: string | null;
  createdAt: string;
  author: Actor | null;
  baseRefName: string;
  baseRefOid: string;
  headRefName: string;
  headRefOid: string;
  reviewDecision: string | null;
  additions: number;
  deletions: number;
  changedFiles: number;
  reviewThreads: { totalCount: number } | null;
}

export interface RemoteComment {
  databaseId: number | null;
  body: string;
  createdAt: string;
  author: Actor | null;
  pullRequestReview: { id: string } | null;
}

export interface RemoteThreadNode {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  originalStartLine: number | null;
  diffSide: 'LEFT' | 'RIGHT' | null;
  subjectType: 'LINE' | 'FILE' | null;
  root: Connection<{ diffHunk: string }>;
  comments: Connection<RemoteComment>;
}

/** A review thread with all of its comments. */
export interface RemoteThread extends Omit<RemoteThreadNode, 'root' | 'comments'> {
  diffHunk: string | null;
  comments: RemoteComment[];
}

export interface PendingReviewNode {
  id: string;
  url: string | null;
  viewerDidAuthor: boolean;
  comments: { totalCount: number };
}

export function nodes<T>(connection: Connection<T> | null | undefined): T[] {
  return (connection?.nodes ?? []).filter((node): node is T => node !== null);
}

export function nextCursor(connection: Connection<unknown> | null | undefined): string | null {
  const info = connection?.pageInfo;
  return info?.hasNextPage ? info.endCursor : null;
}

/** The `data` of a GraphQL response, `GitHubError` with its messages when it has errors. */
export function parseGraphqlResponse<T>(text: string): T {
  let envelope: { data?: T | null; errors?: { message: string }[] | null };
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new GitHubError('Unexpected GitHub response');
  }
  if (envelope.errors && envelope.errors.length > 0) {
    throw new GitHubError(envelope.errors.map((e) => e.message).join('\n'));
  }
  if (!envelope.data) {
    throw new GitHubError('Empty GitHub response');
  }
  return envelope.data;
}

const PR_FIELDS =
  'id number title url state isDraft body createdAt author{login avatarUrl} baseRefName baseRefOid ' +
  'headRefName headRefOid reviewDecision additions deletions changedFiles reviewThreads(first:1){totalCount}';

export const PR_QUERY =
  `query($owner:String!,$name:String!,$number:Int!){viewer{login} repository(owner:$owner,name:$name){pullRequest(number:$number){${PR_FIELDS}}}}`;

const COMMENT_FIELDS = 'databaseId body createdAt author{login avatarUrl __typename} pullRequestReview{id}';

export const THREADS_QUERY =
  'query($owner:String!,$name:String!,$number:Int!,$after:String){repository(owner:$owner,name:$name){pullRequest(number:$number){' +
  'reviewThreads(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{' +
  'id isResolved isOutdated path line startLine originalLine originalStartLine diffSide subjectType ' +
  'root:comments(first:1){nodes{diffHunk}} ' +
  `comments(first:100){pageInfo{hasNextPage endCursor} nodes{${COMMENT_FIELDS}}}}}}}}`;

export const THREAD_COMMENTS_QUERY =
  'query($id:ID!,$after:String){node(id:$id){... on PullRequestReviewThread{' +
  `comments(first:100,after:$after){pageInfo{hasNextPage endCursor} nodes{${COMMENT_FIELDS}}}}}}`;

/** Pending reviews are only visible to their author, `viewerDidAuthor` guards against that changing. */
export const PENDING_REVIEWS_QUERY =
  'query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){' +
  'reviews(first:5,states:PENDING){nodes{id url viewerDidAuthor comments{totalCount}}}}}}';

export const ADD_REVIEW_MUTATION =
  'mutation($input:AddPullRequestReviewInput!){addPullRequestReview(input:$input){pullRequestReview{id url}}}';

export const ADD_THREAD_MUTATION =
  'mutation($input:AddPullRequestReviewThreadInput!){addPullRequestReviewThread(input:$input){thread{id comments(first:1){nodes{databaseId}}}}}';

export const SUBMIT_REVIEW_MUTATION =
  'mutation($input:SubmitPullRequestReviewInput!){submitPullRequestReview(input:$input){pullRequestReview{id url}}}';

export const DELETE_REVIEW_MUTATION =
  'mutation($input:DeletePullRequestReviewInput!){deletePullRequestReview(input:$input){pullRequestReview{id}}}';

export const REPLY_MUTATION =
  'mutation($input:AddPullRequestReviewThreadReplyInput!){addPullRequestReviewThreadReply(input:$input){comment{databaseId}}}';

export const RESOLVE_MUTATION = 'mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id isResolved}}}';

export const UNRESOLVE_MUTATION = 'mutation($id:ID!){unresolveReviewThread(input:{threadId:$id}){thread{id isResolved}}}';

export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

export type DiffSide = 'LEFT' | 'RIGHT';

/** A local thread planned as a review thread, `line` 0 for a comment on the whole file. */
export interface ReviewDraft {
  threadId: string;
  path: string;
  body: string;
  side: DiffSide;
  startLine: number;
  line: number;
}

function lineRange(draft: ReviewDraft): Record<string, unknown> {
  const range: Record<string, unknown> = { line: draft.line, side: draft.side };
  if (draft.startLine > 0 && draft.startLine < draft.line) {
    range.startLine = draft.startLine;
    range.startSide = draft.side;
  }
  return range;
}

/** A `DraftPullRequestReviewThread` of `addPullRequestReview`, which only takes line threads. */
export function draftThreadInput(draft: ReviewDraft): Record<string, unknown> {
  return { path: draft.path, body: draft.body, ...lineRange(draft) };
}

/** The input of `addPullRequestReviewThread`, which also takes whole file threads. */
export function addThreadInput(reviewId: string, draft: ReviewDraft): Record<string, unknown> {
  if (draft.line === 0) {
    return { pullRequestReviewId: reviewId, path: draft.path, body: draft.body, subjectType: 'FILE' };
  }
  return { pullRequestReviewId: reviewId, path: draft.path, body: draft.body, ...lineRange(draft), subjectType: 'LINE' };
}

/** The input of `addPullRequestReview`. Without `event` the review stays pending. */
export function addReviewInput(options: {
  pullRequestId: string;
  commitOID: string;
  threads: ReviewDraft[];
  event?: ReviewEvent;
  body?: string;
}): Record<string, unknown> {
  const input: Record<string, unknown> = {
    pullRequestId: options.pullRequestId,
    commitOID: options.commitOID,
    threads: options.threads.map(draftThreadInput),
  };
  if (options.event) {
    input.event = options.event;
    if (options.body) {
      input.body = options.body;
    }
  }
  return input;
}

export function submitReviewInput(reviewId: string, event: ReviewEvent, body: string): Record<string, unknown> {
  const input: Record<string, unknown> = { pullRequestReviewId: reviewId, event };
  if (body) {
    input.body = body;
  }
  return input;
}

export function replyInput(threadId: string, body: string): Record<string, unknown> {
  return { pullRequestReviewThreadId: threadId, body };
}
