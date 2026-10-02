import { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useHotkeys } from 'react-hotkeys-hook';
import { toast } from 'sonner';
import { queryClient } from '../../lib/query-client';
import { shortcutHint } from '../../lib/shortcuts';
import { TREE_REF } from '../../lib/thread-location';
import { usePaletteActions, type PaletteAction } from '../../hooks/use-palette';
import { useNavigateToRef } from '../layout/ref-menu';
import type { AgentRequest } from './agent-api';
import { SparkleIcon } from './agent-icons';
import { toggleRequestsPanel, useAgentUi } from './agent-store';
import { RequestsPanel } from './requests-panel';
import { AGENT_NAME, endedSince, isExpired, requestTitle } from './request-state';
import { useAgentRequests } from './use-agent';

/** Announces the requests that end while the page is open, and reloads the comments they changed. */
function useRequestOutcomes() {
  const { requests } = useAgentRequests();
  const previous = useRef<Map<string, AgentRequest['status']> | null>(null);
  const progress = useRef(new Map<string, string | null>());
  const navigate = useNavigate();
  const navigateToRef = useNavigateToRef();

  useEffect(() => {
    const before = previous.current;
    previous.current = new Map(requests.map((request) => [request.id, request.status]));
    const progressed = requests.some((request) => progress.current.has(request.id) && progress.current.get(request.id) !== request.progress);
    progress.current = new Map(requests.map((request) => [request.id, request.progress]));
    if (!before) {
      return;
    }
    const ended = endedSince(before, requests);
    if (ended.length > 0 || progressed) {
      queryClient.invalidateQueries({ queryKey: ['threads'] });
      queryClient.invalidateQueries({ queryKey: ['repo-threads'] });
    }
    for (const request of ended) {
      const threadId = request.threadIds[0];
      const show = () => (request.ref === TREE_REF ? navigate('/tree') : navigateToRef(request.ref, { thread: threadId }));
      const action = threadId ? { label: 'Show', onClick: show } : undefined;
      if (request.status === 'done') {
        toast.success(`${AGENT_NAME} finished: ${requestTitle(request)}`, { description: request.result ?? undefined, action });
      } else if (isExpired(request)) {
        toast.info(`${requestTitle(request)} expired`, { description: request.result ?? undefined, action });
      }
    }
  }, [requests, navigate, navigateToRef]);
}

/** Follows the agent's requests on every page: the requests panel, its shortcut and the outcome toasts. */
export function AgentLayer() {
  const open = useAgentUi((s) => s.panelOpen);
  useRequestOutcomes();
  useHotkeys('a', toggleRequestsPanel, { preventDefault: true });

  const paletteActions = useMemo<PaletteAction[]>(() => [{
    id: 'agent-requests',
    title: `${open ? 'Hide' : 'Show'} ${AGENT_NAME} requests`,
    hint: shortcutHint('agent-requests'),
    keywords: 'agent ai claude queue listening watch progress',
    icon: <SparkleIcon className="w-3.5 h-3.5 text-accent" />,
    run: toggleRequestsPanel,
  }], [open]);
  usePaletteActions('agent-requests', paletteActions);

  return <RequestsPanel />;
}
