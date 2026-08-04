#!/usr/bin/env node
/**
 * 强制改密闸门接线哨兵。
 *
 * 判据(枚举 + 白名单登记理由,台账写在本脚本里,不写进被查文件):
 *   1. app/api/**\/route.ts 从磁盘枚举(ground truth,不手写清单)。
 *   2. 每条路由要么接上 requirePasswordChangeCleared,要么在 EXEMPT 台账里带中文理由登记。
 *   3. 「接上」= 调用 + 返回值被 return 掉 + 调用位置在读 token 之前(声明 ≠ 消费 ≠ 生效)。
 *   4. 台账条目必须在磁盘上真实存在(禁止陈旧登记)。
 *   5. 台账条目不得同时接了 guard(台账与代码互相矛盾说明有一方是假的)。
 *   6. 发凭证的三条 auth 路由必须消费 sessionRequiresPasswordChange 且写受限 cookie,
 *      logout 必须清两个 cookie —— 防止「闸门接上了但全权 cookie 照发」。
 *   7. 拒绝理由必须在 error-messages.ts 里有中文可读文案。
 *
 * 新增一条业务代理路由却忘了接 guard → 第 2 条红。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const API_ROOT = join(ROOT, "app", "api");
const GUARD_MODULE = "lib/admin/require-password-change-cleared.ts";
const ERROR_MESSAGES = "lib/admin/error-messages.ts";

const GUARD_CALL = "requirePasswordChangeCleared(await cookies())";
const GUARD_RETURN = "if (passwordChangeBlocked) return passwordChangeBlocked;";
const TOKEN_READ = "ADMIN_TOKEN_COOKIE)?.value";

/**
 * 基数台账:接上闸门的路由数不得低于此基线。
 * 「遍历现存成员」的判据看不见被删掉的成员 —— 删路由导致基数下降时必须在这里同步下调并写明理由。
 * 2026-08-04 基线 23:app/api/admin 下除 auth 生命周期外的全部业务代理路由。
 */
const MIN_GUARDED_ROUTES = 23;

/**
 * 不接闸门的路由台账 —— 每条必须写清「为什么不需要」。
 * 只有认证生命周期本身和不吃后台 cookie 的路由才允许在这里。
 */
const EXEMPT = {
  "app/api/admin/auth/login/route.ts":
    "凭证签发入口:此刻还没有任何 cookie,闸门无从判起;它负责的是改密态只发受限 cookie(见第 6 条判据)。",
  "app/api/admin/auth/mfa/verify/route.ts":
    "凭证签发入口(二次验证分支),同 login:负责发受限 cookie 而不是被闸门拦。",
  "app/api/admin/auth/password/change/route.ts":
    "改密本身是受限态唯一出口,接闸门会把用户永久锁死;它反过来负责改密成功后换回全权 cookie。",
  "app/api/admin/auth/logout/route.ts":
    "登出是受限态的逃生阀,必须始终可达,并负责清掉两个 cookie。",
  "app/api/admin/auth/session/route.ts":
    "只读身份端点,且只认全权 cookie:改密态下全权 cookie 根本不存在,天然 401,前端据此回登录页。",
  "app/api/impersonation/view/route.ts":
    "不读后台 cookie,鉴权走调用方传入的模拟登录 Bearer(只读 H5 镜像),与后台改密态无关。",
};

const failures = [];
const fail = (message) => failures.push(message);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

if (!existsSync(API_ROOT)) {
  console.error("admin auth gate sentinel FAILED: app/api 不存在,判据无从执行。");
  process.exit(1);
}
if (!existsSync(join(ROOT, GUARD_MODULE))) {
  fail(`闸门模块缺失:${GUARD_MODULE}`);
} else {
  const guardSource = readFileSync(join(ROOT, GUARD_MODULE), "utf8");
  if (!/export function requirePasswordChangeCleared/.test(guardSource)) {
    fail(`${GUARD_MODULE} 未导出 requirePasswordChangeCleared`);
  }
  if (!guardSource.includes("nexion_admin_pwd_change_token")) {
    fail(`${GUARD_MODULE} 未定义受限 cookie 名`);
  }
}

const routes = walk(API_ROOT).map((abs) => relative(ROOT, abs).replace(/\\/g, "/"));
if (routes.length === 0) {
  console.error("admin auth gate sentinel FAILED: app/api 下枚举到 0 条路由,判据失效(空集全过)。");
  process.exit(1);
}

let guardedCount = 0;
for (const rel of routes) {
  const source = readFileSync(join(ROOT, rel), "utf8");
  const wired = source.includes(GUARD_CALL);
  const exemptReason = EXEMPT[rel];

  if (exemptReason) {
    if (wired) {
      fail(`${rel}:登记在豁免台账里却又接了闸门,台账与代码矛盾,请更新台账。`);
    }
    continue;
  }

  if (!wired) {
    fail(`${rel}:业务代理路由未接 requirePasswordChangeCleared —— 要么接上闸门,要么在 scripts/admin-auth-gate-sentinel.mjs 的 EXEMPT 台账里登记理由。`);
    continue;
  }
  if (!source.includes(GUARD_RETURN)) {
    fail(`${rel}:调用了闸门却没有 "${GUARD_RETURN}",判定结果被丢弃(声明 ≠ 消费)。`);
    continue;
  }
  const tokenAt = source.indexOf(TOKEN_READ);
  if (tokenAt >= 0 && source.indexOf(GUARD_CALL) > tokenAt) {
    fail(`${rel}:闸门接在了读取 token 之后,改密态仍会先拿到 401 而不是明确原因。`);
    continue;
  }
  guardedCount += 1;
}

