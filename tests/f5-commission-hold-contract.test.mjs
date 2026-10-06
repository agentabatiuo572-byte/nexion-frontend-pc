/**
 * F5 单笔佣金冻结/提前解锁/解冻 · 专属契约门(合并底账 ADMIN-MERGE-BASELINE-20260804 §二#4 恢复)。
 *
 * 为什么必须单独一道门:这组动作曾被静默削减成"只剩不可逆冲正",而动作台账 OPS-F-10 因为锚
 * (f_commission_status)在注册表里仍存在,一直显示 built——台账绿、页面上按钮却没了,属于
 * "锚在、入口无"的虚标形态,现有 ops-actions 门天然测不出。这道门直接钉行内按钮与 dispose
 * 管线的接线,再被削减时 verify 红。
 * 跨仓断言(后端 f_commission_status replay 分支)不在本文件,理由同 GEN10b parity 拆分。
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { F5_KINDS, F5_KIND_LABELS } from "../lib/admin/f-overview-contract.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const componentSource = read("../app/components/domain-views/f-tabs/f5-audit.tsx");
const component = strip(componentSource);
const shell = strip(read("../app/components/domain-views/f-view.tsx"));
const registry = strip(read("../lib/admin/high-ops-registry.ts"));
const f1Client = strip(read("../lib/admin/f1-client.ts"));
const manifest = read("../docs/ops-actions.manifest.json");

function grabBetween(src, from, to) {
  const a = src.indexOf(from);
  assert.ok(a >= 0, `源码里找不到 \`${from}\`(实现被改名或删除?)`);
  const b = to === null ? src.length : src.indexOf(to, a + from.length);
  assert.ok(b > a, `源码里找不到 \`${from}\` 之后的 \`${to}\``);
  const body = src.slice(a, b);
  assert.ok(body.length > from.length + 40, `抠出的实现只有 ${body.length} 字符,判据会空转`);
  return body;
}

// 编译真实组件，只替换 React 渲染和外部上下文；按钮条件和点击回调来自生产源码。
const output = ts.transpileModule(componentSource, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const element = (type, props, key) => ({ type, props: { ...props, key } });
const exports = {};
new Function("require", "exports", "module", output)((name) => {
  if (name === "react") return { useState: (value) => [value, () => undefined], useMemo: (fn) => fn() };
  if (name === "react/jsx-runtime") return { jsx: element, jsxs: element, Fragment: Symbol("Fragment") };
  if (name === "next/link") return { default: () => null };
  if (name.endsWith("design-kit")) return { Badge: () => null };
  if (name === "@/lib/admin/f-overview-contract") return { F5_KINDS, F5_KIND_LABELS };
  throw new Error(`未覆盖的组件依赖: ${name}`);
}, exports, { exports });

function textOf(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  return textOf(node.props?.children);
}

function walk(node) {
  if (node == null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(walk);
  return [node, ...walk(node.props?.children)];
}

function renderRow(kind, status, cur, canDispose = true, coolingDaysLeft = 3, overrides = {}) {
  const row = {
    id: "CM-71", eventId: 71, kind, status, cur, amt: 12, user: "U00000009", userId: 9,
    settledAt: "2026-10-05 12:00:00", coolingDaysLeft, coolPct: 0, coolLb: "冷却计提", state: "计提",
    auditKey: "F.commission.CM-71.status", version: 4, settlementNo: "DR-71", amountUSDT: 12, amountNEX: 120,
  };
  const confirmations = [];
  const tree = exports.F5Audit({ ctx: {
    can: (permission) => permission === "network_f5_commission_dispose" && canDispose,
    f5Overview: {
      pendingCalculations: [], pendingCalculationCount: 0,
      summary: { monthlyCommissionSpendLabel: "", coolingBalanceLabel: "", withdrawableThisMonthLabel: "", frozenCount: 0 },
      commissionEvents: [row], commissionKinds: [], statusDistribution: [], anomalies: [], coolingPolicy: [],
      activeSuspensions: [], operationHistory: [], configValues: {}, total: 1, nextCursor: "",
    },
    openActionConfirm: (confirmation) => confirmations.push(confirmation),
    ...overrides,
  } });
  return { row, confirmations, nodes: walk(tree), buttons: walk(tree).filter((node) => node.type === "button") };
}

const button = (view, label) => view.buttons.find((node) => textOf(node) === label);
const disposalLabels = ["冻结", "提前解锁", "解冻"];

test("F5 注册月份使用月份控件，不要求手工记输入格式", () => {
  const view = renderRow("network", "cooling", "USDT");
  const month = view.nodes.find((node) => node.props?.["aria-label"] === "用户群");
  assert.equal(month.type, "input");
  assert.equal(month.props.type, "month");
});

test("F5 暂停提示显示奖种名称，提交仍保持真实枚举", async () => {
  const calls = [];
  const toasts = [];
  const view = renderRow("network", "cooling", "USDT", true, 3, {
    can: (permission) => permission === "network_f5_commission_reject",
    suspendF5UserCommissions: async (...args) => calls.push(args),
    toast: (message) => toasts.push(message),
  });
  const pause = view.buttons.find((node) => textOf(node).includes("暂停"));
  assert.ok(pause, "真实行内暂停入口必须存在");
  pause.props.onClick();
  await view.confirmations[0].run("核对工单后暂停", { kinds: "network,direct_device_earning" });
  assert.deepEqual(calls, [[9, ["network", "direct_device_earning"], true, "核对工单后暂停"]]);
  assert.equal(toasts[0], `用户 9 的 ${F5_KIND_LABELS.network}、${F5_KIND_LABELS.direct_device_earning} 已提交 A2 待确认`);
  assert.doesNotMatch(toasts[0], /network|direct_device_earning/);
});

test("F5 恢复确认和提示使用相同奖种名称", async () => {
  const calls = [], toasts = [];
  const data = {
    pendingCalculations: [], pendingCalculationCount: 0,
    summary: { monthlyCommissionSpendLabel: "", coolingBalanceLabel: "", withdrawableThisMonthLabel: "", frozenCount: 0 },
    commissionEvents: [], commissionKinds: [], statusDistribution: [], anomalies: [], coolingPolicy: [],
    activeSuspensions: [{ userId: "9", kind: "direct_device_earning", reason: "核对", operator: "审核", updatedAt: "2026-10-06" }],
    operationHistory: [{ operationNo: "F5-1", operationType: "RESUME", userId: "9", kinds: "network,direct_device_earning", reason: "核对", operator: "审核", createdAt: "2026-10-06" }], configValues: {}, total: 0, nextCursor: "",
  };
  const view = renderRow("network", "cooling", "USDT", true, 3, {
    can: (permission) => permission === "network_f5_commission_reject", f5Overview: data,
    suspendF5UserCommissions: async (...args) => calls.push(args), toast: (message) => toasts.push(message),
  });
  button(view, "恢复奖种").props.onClick();
  const confirmation = view.confirmations[0];
  const history = textOf(view.nodes.find((node) => node.type === "tr" && textOf(node).includes("F5-1")));
  assert.match(history, /恢复/);
  assert.match(history, /网络购买奖励、直属设备收益分成/);
  assert.doesNotMatch(history, /RESUME|network|direct_device_earning/);
  assert.match(confirmation.name, /直属设备收益分成/);
  assert.doesNotMatch(confirmation.name + confirmation.detail, /direct_device_earning|suspended=/);
  await confirmation.run("核对后恢复奖种");
  assert.deepEqual(calls, [[9, ["direct_device_earning"], false, "核对后恢复奖种"]]);
  assert.match(toasts[0], /直属设备收益分成/);
  assert.doesNotMatch(toasts[0], /direct_device_earning/);
});

test("①a 直属两类双币冷却行不提供提前解锁，包括剩余天数显示为零", () => {
  for (const kind of ["direct_purchase", "direct_device_earning"]) {
    for (const cur of ["USDT", "NEX"]) {
      for (const days of [3, 0]) {
        const view = renderRow(kind, "cooling", cur, true, days);
        assert.equal(button(view, "提前解锁"), undefined, `${kind}/${cur}/${days} 天仍处于 cooling，不应承诺跳过冷却`);
      }
    }
  }
});

test("①b 历史 network 双币保留冻结、提前解锁与解冻确认", () => {
  for (const cur of ["USDT", "NEX"]) {
    for (const [status, actions] of [["cooling", ["冻结", "提前解锁"]], ["frozen", ["解冻"]]]) {
      const view = renderRow("network", status, cur);
      assert.deepEqual(view.buttons.map(textOf).filter((label) => disposalLabels.includes(label)), actions);
      for (const label of actions) button(view, label).props.onClick();
      assert.deepEqual(view.confirmations.map(({ op, paramKey, expectedVersion, fixedVal, amplify }) =>
        ({ op, paramKey, expectedVersion, fixedVal, amplify })), actions.map((label) => ({
        op: "dispose", paramKey: view.row.auditKey, expectedVersion: 4,
        fixedVal: { 冻结: "frozen", 提前解锁: "unlocked", 解冻: "cooling" }[label], amplify: label === "提前解锁",
      })));
      if (status === "cooling") assert.match(view.confirmations[1].detail, /跳过剩余冷却直接进入可提余额/);
    }
  }
});

test("①c 直属两类双币保留整组冻结、解冻，解冻恢复 cooling", () => {
  for (const kind of ["direct_purchase", "direct_device_earning"]) {
    for (const cur of ["USDT", "NEX"]) {
      for (const [status, label, fixedVal] of [["cooling", "冻结", "frozen"], ["frozen", "解冻", "cooling"]]) {
        const view = renderRow(kind, status, cur);
        assert.deepEqual(view.buttons.map(textOf).filter((item) => disposalLabels.includes(item)), [label]);
        button(view, label).props.onClick();
        assert.equal(view.confirmations.length, 1);
        const confirmation = view.confirmations[0];
        assert.deepEqual({ op: confirmation.op, paramKey: confirmation.paramKey, expectedVersion: confirmation.expectedVersion,
          fixedVal: confirmation.fixedVal, amplify: confirmation.amplify },
        { op: "dispose", paramKey: view.row.auditKey, expectedVersion: 4, fixedVal, amplify: false });
        assert.match(confirmation.detail, /结算组 DR-71 · 12 USDT \+ 120 NEX（整组处理）/);
        if (status === "frozen") assert.match(confirmation.detail, /不会绕过剩余冷却期/);
      }
    }
  }
});

test("①d 无处置权限时历史与直属 cooling/frozen 行均无处置按钮", () => {
  for (const kind of ["network", "direct_purchase", "direct_device_earning"]) {
    for (const status of ["cooling", "frozen"]) {
      const view = renderRow(kind, status, "USDT", false);
      assert.deepEqual(view.buttons.map(textOf).filter((label) => disposalLabels.includes(label)), []);
      assert.deepEqual(view.confirmations, []);
    }
  }
});

test("② dispose 规格:paramKey=auditKey · 目标值固定 · amplify 按资金方向", () => {
  const disposeBody = grabBetween(component, "const dispose = (", "const reverse = (");
  assert.match(disposeBody, /paramKey:\s*row\.auditKey/, "dispose 必须用行上服务端下发的 auditKey,不许前端手拼状态键");
  assert.match(disposeBody, /op:\s*"dispose"/, "必须走 shell 的 dispose 分支(A2 管线),不许改直连");
  const freezeSpec = grabBetween(disposeBody, "freeze: {", "unlock: {");
  assert.match(freezeSpec, /amplify:\s*false/, "冻结是收紧方向,弹窗不该标放大资金流出");
  assert.match(freezeSpec, /fixedVal:\s*"frozen"/, "冻结目标值漂移");
  const unlockSpec = grabBetween(disposeBody, "unlock: {", "unfreeze: {");
  assert.match(unlockSpec, /amplify:\s*true/, "提前解锁放大可提余额,弹窗必须标 amplify 触发 B1 护栏");
  assert.match(unlockSpec, /fixedVal:\s*"unlocked"/, "解锁目标值漂移");
  const unfreezeSpec = grabBetween(disposeBody, "unfreeze: {", "}[kind]");
  assert.match(unfreezeSpec, /amplify:\s*false/, "解冻只恢复冻结前的 cooling,不得误报为放大可提余额");
  assert.match(unfreezeSpec, /fixedVal:\s*"cooling"/, "解冻必须恢复 cooling,不得绕过剩余冷却期");
});

test("③ shell 管线:F5 dispose 路由到 updateF5Config → f_commission_status A2 票", () => {
  const disposeBranch = grabBetween(shell, 'mc.op === "dispose"', "F_CONFIRM_SHAPE_UNKNOWN");
  assert.match(disposeBranch, /tab === "F5"/, "shell dispose 分支丢了 F5 路由");
  assert.match(disposeBranch, /ctx\.updateF5Config\(mc\.paramKey, mc\.fixedVal, reason, mc\.expectedVersion\)/, "F5 dispose 必须携带 expectedVersion 经 updateF5Config(A2 propose),不许静默吞掉");
  // 处置完成提示必须如实:此刻只是入了 A2 待执行队列,冻结这种抢时间的动作被「已生效」
  // 误报会让运营提前撤场(skeptic P2-4)。
  assert.match(disposeBranch, /已提交/, "dispose 完成 toast 必须说「已提交」而非宣称已生效");
  assert.doesNotMatch(disposeBranch, /已生效/, "dispose 分支禁再出现「已生效」话术(propose 后未落库)");
  assert.match(shell, /startsWith\("F\.commission\."\) && key\.endsWith\("\.status"\)/, "resolveFOp 丢了佣金状态键映射,dispose 会落错 op");
  assert.match(registry, /op:\s*"f_commission_status"/, "高敏操作注册表丢了 f_commission_status,A2 票建不出来");
  assert.match(registry, /type:\s*"commission_event"/, "f_commission_status 的对象锁类型漂移");
});

test("④ 数据契约:F5 事件行必须带 auditKey(F.commission.{id}.status)", () => {
  assert.match(f1Client, /auditKey/, "F5CommissionEvent 丢了 auditKey 字段,行内处置无键可用");
  assert.match(f1Client, /F\.commission\./, "auditKey 的键形态漂移(resolveFOp 与 buildTarget 都按 F.commission.*.status 解析)");
});

test("④b D4 下钻必须同时具备真实账本号与 D4 读取权限", () => {
  assert.match(component, /const canReadD4 = ctx\.can\("finance_d4_read"\)/,
    "F5 未按 D4 后端读取权限控制下钻,最小权限运营员会点击后被路由弹回");
  assert.match(component, /canReadD4 && row\.ledgerBizNo/,
    "D4 链接必须同时满足权限与服务端真实 ledgerBizNo");
  assert.match(component, /D4 无权限/,
    "无 D4 权限时必须明确说明,不能保留一个会静默跳回的死链接");
});

test("⑤ 动作台账:OPS-F-10 行内三动作口径落台账,不再虚标", () => {
  const row = grabBetween(manifest, '"id": "OPS-F-10"', '"id": "OPS-G-01"');
  assert.match(row, /单笔冻结\/提前解锁\/解冻/, "OPS-F-10 动作口径没更新,台账仍是旧的模糊三词");
  assert.match(row, /"restAction": "f_commission_status"/, "OPS-F-10 锚漂移");
});
