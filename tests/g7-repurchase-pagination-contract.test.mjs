import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import test from "node:test";

const uiPath = new URL("../app/components/domain-views/g-tabs/g7-repurchase.tsx", import.meta.url);
const clientPath = new URL("../lib/admin/g7-client.ts", import.meta.url);

async function loadPaginationCallbacks() {
  const source = await readFile(uiPath, "utf8");
  const start = source.indexOf("export function G7Repurchase");
  const end = source.indexOf("  if (loading && !overview)", start);
  assert.ok(start >= 0 && end > start, "test fixture could not isolate the production callback body");

  const fixturePath = new URL("./.g7-repurchase-callback-fixture.ts", import.meta.url);
  const callbackBody = source.slice(start, end).replace(
    /export function G7Repurchase\(\{ ctx \}: \{ ctx: GCtx \}\)/,
    "export function G7Repurchase({ ctx }: { ctx: unknown })",
  );
  const prefix = `
let api: {
  overview: () => Promise<unknown>;
  orders: (status?: string, cursor?: number | null) => Promise<unknown>;
  update: () => Promise<unknown>;
} | null = null;
let stateSlots: unknown[] = [];
let refSlots: Array<{ current: unknown }> = [];
let stateCursor = 0;
let refCursor = 0;
export function setApi(next: NonNullable<typeof api>) { api = next; }
export function beginRender() { stateCursor = 0; refCursor = 0; }
export function snapshot() {
  return { overview: stateSlots[0], orders: stateSlots[1], loading: stateSlots[2], error: stateSlots[3], nextCursor: stateSlots[5], hasMore: stateSlots[6], loadingMore: stateSlots[7] };
}
function useState<T>(initial: T): [T, (next: T | ((current: T) => T)) => void] {
  const index = stateCursor++;
  if (!(index in stateSlots)) stateSlots[index] = initial;
  return [stateSlots[index] as T, (next) => { stateSlots[index] = typeof next === "function" ? (next as (current: T) => T)(stateSlots[index] as T) : next; }];
}
function useRef<T>(initial: T) {
  const index = refCursor++;
  if (!(index in refSlots)) refSlots[index] = { current: initial };
  return refSlots[index] as { current: T };
}
function useCallback<T extends (...args: any[]) => any>(callback: T): T { return callback; }
function useEffect(): void {}
const currentAdminOperator = () => "test";
const displayAdminError = (error: unknown) => error instanceof Error ? error.message : String(error);
function messageOf(error: unknown) { return displayAdminError(error); }
const fetchG7RepurchaseOverview = () => api!.overview();
const fetchG7RepurchaseOrders = (status = "", cursor: number | null = null) => api!.orders(status, cursor);
const updateG7RepurchaseParam = () => api!.update();
const useAdminAuth = <T,>(selector: (state: { session: null }) => T) => selector({ session: null });
const Link = () => null;
type G7Order = { orderNo: string };
type G7Overview = { stats: any; coverage: any; params: any[]; g4Capacity: any; stateMachine: string[]; statusBreakdown: any[]; amountDistribution: string; phaseGate: any; sources: string[] };
type G7Param = any;
`;
  await writeFile(fixturePath, prefix + callbackBody + "\n  return { reload, loadMore };\n}", "utf8");
  try {
    return await import(fixturePath.href + "?" + Date.now());
  } finally {
    await rm(fixturePath, { force: true });
  }
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, resolve, reject };
}
function page(orders, nextCursor, hasMore) { return { orders, nextCursor, hasMore, serverCanonical: true }; }
function order(orderNo) {
  return { orderNo, userNo: orderNo, nickname: orderNo, amountUsdt: 1, apyPct: 1, lockDays: 90, lockedAt: "", unlockAt: "", estimatedInterestUsdt: 0, status: "ACTIVE", billCorrelationPrefix: orderNo };
}

test("G7 repurchase orders forwards the server cursor and preserves a supplied status query", async () => {
  const client = await readFile(clientPath, "utf8");
  assert.match(client, /export async function fetchG7RepurchaseOrders\(status = "", cursor: number \| null = null\)/);
  assert.match(client, /const query = new URLSearchParams\(\)/);
  assert.match(client, /query\.set\("status", status\)/);
  assert.match(client, /if \(cursor !== null\) query\.set\("cursor", String\(cursor\)\)/);
});

