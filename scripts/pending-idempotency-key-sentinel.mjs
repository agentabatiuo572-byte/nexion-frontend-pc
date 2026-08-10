#!/usr/bin/env node
/**
 * 内存态幂等键哨兵。
 *
 * 防的坑(2026-08-04 存量 2×P1):高敏动作的 Idempotency-Key 只存在内存
 * (模块级 `new Map()` / `useState<{fingerprint}>` / `useRef(new Map())`),刷新页面即清零;
 * 运营重试时铸出新命令号,后端无法去重 → **重复入账 / 重复操作**。
 * 正确范式 = `lib/admin/pending-mutation-store.ts`(sessionStorage + 24h TTL + fingerprint 校验)。
 *
 * 判据(两个方向都焊,缺一即「删除方向盲区」):
 *   1. 扫 app/ lib/ 里所有「可变 Map 型命令状态容器」,**未登记在下方台账的一律红**。
 *   2. 台账里登记了、但扫描扫不到的条目也红(防止条目被删/改名后台账静默失真)。
 *   3. MIGRATED 文件必须仍然**真 import 并调用**共享 store,且不得回退成裸内存态。**含调用点**:
 *      「文件里有 create 调用」不等于「命令号真的从 store 走」——最可能的回退形态是
 *      保留 `const x = createSlotAttemptStore(...)` 悬空(没人会去删一个 const),把真实
 *      调用点换回内联铸号,或删掉成功路径上的 x.forget(槽位永不收敛,复用已被后端
 *      消费的旧号)。本仓无 ESLint、tsc 未开 noUnusedLocals,悬空 const 别的门全看不见。
 *
 * 🔴 结构判定**一律跑在剥注释正文**上(2026-08-06 硬化)。上一版只有判据 3b 剥了,
 *   同一函数里的 direct / viaExecutor / storageKey / 判据 4 仍读原文,实测走私路径:
 *   删掉真 store、把 `createStableMutationExecutor(idempotencyKey, "k")` 挪进注释 →
 *   viaExecutor 命中 → 整个文件被 `continue` 放行,持久化已经没了而门是绿的。
 *   同理由把 direct 从「文中提到模块名」收紧成「真 import 了 create* 符号」——
 *   字符串里提一嘴、或本地同名桩 + 残留 import 都不再算数。
 *   剥除器自身由**判据 0b 自检**钉住:它一死,整张门就是摆设。
 *
 * 台账写在本脚本(不写在被查文件里),每条必须写理由。新增命中 = 要么迁到共享 store,
 * 要么在 KNOWN 里补一行并说清为什么不需要持久化。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "./lib/strip-comments.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["app", "lib"];
const SHARED_STORE = "lib/admin/pending-mutation-store.ts";
const EXECUTOR_MODULE = "lib/admin/stable-mutation.ts";

/** 已迁到共享 store 的文件:必须仍 import 它,且不得再出现裸内存态幂等键。 */
const MIGRATED = [
  "lib/admin/d-client.ts",
  "lib/admin/user360-client.ts",
  "lib/admin/i-client.ts",
  "lib/admin/g4-invite-client.ts",
  "lib/admin/k6-client.ts",
  "lib/admin/stable-mutation.ts",
  "lib/admin/f1-stable-write.ts",
  "lib/admin/g1-client.ts",
  "lib/admin/g2-client.ts",
  "lib/admin/g3-client.ts",
  "lib/admin/g4-client.ts",
  "lib/admin/g7-client.ts",
  // H9:失败横幅向运营承诺「原样重试用的是同一个幂等键」,而旧实现每点一次保存都现铸一个新键
  //(模块级 `let commandSeq` 计数器,连刷新都撑不过)。承诺与实现必须同真同假 —— 这一行焊住实现侧。
  "lib/admin/h9-client.ts",
  "app/components/domain-views/c-tabs/c3-adjust.tsx",
  "app/components/domain-views/c-tabs/c5-security.tsx",
  "app/components/domain-views/c-tabs/c6-regrisk.tsx",
  "app/components/domain-views/d-tabs/d2-withdrawals.tsx",
  "app/components/domain-views/d-tabs/d3-treasury.tsx",
  "app/components/domain-views/f-view.tsx",
  "app/components/domain-views/i-tabs/i3-campaign.tsx",
  "app/components/domain-views/i-tabs/i4-trust.tsx",
  "app/components/domain-views/j-tabs/j3-tamper.tsx",
  "app/components/domain-views/k-tabs/k1-multiaccount.tsx",
  "app/components/domain-views/k-tabs/k2-arbitrage.tsx",
  "app/components/domain-views/k-tabs/k3-rules.tsx",
  "app/components/domain-views/k-tabs/k4-scoring.tsx",
  "app/components/domain-views/e-view.tsx",
  "app/components/domain-views/h-tabs/h8-referral-rewards.tsx",
  "app/components/domain-views/m-view.tsx",
  "app/_console/overview/funnel/page.tsx",
  "app/_console/overview/liquidity/page.tsx",
  "app/_console/overview/risk-radar/page.tsx",
  "app/_console/users/search/[id]/page.tsx",
];

