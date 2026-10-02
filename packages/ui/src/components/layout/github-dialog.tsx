import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { GitHubIcon } from '../icons/github-icon';
import { RefreshIcon } from '../icons/refresh-icon';
import { XIcon } from '../icons/x-icon';
import { SettingsButton, Switch } from '../settings/settings-controls';
import { DiffStats } from '../diff/diff-stats';
import { MarkdownContent } from './markdown-content';
import type { GitHubDetails } from '../../lib/api';
import { cn } from '../../lib/cn';
import { setAutoSyncPaused, syncNow, useGitHubSync } from '../../lib/github-sync';
import { useNavigateToRef } from './ref-menu';

dayjs.extend(relativeTime);

function stateLabel(details: GitHubDetails): { label: string; className: string } {
  if (details.state === 'MERGED') {
    return { label: 'Merged', className: 'bg-purple-100 text-purple-800 dark:bg-purple-900/50 dark:text-purple-200' };
  }
  if (details.state === 'CLOSED') {
    return { label: 'Closed', className: 'bg-deleted/15 text-deleted' };
  }
  if (details.isDraft) {
    return { label: 'Draft', className: 'bg-bg-tertiary text-text-secondary' };
  }
  return { label: 'Open', className: 'bg-added/15 text-added' };
}

const DECISIONS: Record<string, { label: string; className: string }> = {
  APPROVED: { label: 'Approved', className: 'text-added' },
  CHANGES_REQUESTED: { label: 'Changes requested', className: 'text-deleted' },
  REVIEW_REQUIRED: { label: 'Review required', className: 'text-text-muted' },
};

function Avatar(props: { login: string; url: string | null }) {
  const { login, url } = props;
  const [failed, setFailed] = useState(false);

  if (url && !failed) {
    return <img src={url} alt="" className="w-4 h-4 rounded-full shrink-0" onError={() => setFailed(true)} />;
  }
  return (
    <span className="w-4 h-4 rounded-full shrink-0 bg-text-muted text-white text-[9px] font-medium flex items-center justify-center" aria-hidden>
      {login.charAt(0).toUpperCase()}
    </span>
  );
}

interface GitHubDialogProps {
  details: GitHubDetails;
  /** The ref of the view on screen. */
  diffRef: string;
  onSubmitReview: () => void;
  onClose: () => void;
}

function Section(props: { title: string; children: ReactNode }) {
  const { title, children } = props;

  return (
    <section className="px-4 py-3 border-t border-border first:border-t-0">
      <h3 className="mb-2 text-[11px] font-medium text-text-muted">{title}</h3>
      <div className="flex flex-col gap-2 text-xs text-text-secondary">{children}</div>
    </section>
  );
}

function SyncSection(props: { details: GitHubDetails; diffRef: string; onOpenView: () => void }) {
  const { details, diffRef, onOpenView } = props;
  const { syncing, syncedAt, paused, error } = useGitHubSync();
  const navigateToRef = useNavigateToRef();
  const inView = diffRef === details.ref;

  return (
    <Section title="Review threads">
      <span>{details.reviewThreadCount} on GitHub</span>
      <span className="text-text-muted">
        {syncing ? 'Pulling…' : syncedAt ? `Pulled ${dayjs(syncedAt).fromNow()}` : 'Not pulled yet'}
      </span>
      {error && <span className="text-deleted break-words">{error}</span>}
      <div className="flex flex-wrap items-center gap-2">
        <SettingsButton
          onClick={() => void syncNow(diffRef, (ref) => navigateToRef(ref))}
          disabled={syncing}
          className="inline-flex items-center gap-1.5"
        >
          <RefreshIcon className="w-3.5 h-3.5" />
          Sync now
        </SettingsButton>
        {!inView && (
          <SettingsButton onClick={onOpenView} title={`Open the diff of ${details.ref}`}>
            Open PR view
          </SettingsButton>
        )}
      </div>
      <label className="flex items-center justify-between gap-3">
        <span title="Pulls every minute while the PR view is open">Auto sync in the PR view</span>
        <Switch label="Auto sync in the PR view" checked={!paused} onChange={(on) => setAutoSyncPaused(!on)} />
      </label>
    </Section>
  );
}

function ReviewSection(props: { details: GitHubDetails; onSubmitReview: () => void }) {
  const { details, onSubmitReview } = props;
  const open = details.state === 'OPEN';

  return (
    <Section title="Review">
      <span>{open ? 'Post your open comments as one review' : `The PR is ${details.state.toLowerCase()}`}</span>
      {open && (
        <SettingsButton variant="primary" onClick={onSubmitReview} className="self-start">
          Submit review
        </SettingsButton>
      )}
    </Section>
  );
}

function ChangesSection(props: { details: GitHubDetails }) {
  const { details } = props;

  return (
    <Section title="Changes">
      <span className="flex items-center gap-2 tabular-nums">
        {details.changedFiles} file{details.changedFiles === 1 ? '' : 's'}
        <DiffStats additions={details.additions} deletions={details.deletions} />
      </span>
    </Section>
  );
}

/** The pull request of the checked out branch: its description, review thread sync and review. */
export function GitHubDialog(props: GitHubDialogProps) {
  const { details, diffRef, onSubmitReview, onClose } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const navigateToRef = useNavigateToRef();
  const state = stateLabel(details);
  const decision = details.reviewDecision ? DECISIONS[details.reviewDecision] : undefined;
  const body = details.body.trim();

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      aria-label={`Pull request #${details.number}`}
      onKeyDown={(e) => e.stopPropagation()}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          onClose();
        }
      }}
      className="fixed inset-0 m-auto p-0 w-[880px] max-w-[calc(100vw-2rem)] h-[min(600px,calc(100vh-4rem))] bg-bg text-text border border-border rounded-xl shadow-lg overflow-hidden font-sans backdrop:bg-black/40"
    >
      <div className="flex flex-col h-full">
        <div className="flex items-start gap-3 px-5 pt-4 pb-3 border-b border-border">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-text break-words">
              {details.title} <span className="font-normal text-text-muted">#{details.number}</span>
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary">
              <span className={cn('px-2 py-0.5 rounded-full text-[11px] font-medium', state.className)}>{state.label}</span>
              <span className="inline-flex items-center gap-1.5">
                <Avatar login={details.author} url={details.authorAvatarUrl} />
                <span className="font-medium text-text">{details.author}</span>
              </span>
              <span>
                wants to merge <code className="font-mono text-[11px]">{details.headRefName}</code> into{' '}
                <code className="font-mono text-[11px]">{details.baseRefName}</code>
              </span>
              <span className="text-text-muted">opened {dayjs(details.createdAt).fromNow()}</span>
              {decision && <span className={decision.className}>{decision.label}</span>}
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
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 min-w-0 overflow-y-auto px-5 py-4 text-[13px] leading-relaxed text-text">
            {body ? <MarkdownContent content={body} html /> : <p className="text-text-muted">No description</p>}
          </div>
          <aside className="w-[260px] shrink-0 border-l border-border bg-bg-secondary overflow-y-auto">
            <SyncSection
              details={details}
              diffRef={diffRef}
              onOpenView={() => {
                onClose();
                navigateToRef(details.ref);
              }}
            />
            <ReviewSection details={details} onSubmitReview={onSubmitReview} />
            <ChangesSection details={details} />
            <div className="px-4 py-3 border-t border-border">
              <a
                href={details.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text transition-colors"
              >
                <GitHubIcon className="w-3.5 h-3.5" />
                Open on GitHub
              </a>
            </div>
          </aside>
        </div>
      </div>
    </dialog>
  );
}
