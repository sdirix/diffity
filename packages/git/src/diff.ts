import { lstatSync, unlinkSync } from 'node:fs';
import { loadDiffIgnore, type DiffIgnore, type DiffOptions } from './diffignore.js';
import { InputError } from './errors.js';
import { batchSpec, git, gitBuffer, gitNul, gitTry } from './exec.js';
import { assertRepoPath, repoEntryPath } from './paths.js';
import { getEmptyTree, getHeadHash, getHeadOrEmptyTree, getMergeBase, verifyCommit } from './refs.js';
import { countLines, isBinary } from './text.js';
import { getUntrackedDiff, quoteName } from './untracked.js';

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

export interface FilteredDiff {
  patch: string;
  /** Changed files `.diffityignore` hides, left out of `patch` unless shown. */
  hiddenFiles: string[];
}

/** Above this many bytes of exclusion pathspecs, hidden files are cut from the patch instead. */
const MAX_PATHSPEC_BYTES = 256 * 1024;

interface ChangedFile {
  path: string;
  /** The source of a rename. */
  renamedFrom: string | null;
}

/** `git diff --name-status -z` records, each a status followed by one path or by two for a rename or copy. */
function parseNameStatus(fields: string[]): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (let i = 0; i < fields.length; i++) {
    const status = fields[i][0];
    if (status === 'R' || status === 'C') {
      files.push({ path: fields[i + 2], renamedFrom: status === 'R' ? fields[i + 1] : null });
      i += 2;
    } else {
      files.push({ path: fields[i + 1], renamedFrom: null });
      i += 1;
    }
  }
  return files;
}

function sectionHeader(file: ChangedFile): string {
  return `diff --git ${quoteName('a/', file.renamedFrom ?? file.path)} ${quoteName('b/', file.path)}`;
}

/** `patch` without the file sections that start with one of `headers`. */
export function dropSections(patch: string, headers: Set<string>): string {
  return patch
    .split(/^(?=diff --(?:git|cc|combined) )/m)
    .filter((section) => {
      const eol = section.indexOf('\n');
      return !headers.has(eol === -1 ? section : section.slice(0, eol));
    })
    .join('');
}

interface HiddenPlan {
  /** Exclusion pathspecs for the hidden tracked files, led by `--`. */
  pathspec: string[];
  /** Headers of the sections to drop, set when the pathspecs would make the command line too long. */
  dropHeaders: Set<string> | null;
  untracked: string[];
  hidden: string[];
}

/**
 * How `git diff <args>` leaves out the files `rules` hide: lists the changed
 * files and excludes the hidden ones by pathspec, so git never builds their
 * patches. A hidden folder is excluded whole unless a shown rename starts in
 * it. A rename into a hidden folder from a shown path leaves its source in
 * the diff as deleted. Without `exclude`, the hidden files are only listed.
 */
function planHidden(args: string[], untracked: string[], rules: DiffIgnore, exclude: boolean): HiddenPlan {
  if (!rules.hash) {
    return { pathspec: [], dropHeaders: null, untracked, hidden: [] };
  }
  const changed = parseNameStatus(gitNul(['diff', ...DIFF_FORMAT_ARGS, '--name-status', '-z', ...args]));
  const hiddenTracked = changed.filter((file) => rules.isIgnored(file.path));
  const shownUntracked = untracked.filter((file) => !rules.isIgnored(file));
  const hidden = [...hiddenTracked.map((file) => file.path), ...untracked.filter((file) => rules.isIgnored(file))].sort();
  if (!exclude) {
    return { pathspec: [], dropHeaders: null, untracked, hidden };
  }
  const wholeFolders = !changed.some((file) => file.renamedFrom && !rules.isIgnored(file.path) && rules.isIgnored(file.renamedFrom));

  const excluded = new Set<string>();
  for (const file of hiddenTracked) {
    excluded.add(wholeFolders ? rules.exclusionFor(file.path) : file.path);
    if (file.renamedFrom && rules.isIgnored(file.renamedFrom)) {
      excluded.add(file.renamedFrom);
    }
  }
  let bytes = 0;
  for (const path of excluded) {
    bytes += path.length + 24;
  }
  if (bytes > MAX_PATHSPEC_BYTES) {
    return { pathspec: [], dropHeaders: new Set(hiddenTracked.map(sectionHeader)), untracked: shownUntracked, hidden };
  }
  const pathspec = excluded.size > 0 ? ['--', ...[...excluded].map((path) => `:(top,exclude,literal)${path}`)] : [];
  return { pathspec, dropHeaders: null, untracked: shownUntracked, hidden };
}

