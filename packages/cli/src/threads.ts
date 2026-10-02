import { randomUUID } from 'node:crypto';
import { getDb, queryAll, queryOne, transaction } from './db.js';
import { unescapeMarkdown } from './unescape.js';

export interface ThreadAuthor {
  name: string;
  type: 'user' | 'agent';
}

export interface ThreadComment {
  id: string;
  author: ThreadAuthor;
  body: string;
  createdAt: string;
  /** The id of the GitHub review comment it is. */
  githubCommentId: number | null;
}

export type ThreadStatus = 'open' | 'resolved' | 'dismissed';

export interface Thread {
  id: string;
  sessionId: string;
  filePath: string;
  side: string;
  startLine: number;
  endLine: number;
  status: ThreadStatus;
  anchorContent: string | null;
  createdAt: string;
  updatedAt: string;
  /** The GitHub review thread it is. */
  githubThreadId: string | null;
  comments: ThreadComment[];
}

interface ThreadRow {
  id: string;
  session_id: string;
  file_path: string;
  side: string;
  start_line: number;
  end_line: number;
  status: string;
  anchor_content: string | null;
  created_at: string;
  updated_at: string;
  github_thread_id: string | null;
}

interface CommentRow {
  id: string;
  thread_id: string;
  author_name: string;
  author_type: string;
  body: string;
  created_at: string;
  github_comment_id: number | null;
}

function rowToThread(row: ThreadRow, comments: ThreadComment[]): Thread {
  return {
    id: row.id,
    sessionId: row.session_id,
    filePath: row.file_path,
    side: row.side,
    startLine: row.start_line,
    endLine: row.end_line,
    status: row.status as ThreadStatus,
    anchorContent: row.anchor_content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    githubThreadId: row.github_thread_id,
    comments,
  };
}

function rowToComment(row: CommentRow): ThreadComment {
  return {
    id: row.id,
    author: { name: row.author_name, type: row.author_type as 'user' | 'agent' },
    body: row.body,
    createdAt: row.created_at,
    githubCommentId: row.github_comment_id,
  };
}

function getCommentsForThreads(threadIds: string[]): Map<string, ThreadComment[]> {
  if (threadIds.length === 0) {
    return new Map();
  }
  const placeholders = threadIds.map(() => '?').join(', ');
  const rows = queryAll<CommentRow>(
    `SELECT * FROM comments WHERE thread_id IN (${placeholders}) ORDER BY created_at ASC`,
    ...threadIds,
  );

  const map = new Map<string, ThreadComment[]>();
  for (const row of rows) {
    const comments = map.get(row.thread_id) ?? [];
    comments.push(rowToComment(row));
    map.set(row.thread_id, comments);
  }
  return map;
}

function getCommentsForThread(threadId: string): ThreadComment[] {
  const map = getCommentsForThreads([threadId]);
  return map.get(threadId) ?? [];
}

