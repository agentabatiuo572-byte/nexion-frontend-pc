/**
 * 红测:共享幂等基建硬化包(docs/changes/2026-08-06-idem-hardening.md)。
 *
 * 规矩(沿用 _redtest-restore-mid-tiers.mjs,踩过的坑都在里面):
 *   - **按合取项逐个隔离**:每次注入只破坏一个断言,其余保持合法;一次注入打红多个条件时,
 *     那次红测只能算验了「最先失败的那一项」。
 *   - 还原走「工程内 .redtest-bak 副本 + finally」,禁 git checkout(会连带撤掉真改动)。
 *   - **锚必须单行**:仓内文件是 CRLF,带 \n 的多行锚永远失配。
 *   - 反误红绿测(EXPECT green)与打红用例同等重要:门太紧会把合法重构挡死。
 *
 * 🔴 常驻,不是一次性脚本:**改动这些门的判据后必须重跑**。不挂进 verify:它会临时改写
 *   源文件,并行跑会互相踩。手动跑:
 *     node scripts/_redtest-idem-hardening.mjs
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const STRIPPER = path.join(ROOT, "scripts/lib/strip-comments.mjs");
const STORE = path.join(ROOT, "lib/admin/pending-mutation-store.ts");
const K1 = path.join(ROOT, "app/components/domain-views/k-tabs/k1-multiaccount.tsx");
const G1 = path.join(ROOT, "lib/admin/g1-client.ts");

const GATE = ["scripts/pending-idempotency-key-sentinel.mjs"];
const MIGRATION = ["--test", "tests/pending-mutation-migration-contract.test.mjs"];
const STORE_CONTRACT = ["--test", "tests/pending-mutation-store-contract.test.mjs"];

function gateRed(args) {
  try {
    execFileSync("node", args, { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"] });
    return false; // 退出码 0 = 绿
  } catch { return true; }
}

/** 注入 → 跑门 → 无论如何还原。锚点不存在时 throw:红测本身失效必须暴露。 */
function inject(file, from, to, args) {
  const bak = `${file}.redtest-bak`;
  copyFileSync(file, bak);
  try {
    const src = readFileSync(file, "utf8");
    if (!src.includes(from)) throw new Error(`注入锚点不存在,红测本身失效:${path.basename(file)} ← ${from.slice(0, 60)}`);
    // 替换串用函数形式 —— 字符串形式里的 $& 会被当成整个匹配回填(踩过)。
    writeFileSync(file, src.replace(from, () => to));
    return gateRed(args);
  } finally {
    copyFileSync(bak, file);
    unlinkSync(bak);
  }
}

