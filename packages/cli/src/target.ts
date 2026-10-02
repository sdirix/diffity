import { existsSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { getRepoRoot, isGitRepo, isValidGitRef, WORKING_TREE_REFS } from '@diffity/git';

export interface Operands {
  refs: string[];
  /** The folder or file to open, `null` for the current directory. */
  path: string | null;
  /** Set when the only operand is a ref that also names a path. */
  ambiguous: boolean;
}

interface OperandChecks {
  isRef: (arg: string) => boolean;
  isPath: (arg: string) => boolean;
}

/**
 * Splits the positional arguments into refs and a path to open. Arguments
 * after `--` are the path. Without `--` a lone argument is the path when it
 * exists and is no ref, so a ref keeps working when a file has its name.
 * `separated` is set when `--` came before all arguments, as commander drops
 * it then.
 */
export function splitOperands(args: string[], separated: boolean, checks: OperandChecks): Operands {
  const dash = separated ? 0 : args.indexOf('--');
  if (separated || dash !== -1) {
    const paths = args.slice(separated ? 0 : dash + 1);
    if (paths.length > 1) {
      throw new Error(`Expected one path after --, got ${paths.length}`);
    }
    return { refs: args.slice(0, dash), path: paths[0] ?? null, ambiguous: false };
  }
  if (args.length !== 1 || !checks.isPath(args[0])) {
    return { refs: args, path: null, ambiguous: false };
  }
  if (checks.isRef(args[0])) {
    return { refs: args, path: null, ambiguous: args[0] !== '.' };
  }
  return { refs: [], path: args[0], ambiguous: false };
}

export interface Target extends Omit<Operands, 'path'> {
  /** The repo relative file to open in the tree browser. */
  file: string | null;
}

/**
 * Picks the refs and the path out of the positional arguments and changes
 * into the repo of the path, so diffity runs as if started there.
 */
export function openTarget(args: string[], separated: boolean): Target {
  const inRepo = isGitRepo();
  const { refs, path, ambiguous } = splitOperands(args, separated, {
    isRef: (arg) => WORKING_TREE_REFS.has(arg) || (inRepo && isValidGitRef(arg)),
    isPath: existsSync,
  });
  if (path === null) {
    return { refs, file: null, ambiguous };
  }

  const absolute = resolve(path);
  if (!existsSync(absolute)) {
    throw new Error(`No such file or directory: ${path}`);
  }
  const isFile = !statSync(absolute).isDirectory();
  process.chdir(isFile ? dirname(absolute) : absolute);
  if (!isGitRepo()) {
    throw new Error(`Not a git repository: ${path}`);
  }
  if (!isFile) {
    return { refs, file: null, ambiguous };
  }

  const file = relative(getRepoRoot(), join(realpathSync(dirname(absolute)), basename(absolute)));
  return { refs, file: file.split(sep).join('/'), ambiguous };
}
