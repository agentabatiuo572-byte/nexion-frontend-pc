/**
 * K6 接管执行账本模型(2026-08-07 裁决① · 红队视角)。
 *
 * 🔴 要解决的核心混淆:**「命令下发成功」不等于「设备执行成功」**。
 *   旧模型只有一个 6 值 `commandState`,于是「已下发到队列」「设备已收到」「页面加载中」
 *   「账户态交接到一半」全部塌成 PUBLISHED,运营下发后无法回答:到设备了吗?卡在哪?
 *   为什么失败?能不能重试?——止血动作变成了盲发。
 *
 * 🔴 第二个更危险的空白:**期望目标与设备实际打开的目标没有对账**。
 *   接管是把设备导向一个批准过的目标;如果实际目标与期望不符(下行被改、目标被替换、
 *   设备用了缓存的旧目标),现状下后台看到的仍然是「已确认」。本模型把两者并列存放,
 *   `takeoverTargetMismatch()` 判定不一致——这条不靠人工比对字符串发现。
 *
 * 本文件只定义**后台可观测面**的类型与纯函数;设备端协议与 C2 下行链路属后端契约。
 */

/** 执行相位:意图(是否请求)/ 送达(是否收到)/ 执行(卡在哪)/ 终态 四段分离。 */
export const TAKEOVER_PHASES = [
  "NONE",
  "HIT_NOT_REQUESTED",
  "COMMAND_PENDING_ACK",
  "RECEIVED",
  "WAITING_SESSION_EDGE",
  "LOADING",
  "HANDOFF_FETCHING",
  "HANDOFF_MERGING",
  "HANDOFF_ACKED",
  "SUCCEEDED",
  "FAILED",
  "CANCELLED",
  "REVOKE_PENDING_ACK",
  "REVOKED",
] as const;
export type TakeoverPhase = (typeof TAKEOVER_PHASES)[number];

export const TAKEOVER_PHASE_LABEL: Record<TakeoverPhase, string> = {
  NONE: "无接管",
  HIT_NOT_REQUESTED: "策略命中 · 未请求下发",
  COMMAND_PENDING_ACK: "命令已发 · 等待设备确认",
  RECEIVED: "设备已确认收到",
  WAITING_SESSION_EDGE: "等待会话边界",
  LOADING: "目标页加载中",
  HANDOFF_FETCHING: "账户态交接 · 拉取中",
  HANDOFF_MERGING: "账户态交接 · 合并中",
  HANDOFF_ACKED: "账户态交接已确认",
  SUCCEEDED: "接管生效",
  FAILED: "接管失败",
  CANCELLED: "已取消",
  REVOKE_PENDING_ACK: "撤销命令已发 · 等待确认",
  REVOKED: "已撤销",
};

/** 命令类型:接管 / 撤销 / 换目标 三类,各自独立对账(撤销自己也会失败)。 */
export const TAKEOVER_COMMAND_TYPES = ["ACTIVATE", "REVOKE", "CHANGE_TARGET"] as const;
export type TakeoverCommandType = (typeof TAKEOVER_COMMAND_TYPES)[number];

/** 失败分类决定「能不能原地重试」——同一个 FAILED 徽章里其实混着七种完全不同的处置。 */
export const TAKEOVER_FAILURE_CLASSES = ["delivery", "target", "webview", "handoff", "lease", "cleanup", "contract"] as const;
export type TakeoverFailureClass = (typeof TAKEOVER_FAILURE_CLASSES)[number];

export const TAKEOVER_FAILURE_CLASS_LABEL: Record<TakeoverFailureClass, string> = {
  delivery: "送达失败",
  target: "目标不可用",
  webview: "页面加载失败",
  handoff: "账户态交接失败",
  lease: "接管租约失效",
  cleanup: "撤销清理失败",
  contract: "协议不匹配",
};

/**
 * 可重试性按**分类**判定,不按单个错误码枚举。
 * why:错误码是开放集合(后端随时新增),按码枚举必漏;分类是封闭集合且语义稳定。
 * - delivery / webview:环境瞬时问题,原地重试有意义
 * - target / contract:换目标或修契约前重试必然再失败
 * - handoff / lease:设备侧可能已处于半接管态,必须先撤销再重来
 * - cleanup:撤销没清干净,重发撤销而不是重发接管
 */
export function takeoverRetryable(failureClass: TakeoverFailureClass | null | undefined): boolean {
  return failureClass === "delivery" || failureClass === "webview";
}

/** 失败分类 → 建议的下一步动作(给运营明确出路,不是只报错)。 */
export function takeoverRecommendedAction(failureClass: TakeoverFailureClass | null | undefined): TakeoverCommandType | "NONE" {
  switch (failureClass) {
    case "delivery":
    case "webview":
      return "ACTIVATE"; // 原地重试
    case "target":
    case "contract":
      return "CHANGE_TARGET";
    case "handoff":
    case "lease":
    case "cleanup":
      return "REVOKE"; // 先撤干净再说
    default:
      return "NONE";
  }
}

