"use client";

import { useEffect, useRef, useState } from "react";
import type { ActionConfirmReq, ConfirmReq } from "@/app/components/domain-views/h-tabs/types";
import { initBusinessForm, type BusinessFormValue } from "@/app/components/domain-views/design-kit";
import { isH4ReadConflict, isHGrowthReadConflict } from "./h-write-conflict";
import { ConfirmReadConflict, PendingConfirmRejected } from "./h-conflict-review";

export type RejectedH4Draft = { reason?: string; value?: string; business?: BusinessFormValue; intent?: string; rejection?: PendingConfirmRejected };

function reviewPendingConflict(getRecovery: ActionConfirmReq["getPendingRecovery"], rebase: (error: PendingConfirmRejected) => Error) {
  if (!getRecovery) return;
  return () => {
    const recovery = getRecovery();
    const query = recovery?.query;
    if (!query) return recovery;
    return { ...recovery, query: async () => {
      try { await query(); }
      catch (error) { throw error instanceof PendingConfirmRejected && isH4ReadConflict(error) ? rebase(error) : error; }
    } };
  };
}

/** Bind recovery to the operation constructing this request, never a previous click. */
export function useHConflictDraft(ready: boolean, { readConflict }: {
  readConflict?: (afterRead: (beforeOpen: () => void) => Promise<boolean>, kind: "action" | "confirm", request: ActionConfirmReq | ConfirmReq, key?: string) => ConfirmReadConflict;
} = {}) {
  const openers = useRef(new Map<string, () => void>());
  openers.current.clear();
  const opening = useRef<string | undefined>(undefined);
  const saved = useRef<RejectedH4Draft & { key: string;
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
    get reopenedAfterConflict() { return restoring.current && !saved.current?.rejection; },
    get business() { return restoring.current ? saved.current?.business : undefined; },
    get intent() { return restoring.current ? saved.current?.intent : undefined; },
    get rejection() { return restoring.current ? saved.current?.rejection : undefined; },
    reopen(key: string, draft: RejectedH4Draft, beforeOpen: () => void) {
      const open = openers.current.get(key);
      if (!open) return false;
      beforeOpen();
      saved.current = { ...draft, key };
      restoring.current = true;
      opening.current = key;
      try { open(); }
      finally { restoring.current = false; opening.current = undefined; saved.current = undefined; }
      return true;
    },
    register(key: string, open: () => void) {
      openers.current.set(key, open);
      return () => {
        saved.current = undefined;
        setPending(false);
        opening.current = key;
        try { open(); } finally { opening.current = undefined; }
      };
    },
    action<T extends ActionConfirmReq>(request: T, recovering?: () => boolean, restored?: RejectedH4Draft): T {
      const key = opening.current;
      const draft = restored ?? (restoring.current ? saved.current : undefined);
      let attempted: { reason: string; value?: string; business?: BusinessFormValue } | undefined;
      const rebase = (reason: string, value?: string, business?: BusinessFormValue) => {
        const initial = business ? initBusinessForm(request.businessForm) : undefined;
        const changes = initial && business ? Object.fromEntries(Object.entries(business).filter(([field, input]) => input !== initial[field])) : business;
        return readConflict?.(beforeOpen => new Promise(done => retain(key, reason, value, changes, request.rebaseValue, { beforeOpen, done })), "action", request, key);
      };
      const rejection = draft?.rejection;
      const initialRejection = rejection && !request.edit?.review && isH4ReadConflict(rejection)
        ? readConflict?.(beforeOpen => new Promise(done => retain(key, "", draft.value, draft.business, draft.intent, { beforeOpen, done })), "action", request, key) : rejection;
      return { ...request, ...(draft ? { formKey: revision, initialReason: draft.reason ?? "", initialRejection,
        edit: request.edit ? { ...request.edit, initialValue: draft.value } : undefined,
        getPendingBusinessValue: () => {
          const pending = request.getPendingBusinessValue?.();
          if (pending || !readConflict || !draft.business) return pending ?? draft.business;
          const fields = initBusinessForm(request.businessForm);
          return Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, draft.business?.[field] ?? value]));
        },
      } : {}), ...(readConflict ? { getPendingRecovery: reviewPendingConflict(request.getPendingRecovery,
        error => attempted ? rebase(attempted.reason, attempted.value, attempted.business) ?? error : error) } : {}), run: async (reason: string, value?: string, business?: BusinessFormValue) => {
        const original = recovering?.() ?? request.getPendingReason?.() !== undefined;
        if (!original && readConflict) attempted = { reason, value, business };
        try { return await request.run(reason, value, business); }
        catch (error) {
          if (!original && !request.edit?.review && (readConflict ? isH4ReadConflict(error) : isHGrowthReadConflict(error))) {
            if (readConflict) throw rebase(reason, value, business);
            retain(key, reason, value, business, request.rebaseValue);
          }
          throw error;
        }
      } };
    },
    confirm(request: ConfirmReq, recovering?: () => boolean): ConfirmReq {
      const key = opening.current;
      const draft = restoring.current ? saved.current : undefined;
      let attempted: { reason: string; value?: string } | undefined;
      const rebase = (reason: string, value?: string) => readConflict?.(beforeOpen => new Promise(done => retain(key, reason, value, undefined, request.rebaseValue, { beforeOpen, done })), "confirm", request, key);
      const rejection = draft?.rejection;
      return { ...request, ...(readConflict ? { getPendingRecovery: reviewPendingConflict(request.getPendingRecovery,
        error => attempted ? rebase(attempted.reason, attempted.value) ?? error : error) } : {}), ...(draft ? { initialReason: draft.reason ?? "", formKey: revision,
        initialRejection: rejection && isH4ReadConflict(rejection) ? rebase("", draft.value) : rejection,
        ...(readConflict && draft.value !== undefined ? { initialInputValue: draft.value } : {}), } : {}),
        run: async (reason, value) => {
          const original = recovering?.() ?? request.getPendingReason?.() !== undefined;
          if (!original && readConflict) attempted = { reason, value };
          try { return await request.run(reason, value); }
          catch (error) {
            if (!original && (readConflict ? isH4ReadConflict(error) : isHGrowthReadConflict(error))) {
              if (readConflict) throw rebase(reason, value);
              retain(key, reason, value, undefined, request.rebaseValue);
            }
            throw error;
          }
        },
      };
    },
  };
}
