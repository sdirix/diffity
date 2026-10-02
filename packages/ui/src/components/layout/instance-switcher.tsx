import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '../../lib/cn';
import { instancesOptions } from '../../queries/instances';
import { ChevronDownIcon } from '../icons/chevron-down-icon';
import { GitBranchIcon } from '../icons/git-branch-icon';
import { menuItemClass } from './options-menu';

/** The instance on `port` under the host this page was opened with. */
function instanceUrl(port: number): string {
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:${port}/`;
}

/** Lists the other running diffity instances, each opening in this tab. Hidden while there are none. */
export function InstanceSwitcher() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const { data: instances = [], refetch } = useQuery(instancesOptions());

  useEffect(() => {
    if (!open) {
      return;
    }
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (instances.length === 0) {
    return null;
  }

  return (
    <div className="relative -ml-1.5 shrink-0 flex" ref={containerRef}>
      <button
        aria-expanded={open}
        aria-label="Switch repo"
        title="Switch repo"
        onClick={() => {
          if (!open) {
            void refetch();
          }
          setOpen(!open);
        }}
        className={cn(
          'p-0.5 rounded text-text-muted hover:text-text hover:bg-hover transition-colors cursor-pointer',
          open && 'bg-active text-text',
        )}
      >
        <ChevronDownIcon className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-72 py-1 bg-bg-secondary rounded-md shadow-lg ring-1 ring-border z-50">
          <div className="px-3 py-1 text-[11px] text-text-muted">Other instances</div>
          {instances.map((instance) => (
            <a key={instance.port} href={instanceUrl(instance.port)} title={instance.root} className={menuItemClass}>
              <span className="font-medium text-text truncate">{instance.name}</span>
              {instance.branch && (
                <span className="inline-flex items-center gap-1 min-w-0 font-mono text-[11px] text-text-muted">
                  <GitBranchIcon className="w-3 h-3 shrink-0" />
                  <span className="truncate">{instance.branch}</span>
                </span>
              )}
              <span className="ml-auto pl-2 text-text-muted tabular-nums">:{instance.port}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
