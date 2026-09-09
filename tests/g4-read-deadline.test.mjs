import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import test from "node:test";
import ts from "typescript";

const routeSource = readFileSync(new URL("../app/api/admin/market/[...path]/route.ts", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../lib/admin/g4-client.ts", import.meta.url), "utf8");
const viewSource = readFileSync(new URL("../app/components/domain-views/g-tabs/g4-genesis.tsx", import.meta.url), "utf8");

function compile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function loadMarketRoute() {
  const output = compile(routeSource);
  const exports = {};
  new Function("require", "exports", "module", output)((name) => {
    if (name === "next/headers") return { cookies: async () => ({ get: () => ({ value: "test-token" }) }) };
    if (name.endsWith("require-password-change-cleared")) return { requirePasswordChangeCleared: () => null };
    throw new Error(`unexpected import: ${name}`);
  }, exports, { exports });
  return exports;
}

function loadG4Client(guardedFetch) {
  const output = compile(clientSource);
  const exports = {};
  new Function("require", "exports", "module", output)((name) => {
    if (name.endsWith("auth-session")) return { isAdminAuthFailure: () => false, resetAdminSession: () => undefined };
    if (name.endsWith("error-messages")) return { formatAdminApiError: (message, fallback) => message || fallback, guardedFetch };
    if (name.endsWith("g-overview-contract")) return { assertG4OverviewContract: () => undefined };
    if (name.endsWith("stable-mutation")) return {
      createStableMutationExecutor: () => async () => undefined,
      stableMutationFingerprint: () => "", stableMutationHttpFailure: (message) => new Error(message),
    };
    throw new Error(`unexpected import: ${name}`);
  }, exports, { exports });
  return exports;
}

function textOf(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.props?.children);
}

function findButton(node, label) {
  if (node == null || typeof node === "boolean" || typeof node === "string" || typeof node === "number") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child, label);
      if (found) return found;
    }
    return null;
  }
  if (node.type === "button" && textOf(node.props?.children) === label) return node;
  return findButton(node.props?.children, label);
}

function overviewAfterRetry() {
  return {
    stats: { totalSlots: 1000, sold: 0, unitPrice: 9999, unsold: 1000, soldPct: 0, genesisAccrualUsd: 0, marketOn: true, todayBatch: "", secondary: { floor: 0, vol24h: 0, listed: 0, owners: 0, royaltyPct: 0 } },
    params: [], dividend: { batchStatus: "ready", batchNo: "", dailyVolumeBase: 0, dividendPct: 0, poolToday: 0, perSlotPerDay: 0, floorPerNodePerDay: 0, payoutToday: 0 },
    coverage: { coverageRatio: 100, redlinePct: 100, redlineBreached: false, precheck: "B1" },
    emissionGate: { open: false, configKey: "", owner: "H1" },
    market: { enabled: true, linkedDomain: "J1", marketOpenState: "open", lastChange: "", configKey: "", marketOpenStateVersion: 1, closedNoticeKey: "default" },
    geoBlocked: [], nodes: [], nodePage: { page: 1, pageSize: 10, total: 0, totalPages: 1, hasPrev: false, hasNext: false },
    stateMachine: [], tiers: null, tierPrice: { status: "legacy" }, tiersVersion: 0, serverCanonical: true, sources: ["test"],
  };
}

async function renderRejectedReadThenRetry() {
  const output = compile(viewSource);
  const exports = {};
  const state = [];
  let stateIndex = 0;
  let effectRan = false;
  let reads = 0;
  const element = (type, props, key) => ({ type, props: { ...props, key } });
  new Function("require", "exports", "module", output)((name) => {
    if (name === "react") return {
      useState: (initial) => {
        const index = stateIndex++;
        if (!(index in state)) state[index] = initial;
        return [state[index], (next) => { state[index] = typeof next === "function" ? next(state[index]) : next; }];
      },
      useCallback: (callback) => callback,
      useEffect: (effect) => { if (!effectRan) effect(); },
      useMemo: (callback) => callback(),
    };
    if (name === "react/jsx-runtime") return { jsx: element, jsxs: element, Fragment: Symbol("Fragment") };
    if (name === "next/link") return { default: "a" };
    if (name.endsWith("current-operator")) return { currentAdminOperator: () => "audit" };
    // 这里只验证组件拿到任一已格式化错误后进入失败和重试路径，不把该 mock 当作真实翻译证据。
    if (name.endsWith("error-messages")) return { displayAdminError: () => "受控读取失败。" };
    if (name.endsWith("design-kit")) return { Drawer: () => null, PaginationExemption: () => null };
    if (name.endsWith("g4-client")) return {
      fetchG4GenesisOverview: async () => {
        reads += 1;
        if (reads === 1) throw new Error("abort");
        return overviewAfterRetry();
      },
      createG4GenesisTier: async () => undefined, deleteG4GenesisTier: async () => undefined,
      rerunG4GenesisDividendBatch: async () => undefined, updateG4GenesisMarketStatus: async () => undefined,
      updateG4GenesisMarketOpenState: async () => undefined, updateG4GenesisParam: async () => undefined,
      updateG4GenesisTier: async () => undefined,
    };
    if (name.endsWith("admin-auth")) return { useAdminAuth: () => ({ session: { role: "superadmin", authorities: [] } }) };
    if (name.endsWith("g4-admin-operations")) return { default: () => null };
    throw new Error(`unexpected import: ${name}`);
  }, exports, { exports });

  const render = () => {
    stateIndex = 0;
    return exports.G4Genesis({ ctx: { toast: () => undefined, openActionConfirm: () => undefined } });
  };
  render();
  await new Promise((resolve) => setImmediate(resolve));
  effectRan = true;
  const failed = render();
  const retry = findButton(failed, "重新加载");
  assert.ok(retry, "失败页必须提供实际可点击的重新加载按钮");
  retry.props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  return { failedText: textOf(failed), recoveredText: textOf(render()), reads };
}

