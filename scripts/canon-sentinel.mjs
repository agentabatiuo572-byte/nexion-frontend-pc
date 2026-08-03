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
  // 在 .claude/worktrees/<wt> 内跑时 PLAN_ROOT 落在 .claude/worktrees,向上四级回 PLAN 找兄弟仓。
  path.resolve(ROOT, "..", "..", "..", "..", "Nexion-uniapp"),
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
// 2026-07-02 admin 4fdb080:g-tabs/data.ts(USDT_TIERS/GENESIS mock)随 server-canonical 化删除,
// 原 if (adminG) 分支自此静默跳过——正是本文件自己警告的「空集全过」假绿形态。现改响亮真锚:
// APY/罚金数值由 G1 真接口下发(本仓无字面量,值检查退役,uni 侧仍逐项锚 canon);本仓可静态
// 证明的是 canon.adminUsdtTierByTerm 的每个档位 id 仍在 g1-staking CANONICAL_USDT_TIERS 控制面。
const adminG1 = readIfExists(path.join(ROOT, "app", "components", "domain-views", "g-tabs", "g1-staking.tsx")) ?? "";
const adminTierIds = [...(adminG1.match(/CANONICAL_USDT_TIERS\s*=\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"([a-z0-9]+)"/g)].map((m) => m[1]);

if (!uniStaking) {
  failures.push("sibling UniApp staking source missing; cannot prove cross-end canon");
} else {
  const uniApy = parseNumberRecord(uniStaking, "STAKING_APY");
  const uniPenalty = parseNumberRecord(uniStaking, "STAKING_PENALTY");
  for (const [term, expected] of Object.entries(canon.staking.usdtApy)) {
    expectNumber(`staking.uni.apy.${term}`, uniApy?.[term] ?? null, expected, ["../Nexion-uniapp/src/store/staking.ts"]);
    const tierId = canon.staking.adminUsdtTierByTerm[term];
    const tierWired = adminTierIds.includes(tierId);
    pushCheck(checks, `staking.admin.tierWired.${term}`, tierWired, tierWired ? `${tierId} in CANONICAL_USDT_TIERS` : `${tierId} missing in CANONICAL_USDT_TIERS`, ["app/components/domain-views/g-tabs/g1-staking.tsx"]);
    if (!tierWired) failures.push(`staking.admin.tierWired.${term}: canon 档位 ${tierId} 不在 g1-staking CANONICAL_USDT_TIERS 控制面`);
  }
  for (const [term, expected] of Object.entries(canon.staking.usdtPenalty)) {
    expectNumber(`staking.uni.penalty.${term}`, uniPenalty?.[term] ?? null, expected, ["../Nexion-uniapp/src/store/staking.ts"]);
  }
}

const uniGenesis = readIfExists(path.join(UNI_ROOT, "src", "store", "genesis.ts"));
if (!uniGenesis) {
  failures.push("sibling UniApp Genesis source missing; cannot prove Genesis canon");
} else {
  for (const [label, src, evidence] of [
    ["uni", uniGenesis, "../Nexion-uniapp/src/store/genesis.ts"],
  ]) {
    expectNumber(`genesis.${label}.totalSlots`, extractConstNumber(src, "TOTAL_SLOTS"), canon.genesis.totalSlots, [evidence]);
    // 分红延期改造:单一 unitPriceUSDT($9,999) → GENESIS_TIERS 3 档阶梯,unitPriceUSDT 变 computed(当前档)。
    // 2026-07-10 uniapp aee5f3c(FEAT-GEN09/GEN10):阶梯运营可配化,默认档位字面量迁至叶子文件
    // genesis-config.ts(GENESIS_TIERS_DEFAULT);锚点价仍 = 公售 t1 档 priceUSDT,改从该文件抽取。
    const uniGenesisConfig = readIfExists(path.join(UNI_ROOT, "src", "store", "genesis-config.ts")) ?? "";
    const t1Match = uniGenesisConfig.match(/id:\s*"t1"[^}]*priceUSDT:\s*(\d+)/);
    expectNumber(`genesis.${label}.unitPriceAnchor`, t1Match ? Number(t1Match[1]) : null, canon.genesis.unitPriceUSDT, ["../Nexion-uniapp/src/store/genesis-config.ts"]);
    expectNumber(`genesis.${label}.seedSoldSlots`, extractFieldNumber(src, "soldSlots"), canon.genesis.seedSoldSlots, [evidence]);
  }
  // 2026-07-10 uniapp 177261f 删「创世 18% 凭空成交」引擎时一并删了 GENESIS_ROYALTY_RATE 常量
  //(数值 0.025 未变);2.5% 版税在 uni 侧仅存于三语市场页文案 royaltyFooter。哨兵改锚该文案——
  // 本哨兵的本职即「display copy 不得静默 fork 经济学」,逐语言对账防单语种文案漂移。
  for (const locale of ["zh", "en", "vi"]) {
    const localeMessages = readIfExists(path.join(UNI_ROOT, "src", "i18n", "messages", `${locale}.ts`));
    const royaltyCopy = localeMessages ? localeMessages.match(/royaltyFooter:\s*"[^"]*?(\d+(?:\.\d+)?)\s*%/) : null;
    expectNumber(`genesis.uni.royaltyRate.${locale}`, royaltyCopy ? Number(royaltyCopy[1]) / 100 : null, canon.genesis.royaltyRate, [`../Nexion-uniapp/src/i18n/messages/${locale}.ts`]);
  }
  // 2026-07-02 4fdb080:g-tabs GENESIS mock 删除,genesis.admin 数值(totalSlots/unitPrice/royalty/
  // perSlot/floor)改由 G4 真接口下发,本仓无字面量 → 值检查退役(原 if (adminGenesis) 已静默跳过
  // 多时);uni 侧 + canon 仍逐项对账,canon 里这批键继续作为权威台账保留。本仓仅存的 admin 侧
  // 数字表征 = g4-genesis 排放率徽标「基准 0.1%/日」display copy,锚它 ↔ canon.dividendShareRate。
  const adminG4 = readIfExists(path.join(ROOT, "app", "components", "domain-views", "g-tabs", "g4-genesis.tsx")) ?? "";
  const dividendBadge = adminG4.match(/基准\s*([\d.]+)%\/日/);
  expectNumber("genesis.admin.dividendShareCopy", dividendBadge ? Number(dividendBadge[1]) / 100 : null, canon.genesis.dividendShareRate, ["app/components/domain-views/g-tabs/g4-genesis.tsx"]);
}

