import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openTarget, splitOperands } from '../src/target.js';
import { createRepo, type TempRepo } from './helpers.js';

const checks = {
  isRef: (arg: string) => ['main', 'HEAD~1', 'staged', '.'].includes(arg),
  isPath: (arg: string) => ['main', 'src', 'src/app.ts', 'staged', '.'].includes(arg),
};

describe('splitOperands', () => {
  it('keeps refs that name no path', () => {
    expect(splitOperands([], false, checks)).toEqual({ refs: [], path: null, ambiguous: false });
    expect(splitOperands(['HEAD~1'], false, checks)).toEqual({ refs: ['HEAD~1'], path: null, ambiguous: false });
    expect(splitOperands(['nope'], false, checks)).toEqual({ refs: ['nope'], path: null, ambiguous: false });
  });

  it('takes a lone existing path that is no ref', () => {
    expect(splitOperands(['src'], false, checks)).toEqual({ refs: [], path: 'src', ambiguous: false });
    expect(splitOperands(['src/app.ts'], false, checks)).toEqual({ refs: [], path: 'src/app.ts', ambiguous: false });
  });

  it('keeps a ref that also names a path, flagging it', () => {
    expect(splitOperands(['main'], false, checks)).toEqual({ refs: ['main'], path: null, ambiguous: true });
    expect(splitOperands(['staged'], false, checks)).toEqual({ refs: ['staged'], path: null, ambiguous: true });
    expect(splitOperands(['.'], false, checks)).toEqual({ refs: ['.'], path: null, ambiguous: false });
  });

  it('only reads a path from a lone argument without --', () => {
    expect(splitOperands(['HEAD~1', 'src'], false, checks)).toEqual({ refs: ['HEAD~1', 'src'], path: null, ambiguous: false });
  });

  it('takes the argument after -- as the path', () => {
    expect(splitOperands(['main'], true, checks)).toEqual({ refs: [], path: 'main', ambiguous: false });
    expect(splitOperands([], true, checks)).toEqual({ refs: [], path: null, ambiguous: false });
    expect(splitOperands(['HEAD~1', '--', 'main'], false, checks)).toEqual({ refs: ['HEAD~1'], path: 'main', ambiguous: false });
    expect(splitOperands(['a', 'b', '--'], false, checks)).toEqual({ refs: ['a', 'b'], path: null, ambiguous: false });
    expect(() => splitOperands(['--', 'a', 'b'], false, checks)).toThrow('Expected one path after --, got 2');
  });
});

describe('openTarget', () => {
  let repo: TempRepo;
  let outside: string;

  beforeEach(() => {
    repo = createRepo();
    repo.write('src/app.ts', 'x\n');
    repo.commit('app');
    outside = realpathSync(mkdtempSync(join(tmpdir(), 'diffity-cli-outside-')));
  });

  afterEach(() => {
    repo.remove();
    rmSync(outside, { recursive: true, force: true });
  });

  it('changes into the repo of a folder', () => {
    process.chdir(outside);
    expect(openTarget([join(repo.dir, 'src')], false)).toEqual({ refs: [], file: null, ambiguous: false });
    expect(process.cwd()).toBe(realpathSync(join(repo.dir, 'src')));
  });

  it('opens a file relative to its repo root', () => {
    process.chdir(outside);
    expect(openTarget([join(repo.dir, 'src/app.ts')], false)).toEqual({ refs: [], file: 'src/app.ts', ambiguous: false });
    process.chdir(join(repo.dir, 'src'));
    expect(openTarget(['app.ts'], false).file).toBe('src/app.ts');
  });

  it('keeps refs and the ref that names a path', () => {
    repo.git('branch', 'src');
    expect(openTarget(['src'], false)).toEqual({ refs: ['src'], file: null, ambiguous: true });
    expect(openTarget(['src'], true)).toEqual({ refs: [], file: null, ambiguous: false });
    process.chdir(repo.dir);
    expect(openTarget(['main', '--', 'src'], false)).toEqual({ refs: ['main'], file: null, ambiguous: false });
  });

  it('refuses a missing path or one outside a repo', () => {
    expect(() => openTarget(['missing'], true)).toThrow('No such file or directory: missing');
    mkdirSync(join(outside, 'plain'));
    expect(() => openTarget([join(outside, 'plain')], false)).toThrow('Not a git repository');
  });
});
