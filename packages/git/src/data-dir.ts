import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getRepoRoot } from './exec.js';

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
