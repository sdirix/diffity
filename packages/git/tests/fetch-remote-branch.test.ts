import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeRef } from '../src/diff.js';
import { verifyCommit } from '../src/refs.js';
import { fetchRemoteBranch } from '../src/repo.js';
import { createRepo, type TempRepo } from './helpers.js';

let upstream: TempRepo;
let cloneDir: string;
let origCwd: string;

function inClone(...args: string[]): string {
  return execFileSync('git', args, { cwd: cloneDir, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

beforeAll(() => {
  origCwd = process.cwd();
  upstream = createRepo();
  upstream.write('base.txt', 'base\n');
  upstream.commit('base');

  cloneDir = join(mkdtempSync(join(tmpdir(), 'diffity-clone-')), 'clone');
  execFileSync('git', ['clone', '-q', upstream.dir, cloneDir], { stdio: 'pipe' });
  inClone('config', 'user.email', 'test@test.com');
  inClone('config', 'user.name', 'Test');
  inClone('checkout', '-q', '-b', 'feature');
  inClone('branch', '-D', 'main');

  upstream.write('base.txt', 'base\nmoved on\n');
  upstream.commit('main moved on');
  process.chdir(cloneDir);
});

afterAll(() => {
  process.chdir(origCwd);
  upstream.remove();
  rmSync(join(cloneDir, '..'), { recursive: true, force: true });
});

describe('fetchRemoteBranch', () => {
  it('fetches a branch that is missing locally and stale on the remote-tracking ref', () => {
    const stale = verifyCommit('origin/main');
    const ref = fetchRemoteBranch('origin', 'main');

    expect(ref).toBe('origin/main');
    expect(verifyCommit(ref)).toBe(upstream.git('rev-parse', 'HEAD').trim());
    expect(verifyCommit(ref)).not.toBe(stale);
    expect(normalizeRef(ref)).toBe(stale);
  });

  it('rejects remotes that look like options', () => {
    expect(() => fetchRemoteBranch('--upload-pack=touch pwned', 'main')).toThrow();
  });
});
