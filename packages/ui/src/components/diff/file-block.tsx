import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DiffHunk } from '@diffity/parser';
import type { DiffFile, DiffLine as DiffLineType } from '@diffity/parser';
import type { CodeHighlighter } from '../../hooks/use-highlighter';
import type { CommentSide, LineSelection } from '../comments/types';
import { type ViewMode, getFilePath, buildChangeGroupPatch, extractLinesFromDiff, extractLinesFromExpandedLines, newFileLineCount } from '../../lib/diff-utils';
import { revertHunk as apiRevertHunk } from '../../lib/api';
import { withToast } from '../../lib/toast';
import { ConfirmDialog } from '../ui/confirm-dialog';
import { computeGaps, createContextLines, getExpandRange, type ExpandableGap } from '../../lib/context-expansion';
import { fileContentOptions, headFileContentOptions } from '../../queries/file';
import { sidesShown } from '../../lib/syntax-lines';
import { useSyntaxMap } from '../../hooks/use-syntax-map';
import type { CommentActions } from '../../hooks/use-comment-actions';
import type { CommentThread } from '../comments/types';
import { GENERAL_THREAD_FILE_PATH, DEFAULT_AUTHOR } from '../comments/types';
import { useLineSelection } from '../../hooks/use-line-selection';
import { useCopy } from '../../hooks/use-copy';
import { CopyIcon } from '../icons/copy-icon';
import { CheckIcon } from '../icons/check-icon';
import { CommentIcon } from '../icons/comment-icon';
import { DiffStats } from './diff-stats';
import { Badge } from '../ui/badge';
import { IconButton } from '../ui/icon-button';
import { StatusBadge } from '../ui/status-badge';
import { HunkWithGap } from './hunk-with-gap';
import { OrphanedThreads } from '../comments/orphaned-threads';
import { FileComments } from '../comments/file-comments';
import { ThreadBadge } from '../ui/thread-badge';
import { buildExpansionSyntaxMap, renderExpansionRows } from './render-expansion-rows';
import { ExpandRow } from './expand-row';
import { EyeIcon } from '../icons/eye-icon';
import { Spinner } from '../icons/spinner';
import { LazySlice } from './lazy-slice';
import { hunkUnits, isPinnedSlice, sliceRowCount } from '../../lib/hunk-slices';
import { SinceViewedBadge, SinceViewedDiff, type SinceViewedInfo } from './since-viewed';
import { isMarkdownFile } from '../../lib/file-types';
import { useViewState } from '../../lib/view-state';
import { cn } from '../../lib/cn';

/** Longer files are highlighted from their hunks only. */
const HIGHLIGHT_MAX_FILE_LINES = 10000;

/** A file waiting for "Load diff". */
export interface HeldBack {
  reason: string;
  rows: number;
  onLoad: () => void;
}

export interface FileBlockProps {
  file: DiffFile;
  viewMode: ViewMode;
  collapsed: boolean;
  onToggleCollapse: (path: string) => void;
  reviewed: boolean;
  /** Set when the file changed after it was marked viewed. */
  sinceViewed?: SinceViewedInfo | null;
  /** Shows only the changes since viewed instead of the diff. */
  showSinceViewed?: boolean;
  onShowSinceViewedChange?: (path: string, show: boolean) => void;
  onReviewedChange: (path: string, reviewed: boolean) => void;
  highlightCode?: CodeHighlighter;
  baseRef?: string;
  theme?: 'light' | 'dark';
  canRevert?: boolean;
  onRevert?: () => void;
  threads: CommentThread[];
  commentsEnabled: boolean;
  commentActions: CommentActions;
  onAddThread: CommentActions['addThread'];
  pendingSelection: LineSelection | null;
  onPendingSelectionChange: (selection: LineSelection | null) => void;
  highlighted?: boolean;
  onHighlightEnd?: () => void;
  heldBack?: HeldBack | null;
  /** The hunks of a `trimmed` file are being fetched or could not be. */
  patchState?: 'loading' | 'error';
  /** Lines kept mounted, like the current find match (`add-12`). */
  pinnedLines?: string[];
}