/**
 * 存量台账。verdict:
 *   "debt"            —— 同族内存态幂等键,刷新即失效,待专项 sprint 迁到共享 store。
 *   "not-idempotency" —— 不是幂等键容器(派生索引 / 纯展示态),不需要持久化。
 * key = `<相对路径>#<标识符>`(**不写行号**:并发改动会漂移)。
 */
const KNOWN = {
  // ---- not-idempotency:不是命令号容器 ----
  "app/components/domain-views/m-view.tsx#pendingMCommandMetadata": { verdict: "not-idempotency", reason: "只缓存弹窗回显的动作名/理由文案,丢了不会重复入账" },
  "app/components/domain-views/m-view.tsx#pendingMCommandBaselines": { verdict: "not-idempotency", reason: "只缓存调参前基线用于 diff 展示,丢了只是少一段回显" },
  "app/components/domain-views/m-tabs/m5-scripts.tsx#pendingReplyTemplateDraftIds": { verdict: "not-idempotency", reason: "话术草稿的本地临时 id,非 Idempotency-Key,不入后端去重" },
  "lib/admin/registry/index.ts#BY_PATH": { verdict: "not-idempotency", reason: "registry 路由→模块的派生只读索引,进程内重建即可" },
  // ---- 2026-08-06 merge origin/main 带入(B 域看板读路径,与命令幂等无关)----
  "lib/admin/b-client.ts#cachedDashboards": { verdict: "not-idempotency", reason: "看板响应读缓存(stale-while-revalidate),丢了只是多发一次 GET,不承载重试/入账语义" },
  "lib/admin/b-client.ts#inflightDashboards": { verdict: "not-idempotency", reason: "在途 GET 去重(同 key 并发合流),不是写命令号容器" },
  "lib/admin/b-client.ts#dashboardSubscribers": { verdict: "not-idempotency", reason: "订阅者回调注册表,纯进程内派发,无持久化意义" },
};

/**
 * 解析出文件里**运行期真正可用**的 import 绑定名(来自指定模块)。
 *
 * 三条都必须成立才算数,少一条就是 2026-08-06 独立验收抓到的 P0 走私路径:
 *   1. **不是 `import type`** —— 类型导入运行时被擦除,调用点用的必然是别的东西。
 *   2. **没有被 `as` 改名** —— `{ createSlotAttemptStore as _unused }` 之后,调用点写的
 *      `createSlotAttemptStore` 完全可以是同文件里另一个本地桩。「导入过这个名字」与
 *      「调用点用的是这个绑定」之间必须有连线。
 *   3. **模块路径精确解析到目标文件** —— 子串判据会放行自造的
 *      `probe-pending-mutation-store.ts` / `fake/pending-mutation-store.ts`。
 */
