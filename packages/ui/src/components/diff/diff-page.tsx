import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useLoaderData, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ParsedDiff } from '@diffity/parser';
import { useDiff } from '../../hooks/use-diff';
import { useInfo } from '../../hooks/use-info';
import { useTheme } from '../../hooks/use-theme';
import { useKeyboard } from '../../hooks/use-keyboard';
import { usePaletteActions, usePaletteView, type PaletteAction, type PaletteView } from '../../hooks/use-palette';
import { useReviewThreads } from '../../hooks/use-review-threads';
import { useCommentActions } from '../../hooks/use-comment-actions';
import { useThreadLocations } from '../../hooks/use-thread-locations';
import { useViewedFiles } from '../../hooks/use-viewed-files';
import { Toolbar } from '../layout/toolbar';
import { useNavigateToRef } from '../layout/ref-menu';
import { DiffView, flashThreadElement, type DiffViewHandle } from './diff-view';
import type { SinceViewedInfo } from './since-viewed';
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
import { OutsideThreads } from '../comments/outside-threads';
import { CommentsPanel } from '../comments/comments-panel';
import { useRevealClass } from '../ui/skeleton';
import { useDiffStaleness } from '../../hooks/use-diff-staleness';
import { cn } from '../../lib/cn';
import { type ViewMode, getFilePath, getAutoCollapsedPaths } from '../../lib/diff-utils';
import { buildFirstOpenThreadByFile, buildThreadCountsByFile } from '../../lib/comment-navigation';
import { getOutsideThreads, locateViewThreads } from '../../lib/thread-location';
import { getHunkHeaders, scrollToElement } from '../../lib/dom-utils';
import { githubDetailsOptions } from '../../queries/github';
import { useAutoSync } from '../../lib/github-sync';
import { readViewState, useViewState, writeViewState } from '../../lib/view-state';
import { shortcutHint } from '../../lib/shortcuts';
import { readPreference, useSettings, writePreference } from '../../lib/preferences';
import { setDiffPalette, useDiffPalette } from '../../lib/diff-palette';
import { initialCollapsed, nextUnviewedFile } from '../../lib/viewed-state';
import type { FindMatch } from '../../lib/find';
import type { CommentThread, LineSelection } from '../comments/types';
import { isThreadResolved } from '../comments/types';

const NO_THREADS: CommentThread[] = [];
/** The fingerprint each ref's diff was last shown with, to read the file contents again once it changed. */
const shownFingerprints = new Map<string, string>();
const COMMENTS_PANEL_PREFERENCE = 'comments-panel';
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
  collapsedFiles: Set<string>;
  manuallyToggled: Set<string>;
}

