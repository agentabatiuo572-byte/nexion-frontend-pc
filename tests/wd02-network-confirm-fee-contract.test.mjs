// FEAT-WD02 提现费用改造 · D5 三网络固定确认费 + D2 双形态契约
// 同款先例:tests/wd01-trust-payout-params-contract.test.mjs(source-needle)+ 行为固定靶
// (Node ≥23 原生 type-strip:把 d-client 纯函数抽取成临时 .ts 后 import 真跑 —— 源码 regex
//  抓不到「判据写了但没被消费」,而 D2 三态判型正是独立证伪构造出洞的地方,必须行为验)。
// 红测方式见每条断言注释 —— 去掉被断言的实现,对应 test 必须 FAIL。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const client = read("lib/admin/d-client.ts");
const page = read("app/components/domain-views/d-tabs/d5-params.tsx");
const h1Page = read("app/components/domain-views/h-tabs/h1-phase.tsx");
const d2Page = read("app/components/domain-views/d-tabs/d2-withdrawals.tsx");

// ── 🔴 跨仓种子契约声明(规格 ⑦ parity 锚点)────────────────────────────
// 这是 admin 侧的**声明性锚**(非 :8110 运行时值 —— D5 无 mock seed,后端字段同步是人肉义务):
// uniapp scripts/verify.sh「WD02 network-confirm-fee parity」哨兵逐键比对
// uniapp mock/platform-config.ts networkConfirmFeeUsd ↔ 本文件所锚定的 d-client 默认种子。
// 单边改值 → uniapp verify 红;改这里不改 d-client → 本测试红。
const WD02_SEED_NETWORK_CONFIRM_FEE_USD = { trc20: 1, bep20: 1, erc20: 5 };

test("WD02 d-client 默认种子与契约声明逐键一致(跨仓 parity 锚)", () => {
  // 红测:d-client 单边改 erc20 5→4 → FAIL
  const m = client.match(/D5_NETWORK_CONFIRM_FEE_DEFAULT = \{ trc20: ([\d.]+), bep20: ([\d.]+), erc20: ([\d.]+) \}/);
  assert.ok(m, "d-client 缺 D5_NETWORK_CONFIRM_FEE_DEFAULT 字面量");
  assert.equal(Number(m[1]), WD02_SEED_NETWORK_CONFIRM_FEE_USD.trc20);
  assert.equal(Number(m[2]), WD02_SEED_NETWORK_CONFIRM_FEE_USD.bep20);
  assert.equal(Number(m[3]), WD02_SEED_NETWORK_CONFIRM_FEE_USD.erc20);
  assert.match(client, /D5_NETWORK_CONFIRM_FEE_MAX = 25/);
});

