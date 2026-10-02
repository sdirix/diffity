import { useState, useCallback, useRef } from 'react';
import { copyWithToast } from '../lib/toast';

export function useCopy(resetDelay = 2000) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const copy = useCallback((text: string, message = 'Copied') => {
    void copyWithToast(text, message).then((ok) => {
      if (!ok) {
        return;
      }
      setCopied(true);
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setCopied(false), resetDelay);
    });
  }, [resetDelay]);

  return { copied, copy };
}
