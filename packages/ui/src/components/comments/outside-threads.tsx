import type { CommentThread } from './types';
import type { CommentActions } from '../../hooks/use-comment-actions';
import type { LocatedThread } from '../../lib/api';
import { useNavigateToRef } from '../layout/ref-menu';
import { OrphanedThreads } from './orphaned-threads';

interface OutsideThreadsProps {
  threads: CommentThread[];
  locations: Map<string, LocatedThread>;
  commentActions: CommentActions;
  /** The view has no changes left, so every thread of it is listed. */
  viewEmpty?: boolean;
  className?: string;
}

/** Threads of this view the diff has no place for, with the commit their code went to when there is one. */
export function OutsideThreads(props: OutsideThreadsProps) {
  const { threads, locations, commentActions, viewEmpty, className } = props;
  const navigateToRef = useNavigateToRef();

  const count = `${threads.length} comment${threads.length === 1 ? '' : 's'}`;

  return (
    <OrphanedThreads
      threads={threads}
      commentActions={commentActions}
      title={viewEmpty ? `${count} on code no longer in this view` : `${count} on files no longer in this diff`}
      showFilePath
      className={className}
      renderExtra={(thread) => {
        const movedTo = locations.get(thread.id)?.movedTo;
        if (!movedTo) {
          return null;
        }
        return (
          <button
            onClick={() => navigateToRef(movedTo.ref)}
            className="text-[11px] text-accent hover:underline cursor-pointer shrink-0"
            title={movedTo.subject}
          >
            View in commit {movedTo.shortSha}
          </button>
        );
      }}
    />
  );
}
