"use client";

import { useEffect, useRef, useState } from "react";
import type { ActionConfirmReq, ConfirmReq } from "@/app/components/domain-views/h-tabs/types";
import { initBusinessForm, type BusinessFormValue } from "@/app/components/domain-views/design-kit";
import { isHGrowthReadConflict } from "./h-write-conflict";

/** Bind recovery to the operation constructing this request, never a previous click. */
export function useHConflictDraft(ready: boolean, { rebaseOnConflict = false } = {}) {
  const openers = useRef(new Map<string, () => void>());
  openers.current.clear();
  const opening = useRef<string | undefined>(undefined);
  const saved = useRef<{ key: string; reason?: string; value?: string; business?: BusinessFormValue; intent?: string } | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const restoring = useRef(false);
  useEffect(() => {
    if (!pending || !ready || !saved.current) return;
    const key = saved.current.key, open = openers.current.get(key);
    if (!open) { saved.current = undefined; setPending(false); return; }
    restoring.current = true;
    opening.current = key;
    try { open(); } finally { restoring.current = false; opening.current = undefined; }
    setPending(false);
    saved.current = undefined;
  }, [pending, ready]);
  const retain = (key: string | undefined, reason: string, value?: string, business?: BusinessFormValue, intent?: string) => {
    if (!key) return;
    saved.current = { key, reason: rebaseOnConflict ? undefined : reason, value, business, intent };
    setRevision(v => v + 1);
    setPending(true);
  };
  return {
    get reopenedAfterConflict() { return restoring.current; },
    get business() { return restoring.current ? saved.current?.business : undefined; },
    get intent() { return restoring.current ? saved.current?.intent : undefined; },
    register(key: string, open: () => void) {
      openers.current.set(key, open);
      return () => {
        saved.current = undefined;
        setPending(false);
        opening.current = key;
        try { open(); } finally { opening.current = undefined; }
      };
    },
    action<T extends ActionConfirmReq>(request: T, recovering?: () => boolean): T {
      const key = opening.current;
      const draft = restoring.current ? saved.current : undefined;
      return { ...request, ...(draft ? { formKey: revision, initialReason: draft.reason ?? "",
        edit: request.edit ? { ...request.edit, initialValue: draft.value } : undefined,
        getPendingBusinessValue: () => request.getPendingBusinessValue?.() ?? (rebaseOnConflict && draft.business
          ? { ...initBusinessForm(request.businessForm), ...draft.business } : draft.business),
      } : {}), run: async (reason: string, value?: string, business?: BusinessFormValue) => {
        const original = recovering?.() ?? request.getPendingReason?.() !== undefined;
        try { return await request.run(reason, value, business); }
        catch (error) {
          if (!original && isHGrowthReadConflict(error)) {
            const initial = rebaseOnConflict && business ? initBusinessForm(request.businessForm) : undefined;
            const changes = initial && business ? Object.fromEntries(Object.entries(business).filter(([field, input]) => input !== initial[field])) : business;
            retain(key, reason, value, changes, request.rebaseValue);
          }
          throw error;
        }
      } };
    },
    confirm(request: ConfirmReq, recovering?: () => boolean): ConfirmReq {
      const key = opening.current;
      const draft = restoring.current ? saved.current : undefined;
      return { ...request, ...(draft ? { initialReason: draft.reason ?? "", formKey: revision } : {}),
        run: async (reason, value) => {
          const original = recovering?.() ?? request.getPendingReason?.() !== undefined;
          try { return await request.run(reason, value); }
          catch (error) {
            if (!original && isHGrowthReadConflict(error)) retain(key, reason, value, undefined, request.rebaseValue);
            throw error;
          }
        },
      };
    },
  };
}
