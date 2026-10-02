import { describe, expect, it } from 'vitest';
import type { DiffFile } from '@diffity/parser';
import {
  allDirsExpanded,
  ancestorDirs,
  buildFileTree,
  buildFileTreeFromPaths,
  collapseSingleChildDirs,
  collectAllDirPaths,
  filterTreeToPaths,
  knownExpandedDirs,
  sortTree,
  visibleRows,
} from '../src/lib/file-tree';

function makeFile(path: string): DiffFile {
  return {
    oldPath: path,
    newPath: path,
    status: 'modified',
    additions: 1,
    deletions: 0,
    hunks: [],
    isBinary: false,
  };
}

describe('filterTreeToPaths', () => {
  it('keeps only matching files and the directories needed to reach them', () => {
    const tree = buildFileTree([
      makeFile('src/app.ts'),
      makeFile('src/nested/utils.ts'),
      makeFile('tests/app.test.ts'),
    ]);

    const filtered = filterTreeToPaths(tree, new Set(['src/nested/utils.ts']));

    expect(filtered).toHaveLength(1);
    expect(filtered[0]).toMatchObject({ type: 'dir', name: 'src' });

    if (filtered[0].type !== 'dir') {
      throw new Error('Expected directory node');
    }

    expect(filtered[0].children).toHaveLength(1);
    expect(filtered[0].children[0]).toMatchObject({ type: 'dir', name: 'nested' });
  });

  it('returns an empty tree when nothing matches', () => {
    const tree = buildFileTree([makeFile('src/app.ts')]);

    expect(filterTreeToPaths(tree, new Set(['docs/readme.md']))).toEqual([]);
  });
});

describe('ancestorDirs', () => {
  it('collects every folder above the paths', () => {
    expect(ancestorDirs(['src/lib/api.ts', 'src/app.ts', 'README.md'])).toEqual(new Set(['src', 'src/lib']));
  });
});

describe('visibleRows', () => {
  const tree = sortTree(buildFileTreeFromPaths(['src/lib/api.ts', 'src/app.ts', 'README.md']));

  it('lists folders before files with the depth of each row', () => {
    const rows = visibleRows(tree, new Set(['src', 'src/lib']));
    expect(rows.map((row) => [row.node.path, row.depth])).toEqual([
      ['src', 0],
      ['src/lib', 1],
      ['src/lib/api.ts', 2],
      ['src/app.ts', 1],
      ['README.md', 0],
    ]);
  });

  it('leaves out the children of collapsed folders', () => {
    const rows = visibleRows(tree, new Set(['src/lib']));
    expect(rows.map((row) => row.node.path)).toEqual(['src', 'README.md']);
  });
});

describe('expanded folders', () => {
  // `src/deep/nested` shows as one row, so only `src/deep/nested` and `lib` are folders.
  const dirPaths = collectAllDirPaths(collapseSingleChildDirs(buildFileTreeFromPaths(['src/deep/nested/a.ts', 'src/deep/nested/b.ts', 'lib/c.ts'])));
  const revealed = new Set(['src', 'src/deep', 'src/deep/nested']);

  it('counts a tree as expanded only when each of its folders is', () => {
    expect(dirPaths).toEqual(['src/deep/nested', 'lib']);
    expect(allDirsExpanded(dirPaths, revealed)).toBe(false);
    expect(allDirsExpanded(dirPaths, new Set([...revealed, 'lib']))).toBe(true);
  });

  it('keeps only the paths that are folders of the tree', () => {
    expect(knownExpandedDirs(revealed, dirPaths)).toEqual(['src/deep/nested']);
  });
});
