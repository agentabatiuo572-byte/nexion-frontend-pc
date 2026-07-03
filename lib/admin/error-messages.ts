const ADMIN_ERROR_MESSAGES: Record<string, string> = {
  ADMIN_CREDENTIAL_INVALID: "账号或密码不正确,请重新输入。",
  AUTH_REQUIRED: "登录已失效,请重新登录。",
  AUTH_TOKEN_INVALID: "登录凭证无效,请重新登录。",
  IDEMPOTENCY_KEY_REQUIRED: "缺少幂等请求标识,请刷新页面后重试。",
  REASON_REQUIRED: "请填写操作原因。",
  OPERATOR_REQUIRED: "缺少操作人信息,请重新登录后再试。",
  FORCE_LOGOUT_SELF_FORBIDDEN: "不能强制登出自己的当前账号。",
  FORCE_LOGOUT_ROLE_FORBIDDEN: "只有超管可以强制登出运营账号。",
  FORCE_LOGOUT_SUPER_TARGET_FORBIDDEN: "超管账号不能被强制登出。",
  VALIDATION_FAILED: "参数校验失败,请检查输入内容。",
  WORK_EMAIL_REQUIRED: "请使用 Nexion 工作邮箱(@nexion.ai 或 @nexion.io)。",
  ADMIN_EMAIL_EXISTS: "该工作邮箱已存在运营账号。",
  INVALID_STATE_TRANSITION: "当前状态不允许执行该操作,请刷新后查看最新状态。",
  COVERAGE_BELOW_REDLINE: "B1 兑付覆盖率低于红线,当前操作会放大资金流出或未来负债,后端已拒绝执行。",
  B1_COVERAGE_BELOW_REDLINE: "B1 兑付覆盖率低于红线,当前操作会放大资金流出或未来负债,后端已拒绝执行。",
  PHASE_PARAM_READONLY: "当前阶段参数只读,不能修改。",
  RETIRED_FEATURE: "该功能已下线,不能继续操作。",
  SUNSET_CAPABILITY_READONLY: "该能力已下线或只读,不能继续操作。",
  INTERNAL_ERROR: "服务器内部错误,请稍后重试。",
  USER_ID_REQUIRED: "请选择用户。",
  USER_CODE_REQUIRED: "请选择用户。",
  USER_NOT_FOUND: "没有找到对应用户,请重新选择。",
};

const MACHINE_CODE_RE = /^[A-Z][A-Z0-9_]+$/;

export function formatAdminApiError(message: string | null | undefined, fallback: string) {
  const raw = (message || fallback || "").trim();
  if (!raw) return "操作失败,请稍后重试。";

  const exact = ADMIN_ERROR_MESSAGES[raw];
  if (exact) return exact;

  for (const [code, translated] of Object.entries(ADMIN_ERROR_MESSAGES)) {
    if (raw.includes(code)) return translated;
  }

  if (MACHINE_CODE_RE.test(raw)) {
    return "操作失败,请检查输入内容或刷新页面后重试。";
  }

  return raw;
}
