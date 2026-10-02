import { useCallback, useEffect, useState, type ReactNode } from 'react';
import type { CommentThread as CommentThreadType } from './types';
import { DEFAULT_AUTHOR, GENERAL_THREAD_FILE_PATH, isThreadResolved } from './types';
import type { CommentActions } from '../../hooks/use-comment-actions';
import { threadLineLabel } from '../../lib/thread-location';
import { cn } from '../../lib/cn';
import { CommentIcon } from '../icons/comment-icon';
import { ChevronIcon } from '../icons/chevron-icon';
import { ThreadBadge } from '../ui/thread-badge';
import { ThreadCard } from './thread-card';

interface OrphanedThreadsProps {
  threads: CommentThreadType[];
  commentActions: CommentActions;
  /** Defaults to "N outdated comments". */
  title?: string;
  /** Names the file of each thread, for threads of files the diff no longer shows. */
  showFilePath?: boolean;
  renderExtra?: (thread: CommentThreadType) => ReactNode;
  className?: string;
}

/** Threads whose lines the diff no longer shows, listed with the code they were left on. */
export function OrphanedThreads(props: OrphanedThreadsProps) {
  const { threads, commentActions, title, showFilePath, renderExtra, className } = props;
  const [isExpanded, setIsExpanded] = useState(() => threads.some(thread => !isThreadResolved(thread)));
  const [focused, setFocused] = useState<HTMLElement | null>(null);

  // The focus event does not bubble, the capture phase still passes the container.
  const containerRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) {
      return;
    }
    const handler = (event: Event) => {
      setIsExpanded(true);
      setFocused(event.target as HTMLElement);
    };
    el.addEventListener('diffity:focus-thread', handler, true);
    return () => el.removeEventListener('diffity:focus-thread', handler, true);
  }, []);

  useEffect(() => {
    if (threads.some(thread => !isThreadResolved(thread))) {
      setIsExpanded(true);
    }
  }, [threads]);

  useEffect(() => {
    if (!focused || !isExpanded) {
      return;
    }
    focused.scrollIntoView({ behavior: 'instant', block: 'center' });
    setFocused(null);
  }, [focused, isExpanded]);

  if (threads.length === 0) {
    return null;
  }

  return (
    <div ref={containerRef} className={cn('border-b border-border bg-bg-secondary/50', className)}>
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 w-full px-4 py-2 text-xs text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
      >
        <ChevronIcon expanded={isExpanded} />
        <CommentIcon className="w-3.5 h-3.5" />
        <span>
          {title ?? `${threads.length} outdated comment${threads.length !== 1 ? 's' : ''}`}
        </span>
        <ThreadBadge variant="outdated" />
      </button>
      <div className={cn('px-4 pb-3 space-y-2', !isExpanded && 'hidden')}>
        {threads.map((thread) => (
          <div key={thread.id} data-thread-id={thread.id}>
            <ThreadCard
              thread={thread}
              onReply={(body) => commentActions.addReply(thread.id, body, DEFAULT_AUTHOR)}
              onResolve={() => commentActions.resolveThread(thread.id)}
              onUnresolve={() => commentActions.unresolveThread(thread.id)}
              onEditComment={(commentId, body) => commentActions.editComment(commentId, body)}
              onDeleteComment={(commentId) => commentActions.deleteComment(thread.id, commentId)}
              onDeleteThread={() => commentActions.deleteThread(thread.id)}
              className="thread-card border border-border max-w-[700px]"
              headerLeft={
                <>
                  {showFilePath && thread.filePath !== GENERAL_THREAD_FILE_PATH && (
                    <span className="text-[11px] text-text-secondary font-mono truncate">{thread.filePath}</span>
                  )}
                  <span className="text-[11px] text-text-muted font-mono shrink-0">{threadLineLabel(thread)}</span>
                  <ThreadBadge variant="outdated" />
                  {thread.status !== 'open' && <ThreadBadge variant={thread.status} />}
                  {renderExtra?.(thread)}
                </>
              }
            >
              {thread.anchorContent && (
                <pre className="px-3 py-2 text-xs font-mono text-text-muted bg-bg-tertiary/50 border-b border-border overflow-x-auto whitespace-pre max-h-24 overflow-y-auto">{thread.anchorContent}</pre>
              )}
            </ThreadCard>
          </div>
        ))}
      </div>
    </div>
  );
}