export interface TakeoverExecution {
  phase: TakeoverPhase;
  commandId?: string | null;
  commandType?: TakeoverCommandType | null;
  /** 后台下发的命令版本 vs 设备回报的已应用版本:不等 = 设备跑的是旧命令。 */
  commandVersion?: number | null;
  deviceAppliedVersion?: number | null;
  /** 因果来源:人工请求号 + 审计号,或自动判定号。回答「谁让它接管的」。 */
  causeRequestId?: string | null;
  causeAuditId?: string | null;
  causeDecisionId?: string | null;
  /** 🔴 期望 vs 实际目标:红队核心对账位。 */
  expectedTargetId?: string | null;
  actualTargetId?: string | null;
  requestedAt?: number | null;
  acknowledgedAt?: number | null;
  failureCode?: string | null;
  failureClass?: TakeoverFailureClass | null;
  failurePhase?: TakeoverPhase | null;
  failureMessage?: string | null;
}

/**
 * 🔴 目标对账:期望与实际都拿到、且不相等即为失陷信号。
 * 只有一侧缺失时**不判失配**(还没到对账时点),避免把「未上报」误报成「被替换」。
 */
export function takeoverTargetMismatch(exec: TakeoverExecution | null | undefined): boolean {
  const expected = exec?.expectedTargetId?.trim();
  const actual = exec?.actualTargetId?.trim();
  if (!expected || !actual) return false;
  return expected !== actual;
}

/** 命令版本对账:设备已应用版本落后于下发版本 = 设备仍在跑旧命令。 */
export function takeoverVersionStale(exec: TakeoverExecution | null | undefined): boolean {
  const sent = exec?.commandVersion;
  const applied = exec?.deviceAppliedVersion;
  if (typeof sent !== "number" || typeof applied !== "number") return false;
  return applied < sent;
}

/**
 * 相位 → 旧 6 值命令态的摘要映射。
 *
 * why 保留:`commandState` 有三个既有消费者(设备详情徽章 / 审计展示 / 契约校验),
 * 且契约把它锁成闭集。新模型作为**更细的下层**存在,摘要由此派生,旧面零改动、不回退。
 */
export type LegacyCommandState = "PENDING" | "PUBLISHED" | "ACKED" | "FAILED" | "EXPIRED" | "CANCELLED";

export function takeoverPhaseToCommandState(phase: TakeoverPhase): LegacyCommandState | null {
  switch (phase) {
    case "NONE":
    case "HIT_NOT_REQUESTED":
      return null;
    case "COMMAND_PENDING_ACK":
    case "REVOKE_PENDING_ACK":
      return "PUBLISHED";
    case "RECEIVED":
    case "WAITING_SESSION_EDGE":
    case "LOADING":
    case "HANDOFF_FETCHING":
    case "HANDOFF_MERGING":
    case "HANDOFF_ACKED":
      return "PUBLISHED"; // 设备侧在推进,但对外仍是「已下发未终结」
    case "SUCCEEDED":
    case "REVOKED":
      return "ACKED";
    case "FAILED":
      return "FAILED";
    case "CANCELLED":
      return "CANCELLED";
  }
}

/** 该相位下允许发起哪些命令(不可用时页面给禁用原因,不隐藏按钮)。 */
export function allowedTakeoverCommands(exec: TakeoverExecution | null | undefined): TakeoverCommandType[] {
  const phase = exec?.phase ?? "NONE";
  switch (phase) {
    case "COMMAND_PENDING_ACK":
    case "RECEIVED":
    case "WAITING_SESSION_EDGE":
    case "LOADING":
    case "HANDOFF_FETCHING":
    case "HANDOFF_MERGING":
    case "HANDOFF_ACKED":
      // 在途:可撤销、可换目标(换目标覆盖在途命令),不重复下发接管
      return ["REVOKE", "CHANGE_TARGET"];
    case "SUCCEEDED":
      return ["REVOKE", "CHANGE_TARGET"];
    case "FAILED":
      return takeoverRetryable(exec?.failureClass)
        ? ["ACTIVATE", "CHANGE_TARGET", "REVOKE"]
        : ["CHANGE_TARGET", "REVOKE"];
    case "REVOKE_PENDING_ACK":
      return ["REVOKE"]; // 只能重发撤销
    case "REVOKED":
    case "CANCELLED":
    case "HIT_NOT_REQUESTED":
    case "NONE":
      return [];
  }
}

export function takeoverCommandDisabledReason(exec: TakeoverExecution | null | undefined, command: TakeoverCommandType): string | null {
  if (allowedTakeoverCommands(exec).includes(command)) return null;
  const phase = exec?.phase ?? "NONE";
  if (phase === "NONE" || phase === "HIT_NOT_REQUESTED") return "该设备当前没有在途或生效的接管命令";
  if (phase === "REVOKED" || phase === "CANCELLED") return "接管已结束,如需重新接管请从策略或人工接管入口发起";
  if (phase === "REVOKE_PENDING_ACK") return "撤销命令等待设备确认中,此时只能重发撤销";
  if (command === "ACTIVATE") return `失败原因属「${exec?.failureClass ? TAKEOVER_FAILURE_CLASS_LABEL[exec.failureClass] : "未分类"}」,原地重试会再次失败`;
  return "当前执行相位不允许该动作";
}
