import { useState, useCallback } from 'react';

export function useCopyToClipboard(resetDelay = 1500) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copy = useCallback(
    async (text: string, id: string) => {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => {
        setCopiedId((prev) => (prev === id ? null : prev));
      }, resetDelay);
    },
    [resetDelay]
  );

  return { copiedId, copy };
}