function runtimeBindings(code, fromFile, targetRel) {
  const target = path.join(ROOT, targetRel).replace(/\.tsx?$/, "");
  const bindings = new Set();
  for (const match of code.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g)) {
    const [, typeOnly, clause, specifier] = match;
    if (typeOnly) continue;
    let resolved;
    if (specifier.startsWith("@/")) resolved = path.join(ROOT, specifier.slice(2));
    else if (specifier.startsWith(".")) resolved = path.resolve(path.dirname(fromFile), specifier);
    else continue; // 裸包名不可能是本仓模块
    if (resolved.replace(/\.tsx?$/, "") !== target) continue;
    for (const raw of clause.split(",")) {
      const part = raw.trim();
      if (!part || /^type\b/.test(part) || /\bas\b/.test(part)) continue;
      if (/^[A-Za-z_$][\w$]*$/.test(part)) bindings.add(part);
    }
  }
  return bindings;
}

/** 顶层逗号拆实参(括号 / 方括号 / 花括号内的逗号不算)。容尾逗号与折行 —— 二者都是合法排版。 */
function splitArgs(raw) {
  const args = [];
  let depth = 0;
  let current = "";
  for (const char of raw) {
    if ("([{".includes(char)) depth += 1;
    else if (")]}".includes(char)) depth -= 1;
    if (char === "," && depth === 0) { args.push(current.trim()); current = ""; continue; }
    current += char;
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

/**
 * 这个实参是不是非空字符串?字面量直接看;具名常量回本文件查它的定义。
 * (把 storageKey 抽成常量是日常重构,上一版的单条正则会把它误判成「没传 storageKey」。)
 */
function nonEmptyStringLiteral(arg, code) {
  if (!arg) return false;
  const literal = arg.match(/^["'`]([^"'`]*)["'`]$/);
  if (literal) return literal[1].length > 0;
  if (!/^[A-Za-z_$][\w$]*$/.test(arg)) return false;
  const declared = code.match(new RegExp(`(?:const|let)\\s+${arg.replace(/\$/g, "\\$")}\\s*(?::[^=]+)?=\\s*["'\`]([^"'\`]*)["'\`]`));
  return !!declared && declared[1].length > 0;
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".next", ".trash", ".claude", ".git"].includes(entry.name)) continue;
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** 命令号语义的标识符词表。只用于「容器形态本身不足以判定」的宽匹配上。 */
const COMMAND_IDENT = /pending|command|idempotenc|attempt|uncertain|fingerprint/i;

// 命中形态:标识符 + 可变命令状态容器。Map 形态刻意不按变量名过滤 —— 靠改名就能绕过的判据等于没有判据。
const PATTERNS = [
  { kind: "useRef-map", re: /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*useRef\s*(?:<[^=]*?>\s*)?\(\s*new\s+Map\b/g },
  { kind: "useRef-map-generic", re: /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*useRef\s*<\s*Map\b/g },
  { kind: "module-map", re: /^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*new\s+Map\b/gm },
  // 任意缩进(含闭包内)的 `const x = new Map`,再按名字筛出命令号语义的;
  // 注意名字判定不能要求前缀字符,`pendingKeys` 这种以关键词开头的曾被漏掉。
  { kind: "scoped-command-map", re: /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*new\s+Map\b/g, identMustMatch: COMMAND_IDENT },
  { kind: "state-fingerprint", re: /(?:const|let)\s*\[\s*([A-Za-z_$][\w$]*)[^\]]*\]\s*=\s*useState\s*<[^>]*fingerprint/g },
  // ↓ 2026-08-04 补:只认 `new Map` 是**判据自身的漏洞** —— 单槽位命令号根本不用 Map,
  //   `useRef<string|null>(null)` / `useRef<{fingerprint,key}|null>(null)` / `useRef<Record<string,string>>({})`
  //   这三种写法当时整片扫不到(B2 预测配置 / B3 保存视图 / B5 挤兑阈值 / C1 昵称重置 / J3 阈值与导出
  //   / K3 沙盒模拟全在盲区)。形态不足以判定语义,故按标识符词表收敛。
  { kind: "useRef-slot", re: /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*useRef\s*(?:<[^=]*?>\s*)?\(\s*null\s*\)/g, identMustMatch: COMMAND_IDENT },
  { kind: "useRef-record", re: /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*useRef\s*<\s*(?:Record|\{)[^=]*?>\s*\(\s*\{\s*\}\s*\)/g, identMustMatch: COMMAND_IDENT },
  { kind: "module-record", re: /^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*:\s*Record<[^=]*>\s*=\s*\{\s*\}/gm, identMustMatch: COMMAND_IDENT },
];

const files = SCAN_DIRS
  .map((dir) => path.join(ROOT, dir))
  .filter(fs.existsSync)
  .flatMap(walk);

const hits = new Map(); // key -> { file, ident, kinds:Set }
for (const file of files) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  // 扫描面同样剥注释:注释掉的 `const pendingFoo = new Map()` 不是运行时容器,
  // 却会逼台账为一段死代码常驻一行(判据 2 的反向噪声)。真容器不可能活在注释里。
  const src = stripComments(fs.readFileSync(file, "utf8"));
  for (const { kind, re, identMustMatch } of PATTERNS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(src)) !== null) {
      if (identMustMatch && !identMustMatch.test(match[1])) continue;
      const key = `${rel}#${match[1]}`;
      if (!hits.has(key)) hits.set(key, { file: rel, ident: match[1], kinds: new Set() });
      hits.get(key).kinds.add(kind);
    }
  }
}

