/**
 * 强制改密闸门契约测试。
 *
 * 覆盖:①改密态登录不发全权 cookie ②改密态访问业务代理被拒且给出中文原因
 *       ③正常态登录与访问行为不变 ④哨兵能抓到「新增业务代理路由未接 guard」。
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  ADMIN_PASSWORD_CHANGE_COOKIE,
  ADMIN_PASSWORD_CHANGE_REQUIRED_CODE,
  ADMIN_TOKEN_COOKIE,
  readAdminAccessToken,
  requirePasswordChangeCleared,
  sessionRequiresPasswordChange,
} from "../lib/admin/require-password-change-cleared.ts";
import { formatAdminApiError } from "../lib/admin/error-messages.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

/** 最小 cookie jar 替身:形状与 next/headers 的 cookies() 一致。 */
function jar(entries) {
  return { get: (name) => (name in entries ? { value: entries[name] } : undefined) };
}

const GUARDED_ROUTES = [
  "app/api/admin/finance/[...path]/route.ts",
  "app/api/admin/withdraw/[[...path]]/route.ts",
  "app/api/admin/emergency/[...path]/route.ts",
  "app/api/admin/platform/[...path]/route.ts",
  "app/api/admin/treasury/[...path]/route.ts",
  "app/api/admin/risk/[...path]/route.ts",
  "app/api/admin/users/[...path]/route.ts",
];

// ① 改密态登录:不下发全权 cookie
test("改密态登录只种受限 cookie，全权 cookie 被显式清空", () => {
  assert.equal(sessionRequiresPasswordChange({ passwordChangeRequired: true }), true);
  assert.equal(sessionRequiresPasswordChange({ passwordChangeRequired: "yes" }), true);
  assert.equal(sessionRequiresPasswordChange({ passwordChangeRequired: false }), false);
  assert.equal(sessionRequiresPasswordChange({}), false, "老后端不带该字段时不得改变登录行为");
  assert.equal(sessionRequiresPasswordChange(null), false);
  assert.equal(sessionRequiresPasswordChange("whatever"), false);

  for (const rel of [
    "app/api/admin/auth/login/route.ts",
    "app/api/admin/auth/mfa/verify/route.ts",
    "app/api/admin/auth/password/change/route.ts",
  ]) {
    const source = read(rel);
    assert.match(source, /sessionRequiresPasswordChange\(parsed\.data\.session\)/, `${rel} 必须按后端标志分流`);
    assert.match(
      source,
      /ADMIN_TOKEN_COOKIE,\s*passwordChangeRequired \? "" : accessToken/,
      `${rel} 改密态不得下发全权 cookie`,
    );
    assert.match(
      source,
      /maxAge: passwordChangeRequired \? 0 : ADMIN_TOKEN_MAX_AGE_SECONDS/,
      `${rel} 改密态全权 cookie 必须立即过期`,
    );
    assert.match(
      source,
      /ADMIN_PASSWORD_CHANGE_COOKIE,\s*passwordChangeRequired \? accessToken : ""/,
      `${rel} 改密态必须种受限 cookie，正常态必须清掉它`,
    );
  }
});

// ② 改密态访问业务代理:被拒 + 明确中文原因 + 下一步入口
test("改密态访问业务代理被 403 拒绝，并给出中文原因和下一步入口", async () => {
  const blocked = requirePasswordChangeCleared(jar({ [ADMIN_PASSWORD_CHANGE_COOKIE]: "pending-token" }));
  assert.ok(blocked instanceof Response, "改密态必须返回拒绝响应");
  assert.equal(blocked.status, 403, "必须是明确的 403，不是静默 401");
  assert.equal(blocked.headers.get("Cache-Control"), "no-store");
  const body = await blocked.json();
  assert.equal(body.code, 403);
  assert.equal(body.message, ADMIN_PASSWORD_CHANGE_REQUIRED_CODE);
  assert.equal(body.data, null);

  const readable = formatAdminApiError(ADMIN_PASSWORD_CHANGE_REQUIRED_CODE, "");
  assert.ok(readable.includes("请先完成密码修改"), `拒绝原因必须运营可读，实际:${readable}`);
  assert.ok(readable.includes("重新登录"), "必须给出下一步入口");
  assert.ok(!/^[A-Z][A-Z0-9_]+$/.test(readable), "不得把机器码直接甩给用户");
});

test("受限 cookie 同时存在时也拒绝：拷贝到全权 cookie 名下不能绕过闸门", () => {
  const both = jar({ [ADMIN_TOKEN_COOKIE]: "full", [ADMIN_PASSWORD_CHANGE_COOKIE]: "pending" });
  assert.ok(requirePasswordChangeCleared(both) instanceof Response);
});

