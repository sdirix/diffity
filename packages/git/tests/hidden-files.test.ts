import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getDiffityDirPath } from '../src/data-dir.js';
import { dropSections, getDiffFiles, getRefDiff, resolveRef } from '../src/diff.js';
import { getDiffIgnoredPaths, readLocalDiffIgnore, writeLocalDiffIgnore } from '../src/diffignore.js';
import { getDiffFingerprint } from '../src/fingerprint.js';
import { createRepo, type TempRepo } from './helpers.js';

let repo: TempRepo;
let origCwd: string;
let origHome: string | undefined;
let home: string;

/** Paths of the `diff --git` sections of `patch`. */
function sections(patch: string): string[] {
  return [...patch.matchAll(/^diff --git a\/\S+ b\/(\S+)$/gm)].map((match) => match[1]);
}

beforeEach(() => {
  origCwd = process.cwd();
  origHome = process.env.HOME;
  home = mkdtempSync(join(tmpdir(), 'diffity-home-'));
  process.env.HOME = home;
  repo = createRepo();
  repo.write('src/app.ts', 'a\n');
  repo.write('dist/bundle.js', 'a\n');
  repo.write('dist/keep.js', 'a\n');
  repo.write('api.generated.ts', 'a\n');
  repo.commit('initial');
  process.chdir(repo.dir);
});

afterEach(() => {
  process.chdir(origCwd);
  process.env.HOME = origHome;
  repo.remove();
  rmSync(home, { recursive: true, force: true });
});

function editAll() {
  for (const path of ['src/app.ts', 'dist/bundle.js', 'dist/keep.js', 'api.generated.ts']) {
    repo.write(path, 'b\n');
  }
}

describe('diffs with .diffityignore', () => {
  it('leaves hidden tracked and untracked files out of the working tree diff', () => {
    repo.write('.diffityignore', '# generated\ndist/\n*.generated.ts\n!dist/keep.js\n');
    editAll();
    repo.write('dist/new.js', 'new\n');
    repo.write('src/new.generated.ts', 'new\n');
    repo.write('src/new.ts', 'new\n');

    const { patch, hiddenFiles } = getRefDiff('work');
    expect(sections(patch).sort()).toEqual(['.diffityignore', 'dist/keep.js', 'src/app.ts', 'src/new.ts']);
    expect(hiddenFiles).toEqual(['api.generated.ts', 'dist/bundle.js', 'dist/new.js', 'src/new.generated.ts']);
    expect(getDiffFiles('work').sort()).toEqual(['.diffityignore', 'dist/keep.js', 'src/app.ts', 'src/new.ts']);
  });

  it('shows everything with showHidden and still lists the hidden files', () => {
    repo.write('.diffityignore', 'dist/\n');
    editAll();
    repo.write('dist/new.js', 'new\n');
    const { patch, hiddenFiles } = getRefDiff('work', [], { showHidden: true });
    expect(sections(patch)).toEqual(expect.arrayContaining(['dist/bundle.js', 'dist/new.js']));
    expect(hiddenFiles).toEqual(['dist/bundle.js', 'dist/keep.js', 'dist/new.js']);
    expect(getDiffFiles('work', { showHidden: true })).toContain('dist/bundle.js');
  });

  it('hides files in staged, unstaged and commit range diffs', () => {
    repo.write('.diffityignore', 'dist/\n');
    repo.git('add', '.diffityignore');
    editAll();
    repo.git('add', 'dist/bundle.js', 'src/app.ts');
    expect(sections(resolveRef('staged')).sort()).toEqual(['.diffityignore', 'src/app.ts']);
    expect(sections(resolveRef('unstaged')).sort()).toEqual(['api.generated.ts']);

    repo.commit('edit');
    const range = getRefDiff('HEAD~1..HEAD');
    expect(sections(range.patch).sort()).toEqual(['.diffityignore', 'api.generated.ts', 'src/app.ts']);
    expect(range.hiddenFiles).toEqual(['dist/bundle.js', 'dist/keep.js']);
    expect(getRefDiff('HEAD~1').hiddenFiles).toEqual(['dist/bundle.js', 'dist/keep.js']);
  });

  it('reads the rules from the working tree for old commits', () => {
    editAll();
    repo.commit('edit');
    repo.write('.diffityignore', '*.generated.ts\n');
    expect(getRefDiff('HEAD~1..HEAD').hiddenFiles).toEqual(['api.generated.ts']);
  });

  it('shows the source of a rename into a hidden folder as deleted', () => {
    repo.write('src/old.js', Array.from({ length: 20 }, (_, i) => `line ${i}\n`).join(''));
    repo.write('dist/older.js', Array.from({ length: 20 }, (_, i) => `older ${i}\n`).join(''));
    repo.write('.diffityignore', 'dist/\n');
    repo.commit('base');
    repo.git('mv', 'src/old.js', 'dist/old.js');
    repo.git('mv', 'dist/older.js', 'dist/oldest.js');
    const { patch, hiddenFiles } = getRefDiff('staged');
    expect(sections(patch)).toEqual(['src/old.js']);
    expect(patch).toContain('deleted file mode 100644');
    expect(patch).not.toContain('dist/');
    expect(hiddenFiles).toEqual(['dist/old.js', 'dist/oldest.js']);
    expect(getDiffFiles('staged')).toEqual(['src/old.js']);
  });

  it('keeps a rename out of a hidden folder next to hidden changes in it', () => {
    repo.write('dist/moved.js', Array.from({ length: 20 }, (_, i) => `line ${i}\n`).join(''));
    repo.write('.diffityignore', 'dist/\n');
    repo.commit('base');
    repo.git('mv', 'dist/moved.js', 'src/moved.js');
    repo.write('dist/bundle.js', 'b\n');
    repo.git('add', 'dist/bundle.js');
    const { patch, hiddenFiles } = getRefDiff('staged');
    expect(patch).toContain('rename from dist/moved.js');
    expect(patch).not.toContain('dist/bundle.js');
    expect(hiddenFiles).toEqual(['dist/bundle.js']);
  });

  it('counts only the names of hidden files and follows the rules in the fingerprint', () => {
    repo.write('.diffityignore', 'dist/\n');
    editAll();
    let before = getDiffFingerprint('work');
    repo.write('dist/bundle.js', 'c\nd\n');
    expect(getDiffFingerprint('work')).toBe(before);
    expect(getDiffFingerprint('work', { showHidden: true })).not.toBe(getDiffFingerprint('work'));
    repo.write('dist/new.js', 'new\n');
    expect(getDiffFingerprint('work')).not.toBe(before);
    before = getDiffFingerprint('work');
    repo.write('src/app.ts', 'c\nd\n');
    expect(getDiffFingerprint('work')).not.toBe(before);

    repo.commit('edit');
    const range = getDiffFingerprint('HEAD~1..HEAD');
    repo.write('.diffityignore', 'dist/\n*.ts\n');
    expect(getDiffFingerprint('HEAD~1..HEAD')).not.toBe(range);
  });
});

