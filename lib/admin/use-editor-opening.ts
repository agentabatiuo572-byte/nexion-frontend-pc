"use client";

import { useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";

const EDITOR_BUSY = "正在编辑另一份，先保存或关掉再继续。";
const OPENING = "正在打开，稍等。";
/** 打开前的读取最多等这么久，到时放开入口。 */
const OPEN_TIMEOUT_MS = 15_000;
const TIMED_OUT = Symbol("editor-opening-timeout");

/** Reserve the editor while its opening reads run, then recheck before applying a draft. */
export function useEditorOpening(occupied: boolean, warn: (message: string) => void) {
  const editorOpen = useRef(occupied);
  editorOpen.current = occupied;
  const intent = useRef<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const canOpen = () => {
    if (intent.current === null && !editorOpen.current) return true;
    warn(editorOpen.current ? EDITOR_BUSY : OPENING);
    return false;
  };
  const run = async (key: string, prepare: () => Promise<(() => void) | undefined>, stillCurrent = () => true) => {
    if (!canOpen()) return;
    const owner = useAdminAuth.getState().session?.adminId;
    intent.current = key;
    setOpening(key);
    let timer: number | undefined;
    try {
      const apply = await Promise.race([prepare(), new Promise<typeof TIMED_OUT>(resolve => { timer = window.setTimeout(() => resolve(TIMED_OUT), OPEN_TIMEOUT_MS); })]);
      if (apply === TIMED_OUT) { warn("打开时读取超时，请再试一次。"); return; }
      if (useAdminAuth.getState().session?.adminId !== owner || !stillCurrent()) return;
      if (editorOpen.current) {
        warn(EDITOR_BUSY);
        return;
      }
      apply?.();
    } finally {
      window.clearTimeout(timer);
      intent.current = null;
      setOpening(null);
    }
  };
  return { canOpen, run, opening, blocked: occupied ? EDITOR_BUSY : opening !== null ? OPENING : undefined };
}
