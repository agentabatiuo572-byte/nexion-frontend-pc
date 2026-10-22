import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const source = readFileSync(new URL("../app/components/domain-views/d-tabs/cregis-status.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
} }).outputText;

function snapshot(capability = { configured: true, enabled: false, disabledReason: "SWITCH_OFF" }) {
  return {
    mode: "PROVIDER", depositEnabled: true, depositCreditEnabled: true,
    provisionGate: { state: "IDLE", version: 7, assignEnabled: 1, creditEnabled: 0, payoutEnabled: 0 },
    providerPayout: capability,
    uncertainAddresses: [], heldDeposits: [], failedDeliveries: [], pendingDeliveries: [],
    unattributed: [], providerMissing: [], switchCases: [],
  };
}

function harness(data) {
  const state = [data];
  state[8] = Boolean(data.provisionGate.assignEnabled);
  state[9] = Boolean(data.provisionGate.creditEnabled);
  state[10] = Boolean(data.provisionGate.payoutEnabled);
  let index = 0;
  const requests = [];
  const confirms = [];
  const exports = {};
  const context = {
    exports,
    require(name) {
      if (name === "./cregis-exceptions") return { CregisExceptionOperations: () => null };
    if (name === "./cregis-funds-preparation") return { CregisFundsPreparation: () => null };
    if (name === "./cregis-auto-forward") return { CregisAutoForward: () => null };
      if (name === "react") return {
        useState(initial) {
          const slot = index++;
          if (!(slot in state)) state[slot] = initial;
          return [state[slot], (next) => { state[slot] = next; }];
        },
        useCallback: (callback) => callback, useEffect() {}, useRef: (current) => ({ current }),
      };
      if (name === "react/jsx-runtime") return {
        jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }),
      };
      if (name === "@/lib/admin/d-client") return {
        async financeAdminRequest(path, options) {
          requests.push({ path, options });
          return options ? { caseId: 1, status: "MAKER_DONE" } : data;
        },
      };
      throw new Error(`Unexpected module: ${name}`);
    },
  };
  vm.runInNewContext(`${compiled}\nexports.checks = { parseExceptions, canEnableProviderPayout, payoutCapabilityText, payoutSwitchText, canProvisionAddress };`, context);
  return {
    ...exports.checks, requests, confirms,
    render(canManage = true) {
      index = 0;
      return exports.CregisStatus({ canManage, openActionConfirm: (spec) => confirms.push(spec) });
    },
  };
}

function nodes(root, type) {
  if (!root || typeof root !== "object") return [];
  if (Array.isArray(root)) return root.flatMap((child) => nodes(child, type));
  return [...(root.type === type ? [root] : []), ...nodes(root.props?.children, type)];
}

test("capability fails closed for absent, unknown, held and malformed server facts", () => {
  const api = harness(snapshot());
  assert.equal(api.canEnableProviderPayout(api.parseExceptions(snapshot())), true);
  for (const disabledReason of ["NOT_CONFIGURED", "RISK_HOLD", "RECONCILIATION_REQUIRED", "FUTURE_REASON", null]) {
    const data = snapshot({ configured: true, enabled: false, disabledReason });
    assert.equal(api.canEnableProviderPayout(api.parseExceptions(data)), false);
    assert.doesNotMatch(api.payoutCapabilityText(data), /FUTURE_REASON/);
  }
  const legacy = snapshot();
  delete legacy.providerPayout;
  assert.equal(api.canEnableProviderPayout(api.parseExceptions(legacy)), false);
  assert.match(api.payoutCapabilityText(legacy), /尚未确认/);
  const disabled = { ...legacy, mode: "DISABLED", provisionGate: { state: "DISABLED" } };
  assert.equal(api.canEnableProviderPayout(api.parseExceptions(disabled)), false);
  assert.equal(api.payoutSwitchText(disabled.provisionGate, "未知"), "未知");
  for (const flag of [undefined, null, "0", 2]) {
    const invalid = snapshot();
    invalid.provisionGate.payoutEnabled = flag;
    assert.throws(() => api.parseExceptions(invalid), /资金开关状态无效/);
  }
  assert.throws(() => api.parseExceptions(snapshot({ configured: true, enabled: true, disabledReason: null })), /能力响应无效/);
  assert.throws(() => api.parseExceptions(snapshot(null)), /能力响应无效/);
});

