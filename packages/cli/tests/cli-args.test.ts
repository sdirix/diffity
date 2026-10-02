import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createRepo, type TempRepo } from './helpers.js';

const tsx = createRequire(import.meta.url).resolve('tsx/cli');
const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url));

let repo: TempRepo;

beforeEach(() => {
  repo = createRepo();
});

afterEach(() => {
  repo.remove();
});

function diffity(...args: string[]): { status: number | null; stderr: string } {
  const result = spawnSync(process.execPath, [tsx, entry, ...args], { cwd: repo.dir, encoding: 'utf-8', timeout: 30_000 });
  return { status: result.status, stderr: result.stderr };
}

describe('diffity arguments', () => {
  it('reads flags after the refs as flags', () => {
    const result = diffity('no-such-ref', '--no-open', '--dark');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`'no-such-ref' is not a valid git reference`);
  });

  it('reads everything after -- as a path', () => {
    const result = diffity('--', '-x');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('No such file or directory: -x');
  });
});
