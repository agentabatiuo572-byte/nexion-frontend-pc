import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import ts from "typescript";
import { adminShellSessionKey } from "../lib/admin/shell-authorities";
import {
  isCurrentAccountDeletionListRead,
  isCurrentAccountDeletionSelection,
  syncSelectedAccountDeletion,
} from "../app/components/domain-views/c-tabs/account-deletion-queue-state";

type Request = { requestNo: string; userId: number; status: string; version: number; reason?: string };
type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };
type Session = { adminId: number; role: string; authorities: string[] };
type Element = { type: unknown; props: Record<string, any> };

function elements(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(elements);
  if (!value || typeof value !== "object" || !("props" in value)) return [];
  const element = value as Element;
  return [element, ...elements(element.props.children)];
}

function textContent(value: unknown): string {
  if (Array.isArray(value)) return value.map(textContent).join("");
  if (value && typeof value === "object" && "props" in value) return textContent((value as Element).props.children);
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function button(harness: ReturnType<typeof actualQueueHarness>, label: string): Element {
  const found = elements(harness.current.ui).find((element) => element.type === "button" && textContent(element) === label);
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  return { promise: new Promise<T>((yes, no) => { resolve = yes; reject = no; }), resolve, reject };
}

const row = (requestNo: string, version: number, status = "REQUESTED"): Request => ({ requestNo, userId: 1, version, status });
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };

