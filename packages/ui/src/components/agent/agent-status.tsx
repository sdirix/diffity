import { cn } from '../../lib/cn';
import { Spinner } from '../icons/spinner';
import { AGENT_NAME, requestTitle } from './request-state';
import { OFFLINE_HINT, useAgentStatus, type AgentStatus } from './use-agent';

/** A dot for whether the agent works, waits or is away. */
export function StatusDot(props: { state: AgentStatus['state'] }) {
  const { state } = props;
  if (state === 'working') {
    return <Spinner className="w-3 h-3 shrink-0" />;
  }
  return <span className={cn('inline-block w-2 h-2 rounded-full shrink-0', state === 'listening' ? 'bg-added' : 'bg-text-muted/50')} />;
}

/** What the agent does, in a few words. */
export function statusText(status: AgentStatus): string {
  if (status.state === 'working' && status.current) {
    return `${AGENT_NAME}: ${status.current.progress ?? requestTitle(status.current)}`;
  }
  return status.state === 'offline' ? 'No agent listening' : `${AGENT_NAME} listening`;
}

/** The hint under a form that queues a request, while no agent listens. */
export function OfflineHint() {
  const { state } = useAgentStatus();
  if (state !== 'offline') {
    return null;
  }
  return <p className="text-[11px] leading-snug text-text-muted">{OFFLINE_HINT}</p>;
}
