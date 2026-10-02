import { useLayoutEffect, useRef } from 'react';
import { XIcon } from '../icons/x-icon';
import { Kbd } from '../ui/kbd';
import { SHORTCUT_SECTIONS } from '../../lib/shortcuts';

interface ShortcutModalProps {
  onClose: () => void;
}

export function ShortcutModal(props: ShortcutModalProps) {
  const { onClose } = props;
  const dialogRef = useRef<HTMLDialogElement>(null);

  // A layout effect closes the dialog before it leaves the document, so focus goes back where it was.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) {
      return;
    }

    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="bg-bg text-text border border-border rounded-xl shadow-md w-[420px] max-w-[90vw] max-h-[80vh] overflow-y-auto backdrop:bg-black/60 backdrop:backdrop-blur-sm p-0 m-auto fixed inset-0 h-fit"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === dialogRef.current) {
          onClose();
        }
      }}
    >
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
        <h2 className="text-sm font-semibold">Keyboard shortcuts</h2>
        <button
          className="p-1 rounded-md text-text-muted hover:text-text hover:bg-hover cursor-pointer"
          onClick={onClose}
        >
          <XIcon className="w-4 h-4" />
        </button>
      </div>
      <div className="px-5 py-4">
        {SHORTCUT_SECTIONS.map(section => (
          <div key={section.title} className="mb-5 last:mb-0">
            <h3 className="text-[10px] font-semibold text-text-muted mb-2.5 uppercase tracking-widest">
              {section.title}
            </h3>
            <div className="flex flex-col gap-1.5">
              {section.shortcuts.map(item => (
                <div key={item.label} className="flex items-center justify-between py-0.5">
                  <span className="text-xs text-text-secondary">{item.label}</span>
                  <span className="flex items-center gap-1">
                    {item.keys.map(key => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </dialog>
  );
}
