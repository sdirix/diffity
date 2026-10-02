import { randomUUID } from 'node:crypto';
import type { SQLInputValue } from 'node:sqlite';
import { isBot, mapRemoteThread, type RemoteComment, type RemoteThread } from '@diffity/github';
import { getDb, queryAll, transaction } from './db.js';

export interface PullResult {
  pulled: number;
  updated: number;
  skipped: number;
}

interface LinkedThread {
  id: string;
  file_path: string;
  side: string;
  start_line: number;
  end_line: number;
  status: string;
  github_thread_id: string | null;
  github_resolved: number | null;
  first_body: string | null;
}

interface LinkedComment {
  id: string;
  thread_id: string;
  body: string;
  github_comment_id: number | null;
}

function normalize(body: string): string {
  return body.replace(/\r\n/g, '\n').trim();
}

function isoDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function insertRemoteComment(threadId: string, comment: RemoteComment): void {
  getDb().prepare(
    'INSERT INTO comments (id, thread_id, author_name, author_type, body, created_at, github_comment_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(
    randomUUID(),
    threadId,
    comment.author?.login ?? 'ghost',
    isBot(comment.author) ? 'agent' : 'user',
    comment.body,
    isoDate(comment.createdAt),
    comment.databaseId,
  );
}

/** The status a GitHub resolve or unresolve leaves a local thread in. Dismissed threads stay dismissed. */
function statusAfter(status: string, resolved: boolean): string {
  if (resolved) {
    return status === 'open' ? 'resolved' : status;
  }
  return status === 'resolved' ? 'open' : status;
}

/**
 * Brings a linked thread up to date: adds the comments it lacks, takes over a
 * resolve or unresolve done on GitHub since the last sync and the lines GitHub
 * moved a current thread to. A local comment GitHub has without an id, like a
 * reply whose id was not stored, is matched by its text.
 */
function mergeIntoExisting(local: LinkedThread, comments: LinkedComment[], remote: RemoteThread): boolean {
  const db = getDb();
  let changed = false;
  const known = new Set(comments.map((c) => c.github_comment_id).filter((id) => id !== null));
  const unlinked = comments.filter((c) => c.github_comment_id === null);
  for (const comment of remote.comments) {
    if (comment.databaseId === null || known.has(comment.databaseId)) {
      continue;
    }
    const index = unlinked.findIndex((c) => normalize(c.body) === normalize(comment.body));
    if (index >= 0) {
      db.prepare('UPDATE comments SET github_comment_id = ? WHERE id = ?').run(comment.databaseId, unlinked[index].id);
      unlinked.splice(index, 1);
      continue;
    }
    insertRemoteComment(local.id, comment);
    changed = true;
  }

  const resolved = remote.isResolved ? 1 : 0;
  let status = local.status;
  if (local.github_resolved !== resolved) {
    status = statusAfter(local.status, remote.isResolved);
  }
  const spec = mapRemoteThread(remote);
  const moved = !!spec && !remote.isOutdated && spec.startLine !== 0 && local.start_line !== 0
    && (spec.startLine !== local.start_line || spec.endLine !== local.end_line || spec.side !== local.side);
  changed ||= status !== local.status || moved;
  const sets = ['github_resolved = ?', 'status = ?'];
  const params: SQLInputValue[] = [resolved, status];
  if (moved) {
    sets.push('side = ?', 'start_line = ?', 'end_line = ?');
    params.push(spec.side, spec.startLine, spec.endLine);
  }
  if (changed) {
    sets.push('updated_at = ?');
    params.push(new Date().toISOString());
  }
  db.prepare(`UPDATE comment_threads SET ${sets.join(', ')} WHERE id = ?`).run(...params, local.id);
  return changed;
}

function insertRemoteThread(sessionId: string, remote: RemoteThread): boolean {
  const spec = mapRemoteThread(remote);
  if (!spec || remote.comments.length === 0) {
    return false;
  }
  const id = randomUUID();
  const createdAt = isoDate(remote.comments[0].createdAt);
  const updatedAt = isoDate(remote.comments[remote.comments.length - 1].createdAt);
  getDb().prepare(
    `INSERT INTO comment_threads (id, session_id, file_path, side, start_line, end_line, status, anchor_content,
      created_at, updated_at, github_thread_id, github_resolved) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, sessionId, spec.filePath, spec.side, spec.startLine, spec.endLine, spec.resolved ? 'resolved' : 'open',
    spec.anchorContent, createdAt, updatedAt, remote.id, spec.resolved ? 1 : 0,
  );
  for (const comment of remote.comments) {
    insertRemoteComment(id, comment);
  }
  return true;
}

/**
 * A thread pulled or posted before threads were linked: one of `sessionId`
 * on the same lines whose first comment reads like the GitHub thread's.
 */
function findUnlinked(threads: LinkedThread[], remote: RemoteThread): LinkedThread | undefined {
  const spec = mapRemoteThread(remote);
  const first = remote.comments[0];
  if (!spec || !first) {
    return undefined;
  }
  return threads.find((t) =>
    t.github_thread_id === null
    && t.file_path === spec.filePath
    && t.side === spec.side
    && t.end_line === spec.endLine
    && t.first_body !== null
    && normalize(t.first_body) === normalize(first.body),
  );
}

function loadThreads(sessionId: string): LinkedThread[] {
  return queryAll<LinkedThread>(`
    SELECT t.id, t.file_path, t.side, t.start_line, t.end_line, t.status, t.github_thread_id, t.github_resolved,
      (SELECT c.body FROM comments c WHERE c.thread_id = t.id ORDER BY c.created_at ASC, c.rowid ASC LIMIT 1) AS first_body
    FROM comment_threads t
    WHERE t.github_thread_id IS NOT NULL OR t.session_id = ?
  `, sessionId);
}

function loadComments(threadId: string): LinkedComment[] {
  return queryAll<LinkedComment>('SELECT id, thread_id, body, github_comment_id FROM comments WHERE thread_id = ?', threadId);
}

/**
 * Pulls GitHub review threads into the repository's comments. Threads linked
 * to one, from any view, are merged into, the others are added to `sessionId`.
 */
export function syncRemoteThreads(sessionId: string, remoteThreads: RemoteThread[]): PullResult {
  const result: PullResult = { pulled: 0, updated: 0, skipped: 0 };
  transaction(() => {
    const threads = loadThreads(sessionId);
    const linked = new Map(threads.filter((t) => t.github_thread_id).map((t) => [t.github_thread_id!, t]));
    for (const remote of remoteThreads) {
      let local = linked.get(remote.id);
      if (!local) {
        local = findUnlinked(threads, remote);
        if (local) {
          getDb().prepare('UPDATE comment_threads SET github_thread_id = ? WHERE id = ?').run(remote.id, local.id);
          local.github_thread_id = remote.id;
        }
      }
      if (local) {
        if (mergeIntoExisting(local, loadComments(local.id), remote)) {
          result.updated++;
        } else {
          result.skipped++;
        }
        continue;
      }
      if (insertRemoteThread(sessionId, remote)) {
        result.pulled++;
      } else {
        result.skipped++;
      }
    }
  });
  return result;
}
