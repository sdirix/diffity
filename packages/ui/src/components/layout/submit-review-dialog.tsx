import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, fetchReviewCandidates, submitGitHubReview, type GitHubDetails, type ReviewCandidate, type ReviewEvent } from '../../lib/api';
import { cn } from '../../lib/cn';
import { pullReviewThreads, refreshThreadQueries } from '../../lib/github-sync';
import { isModPressed, MOD_KEY } from '../../lib/platform';
import {
  candidateLocation,
  defaultExcluded,
  disabledReason,
  EVENT_LABELS,
  groupByFile,
  headerLine,
  postedToast,
  startedByAgent,
  submitLabel,
} from '../../lib/review-candidates';
import { fileLabel, viewLabel } from '../../lib/thread-location';
import { errorMessage } from '../../lib/toast';
import { statusOptions } from '../../queries/refs';
import { Skeleton } from '../ui/skeleton';
import { Spinner } from '../icons/spinner';
import { XIcon } from '../icons/x-icon';

const EVENTS: { value: ReviewEvent; hint: string }[] = [
  { value: 'COMMENT', hint: 'Feedback without a verdict' },
  { value: 'APPROVE', hint: 'Ready to merge' },
  { value: 'REQUEST_CHANGES', hint: 'Must be addressed before merging' },
];

interface SubmitReviewDialogProps {
  details: GitHubDetails;
  branch: string | null;
  onClose: () => void;
}

function excerpt(candidate: ReviewCandidate): string {
  return (candidate.thread.comments[0]?.body ?? '').replace(/\s+/g, ' ').trim();
}

function CandidateRow(props: { candidate: ReviewCandidate; checked: boolean; onToggle: () => void; view: string | null }) {
  const { candidate, checked, onToggle, view } = props;

  return (
    <label className="flex items-start gap-2 px-2 py-1 rounded-md hover:bg-hover cursor-pointer">
      <input type="checkbox" checked={checked} onChange={onToggle} className="mt-0.5 accent-accent" />
      <span className="shrink-0 w-14 pt-px font-mono text-[11px] text-text-muted">{candidateLocation(candidate.thread)}</span>
      <span className="min-w-0 flex-1 text-xs leading-5 text-text line-clamp-2 break-words">{excerpt(candidate)}</span>
      {startedByAgent(candidate) && (
        <span className="shrink-0 mt-0.5 px-1.5 rounded text-[10px] leading-4 font-medium bg-accent/15 text-accent">{candidate.thread.comments[0].author.name}</span>
      )}
      {view && (
        <span className="shrink-0 mt-0.5 px-1.5 rounded text-[10px] leading-4 bg-bg-tertiary text-text-secondary max-w-[140px] truncate" title={`Left in ${view}`}>
          {view}
        </span>
      )}
    </label>
  );
}

function BlockedRow(props: { candidate: ReviewCandidate }) {
  const { candidate } = props;
  const { thread } = candidate;
  const where = thread.filePath === '__general__' ? 'General' : `${thread.filePath.split('/').pop()} ${candidateLocation(thread)}`;

  return (
    <div className="px-2 py-1 text-xs">
      <div className="flex items-start gap-2">
        <span className="shrink-0 max-w-[45%] pt-px font-mono text-[11px] text-text-muted truncate" title={thread.filePath}>{where}</span>
        <span className="min-w-0 flex-1 leading-5 text-text-secondary truncate">{excerpt(candidate)}</span>
      </div>
      <div className="text-[11px] leading-4 text-deleted">{candidate.reason}</div>
    </div>
  );
}