function actualQueueHarness(deps: {
  list: ReturnType<typeof vi.fn>;
  detail: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  toast: ReturnType<typeof vi.fn>;
}) {
  const source = readFileSync(new URL("../app/components/domain-views/c-tabs/account-deletion-queue.tsx", import.meta.url), "utf8");
  const checkpoint = "  if (!canRead) return null;";
  if (!source.includes(checkpoint)) throw new Error("Actual queue lifecycle handlers not found");
  const handlerSource = source.replace(checkpoint, `  capture({ selected, rows, total, loading, error, reason, refresh, openDetail, closeDetail, act, changeStatus, changePage, setReason,
    detailRead: typeof detailRead === "undefined" ? undefined : detailRead });\n${checkpoint}`);
  const compiled = ts.transpileModule(handlerSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;

  const hooks: Array<{ value?: unknown; deps?: readonly unknown[] }> = [];
  let cursor = 0;
  let rendering = false;
  let rerenderRequested = false;
  let current: Record<string, unknown>;
  let auth: { session: Session | null; authEpoch: number } = { session: { adminId: 1, role: "superadmin", authorities: [] }, authEpoch: 1 };
  const sameDeps = (left?: readonly unknown[], right?: readonly unknown[]) => left !== undefined && right !== undefined && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const queuedEffects: Array<() => void> = [];
  const render = () => {
    if (rendering) { rerenderRequested = true; return; }
    do {
      rerenderRequested = false;
      rendering = true;
      cursor = 0;
      const ui = Queue({ toast: deps.toast });
      current.ui = ui;
      rendering = false;
      while (queuedEffects.length) queuedEffects.shift()!();
    } while (rerenderRequested);
  };
  const useState = <T,>(initial: T) => {
    const slot = cursor++;
    if (!(slot in hooks)) hooks[slot] = { value: initial };
    const set = (next: T | ((previous: T) => T)) => {
      const previous = hooks[slot].value as T;
      hooks[slot].value = typeof next === "function" ? (next as (value: T) => T)(previous) : next;
      render();
    };
    return [hooks[slot].value as T, set] as const;
  };
  const useRef = <T,>(initial: T) => {
    const slot = cursor++;
    if (!(slot in hooks)) hooks[slot] = { value: { current: initial } };
    return hooks[slot].value as { current: T };
  };
  const useCallback = <T extends (...args: never[]) => unknown>(callback: T, depsArray: readonly unknown[]) => {
    const slot = cursor++;
    const previous = hooks[slot];
    if (!previous || !sameDeps(previous.deps, depsArray)) hooks[slot] = { value: callback, deps: depsArray };
    return hooks[slot].value as T;
  };
  const useEffect = (effect: () => void, depsArray: readonly unknown[]) => {
    const slot = cursor++;
    const previous = hooks[slot];
    if (!previous || !sameDeps(previous.deps, depsArray)) {
      hooks[slot] = { deps: depsArray };
      queuedEffects.push(effect);
    }
  };
  const useAdminAuth = Object.assign((selector: (state: typeof auth) => unknown) => selector(auth), { getState: () => auth });
  const exports: Record<string, any> = {};
  const jsx = (type: unknown, props: Record<string, any>) => ({ type, props });
  new Function("require", "exports", "capture", compiled)((name: string) => {
    if (name === "react") return { useCallback, useEffect, useRef, useState };
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
    if (name.endsWith("design-kit")) return { Drawer: "drawer" };
    if (name.endsWith("error-messages")) return { displayAdminError: (cause: unknown) => cause instanceof Error ? cause.message : String(cause) };
    if (name.endsWith("store/admin-auth")) return { useAdminAuth };
    if (name.endsWith("shell-authorities")) return { adminShellSessionKey };
    if (name.endsWith("account-deletion-client")) return { ACCOUNT_DELETION_STATUSES: ["REQUESTED", "IN_REVIEW", "BLOCKED", "COMPLETED", "CANCELLED"], fetchAccountDeletion: deps.detail, fetchAccountDeletions: deps.list, updateAccountDeletion: deps.update };
    if (name.endsWith("account-deletion-queue-state")) return { isCurrentAccountDeletionListRead, isCurrentAccountDeletionSelection, syncSelectedAccountDeletion };
    throw new Error(`Unexpected import ${name}`);
  }, exports, (snapshot: Record<string, unknown>) => { current = snapshot; });
  const Queue = exports.AccountDeletionQueue;
  render();
  return {
    get current() { return current; },
    changeAuth(session: Session | null, authEpoch = auth.authEpoch, rerender = true) {
      auth = { session, authEpoch };
      if (rerender) render();
    },
  };
}

describe("actual account-deletion queue lifecycle handlers", () => {
  it("blocks an in-flight detail even with a reason, then persists failure without showing cached detail", async () => {
    const pending = deferred<Request>();
    const update = vi.fn().mockResolvedValue(row("A", 2, "IN_REVIEW"));
    const harness = actualQueueHarness({ list: vi.fn().mockResolvedValue({ records: [row("A", 1)], total: 1 }), detail: vi.fn(() => pending.promise), update, toast: vi.fn() });
    await settle();
    const reading = (harness.current.openDetail as (item: Request) => Promise<void>)(row("A", 1));
    (harness.current.setReason as (reason: string) => void)("review evidence");
    await (harness.current.act as (action: "review") => Promise<void>)("review");
    expect(update).not.toHaveBeenCalled();
    expect(button(harness, "开始审核").props.disabled).toBe(true);
    expect(textContent(harness.current.ui)).toContain("正在读取申请详情");
    pending.reject(new Error("INTERNAL_SERVER_ERROR"));
    await reading;
    expect(textContent(harness.current.ui)).toContain("详情读取失败");
    expect(textContent(harness.current.ui)).not.toContain("INTERNAL_SERVER_ERROR");
    expect(elements(harness.current.ui).some((element) => element.props.className === "kv" && textContent(element).includes("CAS 版本"))).toBe(false);
    expect(button(harness, "重试").props.disabled).toBe(false);
    await (harness.current.act as (action: "review") => Promise<void>)("review");
    expect(update).not.toHaveBeenCalled();
    expect(button(harness, "开始审核").props.disabled).toBe(true);
  });

  it("keeps failure locked after filling a reason and restores the valid CAS flow through retry", async () => {
    const retry = deferred<Request>();
    const detail = vi.fn().mockRejectedValueOnce(new Error("500")).mockReturnValueOnce(retry.promise);
    const update = vi.fn().mockResolvedValue(row("A", 3, "IN_REVIEW"));
    const list = vi.fn().mockResolvedValue({ records: [row("A", 1)], total: 1 });
    const harness = actualQueueHarness({ list, detail, update, toast: vi.fn() });
    await settle();
    await (harness.current.openDetail as (item: Request) => Promise<void>)(row("A", 1));
    (harness.current.setReason as (reason: string) => void)("  reviewed evidence  ");
    await (harness.current.act as (action: "review") => Promise<void>)("review");
    expect(update).not.toHaveBeenCalled();
    expect(button(harness, "开始审核").props.disabled).toBe(true);
    button(harness, "重试").props.onClick();
    expect(detail).toHaveBeenLastCalledWith("A");
    expect(harness.current.reason).toBe("  reviewed evidence  ");
    expect(button(harness, "开始审核").props.disabled).toBe(true);
    retry.resolve(row("A", 2));
    await settle();
    expect(button(harness, "开始审核").props.disabled).toBe(false);
    await (harness.current.act as (action: "review") => Promise<void>)("review");
    expect(update).toHaveBeenCalledExactlyOnceWith("A", "review", 2, "reviewed evidence");
    expect((harness.current.selected as Request).version).toBe(3);
    expect(harness.current.reason).toBe("");
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("rejects a detail for the wrong request, user, or an older version", async () => {
    for (const response of [row("B", 3), { ...row("A", 3), userId: 2 }, row("A", 1)]) {
      const update = vi.fn();
      const harness = actualQueueHarness({ list: vi.fn().mockResolvedValue({ records: [row("A", 2)], total: 1 }), detail: vi.fn().mockResolvedValue(response), update, toast: vi.fn() });
      await settle();
      await (harness.current.openDetail as (item: Request) => Promise<void>)(row("A", 2));
      (harness.current.setReason as (reason: string) => void)("review evidence");
      await (harness.current.act as (action: "review") => Promise<void>)("review");
      expect(update).not.toHaveBeenCalled();
      expect((harness.current.selected as Request).requestNo).toBe("A");
      expect(textContent(harness.current.ui)).toContain("详情读取失败");
    }
  });

  it("does not let a list response confirm detail, downgrade its version, or accept an older pending read", async () => {
    const late = deferred<Request>();
    const list = vi.fn().mockResolvedValueOnce({ records: [row("A", 1)], total: 1 }).mockResolvedValueOnce({ records: [row("A", 3)], total: 1 }).mockResolvedValueOnce({ records: [row("A", 2)], total: 1 });
    const harness = actualQueueHarness({ list, detail: vi.fn(() => late.promise), update: vi.fn(), toast: vi.fn() });
    await settle();
    const reading = (harness.current.openDetail as (item: Request) => Promise<void>)(row("A", 1));
    await (harness.current.refresh as () => Promise<void>)();
    expect((harness.current.selected as Request).version).toBe(3);
    (harness.current.setReason as (reason: string) => void)("review evidence");
    expect(button(harness, "开始审核").props.disabled).toBe(true);
    late.resolve(row("A", 2));
    await reading;
    expect((harness.current.selected as Request).version).toBe(3);
    expect(button(harness, "开始审核").props.disabled).toBe(true);
    await (harness.current.refresh as () => Promise<void>)();
    expect((harness.current.selected as Request).version).toBe(3);
  });

  it("does not reopen a closed drawer on late success or let an old handler submit", async () => {
    const late = deferred<Request>();
    const update = vi.fn();
    const harness = actualQueueHarness({ list: vi.fn().mockResolvedValue({ records: [row("A", 1)], total: 1 }), detail: vi.fn().mockResolvedValueOnce(row("A", 1)).mockReturnValueOnce(late.promise), update, toast: vi.fn() });
    await settle();
    await (harness.current.openDetail as (item: Request) => Promise<void>)(row("A", 1));
    (harness.current.setReason as (reason: string) => void)("review evidence");
    const oldAct = harness.current.act as (action: "review") => Promise<void>;
    const reading = (harness.current.openDetail as (item: Request) => Promise<void>)(row("A", 1));
    (harness.current.closeDetail as () => void)();
    late.resolve(row("A", 2));
    await reading;
    await oldAct("review");
    expect(harness.current.selected).toBeNull();
    expect(elements(harness.current.ui).some((element) => element.type === "drawer")).toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it("keeps all review actions locked after failure and enforces a read-only session", async () => {
    const update = vi.fn();
    const harness = actualQueueHarness({ list: vi.fn().mockResolvedValue({ records: [row("A", 1, "IN_REVIEW")], total: 1 }), detail: vi.fn().mockRejectedValueOnce(new Error("500")).mockResolvedValue(row("A", 1, "IN_REVIEW")), update, toast: vi.fn() });
    await settle();
    await (harness.current.openDetail as (item: Request) => Promise<void>)(row("A", 1, "IN_REVIEW"));
    (harness.current.setReason as (reason: string) => void)("review evidence");
    for (const [action, label] of [["block", "阻断申请"], ["complete", "完成注销"], ["cancel", "取消申请"]] as const) {
      expect(button(harness, label).props.disabled).toBe(true);
      await (harness.current.act as (value: typeof action) => Promise<void>)(action);
    }
    expect(update).not.toHaveBeenCalled();
    harness.changeAuth({ adminId: 1, role: "auditor", authorities: ["user_c1_read"] });
    await (harness.current.openDetail as (item: Request) => Promise<void>)(row("A", 1, "IN_REVIEW"));
    (harness.current.setReason as (reason: string) => void)("review evidence");
    await (harness.current.act as (action: "complete") => Promise<void>)("complete");
    expect(update).not.toHaveBeenCalled();
    expect(elements(harness.current.ui).filter((element) => element.type === "button").map(textContent)).not.toContain("完成注销");
  });

  it("blocks duplicate commands while preserving a confirmed detail through an equal-version list refresh", async () => {
    const command = deferred<Request>();
    const update = vi.fn(() => command.promise);
    const harness = actualQueueHarness({ list: vi.fn().mockResolvedValue({ records: [row("A", 1)], total: 1 }), detail: vi.fn().mockResolvedValue({ ...row("A", 1), reason: "server evidence" }), update, toast: vi.fn() });
    await settle();
    await (harness.current.openDetail as (item: Request) => Promise<void>)(row("A", 1));
    await (harness.current.refresh as () => Promise<void>)();
    expect((harness.current.selected as Request).reason).toBe("server evidence");
    (harness.current.setReason as (reason: string) => void)("review evidence");
    const act = harness.current.act as (action: "review") => Promise<void>;
    const pending = act("review");
    await act("review");
    expect(update).toHaveBeenCalledExactlyOnceWith("A", "review", 1, "review evidence");
    expect(button(harness, "开始审核").props.disabled).toBe(true);
    command.resolve(row("A", 2, "IN_REVIEW"));
    await pending;
    expect((harness.current.selected as Request).version).toBe(2);
  });

  it("clears old identity or permission results and blocks handlers before the auth rerender", async () => {
    const changes: Session[] = [{ adminId: 2, role: "superadmin", authorities: [] }, { adminId: 1, role: "auditor", authorities: ["user_c1_read"] }];
    for (const session of changes) {
      const oldList = deferred<{ records: Request[]; total: number }>();
      const oldDetail = deferred<Request>();
      const update = vi.fn().mockResolvedValue(row("A", 2));
      const harness = actualQueueHarness({ list: vi.fn().mockReturnValueOnce(oldList.promise).mockResolvedValue({ records: [], total: 0 }), detail: vi.fn().mockReturnValueOnce(oldDetail.promise).mockResolvedValue(row("A", 1)), update, toast: vi.fn() });
      const reading = (harness.current.openDetail as (item: Request) => Promise<void>)(row("A", 1));
      harness.changeAuth(session);
      oldDetail.resolve(row("A", 1));
      oldList.resolve({ records: [row("A", 1)], total: 1 });
      await reading;
      await settle();
      expect(harness.current.selected).toBeNull();
      expect(harness.current.rows).toEqual([]);
      harness.changeAuth({ adminId: 1, role: "superadmin", authorities: [] });
      await (harness.current.openDetail as (item: Request) => Promise<void>)(row("A", 1));
      (harness.current.setReason as (reason: string) => void)("review evidence");
      const oldAct = harness.current.act as (action: "review") => Promise<void>;
      harness.changeAuth(session, undefined, false);
      await oldAct("review");
      expect(update).not.toHaveBeenCalled();
    }
  });

  it("opening a current-page row does not start another list read and list refresh synchronizes its newer version", async () => {
    const firstList = deferred<{ records: Request[]; total: number }>();
    const refreshedList = deferred<{ records: Request[]; total: number }>();
    const details = deferred<Request>();
    const list = vi.fn().mockReturnValueOnce(firstList.promise).mockReturnValueOnce(refreshedList.promise);
    const detail = vi.fn(() => details.promise);
    const harness = actualQueueHarness({ list, detail, update: vi.fn(), toast: vi.fn() });
    expect(list).toHaveBeenCalledTimes(1);
    firstList.resolve({ records: [row("A", 1)], total: 1 });
    await settle();
    (harness.current.openDetail as (item: Request) => Promise<void>)(row("A", 1));
    expect(detail).toHaveBeenCalledWith("A");
    expect(list).toHaveBeenCalledTimes(1);
    details.resolve(row("A", 1));
    await settle();
    expect(list).toHaveBeenCalledTimes(1);
    const refreshed = (harness.current.refresh as () => Promise<void>)();
    expect(list).toHaveBeenCalledTimes(2);
    refreshedList.resolve({ records: [row("A", 2, "IN_REVIEW")], total: 1 });
    await refreshed;
    expect((harness.current.selected as Request).version).toBe(2);
  });

  it("keeps B selected when A resolves late, and ignores a closed drawer's late failure", async () => {
    const initial = deferred<{ records: Request[]; total: number }>();
    const slowA = deferred<Request>();
    const fastB = deferred<Request>();
    const staleFailure = deferred<Request>();
    const closedFailure = deferred<Request>();
    const details = vi.fn()
      .mockReturnValueOnce(slowA.promise)
      .mockReturnValueOnce(fastB.promise)
      .mockReturnValueOnce(staleFailure.promise)
      .mockResolvedValueOnce(row("B", 3, "IN_REVIEW"))
      .mockReturnValueOnce(closedFailure.promise);
    const toast = vi.fn();
    const harness = actualQueueHarness({ list: vi.fn(() => initial.promise), detail: details, update: vi.fn(), toast });
    initial.resolve({ records: [row("A", 1), row("B", 1)], total: 2 });
    await settle();
    (harness.current.openDetail as (item: Request) => Promise<void>)(row("A", 1));
    (harness.current.openDetail as (item: Request) => Promise<void>)(row("B", 1));
    fastB.resolve(row("B", 2, "IN_REVIEW"));
    await settle();
    expect((harness.current.selected as Request).requestNo).toBe("B");
    slowA.resolve(row("A", 2));
    await settle();
    expect((harness.current.selected as Request).requestNo).toBe("B");
    (harness.current.openDetail as (item: Request) => Promise<void>)(row("A", 1));
    (harness.current.openDetail as (item: Request) => Promise<void>)(row("B", 2, "IN_REVIEW"));
    await settle();
    staleFailure.reject(new Error("stale A failure"));
    await settle();
    expect((harness.current.selected as Request).requestNo).toBe("B");
    expect(toast).not.toHaveBeenCalled();
    (harness.current.openDetail as (item: Request) => Promise<void>)(row("A", 1));
    (harness.current.closeDetail as () => void)();
    closedFailure.reject(new Error("closed A failure"));
    await settle();
    expect(harness.current.selected).toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });

  it("does not report a late A review failure against a drawer that now shows B", async () => {
    const initial = deferred<{ records: Request[]; total: number }>();
    const action = deferred<Request>();
    const toast = vi.fn();
    const harness = actualQueueHarness({
      list: vi.fn(() => initial.promise),
      detail: vi.fn()
        .mockResolvedValueOnce(row("A", 1))
        .mockResolvedValueOnce(row("B", 1)),
      update: vi.fn(() => action.promise),
      toast,
    });
    initial.resolve({ records: [row("A", 1), row("B", 1)], total: 2 });
    await settle();
    (harness.current.openDetail as (item: Request) => Promise<void>)(row("A", 1));
    await settle();
    (harness.current.setReason as (reason: string) => void)("review evidence");
    const pendingAction = (harness.current.act as (action: "review") => Promise<void>)("review");
    (harness.current.openDetail as (item: Request) => Promise<void>)(row("B", 1));
    await settle();
    action.reject(new Error("late A failure"));
    await pendingAction;
    expect((harness.current.selected as Request).requestNo).toBe("B");
    expect(toast).not.toHaveBeenCalled();
  });

  it("does not publish a stale list result and makes a late action read the current filter", async () => {
    const oldList = deferred<{ records: Request[]; total: number }>();
    const currentList = deferred<{ records: Request[]; total: number }>();
    const pageSwitchList = deferred<{ records: Request[]; total: number }>();
    const actionRead = deferred<{ records: Request[]; total: number }>();
    const action = deferred<Request>();
    const list = vi.fn()
      .mockReturnValueOnce(oldList.promise)
      .mockReturnValueOnce(currentList.promise)
      .mockReturnValueOnce(pageSwitchList.promise)
      .mockReturnValueOnce(actionRead.promise);
    const update = vi.fn(() => action.promise);
    const harness = actualQueueHarness({ list, detail: vi.fn().mockResolvedValue(row("CURRENT", 1, "IN_REVIEW")), update, toast: vi.fn() });
    (harness.current.changeStatus as (status: string) => void)("IN_REVIEW");
    expect(list).toHaveBeenNthCalledWith(2, "IN_REVIEW", 1, 20);
    currentList.resolve({ records: [row("CURRENT", 1, "IN_REVIEW")], total: 1 });
    await settle();
    oldList.resolve({ records: [row("OLD", 1)], total: 1 });
    await settle();
    expect((harness.current.rows as Request[])[0].requestNo).toBe("CURRENT");
    (harness.current.openDetail as (item: Request) => Promise<void>)(row("CURRENT", 1, "IN_REVIEW"));
    await settle();
    (harness.current.setReason as (reason: string) => void)("review evidence");
    const pendingAction = (harness.current.act as (action: "block") => Promise<void>)("block");
    expect(update).toHaveBeenCalledOnce();
    (harness.current.changePage as (page: number) => void)(2);
    expect(list).toHaveBeenNthCalledWith(3, "IN_REVIEW", 2, 20);
    action.resolve(row("CURRENT", 2, "IN_REVIEW"));
    await settle();
    expect(list).toHaveBeenLastCalledWith("IN_REVIEW", 2, 20);
    actionRead.resolve({ records: [row("ACTION", 2, "IN_REVIEW")], total: 1 });
    await pendingAction;
    expect((harness.current.rows as Request[])[0].requestNo).toBe("ACTION");
    pageSwitchList.resolve({ records: [row("STALE", 1, "IN_REVIEW")], total: 1 });
    await settle();
    expect((harness.current.rows as Request[])[0].requestNo).toBe("ACTION");
  });
});