const uniLifecycle = readIfExists(path.join(UNI_ROOT, "src", "store", "device-lifecycle.ts"));
// 2026-07-02 admin 4fdb080「remove ops console mock data paths」:E 域参数改 server-canonical
//(nexion-backend + MySQL 经 e3-client 真接口下发),e-tabs/data.ts 的 E_PARAM_DEFAULTS mock
// 常量删除,本仓不再持有这批数字的权威副本。哨兵随架构降档:改锚本仓仅存的运行时展示层字面量
// —— e3-lifecycle.tsx 的曲线兜底值 num(pE(key), fallback) 与调参弹窗 placeholder。它们是运营者
// 实际看到的默认数字,漂移同样 fork 经济学;E3 键接线完整性另由 capacity-ladder-sentinel 把门。
const adminE3 = readIfExists(path.join(ROOT, "app", "components", "domain-views", "e-tabs", "e3-lifecycle.tsx")) ?? "";
// 注:两个 helper 只对 key 里的「.」做转义(键恒为点分字母数字);若未来 key 含其它正则元字符须改通用转义。
const adminFallback = (key) => {
  const match = adminE3.match(new RegExp(`num\\(pE\\("${key.replaceAll(".", "\\.")}"\\),\\s*(-?[0-9.]+)\\)`));
  return match ? numberFrom(match[1]) : null;
};
const adminPlaceholder = (key) => {
  const match = adminE3.match(new RegExp(`paramKey:\\s*"${key.replaceAll(".", "\\.")}"[^}]*placeholder:\\s*"(-?[0-9.]+)"`));
  return match ? numberFrom(match[1]) : null;
};
const pctOrNull = (value) => (value === null ? null : value / 100);
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

  // FEAT-DEV01 (2026-07-06): admin 参数键改任务产能口径(数值不变);server-canonical 化后数值
  // 锚 e3-lifecycle.tsx 的曲线兜底字面量(后端缺值时运营端实际渲染的默认曲线,单位 %)。
  expectNumber("lifecycle.admin.minEfficiency", pctOrNull(adminFallback("E.device.capacity.floorPct")), canon.deviceLifecycle.minEfficiency, ["app/components/domain-views/e-tabs/e3-lifecycle.tsx"]);
  expectNumber("lifecycle.admin.degradeEarly", pctOrNull(adminFallback("E.device.capacity.band1DeltaPct")), canon.deviceLifecycle.degradationPerMonth.early, ["app/components/domain-views/e-tabs/e3-lifecycle.tsx"]);
  expectNumber("lifecycle.admin.degradeMiddle", pctOrNull(adminFallback("E.device.capacity.band2DeltaPct")), canon.deviceLifecycle.degradationPerMonth.middle, ["app/components/domain-views/e-tabs/e3-lifecycle.tsx"]);
  expectNumber("lifecycle.admin.degradeLate", pctOrNull(adminFallback("E.device.capacity.band3DeltaPct")), canon.deviceLifecycle.degradationPerMonth.late, ["app/components/domain-views/e-tabs/e3-lifecycle.tsx"]);

  // FEAT-DEV01 新防线:新机补贴天数三端 + 豁免集(uniapp 字面量 ↔ canon ↔ admin applyTo)镜像。
  const uniSubsidyMatch = uniLifecycle.match(/SUBSIDY_DAYS\s*=\s*(\d+)/);
  expectNumber("lifecycle.uni.subsidyDays", uniSubsidyMatch ? Number(uniSubsidyMatch[1]) : null, canon.deviceLifecycle.subsidyDays, ["../Nexion-uniapp/src/store/device-lifecycle.ts"]);
  // lifecycle.admin.subsidyDays 数值检查退役(2026-07-02 4fdb080 server-canonical 化):本仓已无
  // 该数字的任何字面量(调参行无 placeholder,渲染值纯后端下发)。uni 侧 SUBSIDY_DAYS 仍锚 canon;
  // admin 键接线(subsidyDays 在页面 + e3-client 映射中存在)由 capacity-ladder-sentinel 保证。
  const canonExempt = [...canon.deviceLifecycle.exemptKinds].sort();
  const uniExemptMatch = uniLifecycle.match(/CAPACITY_EXEMPT_KINDS[^=]*=\s*\[([^\]]*)\]/);
  const uniExempt = uniExemptMatch ? [...uniExemptMatch[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort() : [];
  if (JSON.stringify(uniExempt) !== JSON.stringify(canonExempt)) {
    failures.push(`lifecycle.uni.exemptKinds [${uniExempt.join(",")}] ≠ canon [${canonExempt.join(",")}] (../Nexion-uniapp/src/store/device-lifecycle.ts)`);
  }
  // applyTo 免/参与的默认布尔已随 server-canonical 化离仓(渲染值来自后端)。本仓可静态证明的收窄为:
  // canon 豁免的每个 SKU 必须仍是 e3-lifecycle APPLY_TO_SKUS 控制面里的可控行,防 canon 与控制面脱钩。
  // 圈定 APPLY_TO_SKUS 数组体再抽 kind,防同文件无关 kind:(如 AdjMulti 的 "multi-field")混入假过。
  const applyToBody = adminE3.match(/APPLY_TO_SKUS[^=]*=\s*\[([\s\S]*?)\]\s*;/)?.[1] ?? "";
  const adminApplyToKinds = [...applyToBody.matchAll(/kind:\s*"([a-z0-9-]+)"/g)].map((m) => m[1]);
  for (const kind of canonExempt) {
    const wired = adminApplyToKinds.includes(kind);
    pushCheck(checks, `lifecycle.admin.applyToWired.${kind}`, wired, wired ? "in APPLY_TO_SKUS" : "missing in APPLY_TO_SKUS", ["app/components/domain-views/e-tabs/e3-lifecycle.tsx"]);
    if (!wired) failures.push(`lifecycle.admin.applyToWired.${kind}: canon 豁免 SKU 不在 e3-lifecycle APPLY_TO_SKUS 控制面`);
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
    // 阶梯数值 server-canonical 化后,本仓仅存数字 = e3-lifecycle 调参弹窗 placeholder(运营在
    // 输入框里看到的默认提示)。锚 placeholder ↔ canon,防展示层与权威阶梯漂移;真实生效值由
    // 后端下发,uni 侧字面量已在上方逐项对账。
    canonCuts.forEach((cut, i) => {
      expectNumber(`tradein.admin.cut${i + 1}`, adminPlaceholder(`E.tradein.ladder.cut${i + 1}`), cut, ["app/components/domain-views/e-tabs/e3-lifecycle.tsx"]);
    });
    canonCredits.forEach((credit, i) => {
      expectNumber(`tradein.admin.credit${i + 1}`, adminPlaceholder(`E.tradein.ladder.credit${i + 1}`), credit, ["app/components/domain-views/e-tabs/e3-lifecycle.tsx"]);
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
  // withdraw.admin.offset 值检查退役:d-tabs/data.ts 已随 server-canonical 化删除(旧「存在才对账」
  // 条件自此静默跳过),D5 NEX 抵扣率由 d-client 真接口下发、d5-params 运行时渲染,本仓无默认字面量。
  // uni 侧 offset 已按 6 个 phase 逐项锚 canon;admin 侧确认费种子 D5_NETWORK_CONFIRM_FEE_DEFAULT 在上方对账。
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
  // 2026-07-02 4fdb080 server-canonical 化:enabled/leadDays 默认值随 E_PARAM_DEFAULTS 离仓。
  // enabled 值检查退役(uni 侧 TRADEIN_EARLY_ACCESS.enabled 在上方仍锚 canon);admin 侧改验
  //「控制面可表达 canon」:canon.leadDays 必须同时是 e1-catalog 下拉可选项和 e-view 白名单成员,
  // 防 canon 演化出运营控制面选不出来的值。
  const adminE1Catalog = readIfExists(path.join(ROOT, "app", "components", "domain-views", "e-tabs", "e1-catalog.tsx")) ?? "";
  const adminEView = readIfExists(path.join(ROOT, "app", "components", "domain-views", "e-view.tsx")) ?? "";
  const leadOptions = [...(adminE1Catalog.match(/key:\s*"leadDays"[^}]*options:\s*\[([^\]]*)\]/)?.[1] ?? "").matchAll(/"(\d+)"/g)].map((m) => Number(m[1]));
  const leadAllowlist = ((adminEView.match(/!\[([0-9,\s]+)\]\.includes\(leadDays\)/)?.[1] ?? "").match(/\d+/g) ?? []).map(Number);
  const leadOffered = leadOptions.includes(ea.leadDays) && leadAllowlist.includes(ea.leadDays);
  pushCheck(checks, "earlyAccess.admin.leadDaysOffered", leadOffered, `canon ${ea.leadDays} · options=[${leadOptions.join(",")}] · allow=[${leadAllowlist.join(",")}]`, ["app/components/domain-views/e-tabs/e1-catalog.tsx", "app/components/domain-views/e-view.tsx"]);
  if (!leadOffered) failures.push(`earlyAccess.admin.leadDaysOffered: canon leadDays ${ea.leadDays} 不在 admin 控制面(options=[${leadOptions.join(",")}] allow=[${leadAllowlist.join(",")}])`);
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
