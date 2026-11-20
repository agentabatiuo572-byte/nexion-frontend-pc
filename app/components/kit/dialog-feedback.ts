"use client";

import { useId, useLayoutEffect } from "react";
import { useUI } from "@/lib/store/ui";

/** 开框前清掉普通提示；常驻提示等关框后恢复，新的普通反馈显示在最上层框内。 */
export function useDialogFeedback(open: boolean | string = true) {
  const id = useId();
  useLayoutEffect(() => {
    if (!open) return;
    useUI.getState().openDialog(id);
    return () => useUI.getState().closeDialog(id);
  }, [id, open]);
  return id;
}