test("payout proposal freezes current server pay-in bits rather than unsaved pay-in edits", async () => {
  const api = harness(snapshot());
  let tree = api.render();
  const inputs = nodes(tree, "input").filter((node) => node.props.type === "checkbox");
  inputs[0].props.onChange({ target: { checked: false } });
  inputs[1].props.onChange({ target: { checked: true } });
  inputs[2].props.onChange({ target: { checked: true } });
  tree = api.render();
  const button = nodes(tree, "button").find((node) => node.props.children === "提交出款开关提案");
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  assert.match(api.confirms[0].detail, /不会直接放行或确认任何提现单/);
  await api.confirms[0].run("仅开启链上出款用于本轮验证");
  const request = api.requests.find((row) => row.options?.method === "POST");
  assert.equal(request.path, "/cregis/switch-cases");
  assert.deepEqual(JSON.parse(request.options.body), {
    expectedVersion: 7, assignEnabled: true, creditEnabled: false, payoutEnabled: true,
    reason: "仅开启链上出款用于本轮验证",
  });
});

test("pay-in proposal omits payout, read-only admins have no write controls, and unknown cannot enable", async () => {
  const api = harness(snapshot());
  const tree = api.render();
  nodes(tree, "button").find((node) => node.props.children === "提交开关提案").props.onClick();
  await api.confirms[0].run("仅调整原有收款开关状态");
  const body = JSON.parse(api.requests.find((row) => row.options?.method === "POST").options.body);
  assert.equal(Object.hasOwn(body, "payoutEnabled"), false);
  assert.equal(nodes(api.render(false), "input").length, 0);
  const held = harness(snapshot({ configured: true, enabled: false, disabledReason: "FUTURE_REASON" }));
  const payoutInput = nodes(held.render(), "input").filter((node) => node.props.type === "checkbox")[2];
  assert.equal(payoutInput.props.disabled, true);
});

test("a held enabled gate can still be proposed off, and checker copy carries all three bits", () => {
  const data = snapshot({ configured: true, enabled: false, disabledReason: "RISK_HOLD" });
  data.provisionGate.payoutEnabled = 1;
  data.switchCases = [{ id: 31, status: "MAKER_DONE", makerId: 4,
    assignEnabled: 1, creditEnabled: 0, payoutEnabled: 1, reason: "本轮独立出款开关提案" }];
  const api = harness(data);
  let tree = api.render();
  const input = nodes(tree, "input").filter((node) => node.props.type === "checkbox")[2];
  assert.equal(input.props.disabled, false);
  input.props.onChange({ target: { checked: false } });
  tree = api.render();
  assert.equal(nodes(tree, "button").find((node) => node.props.children === "提交出款开关提案").props.disabled, false);
  nodes(tree, "button").find((node) => node.props.children === "复核通过").props.onClick();
  assert.match(api.confirms[0].detail, /地址 开 \/ 入账 关 \/ 出款 开/);
  assert.equal(api.payoutSwitchText({}), "保持现值");
});

test("address replenishment uses verified pool facts and creates only one candidate through confirmation", async () => {
  const data = snapshot();
  data.addressPool = { available: true, total: 3, unassigned: 2, assigned: 1, verifying: 0, unknown: 0, limit: 60 };
  const api = harness(data);
  assert.equal(api.canProvisionAddress(api.parseExceptions(data)), true);
  const button = nodes(api.render(), "button").find((node) => node.props.children === "补充收款地址");
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  assert.match(api.confirms[0].detail, /核对归属、余额和链上历史/);
  await api.confirms[0].run("为测试用户补充一个经过核验的收款地址");
  assert.equal(api.requests.filter((row) => row.options?.method === "POST").length, 1);
  assert.equal(api.requests.find((row) => row.options?.method === "POST").path, "/cregis/addresses/provision");
  assert.equal(nodes(api.render(false), "button").some((node) => node.props.children === "补充收款地址"), false);
  for (const pool of [undefined, { ...data.addressPool, available: false }, { ...data.addressPool, total: 60 },
    { ...data.addressPool, verifying: 1 }, { ...data.addressPool, unknown: 1 }]) {
    assert.equal(api.canProvisionAddress({ ...data, addressPool: pool }), false);
  }
  assert.equal(api.canProvisionAddress({ ...data, provisionGate: { ...data.provisionGate, state: "BLOCKED" } }), false);
  assert.throws(() => api.parseExceptions({ ...data, addressPool: { ...data.addressPool, unassigned: "2" } }), /地址池状态无效/);
});
