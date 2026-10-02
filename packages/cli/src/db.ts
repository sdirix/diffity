import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { getDiffityDir } from '@diffity/git';

const require = createRequire(import.meta.url);

let db: DatabaseSync | null = null;

// Loaded lazily: `node:sqlite` only exists on Node >= 22.13, and a static import
// would abort the whole CLI at startup instead of showing this hint.
function loadSqlite(): { DatabaseSync: new (path: string) => DatabaseSync } {
  try {
    return require('node:sqlite');
  } catch {
    throw new Error(
      `diffity needs Node's built-in sqlite module, which requires Node >= 22.13 (running ${process.version}).`,
    );
  }
}

export function getDb(): DatabaseSync {
  if (db) {
    return db;
  }

  const { DatabaseSync: Database } = loadSqlite();
  const conn = new Database(join(getDiffityDir(), 'reviews.db'));
  try {
    // The server and `diffity agent` processes write the same file, so wait for a lock instead of failing.
    conn.exec('PRAGMA busy_timeout = 5000');
    conn.exec('PRAGMA journal_mode = WAL');
    migrate(conn);
    conn.exec('PRAGMA foreign_keys = ON');
  } catch (err) {
    conn.close();
    throw err;
  }
  db = conn;
  return db;
}

// node:sqlite types every row as `Record<string, SQLOutputValue>`, so the shape a
// query returns has to be asserted. These helpers keep that assertion in one place
// rather than at every call site.
export function queryAll<T>(sql: string, ...params: SQLInputValue[]): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

export function queryOne<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
  return getDb().prepare(sql).get(...params) as T | undefined;
}

let transactionDepth = 0;

/**
 * Runs `fn` in a write transaction, so a multi-row change is never half applied.
 * `BEGIN IMMEDIATE` takes the write lock up front, where the busy timeout applies.
 * Nested calls join the outer transaction.
 */
export function transaction<T>(fn: () => T): T {
  const conn = getDb();
  if (transactionDepth > 0) {
    return fn();
  }
  conn.exec('BEGIN IMMEDIATE');
  transactionDepth++;
  try {
    const result = fn();
    conn.exec('COMMIT');
    return result;
  } catch (err) {
    rollback(conn);
    throw err;
  } finally {
    transactionDepth--;
  }
}

// SQLite already rolls back on some errors, and a second ROLLBACK would hide the original error.
function rollback(conn: DatabaseSync): void {
  try {
    conn.exec('ROLLBACK');
  } catch {
    // No transaction left to roll back.
  }
}

/**
 * Schema steps, applied in order. `PRAGMA user_version` records how many have run.
 * Never edit a released step, append a new one.
 */
const MIGRATIONS: ((db: DatabaseSync) => void)[] = [
  // The schema from before versioned migrations. `IF NOT EXISTS` lets files created back then pass through.
  (db) => db.exec(`
    CREATE TABLE IF NOT EXISTS review_sessions (
      id TEXT PRIMARY KEY,
      ref TEXT NOT NULL,
      head_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS comment_threads (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES review_sessions(id),
      file_path TEXT NOT NULL,
      side TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      anchor_content TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,
      author_name TEXT NOT NULL,
      author_type TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_threads_session ON comment_threads(session_id);
    CREATE INDEX IF NOT EXISTS idx_comments_thread ON comments(thread_id);

    CREATE TABLE IF NOT EXISTS tours (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES review_sessions(id),
      topic TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'building',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS tour_steps (
      id TEXT PRIMARY KEY,
      tour_id TEXT NOT NULL REFERENCES tours(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      annotation TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_tours_session ON tours(session_id);
    CREATE INDEX IF NOT EXISTS idx_tour_steps_tour ON tour_steps(tour_id);
  `),
  // Sessions are keyed by (ref, scope) instead of (ref, head_hash). Older rows keep a NULL scope
  // until a branch adopts them, see `findOrCreateSession`. All of them stay, as an older diffity
  // that still runs may hold one and write comments to it.
  (db) => db.exec(`
    ALTER TABLE review_sessions ADD COLUMN scope TEXT;
    CREATE UNIQUE INDEX idx_sessions_ref_scope ON review_sessions(ref, scope);
  `),
  // Files marked viewed per session. `blob` is the file's new side when it was marked, NULL when it had
  // none, and `kept` whether that blob was stored as text to diff against once the file changes.
  (db) => db.exec(`
    CREATE TABLE viewed_files (
      session_id TEXT NOT NULL REFERENCES review_sessions(id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      blob TEXT,
      kept INTEGER NOT NULL DEFAULT 0,
      viewed_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (session_id, file_path)
    );
  `),
  // A single ref is diffed from its merge base with HEAD against the working tree, so its view is branch
  // relative. Its sessions shared by every branch go back to having no scope, for their branch to adopt.
  (db) => db.exec(`
    UPDATE review_sessions SET scope = NULL
    WHERE scope = '' AND ref <> '__tree__' AND instr(ref, '..') = 0;
  `),
  // The GitHub review thread and comment a local one is. `github_resolved` is the state GitHub reported
  // last, so a sync only applies what changed there. `github_review_id` marks threads posted in a review body.
  (db) => db.exec(`
    ALTER TABLE comment_threads ADD COLUMN github_thread_id TEXT;
    ALTER TABLE comment_threads ADD COLUMN github_resolved INTEGER;
    ALTER TABLE comment_threads ADD COLUMN github_review_id TEXT;
    ALTER TABLE comments ADD COLUMN github_comment_id INTEGER;
    CREATE INDEX idx_threads_github ON comment_threads(github_thread_id);
  `),
];

function userVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

function migrate(db: DatabaseSync): void {
  if (userVersion(db) >= MIGRATIONS.length) {
    return;
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    // Read again under the lock, another process may have migrated in the meantime.
    const from = userVersion(db);
    for (let version = from; version < MIGRATIONS.length; version++) {
      MIGRATIONS[version](db);
    }
    if (from < MIGRATIONS.length) {
      db.exec(`PRAGMA user_version = ${MIGRATIONS.length}`);
    }
    db.exec('COMMIT');
  } catch (err) {
    rollback(db);
    throw err;
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
