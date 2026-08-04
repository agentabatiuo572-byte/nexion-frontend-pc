import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createPendingMutationStore,
  createSlotAttemptStore,
  PENDING_MUTATION_TTL_MS,
} from "../lib/admin/pending-mutation-store.ts";

/**
 * 2026-08-04 存量清仓:18 处内存态幂等键 + 同族 9 处哨兵盲区,全部迁到共享持久化 store。
 * 原缺陷:命令号只活在组件 useRef / 模块级 Map,刷新页面即清零;运营在「结果未知」后重试会铸
 * 新命令号,后端无法去重 → 重复入账 / 重复处置。
 *
 * 本文件验三件事(逐条对应验收要求):
 *   ① 刷新后复用同一命令号   ② TTL 过期不再拦   ③ 不同目标 / 不同动作不撞 key
 * 另加 ④ 槽位换指纹必须丢弃旧命令号(迁移引入的新风险,不是原代码就有的)。
 */

/** 极简 sessionStorage 替身:刷新 = 换 store 实例(内存清零)但保留本对象。 */
function installStorage() {
  const cells = new Map();
  const sessionStorage = {
    getItem: (key) => (cells.has(key) ? cells.get(key) : null),
    setItem: (key, value) => { cells.set(key, String(value)); },
    removeItem: (key) => { cells.delete(key); },
  };
  globalThis.window = { sessionStorage };
  return {
    raw: (key) => JSON.parse(sessionStorage.getItem(key) ?? "null"),
    seed: (key, value) => sessionStorage.setItem(key, JSON.stringify(value)),
  };
}

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

/** 本轮迁移的全部文件。ground truth 取哨兵台账,不在这里手抄第二份清单。 */
const SENTINEL = read("scripts/pending-idempotency-key-sentinel.mjs");
const MIGRATED = [...SENTINEL.matchAll(/^\s{2}"([^"]+\.tsx?)",$/gm)].map((match) => match[1]);

// ---------------------------------------------------------------- ① 刷新后仍认得同一次提交

test("① 槽位命令号写入后刷新页面仍被认出:同一输入重试复用同一 Idempotency-Key", () => {
  installStorage();
  const mint = (() => { let n = 0; return () => `k4-override-${++n}`; })();

  const before = createSlotAttemptStore({ storageKey: "t-slot-refresh" });
  const first = before.resolve("override:U-1001", "score=80|理由都一样都一样", mint);
  assert.equal(first, "k4-override-1", "首次提交应铸新命令号");

  // 刷新:新实例 = 内存 Map 清零,只剩 sessionStorage。
  const after = createSlotAttemptStore({ storageKey: "t-slot-refresh" });
  assert.equal(
    after.resolve("override:U-1001", "score=80|理由都一样都一样", mint),
    "k4-override-1",
    "刷新后必须复用同一命令号,否则后端去重不了 → 重复处置",
  );

  // 负控:换一个 storageKey(等于没持久化)时必须取不到 —— 证明上面那条不是内存 Map 蒙的。
  assert.equal(
    createSlotAttemptStore({ storageKey: "t-slot-other" }).resolve("override:U-1001", "score=80|理由都一样都一样", mint),
    "k4-override-2",
  );

  // 命令收敛后不再拦截,刷新也不会复活。
  after.forget("override:U-1001");
  assert.equal(
    createSlotAttemptStore({ storageKey: "t-slot-refresh" }).resolve("override:U-1001", "score=80|理由都一样都一样", mint),
    "k4-override-3",
  );
});

// ---------------------------------------------------------------- ② TTL

