import { lstatSync, unlinkSync } from 'node:fs';
import { InputError } from './errors.js';
import { git, gitBuffer, gitNul, gitTry } from './exec.js';
import { assertRepoPath, repoEntryPath } from './paths.js';
import { getEmptyTree, getHeadHash, getHeadOrEmptyTree, getMergeBase, verifyCommit } from './refs.js';
import { countLines, isBinary } from './text.js';
import { getUntrackedDiff } from './untracked.js';

/**
 * Flags that neutralize user git config which would otherwise alter the diff
 * format and break parsing:
 * - `--no-color` guards against `color.ui=always` / `color.diff=always`
 * - `--no-ext-diff` guards against a configured `diff.external` driver
 * - `--no-textconv` shows file content instead of textconv filter output
 * - `--no-relative` guards against `diff.relative`
 * - `--src-prefix`/`--dst-prefix` force the standard `a/`/`b/` prefixes,
 *   overriding `diff.mnemonicPrefix`, `diff.noprefix` and custom prefixes
 * - `-M` detects renames even with `diff.renames=false`
 * - `--submodule=short` keeps the `Subproject commit` patch of a submodule
 *   despite `diff.submodule=log` or `diff.submodule=diff`
 */
export const DIFF_FORMAT_ARGS = [
  '--no-color',
  '--no-ext-diff',
  '--no-textconv',
  '--no-relative',
  '--src-prefix=a/',
  '--dst-prefix=b/',
  '-M',
  '--submodule=short',
];

export function getDiff(args: string[] = []): string {
  return git(['diff', ...DIFF_FORMAT_ARGS, ...args]);
}

/** Untracked files that are not ignored. Nested repositories, listed as `dir/`, are left out. */
export function getUntrackedFiles(): string[] {
  return gitNul(['ls-files', '-z', '--others', '--exclude-standard']).filter((f) => !f.endsWith('/'));
}

export type RefDiffArgs = { type: 'args'; args: string[]; includeUntracked: boolean };

export function resolveDiffArgs(ref: string): RefDiffArgs {
  switch (ref) {
    case 'staged':
      return { type: 'args', args: ['--staged'], includeUntracked: false };
    case 'unstaged':
      return { type: 'args', args: [], includeUntracked: false };
    case '.':
    case 'work':
      return { type: 'args', args: [getHeadOrEmptyTree()], includeUntracked: true };
    default:
      return { type: 'args', args: [normalizeRef(ref)], includeUntracked: splitRange(ref) === null };
  }
}

export function resolveRef(ref: string, extraArgs: string[] = []): string {
  const resolved = resolveDiffArgs(ref);

  let raw = getDiff([...resolved.args, ...extraArgs]);
  if (resolved.includeUntracked) {
    const untrackedFiles = getUntrackedFiles();
    if (untrackedFiles.length > 0) {
      raw += '\n' + getUntrackedDiff(untrackedFiles);
    }
  }
  return raw;
}

export function getDiffFiles(ref: string): string[] {
  const resolved = resolveDiffArgs(ref);

  const tracked = gitNul(['diff', ...DIFF_FORMAT_ARGS, '--name-only', '-z', ...resolved.args]);
  if (resolved.includeUntracked) {
    const untracked = getUntrackedFiles();
    return [...new Set([...tracked, ...untracked])];
  }
  return tracked;
}

/**
 * Discards working tree changes to `filePath`. Restores it from HEAD, or
 * removes it from the index and the working tree when HEAD does not have it.
 */