test("WD02 D5 类型与可写变更集:三网络确认费在、旧三件套与惩罚费不在", () => {
  // 红测:从 D5Params 删掉 networkConfirmFeeUsd → FAIL
  assert.match(client, /networkConfirmFeeUsd: \{ trc20: number; bep20: number; erc20: number \}/);
  assert.match(client, /D5OwnedChanges[\s\S]{0,320}networkConfirmFeeUsd/);
  // 红测:把 networkFeeRatio/penaltyFeeRate 加回 D5Params → FAIL(剥注释后扫)
  const stripped = client.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  const d5Block = stripped.match(/export interface D5Params \{[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(!/networkFeeRatio|networkFeeMin|networkFeeMax|penaltyFeeRate/.test(d5Block),
    "D5Params 仍残留旧费字段");
});

test("WD02 D5 页:步进 0.5 + 字段级越界红字 + 0 值免手续费警示 + 恢复默认走确认链", () => {
  assert.match(page, /aria-label="TRC20 网络确认费目标值"[\s\S]{0,140}step="0\.5"/);
  assert.match(page, /aria-label="BEP20 网络确认费目标值"[\s\S]{0,140}step="0\.5"/);
  assert.match(page, /aria-label="ERC20 网络确认费目标值"[\s\S]{0,140}step="0\.5"/);
  // 红测:删掉任一字段级红字 → FAIL
  assert.match(page, /TRC20 超出 0–\{D5_NETWORK_CONFIRM_FEE_MAX\} 值域/);
  assert.match(page, /BEP20 超出 0–\{D5_NETWORK_CONFIRM_FEE_MAX\} 值域/);
  assert.match(page, /ERC20 超出 0–\{D5_NETWORK_CONFIRM_FEE_MAX\} 值域/);
  assert.match(page, /免手续费/);
  // 恢复默认按钮回填种子且仍走 submit 确认链(不是绕过 openActionConfirm 直写)
  assert.match(page, /恢复默认/);
  assert.match(page, /submit\("网络确认费恢复默认", \{ networkConfirmFeeUsd: \{ \.\.\.D5_NETWORK_CONFIRM_FEE_DEFAULT \} \}/);
});

test("WD02 D5/H1 运营渲染面无惩罚费残留(注释已剥;D2 双形态分支为唯一豁免)", () => {
  const strip = (s) => s
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  // 红测:把「提现惩罚费率」行加回 D5 或 H1 → FAIL
  assert.ok(!/penaltyFeeRate|withdrawPenaltyFeeRate|提现惩罚费率/.test(strip(page)), "d5-params 残留惩罚费");
  assert.ok(!/penaltyFeeRate|withdrawPenaltyFeeRate|提现惩罚费率/.test(strip(h1Page)), "h1-phase 残留惩罚费");
  // D2 渲染层必须按 feeModel 分支(新单不许打出一串 null 旧字段)
  assert.match(d2Page, /row\.feeModel === "confirm"/);
  assert.match(d2Page, /detail\.feeModel === "confirm"/);
  assert.match(d2Page, /网络确认费/);
});

// ── 行为固定靶:抽取 d-client 纯函数真跑(Node 原生 type-strip) ──────────
function grabFn(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `d-client 里找不到 function ${name}(被改名或删除?)`);
  let p = source.indexOf("(", start);
  let paren = 0;
  for (; p < source.length; p++) {
    if (source[p] === "(") paren++;
    else if (source[p] === ")") { paren--; if (paren === 0) { p++; break; } }
  }
  let depth = 0;
  let started = false;
  for (; p < source.length; p++) {
    if (source[p] === "{") { depth++; started = true; }
    else if (source[p] === "}") { depth--; if (started && depth === 0) return source.slice(start, p + 1); }
  }
  assert.fail(`${name} 括号不闭合`);
}

async function loadExtracted() {
  const constants = [...client.matchAll(/export const (D5_[A-Z_0-9]+) = ([^;]+);/g)]
    .map((m) => `const ${m[1]} = ${m[2]};`)
    .join("\n");
  const fns = [
    "d2Invalid", "d2Object", "d2Number", "d2NullableNumber", "d2RoutingPriority",
    "d2String", "d2Integer", "d2OptionalString", "normalizeWithdrawal",
    "d5Number", "d5Object", "d5Integer", "d5Boolean", "d5String", "normalizeD5Params",
  ].map((name) => grabFn(client, name)).join("\n");
  const bundle = [
    "// auto-extracted from lib/admin/d-client.ts by wd02 contract test — DO NOT EDIT",
    "type D2Withdrawal = any;",
    "type D5Params = any;",
    "const formatAdminApiError = (code: string, detail?: string): string => detail || code;",
    constants,
    fns,
    "export { normalizeWithdrawal, normalizeD5Params };",
  ].join("\n").replace(/\bexport function /g, "function ");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wd02-extract-"));
  const file = path.join(dir, "extract.ts");
  fs.writeFileSync(file, bundle);
  return import(pathToFileURL(file).href);
}

const extracted = await loadExtracted();

/** 合法 D5 服务端响应底板(所有必填字段齐)。 */
function d5Payload(overrides = {}) {
  return {
    version: 3,
    dailyLimitCount: 1,
    balanceMaxRatio: 0.8,
    nexFeeOffsetRate: 0.4,
    cooldownDays: 0,
    complianceHoldEnabled: false,
    currentPhase: "P1",
    currentMonth: 1,
    coverageRatio: 120,
    redlinePct: 70,
    coverageReliable: true,
    smallAmountThresholdUsd: 50,
    payoutSlaHours: 24,
    sourceByField: {
      dailyLimitCount: "d5", balanceMaxRatio: "d5", nexFeeOffsetRate: "d5",
      networkConfirmFeeUsd: "d5", smallAmountThresholdUsd: "d5", payoutSlaHours: "d5",
      cooldownDays: "phase-h1", complianceHoldEnabled: "phase-h1",
    },
    ...overrides,
  };
}

test("WD02 行为:networkConfirmFeeUsd 整组缺失/null → fail-closed", () => {
  for (const absent of [d5Payload(), d5Payload({ networkConfirmFeeUsd: null })]) {
    assert.throws(() => extracted.normalizeD5Params(absent), /D5_RESPONSE_INVALID/);
  }
});

test("WD02 行为:值域固定靶 —— 30/-1/26 → invalid;0 与 25 → 合法(与 uniapp 26→false 同数字系)", () => {
  const ok0 = extracted.normalizeD5Params(d5Payload({ networkConfirmFeeUsd: { trc20: 0, bep20: 0, erc20: 0 } }));
  assert.equal(ok0.networkConfirmFeeUsd.erc20, 0);
  const ok25 = extracted.normalizeD5Params(d5Payload({ networkConfirmFeeUsd: { trc20: 25, bep20: 25, erc20: 25 } }));
  assert.equal(ok25.networkConfirmFeeUsd.trc20, 25);
  // 红测:business-range 删掉三键检查 → 下面三条 FAIL
  for (const bad of [
    { trc20: 1, bep20: 1, erc20: 30 },
    { trc20: -1, bep20: 1, erc20: 5 },
    { trc20: 1, bep20: 26, erc20: 5 },
  ]) {
    assert.throws(() => extracted.normalizeD5Params(d5Payload({ networkConfirmFeeUsd: bad })),
      /D5_RESPONSE_INVALID/);
  }
  // 组下发但缺键/非数 → fail-closed(半组配置不许静默用默认补)
  assert.throws(() => extracted.normalizeD5Params(d5Payload({ networkConfirmFeeUsd: { trc20: 1, erc20: 5 } })),
    /D5_RESPONSE_INVALID/);
  assert.throws(() => extracted.normalizeD5Params(d5Payload({ networkConfirmFeeUsd: { trc20: 1, bep20: null, erc20: 5 } })),
    /D5_RESPONSE_INVALID/);
});

/** 合法 D2 提现行底板(旧模型,全字段齐)。 */
function d2Row(overrides = {}) {
  return {
    id: 7, userId: 11, withdrawalNo: "WD-20260802-1001", asset: "USDT", chain: "TRC20",
    amount: 100, fee: 1, targetAddress: "TX9y…", riskDecisionId: null, chainTxHash: null,
    status: "REVIEW_PENDING", createdAt: "2026-08-02 10:00:00", updatedAt: "2026-08-02 10:00:00",
    userNo: "U-11", nickname: "n", phoneMasked: "84*", userStatus: "ACTIVE",
    riskScore: 12, hitRules: "", riskReason: "", withdrawalCount24h: 1,
    statusHistory: "", auditTrail: "", failureReason: "", userLevel: "", deviceSummary: "",
    referralPosition: "", riskScoreBreakdown: "", withdrawalHistory: "",
    networkFeeRate: 0.01, networkFeeMin: 1, networkFeeMax: 25, networkFee: 1,
    penaltyFeeRate: 0.2, grossFee: 21, nexBurned: 0, nexFeeOffsetRate: 0.4,
    feeWaived: 0, actualFee: 21, netReceive: 79,
    ipSegment: "", holdUntil: "", lifecycleOwner: "", freezePeriod: "", previousStatus: "",
    routingPriority: "NORMAL", k4BandLowMax: null, k4BandHighMin: null, k4AutoEscalateScore: null,
    k3RiskRoute: "manual",
    ...overrides,
  };
}

test("WD02 行为:D2 三态判型 —— 旧单全字段照旧通过", () => {
  const out = extracted.normalizeWithdrawal(d2Row());
  assert.equal(out.feeModel, "legacy");
  assert.equal(out.grossFee, 21);
});

test("WD02 行为:🔴 毒样本 —— 新单被原始 double DTO 零填旧字段,必须判新型且新等式仍被执行", () => {
  // 独立证伪构造的洞:penaltyFeeRate:0/networkFee:0/grossFee:0 时旧等式 |0−0−a×0| 空真恒过,
  // 若按「含 penaltyFeeRate 字段=旧单」判型,新等式一次都不会被验(校验洞)。
  const poisoned = d2Row({
    networkConfirmUsd: 5, networkFeeRate: 0, networkFeeMin: 0, networkFeeMax: 0,
    networkFee: 0, penaltyFeeRate: 0, grossFee: 0,
    nexBurned: 0, feeWaived: 0, actualFee: 5, netReceive: 95,
  });
  const out = extracted.normalizeWithdrawal(poisoned);
  assert.equal(out.feeModel, "confirm");
  // 红测:把新等式从 confirm 分支删掉 → 本条 FAIL(actualFee 3 ≠ max(0, 5−0) 必须被拒)
  assert.throws(() => extracted.normalizeWithdrawal(d2Row({
    networkConfirmUsd: 5, networkFee: 0, penaltyFeeRate: 0, grossFee: 0,
    nexBurned: 0, feeWaived: 0, actualFee: 3, netReceive: 97,
  })), /D2_RESPONSE_INVALID/);
});

test("WD02 行为:新单旧字段发 null → 不再 100% 拒单(可空解析);缺自家字段仍 fail-closed", () => {
  // 反向洞:d2Number 全必填时,后端对旧字段序列化 null → 新单 100% 被拒、D2 永久 fail-closed。
  const nullOld = extracted.normalizeWithdrawal(d2Row({
    networkConfirmUsd: 1, networkFeeRate: null, networkFeeMin: null, networkFeeMax: null,
    networkFee: null, penaltyFeeRate: null, grossFee: null,
    nexBurned: 3, feeWaived: 1, actualFee: 0, netReceive: 100,
  }));
  assert.equal(nullOld.feeModel, "confirm");
  assert.equal(nullOld.networkConfirmUsd, 1);
  // 三态之三:两头都缺 → invalid(不许静默放行)
  assert.throws(() => extracted.normalizeWithdrawal(d2Row({
    networkConfirmUsd: null, networkFeeRate: null, networkFeeMin: null, networkFeeMax: null,
    networkFee: null, penaltyFeeRate: null, grossFee: null,
  })), /D2_RESPONSE_INVALID/);
  // confirm 单值域:确认费 > 25 拒(与 D5 值域同数字系)
  assert.throws(() => extracted.normalizeWithdrawal(d2Row({
    networkConfirmUsd: 26, networkFee: null, penaltyFeeRate: null, grossFee: null,
    networkFeeRate: null, networkFeeMin: null, networkFeeMax: null,
    nexBurned: 0, feeWaived: 0, actualFee: 26, netReceive: 74,
  })), /D2_RESPONSE_INVALID/);
});

// ── D2 财务闭合补齐(2×P1+1×P2,2026-08-03):netReceive 等式 + 旧单 actualFee 等式 + 舍入容差 ──
// 公式权威源 = PRD_v1 D5「提现手续费模型(本子模块权威定义)」:actualFee = grossFee − feeWaived、
// netReceive = 提现额 − actualFee(双形态同式;uniapp nex-faucet.ts 同款)。
// 每条反例按合取项隔离:除被测等式外其余不变量全自洽,删掉那一条等式 → 恰好对应断言红。

/** confirm 形态底板:旧字段整组 null(真实新单 DTO 形态)。 */
function d2ConfirmRow(overrides = {}) {
  return d2Row({
    networkConfirmUsd: 5, networkFeeRate: null, networkFeeMin: null, networkFeeMax: null,
    networkFee: null, penaltyFeeRate: null, grossFee: null,
    nexBurned: 0, feeWaived: 0, actualFee: 5, netReceive: 95,
    ...overrides,
  });
}

test("WD02 行为:🔴 P1-A netReceive 等式 —— confirm 审计反例(费 5 报到账 80,应 95)必须被拒", () => {
  // 红测:把 confirm 分支 |netReceive − (amount − actualFee)| 等式删掉/容差改宽 → 本条 FAIL
  // (actualFee 5 = max(0, 5−0) 自洽、80 < amount,旧界值全过 —— 只有新等式能拦)。
  assert.throws(() => extracted.normalizeWithdrawal(d2ConfirmRow({ netReceive: 80 })),
    /D2_RESPONSE_INVALID/);
  // 自洽 confirm 单照常通过(等式不误杀)
  const ok = extracted.normalizeWithdrawal(d2ConfirmRow());
  assert.equal(ok.netReceive, 95);
});

test("WD02 行为:🔴 P1-A netReceive 等式 —— legacy 单到账脱钩(应 79 报 90)必须被拒", () => {
  // 红测:把 legacy 分支 netReceive 等式删掉 → 本条 FAIL(90 < amount,actualFee 21 = 21−0 自洽)。
  assert.throws(() => extracted.normalizeWithdrawal(d2Row({ netReceive: 90 })),
    /D2_RESPONSE_INVALID/);
});

test("WD02 行为:🔴 P1-B legacy actualFee 等式 —— 审计反例 grossFee 21/feeWaived 0/actualFee 1 必须被拒", () => {
  // 红测:把 legacy 分支 |actualFee − (grossFee − feeWaived)| 等式删掉 → 本条 FAIL
  // (netReceive 给 99 = 100−1 让 netReceive 等式自洽 —— 隔离到只有 actualFee 等式能拦)。
  assert.throws(() => extracted.normalizeWithdrawal(d2Row({ actualFee: 1, netReceive: 99 })),
    /D2_RESPONSE_INVALID/);
  // NEX 抵扣旧单(feeWaived > 0)必须过:actualFee 13 = 21−8、netReceive 87 = 100−13。
  // 这是 netReceive 锚 actualFee 而非 grossFee 的判别靶(amount − grossFee = 79 ≠ 87,PRD 公式胜)。
  const waived = extracted.normalizeWithdrawal(d2Row({
    nexBurned: 20, feeWaived: 8, actualFee: 13, netReceive: 87,
  }));
  assert.equal(waived.netReceive, 87);
});

test("WD02 行为:P2 舍入容差 —— 等式差 0.00005 必须通过不冻整页;真越界仍拒", () => {
  // 红测:把上界比较改回严格 netReceive > amount、或把等式容差删成 !== → 本条 FAIL。
  // confirm 全免手续费单:netReceive 100.00005 与 amount 100 差 0.00005(合法舍入,含轻微超 amount)。
  const c = extracted.normalizeWithdrawal(d2ConfirmRow({
    nexBurned: 20, feeWaived: 5, actualFee: 0, netReceive: 100.00005,
  }));
  assert.equal(c.feeModel, "confirm");
  // legacy 舍入:netReceive 79.00005 ≈ 100 − 21。
  const l = extracted.normalizeWithdrawal(d2Row({ netReceive: 79.00005 }));
  assert.equal(l.feeModel, "legacy");
  // legacy 全免手续费单贴 amount 舍入(专测 legacy 上界容差,与 confirm 侧对称):
  // grossFee 1 = networkFee 1 + 100×0、feeWaived 1 = 2.5×0.4、actualFee 0、netReceive 100.00005。
  const lTop = extracted.normalizeWithdrawal(d2Row({
    grossFee: 1, penaltyFeeRate: 0, nexBurned: 2.5, feeWaived: 1, actualFee: 0, netReceive: 100.00005,
  }));
  assert.equal(lTop.netReceive, 100.00005);
  // 容差不是放水:超 amount 0.001(> 0.0001)仍拒(双形态)。
  assert.throws(() => extracted.normalizeWithdrawal(d2ConfirmRow({
    nexBurned: 20, feeWaived: 5, actualFee: 0, netReceive: 100.001,
  })), /D2_RESPONSE_INVALID/);
  assert.throws(() => extracted.normalizeWithdrawal(d2Row({
    grossFee: 1, penaltyFeeRate: 0, actualFee: 1, netReceive: 100.001,
  })), /D2_RESPONSE_INVALID/);
});
