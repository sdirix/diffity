import { parseDiff } from '@diffity/parser';
import {
  getHeadHash,
  getMergeBase,
  getRefDiff,
  getWorkingTreeStatus,
  resolveBaseRef,
  resolveHeadRef,
  verifyCommit,
} from '@diffity/git';
import {
  buildReviewPlan,
  composeReviewBody,
  fetchPendingReview,
  fetchPrDiff,
  fetchReviewThreads,
  matchPostedThreads,
  replyToThread,
  submitReview,
  type PendingReview,
  type PostedThread,
  type PullRequest,
  type ReviewEvent,
} from '@diffity/github';
import { getDb, queryAll, transaction } from './db.js';
import { bodyForGitHub } from './github-threads.js';
import { PATH_THREAD_PREFIX } from './agent-comment.js';
import { currentScope, TREE_REF } from './session.js';
import { getThreadsForSession, type Thread } from './threads.js';
import { GENERAL_THREAD_PATH, indexDiff, type ViewIndex } from './thread-location.js';

export const REASONS = {
  noView: 'View no longer available',
  notInPr: 'File is not part of the PR',
  outsideDiff: 'Lines are outside the PR diff',
  otherCommit: 'Left on another commit than the PR head',
  otherBase: 'Old side is not the PR base',
  localChanges: 'File has local changes, commit and push them first',
};

/** How the line numbers of a view relate to the pull request's diff on GitHub. */
export interface SessionAnchor {
  /** The view's new side is the PR head. */
  newMatches: boolean;
  /** The view's old side is the PR base, the merge base of base and head. */
  oldMatches: boolean;
  isPrSession: boolean;
  /** The new side is the working tree or index, so it equals the PR head only for files without local changes. */
  newIsLocal: boolean;
}

/** What the pull request's diff covers. */
export interface PrDiff {
  index: ViewIndex;
  /** Files with staged, unstaged or untracked changes. */
  locallyChanged: Set<string>;
}

export function sessionAnchor(ref: string, prRef: string, prHead: string, prBase: string | null): SessionAnchor | null {
  const isPrSession = ref === prRef;
  if (ref === TREE_REF) {
    return { newMatches: getHeadHash() === prHead, oldMatches: false, isPrSession, newIsLocal: true };
  }
  try {
    const head = resolveHeadRef(ref);
    const base = resolveBaseRef(ref);
    const newSha = head.type === 'ref' ? verifyCommit(head.ref) : getHeadHash();
    const baseSha = base.type === 'ref' ? verifyCommit(base.ref) : null;
    return {
      newMatches: newSha === prHead,
      oldMatches: !!prBase && baseSha === prBase,
      isPrSession,
      newIsLocal: head.type !== 'ref',
    };
  } catch {
    return null;
  }
}

function covers(lines: Map<number, string>, start: number, end: number): boolean {
  for (let n = start; n <= end; n++) {
    if (!lines.has(n)) {
      return false;
    }
  }
  return true;
}

/** Why `thread` cannot be posted to the pull request as it is, `null` when it can. */
export function postableReason(thread: Pick<Thread, 'filePath' | 'side' | 'startLine' | 'endLine'>, anchor: SessionAnchor | null, pr: PrDiff): string | null {
  if (!anchor) {
    return REASONS.noView;
  }
  if (thread.filePath === GENERAL_THREAD_PATH) {
    return anchor.isPrSession || anchor.newMatches ? null : REASONS.otherCommit;
  }
  const file = pr.index.files.get(thread.filePath);
  if (!file) {
    return REASONS.notInPr;
  }
  if (thread.startLine === 0) {
    return anchor.newMatches || anchor.oldMatches ? null : REASONS.otherCommit;
  }
  const side = thread.side === 'old' ? 'old' : 'new';
  if (side === 'new' && !anchor.newMatches) {
    return REASONS.otherCommit;
  }
  if (side === 'old' && !anchor.oldMatches) {
    return REASONS.otherBase;
  }
  if (side === 'new' && anchor.newIsLocal && pr.locallyChanged.has(thread.filePath)) {
    return REASONS.localChanges;
  }
  return covers(file[side], thread.startLine, thread.endLine) ? null : REASONS.outsideDiff;
}

