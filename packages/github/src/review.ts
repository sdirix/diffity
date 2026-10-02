import type { Actor, DiffSide, RemoteThread, ReviewDraft } from './graphql.js';

export type LocalSide = 'old' | 'new';

/** The path general comments are filed under. */
export const GENERAL_PATH = '__general__';

export function sideToGitHub(side: string): DiffSide {
  return side === 'old' ? 'LEFT' : 'RIGHT';
}

export function sideFromGitHub(side: string | null | undefined): LocalSide {
  return side === 'LEFT' ? 'old' : 'new';
}

export function isBot(actor: Actor | null | undefined): boolean {
  return actor?.__typename === 'Bot';
}

/** How a GitHub review thread is filed locally, `startLine` and `endLine` 0 for a whole file thread. */
export interface PulledThreadSpec {
  filePath: string;
  side: LocalSide;
  startLine: number;
  endLine: number;
  resolved: boolean;
  /** The text of the commented lines when the thread was left. */
  anchorContent: string | null;
}

function validStart(start: number | null, end: number): number {
  return start && start > 0 && start <= end ? start : end;
}

/**
 * The text of lines `start` to `end` of `side` in a review comment's diff hunk,
 * which ends at the commented line. `null` when the hunk does not hold them all.
 */
export function anchorFromDiffHunk(diffHunk: string, side: LocalSide, start: number, end: number): string | null {
  const [header, ...lines] = diffHunk.split('\n');
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(header);
  if (!match) {
    return null;
  }
  let oldLine = Number(match[1]);
  let newLine = Number(match[2]);
  const inRange = (n: number) => n >= start && n <= end;
  const texts: string[] = [];
  for (const line of lines) {
    if (line === '' || line.startsWith('\\')) {
      continue;
    }
    const text = line.slice(1);
    if (line[0] === '+') {
      if (side === 'new' && inRange(newLine)) {
        texts.push(text);
      }
      newLine++;
    } else if (line[0] === '-') {
      if (side === 'old' && inRange(oldLine)) {
        texts.push(text);
      }
      oldLine++;
    } else {
      if (inRange(side === 'new' ? newLine : oldLine)) {
        texts.push(text);
      }
      oldLine++;
      newLine++;
    }
  }
  return texts.length === end - start + 1 ? texts.join('\n') : null;
}

/**
 * Where a GitHub thread goes locally. A current thread keeps the lines GitHub
 * moved it to, an outdated one the lines it was left on, and both carry the
 * text those lines had then, so the location shows when the code changed.
 */
export function mapRemoteThread(thread: RemoteThread): PulledThreadSpec | null {
  if (thread.subjectType === 'FILE') {
    return { filePath: thread.path, side: 'new', startLine: 0, endLine: 0, resolved: thread.isResolved, anchorContent: null };
  }
  const side = sideFromGitHub(thread.diffSide);
  const end = thread.line ?? thread.originalLine;
  if (!end) {
    return null;
  }
  const start = validStart(thread.line !== null ? thread.startLine : thread.originalStartLine, end);
  const originalEnd = thread.originalLine ?? end;
  const originalStart = validStart(thread.originalStartLine, originalEnd);
  return {
    filePath: thread.path,
    side,
    startLine: start,
    endLine: end,
    resolved: thread.isResolved,
    anchorContent: thread.diffHunk ? anchorFromDiffHunk(thread.diffHunk, side, originalStart, originalEnd) : null,
  };
}

/** A local thread to post, `startLine` and `endLine` 0 for a whole file thread. */
export interface PlanCandidate {
  threadId: string;
  filePath: string;
  side: string;
  startLine: number;
  endLine: number;
  body: string;
}

export interface ReviewPlan {
  /** Threads on lines or whole files. */
  drafts: ReviewDraft[];
  /** General comments, which go into the review body. */
  bodySections: string[];
  /** The threads `bodySections` came from. */
  inBody: string[];
}

export function buildReviewPlan(candidates: PlanCandidate[]): ReviewPlan {
  const plan: ReviewPlan = { drafts: [], bodySections: [], inBody: [] };
  for (const candidate of candidates) {
    const body = candidate.body.trim();
    if (!body) {
      continue;
    }
    if (candidate.filePath === GENERAL_PATH) {
      plan.bodySections.push(body);
      plan.inBody.push(candidate.threadId);
      continue;
    }
    const file = candidate.startLine === 0;
    plan.drafts.push({
      threadId: candidate.threadId,
      path: candidate.filePath,
      body,
      side: file ? 'RIGHT' : sideToGitHub(candidate.side),
      startLine: file ? 0 : candidate.startLine,
      line: file ? 0 : candidate.endLine,
    });
  }
  return plan;
}

export function composeReviewBody(summary: string, sections: string[]): string {
  return [summary, ...sections].map((part) => part.trim()).filter(Boolean).join('\n\n');
}

export interface PostedThread {
  threadId: string;
  githubThreadId: string;
  commentId: number | null;
}

function sameBody(a: string, b: string): boolean {
  return a.replace(/\r\n/g, '\n').trim() === b.replace(/\r\n/g, '\n').trim();
}

/**
 * The GitHub threads review `reviewId` created for `drafts`, found by path,
 * line and text, since `addPullRequestReview` does not answer with them.
 */
export function matchPostedThreads(drafts: ReviewDraft[], remote: RemoteThread[], reviewId: string): { posted: PostedThread[]; unmatched: ReviewDraft[] } {
  const available = remote.filter((thread) => thread.comments[0]?.pullRequestReview?.id === reviewId);
  const posted: PostedThread[] = [];
  const unmatched: ReviewDraft[] = [];
  for (const draft of drafts) {
    const index = available.findIndex((thread) =>
      thread.path === draft.path
      && (draft.line === 0 || (thread.line ?? thread.originalLine) === draft.line)
      && sameBody(thread.comments[0].body, draft.body),
    );
    if (index < 0) {
      unmatched.push(draft);
      continue;
    }
    const [thread] = available.splice(index, 1);
    posted.push({ threadId: draft.threadId, githubThreadId: thread.id, commentId: thread.comments[0].databaseId });
  }
  return { posted, unmatched };
}