export function revertFile(filePath: string): void {
  assertRepoPath(filePath);
  const type = gitTry(['cat-file', '-t', `HEAD:${filePath}`])?.trim();
  if (type === 'tree') {
    throw new InputError(`Not a file: ${filePath}`);
  }
  if (type) {
    git(['--literal-pathspecs', 'checkout', 'HEAD', '--', filePath]);
    return;
  }
  if (gitTry(['--literal-pathspecs', 'ls-files', '-z', '--error-unmatch', '--', filePath]) !== null) {
    git(['--literal-pathspecs', 'rm', '--cached', '--quiet', '--', filePath]);
  }
  const entry = repoEntryPath(filePath);
  let stat;
  try {
    stat = lstatSync(entry);
  } catch {
    return;
  }
  if (stat.isFile() || stat.isSymbolicLink()) {
    unlinkSync(entry);
  }
}

export function revertHunk(patch: string): void {
  git(['apply', '--reverse', '--unidiff-zero', '-'], { input: patch });
}

function requireCommit(rev: string): string {
  const sha = verifyCommit(rev);
  if (!sha) {
    throw new InputError(`Unknown revision: ${rev}`);
  }
  return sha;
}

/** Splits `a..b` or `a...b`, defaulting an omitted side to HEAD like git does. */
function splitRange(ref: string): { left: string; right: string } | null {
  for (const sep of ['...', '..']) {
    const idx = ref.indexOf(sep);
    if (idx !== -1) {
      return {
        left: ref.slice(0, idx) || 'HEAD',
        right: ref.slice(idx + sep.length) || 'HEAD',
      };
    }
  }
  return null;
}

/** The merge base of a range's two ends, both verified as commits. */
function rangeBase(left: string, right: string): string {
  const base = getMergeBase(requireCommit(left), requireCommit(right));
  if (!base) {
    throw new InputError(`'${left}' and '${right}' have no common ancestor`);
  }
  return base;
}

/**
 * The commit of `<sha>~1..<sha>` or `<sha>^..<sha>` when it is a root commit,
 * which has no parent to diff against.
 */
function rootCommitOf(left: string, right: string): string | null {
  const child = left.endsWith('~1') ? left.slice(0, -2) : left.endsWith('^') ? left.slice(0, -1) : null;
  if (child === null || verifyCommit(left)) {
    return null;
  }
  const sha = verifyCommit(child);
  return sha && verifyCommit(right) === sha ? sha : null;
}

/** The merge base of `ref` and HEAD, or `ref` itself when they share no history. */
function refBase(ref: string): string {
  const sha = requireCommit(ref);
  return getMergeBase(sha, 'HEAD') ?? sha;
}

/**
 * Turns a user supplied ref into `git diff` arguments made of verified commit
 * hashes: a range becomes `<merge-base>..<right>`, a single ref its merge base
 * with HEAD. The parent range of a root commit starts at the empty tree.
 */
export function normalizeRef(ref: string): string {
  const range = splitRange(ref);
  if (range) {
    const root = rootCommitOf(range.left, range.right);
    if (root) {
      return `${getEmptyTree()}..${root}`;
    }
    return `${rangeBase(range.left, range.right)}..${requireCommit(range.right)}`;
  }
  return refBase(ref);
}

export const WORKING_TREE_REFS = new Set(['work', '.', 'staged', 'unstaged']);

/**
 * Where the *old* side of a diff comes from, mirroring `resolveDiffArgs`:
 * - `unstaged` diffs the working tree against the index
 * - the other working tree refs diff against HEAD, or against the empty
 *   tree in a repository without commits
 * - a range or a single ref diffs against a merge base, the parent range of
 *   a root commit against the empty tree
 */
export type BaseSource =
  | { type: 'empty' }
  | { type: 'index' }
  | { type: 'ref'; ref: string };

export function resolveBaseRef(ref: string): BaseSource {
  if (ref === 'unstaged') {
    return { type: 'index' };
  }
  if (WORKING_TREE_REFS.has(ref)) {
    const head = getHeadHash();
    return head ? { type: 'ref', ref: head } : { type: 'empty' };
  }
  const range = splitRange(ref);
  if (range) {
    if (rootCommitOf(range.left, range.right)) {
      return { type: 'empty' };
    }
    return { type: 'ref', ref: rangeBase(range.left, range.right) };
  }
  return { type: 'ref', ref: refBase(ref) };
}

