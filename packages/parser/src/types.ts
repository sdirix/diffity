/** `conflicted` is an unmerged path, listed without hunks. */
export type FileStatus = 'added' | 'deleted' | 'modified' | 'renamed' | 'copied' | 'conflicted';

export type LineDiffType = 'equal' | 'insert' | 'delete';

export interface WordDiffSegment {
  text: string;
  type: LineDiffType;
}

export type DiffLineType = 'add' | 'delete' | 'context';

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLineNumber: number | null;
  newLineNumber: number | null;
  noNewline?: boolean;
  wordDiff?: WordDiffSegment[];
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  context?: string;
  lines: DiffLine[];
}

export interface DiffFile {
  oldPath: string;
  newPath: string;
  status: FileStatus;
  hunks: DiffHunk[];
  additions: number;
  deletions: number;
  isBinary: boolean;
  oldMode?: string;
  newMode?: string;
  similarityIndex?: number;
  oldFileLineCount?: number;
  /** The patch was too long to include: `hunks` is empty, `additions` and `deletions` still count its lines. */
  trimmed?: boolean;
}

export interface ParsedDiff {
  files: DiffFile[];
  stats: {
    totalAdditions: number;
    totalDeletions: number;
    filesChanged: number;
  };
}

export interface ParseOptions {
  /** Files whose patch has more characters than this come without hunks and with `trimmed` set. */
  maxFilePatchLength?: number;
}
