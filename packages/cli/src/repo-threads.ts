import { readFileSync, statSync } from 'node:fs';
import { parseDiff } from '@diffity/parser';
import { getCommit, getHeadHash, resolveInRepo, resolveRef, WORKING_TREE_REFS } from '@diffity/git';
import { queryAll } from './db.js';
import { currentScope, TREE_REF } from './session.js';
import { getThreadsForSession, type Thread } from './threads.js';
import {
  indexDiff,
  locateThread,
  locateTreeThread,
  showsThread,
  treeThreadPath,
  type ThreadLocation,
  type ViewIndex,
} from './thread-location.js';

/** The commit that now holds the code a working tree thread was left on. */
export interface MovedTo {
  sha: string;
  shortSha: string;
  subject: string;
  /** The view of that commit's changes. */
  ref: string;
}

export interface LocatedThread extends Thread {
  ref: string;
  /** The branch a view of another branch than the checked out one belongs to. */
  otherBranch: string | null;
  location: ThreadLocation;
  movedTo: MovedTo | null;
}

interface SessionRow {
  id: string;
  ref: string;
  scope: string | null;
}

/** The diff of `ref` with the files `.diffityignore` hides, which can hold threads too. */
function loadIndex(ref: string): ViewIndex | null {
  try {
    return indexDiff(parseDiff(resolveRef(ref, [], { showHidden: true })));
  } catch {
    return null;
  }
}

/** The file's text, `''` for a folder or the root, `null` when the path is gone or leaves the repository. */
function readTreePath(path: string): string | null {
  if (!path) {
    return '';
  }
  try {
    const full = resolveInRepo(path);
    return statSync(full).isFile() ? readFileSync(full, 'utf-8') : '';
  } catch {
    return null;
  }
}

interface HeadCommit {
  movedTo: MovedTo;
  index: ViewIndex;
}

function loadHeadCommit(): HeadCommit | null {
  const sha = getHeadHash();
  if (!sha) {
    return null;
  }
  const ref = `${sha}~1..${sha}`;
  const index = loadIndex(ref);
  if (!index) {
    return null;
  }
  const subject = getCommit(sha)?.message ?? '';
  return { index, movedTo: { sha, shortSha: sha.slice(0, 7), subject, ref } };
}

/**
 * The threads of one session, or of every session of the repository, each
 * located in the current diff of its view. A thread of a working tree view
 * whose code is gone from it points at HEAD when HEAD's commit holds that code.
 */
export function listLocatedThreads(sessionId?: string): LocatedThread[] {
  const sessions = sessionId
    ? queryAll<SessionRow>('SELECT id, ref, scope FROM review_sessions WHERE id = ?', sessionId)
    : queryAll<SessionRow>('SELECT id, ref, scope FROM review_sessions ORDER BY created_at ASC, rowid ASC');
  const scope = currentScope();
  const views = new Map<string, ViewIndex | null>();
  const treeContent = new Map<string, string | null>();
  let head: HeadCommit | null | undefined;
  const out: LocatedThread[] = [];

  for (const session of sessions) {
    const threads = getThreadsForSession(session.id);
    if (threads.length === 0) {
      continue;
    }
    const otherBranch = session.scope && session.scope !== scope ? session.scope : null;
    let index: ViewIndex | null = null;
    if (!otherBranch && session.ref !== TREE_REF) {
      if (!views.has(session.ref)) {
        views.set(session.ref, loadIndex(session.ref));
      }
      index = views.get(session.ref)!;
    }

    for (const thread of threads) {
      let location: ThreadLocation;
      if (otherBranch) {
        location = 'unknown';
      } else if (session.ref === TREE_REF) {
        const path = treeThreadPath(thread);
        if (!treeContent.has(path)) {
          treeContent.set(path, readTreePath(path));
        }
        location = locateTreeThread(thread, treeContent.get(path)!);
      } else {
        location = index ? locateThread(index, thread) : 'unknown';
      }

      let movedTo: MovedTo | null = null;
      if (location !== 'current' && location !== 'unknown' && WORKING_TREE_REFS.has(session.ref)) {
        if (head === undefined) {
          head = loadHeadCommit();
        }
        movedTo = head && showsThread(head.index, thread) ? head.movedTo : null;
      }
      out.push({ ...thread, ref: session.ref, otherBranch, location, movedTo });
    }
  }
  return out;
}