for (const [rel, reason] of Object.entries(EXEMPT)) {
  if (!existsSync(join(ROOT, rel))) {
    fail(`豁免台账条目已陈旧(文件不存在):${rel}`);
  }
  if (!reason || reason.trim().length < 10) {
    fail(`豁免台账条目缺少可核查的中文理由:${rel}`);
  }
}

// 第 6 条:发凭证的路由必须真的按 passwordChangeRequired 分流,而不是照发全权 cookie。
const ISSUERS = [
  "app/api/admin/auth/login/route.ts",
  "app/api/admin/auth/mfa/verify/route.ts",
  "app/api/admin/auth/password/change/route.ts",
];
for (const rel of ISSUERS) {
  if (!existsSync(join(ROOT, rel))) {
    fail(`凭证签发路由缺失:${rel}`);
    continue;
  }
  const source = readFileSync(join(ROOT, rel), "utf8");
  if (!source.includes("sessionRequiresPasswordChange(parsed.data.session)")) {
    fail(`${rel}:未消费 sessionRequiresPasswordChange,改密态会照发 8 小时全权 cookie。`);
  }
  // 只查「引用了符号」会假绿(2026-08-04 红测 R4 实测放行),必须查全权 cookie 的值真的是条件化的。
  if (!source.includes('ADMIN_TOKEN_COOKIE, passwordChangeRequired ? "" : accessToken')) {
    fail(`${rel}:全权 cookie 不是按 passwordChangeRequired 条件下发,改密态仍会拿到 8 小时全权凭证。`);
  }
  if (!source.includes('ADMIN_PASSWORD_CHANGE_COOKIE, passwordChangeRequired ? accessToken : ""')) {
    fail(`${rel}:受限 cookie 不是按 passwordChangeRequired 条件下发,改密态没有可用凭证或正常态残留标签。`);
  }
}

const LOGOUT = "app/api/admin/auth/logout/route.ts";
if (existsSync(join(ROOT, LOGOUT))) {
  const logoutSource = readFileSync(join(ROOT, LOGOUT), "utf8");
  // 同上:查到「文件里出现过这个常量」不算数(红测 R5 实测放行),必须查到真的把它清空了。
  if (!/ADMIN_PASSWORD_CHANGE_COOKIE,\s*""/.test(logoutSource) || !/maxAge: 0/.test(logoutSource)) {
    fail(`${LOGOUT}:登出没有清受限 cookie,改密态用户会被残留标签长期锁住。`);
  }
  if (!logoutSource.includes("readAdminAccessToken(await cookies())")) {
    fail(`${LOGOUT}:登出只认全权 cookie,改密态用户无法吊销服务端会话。`);
  }
} else {
  fail(`登出路由缺失:${LOGOUT}`);
}

// 第 7 条:拒绝理由必须是运营可读中文,不能只有机器码。
if (!existsSync(join(ROOT, ERROR_MESSAGES))) {
  fail(`文案单源缺失:${ERROR_MESSAGES}`);
} else {
  const messages = readFileSync(join(ROOT, ERROR_MESSAGES), "utf8");
  const line = messages.split(/\r?\n/).find((text) => text.includes("ADMIN_PASSWORD_CHANGE_REQUIRED:"));
  if (!line) {
    fail(`${ERROR_MESSAGES} 未登记 ADMIN_PASSWORD_CHANGE_REQUIRED 的中文文案。`);
  } else if (!line.includes("请先完成密码修改")) {
    fail(`${ERROR_MESSAGES} 的 ADMIN_PASSWORD_CHANGE_REQUIRED 文案没有说明原因(缺「请先完成密码修改」)。`);
  } else if (!line.includes("重新登录")) {
    fail(`${ERROR_MESSAGES} 的 ADMIN_PASSWORD_CHANGE_REQUIRED 文案没有给出下一步入口。`);
  }
}

if (guardedCount < MIN_GUARDED_ROUTES) {
  fail(`已接闸门的路由只有 ${guardedCount} 条,低于基线 ${MIN_GUARDED_ROUTES} —— 若确有路由下线,请在本脚本 MIN_GUARDED_ROUTES 处写明理由后同步下调。`);
}

if (failures.length) {
  console.error(`admin auth gate sentinel FAILED(路由 ${routes.length} 条,已接闸门 ${guardedCount} 条,豁免 ${Object.keys(EXEMPT).length} 条):`);
  for (const message of failures) console.error(`- ${message}`);
  process.exit(1);
}

console.log(
  `admin auth gate sentinel passed. 枚举路由=${routes.length},已接闸门=${guardedCount},登记豁免=${Object.keys(EXEMPT).length},签发路由分流=${ISSUERS.length}。`,
);
