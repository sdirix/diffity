import { useEffect, useReducer } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { queryClient } from '../../lib/query-client';
import { errorMessage } from '../../lib/toast';
import { fetchAgentRequests, postAgentRequest, type AgentRequest, type AgentRequests, type NewRequest } from './agent-api';
import { AGENT_NAME, WATCH_COMMAND, agentState, threadActivity, type AgentState, type ThreadActivity } from './request-state';

export const AGENT_REQUESTS_KEY = ['agent', 'requests'];

const POLL_MS = 2000;
/** How long the agent still counts as listening after it was last seen, while it starts the next wait. */
const LISTEN_GRACE_MS = 15_000;

export const OFFLINE_HINT = `No agent listening. Run ${WATCH_COMMAND} in Claude Code.`;

interface PolledRequests extends AgentRequests {
  /** When this page last saw an agent waiting for a request or working on one. */
  seenAt: number | null;
}

let seenAt: number | null = null;

async function loadRequests(): Promise<PolledRequests> {
  const data = await fetchAgentRequests();
  if (data.listener || data.requests.some((request) => request.status === 'claimed')) {
    seenAt = Date.now();
  }
  return { ...data, seenAt };
}

const EMPTY: PolledRequests = { requests: [], listener: null, seenAt: null };

/** The recent requests and the waiting agents, polled like the threads. */
export function useAgentRequests(): PolledRequests {
  const { data } = useQuery({ queryKey: AGENT_REQUESTS_KEY, queryFn: loadRequests, refetchInterval: POLL_MS });
  return data ?? EMPTY;
}

export interface AgentStatus {
  state: AgentState;
  /** The request the agent works on, the oldest one when it took several. */
  current: AgentRequest | null;
  /** Requests waiting for the agent. */
  queued: number;
  /** When the agent started waiting, while it does. */
  since: string | null;
}

export function useAgentStatus(): AgentStatus {
  const { requests, listener, seenAt: seen } = useAgentRequests();
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const now = Date.now();
  const working = requests.some((request) => request.status === 'claimed');
  const graceLeft = !listener && !working && seen !== null ? seen + LISTEN_GRACE_MS - now : 0;

  // The poll stops changing once the agent is gone, so the grace period ends on a timer.
  useEffect(() => {
    if (graceLeft <= 0) {
      return;
    }
    const timer = setTimeout(rerender, graceLeft + 50);
    return () => clearTimeout(timer);
  }, [graceLeft > 0, seen]);

  const claimed = requests.filter((request) => request.status === 'claimed');
  return {
    state: agentState(requests, listener, seen, now, LISTEN_GRACE_MS),
    current: claimed.at(-1) ?? null,
    queued: requests.filter((request) => request.status === 'queued').length,
    since: listener?.since ?? null,
  };
}

export function useThreadActivity(threadId: string): ThreadActivity {
  return threadActivity(useAgentRequests().requests, threadId);
}

/** Whether an agent waits for requests or works on one, as the last poll saw it. */
function agentReachable(): boolean {
  const data = queryClient.getQueryData<PolledRequests>(AGENT_REQUESTS_KEY);
  if (!data) {
    return true;
  }
  return agentState(data.requests, data.listener, data.seenAt, Date.now(), LISTEN_GRACE_MS) !== 'offline';
}

/** Queues `input` for the agent and confirms it, with a hint when no agent listens. Rejects when the server refuses it. */
export async function queueRequest(input: NewRequest): Promise<AgentRequest> {
  const request = await postAgentRequest(input);
  queryClient.invalidateQueries({ queryKey: AGENT_REQUESTS_KEY });
  toast.success(`Queued for ${AGENT_NAME}`, { description: agentReachable() ? undefined : OFFLINE_HINT });
  return request;
}

/** `queueRequest` that reports a failure as a toast. */
export function queueWithToast(input: NewRequest, failure: string) {
  queueRequest(input).catch((error) => toast.error(failure, { description: errorMessage(error) }));
}
