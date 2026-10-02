import { execFileSync } from 'node:child_process';

/** Runs the GitHub CLI with an argument vector, never through a shell. */
export function gh(args: string[], input?: string): string {
  return execFileSync('gh', args, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
    input,
    maxBuffer: 50 * 1024 * 1024,
  });
}

export function ghSucceeds(args: string[]): boolean {
  try {
    gh(args);
    return true;
  } catch {
    return false;
  }
}
