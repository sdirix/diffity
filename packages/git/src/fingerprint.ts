import { createHash, type Hash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeRef, resolveHeadRef, WORKING_TREE_REFS } from './diff.js';
import { getRepoRoot, gitNul } from './exec.js';
import { FIELDS_BEFORE_PATH } from './status.js';

/**
 * The changes a diff shows: the index against HEAD, the working tree against
 * the index, or both plus untracked files.
 */
type Scope = 'staged' | 'unstaged' | 'all';

/** Whether a status record bears on `scope`. `xy` holds the index and the working tree column. */
function inScope(kind: string, xy: string, scope: Scope): boolean {
  switch (kind) {
    case '?':
      return scope === 'all';
    case 'u':
      return true;
    case '1':
      return scope === 'all' || xy[scope === 'staged' ? 0 : 1] !== '.';
    default:
      return false;
  }
}

function statKey(root: string, path: string): string {
  const stat = lstatSync(join(root, path), { bigint: true, throwIfNoEntry: false });
  return stat ? `${stat.size}:${stat.mtimeNs}` : '-';
}

/**
 * Feeds `hash` with HEAD, the branch and the `git status` record of each
 * changed path in `scope`, which holds its index state, plus the size and
 * mtime of each changed or untracked file. A file that changes again keeps
 * its status but not its mtime.
 */
function hashStatus(hash: Hash, scope: Scope): void {
  const root = getRepoRoot();
  const records = gitNul([
    'status', '--porcelain=v2', '-z', '--branch', '--no-ahead-behind', '--no-renames', '--untracked-files=all',
  ]);
  for (const record of records) {
    const kind = record[0];
    if (kind === '#') {
      if (/^# branch\.(oid|head) /.test(record)) {
        hash.update(`${record}\0`);
      }
      continue;
    }
    const fields = record.split(' ');
    const xy = fields[1];
    if (!inScope(kind, xy, scope)) {
      continue;
    }
    const path = kind === '?' ? record.slice(2) : fields.slice(FIELDS_BEFORE_PATH[kind]).join(' ');
    if (scope === 'staged') {
      hash.update(`${kind === '1' ? `${xy[0]} ${fields[4]} ${fields[7]} ${path}` : record}\0`);
      continue;
    }
    hash.update(`${record}\0${statKey(root, path)}\0`);
  }
}

/**
 * Cheap change detector for the diff of `ref`. Read it before the diff, so
 * an edit landing in between makes the diff stale instead of being missed.
 * A range only depends on the commits it resolves to.
 */
export function getDiffFingerprint(ref: string): string {
  const hash = createHash('sha1');
  if (!WORKING_TREE_REFS.has(ref)) {
    hash.update(`${normalizeRef(ref)}\0`);
  }
  if (resolveHeadRef(ref).type !== 'ref') {
    hashStatus(hash, ref === 'staged' ? 'staged' : ref === 'unstaged' ? 'unstaged' : 'all');
  }
  return hash.digest('hex');
}

/** Cheap change detector for the file browser, which reads the whole working tree. */
export function getTreeFingerprint(): string {
  const hash = createHash('sha1');
  hashStatus(hash, 'all');
  return hash.digest('hex');
}
