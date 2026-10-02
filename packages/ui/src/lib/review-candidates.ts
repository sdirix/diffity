import { GENERAL_THREAD_FILE_PATH, type CommentThread } from '../components/comments/types';
import type { ReviewCandidate, ReviewEvent, ReviewResult } from './api';

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

export function candidateLocation(thread: Pick<CommentThread, 'filePath' | 'startLine' | 'endLine'>): string {
  if (thread.filePath === GENERAL_THREAD_FILE_PATH) {
    return 'General';
  }
  if (thread.startLine === 0) {
    return 'File';
  }
  return thread.startLine === thread.endLine ? `L${thread.endLine}` : `L${thread.startLine}–${thread.endLine}`;
}

export function startedByAgent(candidate: ReviewCandidate): boolean {
  return candidate.thread.comments[0]?.author.type === 'agent';
}

/** Postable threads an agent started, which you choose to post yourself. */
export function defaultExcluded(candidates: ReviewCandidate[]): Set<string> {
  return new Set(candidates.filter((c) => !c.reason && startedByAgent(c)).map((c) => c.thread.id));
}

/** Candidates by file, general comments first, keeping their order within a file. */
export function groupByFile(candidates: ReviewCandidate[]): [string, ReviewCandidate[]][] {
  const groups = new Map<string, ReviewCandidate[]>();
  for (const candidate of candidates) {
    const path = candidate.thread.filePath;
    groups.set(path, [...(groups.get(path) ?? []), candidate]);
  }
  return [...groups.entries()].sort(([a], [b]) => Number(b === GENERAL_THREAD_FILE_PATH) - Number(a === GENERAL_THREAD_FILE_PATH));
}

export function headerLine(selected: number, blocked: number): string {
  const parts = [selected > 0 ? `${plural(selected, 'comment')} to post` : 'No comments selected'];
  if (blocked > 0) {
    parts.push(`${blocked} can't be posted`);
  }
  return parts.join(' · ');
}

export const EVENT_LABELS: Record<ReviewEvent, string> = {
  COMMENT: 'Comment',
  APPROVE: 'Approve',
  REQUEST_CHANGES: 'Request changes',
};

export function submitLabel(event: ReviewEvent): string {
  return event === 'COMMENT' ? 'Submit review' : EVENT_LABELS[event];
}

/** Why the review cannot be submitted yet, `null` when it can. */
export function disabledReason(input: { blocker: string | null; selected: number; hasBody: boolean; event: ReviewEvent; needsPendingChoice: boolean }): string | null {
  if (input.blocker) {
    return input.blocker;
  }
  if (input.selected === 0 && !input.hasBody && input.event === 'COMMENT') {
    return 'Select a comment, write a summary or choose a verdict';
  }
  if (input.needsPendingChoice) {
    return 'Choose what to do with your pending review';
  }
  return null;
}

export function postedToast(prNumber: number, event: ReviewEvent, result: ReviewResult): { title: string; description?: string } {
  const comments = result.posted > 0 ? ` with ${plural(result.posted, 'comment')}` : '';
  const titles: Record<ReviewEvent, string> = {
    COMMENT: `Reviewed #${prNumber}${comments}`,
    APPROVE: `Approved #${prNumber}${comments}`,
    REQUEST_CHANGES: `Requested changes on #${prNumber}${comments}`,
  };
  const notes = [...result.skipped.map((s) => `Skipped ${s}`), ...result.errors];
  return { title: titles[event], description: notes.length > 0 ? notes.join('\n') : undefined };
}