function deadlineSignal() {
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error("test deadline")), 0);
  return controller.signal;
}

async function settleWithin(promise) {
  const timedOut = Symbol("timedOut");
  const result = await Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(timedOut), 60))]);
  assert.notEqual(result, timedOut, "请求没有在应用 deadline 后转为可重试错误");
  return result;
}

function installShortDeadline(t) {
  const original = globalThis.AbortSignal;
  Object.defineProperty(globalThis, "AbortSignal", { configurable: true, writable: true, value: { timeout: deadlineSignal } });
  t.after(() => Object.defineProperty(globalThis, "AbortSignal", { configurable: true, writable: true, value: original }));
}

async function startHangingUpstream(mode) {
  const sockets = new Set();
  const server = createServer((_request, response) => {
    if (mode === "body") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write('{"code":0');
    }
    // header mode sends nothing; body mode sends an incomplete body. Both stay open until test cleanup.
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function g4ReadAgainstHangingUpstream(t, mode) {
  installShortDeadline(t);
  const upstream = await startHangingUpstream(mode);
  t.after(() => upstream.close());
  const oldBaseUrl = process.env.NEXION_BACKEND_URL;
  process.env.NEXION_BACKEND_URL = upstream.baseUrl;
  t.after(() => {
    if (oldBaseUrl === undefined) delete process.env.NEXION_BACKEND_URL;
    else process.env.NEXION_BACKEND_URL = oldBaseUrl;
  });

  const { GET } = loadMarketRoute();
  return settleWithin(GET(new Request("http://pc/api/admin/market/nex/genesis"), {
    params: Promise.resolve({ path: ["nex", "genesis"] }),
  }));
}

test("G4 overview gateway ends a real upstream header hang as a retryable 503", async (t) => {
  const response = await g4ReadAgainstHangingUpstream(t, "header");
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: 503, message: "MARKET_BACKEND_UNAVAILABLE", data: null });
});

test("G4 overview gateway applies its deadline while reading a real hanging upstream body", async (t) => {
  const response = await g4ReadAgainstHangingUpstream(t, "body");
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: 503, message: "MARKET_BACKEND_UNAVAILABLE", data: null });
});

test("only G4 overview GET receives a browser deadline; generic G4 command requests keep their existing semantics", async (t) => {
  installShortDeadline(t);
  const seen = [];
  const { fetchG4GenesisOverview, g4Request } = loadG4Client(async (_url, init) => {
    seen.push(init);
    return { ok: true, status: 200, json: async () => ({ code: 0, data: null }) };
  });

  await fetchG4GenesisOverview();
  await g4Request("/nex/genesis/market-status", { method: "PATCH", body: "{}" });
  assert.ok(seen[0].signal, "概览 GET 必须有 deadline signal");
  assert.equal(seen[1].signal, undefined, "写命令不得因本修复被强行加浏览器 deadline");
});

test("a rejected initial G4 read uses the actual retry button and recovers on the next successful read", async () => {
  const { failedText, recoveredText, reads } = await renderRejectedReadThenRetry();
  assert.match(failedText, /G4 数据加载失败/);
  assert.match(failedText, /受控读取失败。/);
  assert.match(failedText, /重新加载/);
  assert.doesNotMatch(recoveredText, /G4 数据加载失败/);
  assert.match(recoveredText, /节点经济参数/);
  assert.equal(reads, 2);
});
