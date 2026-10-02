import { getRepoRoot, git, gitTry } from './exec.js';

/**
 * Resolves `rev` to a commit hash, or `null` when it does not name a commit.
 * Revisions starting with `-` are rejected so they can never be read as an
 * option by a later git call.
 */
export function verifyCommit(rev: string): string | null {
  if (!rev || rev.startsWith('-')) {
    return null;
  }
  const out = gitTry(['rev-parse', '--verify', '--quiet', '--end-of-options', `${rev}^{commit}`]);
  return out?.trim() || null;
}

export function getMergeBase(a: string, b: string): string | null {
  return gitTry(['merge-base', '--end-of-options', a, b])?.trim() || null;
}

/** The commit HEAD points to, or `null` in a repository without commits. */
export function getHeadHash(): string | null {
  return verifyCommit('HEAD');
}

const emptyTrees = new Map<string, string>();

/** The empty tree, the base of a diff in a repository without commits. */
export function getEmptyTree(): string {
  const root = getRepoRoot();
  let tree = emptyTrees.get(root);
  if (tree === undefined) {
    tree = git(['hash-object', '-t', 'tree', '--stdin'], { input: '' }).trim();
    emptyTrees.set(root, tree);
  }
  return tree;
}

/** HEAD, or the empty tree when there are no commits yet. */
export function getHeadOrEmptyTree(): string {
  return getHeadHash() ?? getEmptyTree();
}
