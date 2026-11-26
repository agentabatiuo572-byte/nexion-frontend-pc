"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { displayAdminReadError } from "./error-messages";

type ReadSource<T> = {
  key: string;
  data: T | null;
  at: string | null;
  loading: boolean;
  error: string | null;
  autoFailures: number;
  afterMark?: "handled" | "resolved";
};

function empty<T>(key: string): ReadSource<T> {
  return { key, data: null, at: null, loading: true, error: null, autoFailures: 0 };
}

/** Keep the last success for this source and query. A different query or account starts empty. */
export function useB5Read<T>(key: string, read: () => Promise<T>, enabled = true) {
  const [snapshot, setSnapshot] = useState(() => empty<T>(key));
  const request = useRef(0);

  const setData = useCallback((data: T) => {
    const at = new Date().toISOString();
    setSnapshot({ key, data, at, loading: false, error: null, autoFailures: 0 });
  }, [key]);

  const reload = useCallback(async (cause?: "auto" | "handled" | "resolved") => {
    if (!enabled) return null;
    const sequence = ++request.current;
    setSnapshot(current => current.key === key ? { ...current, loading: true } : empty<T>(key));
    try {
      const data = await read();
      if (sequence !== request.current) return null;
      setData(data);
      return data;
    } catch (error) {
      if (sequence !== request.current) return null;
      setSnapshot(current => ({ ...current, loading: false, error: displayAdminReadError(error),
        autoFailures: cause === "auto" ? current.autoFailures + 1 : 0,
        afterMark: cause === "handled" || cause === "resolved" ? cause : current.afterMark }));
      return null;
    }
  }, [enabled, key, read, setData]);

  useEffect(() => {
    void reload();
    return () => { request.current += 1; };
  }, [reload]);

  const current = snapshot.key === key && enabled ? snapshot : empty<T>(key);
  const stale = current.error && current.at ? {
    at: current.at, auto: current.autoFailures >= 2, afterMark: current.afterMark,
  } : undefined;
  return { ...current, stale, reload, setData };
}
