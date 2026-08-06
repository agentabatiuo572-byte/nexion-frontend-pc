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
import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const STRIPPER = path.join(ROOT, "scripts/lib/strip-comments.mjs");
const SENTINEL = path.join(ROOT, "scripts/pending-idempotency-key-sentinel.mjs");
const STORE = path.join(ROOT, "lib/admin/pending-mutation-store.ts");
const K1 = path.join(ROOT, "app/components/domain-views/k-tabs/k1-multiaccount.tsx");
const G1 = path.join(ROOT, "lib/admin/g1-client.ts");
const AUTH = path.join(ROOT, "lib/admin/auth-session.ts");
const CLASSIFY = path.join(ROOT, "lib/admin/outcome-classification.ts");
const A2 = path.join(ROOT, "lib/admin/a2-client.ts");
const B2 = path.join(ROOT, "lib/admin/b2-client.ts");
const K = path.join(ROOT, "lib/admin/k-client.ts");
const U360 = path.join(ROOT, "lib/admin/user360-client.ts");
const AUTHSTORE = path.join(ROOT, "lib/store/admin-auth.ts");
const SMUT = path.join(ROOT, "lib/admin/stable-mutation.ts");
const LOGIN = path.join(ROOT, "lib/admin/login-completion.ts");
const SHELL = path.join(ROOT, "app/components/shell/console-shell.tsx");

const GATE = ["scripts/pending-idempotency-key-sentinel.mjs"];
const MIGRATION = ["--test", "tests/pending-mutation-migration-contract.test.mjs"];
const STORE_CONTRACT = ["--test", "tests/pending-mutation-store-contract.test.mjs"];
const OUTCOME = ["--experimental-strip-types", "--test", "tests/outcome-classification-contract.test.mjs"];

/**
 * 跑门,返回 { red, output }。
 * 🔴 必须把输出带回来(2026-08-06 独立验收 P2):只断言退出码时,「红对了但红错了理由」
 *   ——甚至门自己因语法错误崩掉 —— 都会显示 ✓。用例声明 expectText 后才算真的钉住判据。
 */
function gate(args) {
  try {
    const stdout = execFileSync("node", args, { cwd: ROOT, stdio: ["pipe", "pipe", "pipe"], encoding: "utf8" });
    return { red: false, output: stdout ?? "" };
  } catch (error) {
    return { red: true, output: `${error.stdout ?? ""}${error.stderr ?? ""}` };
  }
}

/** 注入 → 跑门 → 无论如何还原。锚点不存在、或注入没改变内容时 throw:红测本身失效必须暴露。 */
function inject(file, from, to, args) {
  const bak = `${file}.redtest-bak`;
  copyFileSync(file, bak);
  try {
    const src = readFileSync(file, "utf8");
    if (!src.includes(from)) throw new Error(`注入锚点不存在,红测本身失效:${path.basename(file)} ← ${from.slice(0, 60)}`);
    // 替换串用函数形式 —— 字符串形式里的 $& 会被当成整个匹配回填(踩过)。
    const mutated = src.replace(from, () => to);
    // 🔴 空注入守卫(独立验收 P2):from === to 时这一条只是「在原样的树上跑一遍门」,
    //   零判别力却照样打 ✓。宁可红测自己炸,也不留一条自我安慰的用例。
    if (mutated === src) throw new Error(`空注入(from === to),该用例没有判别力:${path.basename(file)}`);
    writeFileSync(file, mutated);
    return gate(args);
  } finally {
    copyFileSync(bak, file);
    unlinkSync(bak);
  }
}

