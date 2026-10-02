import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { deleteThread, fetchRepoThreads, type LocatedThread } from '../../lib/api';
import { errorMessage } from '../../lib/toast';
import { cn } from '../../lib/cn';
import { parseCommitRef } from '../../lib/refs';
import { shortcutHint } from '../../lib/shortcuts';
import { useViewState } from '../../lib/view-state';
import {
  fileLabel,
  groupThreads,
  locationNote,
  matchesFilters,
  threadAuthor,
  threadLineLabel,
  treePagePath,
  TREE_REF,
  viewLabel,
  type AuthorFilter,
  type FileThreads,
  type StatusFilter,
  type ThreadFilters,
  type ViewGroup,
} from '../../lib/thread-location';
import { statusOptions } from '../../queries/refs';
import { useNavigateToRef } from '../layout/ref-menu';
import { formatRelativeTime } from './comment-bubble';
import { GENERAL_THREAD_FILE_PATH } from './types';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { SegmentedToggle } from '../ui/segmented-toggle';
import { ThreadBadge } from '../ui/thread-badge';
import { Kbd } from '../ui/kbd';
import { CommentIcon } from '../icons/comment-icon';
import { FileIcon } from '../icons/file-icon';
import { GitCommitIcon } from '../icons/git-commit-icon';
import { GitCompareIcon } from '../icons/git-compare-icon';
import { PencilIcon } from '../icons/pencil-icon';
import { TrashIcon } from '../icons/trash-icon';
import { XIcon } from '../icons/x-icon';

type Scope = 'view' | 'all';

interface PanelState extends ThreadFilters {
  scope: Scope;
}

const DEFAULT_STATE: PanelState = { scope: 'view', status: 'open', author: 'all' };

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: 'All',
  open: 'Open',
  resolved: 'Resolved',
  dismissed: 'Dismissed',
};

