import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { closeDb, getDb, queryAll, queryOne, transaction } from '../src/db.js';
import { createThread, getThreadsForSession } from '../src/threads.js';
import { createRepo, dbPath, writeLegacyDb, type TempRepo } from './helpers.js';

let repo: TempRepo;

beforeEach(() => {
  repo = createRepo();
});

afterEach(() => {
  repo.remove();
});

describe('getDb', () => {
  it('migrates a database created before versioned migrations', () => {
    writeLegacyDb(`
      INSERT INTO review_sessions (id, ref, head_hash) VALUES ('s1', 'work', 'abc');
      INSERT INTO comment_threads (id, session_id, file_path, side, start_line, end_line)
        VALUES ('t1', 's1', 'a.txt', 'new', 1, 1);
      INSERT INTO comments (id, thread_id, author_name, author_type, body)
        VALUES ('c1', 't1', 'You', 'user', 'keep me');
    `);

    const version = queryOne<{ user_version: number }>('PRAGMA user_version')!.user_version;
    expect(version).toBeGreaterThan(0);
    const threads = getThreadsForSession('s1');
    expect(threads.map((t) => t.comments[0].body)).toEqual(['keep me']);

    closeDb();
    expect(queryOne<{ user_version: number }>('PRAGMA user_version')!.user_version).toBe(version);
  });

  it('waits for other writers and uses WAL', () => {
    expect(queryOne<{ timeout: number }>('PRAGMA busy_timeout')!.timeout).toBe(5000);
    expect(queryOne<{ journal_mode: string }>('PRAGMA journal_mode')!.journal_mode).toBe('wal');
  });

  it('writes while another process holds the lock', async () => {
    getDb().prepare("INSERT INTO review_sessions (id, ref, head_hash) VALUES ('s1', 'work', '')").run();
    const holder = spawn(process.execPath, ['-e', `
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(${JSON.stringify(dbPath())});
      db.exec('BEGIN IMMEDIATE');
      console.log('locked');
      setTimeout(() => { db.exec('COMMIT'); db.close(); }, 300);
    `]);
    await new Promise<void>((resolve, reject) => {
      holder.stdout.on('data', () => resolve());
      holder.on('exit', () => reject(new Error('lock holder exited early')));
    });

    createThread('s1', 'a.txt', 'new', 1, 1, 'after the lock', { name: 'Agent', type: 'agent' });
    expect(getThreadsForSession('s1')).toHaveLength(1);
  });
});

describe('transaction', () => {
  it('rolls back every write when one fails', () => {
    getDb().prepare("INSERT INTO review_sessions (id, ref, head_hash) VALUES ('s1', 'work', '')").run();
    expect(() => transaction(() => {
      getDb().prepare("INSERT INTO review_sessions (id, ref, head_hash) VALUES ('s2', 'work', '')").run();
      getDb().prepare("INSERT INTO review_sessions (id, ref, head_hash) VALUES ('s1', 'work', '')").run();
    })).toThrow();
    expect(queryAll<{ id: string }>('SELECT id FROM review_sessions').map((r) => r.id)).toEqual(['s1']);
  });
});
