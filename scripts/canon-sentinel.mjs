#!/usr/bin/env node
/**
 * L3d/L5 canon-number sentinel.
 *
 * Reads docs/remediation/canon-numbers.json, then extracts the same business
 * constants from Admin, Next reference, and UniApp sources. The gate fails on
 * numeric drift, so a display copy update cannot silently fork core economics.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_ROOT = path.resolve(ROOT, "..");
const NEXT_ROOT = path.join(PLAN_ROOT, "Nexion-prototype");
const UNI_ROOT = path.join(PLAN_ROOT, "Nexion-uniapp");
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
  const block = extractArrayItemByField(src, "USDT_TIERS", "tier", tier)
    ?? extractArrayItemByField(src, "NEX_TIERS", "tier", tier);
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

const nextStaking = readIfExists(path.join(NEXT_ROOT, "lib", "v3", "staking.ts"));
const uniStaking = readIfExists(path.join(UNI_ROOT, "src", "store", "staking.ts"));
const adminG = read(path.join(ROOT, "app", "components", "domain-views", "g-tabs", "data.ts"));

if (!nextStaking || !uniStaking) {
  failures.push("sibling Next/UniApp source missing; cannot prove cross-end canon");
} else {
  const nextApy = parseNumberRecord(nextStaking, "STAKING_APY");
  const uniApy = parseNumberRecord(uniStaking, "STAKING_APY");
  const nextPenalty = parseNumberRecord(nextStaking, "STAKING_PENALTY");
  const uniPenalty = parseNumberRecord(uniStaking, "STAKING_PENALTY");
  for (const [term, expected] of Object.entries(canon.staking.usdtApy)) {
    expectNumber(`staking.next.apy.${term}`, nextApy?.[term] ?? null, expected, ["../Nexion-prototype/lib/v3/staking.ts"]);
    expectNumber(`staking.uni.apy.${term}`, uniApy?.[term] ?? null, expected, ["../Nexion-uniapp/src/store/staking.ts"]);
    const adminTier = extractAdminTier(adminG, canon.staking.adminUsdtTierByTerm[term]);
    expectNumber(`staking.admin.apy.${term}`, (adminTier?.apyPct ?? null) === null ? null : adminTier.apyPct / 100, expected, ["app/components/domain-views/g-tabs/data.ts"]);
  }
  for (const [term, expected] of Object.entries(canon.staking.usdtPenalty)) {
    expectNumber(`staking.next.penalty.${term}`, nextPenalty?.[term] ?? null, expected, ["../Nexion-prototype/lib/v3/staking.ts"]);
    expectNumber(`staking.uni.penalty.${term}`, uniPenalty?.[term] ?? null, expected, ["../Nexion-uniapp/src/store/staking.ts"]);
    const adminTier = extractAdminTier(adminG, canon.staking.adminUsdtTierByTerm[term]);
    expectNumber(`staking.admin.penalty.${term}`, (adminTier?.penaltyPct ?? null) === null ? null : adminTier.penaltyPct / 100, expected, ["app/components/domain-views/g-tabs/data.ts"]);
  }
}

const nextGenesis = readIfExists(path.join(NEXT_ROOT, "lib", "v3", "genesis.ts"));
const uniGenesis = readIfExists(path.join(UNI_ROOT, "src", "store", "genesis.ts"));
if (!nextGenesis || !uniGenesis) {
  failures.push("sibling Next/UniApp Genesis source missing; cannot prove Genesis canon");
} else {
  const adminGenesis = parseNumberRecord(adminG, "GENESIS") ?? {};
  for (const [label, src, evidence] of [
    ["next", nextGenesis, "../Nexion-prototype/lib/v3/genesis.ts"],
    ["uni", uniGenesis, "../Nexion-uniapp/src/store/genesis.ts"],
  ]) {
    expectNumber(`genesis.${label}.totalSlots`, extractConstNumber(src, "TOTAL_SLOTS"), canon.genesis.totalSlots, [evidence]);
    expectNumber(`genesis.${label}.royaltyRate`, extractConstNumber(src, "GENESIS_ROYALTY_RATE"), canon.genesis.royaltyRate, [evidence]);
    expectNumber(`genesis.${label}.unitPrice`, extractFieldNumber(src, "unitPriceUSDT"), canon.genesis.unitPriceUSDT, [evidence]);
    expectNumber(`genesis.${label}.seedSoldSlots`, extractFieldNumber(src, "soldSlots"), canon.genesis.seedSoldSlots, [evidence]);
  }
  expectNumber("genesis.admin.totalSlots", adminGenesis.totalSlots ?? null, canon.genesis.totalSlots, ["app/components/domain-views/g-tabs/data.ts"]);
  expectNumber("genesis.admin.unitPrice", adminGenesis.unitPrice ?? null, canon.genesis.unitPriceUSDT, ["app/components/domain-views/g-tabs/data.ts"]);
  expectNumber("genesis.admin.royaltyRate", (adminGenesis.royaltyPct ?? null) === null ? null : adminGenesis.royaltyPct / 100, canon.genesis.royaltyRate, ["app/components/domain-views/g-tabs/data.ts"]);
  expectNumber("genesis.admin.dividendShareRate", (adminGenesis.dividendSharePct ?? null) === null ? null : adminGenesis.dividendSharePct / 100, canon.genesis.dividendShareRate, ["app/components/domain-views/g-tabs/data.ts"]);
  expectNumber("genesis.admin.perSlotDisplay", adminGenesis.perSlotPerDay ?? null, canon.genesis.perSlotPerDayDisplayUSD, ["app/components/domain-views/g-tabs/data.ts"], 0.1);
  expectNumber("genesis.admin.floorPerNode", adminGenesis.floorPerNodePerDay ?? null, canon.genesis.floorPerNodePerDayUSD, ["app/components/domain-views/g-tabs/data.ts"]);
}

const nextLifecycle = readIfExists(path.join(NEXT_ROOT, "lib", "store", "device-lifecycle.ts"));
const uniLifecycle = readIfExists(path.join(UNI_ROOT, "src", "store", "device-lifecycle.ts"));
const adminE = read(path.join(ROOT, "app", "components", "domain-views", "e-tabs", "data.ts"));
if (!nextLifecycle || !uniLifecycle) {
  failures.push("sibling Next/UniApp lifecycle source missing; cannot prove lifecycle canon");
} else {
  const nextDeg = parseNumberRecord(nextLifecycle, "DEGRADATION_PER_MONTH");
  const uniDeg = parseNumberRecord(uniLifecycle, "DEGRADATION_PER_MONTH");
  for (const [phase, expected] of Object.entries(canon.deviceLifecycle.degradationPerMonth)) {
    expectNumber(`lifecycle.next.${phase}`, nextDeg?.[phase] ?? null, expected, ["../Nexion-prototype/lib/store/device-lifecycle.ts"]);
    expectNumber(`lifecycle.uni.${phase}`, uniDeg?.[phase] ?? null, expected, ["../Nexion-uniapp/src/store/device-lifecycle.ts"]);
  }
  expectNumber("lifecycle.next.minEfficiency", extractConstNumber(nextLifecycle, "MIN_EFFICIENCY"), canon.deviceLifecycle.minEfficiency, ["../Nexion-prototype/lib/store/device-lifecycle.ts"]);
  expectNumber("lifecycle.uni.minEfficiency", extractConstNumber(uniLifecycle, "MIN_EFFICIENCY"), canon.deviceLifecycle.minEfficiency, ["../Nexion-uniapp/src/store/device-lifecycle.ts"]);

  const adminDefaults = extractRecord(adminE, "E_PARAM_DEFAULTS") ?? "";
  const adminNum = (key) => {
    const match = adminDefaults.match(new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`));
    return match ? numberFrom(match[1]) : null;
  };
  expectNumber("lifecycle.admin.minEfficiency", (adminNum("E.device.minEfficiency") ?? NaN) / 100, canon.deviceLifecycle.minEfficiency, ["app/components/domain-views/e-tabs/data.ts"]);
  expectNumber("lifecycle.admin.degradeEarly", (adminNum("E.device.degradeEarly") ?? NaN) / 100, canon.deviceLifecycle.degradationPerMonth.early, ["app/components/domain-views/e-tabs/data.ts"]);
  expectNumber("lifecycle.admin.degradeMiddle", (adminNum("E.device.degradeMid") ?? NaN) / 100, canon.deviceLifecycle.degradationPerMonth.middle, ["app/components/domain-views/e-tabs/data.ts"]);
  expectNumber("lifecycle.admin.degradeLate", (adminNum("E.device.degradeLate") ?? NaN) / 100, canon.deviceLifecycle.degradationPerMonth.late, ["app/components/domain-views/e-tabs/data.ts"]);
}

const nextProducts = readIfExists(path.join(NEXT_ROOT, "lib", "mock", "products.ts"));
const uniProducts = readIfExists(path.join(UNI_ROOT, "src", "mock", "products.ts"));
if (!nextProducts || !uniProducts) {
  failures.push("sibling Next/UniApp products source missing; cannot prove product canon");
} else {
  for (const [label, values, evidence] of [
    ["next", collectProductValues(nextProducts), "../Nexion-prototype/lib/mock/products.ts"],
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
