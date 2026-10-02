import { readFileSync } from 'node:fs';
import { gitNul } from './exec.js';
import { assertRepoPath, resolveInRepo } from './paths.js';

export interface TreeEntry {
  type: 'blob' | 'tree';
  path: string;
  name: string;
}

function getWorkingTreeFiles(dirPath?: string): string[] {
  if (dirPath) {
    assertRepoPath(dirPath);
  }
  const pathArgs = dirPath ? [dirPath + '/'] : [];

  const tracked = gitNul(['--literal-pathspecs', 'ls-files', '-z', '--', ...pathArgs]);
  const deleted = new Set(gitNul(['--literal-pathspecs', 'ls-files', '-z', '--deleted', '--', ...pathArgs]));
  const untracked = gitNul(['--literal-pathspecs', 'ls-files', '-z', '--others', '--exclude-standard', '--', ...pathArgs])
    .filter((f) => !f.endsWith('/'));

  const files = new Set<string>();
  for (const f of tracked) {
    if (!deleted.has(f)) {
      files.add(f);
    }
  }
  for (const f of untracked) {
    files.add(f);
  }

  return Array.from(files).sort();
}

export function getTree(): string[] {
  return getWorkingTreeFiles();
}

export function getTreeEntries(_ref = 'HEAD', dirPath?: string): TreeEntry[] {
  const files = getWorkingTreeFiles(dirPath);
  const prefix = dirPath ? dirPath + '/' : '';
  const entries = new Map<string, TreeEntry>();

  for (const file of files) {
    const relative = file.slice(prefix.length);
    const slashIndex = relative.indexOf('/');
    if (slashIndex === -1) {
      entries.set(relative, { type: 'blob', path: file, name: relative });
    } else {
      const dirName = relative.slice(0, slashIndex);
      const fullPath = prefix + dirName;
      if (!entries.has(dirName)) {
        entries.set(dirName, { type: 'tree', path: fullPath, name: dirName });
      }
    }
  }

  return Array.from(entries.values());
}

export function getWorkingTreeFileContent(filePath: string): string {
  return readFileSync(resolveInRepo(filePath), 'utf-8');
}

export function getWorkingTreeRawFile(filePath: string): { data: Buffer; fullPath: string } {
  const fullPath = resolveInRepo(filePath);
  return { data: readFileSync(fullPath), fullPath };
}
