import { useQuery } from '@tanstack/react-query';
import type { DiffHunk } from '@diffity/parser';
import type { CodeHighlighter } from '../../hooks/use-highlighter';
import { useSyntaxMap } from '../../hooks/use-syntax-map';
import { fetchViewedChanges } from '../../lib/api';
import { cn } from '../../lib/cn';
import type { ViewMode } from '../../lib/diff-utils';
import { errorMessage } from '../../lib/toast';
import { Spinner } from '../icons/spinner';
import { DiffStats } from './diff-stats';
import { HunkBlock } from './hunk-block';
import { HunkBlockSplit } from './hunk-block-split';

export interface SinceViewedInfo {
  sessionId: string;
  /** The viewed version was kept, so the changes since can be shown. */
  canDiff: boolean;
  /** Changes with either version, so the comparison is fetched again. */
  version: string;
}

const NO_HUNKS: DiffHunk[] = [];
const badgeClass = 'shrink-0 rounded-full px-1.5 text-[11px] font-medium leading-4 text-modified';

interface SinceViewedBadgeProps {
  canDiff: boolean;
  open: boolean;
  onToggle: () => void;
}

export function SinceViewedBadge(props: SinceViewedBadgeProps) {
  const { canDiff, open, onToggle } = props;

  if (!canDiff) {
    return (
      <span className={cn(badgeClass, 'bg-modified/12')} title="The file changed after it was marked viewed. Its viewed version was not kept.">
        Changed since viewed
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(badgeClass, 'cursor-pointer transition-colors', open ? 'bg-modified/25' : 'bg-modified/12 hover:bg-modified/20')}
      title={open ? 'Show the full diff' : 'Show only the changes since viewed'}
      aria-pressed={open}
    >
      Changed since viewed
    </button>
  );
}

interface SinceViewedDiffProps {
  sessionId: string;
  filePath: string;
  version: string;
  viewMode: ViewMode;
  highlightCode?: CodeHighlighter;
  onClose: () => void;
}

/** What changed in a file between the version marked viewed and now, shown instead of its diff. */
export function SinceViewedDiff(props: SinceViewedDiffProps) {
  const { sessionId, filePath, version, viewMode, highlightCode, onClose } = props;
  const { data: file, error, isPending } = useQuery({
    queryKey: ['viewed-changes', sessionId, filePath, version],
    queryFn: () => fetchViewedChanges(sessionId, filePath),
    staleTime: Infinity,
  });
  const hunks = file?.hunks ?? NO_HUNKS;
  const syntaxMap = useSyntaxMap(highlightCode, hunks.length > 0, hunks, null, 0);
  const HunkComponent = viewMode === 'split' ? HunkBlockSplit : HunkBlock;

  const renderBody = () => {
    if (isPending) {
      return (
        <div className="flex items-center justify-center gap-2 p-4 text-xs text-text-muted">
          <Spinner />
          Loading changes…
        </div>
      );
    }
    if (error) {
      return <div className="p-4 text-center text-text-muted italic">{errorMessage(error)}</div>;
    }
    if (hunks.length === 0) {
      return <div className="p-4 text-center text-text-muted italic">No changes since viewed</div>;
    }
    return (
      <table className="w-full border-collapse table-fixed">
        {viewMode === 'split' ? (
          <colgroup>
            <col className="w-12.5" />
            <col className="w-[calc(50%-50px)]" />
            <col className="w-12.5" />
            <col />
          </colgroup>
        ) : (
          <colgroup>
            <col className="w-12.5" />
            <col className="w-12.5" />
            <col className="w-5" />
            <col />
          </colgroup>
        )}
        {hunks.map((hunk, i) => (
          <HunkComponent key={i} hunk={hunk} syntaxMap={syntaxMap} filePath={filePath} />
        ))}
      </table>
    );
  };

  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border-muted bg-modified/8 text-xs">
        <span className="font-medium text-modified">Changes since viewed</span>
        {file && <DiffStats additions={file.additions} deletions={file.deletions} />}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto text-[11px] text-text-muted hover:text-text transition-colors cursor-pointer"
        >
          Show full diff
        </button>
      </div>
      {renderBody()}
    </div>
  );
}