const failures = [];

// 判据 0:扫描器自身没瞎(空集全过是哨兵最常见的假绿形态)。
if (files.length < 50) failures.push(`扫描文件数异常偏低(${files.length}),扫描器或目录结构可能已失效`);
if (hits.size === 0) failures.push("候选命中为 0:判据已失效(存量台账非空,不可能一个都扫不到)");

// 判据 0b:剥注释器自检。下面每一条结构判据都建立在它之上 —— 它一失效,注释走私就全线放行,
//   而门照样打印 PASS。探针刻意用 **CRLF**:按行 `split("\n").map(l => l.replace(/\/\/.*$/, ""))`
//   这种写法在 CRLF 文件上从来剥不掉行注释(`.` 不匹配 \r),本仓文件正是 CRLF,踩过。
{
  // 🔴 每种注释放**两处**(2026-08-06 独立验收 P1):只放一处时,「全局替换」和「只替换第一处」
  //   的行为完全一样 —— 两条正则各自丢掉 `g` 标志,自检照样绿,而真实文件里除第一处外的
  //   成百上千条注释原样留在 code 里 = 全线走私放行。第二处(带 2 后缀)就是为此存在的。
  // 探针名刻意**互不为子串**(headLine / tailLine,不是 x / x2)—— 用 includes 判定时
  // `x2` 里含着 `x`,两条分支会串味,红是红了却报错原因(本轮红测实测抓到)。
  const probe = 'const a = 1;\r\n// const headLineSmuggle = createSlotAttemptStore({ storageKey: "x" });\r\n'
    + 'const b = 2;\r\n// const tailLineSmuggle = createSlotAttemptStore({ storageKey: "x2" });\r\n'
    + 'const url = "https://nexion.example/pending-mutation-store";\r\n'
    + '/* const headBlockSmuggle = createPendingMutationStore({ storageKey: "y" }); */\r\n'
    + 'const c = 3;\r\n/* const tailBlockSmuggle = createPendingMutationStore({ storageKey: "y2" }); */\r\n';
  const stripped = stripComments(probe);
  if (stripped.includes("headLineSmuggle")) {
    failures.push("剥注释器对 CRLF 行注释失效 → 所有结构判据都可被「声明挪进注释」走私(须为 /gm 形式)");
  } else if (stripped.includes("tailLineSmuggle")) {
    failures.push("剥注释器只剥掉第一条行注释(行注释正则丢了 g 标志)→ 其余注释全部原样留在判定文本里");
  }
  if (stripped.includes("headBlockSmuggle")) {
    failures.push("剥注释器没剥块注释 → 结构判据可被 /* */ 走私");
  } else if (stripped.includes("tailBlockSmuggle")) {
    failures.push("剥注释器只剥掉第一段块注释(块注释正则丢了 g 标志)→ 其余块注释全部漏网");
  }
  if (!stripped.includes("https://nexion.example/pending-mutation-store")) {
    failures.push("剥注释器误伤 :// 协议串(丢了 (^|[^:]) 守卫)→ 正常代码被当注释吃掉,判据会误红");
  }
  // html 分支只有 uni-storage-key-sentinel 的 .vue 面用,那边没有自检 —— 摘掉它三门全绿,
  // 所以由本门代管(共享 lib 的每一半都得有人钉,2026-08-06 独立验收 P2)。
  if (stripComments("<!-- <template>x</template> -->keep", { html: true }).includes("<template>")) {
    failures.push("剥注释器的 html 分支失效 → uni-storage-key-sentinel 的 .vue 面判定可被 <!-- --> 走私");
  }
}

