import { useSyncExternalStore } from 'react';

interface AgentUiState {
  /** Whether the requests panel shows. */
  panelOpen: boolean;
  /** The comments the diff toolbar would send, `null` while it offers none. */
  sendCount: number | null;
  /** Counts the requests to open the send picker. */
  sendRequest: number;
}

let state: AgentUiState = { panelOpen: false, sendCount: null, sendRequest: 0 };
const listeners = new Set<() => void>();

function setState(next: Partial<AgentUiState>) {
  state = { ...state, ...next };
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useAgentUi<T>(select: (state: AgentUiState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state), () => select(state));
}

export function setSendCount(sendCount: number | null) {
  if (state.sendCount !== sendCount) {
    setState({ sendCount });
  }
}

/** Opens the send picker of the diff toolbar. */
export function requestSend() {
  setState({ sendRequest: state.sendRequest + 1 });
}

export function openRequestsPanel() {
  setState({ panelOpen: true });
}

export function closeRequestsPanel() {
  setState({ panelOpen: false });
}

export function toggleRequestsPanel() {
  setState({ panelOpen: !state.panelOpen });
}