/** The merge base GitHub diffs the pull request against, `null` when the base is not fetched. */
function prBase(pr: PullRequest): string | null {
  if (!verifyCommit(pr.headRefOid)) {
    return null;
  }
  for (const base of [pr.baseRefOid, `origin/${pr.baseRefName}`]) {
    if (verifyCommit(base)) {
      const mergeBase = getMergeBase(base, pr.headRefOid);
      if (mergeBase) {
        return mergeBase;
      }
    }
  }
  return null;
}

/** GitHub's diff of the pull request, or the same diff read locally when gh cannot give it. */
function loadPrDiff(pr: PullRequest, base: string | null): ViewIndex {
  let patch: string;
  try {
    patch = fetchPrDiff(pr);
  } catch (err) {
    if (!base) {
      throw err;
    }
    patch = getRefDiff(`${base}..${pr.headRefOid}`, [], { showHidden: true }).patch;
  }
  return indexDiff(parseDiff(patch));
}

export interface ReviewCandidate {
  thread: Thread;
  /** The view it was left in. */
  ref: string;
  /** Why it cannot be posted, `null` when it can. */
  reason: string | null;
}

export interface ReviewContext {
  /** Why nothing can be posted, like a local HEAD that is not the PR head. */
  blocker: string | null;
  candidates: ReviewCandidate[];
}

interface SessionRow {
  id: string;
  ref: string;
  scope: string | null;
}

function short(sha: string | null): string {
  return sha ? sha.slice(0, 7) : 'none';
}

/**
 * The open threads of this branch's views that are not on GitHub yet, each
 * with why it cannot be posted. Postable ones first, the PR view's first among
 * them, then the oldest.
 */
export function reviewCandidates(pr: PullRequest, prRef: string): ReviewContext {
  const head = getHeadHash();
  const blocker = head === pr.headRefOid
    ? null
    : `Local HEAD ${short(head)} is not the PR head ${short(pr.headRefOid)}. Push or pull first.`;
  const base = prBase(pr);
  const diff: PrDiff = { index: loadPrDiff(pr, base), locallyChanged: new Set(Object.keys(getWorkingTreeStatus())) };
  const posted = new Set(queryAll<{ id: string }>('SELECT id FROM comment_threads WHERE github_review_id IS NOT NULL').map((r) => r.id));
  const scope = currentScope();
  const sessions = queryAll<SessionRow>('SELECT id, ref, scope FROM review_sessions')
    .filter((s) => s.scope === '' || s.scope === scope);

  const candidates: (ReviewCandidate & { isPrSession: boolean })[] = [];
  for (const session of sessions) {
    const threads = getThreadsForSession(session.id, 'open').filter((t) =>
      !t.githubThreadId && !posted.has(t.id) && t.comments.length > 0 && !t.filePath.startsWith(PATH_THREAD_PREFIX),
    );
    if (threads.length === 0) {
      continue;
    }
    const anchor = sessionAnchor(session.ref, prRef, pr.headRefOid, base);
    for (const thread of threads) {
      candidates.push({ thread, ref: session.ref, reason: postableReason(thread, anchor, diff), isPrSession: session.ref === prRef });
    }
  }
  candidates.sort((a, b) =>
    Number(!!a.reason) - Number(!!b.reason)
    || Number(b.isPrSession) - Number(a.isPrSession)
    || a.thread.createdAt.localeCompare(b.thread.createdAt),
  );
  return { blocker, candidates: candidates.map(({ isPrSession, ...candidate }) => candidate) };
}

export class ReviewError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
  }
}

export interface ReviewRequest {
  event: ReviewEvent;
  body: string;
  threadIds: string[];
  /** What to do with your pending review on GitHub, when there is one. */
  pendingAction: 'add' | 'discard' | null;
}

export interface ReviewResult {
  /** Threads posted, as review threads or in the body. */
  posted: number;
  /** Threads left out, with why. */
  skipped: string[];
  /** Problems after the review was posted. */
  errors: string[];
  url: string | null;
}

export function threadLocation(thread: Pick<Thread, 'filePath' | 'startLine' | 'endLine'>): string {
  if (thread.filePath === GENERAL_THREAD_PATH) {
    return 'General comment';
  }
  if (thread.startLine === 0) {
    return thread.filePath;
  }
  return thread.startLine === thread.endLine
    ? `${thread.filePath}:${thread.endLine}`
    : `${thread.filePath}:${thread.startLine}-${thread.endLine}`;
}

