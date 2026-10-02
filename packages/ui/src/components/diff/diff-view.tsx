import { useMemo, useRef, useState, useCallback, useImperativeHandle, useEffect } from 'react';
import { useVirtualizer, type Rect, type VirtualItem } from '@tanstack/react-virtual';
import type { DiffFile, ParsedDiff } from '@diffity/parser';
import { DeferredFileBlock } from './deferred-file-block';
import { SLICE_RESIZE_EVENT } from './lazy-slice';
import type { SinceViewedInfo } from './since-viewed';
import { GeneralComments } from '../comments/general-comments';
import { OutsideThreads } from '../comments/outside-threads';
import { getLang, useHighlighter, type CodeHighlighter } from '../../hooks/use-highlighter';
import { type ViewMode, deferReason, getFilePath } from '../../lib/diff-utils';
import type { CommentThread, LineSelection } from '../comments/types';
import type { CommentActions } from '../../hooks/use-comment-actions';
import type { LocatedThread } from '../../lib/api';
import type { FindMatch } from '../../lib/find';
import type { DiffSource } from '../../queries/diff';

export function flashThreadElement(element: Element) {
  element.dispatchEvent(new CustomEvent('diffity:focus-thread', { bubbles: false }));
  element.classList.remove('flash-thread');
  void (element as HTMLElement).offsetWidth;
  element.classList.add('flash-thread');
}

export interface DiffViewHandle {
  scrollToFile: (path: string) => void;
  /** Scrolls to a thread, mounting its file first, and calls `onRevealed` once it is in view. */
  scrollToThread: (threadId: string, filePath: string, onRevealed?: () => void) => void;
  /** Brings a line rendered with `data-find-line` into view, mounting its file first. */
  scrollToLine: (path: string, key: string) => void;
}

const VIRTUALIZER_OVERSCAN = 3;
const FILE_HEADER_HEIGHT = 56;
const EMPTY_CONTENT_HEIGHT = 100;
const LINE_HEIGHT = 24;
const HUNK_HEADER_HEIGHT = 32;
const FILE_BLOCK_PADDING = 16;
/** Lines closer than this to the top of the scroller sit under the sticky file header. */
const STICKY_HEADER_OFFSET = 48;

interface DiffViewProps {
  diff: ParsedDiff;
  viewMode: ViewMode;
  theme: 'light' | 'dark';
  collapsedFiles: Set<string>;
  onToggleCollapse: (path: string) => void;
  reviewedFiles: Set<string>;
  /** Files that changed after they were marked viewed. */
  sinceViewedFiles: Map<string, SinceViewedInfo>;
  /** Files showing only their changes since viewed. */
  sinceViewedShown: Set<string>;
  onShowSinceViewedChange: (path: string, show: boolean) => void;
  onReviewedChange: (path: string, reviewed: boolean) => void;
  onActiveFileChange?: (path: string) => void;
  scrollRef?: React.RefCallback<HTMLElement>;
  handle?: React.Ref<DiffViewHandle>;
  baseRef?: string;
  /** Where the diff came from, to fetch the hunks of `trimmed` files. */
  source: DiffSource;
  canRevert?: boolean;
  onRevert?: () => void;
  threads: CommentThread[];
  /** Threads on files that left the diff. */
  outsideThreads: CommentThread[];
  threadLocations: Map<string, LocatedThread>;
  commentsEnabled: boolean;
  commentActions: CommentActions;
  onAddThread: CommentActions['addThread'];
  pendingSelection: LineSelection | null;
  onPendingSelectionChange: (selection: LineSelection | null) => void;
  /** The current find match, rendered even when its file is held back. */
  findMatch?: FindMatch | null;
  /** Opens the general comment form whenever it changes. */
  generalCommentRequest?: number;
}

interface SavedScroll {
  offset: number;
  rect: Rect | null;
  measurements: VirtualItem[];
}

/** Where each diff was scrolled to, so it opens there again when shown after another view. */
const savedScrolls = new WeakMap<ParsedDiff, SavedScroll>();

function isLineInView(element: Element, scroller: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const bounds = scroller.getBoundingClientRect();
  return rect.top >= bounds.top + STICKY_HEADER_OFFSET && rect.bottom <= bounds.bottom - 16;
}

/** Calls `reveal` with the element `selector` names once it is mounted in `scroller`, waiting up to 2s. */
function whenMounted(scroller: HTMLElement, selector: string, reveal: (element: Element) => void): () => void {
  let frame = 0;
  const started = performance.now();

  const tick = () => {
    const element = scroller.querySelector(selector);
    if (element) {
      reveal(element);
    } else if (performance.now() - started < 2000) {
      frame = requestAnimationFrame(tick);
    }
  };

  frame = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(frame);
}

