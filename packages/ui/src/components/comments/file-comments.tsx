import { useEffect, useRef, useState } from 'react';
import type { CommentThread } from './types';
import { DEFAULT_AUTHOR, isThreadResolved } from './types';
import type { CommentActions } from '../../hooks/use-comment-actions';
import { CommentForm } from './comment-form';
import { CommentIcon } from '../icons/comment-icon';
import { ThreadBadge } from '../ui/thread-badge';
import { ThreadCard } from './thread-card';

interface FileCommentsProps {
  filePath: string;
  /** Threads on the whole file, at line 0. */
  threads: CommentThread[];
  commentActions: CommentActions;
  showForm: boolean;
  onCloseForm: () => void;
}

interface FileThreadProps {
  thread: CommentThread;
  commentActions: CommentActions;
}

/** A whole-file thread, collapsed while resolved like a line thread. */
function FileThread(props: FileThreadProps) {
  const { thread, commentActions } = props;
  const [isCollapsed, setIsCollapsed] = useState(isThreadResolved(thread));
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const handler = () => setIsCollapsed(false);
    el.addEventListener('diffity:focus-thread', handler);
    return () => el.removeEventListener('diffity:focus-thread', handler);
  }, []);

  const statusBadge = thread.status !== 'open' && <ThreadBadge variant={thread.status} />;

  return (
    <div ref={ref} data-thread-id={thread.id}>
      {isCollapsed ? (
        <button
          onClick={() => setIsCollapsed(false)}
          className="thread-card inline-flex items-center gap-1.5 px-2 py-1 text-xs text-text-muted hover:text-text-secondary hover:bg-hover rounded-md transition-colors cursor-pointer"
        >
          <CommentIcon className="w-3.5 h-3.5" />
          <span>File · {thread.comments.length} comment{thread.comments.length !== 1 ? 's' : ''}</span>
          {statusBadge}
        </button>
      ) : (
        <ThreadCard
          thread={thread}
          onReply={(body) => commentActions.addReply(thread.id, body, DEFAULT_AUTHOR)}
          onResolve={() => {
            commentActions.resolveThread(thread.id);
            setIsCollapsed(true);
          }}
          onUnresolve={() => commentActions.unresolveThread(thread.id)}
          onEditComment={(commentId, body) => commentActions.editComment(commentId, body)}
          onDeleteComment={(commentId) => commentActions.deleteComment(thread.id, commentId)}
          onDeleteThread={() => commentActions.deleteThread(thread.id)}
          className="thread-card max-w-[700px] bg-bg-secondary"
          headerLeft={
            <>
              <span className="text-[11px] text-text-muted font-mono">File</span>
              {statusBadge}
            </>
          }
          headerRight={
            <button
              onClick={() => setIsCollapsed(true)}
              className="text-[11px] text-text-muted hover:text-text-secondary transition-colors cursor-pointer ml-2"
            >
              Collapse
            </button>
          }
        />
      )}
    </div>
  );
}

/** Comments on a whole file, shown above its diff. */
export function FileComments(props: FileCommentsProps) {
  const { filePath, threads, commentActions, showForm, onCloseForm } = props;

  if (threads.length === 0 && !showForm) {
    return null;
  }

  return (
    <div className="px-4 py-3 space-y-2 border-b border-border">
      {threads.map((thread) => (
        <FileThread key={thread.id} thread={thread} commentActions={commentActions} />
      ))}
      {showForm && (
        <div className="max-w-[700px]">
          <CommentForm
            onSubmit={(body) => {
              commentActions.addThread(filePath, 'new', 0, 0, body, DEFAULT_AUTHOR);
              onCloseForm();
            }}
            onCancel={onCloseForm}
            placeholder={`Comment on ${filePath.split('/').pop()}...`}
            submitLabel="Comment"
          />
        </div>
      )}
    </div>
  );
}