test("G7 actual callback body appends one page once and terminates at the server cursor", async () => {
  const runtime = await loadPaginationCallbacks();
  const requests = [];
  const second = deferred();
  runtime.setApi({
    overview: async () => ({ stats: {}, coverage: {}, params: [], g4Capacity: {}, stateMachine: [], statusBreakdown: [], amountDistribution: "", phaseGate: {}, sources: [] }),
    orders: (status, cursor) => {
      requests.push([status, cursor]);
      return cursor === null ? Promise.resolve(page([order("A"), order("B")], 20, true)) : second.promise;
    },
    update: async () => ({}),
  });
  const ctx = { toast() {}, openActionConfirm() {} };
  runtime.beginRender();
  let view = runtime.G7Repurchase({ ctx });
  await view.reload();
  runtime.beginRender();
  view = runtime.G7Repurchase({ ctx });
  const firstLoadMore = view.loadMore();
  const duplicateLoadMore = view.loadMore();
  assert.equal(requests.length, 2, "the ref gate must reject a second click before React re-renders");
  second.resolve(page([order("B"), order("C")], null, false));
  await Promise.all([firstLoadMore, duplicateLoadMore]);
  assert.deepEqual(runtime.snapshot().orders.map((row) => row.orderNo), ["A", "B", "C"]);
  assert.equal(runtime.snapshot().nextCursor, null);
  assert.equal(runtime.snapshot().hasMore, false);
  runtime.beginRender();
  view = runtime.G7Repurchase({ ctx });
  await view.loadMore();
  assert.equal(requests.length, 2, "a terminal cursor must not issue another request");
});

test("G7 actual callback body discards an old page after a newer reload and keeps loaded rows when a page fails", async () => {
  const runtime = await loadPaginationCallbacks();
  const stalePage = deferred();
  const refreshedPage = deferred();
  const failingPage = deferred();
  let firstPage = 0;
  runtime.setApi({
    overview: async () => ({ stats: {}, coverage: {}, params: [], g4Capacity: {}, stateMachine: [], statusBreakdown: [], amountDistribution: "", phaseGate: {}, sources: [] }),
    orders: (_status, cursor) => {
      if (cursor === null) {
        firstPage += 1;
        return firstPage === 1 ? Promise.resolve(page([order("A")], 20, true)) : refreshedPage.promise;
      }
      if (cursor === 20) return stalePage.promise;
      return failingPage.promise;
    },
    update: async () => ({}),
  });
  const ctx = { toast() {}, openActionConfirm() {} };
  runtime.beginRender();
  let view = runtime.G7Repurchase({ ctx });
  await view.reload();
  runtime.beginRender();
  view = runtime.G7Repurchase({ ctx });
  const oldLoadMore = view.loadMore();
  const replacementReload = view.reload();
  stalePage.resolve(page([order("OLD")], null, false));
  await oldLoadMore;
  refreshedPage.resolve(page([order("NEW")], 10, true));
  await replacementReload;
  assert.deepEqual(runtime.snapshot().orders.map((row) => row.orderNo), ["NEW"], "a stale page cannot append after reload wins");
  runtime.beginRender();
  view = runtime.G7Repurchase({ ctx });
  const failedLoadMore = view.loadMore();
  failingPage.reject(new Error("network unavailable"));
  await failedLoadMore;
  assert.deepEqual(runtime.snapshot().orders.map((row) => row.orderNo), ["NEW"], "a failed continuation keeps the last confirmed page");
  assert.equal(runtime.snapshot().nextCursor, 10, "retry keeps the canonical server cursor");
});

test("G7 source retains a loaded page on failure and provides no user-reachable status switch", async () => {
  const ui = await readFile(uiPath, "utf8");
  assert.doesNotMatch(ui, /setOrders\(\[\]\)/);
  assert.doesNotMatch(ui, /setOverview\(null\)/);
  assert.match(ui, /if \(generation !== requestGeneration\.current\) return;/);
  assert.match(ui, /if \(loading \|\| moreInFlight\.current \|\| !hasMore \|\| nextCursor === null\) return;/);
  assert.doesNotMatch(ui, /useState<.*status|setStatus\(/);
});
