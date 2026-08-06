import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createPendingMutationStore,
  createSlotAttemptStore,
  PENDING_MUTATION_TTL_MS,
} from "../lib/admin/pending-mutation-store.ts";

const dClient = readFileSync(new URL("../lib/admin/d-client.ts", import.meta.url), "utf8");
const user360 = readFileSync(new URL("../lib/admin/user360-client.ts", import.meta.url), "utf8");
const c3 = readFileSync(new URL("../app/components/domain-views/c-tabs/c3-adjust.tsx", import.meta.url), "utf8");

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
    sessionStorage,
    raw: (key) => JSON.parse(sessionStorage.getItem(key) ?? "null"),
    seed: (key, value) => sessionStorage.setItem(key, JSON.stringify(value)),
  };
}

const storageKeyOf = (source, file) => {
  const match = source.match(/storageKey:\s*"([^"]+)"/);
  assert.ok(match, `${file} 必须显式声明 storageKey`);
  return match[1];
};

// ---------------------------------------------------------------- ① 刷新后仍认得同一次提交

test("① 命令号写入后刷新页面仍被认出:重复提交复用同一 Idempotency-Key", () => {
  const env = installStorage();
  const fingerprint = "submit|{\"id\":1001,\"amount\":\"120\"}";

  const beforeRefresh = createPendingMutationStore({ storageKey: "t-refresh" });
  assert.equal(beforeRefresh.get(fingerprint), undefined, "首次提交不应有旧命令号");
  beforeRefresh.remember(fingerprint, "c3-adjust-K1");

  // 刷新:新实例 = 内存 Map 清零,只剩 sessionStorage。
  const afterRefresh = createPendingMutationStore({ storageKey: "t-refresh" });
  assert.equal(afterRefresh.get(fingerprint), "c3-adjust-K1", "刷新后必须复用同一命令号,否则重复入账");

  // 负控:换一个 storageKey(等于没持久化)时必须取不到 —— 证明上面那条不是内存 Map 蒙的。
  assert.equal(createPendingMutationStore({ storageKey: "t-other" }).get(fingerprint), undefined);

  // 命令收敛后不再拦截。
  afterRefresh.forget(fingerprint);
  assert.equal(createPendingMutationStore({ storageKey: "t-refresh" }).get(fingerprint), undefined);
  assert.equal(env.sessionStorage.getItem("t-refresh"), null, "清空后应删键,不留空对象");
});

// ---------------------------------------------------------------- ② TTL

test("② TTL 过期后不再拦截,并把过期记录清出存储", () => {
  const env = installStorage();
  const now = Date.now();
  env.seed("t-ttl", {
    "expired-key": { fingerprint: "fp-old", commandKey: "expired-key", createdAt: now - 2 * PENDING_MUTATION_TTL_MS, expiresAt: now - 1000 },
    "live-key": { fingerprint: "fp-new", commandKey: "live-key", createdAt: now, expiresAt: now + 60_000 },
  });

  const store = createPendingMutationStore({ storageKey: "t-ttl" });
  assert.equal(store.get("fp-old"), undefined, "过期命令号不得再被复用");
  assert.equal(store.get("fp-new"), "live-key");
  assert.deepEqual(Object.keys(env.raw("t-ttl")), ["live-key"], "过期项应被读取时剪掉");

  assert.equal(PENDING_MUTATION_TTL_MS, 24 * 60 * 60 * 1000, "24h 幂等窗口是后台既定口径");
  const fresh = createPendingMutationStore({ storageKey: "t-ttl2" });
  fresh.remember("fp", "K");
  const record = env.raw("t-ttl2").K;
  assert.ok(record.expiresAt - record.createdAt >= PENDING_MUTATION_TTL_MS - 50, "新记录必须带满 TTL");

  // 续期不改 createdAt(重试不会把窗口从头算,也不会丢首次时间)。
  fresh.remember("fp", "K");
  assert.equal(env.raw("t-ttl2").K.createdAt, record.createdAt);
});