/** 先造一个临时模块,再在它存在期间跑注入(路径走私变异需要那个同名文件真的在)。 */
function withExtraFile(relPath, content, run) {
  const full = path.join(ROOT, relPath);
  writeFileSync(full, content);
  try { return run(); } finally { unlinkSync(full); }
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
  // ⑫⑬ 原为空注入(from === to),零判别力 —— 独立验收 P2 点破,改成真变异。
  ["T5⑫ 台账反解析抗排版漂移:MIGRATED 条目改缩进后清单不得静默缩短", "green",
    () => inject(SENTINEL, '  "lib/admin/i-client.ts",', '    "lib/admin/i-client.ts",', MIGRATION)],
  ["T5⑬ 台账反解析抗行尾注释:条目后加注释清单不得静默缩短", "green",
    () => inject(SENTINEL, '  "lib/admin/k6-client.ts",', '  "lib/admin/k6-client.ts", // K6 远端写入', MIGRATION)],
  // ⑭ 打的是哨兵而非迁移契约:契约那边只有 `>= 28` 的下限兜底(实际 30),少一条照样绿 ——
  //    本轮红测实测抓到,遂在哨兵补判据 5「用了共享 store 就必须在台账里」,由它来咬。
  ["T5⑭ 台账真少一条时必红(证明上面两条不是靠判据松垮才绿)", "red",
    () => inject(SENTINEL, '  "lib/admin/i-client.ts",\r\n', "", GATE),
    "却不在 MIGRATED 台账里"],

  // ══ T5-R 独立验收 3×P0 + 2×P1 的回归钉 ══════════════════════════
  ["T5-R1 别名 import + 同名本地桩(P0:判名字出现过而非判绑定去向)", "red",
    () => inject(K1,
      'import { createPendingMutationStore } from "@/lib/admin/pending-mutation-store";',
      'import { createPendingMutationStore as _real } from "@/lib/admin/pending-mutation-store";\r\n'
      + "const createPendingMutationStore = (_o) => ({ get: () => undefined, remember: () => {}, forget: () => {}, list: () => [] });",
      GATE),
    "没有从共享 store"],
  ["T5-R2 import 路径指向自造同名文件(P0:路径子串判据)", "red",
    () => withExtraFile("lib/admin/probe-pending-mutation-store.ts",
      "export const createPendingMutationStore = () => ({ get: () => undefined, remember: () => {}, forget: () => {}, list: () => [] });\n",
      () => inject(K1, "@/lib/admin/pending-mutation-store", "@/lib/admin/probe-pending-mutation-store", GATE)),
    "没有从共享 store"],
  ["T5-R3 import type(P0 同族:运行时无绑定却被当真)", "red",
    () => inject(K1, "import { createPendingMutationStore }", "import type { createPendingMutationStore }", GATE),
    "没有从共享 store"],
  ["T5-R4 悬空 executor 常量换整文件免检(P0:viaExecutor 分支的 continue 金牌)", "red",
    () => inject(K1,
      'import { createPendingMutationStore } from "@/lib/admin/pending-mutation-store";',
      'import { createStableMutationExecutor } from "@/lib/admin/stable-mutation";\r\n'
      + 'const _dangling = createStableMutationExecutor(() => "x", "nexion-admin-k1-probe-v1");\r\n'
      + "const createPendingMutationStore = (_o) => ({ get: () => undefined, remember: () => {}, forget: () => {}, list: () => [] });",
      GATE),
    "建了却从不调用"],
  ["T5-R5 反误红:executor 调用折行 + 尾逗号(P1 误红,prettier 日常排版)", "green",
    () => inject(G1, 'createStableMutationExecutor(idempotencyKey, "nexion-admin-g1-staking-commands-v1");',
      'createStableMutationExecutor(\r\n  idempotencyKey,\r\n  "nexion-admin-g1-staking-commands-v1",\r\n);', GATE)],
  ["T5-R6 反误红:storageKey 抽成具名常量(P1 误红,合法重构)", "green",
    () => inject(G1, 'createStableMutationExecutor(idempotencyKey, "nexion-admin-g1-staking-commands-v1");',
      'createStableMutationExecutor(idempotencyKey, G1_KEY);\r\n'
      + 'const G1_KEY = "nexion-admin-g1-staking-commands-v1";', GATE)],
  ["T5-R7 具名常量为空串仍必须红(上一条放宽后不得漏掉真缺陷)", "red",
    () => inject(G1, 'createStableMutationExecutor(idempotencyKey, "nexion-admin-g1-staking-commands-v1");',
      'createStableMutationExecutor(idempotencyKey, G1_KEY);\r\nconst G1_KEY = "";', GATE),
    "storageKey 不是非空字符串"],
  ["T5-R8 自检咬人:行注释正则丢 g(只剥第一处)→ 判据 0b 必红", "red",
    () => inject(STRIPPER, 'out = out.replace(/(^|[^:])\\/\\/.*$/gm, "$1");', 'out = out.replace(/(^|[^:])\\/\\/.*$/m, "$1");', GATE),
    "只剥掉第一条行注释"],
  ["T5-R9 自检咬人:块注释正则丢 g(只剥第一段)→ 判据 0b 必红", "red",
    () => inject(STRIPPER, 'let out = source.replace(/\\/\\*[\\s\\S]*?\\*\\//g, "");', 'let out = source.replace(/\\/\\*[\\s\\S]*?\\*\\//, "");', GATE),
    "只剥掉第一段块注释"],
  ["T5-R10 自检咬人:html 分支被摘 → 判据 0b 必红(共享 lib 那一半原本零自检)", "red",
    () => inject(STRIPPER, '  if (html) out = out.replace(/<!--[\\s\\S]*?-->/g, "");', "  void html;", GATE),
    "html 分支失效"],

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

  // ══ T2 登出 / 换操作员清扫 ═════════════════════════════════════
  // T2①②③ 原本钉「resetAdminSession 必须清扫」,已被第三轮验收推翻(401 ≠ 换人,
  // 在那里清会误伤同一个人)。现在改钉反向不变量:401 路径**不得**自行清扫。
  ["T2① 401 路径又自行清扫(误伤同一个人的在途命令号)→ 必红", "red",
    () => inject(AUTH, "  void fetch(\"/api/admin/auth/logout\"",
      "  clearPendingCommandRecords(window.sessionStorage);\r\n  void fetch(\"/api/admin/auth/logout\"", MIGRATION),
    "不得自行清扫"],
  // ④ 把清扫改回**派单原本设想的按键名判**,复现它会漏掉 h9 那把命名不合群的键
  //   (nexion-admin-h9-public-stats-attempt:既不含 commands 也没有版本后缀)。
  ["T2④ 退回「按键名判」→ 漏掉 h9 那把不合群的键,必红", "red",
    () => inject(STORE,
      "      if (key && isPendingCommandTable(target.getItem(key))) doomed.push(key);",
      '      if (key && /^nexion-admin-.+-commands-v\\d+$/.test(key) && isPendingCommandTable(target.getItem(key))) doomed.push(key);',
      MIGRATION),
    "清扫覆盖全仓每一把在途命令号存储键"],
  ["T2⑤ 形状判据被放宽成「是个对象就清」→ 误删无关数据必红", "red",
    () => inject(STORE, "      return !!record && typeof record === \"object\"", "      return !!record || typeof record === \"object\"", MIGRATION),
    "清扫按记录形状认表"],
  ["T2⑥ 遍历时边删边走(key 索引塌陷,漏掉一半)→ 必红", "red",
    () => inject(STORE,
      "      if (key && isPendingCommandTable(target.getItem(key))) doomed.push(key);",
      "      if (key && isPendingCommandTable(target.getItem(key))) target.removeItem(key);",
      MIGRATION),
    "清扫数与键数不符"],

  // ══ T1 全家族失败归类统一 ═══════════════════════════════════════
  ["T1① 谓词把 5xx 判成确定失败(复现原缺陷:弃号 → 资金动作双发)", "red",
    () => inject(CLASSIFY, "  if (status >= 400 && status < 500) return true;", "  if (status >= 400) return true;", OUTCOME),
    "不得判确定失败"],
  ["T1② 两个谓词不再互补(只改一个,另一个留旧口径)", "red",
    () => inject(CLASSIFY, "  return !isDeterministicRejection(status, apiCode);", "  return status >= 500;", OUTCOME),
    "两个谓词恒为互补"],
  ["T1③ a2 退回原口径(结构化 5xx 归确定失败)→ 舰队门必红", "red",
    () => inject(A2, "    if (init?.commandKey && outcomeStaysUnknown(response.status, result?.code)) {",
      "    if (false) {", OUTCOME),
    "判了个寂寞"],
  ["T1④ b2 撤掉传输层 try/catch(断网抛裸错误被当确定失败)→ 必红", "red",
    () => inject(B2, "  let response: Response;\r\n  try {\r\n    response = await fetch(`/api/admin/treasury${path}`",
      "  let response: Response;\r\n  {\r\n    response = await fetch(`/api/admin/treasury${path}`", OUTCOME)],
  ["T1⑤ 某个域偷偷自搓 5xx 门槛(口径分叉复发)→ 必红", "red",
    () => inject(K, "    if (isWrite && outcomeStaysUnknown(res.status, payload.code)) {",
      "    if (isWrite && res.status >= 500) {", OUTCOME),
    "自搓的 5xx 门槛"],
  ["T1⑥ 反误红:非归类用途的 5xx 判定带显式豁免标记时不得报红", "green",
    () => inject(U360, "    // classification-ok:这里的 5xx 判定只挑**错误文案**",
      "    // classification-ok: 文案选择,不参与命令号去留\r\n    // (原注释)这里的 5xx 判定只挑**错误文案**", OUTCOME)],
  ["T1⑦ 豁免标记被摘掉 → 必红(豁免必须显式,不许靠沉默)", "red",
    () => inject(U360, "    // classification-ok:这里的 5xx 判定只挑**错误文案**", "    // 这里的 5xx 判定只挑**错误文案**", OUTCOME),
    "自搓的 5xx 门槛"],

  // ══ R2 第二轮独立验收(2×P0 + 4×P1)的回归钉 ══════════════════
  // R2 原来的两条钉的是「清扫挂 signOut」那版设计,已被第三轮验收推翻(挂 signOut 会误伤
  // 同一个人)。换成钉现行的身份判据 —— 两个方向各钉一条,漏一个泄漏、错一个重复打款。
  ["R2-P0-1 身份认领从 signIn 上摘掉(换人不再清)→ 必红", "red",
    () => inject(AUTHSTORE, "    claimPendingCommandOwner(String(session.adminId));", "", MIGRATION),
    "必须按持久化的 adminId 认领"],
  ["R2-P0-1b 认领改用内存里的显示名(刷新后为空,永远判不出换人)→ 必红", "red",
    () => inject(AUTHSTORE, "claimPendingCommandOwner(String(session.adminId));", "claimPendingCommandOwner(session.operator);", MIGRATION),
    "必须按持久化的 adminId 认领"],
  ["R2-P0-1c 认领改成无条件清(误伤同一个人 = 重复打款)→ 必红", "red",
    () => inject(STORE, "  if (previous === ownerId) return 0;", "  if (false) return 0;", MIGRATION),
    "不得清掉同一个人的在途命令号"],
  ["R2-P0-1d marker 缺失时改成放行(归属不明的号给了下一个人)→ 必红", "red",
    () => inject(STORE, "  if (previous === ownerId) return 0;", "  if (previous === ownerId || !previous) return 0;", MIGRATION),
    "归属不明必须清"],
  ["R2-P0-1e 登出路径又自作主张清(散落清扫复发)→ 必红", "red",
    () => inject(AUTHSTORE, "  signOut: () =>\r\n    set({", "  signOut: () => {\r\n    clearPendingCommandRecords();\r\n    return set({", MIGRATION),
    "signOut 不得清"],
  ["R2-P0-2 清扫代次被摘掉 → 存活实例的内存镜像把命令号复活,必红", "red",
    () => inject(STORE, "  clearGeneration += 1;", "  void 0;", MIGRATION),
    "不得把命令号写回来"],
  ["R2-P0-2b 代次作废只清代次不清内存 → 必红", "red",
    () => inject(STORE, "    seenGeneration = clearGeneration;\r\n    memory.clear();", "    seenGeneration = clearGeneration;", MIGRATION),
    "清扫不得被存活实例的内存镜像复活"],
  ["R2-P1-1 硬上限被读路径击穿(把续期藏进 readAll)→ 必红", "red",
    () => inject(STORE, "      if (usable(record, commandKey, now)) current[commandKey] = record;",
      "      if (usable(record, commandKey, now)) current[commandKey] = { ...record, expiresAt: now + ttlMs };", STORE_CONTRACT),
    "读路径若偷偷续期"],
  ["R2-P1-2 口径退化藏进「参数不叫 status 的 helper」→ 必红(门不再认变量名)", "red",
    () => inject(K, "    if (isWrite && outcomeStaysUnknown(res.status, payload.code)) {",
      "    const hardFail = (c: number) => c >= 500;\r\n    if (isWrite && !hardFail(res.status) && outcomeStaysUnknown(999, 1)) {", OUTCOME),
    "自搓的 5xx 门槛"],
  ["R2-P1-3 stable-mutation 退回自带副本(五个 G 域的两源问题)→ 必红", "red",
    () => inject(SMUT, "    isDeterministicRejection(status, apiCode) ? \"deterministic\" : \"outcome-unknown\",",
      "    ((status >= 400 && status < 500) ? true : false) ? \"deterministic\" : \"outcome-unknown\",", OUTCOME),
    "自搓的 5xx 门槛"],
  ["R2-P2-1 公共字段挪回 extra 之前(调用方元数据能覆盖命令号)→ 必红", "red",
    () => inject(STORE, "        ...(extra as object | undefined),\r\n        fingerprint,\r\n        commandKey,",
      "        fingerprint,\r\n        commandKey,\r\n        ...(extra as object | undefined),", STORE_CONTRACT),
    "公共字段必须排在 extra 之后"],
  // R3 原来两条钉的是「登录侧无条件清」那版兜底闸,同样被推翻(会误伤同一个人重新登录)。
  // 换成钉「登录/401 路径不得再自行清扫」与「会话恢复必须经 signIn(否则绕过认领)」。
  ["R3① 登录页自行清扫复发(误伤同一个人会话过期后重登)→ 必红", "red",
    () => inject(LOGIN, "  signIn(result);\r\n  reload();",
      "  clearPendingCommandRecords();\r\n  signIn(result);\r\n  reload();", MIGRATION),
    "不得自行清扫"],
  ["R3② 会话恢复绕过 signIn(直接塞状态)→ 认领不会发生,必红", "red",
    () => inject(SHELL, "          signIn(auth);", "          void auth;", MIGRATION),
    "都必须经 signIn"],
  ["R2-P2-3 形状判据从 every 放宽成 some → 混合业务表被误删,必红", "red",
    () => inject(STORE, "    return rows.every(([commandKey, value]) => {", "    return rows.some(([commandKey, value]) => {", MIGRATION),
    "清扫按记录形状认表"],
];