interface CommentsPanelProps {
  sessionId: string;
  /** Threads of the view on screen, located in its diff. */
  viewThreads: LocatedThread[];
  branch: string | null;
  onScrollToThread: (threadId: string, filePath: string) => void;
  onClose: () => void;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function deleteMessage(count: number, filters: ThreadFilters, scope: Scope): string {
  const status = filters.status === 'all' ? '' : `${filters.status} `;
  const author = filters.author === 'user' ? ' started by you' : filters.author === 'agent' ? ' started by an agent' : '';
  const where = scope === 'view' ? 'in this view' : 'in all views';
  const what = count === 1 ? `the ${status}comment` : `all ${count} ${status}comments`;
  return `Delete ${what}${author} ${where}? This cannot be undone.`;
}

function ViewIcon(props: { viewRef: string }) {
  const { viewRef } = props;
  const className = 'w-3.5 h-3.5 shrink-0 text-text-muted';
  if (viewRef === TREE_REF) {
    return <FileIcon className={className} />;
  }
  if (parseCommitRef(viewRef)) {
    return <GitCommitIcon className={className} />;
  }
  if (viewRef.includes('..')) {
    return <GitCompareIcon className={className} />;
  }
  return <PencilIcon className={className} />;
}

interface ThreadRowProps {
  thread: LocatedThread;
  outdated: boolean;
  openable: boolean;
  onOpen: (thread: LocatedThread) => void;
  onOpenRef: (ref: string) => void;
  onDelete: (thread: LocatedThread) => void;
}

function ThreadRow(props: ThreadRowProps) {
  const { thread, outdated, openable, onOpen, onOpenRef, onDelete } = props;
  const first = thread.comments[0];
  const replies = thread.comments.length - 1;
  const note = locationNote(thread);
  const agent = threadAuthor(thread) === 'agent';
  const excerpt = (first?.body ?? '').replace(/\s+/g, ' ').trim() || 'Comment';

  return (
    <div
      role="button"
      tabIndex={openable ? 0 : -1}
      data-panel-thread-id={thread.id}
      onClick={() => openable && onOpen(thread)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && openable) {
          onOpen(thread);
        }
      }}
      className={cn(
        'group rounded-md border border-border bg-bg px-2.5 py-2 outline-none transition-colors focus-visible:border-accent',
        openable ? 'cursor-pointer hover:border-accent/60' : 'cursor-default',
      )}
      title={openable ? 'Show in the diff' : undefined}
    >
      <div className="flex items-center gap-1.5 min-w-0 text-[11px]">
        <span
          className={cn(
            'w-4 h-4 rounded-full shrink-0 flex items-center justify-center text-[9px] font-medium text-white',
            agent ? 'bg-accent' : 'bg-text-muted',
          )}
          title={first?.author.name}
        >
          {(first?.author.name ?? '?').charAt(0).toUpperCase()}
        </span>
        <span className="text-text-secondary truncate">{first?.author.name}</span>
        {thread.filePath !== GENERAL_THREAD_FILE_PATH && (
          <span className="font-mono text-text-muted shrink-0">{threadLineLabel(thread)}</span>
        )}
        {thread.status !== 'open' && <ThreadBadge variant={thread.status} size="sm" />}
        <span className="ml-auto text-text-muted shrink-0 group-hover:hidden group-focus-within:hidden">
          {thread.updatedAt ? formatRelativeTime(thread.updatedAt) : ''}
        </span>
        <button
          onClick={(event) => {
            event.stopPropagation();
            onDelete(thread);
          }}
          className="ml-auto hidden group-hover:inline-flex group-focus-within:inline-flex items-center justify-center w-4 h-4 text-text-muted hover:text-deleted cursor-pointer shrink-0"
          title="Delete thread"
          aria-label="Delete thread"
        >
          <TrashIcon className="w-3.5 h-3.5" />
        </button>
      </div>
      <p className="mt-1 text-xs leading-5 text-text line-clamp-2 break-words">{excerpt}</p>
      {outdated && thread.anchorContent && (
        <pre className="mt-1.5 px-2 py-1 text-[11px] font-mono text-text-muted bg-bg-tertiary/60 rounded overflow-x-auto whitespace-pre max-h-20 overflow-y-auto">{thread.anchorContent}</pre>
      )}
      {(replies > 0 || note || thread.movedTo) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[11px] text-text-muted">
          {replies > 0 && <span>{replies === 1 ? '1 reply' : `${replies} replies`}</span>}
          {note && <span>{note}</span>}
          {thread.movedTo && (
            <button
              onClick={(event) => {
                event.stopPropagation();
                onOpenRef(thread.movedTo!.ref);
              }}
              className="text-accent hover:underline cursor-pointer"
              title={thread.movedTo.subject}
            >
              View in commit {thread.movedTo.shortSha}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

interface FileSectionProps extends Omit<ThreadRowProps, 'thread' | 'openable'> {
  file: FileThreads;
  isOpenable: (thread: LocatedThread) => boolean;
}

function FileSection(props: FileSectionProps) {
  const { file, isOpenable, ...rowProps } = props;

  return (
    <div className="px-3 pt-2">
      <div className="pb-1 font-mono text-[11px] text-text-secondary truncate" title={file.path}>{fileLabel(file.path)}</div>
      <div className="space-y-1.5">
        {file.threads.map((thread) => (
          <ThreadRow key={thread.id} thread={thread} openable={isOpenable(thread)} {...rowProps} />
        ))}
      </div>
    </div>
  );
}

interface GroupBodyProps extends Omit<FileSectionProps, 'file' | 'outdated'> {
  group: ViewGroup;
}

function GroupBody(props: GroupBodyProps) {
  const { group, ...sectionProps } = props;
  const outdatedCount = group.outdated.reduce((count, file) => count + file.threads.length, 0);

  return (
    <>
      {group.located.map((file) => (
        <FileSection key={file.path} file={file} outdated={false} {...sectionProps} />
      ))}
      {outdatedCount > 0 && (
        <div className="mt-2">
          <div className="flex items-center gap-1.5 px-3 pt-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            Outdated
            <ThreadBadge variant="outdated" size="sm">{outdatedCount}</ThreadBadge>
          </div>
          {group.outdated.map((file) => (
            <FileSection key={file.path} file={file} outdated {...sectionProps} />
          ))}
        </div>
      )}
    </>
  );
}

/** The threads of the view on screen, or of every view of the repository, with filters. */
export function CommentsPanel(props: CommentsPanelProps) {
  const { sessionId, viewThreads, branch, onScrollToThread, onClose } = props;
  const [state, setState] = useViewState<PanelState>('comments-panel', DEFAULT_STATE);
  const [confirm, setConfirm] = useState<{ ids: string[]; title: string; message: string } | null>(null);
  const navigate = useNavigate();
  const navigateToRef = useNavigateToRef();
  const queryClient = useQueryClient();
  const { data: status } = useQuery(statusOptions());
  const repoThreads = useQuery({
    queryKey: ['repo-threads'],
    queryFn: () => fetchRepoThreads(),
    enabled: state.scope === 'all',
    refetchInterval: 10_000,
    placeholderData: keepPreviousData,
  });

  const scoped = useMemo(() => {
    if (state.scope === 'view') {
      return viewThreads;
    }
    return [...viewThreads, ...(repoThreads.data ?? []).filter((thread) => thread.sessionId !== sessionId)];
  }, [state.scope, viewThreads, repoThreads.data, sessionId]);

  const counts = useMemo(() => {
    const byAuthor = scoped.filter((thread) => matchesFilters(thread, { status: 'all', author: state.author }));
    return {
      all: byAuthor.length,
      open: byAuthor.filter((thread) => thread.status === 'open').length,
      resolved: byAuthor.filter((thread) => thread.status === 'resolved').length,
      dismissed: byAuthor.filter((thread) => thread.status === 'dismissed').length,
    };
  }, [scoped, state.author]);

  const visible = useMemo(() => scoped.filter((thread) => matchesFilters(thread, state)), [scoped, state]);
  const groups = useMemo(() => groupThreads(visible, sessionId), [visible, sessionId]);

  const update = (next: Partial<PanelState>) => setState((prev) => ({ ...prev, ...next }));

  const openRef = (ref: string) => {
    if (ref === TREE_REF) {
      navigate(treePagePath());
      return;
    }
    navigateToRef(ref);
  };

  const openThread = (thread: LocatedThread) => {
    if (thread.sessionId === sessionId) {
      onScrollToThread(thread.id, thread.filePath);
    } else if (thread.ref === TREE_REF) {
      navigate(treePagePath(thread));
    } else {
      navigateToRef(thread.ref, { thread: thread.id });
    }
  };

  const removeThreads = async (ids: string[]) => {
    setConfirm(null);
    const results = await Promise.allSettled(ids.map((id) => deleteThread(id)));
    queryClient.invalidateQueries({ queryKey: ['threads'] });
    queryClient.invalidateQueries({ queryKey: ['repo-threads'] });
    const failed = results.filter((result) => result.status === 'rejected');
    if (failed.length > 0) {
      toast.error(`Failed to delete ${plural(failed.length, 'comment')}`, {
        description: errorMessage((failed[0] as PromiseRejectedResult).reason),
      });
    } else if (ids.length > 1) {
      toast.success(`Deleted ${plural(ids.length, 'comment')}`);
    }
  };

  const requestDelete = (thread: LocatedThread) => {
    const replies = thread.comments.length - 1;
    if (replies === 0) {
      void removeThreads([thread.id]);
      return;
    }
    setConfirm({
      ids: [thread.id],
      title: 'Delete thread',
      message: `Delete this thread and its ${replies === 1 ? 'reply' : `${replies} replies`}? This cannot be undone.`,
    });
  };

  const rowProps = {
    isOpenable: (thread: LocatedThread) => !thread.otherBranch && thread.location !== 'unknown',
    onOpen: openThread,
    onOpenRef: openRef,
    onDelete: requestDelete,
  };

  const statusOptionsList = (['open', 'resolved', 'dismissed', 'all'] as StatusFilter[]).map((value) => ({
    value,
    label: `${STATUS_LABELS[value]} ${counts[value]}`,
  }));
  const authorOptions: { value: AuthorFilter; label: string }[] = [
    { value: 'all', label: 'Everyone' },
    { value: 'user', label: 'You' },
    { value: 'agent', label: 'Agent' },
  ];
  const loadingAll = state.scope === 'all' && repoThreads.isPending;

  return (
    <aside aria-label="Comments" className="w-[360px] min-w-[360px] border-l border-border bg-bg-secondary flex flex-col overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <span className="text-xs font-medium text-text-secondary uppercase tracking-wider flex items-center gap-1.5">
          <CommentIcon className="w-3.5 h-3.5" />
          Comments
        </span>
        <div className="ml-auto">
          <SegmentedToggle<Scope>
            value={state.scope}
            onChange={(scope) => update({ scope })}
            options={[
              { value: 'view', label: 'This view' },
              { value: 'all', label: 'All views' },
            ]}
          />
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded-md text-text-muted hover:text-text hover:bg-hover cursor-pointer"
          title={`Close (${shortcutHint('comments-panel')})`}
          aria-label="Close comments panel"
        >
          <XIcon className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex flex-col gap-1.5 px-3 py-2 border-b border-border">
        <SegmentedToggle<StatusFilter> value={state.status} onChange={(value) => update({ status: value })} options={statusOptionsList} />
        <SegmentedToggle<AuthorFilter> value={state.author} onChange={(author) => update({ author })} options={authorOptions} />
      </div>
      <div className="flex-1 overflow-y-auto pb-3">
        {loadingAll && <div className="px-4 py-6 text-xs text-text-muted">Loading comments...</div>}
        {repoThreads.error && state.scope === 'all' && (
          <div className="px-4 py-3 text-xs text-deleted">Failed to load other views: {errorMessage(repoThreads.error)}</div>
        )}
        {!loadingAll && groups.length === 0 && (
          <div className="px-6 py-10 text-center text-xs text-text-muted">
            {scoped.length === 0
              ? state.scope === 'view' ? 'No comments in this view' : 'No comments in this repository'
              : 'No comments match the filters'}
          </div>
        )}
        {state.scope === 'view'
          ? groups.map((group) => <GroupBody key={group.sessionId} group={group} {...rowProps} />)
          : groups.map((group) => (
            <section key={group.sessionId} className="pt-1">
              <div className="sticky top-0 z-10 flex items-center gap-1.5 px-3 py-1.5 bg-bg-secondary border-b border-border">
                <ViewIcon viewRef={group.ref} />
                <span className="text-xs font-medium text-text truncate" title={group.ref}>
                  {viewLabel(group.ref, branch, status?.base ?? null, group.otherBranch)}
                </span>
                {group.current && (
                  <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-accent/15 text-accent shrink-0">This view</span>
                )}
                <span className="text-[11px] text-text-muted shrink-0 tabular-nums">{group.count}</span>
                {!group.current && !group.otherBranch && (
                  <button
                    onClick={() => openRef(group.ref)}
                    className="ml-auto text-[11px] text-accent hover:underline cursor-pointer shrink-0"
                    title={group.ref === TREE_REF ? 'Open the file browser' : `Open the diff of ${group.ref}`}
                  >
                    Open
                  </button>
                )}
              </div>
              <GroupBody group={group} {...rowProps} />
            </section>
          ))}
      </div>
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-border text-[11px] text-text-muted">
        <Kbd>{shortcutHint('comments-panel')}</Kbd>
        toggles this panel
        {visible.length > 0 && (
          <button
            onClick={() => setConfirm({
              ids: visible.map((thread) => thread.id),
              title: `Delete ${plural(visible.length, 'comment')}`,
              message: deleteMessage(visible.length, state, state.scope),
            })}
            className="ml-auto inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-text-muted hover:text-deleted hover:bg-hover cursor-pointer"
            title="Delete the comments listed above"
          >
            <TrashIcon className="w-3 h-3" />
            Delete all
          </button>
        )}
      </div>
      {confirm && (
        <ConfirmDialog
          title={confirm.title}
          message={confirm.message}
          confirmLabel="Delete"
          onConfirm={() => void removeThreads(confirm.ids)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </aside>
  );
}
