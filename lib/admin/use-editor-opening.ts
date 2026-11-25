"use client";

import { useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";

const EDITOR_BUSY = "正在编辑另一份，先保存或关掉再继续。";

/** Reserve the editor while its opening reads run, then recheck before applying a draft. */
export function useEditorOpening(occupied: boolean, warn: (message: string) => void) {
  const editorOpen = useRef(occupied);
  editorOpen.current = occupied;
  const intent = useRef<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const canOpen = () => {
    if (intent.current === null && !editorOpen.current) return true;
    warn(EDITOR_BUSY);
    return false;
  };
  const run = async (key: string, prepare: () => Promise<(() => void) | undefined>, stillCurrent = () => true) => {
    if (!canOpen()) return;
    const owner = useAdminAuth.getState().session?.adminId;
    intent.current = key;
    setOpening(key);
    try {
      const apply = await prepare();
      if (useAdminAuth.getState().session?.adminId !== owner || !stillCurrent()) return;
      if (editorOpen.current) {
        warn(EDITOR_BUSY);
        return;
      }
      apply?.();
    } finally {
      intent.current = null;
      setOpening(null);
    }
  };
  return { canOpen, run, opening, blocked: occupied || opening !== null ? EDITOR_BUSY : undefined };
}
