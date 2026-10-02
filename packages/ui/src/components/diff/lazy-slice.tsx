import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

const LINE_HEIGHT = 24;
/** Slices this close to the viewport stay mounted, so a fast scroll rarely shows a blank band. */
const MARGIN = 1600;

const listeners = new Set<() => void>();
let frame = 0;

function flush() {
  frame = 0;
  for (const listener of listeners) {
    listener();
  }
}

function schedule() {
  if (!frame) {
    frame = requestAnimationFrame(flush);
  }
}

function scrollerOf(element: Element): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return node;
    }
  }
  return null;
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) {
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    window.addEventListener('resize', schedule);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      document.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
    }
  };
}

/**
 * Fired on a slice that changed height above the viewport. An ancestor that
 * corrects the scroll for the change itself cancels it.
 */
export const SLICE_RESIZE_EVENT = 'diffity:slice-resize';

interface LazySliceProps {
  rows: number;
  /** Keeps the slice mounted, for a thread, the comment form or the find match in it. */
  pinned?: boolean;
  children: ReactNode;
}

/**
 * Renders a run of table rows only while it is near the viewport, otherwise
 * one spacer row of the height it had when last shown, or of `rows` lines
 * before that. Two empty row groups bracket the slice to measure it. When
 * the slice changes height above the viewport, it scrolls by the change, so
 * the rows in view stay put, unless an ancestor cancels `SLICE_RESIZE_EVENT`.
 * Its scroller must opt out of scroll anchoring.
 */
export function LazySlice(props: LazySliceProps) {
  const { rows, pinned = false, children } = props;
  const startRef = useRef<HTMLTableSectionElement>(null);
  const endRef = useRef<HTMLTableSectionElement>(null);
  const heightRef = useRef<number | null>(null);
  const shownHeightRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const [near, setNear] = useState(false);
  const mounted = near || pinned;

  useLayoutEffect(() => {
    const check = () => {
      const start = startRef.current;
      const end = endRef.current;
      if (!start || !end) {
        return;
      }
      const top = start.getBoundingClientRect().top;
      const bottom = end.getBoundingClientRect().top;
      // Shown rows rewrap when the layout width changes, so their height is taken again before they unmount.
      if (mountedRef.current) {
        heightRef.current = bottom - top;
        shownHeightRef.current = bottom - top;
      }
      setNear(bottom > -MARGIN && top < window.innerHeight + MARGIN);
    };
    check();
    return subscribe(check);
  }, []);

  useLayoutEffect(() => {
    mountedRef.current = mounted;
    const start = startRef.current;
    const end = endRef.current;
    if (!start || !end) {
      return;
    }
    const top = start.getBoundingClientRect().top;
    const shown = end.getBoundingClientRect().top - top;
    const previous = shownHeightRef.current;
    shownHeightRef.current = shown;
    const scroller = scrollerOf(start);
    if (previous !== null && shown !== previous && scroller && top < scroller.getBoundingClientRect().top) {
      const event = new CustomEvent(SLICE_RESIZE_EVENT, { bubbles: true, cancelable: true });
      if (start.dispatchEvent(event)) {
        scroller.scrollTop += shown - previous;
      }
    }
  }, [mounted]);

  const height = heightRef.current ?? rows * LINE_HEIGHT;

  return (
    <>
      <tbody ref={startRef} />
      {mounted ? (
        children
      ) : (
        <tbody aria-hidden>
          <tr style={{ height }}>
            <td colSpan={4} className="p-0" />
          </tr>
        </tbody>
      )}
      <tbody ref={endRef} />
    </>
  );
}
