#!/usr/bin/env node
/**
 * L3d/L5 canon-number sentinel.
 *
 * Reads docs/remediation/canon-numbers.json, then extracts the same business
 * constants from Admin and UniApp sources. The gate fails on numeric drift,
 * so a display copy update cannot silently fork core economics.
 *
 * 2026-06-26: H5 reference workspace retired; only Admin + UniApp ends are
 * checked (formerly tri-end).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_ROOT = path.resolve(ROOT, "..");
const UNI_ROOT_CANDIDATES = [
  path.join(PLAN_ROOT, "Nexion-uniapp"),
  path.join(PLAN_ROOT, "nexion-frontend-uniapp"),
  path.resolve(ROOT, "..", "..", "nexion-frontend-uniapp"),
];
const UNI_ROOT = UNI_ROOT_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? UNI_ROOT_CANDIDATES[0];
const CANON_PATH = path.join(ROOT, "docs", "remediation", "canon-numbers.json");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function readIfExists(file) {
  return fs.existsSync(file) ? read(file) : null;
}

function numberFrom(raw) {
  const n = Number(String(raw).replace(/_/g, ""));
  if (!Number.isFinite(n)) throw new Error(`Cannot parse number: ${raw}`);
  return n;
}

function approxEqual(a, b, tolerance = 1e-9) {
  return Math.abs(Number(a) - Number(b)) <= tolerance;
}

function extractConstNumber(src, name) {
  const re = new RegExp(`(?:export\\s+)?const\\s+${name}\\s*=\\s*(-?[0-9][0-9_]*(?:\\.[0-9]+)?)`);
  const match = src.match(re);
  return match ? numberFrom(match[1]) : null;
}

function extractRecord(src, name) {
  const start = src.search(new RegExp(`(?:export\\s+)?const\\s+${name}\\s*[:=]`));
  if (start < 0) return null;
  const after = src.slice(start);
  const open = after.indexOf("{");
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < after.length; i += 1) {
    const ch = after[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return after.slice(open + 1, i);
    }
  }
  return null;
}

function parseNumberRecord(src, name) {
  const body = extractRecord(src, name);
  if (!body) return null;
  const out = {};
  for (const match of body.matchAll(/([A-Za-z0-9_]+)\s*:\s*(-?[0-9][0-9_]*(?:\.[0-9]+)?)/g)) {
    out[match[1]] = numberFrom(match[2]);
  }
  return out;
}

function extractArrayItemByField(src, arrayName, field, value) {
  const start = src.search(new RegExp(`(?:export\\s+)?const\\s+${arrayName}\\s*[:=]`));
  if (start < 0) return null;
  const arrayStart = src.indexOf("[", start);
  if (arrayStart < 0) return null;
  const needle = `${field}: "${value}"`;
  const valueAt = src.indexOf(needle, arrayStart);
  if (valueAt < 0) return null;
  const itemStart = src.lastIndexOf("{", valueAt);
  let depth = 0;
  for (let i = itemStart; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(itemStart, i + 1);
    }
  }
  return null;
}

function extractFieldNumber(block, field) {
  if (!block) return null;
  const match = block.match(new RegExp(`${field}\\s*:\\s*(-?[0-9][0-9_]*(?:\\.[0-9]+)?)`));
  return match ? numberFrom(match[1]) : null;
}

function extractAdminTier(src, tier) {
  const block = extractArrayItemByField(src, "USDT_TIERS", "tier", tier);
  if (!block) return null;
  return {
    apyPct: extractFieldNumber(block, "apy"),
    penaltyPct: extractFieldNumber(block, "pen"),
  };
}

function collectProductValues(src) {
  const values = {};
  for (const id of Object.keys(canon.products)) {
    const block = extractArrayItemByField(src, "PRODUCTS", "id", id);
    if (!block) {
      values[id] = null;
      continue;
    }
    values[id] = {
      price: extractFieldNumber(block, "price"),
      dailyEarn: extractFieldNumber(block, "dailyEarn"),
      dailyEarnNEX: extractFieldNumber(block, "dailyEarnNEX"),
    };
  }
  return values;
}

function pushCheck(checks, id, ok, details, evidence = []) {
  checks.push({ id, status: ok ? "passed" : "failed", details, evidence });
}

const canon = JSON.parse(read(CANON_PATH));
const checks = [];
const failures = [];

function expectNumber(id, actual, expected, evidence, tolerance = 1e-9) {
  const ok = actual !== null && approxEqual(actual, expected, tolerance);
  pushCheck(checks, id, ok, `${actual} expected ${expected}`, evidence);
  if (!ok) failures.push(`${id}: ${actual} expected ${expected}`);
}

const uniStaking = readIfExists(path.join(UNI_ROOT, "src", "store", "staking.ts"));
const adminG = readIfExists(path.join(ROOT, "app", "components", "domain-views", "g-tabs", "data.ts"));

if (!uniStaking) {
  failures.push("sibling UniApp staking source missing; cannot prove cross-end canon");
} else {
  const uniApy = parseNumberRecord(uniStaking, "STAKING_APY");
  const uniPenalty = parseNumberRecord(uniStaking, "STAKING_PENALTY");
  for (const [term, expected] of Object.entries(canon.staking.usdtApy)) {
    expectNumber(`staking.uni.apy.${term}`, uniApy?.[term] ?? null, expected, ["../Nexion-uniapp/src/store/staking.ts"]);
    if (adminG) {
      const adminTier = extractAdminTier(adminG, canon.staking.adminUsdtTierByTerm[term]);
      expectNumber(`staking.admin.apy.${term}`, (adminTier?.apyPct ?? null) === null ? null : adminTier.apyPct / 100, expected, ["app/components/domain-views/g-tabs/data.ts"]);
    }
  }
  for (const [term, expected] of Object.entries(canon.staking.usdtPenalty)) {
    expectNumber(`staking.uni.penalty.${term}`, uniPenalty?.[term] ?? null, expected, ["../Nexion-uniapp/src/store/staking.ts"]);
    if (adminG) {
      const adminTier = extractAdminTier(adminG, canon.staking.adminUsdtTierByTerm[term]);
      expectNumber(`staking.admin.penalty.${term}`, (adminTier?.penaltyPct ?? null) === null ? null : adminTier.penaltyPct / 100, expected, ["app/components/domain-views/g-tabs/data.ts"]);
    }
  }
}

const uniGenesis = readIfExists(path.join(UNI_ROOT, "src", "store", "genesis.ts"));
if (!uniGenesis) {
  failures.push("sibling UniApp Genesis source missing; cannot prove Genesis canon");
} else {
  const adminGenesis = adminG ? (parseNumberRecord(adminG, "GENESIS") ?? {}) : null;
  for (const [label, src, evidence] of [
    ["uni", uniGenesis, "../Nexion-uniapp/src/store/genesis.ts"],
  ]) {
    expectNumber(`genesis.${label}.totalSlots`, extractConstNumber(src, "TOTAL_SLOTS"), canon.genesis.totalSlots, [evidence]);
    expectNumber(`genesis.${label}.royaltyRate`, extractConstNumber(src, "GENESIS_ROYALTY_RATE"), canon.genesis.royaltyRate, [evidence]);
    // 分红延期改造:单一 unitPriceUSDT($9,999) → GENESIS_TIERS 3 档阶梯,unitPriceUSDT 变 computed(当前档)。
    // 锚点价 = 公售 T1 档 priceUSDT(与 canon.unitPriceUSDT 同源),从 GENESIS_TIERS 的 t1 条目抽取。
    const t1Match = src.match(/id:\s*"t1"[^}]*priceUSDT:\s*(\d+)/);
    expectNumber(`genesis.${label}.unitPriceAnchor`, t1Match ? Number(t1Match[1]) : null, canon.genesis.unitPriceUSDT, [evidence]);
    expectNumber(`genesis.${label}.seedSoldSlots`, extractFieldNumber(src, "soldSlots"), canon.genesis.seedSoldSlots, [evidence]);
  }
  if (adminGenesis) {
    expectNumber("genesis.admin.totalSlots", adminGenesis.totalSlots ?? null, canon.genesis.totalSlots, ["app/components/domain-views/g-tabs/data.ts"]);
    expectNumber("genesis.admin.unitPrice", adminGenesis.unitPrice ?? null, canon.genesis.unitPriceUSDT, ["app/components/domain-views/g-tabs/data.ts"]);
    expectNumber("genesis.admin.royaltyRate", (adminGenesis.royaltyPct ?? null) === null ? null : adminGenesis.royaltyPct / 100, canon.genesis.royaltyRate, ["app/components/domain-views/g-tabs/data.ts"]);
    expectNumber("genesis.admin.dividendShareRate", (adminGenesis.dividendSharePct ?? null) === null ? null : adminGenesis.dividendSharePct / 100, canon.genesis.dividendShareRate, ["app/components/domain-views/g-tabs/data.ts"]);
    expectNumber("genesis.admin.perSlotDisplay", adminGenesis.perSlotPerDay ?? null, canon.genesis.perSlotPerDayDisplayUSD, ["app/components/domain-views/g-tabs/data.ts"], 0.1);
    expectNumber("genesis.admin.floorPerNode", adminGenesis.floorPerNodePerDay ?? null, canon.genesis.floorPerNodePerDayUSD, ["app/components/domain-views/g-tabs/data.ts"]);
  }
}

const uniLifecycle = readIfExists(path.join(UNI_ROOT, "src", "store", "device-lifecycle.ts"));
const adminE = read(path.join(ROOT, "app", "components", "domain-views", "e-tabs", "data.ts"));
if (!uniLifecycle) {
  failures.push("sibling UniApp lifecycle source missing; cannot prove lifecycle canon");
} else {
  // FEAT-DEV01 (2026-07-06): uniapp refactored the degradation constants into
  // the TASK_CAPACITY_BANDS literal (same numbers, task-capacity narrative).
  // Band order maps onto early/middle/late; a band-count change must update
  // canon-numbers.json + this mapping in the same commit.
  const uniBandRe = /\{\s*throughMonth:\s*(?:\d+|null)\s*,\s*monthlyDeltaPct:\s*(-?\d+(?:\.\d+)?)\s*\}/g;
  const uniBands = [...uniLifecycle.matchAll(uniBandRe)].map((m) => Number(m[1]) / 100);
  const lifecyclePhases = Object.entries(canon.deviceLifecycle.degradationPerMonth);
  if (uniBands.length !== lifecyclePhases.length) {
    failures.push(`lifecycle.uni band count ${uniBands.length} ≠ canon phase count ${lifecyclePhases.length} (../Nexion-uniapp/src/store/device-lifecycle.ts)`);
  } else {
    lifecyclePhases.forEach(([phase, expected], i) => {
      expectNumber(`lifecycle.uni.${phase}`, uniBands[i] ?? null, expected, ["../Nexion-uniapp/src/store/device-lifecycle.ts"]);
    });
  }
  const uniFloorMatch = uniLifecycle.match(/CAPACITY_FLOOR\s*=\s*(\d+(?:\.\d+)?)/);
  expectNumber("lifecycle.uni.minEfficiency", uniFloorMatch ? Number(uniFloorMatch[1]) : null, canon.deviceLifecycle.minEfficiency, ["../Nexion-uniapp/src/store/device-lifecycle.ts"]);

  const adminDefaults = extractRecord(adminE, "E_PARAM_DEFAULTS") ?? "";
  const adminNum = (key) => {
    const match = adminDefaults.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
    return match ? numberFrom(match[1]) : null;
  };
  // FEAT-DEV01 (2026-07-06): admin 参数键改任务产能口径(数值不变)。
  expectNumber("lifecycle.admin.minEfficiency", (adminNum("E.device.capacity.floorPct") ?? NaN) / 100, canon.deviceLifecycle.minEfficiency, ["app/components/domain-views/e-tabs/data.ts"]);
  expectNumber("lifecycle.admin.degradeEarly", (adminNum("E.device.capacity.band1DeltaPct") ?? NaN) / 100, canon.deviceLifecycle.degradationPerMonth.early, ["app/components/domain-views/e-tabs/data.ts"]);
  expectNumber("lifecycle.admin.degradeMiddle", (adminNum("E.device.capacity.band2DeltaPct") ?? NaN) / 100, canon.deviceLifecycle.degradationPerMonth.middle, ["app/components/domain-views/e-tabs/data.ts"]);
  expectNumber("lifecycle.admin.degradeLate", (adminNum("E.device.capacity.band3DeltaPct") ?? NaN) / 100, canon.deviceLifecycle.degradationPerMonth.late, ["app/components/domain-views/e-tabs/data.ts"]);

  // FEAT-DEV01 新防线:新机补贴天数三端 + 豁免集(uniapp 字面量 ↔ canon ↔ admin applyTo)镜像。
  const uniSubsidyMatch = uniLifecycle.match(/SUBSIDY_DAYS\s*=\s*(\d+)/);
  expectNumber("lifecycle.uni.subsidyDays", uniSubsidyMatch ? Number(uniSubsidyMatch[1]) : null, canon.deviceLifecycle.subsidyDays, ["../Nexion-uniapp/src/store/device-lifecycle.ts"]);
  expectNumber("lifecycle.admin.subsidyDays", adminNum("E.device.capacity.subsidyDays"), canon.deviceLifecycle.subsidyDays, ["app/components/domain-views/e-tabs/data.ts"]);
  const canonExempt = [...canon.deviceLifecycle.exemptKinds].sort();
  const uniExemptMatch = uniLifecycle.match(/CAPACITY_EXEMPT_KINDS[^=]*=\s*\[([^\]]*)\]/);
  const uniExempt = uniExemptMatch ? [...uniExemptMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort() : [];
  if (JSON.stringify(uniExempt) !== JSON.stringify(canonExempt)) {
    failures.push(`lifecycle.uni.exemptKinds [${uniExempt.join(",")}] ≠ canon [${canonExempt.join(",")}] (../Nexion-uniapp/src/store/device-lifecycle.ts)`);
  }
  const adminApplyToEntries = [...adminDefaults.matchAll(/"E\.device\.capacity\.applyTo\.([a-z0-9-]+)"\s*:\s*"([^"]+)"/g)];
  const adminExempt = adminApplyToEntries.filter((m) => m[2] === "免递减").map((m) => m[1]).sort();
  if (adminApplyToEntries.length === 0) {
    failures.push("lifecycle.admin.applyTo entries missing in E_PARAM_DEFAULTS (app/components/domain-views/e-tabs/data.ts)");
  } else if (JSON.stringify(adminExempt) !== JSON.stringify(canonExempt)) {
    failures.push(`lifecycle.admin.applyTo 免递减集 [${adminExempt.join(",")}] ≠ canon exemptKinds [${canonExempt.join(",")}] (app/components/domain-views/e-tabs/data.ts)`);
  }

  // FEAT-DEV02 (2026-07-06): 置换阶梯三端对账 —— uniapp TRADEIN_CREDIT_LADDER 字面量
  // ↔ canon.tradeInLadder ↔ admin E.tradein.ladder.* 参数。界点 = uniapp 行的 maxRatioPct
  // (末行开区间 null 不对界点,只对 credit)。
  const uniTradein = readIfExists(path.join(UNI_ROOT, "src", "mock", "tradein-config.ts"));
  if (!uniTradein) {
    failures.push("sibling UniApp tradein-config source missing; cannot prove trade-in ladder canon");
  } else {
    const ladderRowRe = /\{\s*minRatioPct:\s*(\d+(?:\.\d+)?)\s*,\s*maxRatioPct:\s*(\d+(?:\.\d+)?|null)\s*,\s*creditPct:\s*(\d+(?:\.\d+)?)\s*\}/g;
    const uniRows = [...uniTradein.matchAll(ladderRowRe)].map((m) => ({ max: m[2] === "null" ? null : Number(m[2]), credit: Number(m[3]) }));
    const canonCuts = canon.tradeInLadder.cutsPct;
    const canonCredits = canon.tradeInLadder.creditsPct;
    if (uniRows.length !== canonCredits.length) {
      failures.push(`tradein.uni ladder rows ${uniRows.length} ≠ canon credits ${canonCredits.length} (../Nexion-uniapp/src/mock/tradein-config.ts)`);
    } else {
      uniRows.forEach((r, i) => {
        expectNumber(`tradein.uni.credit${i + 1}`, r.credit, canonCredits[i], ["../Nexion-uniapp/src/mock/tradein-config.ts"]);
        if (i < canonCuts.length) expectNumber(`tradein.uni.cut${i + 1}`, r.max, canonCuts[i], ["../Nexion-uniapp/src/mock/tradein-config.ts"]);
      });
    }
    canonCuts.forEach((cut, i) => {
      expectNumber(`tradein.admin.cut${i + 1}`, adminNum(`E.tradein.ladder.cut${i + 1}`), cut, ["app/components/domain-views/e-tabs/data.ts"]);
    });
    canonCredits.forEach((credit, i) => {
      expectNumber(`tradein.admin.credit${i + 1}`, adminNum(`E.tradein.ladder.credit${i + 1}`), credit, ["app/components/domain-views/e-tabs/data.ts"]);
    });
  }
}

const uniProducts = readIfExists(path.join(UNI_ROOT, "src", "mock", "products.ts"));
if (!uniProducts) {
  failures.push("sibling UniApp products source missing; cannot prove product canon");
} else {
  for (const [label, values, evidence] of [
    ["uni", collectProductValues(uniProducts), "../Nexion-uniapp/src/mock/products.ts"],
  ]) {
    for (const [id, expected] of Object.entries(canon.products)) {
      const actual = values[id];
      expectNumber(`product.${label}.${id}.price`, actual?.price ?? null, expected.price, [evidence]);
      expectNumber(`product.${label}.${id}.dailyEarn`, actual?.dailyEarn ?? null, expected.dailyEarn, [evidence]);
      expectNumber(`product.${label}.${id}.dailyEarnNEX`, actual?.dailyEarnNEX ?? null, expected.dailyEarnNEX, [evidence]);
    }
  }
}

// ---- Withdrawal fee model canon (仅活跃面 uniapp + admin;H5 冻结保留旧模型,故排除) ----
// FEAT-WD02(2026-08-02):费用 = 按网络固定确认费 networkConfirmFeeUsd;旧 penaltyFeeRateByPhase
// 已随惩罚费模型删除(uniapp PHASES 不再有 withdrawPenaltyFeeRate 字段,canon 同步删键)。
// 🔴 offset 匹配从 penalty 上解耦:老正则以 withdrawPenaltyFeeRate 为锚,字段删除后 uniByPhase
// 变空集 → offset 检查静默消失(哨兵假绿的经典形态),现改为直接锚 nexFeeOffsetRate。
// 单源:canon.withdrawal ↔ uniapp product-phase.PHASES(offset)/ platform-config(confirm fee)
// ↔ admin d-client D5_NETWORK_CONFIRM_FEE_DEFAULT + D5 OWN_PARAMS(offset,存在才对账)。
const uniPhase = readIfExists(path.join(UNI_ROOT, "src", "store", "product-phase.ts"));
const uniPlatformCfg = readIfExists(path.join(UNI_ROOT, "src", "mock", "platform-config.ts"));
const adminDdata = readIfExists(path.join(ROOT, "app", "components", "domain-views", "d-tabs", "data.ts")) ?? "";
const adminDClient = readIfExists(path.join(ROOT, "lib", "admin", "d-client.ts")) ?? "";
const wd = canon.withdrawal || {};
if (!uniPhase) {
  failures.push("uniapp product-phase.ts missing; cannot prove withdrawal canon");
} else if (wd.nexFeeOffsetRateUSDPerNex == null || !wd.networkConfirmFeeUsd) {
  failures.push("canon.withdrawal missing nexFeeOffsetRateUSDPerNex / networkConfirmFeeUsd");
} else {
  // uniapp PHASES: 每 phase 的 nexFeeOffsetRate(直接锚字段本身,不再借道已删除的 penalty 字段)
  const uniOffsetByPhase = {};
  for (const m of uniPhase.matchAll(/id:\s*"(P\d)"[\s\S]*?nexFeeOffsetRate:\s*([\d.]+)/g)) {
    uniOffsetByPhase[m[1]] = numberFrom(m[2]);
  }
  const phaseCount = Object.keys(uniOffsetByPhase).length;
  if (phaseCount !== 6) {
    failures.push(`withdraw.uni.offset coverage: expected 6 phases, got ${phaseCount}(正则或 PHASES 结构漂移 —— 空集全过是哨兵假绿,显式拦)`);
  }
  for (const [phase, offset] of Object.entries(uniOffsetByPhase)) {
    expectNumber(`withdraw.uni.offset.${phase}`, offset, wd.nexFeeOffsetRateUSDPerNex, ["../Nexion-uniapp/src/store/product-phase.ts"]);
  }
  // uniapp 网络确认费种子 ↔ canon 三键逐键(uniapp verify.sh 另有跨仓 parity 哨兵盯 admin 侧)
  if (uniPlatformCfg) {
    const seed = uniPlatformCfg.match(/networkConfirmFeeUsd:\s*\{\s*trc20:\s*([\d.]+),\s*bep20:\s*([\d.]+),\s*erc20:\s*([\d.]+)\s*\}/);
    expectNumber("withdraw.uni.confirmFee.trc20", seed ? numberFrom(seed[1]) : null, wd.networkConfirmFeeUsd.trc20, ["../Nexion-uniapp/src/mock/platform-config.ts"]);
    expectNumber("withdraw.uni.confirmFee.bep20", seed ? numberFrom(seed[2]) : null, wd.networkConfirmFeeUsd.bep20, ["../Nexion-uniapp/src/mock/platform-config.ts"]);
    expectNumber("withdraw.uni.confirmFee.erc20", seed ? numberFrom(seed[3]) : null, wd.networkConfirmFeeUsd.erc20, ["../Nexion-uniapp/src/mock/platform-config.ts"]);
  } else {
    failures.push("uniapp platform-config.ts missing; cannot prove networkConfirmFeeUsd canon");
  }
  // admin D5 兜底种子(d-client D5_NETWORK_CONFIRM_FEE_DEFAULT)↔ canon 三键
  const adminSeed = adminDClient.match(/D5_NETWORK_CONFIRM_FEE_DEFAULT = \{ trc20: ([\d.]+), bep20: ([\d.]+), erc20: ([\d.]+) \}/);
  expectNumber("withdraw.admin.confirmFee.trc20", adminSeed ? numberFrom(adminSeed[1]) : null, wd.networkConfirmFeeUsd.trc20, ["lib/admin/d-client.ts"]);
  expectNumber("withdraw.admin.confirmFee.bep20", adminSeed ? numberFrom(adminSeed[2]) : null, wd.networkConfirmFeeUsd.bep20, ["lib/admin/d-client.ts"]);
  expectNumber("withdraw.admin.confirmFee.erc20", adminSeed ? numberFrom(adminSeed[3]) : null, wd.networkConfirmFeeUsd.erc20, ["lib/admin/d-client.ts"]);
  // admin D5 OWN_PARAMS nexFeeOffsetRate 默认值("$0.40 / NEX";d-tabs/data.ts 存在才对账)
  const d5 = adminDdata.match(/key:\s*"nexFeeOffsetRate"[\s\S]{0,160}?cur:\s*"\$?([\d.]+)/);
  const adminOffset = d5 ? numberFrom(d5[1]) : null;
  if (adminDdata) {
    expectNumber("withdraw.admin.offset", adminOffset, wd.nexFeeOffsetRateUSDPerNex, ["app/components/domain-views/d-tabs/data.ts"]);
  }
}

// ---- FEAT-DEV02b:置换侧抢先购三端对账(uniapp TRADEIN_EARLY_ACCESS ↔ admin E.release.earlyAccess.* ↔ canon)----
if (uniPhase) {
  const earlyBlock = uniPhase.match(/TRADEIN_EARLY_ACCESS\s*=\s*\{([\s\S]*?)\}\s*as const/)?.[1] ?? "";
  const uniEnabled = /enabled:\s*(true|false)/.exec(earlyBlock)?.[1] ?? null;
  const uniLead = /leadDays:\s*(\d+)/.exec(earlyBlock)?.[1] ?? null;
  const ea = canon.tradeInEarlyAccess;
  if (uniEnabled === null) failures.push("earlyAccess.uni.enabled missing (../Nexion-uniapp/src/store/product-phase.ts TRADEIN_EARLY_ACCESS)");
  else if ((uniEnabled === "true") !== ea.enabled) failures.push(`earlyAccess.uni.enabled ${uniEnabled} ≠ canon ${ea.enabled} (../Nexion-uniapp/src/store/product-phase.ts)`);
  expectNumber("earlyAccess.uni.leadDays", uniLead === null ? null : Number(uniLead), ea.leadDays, ["../Nexion-uniapp/src/store/product-phase.ts"]);
  const adminE1 = read(path.join(ROOT, "app", "components", "domain-views", "e-tabs", "data.ts"));
  const adminDefaults2 = extractRecord(adminE1, "E_PARAM_DEFAULTS") ?? "";
  const adminEnabled = adminDefaults2.match(/"E\.release\.earlyAccess\.enabled"\s*:\s*"([^"]+)"/)?.[1] ?? null;
  const adminLead = adminDefaults2.match(/"E\.release\.earlyAccess\.leadDays"\s*:\s*"([^"]+)"/)?.[1] ?? null;
  if (adminEnabled === null) failures.push("earlyAccess.admin.enabled key missing (e-tabs/data.ts)");
  else if ((adminEnabled === "开") !== ea.enabled) failures.push(`earlyAccess.admin.enabled ${adminEnabled} ≠ canon ${ea.enabled} (app/components/domain-views/e-tabs/data.ts)`);
  expectNumber("earlyAccess.admin.leadDays", adminLead === null ? null : Number(adminLead), ea.leadDays, ["app/components/domain-views/e-tabs/data.ts"]);
}

// ---- 旧 2% 提现费指纹哨兵:防 max(1,min(20,amt*0.02)) clamp 复发(新模型 = penaltyFeeRate × 金额 − NEX 抵扣)----
function walkTsCanon(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!["node_modules", ".next", ".trash"].includes(e.name)) walkTsCanon(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const OLD_FEE_FP = /Math\.max\(\s*1\s*,\s*Math\.min\(\s*20\b/; // 旧提现费 clamp $1–$20 签名
for (const d of ["app", "lib"].map((x) => path.join(ROOT, x)).filter((x) => fs.existsSync(x))) {
  for (const f of walkTsCanon(d)) {
    if (OLD_FEE_FP.test(read(f))) failures.push(`withdraw.oldFeeFingerprint: ${path.relative(ROOT, f)} 含旧 2% 提现费 clamp max(1,min(20,…));新模型应 penaltyFeeRate × 金额 − NEX 抵扣`);
  }
}

const result = {
  status: failures.length === 0 ? "passed" : "failed",
  canonVersion: canon.version,
  checkCount: checks.length,
  failureCount: failures.length,
  failures,
  checks,
};

console.log(JSON.stringify(result, null, 2));
if (failures.length > 0) process.exit(1);
