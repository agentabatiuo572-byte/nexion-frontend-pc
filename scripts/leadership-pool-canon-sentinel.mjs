#!/usr/bin/env node
/**
 * leadership-pool-canon-sentinel —— 领导池模型「双端单一真源」机器门。
 *
 * 真源 = 前端 store/leadership-pool.ts(GLOBAL_V_DISTRIBUTION + V_VOTES + WEEKLY_GMV + RATIO)。
 * 断言:
 *   1. 后台 data.ts LEADERSHIP_CANON(gmv/ratio/ranks votes+pop)逐项镜像前端真源。
 *   2. 后台 F1 VRANK.pop(V3+)== canon pop(同一全网分布)。
 *   3. 派生量(周池额 / 顶部10名集中度 / 合格领袖数)前端算值 == 后台 canon 算值。
 *   4. 禁散落硬编码:f4-ops / registry 不得再出现 ≈80% / 顶部10人吃池80 / 参与V8+ /
 *      V6 及以上(领导池门槛)/ V6:1 V9:2 / $214,000(池) / $96,400 ;
 *      前端用户面不得出现「20 万总票」死估算。
 *
 * 每坑必哨兵(进化闭环):领导池曾在前端/后台/PRD 三面口径分裂 + 自曝失真 80%。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADMIN = path.resolve(HERE, "..");
const ROOT = path.resolve(ADMIN, "..");
const UNIAPP = path.join(ROOT, "Nexion-uniapp");

const fails = [];
const fail = (m) => fails.push(m);
const read = (p) => fs.readFileSync(p, "utf8");

// ── 解析前端真源 ──
const feStorePath = path.join(UNIAPP, "src/store/leadership-pool.ts");
const fe = read(feStorePath);

function parseRecord(text, varName) {
  const re = new RegExp(varName + "[^={]*=\\s*\\{([\\s\\S]*?)\\}", "m");
  const m = text.match(re);
  if (!m) return null;
  const out = {};
  for (const pair of m[1].matchAll(/(\d+)\s*:\s*(\d+)/g)) out[Number(pair[1])] = Number(pair[2]);
  return out;
}
const num = (text, name) => {
  const m = text.match(new RegExp(name + "\\s*[:=]\\s*([0-9_\\.]+)"));
  return m ? Number(m[1].replace(/_/g, "")) : null;
};

const feVotes = parseRecord(fe, "V_VOTES");
const feDist = parseRecord(fe, "GLOBAL_V_DISTRIBUTION");
const feGmv = num(fe, "WEEKLY_GMV_USDT");
const feRatio = num(fe, "POOL_RATIO");
const feUnlock = num(fe, "UNLOCK_RANK");
const feTopN = num(fe, "POOL_TOP_N");

if (!feVotes || !feDist || !feGmv || !feRatio) {
  fail("无法从前端 store 解析 canon(V_VOTES/GLOBAL_V_DISTRIBUTION/WEEKLY_GMV/RATIO)");
}

// ── 前端派生量(真值) ──
function derive(votes, dist, gmv, ratio, unlock, topN) {
  const pool = Math.round(gmv * ratio);
  let total = 0, qual = 0;
  const indiv = [];
  for (let v = unlock; v <= 12; v++) {
    const c = dist[v] || 0, w = votes[v] || 0;
    total += c * w; qual += c;
    for (let i = 0; i < c; i++) indiv.push(w);
  }
  indiv.sort((a, b) => b - a);
  const top = indiv.slice(0, topN).reduce((a, b) => a + b, 0);
  return { pool, total, qual, topConc: total ? top / total : 0 };
}
const feD = (feVotes && feDist) ? derive(feVotes, feDist, feGmv, feRatio, feUnlock || 3, feTopN || 10) : null;

// ── 解析后台 canon ──
const adminDataPath = path.join(ADMIN, "app/components/domain-views/f-tabs/data.ts");
const ad = read(adminDataPath);

const adGmv = num(ad, "weeklyGmvUsdt");
const adRatio = num(ad, "poolRatio");
const adUnlock = num(ad, "unlockRank");
const adTopN = num(ad, "topN");

// LEADERSHIP_CANON.ranks: { v: N, votes: M, pop: P }
const adVotes = {}, adPop = {};
const ranksBlock = ad.match(/ranks:\s*\[([\s\S]*?)\]/);
if (ranksBlock) {
  for (const r of ranksBlock[1].matchAll(/\{\s*v:\s*(\d+),\s*votes:\s*(\d+),\s*pop:\s*(\d+)\s*\}/g)) {
    adVotes[Number(r[1])] = Number(r[2]);
    adPop[Number(r[1])] = Number(r[3]);
  }
} else fail("后台 data.ts 未找到 LEADERSHIP_CANON.ranks");

// F1 VRANK pop: { v: "VN", ... pop: P }
const vrankPop = {};
for (const r of ad.matchAll(/\{\s*v:\s*"V(\d+)"[^}]*pop:\s*(\d+)\s*\}/g)) vrankPop[Number(r[1])] = Number(r[2]);

// ── 断言 1+2:逐项镜像 ──
if (feGmv !== adGmv) fail(`周 GMV 不一致: 前端 ${feGmv} ≠ 后台 ${adGmv}`);
if (feRatio !== adRatio) fail(`池比例不一致: 前端 ${feRatio} ≠ 后台 ${adRatio}`);
for (let v = 3; v <= 12; v++) {
  if (feVotes[v] !== adVotes[v]) fail(`V${v} 票权不一致: 前端 ${feVotes[v]} ≠ 后台 canon ${adVotes[v]}`);
  if (feDist[v] !== adPop[v]) fail(`V${v} 人头不一致: 前端 ${feDist[v]} ≠ 后台 canon ${adPop[v]}`);
  if (adPop[v] !== vrankPop[v]) fail(`V${v} 人头不一致: 后台 canon ${adPop[v]} ≠ F1 VRANK ${vrankPop[v]}`);
}

// ── 断言 3:派生量一致 ──
if (feD) {
  const adD = derive(adVotes, adPop, adGmv, adRatio, adUnlock || 3, adTopN || 10);
  if (feD.pool !== adD.pool) fail(`周池额派生不一致: 前端 $${feD.pool} ≠ 后台 $${adD.pool}`);
  if (feD.qual !== adD.qual) fail(`合格领袖数不一致: 前端 ${feD.qual} ≠ 后台 ${adD.qual}`);
  if (Math.round(feD.topConc * 100) !== Math.round(adD.topConc * 100)) {
    fail(`顶部${feTopN}名集中度不一致: 前端 ${(feD.topConc * 100).toFixed(1)}% ≠ 后台 ${(adD.topConc * 100).toFixed(1)}%`);
  }
}

// ── 断言 4:禁散落硬编码 ──
const banAdmin = [
  { re: /≈\s*80\s*%/, why: "硬编码集中度 ≈80%(应派生)" },
  { re: /(领导池|集中度|虹吸|池占比)[^。\n]{0,12}80\s*%|80\s*%[^。\n]{0,12}(领导池|分配|虹吸|池占比)/, why: "领导池集中度裸 80% 自曝(应派生,如 f1-vrank「承担 80% 领导池」)" },
  { re: /顶部\s*10\s*人.{0,6}80/, why: "硬编码「顶部10人…80%」" },
  { re: /参与\s*V8\+/, why: "硬编码参与门槛 V8+(应 V3+ 派生)" },
  { re: /V6\s*及以上/, why: "硬编码领导池门槛 V6(应 V3+)" },
  { re: /V6:1\s*\/\s*V9:2/, why: "硬编码等级权重 V6:1/V9:2/V12:3(应指数翻倍)" },
  { re: /\$96,?400/, why: "stale 领导池额 $96,400(应派生)" },
  { re: /\$214,000/, why: "硬编码领导池注入 $214,000(应派生)" },
];
for (const f of [
  "app/components/domain-views/f-tabs/f4-ops.tsx",
  "app/components/domain-views/f-tabs/f1-vrank.tsx",
  "lib/admin/registry/f.ts",
]) {
  const txt = read(path.join(ADMIN, f));
  for (const b of banAdmin) if (b.re.test(txt)) fail(`${f}: ${b.why}`);
}

// ── 断言 5:registry/f.ts 领导池字面值必须跟随 canon(防死字面静默漂移;3-agent audit 缺口)──
if (feD) {
  const regTxt = read(path.join(ADMIN, "lib/admin/registry/f.ts"));
  const regPool = regTxt.match(/label:\s*"本周奖池",\s*value:\s*"\$([\d,]+)"/);
  if (regPool && Number(regPool[1].replace(/,/g, "")) !== feD.pool) fail(`registry/f.ts 本周奖池字面 $${regPool[1]} ≠ canon 派生 $${feD.pool.toLocaleString()}`);
  const regQual = regTxt.match(/label:\s*"合格领袖",\s*value:\s*"(\d+)"/);
  if (regQual && Number(regQual[1]) !== feD.qual) fail(`registry/f.ts 合格领袖字面 ${regQual[1]} ≠ canon ${feD.qual}`);
  const expTop = Math.round(feD.topConc * 100);
  for (const m of regTxt.matchAll(/顶部\s*10\s*名\s*≈\s*(\d+)\s*%/g)) {
    if (Number(m[1]) !== expTop) fail(`registry/f.ts 集中度字面 ≈${m[1]}% ≠ canon ≈${expTop}%`);
  }
}

// ── 断言 6:f1-vrank 顶栏会员数必须派生(防再硬编码 614/100,575 与 canon 合格领袖 498 漂移)──
{
  const f1Txt = read(path.join(ADMIN, "app/components/domain-views/f-tabs/f1-vrank.tsx"));
  if (/V3\+\s*高价值<\/div><div className="v">\s*\d/.test(f1Txt)) fail('f1-vrank.tsx「V3+ 高价值」顶栏数硬编码(应派生自 leadershipQualifiers,防与 canon 合格领袖漂移)');
  if (/总会员<\/div><div className="v">\s*\d/.test(f1Txt)) fail('f1-vrank.tsx「总会员」顶栏数硬编码(应派生自 VRANK 求和)');
}

// 前端用户面禁死估算
const banFe = [
  { p: "src/i18n/messages/zh.ts", re: /20\s*万总票/, why: "i18n 死估算「20 万总票」" },
  { p: "src/i18n/messages/en.ts", re: /200K total votes/, why: "i18n 死估算「200K total votes」" },
];
for (const b of banFe) {
  const txt = read(path.join(UNIAPP, b.p));
  if (b.re.test(txt)) fail(`${b.p}: ${b.why}`);
}

// ── 结果 ──
if (fails.length) {
  console.error("✗ leadership-pool-canon-sentinel FAIL:");
  for (const f of fails) console.error("  · " + f);
  process.exit(1);
}
const r = feD || { pool: 0, qual: 0, topConc: 0 };
console.log(`✓ leadership-pool-canon-sentinel PASS — 双端单源一致 (池 $${r.pool.toLocaleString()} · 合格 ${r.qual} · 顶部${feTopN}名 ≈${Math.round(r.topConc * 100)}%)`);
