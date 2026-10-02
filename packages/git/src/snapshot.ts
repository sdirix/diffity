import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DIFF_FORMAT_ARGS, resolveHeadRef, type HeadSource } from './diff.js';
import { InputError } from './errors.js';
import { batchSpec, getRepoRoot, git, gitBuffer, gitTry } from './exec.js';
import { assertRepoPath, repoEntryPath } from './paths.js';
import { isBinary } from './text.js';
import { quoteName } from './untracked.js';

/** Larger files are hashed but not kept, so their changes since viewed cannot be shown. */
export const SNAPSHOT_MAX_BYTES = 1024 * 1024;

const OBJECT_ID = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

export interface BlobSnapshot {
  /** The blob of the file, `null` when the new side has no such file. */
  blob: string | null;
  /** The blob is text and in the object database, so it can be diffed against later. */
  kept: boolean;
}

type StoredSource = Exclude<HeadSource, { type: 'worktree' }>;

interface WorkingEntry {
  data: Buffer;
  /** Set for a regular file, which git can read by path. */
  file: string | null;
}

const objectFormats = new Map<string, string>();

function objectFormat(): string {
  const root = getRepoRoot();
  let format = objectFormats.get(root);
  if (format === undefined) {
    format = gitTry(['rev-parse', '--show-object-format'])?.trim() === 'sha256' ? 'sha256' : 'sha1';
    objectFormats.set(root, format);
  }
  return format;
}

/** The id git gives `data` as a blob, computed without writing it. */
export function hashBlob(data: Buffer): string {
  return createHash(objectFormat()).update(`blob ${data.length}\0`).update(data).digest('hex');
}

function writeBlob(data: Buffer): string {
  return git(['hash-object', '-w', '--stdin'], { input: data }).trim();
}

/** `path` in the working tree as git stores it: a symlink as its target, a file as its bytes. */
function readWorkingEntry(path: string): WorkingEntry | null {
  const entry = repoEntryPath(path);
  let stat;
  try {
    stat = lstatSync(entry);
  } catch {
    return null;
  }
  if (stat.isSymbolicLink()) {
    return { data: readlinkSync(entry, { encoding: 'buffer' }), file: null };
  }
  return stat.isFile() ? { data: readFileSync(entry), file: entry } : null;
}

function keepable(data: Buffer): boolean {
  return data.length <= SNAPSHOT_MAX_BYTES && !isBinary(data);
}

function objectSpec(head: StoredSource, path: string): string {
  return head.type === 'index' ? `:0:${path}` : `${head.ref}:${path}`;
}

/** Id and size of the blob each spec names, `null` where it names none. */
function statBlobs(specs: string[]): ({ oid: string; size: number } | null)[] {
  const inputs = specs.map(batchSpec);
  const asked = inputs.flatMap((input, i) => (input === null ? [] : [i]));
  const stats: ({ oid: string; size: number } | null)[] = specs.map(() => null);
  if (asked.length === 0) {
    return stats;
  }
  const lines = git(['cat-file', '--batch-check'], { input: asked.map((i) => `${inputs[i]}\n`).join('') }).split('\n');
  asked.forEach((index, n) => {
    const match = /^([0-9a-f]+) blob (\d+)$/.exec(lines[n] ?? '');
    stats[index] = match ? { oid: match[1], size: Number(match[2]) } : null;
  });
  return stats;
}

function readBlobs(oids: string[]): Buffer[] {
  if (oids.length === 0) {
    return [];
  }
  const out = gitBuffer(['cat-file', '--batch'], { input: oids.map((oid) => `${oid}\n`).join('') });
  const blobs: Buffer[] = [];
  let pos = 0;
  for (let i = 0; i < oids.length; i++) {
    const eol = out.indexOf(0x0a, pos);
    const size = Number(out.subarray(pos, eol).toString('utf-8').split(' ')[2]);
    blobs.push(out.subarray(eol + 1, eol + 1 + size));
    pos = eol + 1 + size + 1;
  }
  return blobs;
}

function headSource(ref: string, paths: string[]): HeadSource {
  for (const path of paths) {
    assertRepoPath(path);
  }
  return resolveHeadRef(ref);
}

/** The blob of each of `paths` on the new side of the diff of `ref`, `null` where that side has no such file. */
export function getNewSideBlobs(ref: string, paths: string[]): (string | null)[] {
  const head = headSource(ref, paths);
  if (head.type === 'worktree') {
    return paths.map((path) => {
      const entry = readWorkingEntry(path);
      return entry && hashBlob(entry.data);
    });
  }
  return statBlobs(paths.map((path) => objectSpec(head, path))).map((stat) => stat?.oid ?? null);
}