/** A row near the top of the scroller, or the find match while it is in view, and how far below the scroller top it sits. */
interface ReadingAnchor {
  element: Element;
  offset: number;
  /** The row's line, to find it again once the rows are rendered anew, as after a switch between split and unified view. */
  line: FindLineRef | null;
}

/** A line rendered with `data-find-line` in the file with `data-find-scope`. */
interface FindLineRef {
  scope: string;
  key: string;
}

function lineSelector(scope: string, key: string): string {
  return `[data-find-scope="${CSS.escape(scope)}"] [data-find-line="${CSS.escape(key)}"]`;
}

function readingAnchor(scroller: HTMLElement, findMatch?: FindMatch | null): ReadingAnchor | null {
  const bounds = scroller.getBoundingClientRect();
  const match = findMatch && scroller.querySelector(lineSelector(findMatch.scope, findMatch.key));
  const hit = match && isLineInView(match, scroller)
    ? match
    : document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + STICKY_HEADER_OFFSET + 8);
  const element = hit?.closest('tr') ?? hit;
  if (!element || !scroller.contains(element)) {
    return null;
  }
  const key = (hit?.closest('[data-find-line]') ?? element.querySelector('[data-find-line]'))?.getAttribute('data-find-line');
  const scope = element.closest('[data-find-scope]')?.getAttribute('data-find-scope');
  return {
    element,
    offset: element.getBoundingClientRect().top - bounds.top,
    line: key && scope !== undefined && scope !== null ? { scope, key } : null,
  };
}

function estimateFileHeight(file: DiffFile, collapsed: boolean): number {
  if (collapsed) {
    return FILE_HEADER_HEIGHT;
  }
  if (file.isBinary || file.hunks.length === 0 || deferReason(file)) {
    return EMPTY_CONTENT_HEIGHT;
  }
  let lineCount = 0;
  for (const hunk of file.hunks) {
    lineCount += hunk.lines.length;
  }
  return FILE_HEADER_HEIGHT + lineCount * LINE_HEIGHT + file.hunks.length * HUNK_HEADER_HEIGHT + FILE_BLOCK_PADDING;
}

