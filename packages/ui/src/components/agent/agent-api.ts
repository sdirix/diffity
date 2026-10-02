export type RequestMode = 'review' | 'resolve' | 'thread' | 'summarize';
export type RequestStatus = 'queued' | 'claimed' | 'done' | 'cancelled';

/** A request for the user's own agent, which takes it with `diffity agent wait`. */
export interface AgentRequest {
  id: string;
  sessionId: string;
  ref: string;
  mode: RequestMode;
  /** `mention` when a comment mentioning the agent queued it. */
  trigger: 'user' | 'mention';
  threadIds: string[];
  note: string | null;
  focus: string | null;
  paths: string[];
  status: RequestStatus;
  progress: string | null;
  result: string | null;
  createdAt: string;
  claimedAt: string | null;
  progressAt: string | null;
  doneAt: string | null;
}

/** The agents waiting for requests right now. */
export interface ListenerStatus {
  since: string;
  seenAt: string;
  count: number;
}

export interface AgentRequests {
  requests: AgentRequest[];
  listener: ListenerStatus | null;
}

export interface NewRequest {
  mode: RequestMode;
  ref?: string;
  threadIds?: string[];
  note?: string;
  focus?: string;
  paths?: string[];
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(json?.error || `HTTP ${res.status}`);
  }
  return json as T;
}

function post<T>(url: string, body: unknown): Promise<T> {
  return request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

export function fetchAgentRequests(): Promise<AgentRequests> {
  return request('/api/agent/requests');
}

export function postAgentRequest(input: NewRequest): Promise<AgentRequest> {
  return post('/api/agent/requests', input);
}

export function cancelAgentRequest(id: string): Promise<AgentRequest> {
  return post(`/api/agent/requests/${encodeURIComponent(id)}/cancel`, {});
}