test("② TTL 是从首次尝试起的硬上限,重复 remember 不得滑动续期", () => {
  const env = installStorage();
  const now = Date.now();
  // 播一条「已经躺了 23 小时」的在途记录:再重试一次,过期时刻必须仍钉在首次 +24h,
  // 而不是被推到「现在 +24h」。滑动续期会让客户端记录活过后端那个固定 24h 窗口,
  // 窗外复用同一个号后端早已不认,却给了操作员「这次会被去重」的虚假信心。
  const createdAt = now - 23 * 60 * 60 * 1000;
  env.seed("t-ttl-cap", {
    K: { fingerprint: "fp", commandKey: "K", createdAt, expiresAt: createdAt + PENDING_MUTATION_TTL_MS },
  });

  const store = createPendingMutationStore({ storageKey: "t-ttl-cap" });
  store.remember("fp", "K");
  const after = env.raw("t-ttl-cap").K;
  assert.equal(after.createdAt, createdAt, "首次时间不得被重试覆盖");
  assert.equal(after.expiresAt, createdAt + PENDING_MUTATION_TTL_MS,
    "重试必须沿用首次起算的过期时刻;滑动续期会让记录活过后端固定 24h 幂等窗");
  assert.ok(after.expiresAt < now + PENDING_MUTATION_TTL_MS,
    "过期时刻必须仍早于「现在 +24h」—— 相等即说明窗口被从头重算了");
});

// ---------------------------------------------------------------- ②b 存储不可用时的降级兜底

/** 隐私模式 / 配额满:sessionStorage 存在但读写都抛。 */
function installBrokenStorage() {
  const calls = { warn: 0 };
  globalThis.window = {
    sessionStorage: {
      getItem() { throw new DOMException("SecurityError"); },
      setItem() { throw new DOMException("QuotaExceededError"); },
      removeItem() { throw new DOMException("SecurityError"); },
    },
  };
  const original = console.warn;
  console.warn = () => { calls.warn += 1; };
  return { calls, restore: () => { console.warn = original; } };
}

test("②b 存储被禁时命令号仍在本页内存里活着:同槽同输入重试不得铸新号", () => {
  const env = installBrokenStorage();
  try {
    let minted = 0;
    const mint = () => `k-${++minted}`;
    const store = createSlotAttemptStore({ storageKey: "t-broken" });

    const first = store.resolve("override:U-1", "score=80", mint);
    assert.equal(
      store.resolve("override:U-1", "score=80", mint), first,
      "隐私模式下同一会话连续重试仍必须复用同号 —— 每次铸新号 = 防重复整体失效(后端收到两条命令)",
    );
    // 语义不能因降级而走样:换输入照样换号、收敛后照样铸新。
    assert.notEqual(store.resolve("override:U-1", "score=90", mint), first);
    store.forget("override:U-1");
    assert.notEqual(store.resolve("override:U-1", "score=80", mint), first);

    assert.equal(env.calls.warn, 1, "降级必须告警,且只喊一次(每次读写都喊会把 console 淹掉)");
  } finally {
    env.restore();
  }
});

test("②b 降级兜底不掩盖 TTL:内存里的过期记录同样不得复用", () => {
  const env = installBrokenStorage();
  try {
    const store = createPendingMutationStore({ storageKey: "t-broken-ttl", ttlMs: 1 });
    store.remember("fp", "K-old");
    const expired = Date.now() + 5;
    while (Date.now() < expired) { /* 等 1ms TTL 走完(不引入定时器依赖) */ }
    assert.equal(store.get("fp"), undefined, "内存兜底不是免死金牌,过期照样失效");
  } finally {
    env.restore();
  }
});

// ---------------------------------------------------------------- ③ 不撞 key

test("③ user360 五类动作的 fingerprint 都编码了动作类型与目标 id", () => {
  assert.match(
    user360,
    /const mutationFingerprint = init\?\.idempotencyPrefix && method !== "GET"\s*\?\s*`\$\{method\}\|\$\{path\}\|\$\{typeof init\.body === "string" \? init\.body : ""\}`/,
    "fingerprint 必须由 method + path + body 组成:少了 path/body 就会跨动作、跨用户撞 key",
  );

  // ground truth 取自磁盘上真实的调用点,不手写清单。
  const sites = [];
  for (let idx = user360.indexOf('idempotencyPrefix: "'); idx !== -1; idx = user360.indexOf('idempotencyPrefix: "', idx + 1)) {
    const start = user360.lastIndexOf("usersRequest", idx);
    const chunk = user360.slice(start, user360.indexOf("\n", idx));
    const prefix = chunk.match(/idempotencyPrefix: "([^"]+)"/)[1];
    const pathArg = chunk.slice(chunk.indexOf("(") + 1, chunk.indexOf(", {"));
    const body = (chunk.match(/body: JSON\.stringify\(\{([^}]*)\}\)/) ?? [, ""])[1];
    sites.push({ prefix, pathArg, body });
  }
  assert.equal(sites.length, 5, "user360 已知 5 个 idempotencyPrefix 调用点;数量变了必须逐个重核 fingerprint 是否带目标 id");

  const prefixes = new Set(sites.map((site) => site.prefix));
  assert.equal(prefixes.size, 5, "动作前缀不得重复");
  const paths = new Set(sites.map((site) => site.pathArg.replace(/\s+/g, "")));
  assert.equal(paths.size, 5, "五类动作的 path 必须互不相同 —— path 是 fingerprint 里区分动作类型的唯一位");

  for (const site of sites) {
    const targetInPath = /\$\{/.test(site.pathArg);
    const targetInBody = /\buserId\b/.test(site.body);
    assert.ok(
      targetInPath || targetInBody,
      `${site.prefix} 的 fingerprint 没有编码目标 id(path=${site.pathArg} body=${site.body}) → 不同用户会撞 key,把别人的操作误判成重复提交`,
    );
  }
});