test("② 槽位命令号过期后不再复用,过期记录被清出存储", () => {
  const env = installStorage();
  const now = Date.now();
  env.seed("t-slot-ttl", {
    "expired-key": {
      fingerprint: "override:U-1001", commandKey: "expired-key", inputFingerprint: "score=80",
      createdAt: now - 2 * PENDING_MUTATION_TTL_MS, expiresAt: now - 1000,
    },
    "live-key": {
      fingerprint: "override:U-1002", commandKey: "live-key", inputFingerprint: "score=90",
      createdAt: now, expiresAt: now + 60_000,
    },
  });

  const store = createSlotAttemptStore({ storageKey: "t-slot-ttl" });
  assert.equal(store.resolve("override:U-1002", "score=90", () => "fresh"), "live-key", "未过期的仍复用");
  assert.equal(
    store.resolve("override:U-1001", "score=80", () => "fresh-after-expiry"),
    "fresh-after-expiry",
    "过期命令号不得再被复用:24h 外后端幂等窗口已关,复用只会被当成新命令或直接报错",
  );
  assert.ok(!Object.keys(env.raw("t-slot-ttl")).includes("expired-key"), "过期项应被读取时剪掉");
});

test("② 结构非法的记录被剔除:缺 inputFingerprint 的记录不得被当成有效尝试", () => {
  const env = installStorage();
  const now = Date.now();
  env.seed("t-slot-shape", {
    "no-input-fp": {
      fingerprint: "override:U-1001", commandKey: "no-input-fp",
      createdAt: now, expiresAt: now + 60_000,
    },
  });
  assert.equal(
    createSlotAttemptStore({ storageKey: "t-slot-shape" }).resolve("override:U-1001", "score=80", () => "fresh"),
    "fresh",
  );
});

// ---------------------------------------------------------------- ③ 不同目标 / 不同动作不撞 key

test("③ 不同目标对象、不同动作类型各自持有命令号,互不顶掉", () => {
  installStorage();
  const store = createSlotAttemptStore({ storageKey: "t-slot-collide" });
  // 同一批动作打到不同用户 / 同一用户的不同动作 —— 撞 key 就会把别人的操作当重复提交吞掉。
  const cases = [
    ["override:U-1001", "score=80", "k-override-1001"],
    ["override:U-1002", "score=80", "k-override-1002"],
    ["recompute:U-1001", "score=80", "k-recompute-1001"],
    ["decision:T-9", "approve:v3", "k-decision-T9"],
    ["decision:T-10", "approve:v3", "k-decision-T10"],
  ];
  cases.forEach(([slot, input, key]) => store.resolve(slot, input, () => key));

  const reloaded = createSlotAttemptStore({ storageKey: "t-slot-collide" });
  cases.forEach(([slot, input, key]) => {
    assert.equal(reloaded.resolve(slot, input, () => "MINTED-NEW"), key, `${key} 被别的目标/动作顶掉了`);
  });

  // 收敛一条不影响其余。
  reloaded.forget("override:U-1001");
  assert.equal(reloaded.resolve("override:U-1002", "score=80", () => "MINTED-NEW"), "k-override-1002");
  assert.equal(reloaded.resolve("recompute:U-1001", "score=80", () => "MINTED-NEW"), "k-recompute-1001");
});

test("③ 每个域各用各的 storageKey:两个域共用一把键会互相覆盖在途命令号", () => {
  const keys = MIGRATED.flatMap((rel) => {
    const source = read(rel);
    return [
      ...[...source.matchAll(/storageKey:\s*"([^"]+)"/g)].map((m) => m[1]),
    ];
  });
  assert.ok(keys.length >= 20, `迁移文件里只找到 ${keys.length} 个 storageKey,清单或断言已失真`);
  const duplicated = keys.filter((key, index) => keys.indexOf(key) !== index);
  assert.deepEqual(duplicated, [], `storageKey 重复:${duplicated.join(", ")}`);
});

// ---------------------------------------------------------------- ④ 换指纹必须丢弃旧命令号

test("④ 同槽位换了输入就换新命令号,且旧命令号被丢弃(改回原值不得复活旧号)", () => {
  const env = installStorage();
  const store = createSlotAttemptStore({ storageKey: "t-slot-replace" });

  const original = store.resolve("cap|low", "cap=100", () => "i3-cap-A");
  const changed = store.resolve("cap|low", "cap=200", () => "i3-cap-B");
  assert.notEqual(changed, original, "输入变了必须铸新命令号,否则后端按旧号去重,新值被静默吞掉");
  assert.deepEqual(Object.keys(env.raw("t-slot-replace")), ["i3-cap-B"], "旧命令号必须被丢弃,不留到 TTL 到期");

  // 关键回归:改回原值也必须是新号 —— 旧号可能已被后端消费,复用会让这次真实操作被当成重复提交。
  const backToOriginal = store.resolve("cap|low", "cap=100", () => "i3-cap-C");
  assert.equal(backToOriginal, "i3-cap-C");
  assert.notEqual(backToOriginal, original);
});

