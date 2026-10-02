import { randomUUID } from 'node:crypto';
import { getDb, queryOne, transaction } from './db.js';
import { unescapeMarkdown } from './unescape.js';
import type { ThreadAuthor, ThreadComment } from './threads.js';

/** An agent's comment says so on GitHub, where it shows under your name. */
export function bodyForGitHub(body: string, authorName: string, authorType: string): string {
  return authorType === 'agent' ? `${body.trimEnd()}\n\n<sub>Drafted by ${authorName} in diffity</sub>` : body;
}

/** The GitHub review thread a local thread is, `null` for a local only thread. */
export function githubThreadOf(threadId: string): string | null {
  return queryOne<{ github_thread_id: string | null }>('SELECT github_thread_id FROM comment_threads WHERE id = ?', threadId)?.github_thread_id ?? null;
}

/** Stores a reply posted to GitHub. Unlike a local reply it leaves the status alone, GitHub does too. */
export function recordGitHubReply(threadId: string, body: string, author: ThreadAuthor, githubCommentId: number | null): ThreadComment {
  const id = randomUUID();
  const now = new Date().toISOString();
  const cleanBody = unescapeMarkdown(body);
  transaction(() => {
    getDb().prepare(
      'INSERT INTO comments (id, thread_id, author_name, author_type, body, created_at, github_comment_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(id, threadId, author.name, author.type, cleanBody, now, githubCommentId);
    getDb().prepare('UPDATE comment_threads SET updated_at = ? WHERE id = ?').run(now, threadId);
  });
  return { id, author, body: cleanBody, createdAt: now, githubCommentId };
}

export function recordGitHubStatus(threadId: string, resolved: boolean): void {
  getDb().prepare('UPDATE comment_threads SET status = ?, github_resolved = ?, updated_at = ? WHERE id = ?')
    .run(resolved ? 'resolved' : 'open', resolved ? 1 : 0, new Date().toISOString(), threadId);
}

export interface PostableComment {
  id: string;
  body: string;
  authorName: string;
  authorType: string;
  githubCommentId: number | null;
  githubThreadId: string | null;
}

export function findComment(commentId: string): PostableComment | null {
  return queryOne<PostableComment>(`
    SELECT c.id, c.body, c.author_name AS authorName, c.author_type AS authorType, c.github_comment_id AS githubCommentId,
      t.github_thread_id AS githubThreadId
    FROM comments c JOIN comment_threads t ON t.id = c.thread_id
    WHERE c.id = ?
  `, commentId) ?? null;
}

export function setCommentGitHubId(commentId: string, githubCommentId: number | null): void {
  getDb().prepare('UPDATE comments SET github_comment_id = ? WHERE id = ?').run(githubCommentId, commentId);
}
