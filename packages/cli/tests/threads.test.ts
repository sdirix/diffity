import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb } from '../src/db.js';
import { findOrCreateSession } from '../src/session.js';
import { createThread, findThread } from '../src/threads.js';
import { createRepo, type TempRepo } from './helpers.js';

let repo: TempRepo;

function insertThread(id: string, sessionId: string): void {
  getDb().prepare(
    "INSERT INTO comment_threads (id, session_id, file_path, side, start_line, end_line) VALUES (?, ?, 'a.txt', 'new', 1, 1)"
  ).run(id, sessionId);
}

beforeEach(() => {
  repo = createRepo();
});

afterEach(() => {
  repo.remove();
});

describe('findThread', () => {
  it('finds a thread by id or unique prefix in its session', () => {
    const session = findOrCreateSession('work');
    const thread = createThread(session.id, 'a.txt', 'new', 1, 1, 'hi', { name: 'You', type: 'user' });
    expect(findThread(session.id, thread.id).comments[0].body).toBe('hi');
    expect(findThread(session.id, ` ${thread.id.slice(0, 8)} `).id).toBe(thread.id);
  });

  it('rejects short, ambiguous and foreign ids', () => {
    const session = findOrCreateSession('work');
    const other = findOrCreateSession('__tree__');
    insertThread('aaaaaaaa-1', session.id);
    insertThread('aaaaaaaa-2', session.id);
    insertThread('bbbbbbbb-1', other.id);
    insertThread('cccc%ccc-1', session.id);

    expect(() => findThread(session.id, 'aaaa')).toThrow('at least 8 characters');
    expect(() => findThread(session.id, 'aaaaaaaa')).toThrow('ambiguous');
    expect(findThread(session.id, 'aaaaaaaa-2').id).toBe('aaaaaaaa-2');
    expect(() => findThread(session.id, 'bbbbbbbb')).toThrow(
      `belongs to session ${other.id} (ref "__tree__"). Rerun without --ref and with DIFFITY_SESSION_ID=${other.id}`,
    );
    expect(() => findThread(session.id, 'cccc_ccc')).toThrow('not found');
    expect(findThread(session.id, 'cccc%ccc').id).toBe('cccc%ccc-1');
  });
});
