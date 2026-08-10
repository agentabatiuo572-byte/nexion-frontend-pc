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
  // 🔴 撤销失败必须独立成相位(2026-08-07 审计 P1-5):cleanup 类失败若复用 FAILED,
  //   徽章会写「接管失败」= 运营读成「没接管上,无需处置」——而真相是**接管仍然生效、
  //   设备还被控着,失败的是撤销**。安全语义正好反转,这是 14 相位里最危险的缺口。
  "REVOKE_FAILED",
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
  REVOKE_FAILED: "撤销失败 · 接管仍生效",
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
  actualTargetVersion?: number | null;
  actualTargetCatalogVersion?: number | null;
  requestedAt?: number | null;
  acknowledgedAt?: number | null;
  failureCode?: string | null;
  failureClass?: TakeoverFailureClass | null;
  failurePhase?: TakeoverPhase | null;
  failureMessage?: string | null;
  deliveryAttempts?: number | null;
  rowVersion?: number | null;
  deviceAppVersion?: string | null;
  handoffReceipt?: string | null;
  reconciliationId?: string | null;
  fresh?: boolean;
}

/**
 * 🔴 目标对账:实际目标 ≠ 批准目标 即失陷信号。
 *
 * **期望侧优先取 `approvedTargetId`(后台自己的批准绑定)**,而不是响应里的 `expectedTargetId`
 * (2026-08-07 审计 P1-1):后者与 `actualTargetId` 来自同一个后端响应 blob,上报链路被控时
 * 攻击者可令两者相等而静默通过——用同源两侧互证等于没有对账。后台批准记录是唯一独立锚点。
 * 无独立锚点时才退回响应内自比(至少能抓到「后端自己发现不一致」的情形)。
 *
 * 一侧缺失仍**不判失配**(未上报 ≠ 被替换),但那不再等于安全:见 takeoverReconciliationOverdue。
 */
export function takeoverTargetMismatch(
  exec: TakeoverExecution | null | undefined,
  approvedTargetId?: string | null,
): boolean {
  const expected = (approvedTargetId ?? exec?.expectedTargetId)?.trim();
  const actual = exec?.actualTargetId?.trim();
  if (!expected || !actual) return false;
  return expected !== actual;
}

/** 命令已进入设备执行阶段(此后设备就该回报实际目标了)。 */
const RECONCILABLE_PHASES = new Set<TakeoverPhase>([
  "RECEIVED", "WAITING_SESSION_EDGE", "LOADING",
  "HANDOFF_FETCHING", "HANDOFF_MERGING", "HANDOFF_ACKED", "SUCCEEDED",
]);

/** 实际目标迟迟不回报的容忍窗(超过即判对账未完成)。 */
export const TAKEOVER_RECONCILE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * 🔴 对账未完成(2026-08-07 审计 P1-2):设备**不上报**实际目标,曾经等于永久免告警——
 * 「不误报」只做了减法,静音由此成为最省事的规避手段。补上正交的第二条判定:
 * 已有批准目标 + 相位已进入设备执行阶段 + 超过容忍窗仍无实际目标 = 对账未完成(黄色,
 * 与红色「已确认被替换」分级)。静音从此不再等于安全,而是另一种可见异常。
 */
export function takeoverReconciliationOverdue(
  exec: TakeoverExecution | null | undefined,
  approvedTargetId?: string | null,
  now: number = Date.now(),
): boolean {
  if (!exec) return false;
  const expected = (approvedTargetId ?? exec.expectedTargetId)?.trim();
  if (!expected) return false;
  if (exec.actualTargetId?.trim()) return false; // 已回报 → 交给 mismatch 判
  if (!RECONCILABLE_PHASES.has(exec.phase)) return false;
  const since = exec.acknowledgedAt ?? exec.requestedAt;
  if (typeof since !== "number") return false;
  return now - since > TAKEOVER_RECONCILE_TIMEOUT_MS;
}

export type TakeoverVersionDrift = "none" | "stale" | "ahead";

