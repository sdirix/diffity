import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { isModalOpen } from '../../lib/dom-utils';
import { usePaletteActions, type PaletteAction } from '../../hooks/use-palette';
import { EyeIcon } from '../icons/eye-icon';
import { EyeOffIcon } from '../icons/eye-off-icon';

interface HiddenFilesChipProps {
  /** Changed files `.diffityignore` hides. */
  files: string[];
  /** Whether they are shown in the diff anyway. */
  showing: boolean;
  onShowingChange: (showing: boolean) => void;
}

/** Counts the files `.diffityignore` hides and lists them, with a toggle that shows them for this session. */
export function HiddenFilesChip(props: HiddenFilesChipProps) {
  const { files, showing, onShowingChange } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const paletteActions = useMemo<PaletteAction[]>(() => files.length === 0 ? [] : [{
    id: 'hidden-files',
    title: showing ? 'Hide files matched by .diffityignore' : 'Show files hidden by .diffityignore',
    group: 'View',
    keywords: 'diffityignore ignored generated hidden',
    icon: showing ? <EyeOffIcon className="w-3.5 h-3.5" /> : <EyeIcon className="w-3.5 h-3.5" />,
    run: () => onShowingChange(!showing),
  }], [files.length, showing, onShowingChange]);
  usePaletteActions('hidden-files', paletteActions);

  useEffect(() => {
    if (!open) {
      return;
    }
    const handleClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isModalOpen()) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  if (files.length === 0) {
    return null;
  }

  const Icon = showing ? EyeIcon : EyeOffIcon;

  return (
    <div className="relative shrink-0" ref={rootRef}>
      <button
        className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded-md transition-colors cursor-pointer',
          showing ? 'bg-accent/10 text-accent hover:bg-accent/15' : 'bg-bg-tertiary text-text-muted hover:text-text',
        )}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={showing ? 'Files matched by .diffityignore, shown for now' : 'Files hidden by .diffityignore'}
      >
        <Icon className="w-3 h-3" />
        {files.length} hidden{showing && ' shown'}
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-80 bg-bg-secondary rounded-md shadow-lg ring-1 ring-border z-50">
          <div className="px-3 pt-2 pb-1 text-text-secondary font-medium">
            {showing ? 'Matched by .diffityignore' : 'Hidden by .diffityignore'}
          </div>
          <ul className="max-h-64 overflow-y-auto pb-1">
            {files.map((path) => (
              <li key={path} className="px-3 py-0.5 font-mono text-[11px] text-text-muted truncate" title={path}>
                {path}
              </li>
            ))}
          </ul>
          <div className="flex justify-end px-3 py-2 border-t border-border">
            <button
              className="px-3 py-1 bg-bg-tertiary rounded-md text-text-secondary hover:bg-hover hover:text-text transition-colors cursor-pointer"
              onClick={() => {
                onShowingChange(!showing);
                setOpen(false);
              }}
            >
              {showing ? 'Hide again' : 'Show for this session'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
