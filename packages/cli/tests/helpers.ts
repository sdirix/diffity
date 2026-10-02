import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { getDiffityDirPath } from '@diffity/git';
import { closeDb } from '../src/db.js';

export interface TempRepo {
  dir: string;
  home: string;
  git: (...args: string[]) => string;
  write: (name: string, content: string) => void;
  commit: (message: string) => void;
  remove: () => void;
}

/**
 * A repository with one commit on `main`, made the working directory, and an
 * empty HOME so the database lands in a throwaway `~/.diffity`.
 */
export function createRepo(): TempRepo {
  const dir = mkdtempSync(join(tmpdir(), 'diffity-cli-test-'));
  const home = mkdtempSync(join(tmpdir(), 'diffity-cli-home-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf-8', stdio: 'pipe' });

  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@test.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');

  const write = (name: string, content: string) => {
    const full = join(dir, name);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  };
  const commit = (message: string) => {
    git('add', '-A');
    git('commit', '-q', '-m', message);
  };
  write('a.txt', 'one\ntwo\nthree\n');
  commit('initial');

  const origCwd = process.cwd();
  const origHome = process.env.HOME;
  process.chdir(dir);
  process.env.HOME = home;

  return {
    dir,
    home,
    git,
    write,
    commit,
    remove() {
      closeDb();
      process.chdir(origCwd);
      process.env.HOME = origHome;
      rmSync(dir, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    },
  };
}

/** The schema as diffity created it before `PRAGMA user_version` was tracked. */
const LEGACY_SCHEMA = `
  CREATE TABLE review_sessions (
    id TEXT PRIMARY KEY,
    ref TEXT NOT NULL,
    head_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE comment_threads (
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
  CREATE TABLE comments (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,
    author_name TEXT NOT NULL,
    author_type TEXT NOT NULL,
    body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE tours (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES review_sessions(id),
    topic TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'building',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE tour_steps (
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
`;

export function dbPath(): string {
  return join(getDiffityDirPath(), 'reviews.db');
}

/** Writes a database the way a diffity release before versioned migrations left it. */
export function writeLegacyDb(sql: string): void {
  mkdirSync(getDiffityDirPath(), { recursive: true });
  const legacy = new DatabaseSync(dbPath());
  legacy.exec('PRAGMA journal_mode = WAL');
  legacy.exec(LEGACY_SCHEMA);
  legacy.exec(sql);
  legacy.close();
}
