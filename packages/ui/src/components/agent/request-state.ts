import { parseCommitRef } from '../../lib/refs';
import { TREE_REF } from '../../lib/thread-location';
import { GENERAL_THREAD_FILE_PATH, type CommentThread } from '../comments/types';
import type { AgentRequest, ListenerStatus } from './agent-api';

/** What the UI calls the user's agent. */
export const AGENT_NAME = 'Agent';

/** The skill that makes the user's agent take requests. */
export const WATCH_COMMAND = '/diffity-watch';

export type ThreadActivity = 'idle' | 'queued' | 'working';

/** `working` while the agent handles a request, `listening` while it waits for one, `offline` otherwise. */
export type AgentState = 'working' | 'listening' | 'offline';

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function isActive(request: Pick<AgentRequest, 'status'>): boolean {
  return request.status === 'queued' || request.status === 'claimed';
}

/** A cancelled request the agent had taken, which expired without news from it. */
export function isExpired(request: Pick<AgentRequest, 'status' | 'claimedAt'>): boolean {
  return request.status === 'cancelled' && request.claimedAt !== null;
}

/** What the request asks for, e.g. `Review` or `Resolve 2 comments`. */
export function requestTitle(request: Pick<AgentRequest, 'mode' | 'threadIds'>): string {
  switch (request.mode) {
    case 'review':
      return 'Review';
    case 'resolve':
      return `Resolve ${plural(request.threadIds.length, 'comment')}`;
    case 'thread':
      return 'Reply in thread';
    case 'summarize':
      return 'Summary';
  }
}

/**
 * Whether the agent works on a request, waits for one, or neither. It still
 * counts as waiting for `graceMs` after it was last seen at `seenAt`, the gap
 * between finishing a request and waiting for the next.
 */
export function agentState(requests: AgentRequest[], listener: ListenerStatus | null, seenAt: number | null, now: number, graceMs = 15_000): AgentState {
  if (requests.some((request) => request.status === 'claimed')) {
    return 'working';
  }
  if (listener || (seenAt !== null && now - seenAt < graceMs)) {
    return 'listening';
  }
  return 'offline';
}

export function threadActivity(requests: AgentRequest[], threadId: string): ThreadActivity {
  let activity: ThreadActivity = 'idle';
  for (const request of requests) {
    if (!isActive(request) || !request.threadIds.includes(threadId)) {
      continue;
    }
    if (request.status === 'claimed') {
      return 'working';
    }
    activity = 'queued';
  }
  return activity;
}

/** Threads that queued and claimed requests work on. */
export function busyThreadIds(requests: AgentRequest[]): Set<string> {
  return new Set(requests.filter(isActive).flatMap((request) => request.threadIds));
}

/**
 * Whether the agent may edit for comments of the view: it edits the working
 * tree, so not for an old commit or a range that ends before HEAD.
 */
export function canSendTo(ref: string): boolean {
  if (ref === TREE_REF) {
    return true;
  }
  if (parseCommitRef(ref)) {
    return false;
  }
  if (ref.includes('..')) {
    const head = ref.split(/\.{2,3}/)[1];
    return !head || head === 'HEAD';
  }
  return true;
}

export interface SendCandidates {
  /** Open threads whose last comment is the user's. */
  yours: CommentThread[];
  /** Open review comments of the agent nobody replied to yet. */
  agents: CommentThread[];
}

/** The threads that can be sent to the agent, leaving out those a request already works on. */
export function sendCandidates(threads: CommentThread[], busy: ReadonlySet<string>): SendCandidates {
  const open = threads.filter((thread) => thread.status === 'open' && !busy.has(thread.id) && thread.comments.length > 0);
  return {
    yours: open.filter((thread) => thread.comments.at(-1)!.author.type === 'user'),
    agents: open.filter((thread) => thread.filePath !== GENERAL_THREAD_FILE_PATH && thread.comments.every((c) => c.author.type === 'agent')),
  };
}

/** Your threads, else the agent's own when you have none, like the server picks without a selection. */
export function preselected(candidates: SendCandidates): CommentThread[] {
  return candidates.yours.length > 0 ? candidates.yours : candidates.agents;
}

/** The requests that ended since `before`, a map of the ids and statuses of the last poll. */
export function endedSince(before: ReadonlyMap<string, AgentRequest['status']>, requests: AgentRequest[]): AgentRequest[] {
  return requests.filter((request) => {
    const previous = before.get(request.id);
    return previous !== undefined && isActive({ status: previous }) && !isActive(request);
  });
}