/**
 * Where the *new* side of a diff comes from, mirroring `resolveDiffArgs`:
 * - `staged` diffs the index against HEAD, so the new side is the index
 * - the other working-tree refs and any single ref (`HEAD~3`) diff against the
 *   working tree, so the new side is the file on disk
 * - a range (`main..feature`) diffs two commits, so the new side is its right
 *   end, defaulting to HEAD when omitted (git's own `main..` semantics)
 */
export type HeadSource =
  | { type: 'worktree' }
  | { type: 'index' }
  | { type: 'ref'; ref: string };

export function resolveHeadRef(ref: string): HeadSource {
  if (ref === 'staged') {
    return { type: 'index' };
  }
  if (WORKING_TREE_REFS.has(ref)) {
    return { type: 'worktree' };
  }

  const threeDotsIdx = ref.indexOf('...');
  if (threeDotsIdx !== -1) {
    const right = ref.slice(threeDotsIdx + 3);
    return { type: 'ref', ref: right || 'HEAD' };
  }

  const twoDotsIdx = ref.indexOf('..');
  if (twoDotsIdx !== -1) {
    const right = ref.slice(twoDotsIdx + 2);
    return { type: 'ref', ref: right || 'HEAD' };
  }

  return { type: 'worktree' };
}

export function getFileContent(path: string, ref = 'HEAD'): string {
  assertRepoPath(path);
  return git(['show', '--no-textconv', '--end-of-options', `${ref}:${path}`]);
}

export function getIndexFileContent(path: string): string {
  assertRepoPath(path);
  return git(['show', '--no-textconv', '--end-of-options', `:0:${path}`]);
}

export function getBaseFileContent(path: string, base: BaseSource): string {
  if (base.type === 'empty') {
    throw new InputError(`File not found: ${path}`, 'not_found');
  }
  return base.type === 'index' ? getIndexFileContent(path) : getFileContent(path, base.ref);
}

/** Line counts per `git cat-file --batch` object, `null` for a missing, non-blob or binary one. */
function parseBatchLineCounts(out: Buffer, expected: number): (number | null)[] {
  const counts: (number | null)[] = [];
  let pos = 0;
  while (counts.length < expected && pos < out.length) {
    const eol = out.indexOf(0x0a, pos);
    if (eol === -1) {
      break;
    }
    const header = out.subarray(pos, eol).toString('utf-8');
    pos = eol + 1;
    const [, type, sizeField] = header.split(' ');
    const size = Number(sizeField);
    if (header.endsWith(' missing') || header.endsWith(' ambiguous') || !Number.isInteger(size)) {
      counts.push(null);
      continue;
    }
    const data = out.subarray(pos, pos + size);
    pos += size + 1;
    counts.push(type === 'blob' && !isBinary(data) ? countLines(data) : null);
  }
  while (counts.length < expected) {
    counts.push(null);
  }
  return counts;
}

/**
 * Line counts of `paths` on the old side of a diff, read with one
 * `git cat-file --batch`. `null` where a file is missing there or binary.
 */
export function getFileLineCounts(paths: string[], base: BaseSource): (number | null)[] {
  const counts: (number | null)[] = paths.map(() => null);
  if (base.type === 'empty') {
    return counts;
  }
  const rev = base.type === 'index' ? ':0' : base.ref;
  // The batch input is line based, so a name with a newline cannot be requested.
  const requested = paths.flatMap((path, i) => (path.includes('\n') ? [] : [i]));
  if (requested.length === 0) {
    return counts;
  }
  const input = requested.map((i) => `${rev}:${paths[i]}\n`).join('');
  const out = gitBuffer(['cat-file', '--batch', '--buffer'], { input });
  parseBatchLineCounts(out, requested.length).forEach((count, n) => {
    counts[requested[n]] = count;
  });
  return counts;
}
