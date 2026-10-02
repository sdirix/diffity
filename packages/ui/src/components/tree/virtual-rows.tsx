import { useCallback, useEffect, useRef, type ReactNode, type RefCallback } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import { ROW_HEIGHT } from './file-tree-row';

const PADDING = 4;

interface VirtualRowsProps<T> {
  items: T[];
  itemPath: (item: T) => string;
  /** Scrolled into view when it changes, and on mount unless `revealOnMount` is off. */
  activePath: string | null;
  /** Off when the list restores a scroll offset on mount, which the active row would override. */
  revealOnMount?: boolean;
  /** Gets the scroll container, which this renders. */
  scrollRef?: RefCallback<HTMLElement>;
  className?: string;
  renderRow: (item: T) => ReactNode;
}

/** A scroll container that renders only the rows in or near its viewport. */
export function VirtualRows<T>(props: VirtualRowsProps<T>) {
  const { items, itemPath, activePath, revealOnMount = true, scrollRef, className, renderRow } = props;
  const elementRef = useRef<HTMLDivElement | null>(null);
  const setElement = useCallback((el: HTMLDivElement | null) => {
    elementRef.current = el;
    return scrollRef?.(el);
  }, [scrollRef]);
  const focusedPathRef = useRef<string | null>(null);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => elementRef.current,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => itemPath(items[index]),
    paddingStart: PADDING,
    paddingEnd: PADDING,
    overscan: 12,
    // The row with the keyboard focus stays mounted, so scrolling it out of view keeps the focus.
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range);
      const focused = focusedPathRef.current;
      const index = focused === null ? -1 : items.findIndex((item) => itemPath(item) === focused);
      return index < 0 || indexes.includes(index) ? indexes : [...indexes, index].sort((a, b) => a - b);
    },
  });

  const revealedPath = useRef(revealOnMount ? null : activePath);
  const activeIndex = activePath === null ? -1 : items.findIndex((item) => itemPath(item) === activePath);

  useEffect(() => {
    const el = elementRef.current;
    if (activePath === null) {
      revealedPath.current = null;
      return;
    }
    if (!el || activeIndex < 0 || revealedPath.current === activePath) {
      return;
    }
    revealedPath.current = activePath;
    const top = PADDING + activeIndex * ROW_HEIGHT;
    if (top < el.scrollTop) {
      el.scrollTop = top;
    } else if (top + ROW_HEIGHT > el.scrollTop + el.clientHeight) {
      el.scrollTop = top + ROW_HEIGHT - el.clientHeight;
    }
  }, [activePath, activeIndex]);

  return (
    <div
      ref={setElement}
      className={className}
      onFocus={(e) => {
        focusedPathRef.current = e.target.closest('[data-path]')?.getAttribute('data-path') ?? null;
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          focusedPathRef.current = null;
        }
      }}
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.key}
            data-path={row.key}
            className="absolute left-0 top-0 w-full"
            style={{ height: ROW_HEIGHT, transform: `translateY(${row.start}px)` }}
          >
            {renderRow(items[row.index])}
          </div>
        ))}
      </div>
    </div>
  );
}