export function DiffPage() {
  const { ref: refParam, theme: initialTheme, view: initialViewMode } = useLoaderData<{
    ref: string;
    theme: 'light' | 'dark' | null;
    view: 'split' | 'unified' | null;
  }>();

  const settings = useSettings();
  const [viewMode, setViewMode] = useViewState<ViewMode>('diff:view-mode', initialViewMode || settings.diffLayout);
  const [hideWhitespace, setHideWhitespace] = useViewState('diff:hide-whitespace', settings.hideWhitespace);
  const [seenDefaults, setSeenDefaults] = useViewState('diff:defaults', settings);
  // A changed default also applies to the open diff, and to one shown again after it changed.
  if (seenDefaults.diffLayout !== settings.diffLayout || seenDefaults.hideWhitespace !== settings.hideWhitespace) {
    setSeenDefaults(settings);
    if (seenDefaults.diffLayout !== settings.diffLayout) {
      setViewMode(settings.diffLayout);
    }
    if (seenDefaults.hideWhitespace !== settings.hideWhitespace) {
      setHideWhitespace(settings.hideWhitespace);
    }
  }
  const [showHelp, setShowHelp] = useState(false);
  const [refMenuOpen, setRefMenuOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(() => readPreference(COMMENTS_PANEL_PREFERENCE) === 'open');
  const [searchParams] = useSearchParams();
  const navigateToRef = useNavigateToRef();
  const { theme, toggleTheme } = useTheme(initialTheme);
  const diffPalette = useDiffPalette();
  const [showHidden, setShowHidden] = useViewState('diff:show-hidden', false);
  const { data: diff, error, dataUpdatedAt: diffVersion } = useDiff(hideWhitespace, refParam, showHidden);
  const { data: info } = useInfo(refParam);
  const reviewKey = `diff:${refParam}:review`;
  const [saved] = useState(() => readViewState<SavedReview | null>(reviewKey, null));
  const [activeFile, setActiveFile] = useState<string | null>(saved?.activeFile ?? null);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(saved?.collapsedFiles ?? new Set());
  const manuallyToggledRef = useRef<Set<string>>(saved?.manuallyToggled ?? new Set());
  const [pendingSelection, setPendingSelection] = useState<LineSelection | null>(null);
  const [findMatch, setFindMatch] = useState<FindMatch | null>(null);
  const [findRequest, setFindRequest] = useState(0);
  const [generalCommentRequest, setGeneralCommentRequest] = useState(0);
  const mainRef = useRef<HTMLElement | null>(null);
  const diffViewRef = useRef<DiffViewHandle>(null);
  const currentFileIdx = useRef(0);
  const initializedDiffRef = useRef<ParsedDiff | null>(saved?.diff?.deref() ?? null);
  const commentedSeenRef = useRef<Set<string> | null>(null);
  const changedSeenRef = useRef<Set<string> | null>(null);

  const reviewsEnabled = !!info?.capabilities?.reviews;
  const sessionId = info?.sessionId ?? null;
  const canRevert = !!info?.capabilities?.revert;
  const filePaths = useMemo(() => diff.files.map((file) => getFilePath(file)), [diff]);
  const {
    viewedFiles: reviewedFiles,
    changedFiles,
    setViewed,
    loading: viewedLoading,
    settled: viewedSettled,
  } = useViewedFiles(sessionId, filePaths, diffVersion);
  const changedSinceViewed = useMemo(() => new Set(changedFiles.keys()), [changedFiles]);
  const sinceViewedFiles = useMemo(() => {
    const map = new Map<string, SinceViewedInfo>();
    if (sessionId) {
      for (const [path, mark] of changedFiles) {
        map.set(path, { sessionId, canDiff: mark.kept, version: `${mark.blob}..${mark.current}` });
      }
    }
    return map;
  }, [sessionId, changedFiles]);
  const [sinceViewedShown, setSinceViewedShown] = useState<Set<string>>(() => new Set());
  if ([...sinceViewedShown].some((path) => !sinceViewedFiles.has(path))) {
    setSinceViewedShown(new Set([...sinceViewedShown].filter((path) => sinceViewedFiles.has(path))));
  }
  const handleShowSinceViewedChange = useCallback((path: string, show: boolean) => {
    setSinceViewedShown((prev) => {
      if (prev.has(path) === show) {
        return prev;
      }
      const next = new Set(prev);
      if (show) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
  }, []);
  const { isStale, resetStaleness } = useDiffStaleness(diff.fingerprint, refParam, showHidden, !!info?.capabilities?.staleness);
  const { data: githubDetails = null } = useQuery(githubDetailsOptions(!!info?.github));
  useAutoSync(reviewsEnabled && !!githubDetails && githubDetails.ref === refParam);

  const { data: serverThreads, isFetched: threadsFetched } = useReviewThreads(reviewsEnabled ? sessionId : null);
  const threads = reviewsEnabled && serverThreads ? serverThreads : NO_THREADS;
  const commentActions = useCommentActions(sessionId, reviewsEnabled, threads);
  const commentCountsByFile = useMemo(() => buildThreadCountsByFile(threads), [threads]);
  const threadLocations = useThreadLocations(reviewsEnabled ? sessionId : null, threads, diffVersion);
  const outsideThreads = useMemo(() => getOutsideThreads(threads, diff), [threads, diff]);
  const viewThreads = useMemo(
    () => locateViewThreads(threads, threadLocations, outsideThreads, { sessionId: sessionId ?? '', ref: refParam, empty: diff.files.length === 0 }),
    [threads, threadLocations, outsideThreads, sessionId, refParam, diff],
  );
  const openThreadCount = useMemo(() => threads.filter((thread) => thread.status === 'open').length, [threads]);

  const toggleComments = useCallback(() => setCommentsOpen((open) => !open), []);

  useEffect(() => {
    writePreference(COMMENTS_PANEL_PREFERENCE, commentsOpen ? 'open' : null);
  }, [commentsOpen]);

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

  const threadsLoading = reviewsEnabled && !threadsFetched;
  const layoutReady = !threadsLoading && viewedSettled;

  // Lays out a new diff once its comments and viewed marks are in, and opens files that changed since viewed.
  useEffect(() => {
    if (!layoutReady) {
      return;
    }
    const seen = changedSeenRef.current;
    changedSeenRef.current = changedSinceViewed;
    const newlyChanged = seen ? [...changedSinceViewed].filter((path) => !seen.has(path)) : [];
    for (const path of newlyChanged) {
      manuallyToggledRef.current.delete(path);
    }
    if (diff !== initializedDiffRef.current) {
      initializedDiffRef.current = diff;
      commentedSeenRef.current = filesWithComments;
      const viewedState = { viewed: reviewedFiles, changed: changedFiles };
      setCollapsedFiles(initialCollapsed(filePaths, getAutoCollapsedPaths(diff.files), filesWithComments, viewedState, manuallyToggledRef.current));
      return;
    }
    if (newlyChanged.length > 0) {
      setCollapsedFiles((prev) => {
        const next = new Set(prev);
        for (const path of newlyChanged) {
          next.delete(path);
        }
        return next;
      });
    }
  }, [diff, layoutReady, changedSinceViewed]);

  useEffect(() => {
    writeViewState(reviewKey, {
      diff: initializedDiffRef.current && new WeakRef(initializedDiffRef.current),
      activeFile,
      collapsedFiles,
      manuallyToggled: manuallyToggledRef.current,
    } satisfies SavedReview);
  }, [reviewKey, activeFile, collapsedFiles]);

  useEffect(() => {
    const seen = commentedSeenRef.current;
    commentedSeenRef.current = filesWithComments;
    if (!seen) {
      return;
    }
    const added = [...filesWithComments].filter((path) => !seen.has(path));
    setCollapsedFiles((prev) => {
      if (!added.some((path) => prev.has(path))) {
        return prev;
      }
      const next = new Set(prev);
      for (const path of added) {
        next.delete(path);
      }
      return next;
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
    setViewed([path], reviewed);
    manuallyToggledRef.current.delete(path);
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (reviewed) {
        next.add(path);
      } else {
        next.delete(path);
      }
      return next;
    });
  }, [setViewed]);

  const setAllCollapsed = useCallback((collapsed: boolean) => {
    if (!diff) {
      return;
    }
    manuallyToggledRef.current = new Set();
    setCollapsedFiles(collapsed ? new Set(diff.files.map((f) => getFilePath(f))) : new Set());
  }, [diff]);

  const setAllReviewed = useCallback((reviewed: boolean) => {
    const paths = filePaths.filter((path) => (reviewed ? !reviewedFiles.has(path) : reviewedFiles.has(path) || changedFiles.has(path)));
    setViewed(paths, reviewed);
    for (const path of paths) {
      manuallyToggledRef.current.delete(path);
    }
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
  }, [filePaths, reviewedFiles, changedFiles, setViewed]);

  const getCurrentFilePath = useCallback((): string | null => filePaths[currentFileIdx.current] ?? null, [filePaths]);

  useEffect(() => {
    const index = activeFile ? filePaths.indexOf(activeFile) : -1;
    if (index >= 0) {
      currentFileIdx.current = index;
    }
  }, [activeFile, filePaths]);

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

  const toggleViewed = useCallback((path: string) => {
    const wasReviewed = reviewedFiles.has(path);
    handleReviewedChange(path, !wasReviewed);
    if (!wasReviewed) {
      navigateFile(1);
    }
  }, [reviewedFiles, handleReviewedChange, navigateFile]);

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
      if (path) {
        toggleViewed(path);
      }
    },
    onMarkAllViewed: () => setAllReviewed(true),
    onNextUnviewed: () => goToNextUnviewed(),
    onUnifiedView: () => setViewMode('unified'),
    onSplitView: () => setViewMode('split'),
    onShowHelp: () => setShowHelp(true),
    onOpenRefMenu: () => setRefMenuOpen(true),
    onToggleComments: () => {
      if (reviewsEnabled) {
        toggleComments();
      }
    },
    onFocusSearch: focusFileFilter,
    onEscape: () => setShowHelp(false),
  });

  const queryClient = useQueryClient();
  const diffSource = useMemo(
    () => ({ ref: refParam, hideWhitespace, showHidden, fingerprint: diff.fingerprint }),
    [refParam, hideWhitespace, showHidden, diff.fingerprint],
  );

  useEffect(() => {
    const shown = shownFingerprints.get(refParam);
    shownFingerprints.set(refParam, diff.fingerprint);
    if (shown !== undefined && shown !== diff.fingerprint) {
      queryClient.invalidateQueries({ queryKey: ['file-content'] });
    }
  }, [refParam, diff.fingerprint, queryClient]);

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

  const handleScrollToThread = useCallback((threadId: string, filePath: string, onRevealed?: () => void) => {
    setActiveFile(filePath);
    handleShowSinceViewedChange(filePath, false);
    setCollapsedFiles((prev) => {
      if (!prev.has(filePath)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(filePath);
      return next;
    });
    if (diffViewRef.current) {
      diffViewRef.current.scrollToThread(threadId, filePath, onRevealed);
      return;
    }
    const element = document.querySelector(`[data-thread-id="${CSS.escape(threadId)}"]`);
    if (element) {
      element.scrollIntoView({ behavior: 'instant', block: 'center' });
      flashThreadElement(element);
      onRevealed?.();
    }
  }, [handleShowSinceViewedChange]);

  const focusThreadId = searchParams.get('thread');
  const focusedThreadRef = useRef<string | null>(null);
  // Waits for the diff to be laid out, and keeps the link until the thread is in view.
  useEffect(() => {
    if (!focusThreadId || !layoutReady || focusedThreadRef.current === focusThreadId) {
      return;
    }
    const clearLink = () => navigateToRef(refParam, { replace: true });
    const thread = threads.find((t) => t.id === focusThreadId);
    if (!thread) {
      clearLink();
      return;
    }
    focusedThreadRef.current = focusThreadId;
    handleScrollToThread(thread.id, thread.filePath, clearLink);
  }, [focusThreadId, layoutReady, threads, handleScrollToThread, navigateToRef, refParam]);

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
    setFindMatch(match);
    handleShowSinceViewedChange(match.scope, false);
    setCollapsedFiles((prev) => {
      if (!prev.has(match.scope)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(match.scope);
      return next;
    });
    diffViewRef.current?.scrollToLine(match.scope, match.key);
  }, [handleShowSinceViewedChange]);

  const handleFindClose = useCallback(() => setFindMatch(null), []);

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

  const goToNextUnviewed = useCallback(() => {
    const path = nextUnviewedFile(filePaths, currentFileIdx.current, reviewedFiles);
    if (path) {
      handleRevealFile(path);
    } else if (filePaths.length > 0) {
      toast.success('All files viewed');
    }
  }, [filePaths, reviewedFiles, handleRevealFile]);

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
    const paths = filePaths;
    const hasFiles = paths.length > 0;
    const currentFile = (activeFile && paths.includes(activeFile) ? activeFile : paths[0]) ?? null;
    const anyExpanded = paths.some((path) => !collapsedFiles.has(path));
    const list: PaletteAction[] = [];
    if (hasFiles) {
      list.push(
        { id: 'find', title: 'Find in diff', hint: shortcutHint('find'), keywords: 'search text', icon: <SearchIcon className={iconClass} />, run: () => setFindRequest((n) => n + 1) },
        { id: 'filter-files', title: 'Filter files', hint: shortcutHint('filter-files'), keywords: 'sidebar search', icon: <SearchIcon className={iconClass} />, run: focusFileFilter },
      );
      if (currentFile) {
        const name = currentFile.split('/').pop();
        list.push({
          id: 'toggle-viewed',
          title: reviewedFiles.has(currentFile) ? `Mark ${name} as not viewed` : `Mark ${name} as viewed`,
          hint: shortcutHint('toggle-viewed'),
          keywords: 'reviewed current file',
          icon: <CheckIcon className={iconClass} />,
          run: () => toggleViewed(currentFile),
        });
      }
      if (!paths.every((path) => reviewedFiles.has(path))) {
        list.push({ id: 'mark-all-viewed', title: 'Mark all files as viewed', hint: shortcutHint('mark-all-viewed'), keywords: 'reviewed', icon: <CheckIcon className={iconClass} />, run: () => setAllReviewed(true) });
      }
      if (paths.some((path) => reviewedFiles.has(path) || changedFiles.has(path))) {
        list.push({ id: 'unmark-all-viewed', title: 'Mark all files as not viewed', keywords: 'reviewed unviewed', icon: <CheckIcon className={iconClass} />, run: () => setAllReviewed(false) });
      }
      if (reviewsEnabled) {
        list.push({ id: 'general-comment', title: 'Add general comment', group: 'Comments', keywords: 'review note', icon: <CommentIcon className={iconClass} />, run: () => setGeneralCommentRequest((n) => n + 1) });
      }
    }
    if (reviewsEnabled) {
      list.push({
        id: 'comments-panel',
        title: commentsOpen ? 'Hide comments panel' : 'Show comments panel',
        group: 'Comments',
        hint: shortcutHint('comments-panel'),
        keywords: 'threads outdated all views list',
        icon: <CommentIcon className={iconClass} />,
        run: toggleComments,
      });
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
      );
      if (!paths.every((path) => reviewedFiles.has(path))) {
        list.push({
          id: 'file-next-unviewed',
          title: 'Next unviewed file',
          group: 'Go to',
          hint: shortcutHint('file-next-unviewed'),
          keywords: 'viewed reviewed changed since',
          icon: <ArrowDownIcon />,
          run: goToNextUnviewed,
        });
      }
      list.push(
        { id: 'hunk-next', title: 'Next changed hunk', group: 'Go to', hint: shortcutHint('hunk-next'), icon: <ChevronDownIcon className={iconClass} />, run: () => navigateHunk(1) },
        { id: 'hunk-prev', title: 'Previous changed hunk', group: 'Go to', hint: shortcutHint('hunk-prev'), icon: <ChevronUpIcon className={iconClass} />, run: () => navigateHunk(-1) },
      );
    }
    return list;
  }, [
    filePaths, activeFile, viewMode, setViewMode, hideWhitespace, setHideWhitespace, theme, toggleTheme, diffPalette,
    handleRefreshDiff, collapsedFiles, reviewedFiles, changedFiles, navigateFile, navigateHunk, setAllCollapsed,
    setAllReviewed, toggleViewed, goToNextUnviewed, reviewsEnabled, commentsOpen, toggleComments,
  ]);
  usePaletteActions('diff', paletteActions);

  const reveal = useRevealClass(threadsLoading || viewedLoading);

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

  if (threadsLoading || viewedLoading) {
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
        hiddenFiles={{ files: diff.hiddenFiles ?? [], showing: showHidden, onShowingChange: setShowHidden }}
        commentsPanel={reviewsEnabled ? { open: commentsOpen, openCount: openThreadCount, onToggle: toggleComments } : undefined}
      />
      {isStale && <StaleDiffBanner onRefresh={handleRefreshDiff} />}
      <div className="flex flex-1 overflow-hidden">
        {diff.files.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 overflow-y-auto p-6">
            <div className="text-added opacity-40 mb-1">
              <CheckCircleIcon />
            </div>
            <h2 className="text-base font-medium text-text-secondary">No changes found</h2>
            <p className="text-xs text-text-muted">
              {diff.hiddenFiles?.length
                ? `${diff.hiddenFiles.length} changed file${diff.hiddenFiles.length === 1 ? ' is' : 's are'} hidden by .diffityignore.`
                : 'There are no differences to display.'}
            </p>
            <button
              className="mt-3 px-3 py-1 bg-bg-tertiary rounded-md text-xs text-text-secondary hover:bg-hover hover:text-text transition-colors cursor-pointer"
              onClick={() => setRefMenuOpen(true)}
            >
              Choose what to review
            </button>
            {reviewsEnabled && (
              <OutsideThreads
                threads={outsideThreads}
                locations={threadLocations}
                commentActions={commentActions}
                viewEmpty
                className="mt-6 w-full max-w-[760px] rounded-lg border overflow-hidden"
              />
            )}
          </div>
        ) : (
          <>
            <Sidebar
              files={diff?.files || []}
              activeFile={activeFile}
              reviewedFiles={reviewedFiles}
              changedSinceViewed={changedSinceViewed}
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
                  source={diffSource}
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
                  sinceViewedFiles={sinceViewedFiles}
                  sinceViewedShown={sinceViewedShown}
                  onShowSinceViewedChange={handleShowSinceViewedChange}
                  onReviewedChange={handleReviewedChange}
                  onActiveFileChange={handleActiveFileFromScroll}
                  handle={diffViewRef}
                  baseRef={refParam}
                  source={diffSource}
                  canRevert={canRevert}
                  onRevert={handleRevert}
                  scrollRef={(node) => {
                    mainRef.current = node;
                  }}
                  threads={threads}
                  outsideThreads={outsideThreads}
                  threadLocations={threadLocations}
                  commentsEnabled={reviewsEnabled}
                  commentActions={commentActions}
                  onAddThread={handleAddThread}
                  pendingSelection={pendingSelection}
                  onPendingSelectionChange={setPendingSelection}
                  findMatch={findMatch}
                  generalCommentRequest={generalCommentRequest}
                />
              </div>
            ) : null}
          </>
        )}
        {reviewsEnabled && sessionId && commentsOpen && (
          <CommentsPanel
            sessionId={sessionId}
            viewThreads={viewThreads}
            branch={info?.branch || null}
            onScrollToThread={handleScrollToThread}
            onClose={toggleComments}
          />
        )}
      </div>
      {showHelp && <ShortcutModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}