function snapshotWorkingTree(paths: string[]): BlobSnapshot[] {
  const entries = paths.map(readWorkingEntry);
  const snapshots: BlobSnapshot[] = entries.map((entry) => ({ blob: entry && hashBlob(entry.data), kept: false }));
  const byPath = entries.flatMap((entry, i) => (entry?.file && keepable(entry.data) ? [i] : []));
  if (byPath.length > 0) {
    // Git unquotes a path line in C style, so a name with a newline or a trailing CR still reads right.
    const input = byPath.map((i) => `${quoteName('', entries[i]!.file!)}\n`).join('');
    const oids = git(['hash-object', '-w', '--no-filters', '--stdin-paths'], { input }).split('\n');
    byPath.forEach((index, n) => {
      snapshots[index] = { blob: oids[n], kept: true };
    });
  }
  entries.forEach((entry, i) => {
    if (entry && !snapshots[i].kept && keepable(entry.data)) {
      snapshots[i] = { blob: writeBlob(entry.data), kept: true };
    }
  });
  return snapshots;
}

/**
 * The new side of `paths` in the diff of `ref`, kept in the object database
 * so it can be diffed against once the file changes. Binary and larger files
 * are only hashed.
 */
export function snapshotNewSide(ref: string, paths: string[]): BlobSnapshot[] {
  const head = headSource(ref, paths);
  if (head.type === 'worktree') {
    return snapshotWorkingTree(paths);
  }
  const stats = statBlobs(paths.map((path) => objectSpec(head, path)));
  const small = stats.flatMap((stat, i) => (stat && stat.size <= SNAPSHOT_MAX_BYTES ? [i] : []));
  const text = new Set<number>();
  readBlobs(small.map((i) => stats[i]!.oid)).forEach((data, n) => {
    if (!isBinary(data)) {
      text.add(small[n]);
    }
  });
  return stats.map((stat, i) => ({ blob: stat?.oid ?? null, kept: text.has(i) }));
}

/** `git diff <blob> <blob>` names both sides by their ids, the parser and highlighting need the file name. */
function nameBlobPatch(raw: string, path: string): string {
  const body = raw.search(/^@@ /m);
  if (body === -1) {
    return '';
  }
  const index = raw.slice(0, body).split('\n').filter((line) => line.startsWith('index '));
  const oldName = quoteName('a/', path);
  const newName = quoteName('b/', path);
  const tab = oldName.includes(' ') ? '\t' : '';
  return [`diff --git ${oldName} ${newName}`, ...index, `--- ${oldName}${tab}`, `+++ ${newName}${tab}`, raw.slice(body)].join('\n');
}

/** The patch from `blob` to `data`, diffed as files, so nothing lands in the object database. */
function diffBlobWith(blob: string, data: Buffer, path: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'diffity-viewed-'));
  try {
    const before = join(dir, 'before');
    const after = join(dir, 'after');
    writeFileSync(before, gitBuffer(['cat-file', 'blob', blob]));
    writeFileSync(after, data);
    return nameBlobPatch(git(['diff', '--no-index', ...DIFF_FORMAT_ARGS, before, after], { okCodes: [0, 1] }), path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function cannotCompare(path: string): InputError {
  return new InputError(`${path} is binary or too large to compare`);
}

/**
 * The patch from `blob`, a version of `path` kept by `snapshotNewSide`, to
 * the file on the new side of the diff of `ref` now. Empty when they match.
 * Writes nothing to the repository.
 */
export function getChangesSinceBlob(ref: string, path: string, blob: string): string {
  if (!OBJECT_ID.test(blob) || gitTry(['cat-file', '-e', `${blob}^{blob}`]) === null) {
    throw new InputError(`The viewed version of ${path} is no longer available`, 'not_found');
  }
  const head = headSource(ref, [path]);
  if (head.type === 'worktree') {
    const entry = readWorkingEntry(path);
    if (entry && hashBlob(entry.data) === blob) {
      return '';
    }
    if (entry && !keepable(entry.data)) {
      throw cannotCompare(path);
    }
    return diffBlobWith(blob, entry?.data ?? Buffer.alloc(0), path);
  }
  const [current] = snapshotNewSide(ref, [path]);
  if (current.blob === blob) {
    return '';
  }
  if (current.blob === null) {
    return diffBlobWith(blob, Buffer.alloc(0), path);
  }
  if (!current.kept) {
    throw cannotCompare(path);
  }
  return nameBlobPatch(git(['diff', ...DIFF_FORMAT_ARGS, blob, current.blob]), path);
}