interface GapExpansion {
  fromTop: number;
  fromBottom: number;
  linesFromTop: DiffLineType[];
  linesFromBottom: DiffLineType[];
}

export function FileBlock(props: FileBlockProps) {
  const {
    file, viewMode, collapsed, onToggleCollapse, reviewed, sinceViewed, showSinceViewed, onShowSinceViewedChange, onReviewedChange, highlightCode, baseRef, theme, canRevert, onRevert,
    threads: allThreads, commentsEnabled, commentActions, onAddThread: rawAddThread, pendingSelection, onPendingSelectionChange,
    highlighted, onHighlightEnd, heldBack, patchState, pinnedLines,
  } = props;

  const sinceViewedOpen = !!showSinceViewed && !!sinceViewed?.canDiff;
  const [expansions, setExpansions] = useState<Map<string, GapExpansion>>(new Map());
  const [loadingGap, setLoadingGap] = useState<{ id: string; direction: 'up' | 'down' | 'all' } | null>(null);

  const filePath = getFilePath(file);
  const showRename = file.status === 'renamed' && file.oldPath !== file.newPath;
  const isNewFile = file.status === 'added';

  const queryClient = useQueryClient();
  const fileContentPath = file.oldPath || filePath;
  const fileLineCount = file.oldFileLineCount ?? null;

  const { copied: pathCopied, copy: copyPath } = useCopy();

  const [confirmRevertChange, setConfirmRevertChange] = useState<{ hunk: DiffHunk; startIndex: number; endIndex: number } | null>(null);

  // A deleted file has no new side to render, so there is nothing to preview.
  const canPreview = isMarkdownFile(filePath) && file.status !== 'deleted';
  // The theme rides along so the new tab matches when it was set by --dark
  // rather than by a toggle, which is what seeds localStorage.
  const previewUrl = `/preview?${new URLSearchParams({
    path: filePath,
    ref: baseRef || 'work',
    ...(theme ? { theme } : {}),
  })}`;

  const handleRevertChange = useCallback(async (info: { hunk: DiffHunk; startIndex: number; endIndex: number }) => {
    setConfirmRevertChange(null);
    const patch = buildChangeGroupPatch(file, info.hunk, info.startIndex, info.endIndex);
    const reverted = await withToast(apiRevertHunk(patch), {
      loading: 'Undoing change…',
      success: 'Change undone',
      error: 'Failed to undo the change',
    });
    if (reverted) {
      onRevert?.();
    }
  }, [file, onRevert]);


  const { addReply, resolveThread, unresolveThread, dismissThread, editComment, deleteComment, deleteThread } = commentActions;

  const allExpandedLines = useMemo(() => {
    const lines: DiffLineType[] = [];
    for (const [, expansion] of expansions) {
      lines.push(...expansion.linesFromTop, ...expansion.linesFromBottom);
    }
    return lines;
  }, [expansions]);

  const getOriginalCode = useCallback((side: CommentSide, startLine: number, endLine: number) => {
    const fromHunks = extractLinesFromDiff(file.hunks, side, startLine, endLine);
    if (fromHunks) {
      return fromHunks;
    }
    return extractLinesFromExpandedLines(allExpandedLines, side, startLine, endLine);
  }, [file.hunks, allExpandedLines]);

  const addThread = useCallback((fp: string, side: CommentSide, startLine: number, endLine: number, body: string, author: import('../comments/types').CommentAuthor) => {
    let anchorContent = extractLinesFromDiff(file.hunks, side, startLine, endLine);
    if (!anchorContent) {
      anchorContent = extractLinesFromExpandedLines(allExpandedLines, side, startLine, endLine);
    }
    rawAddThread(fp, side, startLine, endLine, body, author, anchorContent || undefined);
  }, [rawAddThread, file.hunks, allExpandedLines]);

  const allFileThreads = useMemo(() => {
    return allThreads.filter(t => t.filePath === filePath && t.filePath !== GENERAL_THREAD_FILE_PATH);
  }, [allThreads, filePath]);
  const [showFileForm, setShowFileForm] = useViewState(`diff:${baseRef ?? 'work'}:file-form:${filePath}`, false);

  const { anchoredThreads: fileThreads, orphanedThreads, wholeFileThreads } = useMemo(() => {
    const diffLineNumbers = new Set<string>();
    const addLines = (lines: DiffLineType[]) => {
      for (const line of lines) {
        if (line.oldLineNumber !== null) {
          diffLineNumbers.add(`old:${line.oldLineNumber}`);
        }
        if (line.newLineNumber !== null) {
          diffLineNumbers.add(`new:${line.newLineNumber}`);
        }
      }
    };
    for (const hunk of file.hunks) {
      addLines(hunk.lines);
    }
    addLines(allExpandedLines);

    const anchored: typeof allFileThreads = [];
    const orphaned: typeof allFileThreads = [];
    const wholeFile: typeof allFileThreads = [];
    for (const thread of allFileThreads) {
      if (thread.startLine === 0) {
        wholeFile.push(thread);
        continue;
      }
      if (file.trimmed) {
        continue;
      }
      let isInDiff = false;
      for (let line = thread.startLine; line <= thread.endLine; line++) {
        if (diffLineNumbers.has(`${thread.side}:${line}`)) {
          isInDiff = true;
          break;
        }
      }

      if (isInDiff) {
        anchored.push(thread);
      } else {
        orphaned.push(thread);
      }
    }

    return { anchoredThreads: anchored, orphanedThreads: orphaned, wholeFileThreads: wholeFile };
  }, [allFileThreads, file.hunks, allExpandedLines]);

  const handleSelectionComplete = useCallback((selection: LineSelection) => {
    if (!commentsEnabled) {
      return;
    }
    onPendingSelectionChange(selection);
  }, [onPendingSelectionChange, commentsEnabled]);

  const { isLineInSelection, handleLineMouseDown, handleLineMouseEnter } = useLineSelection({
    filePath,
    onSelectionComplete: handleSelectionComplete,
  });

  const handleCommentClickFn = useCallback((line: number, side: CommentSide) => {
    onPendingSelectionChange({
      filePath,
      side,
      startLine: line,
      endLine: line,
    });
  }, [filePath, onPendingSelectionChange]);

  const handleCommentClick = commentsEnabled ? handleCommentClickFn : undefined;

  const handleCancelPending = useCallback(() => {
    onPendingSelectionChange(null);
  }, [onPendingSelectionChange]);

  const isLineSelected = useCallback((line: number, side: CommentSide) => {
    if (isLineInSelection(line, side)) {
      return true;
    }
    if (pendingSelection && pendingSelection.filePath === filePath && pendingSelection.side === side) {
      return line >= pendingSelection.startLine && line <= pendingSelection.endLine;
    }
    for (const thread of fileThreads) {
      if (thread.side === side && line >= thread.startLine && line <= thread.endLine && thread.status === 'open') {
        return true;
      }
    }
    return false;
  }, [isLineInSelection, pendingSelection, filePath, fileThreads]);


  const rendersLines = !collapsed && !sinceViewedOpen && !heldBack && !patchState && !file.isBinary && file.hunks.length > 0;
  const shownSides = useMemo(() => sidesShown(file.hunks), [file.hunks]);
  const wholeFile = !!highlightCode && rendersLines && file.status !== 'added' && file.status !== 'deleted';
  const fetchOld = wholeFile && shownSides.old && (fileLineCount ?? 0) <= HIGHLIGHT_MAX_FILE_LINES;
  const fetchNew = wholeFile && shownSides.new && newFileLineCount(file) <= HIGHLIGHT_MAX_FILE_LINES;
  const oldContent = useQuery({ ...fileContentOptions(fileContentPath, fetchOld, baseRef), staleTime: Infinity });
  const newContent = useQuery({ ...headFileContentOptions(filePath, baseRef), enabled: fetchNew, staleTime: Infinity });
  const contentSettled = (!fetchOld || !oldContent.isPending) && (!fetchNew || !newContent.isPending);
  const versions = useMemo(
    () => (contentSettled ? { oldLines: oldContent.data ?? null, newLines: newContent.data ?? null } : null),
    [contentSettled, oldContent.data, newContent.data],
  );

  const syntaxMap = useSyntaxMap(highlightCode, rendersLines, file.hunks, versions, HIGHLIGHT_MAX_FILE_LINES);

  const gaps = useMemo(() => {
    if (isNewFile) {
      return [];
    }
    return computeGaps(file.hunks, fileLineCount);
  }, [file.hunks, fileLineCount, isNewFile]);

  const gapMap = useMemo(() => {
    const map = new Map<string, ExpandableGap>();
    for (const gap of gaps) {
      map.set(gap.id, gap);
    }
    return map;
  }, [gaps]);

  const handleExpand = useCallback(async (gap: ExpandableGap, direction: 'up' | 'down' | 'all') => {
    setLoadingGap({ id: gap.id, direction });

    const lines = await queryClient.ensureQueryData(
      fileContentOptions(fileContentPath, true, baseRef)
    );

    setExpansions(prev => {
      const next = new Map(prev);
      const existing = next.get(gap.id) || { fromTop: 0, fromBottom: 0, linesFromTop: [], linesFromBottom: [] };
      const newOffset = gap.newStart - gap.oldStart;
      const range = getExpandRange(gap, direction, existing);

      if (!range) {
        return prev;
      }

      const contextLines = createContextLines(lines, range.oldStart, range.oldEnd, newOffset);

      if (direction === 'all') {
        next.set(gap.id, {
          fromTop: gap.oldEnd - gap.oldStart + 1,
          fromBottom: 0,
          linesFromTop: contextLines,
          linesFromBottom: [],
        });
      } else if (direction === 'down') {
        const newExpansion = {
          ...existing,
          fromTop: existing.fromTop + (range.oldEnd - range.oldStart + 1),
          linesFromTop: [...existing.linesFromTop, ...contextLines],
        };
        next.set(gap.id, newExpansion);
      } else {
        const newExpansion = {
          ...existing,
          fromBottom: existing.fromBottom + (range.oldEnd - range.oldStart + 1),
          linesFromBottom: [...contextLines, ...existing.linesFromBottom],
        };
        next.set(gap.id, newExpansion);
      }

      return next;
    });

    setLoadingGap(null);
  }, [fileContentPath, queryClient, baseRef]);

  const getGapRemaining = useCallback((gap: ExpandableGap): { total: number; up: number; down: number } => {
    const expansion = expansions.get(gap.id);
    if (!expansion) {
      return { total: gap.totalLines, up: gap.totalLines, down: gap.totalLines };
    }
    const total = Math.max(0, gap.totalLines - expansion.fromTop - expansion.fromBottom);
    const up = Math.max(0, gap.totalLines - expansion.fromTop);
    const down = Math.max(0, gap.totalLines - expansion.fromBottom);
    return { total, up, down };
  }, [expansions]);

  const getExpandControlsForHunk = useCallback((hunkIndex: number) => {
    let gap: ExpandableGap | undefined;
    let position: 'top' | 'between' = 'between';

    if (hunkIndex === 0) {
      gap = gapMap.get('top');
      position = 'top';
    } else {
      gap = gapMap.get(`between-${hunkIndex - 1}`);
      position = 'between';
    }

    if (!gap) {
      return undefined;
    }

    const remaining = getGapRemaining(gap);
    const wasExpanded = expansions.has(gap.id);

    return {
      position,
      remainingLines: remaining.total,
      remainingUp: remaining.up,
      remainingDown: remaining.down,
      loadingDirection: loadingGap?.id === gap.id ? loadingGap.direction : null,
      wasExpanded,
      onExpand: (dir: 'up' | 'down' | 'all') => handleExpand(gap, dir),
    };
  }, [gapMap, getGapRemaining, loadingGap, handleExpand, expansions]);

  const total = file.additions + file.deletions;
  const addBlocks = total > 0 ? Math.round((file.additions / total) * Math.min(5, total)) : 0;
  const delBlocks = total > 0 ? Math.min(5, total) - addBlocks : 0;
  const neutralBlocks = 5 - addBlocks - delBlocks;

  const bottomGap = gapMap.get('bottom');
  const bottomRemaining = bottomGap ? getGapRemaining(bottomGap).total : 0;

  const filePendingSelection = pendingSelection && pendingSelection.filePath === filePath ? pendingSelection : null;

  const { sliced, units } = useMemo(() => hunkUnits(file), [file]);
  const pins = useMemo(() => {
    const set = new Set(fileThreads.map((thread) => `${thread.side}:${thread.endLine}`));
    if (filePendingSelection) {
      set.add(`${filePendingSelection.side}:${filePendingSelection.endLine}`);
    }
    return set;
  }, [fileThreads, filePendingSelection]);

  return (
    <div
      className={`border rounded-lg mx-4 my-3 overflow-clip ${highlighted ? 'animate-flash-highlight-border' : 'border-border'}`}
      id={`file-${encodeURIComponent(filePath)}`}
      onAnimationEnd={onHighlightEnd}
    >
      <div
        className={`group flex items-center gap-2 px-3 py-1.5 border-border text-xs sticky top-0 z-10 shadow-sticky ${highlighted ? 'animate-flash-highlight' : 'bg-bg-secondary'}`}
      >
        <IconButton
          className="text-[10px] w-4 h-4 shrink-0"
          onClick={() => onToggleCollapse(filePath)}
          title={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? '\u25b6' : '\u25bc'}
        </IconButton>
        <button
          className="font-mono text-xs truncate text-left cursor-pointer hover:text-accent transition-colors"
          onClick={() => onToggleCollapse(filePath)}
        >
          {showRename ? (
            <>
              <span className="line-through text-text-muted">{file.oldPath}</span>
              <span className="text-text-muted"> → </span>
              <span>{file.newPath}</span>
            </>
          ) : (
            filePath
          )}
        </button>
        <button
          onClick={() => copyPath(filePath, 'Path copied')}
          className="shrink-0 text-text-muted hover:text-text transition-colors cursor-pointer"
          title="Copy file path"
        >
          {pathCopied ? (
            <CheckIcon className="w-3 h-3 text-added" />
          ) : (
            <CopyIcon className="w-3 h-3" />
          )}
        </button>
        {file.status !== 'modified' && <StatusBadge status={file.status} />}
        {file.isBinary && <Badge className="bg-bg-tertiary text-text-muted">Binary</Badge>}
        {collapsed && heldBack && <Badge className="bg-bg-tertiary text-text-muted">{heldBack.reason}</Badge>}
        {sinceViewed && (
          <SinceViewedBadge
            canDiff={sinceViewed.canDiff}
            open={sinceViewedOpen}
            onToggle={() => {
              onShowSinceViewedChange?.(filePath, !sinceViewedOpen);
              if (collapsed) {
                onToggleCollapse(filePath);
              }
            }}
          />
        )}
        <div className="ml-auto flex items-center gap-2.5 shrink-0">
          {commentsEnabled && (
            <button
              onClick={() => {
                setShowFileForm(true);
                if (collapsed) {
                  onToggleCollapse(filePath);
                }
              }}
              className={cn(
                'flex items-center gap-1 text-[11px] text-text-muted hover:text-text transition-colors cursor-pointer',
                allFileThreads.length === 0 && 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
              )}
              title="Comment on this file"
              aria-label="Comment on this file"
            >
              <CommentIcon className="w-3 h-3" />
              {allFileThreads.length > 0 && allFileThreads.length}
            </button>
          )}
          {orphanedThreads.length > 0 && (
            <ThreadBadge variant="outdated" size="sm">
              {orphanedThreads.length} outdated
            </ThreadBadge>
          )}
          {canPreview && (
            <a
              href={previewUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-[11px] text-text-muted hover:text-text transition-colors"
              title="Preview rendered Markdown in a new tab"
            >
              <EyeIcon className="w-3 h-3" />
              Preview
            </a>
          )}
          <div className="flex items-center gap-1.5">
            <DiffStats additions={file.additions} deletions={file.deletions} />
            <div className="flex gap-px">
              {Array.from({ length: addBlocks }).map((_, i) => (
                <span key={`a${i}`} className="w-1.5 h-1.5 rounded-sm bg-diff-added" />
              ))}
              {Array.from({ length: delBlocks }).map((_, i) => (
                <span key={`d${i}`} className="w-1.5 h-1.5 rounded-sm bg-diff-deleted" />
              ))}
              {Array.from({ length: neutralBlocks }).map((_, i) => (
                <span key={`n${i}`} className="w-1.5 h-1.5 rounded-sm bg-border" />
              ))}
            </div>
          </div>
          <label className="flex items-center gap-1.5 text-[11px] text-text-muted cursor-pointer select-none hover:text-text transition-colors">
            <input
              type="checkbox"
              checked={reviewed}
              onChange={() => onReviewedChange(filePath, !reviewed)}
              className="accent-added cursor-pointer w-3 h-3"
            />
            Viewed
          </label>
        </div>
      </div>
      {!collapsed && (
        <div>
          {commentsEnabled && (
            <FileComments
              filePath={filePath}
              threads={wholeFileThreads}
              commentActions={commentActions}
              showForm={showFileForm}
              onCloseForm={() => setShowFileForm(false)}
            />
          )}
          {sinceViewedOpen && sinceViewed ? (
            <SinceViewedDiff
              sessionId={sinceViewed.sessionId}
              filePath={filePath}
              version={sinceViewed.version}
              viewMode={viewMode}
              highlightCode={highlightCode}
              onClose={() => onShowSinceViewedChange?.(filePath, false)}
            />
          ) : file.isBinary ? (
            <div className="p-4 text-center text-text-muted italic">Binary file not shown</div>
          ) : heldBack ? (
            <div className="flex items-center justify-center gap-3 py-6 px-4 text-sm text-text-muted">
              <span>{heldBack.reason} · {heldBack.rows.toLocaleString()} line{heldBack.rows === 1 ? '' : 's'} not rendered</span>
              <button
                className="text-accent hover:underline cursor-pointer font-medium"
                onClick={heldBack.onLoad}
              >
                Load diff
              </button>
            </div>
          ) : patchState === 'loading' ? (
            <div className="flex items-center justify-center gap-2 py-6 px-4 text-sm text-text-muted">
              <Spinner className="w-3.5 h-3.5" />
              Loading diff…
            </div>
          ) : patchState === 'error' ? (
            <div className="p-4 text-center text-text-muted italic">Failed to load the diff</div>
          ) : file.hunks.length === 0 ? (
            <div className="p-4 text-center text-text-muted italic">
              {file.oldMode && file.newMode
                ? `File mode changed from ${file.oldMode} to ${file.newMode}`
                : 'No content changes'}
            </div>
          ) : (
            <>
            <OrphanedThreads threads={orphanedThreads} commentActions={commentActions} />
            <table className="w-full border-collapse table-fixed" data-find-scope={filePath}>
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
              {units.map(({ hunk, index: i, first, key }) => {
                const betweenGap = first && i > 0 ? gapMap.get(`between-${i - 1}`) : undefined;
                const betweenExpansion = betweenGap ? expansions.get(betweenGap.id) : undefined;
                const topExpansion = first && i === 0 ? expansions.get('top') : undefined;

                const block = (
                  <HunkWithGap
                    key={key}
                    hunk={hunk}
                    viewMode={viewMode}
                    syntaxMap={syntaxMap}
                    expandControls={first ? getExpandControlsForHunk(i) : undefined}
                    topExpansionLines={first && i === 0 ? [...(topExpansion?.linesFromTop ?? []), ...(topExpansion?.linesFromBottom ?? [])] : undefined}
                    gapExpansion={betweenExpansion}
                    gapId={betweenGap?.id}
                    highlightCode={highlightCode}
                    threads={fileThreads}
                    pendingSelection={filePendingSelection}
                    currentAuthor={DEFAULT_AUTHOR}
                    isLineSelected={isLineSelected}
                    onLineMouseDown={handleLineMouseDown}
                    onLineMouseEnter={handleLineMouseEnter}
                    onCommentClick={handleCommentClick}
                    onAddThread={addThread}
                    onReply={addReply}
                    onResolve={resolveThread}
                    onUnresolve={unresolveThread}
                    onEditComment={editComment}
                    onDeleteComment={deleteComment}
                    onDeleteThread={deleteThread}
                    onCancelPending={handleCancelPending}
                    filePath={filePath}
                    onRevertChange={canRevert ? (h: DiffHunk, startIndex: number, endIndex: number) => setConfirmRevertChange({ hunk: h, startIndex, endIndex }) : undefined}
                    getOriginalCode={getOriginalCode}
                  />
                );
                return sliced ? (
                  <LazySlice key={`${viewMode}:${key}`} rows={sliceRowCount(hunk.lines, viewMode === 'split') + (first ? 1 : 0)} pinned={isPinnedSlice(hunk.lines, pins, pinnedLines)}>
                    {block}
                  </LazySlice>
                ) : block;
              })}
              {bottomGap && (() => {
                const bottomExpansion = expansions.get('bottom');
                const bottomLines = [
                  ...(bottomExpansion?.linesFromTop ?? []),
                  ...(bottomExpansion?.linesFromBottom ?? []),
                ];
                const bottomSyntaxMap = buildExpansionSyntaxMap(bottomLines, syntaxMap, highlightCode);
                const bottomCommentProps = {
                  isLineSelected, onLineMouseDown: handleLineMouseDown, onLineMouseEnter: handleLineMouseEnter,
                  onCommentClick: handleCommentClick, threads: fileThreads, pendingSelection: filePendingSelection,
                  currentAuthor: DEFAULT_AUTHOR, onAddThread: addThread, onReply: addReply,
                  onResolve: resolveThread, onUnresolve: unresolveThread, onEditComment: editComment, onDeleteComment: deleteComment,
                  onDeleteThread: deleteThread, onCancelPending: handleCancelPending, filePath,
                  getOriginalCode,
                };
                return (
                  <tbody>
                    {bottomExpansion?.linesFromTop && bottomExpansion.linesFromTop.length > 0 &&
                      renderExpansionRows(bottomExpansion.linesFromTop, viewMode, 'bottom-top', bottomSyntaxMap, bottomCommentProps)}
                    <ExpandRow
                      position="bottom"
                      remainingLines={bottomRemaining}
                      loading={loadingGap?.id === 'bottom'}
                      onExpand={(dir) => handleExpand(bottomGap, dir)}
                    />
                    {bottomExpansion?.linesFromBottom && bottomExpansion.linesFromBottom.length > 0 &&
                      renderExpansionRows(bottomExpansion.linesFromBottom, viewMode, 'bottom-bot', bottomSyntaxMap, bottomCommentProps)}
                  </tbody>
                );
              })()}
            </table>
            </>
          )}
        </div>
      )}
      {confirmRevertChange && (
        <ConfirmDialog
          title="Undo change"
          message="This will undo the selected change. This cannot be undone."
          onConfirm={() => handleRevertChange(confirmRevertChange)}
          onCancel={() => setConfirmRevertChange(null)}
        />
      )}
    </div>
  );
}