// 判据 1:未登记的命中一律红。
for (const [key, hit] of hits) {
  if (!KNOWN[key]) {
    failures.push(`未登记的内存态命令状态容器:${key}(形态 ${[...hit.kinds].join("+")})`
      + ` → 迁到 ${SHARED_STORE},或在 scripts/pending-idempotency-key-sentinel.mjs 的 KNOWN 里补一行并写明理由`);
  }
}

// 判据 2:台账里有、代码里没有 → 台账失真(改名/删除都必须同步台账)。
for (const key of Object.keys(KNOWN)) {
  if (!hits.has(key)) failures.push(`台账条目已在代码中消失:${key} → 若已迁移/删除,请同步删掉该台账行(并按需加入 MIGRATED)`);
}

// 判据 3:已迁移文件不得回退。两条合法路径:
//   直接 —— import 共享 store 并 create{PendingMutation,SlotAttempt}Store;
//   间接 —— 走 createStableMutationExecutor,但**必须传非空 storageKey**(不传就静默退回内存态)。
let storeIdents = 0; // 判据 3b 实际核过调用点的标识符数(0 = 判据失效,PASS 必打样本量)
for (const rel of MIGRATED) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) { failures.push(`MIGRATED 文件缺失:${rel}`); continue; }
  // 🔴 本块**全部**判据打在剥注释正文 `code` 上(2026-08-06 硬化;上一版只有 3b 剥了):
  //   `inlineMint( // was: h9Attempts.resolve(` —— 真实调用已回退成内联铸号、同行注释残留旧
  //   调用文本,不剥就假绿。同族走私还有「把 import / executor 调用整行挪进注释」。
  const code = stripComments(fs.readFileSync(full, "utf8"));
  // 🔴 判「绑定去向」,不判「名字出现过」(2026-08-06 独立验收 3×P0)。
  //   上一版只要求「花括号里出现过这个符号 + 路径含这段子串」,三条路全通,且 tsc 与迁移契约
  //   测试一并骗过:① `{ X as _unused }` + 同文件另写一个同名本地桩接管全部调用点;
  //   ② 路径指向自造的 `probe-pending-mutation-store.ts`(子串照样命中);③ `import type`
  //   运行时根本不存在绑定却被当真。下面改成解析出**真正可用的运行期绑定名**再判。
  const storeBindings = runtimeBindings(code, full, SHARED_STORE);
  const importsStore = ["createPendingMutationStore", "createSlotAttemptStore"].some((name) => storeBindings.has(name));
  const callsStore = [...storeBindings].some((name) =>
    new RegExp(`\\b${name}\\s*(?:<[^>]*>)?\\s*\\(`).test(code));
  const direct = importsStore && callsStore;

  // executor 间接路径:同样按真绑定判,且**不再发免检金牌**(原来命中即 continue,
  // 于是一个从不被调用的悬空 executor 常量就能让整个文件跳过后续全部判据 —— 与判据 3b
  // 「悬空 const 没人会去删」的立意直接矛盾)。现在逐个 executor 常量核储存键与调用点。
  const executorBindings = runtimeBindings(code, full, EXECUTOR_MODULE);
  const executorSites = executorBindings.has("createStableMutationExecutor")
    ? [...code.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*createStableMutationExecutor\s*\(([^)]*)\)/g)]
    : [];
  for (const [, ident, argsRaw] of executorSites) {
    storeIdents += 1;
    const storageArg = splitArgs(argsRaw)[1];
    if (!nonEmptyStringLiteral(storageArg, code)) {
      failures.push(`${rel} 的 ${ident} 调用 createStableMutationExecutor 时 storageKey 不是非空字符串`
        + `(实参:${storageArg ?? "缺失"})→ 命令号退回内存态,刷新即失效`);
    }
    if (!new RegExp(`\\b${ident.replace(/\$/g, "\\$")}\\s*\\(`).test(code)) {
      failures.push(`${rel} 的通用执行器 ${ident} 建了却从不调用 → 悬空 const 顶包,真实写路径已绕开幂等键`);
    }
  }
  const viaExecutor = executorSites.length > 0;

  if (!direct && !viaExecutor) {
    if (!importsStore) {
      failures.push(`${rel} 没有从共享 store(${SHARED_STORE})import create{PendingMutation,SlotAttempt}Store`
        + `(剥注释 + 解析真绑定后判定;别名 import / 同名本地桩 / import type / 同名文件都不算)`
        + ` → 幂等键回退成内存态,刷新即失效`);
    } else {
      failures.push(`${rel} 只 import 不调用 create{PendingMutation,SlotAttempt}Store → 等于没迁`);
    }
  }
  // 判据 3b(2026-08-05 补,P1「回退形态假绿」):逐标识符核**调用点**。
  //   槽位式(createSlotAttemptStore)契约 = resolve(取号/换号)+ forget(成功后收敛),二者缺一即红;
  //   命令号式(createPendingMutationStore)至少要有一次方法调用(纯悬空 const 即红)。
  // ponytail: resolve 出来的键是否真塞进了 Idempotency-Key 头,静态 regex 判不了 ——
  //           那半步靠 tests/pending-mutation-*.test.mjs 守 store 行为 + 评审;这里守「接线没被拆」。
  for (const match of code.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*createSlotAttemptStore\s*\(/g)) {
    const ident = match[1];
    const escaped = ident.replace(/\$/g, "\\$");
    storeIdents += 1;
    if (!new RegExp(`${escaped}\\.resolve\\s*\\(`).test(code)) {
      failures.push(`${rel} 的槽位存储 ${ident} 创建后没有任何 .resolve( 调用 → 命令号已回退成调用点现铸,悬空 const 掩护着假绿`);
    }
    if (!new RegExp(`${escaped}\\.forget\\s*\\(`).test(code)) {
      failures.push(`${rel} 的槽位存储 ${ident} 没有任何 .forget( 调用 → 命令成功后永不收敛,下次会复用已被后端消费的旧号`);
    }
  }
  for (const match of code.matchAll(/(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*createPendingMutationStore\s*(?:<[^>]*>)?\s*\(/g)) {
    const ident = match[1];
    const escaped = ident.replace(/\$/g, "\\$");
    storeIdents += 1;
    // 🔴 必须**取号**(get / list),不是「调过任意一个方法」(2026-08-06 第四轮验收 P1-E)。
    //   只要求「有方法调用」时,把所有 .get( 删光、只留 remember/forget,门照样绿 ——
    //   而没有取号就等于每次提交现铸新号,整套持久化被一行改动废掉,零红灯。
    if (!new RegExp(`${escaped}\\.(?:get|list)\\s*\\(`).test(code)) {
      failures.push(`${rel} 的命令号存储 ${ident} 没有任何 .get( / .list( 取号调用`
        + ` → 每次提交都现铸新号,持久化形同虚设(只写不读等于没迁)`);
    }
    if (!new RegExp(`${escaped}\\.(?:remember|forget)\\s*\\(`).test(code)) {
      failures.push(`${rel} 的命令号存储 ${ident} 既不 remember 也不 forget → 号永远不落库或永不收敛`);
    }
  }
}

// 判据 5:台账必须**盖住全部真实用店面**(2026-08-06 补,独立验收 P2「台账静默缩短」同族)。
//   判据 3 只保护「已登记的面」;一个文件迁了却没进 MIGRATED,就完全不受回归保护 ——
//   而少登记一条恰恰是最不起眼的退化方式(改名 / 新增面时忘了同步台账,没有任何门会响)。
//   ground truth 由扫描现场得出,不手抄第二份清单。
{
  const ledger = new Set(MIGRATED);
  const users = files
    .map((file) => path.relative(ROOT, file).split(path.sep).join("/"))
    .filter((rel) => rel !== SHARED_STORE && !ledger.has(rel))
    .filter((rel) => {
      const code = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
      const storeSide = runtimeBindings(code, path.join(ROOT, rel), SHARED_STORE);
      // 只认**建店**函数:模块还导出 clearPendingCommandRecords 之类的工具(auth-session 就只用它),
      // 那些文件自己不持有命令号,不该被要求进台账 —— 本轮红测实测抓到的误伤。
      return storeSide.has("createPendingMutationStore") || storeSide.has("createSlotAttemptStore")
        || runtimeBindings(code, path.join(ROOT, rel), EXECUTOR_MODULE).has("createStableMutationExecutor");
    });
  for (const rel of users) {
    failures.push(`${rel} 用了共享 store / 通用执行器却不在 MIGRATED 台账里 → 该面不受回归保护`
      + `,请在 scripts/pending-idempotency-key-sentinel.mjs 的 MIGRATED 里补一行`);
  }
}

// 判据 4:共享 store 必须真的落 sessionStorage 且带 TTL(防「迁了个空壳」)。
// 同样剥注释:store 头部注释里就写着 sessionStorage / TTL / 24h,读原文等于永远命中自己的文档。
const storeSrc = fs.existsSync(path.join(ROOT, SHARED_STORE))
  ? stripComments(fs.readFileSync(path.join(ROOT, SHARED_STORE), "utf8"))
  : "";
if (!storeSrc) failures.push(`共享 store 不存在:${SHARED_STORE}`);
else {
  // 🔴 必须钉**记录表**那次写入(带 storageKey),不能只看有没有 sessionStorage.setItem:
  //   模块里还有别的写入(身份归属标记),泛判据会被它顺带满足 —— 把记录写入整条删掉门也不红。
  //   2026-08-06 红测实测抓到:新增归属标记后 T5⑥ 当场从红变绿。
  if (!/sessionStorage\.setItem\(storageKey/.test(storeSrc)) {
    failures.push(`${SHARED_STORE} 没有按 storageKey 写 sessionStorage:命令号持久化是空壳`);
  }
  if (!/expiresAt\s*>\s*now/.test(storeSrc)) failures.push(`${SHARED_STORE} 缺少 TTL 过期判定:过期命令号会被无限复用`);
  // 槽位式尝试:输入指纹变了必须丢弃旧命令号。少了这步,运营改回原输入时会复用可能已被后端
  // 消费的号,把一次真实的新操作当成重复提交静默吞掉。
  if (!/export function createSlotAttemptStore/.test(storeSrc)) {
    failures.push(`${SHARED_STORE} 缺少 createSlotAttemptStore:槽位式调用方会各自复制一份比较逻辑`);
  }
  if (!/if \(saved\) store\.forget\(slot\)/.test(storeSrc)) {
    failures.push(`${SHARED_STORE} 的 createSlotAttemptStore 换指纹时没丢弃旧命令号:改回原输入会复用旧号被后端吞掉`);
  }
}

const debt = Object.values(KNOWN).filter((entry) => entry.verdict === "debt").length;
if (failures.length) {
  console.error("pending-idempotency-key sentinel FAIL");
  failures.forEach((line) => console.error(`  - ${line}`));
  process.exit(1);
}
if (storeIdents === 0) {
  console.error("pending-idempotency-key sentinel FAIL");
  console.error("  - 判据 3b 一个 store 标识符都没核到(MIGRATED 全走了别的形态?判据失效,不能当通过)");
  process.exit(1);
}
console.log(`pending-idempotency-key sentinel PASS `
  + `(扫描 ${files.length} 个文件 / 命中 ${hits.size} 处 / 台账 ${Object.keys(KNOWN).length} 条,其中待迁欠账 ${debt} 条 / `
  + `已迁 ${MIGRATED.length} 个文件,其中 ${storeIdents} 个 store 标识符逐个核过调用点)`);
