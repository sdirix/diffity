import type { IncomingMessage, ServerResponse } from 'node:http';
import { getCurrentBranch, getHeadHash } from '@diffity/git';
import {
  fetchPendingReview,
  fetchReviewThreads,
  findPullRequest,
  GitHubError,
  type GitHubRemote,
  type PendingReview,
  type PullRequest,
  type ReviewEvent,
  replyToThread,
  setThreadResolved,
} from '@diffity/github';
import { findOrCreateSession } from './session.js';
import { syncRemoteThreads } from './github-sync.js';
import { postReview, reviewCandidates, ReviewError, type ReviewRequest } from './github-review.js';
import { bodyForGitHub, findComment, githubThreadOf, recordGitHubReply, recordGitHubStatus, setCommentGitHubId } from './github-threads.js';
import { readJsonObject, sendError, sendJson } from './http-utils.js';
import { requestOnMention } from './agent-mentions.js';
import type { ThreadAuthor } from './threads.js';

const PR_CACHE_MS = 15_000;
const REVIEW_EVENTS: ReviewEvent[] = ['COMMENT', 'APPROVE', 'REQUEST_CHANGES'];
const YOU: ThreadAuthor = { name: 'You', type: 'user' };

function isAuthor(value: unknown): value is ThreadAuthor {
  const author = value as ThreadAuthor | null;
  return !!author && typeof author.name === 'string' && (author.type === 'user' || author.type === 'agent');
}


let cached: { key: string; at: number; pr: PullRequest | null } | null = null;

/** The pull request of the checked out branch. Looked up again after a while, or when `fresh` is set. */
function currentPr(fresh = false): PullRequest | null {
  const key = `${getCurrentBranch()}@${getHeadHash() ?? ''}`;
  if (!fresh && cached && cached.key === key && Date.now() - cached.at < PR_CACHE_MS) {
    return cached.pr;
  }
  const pr = findPullRequest();
  cached = { key, at: Date.now(), pr };
  return pr;
}

/** The view of a pull request's changes, the one `diffity <pr-url>` opens. */
export function prRef(pr: PullRequest): string {
  return `origin/${pr.baseRefName}`;
}

function toDetails(pr: PullRequest) {
  const { slug, id, headRefOid, baseRefOid, ...details } = pr;
  return { ...details, headSha: headRefOid, ref: prRef(pr) };
}

/** Answers a failed GitHub call, with `prefix` when the UI does not say what failed. */
function sendFailure(res: ServerResponse, err: unknown, prefix?: string) {
  const message = err instanceof Error ? err.message : String(err);
  sendError(res, err instanceof GitHubError ? 502 : 500, prefix ? `${prefix}: ${message}` : message);
}