// ③ 正常态:行为不变
test("正常态放行，闸门返回 null 且不改变原有 401 口径", () => {
  assert.equal(requirePasswordChangeCleared(jar({})), null, "未登录仍走各路由原有 401");
  assert.equal(requirePasswordChangeCleared(jar({ [ADMIN_TOKEN_COOKIE]: "full" })), null, "正常登录态必须原样放行");
  assert.equal(requirePasswordChangeCleared(jar({ [ADMIN_PASSWORD_CHANGE_COOKIE]: "" })), null, "空值标签不算改密态");

  for (const rel of GUARDED_ROUTES) {
    const source = read(rel);
    assert.match(source, /const token = \(await cookies\(\)\)\.get\(ADMIN_TOKEN_COOKIE\)\?\.value;/, `${rel} 原取 token 口径不得改动`);
    assert.match(source, /ADMIN_AUTH_REQUIRED/, `${rel} 原 401 口径不得改动`);
    const guardAt = source.indexOf("requirePasswordChangeCleared(await cookies())");
    const tokenAt = source.indexOf("ADMIN_TOKEN_COOKIE)?.value");
    assert.ok(guardAt >= 0, `${rel} 必须接闸门`);
    assert.ok(guardAt < tokenAt, `${rel} 闸门必须在读 token 之前`);
  }
});

test("改密与登出在受限态仍可达：受限 cookie 优先，全权 cookie 兜底", () => {
  assert.equal(readAdminAccessToken(jar({ [ADMIN_PASSWORD_CHANGE_COOKIE]: "pending" })), "pending");
  assert.equal(readAdminAccessToken(jar({ [ADMIN_TOKEN_COOKIE]: "full" })), "full");
  assert.equal(readAdminAccessToken(jar({ [ADMIN_TOKEN_COOKIE]: "full", [ADMIN_PASSWORD_CHANGE_COOKIE]: "pending" })), "pending");
  assert.equal(readAdminAccessToken(jar({})), "");

  for (const rel of ["app/api/admin/auth/password/change/route.ts", "app/api/admin/auth/logout/route.ts"]) {
    assert.match(read(rel), /readAdminAccessToken\(await cookies\(\)\)/, `${rel} 受限态必须仍可用`);
  }
  assert.match(read("app/api/admin/auth/logout/route.ts"), /ADMIN_PASSWORD_CHANGE_COOKIE, ""/, "登出必须清掉受限 cookie");
});

// ④ 哨兵能抓到「新增业务代理路由未接 guard」
test("哨兵基线通过，且新增未接闸门的路由会被抓红", () => {
  const sentinel = ["scripts/admin-auth-gate-sentinel.mjs"];
  const baseline = spawnSync(process.execPath, sentinel, { cwd: ROOT, encoding: "utf8" });
  assert.equal(baseline.status, 0, `哨兵基线应通过:${baseline.stdout}${baseline.stderr}`);
  assert.match(baseline.stdout, /枚举路由=\d+,已接闸门=\d+/, "PASS 行必须打样本量");

  const probeDir = join(ROOT, "app", "api", "admin", "__gate_probe__");
  const probeFile = join(probeDir, "route.ts");
  try {
    mkdirSync(probeDir, { recursive: true });
    writeFileSync(
      probeFile,
      'import { cookies } from "next/headers";\n'
        + 'const ADMIN_TOKEN_COOKIE = "nexion_admin_token";\n'
        + "export async function GET() {\n"
        + "  const token = (await cookies()).get(ADMIN_TOKEN_COOKIE)?.value;\n"
        + '  return Response.json({ code: token ? 0 : 401, message: "probe", data: null });\n'
        + "}\n",
      "utf8",
    );
    const injected = spawnSync(process.execPath, sentinel, { cwd: ROOT, encoding: "utf8" });
    assert.notEqual(injected.status, 0, "新增未接闸门的路由必须被哨兵抓红");
    assert.match(injected.stderr, /__gate_probe__/, "哨兵必须点名具体是哪条路由");
  } finally {
    if (existsSync(probeDir)) rmSync(probeDir, { recursive: true, force: true });
  }
  assert.equal(existsSync(probeDir), false, "探针必须清理干净");

  const after = spawnSync(process.execPath, sentinel, { cwd: ROOT, encoding: "utf8" });
  assert.equal(after.status, 0, "清理后哨兵必须复绿");
});