export function DiffView(props: DiffViewProps) {
  const {
    diff, viewMode, theme, collapsedFiles, onToggleCollapse,
    reviewedFiles, sinceViewedFiles, sinceViewedShown, onShowSinceViewedChange, onReviewedChange, onActiveFileChange, scrollRef,
    handle, baseRef, source, canRevert, onRevert,
    threads, outsideThreads, threadLocations, commentsEnabled, commentActions, onAddThread,
    pendingSelection, onPendingSelectionChange, findMatch, generalCommentRequest,
  } = props;
  const { tokenize, ready: highlighterReady } = useHighlighter();
  const scrollElementRef = useRef<HTMLElement>(null);

  const highlighters = useMemo(() => {
    const map = new Map<string, CodeHighlighter>();
    if (!highlighterReady) {
      return map;
    }
    for (const file of diff.files) {
      const filePath = getFilePath(file);
      if (getLang(filePath)) {
        map.set(filePath, (code, state) => tokenize(code, filePath, theme, state));
      }
    }
    return map;
  }, [diff, tokenize, theme, highlighterReady]);

  const [restored] = useState(() => savedScrolls.get(diff));

  const virtualizer = useVirtualizer({
    count: diff.files.length,
    getScrollElement: () => scrollElementRef.current,
    estimateSize: (index) => estimateFileHeight(diff.files[index], collapsedFiles.has(getFilePath(diff.files[index]))),
    overscan: VIRTUALIZER_OVERSCAN,
    initialOffset: restored?.offset,
    initialRect: restored?.rect ?? undefined,
    initialMeasurementsCache: restored?.measurements,
  });
  const listRef = useRef<HTMLDivElement>(null);
  /** Whether the virtualizer corrects the scroll for the next size change of an item, decided when one of its slices changed. */
  const resizeOwners = useRef(new Map<number, boolean>());
  /** Set for the frame the scroller width changed in, which the reading anchor corrects for. */
  const widthChangeRef = useRef(false);
  // The scroller opts out of scroll anchoring. The virtualizer corrects for files that ended above the viewport, the slices of a file reaching into it correct for themselves.
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => {
    const owner = resizeOwners.current.get(item.index);
    resizeOwners.current.delete(item.index);
    if (widthChangeRef.current) {
      return false;
    }
    return owner ?? item.end <= (instance.scrollOffset ?? 0);
  };

  useEffect(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const handleSliceResize = (event: Event) => {
      const index = Number((event.target as Element).closest('[data-index]')?.getAttribute('data-index'));
      const item = virtualizer.measurementsCache[index];
      if (!item) {
        return;
      }
      const owner = item.end <= (virtualizer.scrollOffset ?? 0);
      resizeOwners.current.set(index, owner);
      if (owner) {
        event.preventDefault();
      }
    };
    list.addEventListener(SLICE_RESIZE_EVENT, handleSliceResize);
    return () => list.removeEventListener(SLICE_RESIZE_EVENT, handleSliceResize);
  }, [virtualizer]);

  useEffect(() => () => {
    savedScrolls.set(diff, {
      offset: virtualizer.scrollOffset ?? 0,
      rect: virtualizer.scrollRect,
      measurements: virtualizer.measurementsCache,
    });
  }, [diff, virtualizer]);

  const anchorRef = useRef<ReadingAnchor | null>(null);
  const anchorFrameRef = useRef(0);
  const findMatchRef = useRef(findMatch);
  findMatchRef.current = findMatch;

  const noteAnchor = useCallback(() => {
    if (anchorFrameRef.current) {
      return;
    }
    anchorFrameRef.current = requestAnimationFrame(() => {
      anchorFrameRef.current = 0;
      const scroller = scrollElementRef.current;
      anchorRef.current = scroller && readingAnchor(scroller, findMatchRef.current);
    });
  }, []);

  useEffect(noteAnchor, [findMatch, noteAnchor]);

  // Rows rewrap when the scroller gets wider or narrower. The row read last stays in place, which covers the files above it too.
  useEffect(() => {
    const scroller = scrollElementRef.current;
    if (!scroller) {
      return;
    }
    let width = scroller.clientWidth;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      const anchor = anchorRef.current;
      if (scroller.clientWidth === width) {
        return;
      }
      width = scroller.clientWidth;
      if (!anchor?.element.isConnected) {
        return;
      }
      widthChangeRef.current = true;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        widthChangeRef.current = false;
      });
      scroller.scrollTop += anchor.element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.offset;
    });
    observer.observe(scroller);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(anchorFrameRef.current);
    };
  }, []);

  const scrollTargetRef = useRef<string | null>(null);
  const [highlightedFile, setHighlightedFile] = useState<string | null>(null);

  const cancelJumpRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cancelJumpRef.current?.(), []);

  /**
   * Hands the element `selector` names to `reveal` once it is mounted, after
   * scrolling to file `index` when it is not yet. A new jump cancels the one
   * before, and one that found its element is done.
   */
  const jumpTo = useCallback((index: number, selector: string, reveal: (element: Element) => void) => {
    const scroller = scrollElementRef.current;
    if (!scroller) {
      return;
    }
    cancelJumpRef.current?.();
    if (index >= 0 && !scroller.querySelector(selector)) {
      virtualizer.scrollToIndex(index, { align: 'start' });
    }
    cancelJumpRef.current = whenMounted(scroller, selector, (element) => {
      cancelJumpRef.current = null;
      reveal(element);
      // Ends the virtualizer's chase of the file it scrolled to, which would move the element out of view again.
      virtualizer.scrollToOffset(scroller.scrollTop);
    });
  }, [virtualizer]);

  useImperativeHandle(handle, () => ({
    scrollToFile: (path: string) => {
      const index = diff.files.findIndex((f) => getFilePath(f) === path);
      if (index >= 0) {
        scrollTargetRef.current = path;
        setHighlightedFile(path);
        jumpTo(index, `#file-${CSS.escape(encodeURIComponent(path))}`, (element) => {
          element.scrollIntoView({ behavior: 'instant', block: 'start' });
        });
      }
    },
    scrollToThread: (threadId: string, filePath: string, onRevealed?: () => void) => {
      const selector = `[data-thread-id="${CSS.escape(threadId)}"]`;
      const index = scrollElementRef.current?.querySelector(selector) ? -1 : diff.files.findIndex((f) => getFilePath(f) === filePath);
      if (index >= 0) {
        scrollTargetRef.current = filePath;
      }
      jumpTo(index, selector, (element) => {
        element.scrollIntoView({ behavior: 'instant', block: 'center' });
        flashThreadElement(element);
        onRevealed?.();
      });
    },
    scrollToLine: (path: string, key: string) => {
      const scroller = scrollElementRef.current;
      const mounted = !!document.getElementById(`file-${encodeURIComponent(path)}`);
      jumpTo(mounted ? -1 : diff.files.findIndex((f) => getFilePath(f) === path), `[data-find-scope="${CSS.escape(path)}"] [data-find-line="${CSS.escape(key)}"]`, (element) => {
        if (scroller && !isLineInView(element, scroller)) {
          element.scrollIntoView({ behavior: 'instant', block: 'center' });
        }
      });
    },
  }), [diff.files, jumpTo]);

  // Split and unified view render other rows, so the line read last is kept mounted, looked up again and put back where it was.
  const [heldLine, setHeldLine] = useState<FindLineRef | null>(null);
  const shownViewModeRef = useRef(viewMode);
  useEffect(() => {
    const scroller = scrollElementRef.current;
    const line = anchorRef.current?.line;
    const offset = anchorRef.current?.offset ?? 0;
    if (shownViewModeRef.current === viewMode || !scroller) {
      return;
    }
    shownViewModeRef.current = viewMode;
    if (!line) {
      return;
    }
    setHeldLine(line);
    jumpTo(diff.files.findIndex((f) => getFilePath(f) === line.scope), lineSelector(line.scope, line.key), (element) => {
      const row = element.closest('tr') ?? element;
      scroller.scrollTop += row.getBoundingClientRect().top - scroller.getBoundingClientRect().top - offset;
      setHeldLine(null);
    });
  }, [viewMode, diff.files, jumpTo]);

  const getTopVisibleFile = useCallback((): string | null => {
    const visibleItems = virtualizer.getVirtualItems();
    if (visibleItems.length === 0) {
      return null;
    }

    const scrollEl = scrollElementRef.current;
    if (!scrollEl) {
      return null;
    }

    const scrollTop = scrollEl.scrollTop;
    for (const item of visibleItems) {
      if (item.end > scrollTop) {
        return getFilePath(diff.files[item.index]);
      }
    }

    return getFilePath(diff.files[visibleItems[0].index]);
  }, [virtualizer, diff.files]);

  const handleScroll = useCallback(() => {
    noteAnchor();

    if (!onActiveFileChange) {
      return;
    }

    const topFile = getTopVisibleFile();
    if (!topFile) {
      return;
    }

    if (scrollTargetRef.current) {
      if (topFile === scrollTargetRef.current) {
        scrollTargetRef.current = null;
      }
      return;
    }

    onActiveFileChange(topFile);
  }, [getTopVisibleFile, onActiveFileChange, noteAnchor]);

  const items = virtualizer.getVirtualItems();
  const [paddingTop, paddingBottom] = items.length > 0
    ? [
        items[0].start,
        virtualizer.getTotalSize() - items[items.length - 1].end,
      ]
    : [0, 0];

  return (
    <main
      ref={(node) => {
        scrollElementRef.current = node;
        if (scrollRef) {
          scrollRef(node);
        }
      }}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto pb-12 [overflow-anchor:none]"
    >
      {commentsEnabled && (
        <>
          <GeneralComments
            threads={threads}
            commentActions={commentActions}
            composeRequest={generalCommentRequest}
          />
          <OutsideThreads
            threads={outsideThreads}
            locations={threadLocations}
            commentActions={commentActions}
            className="mx-4 mt-3 rounded-lg border overflow-hidden"
          />
        </>
      )}
      <div ref={listRef} className="py-2" style={{ paddingTop, paddingBottom }}>
        {items.map((virtualItem) => {
          const file = diff.files[virtualItem.index];
          const filePath = getFilePath(file);
          return (
            <div
              key={filePath + '-' + virtualItem.index}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
            >
              <DeferredFileBlock
                highlighted={highlightedFile === filePath}
                onHighlightEnd={() => {
                  if (highlightedFile === filePath) {
                    setHighlightedFile(null);
                  }
                }}
                file={file}
                viewMode={viewMode}
                collapsed={collapsedFiles.has(filePath)}
                onToggleCollapse={onToggleCollapse}
                reviewed={reviewedFiles.has(filePath)}
                sinceViewed={sinceViewedFiles.get(filePath) ?? null}
                showSinceViewed={sinceViewedShown.has(filePath)}
                onShowSinceViewedChange={onShowSinceViewedChange}
                onReviewedChange={onReviewedChange}
                highlightCode={highlighters.get(filePath)}
                baseRef={baseRef}
                source={source}
                theme={theme}
                canRevert={canRevert}
                onRevert={onRevert}
                threads={threads}
                commentsEnabled={commentsEnabled}
                commentActions={commentActions}
                onAddThread={onAddThread}
                pendingSelection={pendingSelection}
                onPendingSelectionChange={onPendingSelectionChange}
                load={findMatch?.scope === filePath}
                pinnedLines={[findMatch, heldLine].flatMap((line) => (line?.scope === filePath ? [line.key] : []))}
              />
            </div>
          );
        })}
      </div>
    </main>
  );
}
