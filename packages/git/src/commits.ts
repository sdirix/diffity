import { git } from './exec.js';
import { getHeadHash } from './refs.js';
import type { Commit } from './types.js';

interface CommitQuery {
  count: number;
  skip?: number;
  search?: string;
}

const RECORD = '\x1e';
const FIELD = '\x1f';

function nonNegative(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! >= 0 ? value! : fallback;
}

export function getRecentCommits(query: CommitQuery): Commit[] {
  const count = nonNegative(query.count, 10);
  const skip = nonNegative(query.skip, 0);
  if (!getHeadHash()) {
    return [];
  }

  const args = ['log', `-n${count}`, `--skip=${skip}`, '--format=%x1e%H%x1f%h%x1f%cr%x1f%s'];
  if (query.search) {
    args.push(`--grep=${query.search}`, '-i', '--fixed-strings');
  }

  return git(args)
    .split(RECORD)
    .map((record) => record.replace(/\n$/, ''))
    .filter(Boolean)
    .map((record) => {
      const [hash, shortHash, relativeDate, ...subject] = record.split(FIELD);
      return { hash, shortHash, message: subject.join(FIELD), relativeDate };
    });
}
