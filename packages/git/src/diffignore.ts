import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import ignore, { type Ignore } from 'ignore';
import { getDiffityDirPath } from './data-dir.js';
import { getRepoRoot } from './exec.js';

/** Gitignore syntax file at the repo root whose matches are left out of every diff. */
export const DIFF_IGNORE_FILE = '.diffityignore';

/** This repo's own patterns in the diffity data dir, applied after `.diffityignore`. */
const LOCAL_FILE = 'diffityignore';

/**
 * Whitelists every folder last, so `ignore` never lets a folder decide for
 * the paths below it and `test` reports how a path's own rules match.
 */
const EVERY_DIR = '!*/';

export interface DiffOptions {
  /** Include the files `.diffityignore` hides. */
  showHidden?: boolean;
}

export interface DiffIgnore {
  /** Changes with the rules, so fingerprints notice an edited list. Empty without rules. */
  readonly hash: string;
  /**
   * Whether a repo relative path is hidden, by its own rules or else by the
   * nearest folder above it that a rule matches. Unlike `.gitignore`, a
   * file's own negation (`!dist/keep.js`) shows it under a hidden folder.
   */
  isIgnored(path: string, isDir?: boolean): boolean;
  /**
   * The path whose exclusion hides `path`: its topmost hidden folder when no
   * negation could show anything below it, else `path` itself.
   */
  exclusionFor(path: string): string;
}

const NO_RULES: DiffIgnore = {
  hash: '',
  isIgnored: () => false,
  exclusionFor: (path) => path,
};

function isRule(line: string): boolean {
  return line.trim() !== '' && !line.startsWith('#');
}

/** `line` as a rule for a folder tested like a file: without the trailing slash that limits it to folders. */
function folderRule(line: string): string {
  const body = line.replace(/(?<!\\) +$/, '');
  return body.length > 1 && body.endsWith('/') ? body.slice(0, -1) : body;
}

function matcher(lines: string[]): Ignore {
  return ignore({ ignorecase: false, allowRelativePaths: true }).add(lines).add(EVERY_DIR);
}

/** Rules from gitignore syntax `sources`, a later source winning over an earlier one. */
export function createDiffIgnore(sources: string[]): DiffIgnore {
  const lines = sources.flatMap((text) => text.split(/\r?\n/)).filter(isRule);
  if (lines.length === 0) {
    return NO_RULES;
  }
  const files = matcher(lines);
  const dirs = matcher(lines.map(folderRule));
  const negated = lines.some((line) => line.startsWith('!'));

  /** `true` or `false` when a rule of the path itself decides, `null` when none matches. */
  const own = (path: string, isDir: boolean): boolean | null => {
    const result = (isDir ? dirs : files).test(path);
    return result.ignored ? true : result.unignored ? false : null;
  };

  return {
    hash: createHash('sha1').update(lines.join('\0')).digest('hex'),
    isIgnored(path, isDir = false) {
      if (!path) {
        return false;
      }
      let decided = own(path, isDir);
      for (let end = path.lastIndexOf('/'); decided === null && end > 0; end = path.lastIndexOf('/', end - 1)) {
        decided = own(path.slice(0, end), true);
      }
      return decided ?? false;
    },
    exclusionFor(path) {
      if (negated) {
        return path;
      }
      for (let end = path.indexOf('/'); end > 0; end = path.indexOf('/', end + 1)) {
        const dir = path.slice(0, end);
        if (own(dir, true)) {
          return dir;
        }
      }
      return path;
    },
  };
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return '';
  }
}

function localPath(): string {
  return join(getDiffityDirPath(), LOCAL_FILE);
}

/** The patterns this repo hides from diffs besides `.diffityignore`, kept outside the repo. */
export function readLocalDiffIgnore(): string {
  return readText(localPath());
}

/** Saves the patterns of `readLocalDiffIgnore`, removing the file when they are blank. */
export function writeLocalDiffIgnore(text: string): void {
  const path = localPath();
  if (!text.trim()) {
    rmSync(path, { force: true });
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text.endsWith('\n') ? text : `${text}\n`);
}

/**
 * The rules of the working tree's `.diffityignore` and the repo's local
 * list, for every ref, so a range of old commits hides the same files as
 * the working tree does. None with `showHidden`.
 */
export function loadDiffIgnore(options: DiffOptions = {}): DiffIgnore {
  if (options.showHidden) {
    return NO_RULES;
  }
  return createDiffIgnore([readText(join(getRepoRoot(), DIFF_IGNORE_FILE)), readLocalDiffIgnore()]);
}

/** The files of `files` and the folders above them that `.diffityignore` hides, for the file browser to dim. */
export function getDiffIgnoredPaths(files: string[]): string[] {
  const rules = loadDiffIgnore();
  if (!rules.hash) {
    return [];
  }
  const dirs = new Set<string>();
  for (const file of files) {
    for (let end = file.indexOf('/'); end > 0; end = file.indexOf('/', end + 1)) {
      dirs.add(file.slice(0, end));
    }
  }
  return [
    ...[...dirs].filter((dir) => rules.isIgnored(dir, true)),
    ...files.filter((file) => rules.isIgnored(file)),
  ];
}
