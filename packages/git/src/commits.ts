import { git } from './exec.js';
import { getHeadHash, verifyCommit } from './refs.js';
import type { Commit } from './types.js';

interface CommitQuery {
  count: number;
  skip?: number;
  search?: string;
}

const RECORD = '\x1e';
const FIELD = '\x1f';
const FORMAT = '--format=%x1e%H%x1f%h%x1f%cr%x1f%an%x1f%ae%x1f%s';

function nonNegative(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! >= 0 ? value! : fallback;
}

function parseCommits(out: string): Commit[] {
  return out
    .split(RECORD)
    .map((record) => record.replace(/\n$/, ''))
    .filter(Boolean)
    .map((record) => {
      const [hash, shortHash, relativeDate, authorName, authorEmail, ...subject] = record.split(FIELD);
      return { hash, shortHash, message: subject.join(FIELD), relativeDate, authorName, authorEmail };
    });
}

export function getRecentCommits(query: CommitQuery): Commit[] {
  const count = nonNegative(query.count, 10);
  const skip = nonNegative(query.skip, 0);
  if (!getHeadHash()) {
    return [];
  }

  const args = ['log', `-n${count}`, `--skip=${skip}`, FORMAT];
  if (query.search) {
    args.push(`--grep=${query.search}`, '-i', '--fixed-strings');
  }

  return parseCommits(git(args));
}

/** The commit `rev` names, or `null` when it names none. */
export function getCommit(rev: string): Commit | null {
  const sha = verifyCommit(rev);
  if (!sha) {
    return null;
  }
  return parseCommits(git(['log', '-n1', FORMAT, sha]))[0] ?? null;
}
