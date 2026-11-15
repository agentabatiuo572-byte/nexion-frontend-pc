"use client";

import { useEffect, useRef, useState } from "react";
import type { ActionConfirmReq, ConfirmReq } from "@/app/components/domain-views/h-tabs/types";
import type { BusinessFormValue } from "@/app/components/domain-views/design-kit";

/** Reopen an existing action from the successful replacement read, with its input. */
export function useHConflictDraft(ready: boolean) {
  const openers = useRef(new Map<string, () => void>());
  openers.current.clear();
  const selected = useRef<string | undefined>(undefined);
  const saved = useRef<{ key: string; reason: string; value?: string; business?: BusinessFormValue; intent?: string } | undefined>(undefined);
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const restoring = useRef(false);
  useEffect(() => {
    if (!pending || !ready || !saved.current) return;
    const open = openers.current.get(saved.current.key);
    if (!open) return;
    restoring.current = true;
    try { open(); } finally { restoring.current = false; }
    setPending(false);
  }, [pending, ready]);
  return {
    get business() { return restoring.current ? saved.current?.business : undefined; },
    get intent() { return restoring.current ? saved.current?.intent : undefined; },
    register(key: string, open: () => void) {
      openers.current.set(key, open);
      return () => { selected.current = key; saved.current = undefined; open(); };
    },
    retain(reason: string, value?: string, business?: BusinessFormValue, intent?: string) {
      if (!selected.current) return;
      saved.current = { key: selected.current, reason, value, business, intent };
      setRevision(v => v + 1);
      setPending(true);
    },
    action<T extends ActionConfirmReq>(request: T): T {
      const draft = restoring.current ? saved.current : undefined;
      return draft ? { ...request, formKey: revision, initialReason: draft.reason,
        edit: request.edit ? { ...request.edit, initialValue: draft.value } : undefined,
        getPendingBusinessValue: () => request.getPendingBusinessValue?.() ?? draft.business,
      } : request;
    },
    confirm(request: ConfirmReq): ConfirmReq {
      const draft = restoring.current ? saved.current : undefined;
      return draft ? { ...request, initialReason: draft.reason, formKey: revision } : request;
    },
  };
}
