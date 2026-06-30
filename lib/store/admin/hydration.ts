"use client";

import { useEffect, useState } from "react";

/**
 * Client hydration gate for components that read persisted admin UI/config state.
 * This hook is intentionally stateless: user freeze/session/voucher/ledger facts
 * must come from backend APIs, not a per-user local store.
 */
export function useOpsHydrated(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
