import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  getBranchReflog,
  getCurrentBranch,
  getDiffityDir,
  getHeadHash,
  isAncestor,
  verifyCommit,
  WORKING_TREE_REFS,
} from '@diffity/git';
import { getDb, queryAll, queryOne, transaction } from './db.js';

export const TREE_REF = '__tree__';

export interface Session {
  id: string;
  ref: string;
  /** The branch a HEAD relative view belongs to, empty for a view that reads the same on every branch. */
  scope: string;
  /** HEAD when the session was created. */
  headHash: string;
}

interface SessionRow {
  id: string;
  ref: string;
  scope: string | null;
  head_hash: string;
}

function rowToSession(row: SessionRow): Session {
  return { id: row.id, ref: row.ref, scope: row.scope ?? '', headHash: row.head_hash };
}

/** The views opened last. Diff views and the file browser are tracked apart, so neither replaces the other. */
function sessionFilePath(ref: string): string {
  return join(getDiffityDir(), ref === TREE_REF ? 'current-tree-session' : 'current-session');
}

const COMMIT_HASH = /^[0-9a-f]{7,40}$/i;

function mentionsHead(ref: string): boolean {
  return ref.split(/[^A-Za-z0-9]/).includes('HEAD') || /(^|\.\.)@($|[~^{.])/.test(ref);
}

function isTag(name: string): boolean {
  return verifyCommit(`refs/tags/${name}`) !== null;
}

/**
 * Whether the diff of `ref` depends on the checked out branch: the working
 * tree views, a branch diffed against the working tree, and any ref or range
 * that names HEAD or leaves an end out. Commit hashes, tags, ranges between
 * named commits and the file browser read the same on every branch.
 */
export function isBranchRelative(ref: string, tagExists: (name: string) => boolean = isTag): boolean {
  if (ref === TREE_REF) {
    return false;
  }
  if (WORKING_TREE_REFS.has(ref) || mentionsHead(ref)) {
    return true;
  }
  const range = ref.match(/^(.*?)\.\.\.?(.*)$/);
  if (range) {
    return !range[1] || !range[2];
  }
  const base = ref.split(/[~^]/)[0];
  return !COMMIT_HASH.test(base) && !tagExists(base);
}

/** The checked out branch, or `detached@<sha>` for a detached HEAD. */
export function currentScope(): string {
  const branch = getCurrentBranch();
  if (branch !== 'HEAD') {
    return branch;
  }
  const head = getHeadHash();
  return head ? `detached@${head.slice(0, 12)}` : '';
}

export function sessionScope(ref: string): string {
  return isBranchRelative(ref) ? currentScope() : '';
}

function findScopedSession(ref: string, scope: string): SessionRow | undefined {
  return queryOne<SessionRow>('SELECT * FROM review_sessions WHERE ref = ? AND scope = ?', ref, scope);
}

/**
 * Sessions from before scoping, one per HEAD a view was opened at, that may
 * belong to `scope`: all of them for a view that reads the same everywhere,
 * else those whose HEAD is in the branch's history or reflog. Whichever
 * branch opens the view first takes a session both could claim.
 */
function adoptableSessions(ref: string, scope: string): SessionRow[] {
  const legacy = queryAll<SessionRow>(
    'SELECT * FROM review_sessions WHERE ref = ? AND scope IS NULL ORDER BY created_at DESC, rowid DESC',
    ref,
  );
  if (legacy.length === 0 || !scope) {
    return legacy;
  }
  if (scope.startsWith('detached@')) {
    const head = getHeadHash() ?? '';
    return legacy.filter((s) => s.head_hash === head);
  }
  const reflog = new Set(getBranchReflog(scope));
  const owned = new Map<string, boolean>();
  return legacy.filter((s) => {
    if (!s.head_hash || reflog.has(s.head_hash)) {
      return true;
    }
    if (!owned.has(s.head_hash)) {
      owned.set(s.head_hash, isAncestor(s.head_hash, 'HEAD'));
    }
    return owned.get(s.head_hash)!;
  });
}

/** Folds `sessions` into the first, which becomes the session of (`ref`, `scope`). */
function adoptSessions(sessions: SessionRow[], scope: string): SessionRow {
  const db = getDb();
  const [kept, ...merged] = sessions;
  for (const session of merged) {
    db.prepare('UPDATE comment_threads SET session_id = ? WHERE session_id = ?').run(kept.id, session.id);
    db.prepare('UPDATE tours SET session_id = ? WHERE session_id = ?').run(kept.id, session.id);
    db.prepare('DELETE FROM review_sessions WHERE id = ?').run(session.id);
  }
  db.prepare('UPDATE review_sessions SET scope = ? WHERE id = ?').run(scope, kept.id);
  return { ...kept, scope };
}

/**
 * The session for a view of `ref`, keyed by (ref, scope) so its threads stay
 * reachable across commits, amends and pulls, and stay apart per branch.
 */
export function findOrCreateSession(ref: string): Session {
  const scope = sessionScope(ref);
  let row = findScopedSession(ref, scope);
  if (!row) {
    const adoptable = adoptableSessions(ref, scope);
    row = transaction(() => {
      const raced = findScopedSession(ref, scope);
      if (raced) {
        return raced;
      }
      const ids = new Set(
        queryAll<{ id: string }>('SELECT id FROM review_sessions WHERE ref = ? AND scope IS NULL', ref).map((r) => r.id),
      );
      const legacy = adoptable.filter((s) => ids.has(s.id));
      if (legacy.length > 0) {
        return adoptSessions(legacy, scope);
      }
      const created: SessionRow = { id: randomUUID(), ref, scope, head_hash: getHeadHash() ?? '' };
      getDb().prepare(
        'INSERT INTO review_sessions (id, ref, scope, head_hash) VALUES (?, ?, ?, ?)'
      ).run(created.id, ref, scope, created.head_hash);
      return created;
    });
  }

  return rowToSession(row);
}

export function getSessionById(id: string): Session | null {
  const row = queryOne<SessionRow>('SELECT * FROM review_sessions WHERE id = ?', id);
  return row ? rowToSession(row) : null;
}

/** Records `session` as the one a view just opened, the default for `diffity agent`. */
export function setCurrentSession(session: Session): void {
  writeFileSync(sessionFilePath(session.ref), JSON.stringify(session));
}

function readCurrentRef(file: string): string | null {
  try {
    const saved: { ref?: unknown } = JSON.parse(readFileSync(file, 'utf-8'));
    return typeof saved.ref === 'string' ? saved.ref : null;
  } catch {
    return null;
  }
}

/**
 * The session of the diff view opened last, or of the file browser when no
 * diff was opened. Looked up again by its ref, so it follows the branch that
 * is checked out now.
 */
export function getCurrentSession(): Session | null {
  const ref = readCurrentRef(sessionFilePath('')) ?? readCurrentRef(sessionFilePath(TREE_REF));
  return ref === null ? null : findOrCreateSession(ref);
}