/** Posts the open comments of this branch's views as one review of the pull request. */
export function SubmitReviewDialog(props: SubmitReviewDialogProps) {
  const { details, branch, onClose } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const queryClient = useQueryClient();
  const { data: status } = useQuery(statusOptions());
  const candidatesQuery = useQuery({
    queryKey: ['review-candidates'],
    queryFn: fetchReviewCandidates,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
  const [body, setBody] = useState('');
  const [event, setEvent] = useState<ReviewEvent>('COMMENT');
  const [excludedChoice, setExcludedChoice] = useState<Set<string> | null>(null);
  const [pendingAction, setPendingAction] = useState<'add' | 'discard' | null>(null);
  const [pendingError, setPendingError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  const data = candidatesQuery.data;
  const candidates = useMemo(() => data?.candidates ?? [], [data]);
  const excluded = excludedChoice ?? defaultExcluded(candidates);
  const postable = candidates.filter((c) => !c.reason);
  const blocked = candidates.filter((c) => c.reason);
  const selected = postable.filter((c) => !excluded.has(c.thread.id));
  const own = !!details.viewerLogin && details.viewerLogin === details.author;
  const showPendingChoice = !!data?.pending || pendingError;
  const reason = candidatesQuery.isPending
    ? 'Checking the comments'
    : disabledReason({
      blocker: data?.blocker ?? null,
      selected: selected.length,
      hasBody: body.trim().length > 0,
      event,
      needsPendingChoice: showPendingChoice && pendingAction === null,
    });

  const toggle = (id: string) => {
    const next = new Set(excluded);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setExcludedChoice(next);
  };

  const submit = async () => {
    if (reason || submitting || candidatesQuery.isError) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitGitHubReview({
        event,
        body,
        threadIds: selected.map((c) => c.thread.id),
        pendingAction: showPendingChoice ? pendingAction : null,
      });
      const message = postedToast(details.number, event, result);
      toast.success(message.title, {
        description: message.description,
        action: { label: 'Open', onClick: () => window.open(result.url ?? details.url, '_blank', 'noopener') },
      });
      refreshThreadQueries();
      queryClient.removeQueries({ queryKey: ['review-candidates'] });
      pullReviewThreads().catch(() => {});
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'pending_review_exists') {
        setPendingError(true);
      }
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const viewOf = (candidate: ReviewCandidate) =>
    candidate.ref === details.ref ? null : viewLabel(candidate.ref, branch, status?.base ?? null);

  return (
    <dialog
      ref={dialogRef}
      aria-label={`Submit review of #${details.number}`}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && isModPressed(e)) {
          e.preventDefault();
          void submit();
        }
      }}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          onClose();
        }
      }}
      className="fixed inset-0 m-auto p-0 w-[560px] max-w-[calc(100vw-2rem)] h-fit max-h-[calc(100vh-4rem)] bg-bg text-text border border-border rounded-xl shadow-lg overflow-hidden font-sans backdrop:bg-black/40"
    >
      <div className="flex flex-col max-h-[calc(100vh-4rem)]">
        <div className="flex items-start gap-3 px-4 pt-4 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-text">Submit review</h2>
            <div className="mt-0.5 text-xs text-text-secondary truncate" title={details.title}>
              #{details.number} {details.title}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-text-muted hover:text-text hover:bg-hover transition-colors cursor-pointer shrink-0"
            aria-label="Close"
            title="Close (Esc)"
          >
            <XIcon className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-3 space-y-3">
          <textarea
            autoFocus
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Summary (optional)"
            rows={3}
            className="block w-full px-2.5 py-1.5 text-[13px] bg-bg-secondary text-text border border-border rounded-md resize-y outline-none focus:border-accent placeholder:text-text-muted"
          />

          <div role="radiogroup" aria-label="Verdict" className="grid grid-cols-3 gap-1.5">
            {EVENTS.map((option) => {
              const disabled = own && option.value !== 'COMMENT';
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={event === option.value}
                  disabled={disabled}
                  onClick={() => setEvent(option.value)}
                  title={disabled ? 'Not possible on your own PR' : option.hint}
                  className={cn(
                    'px-2.5 py-1.5 rounded-md border text-left transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-default',
                    event === option.value ? 'border-accent bg-accent/10' : 'border-border hover:bg-hover',
                  )}
                >
                  <div className={cn(
                    'text-xs font-medium',
                    option.value === 'APPROVE' ? 'text-added' : option.value === 'REQUEST_CHANGES' ? 'text-deleted' : 'text-text',
                  )}>
                    {EVENT_LABELS[option.value]}
                  </div>
                  <div className="text-[11px] text-text-muted truncate">{option.hint}</div>
                </button>
              );
            })}
          </div>

          <div>
            <div className="mb-1 text-[11px] font-medium text-text-muted">
              {candidatesQuery.isPending ? 'Checking the comments…' : headerLine(selected.length, blocked.length)}
            </div>
            {candidatesQuery.isPending && (
              <div className="flex flex-col gap-2 py-1" aria-hidden>
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
              </div>
            )}
            {candidatesQuery.isError && (
              <div className="px-2.5 py-1.5 rounded-md bg-deleted/10 text-xs text-deleted">{errorMessage(candidatesQuery.error)}</div>
            )}
            {data && candidates.length === 0 && (
              <div className="px-2.5 py-2 rounded-md bg-bg-secondary text-xs text-text-muted">No open comments that are not on GitHub yet</div>
            )}
            {candidates.length > 0 && (
              <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-bg-secondary/40">
                {groupByFile(postable).map(([path, group]) => (
                  <div key={path} className="pb-1">
                    <div className="px-2 pt-1.5 pb-0.5 font-mono text-[11px] text-text-muted truncate" title={path}>{fileLabel(path)}</div>
                    {group.map((candidate) => (
                      <CandidateRow
                        key={candidate.thread.id}
                        candidate={candidate}
                        checked={!excluded.has(candidate.thread.id)}
                        onToggle={() => toggle(candidate.thread.id)}
                        view={viewOf(candidate)}
                      />
                    ))}
                  </div>
                ))}
                {blocked.length > 0 && (
                  <div className={cn('pb-1', postable.length > 0 && 'border-t border-border')}>
                    <div className="px-2 pt-1.5 pb-0.5 text-[11px] font-medium text-text-muted">Can't be posted ({blocked.length})</div>
                    {blocked.map((candidate) => <BlockedRow key={candidate.thread.id} candidate={candidate} />)}
                  </div>
                )}
              </div>
            )}
          </div>

          {data?.blocker && (
            <div className="px-2.5 py-1.5 rounded-md bg-deleted/10 text-xs text-deleted">{data.blocker}</div>
          )}

          {showPendingChoice && (
            <div role="radiogroup" aria-label="Pending review" className="px-2.5 py-2 rounded-md border border-border bg-modified/10 text-xs text-text space-y-1">
              <div>
                You have a pending review on #{details.number}
                {data?.pending && data.pending.commentCount > 0 ? ` with ${data.pending.commentCount} comment${data.pending.commentCount === 1 ? '' : 's'}` : ''}.
                GitHub allows one.
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="pending" checked={pendingAction === 'add'} onChange={() => setPendingAction('add')} className="accent-accent" />
                Add to it and submit
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="pending" checked={pendingAction === 'discard'} onChange={() => setPendingAction('discard')} className="accent-accent" />
                Discard it, then post this review
              </label>
            </div>
          )}

          {error && (
            <div role="alert" className="px-2.5 py-1.5 rounded-md bg-deleted/10 text-xs text-deleted whitespace-pre-wrap break-words">{error}</div>
          )}
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-t border-border">
          <span className="min-w-0 flex-1 text-[11px] text-text-muted truncate" title={reason ?? undefined}>{reason ?? `${MOD_KEY}+Enter submits`}</span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-md border border-border text-text hover:bg-hover cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={!!reason || submitting || candidatesQuery.isError}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md bg-accent text-white hover:bg-accent-hover cursor-pointer disabled:opacity-50 disabled:cursor-default"
          >
            {submitting && <Spinner className="w-3 h-3" />}
            {submitLabel(event)}
          </button>
        </div>
      </div>
    </dialog>
  );
}
