import { realpathSync } from 'node:fs';
import { join, sep } from 'node:path';
import { InputError } from './errors.js';
import { getRepoRoot } from './exec.js';

/**
 * Accepts only repo relative paths made of plain segments, so a path from a
 * request can neither be absolute nor climb out with `..`.
 */
export function assertRepoPath(rel: string): void {
  const segments = rel.split('/');
  if (!rel || rel.includes('\0') || segments.some((s) => s === '' || s === '.' || s === '..')) {
    throw new InputError(`Invalid path: ${rel}`);
  }
}

function isInside(root: string, path: string): boolean {
  return path === root || path.startsWith(root + sep);
}

/** The real path of `rel` in the working tree. Symlinks may not lead outside the repo. */
export function resolveInRepo(rel: string): string {
  assertRepoPath(rel);
  const root = getRepoRoot();
  let real: string;
  try {
    real = realpathSync(join(root, rel));
  } catch {
    throw new InputError(`File not found: ${rel}`, 'not_found');
  }
  if (!isInside(realpathSync(root), real)) {
    throw new InputError(`Path escapes the repository: ${rel}`);
  }
  return real;
}

/**
 * The working tree location of `rel` without following a final symlink, for
 * operations on the entry itself. Its parent directory may not lead outside
 * the repo.
 */
export function repoEntryPath(rel: string): string {
  assertRepoPath(rel);
  const root = getRepoRoot();
  const slash = rel.lastIndexOf('/');
  if (slash === -1) {
    return join(root, rel);
  }
  try {
    return join(resolveInRepo(rel.slice(0, slash)), rel.slice(slash + 1));
  } catch (err) {
    if (err instanceof InputError && err.code === 'not_found') {
      return join(root, rel);
    }
    throw err;
  }
}
