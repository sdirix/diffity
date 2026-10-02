import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';

interface OpenPopover {
  contains: (node: Node) => boolean;
}

/** Open popovers, innermost last: Escape closes the innermost, a click in one keeps those it opened from. */
const openStack: OpenPopover[] = [];

interface AgentPopoverProps {
  open: boolean;
  onClose: () => void;
  /** The button that toggles it. */
  trigger: ReactNode;
  align?: 'start' | 'end';
  className?: string;
  children: ReactNode;
}

const GAP = 4;
/** Transparent rather than hidden until placed, so `autoFocus` inside still works. */
const UNPLACED: CSSProperties = { top: 0, left: 0, opacity: 0, pointerEvents: 'none' };

/** A panel under its trigger, above it when there is no room, that closes on Escape and on a click outside. */
export function AgentPopover(props: AgentPopoverProps) {
  const { open, onClose, trigger, align = 'end', className, children } = props;
  const rootRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [style, setStyle] = useState<CSSProperties>(UNPLACED);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }
    const place = () => {
      const anchor = rootRef.current?.getBoundingClientRect();
      const height = panelRef.current?.offsetHeight ?? 0;
      if (!anchor) {
        return;
      }
      const above = anchor.bottom + GAP + height > window.innerHeight && anchor.top - GAP - height > 0;
      setStyle({
        top: above ? anchor.top - GAP - height : anchor.bottom + GAP,
        ...(align === 'end' ? { right: window.innerWidth - anchor.right } : { left: anchor.left }),
      });
    };
    place();
    const observer = new ResizeObserver(place);
    if (panelRef.current) {
      observer.observe(panelRef.current);
    }
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, align]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const entry: OpenPopover = {
      contains: (node) => !!rootRef.current?.contains(node) || !!panelRef.current?.contains(node),
    };
    openStack.push(entry);
    const handleDown = (e: MouseEvent) => {
      const target = e.target as Node;
      const inner = openStack.slice(openStack.indexOf(entry));
      if (!inner.some((popover) => popover.contains(target))) {
        closeRef.current();
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openStack.at(-1) === entry) {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      }
    };
    document.addEventListener('mousedown', handleDown);
    window.addEventListener('keydown', handleKey, true);
    return () => {
      openStack.splice(openStack.indexOf(entry), 1);
      document.removeEventListener('mousedown', handleDown);
      window.removeEventListener('keydown', handleKey, true);
      setStyle(UNPLACED);
    };
  }, [open]);

  return (
    <span className="inline-flex shrink-0" ref={rootRef}>
      {trigger}
      {open && createPortal(
        <div
          ref={panelRef}
          style={style}
          className={cn('fixed z-50 bg-bg-secondary rounded-md shadow-lg ring-1 ring-border font-sans text-xs text-text', className)}
        >
          {children}
        </div>,
        document.body,
      )}
    </span>
  );
}
