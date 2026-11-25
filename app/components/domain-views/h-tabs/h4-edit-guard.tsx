"use client";

/**
 * H4 页面一级的离开守卫（OP-29）：切页签、切旧版子页签、打开另一个抽屉、站内链接、后退、刷新，都先处理正在改的抽屉；
 * 同一时间只有一个抽屉在改，只有一个离开框。
 * 抽屉用 useH4Editor 登记自己；要换去别处的入口用 attempt 包一层，关抽屉用 askClose。
 */
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LeaveDialog, useLeaveGuard, type EditorSwitch } from "../i-tabs/i5-writes";

export type H4Editor = {
  /** 这个抽屉改的是哪个对象（和原操作记录的 scope 同一写法）。 */
  scope: string;
  /** 改过、还没保存：和保存按钮同一个判断。 */
  dirty: boolean;
  /** 离开框保存按钮的完整名字，按这次保存的真实生效方式（OP-29）。 */
  saveName: string;
  saveReason?: string;
  close: () => void;
  save: (saved: () => void) => void;
};

type H4EditGuard = {
  report: (id: string, editor: H4Editor | null) => void;
  /** 关抽屉：改过先问。 */
  askClose: () => void;
  /** 换去别处：改过先问，没改直接去。 */
  attempt: (next: () => void) => void;
  /** 有另一个对象的改动没处理：这条原操作要打开的抽屉会顶掉它。 */
  otherDirty: (scope: string) => boolean;
};

const GuardContext = createContext<H4EditGuard>({ report: () => {}, askClose: () => {}, attempt: (next) => next(), otherDirty: () => false });
export const useH4EditGuard = () => useContext(GuardContext);

export function useH4Editor(editor: H4Editor | null) {
  const { report } = useH4EditGuard();
  const id = useId();
  // 每次提交后把最新的回调和状态报给页面；页面只在状态变了才重画。
  useLayoutEffect(() => { report(id, editor); });
  useLayoutEffect(() => () => report(id, null), [report, id]);
}

export function useH4EditHost(confirmOpen: boolean): H4EditGuard & { provide: (children: ReactNode) => ReactNode } {
  const editors = useRef(new Map<string, H4Editor>());
  const [, changed] = useState(0);
  const current = [...editors.current.values()].find((editor) => editor.dirty);
  const switcher = useRef<EditorSwitch | null>(null);
  const guard = useLeaveGuard(!!current, () => editors.current.forEach((editor) => editor.close()), switcher);
  const latest = useRef(guard);
  latest.current = guard;
  // 确认框从离开框打开，或抽屉主按钮变灰重画，原按钮已不在：确认框关掉后抽屉还开着，焦点回抽屉，不落到页面底（CP-66）。
  const confirmed = useRef(false);
  useEffect(() => {
    const closed = confirmed.current && !confirmOpen;
    confirmed.current = confirmOpen;
    if (!closed) return;
    const timer = window.setTimeout(() => {
      if (document.activeElement === document.body) document.querySelector<HTMLElement>(".rd-drawer[data-state='open']")?.focus();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [confirmOpen]);
  // 点到外面的控件时，这一下的动作由控件自己处理（页签、链接先问再去）；点空白处才当作关抽屉。
  const onControl = useRef(false);
  useEffect(() => {
    const mark = (event: PointerEvent) => {
      onControl.current = event.target instanceof Element && event.target.closest(".rd-drawer, .rd-modal") === null
        && event.target.closest('button, a[href], [role="tab"], input, select, textarea, label, summary') !== null;
      window.setTimeout(() => { onControl.current = false; }, 0);
    };
    document.addEventListener("pointerdown", mark, true);
    return () => document.removeEventListener("pointerdown", mark, true);
  }, []);
  const report = useCallback((id: string, editor: H4Editor | null) => {
    const before = editors.current.get(id);
    if (editor) editors.current.set(id, editor); else editors.current.delete(id);
    if (before?.dirty !== editor?.dirty || before?.saveName !== editor?.saveName || before?.saveReason !== editor?.saveReason) changed((value) => value + 1);
  }, []);
  const value = useMemo<H4EditGuard>(() => ({
    report,
    askClose: () => {
      if (onControl.current && [...editors.current.values()].some((editor) => editor.dirty)) return;
      latest.current.askClose();
    },
    attempt: (next) => { if (switcher.current) switcher.current.attempt(next); else next(); },
    otherDirty: (scope) => [...editors.current.values()].some((editor) => editor.dirty && editor.scope !== scope),
  }), [report]);
  return {
    ...value,
    provide: (children) => <GuardContext.Provider value={value}>
      {children}
      <LeaveDialog guard={guard} saveName={current?.saveName} discardLabel="放弃改动并返回" saveBlocked={current?.saveReason} onSave={(saved) => current?.save(saved)} />
    </GuardContext.Provider>,
  };
}
