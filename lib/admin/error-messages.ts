const ADMIN_ERROR_MESSAGES: Record<string, string> = {
  ADMIN_CREDENTIAL_INVALID: "账号或密码不正确,请重新输入。",
  AUTH_REQUIRED: "登录已失效,请重新登录。",
  AUTH_TOKEN_INVALID: "登录凭证无效,请重新登录。",
  IDEMPOTENCY_KEY_REQUIRED: "缺少幂等请求标识,请刷新页面后重试。",
  IDEMPOTENCY_KEY_INVALID: "幂等请求标识过长,请刷新页面后重试。",
  REASON_REQUIRED: "请填写操作原因。",
  OPERATOR_REQUIRED: "缺少操作人信息,请重新登录后再试。",
  FORCE_LOGOUT_SELF_FORBIDDEN: "不能强制登出自己的当前账号。",
  FORCE_LOGOUT_ROLE_FORBIDDEN: "只有超管可以强制登出运营账号。",
  FORCE_LOGOUT_SUPER_TARGET_FORBIDDEN: "超管账号不能被强制登出。",
  VALIDATION_FAILED: "参数校验失败,请检查输入内容。",
  EMAIL_FORMAT_INVALID: "请输入有效邮箱格式。",
  WORK_EMAIL_REQUIRED: "请输入有效邮箱格式。",
  ADMIN_EMAIL_EXISTS: "该工作邮箱已存在运营账号。",
  USERNAME_REQUIRED: "请填写登录名。",
  USERNAME_INVALID: "登录名只能使用 3-32 位小写字母、数字、点、下划线或短横线。",
  ADMIN_USERNAME_EXISTS: "该登录名已存在运营账号。",
  INITIAL_PASSWORD_REQUIRED: "请填写初始密码。",
  INITIAL_PASSWORD_WEAK: "初始密码至少 8 位。",
  ADMIN_PASSWORD_REQUIRED: "请填写当前密码和新密码。",
  ADMIN_PASSWORD_CURRENT_INVALID: "当前密码不正确。",
  ADMIN_PASSWORD_WEAK: "新密码至少 8 位。",
  ADMIN_PASSWORD_REUSED: "新密码不能与当前密码相同。",
  ACCOUNT_PROFILE_UPDATE_FORBIDDEN: "只有超管可以编辑运营账号资料。",
  ACCOUNT_DELETE_FORBIDDEN: "只有超管可以删除运营账号。",
  ACCOUNT_DELETE_SELF_FORBIDDEN: "不能删除自己的当前账号。",
  ACCOUNT_NOT_FOUND: "账号不存在或已删除,请刷新后重试。",
  DISPLAY_NAME_REQUIRED: "请填写显示名。",
  INVALID_STATE_TRANSITION: "当前状态不允许执行该操作,请刷新后查看最新状态。",
  COPY_VERSION_DELETE_FORBIDDEN: "已发布或已归档版本属于审计历史,不能删除。",
  COPY_DRAFT_VERSION_CONFLICT: "该草稿已变化或不再是当前草稿,请刷新后重试。",
  COPY_DRAFT_REVISION_REQUIRED: "缺少草稿修订标识,请刷新后重试。",
  COPY_DRAFT_REVISION_CONFLICT: "草稿内容已被其他人更新,请刷新确认最新内容后再操作。",
  COPY_DRAFT_USED_BY_EXPERIMENT: "该草稿已被实验引用,为保证实验可复盘不能删除。",
  COVERAGE_BELOW_REDLINE: "B1 兑付覆盖率低于红线,当前操作会放大资金流出或未来负债,后端已拒绝执行。",
  B1_COVERAGE_BELOW_REDLINE: "B1 兑付覆盖率低于红线,当前操作会放大资金流出或未来负债,后端已拒绝执行。",
  PHASE_PARAM_READONLY: "当前阶段参数只读,不能修改。",
  RETIRED_FEATURE: "该功能已下线,不能继续操作。",
  SUNSET_CAPABILITY_READONLY: "该能力已下线或只读,不能继续操作。",
  INTERNAL_ERROR: "服务器内部错误,请稍后重试。",
  USER_ID_REQUIRED: "请选择用户。",
  USER_CODE_REQUIRED: "请选择用户。",
  USER_NOT_FOUND: "没有找到对应用户,请重新选择。",
  // E6 算力与设备配置校验(后端 OpsDeviceService.validateComputeValue)
  COMPUTE_URL_INVALID: "客户端下载地址必须以 https:// 开头且不超过 300 字符。",
  COMPUTE_FLAG_INVALID: "入口开关值无效(仅支持开启 / 关闭)。",
  COMPUTE_COEFF_INVALID: "系数值无效:H5 基础托管系数取 0–1、连续在线满额时长须 >0。",
  COMPUTE_YIELD_INVALID: "收益估算值必须为大于 0 的数字。",
  COMPUTE_TOPS_INVALID: "显卡 TOPS 必须为大于 0 的数字。",
  COMPUTE_LABEL_INVALID: "档位名称不能为空且不超过 24 字符。",
  COMPUTE_KEYWORD_INVALID: "单个识别词不超过 48 字符。",
  COMPUTE_DOWNLOAD_TEXT_INVALID: "下载页文案不超过 320 字符。",
  // F 域配置校验(后端 OpsTeamService.validateUiConfig / validateAnomalyThreshold)
  F_TEAM_TOGGLE_INVALID: "开关值无效,仅支持 on / off。",
  F_TEAM_NUMBER_INVALID: "请输入有效的数字值。",
  F_TEAM_DEPTH_OUT_OF_RANGE: "Unilevel 层级深度须为 1-10 之间的整数。",
  F_ANOMALY_THRESHOLD_SCHEMA_INVALID: "异常预警阈值格式无效,须为含 frozen / anomaly 两个非负数字的 JSON。",
  // F 域批1c 高风险配置校验(后端 OpsTeamService.validateUiConfig / validatePeriodPrize / validatePartnerTiers / validateVrankTitles)
  F_TEAM_PCT_OUT_OF_RANGE: "百分比值无效,须为 0-100 之间的数字。",
  F_PERIOD_PRIZE_SCHEMA_INVALID: "4 周期榜单奖池格式无效,须为含 today/week/month/allTime 四个非负数字的 JSON。",
  F_PARTNER_TIERS_SCHEMA_INVALID: "Partner 4 档门槛格式无效,须为含 bronze/silver/gold/diamond 四个非负数字的 JSON。",
  F_PARTNER_TIERS_NOT_ASCENDING: "Partner 4 档门槛须非递减(bronze ≤ silver ≤ gold ≤ diamond)。",
  F_VRANK_TITLES_SCHEMA_INVALID: "V-Rank 头衔格式无效,须为含 V0-V12 共 13 阶非空文本的 JSON。",
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
