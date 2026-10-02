import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { cn } from '../../lib/cn';

/** Placeholders stay invisible this long (see `.skeleton` in app.css), so loads that finish sooner never flash. */
const SKELETON_DELAY_MS = 150;

interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
  circle?: boolean;
}

/**
 * A loading placeholder of fixed size. It stays invisible for the first
 * 150ms, then shows a quiet shimmer, static with reduced motion. Give it
 * the size of what it stands in for.
 */
export function Skeleton(props: SkeletonProps) {
  const { className, style, circle } = props;

  return (
    <span
      aria-hidden
      className={cn('skeleton block shrink-0', circle ? 'rounded-full' : 'rounded', className)}
      style={style}
    />
  );
}

/**
 * Class for content that replaces a placeholder. It fades in only when the
 * placeholder was on screen, so content that loads fast or comes from the
 * cache shows at once.
 */
export function useRevealClass(loading: boolean): string {
  const loadingSince = useRef<number | null>(null);
  const reveal = useRef(false);
  if (loading) {
    loadingSince.current ??= Date.now();
    reveal.current = false;
  } else if (loadingSince.current !== null) {
    reveal.current = Date.now() - loadingSince.current >= SKELETON_DELAY_MS;
    loadingSince.current = null;
  }
  return reveal.current ? 'reveal' : '';
}

/** True once `ms` have passed since mount, for hints that only help when a load is slow. */
export function useElapsed(ms: number): boolean {
  const [mountedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setElapsed(true), Math.max(0, ms - (Date.now() - mountedAt)));
    return () => clearTimeout(timer);
  }, [ms, mountedAt]);

  return elapsed;
}
