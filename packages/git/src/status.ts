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
