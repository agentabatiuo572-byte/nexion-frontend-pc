import { useCallback, useEffect, useState, type RefObject } from "react";
import { displayAdminReadError } from "@/lib/admin/error-messages";

export type CatalogSource = "products" | "gates" | "discount" | "early";
export type CatalogReadOptions = { readback?: { commandKey: string; object: string }; conflict?: boolean };
type Request<T> = CatalogReadOptions & { resolve: (value: T | null) => void };

type ReadPolicy = {
  allowed: boolean;
  checkingReceipts: boolean;
  confirming: boolean;
  sending: RefObject<string>;
  busy: string;
};

// Each instance owns one source. All arrivals during an active read share its next read.
export function useCatalogSource<T>(fetchValue: () => Promise<T>, policy: ReadPolicy) {
  const { allowed, checkingReceipts, confirming, sending, busy } = policy;
  const [state, setState] = useState<{
    queued: Request<T>[]; active: Request<T>[] | null;
    value: T | null; error: string | null; readAt: number | null;
  }>({ queued: [], active: null, value: null, error: null, readAt: null });

  const request = useCallback((options: CatalogReadOptions) => new Promise<T | null>(resolve => {
    setState(current => ({ ...current, queued: [...current.queued, { ...options, resolve }] }));
  }), []);

  const { queued, active } = state;
  const ready = allowed && queued.length > 0 && !checkingReceipts && (!confirming || queued.some(r => r.conflict));
  useEffect(() => {
    if (active || !ready || queued.some(r => r.readback?.commandKey === sending.current)) return;
    setState(current => current.queued === queued && !current.active
      ? { ...current, active: queued, queued: [], error: null }
      : current);
  }, [active, ready, queued, sending, busy]);

  useEffect(() => {
    if (!active) return;
    const read = async () => {
      let value: T | null = null;
      let error: string | null = null;
      try { value = await fetchValue(); }
      catch (failure) { error = displayAdminReadError(failure); }
      const readAt = Date.now();
      setState(current => ({ ...current, active: null, value, error, readAt: error ? current.readAt : readAt }));
      active.forEach(r => r.resolve(value));
    };
    void read();
  }, [active, fetchValue]);

  return {
    request, value: state.value, error: state.error, readAt: state.readAt,
    loading: allowed && (!!active || ready || (!state.value && !state.error)),
    readbacks: [...(active ?? []), ...queued].flatMap(r => r.readback ?? []),
  };
}