export function createThread(
  sessionId: string,
  filePath: string,
  side: string,
  startLine: number,
  endLine: number,
  body: string,
  author: ThreadAuthor,
  anchorContent?: string,
): Thread {
  const db = getDb();
  const threadId = randomUUID();
  const commentId = randomUUID();
  const now = new Date().toISOString();

  const cleanBody = unescapeMarkdown(body);

  transaction(() => {
    db.prepare(
      'INSERT INTO comment_threads (id, session_id, file_path, side, start_line, end_line, anchor_content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(threadId, sessionId, filePath, side, startLine, endLine, anchorContent ?? null, now, now);

    db.prepare(
      'INSERT INTO comments (id, thread_id, author_name, author_type, body, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(commentId, threadId, author.name, author.type, cleanBody, now);
  });

  return {
    id: threadId,
    sessionId,
    filePath,
    side,
    startLine,
    endLine,
    status: 'open',
    anchorContent: anchorContent ?? null,
    createdAt: now,
    updatedAt: now,
    githubThreadId: null,
    comments: [{
      id: commentId,
      author,
      body: cleanBody,
      createdAt: now,
      githubCommentId: null,
    }],
  };
}

interface JoinedRow extends ThreadRow {
  c_id: string | null;
  c_author_name: string | null;
  c_author_type: string | null;
  c_body: string | null;
  c_created_at: string | null;
  c_github_comment_id: number | null;
}

export function getThreadsForSession(sessionId: string, status?: ThreadStatus): Thread[] {
  const where = status
    ? 'WHERE t.session_id = ? AND t.status = ?'
    : 'WHERE t.session_id = ?';
  const params = status ? [sessionId, status] : [sessionId];

  const rows = queryAll<JoinedRow>(`
    SELECT t.*,
           c.id AS c_id, c.author_name AS c_author_name, c.author_type AS c_author_type,
           c.body AS c_body, c.created_at AS c_created_at, c.github_comment_id AS c_github_comment_id
    FROM comment_threads t
    LEFT JOIN comments c ON c.thread_id = t.id
    ${where}
    ORDER BY t.created_at ASC, c.created_at ASC
  `, ...params);

  const threads = new Map<string, Thread>();
  for (const row of rows) {
    let thread = threads.get(row.id);
    if (!thread) {
      thread = rowToThread(row, []);
      threads.set(row.id, thread);
    }
    if (row.c_id) {
      thread.comments.push({
        id: row.c_id,
        author: { name: row.c_author_name!, type: row.c_author_type as 'user' | 'agent' },
        body: row.c_body!,
        createdAt: row.c_created_at!,
        githubCommentId: row.c_github_comment_id,
      });
    }
  }
  return Array.from(threads.values());
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function findThreadRows(idOrPrefix: string, sessionId: string | null): ThreadRow[] {
  const scoped = sessionId === null ? '' : ' AND session_id = ?';
  const params = sessionId === null ? [] : [sessionId];
  const exact = queryOne<ThreadRow>(`SELECT * FROM comment_threads WHERE id = ?${scoped}`, idOrPrefix, ...params);
  if (exact || idOrPrefix.length < 8) {
    return exact ? [exact] : [];
  }
  return queryAll<ThreadRow>(
    `SELECT * FROM comment_threads WHERE id LIKE ? ESCAPE '\\'${scoped} LIMIT 2`,
    `${escapeLike(idOrPrefix)}%`,
    ...params,
  );
}

/**
 * The thread of `sessionId` with the id `idOrPrefix`, or the one whose id
 * starts with it. A prefix needs 8 characters and has to be unambiguous.
 */
export function findThread(sessionId: string, idOrPrefix: string): Thread {
  const id = idOrPrefix.trim();
  const rows = findThreadRows(id, sessionId);
  if (rows.length > 1) {
    throw new Error(`Thread id prefix "${id}" is ambiguous, use more characters`);
  }
  if (rows.length === 1) {
    return rowToThread(rows[0], getCommentsForThread(rows[0].id));
  }
  if (id.length < 8) {
    throw new Error(`Thread not found: ${id} (use at least 8 characters of the id)`);
  }
  const elsewhere = findThreadRows(id, null)[0];
  if (elsewhere) {
    const session = queryOne<{ ref: string; scope: string | null }>(
      'SELECT ref, scope FROM review_sessions WHERE id = ?',
      elsewhere.session_id,
    );
    const sid = elsewhere.session_id;
    const where = session ? ` (ref "${session.ref}"${session.scope ? ` on ${session.scope}` : ''})` : '';
    throw new Error(`Thread ${id} belongs to session ${sid}${where}. Rerun without --ref and with DIFFITY_SESSION_ID=${sid}`);
  }
  throw new Error(`Thread not found: ${id}`);
}

export function addReply(threadId: string, body: string, author: ThreadAuthor): ThreadComment {
  const db = getDb();
  const commentId = randomUUID();
  const now = new Date().toISOString();
  const cleanBody = unescapeMarkdown(body);

  transaction(() => {
    db.prepare(
      'INSERT INTO comments (id, thread_id, author_name, author_type, body, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(commentId, threadId, author.name, author.type, cleanBody, now);

    if (author.type === 'user') {
      db.prepare(
        'UPDATE comment_threads SET status = ?, updated_at = ? WHERE id = ?'
      ).run('open', now, threadId);
    } else {
      db.prepare(
        'UPDATE comment_threads SET updated_at = ? WHERE id = ?'
      ).run(now, threadId);
    }
  });

  return {
    id: commentId,
    author,
    body: cleanBody,
    createdAt: now,
    githubCommentId: null,
  };
}

export function updateThreadStatus(threadId: string, status: ThreadStatus, summaryBody?: string, summaryAuthor?: ThreadAuthor): void {
  const db = getDb();
  const now = new Date().toISOString();

  transaction(() => {
    db.prepare(
      'UPDATE comment_threads SET status = ?, updated_at = ? WHERE id = ?'
    ).run(status, now, threadId);

    if (summaryBody && summaryAuthor) {
      const commentId = randomUUID();
      const cleanSummary = unescapeMarkdown(summaryBody);
      db.prepare(
        'INSERT INTO comments (id, thread_id, author_name, author_type, body, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(commentId, threadId, summaryAuthor.name, summaryAuthor.type, cleanSummary, now);
    }
  });
}

export function deleteThread(threadId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM comment_threads WHERE id = ?').run(threadId);
}

export function deleteAllThreadsForSession(sessionId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM comment_threads WHERE session_id = ?').run(sessionId);
}

/** The thread, author and body of comment `commentId`, `null` when it does not exist. */
export function getComment(commentId: string): { threadId: string; author: ThreadAuthor; body: string } | null {
  const row = queryOne<CommentRow>('SELECT * FROM comments WHERE id = ?', commentId);
  return row ? { threadId: row.thread_id, author: rowToComment(row).author, body: row.body } : null;
}

export function editComment(commentId: string, body: string): void {
  const db = getDb();
  db.prepare('UPDATE comments SET body = ? WHERE id = ?').run(unescapeMarkdown(body), commentId);
}

export function deleteComment(commentId: string): void {
  const db = getDb();
  transaction(() => {
    const comment = queryOne<{ thread_id: string }>('SELECT thread_id FROM comments WHERE id = ?', commentId);
    if (!comment) {
      return;
    }

    db.prepare('DELETE FROM comments WHERE id = ?').run(commentId);

    const remaining = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM comments WHERE thread_id = ?', comment.thread_id);
    if (remaining?.count === 0) {
      db.prepare('DELETE FROM comment_threads WHERE id = ?').run(comment.thread_id);
    }
  });
}
