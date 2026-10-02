import { spawnSync } from 'node:child_process';

const MAX_BUFFER = 256 * 1024 * 1024;

/**
 * Set for every git call: the C locale keeps messages stable, no optional
 * locks keep read-only calls from blocking the user's own git commands, and
 * no terminal prompt keeps a credential request from hanging the server.
 */
const GIT_ENV = {
  LC_ALL: 'C',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
};

export class GitError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
    this.name = 'GitError';
  }
}

export interface GitOptions {
  input?: string | Buffer;
  /** Exit codes that count as success, `[0]` by default. */
  okCodes?: number[];
  /** Defaults to the repo root, so paths are root relative wherever diffity was started. */
  cwd?: string;
}

/** Runs git with an argument vector, never through a shell. */
export function gitBuffer(args: string[], options: GitOptions = {}): Buffer {
  const result = spawnSync('git', ['-c', 'core.quotepath=off', ...args], {
    cwd: options.cwd ?? getRepoRoot(),
    env: { ...process.env, ...GIT_ENV },
    input: options.input,
    stdio: [options.input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    maxBuffer: MAX_BUFFER,
  });
  if (result.error) {
    throw result.error;
  }
  const okCodes = options.okCodes ?? [0];
  if (result.status === null || !okCodes.includes(result.status)) {
    const stderr = result.stderr.toString('utf-8').trim();
    const command = args.find((arg) => !arg.startsWith('-')) ?? '';
    throw new GitError(`git ${command} failed: ${stderr}`, result.status);
  }
  return result.stdout;
}

/** Raw stdout. Use for content, which must keep its whitespace. */
export function git(args: string[], options?: GitOptions): string {
  return gitBuffer(args, options).toString('utf-8');
}

/** Stdout split on NUL, for `-z` listings whose names may contain any character. */
export function gitNul(args: string[], options?: GitOptions): string[] {
  return git(args, options).split('\0').filter(Boolean);
}

/** Like `git`, but `null` when git exits with an error. */
export function gitTry(args: string[], options?: GitOptions): string | null {
  try {
    return git(args, options);
  } catch (err) {
    if (err instanceof GitError) {
      return null;
    }
    throw err;
  }
}

/**
 * `spec` as a line of `git cat-file --batch` input, `null` when it names no
 * object. Git drops a trailing CR from such a line and cannot read a
 * newline in it, so these specs are resolved to an object id first.
 */
export function batchSpec(spec: string): string | null {
  if (!spec.includes('\n') && !spec.endsWith('\r')) {
    return spec;
  }
  return gitTry(['rev-parse', '--verify', '--quiet', '--end-of-options', spec])?.trim() || null;
}

const roots = new Map<string, string>();

export function getRepoRoot(): string {
  const cwd = process.cwd();
  let root = roots.get(cwd);
  if (root === undefined) {
    root = git(['rev-parse', '--show-toplevel'], { cwd }).replace(/\n$/, '');
    roots.set(cwd, root);
  }
  return root;
}
