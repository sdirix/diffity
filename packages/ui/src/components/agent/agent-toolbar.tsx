import { useCallback, useMemo, useState } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { cn } from '../../lib/cn';
import { MOD_KEY, isModPressed } from '../../lib/platform';
import { shortcutHint } from '../../lib/shortcuts';
import { TREE_REF } from '../../lib/thread-location';
import { errorMessage } from '../../lib/toast';
import { usePaletteActions, type PaletteAction } from '../../hooks/use-palette';
import { Kbd } from '../ui/kbd';
import type { CommentThread } from '../comments/types';
import { SendIcon, SparkleIcon } from './agent-icons';
import { AgentPopover } from './agent-popover';
import { openRequestsPanel, requestSend, useAgentUi } from './agent-store';
import { AgentSend } from './agent-send';
import { OfflineHint, StatusDot, statusText } from './agent-status';
import { AGENT_NAME, plural } from './request-state';
import { fieldClass, primaryButtonClass, secondaryButtonClass, toolbarButtonClass } from './styles';
import { OFFLINE_HINT, queueRequest, queueWithToast, useAgentStatus } from './use-agent';

function AgentStatusButton() {
  const status = useAgentStatus();
  const { state, queued } = status;
  const detail = state === 'offline' ? OFFLINE_HINT : `${statusText(status)}.`;

  return (
    <button
      onClick={openRequestsPanel}
      className={cn(toolbarButtonClass, 'max-w-48')}
      title={`${detail} Show requests (${shortcutHint('agent-requests')})`}
      aria-label={`Agent requests, ${statusText(status)}`}
    >
      <StatusDot state={state} />
      <span className="truncate">{state === 'working' ? statusText(status) : AGENT_NAME}</span>
      {queued > 0 && <span className="px-1 rounded bg-accent/15 text-accent tabular-nums">{queued}</span>}
    </button>
  );
}

function ReviewForm(props: { diffRef: string; onClose: () => void }) {
  const { diffRef, onClose } = props;
  const [focus, setFocus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (sending) {
      return;
    }
    setSending(true);
    setError(null);
    try {
      await queueRequest({ mode: 'review', ref: diffRef, focus: focus.trim() || undefined });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
      setSending(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-2.5 w-[360px] p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && isModPressed(e)) {
          e.preventDefault();
          void submit();
        }
      }}
    >
      <div className="flex items-center gap-1.5 text-[13px] font-medium">
        <SparkleIcon className="w-3.5 h-3.5 text-accent" />
        Review with {AGENT_NAME}
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-text-secondary">Focus</span>
        <textarea
          autoFocus
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          rows={3}
          placeholder="Optional, e.g. error handling in the new routes"
          className={fieldClass}
        />
      </label>
      {error && <div className="px-2 py-1.5 rounded-md bg-deleted/10 text-deleted break-words">{error}</div>}
      <OfflineHint />
      <div className="flex items-center justify-end gap-2">
        <button type="button" onClick={onClose} className={secondaryButtonClass}>Cancel</button>
        <button type="submit" disabled={sending} className={primaryButtonClass}>
          Queue review
          <Kbd className="h-4 min-w-0 px-1 text-[10px] bg-transparent border-white/40 text-white/80 shadow-none">{MOD_KEY}+Enter</Kbd>
        </button>
      </div>
    </form>
  );
}

interface AgentToolbarProps {
  diffRef: string;
  /** Whether the diff has files to review. */
  hasChanges: boolean;
  threads: CommentThread[];
}

/** The agent's status, review and summary requests, and the comments to send it. */
export function AgentToolbar(props: AgentToolbarProps) {
  const { diffRef, hasChanges, threads } = props;
  const [reviewOpen, setReviewOpen] = useState(false);
  const sendCount = useAgentUi((s) => s.sendCount);
  const canReview = hasChanges && diffRef !== TREE_REF;

  const openReview = useCallback(() => {
    if (canReview) {
      setReviewOpen(true);
    }
  }, [canReview]);

  const summarize = useCallback(() => {
    queueWithToast({ mode: 'summarize', ref: diffRef }, 'Failed to queue the summary');
  }, [diffRef]);

  const paletteActions = useMemo<PaletteAction[]>(() => {
    const icon = <SparkleIcon className="w-3.5 h-3.5 text-accent" />;
    const list: PaletteAction[] = [];
    if (canReview) {
      list.push(
        { id: 'agent-review', title: `Review with ${AGENT_NAME}`, hint: shortcutHint('agent-review'), keywords: 'agent ai claude comments focus queue', icon, run: openReview },
        { id: 'agent-summarize', title: `Summarize with ${AGENT_NAME}`, keywords: 'agent ai claude summary overview queue', icon, run: summarize },
      );
    }
    if (sendCount !== null) {
      list.push({
        id: 'agent-send',
        title: `Send ${plural(sendCount, 'comment')} to ${AGENT_NAME}`,
        group: 'Comments',
        hint: shortcutHint('agent-send'),
        keywords: 'agent ai claude resolve fix queue',
        icon: <SendIcon className="w-3.5 h-3.5 text-accent" />,
        run: requestSend,
      });
    }
    return list;
  }, [canReview, sendCount, openReview, summarize]);
  usePaletteActions('agent-toolbar', paletteActions);
  useHotkeys('shift+a', openReview, { preventDefault: true, enabled: canReview });
  useHotkeys('shift+c', requestSend, { preventDefault: true, enabled: sendCount !== null });

  return (
    <>
      <AgentStatusButton />
      {canReview && (
        <AgentPopover
          open={reviewOpen}
          onClose={() => setReviewOpen(false)}
          trigger={(
            <button
              onClick={() => setReviewOpen(!reviewOpen)}
              className={cn(toolbarButtonClass, reviewOpen && 'bg-accent/15 text-accent')}
              aria-expanded={reviewOpen}
              title={`${AGENT_NAME} reviews these changes and leaves comments (${shortcutHint('agent-review')})`}
            >
              <SparkleIcon className="w-3.5 h-3.5 text-accent" />
              Review
            </button>
          )}
        >
          <ReviewForm diffRef={diffRef} onClose={() => setReviewOpen(false)} />
        </AgentPopover>
      )}
      <AgentSend diffRef={diffRef} threads={threads} />
    </>
  );
}