test("③ 不同用户 / 不同动作 / 不同命名空间各自独立,不互相顶掉", () => {
  installStorage();
  const fingerprint = (method, path, body) => `${method}|${path}|${body}`;
  const store = createPendingMutationStore({ storageKey: storageKeyOf(user360, "user360-client.ts") });

  const cases = [
    ["PATCH", "/profiles/1001/status", '{"status":"FROZEN"}', "k-status-1001"],
    ["PATCH", "/profiles/1002/status", '{"status":"FROZEN"}', "k-status-1002"],
    ["POST", "/profiles/1001/impersonations", '{"ttlMinutes":15}', "k-imp-start-1001"],
    ["POST", "/impersonations/S-9/terminate", '{"reason":"done"}', "k-imp-end-S9"],
    ["POST", "/account-lists", '{"userId":1001,"kind":"BLOCK"}', "k-list-add-1001"],
    ["POST", "/account-lists", '{"userId":1002,"kind":"BLOCK"}', "k-list-add-1002"],
    ["POST", "/account-lists/1001/remove", '{"reason":"ok"}', "k-list-del-1001"],
  ];
  cases.forEach(([method, path, body, key]) => store.remember(fingerprint(method, path, body), key));

  const reloaded = createPendingMutationStore({ storageKey: storageKeyOf(user360, "user360-client.ts") });
  cases.forEach(([method, path, body, key]) => {
    assert.equal(reloaded.get(fingerprint(method, path, body)), key, `${key} 被别的动作顶掉了`);
  });

  // 收敛一条不影响其余(旧实现共用一把全局 key,删一次会把所有在途都清掉)。
  reloaded.forget(fingerprint("PATCH", "/profiles/1001/status", '{"status":"FROZEN"}'));
  assert.equal(reloaded.get(fingerprint("PATCH", "/profiles/1002/status", '{"status":"FROZEN"}')), "k-status-1002");
  assert.equal(reloaded.get(fingerprint("POST", "/account-lists", '{"userId":1001,"kind":"BLOCK"}')), "k-list-add-1001");
});

