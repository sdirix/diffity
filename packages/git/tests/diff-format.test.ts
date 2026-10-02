import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { getDiffFiles, getFileContent, resolveRef } from '../src/diff.js';
import { getStagedFiles } from '../src/status.js';
import { createRepo, type TempRepo } from './helpers.js';

let repo: TempRepo;
let origCwd: string;

beforeAll(() => {
  origCwd = process.cwd();
  repo = createRepo();

  // git config that alters the default diff format and previously broke parsing
  repo.git('config', 'diff.mnemonicprefix', 'true');
  repo.git('config', 'color.ui', 'always');
  repo.git('config', 'diff.external', 'false');
  repo.git('config', 'diff.relative', 'true');
  repo.git('config', 'diff.renames', 'false');
  repo.git('config', 'diff.upper.textconv', 'tr a-z A-Z');
  repo.git('config', 'diff.submodule', 'log');

  repo.write('.gitattributes', '*.up diff=upper\n');
  repo.write('base.txt', 'a\nb\n');
  repo.write('text.up', 'lower\n');
  repo.write('moved.txt', Array.from({ length: 20 }, (_, i) => `line ${i}\n`).join(''));
  repo.commit('initial commit');

  process.chdir(repo.dir);
});

afterAll(() => {
  process.chdir(origCwd);
  repo.remove();
});

describe('diff format neutralization', () => {
  it('emits standard a/ b/ prefixes despite diff.mnemonicprefix', () => {
    repo.write('base.txt', 'a\nc\n');

    const raw = resolveRef('unstaged');

    expect(raw).toContain('diff --git a/base.txt b/base.txt');
    expect(raw).toContain('--- a/base.txt');
    expect(raw).toContain('+++ b/base.txt');
    // no ANSI color escapes even with color.ui=always
    expect(raw).not.toMatch(/\x1b\[/);

    repo.git('checkout', '--', 'base.txt');
  });

  it('emits standard prefixes for untracked files', () => {
    repo.write('untracked.txt', 'x\ny\n');

    const raw = resolveRef('work');

    expect(raw).toContain('diff --git a/untracked.txt b/untracked.txt');
    expect(raw).toContain('+++ b/untracked.txt');
    expect(raw).not.toMatch(/\x1b\[/);

    rmSync(join(repo.dir, 'untracked.txt'));
  });

  it('shows file content instead of textconv output', () => {
    repo.write('text.up', 'still lower\n');

    const raw = resolveRef('unstaged');

    expect(raw).toContain('-lower');
    expect(raw).toContain('+still lower');
    expect(getFileContent('text.up', 'HEAD')).toBe('lower\n');

    repo.git('checkout', '--', 'text.up');
  });

  it('detects renames despite diff.renames=false', () => {
    repo.git('mv', 'moved.txt', 'renamed.txt');

    const raw = resolveRef('staged');

    expect(raw).toContain('rename from moved.txt');
    expect(raw).toContain('rename to renamed.txt');
    expect(getDiffFiles('staged')).toEqual(['renamed.txt']);
    expect(getStagedFiles()).toEqual(['renamed.txt']);

    repo.git('mv', 'renamed.txt', 'moved.txt');
  });

  it('shows a submodule change as a patch despite diff.submodule=log', () => {
    const head = repo.git('rev-parse', 'HEAD').trim();
    repo.git('update-index', '--add', '--cacheinfo', `160000,${head},sub`);

    const raw = resolveRef('staged');

    expect(raw).toContain('diff --git a/sub b/sub');
    expect(raw).toContain(`+Subproject commit ${head}`);
    expect(raw).not.toContain('Submodule sub');

    repo.git('rm', '-q', '--cached', 'sub');
  });
});
