import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { findOrCreateSession, TREE_REF } from '../src/session.js';
import { addReply, createThread } from '../src/threads.js';
import { createTour, getToursForSession } from '../src/tours.js';
import { markViewed } from '../src/viewed.js';
import { clearRepoData, countRepoData } from '../src/repo-data.js';
import { createRepo, type TempRepo } from './helpers.js';

let repo: TempRepo;

beforeEach(() => {
  repo = createRepo();
});

afterEach(() => {
  repo.remove();
});

describe('repo data', () => {
  it('counts and clears comments and viewed marks of every session, keeping tours', () => {
    const author = { name: 'You', type: 'user' as const };
    const work = findOrCreateSession('work');
    const tree = findOrCreateSession(TREE_REF);
    const thread = createThread(work.id, 'a.txt', 'new', 1, 1, 'one', author);
    addReply(thread.id, 'two', author);
    createThread(tree.id, 'a.txt', 'new', 2, 2, 'three', author);
    markViewed(work, ['a.txt']);
    createTour(tree.id, 'topic', 'body');

    expect(countRepoData()).toEqual({ threads: 2, comments: 3, viewed: 1 });
    clearRepoData();
    expect(countRepoData()).toEqual({ threads: 0, comments: 0, viewed: 0 });
    expect(getToursForSession(tree.id)).toHaveLength(1);
  });
});
