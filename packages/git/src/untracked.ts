import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getRepoRoot, gitNul } from './exec.js';
import { countLines, isBinary } from './text.js';

/** Larger untracked files are listed as binary instead of being read into the diff. */
export const UNTRACKED_TEXT_MAX_BYTES = 50 * 1024 * 1024;

const QUOTED_CHARS = /["\\\x00-\x1f\x7f]/g;

const C_ESCAPES: Record<string, string> = {
  '\x07': 'a', '\b': 'b', '\t': 't', '\n': 'n', '\v': 'v', '\f': 'f', '\r': 'r', '"': '"', '\\': '\\',
};

/** `prefix` and `name` quoted the way git quotes them with `core.quotepath` off. */
function quoteName(prefix: string, name: string): string {
  const full = prefix + name;
  if (!full.match(QUOTED_CHARS)) {
    return full;
  }
  const escaped = full.replace(QUOTED_CHARS, (ch) => {
    const named = C_ESCAPES[ch];
    return named ? `\\${named}` : `\\${ch.charCodeAt(0).toString(8).padStart(3, '0')}`;
  });
  return `"${escaped}"`;
}

/**
 * The patch `git diff --no-index /dev/null <path>` prints for a new file,
 * without its `index` line, which nothing reads.
 */
export function synthesizeNewFilePatch(path: string, data: Buffer | null, mode: string, binary: boolean): string {
  const oldName = quoteName('a/', path);
  const newName = quoteName('b/', path);
  let patch = `diff --git ${oldName} ${newName}\nnew file mode ${mode}\n`;
  if (data?.length === 0) {
    return patch;
  }
  if (binary || !data) {
    return `${patch}Binary files /dev/null and ${newName} differ\n`;
  }

  const text = data.toString('utf-8');
  const lines = countLines(data);
  patch += `--- /dev/null\n+++ ${newName}${newName.includes(' ') ? '\t' : ''}\n`;
  patch += lines === 1 ? '@@ -0,0 +1 @@\n' : `@@ -0,0 +1,${lines} @@\n`;
  patch += `+${text.replace(/\n(?!$)/g, '\n+')}`;
  if (!text.endsWith('\n')) {
    patch += '\n\\ No newline at end of file\n';
  }
  return patch;
}

/** The `diff` attribute of each file: `false` when unset (`-diff`, `binary`), `true` when set. */
function diffAttributes(files: string[]): Map<string, boolean> {
  const out = gitNul(['check-attr', '-z', '--stdin', 'diff'], { input: files.join('\0') + '\0' });
  const attributes = new Map<string, boolean>();
  for (let i = 0; i + 2 < out.length; i += 3) {
    if (out[i + 2] === 'set' || out[i + 2] === 'unset') {
      attributes.set(out[i], out[i + 2] === 'set');
    }
  }
  return attributes;
}

function untrackedPatch(root: string, path: string, diffAttribute: boolean | undefined): string | null {
  const full = join(root, path);
  let stat;
  try {
    stat = lstatSync(full);
  } catch {
    return null;
  }

  let data: Buffer | null;
  let mode: string;
  if (stat.isSymbolicLink()) {
    data = readlinkSync(full, { encoding: 'buffer' });
    mode = '120000';
  } else if (stat.isFile()) {
    data = stat.size > UNTRACKED_TEXT_MAX_BYTES ? null : readFileSync(full);
    mode = stat.mode & 0o100 ? '100755' : '100644';
  } else {
    return null;
  }

  const binary = diffAttribute === undefined ? data === null || isBinary(data) : !diffAttribute;
  return synthesizeNewFilePatch(path, data, mode, binary);
}

/**
 * Patches for untracked files, built in process instead of one
 * `git diff --no-index` per file. Only `.gitattributes` costs a git call.
 */
export function getUntrackedDiff(files: string[]): string {
  if (files.length === 0) {
    return '';
  }
  const root = getRepoRoot();
  const attributes = diffAttributes(files);
  return files
    .map((file) => untrackedPatch(root, file, attributes.get(file)))
    .filter((patch) => patch !== null)
    .join('');
}
