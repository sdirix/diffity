import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getBaseBranch } from '../src/repo.js';
import { createRepo, type TempRepo } from './helpers.js';

let origin: TempRepo;
let local: TempRepo;
let cloneDir: string;
let origCwd: string;

function inClone(...args: string[]): string {
  return execFileSync('git', args, { cwd: cloneDir, encoding: 'utf-8', stdio: 'pipe' }).trim();
}

beforeAll(() => {
  origCwd = process.cwd();
  origin = createRepo();
  origin.write('base.txt', 'base\n');
  origin.commit('base');
  origin.git('branch', 'develop');

  cloneDir = join(mkdtempSync(join(tmpdir(), 'diffity-clone-')), 'clone');
  execFileSync('git', ['clone', '-q', origin.dir, cloneDir], { stdio: 'pipe' });

  local = createRepo();
  local.write('base.txt', 'base\n');
  local.commit('base');
});

afterAll(() => {
  process.chdir(origCwd);
  origin.remove();
  local.remove();
  rmSync(join(cloneDir, '..'), { recursive: true, force: true });
});

describe('getBaseBranch', () => {
  it('uses the default branch of origin', () => {
    process.chdir(cloneDir);
    inClone('checkout', '-q', '-b', 'feature');
    expect(getBaseBranch()).toBe('origin/main');
  });

  it('prefers an upstream that is another branch', () => {
    process.chdir(cloneDir);
    inClone('checkout', '-q', '-b', 'topic', '--track', 'origin/develop');
    expect(getBaseBranch()).toBe('origin/develop');
  });

  it('is null on the default branch', () => {
    process.chdir(cloneDir);
    inClone('checkout', '-q', 'main');
    expect(getBaseBranch()).toBeNull();
  });

  it('falls back to a well known local branch', () => {
    process.chdir(local.dir);
    local.git('branch', 'develop');
    local.git('checkout', '-q', '-b', 'feature');
    expect(getBaseBranch()).toBe('main');
    local.git('checkout', '-q', 'develop');
    expect(getBaseBranch()).toBe('main');
    local.git('checkout', '-q', 'main');
    expect(getBaseBranch()).toBeNull();
  });
});
