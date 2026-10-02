import { useEffect, useId, useRef } from 'react';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog(props: ConfirmDialogProps) {
  const { title, message, confirmLabel = 'Undo', onConfirm, onCancel } = props;
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  const onCancelRef = useRef(onCancel);
  onCancelRef.current = onCancel;

  // Listens once, as a listener swapped while the key is dispatched would miss it.
  useEffect(() => {
    cancelRef.current?.focus();
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancelRef.current();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-bg border border-border rounded-xl shadow-lg p-5 max-w-sm w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} className="text-sm font-semibold text-text mb-1.5">{title}</h3>
        <p className="text-xs text-text-muted mb-4 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded-md border border-border text-text hover:bg-hover cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 text-xs rounded-md bg-deleted text-white hover:opacity-90 cursor-pointer"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
