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
 *   3. MIGRATED 三个文件必须仍然引用共享 store,且不得回退成裸内存态。
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
for (const rel of MIGRATED) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) { failures.push(`MIGRATED 文件缺失:${rel}`); continue; }
  const src = fs.readFileSync(full, "utf8");
  const direct = src.includes("pending-mutation-store")
    && /create(?:PendingMutation|SlotAttempt)Store\s*(?:<[^>]*>)?\s*\(/.test(src);
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
console.log(`pending-idempotency-key sentinel PASS `
  + `(扫描 ${files.length} 个文件 / 命中 ${hits.size} 处 / 台账 ${Object.keys(KNOWN).length} 条,其中待迁欠账 ${debt} 条 / 已迁 ${MIGRATED.length} 个文件)`);
