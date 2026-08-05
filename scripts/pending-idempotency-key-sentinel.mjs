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
 *   3. MIGRATED 文件必须仍然引用共享 store,且不得回退成裸内存态。**含调用点**:
 *      「文件里有 create 调用」不等于「命令号真的从 store 走」——最可能的回退形态是
 *      保留 `const x = createSlotAttemptStore(...)` 悬空(没人会去删一个 const),把真实
 *      调用点换回内联铸号,或删掉成功路径上的 x.forget(槽位永不收敛,复用已被后端
 *      消费的旧号)。本仓无 ESLint、tsc 未开 noUnusedLocals,悬空 const 别的门全看不见。
 *
 * 台账写在本脚本(不写在被查文件里),每条必须写理由。新增命中 = 要么迁到共享 store,
 * 要么在 KNOWN 里补一行并说清为什么不需要持久化。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCAN_DIRS = ["app", "lib"];
const SHARED_STORE = "lib/admin/pending-mutation-store.ts";

/** 已迁到共享 store 的文件:必须仍 import 它,且不得再出现裸内存态幂等键。 */
const MIGRATED = [
  "lib/admin/d-client.ts",
  "lib/admin/user360-client.ts",
  "lib/admin/i-client.ts",
  "lib/admin/k6-client.ts",
  "lib/admin/stable-mutation.ts",
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
  "app/components/domain-views/i-tabs/i3-campaign.tsx",
  "app/components/domain-views/i-tabs/i4-trust.tsx",
  "app/components/domain-views/j-tabs/j3-tamper.tsx",
  "app/components/domain-views/k-tabs/k1-multiaccount.tsx",
  "app/components/domain-views/k-tabs/k2-arbitrage.tsx",
  "app/components/domain-views/k-tabs/k3-rules.tsx",
  "app/components/domain-views/k-tabs/k4-scoring.tsx",
  "app/components/domain-views/k-tabs/k5-kyc.tsx",
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
  "app/components/domain-views/k-tabs/k5-kyc.tsx#pendingManualTicket": { verdict: "not-idempotency", reason: "只暂存刚建的人工工单号用于弹窗回显,不进 Idempotency-Key,丢了不会重复入账" },
  "app/components/domain-views/m-view.tsx#pendingMCommandMetadata": { verdict: "not-idempotency", reason: "只缓存弹窗回显的动作名/理由文案,丢了不会重复入账" },
  "app/components/domain-views/m-view.tsx#pendingMCommandBaselines": { verdict: "not-idempotency", reason: "只缓存调参前基线用于 diff 展示,丢了只是少一段回显" },
  "app/components/domain-views/m-tabs/m5-scripts.tsx#pendingReplyTemplateDraftIds": { verdict: "not-idempotency", reason: "话术草稿的本地临时 id,非 Idempotency-Key,不入后端去重" },
  "lib/admin/registry/index.ts#BY_PATH": { verdict: "not-idempotency", reason: "registry 路由→模块的派生只读索引,进程内重建即可" },
};

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
  const src = fs.readFileSync(file, "utf8");
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
  const src = fs.readFileSync(full, "utf8");
  // 🔴 判据 3b 打在**剥注释后**的正文(2026-08-06 独立证伪 T1b):
  //   `inlineMint( // was: h9Attempts.resolve(` —— 真实调用已回退成内联铸号,
  //   同行注释残留旧调用文本,不剥就假绿。「子串哨兵必剥注释」是本仓已固化纪律,
  //   同轮的 parity 门剥了、这里漏了。剥法与 h9-public-stats-parity.mjs 同款(护 :// 协议)。
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const direct = src.includes("pending-mutation-store")
    && /create(?:PendingMutation|SlotAttempt)Store\s*(?:<[^>]*>)?\s*\(/.test(code);
  const viaExecutor = /createStableMutationExecutor\s*\(/.test(src);
  if (viaExecutor && !direct) {
    if (!/createStableMutationExecutor\s*\([^,)]+,\s*"[^"]+"\s*\)/.test(src)) {
      failures.push(`${rel} 调用 createStableMutationExecutor 时没传非空 storageKey → 命令号退回内存态,刷新即失效`);
    }
    continue;
  }
  if (!src.includes("pending-mutation-store")) {
    failures.push(`${rel} 未引用共享 store(${SHARED_STORE}) → 幂等键回退成内存态,刷新即失效`);
  }
  if (!/create(?:PendingMutation|SlotAttempt)Store\s*(?:<[^>]*>)?\s*\(/.test(src)) {
    failures.push(`${rel} 未调用 createPendingMutationStore / createSlotAttemptStore → 只 import 不用等于没迁`);
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
    if (!new RegExp(`${escaped}\\.[A-Za-z_$][\\w$]*\\s*\\(`).test(code)) {
      failures.push(`${rel} 的命令号存储 ${ident} 创建后没有任何方法调用 → 悬空 const,幂等键已从别的路子铸(只建不用等于没迁)`);
    }
  }
}

// 判据 4:共享 store 必须真的落 sessionStorage 且带 TTL(防「迁了个空壳」)。
const storeSrc = fs.existsSync(path.join(ROOT, SHARED_STORE))
  ? fs.readFileSync(path.join(ROOT, SHARED_STORE), "utf8")
  : "";
if (!storeSrc) failures.push(`共享 store 不存在:${SHARED_STORE}`);
else {
  if (!/sessionStorage\.setItem/.test(storeSrc)) failures.push(`${SHARED_STORE} 没有写 sessionStorage:持久化是空壳`);
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
