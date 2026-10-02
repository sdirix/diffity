import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { cn } from '../../lib/cn';
import { queryClient } from '../../lib/query-client';
import { viewLabel } from '../../lib/thread-location';
import { errorMessage } from '../../lib/toast';
import { statusOptions } from '../../queries/refs';
import { formatRelativeTime } from '../comments/comment-bubble';
import { CheckIcon } from '../icons/check-icon';
import { Spinner } from '../icons/spinner';
import { XIcon } from '../icons/x-icon';
import { cancelAgentRequest, type AgentRequest } from './agent-api';
import { SparkleIcon } from './agent-icons';
import { StatusDot } from './agent-status';
import { closeRequestsPanel, useAgentUi } from './agent-store';
import { AGENT_NAME, WATCH_COMMAND, isExpired, requestTitle } from './request-state';
import { secondaryButtonClass } from './styles';
import { AGENT_REQUESTS_KEY, useAgentRequests, useAgentStatus } from './use-agent';

function badge(request: AgentRequest): { label: string; className: string } {
  switch (request.status) {
    case 'queued':
      return { label: 'Queued', className: 'bg-bg-tertiary text-text-secondary' };
    case 'claimed':
      return { label: 'Working', className: 'bg-accent/15 text-accent' };
    case 'done':
      return { label: 'Done', className: 'bg-added/15 text-added' };
    case 'cancelled':
      return isExpired(request)
        ? { label: 'Expired', className: 'bg-modified/15 text-modified' }
        : { label: 'Cancelled', className: 'bg-bg-tertiary text-text-muted' };
  }
}

function cancel(request: AgentRequest) {
  cancelAgentRequest(request.id)
    .then(() => queryClient.invalidateQueries({ queryKey: AGENT_REQUESTS_KEY }))
    .catch((error) => toast.error('Failed to cancel the request', { description: errorMessage(error) }));
}

function RequestRow(props: { request: AgentRequest }) {
  const { request } = props;
  const { data: status } = useQuery(statusOptions());
  const { label, className } = badge(request);
  const asked = request.focus ?? request.note;

  return (
    <li className="flex flex-col gap-1.5 px-2.5 py-2 rounded-md border border-border bg-bg">
      <div className="flex items-center gap-2 text-xs">
        {request.status === 'claimed' ? <Spinner className="w-3 h-3 shrink-0" /> : <SparkleIcon className="w-3 h-3 shrink-0 text-accent" />}
        <span className="font-medium text-text truncate">{requestTitle(request)}</span>
        <span className={cn('ml-auto px-1.5 py-0.5 rounded-full text-[10px] font-medium shrink-0', className)}>{label}</span>
      </div>
      <div className="flex items-center gap-2 pl-5 text-[11px] text-text-muted">
        <span className="truncate">{viewLabel(request.ref, status?.branch ?? null, status?.base ?? null)}</span>
        {request.trigger === 'mention' && <span className="shrink-0">@mention</span>}
        <span className="ml-auto shrink-0" title={request.createdAt}>{formatRelativeTime(request.createdAt)}</span>
      </div>
      {asked && (
        <blockquote className="ml-5 pl-2 border-l-2 border-border text-xs text-text-secondary whitespace-pre-wrap break-words line-clamp-3">{asked}</blockquote>
      )}
      {request.status === 'claimed' && request.progress && (
        <div className="ml-5 text-xs text-text-secondary break-words">{request.progress}</div>
      )}
      {request.status !== 'claimed' && request.result && (
        <div className="ml-5 flex items-start gap-1.5 text-xs text-text-secondary break-words">
          {request.status === 'done' && <CheckIcon className="w-3 h-3 mt-0.5 shrink-0 text-added" />}
          <span className="min-w-0">{request.result}</span>
        </div>
      )}
      {request.status === 'queued' && (
        <div className="ml-5">
          <button onClick={() => cancel(request)} className={cn(secondaryButtonClass, '-ml-2 px-2 py-0.5')}>
            <XIcon className="w-3 h-3" />
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}

function ListenerLine() {
  const { state, since } = useAgentStatus();

  if (state === 'offline') {
    return (
      <div className="flex items-start gap-2 text-xs text-text-secondary">
        <span className="pt-1"><StatusDot state={state} /></span>
        <p className="leading-snug">
          No agent listening. Run <code className="px-1 rounded bg-bg-tertiary font-mono text-[11px]">{WATCH_COMMAND}</code> in Claude Code. Requests wait until it does.
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs text-text-secondary">
      <StatusDot state={state} />
      {state === 'working' ? `${AGENT_NAME} working` : `${AGENT_NAME} listening`}
      {since && <span className="text-text-muted" title={since}>since {new Date(since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
    </div>
  );
}

/** Esc closes the panel, unless it is meant for a field or a dialog. */
function useEscapeToClose() {
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (e.key !== 'Escape' || tag === 'INPUT' || tag === 'TEXTAREA' || document.querySelector('dialog:modal')) {
        return;
      }
      closeRequestsPanel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);
}

function RequestsDrawer() {
  const { requests } = useAgentRequests();
  useEscapeToClose();

  return (
    <aside
      aria-label="Agent requests"
      className="fixed top-0 right-0 bottom-0 z-40 w-[420px] max-w-[92vw] flex flex-col bg-bg-secondary border-l border-border shadow-lg font-sans text-text"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <SparkleIcon className="w-3.5 h-3.5 text-accent shrink-0" />
        <span className="text-xs font-medium text-text-secondary uppercase tracking-wider truncate">{AGENT_NAME} requests</span>
        <button
          onClick={closeRequestsPanel}
          className="ml-auto p-1 rounded-md text-text-muted hover:text-text hover:bg-hover cursor-pointer"
          title="Close (Esc)"
          aria-label="Close agent requests"
        >
          <XIcon className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="px-3 py-2.5 border-b border-border">
        <ListenerLine />
      </div>
      <ul className="flex-1 overflow-y-auto p-3 space-y-1.5">
        {requests.length === 0 && <li className="py-10 text-center text-xs text-text-muted">No requests yet</li>}
        {requests.map((request) => <RequestRow key={request.id} request={request} />)}
      </ul>
    </aside>
  );
}

/** The recent requests of the agent and whether it listens, as a drawer on the right. */
export function RequestsPanel() {
  const open = useAgentUi((s) => s.panelOpen);
  return open ? <RequestsDrawer /> : null;
}
