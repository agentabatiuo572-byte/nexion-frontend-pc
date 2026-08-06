/**
 * 红测:G4 市场状态两道门。**按合取项逐个隔离** —— 每次注入只破坏一个断言,
 * 其余保持合法;一次注入打红多个条件时,那次红测只能算验了「最先失败的那一项」。
 * 还原走「工程内 .redtest-bak 副本 + finally」,禁 git checkout(会连带撤掉真改动)。
 *
 * 🔴 常驻,不是一次性脚本:**改动这两道门的判据后必须重跑**,证明新判据仍抓得住对应形态。
 *   「门是绿的」从来不等于「判据有效」—— 本文件首跑就抓出两处假绿(⑤a 只查 lastChange、
 *   parity③ 只验「新名出现过」而该文件同形声明有三处)。
 *   不挂进 verify:它会临时改写源文件,并行跑会互相踩。手动跑:
 *     node scripts/_redtest-g4-market-gates.mjs
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const UNI = path.resolve(ROOT, "../Nexion-uniapp");
const VIEW = path.join(ROOT, "app/components/domain-views/g-tabs/g4-genesis.tsx");
const CLIENT = path.join(ROOT, "lib/admin/g4-client.ts");
const REGISTRY = path.join(ROOT, "lib/admin/registry/g.ts");
const UNICFG = path.join(UNI, "src/store/genesis-config.ts");

const CONTRACT = ["--test", "tests/g4-market-open-state-contract.test.mjs"];
const PARITY = ["--test", "tests/g4-market-open-state-parity.test.mjs"];

function gateRed(args) {
  try {
    execFileSync("node", args, { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] });
    return false; // 退出码 0 = 绿
  } catch { return true; }
}

/** 注入 → 跑门 → 无论如何还原。 */
function inject(file, from, to, args) {
  const bak = `${file}.redtest-bak`;
  copyFileSync(file, bak);
  try {
    const src = readFileSync(file, "utf8");
    if (!src.includes(from)) throw new Error(`注入锚点不存在,红测本身失效:${path.basename(file)} ← ${from.slice(0, 50)}`);
    // 替换串用函数形式 —— 字符串形式里的 $& 会被当成整个匹配回填(踩过)。
    writeFileSync(file, src.replace(from, () => to));
    return gateRed(args);
  } finally {
    copyFileSync(bak, file);
    unlinkSync(bak);
  }
}

const CASES = [
  // ── 契约门 ① 理由必填 ────────────────────────────────────────
  ["①a reasonMax 改成 0(\\d+ 连 0 都算过是上一版的洞)",
    () => inject(VIEW, "reasonMax: 200,", "reasonMax: 0,", CONTRACT)],
  ["①b reasonMax 按方向分叉(换个写法绕过上一版的字面量断言)",
    () => inject(VIEW, "reasonMax: 200,", 'reasonMax: next === "closed" ? 200 : 0,', CONTRACT)],
  ["①c 上一版那个字面量本身(回归)",
    () => inject(VIEW, "reasonMax: 200,", 'reasonMax: next === "open" ? undefined : 200,', CONTRACT)],
  // ── 契约门 ② 下拉不自由输入 ──────────────────────────────────
  ["② inputKind 退回自由文本",
    () => inject(VIEW, 'inputKind: "select"', 'inputKind: "text"', CONTRACT)],
  // ── 契约门 ③ 旧名绝迹(消费面,不只定义面)──────────────────
  ["③a 旧名残留在 view(消费面)",
    () => inject(VIEW, "const marketClosed = overview.market.marketOpenState",
      "const openState = overview.market.marketOpenState;\n  const marketClosed = overview.market.marketOpenState", CONTRACT)],
  ["③b 旧名残留在 registry(上一版只查 g4-client.ts,扫不到这里)",
    () => inject(REGISTRY, "export ", "const openState = 1;\nexport ", CONTRACT)],
  // ── 契约门 ⑤ 展示两件 ────────────────────────────────────────
  // ⚠️ 锚点必须唯一:首版写成裸串「创世市场状态」,replace 命中的是**第 235 行那条注释**
  //    (而门是剥注释后判的)→ 假绿。锚到 JSX 本身。
  ["⑤a 删掉「当前状态」那一格的标题(上一版只查 lastChange,这里全绿)",
    () => inject(VIEW, '<div className="k">创世市场状态</div>', '<div className="k">市场开关</div>', CONTRACT)],
  ["⑤b 删掉「最近一次变更」展示(回归)",
    () => inject(VIEW, "最近变更:{overview.market.lastChange", "最近变更:{(", CONTRACT)],
  // ── 契约门 ④ 两个独立动作 ────────────────────────────────────
  ["④ 市场状态端点被并进熔断端点",
    () => inject(CLIENT, '"/nex/genesis/market-open-state"', '"/nex/genesis/market-status"', CONTRACT)],
  // ── parity 门 ③ 跨仓字段名 ───────────────────────────────────
  ["parity③ 前端字段名改回旧名",
    () => inject(UNICFG, 'marketOpenState: "open" | "closed"', 'marketStatus: "open" | "closed"', PARITY)],
  // ── parity 门 ② 跨仓白名单等价 ───────────────────────────────
  ["parity② 后台下拉少一项",
    () => inject(VIEW, 'options: ["default", "maintenance", "restock"]', 'options: ["default", "maintenance"]', PARITY)],
  ["parity② 前端白名单多一项",
    () => inject(UNICFG, '"default", "maintenance", "restock"', '"default", "maintenance", "restock", "sold_out"', PARITY)],
];

let bad = 0;
for (const [name, run] of CASES) {
  let red;
  try { red = run(); } catch (e) { console.log(`  ⚠️  ${name} —— 红测本身出错:${e.message}`); bad++; continue; }
  if (!red) bad++;
  console.log(`  ${red ? "✅" : "❌"} ${name}  →  ${red ? "红(判据有效)" : "绿(判据形同虚设)"}`);
}

// 还原后必须回到全绿 —— 否则说明某个 finally 没还干净。
const contractGreen = !gateRed(CONTRACT);
const parityGreen = !gateRed(PARITY);
console.log(`\n还原后复跑:契约门 ${contractGreen ? "绿" : "红 ❌"} · parity 门 ${parityGreen ? "绿" : "红 ❌"}`);
if (!contractGreen || !parityGreen) bad++;
console.log(`红测:${CASES.length - bad}/${CASES.length} 通过${bad ? " —— 有判据抓不住对应形态" : ""}`);
process.exit(bad === 0 ? 0 : 1);
