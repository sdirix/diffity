import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useLoaderData } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { ParsedDiff } from '@diffity/parser';
import { useDiff } from '../../hooks/use-diff';
import { useInfo } from '../../hooks/use-info';
import { useTheme } from '../../hooks/use-theme';
import { useKeyboard } from '../../hooks/use-keyboard';
import { usePaletteActions, usePaletteView, type PaletteAction, type PaletteView } from '../../hooks/use-palette';
import { useReviewThreads } from '../../hooks/use-review-threads';
import { useCommentActions } from '../../hooks/use-comment-actions';
import { Toolbar } from '../layout/toolbar';
import { DiffView, type DiffViewHandle } from './diff-view';
import { Sidebar } from '../layout/sidebar';
import { ShortcutModal } from '../layout/shortcut-modal';
import { StaleDiffBanner } from '../layout/stale-diff-banner';
import { FindBar } from './find-bar';
import { CheckCircleIcon } from '../icons/check-circle-icon';
import { CheckIcon } from '../icons/check-icon';
import { ArrowDownIcon } from '../icons/arrow-down-icon';
import { ArrowUpIcon } from '../icons/arrow-up-icon';
import { ChevronDownIcon } from '../icons/chevron-down-icon';
import { ChevronUpIcon } from '../icons/chevron-up-icon';
import { CollapseAllIcon } from '../icons/collapse-all-icon';
import { ExpandAllIcon } from '../icons/expand-all-icon';
import { CommentIcon } from '../icons/comment-icon';
import { EyeIcon } from '../icons/eye-icon';
import { EyeOffIcon } from '../icons/eye-off-icon';
import { GitCompareIcon } from '../icons/git-compare-icon';
import { KeyboardIcon } from '../icons/keyboard-icon';
import { ContrastIcon } from '../icons/contrast-icon';
import { MoonIcon } from '../icons/moon-icon';
import { SearchIcon } from '../icons/search-icon';
import { SplitViewIcon } from '../icons/split-view-icon';
import { SunIcon } from '../icons/sun-icon';
import { UnifiedViewIcon } from '../icons/unified-view-icon';
import { RefreshIcon } from '../icons/refresh-icon';
import { DiffSkeleton } from '../layout/skeleton';
import { useRevealClass } from '../ui/skeleton';
import { useDiffStaleness } from '../../hooks/use-diff-staleness';
import { cn } from '../../lib/cn';
import { type ViewMode, getFilePath, getAutoCollapsedPaths } from '../../lib/diff-utils';
import { buildFirstOpenThreadByFile, buildThreadCountsByFile } from '../../lib/comment-navigation';
import { getHunkHeaders, scrollToElement } from '../../lib/dom-utils';
import { fetchGitHubDetails, type GitHubDetails } from '../../lib/api';
import { readViewState, useViewState, writeViewState } from '../../lib/view-state';
import { shortcutHint } from '../../lib/shortcuts';
import { setDiffPalette, useDiffPalette } from '../../lib/diff-palette';
import type { FindMatch } from '../../lib/find';
import type { CommentThread, LineSelection } from '../comments/types';
import { isThreadResolved } from '../comments/types';

const NO_THREADS: CommentThread[] = [];
const iconClass = 'w-3.5 h-3.5';

function focusFileFilter() {
  const input = document.querySelector(
    'input[placeholder="Filter files..."]',
  ) as HTMLInputElement;
  if (input) {
    input.focus();
  }
}

interface SavedReview {
  diff: WeakRef<ParsedDiff> | null;
  activeFile: string | null;
  reviewedFiles: Set<string>;
  collapsedFiles: Set<string>;
  manuallyToggled: Set<string>;
}