/** expect: "red"(注入必须打红)或 "green"(合法重构不得误红)。 */
const CASES = [
  // ══ T5 哨兵剥注释硬化 ═══════════════════════════════════════════
  ["T5① 派单原样走私:删真店换本地同名桩 + import 声明挪进注释(硬化前实测绿)", "red",
    () => inject(K1,
      'import { createPendingMutationStore } from "@/lib/admin/pending-mutation-store";',
      '// import { createPendingMutationStore } from "@/lib/admin/pending-mutation-store";\n'
      + 'const createPendingMutationStore = () => ({ get: () => undefined, remember: () => {}, forget: () => {}, list: () => [] });',
      GATE)],
  ["T5② 行注释走私:真 create 调用整行挪进注释(CRLF 剥除器活着才抓得到)", "red",
    () => inject(K1, "const commandAttempt = createPendingMutationStore(", "const commandAttempt = null; // const commandAttempt = createPendingMutationStore(", GATE)],
  // 注:块注释必须**闭合**才会被剥除器认出;写个不闭合的 `/*` 反而什么都没剥掉,
  //     那验的就不是「块注释走私被抓」而是「正则失配」——第一版就踩了这个,故整行替换。
  ["T5③ 块注释走私:executor 接线被 /* */ 包住(viaExecutor 旁路)", "red",
    () => inject(G1,
      'const executeG1Mutation = createStableMutationExecutor(idempotencyKey, "nexion-admin-g1-staking-commands-v1");',
      'const executeG1Mutation = null; /* createStableMutationExecutor(idempotencyKey, "nexion-admin-g1-staking-commands-v1"); */',
      GATE)],
  ["T5④ executor 路径改用本地同名桩(import 绑定判据)", "red",
    () => inject(G1,
      'import { createStableMutationExecutor, stableMutationFingerprint, stableMutationHttpFailure } from "@/lib/admin/stable-mutation";',
      'import { stableMutationFingerprint, stableMutationHttpFailure } from "@/lib/admin/stable-mutation";\n'
      + "const createStableMutationExecutor = () => async (_p, _f, cmd, ok) => ok(await cmd(\"inline-\" + Math.random()));",
      GATE)],
  ["T5⑤ 判据 4 走私:store 的换指纹弃号被注释掉(空壳化)", "red",
    () => inject(STORE, "      if (saved) store.forget(slot);", "      // if (saved) store.forget(slot);", GATE)],
  ["T5⑥ 判据 4 走私:sessionStorage 写入被注释掉(持久化空壳)", "red",
    () => inject(STORE, "else window.sessionStorage.setItem(storageKey,", "else void 0; // window.sessionStorage.setItem(storageKey,", GATE)],
  ["T5⑦ 自检咬人:剥除器退回按行形态(CRLF 上死掉)→ 判据 0b 必红", "red",
    () => inject(STRIPPER, 'out = out.replace(/(^|[^:])\\/\\/.*$/gm, "$1");',
      'out = out.split("\\n").map((line) => line.replace(/\\/\\/.*$/, "")).join("\\n");', GATE)],
  ["T5⑧ 自检咬人:剥除器丢掉 :// 协议守卫 → 判据 0b 必红", "red",
    () => inject(STRIPPER, 'out = out.replace(/(^|[^:])\\/\\/.*$/gm, "$1");', 'out = out.replace(/\\/\\/.*$/gm, "");', GATE)],
  ["T5⑨ 自检咬人:剥除器不再剥块注释 → 判据 0b 必红", "red",
    () => inject(STRIPPER, 'let out = source.replace(/\\/\\*[\\s\\S]*?\\*\\//g, "");', "let out = source;", GATE)],
  // 判别力说明:URL 必须**与承重代码同行且在其前面** —— 单独一行的 URL 无论守卫在不在
  //   都不影响判定,那种探针证明不了任何事。这里守卫失守 = create 调用被连带吃掉 = 误红。
  ["T5⑩ 反误红::// 协议串与 create 调用同行时不得把后半行吃掉", "green",
    () => inject(K1, "const commandAttempt = createPendingMutationStore(",
      'const k1Docs = "https://nexion.example/docs"; const commandAttempt = createPendingMutationStore(', GATE)],
  ["T5⑪ 反误红:import 换成多行排版(合法重构)", "green",
    () => inject(K1,
      'import { createPendingMutationStore } from "@/lib/admin/pending-mutation-store";',
      "import {\n  createPendingMutationStore,\n} from \"@/lib/admin/pending-mutation-store\";", GATE)],
  ["T5⑫ 台账反解析不被破坏:migration-contract 仍能从哨兵源码解析出 MIGRATED 清单", "green",
    () => inject(K1, "const commandAttempt = createPendingMutationStore(", "const commandAttempt = createPendingMutationStore(", MIGRATION)],
  ["T5⑬ store 行为契约不被硬化波及(负控)", "green",
    () => inject(K1, "const commandAttempt = createPendingMutationStore(", "const commandAttempt = createPendingMutationStore(", STORE_CONTRACT)],

  // ══ T3 存储不可用时的内存兜底 ═══════════════════════════════════
  ["T3① 复现原缺陷:readAll 不再以内存打底(隐私模式下每次重试铸新号)", "red",
    () => inject(STORE, "    for (const [commandKey, record] of memory) {", "    for (const [commandKey, record] of []) {", STORE_CONTRACT)],
  ["T3② 复现原缺陷:writeAll 不同步内存镜像(写失败后记录凭空消失)", "red",
    () => inject(STORE, "  function writeAll(value: Record<string, T>) {\r\n    syncMemory(value);",
      "  function writeAll(value: Record<string, T>) {", STORE_CONTRACT)],
  ["T3③ 降级告警被摘掉 → 契约门必红(缺陷可以静默发生正是原问题的一半)", "red",
    () => inject(STORE, "    console.warn(", "    void 0 && console.warn(", STORE_CONTRACT)],
  ["T3④ 告警改成每次都喊(刷屏)→ 契约门必红", "red",
    () => inject(STORE, "    if (degradedNotified) return;", "    if (false) return;", STORE_CONTRACT)],
  ["T3⑤ 内存兜底不得凌驾 TTL:过期判定被摘掉即红", "red",
    () => inject(STORE, "      if (usable(record, commandKey, now)) current[commandKey] = record;\r\n    }\r\n    let persistedCount",
      "      current[commandKey] = record;\r\n    }\r\n    let persistedCount", STORE_CONTRACT)],

  // ══ T4 TTL 硬上限 ═════════════════════════════════════════════
  ["T4① 复现原缺陷:expiresAt 改回滑动续期 → 契约门必红", "red",
    () => inject(STORE, "        expiresAt: createdAt + ttlMs,", "        expiresAt: Date.now() + ttlMs,", STORE_CONTRACT)],
  ["T4② createdAt 被重试覆盖(首次时间丢失)→ 契约门必红", "red",
    () => inject(STORE, "      const createdAt = previous?.createdAt ?? Date.now();", "      const createdAt = Date.now();", STORE_CONTRACT)],
  ["T4③ 反误红:ttlMs 仍可由调用方覆盖(降级 TTL 用例依赖它)", "green",
    () => inject(STORE, "        expiresAt: createdAt + ttlMs,", "        expiresAt: createdAt + ttlMs, // ponytail: 窗口口径见 §0.4", STORE_CONTRACT)],
];

let failed = 0;
for (const [name, expect, run] of CASES) {
  const red = run();
  const ok = expect === "red" ? red : !red;
  if (!ok) failed += 1;
  console.log(`${ok ? "✓" : "✗"} [期望${expect === "red" ? "红" : "绿"}] ${name}${ok ? "" : "  ← 与期望不符"}`);
}

// 还原完整性:红测跑完源文件必须逐字节回到原样(否则后续门验的是被污染的树)。
const dirty = execFileSync("git", ["status", "--porcelain", "--", "scripts", "lib", "app"], { cwd: ROOT, encoding: "utf8" })
  .split("\n").filter((line) => line.includes(".redtest-bak"));
if (dirty.length) { console.error(`✗ 残留备份文件:${dirty.join(" ")}`); failed += 1; }

console.log(failed ? `\n红测未通过:${failed} 项与期望不符` : `\n红测全部按预期(${CASES.length} 项)`);
process.exit(failed ? 1 : 0);
