// FEAT-DEV01 任务产能节奏参数 gate(PR-B1, 2026-07-06)。
// 三件事:
//   1) 合法性 — 三段每月变化必须为负、分段月严格递增、产能下限 ∈ (0,100)、
//      补贴天数为非负整数、参与任务递减开关 8 个 SKU 全覆盖且值 ∈ {参与递减, 免递减}。
//   2) 双副本一致 — e-tabs/data.ts E_PARAM_DEFAULTS 与 lib/admin/local-mock-backend.ts
//      MOCK_E3_CONFIG 的 E.device.* 键值逐项相等(两份种子历史上就容易漂,机器焊死)。
//   3) 旧键归零 — E.device.degradeEarly/Mid/Late、E.device.minEfficiency 在 app/ lib/
//      源码中残留 = 0(键改名后旧读者必须全部迁移,防静默读空值)。
// 跨端豁免集 / 补贴天数与 uniapp 的镜像在 canon-sentinel.mjs(三端对账),本 gate 只管 admin 仓内。

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const errs = [];

function parseRecord(src, name) {
  const m = src.match(new RegExp(`${name}[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`));
  if (!m) return null;
  const entries = {};
  for (const kv of m[1].matchAll(/"([^"]+)"\s*:\s*"([^"]*)"/g)) entries[kv[1]] = kv[2];
  return entries;
}

const dataSrc = read("app/components/domain-views/e-tabs/data.ts");
const mockSrc = read("lib/admin/local-mock-backend.ts");
const defaults = parseRecord(dataSrc, "E_PARAM_DEFAULTS");
const mock = parseRecord(mockSrc, "MOCK_E3_CONFIG");
if (!defaults) errs.push("E_PARAM_DEFAULTS 不可解析(data.ts)");
if (!mock) errs.push("MOCK_E3_CONFIG 不可解析(local-mock-backend.ts)");

const SKUS = ["phone", "cloud-share", "pc-gpu", "stellarbox-s1", "stellarbox-pro", "stellarbox-pro-v2", "stellarrack-p1", "stellarrack-p2"];

if (defaults) {
  const n = (k) => Number(defaults[k]);
  for (const k of ["E.device.capacity.band1DeltaPct", "E.device.capacity.band2DeltaPct", "E.device.capacity.band3DeltaPct"]) {
    if (!(n(k) < 0)) errs.push(`${k} 必须为负(每月产能变化),got ${defaults[k]}`);
  }
  const s1 = n("E.device.stageEarlyEnd"), s2 = n("E.device.stageMidEnd"), cyc = n("E.device.cycleMonths");
  if (!(s1 > 0 && s1 < s2 && s2 < cyc)) errs.push(`分段月须严格递增 0<段1末<段2末<视窗,got ${s1}/${s2}/${cyc}`);
  const floor = n("E.device.capacity.floorPct");
  if (!(floor > 0 && floor < 100)) errs.push(`产能下限须 ∈ (0,100),got ${defaults["E.device.capacity.floorPct"]}`);
  const subsidy = n("E.device.capacity.subsidyDays");
  if (!(Number.isInteger(subsidy) && subsidy >= 0)) errs.push(`补贴天数须为非负整数,got ${defaults["E.device.capacity.subsidyDays"]}`);
  for (const kind of SKUS) {
    const v = defaults[`E.device.capacity.applyTo.${kind}`];
    if (v === undefined) errs.push(`applyTo 缺 SKU:${kind}`);
    else if (v !== "参与递减" && v !== "免递减") errs.push(`applyTo.${kind} 值非法:${v}(须 参与递减/免递减)`);
  }

  // FEAT-DEV02 置换阶梯合法性:界点严格递增且 >0;抵扣率逐档递减且 ∈(0,100];开关枚举;台数 ≥1 整数。
  const cuts = [1, 2, 3, 4].map((i) => n(`E.tradein.ladder.cut${i}`));
  for (let i = 0; i < cuts.length; i++) {
    if (!(cuts[i] > 0)) errs.push(`ladder.cut${i + 1} 须 >0,got ${cuts[i]}`);
    if (i > 0 && !(cuts[i] > cuts[i - 1])) errs.push(`阶梯界点须严格递增:cut${i}=${cuts[i - 1]} → cut${i + 1}=${cuts[i]}`);
  }
  const credits = [1, 2, 3, 4, 5].map((i) => n(`E.tradein.ladder.credit${i}`));
  for (let i = 0; i < credits.length; i++) {
    if (!(credits[i] > 0 && credits[i] <= 100)) errs.push(`ladder.credit${i + 1} 须 ∈ (0,100],got ${credits[i]}`);
    if (i > 0 && !(credits[i] < credits[i - 1])) errs.push(`各档抵扣率须逐档递减:credit${i}=${credits[i - 1]} → credit${i + 1}=${credits[i]}`);
  }
  for (const k of ["E.tradein.enabled", "E.tradein.requireHigherPrice"]) {
    const v = defaults[k];
    if (v !== "开" && v !== "关") errs.push(`${k} 值非法:${v}(须 开/关)`);
  }
  const maxDev = n("E.tradein.maxDevicesPerOrder");
  if (!(Number.isInteger(maxDev) && maxDev >= 1)) errs.push(`maxDevicesPerOrder 须 ≥1 整数,got ${defaults["E.tradein.maxDevicesPerOrder"]}`);
}

if (defaults && mock) {
  const deviceKeys = Object.keys(defaults).filter((k) => k.startsWith("E.device.") || k.startsWith("E.tradein."));
  for (const k of deviceKeys) {
    if (mock[k] === undefined) errs.push(`local-mock-backend 缺键:${k}`);
    else if (mock[k] !== defaults[k]) errs.push(`双副本漂移 ${k}: data.ts=${defaults[k]} vs mock-backend=${mock[k]}`);
  }
}

// 旧键残留扫描(app/ + lib/ 的 .ts/.tsx 源码)。
const LEGACY = /E\.device\.(degradeEarly|degradeMid|degradeLate|minEfficiency)\b|E\.tradein\.(salvagePct|minHoldingMonths)\b/;
function walk(dir, hits) {
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`;
    const st = statSync(join(ROOT, rel));
    if (st.isDirectory()) { if (name !== "node_modules" && name !== ".next") walk(rel, hits); continue; }
    if (!/\.(ts|tsx)$/.test(name)) continue;
    const src = readFileSync(join(ROOT, rel), "utf8");
    src.split("\n").forEach((line, i) => { if (LEGACY.test(line)) hits.push(`${rel}:${i + 1}`); });
  }
}
const legacyHits = [];
walk("app", legacyHits);
walk("lib", legacyHits);
if (legacyHits.length) errs.push(`旧参数键残留(须迁移到 E.device.capacity.*):\n    ${legacyHits.join("\n    ")}`);

if (errs.length) {
  for (const e of errs) console.error(`  ✗ ${e}`);
  process.exit(1);
}
console.log(`capacity+ladder 参数 gate:合法性 ✓ · 双副本一致(${defaults ? Object.keys(defaults).filter((k) => k.startsWith("E.device.") || k.startsWith("E.tradein.")).length : 0} 键) · applyTo 8 SKU 全覆盖 · 阶梯界点递增/抵扣率递减 ✓ · 旧键残留 0`);