/**
 * `git diff <args>`, followed by the untracked files with
 * `includeUntracked`, without the files `.diffityignore` hides unless
 * `showHidden`.
 */
export function getFilteredDiff(args: string[], includeUntracked: boolean, options: DiffOptions = {}): FilteredDiff {
  const plan = planHidden(args, includeUntracked ? getUntrackedFiles() : [], loadDiffIgnore(), !options.showHidden);
  let patch = getDiff([...args, ...plan.pathspec]);
  if (plan.dropHeaders) {
    patch = dropSections(patch, plan.dropHeaders);
  }
  if (plan.untracked.length > 0) {
    patch += '\n' + getUntrackedDiff(plan.untracked);
  }
  return { patch, hiddenFiles: plan.hidden };
}

export function getRefDiff(ref: string, extraArgs: string[] = [], options: DiffOptions = {}): FilteredDiff {
  const resolved = resolveDiffArgs(ref);
  return getFilteredDiff([...resolved.args, ...extraArgs], resolved.includeUntracked, options);
}

/**
 * The section of `getRefDiff` for one file, `''` when the file is not part
 * of it or `.diffityignore` hides it. `oldPath` is the source of a rename.
 */
export function getRefFilePatch(ref: string, path: string, oldPath: string | null, extraArgs: string[] = [], options: DiffOptions = {}): string {
  assertRepoPath(path);
  if (oldPath) {
    assertRepoPath(oldPath);
  }
  if (loadDiffIgnore(options).isIgnored(path)) {
    return '';
  }
  const resolved = resolveDiffArgs(ref);
  const paths = oldPath && oldPath !== path ? [oldPath, path] : [path];
  const patch = getDiff([...resolved.args, ...extraArgs, '--', ...paths.map((p) => `:(top,literal)${p}`)]);
  if (patch || !resolved.includeUntracked) {
    return patch;
  }
  const untracked = gitNul(['ls-files', '-z', '--others', '--exclude-standard', '--', `:(top,literal)${path}`]);
  return untracked.includes(path) ? getUntrackedDiff([path]) : '';
}

export function resolveRef(ref: string, extraArgs: string[] = [], options: DiffOptions = {}): string {
  return getRefDiff(ref, extraArgs, options).patch;
}

/** The files the diff of `ref` shows, the source of a rename into a hidden folder as deleted. */
export function getDiffFiles(ref: string, options: DiffOptions = {}): string[] {
  const resolved = resolveDiffArgs(ref);
  const rules = loadDiffIgnore(options);

  const tracked = parseNameStatus(gitNul(['diff', ...DIFF_FORMAT_ARGS, '--name-status', '-z', ...resolved.args]))
    .map((file) => (file.renamedFrom && rules.isIgnored(file.path) ? file.renamedFrom : file.path));
  const files = new Set(resolved.includeUntracked ? [...tracked, ...getUntrackedFiles()] : tracked);
  return [...files].filter((file) => !rules.isIgnored(file));
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
  const specs = paths.map((path) => batchSpec(`${rev}:${path}`));
  const requested = paths.flatMap((_, i) => (specs[i] === null ? [] : [i]));
  if (requested.length === 0) {
    return counts;
  }
  const input = requested.map((i) => `${specs[i]}\n`).join('');
  const out = gitBuffer(['cat-file', '--batch', '--buffer'], { input });
  parseBatchLineCounts(out, requested.length).forEach((count, n) => {
    counts[requested[n]] = count;
  });
  return counts;
}