export function DiffPage() {
  const { ref: refParam, theme: initialTheme, view: initialViewMode } = useLoaderData<{
    ref: string;
    theme: 'light' | 'dark' | null;
    view: 'split' | 'unified' | null;
  }>();

  const [viewMode, setViewMode] = useViewState<ViewMode>('diff:view-mode', initialViewMode || 'split');
  const [hideWhitespace, setHideWhitespace] = useViewState('diff:hide-whitespace', false);
  const [showHelp, setShowHelp] = useState(false);
  const [refMenuOpen, setRefMenuOpen] = useState(false);
  const { theme, toggleTheme } = useTheme(initialTheme);
  const diffPalette = useDiffPalette();
  const { data: diff, error } = useDiff(hideWhitespace, refParam);
  const { data: info } = useInfo(refParam);
  const reviewKey = `diff:${refParam}:review`;
  const [saved] = useState(() => readViewState<SavedReview | null>(reviewKey, null));
  const [activeFile, setActiveFile] = useState<string | null>(saved?.activeFile ?? null);
  const [reviewedFiles, setReviewedFiles] = useState<Set<string>>(saved?.reviewedFiles ?? new Set());
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(saved?.collapsedFiles ?? new Set());
  const manuallyToggledRef = useRef<Set<string>>(saved?.manuallyToggled ?? new Set());
  const [pendingSelection, setPendingSelection] = useState<LineSelection | null>(null);
  const [findFile, setFindFile] = useState<string | null>(null);
  const [findRequest, setFindRequest] = useState(0);
  const [generalCommentRequest, setGeneralCommentRequest] = useState(0);
  const mainRef = useRef<HTMLElement | null>(null);
  const diffViewRef = useRef<DiffViewHandle>(null);
  const currentFileIdx = useRef(0);
  const initializedDiffRef = useRef<ParsedDiff | null>(saved?.diff?.deref() ?? null);

  const reviewsEnabled = !!info?.capabilities?.reviews;
  const sessionId = info?.sessionId ?? null;
  const canRevert = !!info?.capabilities?.revert;
  const { isStale, resetStaleness } = useDiffStaleness(diff.fingerprint, refParam, !!info?.capabilities?.staleness);
  const [githubDetails, setGithubDetails] = useState<GitHubDetails | null>(null);

  useEffect(() => {
    if (!info?.github) {
      return;
    }
    fetchGitHubDetails()
      .then(data => setGithubDetails(data))
      .catch(() => {});
  }, [info?.github]);

  const { data: serverThreads, isFetched: threadsFetched } = useReviewThreads(reviewsEnabled ? sessionId : null);
  const threads = reviewsEnabled && serverThreads ? serverThreads : NO_THREADS;
  const commentActions = useCommentActions(sessionId, reviewsEnabled);
  const commentCountsByFile = useMemo(() => buildThreadCountsByFile(threads), [threads]);

  const filesWithComments = useMemo(() => {
    return new Set(commentCountsByFile.keys());
  }, [commentCountsByFile]);

  const firstOpenThreadByFile = useMemo(() => {
    const fileOrder = diff?.files.map(file => getFilePath(file)) ?? [];
    return buildFirstOpenThreadByFile(threads, fileOrder);
  }, [diff, threads]);

  const handleAddThread = useCallback((...args: Parameters<typeof commentActions.addThread>) => {
    commentActions.addThread(...args);
    setPendingSelection(null);
  }, [commentActions]);

  useEffect(() => {
    if (!diff || diff === initializedDiffRef.current) {
      return;
    }
    initializedDiffRef.current = diff;

    const autoCollapsed = getAutoCollapsedPaths(diff.files);
    for (const path of filesWithComments) {
      autoCollapsed.delete(path);
    }
    for (const path of manuallyToggledRef.current) {
      if (autoCollapsed.has(path)) {
        autoCollapsed.delete(path);
      } else {
        autoCollapsed.add(path);
      }
    }
    setCollapsedFiles(autoCollapsed);
  }, [diff]);

  useEffect(() => {
    writeViewState(reviewKey, {
      diff: initializedDiffRef.current && new WeakRef(initializedDiffRef.current),
      activeFile,
      reviewedFiles,
      collapsedFiles,
      manuallyToggled: manuallyToggledRef.current,
    } satisfies SavedReview);
  }, [reviewKey, activeFile, reviewedFiles, collapsedFiles]);

  useEffect(() => {
    if (filesWithComments.size === 0) {
      return;
    }
    setCollapsedFiles((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const path of filesWithComments) {
        if (next.has(path)) {
          next.delete(path);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [filesWithComments]);

  const handleToggleCollapse = useCallback((path: string) => {
    const toggled = manuallyToggledRef.current;
    if (toggled.has(path)) {
      toggled.delete(path);
    } else {
      toggled.add(path);
    }
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const handleReviewedChange = useCallback((path: string, reviewed: boolean) => {
    setReviewedFiles((prev) => {
      const next = new Set(prev);
      if (reviewed) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
    if (reviewed) {
      setCollapsedFiles((prev) => {
        const next = new Set(prev);
        next.add(path);
        return next;
      });
    } else {
      setCollapsedFiles((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, []);

  const setAllCollapsed = useCallback((collapsed: boolean) => {
    if (!diff) {
      return;
    }
    manuallyToggledRef.current = new Set();
    setCollapsedFiles(collapsed ? new Set(diff.files.map((f) => getFilePath(f))) : new Set());
  }, [diff]);

  const setAllReviewed = useCallback((reviewed: boolean) => {
    if (!diff) {
      return;
    }
    const paths = diff.files.map((f) => getFilePath(f));
    setReviewedFiles(reviewed ? new Set(paths) : new Set());
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      for (const path of paths) {
        if (reviewed) {
          next.add(path);
        } else if (reviewedFiles.has(path)) {
          next.delete(path);
        }
      }
      return next;
    });
  }, [diff, reviewedFiles]);

  const getCurrentFilePath = useCallback((): string | null => {
    if (!diff) {
      return null;
    }
    return getFilePath(diff.files[currentFileIdx.current]);
  }, [diff]);

  const navigateFile = useCallback((direction: number) => {
    if (!diff) {
      return;
    }
    const nextIdx = Math.max(0, Math.min(diff.files.length - 1, currentFileIdx.current + direction));
    currentFileIdx.current = nextIdx;
    const path = getFilePath(diff.files[nextIdx]);
    diffViewRef.current?.scrollToFile(path);
  }, [diff]);

  const navigateHunk = useCallback((direction: number) => {
    const hunks = getHunkHeaders();
    if (hunks.length === 0) {
      return;
    }
    let target = direction > 0 ? hunks[0] : hunks[hunks.length - 1];

    for (let i = 0; i < hunks.length; i++) {
      const rect = hunks[i].getBoundingClientRect();
      if (direction > 0 && rect.top > 100) {
        target = hunks[i];
        break;
      }
      if (direction < 0 && rect.top < -10) {
        target = hunks[i];
      }
    }

    scrollToElement(target);
  }, []);

  useKeyboard({
    onNextFile: () => navigateFile(1),
    onPrevFile: () => navigateFile(-1),
    onNextHunk: () => navigateHunk(1),
    onPrevHunk: () => navigateHunk(-1),
    onToggleCollapse: () => {
      const path = getCurrentFilePath();
      if (path) {
        handleToggleCollapse(path);
      }
    },
    onCollapseAll: () => {
      if (!diff) {
        return;
      }
      setAllCollapsed(diff.files.some((f) => !collapsedFiles.has(getFilePath(f))));
    },
    onToggleReviewed: () => {
      const path = getCurrentFilePath();
      if (!path) {
        return;
      }
      const wasReviewed = reviewedFiles.has(path);
      handleReviewedChange(path, !wasReviewed);
      if (!wasReviewed) {
        navigateFile(1);
      }
    },
    onUnifiedView: () => setViewMode('unified'),
    onSplitView: () => setViewMode('split'),
    onShowHelp: () => setShowHelp(true),
    onOpenRefMenu: () => setRefMenuOpen(true),
    onFocusSearch: focusFileFilter,
    onEscape: () => setShowHelp(false),
  });

  const queryClient = useQueryClient();

  const handleRevert = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['diff'] });
    queryClient.invalidateQueries({ queryKey: ['file-content'] });
  }, [queryClient]);

  const handleRefreshDiff = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['diff'] });
    queryClient.invalidateQueries({ queryKey: ['file-content'] });
    queryClient.invalidateQueries({ queryKey: ['repo-info'] });
    queryClient.invalidateQueries({ queryKey: ['status'] });
    resetStaleness();
  }, [queryClient, resetStaleness]);

  const handleSidebarFileClick = useCallback((path: string) => {
    setActiveFile(path);
    diffViewRef.current?.scrollToFile(path);
  }, []);

  const handleScrollToThread = useCallback((threadId: string, filePath: string) => {
    setActiveFile(filePath);
    setCollapsedFiles((prev) => {
      if (!prev.has(filePath)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(filePath);
      return next;
    });
    diffViewRef.current?.scrollToThread(threadId, filePath);
  }, []);

  const handleSidebarCommentedFileClick = useCallback((path: string) => {
    const threadId = firstOpenThreadByFile.get(path);
    if (!threadId) {
      handleSidebarFileClick(path);
      return;
    }
    handleScrollToThread(threadId, path);
  }, [firstOpenThreadByFile, handleSidebarFileClick, handleScrollToThread]);

  const handleActiveFileFromScroll = useCallback((path: string) => {
    setActiveFile(path);
  }, []);

  const handleFindReveal = useCallback((match: FindMatch) => {
    setFindFile(match.scope);
    setCollapsedFiles((prev) => {
      if (!prev.has(match.scope)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(match.scope);
      return next;
    });
    diffViewRef.current?.scrollToLine(match.scope, match.key);
  }, []);

  const handleFindClose = useCallback(() => setFindFile(null), []);

  const handleRevealFile = useCallback((path: string) => {
    const index = diff?.files.findIndex((f) => getFilePath(f) === path) ?? -1;
    if (index >= 0) {
      currentFileIdx.current = index;
    }
    setCollapsedFiles((prev) => {
      if (!prev.has(path)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(path);
      return next;
    });
    handleSidebarFileClick(path);
  }, [diff, handleSidebarFileClick]);

  const paletteView = useMemo<PaletteView | null>(() => {
    if (!diff || !info) {
      return null;
    }
    return {
      repo: info.root,
      filesLabel: 'Changed files',
      files: diff.files.map((file) => {
        const path = getFilePath(file);
        return {
          path,
          additions: file.additions,
          deletions: file.deletions,
          comments: commentCountsByFile.get(path),
          viewed: reviewedFiles.has(path),
        };
      }),
      openFile: handleRevealFile,
      threads,
      openThread: handleScrollToThread,
      editor: !!info.editor,
    };
  }, [diff, info, commentCountsByFile, reviewedFiles, handleRevealFile, threads, handleScrollToThread]);
  usePaletteView(paletteView);

  const paletteActions = useMemo<PaletteAction[]>(() => {
    const paths = diff?.files.map((f) => getFilePath(f)) ?? [];
    const hasFiles = paths.length > 0;
    const anyExpanded = paths.some((path) => !collapsedFiles.has(path));
    const list: PaletteAction[] = [];
    if (hasFiles) {
      list.push(
        { id: 'find', title: 'Find in diff', hint: shortcutHint('find'), keywords: 'search text', icon: <SearchIcon className={iconClass} />, run: () => setFindRequest((n) => n + 1) },
        { id: 'filter-files', title: 'Filter files', hint: shortcutHint('filter-files'), keywords: 'sidebar search', icon: <SearchIcon className={iconClass} />, run: focusFileFilter },
      );
      if (!paths.every((path) => reviewedFiles.has(path))) {
        list.push({ id: 'mark-all-viewed', title: 'Mark all files as viewed', keywords: 'reviewed', icon: <CheckIcon className={iconClass} />, run: () => setAllReviewed(true) });
      }
      if (paths.some((path) => reviewedFiles.has(path))) {
        list.push({ id: 'unmark-all-viewed', title: 'Mark all files as not viewed', keywords: 'reviewed unviewed', icon: <CheckIcon className={iconClass} />, run: () => setAllReviewed(false) });
      }
      if (reviewsEnabled) {
        list.push({ id: 'general-comment', title: 'Add general comment', group: 'Comments', keywords: 'review note', icon: <CommentIcon className={iconClass} />, run: () => setGeneralCommentRequest((n) => n + 1) });
      }
    }
    list.push(
      { id: 'reload', title: 'Reload diff', keywords: 'refresh', icon: <RefreshIcon className={iconClass} />, run: handleRefreshDiff },
      { id: 'shortcuts', title: 'Keyboard shortcuts', hint: shortcutHint('shortcuts'), keywords: 'help keys', icon: <KeyboardIcon className={iconClass} />, run: () => setShowHelp(true) },
      viewMode === 'split'
        ? { id: 'view-unified', title: 'Unified view', group: 'View', hint: shortcutHint('view-unified'), icon: <UnifiedViewIcon className={iconClass} />, run: () => setViewMode('unified') }
        : { id: 'view-split', title: 'Split view', group: 'View', hint: shortcutHint('view-split'), icon: <SplitViewIcon className={iconClass} />, run: () => setViewMode('split') },
      {
        id: 'whitespace',
        title: hideWhitespace ? 'Show whitespace changes' : 'Hide whitespace changes',
        group: 'View',
        icon: hideWhitespace ? <EyeIcon className={iconClass} /> : <EyeOffIcon className={iconClass} />,
        run: () => setHideWhitespace(!hideWhitespace),
      },
      {
        id: 'theme',
        title: theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme',
        group: 'View',
        keywords: 'dark light mode appearance',
        icon: theme === 'dark' ? <SunIcon className={iconClass} /> : <MoonIcon className={iconClass} />,
        run: toggleTheme,
      },
      {
        id: 'diff-palette',
        title: diffPalette === 'colorblind' ? 'Use default diff colours' : 'Use colour-blind diff colours',
        group: 'View',
        keywords: 'color colour blind accessibility blue orange green red',
        icon: <ContrastIcon className={iconClass} />,
        run: () => setDiffPalette(diffPalette === 'colorblind' ? 'default' : 'colorblind'),
      },
    );
    if (hasFiles) {
      list.push(
        { id: 'collapse-all-files', title: 'Collapse all files', group: 'View', hint: anyExpanded ? shortcutHint('collapse-all') : undefined, icon: <CollapseAllIcon className={iconClass} />, run: () => setAllCollapsed(true) },
        { id: 'expand-all-files', title: 'Expand all files', group: 'View', hint: anyExpanded ? undefined : shortcutHint('collapse-all'), icon: <ExpandAllIcon className={iconClass} />, run: () => setAllCollapsed(false) },
      );
    }
    list.push({
      id: 'ref-menu',
      title: 'Choose what to review',
      group: 'Go to',
      hint: shortcutHint('ref-menu'),
      keywords: 'ref branch commit range compare',
      icon: <GitCompareIcon className={iconClass} />,
      run: () => setRefMenuOpen(true),
    });
    if (hasFiles) {
      list.push(
        { id: 'file-next', title: 'Next file', group: 'Go to', hint: shortcutHint('file-next'), icon: <ArrowDownIcon />, run: () => navigateFile(1) },
        { id: 'file-prev', title: 'Previous file', group: 'Go to', hint: shortcutHint('file-prev'), icon: <ArrowUpIcon />, run: () => navigateFile(-1) },
        { id: 'hunk-next', title: 'Next changed hunk', group: 'Go to', hint: shortcutHint('hunk-next'), icon: <ChevronDownIcon className={iconClass} />, run: () => navigateHunk(1) },
        { id: 'hunk-prev', title: 'Previous changed hunk', group: 'Go to', hint: shortcutHint('hunk-prev'), icon: <ChevronUpIcon className={iconClass} />, run: () => navigateHunk(-1) },
      );
    }
    return list;
  }, [
    diff, viewMode, setViewMode, hideWhitespace, setHideWhitespace, theme, toggleTheme, diffPalette, handleRefreshDiff,
    collapsedFiles, reviewedFiles, navigateFile, navigateHunk, setAllCollapsed, setAllReviewed, reviewsEnabled,
  ]);
  usePaletteActions('diff', paletteActions);

  const threadsLoading = reviewsEnabled && !threadsFetched;
  const reveal = useRevealClass(threadsLoading);

  if (error) {
    return (
      <div className="flex flex-col min-h-screen bg-bg text-text font-sans">
        <div className="flex flex-col items-center justify-center p-12 text-deleted text-center">
          <h2 className="text-xl mb-2">Failed to load diff</h2>
          <p className="text-text-secondary">{error}</p>
        </div>
      </div>
    );
  }

  if (threadsLoading) {
    return <DiffSkeleton />;
  }

  return (
    <div className={cn('flex flex-col h-screen bg-bg text-text font-sans', reveal)}>
      <Toolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        hideWhitespace={hideWhitespace}
        onHideWhitespaceChange={setHideWhitespace}
        theme={theme}
        onToggleTheme={toggleTheme}
        onShowHelp={() => setShowHelp(true)}
        diff={diff || undefined}
        diffRef={refParam}
        refMenuOpen={refMenuOpen}
        onRefMenuOpenChange={setRefMenuOpen}
        threads={threads}
        onDeleteAllComments={commentActions.deleteAllThreads}
        onScrollToThread={handleScrollToThread}
        repoName={info?.name || null}
        branch={info?.branch || null}
        githubDetails={githubDetails}
        sessionId={sessionId}
        onGitHubPulled={() => queryClient.invalidateQueries({ queryKey: ['threads'] })}
      />
      {isStale && <StaleDiffBanner onRefresh={handleRefreshDiff} />}
      {diff.files.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2">
          <div className="text-added opacity-40 mb-1">
            <CheckCircleIcon />
          </div>
          <h2 className="text-base font-medium text-text-secondary">No changes found</h2>
          <p className="text-xs text-text-muted">There are no differences to display.</p>
          <button
            className="mt-3 px-3 py-1 bg-bg-tertiary rounded-md text-xs text-text-secondary hover:bg-hover hover:text-text transition-colors cursor-pointer"
            onClick={() => setRefMenuOpen(true)}
          >
            Choose what to review
          </button>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          <Sidebar
            files={diff?.files || []}
            activeFile={activeFile}
            reviewedFiles={reviewedFiles}
            commentCountsByFile={commentCountsByFile}
            repoRoot={info.root}
            editor={!!info.editor}
            diffRef={refParam}
            onFileClick={handleSidebarFileClick}
            onCommentedFileClick={handleSidebarCommentedFileClick}
          />
          {diff ? (
            <div className="relative flex flex-1 min-w-0">
              <FindBar
                files={diff.files}
                activeFile={activeFile}
                onReveal={handleFindReveal}
                onClose={handleFindClose}
                openRequest={findRequest}
              />
              <DiffView
                diff={diff}
                viewMode={viewMode}
                theme={theme}
                collapsedFiles={collapsedFiles}
                onToggleCollapse={handleToggleCollapse}
                reviewedFiles={reviewedFiles}
                onReviewedChange={handleReviewedChange}
                onActiveFileChange={handleActiveFileFromScroll}
                handle={diffViewRef}
                baseRef={refParam}
                canRevert={canRevert}
                onRevert={handleRevert}
                scrollRef={(node) => {
                  mainRef.current = node;
                }}
                threads={threads}
                commentsEnabled={reviewsEnabled}
                commentActions={commentActions}
                onAddThread={handleAddThread}
                pendingSelection={pendingSelection}
                onPendingSelectionChange={setPendingSelection}
                findFile={findFile}
                generalCommentRequest={generalCommentRequest}
              />
            </div>
          ) : null}
        </div>
      )}
      {showHelp && <ShortcutModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}