function pendingMessage(pr: PullRequest, pending: PendingReview): string {
  const count = pending.commentCount === 0 ? '' : pending.commentCount === 1 ? ' with 1 comment' : ` with ${pending.commentCount} comments`;
  return `You have a pending review on #${pr.number}${count}. Add to it or discard it.`;
}

/** Links posted threads to GitHub and posts their replies, collecting what went wrong. */
function recordPosted(posted: PostedThread[], byId: Map<string, Thread>, reviewId: string, errors: string[]): void {
  const db = getDb();
  for (const link of posted) {
    const thread = byId.get(link.threadId);
    if (!thread) {
      continue;
    }
    transaction(() => {
      db.prepare('UPDATE comment_threads SET github_thread_id = ?, github_resolved = 0, github_review_id = ? WHERE id = ?')
        .run(link.githubThreadId, reviewId, thread.id);
      if (link.commentId !== null) {
        db.prepare('UPDATE comments SET github_comment_id = ? WHERE id = ?').run(link.commentId, thread.comments[0].id);
      }
    });
    for (const reply of thread.comments.slice(1)) {
      try {
        const id = replyToThread(link.githubThreadId, bodyForGitHub(reply.body, reply.author.name, reply.author.type));
        db.prepare('UPDATE comments SET github_comment_id = ? WHERE id = ?').run(id, reply.id);
      } catch (err) {
        errors.push(`${threadLocation(thread)}: reply not posted, ${err instanceof Error ? err.message : err}`);
      }
    }
  }
}

/**
 * Posts the chosen threads as one review: line and whole file threads as
 * review threads, general comments in the body after the summary. Posted
 * threads are linked to GitHub, the others are reported with their reason.
 */
export function postReview(pr: PullRequest, prRef: string, request: ReviewRequest): ReviewResult {
  const context = reviewCandidates(pr, prRef);
  if (context.blocker) {
    throw new ReviewError(context.blocker, 409);
  }
  const wanted = new Set(request.threadIds);
  const chosen = context.candidates.filter((c) => wanted.has(c.thread.id));
  const skipped = chosen.filter((c) => c.reason).map((c) => `${threadLocation(c.thread)}: ${c.reason}`);
  const postable = chosen.filter((c) => !c.reason).map((c) => c.thread);
  const plan = buildReviewPlan(postable.map((t) => ({
    threadId: t.id,
    filePath: t.filePath,
    side: t.side,
    startLine: t.startLine,
    endLine: t.endLine,
    body: bodyForGitHub(t.comments[0].body, t.comments[0].author.name, t.comments[0].author.type),
  })));
  const body = composeReviewBody(request.body, plan.bodySections);
  if (plan.drafts.length === 0 && !body && request.event === 'COMMENT') {
    throw new ReviewError(skipped.length > 0 ? `Nothing to post. ${skipped.join('. ')}` : 'Nothing to post', 400);
  }

  const pending = fetchPendingReview(pr);
  if (pending && !request.pendingAction) {
    throw new ReviewError(pendingMessage(pr, pending), 409, 'pending_review_exists');
  }
  const review = submitReview(pr, {
    event: request.event,
    body,
    drafts: plan.drafts,
    pending: pending && request.pendingAction ? { id: pending.id, action: request.pendingAction } : null,
  });

  const errors: string[] = [];
  const linked = new Set(review.threads.map((t) => t.threadId));
  const unlinked = plan.drafts.filter((d) => !linked.has(d.threadId));
  const posted = [...review.threads];
  if (unlinked.length > 0) {
    try {
      const match = matchPostedThreads(unlinked, fetchReviewThreads(pr.slug, pr.number), review.id);
      posted.push(...match.posted);
      errors.push(...match.unmatched.map((d) => `${d.path}${d.line ? `:${d.line}` : ''}: posted, but not linked`));
    } catch (err) {
      errors.push(`Posted, but threads not linked: ${err instanceof Error ? err.message : err}`);
    }
  }
  recordPosted(posted, new Map(postable.map((t) => [t.id, t])), review.id, errors);
  if (plan.inBody.length > 0) {
    const placeholders = plan.inBody.map(() => '?').join(', ');
    getDb().prepare(`UPDATE comment_threads SET github_review_id = ? WHERE id IN (${placeholders})`).run(review.id, ...plan.inBody);
  }
  return { posted: plan.drafts.length + plan.inBody.length, skipped, errors, url: review.url };
}
