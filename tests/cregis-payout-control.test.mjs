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
  state[9] = Boolean(data.provisionGate.assignEnabled);
  state[10] = Boolean(data.provisionGate.creditEnabled);
  state[11] = Boolean(data.provisionGate.payoutEnabled);
  let index = 0;
  const requests = [];
  const confirms = [];
  const exports = {};
  const context = {
    exports,
    require(name) {
      if (name === "./cregis-exceptions") return { CregisExceptionOperations: () => null };
      if (name === "./cregis-deposit-policy") return { CregisDepositPolicy: () => null };
    if (name === "./cregis-funds-preparation") return { CregisFundsPreparation: () => null };
    if (name === "./cregis-pool-policy") return { CregisPoolPolicy: () => null };
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
  vm.runInNewContext(`${compiled}\nexports.checks = { parseExceptions, canEnableProviderPayout, payoutCapabilityText, payoutSwitchText, canProvisionAddress, rowNetwork };`, context);
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

test("navigation preserves an unfinished switch edit and does not send a command", () => {
  const api = harness(snapshot());
  let tree = api.render();
  const area = () => nodes(tree, "section").filter(node => node.props.id?.startsWith("cregis-"));
  assert.deepEqual(area().filter(node => !node.props.hidden).map(node => node.props.id), ["cregis-records"]);
  nodes(tree, "button").find(node => node.props["aria-controls"] === "cregis-settings").props.onClick();
  tree = api.render();
  nodes(tree, "input").find(node => node.props.type === "checkbox").props.onChange({ target: { checked: false } });
  nodes(tree, "button").find(node => node.props["aria-controls"] === "cregis-funds").props.onClick();
  tree = api.render();
  assert.equal(area().find(node => node.props.id === "cregis-funds").props.hidden, false);
  nodes(tree, "button").find(node => node.props["aria-controls"] === "cregis-settings").props.onClick();
  tree = api.render();
  assert.equal(nodes(tree, "input").find(node => node.props.type === "checkbox").props.checked, false);
  assert.equal(api.requests.length, 0);
  assert.equal(api.confirms.length, 0);
});

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
    assert.throws(() => api.parseExceptions(invalid), /资金开关状态加载不完整/);
  }
  assert.throws(() => api.parseExceptions(snapshot({ configured: true, enabled: true, disabledReason: null })), /出款状态加载不完整/);
  assert.throws(() => api.parseExceptions(snapshot(null)), /出款状态加载不完整/);
});

test("payout proposal freezes current server pay-in bits rather than unsaved pay-in edits", async () => {
  const api = harness(snapshot());
  let tree = api.render();
  const inputs = nodes(tree, "input").filter((node) => node.props.type === "checkbox");
  inputs[0].props.onChange({ target: { checked: false } });
  inputs[1].props.onChange({ target: { checked: true } });
  inputs[2].props.onChange({ target: { checked: true } });
  tree = api.render();
  const button = nodes(tree, "button").find((node) => node.props.children === "提交出款开关审批");
  assert.equal(button.props.disabled, false);
  button.props.onClick();
  assert.match(api.confirms[0].detail, /不会直接放行任何提现/);
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
  nodes(tree, "button").find((node) => node.props.children === "提交审批").props.onClick();
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
  assert.equal(nodes(tree, "button").find((node) => node.props.children === "提交出款开关审批").props.disabled, false);
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
  assert.equal(api.requests.find((row) => row.options?.method === "POST").path, "/cregis/addresses/provision?network=BEP20");
  assert.equal(nodes(api.render(false), "button").some((node) => node.props.children === "补充收款地址"), false);
  assert.equal(api.canProvisionAddress({ ...data, addressPool: { ...data.addressPool, limit: 0, total: 10000 } }), true);
  for (const pool of [undefined, { ...data.addressPool, available: false }, { ...data.addressPool, total: 60 },
    { ...data.addressPool, verifying: 1 }, { ...data.addressPool, unknown: 1 }]) {
    assert.equal(api.canProvisionAddress({ ...data, addressPool: pool }), false);
  }
  assert.equal(api.canProvisionAddress({ ...data, provisionGate: { ...data.provisionGate, state: "BLOCKED" } }), false);
  assert.throws(() => api.parseExceptions({ ...data, addressPool: { ...data.addressPool, unassigned: "2" } }), /地址池状态加载不完整/);
});


test("network pools and payout capabilities stay independent and legacy pool never enables ERC20", async () => {
  const data = snapshot();
  data.addressPool = { available: true, total: 3, unassigned: 2, assigned: 1, verifying: 0, unknown: 0, limit: 60 };
  data.addressPools = { BEP20: data.addressPool, ERC20: { ...data.addressPool, total: 0, unassigned: 0, assigned: 0 } };
  data.networkCapabilities = [{ network: "BEP20", configured: true, enabled: false, disabledReason: "SWITCH_OFF" }, { network: "ERC20", configured: false, enabled: false, disabledReason: "NOT_CONFIGURED" }];
  const api = harness(data);
  assert.equal(api.canProvisionAddress({ ...data, addressPools: undefined }, "ERC20"), false);
  assert.equal(api.canProvisionAddress(api.parseExceptions(data), "ERC20"), true);
  let tree = api.render();
  nodes(tree, "select").find(node => node.props["aria-label"] === "地址池网络").props.onChange({ target: { value: "ERC20" } });
  tree = api.render();
  nodes(tree, "button").find(node => node.props.children === "补充收款地址").props.onClick();
  assert.match(api.confirms[0].action, /ERC20/);
  await api.confirms[0].run("按ERC20网络单独补充一个待核验地址");
  assert.equal(api.requests.find(row => row.options?.method === "POST").path, "/cregis/addresses/provision?network=ERC20");
  assert.throws(() => api.parseExceptions({ ...data, networkCapabilities: [{ network: "ERC20", configured: false, enabled: true, disabledReason: null }] }), /各网络出款状态加载不完整/);
});


test("ERC20 selected reconciliation never borrows BEP20 or unlabelled legacy completion", () => {
  const data = snapshot();
  data.reconcileRuns = [{ status: "COMPLETE", network: "BEP20", completedAt: "BSC-completed" }, { status: "COMPLETE", completedAt: "legacy-BSC-completed" }, { status: "INCOMPLETE", network: "ERC20", completedAt: "ETH-incomplete" }];
  const api = harness(data);
  let tree = api.render();
  const completion = root => nodes(root, "strong").map(node => node.props.children).find(value => ["BSC-completed", "legacy-BSC-completed", "ETH-completed", "尚无"].includes(value));
  assert.equal(completion(tree), "BSC-completed");
  nodes(tree, "select").find(node => node.props["aria-label"] === "地址池网络").props.onChange({ target: { value: "ERC20" } });
  tree = api.render(); assert.equal(completion(tree), "尚无");
  const labels = JSON.stringify(tree);
  for (const globalLabel of ["全局 App 收款入口", "全局自动入账能力", "全局地址分配", "全局自动入账", "全局出款总闸："]) assert.ok(labels.includes(globalLabel));
  data.reconcileRuns.unshift({ status: "COMPLETE", chainId: "60", completedAt: "ETH-completed" });
  tree = api.render(); assert.equal(completion(tree), "ETH-completed");
  assert.equal(api.rowNetwork({ chain_id: "60" }), "ERC20");
  assert.equal(api.rowNetwork({ chainId: "2510" }), "BEP20");
  assert.equal(api.rowNetwork({ chainId: ["60"] }), null);
  assert.equal(api.rowNetwork({}), "BEP20");
  assert.equal(api.rowNetwork({ chain_id: "1" }), null);
});
