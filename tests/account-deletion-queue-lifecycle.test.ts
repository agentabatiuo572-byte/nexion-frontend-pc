import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import ts from "typescript";
import {
  isCurrentAccountDeletionListRead,
  isCurrentAccountDeletionSelection,
  syncSelectedAccountDeletion,
} from "../app/components/domain-views/c-tabs/account-deletion-queue-state";

type Request = { requestNo: string; userId: number; status: string; version: number; reason?: string };
type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };

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
  const start = source.indexOf("export function AccountDeletionQueue");
  const end = source.indexOf("  if (!canRead) return null;", start);
  if (start < 0 || end < 0) throw new Error("Actual queue lifecycle handlers not found");
  const handlerSource = `${source.slice(start, end).replace("export function AccountDeletionQueue", "function AccountDeletionQueue")}\nreturn { selected, rows, total, loading, error, reason, refresh, openDetail, closeDetail, act, changeStatus, changePage, setReason };\n}`;
  const compiled = ts.transpileModule(handlerSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;

  const hooks: Array<{ value?: unknown; deps?: readonly unknown[] }> = [];
  let cursor = 0;
  let rendering = false;
  let rerenderRequested = false;
  let current: Record<string, unknown>;
  const sameDeps = (left?: readonly unknown[], right?: readonly unknown[]) => left !== undefined && right !== undefined && left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
  const queuedEffects: Array<() => void> = [];
  const render = () => {
    if (rendering) { rerenderRequested = true; return; }
    do {
      rerenderRequested = false;
      rendering = true;
      cursor = 0;
      current = Queue({ toast: deps.toast });
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
  const Queue = new Function("useCallback", "useEffect", "useRef", "useState", "displayAdminError", "useAdminAuth", "fetchAccountDeletion", "fetchAccountDeletions", "updateAccountDeletion", "isCurrentAccountDeletionListRead", "isCurrentAccountDeletionSelection", "syncSelectedAccountDeletion", "ACTION_LABELS", `${compiled}; return AccountDeletionQueue;`)(
    useCallback, useEffect, useRef, useState,
    (cause: unknown) => cause instanceof Error ? cause.message : String(cause),
    (selector: (state: { session: { role: string; authorities: string[] } }) => unknown) => selector({ session: { role: "superadmin", authorities: [] } }),
    deps.detail, deps.list, deps.update,
    isCurrentAccountDeletionListRead, isCurrentAccountDeletionSelection, syncSelectedAccountDeletion,
    { review: "开始审核", block: "阻断申请", complete: "完成注销", cancel: "取消申请" },
  ) as (props: { toast: ReturnType<typeof vi.fn> }) => Record<string, unknown>;
  render();
  return { get current() { return current; } };
}

describe("actual account-deletion queue lifecycle handlers", () => {
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
    const pendingAction = (harness.current.act as (action: "review") => Promise<void>)("review");
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
