import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { parseDiff } from '../../parser/src/index.js';
import { getDiffFiles, getFileContent, getUntrackedFiles, resolveRef } from '../src/diff.js';
import { getStagedFiles, getUnstagedFiles } from '../src/status.js';
import { getTree, getWorkingTreeFileContent } from '../src/tree.js';
import { createRepo, type TempRepo } from './helpers.js';

const TRACKED = ['ünïcødé.txt', 'q"uote.txt', 'tab\there.txt', 'new\nline.txt', 'back\\slash.txt', 'sp ace.txt'];
const UNTRACKED = TRACKED.map((name) => `u-${name}`);

let repo: TempRepo;
let origCwd: string;

beforeAll(() => {
  origCwd = process.cwd();
  repo = createRepo();
  repo.git('config', 'core.quotepath', 'true');
  for (const name of TRACKED) {
    repo.write(name, 'a\n');
  }
  repo.commit('initial');
  for (const name of TRACKED) {
    repo.write(name, 'b\n');
  }
  for (const name of UNTRACKED) {
    repo.write(name, 'u\n');
  }
  repo.write('staged ü.txt', 's\n');
  repo.git('add', 'staged ü.txt');
  process.chdir(repo.dir);
});

afterAll(() => {
  process.chdir(origCwd);
  repo.remove();
});

describe('file names git would quote', () => {
  it('lists them verbatim', () => {
    expect(getUntrackedFiles().sort()).toEqual([...UNTRACKED].sort());
    expect(getUnstagedFiles().sort()).toEqual([...TRACKED].sort());
    expect(getStagedFiles()).toEqual(['staged ü.txt']);
    expect(getTree().sort()).toEqual([...TRACKED, ...UNTRACKED, 'staged ü.txt'].sort());
    expect(getDiffFiles('work').sort()).toEqual([...TRACKED, ...UNTRACKED, 'staged ü.txt'].sort());
  });

  it('parses them back from the diff', () => {
    const files = parseDiff(resolveRef('work')).files;
    const byName = new Map(files.map((f) => [f.newPath, f]));
    for (const name of TRACKED) {
      expect(byName.get(name)?.oldPath).toBe(name);
      expect(byName.get(name)?.status).toBe('modified');
    }
    for (const name of [...UNTRACKED, 'staged ü.txt']) {
      expect(byName.get(name)?.status).toBe('added');
    }
    expect(files).toHaveLength(TRACKED.length + UNTRACKED.length + 1);
  });

  it('reads their content', () => {
    for (const name of TRACKED) {
      expect(getFileContent(name, 'HEAD')).toBe('a\n');
      expect(getWorkingTreeFileContent(name)).toBe('b\n');
    }
  });
});
