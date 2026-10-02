import { basename } from 'node:path';
import { InputError } from './errors.js';
import { getRepoRoot, git, gitTry } from './exec.js';
import { verifyCommit } from './refs.js';
import { normalizeRef, WORKING_TREE_REFS } from './diff.js';
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

const BASE_BRANCHES = ['main', 'master', 'develop', 'trunk'];

/**
 * The branch the current one is compared against: its upstream when that is
 * another branch, else the default branch. That is the one `origin/HEAD`
 * names, or the first of main, master, develop and trunk that exists, the
 * remote one first. `null` on the default branch itself or without one.
 */
export function getBaseBranch(): string | null {
  const branch = getCurrentBranch();
  const remoteHead = gitTry(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'])?.trim();
  const defaultBranch = [remoteHead, ...BASE_BRANCHES.flatMap((name) => [`origin/${name}`, name])]
    .find((name): name is string => !!name && verifyCommit(name) !== null);
  if (defaultBranch === branch || defaultBranch === `origin/${branch}`) {
    return null;
  }
  const merge = branch === 'HEAD' ? null : gitTry(['config', '--get', `branch.${branch}.merge`])?.trim();
  if (merge && merge !== `refs/heads/${branch}`) {
    const upstream = gitTry(['rev-parse', '--abbrev-ref', '@{upstream}'])?.trim();
    if (upstream && verifyCommit(upstream)) {
      return upstream;
    }
  }
  return defaultBranch ?? null;
}

export function getRepoInfo(): RepoInfo {
  return {
    name: getRepoName(),
    branch: getCurrentBranch(),
    root: getRepoRoot(),
  };
}

/** Whether `ref` is a commit or a range the server can diff, including the parent range of a root commit. */
export function isValidGitRef(ref: string): boolean {
  try {
    normalizeRef(ref);
    return true;
  } catch (err) {
    if (err instanceof InputError) {
      return false;
    }
    throw err;
  }
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