test("③ c3 三把命令号共用一张表但命名空间隔离", () => {
  installStorage();
  const key = storageKeyOf(c3, "c3-adjust.tsx");
  assert.equal((c3.match(/storageKey:\s*"/g) ?? []).length, 1, "三类命令共用一个 storageKey,不再各建一张表");
  for (const helper of ["submitFingerprint", "reviewFingerprint", "reverseFingerprint"]) {
    assert.ok(c3.includes(helper), `${helper} 命名空间缺失`);
  }
  assert.match(c3, /`submit\|/);
  assert.match(c3, /`review\|\$\{approved \? "approve" : "reject"\}/);
  assert.match(c3, /`reverse\|/);

  // 同一单号 + 同一理由,三个动作必须各自持有命令号。
  const store = createPendingMutationStore({ storageKey: key });
  const same = "ADJ-1|理由都一样都一样";
  store.remember(`review|approve|${same}`, "k-approve");
  store.remember(`review|reject|${same}`, "k-reject");
  store.remember(`reverse|${same}`, "k-reverse");
  const reloaded = createPendingMutationStore({ storageKey: key });
  assert.equal(reloaded.get(`review|approve|${same}`), "k-approve");
  assert.equal(reloaded.get(`review|reject|${same}`), "k-reject");
  assert.equal(reloaded.get(`reverse|${same}`), "k-reverse");
});

// ---------------------------------------------------------------- ④ d-client 负控:行为不变

test("④ d-client 迁移后对外行为不变:存储键 / 记录结构 / 校验 / 重试入口", () => {
  const env = installStorage();
  const storageKey = storageKeyOf(dClient, "d-client.ts");
  assert.equal(storageKey, "nexgrid-admin-d1-uncertain-commands-v1", "改存储键会让在途命令号在刷新后失联");

  const store = createPendingMutationStore({
    storageKey,
    isValidRecord: (value) =>
      ["finance", "treasury", "bills", "withdraw"].includes(value.base)
      && typeof value.path === "string" && value.path.startsWith("/")
      && typeof value.method === "string" && value.method !== "GET"
      && typeof value.body === "string",
  });
  store.remember("POST|finance|/topup/confirm|{}", "d1-topup-1", {
    base: "finance", path: "/topup/confirm", method: "POST", body: "{}",
  });
  assert.deepEqual(
    Object.keys(env.raw(storageKey)["d1-topup-1"]),
    ["fingerprint", "commandKey", "base", "path", "method", "body", "createdAt", "expiresAt"],
    "记录字段与迁移前逐字段同名同序",
  );

  const now = Date.now();
  env.seed(storageKey, {
    ok: { fingerprint: "f1", commandKey: "ok", base: "finance", path: "/topup/x", method: "POST", body: "{}", createdAt: now, expiresAt: now + 60_000 },
    badBase: { fingerprint: "f2", commandKey: "badBase", base: "nope", path: "/topup/x", method: "POST", body: "{}", createdAt: now, expiresAt: now + 60_000 },
    badPath: { fingerprint: "f3", commandKey: "badPath", base: "finance", path: "topup/x", method: "POST", body: "{}", createdAt: now, expiresAt: now + 60_000 },
    badMethod: { fingerprint: "f4", commandKey: "badMethod", base: "finance", path: "/topup/x", method: "GET", body: "{}", createdAt: now, expiresAt: now + 60_000 },
    keyMismatch: { fingerprint: "f5", commandKey: "other", base: "finance", path: "/topup/x", method: "POST", body: "{}", createdAt: now, expiresAt: now + 60_000 },
  });
  const reloaded = createPendingMutationStore({
    storageKey,
    isValidRecord: (value) =>
      ["finance", "treasury", "bills", "withdraw"].includes(value.base)
      && typeof value.path === "string" && value.path.startsWith("/")
      && typeof value.method === "string" && value.method !== "GET"
      && typeof value.body === "string",
  });
  assert.deepEqual(reloaded.list().map((value) => value.commandKey), ["ok"], "非法记录必须全部被剔除");
  assert.equal(reloaded.get("f2"), undefined);

  // 源码面:d-client 不再自己维护内存表,且保留「确定性失败不吞旧命令号」的语义。
  assert.doesNotMatch(dClient, /const pendingMutationKeys = new Map/);
  assert.doesNotMatch(dClient, /function (?:read|write)PersistedPendingMutations/);
  assert.match(dClient, /createPendingMutationStore<PersistedPendingMutation>/);
  assert.match(dClient, /pendingMutations\.get\(mutationFingerprint\)/);
  assert.match(dClient, /pendingMutations\.remember\(mutationFingerprint, commandKey, \{/);
  assert.match(dClient, /if \(mutationFingerprint && !pendingKeyBeforeRequest\) \{\s*pendingMutations\.forget\(mutationFingerprint\);/);
  assert.match(dClient, /listD1PendingTopupCommands[\s\S]*pendingMutations\.list\(\)/);
  assert.match(dClient, /retryD1PendingTopupCommand[\s\S]*pendingMutations\.list\(\)\.find\(\(value\) => value\.commandKey === commandKey\)/);
});

test("④ user360 / c3 不再持有内存态命令号,且三处存储键互不冲突", () => {
  assert.doesNotMatch(user360, /const pendingUserMutationKeys = new Map/);
  assert.doesNotMatch(user360, /pendingUserMutationKeys\./);
  assert.match(user360, /pendingUserMutations\.remember\(mutationFingerprint, commandKey\)/);
  assert.match(user360, /if \(mutationFingerprint && !pendingKeyBeforeRequest\) pendingUserMutations\.forget\(mutationFingerprint\)/);
  assert.match(user360, /if \(mutationFingerprint\) pendingUserMutations\.forget\(mutationFingerprint\)/);

  assert.doesNotMatch(c3, /useRef\(new Map/);
  assert.doesNotMatch(c3, /useState<\{ fingerprint/);
  assert.doesNotMatch(c3, /reviewCommandKeys|reverseCommandKeys|setSubmission/);
  assert.match(c3, /c3Commands\.get\(fingerprint\)/);
  assert.match(c3, /c3Commands\.forget\(fingerprint\)/);

  const keys = [dClient, user360, c3].map((source, index) => storageKeyOf(source, `source#${index}`));
  assert.equal(new Set(keys).size, 3, "三处必须各用各的存储键,否则不同域的命令号会互相覆盖");
});