/**
 * 命令版本对账,**双向**(2026-08-07 审计 P1-3):
 * - `stale`:设备已应用版本落后 = 仍在跑旧命令
 * - `ahead`:设备执行着后台从未下发过的版本 = **疑似命令注入或重放**,比落后危险得多
 * 旧实现只判 `applied < sent`,超前方向静默放行。
 */
export function takeoverVersionDrift(exec: TakeoverExecution | null | undefined): TakeoverVersionDrift {
  const sent = exec?.commandVersion;
  const applied = exec?.deviceAppliedVersion;
  if (typeof sent !== "number" || typeof applied !== "number") return "none";
  if (applied < sent) return "stale";
  if (applied > sent) return "ahead";
  return "none";
}

/** 兼容旧调用点的窄判定;新代码请用 takeoverVersionDrift 以区分两个方向。 */
export function takeoverVersionStale(exec: TakeoverExecution | null | undefined): boolean {
  return takeoverVersionDrift(exec) === "stale";
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
    case "REVOKE_FAILED":
      // 撤销失败同样是 FAILED 摘要,但两者的处置完全相反 —— 摘要只供既有消费面,
      // 真实处置一律读相位(这也是为什么审计面必须消费明细,见 k6-audit-presenter)。
      return "FAILED";
    case "CANCELLED":
      return "CANCELLED";
  }
}

/**
 * 该相位下允许发起哪些命令(不可用时页面给禁用原因,不隐藏按钮)。
 *
 * 🔴 对账异常压倒相位(2026-08-07 审计 P1-4):相位是**后台记录**,对账异常恰恰说明
 *   后台记录与设备现实脱节——曾经的实现里 `phase:"NONE"` + 目标失配会同时显示
 *   「设备可能在执行未经批准的目标,请立即撤销」和「没有接管命令,撤销不可用」,
 *   自相矛盾且把最该有出路的场景堵死。故:一旦对账异常,REVOKE 无条件放行。
 */
export function allowedTakeoverCommands(
  exec: TakeoverExecution | null | undefined,
  reconcileAnomaly = false,
): TakeoverCommandType[] {
  const phase = exec?.phase ?? "NONE";
  if (reconcileAnomaly) {
    const base = allowedTakeoverCommandsByPhase(phase, exec);
    return base.includes("REVOKE") ? base : ["REVOKE", ...base];
  }
  return allowedTakeoverCommandsByPhase(phase, exec);
}

function allowedTakeoverCommandsByPhase(phase: TakeoverPhase, exec: TakeoverExecution | null | undefined): TakeoverCommandType[] {
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
    case "REVOKE_FAILED":
      // 撤销失败 = 接管仍生效、设备还被控着。必须能重发撤销;换目标作为退路
      //(把设备导向一个安全目标,总好过继续留在攻击者指定的目标上)。
      return ["REVOKE", "CHANGE_TARGET"];
    case "REVOKED":
    case "CANCELLED":
    case "HIT_NOT_REQUESTED":
    case "NONE":
      return [];
  }
}

export function takeoverCommandDisabledReason(
  exec: TakeoverExecution | null | undefined,
  command: TakeoverCommandType,
  reconcileAnomaly = false,
): string | null {
  if (allowedTakeoverCommands(exec, reconcileAnomaly).includes(command)) return null;
  const phase = exec?.phase ?? "NONE";
  if (phase === "NONE" || phase === "HIT_NOT_REQUESTED") return "该设备当前没有在途或生效的接管命令";
  if (phase === "REVOKED" || phase === "CANCELLED") return "接管已结束,如需重新接管请从策略或人工接管入口发起";
  if (phase === "REVOKE_PENDING_ACK") return "撤销命令等待设备确认中,此时只能重发撤销";
  if (command === "ACTIVATE") return `失败原因属「${exec?.failureClass ? TAKEOVER_FAILURE_CLASS_LABEL[exec.failureClass] : "未分类"}」,原地重试会再次失败`;
  return "当前执行相位不允许该动作";
}