// ---------------------------------------------------------------- 迁移面:不许回退成内存态

test("迁移清单里的文件都真的用了共享 store", () => {
  assert.ok(MIGRATED.length >= 22, `哨兵 MIGRATED 清单只解析出 ${MIGRATED.length} 条,解析已失真`);
  for (const rel of MIGRATED) {
    assert.match(read(rel), /create(?:PendingMutation|SlotAttempt)Store/, `${rel} 没用共享 store`);
  }
});

/**
 * 「有没有漏网的内存态命令表」这一问必须交给哨兵:只有它有标识符词表 + 双向台账,分得清
 * `pendingMCommandBaselines`(纯回显缓存,刻意不持久化)和真命令号表。在这里手搓一个粗版判据
 * 只会把合法的内存缓存判红。这里只焊「哨兵必须还挂在 verify 上」,防判据被静默摘掉。
 */
test("内存态幂等键哨兵仍挂在 verify 齿轮表上", () => {
  const verify = read("scripts/verify.mjs");
  assert.match(verify, /scripts\/pending-idempotency-key-sentinel\.mjs/);
  assert.match(verify, /tests\/pending-mutation-store-contract\.test\.mjs/);
  assert.match(verify, /tests\/pending-mutation-migration-contract\.test\.mjs/);
});

/**
 * 指纹取证:命令号一旦跨刷新存活,指纹**必须**编码动作类型 + 目标对象 id。
 * 少了目标 id → 切到下一个用户 / 下一张卡时复用上一个目标的号,后端把这次操作当重复提交吞掉;
 * 少了动作类型 → 同一目标上的两个动作互相顶掉。
 */
test("涉钱与用户面的指纹都编码了「动作类型 + 目标对象 id」", () => {
  const d2 = read("app/components/domain-views/d-tabs/d2-withdrawals.tsx");
  assert.match(d2, /const reviewScope = \(withdrawalNo: string, action: D2ReviewAction\) =>\s*`review\|\$\{withdrawalNo\}\|\$\{action\}`/);
  assert.match(d2, /const batchScope = \(action: D2BatchAction, ids: string\[\]\) =>\s*`batch\|\$\{action\}\|\$\{\[\.\.\.ids\]\.sort\(\)\.join\(","\)\}`/);

  const d3 = read("app/components/domain-views/d-tabs/d3-treasury.tsx");
  // D3 目标对象 = 到账凭证号(后端唯一去重位)。
  assert.match(d3, /const injectionScope = \(voucherNo: string, amount: string\) => `injection\|\$\{voucherNo\}\|\$\{amount\}`/);

  const c1 = read("app/_console/users/search/[id]/page.tsx");
  assert.match(c1, /const nicknameSlot = \(userId: string \| number\) => `nickname-reset\|\$\{userId\}`/);
  assert.match(c1, /const paymentSlot = \(action: "unbind" \| "rebind", userId: string \| number, methodId: number\) =>/);
  assert.match(c1, /`payment-\$\{action\}\|\$\{userId\}\|\$\{methodId\}`/);

  // B5 阈值/订阅迁移前没有输入指纹(内存态下无所谓)。持久化后必须补,否则改了阈值仍复用旧号。
  const b5 = read("app/_console/overview/risk-radar/page.tsx");
  assert.match(b5, /b5Commands\.resolve\(\s*THRESHOLD_SLOT,\s*JSON\.stringify\(\[yellowPct, redPct, data\.bankrun\.version, reason\.trim\(\)\]\)/);
  assert.match(b5, /b5Commands\.resolve\(\s*SUBSCRIPTION_SLOT,\s*JSON\.stringify\(\[subscription, subscriptionVersion\]\)/);
  assert.match(b5, /const triageSlot = `triage\|\$\{dimension\}`/);
});
