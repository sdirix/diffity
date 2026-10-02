import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { InputError } from './errors.js';
import { getRepoRoot, git, gitTry } from './exec.js';
import { verifyCommit } from './refs.js';
import { WORKING_TREE_REFS } from './diff.js';
import type { RepoInfo } from './types.js';

export function isGitRepo(): boolean {
  return gitTry(['rev-parse', '--is-inside-work-tree'])?.trim() === 'true';
}

export { getRepoRoot };

export function getRepoName(): string {
  const root = getRepoRoot();
  return basename(root) || root;
}

/** The checked out branch, also when it has no commits yet, or `HEAD` when detached. */
export function getCurrentBranch(): string {
  return gitTry(['symbolic-ref', '--quiet', '--short', 'HEAD'])?.trim() || 'HEAD';
}

export function getRepoInfo(): RepoInfo {
  return {
    name: getRepoName(),
    branch: getCurrentBranch(),
    root: getRepoRoot(),
  };
}

export function getDiffityDirPath(): string {
  const repoRoot = getRepoRoot();
  const hash = createHash('sha256').update(repoRoot).digest('hex').slice(0, 12);
  return join(homedir(), '.diffity', hash);
}

export function getDiffityDir(): string {
  const dir = getDiffityDirPath();
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function isValidGitRef(ref: string): boolean {
  for (const sep of ['...', '..']) {
    const idx = ref.indexOf(sep);
    if (idx !== -1) {
      const left = ref.slice(0, idx) || 'HEAD';
      const right = ref.slice(idx + sep.length) || 'HEAD';
      return verifyCommit(left) !== null && verifyCommit(right) !== null;
    }
  }
  return verifyCommit(ref) !== null;
}

export function getRemoteUrl(name = 'origin'): string | null {
  return gitTry(['remote', 'get-url', '--', name])?.trim() || null;
}

/**
 * Fetches `branch` from `remote` into its remote-tracking ref and returns
 * that ref, e.g. `origin/main`, which is current even when the local branch
 * is missing or stale.
 */
export function fetchRemoteBranch(remote: string, branch: string): string {
  if (!remote || remote.startsWith('-') || !branch) {
    throw new InputError(`Invalid branch: ${remote}/${branch}`);
  }
  git(['fetch', remote, `+refs/heads/${branch}:refs/remotes/${remote}/${branch}`]);
  return `${remote}/${branch}`;
}

export interface RefCapabilities {
  reviews: boolean;
  revert: boolean;
  staleness: boolean;
}

export function getRefCapabilities(ref?: string): RefCapabilities {
  if (!ref) {
    return { reviews: true, revert: false, staleness: false };
  }
  const isWorkingTree = WORKING_TREE_REFS.has(ref);
  return {
    reviews: true,
    revert: isWorkingTree,
    staleness: true,
  };
}
