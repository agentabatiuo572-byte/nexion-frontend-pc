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
  "app/components/domain-views/c-tabs/c3-adjust.tsx",
];

/**
 * 存量台账。verdict:
 *   "debt"            —— 同族内存态幂等键,刷新即失效,待专项 sprint 迁到共享 store。
 *   "not-idempotency" —— 不是幂等键容器(派生索引 / 纯展示态),不需要持久化。
 * key = `<相对路径>#<标识符>`(**不写行号**:并发改动会漂移)。
 */
const KNOWN = {
  // ---- debt:同族存量,本轮未迁(不在 2 处点名缺陷范围;迁移需各自回归其域契约测试)----
  "lib/admin/i-client.ts#uncertainCommandKeys": { verdict: "debt", reason: "I 域结果未知命令号,模块级内存;刷新丢失同 P1,待 I 域专项迁移" },
  "lib/admin/k6-client.ts#pendingWriteKeys": { verdict: "debt", reason: "K6 远端写入命令号,模块级内存且被 export;迁移需同步改消费方,待 K6 专项" },
  "lib/admin/stable-mutation.ts#pendingKeys": { verdict: "debt", reason: "通用 stable-mutation 执行器的闭包内存表;迁移会改所有使用方的语义,待统一 sprint" },
  "app/components/domain-views/c-tabs/c5-security.tsx#pendingCommandKeys": { verdict: "debt", reason: "C5 安全动作命令号,组件 ref;同族待迁" },
  "app/components/domain-views/c-tabs/c6-regrisk.tsx#pendingCommandKeys": { verdict: "debt", reason: "C6 注册风控命令号,组件 ref;同族待迁" },
  "app/components/domain-views/d-tabs/d2-withdrawals.tsx#pendingKeys": { verdict: "debt", reason: "D2 提现处置命令号,组件 ref;涉钱,同族待迁(优先级最高)" },
  "app/components/domain-views/d-tabs/d3-treasury.tsx#pendingKeys": { verdict: "debt", reason: "D3 资金库命令号,组件 ref;涉钱,同族待迁" },
  "app/components/domain-views/i-tabs/i3-campaign.tsx#capCommandAttempts": { verdict: "debt", reason: "I3 档位上限调参命令号,组件 ref;同族待迁" },
  "app/components/domain-views/i-tabs/i4-trust.tsx#trustCommandAttempts": { verdict: "debt", reason: "I4 信任面调参命令号,组件 ref;同族待迁" },
  "app/components/domain-views/i-tabs/i4-trust.tsx#disclosureCommandAttempts": { verdict: "debt", reason: "I4 披露调参命令号,组件 ref;同族待迁" },
  "app/components/domain-views/k-tabs/k1-multiaccount.tsx#commandAttempt": { verdict: "debt", reason: "K1 多账号处置命令号,组件 ref;同族待迁" },
  "app/components/domain-views/k-tabs/k2-arbitrage.tsx#commandAttempt": { verdict: "debt", reason: "K2 套利处置命令号,组件 ref;同族待迁" },
  "app/components/domain-views/k-tabs/k3-rules.tsx#commandAttempt": { verdict: "debt", reason: "K3 规则调参命令号,组件 ref;同族待迁" },
  "app/components/domain-views/k-tabs/k4-scoring.tsx#commandAttempts": { verdict: "debt", reason: "K4 评分调参命令号,组件 ref;同族待迁" },
  "app/components/domain-views/k-tabs/k5-kyc.tsx#commandAttempts": { verdict: "debt", reason: "K5 KYC 审核命令号,组件 ref;同族待迁" },
  "app/components/domain-views/m-view.tsx#pendingIdempotencyKeys": { verdict: "debt", reason: "M 域命令号,组件 ref;同族待迁" },
  "app/components/domain-views/m-view.tsx#pendingMCommandAttempts": { verdict: "debt", reason: "M 域调参尝试(值+命令号),组件 ref;同族待迁" },
  "app/components/domain-views/m-view.tsx#pendingMDirectWriteKeys": { verdict: "debt", reason: "M 域直写命令号,组件 ref;同族待迁" },

  // ---- not-idempotency:不是命令号容器 ----
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

// 命中形态:标识符 + 可变 Map 容器。刻意不按变量名过滤 —— 靠改名就能绕过的判据等于没有判据。
const PATTERNS = [
  { kind: "useRef-map", re: /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*useRef\s*(?:<[^=]*?>\s*)?\(\s*new\s+Map\b/g },
  { kind: "useRef-map-generic", re: /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*useRef\s*<\s*Map\b/g },
  { kind: "module-map", re: /^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*new\s+Map\b/gm },
  // 任意缩进(含闭包内)的 `const x = new Map`,再按名字筛出命令号语义的;
  // 注意名字判定不能要求前缀字符,`pendingKeys` 这种以关键词开头的曾被漏掉。
  { kind: "scoped-command-map", re: /(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*new\s+Map\b/g, identMustMatch: /pending|command|idempotenc|attempt|uncertain|fingerprint/i },
  { kind: "state-fingerprint", re: /(?:const|let)\s*\[\s*([A-Za-z_$][\w$]*)[^\]]*\]\s*=\s*useState\s*<[^>]*fingerprint/g },
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

// 判据 3:已迁移文件不得回退。
for (const rel of MIGRATED) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) { failures.push(`MIGRATED 文件缺失:${rel}`); continue; }
  const src = fs.readFileSync(full, "utf8");
  if (!src.includes("pending-mutation-store")) {
    failures.push(`${rel} 未引用共享 store(${SHARED_STORE}) → 幂等键回退成内存态,刷新即失效`);
  }
  if (!/createPendingMutationStore\s*(?:<[^>]*>)?\s*\(/.test(src)) {
    failures.push(`${rel} 未调用 createPendingMutationStore → 只 import 不用等于没迁`);
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
}

const debt = Object.values(KNOWN).filter((entry) => entry.verdict === "debt").length;
if (failures.length) {
  console.error("pending-idempotency-key sentinel FAIL");
  failures.forEach((line) => console.error(`  - ${line}`));
  process.exit(1);
}
console.log(`pending-idempotency-key sentinel PASS `
  + `(扫描 ${files.length} 个文件 / 命中 ${hits.size} 处 / 台账 ${Object.keys(KNOWN).length} 条,其中待迁欠账 ${debt} 条 / 已迁 ${MIGRATED.length} 个文件)`);
