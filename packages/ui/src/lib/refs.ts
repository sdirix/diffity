const WORKING_TREE_LABELS: Record<string, string> = {
  work: 'Uncommitted changes',
  '.': 'Uncommitted changes',
  staged: 'Staged changes',
  unstaged: 'Unstaged changes',
};

const COMMIT_REF = /^([0-9a-f]{7,40})~1\.\.\1$/i;

export type RefKind = 'work' | 'branch' | 'commit' | 'range' | 'ref';

export function isWorkingTreeRef(ref: string): boolean {
  return ref in WORKING_TREE_LABELS;
}

/** The changes of one commit, diffed against its parent or, for a root commit, the empty tree. */
export function commitRef(hash: string): string {
  return `${hash}~1..${hash}`;
}

/** The commit of a ref made by `commitRef`, else `null`. */
export function parseCommitRef(ref: string): string | null {
  return COMMIT_REF.exec(ref)?.[1] ?? null;
}

/** A single ref like `main` or `HEAD~3`, diffed up to the working tree. */
export function isSingleRef(ref: string): boolean {
  return !!ref && !isWorkingTreeRef(ref) && !ref.includes('..');
}

/**
 * A single ref with uncommitted changes (`main`) and the same range without
 * them (`main...HEAD`), for either of the two, else `null`.
 */
export function uncommittedTwins(ref: string): { all: string; committed: string } | null {
  if (isSingleRef(ref)) {
    return { all: ref, committed: `${ref}...HEAD` };
  }
  const base = ref.endsWith('...HEAD') ? ref.slice(0, -'...HEAD'.length) : '';
  return isSingleRef(base) ? { all: base, committed: ref } : null;
}

/** `ref` with a long commit hash at its start cut to 7 characters. */
export function shortRef(ref: string): string {
  return ref.replace(/^[0-9a-f]{8,40}(?=$|[~^])/i, (hash) => hash.slice(0, 7));
}

export function shortBase(base: string): string {
  return base.replace(/^origin\//, '');
}

/** Whether `ref` compares the current branch with `base`, with or without uncommitted changes. */
export function isBranchRef(ref: string, base: string | null): boolean {
  return !!base && (ref === base || ref === `${base}...HEAD`);
}

export function refLabel(ref: string, branch: string | null, base: string | null): { kind: RefKind; label: string } {
  const workLabel = WORKING_TREE_LABELS[ref];
  if (workLabel) {
    return { kind: 'work', label: workLabel };
  }
  if (isBranchRef(ref, base)) {
    return { kind: 'branch', label: `${branch ?? 'HEAD'} vs ${shortBase(base!)}` };
  }
  const commit = parseCommitRef(ref);
  if (commit) {
    return { kind: 'commit', label: `Commit ${commit.slice(0, 7)}` };
  }
  const sep = ref.indexOf('..');
  if (sep !== -1) {
    const left = ref.slice(0, sep) || 'HEAD';
    const right = ref.slice(ref[sep + 2] === '.' ? sep + 3 : sep + 2) || 'HEAD';
    return { kind: 'range', label: `${shortRef(left)} → ${shortRef(right)}` };
  }
  return { kind: 'ref', label: `Changes since ${shortRef(ref)}` };
}

export function isHash(text: string): boolean {
  return /^[0-9a-f]{7,40}$/i.test(text);
}

/** Text that names a ref, as opposed to words to search commit messages for. */
export function looksLikeRef(text: string): boolean {
  return text.includes('..') || isHash(text) || /[~^]\d*$/.test(text) || /^(HEAD|@)$/.test(text);
}
