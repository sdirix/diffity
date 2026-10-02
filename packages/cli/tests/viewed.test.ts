import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDb, queryOne } from '../src/db.js';
import { findOrCreateSession } from '../src/session.js';
import { getChangesSinceViewed, getViewedFiles, markViewed, unmarkViewed } from '../src/viewed.js';
import { createRepo, writeLegacyDb, type TempRepo } from './helpers.js';

let repo: TempRepo;

beforeEach(() => {
  repo = createRepo();
});

afterEach(() => {
  repo.remove();
});

describe('viewed files', () => {
  it('keep the viewed version and report the current one', () => {
    const session = findOrCreateSession('work');
    repo.write('a.txt', 'one\ntwo\nthree\nfour\n');
    markViewed(session, ['a.txt']);

    const [viewed] = getViewedFiles(session);
    expect(viewed).toMatchObject({ path: 'a.txt', kept: true });
    expect(viewed.current).toBe(viewed.blob);
    expect(getChangesSinceViewed(session, 'a.txt')).toBe('');

    repo.write('a.txt', 'one\ntwo\nthree\nfour\nfive\n');
    const [changed] = getViewedFiles(session);
    expect(changed.blob).toBe(viewed.blob);
    expect(changed.current).not.toBe(viewed.blob);
    const patch = getChangesSinceViewed(session, 'a.txt');
    expect(patch).toContain(' four\n+five\n');
    expect(patch).not.toMatch(/^-(?!--)/m);

    markViewed(session, ['a.txt']);
    const [again] = getViewedFiles(session);
    expect(again.current).toBe(again.blob);
  });

  it('stay apart per session and unmark', () => {
    const work = findOrCreateSession('work');
    const staged = findOrCreateSession('staged');
    markViewed(work, ['a.txt', 'gone.txt']);
    expect(getViewedFiles(work).map((file) => [file.path, file.blob === null, file.kept])).toEqual([
      ['a.txt', false, true],
      ['gone.txt', true, false],
    ]);
    expect(getViewedFiles(staged)).toEqual([]);

    unmarkViewed(work, ['a.txt']);
    expect(getViewedFiles(work).map((file) => file.path)).toEqual(['gone.txt']);
    expect(() => getChangesSinceViewed(work, 'gone.txt')).toThrow('No viewed version');
  });

  it('read the right end of a range', () => {
    repo.write('a.txt', 'v2\n');
    repo.commit('v2');
    const session = findOrCreateSession('HEAD~1..HEAD');
    markViewed(session, ['a.txt']);
    repo.write('a.txt', 'edited in the working tree\n');
    const [viewed] = getViewedFiles(session);
    expect(viewed.blob).toBe(repo.git('rev-parse', 'HEAD:a.txt').trim());
    expect(viewed.current).toBe(viewed.blob);
  });

  it('are created by the migration of an older database', () => {
    writeLegacyDb("INSERT INTO review_sessions (id, ref, head_hash) VALUES ('s1', 'work', 'abc');");
    getDb();
    expect(queryOne<{ name: string }>("SELECT name FROM sqlite_master WHERE name = 'viewed_files'")?.name).toBe('viewed_files');
  });
});