/** The pull request routes. Answers nothing for a repository whose origin is not on GitHub. */
export async function handleGitHubRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  remote: GitHubRemote | null,
): Promise<boolean> {
  if (!pathname.startsWith('/api/github/')) {
    return false;
  }
  if (!remote) {
    if (pathname === '/api/github/details') {
      sendJson(res, null);
    } else {
      sendError(res, 400, 'No GitHub remote');
    }
    return true;
  }

  if (pathname === '/api/github/details' && req.method === 'GET') {
    try {
      const pr = currentPr();
      sendJson(res, pr && toDetails(pr));
    } catch (err) {
      sendFailure(res, err, 'Failed to load the pull request');
    }
    return true;
  }

  if (pathname === '/api/github/pull' && req.method === 'POST') {
    try {
      const pr = currentPr();
      if (!pr) {
        sendError(res, 404, 'No pull request for this branch');
        return true;
      }
      const session = findOrCreateSession(prRef(pr));
      const result = syncRemoteThreads(session.id, fetchReviewThreads(pr.slug, pr.number));
      sendJson(res, { ...result, sessionId: session.id, ref: session.ref });
    } catch (err) {
      sendFailure(res, err);
    }
    return true;
  }

  if (pathname === '/api/github/review-candidates' && req.method === 'GET') {
    try {
      const pr = currentPr(true);
      if (!pr) {
        sendError(res, 404, 'No pull request for this branch');
        return true;
      }
      const context = reviewCandidates(pr, prRef(pr));
      let pending: PendingReview | null = null;
      try {
        pending = fetchPendingReview(pr);
      } catch {
        // Asked again on submit, which fails clearly
      }
      sendJson(res, { ...context, pending });
    } catch (err) {
      sendFailure(res, err, 'Failed to check the comments');
    }
    return true;
  }

  if (pathname === '/api/github/review' && req.method === 'POST') {
    const body = await readJsonObject(req);
    const event = body.event;
    const threadIds = body.threadIds;
    const pendingAction = body.pendingAction ?? null;
    if (!REVIEW_EVENTS.includes(event as ReviewEvent) || !Array.isArray(threadIds) || ![null, 'add', 'discard'].includes(pendingAction as string)) {
      sendError(res, 400, 'Invalid review');
      return true;
    }
    try {
      const pr = currentPr(true);
      if (!pr) {
        sendError(res, 404, 'No pull request for this branch');
        return true;
      }
      sendJson(res, postReview(pr, prRef(pr), {
        event: event as ReviewEvent,
        body: typeof body.body === 'string' ? body.body : '',
        threadIds: threadIds.filter((id): id is string => typeof id === 'string'),
        pendingAction: pendingAction as ReviewRequest['pendingAction'],
      }));
    } catch (err) {
      if (err instanceof ReviewError) {
        res.writeHead(err.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message, code: err.code }));
        return true;
      }
      sendFailure(res, err);
    }
    return true;
  }

  const replyMatch = pathname.match(/^\/api\/github\/threads\/([^/]+)\/reply$/);
  if (replyMatch && req.method === 'POST') {
    const body = await readJsonObject(req);
    const githubThreadId = githubThreadOf(replyMatch[1]);
    if (typeof body.body !== 'string' || !body.body.trim()) {
      sendError(res, 400, 'Missing body');
      return true;
    }
    if (!githubThreadId) {
      sendError(res, 400, 'The thread is not on GitHub');
      return true;
    }
    const author = isAuthor(body.author) ? body.author : YOU;
    try {
      const id = replyToThread(githubThreadId, bodyForGitHub(body.body, author.name, author.type));
      const comment = recordGitHubReply(replyMatch[1], body.body, author, id);
      requestOnMention({ threadId: replyMatch[1], body: comment.body, author });
      sendJson(res, comment);
    } catch (err) {
      sendFailure(res, err);
    }
    return true;
  }

  const resolveMatch = pathname.match(/^\/api\/github\/threads\/([^/]+)\/resolve$/);
  if (resolveMatch && req.method === 'POST') {
    const body = await readJsonObject(req);
    const githubThreadId = githubThreadOf(resolveMatch[1]);
    if (typeof body.resolved !== 'boolean') {
      sendError(res, 400, 'Missing resolved');
      return true;
    }
    if (!githubThreadId) {
      sendError(res, 400, 'The thread is not on GitHub');
      return true;
    }
    try {
      setThreadResolved(githubThreadId, body.resolved);
      recordGitHubStatus(resolveMatch[1], body.resolved);
      sendJson(res, { ok: true });
    } catch (err) {
      sendFailure(res, err);
    }
    return true;
  }

  const postMatch = pathname.match(/^\/api\/github\/comments\/([^/]+)\/post$/);
  if (postMatch && req.method === 'POST') {
    const comment = findComment(postMatch[1]);
    if (!comment) {
      sendError(res, 404, 'Comment not found');
      return true;
    }
    if (comment.githubCommentId !== null) {
      sendJson(res, { ok: true });
      return true;
    }
    if (!comment.githubThreadId) {
      sendError(res, 400, 'The thread is not on GitHub');
      return true;
    }
    try {
      setCommentGitHubId(comment.id, replyToThread(comment.githubThreadId, bodyForGitHub(comment.body, comment.authorName, comment.authorType)));
      sendJson(res, { ok: true });
    } catch (err) {
      sendFailure(res, err);
    }
    return true;
  }

  return false;
}
