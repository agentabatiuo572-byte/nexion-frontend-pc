/**
 * 强制改密未完成时的统一闸门(BFF 层)。
 *
 * 后端把「首次登录/重置后必须改密」表达为 session.passwordChangeRequired。本文件让 BFF 做两件事:
 *  1. 签发端(login / mfa verify / password change):该标志为真时**不下发全权 cookie**,只把 accessToken
 *     写进受限 cookie(nexion_admin_pwd_change_token),它唯一用途是调改密接口与登出。
 *  2. 消费端(全部业务代理路由):读 token 之前先过 requirePasswordChangeCleared(),发现受限 cookie
 *     就整体拒绝,并回中文可读原因 + 下一步入口(文案见 error-messages.ts 里的同名 code)。
 *
 * 🔴 边界声明(2026-08-04 核实):cookie 里只有不透明 accessToken,BFF 解不出 session 内容,所以这层
 * 只能做到「不主动下发全权凭证 + 认标签即拒」,不是密码学意义上的强制力——拿到 token 的人仍可绕过 BFF
 * 直接打后端。真正的闸门必须由后端在每个高敏接口上独立校验 passwordChangeRequired。**后端源码不在本
 * 工作区,是否已实现未经核实,不得假设已做。**
 *
 * 接线由 scripts/admin-auth-gate-sentinel.mjs 机器门看着:新增业务代理路由忘接 guard 会红。
 */

export const ADMIN_TOKEN_COOKIE = "nexion_admin_token";
export const ADMIN_PASSWORD_CHANGE_COOKIE = "nexion_admin_pwd_change_token";
/** 用户可见文案在 lib/admin/error-messages.ts 单源维护,此处只出 code。 */
export const ADMIN_PASSWORD_CHANGE_REQUIRED_CODE = "ADMIN_PASSWORD_CHANGE_REQUIRED";

interface ReadableCookieJar {
  get(name: string): { value: string } | undefined;
}

/**
 * 业务代理路由的统一闸门:改密未完成返回 403 + 原因,否则返回 null 放行(正常路径行为不变)。
 * 直接传 next/headers 的 cookies() 结果即可;做成纯同步函数是为了能在 node:test 里跑真实判定。
 */
export function requirePasswordChangeCleared(jar: ReadableCookieJar): Response | null {
  if (!jar.get(ADMIN_PASSWORD_CHANGE_COOKIE)?.value) return null;
  return Response.json(
    { code: 403, message: ADMIN_PASSWORD_CHANGE_REQUIRED_CODE, data: null },
    { status: 403, headers: { "Cache-Control": "no-store" } },
  );
}

/** 改密流程自身(password/change、logout)取 token 的口径:受限 cookie 优先,其次全权 cookie。 */
export function readAdminAccessToken(jar: ReadableCookieJar): string {
  return jar.get(ADMIN_PASSWORD_CHANGE_COOKIE)?.value || jar.get(ADMIN_TOKEN_COOKIE)?.value || "";
}

/**
 * 从后端返回的 session 判定是否仍需改密。
 * 取不到字段按 false(与 lib/admin/auth-client.ts 的 Boolean() 口径一致,老后端不带该字段时登录行为不变);
 * 任何真值都按「需改密」处理,即偏保守一侧。
 */
export function sessionRequiresPasswordChange(session: unknown): boolean {
  if (!session || typeof session !== "object") return false;
  return Boolean((session as { passwordChangeRequired?: unknown }).passwordChangeRequired);
}
