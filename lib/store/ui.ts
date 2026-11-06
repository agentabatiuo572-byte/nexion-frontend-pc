"use client";

/**
 * 全局 UI store — toast + confirm。提供可在任意 handler 直接调用(免 hook)的
 * toast.* / confirm() 助手。Host 组件 <ToastHost>/<ConfirmDialog> 在 root layout 挂载一次。
 */
import type { ReactNode } from "react";
import { create } from "zustand";

export type ToastKind = "success" | "info" | "warn" | "error";

export interface Toast {
  id: string;
  key?: string;
  kind: ToastKind;
  title: string;
  description?: string;
  durationMs: number;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  content?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  hideCancel?: boolean;
}

interface ConfirmInternal extends ConfirmOptions {
  id: string;
  resolve: (ok: boolean) => void;
}

interface UIStore {
  toasts: Toast[];
  pushToast: (t: Omit<Toast, "id" | "durationMs"> & { durationMs?: number }) => string;
  dismissToast: (id: string) => void;
  pauseToast: (id: string) => void;
  resumeToast: (id: string) => void;
  dismissToasts: () => void;
  dialogs: string[];
  openDialog: (id: string) => void;
  closeDialog: (id: string) => void;

  confirmQueue: ConfirmInternal[];
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  resolveConfirm: (id: string, ok: boolean) => void;
}

let toastSeq = 0;
let confirmSeq = 0;
const toastTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useUI = create<UIStore>((set, get) => ({
  toasts: [],

  pushToast: (t) => {
    if (t.key) {
      for (const old of get().toasts) if (old.key === t.key) get().dismissToast(old.id);
    }
    const id = `tst-${++toastSeq}`;
    const durationMs = t.durationMs ?? 3000;
    set((s) => ({ toasts: [...s.toasts, { ...t, id, durationMs }] }));
    if (durationMs > 0) {
      toastTimers.set(id, setTimeout(() => get().dismissToast(id), durationMs));
    }
    return id;
  },

  dismissToast: (id) => {
    get().pauseToast(id);
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
  pauseToast: (id) => {
    clearTimeout(toastTimers.get(id));
    toastTimers.delete(id);
  },
  resumeToast: (id) => {
    get().pauseToast(id);
    const toast = get().toasts.find((item) => item.id === id);
    if (toast && toast.durationMs > 0) toastTimers.set(id, setTimeout(() => get().dismissToast(id), toast.durationMs));
  },
  dismissToasts: () => {
    for (const timer of toastTimers.values()) clearTimeout(timer);
    toastTimers.clear();
    set({ toasts: [] });
  },
  dialogs: [],
  openDialog: (id) => {
    get().dismissToasts();
    set((s) => ({ dialogs: [...s.dialogs, id] }));
  },
  closeDialog: (id) => set((s) => ({ dialogs: s.dialogs.filter((dialog) => dialog !== id) })),

  confirmQueue: [],

  confirm: (opts) =>
    new Promise<boolean>((resolve) => {
      const id = `cnf-${++confirmSeq}`;
      set((s) => ({ confirmQueue: [...s.confirmQueue, { ...opts, id, resolve }] }));
    }),

  resolveConfirm: (id, ok) => {
    const item = get().confirmQueue.find((c) => c.id === id);
    if (!item) return; // 已被解析(防 backdrop 连点重复 resolve)
    set((s) => ({ confirmQueue: s.confirmQueue.filter((c) => c.id !== id) }));
    item.resolve(ok);
  },
}));

// 可在任意位置直接调用,无需 hook
export const toast = {
  success: (title: string, description?: string) =>
    useUI.getState().pushToast({ kind: "success", title, description }),
  info: (title: string, description?: string) =>
    useUI.getState().pushToast({ kind: "info", title, description }),
  warn: (title: string, description?: string) =>
    useUI.getState().pushToast({ kind: "warn", title, description }),
  error: (title: string, description?: string) =>
    useUI.getState().pushToast({ kind: "error", title, description }),
};

export const confirm = (opts: ConfirmOptions): Promise<boolean> =>
  useUI.getState().confirm(opts);
