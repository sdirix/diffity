import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';

export interface MenuPosition {
  x: number;
  y: number;
}

const MARGIN = 8;
const ITEM_SELECTOR = '[role="menuitem"]:not(:disabled)';

const CloseMenu = createContext<() => void>(() => {});

/** The context menu key or Shift+F10, the keyboard way to open a context menu. */
export function isMenuKey(event: { key: string; shiftKey: boolean }): boolean {
  return event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10');
}

/** Where the menu for `event` opens: at the pointer, or below the target when the keyboard opened it. */
export function menuPositionFor(event: React.MouseEvent | React.KeyboardEvent): MenuPosition {
  if ('clientX' in event && (event.clientX !== 0 || event.clientY !== 0)) {
    return { x: event.clientX, y: event.clientY };
  }
  const rect = event.currentTarget.getBoundingClientRect();
  return { x: rect.left + 24, y: rect.bottom };
}

interface ContextMenuProps {
  position: MenuPosition;
  label: string;
  onClose: () => void;
  children: ReactNode;
}

/**
 * A menu at `position`, kept inside the viewport. It takes focus, arrow keys
 * move between items, and Esc, Tab, scrolling or a click outside close it.
 */
export function ContextMenu(props: ContextMenuProps) {
  const { position, label, onClose, children } = props;
  const panelRef = useRef<HTMLDivElement>(null);
  const [returnFocus] = useState(() => document.activeElement as HTMLElement | null);
  const [placed, setPlaced] = useState<{ left: number; top: number } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const close = (refocus: boolean) => {
    onCloseRef.current();
    if (refocus && returnFocus?.isConnected) {
      returnFocus.focus();
    }
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) {
      return;
    }
    const { offsetWidth: width, offsetHeight: height } = panel;
    const left = Math.max(MARGIN, Math.min(position.x, window.innerWidth - width - MARGIN));
    const fitsBelow = position.y + height + MARGIN <= window.innerHeight;
    const top = fitsBelow ? position.y : Math.max(MARGIN, position.y - height);
    setPlaced({ left, top });
    panel.querySelector<HTMLElement>(ITEM_SELECTOR)?.focus({ preventScroll: true });
  }, [position.x, position.y]);

  useEffect(() => {
    const outside = (event: Event) => {
      if (!panelRef.current?.contains(event.target as Node)) {
        closeRef.current(false);
      }
    };
    const dismiss = () => closeRef.current(false);
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('scroll', outside, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      document.removeEventListener('mousedown', outside, true);
      document.removeEventListener('scroll', outside, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, []);

  const handleKeyDown = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      close(true);
      return;
    }
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    if (items.length === 0) {
      return;
    }
    const index = items.indexOf(document.activeElement as HTMLElement);
    const moves: Record<string, number> = {
      ArrowDown: (index + 1) % items.length,
      ArrowUp: (index - 1 + items.length) % items.length,
      Home: 0,
      End: items.length - 1,
    };
    if (event.key in moves) {
      event.preventDefault();
      items[moves[event.key]].focus();
    }
  };

  return createPortal(
    <div
      ref={panelRef}
      role="menu"
      aria-label={label}
      className="fixed z-50 min-w-48 max-w-80 py-1 bg-bg-secondary rounded-md shadow-lg ring-1 ring-border font-sans"
      style={placed ? { left: placed.left, top: placed.top } : { left: -9999, top: -9999 }}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <CloseMenu.Provider value={() => close(true)}>{children}</CloseMenu.Provider>
    </div>,
    document.body,
  );
}

interface ContextMenuItemProps {
  icon?: ReactNode;
  label: string;
  disabled?: boolean;
  onSelect: () => void;
}

export function ContextMenuItem(props: ContextMenuItemProps) {
  const { icon, label, disabled, onSelect } = props;
  const close = useContext(CloseMenu);

  return (
    <button
      role="menuitem"
      disabled={disabled}
      className={cn(
        'flex items-center gap-2.5 w-full px-3 py-1.5 text-xs text-left text-text-secondary outline-none transition-colors cursor-pointer',
        'focus:bg-hover focus:text-text disabled:opacity-50 disabled:cursor-default',
      )}
      onMouseEnter={(event) => event.currentTarget.focus({ preventScroll: true })}
      onClick={() => {
        close();
        onSelect();
      }}
    >
      <span className="flex w-3.5 shrink-0 justify-center">{icon}</span>
      <span className="min-w-0 truncate">{label}</span>
    </button>
  );
}

export function ContextMenuSeparator() {
  return <div role="separator" className="border-t border-border my-1" />;
}
