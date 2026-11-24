"use client";

import { useEffect, useRef, useState } from "react";
import type { ActionConfirmReq, ConfirmReq } from "@/app/components/domain-views/h-tabs/types";
import { initBusinessForm, type BusinessFormValue } from "@/app/components/domain-views/design-kit";
import { isH4ReadConflict, isHGrowthReadConflict } from "./h-write-conflict";

/** Bind recovery to the operation constructing this request, never a previous click. */
export function useHConflictDraft(ready: boolean, { readConflict }: {
  readConflict?: (afterRead: (beforeOpen: () => void) => Promise<boolean>, kind: "action" | "confirm", request: ActionConfirmReq | ConfirmReq) => Error;
} = {}) {
  const openers = useRef(new Map<string, () => void>());
  openers.current.clear();
  const opening = useRef<string | undefined>(undefined);
  const saved = useRef<{ key: string; reason?: string; value?: string; business?: BusinessFormValue; intent?: string;
    recovery?: { beforeOpen: () => void; done: (found: boolean) => void } } | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const restoring = useRef(false);
  useEffect(() => {
    if (!pending || !ready || !saved.current) return;
    const { key, recovery } = saved.current, open = openers.current.get(key);
    if (!open) { recovery?.done(false); saved.current = undefined; setPending(false); return; }
    recovery?.beforeOpen();
    restoring.current = true;
    opening.current = key;
    try { open(); } finally { restoring.current = false; opening.current = undefined; recovery?.done(true); }
    setPending(false);
    saved.current = undefined;
  }, [pending, ready]);
  const retain = (key: string | undefined, reason: string, value?: string, business?: BusinessFormValue, intent?: string, recovery?: NonNullable<typeof saved.current>["recovery"]) => {
    if (!key) { recovery?.beforeOpen(); recovery?.done(true); return; }
    saved.current = { key, reason: readConflict ? undefined : reason, value, business, intent, recovery };
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
        getPendingBusinessValue: () => request.getPendingBusinessValue?.() ?? (readConflict && draft.business
          ? { ...initBusinessForm(request.businessForm), ...draft.business } : draft.business),
      } : {}), run: async (reason: string, value?: string, business?: BusinessFormValue) => {
        const original = recovering?.() ?? request.getPendingReason?.() !== undefined;
        try { return await request.run(reason, value, business); }
        catch (error) {
          if (!original && (readConflict ? isH4ReadConflict(error) : isHGrowthReadConflict(error))) {
            const initial = readConflict && business ? initBusinessForm(request.businessForm) : undefined;
            const changes = initial && business ? Object.fromEntries(Object.entries(business).filter(([field, input]) => input !== initial[field])) : business;
            if (readConflict) throw readConflict(beforeOpen => new Promise(done => retain(key, reason, value, changes, request.rebaseValue, { beforeOpen, done })), "action", request);
            retain(key, reason, value, changes, request.rebaseValue);
          }
          throw error;
        }
      } };
    },
    confirm(request: ConfirmReq, recovering?: () => boolean): ConfirmReq {
      const key = opening.current;
      const draft = restoring.current ? saved.current : undefined;
      return { ...request, ...(draft ? { initialReason: draft.reason ?? "", formKey: revision,
        ...(readConflict && draft.value !== undefined ? { initialInputValue: draft.value } : {}), } : {}),
        run: async (reason, value) => {
          const original = recovering?.() ?? request.getPendingReason?.() !== undefined;
          try { return await request.run(reason, value); }
          catch (error) {
            if (!original && (readConflict ? isH4ReadConflict(error) : isHGrowthReadConflict(error))) {
              if (readConflict) throw readConflict(beforeOpen => new Promise(done => retain(key, reason, value, undefined, request.rebaseValue, { beforeOpen, done })), "confirm", request);
              retain(key, reason, value, undefined, request.rebaseValue);
            }
            throw error;
          }
        },
      };
    },
  };
}