describe('the local list', () => {
  it('is kept in the data dir and adds to .diffityignore', () => {
    editAll();
    repo.commit('edit');
    repo.write('.diffityignore', 'dist/\n');
    writeLocalDiffIgnore('*.generated.ts\n!dist/keep.js');
    const file = join(getDiffityDirPath(), 'diffityignore');
    expect(file.startsWith(home)).toBe(true);
    expect(readFileSync(file, 'utf-8')).toBe('*.generated.ts\n!dist/keep.js\n');
    expect(readLocalDiffIgnore()).toBe('*.generated.ts\n!dist/keep.js\n');
    expect(getRefDiff('HEAD~1..HEAD').hiddenFiles).toEqual(['api.generated.ts', 'dist/bundle.js']);

    writeLocalDiffIgnore('  \n');
    expect(existsSync(file)).toBe(false);
    expect(getRefDiff('HEAD~1..HEAD').hiddenFiles).toEqual(['dist/bundle.js', 'dist/keep.js']);
  });
});

describe('getDiffIgnoredPaths', () => {
  it('lists the hidden files and folders of the tree', () => {
    expect(getDiffIgnoredPaths(['dist/bundle.js'])).toEqual([]);
    repo.write('.diffityignore', 'dist/\n*.generated.ts\n!dist/keep.js\n');
    const paths = ['api.generated.ts', 'dist/bundle.js', 'dist/keep.js', 'src/app.ts', 'src/gen/a.generated.ts'];
    expect(getDiffIgnoredPaths(paths).sort()).toEqual(['api.generated.ts', 'dist', 'dist/bundle.js', 'src/gen/a.generated.ts']);
  });
});

describe('dropSections', () => {
  it('removes the sections with the given headers', () => {
    repo.write('.diffityignore', '');
    editAll();
    const patch = resolveRef('unstaged');
    const dropped = dropSections(patch, new Set(['diff --git a/dist/bundle.js b/dist/bundle.js', 'diff --git a/src/app.ts b/src/app.ts']));
    expect(sections(dropped)).toEqual(['api.generated.ts', 'dist/keep.js']);
    expect(dropped).toContain('+b\n');
  });

  it('keeps the combined section of an unmerged path after a dropped one', () => {
    const patch = 'diff --git a/x b/x\n-x\n+y\ndiff --cc f.txt\nindex 1,2..0\n++<<<<<<< HEAD\n';
    expect(dropSections(patch, new Set(['diff --git a/x b/x']))).toBe('diff --cc f.txt\nindex 1,2..0\n++<<<<<<< HEAD\n');
  });
});
