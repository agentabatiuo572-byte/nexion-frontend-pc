"use client";

import { useId, useLayoutEffect } from "react";
import { useUI } from "@/lib/store/ui";

/** 开框前清掉旧提示；后来的反馈由最上层框内的 ToastHost 显示，随内容排版。 */
export function useDialogFeedback(open: boolean | string = true) {
  const id = useId();
  useLayoutEffect(() => {
    if (!open) return;
    useUI.getState().openDialog(id);
    return () => useUI.getState().closeDialog(id);
  }, [id, open]);
  return id;
}
