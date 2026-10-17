"use client";

import { useEffect, useState } from "react";

export type RemoteList<T> = { status: "loading" | "error" } | { status: "done"; data: T };

export function useRemoteList<T>(url: string, parse: (body: unknown) => T) {
  const [state, setState] = useState<RemoteList<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });
    fetch(url, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<unknown>;
      })
      .then((body) => setState({ status: "done", data: parse(body) }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    return () => controller.abort();
  }, [url, parse, attempt]);

  return { state, retry: () => setAttempt((n) => n + 1) };
}
