import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export function Kbd(props: { children: ReactNode; className?: string }) {
  const { children, className } = props;

  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center min-w-6 h-5 px-1.5 bg-bg-secondary border border-border rounded font-mono text-[11px] text-text-muted shadow-[inset_0_-1px_0_var(--color-border)]',
        className,
      )}
    >
      {children}
    </kbd>
  );
}