// 🔴 还原完整性升级为**内容指纹**(2026-08-06 独立验收 P2):原来只 filter 残留的 .redtest-bak,
//   而被注入的文件本来就处在 ` M` 状态 —— 内容没还原完全看不出来,后续门验的就是被污染的树。
const TOUCHED = [STRIPPER, STORE, K1, G1, SENTINEL, AUTH, CLASSIFY, A2, B2, K, U360, AUTHSTORE, SMUT, LOGIN, SHELL];
const digest = () => TOUCHED.map((file) => createHash("sha1").update(readFileSync(file)).digest("hex")).join(" ");
const before = digest();

let failed = 0;
for (const [name, expect, run, expectText] of CASES) {
  const { red, output } = run();
  let ok = expect === "red" ? red : !red;
  let note = "";
  // 红对了还得**红在正确的判据上**:门因语法错误自己崩掉、或红在无关条目上,都不算验到。
  if (ok && expect === "red" && expectText && !output.includes(expectText)) {
    ok = false;
    note = `  ← 红了,但不是因为「${expectText}」(实际:${output.trim().split("\n").slice(-1)[0]?.slice(0, 90)})`;
  }
  if (!ok) failed += 1;
  console.log(`${ok ? "✓" : "✗"} [期望${expect === "red" ? "红" : "绿"}] ${name}${ok ? "" : (note || "  ← 与期望不符")}`);
}

const after = digest();
if (after !== before) { console.error("✗ 被注入的源文件内容没有逐字节还原 —— 后续门会验到被污染的树"); failed += 1; }
const strays = execFileSync("git", ["status", "--porcelain", "--", "scripts", "lib", "app"], { cwd: ROOT, encoding: "utf8" })
  .split("\n").filter((line) => line.includes(".redtest-bak") || line.includes("probe-"));
if (strays.length) { console.error(`✗ 残留探针 / 备份文件:${strays.join(" ")}`); failed += 1; }

console.log(failed ? `\n红测未通过:${failed} 项与期望不符` : `\n红测全部按预期(${CASES.length} 项)`);
process.exit(failed ? 1 : 0);
