"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const PENDING_MS = 2500;

export function usePending(signal: unknown): [boolean, (run: () => void) => void] {
  const [sentAt, setSentAt] = useState<{ signal: unknown } | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const start = useCallback(
    (run: () => void) => {
      run();
      setSentAt({ signal });
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setSentAt(null), PENDING_MS);
    },
    [signal],
  );
  return [sentAt !== null && Object.is(sentAt.signal, signal), start];
}
