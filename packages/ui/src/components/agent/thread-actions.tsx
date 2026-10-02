import { Spinner } from '../icons/spinner';
import type { CommentThread } from '../comments/types';
import { SparkleIcon } from './agent-icons';
import { AGENT_NAME } from './request-state';
import { queueWithToast, useThreadActivity } from './use-agent';

interface AgentThreadAskProps {
  thread: CommentThread;
  /** Whether the thread takes replies where it shows. */
  canReply: boolean;
}

/** "Ask Agent" on an open thread that waits on the user. */
export function AgentThreadAsk(props: AgentThreadAskProps) {
  const { thread, canReply } = props;
  const activity = useThreadActivity(thread.id);

  if (!canReply || thread.status !== 'open' || activity !== 'idle' || thread.comments.at(-1)?.author.type === 'agent') {
    return null;
  }

  return (
    <button
      onClick={() => queueWithToast({ mode: 'thread', threadIds: [thread.id] }, `Failed to ask ${AGENT_NAME}`)}
      className="inline-flex items-center gap-1 mr-1 text-[11px] text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
      title={`${AGENT_NAME} answers in this thread`}
    >
      <SparkleIcon className="w-3 h-3 text-accent" />
      Ask {AGENT_NAME}
    </button>
  );
}

/** What the agent does with the thread, nothing while it does not work on it. */
export function AgentThreadActivity(props: { threadId: string }) {
  const { threadId } = props;
  const activity = useThreadActivity(threadId);

  if (activity === 'idle') {
    return null;
  }

  return (
    <div className="flex items-center gap-2 px-4 pb-2 text-xs text-text-muted">
      {activity === 'working' ? <Spinner className="w-3 h-3" /> : <SparkleIcon className="w-3 h-3 text-accent" />}
      {activity === 'working' ? `${AGENT_NAME} is working on it` : `Queued for ${AGENT_NAME}`}
    </div>
  );
}
