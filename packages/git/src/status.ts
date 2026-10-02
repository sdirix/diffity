import { DIFF_FORMAT_ARGS } from './diff.js';
import { git, gitNul } from './exec.js';

export function getStagedFiles(): string[] {
  return gitNul(['diff', ...DIFF_FORMAT_ARGS, '--staged', '--name-only', '-z']);
}

export function getUnstagedFiles(): string[] {
  return gitNul(['diff', ...DIFF_FORMAT_ARGS, '--name-only', '-z']);
}

export function isDirty(): boolean {
  return git(['status', '--porcelain']).trim().length > 0;
}

export type WorkingTreeStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';

/** Space separated fields before the path, per `git status --porcelain=v2` entry type. */
export const FIELDS_BEFORE_PATH: Record<string, number> = { '1': 8, '2': 9, u: 10 };

/**
 * Status of each changed path in the index or working tree, staged and
 * unstaged changes combined. Untracked files are listed one by one.
 */
export function getWorkingTreeStatus(): Record<string, WorkingTreeStatus> {
  const records = gitNul(['status', '--porcelain=v2', '-z', '--untracked-files=all']);
  const statuses: Record<string, WorkingTreeStatus> = {};
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const kind = record[0];
    if (kind === '?') {
      statuses[record.slice(2)] = 'untracked';
      continue;
    }
    const fields = FIELDS_BEFORE_PATH[kind];
    if (fields === undefined) {
      continue;
    }
    const xy = record.slice(2, 4);
    const path = record.split(' ').slice(fields).join(' ');
    if (kind === '2') {
      i++;
      statuses[path] = xy.includes('R') ? 'renamed' : 'added';
    } else if (kind === 'u') {
      statuses[path] = 'conflicted';
    } else if (xy.includes('D')) {
      statuses[path] = 'deleted';
    } else {
      statuses[path] = xy[0] === 'A' ? 'added' : 'modified';
    }
  }
  return statuses;
}
