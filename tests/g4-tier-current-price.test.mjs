import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../app/components/domain-views/g-tabs/g4-genesis.tsx", import.meta.url), "utf8");
const clientSource = readFileSync(new URL("../lib/admin/g4-client.ts", import.meta.url), "utf8");

function loadTierPriceDeriver() {
  const output = ts.transpileModule(clientSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  new Function("require", "exports", "module", output)((name) => {
    if (name.endsWith("auth-session")) return { isAdminAuthFailure: () => false, resetAdminSession: () => undefined };
    if (name.endsWith("error-messages")) return { formatAdminApiError: () => "", guardedFetch: async () => undefined };
    if (name.endsWith("g-overview-contract")) return { assertG4OverviewContract: () => undefined };
    if (name.endsWith("stable-mutation")) return {
      createStableMutationExecutor: () => async () => undefined,
      stableMutationFingerprint: () => "", stableMutationHttpFailure: () => undefined,
    };
    return {};
  }, exports, { exports });
  return exports.deriveG4TierPrice;
}

const deriveG4TierPrice = loadTierPriceDeriver();

function textOf(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.props?.children);
}

function renderG4(overview) {
  const output = ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const element = (type, props, key) => ({ type, props: { ...props, key } });
  const exports = {};
  let stateCall = 0;
  new Function("require", "exports", "module", output)((name) => {
    if (name === "react") return {
      useState: (initial) => [stateCall++ === 0 ? overview : initial, () => undefined],
      useCallback: (callback) => callback,
      useEffect: () => undefined,
      useMemo: (callback) => callback(),
    };
    if (name === "react/jsx-runtime") return { jsx: element, jsxs: element, Fragment: Symbol("Fragment") };
    if (name === "next/link") return { default: "a" };
    if (name.endsWith("current-operator")) return { currentAdminOperator: () => "audit" };
    if (name.endsWith("error-messages")) return { displayAdminError: () => "error" };
    if (name.endsWith("design-kit")) return { Drawer: () => null, PaginationExemption: () => null };
    if (name.endsWith("g4-client")) return {
      createG4GenesisTier: async () => undefined, deleteG4GenesisTier: async () => undefined,
      fetchG4GenesisOverview: async () => overview, rerunG4GenesisDividendBatch: async () => undefined,
      updateG4GenesisMarketStatus: async () => undefined, updateG4GenesisMarketOpenState: async () => undefined,
      updateG4GenesisParam: async () => undefined, updateG4GenesisTier: async () => undefined,
    };
    if (name.endsWith("admin-auth")) return { useAdminAuth: () => ({ session: { role: "superadmin", authorities: [] } }) };
    if (name.endsWith("g4-admin-operations")) return { default: () => null };
    return {};
  }, exports, { exports });
  return textOf(exports.G4Genesis({ ctx: { toast: () => undefined, openActionConfirm: () => undefined } }));
}

function overview({ sold, tiers }) {
  return {
    stats: { totalSlots: 1000, sold, unitPrice: 9999, unsold: 1000 - sold, soldPct: sold / 10, genesisAccrualUsd: 0, marketOn: true, todayBatch: "", secondary: { floor: 0, vol24h: 0, listed: 0, owners: 0, royaltyPct: 0 } },
    params: [{ key: "price", displayValue: "$9,999", value: "9999", sub: "legacy policy", name: "一级购买单价", note: "legacy", b1RedlineTriggered: false, valueType: "NUMBER" }],
    dividend: { batchStatus: "ready", batchNo: "", dailyVolumeBase: 0, dividendPct: 0, poolToday: 0, perSlotPerDay: 0, floorPerNodePerDay: 0, payoutToday: 0 },
    coverage: { coverageRatio: 100, redlinePct: 100, redlineBreached: false, precheck: "B1" }, emissionGate: { open: false, configKey: "", owner: "H1" }, market: { enabled: true, linkedDomain: "J1", marketOpenState: "open", lastChange: "", configKey: "", marketOpenStateVersion: 1, closedNoticeKey: "default" }, geoBlocked: [], nodes: [], nodePage: { page: 1, pageSize: 10, total: 0, totalPages: 1, hasPrev: false, hasNext: false }, stateMachine: [], tiers, tierPrice: deriveG4TierPrice(tiers, sold, 1000, tiers !== undefined && tiers !== null), tiersVersion: 1, serverCanonical: true, sources: ["server"],
  };
}

const validTiers = [
  { id: "t1", from: 0, to: 100, priceUSDT: 7999 },
  { id: "t2", from: 100, to: 550, priceUSDT: 9999 },
  { id: "t3", from: 550, to: 1000, priceUSDT: 11999 },
];

test("G4 rendered headline uses the active sold-tier price instead of legacy stats.unitPrice", () => {
  const text = renderG4(overview({ sold: 1, tiers: validTiers }));
  assert.match(text, /\$7,999 \/ 张 · 当前档 t1/);
  assert.doesNotMatch(text, /一级售出1 \/ 1,000\$9,999 \/ 张/);
});

test("G4 current-tier resolver honors all half-open price boundaries", () => {
  assert.equal(deriveG4TierPrice(validTiers, 0, 1000, true).tier.id, "t1");
  assert.equal(deriveG4TierPrice(validTiers, 99, 1000, true).tier.id, "t1");
  assert.equal(deriveG4TierPrice(validTiers, 100, 1000, true).tier.id, "t2");
  assert.equal(deriveG4TierPrice(validTiers, 549, 1000, true).tier.id, "t2");
  assert.equal(deriveG4TierPrice(validTiers, 550, 1000, true).tier.id, "t3");
});

test("G4 resolver labels only a validated full catalog as sold out and keeps legacy distinct", () => {
  assert.equal(deriveG4TierPrice(validTiers, 1000, 1000, true).status, "soldout");
  assert.equal(deriveG4TierPrice(null, 1, 1000, false).status, "legacy");
  assert.equal(deriveG4TierPrice([], 1, 1000, true).status, "invalid");
  assert.equal(deriveG4TierPrice(validTiers, 1000, 999, true).status, "invalid");
  assert.equal(deriveG4TierPrice(validTiers, -1, 1000, true).status, "invalid");
  assert.equal(deriveG4TierPrice(validTiers, 1.5, 1000, true).status, "invalid");
  assert.equal(deriveG4TierPrice(validTiers, 1001, 1000, true).status, "invalid");
});
