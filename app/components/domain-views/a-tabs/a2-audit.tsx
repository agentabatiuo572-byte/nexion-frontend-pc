"use client";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { k1EarningSourceName } from "@/lib/admin/k1-earning-sources";
import { parseK1ReleaseTicketBefore } from "@/lib/admin/k1-risk-approval";
import { operatorDeviceStatus } from "@/lib/admin/e-operator-display";
import { AUDIT_ACTION_NAMES as A2_ACTION_NAMES, AUDIT_RESOURCE_NAMES, K1_APPROVAL_PARAM_NAMES, k1ApprovalSummaryText } from "@/lib/admin/audit-action-names";
import { TASK_ACTION_ROUTE_LABELS, TASK_CATEGORY_LABELS, legacyAssetText } from "@/lib/admin/config-help/h3-task";
import { a2ActionText, a2ObjectText, DIV_BASE_FORMULA, DIV_BASE_TEXT, operatorCopyText, shareBaseRateText } from "@/lib/admin/operator-copy";
import { PromotionRefundImpact } from "../promotion-refund-impact";
import { PhoneCalibrationReview } from "../e-tabs/phone-calibration-review";
import { AmbassadorMaterialSummary } from "../f-tabs/f4-ambassador-materials";
import { F4PayoutPreviewFacts, F4SettleFacts } from "../f-tabs/f4-payout-preview";
import { F2BootstrapReview, f2PctSum, parseF2BootstrapAfter } from "../f-tabs/f2-bootstrap-ticket";
import { ambassadorBucketLabel, ambassadorMaterialStateLabel } from "@/lib/admin/f4-ambassador-display";
import { F5_KIND_LABELS } from "@/lib/admin/f-overview-contract";
import { fmtConfigPct, fmtPct } from "@/lib/format";
import { fConfigSpec, fConfigValue, type FConfigSpec } from "./a2-f-config";
import { F5CurrentFact, F5CurrentValue, F5ReissueReadings, readF5Current } from "./a2-f5-current";
import { A2I5DisclosureReview } from "./a2-i5-disclosure-review";
import { A2RoleGrantsChange, isRoleGrantsTicket, roleGrantsSummary } from "./a2-role-grants";

/**
 * A2 操作记录与审批（列表页·队列模式，PG-44）。三个页签：待审批（默认）、操作记录（含审批结果）、机制设置。
 *
 * - 待审批和机制设置读不带筛选的总览；操作记录有生效筛选时另读一次带筛选的总览。后端把同一组筛选同时套在
 *   审批单、统计和记录上，不分开读的话待审批数会跟着操作记录的筛选变。
 * - 批准、驳回、撤回、调整机制参数、立即清理、导出：先把命令号和原内容（导出连同已应用的筛选）存进本标签页再发；
 *   结果未知时关框，转成页面上方的待确认条，这张单（这项设置、清理、导出）锁住，只能按原操作重试；
 *   重试被后端明确拒绝（isExplicitRejection）后才能解除，超过 24 小时只能核对（OP-92～OP-96、OP-153）。
 * - 批准、驳回入口使用后端返回的当前资格，没有权限的不显示入口（OP-124）。
 * - 记录只追加：没有改、删记录的接口，页面也不给入口。所有写操作都要填理由。
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Archive, ArrowLeft, ClipboardList, Coins, Copy, Download, FileText, Flame, History, Inbox, ListChecks, Lock, RefreshCw, Siren, SlidersHorizontal, Users } from "lucide-react";
import { AutoGloss } from "@/app/components/kit/gloss";
import {
  BlockState, Button, Cell, Change, ConfigList, ConfigRow, Decision, DiffList, Drawer, Explain, Fact, Facts, FilterBar, FilterField, Fold, IconButton, Input, InlineRetry,
  IrreversibleTag, JudgmentPoints, Notice, PageHeader, PageTabs, Pager, Panel, ReleaseModal, Segments, Select, Stat, StatBand, StatusTag, Table, TableLoading,
  TableMessage, Td, Th, Tr, useTabIds, type DiffRow, type JudgmentRow, type SegmentItem, type StateTone,
} from "@/app/components/rd";
import {
  REVIEW_OPERATION_BY_ACTION,
  approveA2Operation,
  createA2CommandKey,
  exportA2Audit,
  fetchA2RetentionLatest,
  fetchA2RetentionPreview,
  fetchA2Overview,
  isA2OutcomeUncertainError,
  rejectA2Operation,
  runA2RetentionNow,
  updateA2MechanismParam,
  withdrawA2Operation,
  type A2AuditDomain,
  type A2AuditFilter,
  type A2AuditLogRow,
  type A2OperationHistory,
  type A2OperationRow,
  type A2OperationType,
  type A2Overview,
  type RetentionExecution,
  type RetentionPreview,
} from "@/lib/admin/a2-client";
import {
  A2_AUDIT_DOMAINS,
  canAccessA2Export,
  canAccessA2Write,
  matchesA2OperationRole,
  normalizeA2AuditFilter,
  parseA2FilterQuery,
  parseA2ReasonMin,
  parseA2SchemaVersion,
  validateA2MechanismValue,
  validateA2AuditFilterRange,
} from "@/lib/admin/a2-policy";
import { A2_MECHANISM_HELP, A2_MECHANISM_WHERE } from "@/lib/admin/config-help/a2";
import { businessClock, businessStamp, businessZone, formatBusinessTimeCompact, formatBusinessTimeFull } from "@/lib/admin/business-time";
import { createPendingMutationStore, isPendingCommandOwnedBy, isRetryExpired, type PendingMutationExtra, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { canApprovePending, type AuthPrincipal } from "@/lib/admin/ops-authority";
import { isH7VoucherApproval } from "@/lib/admin/h7-voucher-approval";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { announcePermissionDenied, isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { useBDomainDashboard } from "@/lib/admin/b-client";
import { B_DASHBOARD_READ_AUTHORITIES } from "@/lib/admin/shell-authorities";
import { normalizeSessionRole } from "@/lib/admin/session-role";
import { roleLabel } from "@/lib/nav/console-nav";
import { useReach } from "@/lib/nav/use-reach";
import { orderAmount } from "../e-tabs/data";
import type { ActionConfirmReq, ACtx } from "./types";

/* ────────────────── 名字和规则 ────────────────── */

type A2Tab = "pending" | "records" | "settings";
type RecordView = "logs" | "history";
type QType = "all" | A2OperationType;
type QOperator = "all" | "财务" | "风控" | "增长" | "内容" | "客服" | "超管";

/** 类型分段和排序一致：应急在全部后面（OP-74）。不带表情，类型名和标记同名（DT-14）。 */
const TYPE_ITEMS: readonly SegmentItem<QType>[] = [
  { value: "all", label: "全部" },
  { value: "sos", label: "应急" },
  { value: "fund", label: "资金类" },
  { value: "param", label: "参数类" },
  { value: "acct", label: "账号/处置" },
];
const TYPE_NAME: Record<A2OperationType, string> = { sos: "应急", fund: "资金类", param: "参数类", acct: "账号/处置" };

const OPERATOR_OPTIONS: readonly { value: QOperator; label: string }[] = [
  { value: "all", label: "全部发起人" },
  { value: "财务", label: "财务" },
  { value: "风控", label: "风控" },
  { value: "增长", label: "增长" },
  { value: "内容", label: "内容" },
  { value: "客服", label: "客服" },
  { value: "超管", label: "超级管理员" },
];

/** 模块用侧栏域名，值仍是 A～M（PG-04）。 */
const DOMAIN_NAMES: Record<A2AuditDomain, string> = {
  A: "平台基础", B: "运营总览", C: "用户与账户", D: "资金与财务", E: "设备与商城", F: "分销与团队", G: "金融产品",
  H: "增长与活动", I: "内容与合规", J: "紧急与合规控制", K: "风控与反作弊", L: "数据与分析", M: "客服中心",
};

const FILTER_PARAMS = ["domain", "operator", "action", "object", "startTime", "endTime"] as const;
type FilterKey = typeof FILTER_PARAMS[number];
const FILTER_LABEL: Record<Exclude<FilterKey, "domain">, string> = { operator: "操作者", action: "动作", object: "对象", startTime: "开始", endTime: "结束" };
const LOG_PAGE_SIZES = [10, 20, 50] as const;

/** 结果名按 TX-32：执行改批准、取消改驳回。已驳回不是失败，不用红（DT-13）。 */
const HIST_LABEL: Record<string, string> = { pending: "待审批", approved: "已批准", rejected: "已驳回", withdrawn: "已撤回", expired: "已过期" };
const HIST_TONE: Record<string, StateTone> = { pending: "warn", approved: "ok", rejected: "done", withdrawn: "done", expired: "done" };

const OWN_TICKET_REASON = "这是你发起的，需要另一位管理员处理";
const RETIRED_OPERATION_COPY = "此操作已退役，不能批准或重新发起；保留原申请和历史记录，待审申请可按原权限驳回或撤回。";
/** 后端给 coverageCheckOnApproval 的三类单：K1 解除误判、判定为正常；J1 紧急开关恢复；大使申请批准（另有一句）。低于红线时各自什么不变按类写（OpsAuditCenterService.toTicket）。 */
const COVERAGE_ON_APPROVAL_COPY = "批准执行时，系统会检查兑付覆盖率。低于红线时不执行，审批单继续待处理，原状态不变。";
const K1_CLUSTER_COVERAGE_COPY = "批准执行时，系统会检查兑付覆盖率。低于红线时，审批单继续待处理，账户组状态和提现限制保持原样。";
const isK1ClusterTicket = (w: A2OperationRow) => ["k1_cluster_release", "k1_cluster_cleared"].includes(w.operationCode ?? "") || /^(?:解除误判|判定为正常)(?: · |$)/.test(w.action);
const J1_RESTORE_COVERAGE_COPY = "批准执行时，系统会检查兑付覆盖率。低于红线时，审批单继续待处理，开关保持关闭，业务继续暂停。";
/** J1 恢复单后端存的对象是开关代号（「恢复业务开关 · withdraw」）；显示成紧急停用开关页卡片上的名字（OpsKillSwitchService 的 GATE_SEEDS）。 */
const J1_GATE_NAMES: Record<string, string> = { withdraw: "提现开关", staking: "质押开关", genesis: "创世节点开关", exchange: "兑换开关", trial: "试用开关" };
const j1GateName = (key: string) => J1_GATE_NAMES[key] ?? key;
const PENDING_LOCK = "这张单有一次操作结果未知，先到页面上方核对";
const RELOADING = "审批单还在读取，读完再处理";
const SUBMITTING = "正在提交";
const NO_WITHDRAW = "你没有撤回申请的权限";
const NO_DECIDE = "这个账号没有处理这张单的权限";
/** 页面判断不了这张单要哪项业务权限或附加条件时，入口照常放出，写这一句（协调人第五轮定）。 */
const BACKEND_CHECKS_NOTE = "批准时系统再核对业务权限，没有权限会被拒绝并写明原因";
const WAIT_OTHERS = "等待有权限的人处理";
const UNKNOWN_TOAST = "结果未知，不要重复操作。到页面上方查询原结果，或按原请求重试。";
const RETRY_EXPIRED = "已超过 24 小时，不能再重试，请在「操作记录」里按单号核对。";
const RETRY_NO_PERMISSION = "这个账号现在没有这项操作的权限，不能重试，请在「操作记录」里按单号核对";

function approvalCoverageCopy(w: A2OperationRow) {
  return w.ambassadorMaterialProposal?.applicationDecision === "APPROVE"
    ? "批准时系统会重新核对材料、核验结论、认可金额和兑付覆盖率；有一项不满足就不执行，审批单继续待处理，申请和预算额度不变。"
    : w.operationCode === "j1_gate_resume" ? J1_RESTORE_COVERAGE_COPY : isK1ClusterTicket(w) ? K1_CLUSTER_COVERAGE_COPY : COVERAGE_ON_APPROVAL_COPY;
}

function approvalExecutorLabel(w: A2OperationRow) {
  if (["a6_role_status_update", "a6_role_disable", "a6_role_delete", "a6_role_grants_update"].includes(w.operationCode ?? ""))
    return "另一位有审批批准权限和对应业务权限的管理员";
  if (w.operationCode === "h1_phase_dial") return "另一位有审批批准权限和运营阶段修改权限的超级管理员";
  // AuditReplayBusinessPermissionGuard.validateJ1RestoreChecker：超级管理员，且有审批批准权限和业务开关恢复权限。
  if (w.operationCode === "j1_gate_resume") return "另一位有审批批准权限和业务开关恢复权限的超级管理员";
  // AuditReplayBusinessPermissionGuard.requiredAuthority：首次配置要审批批准权限和团队奖励比例权限，不要求超级管理员。
  if (w.operationCode === "f_unilevel_bootstrap") return "另一位有审批批准权限和团队奖励比例权限的管理员";
  // K1RiskApproval.validateChecker：有效超级管理员且有审批批准权限，不能是提交人。
  if (w.operationCode === "k1_release_param" || w.operationCode === "k1_earnings_release") return "另一位有审批批准权限的超级管理员";
  if (w.operationCode === "c2_session_revoke_all" || !w.operationCode && w.action.startsWith("强制登出 · ")) return "另一位有审批批准权限和退出全部设备权限的超级管理员";
  // H5GrowthApproval：三类成长审批都要超级管理员且有审批批准权限。
  if (w.operationCode === "h5_streak_milestone" || w.operationCode === "h5_power_up_config" || w.operationCode === "h5_earn_milestone") return "另一位有审批批准权限的超级管理员";
  if (/^(?:兑换|回购)参数调整 · /.test(w.action)) return "另一位有审批批准权限的超级管理员";
  if (/^调整创世参数 · /.test(w.action)) return "另一位有审批批准权限和该参数业务权限的超级管理员";
  if (["提高旧活动奖励", "放宽转盘奖项配置", "新增转盘奖项", "删除转盘奖项并提高安慰奖", "提高转盘奖项概率",
    "首次发布奖励课程", "发布奖励课程版本", "回滚至有奖励的课程版本"].includes(w.action)) return "另一位有审批批准权限的超级管理员";
  if (w.action === "调整设备型号" || w.action === "发布手机可跑任务") return "另一位有审批批准权限和商品修改权限的管理员";
  if (w.action === "发布规则任务") return "另一位有审批批准权限和任务池修改权限的管理员";
  return w.ambassadorMaterialProposal?.applicationDecision === "APPROVE"
    ? "另一位具有审批和大使批准权限、且未参与本版材料核验的管理员"
    // 后端存的「门槛者」只是占位叫法（A2-BE-02）；只改显示，请求里带的值不动。
    : w.roleGate === "超管" ? "另一位超级管理员" : w.roleGate === "门槛者" ? "另一位有审批批准权限和对应业务权限的管理员" : w.roleGate;
}

function isCurrentOperator(w: A2OperationRow, username: string | undefined) {
  return w.mine || (!!username && username === w.operator);
}

/** G3 价格计划单：后端写死的对象和动作名（G3MarketApproval 的描述）。 */
function isG3Policy(w: Pick<A2OperationRow, "action" | "obj">) {
  return w.obj === "weekly" && /^提高周价格计划·D[1-7]·(?:目标价（USDT\/UVT）|上涨概率)$/.test(w.action)
    || w.obj === "currentPrice" && w.action === "提高当前UVT价格"
    || w.obj === "schedule" && w.action === "首次配置UVT自动推进";
}

function g3PolicyExecutionTiming(w: A2OperationRow) {
  if (!isG3Policy(w)) return undefined;
  try {
    const review = JSON.parse(w.after) as Record<string, unknown>;
    if (review && typeof review["生效时间"] === "string") return review["生效时间"];
  } catch { /* Historical incomplete review text retains the G3 timing reminder. */ }
  return "批准后按完整变更内容注明的时点生效，请先核对";
}

/**
 * F4 派奖、F4 本周结算、F5 奖励状态变更：后端存的对象是榜单代号和配置键（「排行榜 allTime」「F.commission.CM-1040.status」）、
 * 状态是英文代码。批准人看到的写运营的话；单号 CM-… 是运营要对照的，照原样等宽写在后面。
 */
const F4_PERIOD_NAME: Record<string, string> = { allTime: "总榜", week: "周榜", month: "月榜", today: "日榜" };
/** 和「奖励记录核对」页的状态叫法一致（f5-shared STATUS_META）。 */
const F5_STATE_NAME: Record<string, string> = { cooling: "冷却中", unlocked: "已解锁", frozen: "已冻结", rejected: "已拒绝", settled: "已结算", paid: "已提现", reversed: "已冲正" };
/** 改成这个状态之前只能是哪一种（OpsTeamService 状态转换表）；能从几种状态改过来的不写。 */
const F5_STATE_FROM: Record<string, string> = { cooling: "已冻结", unlocked: "冷却中", frozen: "冷却中" };
const F4_COVERAGE_COPY = "批准时先查兑付覆盖率：读不到或低于红线就不发钱，审批单留着待审批。";

type FundTicket = { kind: "f4Payout"; period?: string } | { kind: "f4Settle" } | { kind: "f5Status"; eventId?: string; state: string }
  | { kind: "fConfig"; key: string; spec?: FConfigSpec }
  | { kind: "f5Suspension"; userId?: string; kinds: string[]; suspended: boolean }
  | { kind: "f5Reissue"; ids: string[]; count?: number }
  | { kind: "f5Reverse"; eventId?: string };
const F_CONFIG_CODES = ["f_config", "f_ui_config", "f_unilevel_rule"];
/**
 * F 域配置、F5 暂停／恢复、补发、冲正：后端的描述器写「F 域配置调整 · 键」「暂停用户奖励 123」+ 对象「123:binary,network」、
 * 「批量补发奖励 · N 笔」+ 逗号连起来的记录号、「撤销奖励记录 CM-1」（delegatedFDescriptor）。审批结果里没有对象，从动作名里认。
 */
function fundTicket(w: { operationCode?: string | null; obj?: string; after?: string; action?: string }): FundTicket | undefined {
  const action = w.action ?? "";
  if (w.operationCode === "f4_leaderboard_period_payout") return { kind: "f4Payout", period: F4_PERIOD_NAME[/^排行榜 (\S+)$/.exec(w.obj ?? "")?.[1] ?? ""] };
  if (w.operationCode === "f4_pool_settle") return { kind: "f4Settle" };
  if (w.operationCode === "f_commission_status") return { kind: "f5Status", eventId: /^F\.commission\.(CM-\d+)\.status$/.exec(w.obj ?? "")?.[1], state: (w.after ?? "").trim().toLowerCase() };
  const configKey = /^F 域配置调整 · (.+)$/.exec(action)?.[1];
  // 同一个 f_ui_config 也承载大使申请（动作名是「批准区域大使申请」），那种不在这里。
  if (configKey && (!w.operationCode || F_CONFIG_CODES.includes(w.operationCode))) return { kind: "fConfig", key: configKey, spec: fConfigSpec(configKey, w.after) };
  if (w.operationCode === "f5_commission_suspension") {
    const [user, kinds] = (w.obj ?? "").split(":");
    return { kind: "f5Suspension", userId: /^\d+$/.test(user ?? "") ? user : /^(?:暂停|恢复)用户奖励 (\d+)$/.exec(action)?.[1],
      kinds: kinds ? kinds.split(",").filter(Boolean) : [], suspended: w.after ? w.after === "SUSPENDED" : action.startsWith("暂停") };
  }
  if (w.operationCode === "f5_commission_reissue") {
    const ids = (w.obj ?? "").split(",").map((id) => id.trim()).filter((id) => /^CM-\d+$/.test(id));
    return { kind: "f5Reissue", ids, count: ids.length || Number(/^批量补发奖励 · (\d+) 笔$/.exec(action)?.[1]) || undefined };
  }
  if (w.operationCode === "f5_commission_reverse") return { kind: "f5Reverse", eventId: /^CM-\d+$/.test(w.obj ?? "") ? w.obj : /^撤销奖励记录 (CM-\d+)$/.exec(action)?.[1] };
  return undefined;
}

/**
 * F 域整批申请（f_config_batch）：动作名「网络参数整批原子调整 · N 项」；对象是各项配置键用逗号连起来，太长时只存「F.batch:」加摘要（24fa2815）。
 * 各项的修改前后按「键=值 / 键=值」存在单子上（delegatedFDescriptor），从这里逐项列出，不从摘要猜。两边的键对不上就不拆，照原文显示。
 */
const F_BATCH_ACTION = /^网络参数整批原子调整 · (\d+) 项$/;
const F_BATCH_DIGEST = /^F\.batch:[0-9a-f]{64}$/;
type FBatchItem = { key: string; spec?: FConfigSpec; before: string; after: string };
function fBatchPairs(text: string): Array<[string, string]> | undefined {
  const pairs: Array<[string, string]> = [];
  for (const part of text.split(" / ")) {
    const m = /^(F\d?\.[^=\s]+)=([\s\S]*)$/.exec(part);
    if (m) pairs.push([m[1], m[2]]);
    else if (pairs.length) pairs[pairs.length - 1][1] += ` / ${part}`;
    else return undefined;
  }
  return pairs;
}
/** 两边逐项的键一一对应（数量也对得上）才拆成各项，否则返回 undefined。 */
function fBatchItems(beforeText: string, afterText: string, count?: number): FBatchItem[] | undefined {
  const after = fBatchPairs(afterText);
  const before = fBatchPairs(beforeText);
  if (!after || !before || after.length !== before.length || count !== undefined && after.length !== count || after.some(([key], i) => before[i][0] !== key)) return undefined;
  return after.map(([key, value], i) => {
    const spec = fConfigSpec(key, value);
    return { key, spec, before: fConfigValue(spec, before[i][1]), after: fConfigValue(spec, value) };
  });
}
function fBatchTicket(w: { action?: string; obj?: string; before?: string; after?: string }): { count: number; digest: boolean; items?: FBatchItem[] } | undefined {
  const count = Number(F_BATCH_ACTION.exec(w.action ?? "")?.[1]);
  if (!count) return undefined;
  return { count, digest: F_BATCH_DIGEST.test(w.obj ?? ""), items: fBatchItems(w.before ?? "", w.after ?? "", count) };
}
/**
 * 操作记录里的整批申请：对象是摘要，或正好是各项键用逗号连起来；前后值是单上的原文，后端写成「前 -> 后」（decisionDetail），页面自己拼的是「前 → 后」。
 */
function fBatchLogItems(log: { obj: string; delta: string }): FBatchItem[] | undefined {
  const sides = log.delta.split(/ -> | → /);
  if (sides.length !== 2) return undefined;
  const items = fBatchItems(sides[0], sides[1]);
  return items && (F_BATCH_DIGEST.test(log.obj) || log.obj === items.map((item) => item.key).join(",")) ? items : undefined;
}
const fBatchSummary = (items: readonly FBatchItem[]) => `${fBatchLabel(items[0], fBatchPages(items))} ${items[0].before} → ${items[0].after}${items.length > 1 ? ` 等 ${items.length} 项` : ""}`;
/** 涉及的页面名；认不出的项写「团队参数」。 */
const fBatchPages = (items: readonly FBatchItem[] | undefined) => [...new Set((items ?? []).map((item) => item.spec?.page ?? "团队参数"))];
const fBatchLabel = (item: FBatchItem, pages: readonly string[]) => item.spec ? (pages.length > 1 ? `${item.spec.page} · ${item.spec.item}` : item.spec.item) : "未识别的配置项";

/** 整批申请的完整变更内容：每项一行「现在 → 改后」；配置键放技术信息（对象原文在「对象」旁）。 */
function A2BatchReview({ items }: { items: readonly FBatchItem[] }) {
  const pages = fBatchPages(items);
  return (
    <section className="a2-change-review" aria-label="完整变更内容">
      <div className="a2-change-title">完整变更内容 · {items.length} 项
        <Explain label="技术信息" content={`各项配置键 ${items.map((item) => item.key).join("、")}`} /></div>
      <DiffList rows={items.map((item) => ({ key: item.key, label: fBatchLabel(item, pages), before: item.before, after: item.after }))}
        restTitle="没有改动的项" emptyNote="这些项没有改动" />
    </section>
  );
}
const REISSUE_INLINE = 5;
/** 申请单上能按记录号读的奖励记录：补发按原顺序，冲正和状态变更一笔；暂停、恢复只有用户和类型，不读。 */
const f5RecordIds = (fund: FundTicket | undefined): string[] => fund?.kind === "f5Reissue" ? fund.ids
  : (fund?.kind === "f5Status" || fund?.kind === "f5Reverse") && fund.eventId ? [fund.eventId] : [];
const kindNames = (kinds: readonly string[]) => kinds.map((kind) => F5_KIND_LABELS[kind] ?? "未知奖励类型").join("、");
const userCode = (id: string) => `U${id.padStart(8, "0")}`;
/** 兑付覆盖率：批准时后端到底查不查，按各类的回放方法核过的（8cf61c07）。认不出的类型只写页面自己拦的那一步。 */
const PAGE_COVERAGE_COPY = "页面读到的兑付覆盖率低于红线时不能批准。";
const F2_POLICY_COVERAGE = "批准时先查兑付覆盖率：读不到或低于红线就不执行，审批单留着待审批。";
function coverageFacts(w: { operationCode?: string | null; obj?: string; after?: string; action?: string }) {
  const fund = fundTicket(w);
  if (fund?.kind === "fConfig" && fund.spec?.loosen) return { lead: `这次${fund.spec.loosen}，会让平台多付钱`, check: "批准时先查兑付覆盖率：低于红线就不改，审批单留着待审批。" };
  if (fund?.kind === "f5Reissue") return { lead: "补发会给每笔生成一条新的应付奖励", check: "批准时先查兑付覆盖率，读不到或低于红线就不补，审批单留着待审批。" };
  if (w.operationCode === "f_seven_layer_activation" || w.operationCode === "f_direct_referral_policy") return { lead: undefined, check: F2_POLICY_COVERAGE };
  // OpsTeamService.initializeUnilevelRules：建规则前查兑付覆盖率，低于红线整单不执行。
  if (w.operationCode === "f_unilevel_bootstrap") return { lead: undefined, check: "批准时先查兑付覆盖率：低于红线就不建规则，审批单留着待审批。" };
  return undefined;
}

/**
 * 这三类批准被业务拒绝（后端在写任何东西之前拒，单子不变、锁还在）时，批准人看到的话：没执行、钱没动、单子还待审批、能做什么。
 * 覆盖率两句全站共用的说法不改（别处是直接执行），这里按批准的场景另写。重试被拒时原记录已清掉，同一句也成立。
 */
function approvalRefusedText(operationCode: string | null | undefined, cause: unknown) {
  const code = backendCode(cause);
  // A6 授权单：后端在改授权之前拒（OpsPlatformRoleService 审计角色只读门），授权、单子和锁都不动。
  if (code === "AUDIT_ROLE_WRITE_FORBIDDEN") return "审计角色只能有查看权限，这次批准没有执行，角色权限没有变；审批单还是待审批，不会自己结束。请驳回，或请发起人撤回。";
  // F 域配置（放宽方向）和 F5 补发：后端在改之前拒（OpsTeamService.updateUiConfig 等、F5CommissionService.reissueInternal），单子和锁都不动。
  if (code === "COVERAGE_BELOW_REDLINE" && F_CONFIG_CODES.includes(operationCode ?? "")) return "兑付覆盖率低于红线，这次批准没有执行，设置没有改；审批单还是待审批。等覆盖率恢复后再批准，或驳回。";
  if (code === "COVERAGE_BELOW_REDLINE" && operationCode === "f5_commission_reissue") return "兑付覆盖率低于红线，这次补发没有执行，一笔都没补；审批单还是待审批。等覆盖率恢复后再批准，或驳回。";
  // F2 首次配置：后端在写任何一行之前拒（OpsTeamService.initializeUnilevelRules），单子和锁都不动。
  if (operationCode === "f_unilevel_bootstrap") {
    if (code === "COVERAGE_BELOW_REDLINE") return "兑付覆盖率低于红线，这次批准没有执行，七层规则没有建；审批单还是待审批。等覆盖率恢复后再批准，或驳回。";
    if (code === "F2_UNILEVEL_RULES_ALREADY_CONFIGURED") return "团队购买奖励已经配置过，这次批准没有执行，规则没有改；审批单还是待审批。请驳回。";
  }
  // K1 两类：后端在改之前拒（RiskReleaseParamsService.applyApproved、EarningsReleaseService.manualReleaseOnce），单子和锁都不动。
  if (operationCode === "k1_release_param" || operationCode === "k1_earnings_release") {
    const kept = operationCode === "k1_release_param" ? "规则没有改" : "钱没有动";
    if (code === "K1_RELEASE_PARAM_STALE") return "这项规则在提交后被别人改过，这次批准没有执行，规则没有改；审批单还是待审批。请驳回，或请发起人撤回后重新提交。";
    if (code === "K1_EARNINGS_RELEASE_STALE") return "这笔收益在提交后有变化，这次批准没有执行，钱没有动；审批单还是待审批。请驳回，或请发起人撤回后重新提交。";
    if (code === "K1_EARNINGS_RELEASE_ENTRY_NOT_PROTECTED") return "这笔收益已全部追回或状态已变，这次批准没有执行，钱没有动；审批单还是待审批。请驳回，或请发起人撤回。";
    if (code === "COVERAGE_BELOW_REDLINE") return `兑付覆盖率低于红线，这次批准没有执行，${kept}；审批单还是待审批。等覆盖率恢复后再批准，或驳回。`;
    if (code === "K1_COVERAGE_UNAVAILABLE") return `兑付覆盖率暂时读不到，这次批准没有执行，${kept}；审批单还是待审批。等能读到后再批准，或驳回。`;
    return undefined;
  }
  const f4 = operationCode === "f4_pool_settle" || operationCode === "f4_leaderboard_period_payout";
  if (!f4 && operationCode !== "f_commission_status") return undefined;
  if (code === "COVERAGE_BELOW_REDLINE") return f4 ? "兑付覆盖率低于红线，这次批准没有执行，钱没有动；审批单还是待审批。等覆盖率恢复后再批准，或驳回。"
    : "兑付覆盖率低于红线，这次提前解锁没有执行，奖励还在冷却中；审批单还是待审批。等覆盖率恢复后再批准，或驳回。";
  if (code === "COVERAGE_SNAPSHOT_UNAVAILABLE") return f4 ? "兑付覆盖率暂时读不到，这次批准没有执行，钱没有动；审批单还是待审批。等能读到后再批准，或驳回。"
    : "兑付覆盖率暂时读不到，这次提前解锁没有执行，奖励还在冷却中；审批单还是待审批。等能读到后再批准，或驳回。";
  if (f4) return undefined;
  if (code === "COMMISSION_USER_SUSPENDED") return "这位用户的这类奖励正在暂停，这次提前解锁没有执行，奖励还在冷却中；审批单还是待审批。先在「奖励记录核对」的暂停名单恢复这类奖励再批准，或驳回。";
  if (code === "F5_COOLDOWN_DEADLINE_UNRECOVERABLE") return "这笔是以前暂停时冻结的旧记录，到期时间已被清空，这次解冻没有执行，奖励仍是已冻结；审批单还是待审批。请联系值班人员核对，或驳回。";
  return undefined;
}

/**
 * 批准、驳回要的权限，和后端 AuditReplayBusinessPermissionGuard 对齐（M5、F02、T02）。认单只用后端给的东西：
 * - 退款、J1 恢复、A4 登记、代金券、F5 暂停、试用扣费按后端给的 operationCode 和 fundEffect；
 * - 其余按后端写死的动作名、对象和摘要（validateProposalContext 等用命令生成的描述换掉发起方写的），
 *   手机规则单还有 phoneCalibrationProposal，大使申请有 ambassadorMaterialProposal；
 * - 账号类另认「操作员账号」页提交时写的动作名。
 * 协调人第五轮定的规则：能认出类型、后端规则也确认得了的，照后端精确判断；认不出类型、旧记录拿不到原单、
 * 条件判断不了（D7 摘要读不出是否强制倒挂、G4 摘要读不出动没动总量）的，有 A2 批准权就照常放出批准、驳回，
 * 标 backendChecks，页面写 BACKEND_CHECKS_NOTE；后端按权限拒绝时写清原因（decisionDeniedText）。
 */
/** 一项要的权限；数组是有其中一个就行。 */
/** Display context retained for legacy pending records; never used to grant approval. */
type DecisionRule = { backendChecks?: boolean };
type TicketIdentity = Pick<A2OperationRow, "action" | "obj" | "operationCode" | "fundEffect" | "before" | "after">
  & Partial<Pick<A2OperationRow, "phoneCalibrationProposal" | "ambassadorMaterialProposal" | "roleGate" | "canApprove" | "canReject" | "ruleTaskAction">>;
const A4_REGISTRY_CODES = ["a4_schema_register", "a4_schema_property_add", "a4_domain_extension_register"];
const J4_CODE = /^SOP-[A-Z0-9-]{1,64}$/;
/** 有专项审批、要另一位超管处理的单（各自的 validateChecker：超管＋A2 批准权，批准、驳回一样）。 */
const SUPER_ACTIONS = new Set([
  "放宽任务定价", "变更正式任务目录", // E2TaskPricingApproval
  "降低兑付覆盖率红线", "提高提现压力红线", // TreasuryThresholdApproval
  "首次发布奖励课程", "发布奖励课程版本", "回滚至较高奖励课程版本", "回滚至有奖励的课程版本", // LearningCourseActivationApproval; retain the legacy action gate.
  "放宽用户任务配置", // H3GrowthApproval
  "提高旧活动奖励", "开放旧活动资金奖励", "新增转盘奖项", "放宽转盘奖项配置", "删除转盘奖项并提高安慰奖", "提高转盘奖项概率",
  "启用活动或放宽转盘资金护栏", "发布历史活动只读记录", // H4GrowthApproval
  "放宽连签权益", "放宽收益里程碑", "放宽连签里程碑奖励", // H5GrowthApproval
  "提高新人 USDT 基础额", "提高新人 UVT 基础额", "提高邀请人 UVT 基础额", "改为符合资格就直接发", "启用新人礼与邀请奖励", // H8RewardParamApproval
  "手动结算团队平衡奖励", "提高区域大使申请预算", // TeamFundApproval
]);
const SUPER_ACTION_PATTERNS = [/^首次配置验证码设置 · /, /^放宽 \S+ 晋升条件$/, /^\S+ (?:新增|增加)资金奖励$/];
/**
 * 后端写死的动作名 → 批准要的业务权限（validateApproval 走 approvalAuthority 或 requiredAuthority）。
 * 这些单驳回只要 A2 批准权（validateRejection 对它们放行）。
 */
const CANONICAL_APPROVE = new Set(["调整设备型号", "结束未确认任务（不计收益）", "发布手机校准规则", "发布手机换机策略", "开启手机换绑", "关闭手机换绑", "开启电脑共享算力入口", "关闭电脑共享算力入口", "发布手机可跑任务", "发布规则任务", "USDT BEP20 充值政策", "首次配置 V0–V8", "七层结算启用", "七层结算暂停", "七层结算恢复", "好友奖励双币政策", "批准区域大使申请", "驳回区域大使申请", "调整每周任务地区映射", "批准取消成交奖励", "批准追回成交奖励", "执行指定新人邀请奖励结算", "执行邀请奖励真实结算"]);
/** 后端写成「名字 · 对象」的（descriptor、deviceDescriptor），驳回同样只要 A2 批准权。 */
const CANONICAL_WITH_OBJECT = new Set(["冻结账户", "恢复账户", "强制登出", "用户数据只读视图", "加入信任名单", "加入禁入名单", "移出账户名单", "终止模拟会话", "批量冻结关联账户", "解除误判", "判定为正常", "标记可疑账户簇", "标记套利账户", "拦截新人礼", "标记刷榜账户", "联动 K1 批量冻结", "强制激活设备", "解绑设备资产", "编辑账号资料", "变更角色", "重置两步验证", "启用/禁用账号"]);
/** 动作名前面是后端写死的部分，后面接对象。 */
const CANONICAL_APPROVE_PREFIX = ["更新 E3 生命周期配置 · ", "批量更新算力配置参数 · ", "调整通知优先级 CAP · ", "撤销奖励记录 ", "批量补发奖励 · ", "暂停用户奖励 ", "恢复用户奖励 ", "冻结奖励记录 ", "解冻奖励记录 ", "驳回奖励记录 ", "提前解锁奖励记录 ", "结算奖励记录 ", "发放奖励记录 ", "编辑账号 · ", "变更角色 · ", "重置两步验证 · ", "禁用账号 · ", "启用账号 · "];

/** 「F 域配置调整 · 键」批准要的权限，照后端 fConfigAuthority 按键分（三种 F 配置命令的键不重叠）。 */
function knownFConfig(key: string) {
  if (/^F\.unilevel\.(?:nex\.)?L[1-7]$/.test(key) || ["directRoyaltyPct", "networkRoyaltyPct", "binaryPairRatePct", "maxCombinedOutflowPct",
    "minPayoutUsdt", "F.promo.weekMultiplier", "F.peer.rate"].includes(key)) return true;
  if (["rankWindowDays", "hardwareQuotaPerRank"].includes(key)) return true;
  if (["F.prize.name", "F.vrank.titles"].includes(key)) return true;
  if (key === "F.vrank.permanent") return true;
  if (["F.influence.clampMin", "F.influence.clampMax", "F.cooldown", "F.partner.tiers", "F.royalty.minPayout", "F.unilevel.depthGate",
    "F.unilevel.nexCap", "F.unilevel.backfill", "F.unilevel.depth", "F.sunset.exclusions"].includes(key) || /^F\.unilevel\.L[1-7]\.paused$/.test(key)) return true;
  if (key === "F.binary.paused") return true;
  if (key.startsWith("F.binary.")) return true;
  if (key.startsWith("F3.dailyCap.")) return true;
  if (key.startsWith("F.pool.votes.") || key.startsWith("F.quota.")) return true;
  if (key.startsWith("F.ambassador.") && key.endsWith(".status")) return true;
  if (["F.pool.monthlyCap", "F.pool.settleCron", "F.pool.unlockVRank", "F.leaderboard.minUsd"].includes(key)) return true;
  if (key === "F.leaderboard.poolUsd") return true;
  if (key.startsWith("F.leaderboard.")) return true;
  if (key.startsWith("F.pool.")) return true;
  return false;
}

/** J4 执行应急预案：后端逐步执行，中途失败时前面的步骤可能已经生效（J4_EXECUTION_PARTIAL）。 */
function isJ4Execution(w: Pick<A2OperationRow, "action" | "obj">) {
  return J4_CODE.test(w.obj) && w.action === `执行应急剧本 · ${w.obj}`;
}

/**
 * D7 放宽单是不是强制保存倒挂价：后端预览摘要（PayoutVndConfigService.previewValues）以「vN spread=」开头，
 * 强制时末尾写 forceInverted。摘要不是这个格式（旧记录没存、读不到原单）就判断不了，返回 undefined。
 */
function d7ForceInverted(after: string) {
  return /^v\d+ spread=/.test(after.trim()) ? /\bforceInverted\b/.test(after) : undefined;
}

/** G4 档位单动没动总供应量：后端两份摘要都写「· 总量 N ·」（G4CatalogApproval.summary）。有一份读不出就判断不了。 */
function g4ChangesSupply(w: Pick<A2OperationRow, "before" | "after">) {
  const supply = (text: string) => / · 总量 (\d+) · /.exec(text)?.[1];
  const before = supply(w.before);
  const after = supply(w.after);
  return before && after ? before !== after : undefined;
}

/** Presentation-only: retain existing backend-check notes without copying business permissions. */
function decisionRule(w: TicketIdentity): DecisionRule {
  const code = w.operationCode ?? "";
  if (["h1_phase_dial", "c2_session_revoke_all", "h5_power_up_config", "h5_earn_milestone", "h5_streak_milestone", "g2_exchange_param", "g7_repurchase_param", "g4_genesis_param", "e4_order_refund", "j1_gate_resume", "f5_commission_suspension", "h2_trial_charge"].includes(code)
    || !code && w.action.startsWith("强制登出 · ") || w.fundEffect === "ORDER_REFUND" || A4_REGISTRY_CODES.includes(code) || isH7VoucherApproval(code)
    || w.action === `兑换参数调整 · ${w.obj}` || w.action === `回购参数调整 · ${w.obj}` || w.action === `调整创世参数 · ${w.obj}`) return {};
  if (w.obj === "current" && w.action === "放宽越南盾提现参数") return { backendChecks: d7ForceInverted(w.after) === undefined };
  if (w.obj === "tiers" && w.action === "调整创世节点价格档位") return { backendChecks: g4ChangesSupply(w) === undefined };
  if (w.obj === "current" && ["调整敏感汇率", "放宽提现参数"].includes(w.action) || SUPER_ACTIONS.has(w.action) || SUPER_ACTION_PATTERNS.some(pattern => pattern.test(w.action)) || isG3Policy(w)
    || w.action === "批准创世分红操作" || w.roleGate === "超管" && /^.+ · r\d+ · \S+ UVT$/.test(w.before) && /^.+ · \S+ UVT$/.test(w.after)
    || isJ4Execution(w) || w.phoneCalibrationProposal || w.obj === "phone-calibration" || w.ambassadorMaterialProposal || w.obj.startsWith("E.compute.") || CANONICAL_APPROVE.has(w.action)) return {};
  const suffix = ` · ${w.obj}`;
  if (w.obj && w.action.endsWith(suffix) && CANONICAL_WITH_OBJECT.has(w.action.slice(0, -suffix.length))
    || w.action === `F 域配置调整 · ${w.obj}` && knownFConfig(w.obj) || CANONICAL_APPROVE_PREFIX.some(prefix => w.action.startsWith(prefix))) return {};
  return { backendChecks: true };
}

/** 手机规则申请带未来的生效时间时，批准只登记排程，到点才生效（M6）。effectiveAt 是毫秒，0 是批准后立即。 */
function phoneScheduledAt(w: A2OperationRow) {
  const at = w.phoneCalibrationProposal?.effectiveAt;
  return typeof at === "number" && at > Date.now() ? `${businessStamp(at)}（${businessZone().label}）` : undefined;
}

/** 批准后什么时候生效、会怎样：标题下的标签、执行摘要的影响、抽屉底部说明用同一份（M3、M6）。 */
function monthlyTargetChange(w: Pick<A2OperationRow, "action" | "before" | "after">) {
  if (w.action !== "调整设备型号") return null;
  const before = parseReview(w.before), after = parseReview(w.after);
  if (after?.kind !== "object") return null;
  const was = before?.kind === "object" ? before.value : {};
  if (after.value.clearMonthlyTarget === true) return "close";
  return ["monthlyTargetUsdt", "monthlyTargetBandPct"].some((key) => !same(was[key] ?? null, after.value[key] ?? null)) ? "target" : null;
}

function approvalTiming(w: A2OperationRow) {
  const monthlyChange = monthlyTargetChange(w);
  if (monthlyChange) {
    const impact = monthlyChange === "close"
      ? "批准后保存并关闭月收益目标；已有发布历史的型号之后新建的任务恢复按单计价。未首次发布的草稿在首次上架时发布；已建任务和历史到账不变。"
      : "批准后保存新目标；已有发布历史的型号按新目标建立后续任务。未首次发布的草稿在首次上架时发布；已建任务和历史到账不变。";
    return { tag: "批准后保存", impact, drawer: `${impact}点「驳回」原操作不执行。` };
  }
  const scheduled = phoneScheduledAt(w);
  if (scheduled) return { tag: `按计划在 ${scheduled} 生效`, impact: "批准后登记排程，到点才生效。", drawer: `点「批准」确认后登记排程，到 ${scheduled} 生效；点「驳回」原操作不执行。` };
  if (isJ4Execution(w)) return { tag: "立即逐步执行", impact: "批准后逐步执行，可能只执行一部分；失败时到「监管要求应急处理」的执行追溯里看哪些步骤已生效。", drawer: "点「批准」确认后逐步执行，可能只执行一部分；点「驳回」原操作不执行。" };
  if (w.coverageCheckOnApproval) return { tag: "通过覆盖率检查后执行", impact: "", drawer: "点「批准」确认后先检查兑付覆盖率，够了才执行；点「驳回」原操作不执行。" };
  if (w.operationCode === "k1_release_param") return { tag: "核对通过后执行", impact: "", drawer: "点「批准」确认后先核对规则没被改过、兑付覆盖率够，才改；点「驳回」原操作不执行。" };
  if (w.operationCode === "k1_earnings_release") return { tag: "核对通过后执行", impact: "", drawer: "点「批准」确认后先核对这笔收益没变、兑付覆盖率够，才放行；点「驳回」原操作不执行。" };
  const fund = fundTicket(w);
  if (fund?.kind === "f4Payout" || fund?.kind === "f4Settle") return { tag: "通过覆盖率检查后执行", impact: "", drawer: "点「批准」确认后先查兑付覆盖率，够了才发钱；点「驳回」原操作不执行。" };
  if (fund?.kind === "f5Status" && fund.state === "unlocked") return { tag: "核对通过后执行", impact: "", drawer: "点「批准」确认后先核对，通过了才放钱；点「驳回」原操作不执行。" };
  if (w.amplifies && fund?.kind === "fConfig" && fund.spec?.loosen) return { tag: "通过覆盖率检查后执行", impact: "", drawer: "点「批准」确认后先查兑付覆盖率，够了才改；点「驳回」原操作不执行。" };
  if (fund?.kind === "f5Reissue") return { tag: "通过覆盖率检查后执行", impact: "", drawer: "点「批准」确认后先查兑付覆盖率，够了才补发；点「驳回」原操作不执行。" };
  if (g3PolicyExecutionTiming(w)) return { tag: "按计划时点生效", impact: "", drawer: "点「批准」确认后按生效时间执行；点「驳回」原操作不执行。" };
  return { tag: "立即生效", impact: "", drawer: "点「批准」确认后立即执行，失败不改原值；点「驳回」原操作不执行。" };
}

function roleText(role: string) {
  return ["super", "superadmin", "super_admin", "超管"].includes(role.trim().toLowerCase()) ? "超级管理员" : role;
}

/** 操作记录的角色码写中文，和待审批的发起人同一套名字（DP-30、DT-14）。ADMIN 是兜底的执行者类型，不是角色，不写；对不上的码也不写，原码在记录抽屉的技术信息里。 */
function logRoleText(code: string) {
  const raw = code.trim();
  if (!raw || raw === "—" || raw.toUpperCase() === "ADMIN") return "";
  if (raw.toUpperCase() === "USER") return "用户";
  const role = normalizeSessionRole(raw);
  const label = roleLabel(role);
  return label === role && label === raw ? "" : label;
}

/** 长编号（订单号、提现单号）中间省略，留住区分用的前后段，全文在 title（同 D2 的提现单号）。 */
function shortCodes(text: string) {
  return text.replace(/[A-Z][A-Z0-9]*-[A-Z0-9-]{16,}/g, (code) => `${code.slice(0, 12)}…${code.slice(-6)}`);
}

/** 理由里的工单号、订单号整段不拆（必须改 14）：编号包一层不换行，放不下时整段换到下一行。 */
function keepCodes(text: string): ReactNode {
  // 编号前面的两个字（「工单」「订单」）和编号连在一起，不在词中间折行。
  const parts = text.split(/((?:[\u4e00-\u9fa5]{2} ?)?[A-Z][A-Z0-9]*-[A-Z0-9-]+)/);
  return parts.length === 1 ? text : parts.map((part, index) => index % 2 ? <span key={index} className="a2-code">{part}</span> : part);
}

/** 记录的对象是「类型 · 编号」：编号放第一行，长的中间省略留住前后段，类型放第二行（必须改 8）。 */
function objectCell(obj: string) {
  if (F_BATCH_DIGEST.test(obj)) return { main: "整批调整的团队参数", sub: undefined };
  const [kind, ...rest] = obj.split(" · ");
  if (!rest.length) return { main: middle(shortCodes(obj), 20), sub: undefined };
  const id = rest.join(" · ");
  return { main: id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id, sub: kind };
}

/** 没翻成中文的动作码太长时中间省略：前面是模块，后面是动作，两头都要留。 */
function middle(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 9)}…${text.slice(-8)}` : text;
}

function actionName(ticket: string | { action: string; obj?: string; after?: string; operationCode?: string | null; ruleTaskAction?: A2OperationRow["ruleTaskAction"] | null }) {
  if (typeof ticket !== "string" && (ticket.operationCode === "k1_release_param" || ticket.operationCode === "k1_earnings_release")) return A2_ACTION_NAMES[ticket.operationCode];
  if (typeof ticket !== "string" && ticket.operationCode === "j1_gate_resume" && ticket.obj) return `恢复业务开关 · ${j1GateName(ticket.obj)}`;
  // H3：和 H3 页改值框、新建抽屉的标题同名。审批结果里没有对象，照原动作名。
  if (typeof ticket !== "string" && ticket.operationCode === "h3_quest_config" && ticket.obj && h3ConfigName(ticket.obj)) return `改${/^P\d/.test(h3ConfigName(ticket.obj)!) ? " " : ""}${h3ConfigName(ticket.obj)}`;
  if (typeof ticket !== "string" && ticket.operationCode === "h3_mission_create" && ticket.after) {
    const mission = h3MissionView({ operationCode: ticket.operationCode, after: ticket.after });
    if (mission) return `新建${mission.type}`;
  }
  if (typeof ticket !== "string" && ticket.ruleTaskAction) {
    return ({ CREATE: "新增手机任务", UPDATE: "编辑手机任务", ENABLE: "启用手机任务", DISABLE: "停用手机任务" })[ticket.ruleTaskAction];
  }
  // 和 F4 页确认框的标题同名；审批结果里没有对象，认不出是哪个榜时只写「排行榜」。
  const fund = typeof ticket === "string" ? undefined : fundTicket(ticket);
  if (fund?.kind === "f4Payout") return fund.period === "总榜" ? "发放总榜奖励" : fund.period ? `发放${fund.period}奖励` : "发放排行榜奖励";
  if (fund?.kind === "f4Settle") return "提前结算本周团队激励池";
  if (fund?.kind === "fConfig") return fund.spec?.action ?? "调整未识别的配置项";
  if (fund?.kind === "f5Suspension") return `${fund.suspended ? "暂停" : "恢复"}用户奖励${fund.userId ? ` · ${userCode(fund.userId)}` : ""}`;
  if (fund?.kind === "f5Reissue") return fund.count ? `批量补发 ${fund.count} 笔奖励` : "批量补发奖励";
  if (fund?.kind === "f5Reverse") return `冲正奖励记录${fund.eventId ? ` ${fund.eventId}` : ""}`;
  const batchCount = F_BATCH_ACTION.exec(typeof ticket === "string" ? ticket : ticket.action)?.[1];
  if (batchCount) return `整批调整团队参数 · ${batchCount} 项`;
  const action = typeof ticket === "string" ? ticket : ticket.operationCode === "h5_streak_milestone" ? "放宽连签里程碑奖励" : ticket.action;
  const gParam = G_PARAM_ACTION.exec(action);
  if (gParam) return `${gParam[1] === "回购参数调整" ? "锁定计划参数调整" : gParam[1]} · ${G_PARAM_NAMES[gParam[2]] ?? gParam[2]}`;
  return a2ActionText(nexGridBrandText(action));
}

/** 本页的码翻中文；别的模块的码原样，等宽显示。 */
function logActionText(code: string) {
  return A2_ACTION_NAMES[code] ?? a2ActionText(code);
}

/** 前 → 后里后端存的 true / false 写成是 / 否，原文在抽屉的技术信息里。 */
function logDeltaText(delta: string) {
  return delta.split(" → ").map((part) => part === "true" ? "是" : part === "false" ? "否" : part).join(" → ");
}

/** 动作名的显示：认得出的写中文；没收录的动作码写「未识别的操作」，原码在抽屉的技术信息里；本来就是中文的照写。 */
function logActionShown(code: string) {
  const text = logActionText(code);
  return text === code && /^[A-Za-z][\w.:-]*$/.test(code) && /[_.:]|[a-z][A-Z]/.test(code) ? { text: "未识别的操作", raw: code } : { text };
}

/** 操作记录对象是配置键时，写对应页面上这一项的名字（G2 兑换参数各行；A3 界面语言表的两列）。A3 整组保存记在分享链接键上，只写类型「App 分享与下载」。 */
const AUDIT_CONFIG_KEY_NAMES: Record<string, string> = {
  "wallet.exchange.user_daily_cap_usdt": "单用户日额度", "wallet.exchange.platform_daily_cap_usdt": "平台日额度",
  "wallet.exchange.fee_pct": "兑换手续费率", "wallet.exchange.fee_min_usdt": "最低手续费", "wallet.exchange.queue_mode": "超额度处置策略",
  "wallet.exchange.queue_eta_hours": "预计处理时长", "wallet.exchange.queue_eta_copy": "英文预计说法", "wallet.exchange.queue_eta_copy_zh": "中文预计说法", "wallet.exchange.queue_eta_copy_vi": "越南语预计说法",
  "platform.experience.interface_languages": "界面语言 · App 里可选", "platform.experience.operating_languages": "界面语言 · 发布时必填",
};

/** 配置键、接口路径、页面编号、全大写或驼峰的代码：只给技术同事看，不当对象编号显示。 */
const INTERNAL_OBJECT_ID = /^\/|^[A-Za-z][\w-]*(?:\.[\w-]+)+$|^[A-Z]+(?:_[A-Z0-9]+)*$|^[a-z0-9]+(?:_[a-z0-9]+)+$|^[a-z]+[A-Z]\w*$|^[A-M]\d{1,2}$/;

/**
 * 操作记录的对象。后端只给「类型码 · 编号」时（a2-policy resolveA2AuditObject），类型码换成中文名，内部编号不摆出来；
 * 换掉或藏起来的原文带在 raw 里，进抽屉的技术信息。后端写了对象说明的照原样。
 */
function logObject(l: A2AuditLogRow): { kind?: string; id?: string; raw?: string } {
  const type = l.resourceType?.trim() ?? "", rid = l.resourceId?.trim() ?? "";
  const derived = !!type && [`${type} · ${rid}`, type].includes(l.obj);
  if (!derived) {
    const [kind, ...rest] = l.obj.split(" · ");
    return rest.length ? { kind, id: rest.join(" · ") } : { id: l.obj };
  }
  const kind = AUDIT_RESOURCE_NAMES[type] ?? (h3ConfigName(rid) ? "用户任务设置" : undefined);
  const id = rid.replace(/^[A-Z][A-Z0-9_]*:(?=\S)/, "");
  const named = h3ConfigName(id) ?? AUDIT_CONFIG_KEY_NAMES[id];
  const shownId = named ?? (!id || id === type || INTERNAL_OBJECT_ID.test(id) ? undefined : id);
  const hidden = !AUDIT_RESOURCE_NAMES[type] || shownId !== id;
  return { kind: shownId || kind ? kind : "未识别的对象", id: shownId, raw: hidden ? l.obj : undefined };
}

/** 后端时间是存储时钟、没有时区，按业务时区显示（TX-25、TX-26）。只到分钟时补秒再解析。 */
function bizTime(value: string | undefined, fallback: string) {
  if (!value?.trim()) return fallback;
  const text = /[T ]\d{2}:\d{2}$/.test(value.trim()) ? `${value.trim()}:00` : value.trim();
  return formatBusinessTimeCompact(text, fallback);
}

function bizTimeFull(value: string | undefined, fallback: string) {
  if (!value?.trim()) return fallback;
  const text = /[T ]\d{2}:\d{2}$/.test(value.trim()) ? `${value.trim()}:00` : value.trim();
  return formatBusinessTimeFull(text, fallback);
}

/** 当年的时间不写年（「11-08 17:08」），1024 下表格才放得下（必须改 6、8）。 */
function thisYear(full: string) {
  const year = businessStamp(Date.now()).slice(0, 5);
  return full.startsWith(year) ? full.slice(5) : full;
}

/** 队列第二行的提交时间放在单号前面，放不下时省略的是单号（必须改 6）。 */
function queueTime(w: A2OperationRow) {
  return thisYear(bizTime(w.rawTs, w.ts));
}

/** a2-client 没有 tsLabel 时按浏览器时区写成「11/08 14:30」；那种情况改按业务时区重写，有 tsLabel 时用它（a2-client.ts:378）。 */
const BROWSER_STAMP = /^\d{2}\/\d{2} \d{2}:\d{2}$/;
function logTime(log: A2AuditLogRow) {
  return log.ts !== "—" && !BROWSER_STAMP.test(log.ts) ? log.ts : bizTime(log.createdAt, log.ts);
}

/** 处理人：后端是「发起人:x → 审批人:y · reason + admin.operation_z」，表格写「审批人 y」，系统尾巴进技术信息。 */
function historyActors(chain: string) {
  const match = /^发起人:(.+?) → (审批人|撤回人|执行人):(.+?) · /.exec(chain);
  return match ? { proposer: match[1], role: match[2], actor: match[3] } : null;
}

function historyActorText(chain: string) {
  const actors = historyActors(chain);
  return actors ? `${actors.role} ${actors.actor}` : chain.split(" · ")[0];
}

const count = (value: number) => value.toLocaleString("en-US");
const filterEmpty = (filter: A2AuditFilter) => Object.keys(normalizeA2AuditFilter(filter)).length === 0;
const sameFilter = (a: A2AuditFilter, b: A2AuditFilter) => FILTER_PARAMS.every((key) => (a[key] ?? "") === (b[key] ?? ""));

/** 网址里写输入框的原值，补 :59.999 只在发请求时做（a2-policy normalize）。模块按 parseA2FilterQuery 校验。 */
function readRoute(search: string) {
  const params = new URLSearchParams(search);
  const filter: A2AuditFilter = {};
  const domain = parseA2FilterQuery(params).domain;
  if (domain && domain !== "all") filter.domain = domain;
  for (const key of ["operator", "action", "object", "startTime", "endTime"] as const) {
    const value = params.get(key)?.trim();
    if (value) filter[key] = value;
  }
  const hasFilter = Object.keys(filter).length > 0;
  const tabParam = params.get("tab");
  const tab: A2Tab = tabParam === "records" || tabParam === "settings" ? tabParam : !tabParam && hasFilter ? "records" : "pending";
  const type = params.get("type");
  const role = params.get("operatorRole");
  const page = Number(params.get("page"));
  const pageSize = Number(params.get("pageSize"));
  const returnTo = params.get("returnTo") ?? "";
  return {
    filter,
    entered: hasFilter ? filter : null,
    tab,
    view: (params.get("list") === "history" ? "history" : "logs") as RecordView,
    type: (TYPE_ITEMS.some((item) => item.value === type) ? type : "all") as QType,
    role: (OPERATOR_OPTIONS.some((item) => item.value === role) ? role : "all") as QOperator,
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    pageSize: LOG_PAGE_SIZES.some((size) => size === pageSize) ? pageSize : 10,
    // 只认站内用户详情的地址，别的不当返回入口（PG-17）。
    returnTo: /^\/users\/search\/[^/?#]+/.test(returnTo) ? returnTo : "",
  };
}

/* ────────────────── 结果未知的命令 ────────────────── */

type A2CommandKind = "approve" | "reject" | "withdraw" | "param" | "retention" | "export";
type A2PendingCommand = PendingMutationRecord & {
  kind: A2CommandKind;
  /** 待确认条上写的「做了什么」。 */
  label: string;
  /** 审批单号、参数键、retention 或 export。 */
  target: string;
  reason: string;
  operator: string;
  /** 机制参数的新值。 */
  value?: string;
  /** Confirmed retention policy; absent only on commands saved by the old client. */
  expectedRetentionMonths?: number;
  /** 旧待确认的展示上下文；资格只读后端回执，原键恢复仍由服务端核权。 */
  rule?: (DecisionRule & { unmapped?: boolean }) | null;
  operationCode?: string;
  obj?: string;
  fundEffect?: A2OperationRow["fundEffect"];
  /** 退款单的原订单号：重试前要先读到退款金额（F01）。 */
  refundOrderNo?: string;
  refundAmountUsdtText?: string;
  /** 审批单的原动作，重试时写进标签。 */
  action?: string;
  ruleTaskAction?: A2OperationRow["ruleTaskAction"];
  /** 导出时已应用的筛选：重试只用这一份，不读页面上现在的条件（M2）。 */
  filter?: A2AuditFilter;
};
type A2PendingExtra = PendingMutationExtra<A2PendingCommand>;

const a2Commands = createPendingMutationStore<A2PendingCommand>({
  storageKey: "nexion-admin-a2-commands-v1",
  // 过期后不能再用原号重试，记录和锁都留着（OP-96）。
  retainExpiredRecords: true,
  isValidRecord: record => (record.refundAmountUsdtText === undefined
    || typeof record.refundAmountUsdtText === "string" && /^\d+(?:\.\d{1,6})?$/.test(record.refundAmountUsdtText) && /[1-9]/.test(record.refundAmountUsdtText))
    && (record.expectedRetentionMonths === undefined || Number.isSafeInteger(record.expectedRetentionMonths) && Number(record.expectedRetentionMonths) > 0),
});

type RefundAmount = { state: "loading" } | { state: "ok"; amount: string } | { state: "error"; message: string };
const REFUND_AMOUNT_REQUIRED = "先读到退款金额才能批准";

const DECISION_VERB: Record<"approve" | "reject" | "withdraw", string> = { approve: "批准", reject: "驳回", withdraw: "撤回" };
const DECISION_STATUS: Record<"approve" | "reject" | "withdraw", A2OperationRow["status"]> = { approve: "approved", reject: "rejected", withdraw: "withdrawn" };
const RECOVERY_HINT: Record<A2CommandKind, string> = {
  approve: "查询只能看到这张单现在的状态，证明不了这次操作的结果。可以按原请求重试，不会重复执行。",
  reject: "查询只能看到这张单现在的状态，证明不了这次操作的结果。可以按原请求重试，不会重复执行。",
  withdraw: "查询只能看到这张单现在的状态，证明不了这次操作的结果。可以按原请求重试，不会重复执行。",
  param: "查询只能看到现在的值，值相同也可能是别人改的。可以按原请求重试，不会重复执行。",
  retention: "查询只能看到最近一次手动清理。可以按原请求重试，不会重复清理。",
  export: "查询只能看到有没有这次的导出记录。可以按原请求重试，按当时的条件重新下载。",
};
const PARAM_NAME: Record<string, string> = { ttl: "操作理由最短长度", retention: "操作记录保留期", schema: "记录字段版本" };
const PARAM_TITLE: Record<"ttl" | "retention" | "schema", string> = { ttl: "调整操作理由最短长度", retention: "调整操作记录保留期", schema: "升级记录字段版本" };
const RETENTION_TITLE = "清理到期记录";
const PARAM_AUDIT_OBJECT: Record<A2CommandKind, string | undefined> = { approve: undefined, reject: undefined, withdraw: undefined, param: "A2_MECHANISM_PARAM", retention: "A2_AUDIT_RETENTION", export: undefined };

function backendCode(error: unknown) {
  return error instanceof Error && "backendMessage" in error && typeof error.backendMessage === "string" ? error.backendMessage : "";
}

/**
 * 后端按业务权限拒绝批准、驳回（validateProposal 回的 A2_BUSINESS_PERMISSION_DENIED:权限码）：写清是权限不够、单子没动，带上后端给的权限码。
 * 这是带原因码的明确拒绝，首次提交照常丢号，不算结果未知（第五轮）。其他专项审批的拒绝码已有各自的中文。
 */
function decisionDeniedText(kind: "approve" | "reject", cause: unknown, retry = false) {
  const code = backendCode(cause);
  if (!code.startsWith("A2_BUSINESS_PERMISSION_DENIED")) return undefined;
  const missing = /^A2_BUSINESS_PERMISSION_DENIED:([A-Za-z0-9_]+)$/.exec(code)?.[1];
  const denied = `这个账号没有这张单要的业务权限，这次${kind === "approve" ? "批准" : "驳回"}被拒绝`;
  // 重试被拒说明不了原操作的结果，后半句由重试那边写。
  return retry ? `${denied}${missing ? `（缺的权限编码 ${missing}）` : ""}` : `${denied}。${kind === "approve" ? "原操作没有执行" : "这张单没有驳回"}，还是待审批；请换有这项权限的管理员处理${missing ? `（缺的权限编码 ${missing}）` : ""}。`;
}

/** 后端现在写「统一字段 · v3」，parseA2SchemaVersion 只认旧的「统一 schema · v3」，认不出时取里面的版本号。 */
function schemaVersion(value: string | undefined) {
  const parsed = parseA2SchemaVersion(value);
  return /^v\d+$/.test(parsed) ? parsed : value?.match(/\bv\d+\b/)?.[0] ?? "";
}

function paramReadback(overview: A2Overview, key: string) {
  const value = overview.mechanismParams.find((item) => item.key === key)?.value;
  return key === "schema" ? schemaVersion(value) : value?.match(/\d+/)?.[0];
}

const PARAM_ORDER = ["reason_required", "ttl", "retention", "schema", "confirm_list"];

function ticketStatus(overview: A2Overview | null, id: string) {
  const history = overview?.operationHistory.find((item) => item.id === id);
  if (history) return { status: history.st, actor: historyActors(history.chain)?.actor };
  const ticket = overview?.operationQueue.find((item) => item.id === id);
  return ticket ? { status: ticket.status, actor: undefined } : null;
}

/* ────────────────── 完整变更内容 ────────────────── */

const CHANGE_LABELS: Record<string, string> = {
  skuId: "商品编号", id: "商品编号", name: "商品名称", tier: "商品档位", tagline: "卖点", badge: "角标",
  gpu: "GPU", vram: "显存", hashRate: "算力", power: "功耗", datacenter: "托管机房", allowedPoolCodes: "任务等级", uptime: "在线率",
  warranty: "保修", phoneDailyEarn: "手机日产收益", phoneDailyEarnNex: "手机日产 UVT", price: "价格", computePoints: "每件算力点",
  dailyEarn: "日产收益", dailyEarnNex: "日产 UVT", shareYieldMin: "份额收益下限", shareYieldMax: "份额收益上限",
  monthlyTargetUsdt: "月收益目标", monthlyTargetBandPct: "允许波动", clearMonthlyTarget: "关闭月收益目标",
  baseRate: "收益展示文字", sold: "累计销量", stock: "库存", rating: "评分", reviews: "评价数",
  aiImageGenPerMin: "图像生成性能", aiLlmTokensPerSec: "大模型推理性能", aiVideoMinPerHour: "视频渲染性能",
  aiFineTuneMins: "LoRA 微调性能", aiUnlocks: "解锁算力池", features: "产品特性", generation: "产品代际",
  lifecycle: "生命周期", supersededBy: "后继商品", tradeinDiscount: "换新折扣", unlockPhase: "解锁阶段",
  purchaseGate: "购买限制", imageAssetId: "产品图编号", imageObjectKey: "产品图存储位置", imagePreviewUrl: "产品图预览",
  tag: "商品标签", status: "商城状态", inventoryMode: "库存模式", expectedUpdatedAt: "修改前的更新时间",
  updatedAt: "更新时间", trialEligible: "允许试用", productType: "商品类型", reason: "操作理由", operator: "操作人",
  rankMin: "最低 V 等级", directsMin: "最低有效直接邀请", teamUsdtMin: "最低团队订单额", mode: "条件组合",
  activeDirectMin: "最低有效直接邀请", teamComputePointsMin: "最低团队算力点",
  enforce: "启用限制", quotaCap: "总配额", quotaSold: "已用配额", quotaPeriod: "配额周期",
  ranks: "会员等级", rankCode: "等级", titleCn: "中文头衔", titleEn: "英文头衔",
  selfComputePoints: "自购算力点", directRefs: "直接邀请人数", teamComputePoints: "团队算力点",
  requiredDownlineRank: "分支最低等级", requiredDownlineCount: "达标分支数", unilevelDepth: "团队购买奖励范围",
  peerBonusRate: "同级奖比例", leadershipVotes: "团队激励池票数", rewards: "晋升奖励",
};
// Only these three reward contracts override the shared product-field vocabulary.
const HI_CHANGE_LABELS: Record<string, string> = {
  ...CHANGE_LABELS,
  eventCode: "活动编号", rewardName: "奖励名称", rewardType: "奖励资产", rewardAmount: "发放数量",
  value: "目标值", expectedValue: "原值", tierName: "奖项编号", rewardKind: "奖励类型",
  probabilityPct: "概率（%）", realOutflow: "实际资金流出", dailyStock: "每日库存（0 为不限）",
  expectedSignature: "提交时的奖池核对码", wheelSignature: "奖池核对码", tiers: "奖池档位",
  wheelEvidence: "核对证据", wheelSnapshot: "原奖池内容",
  courseId: "课程编号", version: "课程版本", revision: "修改序号", rewardNex: "奖励（UVT）",
  sourceStatus: "目标版本原状态", expectedRevision: "目标版本的修改序号", expectedCurrentVersion: "当前课程版本",
  expectedCurrentRevision: "当前课程的修改序号", expectedCurrentStatus: "当前课程状态",
  tier: "奖项编号", status: "状态", reward: "奖励名称", prob: "概率（%）", kind: "奖励类型", amount: "发放数量", real: "实际资金流出",
  voucherId: "代金券编号", category: "课程分类", format: "课程形式", level: "难度", duration: "时长",
  titleZh: "中文标题", titleEn: "英文标题", titleVi: "越南语标题", bodyZh: "中文正文", bodyEn: "英文正文", bodyVi: "越南语正文",
  quizQuestions: "测验题", passScore: "及格题数", retryLimit: "可重试次数", completionCondition: "完成条件", rewardEvent: "奖励事件",
  courseTarget: "目标版本的其他内容", field: "内容", content: "目标版本",
};
const WHEEL_REVIEW_OPERATIONS = ["h4_wheel_tier_create", "h4_wheel_tier_update", "h4_wheel_tier_delete", "h4_wheel_probabilities_update"];
const COURSE_REVIEW_OPERATIONS = ["i7_course_first_publish", "i7_course_version_publish", "i7_course_version_rollback"];
const hiReviewLabels = (operationCode?: string) => ["h4_legacy_event_reward_update", ...COURSE_REVIEW_OPERATIONS, ...WHEEL_REVIEW_OPERATIONS].includes(operationCode ?? "") ? HI_CHANGE_LABELS : CHANGE_LABELS;
const G_PARAM_ACTION = /^(兑换参数调整|回购参数调整|调整创世参数) · ([A-Za-z]+)$/;
/** G2、G4、G7 的参数审批单：对象是参数键，给运营看参数名，键收进技术信息。 */
const isGParamTicket = (w: { operationCode?: string | null; action: string }) =>
  ["g2_exchange_param", "g7_repurchase_param", "g4_genesis_param"].includes(w.operationCode ?? "") || G_PARAM_ACTION.test(w.action);
const reviewOperation = (w: { operationCode?: string; action: string }) =>
  ["g2_exchange_param", "g7_repurchase_param", "g4_genesis_param"].includes(w.operationCode ?? "") || !w.operationCode && G_PARAM_ACTION.test(w.action)
    ? "g_param" : w.operationCode ?? REVIEW_OPERATION_BY_ACTION[w.action];
/** G2、G4、G7 参数的页面名字，和三页参数行一致（G4 取后端 GenesisParamDef 的名字）。 */
const G_PARAM_NAMES: Record<string, string> = {
  userDailyCap: "单用户日额度", platformDailyCap: "平台日额度", fee: "兑换手续费率", feeMin: "最低手续费", queueMode: "超额度处置策略",
  apy: "参考年奖励率", lockDays: "锁仓期限", nurture: "好友升级奖励倍率", lottery: "创世节点抽奖券", penalty: "提前解锁扣款", presets: "锁定金额快捷选项",
  supply: "节点总量", price: "系列当前价（分红计价）", dividend: "每日收益比例", royalty: "内部转售手续费", divBase: "收益计算基数",
  airdropPct: "空投占比", emissionCurve: "收益发放曲线", airdropLockDays: "早期持有人奖励锁仓期",
};
// 空值（比如 divBase 合法为空）读进来时末尾的空格已被去掉，等号后面直接结束，写成「= 空」；新单的参数名已是中文，同样补「空」。
// 新增应付后端写「确定新增应付 Δ 12 USDT」，写成「新增应付 12 USDT」。
const gParamText = (text: string) => text.replace(/(^|· )([A-Za-z]+) =( |$)/g, (whole, lead: string, key: string, tail: string) => G_PARAM_NAMES[key] ? `${lead}${G_PARAM_NAMES[key]} =${tail || " 空"}` : whole)
  .replace(/ =$/, " = 空").replace(/确定新增应付 Δ /g, "新增应付 ").replace(DIV_BASE_FORMULA, DIV_BASE_TEXT);
/** H3 审批单对象的配置键写 H3 页上这一项的叫法（H3 页的设置名和改值框标题）。 */
function h3ConfigName(key: string): string | undefined {
  if (key === "dayOne.triReward") return "新手任务奖励";
  const m = /^weekly\.mult\.(P[1-6])$/.exec(key) ?? /^(mission|monthly)\.([A-Za-z0-9_-]{2,64})\.reward$/.exec(key);
  if (!m) return undefined;
  return m.length === 2 ? `${m[1]} 每周阶段倍率` : `${m[1] === "mission" ? "每周任务奖励" : "月度挑战奖励"} · ${m[2]}`;
}
/** H3 新建任务的类型，和 H3 新建抽屉的标题同名（h3-mission-form SUBJECT_TEXT）。 */
const H3_MISSION_TYPE: Record<string, string> = { DAY_ONE: "新手任务", WEEKLY_T1: "每周一档任务", WEEKLY_T2: "每周二档任务" };
/** H3 新建任务单的变更后是后端建单时拼的一句（OpsGrowthService.createMission）：编号；名称；类型；奖励 N UVT；类别；去完成页面；paused。 */
function h3MissionView(w: { operationCode?: string | null; after: string }) {
  if (w.operationCode !== "h3_mission_create") return undefined;
  const m = /^([A-Za-z0-9_-]{2,64})；(.+)；(DAY_ONE|WEEKLY_T1|WEEKLY_T2)；奖励 (\d+) UVT；([A-Z]+)；(\/pages\/\S+)；paused$/.exec(w.after.trim());
  return m ? { code: m[1], name: m[2], type: H3_MISSION_TYPE[m[3]], reward: `${grouped(m[4])} UVT`,
    category: TASK_CATEGORY_LABELS[m[5].toLowerCase()] ?? m[5], route: TASK_ACTION_ROUTE_LABELS[m[6]] ?? m[6] } : undefined;
}
/** 新手任务奖励的原值可能带旧名称 NEX：照 H3 页写成 UVT 并标出旧名称。 */
function h3ConfigValue(key: string | undefined, value: string) {
  if (key !== "dayOne.triReward") return value;
  const reward = legacyAssetText(value);
  return reward.legacy ? `${reward.text}（旧名称 NEX）` : value;
}

/** 对象写运营看得懂的名字：G 参数写参数名，H4 奖池写「抽奖转盘奖池」；其余原样。 */
function objectText(w: { action: string; obj: string; after?: string; objDisplayName?: string; operationCode?: string | null; disclosureReview?: A2OperationRow["disclosureReview"] }) {
  if (w.disclosureReview) return w.disclosureReview.jurisdiction;
  if (w.objDisplayName && isGParamTicket(w)) return w.objDisplayName;
  if (w.objDisplayName) return a2ObjectText(w);
  if (w.operationCode === "k1_release_param") return K1_APPROVAL_PARAM_NAMES[w.obj] ?? w.obj;
  if (w.operationCode === "k1_earnings_release") return `收益记录 ${w.obj}`;
  if (w.operationCode === "j1_gate_resume") return j1GateName(w.obj);
  if (w.operationCode === "f_unilevel_bootstrap") return "团队购买奖励 · L1–L7";
  if (w.operationCode === "h3_mission_create") return `任务 ${w.obj}`;
  if (w.operationCode === "h3_quest_config") return h3ConfigName(w.obj) ?? w.obj;
  const fund = fundTicket(w);
  if (fund?.kind === "f4Payout" && fund.period) return fund.period;
  if (fund?.kind === "f5Status" && fund.eventId) return `奖励记录 ${fund.eventId}`;
  if (fund?.kind === "fConfig") return fund.spec ? `${fund.spec.page} · ${fund.spec.item}` : "未识别的配置项";
  if (fund?.kind === "f5Suspension") return `用户 ${fund.userId ? userCode(fund.userId) : "—"} · ${fund.kinds.length ? kindNames(fund.kinds) : "所选奖励"}`;
  if (fund?.kind === "f5Reissue") return fund.ids.length ? `${fund.ids.length} 笔奖励记录` : w.obj;
  if (fund?.kind === "f5Reverse" && fund.eventId) return `奖励记录 ${fund.eventId}`;
  const batch = fBatchTicket(w);
  if (batch) return `${fBatchPages(batch.items).join("、") || "团队参数"} · ${batch.count} 项`;
  if (G_PARAM_ACTION.test(w.action)) return G_PARAM_NAMES[w.obj] ?? w.obj;
  if (w.obj === "ACTIVE_POOL" && REVIEW_OPERATION_BY_ACTION[w.action]?.startsWith("h4_wheel")) return "抽奖转盘奖池";
  const ambassador = /^F\.ambassador\.(\d+)\.status$/.exec(w.obj);
  if (ambassador) return `区域大使申请 #${ambassador[1]}`;
  return w.obj;
}
/**
 * K1 两类资金审批的前后摘要是后端建单时自己记的（RiskReleaseParamsService、EarningsReleaseService 的 previewApproval）：
 * 拆成批准人要核对的几项，参数键和版本只进技术信息。格式对不上时返回 undefined，照原来的写法显示原文。
 */
type K1TicketView = { kind: "param"; key: string; name: string; from: string; to: string; versionFrom: string; versionTo: string }
  | { kind: "release"; entryNo: string; userId: string; asset: string; net: string; source: string; sourceRef: string; bucket: string; coverage: string; redline: string };
const K1_PARAM_SUMMARY = /^(duplicateAccountPendingFrom|duplicateAccountFreezeFrom) = (\d+)；版本 (\d+)$/;
function k1TicketView(w: { operationCode?: string | null; before: string; after: string }): K1TicketView | undefined {
  if (w.operationCode === "k1_release_param") {
    const b = K1_PARAM_SUMMARY.exec(w.before.trim()), a = K1_PARAM_SUMMARY.exec(w.after.trim());
    return b && a && b[1] === a[1] ? { kind: "param", key: b[1], name: K1_APPROVAL_PARAM_NAMES[b[1]], from: b[2], to: a[2], versionFrom: b[3], versionTo: a[3] } : undefined;
  }
  if (w.operationCode !== "k1_earnings_release") return undefined;
  const release = parseK1ReleaseTicketBefore(w.before);
  return release ? { kind: "release", ...release } : undefined;
}
/** 后端写的净额去掉了末尾 0：只补到两位、加千分位，不舍入。 */
const k1Amount = (text: string) => { const [whole, frac = ""] = text.split("."); return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${frac.padEnd(2, "0")}`; };
const k1Source = k1EarningSourceName;
const k1Bucket = (bucket: string) => bucket === "bonus_locked" ? "锁定奖励" : "审核中";
/** 列表「变更」一格。 */
function k1ChangeCell(v: K1TicketView) {
  return v.kind === "param" ? { main: `${v.from} → ${v.to} 个账户`, sub: v.name }
    : { main: `${k1Amount(v.net)} ${nexGridBrandText(v.asset)}`, sub: `${k1Source(v.source)} · 用户 ${userCode(v.userId)}` };
}
/** 抽屉和批准框里的几项：放的是哪一笔、多少、谁的；或改哪个阈值、从多少到多少。 */
function K1TicketFacts({ v }: { v: K1TicketView }) {
  return v.kind === "param" ? <>
    <Fact k={v.name}><Change from={`${v.from} 个账户`} to={`${v.to} 个账户`} /></Fact>
    <Fact k="批准后">{v.key === "duplicateAccountFreezeFrom" ? "新值生效：新增收益和这组账户现在能不能提现都按新值判断" : "新值生效：之后的新增收益按新值处理"}</Fact>
  </> : <>
    <Fact k="净额" lead tone="role-1" unit={nexGridBrandText(v.asset)}>{k1Amount(v.net)}</Fact>
    <Fact k="用户"><span data-mono>{userCode(v.userId)}</span></Fact>
    <Fact k="来源">{k1Source(v.source)} <span data-mono className="a2-code">{v.sourceRef}</span></Fact>
    <Fact k="前后状态"><Change from={k1Bucket(v.bucket)} to="已放行" /></Fact>
    <Fact k="提交时覆盖率">{`${v.coverage}%（红线 ${v.redline}%）`}</Fact>
    <Fact k="批准后">只放行这一笔，不另发奖、不生成提现单；能否提现还看账户组和其他提现条件</Fact>
  </>;
}
const k1Tech = (v: K1TicketView) => v.kind === "param" ? `参数键 ${v.key} ｜ 版本 ${v.versionFrom} → ${v.versionTo}` : `用户内部号 ${v.userId} ｜ 原状态 ${v.bucket} ｜ 来源原值 ${v.source}`;
const K1_APPROVAL_CHECK = { param: "批准时先核对这项规则没被别人改过、兑付覆盖率够；不满足就不改，审批单留着待审批。",
  release: "批准时先核对这笔收益没变、兑付覆盖率够；不满足就不放行，审批单留着待审批。" } as const;
const COURSE_VALUE_TEXT: Record<string, Record<string, string>> = {
  status: { published: "已发布", draft: "草稿", archived: "已下架", PUBLISHED: "已发布", DRAFT: "草稿", SUPERSEDED: "历史版本" },
  sourceStatus: { DRAFT: "草稿", PUBLISHED: "已发布", SUPERSEDED: "历史版本", LEGACY_DRAFT: "旧草稿（无独立版本）" },
  category: { Basics: "基础", Earn: "赚取", Team: "团队", Wealth: "财富", Security: "安全" },
  format: { Article: "图文", Video: "视频", "Hands-on": "实操" },
  level: { Beginner: "入门", Intermediate: "进阶", Advanced: "高级" },
};
/** 成组记录的量词：「查看全部 9 个等级」。 */
const ROW_UNIT: Record<string, string> = { ranks: "个等级", rewards: "项奖励" };
const ROWS_SHOWN = 5;

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const isRowList = (value: unknown): value is Record<string, unknown>[] => Array.isArray(value) && value.length > 0 && value.every(isRecord);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** 纯数字加千分位，只排版，不舍入（必须改 5）。后端的值不带单位，页面不猜单位。 */
function grouped(text: string) {
  return /^-?\d{4,}(\.\d+)?$/.test(text) ? text.replace(/^-?\d+/, (whole) => whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")) : text;
}

function valueText(key: string | undefined, value: unknown, labels = CHANGE_LABELS): string {
  if (value === null || value === undefined) {
    if (key === "clearMonthlyTarget" || key === "trialEligible") return "否";
    return "未设置";
  }
  if (typeof value === "boolean") return value ? "是" : "否";
  if (key === "monthlyTargetUsdt") return `${grouped(String(value))} USDT`;
  if (key === "monthlyTargetBandPct") return `±${grouped(String(value))}%`;
  if (key === "dailyEarn") return `${grouped(String(value))} USDT/日`;
  if (key === "shareYieldMin" || key === "shareYieldMax") return `${grouped(String(value))}%`;
  if (key === "peerBonusRate" && typeof value === "number") return `${(value * 100).toFixed(2)}%`;
  if (key === "baseRate" && typeof value === "string") return shareBaseRateText(value);
  if (key === "allowedPoolCodes" && Array.isArray(value)) return value.length ? value.map(code => ({L1:"L1 初级",L2:"L2 中级",L3:"L3 高级",L4:"L4 旗舰",PHONE:"手机任务池"}[String(code)] ?? String(code))).join("、") : "未选择";
  if (Array.isArray(value)) return value.length ? value.map((item) => valueText(undefined, item, labels)).join("、") : "无";
  if (isRecord(value)) return Object.entries(value).map(([name, item]) => `${labels[name] ?? name} ${valueText(name, item, labels)}`).join("；") || "无";
  return grouped(String(value));
}

type Review = { kind: "text"; text: string } | { kind: "object"; value: Record<string, unknown> } | { kind: "rows"; rows: Record<string, unknown>[] };

/** 后端存的前后值：JSON 对象、成组记录或一段文字。空和「—」是首次配置，返回 null。 */
function parseReview(value: string): Review | null {
  const raw = value.trim();
  if (!raw || raw === "—") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (isRowList(parsed)) return { kind: "rows", rows: parsed };
    if (isRecord(parsed)) return Object.keys(parsed).length ? { kind: "object", value: parsed } : null;
    return { kind: "text", text: valueText(undefined, parsed) };
  } catch {
    return { kind: "text", text: grouped(raw) };
  }
}

/** H4 stores a pool snapshot before and command values after, not two replacement configs. */
function reviewPair(before: string, after: string, operationCode?: string) {
  const b = parseReview(operationCode === "g_param" ? gParamText(before) : k1ApprovalSummaryText(before, operationCode));
  const a = parseReview(operationCode === "g_param" ? gParamText(after) : k1ApprovalSummaryText(after, operationCode));
  const labels = hiReviewLabels(operationCode);
  const original = { b, a, labels, evidenceKeys: [] as string[] };
  // 旧活动：前值是锁定时整行活动快照（OpsGrowthService.lockH4LegacyEventState），后值是提案 values，只比奖励。
  if (operationCode === "h4_legacy_event_reward_update" && b?.kind === "object" && a?.kind === "object" && "eventCode" in b.value) {
    const status = b.value.status === "1" ? "启用" : b.value.status === "0" ? "停用" : b.value.status;
    return {
      b: { kind: "object" as const, value: { eventCode: b.value.eventCode, rewardName: b.value.rewardName } },
      a: { kind: "object" as const, value: { eventCode: a.value.eventCode, rewardName: a.value.value,
        legacyEvent: [{ eventStatus: status, startsAt: b.value.startsAt, endsAt: b.value.endsAt }] } },
      labels: { ...labels, legacyEvent: "提交时的活动状态", eventStatus: "活动状态", startsAt: "开始时间", endsAt: "结束时间" },
      evidenceKeys: ["legacyEvent"],
    };
  }
  // 课程：前值只有当前版本五项（currentReview），后值是目标版本内容（targetReview）。两边都有的才比，其余作目标版本内容列出。
  if (COURSE_REVIEW_OPERATIONS.includes(operationCode ?? "") && b?.kind === "object" && a?.kind === "object") {
    const show = (key: string, value: unknown) => typeof value === "string" ? COURSE_VALUE_TEXT[key]?.[value] ?? value : value;
    const was: Record<string, unknown> = {};
    const next: Record<string, unknown> = {};
    const extra: Record<string, unknown>[] = [];
    for (const key of Object.keys(a.value)) {
      if (key in b.value) { was[key] = show(key, b.value[key]); next[key] = show(key, a.value[key]); }
      else extra.push({ field: labels[key] ?? key, content: valueText(key, show(key, a.value[key]), labels) });
    }
    for (const key of Object.keys(b.value)) if (!(key in a.value)) was[key] = show(key, b.value[key]);
    if (extra.length) next.courseTarget = extra;
    return { b: { kind: "object" as const, value: was }, a: { kind: "object" as const, value: next }, labels, evidenceKeys: ["courseTarget"] };
  }
  if (!WHEEL_REVIEW_OPERATIONS.includes(operationCode ?? "") || b?.kind !== "object" || a?.kind !== "object"
    || typeof b.value.tiers !== "string") return original;
  let snapshot: unknown;
  try { snapshot = JSON.parse(b.value.tiers); }
  catch { return original; }
  if (!Array.isArray(snapshot) || !snapshot.every(isRecord)) return original;

  // Decimal strings and JSON numbers compare without rounding or false scale-only changes.
  const decimal = (value: unknown) => String(value).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  // 奖型和 H4 页面同一套叫法；旧名 nex、points 照实写出来，不当成合法奖型。
  const kindText = (kind: unknown) => ({ uvt: "UVT", usdt: "USDT", coupon: "代金券", voucher: "代金券", nex: "旧奖型 nex", points: "积分奖型" } as Record<string, string>)[String(kind).toLowerCase()] ?? kind;
  const tiers = snapshot.map(tier => ({
    tierName: tier.tier, rewardName: tier.reward, probabilityPct: decimal(tier.prob),
    realOutflow: tier.real === true || tier.real === 1, rewardKind: kindText(tier.kind),
    rewardAmount: decimal(tier.amount), voucherId: tier.voucherId || "无", dailyStock: tier.dailyStock,
  }));
  const values = a.value;
  const target = tiers.find(tier => tier.tierName === values.tierName);
  let was: Record<string, unknown> | null;
  let next: Record<string, unknown>;
  const wheelLabels = { ...labels };
  if (operationCode === "h4_wheel_probabilities_update") {
    if (!isRecord(values.probabilities)) return original;
    was = {};
    next = {};
    for (const tier of tiers) {
      const key = `probability:${tier.tierName}`;
      wheelLabels[key] = `${tier.tierName} · 概率（%）`;
      was[key] = tier.probabilityPct;
      next[key] = decimal(values.probabilities[String(tier.tierName)]);
    }
  } else if (operationCode === "h4_wheel_tier_delete") {
    if (!target) return original;
    was = { ...target, status: "已启用" };
    next = { ...target, status: "已删除" };
  } else {
    const created = operationCode === "h4_wheel_tier_create";
    if (!created && !target) return original;
    was = created ? null : { ...target };
    // Match OpsGrowthService's defaults for omitted optional command fields.
    next = {
      tierName: values.tierName, rewardName: values.rewardName,
      probabilityPct: decimal(values.probabilityPct ?? target?.probabilityPct ?? 0),
      realOutflow: values.realOutflow == null ? target?.realOutflow ?? false : values.realOutflow === 1,
      rewardKind: values.rewardKind == null ? target?.rewardKind ?? kindText("uvt") : kindText(values.rewardKind),
      rewardAmount: decimal(values.rewardAmount ?? target?.rewardAmount ?? 0),
      voucherId: values.voucherId == null ? target?.voucherId ?? "无" : String(values.voucherId).trim() || "无",
      dailyStock: values.dailyStock ?? target?.dailyStock ?? 0,
    };
  }
  // 改一档、删一档时，每一行都带上是哪一档（和改概率的写法一样），不然差异里只看得到「发放数量 1 → 2」。
  if (operationCode === "h4_wheel_tier_update" || operationCode === "h4_wheel_tier_delete") {
    const named = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([key, value]) => {
      if (key === "tierName" || !labels[key]) return [key, value];
      wheelLabels[`tier:${key}`] = `${String(values.tierName)} · ${labels[key]}`;
      return [`tier:${key}`, value];
    }));
    if (was) was = named(was);
    next = named(next);
  }
  // Existing row groups keep verification evidence out of the business-field diff.
  next.wheelEvidence = [{ wheelSignature: b.value.wheelSignature, expectedSignature: values.expectedSignature }];
  next.wheelSnapshot = tiers;
  return {
    b: was ? { kind: "object" as const, value: was } : null,
    a: { kind: "object" as const, value: next }, labels: wheelLabels,
    evidenceKeys: ["wheelEvidence", "wheelSnapshot"],
  };
}

/** 队列「变更」列：和详情同一套格式。第一项做第一行，原值做第二行，多项时写「等 N 项」（必须改 5）。 */
function changeSummary(before: string, after: string, omit: readonly string[] = [], operationCode?: string) {
  const { b, a, labels, evidenceKeys } = reviewPair(before, after, operationCode);
  if (!a) return { main: "—", sub: b ? `原 ${b.kind === "text" ? b.text : "见详情"}` : undefined };
  if (a.kind === "text") return { main: a.text, sub: b ? `原 ${b.kind === "text" ? b.text : "见详情"}` : "新建" };
  if (a.kind === "rows") return { main: `共 ${a.rows.length} 行`, sub: b ? "原 见详情" : "新建" };
  if (a.value.clearMonthlyTarget === true) return {
    main: "关闭月收益目标",
    sub: a.value.shareYieldMin != null && a.value.shareYieldMax != null
      ? `年奖励率 ${valueText("shareYieldMin", a.value.shareYieldMin, labels)}–${valueText("shareYieldMax", a.value.shareYieldMax, labels)}`
      : `日产收益 ${valueText("dailyEarn", a.value.dailyEarn, labels)}`,
  };
  const keys = Object.keys(a.value).filter((key) => !omit.includes(key) && !evidenceKeys.includes(key));
  const changed = b?.kind === "object" ? keys.filter((key) => !same(b.value[key], a.value[key])) : keys;
  const first = changed[0] ?? keys[0];
  if (!first) return { main: "—" };
  const label = labels[first] ?? first;
  const now = a.value[first];
  const main = `${label} ${isRowList(now) ? `${now.length} ${ROW_UNIT[first] ?? "行"}` : valueText(first, now, labels)}${changed.length > 1 ? ` 等 ${changed.length} 项` : ""}`;
  const was = b?.kind === "object" ? b.value[first] : undefined;
  return { main, sub: !b ? "新建" : b.kind === "object" && (first in b.value || typeof now === "boolean") && !isRowList(was) ? `原 ${valueText(first, was, labels)}` : "原 见详情" };
}

/** 成组的记录画成小表，每组一行，列头用字段名；超过 5 行的收在「查看全部」后面（VS-109）。 */
function ReviewRows({ name, rows, labels = CHANGE_LABELS }: { name: string; rows: readonly Record<string, unknown>[]; labels?: Record<string, string> }) {
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const unit = ROW_UNIT[name] ?? "行";
  const table = (part: readonly Record<string, unknown>[], label: string) => (
    <Table label={label} data-tight="">
      <thead><tr>{columns.map((column) => <Th key={column}>{labels[column] ?? column}</Th>)}</tr></thead>
      <tbody>{part.map((row, index) => <Tr key={index}>{columns.map((column) => <Td key={column}><Cell main={valueText(column, row[column], labels)} title={valueText(column, row[column], labels)} /></Td>)}</Tr>)}</tbody>
    </Table>
  );
  const title = labels[name] ?? name;
  return (
    <div className="a2-change-rows">
      {table(rows.slice(0, ROWS_SHOWN), title)}
      {rows.length > ROWS_SHOWN && <Fold inset title={`查看全部 ${rows.length} ${unit}`} summary={`还有 ${rows.length - ROWS_SHOWN} ${unit}`}>{table(rows.slice(ROWS_SHOWN), `${title}（续）`)}</Fold>}
    </div>
  );
}

/**
 * 详情与批准确认均完整展示已持久化的前后值（必须改 3）。一块底：
 * - 单个值：一行「现在 → 改后」，现在值弱，改后进行中蓝（VS-103）；
 * - 对象：只列改了的项，其余收进「其余 N 项不变」（DiffList）；
 * - 成组记录（等级、奖励）：小表，不拼成一大片文字（VS-109）；
 * - 变更前是空（首次配置）：不画变更前，标题旁写「新建」。
 */
/** 两边都是「字段：值」（多项用「；」连起来）、字段一一对应时，返回 [字段, 原值, 新值]。 */
function fieldPairs(before: string, after: string): Array<[string, string, string]> | null {
  const split = (text: string) => text.split("；").map((part) => /^([^：；]{1,12})：(.*)$/.exec(part));
  const b = split(before), a = split(after);
  if (a.length !== b.length || a.some((m, i) => !m || !b[i] || m[1] !== b[i]![1])) return null;
  return a.map((m, i) => [m![1], b[i]![2] || "未设置", m![2] || "未设置"]);
}

/** 设备审批只翻译后端给出的状态码；占位的原状态不能用设备当前状态补写。 */
function deviceApprovalValue(value: string, operationCode?: string) {
  if (!["e5_device_activate", "e5_device_force_activate", "e5_device_deactivate", "e5_device_unbind"].includes(operationCode ?? "")) return value;
  const states: Record<string, string> = { ACTIVATED: "ACTIVE", ACTIVE: "ACTIVE", ONLINE: "ONLINE", BUSY: "BUSY", RUNNING: "RUNNING", OFFLINE: "OFFLINE", INVENTORY: "INVENTORY", RECYCLED: "RECYCLED", DEACTIVATED: "DEACTIVATED", UNBOUND: "UNBOUND" };
  // 和设备管理页同一个叫法：INACTIVE 在「待激活」，SUSPENDED 是「已暂停」，RETIRED 是「已停用」下的「已退役」。
  if (value === "INACTIVE") return "待激活";
  if (value === "SUSPENDED") return "已暂停";
  if (value === "RETIRED") return "已停用（已退役）";
  const state = states[value];
  return state ? operatorDeviceStatus(state) : value;
}

/**
 * 大使申请单的变更前是后端拼的一句（类别代码、材料状态代码），只把两个代码换成页面上的叫法。
 * F5 奖励状态单的变更前是「以服务器执行时状态与版本为准」、变更后是英文状态：写成「冷却中 → 已解锁」；改之前能是几种状态的写「批准时的状态」。
 */
function i5MatrixVersionText(summary: string, version: string) {
  return version ? summary.startsWith(`${version} · `) ? summary : version : "未配置";
}

const changeBefore = (row: { before: string; after?: string; obj?: string; action?: string; operationCode?: string; ambassadorMaterialProposal?: unknown; disclosureReview?: A2OperationRow["disclosureReview"] }) => {
  if (row.disclosureReview?.kind === "MATRIX") return i5MatrixVersionText(row.before, row.disclosureReview.expectedVersion);
  const fund = fundTicket(row);
  if (fund?.kind === "f5Status") return F5_STATE_FROM[fund.state] ?? "批准时的状态";
  if (fund?.kind === "fConfig") return fConfigValue(fund.spec, row.before);
  if (fund?.kind === "f5Suspension") return fund.suspended ? "批准时的状态" : "暂停中";
  if (fund?.kind === "f5Reissue") return "";
  if (fund?.kind === "f5Reverse") return "批准时的状态";
  // 新建任务的变更前是「任务不存在：编号」：按新建显示，不画变更前。
  if (row.operationCode === "h3_mission_create" && row.after && h3MissionView({ operationCode: row.operationCode, after: row.after })) return "";
  if (row.operationCode === "h3_quest_config") return h3ConfigValue(row.obj, row.before);
  return deviceApprovalValue(changeBeforeText(row), row.operationCode);
};
const changeAfter = (row: { after: string; obj?: string; action?: string; operationCode?: string; disclosureReview?: A2OperationRow["disclosureReview"] }) => {
  if (row.disclosureReview?.kind === "MATRIX") return i5MatrixVersionText(row.after, row.disclosureReview.version);
  if (row.disclosureReview?.kind === "PUBLISH") return row.disclosureReview.version;
  const fund = fundTicket(row);
  if (fund?.kind === "f5Status") return F5_STATE_NAME[fund.state] ?? row.after;
  if (fund?.kind === "fConfig") return fConfigValue(fund.spec, row.after);
  if (fund?.kind === "f5Suspension") return fund.suspended ? "暂停中" : "已恢复";
  if (fund?.kind === "f5Reissue") return `生成 ${fund.count ?? "—"} 条新记录`;
  const mission = h3MissionView({ operationCode: row.operationCode, after: row.after });
  if (mission) return JSON.stringify({ 任务名称: mission.name, 类型: mission.type, 奖励: mission.reward, 类别: mission.category, 去完成页面: mission.route, 建好后: "已停用，绑定完成条件后才能启用" });
  if (row.operationCode === "h3_quest_config") return h3ConfigValue(row.obj, row.after);
  return row.operationCode === "f5_commission_reverse" && row.after === "REVERSED" ? F5_STATE_NAME.reversed : deviceApprovalValue(row.after, row.operationCode);
};
const changeBeforeText = (row: { before: string; ambassadorMaterialProposal?: unknown }) => !row.ambassadorMaterialProposal ? row.before
  : row.before.replace(/^类别 ([a-z]+)；/, (_, code: string) => `类别 ${ambassadorBucketLabel(code)}；`)
    .replace(/；(NOT_SUBMITTED|PENDING|NEEDS_MORE|PASSED)$/, (_, state: string) => `；${ambassadorMaterialStateLabel(state)}`);

export function A2ChangeReview({ before, after, omit = [], operationCode, children }: { before: string; after: string; omit?: readonly string[]; operationCode?: string; children?: ReactNode }) {
  const { b, a, labels } = reviewPair(before, after, operationCode);
  const created = !b;
  let body: ReactNode;
  if (!a) {
    body = <Facts><Fact k="变更后">—</Fact></Facts>;
  } else if (a.kind === "text" && b?.kind === "text" && fieldPairs(b.text, a.text)) {
    // 「显示名：甲；工作邮箱：乙」这类逐项摘要：两边字段一一对应时每项一行，不拼成一长句折行。
    body = <Facts>{fieldPairs(b.text, a.text)!.map(([label, from, to]) => <Fact key={label} k={label}><Change from={from} to={to} /></Fact>)}</Facts>;
  } else if (a.kind === "text") {
    body = <Facts><Fact k={created ? "内容" : "变更"}>{!b ? a.text : <Change from={b.kind === "text" ? b.text : valueText(undefined, b.kind === "object" ? b.value : b.rows, labels)} to={a.text} />}</Fact></Facts>;
  } else if (a.kind === "rows") {
    body = <>
      <ReviewRows labels={labels} name="" rows={a.rows} />
      {b && <Fold inset title="变更前" summary={b.kind === "rows" ? `共 ${b.rows.length} 行` : "原来的内容"}>{b.kind === "rows" ? <ReviewRows labels={labels} name="" rows={b.rows} /> : <p className="rd-note">{b.kind === "text" ? b.text : valueText(undefined, b.value, labels)}</p>}</Fold>}
    </>;
  } else {
    const keys = Object.keys(a.value).filter((key) => !omit.includes(key));
    const was = b?.kind === "object" ? b.value : undefined;
    const removed = was ? Object.keys(was).filter((key) => !omit.includes(key) && !(key in a.value)) : [];
    const groups = keys.filter((key) => isRowList(a.value[key]));
    const plain = [...keys.filter((key) => !isRowList(a.value[key])), ...removed];
    const rows: DiffRow[] = plain.map((key) => ({
      key,
      label: labels[key] ?? key,
      before: valueText(key, was?.[key], labels),
      after: valueText(key, a.value[key], labels),
    }));
    body = <>
      {b && b.kind !== "object" && <Facts><Fact k="变更前">{b.kind === "text" ? b.text : valueText(undefined, b.rows, labels)}</Fact></Facts>}
      {plain.length > 0 && (was
        ? <DiffList rows={rows} restTitle="其余内容" emptyNote="这些项没有改动" />
        : <Facts>{rows.map((row) => <Fact key={row.key} k={String(row.label)}>{row.after}</Fact>)}</Facts>)}
      {groups.map((key) => {
        const old = was?.[key];
        return (
          <div key={key} className="a2-change-group">
            <div className="a2-change-sub">{labels[key] ?? key}{was && same(old, a.value[key]) && <span className="rd-weak"> · 没有改动</span>}</div>
            <ReviewRows labels={labels} name={key} rows={a.value[key] as Record<string, unknown>[]} />
            {isRowList(old) && !same(old, a.value[key]) && <Fold inset title={`变更前的${labels[key] ?? key}`} summary={`${old.length} ${ROW_UNIT[key] ?? "行"}`}><ReviewRows labels={labels} name={key} rows={old} /></Fold>}
          </div>
        );
      })}
    </>;
  }
  return (
    <section className="a2-change-review" aria-label="完整变更内容">
      <div className="a2-change-title">完整变更内容{created && <StatusTag tone="neutral">新建</StatusTag>}</div>
      {body}
      {children}
    </section>
  );
}

/* ────────────────── 页面 ────────────────── */

export function A2Audit({ ctx }: { ctx: ACtx }) {
  const { toast, openActionConfirm } = ctx;
  const reach = useReach();
  const operator = useAdminAuth((s) => s.operator || s.session?.operator || s.session?.username || "");
  const session = useAdminAuth((s) => s.session);
  const principal = {
    name: session?.operator || session?.username || operator,
    role: session?.role,
    authorities: session?.authorities ?? [],
  } as AuthPrincipal;
  const canApprove = canApprovePending(principal);
  const canDecide = (ticket: TicketIdentity, kind: "approve" | "reject") => {
    const qualified = kind === "approve" ? ticket.canApprove : ticket.canReject;
    return canApprove && qualified === true;
  };
  const canExport = canAccessA2Export(principal.authorities);
  // 和顶栏同一份兑付覆盖率；读不到时批准框写「暂时读不到」，批准时后端再查。
  const bDomain = useBDomainDashboard(B_DASHBOARD_READ_AUTHORITIES.every((authority) => principal.authorities.includes(authority)));
  const coverage = bDomain.hasData && !bDomain.error && bDomain.ledger.valuationReliable
    ? { coverageRatio: bDomain.ledger.coverageRatio, redlinePct: bDomain.ledger.redlinePct, healthyPct: bDomain.ledger.healthyPct }
    : undefined;
  const canWrite = canAccessA2Write(principal.authorities);
  const canWithdraw = principal.authorities.includes("platform_a2_proposal_create");
  const isMine = (w: A2OperationRow) => isCurrentOperator(w, session?.username);
  const zone = businessZone().label;

  /* 网址：进页读一次，之后回写（ST-23）。 */
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<A2Tab>("pending");
  const [view, setView] = useState<RecordView>("logs");
  const [qType, setQType] = useState<QType>("all");
  const [qOperator, setQOperator] = useState<QOperator>("all");
  const [qPage, setQPage] = useState(1);
  const [qPageSize, setQPageSize] = useState(10);
  const [filterDraft, setFilterDraft] = useState<A2AuditFilter>({});
  const [appliedFilter, setAppliedFilter] = useState<A2AuditFilter>({});
  const [enteredFilter, setEnteredFilter] = useState<A2AuditFilter | null>(null);
  const [rangeError, setRangeError] = useState("");
  const [logPage, setLogPage] = useState(1);
  const [logPageSize, setLogPageSize] = useState(10);
  const [histPage, setHistPage] = useState(1);
  const [histPageSize, setHistPageSize] = useState(4);
  const [returnTo, setReturnTo] = useState("");

  /* 读取：不带筛选的一份给待审批、机制设置和页签数量；操作记录有筛选时另读一份。 */
  const [main, setMain] = useState<A2Overview | null>(null);
  const [mainLoading, setMainLoading] = useState(true);
  const [mainError, setMainError] = useState("");
  const [filtered, setFiltered] = useState<A2Overview | null>(null);
  const [filteredLoading, setFilteredLoading] = useState(false);
  const [filteredError, setFilteredError] = useState("");
  const [readAt, setReadAt] = useState("");
  const [retentionRun, setRetentionRun] = useState<RetentionExecution | null>(null);
  const [retentionRunError, setRetentionRunError] = useState<string | null>(null);
  const [retentionPreview, setRetentionPreview] = useState<RetentionPreview | null>(null);
  const [retentionPreviewError, setRetentionPreviewError] = useState<string | null>(null);
  const [retentionLoading, setRetentionLoading] = useState(true);
  const mainSeq = useRef(0);
  const filteredSeq = useRef(0);
  const mainRef = useRef<A2Overview | null>(null);
  mainRef.current = main;
  const appliedRef = useRef(appliedFilter);
  appliedRef.current = appliedFilter;

  /* 写操作 */
  const [submitting, setSubmitting] = useState("");
  const [pendingCommands, setPendingCommands] = useState<A2PendingCommand[]>([]);
  const [pendingNotes, setPendingNotes] = useState<Record<string, string>>({});
  const [retryRejected, setRetryRejected] = useState<string[]>([]);
  const [releasing, setReleasing] = useState<A2PendingCommand | null>(null);

  /* 抽屉 */
  const [ticketId, setTicketId] = useState<string | null>(null);
  const [logId, setLogId] = useState<string | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [confirmListOpen, setConfirmListOpen] = useState(false);
  const tabIds = useTabIds();

  const syncPending = () => setPendingCommands(a2Commands.list());
  useEffect(() => { syncPending(); }, [session?.adminId]);

  const loadMain = async () => {
    const seq = ++mainSeq.current;
    setMainLoading(true);
    try {
      const next = await fetchA2Overview({});
      if (seq === mainSeq.current) {
        setMain(next);
        mainRef.current = next;
        setMainError("");
        setReadAt(businessClock(Date.now()));
      }
      return next;
    } catch (error) {
      // 失败不显示旧数据（03 资金和合规页）：清掉旧的审批单和设置。
      if (seq === mainSeq.current) {
        setMain(null);
        mainRef.current = null;
        setMainError(displayAdminReadError(error));
      }
      throw error;
    } finally {
      if (seq === mainSeq.current) setMainLoading(false);
    }
  };

  const loadFiltered = async (filter: A2AuditFilter) => {
    const seq = ++filteredSeq.current;
    if (filterEmpty(filter)) {
      setFiltered(null);
      setFilteredError("");
      setFilteredLoading(false);
      return;
    }
    setFilteredLoading(true);
    try {
      const next = await fetchA2Overview(filter);
      if (seq === filteredSeq.current) { setFiltered(next); setFilteredError(""); }
    } catch (error) {
      if (seq === filteredSeq.current) { setFiltered(null); setFilteredError(displayAdminReadError(error)); }
    } finally {
      if (seq === filteredSeq.current) setFilteredLoading(false);
    }
  };

  const refreshRetentionRun = async () => {
    try {
      setRetentionRunError(null);
      setRetentionRun(await fetchA2RetentionLatest());
    } catch (error) {
      setRetentionRun(null);
      setRetentionRunError(displayAdminReadError(error));
    }
  };

  /* 操作前预览：与执行同谓词的服务端计数，让「立即清理」在点击前就能说清本次范围（缺陷 99）。 */
  const refreshRetentionPreview = async () => {
    setRetentionLoading(true);
    try {
      setRetentionPreviewError(null);
      setRetentionPreview(await fetchA2RetentionPreview());
    } catch (error) {
      setRetentionPreview(null);
      setRetentionPreviewError(displayAdminReadError(error));
    } finally {
      setRetentionLoading(false);
    }
  };

  /** 页头「刷新」：重读当前需要的总览（一次或两次）、清理范围、上次手动清理和提案退款金额，不动已应用条件（ST-50）。 */
  const refreshAll = () => {
    return Promise.all([
      loadMain().catch(() => undefined),
      loadFiltered(appliedRef.current),
      refreshRetentionPreview(),
      refreshRetentionRun(),
    ]);
  };

  useEffect(() => {
    const route = readRoute(window.location.search);
    setTab(route.tab);
    setView(route.view);
    setQType(route.type);
    setQOperator(route.role);
    setFilterDraft(route.filter);
    setAppliedFilter(route.filter);
    appliedRef.current = route.filter;
    setEnteredFilter(route.entered);
    setLogPage(route.page);
    setLogPageSize(route.pageSize);
    setReturnTo(route.returnTo);
    setReady(true);
    syncPending();
    void loadMain().catch(() => undefined);
    void loadFiltered(route.filter);
    void refreshRetentionPreview();
    void refreshRetentionRun();
    // 只在进页时读一次网址。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 替换写网址，不加历史；默认值不写，别的参数（userCode、returnTo）不动（ST-23、ST-24）。
  // 有已应用的筛选时页签一定写上：没写页签又带筛选的网址按外链兼容规则打开「操作记录」，刷新会跳走（M7）。
  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    const write = (name: string, value: string | number, fallback: string | number) => {
      if (value === fallback || value === "") url.searchParams.delete(name);
      else url.searchParams.set(name, String(value));
    };
    write("tab", tab, filterEmpty(appliedFilter) ? "pending" : "");
    write("list", view === "history" ? "history" : "", "");
    write("type", qType, "all");
    write("operatorRole", qOperator, "all");
    for (const key of FILTER_PARAMS) write(key, appliedFilter[key] ?? "", "");
    write("page", logPage, 1);
    write("pageSize", logPageSize, 10);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [ready, tab, view, qType, qOperator, appliedFilter, logPage, logPageSize]);

  /* ────────────────── 派生数据 ────────────────── */

  const hasApplied = !filterEmpty(appliedFilter);
  const records = hasApplied ? filtered : main;
  const recordsLoading = hasApplied ? filteredLoading : mainLoading;
  const recordsError = hasApplied ? filteredError : mainError;
  const stats = main?.stats;
  const mechanismParams = main?.mechanismParams ?? [];
  const confirmCategories = main?.confirmCategories ?? [];
  const reasonMin = parseA2ReasonMin(mechanismParams.find((p) => p.key === "ttl")?.value);
  const pendingTicketIds = useMemo(() => new Set(pendingCommands.filter((record) => ["approve", "reject", "withdraw"].includes(record.kind)).map((record) => record.target)), [pendingCommands]);
  const pendingParams = useMemo(() => new Set(pendingCommands.filter((record) => record.kind === "param").map((record) => record.target)), [pendingCommands]);
  const retentionPending = pendingCommands.some((record) => record.kind === "retention");

  /* 应急整组在前，资金类其次，其余按后端顺序（提交时间从新到旧），稳定排序（OP-74、PCN-10）。 */
  const pendingQueue = useMemo(() => {
    const rank = (ticket: A2OperationRow) => ticket.sos ? 0 : ticket.type === "fund" ? 1 : 2;
    return (main?.operationQueue ?? []).filter((w) => w.status === "pending")
      .map((w, i) => ({ w, i }))
      .sort((a, b) => rank(a.w) - rank(b.w) || a.i - b.i)
      .map((x) => x.w);
  }, [main]);
  /**
   * 待确认记录对应的审批单还在队列里时，用后端这份补齐记录没存的字段（T04）：同一张单内容不变，
   * 第二轮的记录没有订单号和权限规则，第三轮认不出的存成 null。不在队列里时用记录自己存的，前后值缺就不加额外门槛；
   * 退款单的对象就是订单号（后端发起时核过 obj 等于 orderNo）。
   */
  const recordTicket = (record: A2PendingCommand) => pendingQueue.find((w) => w.id === record.target);
  const recordOrderNo = (record: A2PendingCommand) => record.refundOrderNo ?? recordTicket(record)?.refundOrderNo
    ?? (record.fundEffect === "ORDER_REFUND" ? record.obj : undefined);
  const recordRule = (record: A2PendingCommand): DecisionRule => {
    const queued = recordTicket(record);
    if (queued) return decisionRule(queued);
    if (["h1_phase_dial", "c2_session_revoke_all", "h5_streak_milestone"].includes(record.operationCode ?? "")
        || !record.operationCode && record.action?.startsWith("强制登出 · "))
      return decisionRule({ action: record.action ?? "", obj: record.obj ?? "", operationCode: record.operationCode, before: "", after: "" });
    if (record.rule) return { ...record.rule, backendChecks: record.rule.backendChecks || record.rule.unmapped };
    return decisionRule({ action: record.action ?? "", obj: record.obj ?? "", operationCode: record.operationCode, fundEffect: record.fundEffect, before: "", after: "" });
  };
  const queueRows = useMemo(() => pendingQueue.filter((w) => {
    const tOk = qType === "all" || w.type === qType || (qType === "sos" && w.sos);
    const mOk = qOperator === "all" || matchesA2OperationRole(w.operatorRole, qOperator);
    return tOk && mOk;
  }), [pendingQueue, qType, qOperator]);
  const mineCount = pendingQueue.filter(isMine).length;
  const qPages = Math.max(1, Math.ceil(queueRows.length / qPageSize));
  const qSafePage = Math.min(qPage, qPages);
  const qPageRows = queueRows.slice((qSafePage - 1) * qPageSize, qSafePage * qPageSize);
  const queueFiltered = qType !== "all" || qOperator !== "all";

  // B37：退款金额来自这张提案，不能用订单总额替代；缺少权威金额仍禁用批准。
  const refundAmount = (w: A2OperationRow): RefundAmount | undefined => w.fundEffect === "ORDER_REFUND"
    ? w.refundAmountUsdtText != null && /[1-9]/.test(w.refundAmountUsdtText) ? { state: "ok", amount: w.refundAmountUsdtText }
      : { state: "error", message: "退款金额未读取" }
    : undefined;
  const refundAmountText = (amount: RefundAmount) => amount.state === "ok" ? `${orderAmount(amount.amount)} USDT`
    : amount.state === "loading" ? "正在读取" : "退款金额未读取";

  // 已应用的条件后端查过了，以后端的结果为准；对象还会命中详情里的命令号这类字段，前端再按窄的字段筛会把查到的记录删掉（M4）。
  const logRows = records?.recentLogs ?? [];
  const logPages = Math.max(1, Math.ceil(logRows.length / logPageSize));
  const logSafePage = Math.min(logPage, logPages);
  const logPageRows = logRows.slice((logSafePage - 1) * logPageSize, logSafePage * logPageSize);
  const historyRows = records?.operationHistory ?? [];
  const histPages = Math.max(1, Math.ceil(historyRows.length / histPageSize));
  const histSafePage = Math.min(histPage, histPages);
  const histPageRows = historyRows.slice((histSafePage - 1) * histPageSize, histSafePage * histPageSize);
  const recordStats = records?.stats;

  // 数据变少时把网址里的页码收回到最后一页，只在读取成功后收（ST-13、ST-26）。
  useEffect(() => {
    if (records && !recordsLoading && logPage > logPages) setLogPage(logPages);
  }, [records, recordsLoading, logPage, logPages]);

  /* 读回后这一条不在了就关抽屉（第五节）。 */
  const ticket = ticketId ? pendingQueue.find((w) => w.id === ticketId) ?? null : null;
  useEffect(() => { if (ticketId && !mainLoading && !ticket) setTicketId(null); }, [ticketId, mainLoading, ticket]);
  // 选中一张 F5 补发、冲正、状态变更单时重读这几笔奖励现在的样子（只显示，不挡批准）。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (ticket) readF5Current(f5RecordIds(fundTicket(ticket)), true); }, [ticketId]);
  const log = logId ? logRows.find((l) => l.id === logId) ?? null : null;
  useEffect(() => { if (logId && !recordsLoading && !log) setLogId(null); }, [logId, recordsLoading, log]);
  const history = historyId ? historyRows.find((h) => h.id === historyId) ?? null : null;
  useEffect(() => { if (historyId && !recordsLoading && !history) setHistoryId(null); }, [historyId, recordsLoading, history]);
  // 关抽屉时内容还要跟着滑出去。
  const ticketShown = useRef<A2OperationRow | null>(null);
  if (ticket) ticketShown.current = ticket;
  const logShown = useRef<A2AuditLogRow | null>(null);
  if (log) logShown.current = log;
  const historyShown = useRef<A2OperationHistory | null>(null);
  if (history) historyShown.current = history;

  const closeDrawers = () => { setTicketId(null); setLogId(null); setHistoryId(null); setConfirmListOpen(false); };
  const chooseTab = (next: A2Tab) => { closeDrawers(); setTab(next); };

  /* ────────────────── 写操作的共用路 ────────────────── */

  const refreshAfterWrite = () => Promise.all([loadMain().catch(() => undefined), loadFiltered(appliedRef.current)]);

  /**
   * 先把原操作存好再发（OP-92）；明确被拒丢号，留在确认框；结果未知保号，关框，转成页面上方的待确认条，
   * 这张单在确认前不能再处理（OP-93）。接口成功但读回看不到目标结果，也算结果未知（OP-88）。
   * 重试的是保留下来的原命令时，明确被拒也证明不了原命令的结果，继续保留（CP-33）。只有成功并读回到目标状态才解除。
   */
  const sendCommand = async <T,>(scope: string, extra: A2PendingExtra, prefix: string, send: (key: string) => Promise<T>, confirm: (result: T) => Promise<boolean>): Promise<"ok" | "unknown"> => {
    const retained = a2Commands.get(scope);
    const key = retained ?? createA2CommandKey(prefix);
    a2Commands.remember(scope, key, extra);
    if (!a2Commands.isDurablyStored(scope, key)) {
      if (!retained) a2Commands.forget(scope, key);
      throw new Error("浏览器存不下这次操作，没有提交。换一个窗口再试。");
    }
    setSubmitting(scope);
    try {
      let result: T;
      try {
        result = await send(key);
      } catch (cause) {
        const unknown = isA2OutcomeUncertainError(cause);
        const payoutCoverageRefused = extra.kind === "approve"
          && ["f4_pool_settle", "f4_leaderboard_period_payout"].includes(extra.operationCode ?? "")
          && isExplicitRejection(cause)
          && ["COVERAGE_SNAPSHOT_UNAVAILABLE", "COVERAGE_BELOW_REDLINE"].includes((cause as { backendMessage?: string }).backendMessage ?? "");
        const retentionRefused = extra.kind === "retention" && isExplicitRejection(cause)
          && ["RETENTION_PARAMETERS_STALE", "RETENTION_EXPECTED_MONTHS_REQUIRED"].includes((cause as { backendMessage?: string }).backendMessage ?? "");
        if (!unknown && (!retained || payoutCoverageRefused || retentionRefused || (cause as { f5StatusRejected?: boolean })?.f5StatusRejected === true)) a2Commands.forget(scope, key);
        syncPending();
        if (retentionRefused) {
          ctx.closeActionConfirm?.();
          await refreshRetentionPreview();
        }
        await refreshAfterWrite();
        if (unknown) { toast(UNKNOWN_TOAST, "warn"); return "unknown"; }
        throw cause;
      }
      const confirmed = await confirm(result).catch(() => false);
      if (!confirmed) { syncPending(); toast(UNKNOWN_TOAST, "warn"); return "unknown"; }
      a2Commands.forget(scope, key);
      syncPending();
      return "ok";
    } finally {
      setSubmitting("");
    }
  };

  type DecisionTicket = TicketIdentity & Pick<A2OperationRow, "id" | "refundOrderNo" | "refundAmountUsdtText"> & { rule?: DecisionRule | null };
  const runDecision = (kind: "approve" | "reject" | "withdraw", w: DecisionTicket, reason: string, by = operator) => sendCommand(
    `${kind}|${w.id}`,
    { kind, label: `${DECISION_VERB[kind]} · ${actionName(w)}`, target: w.id, reason, operator: by, rule: w.rule !== undefined ? w.rule : decisionRule(w),
      operationCode: w.operationCode, obj: w.obj, fundEffect: w.fundEffect, refundOrderNo: w.refundOrderNo, refundAmountUsdtText: w.refundAmountUsdtText ?? undefined, action: w.action, ruleTaskAction: w.ruleTaskAction },
    `a2-${kind}-${w.id}`,
    (key) => kind === "approve" ? approveA2Operation(w.id, reason, key, w.operationCode)
      : kind === "reject" ? rejectA2Operation(w.id, reason, key)
        : withdrawA2Operation(w.id, reason, by, key),
    async () => {
      const next = await loadMain();
      void loadFiltered(appliedRef.current);
      return next.operationQueue.some((item) => item.id === w.id && item.status === DECISION_STATUS[kind])
        || next.operationHistory.some((item) => item.id === w.id && item.st === DECISION_STATUS[kind]);
    },
  );

  const runParam = (key: "ttl" | "retention" | "schema", value: string, reason: string, by = operator) => sendCommand(
    `param|${key}`,
    { kind: "param", label: PARAM_TITLE[key], target: key, value, reason, operator: by },
    `a2-mechanism-${key}`,
    (commandKey) => updateA2MechanismParam(key, value, reason, commandKey),
    async () => paramReadback(await loadMain(), key) === value,
  );

  const runRetention = async (reason: string, expectedRetentionMonths: number | undefined, by = operator) => {
    const box: { result?: RetentionExecution } = {};
    const outcome = await sendCommand(
      "retention",
      { kind: "retention", label: RETENTION_TITLE, target: "retention", reason, operator: by, ...(expectedRetentionMonths === undefined ? {} : { expectedRetentionMonths }) },
      "a2-retention-run",
      (key) => runA2RetentionNow(reason, key, expectedRetentionMonths),
      async (result) => {
        box.result = result;
        setRetentionRun(result);
        void refreshRetentionPreview();
        return true;
      },
    );
    if (outcome === "ok" && box.result) {
      toast(box.result.lockAcquired
        ? `清理完成：已归档 ${box.result.archivedRows} 条，从在线列表移除 ${box.result.deletedRows} 条`
        : "已有清理正在进行，本次没有删除任何记录", box.result.lockAcquired ? "success" : "info");
    }
    return outcome;
  };

  /** 导出：理由、已应用的筛选、命令号先存好再发；下载到文件才算完成（M2）。 */
  const runExport = async (reason: string, filter: A2AuditFilter, by = operator) => {
    const box: { fileName?: string } = {};
    const outcome = await sendCommand(
      "export",
      { kind: "export", label: "导出操作记录", target: "export", reason, operator: by, filter },
      "a2-audit-export",
      (key) => exportA2Audit(reason, normalizeA2AuditFilter(filter), key),
      async (file) => { box.fileName = file.fileName; void refreshAfterWrite(); return true; },
    );
    if (outcome === "ok" && box.fileName) toast(`已下载 ${box.fileName}`, "success");
    return outcome;
  };

  const decisionToast =(kind: "approve" | "reject" | "withdraw", id: string) => toast(`${id} 已${DECISION_VERB[kind]}`, "success");
  const paramToast = (key: "ttl" | "retention" | "schema", value: string) => toast(key === "ttl" ? `理由最短长度已改为 ${value} 字`
    : key === "retention" ? `保留期已改为 ${value} 个月` : `字段版本已升级为 ${value}`, "success");

  /* ────────────────── 待确认条 ────────────────── */

  const notePending = (record: A2PendingCommand, text: string) =>
    setPendingNotes((current) => ({ ...current, [record.fingerprint]: `${businessClock(Date.now())} ${text}` }));

  /** 重试也是写操作，按这个账号现在的权限判断，和原入口一样（OP-124）。读回核对不受影响。 */
  const canRetry = (record: A2PendingCommand) => {
    if (!isPendingCommandOwnedBy(record)) return false;
    if (record.kind === "withdraw") return canWithdraw;
    if (record.kind === "param" || record.kind === "retention") return canWrite;
    if (record.kind === "export") return canExport;
    const queued = recordTicket(record);
    return queued ? canDecide(queued, record.kind) : canApprove;
  };

  /** 重试前退款单要先读到退款金额，和新开的批准框同一个前提（F01）；读不到只能读回核对，原命令照旧保留。 */
  const retryAmount = (record: A2PendingCommand): RefundAmount | undefined => {
    if (record.kind !== "approve" || record.fundEffect !== "ORDER_REFUND") return undefined;
    if (record.refundAmountUsdtText !== undefined) return { state: "ok", amount: record.refundAmountUsdtText };
    const ticket = main?.operationQueue.find((w) => w.id === record.target);
    return mainLoading ? { state: "loading" } : ticket ? refundAmount(ticket)
      : { state: "error", message: "退款金额未读取" };
  };
  const retryBlock = (record: A2PendingCommand) => {
    if (isRetryExpired(record)) return RETRY_EXPIRED;
    if (!canRetry(record)) return RETRY_NO_PERMISSION;
    const amount = retryAmount(record);
    if (amount?.state === "loading") return "正在读取退款金额，读完再重试";
    if (amount && amount.state !== "ok") return REFUND_AMOUNT_REQUIRED;
    return undefined;
  };

  /**
   * 按原操作重试：同命令号、同内容、同理由，不接受新输入（OP-94）。只有成功并读回到目标状态才解除待确认。
   * 失败时只有后端对这条命令下了结论（isExplicitRejection：带原因码的 4xx）才放出「解除待确认」；
   * 登录、权限、超时、限流、IDEMPOTENCY_* 只更新说明，原命令和锁都留着（M1、OP-153）。
   */
  const retryPending = async (record: A2PendingCommand) => {
    const blocked = retryBlock(record);
    if (blocked) { notePending(record, blocked); return; }
    if (!a2Commands.isDurablyStored(record.fingerprint, record.commandKey)) {
      notePending(record, "浏览器里查不到这条记录，本次没有发送。原记录继续保留，请在「操作记录」里核对。");
      return;
    }
    setRetryRejected((current) => current.filter((key) => key !== record.commandKey));
    try {
      const queued = recordTicket(record);
      const ticketLike = { id: record.target, action: record.action ?? queued?.action ?? record.target, obj: record.obj ?? queued?.obj ?? "",
        ruleTaskAction: record.ruleTaskAction ?? queued?.ruleTaskAction,
        before: queued?.before ?? "", after: queued?.after ?? "", operationCode: record.operationCode ?? queued?.operationCode,
        fundEffect: record.fundEffect ?? queued?.fundEffect, refundOrderNo: recordOrderNo(record),
        refundAmountUsdtText: record.refundAmountUsdtText ?? queued?.refundAmountUsdtText, rule: recordRule(record) };
      const outcome = record.kind === "param" ? await runParam(record.target as "ttl" | "retention" | "schema", record.value ?? "", record.reason, record.operator)
        : record.kind === "retention" ? await runRetention(record.reason, record.expectedRetentionMonths, record.operator)
          : record.kind === "export" ? await runExport(record.reason, record.filter ?? {}, record.operator)
            : await runDecision(record.kind, ticketLike, record.reason, record.operator);
      // 导出和清理自己会提示「已下载」「清理完成」，不再多弹一条。
      if (outcome === "ok") { if (record.kind !== "export" && record.kind !== "retention") toast(`已确认：${record.label}已生效`, "success"); }
      else notePending(record, "重试的结果仍然未知，原记录继续保留。");
    } catch (cause) {
      if (isPermissionDenied(cause)) announcePermissionDenied();
      const why = ((record.kind === "approve" ? approvalRefusedText(record.operationCode, cause) : undefined)
        ?? (record.kind === "approve" || record.kind === "reject" ? decisionDeniedText(record.kind, cause, true) : undefined) ?? displayAdminError(cause)).replace(/[。.]$/, "");
      if ((cause as { f5StatusRejected?: boolean })?.f5StatusRejected === true) { toast(why, "warn"); return; }
      if (!a2Commands.list().some(row => row.commandKey === record.commandKey)) {
        toast(why, "error");
        return;
      }
      if (isExplicitRejection(cause)) {
        notePending(record, `重试没有成功：${why}。这说明不了原操作的结果，原记录继续保留。`);
        setRetryRejected((current) => [...current, record.commandKey]);
      } else notePending(record, `这次没查到结果：${why}。原记录继续保留，稍后再查询或重试。`);
    }
  };

  /** 读回只给现在的事实，不解除（OP-93、OP-95）。 */
  const verifyPending = async (record: A2PendingCommand) => {
    if (!isPendingCommandOwnedBy(record)) return;
    if (record.kind === "export") {
      // 后端把命令号写进这次导出记录的详情，按对象查得到；查到也只说明后端生成过，文件没下到时按原操作重试。
      const found = await fetchA2Overview({ action: "A2_AUDIT_EXPORTED", object: record.commandKey }).catch(() => null);
      if (!found) { notePending(record, "查询失败，导出记录暂时读不到。原记录继续保留。"); return; }
      const hit = found.recentLogs[0];
      notePending(record, hit
        ? `查到：${logTime(hit)} 有这次的导出记录（${hit.obj.split(" · ").pop()}）。没下到文件就按原请求重试。原记录继续保留。`
        : "没查到这次导出的记录，可能没有生成。原记录继续保留。");
      return;
    }
    if (record.kind === "retention") {
      const latest = await fetchA2RetentionLatest().catch(() => undefined);
      if (latest === undefined) { notePending(record, "查询失败，上次手动清理暂时读不到。原记录继续保留。"); return; }
      setRetentionRun(latest);
      notePending(record, latest
        ? `查到：最近一次手动清理在 ${bizTime(latest.evaluatedAt, latest.evaluatedAt)}，归档 ${latest.archivedRows} 条、移除 ${latest.deletedRows} 条。证明不了是不是这次的结果，原记录继续保留。`
        : "查到：还没有手动清理过的记录。原记录继续保留。");
      return;
    }
    const next = await loadMain().catch(() => null);
    if (!next) { notePending(record, record.kind === "param" ? "查询失败，这项设置暂时读不到。原记录继续保留。" : "查询失败，这张单暂时读不到。原记录继续保留。"); return; }
    if (record.kind === "param") {
      const now = next.mechanismParams.find((item) => item.key === record.target)?.value;
      notePending(record, `查到：${PARAM_NAME[record.target] ?? record.target}现在是 ${now ? operatorCopyText(now) : "—"}，你提交的是 ${record.value}。原记录继续保留。`);
      return;
    }
    const found = ticketStatus(next, record.target);
    if (!found) { notePending(record, "查询失败，这张单暂时读不到。原记录继续保留。"); return; }
    // 批准、驳回、撤回只能对待审批的单发出；按单现在的状态和处理人说这次操作的结果，记录照旧保留。
    const kind = record.kind as "approve" | "reject" | "withdraw";
    const verb = DECISION_VERB[kind];
    const step = retryBlock(record) ? "原记录继续保留。" : "按原请求重试可确认，不会重复执行。";
    const now = `「${HIST_LABEL[found.status] ?? found.status}」${found.actor ? `，处理人 ${found.actor}` : ""}`;
    notePending(record, found.status === "pending" ? `查到：这张单还是「待审批」，这次${verb}还没生效。${step}`
      : found.status === DECISION_STATUS[kind] && (!found.actor || found.actor === session?.username) ? `查到：这张单现在是${now}，和这次${verb}对得上。${step}`
        : found.status === "expired" ? `查到：这张单已过期，这次${verb}没有生效。原记录继续保留。`
          : `查到：这张单现在是${now}，不是这次的${verb}，可能是别人处理的。原记录继续保留。`);
  };

  /** 重试被拒后，人核实过原操作的结果才解除。只放开本页的锁，不发请求，后端仍按这张单现在的状态校验。 */
  const releasePending = (record: A2PendingCommand) => {
    if (!isPendingCommandOwnedBy(record)) return;
    a2Commands.forget(record.fingerprint, record.commandKey);
    syncPending();
    setReleasing(null);
    toast(record.kind === "param" ? "已解除原操作记录，这项设置可以重新调整" : record.kind === "retention" ? "已解除原操作记录，可以重新清理"
      : record.kind === "export" ? "已解除原操作记录，可以重新导出" : "已解除原操作记录，这张单可以重新处理", "success");
  };

  /** 「在操作记录里查看」：切到操作记录，对象填审批单号或机制、清理的资源名，导出按这次的命令号查，模块不限。 */
  const showInRecords = (record: A2PendingCommand) => {
    if (!isPendingCommandOwnedBy(record)) return;
    const next: A2AuditFilter = record.kind === "export" ? { action: "A2_AUDIT_EXPORTED", object: record.commandKey } : { object: PARAM_AUDIT_OBJECT[record.kind] ?? record.target };
    applyFilter(next);
    chooseTab("records");
    setView("logs");
  };

  /* ────────────────── 确认框 ────────────────── */

  const immediate = <StatusTag tone="progress" filled>立即生效</StatusTag>;

  /** 框标题只写「批准审批单」，动作名放在标题下面一行，长了省略、悬停看全文（设计偏差二选一的第一种）。 */
  const subject = (w: A2OperationRow) => <span className="a2-confirm-subject" title={actionName(w)}>{shortCodes(actionName(w))}</span>;

  /** 本人、已退役、解析不了、有未确认操作、正在读取、读不到退款金额：入口先禁用并写原因（第五节）。没有业务权限的入口不显示（OP-124），这里只兜底。 */
  const decideBlock = (w: A2OperationRow, kind: "approve" | "reject" | "withdraw") => {
    if (submitting) return SUBMITTING;
    if (pendingTicketIds.has(w.id)) return PENDING_LOCK;
    if (mainLoading) return RELOADING;
    if (kind === "withdraw") return canWithdraw ? undefined : NO_WITHDRAW;
    if (isMine(w)) return OWN_TICKET_REASON;
    if (kind === "approve" && w.retiredOperation) return RETIRED_OPERATION_COPY;
    if (kind === "approve" && (w.phoneCalibrationError || w.ambassadorMaterialError)) return w.phoneCalibrationError ?? w.ambassadorMaterialError;
    if (!canDecide(w, kind)) return (kind === "approve" ? w.approveDeniedMessage : w.rejectDeniedMessage) ?? NO_DECIDE;
    // 读不到退款金额时不能批准（协调人定，同 C3 读不到详情）；驳回不受影响。
    const amount = kind === "approve" ? refundAmount(w) : undefined;
    if (amount?.state === "loading") return "正在读取退款金额，读完再批准";
    if (amount && amount.state !== "ok") return REFUND_AMOUNT_REQUIRED;
    return undefined;
  };

  /** 已被别人处理（终态、状态变了）：框留着，写最新状态，确认按钮禁用（OP-97）。 */
  const staleReason = (w: A2OperationRow, kind: "approve" | "reject" | "withdraw", cause: unknown) => {
    if (!["A2_OPERATION_ALREADY_TERMINAL", "A2_WITHDRAW_STALE"].includes(backendCode(cause))) return undefined;
    const found = ticketStatus(mainRef.current, w.id);
    const now = found && found.status !== "pending" ? `「${HIST_LABEL[found.status] ?? found.status}」` : "已处理";
    return `这张单现在${found && found.status !== "pending" ? `是${now}` : now}，这次${DECISION_VERB[kind]}没有执行。关闭后看最新状态。`;
  };

  /** 对象一格：认得出的写运营的话，编号等宽跟在后面；配置键这类只给技术同事看的收进「技术信息」。 */
  const objectNode = (w: A2OperationRow): ReactNode => {
    const fund = fundTicket(w);
    if (fund?.kind === "f5Status" && fund.eventId || fund?.kind === "f5Reverse" && fund.eventId) return <>奖励记录 <span data-mono className="a2-code">{fund.eventId}</span></>;
    if (fund?.kind === "f4Settle") return <>本周团队激励池<span className="rd-note">（按批准那一刻所在的周）</span></>;
    if (fund?.kind === "f4Payout" && fund.period) return fund.period;
    if (fund?.kind === "fConfig") return <>{objectText(w)}<Explain label="技术信息" content={`配置键 ${fund.key}${fund.spec?.cron || !fund.spec ? ` ｜ 修改前原文 ${w.before || "—"} ｜ 修改后原文 ${w.after || "—"}` : ""}`} /></>;
    if (fund?.kind === "f5Suspension") return <>用户 <span data-mono className="a2-code">{fund.userId ? userCode(fund.userId) : "—"}</span> · {fund.kinds.length ? kindNames(fund.kinds) : "所选奖励"}</>;
    if (fund?.kind === "f5Reissue" && fund.ids.length) return fund.ids.length <= REISSUE_INLINE
      ? <>奖励记录 <span data-mono className="a2-code">{fund.ids.join("、")}</span></> : `${fund.ids.length} 笔奖励记录（记录号见下方）`;
    if (w.operationCode === "f_unilevel_bootstrap") return <>{objectText(w)}<Explain label="技术信息" content={`对象原文 ${w.obj}`} /></>;
    // 整组政策单（七层结算、好友奖励政策、首次配置等）后端写的对象是 current，不是运营要对照的编号。
    if (w.obj === "current" && !w.objDisplayName) return "当前设置";
    // 整批申请的对象是配置键清单或摘要，运营看不懂：写涉及的页面和项数，原文进技术信息。
    if (fBatchTicket(w)) return <>{objectText(w)}<Explain label="技术信息" content={`对象原文 ${w.obj}${fBatchTicket(w)?.digest ? "（清单太长，只存了摘要）" : ""}`} /></>;
    const ambassador = !w.objDisplayName && /^F\.ambassador\.(\d+)\.status$/.exec(w.obj);
    if (ambassador) return <>区域大使申请 <span data-mono className="a2-code">#{ambassador[1]}</span><Explain label="技术信息" content={`对象原文 ${w.obj}`} /></>;
    if (w.operationCode === "j1_gate_resume") return <>{j1GateName(w.obj)}<Explain label="技术信息" content={`对象原文 ${w.obj}`} /></>;
    if (w.operationCode === "h3_mission_create") return <>任务 <span data-mono className="a2-code">{w.obj}</span></>;
    if (w.operationCode === "h3_quest_config" && h3ConfigName(w.obj)) return <>{h3ConfigName(w.obj)}<Explain label="技术信息" content={`配置键 ${w.obj}`} /></>;
    // 收益记录号是 ER- 加 32 位，不能整串不换行：写全、允许在号里换行，框不出横向滚动。
    if (w.operationCode === "k1_earnings_release") return <>收益记录 <span data-mono className="a2-long-code">{w.obj}</span></>;
    if (isGParamTicket(w)) return <>{objectText(w)}<Explain label="技术信息" content={`参数键 ${w.obj}${w.obj === "divBase" ? ` ｜ 修改前原文 ${w.before || "—"} ｜ 修改后原文 ${w.after || "—"}` : ""}`} /></>;
    return <span data-mono className="a2-code">{objectText(w)}</span>;
  };
  /** 补发两笔以上：逐笔读现在的样子，按申请单上的顺序收在折叠里（一笔时写在「这笔奖励」一行）。 */
  const reissueList = (w: A2OperationRow, open = false) => {
    const fund = fundTicket(w);
    if (fund?.kind !== "f5Reissue" || fund.ids.length < 2) return null;
    return <F5ReissueReadings ids={fund.ids} open={open} />;
  };

  /** 框里的关键信息：退款单第一行是退款金额（VS-102）。动作名在标题下面，这里不再写「操作」，单号只写一次（建议 8）。 */
  const ticketFacts = (w: A2OperationRow, kind: "approve" | "reject", lead?: ReactNode) => {
    const amount = refundAmount(w);
    const name = kind === "approve" ? "退款金额" : "申请退款金额";
    const timing = kind === "approve" ? g3PolicyExecutionTiming(w) ?? phoneScheduledAt(w) : undefined;
    const fund = fundTicket(w);
    const objectLead = fund?.kind === "f5Status" && fund.eventId || fund?.kind === "f4Settle" || fund?.kind === "f4Payout" && fund.period
      || fund?.kind === "fConfig" || fund?.kind === "f5Suspension" || fund?.kind === "f5Reissue" || fund?.kind === "f5Reverse" && fund.eventId;
    return (
      <Facts>
        {amount && (amount.state === "ok"
          ? <Fact k={name} lead tone="role-1" unit="USDT">{orderAmount(amount.amount)}</Fact>
          : <Fact k={name} tone="warn">{refundAmountText(amount)}</Fact>)}
        {objectLead ? <Fact k="对象">{objectNode(w)}</Fact> : null}
        {lead}
        <Fact k="审批单"><span data-mono>{w.id}</span></Fact>
        {!objectLead && <Fact k="对象">{objectNode(w)}</Fact>}
        <Fact k="发起人">{`${w.operator} · ${roleText(w.operatorRole)}`}</Fact>
        {kind === "approve" && <Fact k="发起理由">{keepCodes(w.reason)}</Fact>}
        {timing && <Fact k="生效时间">{timing}</Fact>}
      </Facts>
    );
  };

  /**
   * F4 派奖、F4 本周结算、F5 奖励状态变更的批准框：先写这一次批的是什么、批准后会怎样，再放这一次的结果，规则收进折叠。
   * 句子和发起人那边（f4-confirmations、f5-audit）同一套说法；没有的事实不写；F5 单子里没有用户和金额，按记录号读现在的样子（a2-f5-current）。
   */
  type FundSpec = { irreversible: boolean; impact: string; completion?: string; check: string; detail: string; coverageLead?: string; coverageUnknown?: string;
    coverageCheck?: string; facts?: ReactNode; lead?: ReactNode; review?: boolean; extra?: ReactNode };
  const fundSpec = (w: A2OperationRow): FundSpec | undefined => {
    const fund = fundTicket(w);
    if (!fund) return undefined;
    if (fund.kind === "f4Payout") return {
      irreversible: true,
      impact: fund.period === "总榜" ? "批准后按那一刻的总榜重新计算，真实入账给上榜的人。" : "批准后按那一刻的排行榜重新计算，真实入账给上榜的人。",
      completion: F4_COVERAGE_COPY,
      check: "核对这次实发、名单和发起理由，理由写清依据或工单号。",
      detail: "派过一次后再批准不会重发；奖池为 0 或没人上榜时不发钱。",
      coverageLead: "这次派奖按算出的金额真实发钱",
      coverageUnknown: "这次派奖按算出的金额真实发钱，兑付覆盖率暂时读不到",
      coverageCheck: "批准时先查兑付覆盖率：读不到或低于红线就不发钱，审批单留着，可等覆盖率恢复后再批，或驳回；等于红线算够。",
      facts: undefined,
      // 只有总榜的预览接口能按单子里的信息读到；别的榜要哪一期，单子里没有。
      lead: fund.period === "总榜" ? <F4PayoutPreviewFacts approving rules /> : undefined,
    };
    if (fund.kind === "f4Settle") return {
      irreversible: true,
      impact: "批准后按那一刻所在的周重新计算，真实入账给有资格的人。",
      completion: F4_COVERAGE_COPY,
      check: "核对本周奖池和发起理由，理由写清依据或工单号。",
      detail: "本周已经结算过的会跳过，不补发差额；没有合格票时不发钱。",
      coverageLead: "这次结算按算出的金额真实发钱",
      coverageUnknown: "这次结算按算出的金额真实发钱，兑付覆盖率暂时读不到",
      coverageCheck: "批准时先查兑付覆盖率：读不到或低于红线就不发钱，审批单留着，可等覆盖率恢复后再批，或驳回；等于红线算够。",
      facts: undefined,
      lead: <F4SettleFacts />,
    };
    if (fund.kind === "fConfig") {
      const item = fund.spec;
      const cover = w.amplifies ? coverageFacts(w) : undefined;
      const change = <Fact k={item ? item.item : "这一项"}><Change from={changeBefore(w)} to={changeAfter(w)} /></Fact>;
      return {
        irreversible: false,
        impact: item?.impact ?? "批准后立即改这项设置，失败不改原值。",
        completion: cover?.check,
        check: "核对修改前后的值和发起理由，理由写清依据或工单号。",
        detail: item?.detail ? `${item.detail}` : item ? "" : "这一项在团队相关页面上找不到，原配置键在「对象」旁的技术信息里。",
        coverageLead: cover?.lead,
        coverageUnknown: cover?.lead ? `${cover.lead}，兑付覆盖率暂时读不到` : undefined,
        coverageCheck: cover?.check,
        // 一组值（各榜奖池、头衔、门槛）逐项比，放「完整变更内容」；单个值一行写在事实区。
        facts: item?.json ? undefined : change,
        lead: undefined,
        review: !!item?.json,
      };
    }
    if (fund.kind === "f5Suspension") {
      const friendOnly = fund.kinds.length > 0 && fund.kinds.every((kind) => kind === "direct_purchase" || kind === "direct_device_earning");
      return {
        irreversible: false,
        impact: fund.suspended ? "批准后所选类型里未发完的记录改为已冻结；等价格、待追回的不动。"
          : friendOnly ? "批准后没有其他冻结条件的好友奖励回到冷却中。" : "批准后只解除暂停，已冻结的记录不会自动解冻。",
        completion: undefined,
        check: fund.suspended ? "核对用户和要暂停的类型，理由写清依据。" : "核对用户和奖励类型，理由写清为什么可以恢复。",
        detail: fund.suspended ? "能撤回：在「奖励记录核对」的暂停名单恢复，也要审批。好友两类以后算出金额的先冻结；其他类型以后不一定停发。" : friendOnly ? "" : "已冻结的要在「奖励记录核对」逐笔解冻。",
        coverageLead: undefined, coverageUnknown: undefined, coverageCheck: undefined,
        facts: <><Fact k="状态"><Change from={changeBefore(w)} to={changeAfter(w)} /></Fact>{fund.suspended && <Fact k="能不能撤回">能，恢复也要审批</Fact>}</>,
        lead: undefined,
      };
    }
    if (fund.kind === "f5Reissue") {
      const cover = coverageFacts(w);
      return {
        irreversible: true,
        impact: "批准后每笔生成一条新记录，原记录不变。",
        completion: cover?.check,
        check: "核对每一笔为什么能补发，理由写清依据。",
        detail: "有一笔不合格整批都不补，不会只补一部分；好友奖励不能补发。",
        coverageLead: cover?.lead,
        coverageUnknown: cover?.lead ? `${cover.lead}，兑付覆盖率暂时读不到` : undefined,
        coverageCheck: cover?.check,
        facts: <>
          {fund.ids.length === 1 && <F5CurrentFact id={fund.ids[0]} />}
          <Fact k="补发后">团队购买、团队平衡重新冷却；其余四类马上解锁</Fact>
          <Fact k="能不能撤回">不能；新记录可以再冲正</Fact>
        </>,
        lead: undefined,
        extra: reissueList(w),
      };
    }
    if (fund.kind === "f5Reverse") return {
      irreversible: true,
      impact: "批准后收回这笔奖励，状态改为已冲正。",
      completion: undefined,
      check: "核对这笔奖励和发起理由，理由写清收回的原因。",
      detail: "余额不够时：属于结算组的奖励扣不够的记为待追回；其他奖励整次失败，什么都不改。",
      coverageLead: undefined, coverageUnknown: undefined, coverageCheck: undefined,
      facts: <>{fund.eventId && <F5CurrentFact id={fund.eventId} />}<Fact k="状态"><Change from={changeBefore(w)} to={changeAfter(w)} /></Fact><Fact k="凭证单号">申请单里没有，批准时系统再核对</Fact></>,
      lead: undefined,
    };
    const from = F5_STATE_FROM[fund.state] ?? "批准时的状态";
    const to = F5_STATE_NAME[fund.state] ?? fund.state;
    const state = <>{fund.eventId && <F5CurrentFact id={fund.eventId} />}<Fact k="状态"><Change from={from} to={to} /></Fact></>;
    if (fund.state === "unlocked") return {
      irreversible: true,
      impact: "批准后这笔改为已解锁，释放到用户钱包。",
      completion: "批准时先核对，不满足就不放钱，审批单留着待审批。",
      check: "核对这笔奖励和发起理由，理由写清为什么要提前。",
      detail: "要收回只能冲正，不能改回冷却中。",
      coverageLead: undefined,
      coverageUnknown: undefined,
      coverageCheck: "批准时先查兑付覆盖率：读不到或低于红线就不放钱，审批单留着待审批；等于红线算够。",
      facts: <>{state}<Fact k="批准时核对">有没有暂停、兑付覆盖率够不够<Explain label="结算组的奖励" content="属于结算组的奖励还要核冷却有没有真正到期；没到期会被拒，钱不会提前流出。" /></Fact></>,
      lead: undefined,
    };
    if (fund.state === "cooling") return {
      irreversible: false,
      impact: "批准后这笔回到冷却中，到期自动解锁；解冻本身不动用户余额。",
      completion: undefined,
      check: "核对冻结的原因是否已经解除，理由写清依据。",
      detail: "",
      coverageLead: undefined,
      coverageUnknown: undefined,
      coverageCheck: undefined,
      facts: <>{state}<Fact k="到期时间">接着冻结时剩下的时间冷却<Explain label="什么时候会被拒" content="以前暂停用户奖励时冻结的旧记录，到期时间已被清空，批准时会被拒，这笔继续冻结。属于结算组的奖励，用户还在暂停或风险冻结中时也会被拒。" /></Fact></>,
      lead: undefined,
    };
    if (fund.state === "frozen") return {
      irreversible: false,
      impact: "批准后这笔停在冷却里，到期也不解锁；用户余额不变。",
      completion: undefined,
      check: "核对这笔奖励和发起理由，理由写清为什么要先按住。",
      detail: "冻结可以再解冻，回到冷却中。",
      coverageLead: undefined,
      coverageUnknown: undefined,
      coverageCheck: undefined,
      facts: state,
      lead: undefined,
    };
    return undefined;
  };

  const approveRequest = (w: A2OperationRow): ActionConfirmReq => {
    const isRefund = w.fundEffect === "ORDER_REFUND";
    const isFunds = w.type === "fund" || isRefund || w.fundEffect === "REWARD_SUSPENSION" || w.fundEffect === "REWARD_RESUMPTION";
    const briefKind = isFunds ? "funds" : w.type === "acct" ? "security" : w.type === "sos" ? "emergency" : "config";
    const timing = approvalTiming(w);
    const j4 = isJ4Execution(w);
    const scheduled = phoneScheduledAt(w);
    const g3 = g3PolicyExecutionTiming(w);
    const i5Publish = w.operationCode === "i5_disclosure_publish" || w.operationCode === "i4_disclosure_publish";
    // 一行放得下（必须改 14）；时点只写在「生效时间」一处（建议 8）。
    // 摘要标题行只放得下 20 字左右，长了会折出孤字（D10）；细节写在「说明」和事实区。
    const impact = scheduled || monthlyTargetChange(w) ? timing.impact
      : j4 ? "逐步执行，失败时可能只执行了一部分。"
        : w.coverageCheckOnApproval ? "先查兑付覆盖率，够了才执行，不够不动。"
          : g3 ? "按生效时间执行，改线上配置。"
            // 发布只封存这一版，用户看哪版由 I5 的生效版本决定（i5-disclosures 发布框同一说法）。
            : i5Publish ? "批准后这版封存，用户看到的版本不变。"
            : isFunds ? "立即执行，改资金或账目；失败不改原值。"
              : w.type === "acct" ? "立即执行，改账号或权限；失败不改原值。"
                : w.type === "sos" ? "立即执行，停用或恢复业务；失败不改原值。"
                  : "立即执行，改线上配置；失败不改原值。";
    const check = isRefund ? "核对退款金额、订单和发起理由，理由写清依据或工单号。"
      : isFunds ? "核对对象、变更前后和发起理由，理由写清依据或工单号。"
        : w.type === "acct" ? "核对目标账号、申请的角色和发起理由，理由写清依据或工单号。"
          : w.type === "sos" ? "核对值班授权、影响范围和恢复条件，理由写清依据或工单号。"
            : i5Publish || w.operationCode === "i5_matrix_configure" ? "核对这次披露改了什么，理由写清版本依据。"
            : "核对修改前后的值和影响范围，理由写清依据或工单号。";
    const amplifies = w.amplifies && !w.coverageCheckOnApproval;
    const k1 = k1TicketView(w);
    const k1Spec: FundSpec | undefined = k1 && (k1.kind === "release" ? {
      irreversible: true,
      impact: "批准后这笔收益放行，钱不再锁住。",
      check: "核对用户、净额、来源和发起理由，理由写清依据或工单号。",
      detail: "只放行这一笔，不另发奖、不生成提现单。",
      coverageLead: "批准后这笔钱不再锁住",
      coverageUnknown: "批准后这笔钱不再锁住，兑付覆盖率暂时读不到",
      coverageCheck: K1_APPROVAL_CHECK.release,
      facts: <K1TicketFacts v={k1} />,
    } : {
      irreversible: false,
      impact: k1.key === "duplicateAccountFreezeFrom" ? "批准后新值生效，已有余额可能恢复提现。" : "批准后新值生效，可能增加可提现收益。",
      check: "核对修改前后的值和发起理由，理由写清依据或工单号。",
      detail: "",
      coverageLead: "放宽后可能多放收益",
      coverageUnknown: "放宽后可能多放收益，兑付覆盖率暂时读不到",
      coverageCheck: K1_APPROVAL_CHECK.param,
      facts: <K1TicketFacts v={k1} />,
    });
    // F2 首次配置：七层逐行列出后端写在单上的数，不显示原文的修改前后。
    const boot = w.operationCode === "f_unilevel_bootstrap" ? parseF2BootstrapAfter(w.after) : undefined;
    const bootSpec: FundSpec | undefined = boot && {
      irreversible: false,
      impact: "批准后七层规则一次建好；整体结算不会自动启用。",
      check: "逐层核对下表和发起理由，理由写清依据或工单号。",
      detail: "七层都没有规则时才能执行，以前配置过的会被拒。",
      coverageLead: "启用结算后，平台按这些比例付团队奖励",
      coverageUnknown: "启用结算后，平台按这些比例付团队奖励；兑付覆盖率暂时读不到",
      coverageCheck: "批准时先查兑付覆盖率：低于红线就不建规则，审批单留着待审批。",
      facts: <><Fact k="要建立">L1–L7 七层规则</Fact><Fact k="七层合计占订单">{`${f2PctSum(boot.map((row) => row.usdtPct))}%`}</Fact><Fact k="整体结算">不会自动启用，要另外申请</Fact></>,
      extra: <F2BootstrapReview rows={boot} label="要建立的七层规则" />,
    };
    const fund = fundSpec(w) ?? k1Spec ?? bootSpec;
    const belowRedline = !!coverage && coverage.coverageRatio < coverage.redlinePct;
    return {
      briefKind,
      title: "批准审批单",
      action: <>确认执行 · {w.id}({fBatchTicket(w) || w.operationCode === "j1_gate_resume" ? actionName(w) : a2ActionText(w.action)})</>,
      effect: <>{subject(w)}<StatusTag tone="progress" filled>{timing.tag}</StatusTag>{(isRefund || fund?.irreversible) && <IrreversibleTag />}</>,
      detail: fund ? <>{fund.detail}谁能批准：{approvalExecutorLabel(w)}。</> : j4
        ? <>中途失败时，前面的步骤可能已经生效。到「监管要求应急处理」的执行追溯里核对每一步。谁能批准：{approvalExecutorLabel(w)}。</>
        : w.coverageCheckOnApproval ? <>{approvalCoverageCopy(w)}</> : <>谁能批准：{approvalExecutorLabel(w)}。{decisionRule(w).backendChecks && `${BACKEND_CHECKS_NOTE}。`}</>,
      completionCopy: fund?.completion,
      // 派奖、结算：这一次的结果放在关键信息层（和发起人那边同一块），审批单信息放在后面。
      facts: fund?.lead ?? ticketFacts(w, "approve", fund?.facts),
      content: fund?.lead ? <div className="rd-confirm-facts">{ticketFacts(w, "approve")}</div> : fund?.facts && !fund.review ? fund.extra ?? undefined : (
        <div className="rd-stack">
          {fund?.extra}
          {fBatchTicket(w)?.items ? <A2BatchReview items={fBatchTicket(w)!.items!} />
            : isRoleGrantsTicket(w)
            ? <A2RoleGrantsChange limit={4} review={w.roleGrantsReview} fallback={<A2ChangeReview operationCode={reviewOperation(w)} before={changeBefore(w)} after={changeAfter(w)} />} />
            : <A2ChangeReview operationCode={reviewOperation(w)} before={changeBefore(w)} after={changeAfter(w)} omit={g3 ? ["生效时间"] : undefined}>
                {/* I5 发布、设置／切换生效版本：列表上直接批准也看同一份对照，和详情抽屉一样（BUG-503）。 */}
                <A2I5DisclosureReview key={w.id} ticket={w} />
              </A2ChangeReview>}
          {w.phoneCalibrationProposal && <PhoneCalibrationReview proposal={w.phoneCalibrationProposal} />}
          {w.ambassadorMaterialProposal && <AmbassadorMaterialSummary packet={w.ambassadorMaterialProposal} expectedMaterialRevision={w.ambassadorMaterialProposal.applicationDecision === "APPROVE" ? w.ambassadorMaterialProposal.expectedMaterialRevision : undefined} />}
          {isRefund && w.refundOrderNo && <PromotionRefundImpact orderNo={w.refundOrderNo} />}
        </div>
      ),
      statedBrief: fund ? { impact: fund.impact, check: fund.check } : { impact, check },
      amplifies,
      // 有覆盖率时事实区写「兑付覆盖率 X，红线 Y」，多付钱和检查时点进问号；读不到时橙黄写出来，不是一句白字（必须改 12）。
      // 低于红线时共用框写的是发起人的话（「暂时不能提交」）：这里不把读数交给共用框，自己写读数和批准人的话，按钮照样禁用。
      coverage: amplifies && !belowRedline ? coverage : undefined,
      coverageLead: amplifies && belowRedline ? <span className="a2-coverage-unknown">兑付覆盖率 {fmtPct(coverage.coverageRatio)}，低于红线 {fmtConfigPct(coverage.redlinePct)}</span>
        : amplifies && !coverage ? <span className="a2-coverage-unknown"><AlertTriangle size={14} aria-hidden />{fund?.coverageUnknown ?? "会让平台多付钱，兑付覆盖率暂时读不到"}</span> : fund?.coverageLead,
      coverageCheck: fund?.coverageCheck ?? coverageFacts(w)?.check ?? PAGE_COVERAGE_COPY,
      blockedReason: amplifies && belowRedline ? "兑付覆盖率低于红线，现在不能批准；恢复后再批，或驳回。" : undefined,
      reasonMin,
      reasonMax: 200,
      confirmLabel: "确认批准",
      // 直接动钱的确认用红（决定 50）。
      confirmTone: w.amplifies || isRefund ? "danger" : "primary",
      run: async (reason) => {
        try {
          const outcome = await runDecision("approve", w, reason);
          if (outcome === "ok") { decisionToast("approve", w.id); setTicketId(null); }
        } catch (cause) {
          const stale = staleReason(w, "approve", cause);
          if (stale) openActionConfirm({ ...approveRequest(w), blockedReason: stale });
          // 共用的说法对直接编辑、演练都成立；审批这里还要写下一步（M8）。
          if (backendCode(cause) === "J4_PLAYBOOK_NOT_FOUND") throw new Error("应急预案不存在，可能已被删除，这张单不能批准。请驳回后按最新的预案重新发起。");
          const refused = approvalRefusedText(w.operationCode, cause);
          if (refused) throw new Error(refused);
          const denied = decisionDeniedText("approve", cause);
          if (denied) throw new Error(denied);
          throw cause;
        }
      },
    };
  };

  /** 驳回只是不执行，业务什么都没变，还能重新发起：不标「不能撤销」，不用红（必须改 2，VS-106、VS-107）。 */
  const rejectRequest = (w: A2OperationRow): ActionConfirmReq => ({
    briefKind: "record",
    title: "驳回审批单",
    action: <>取消执行 · {w.id} · {w.operationCode === "j1_gate_resume" ? actionName(w) : a2ActionText(w.action)}</>,
    effect: <>{subject(w)}{immediate}</>,
    detail: <>{w.retiredOperation ? "此操作已退役。驳回后保留历史记录，不能重新发起。" : "驳回后这张单结束，要做需重新发起。"}</>,
    facts: ticketFacts(w, "reject", (() => {
      const v = k1TicketView(w);
      return v && (v.kind === "release" ? <Fact k="净额" lead tone="role-1" unit={nexGridBrandText(v.asset)}>{k1Amount(v.net)}</Fact>
        : <Fact k={v.name}><Change from={`${v.from} 个账户`} to={`${v.to} 个账户`} /></Fact>);
    })()),
    statedBrief: w.retiredOperation
      ? { impact: "改为已驳回，原操作不执行。", check: "理由写清驳回依据或工单号。" }
      : { impact: "改为已驳回，原操作不执行；可以重新发起。", check: "理由写清驳回依据或工单号。" },
    amplifies: false,
    reasonMin,
    reasonMax: 200,
    confirmLabel: "确认驳回",
    run: async (reason) => {
      try {
        const outcome = await runDecision("reject", w, reason);
        if (outcome === "ok") { decisionToast("reject", w.id); setTicketId(null); }
      } catch (cause) {
        const stale = staleReason(w, "reject", cause);
        if (stale) openActionConfirm({ ...rejectRequest(w), blockedReason: stale });
        const denied = decisionDeniedText("reject", cause);
        if (denied) throw new Error(denied);
        throw cause;
      }
    },
  });

  const withdrawRequest = (w: A2OperationRow): ActionConfirmReq => ({
    briefKind: "record",
    title: "撤回我的申请",
    action: <>撤回我的申请 · {w.id}</>,
    effect: <>{subject(w)}{immediate}</>,
    detail: <>撤回后原操作不会执行。只有申请人本人能撤回。</>,
    facts: <Facts><Fact k="审批单"><span data-mono>{w.id}</span></Fact><Fact k="对象">{objectNode(w)}</Fact></Facts>,
    statedBrief: { impact: "改为已撤回，原操作不执行。", check: "理由写清撤回原因或工单号。" },
    amplifies: false,
    reasonMin,
    reasonMax: 200,
    confirmLabel: "确认撤回",
    run: async (reason) => {
      try {
        const outcome = await runDecision("withdraw", w, reason);
        if (outcome === "ok") { decisionToast("withdraw", w.id); setTicketId(null); }
      } catch (cause) {
        const stale = staleReason(w, "withdraw", cause);
        if (stale) openActionConfirm({ ...withdrawRequest(w), blockedReason: stale });
        throw cause;
      }
    },
  });

  const confirmDecision = (w: A2OperationRow, kind: "approve" | "reject" | "withdraw") => {
    const blocked = decideBlock(w, kind);
    if (blocked) { toast(blocked, "warn"); return; }
    if (kind === "approve" && ticketId !== w.id) readF5Current(f5RecordIds(fundTicket(w)), true);
    openActionConfirm(kind === "approve" ? approveRequest(w) : kind === "reject" ? rejectRequest(w) : withdrawRequest(w));
  };

  /* 导出：按已查询的条件（appliedFilter），和其他写操作一样先存原命令（M2）。能不能导按后端查到的结果判断（M4）。 */
  const exportPending = pendingCommands.some((record) => record.kind === "export");
  const exportBlock = !canExport ? undefined
    : exportPending ? "导出有一次结果未知，先到页面上方核对"
      : recordsLoading ? "操作记录还在读取，读完再导出"
        : recordsError || !records ? "操作记录读取失败，暂不能导出"
          : logRows.length === 0 ? "当前筛选没有可导出的记录" : undefined;

  const appliedText = (filter: A2AuditFilter) => {
    const parts = [
      filter.domain && filter.domain !== "all" ? DOMAIN_NAMES[filter.domain] : "",
      ...(["operator", "action", "object", "startTime", "endTime"] as const).map((key) => filter[key] ? `${FILTER_LABEL[key]} ${filter[key]}` : ""),
    ].filter(Boolean);
    return parts.join(" · ");
  };

  const exportAudit = () => {
    if (!canExport || exportBlock) return;
    const filter = appliedRef.current;
    const scope = appliedText(filter);
    openActionConfirm({
      briefKind: "export",
      title: "导出操作记录",
      action: "导出操作记录",
      effect: immediate,
      detail: null,
      facts: (
        <Facts>
          <Fact k="范围">{scope || "全部模块，不限时间"}</Fact>
          <Fact k="文件">CSV，最多 5,000 条</Fact>
          <Fact k="隐藏">操作者、资源编号、业务编号只留首尾两位，4 位及以下的全部隐藏</Fact>
        </Facts>
      ),
      statedBrief: { impact: "按查询条件生成 CSV 下载，这次导出也会记录。", check: "核对导出范围，理由写明导出依据或工单号。" },
      amplifies: false,
      reasonMin,
      reasonMax: 200,
      confirmLabel: "确认导出",
      run: async (reason) => { await runExport(reason, filter); },
    });
  };

  /* 机制参数：理由最短长度、保留期、字段版本。 */
  const paramBlock = (key: string) => submitting ? SUBMITTING
    : pendingParams.has(key) ? "这项有一次调整结果未知，先到页面上方核对"
      : mainLoading ? "设置还在读取，读完再调整" : undefined;

  /** 字段版本只能逐版升级：现在 v3 时能填的只有 v4，直接写出来，不让人手打（必须改 11）。 */
  const nextSchema = (current: string) => ["v3", "v4"].find((version) => validateA2MechanismValue("schema", version, current).ok);

  const adjustParam = (key: "ttl" | "retention" | "schema") => {
    if (paramBlock(key)) return;
    const raw = mechanismParams.find((p) => p.key === key)?.value;
    const current = key === "schema" ? schemaVersion(raw) || "v3" : raw?.match(/\d+/)?.[0] ?? (key === "ttl" ? "8" : "13");
    const next = key === "schema" ? nextSchema(current) : undefined;
    if (key === "schema" && !next) return;
    const edit: ActionConfirmReq["edit"] = key === "ttl"
      ? { kind: "number", current, unit: "字", min: 8, max: 200, step: 1, disallowCurrent: true, hint: "8–200 的整数",
        preview: (v) => `改成 ${v} 字：之后所有确认框的理由少于 ${v} 个可见字符就不能提交。` }
      : key === "retention"
        ? { kind: "number", current, unit: "月", min: 13, max: 36, step: 1, disallowCurrent: true, hint: "13–36 的整数，至少覆盖一个完整的 12 个月运营周期",
          preview: (v) => `改成 ${v} 个月：之后新写的记录在线保留 ${v} 个月，已有记录按原到期时间。` }
        : undefined;
    const brief = key === "ttl"
      ? { impact: "全后台确认框按新字数检查，已有记录不受影响。", check: "核对新字数，理由写清依据或工单号。" }
      : key === "retention"
        ? { impact: "只对之后新写的操作记录生效，已有记录按自己的到期时间。", check: "核对新值，理由写清依据或工单号。" }
        : { impact: "之后新写的记录按新版本记，历史记录不改。", check: "核对目标版本，理由写清依据或工单号。" };
    openActionConfirm({
      briefKind: "config",
      title: PARAM_TITLE[key],
      // action 是记进操作记录、被指纹核对的名字，不跟着标题改。
      action: key === "ttl" ? "操作理由最短长度" : key === "retention" ? "操作记录保留期" : "升级记录字段版本",
      effect: immediate,
      detail: null,
      edit,
      facts: key === "schema" && next ? <DiffList rows={[{ key: "schema", before: current, after: next }]} /> : undefined,
      content: key === "schema" ? (
        <p className="rd-note a2-confirm-note">
          只能逐版升级，升级后不能回到 {current}。新事件或字段先在
          {reach("/platform/events") ? <Link className="rd-link" href="/platform/events" prefetch={false}>「用户行为事件」</Link> : "「用户行为事件」"}登记。
        </p>
      ) : undefined,
      statedBrief: brief,
      amplifies: false,
      reasonMin,
      reasonMax: 200,
      confirmLabel: key === "schema" ? "确认升级" : undefined,
      run: async (reason, v) => {
        const value = key === "schema" ? next ?? "" : v ?? "";
        const validation = validateA2MechanismValue(key, value, key === "schema" ? current : undefined);
        if (!validation.ok) throw new Error(validation.message);
        const outcome = await runParam(key, validation.value, reason);
        if (outcome === "ok") paramToast(key, validation.value);
      },
    });
  };

  const retentionBlock = submitting ? SUBMITTING
    : retentionPending ? "清理有一次结果未知，先到页面上方核对"
      : retentionPreviewError ? `清理范围加载失败，暂不能清理：${retentionPreviewError}`
        : !retentionPreview || retentionLoading ? "正在加载清理范围，请稍后重试"
          : !main || mainLoading ? "设置还在读取，读完再清理"
            // 没有到期的记录时点开走完什么也没清，还会留一条空清理记录（必须改 9）。
            : retentionPreview.eligibleRows === 0 ? "现在没有到期的记录，不用清理" : undefined;

  const confirmRetention = () => {
    // 服务端预览拿不到时不允许执行：操作前说不清范围的不可撤销操作，宁可挡住。
    if (!canWrite || retentionBlock || !retentionPreview) return;
    const preview = retentionPreview;
    openActionConfirm({
      briefKind: "record",
      title: RETENTION_TITLE,
      action: <>归档并清理已到期操作记录</>,
      effect: <>{immediate}<IrreversibleTag /></>,
      detail: null,
      facts: (
        <Facts>
          <Fact k="可清理" lead unit="条">{count(preview.eligibleRows)}</Fact>
          <Fact k="最早到期">{preview.earliestExpireAt ? bizTime(preview.earliestExpireAt, preview.earliestExpireAt) : "—"}</Fact>
          <Fact k="未到期">{`${count(preview.notYetExpiredRows)} 条，不动`}</Fact>
          <Fact k="旧版历史">{`${count(preview.legacyRowsWithoutExpireAt)} 条，不动`}</Fact>
          <Fact k="保留期">{`${preview.retentionMonths} 个月`}</Fact>
          <Fact k="每次最多处理">2,000 条</Fact>
        </Facts>
      ),
      // 「不能撤销」标题下已有标签，摘要不再写（VS-106）。
      statedBrief: { impact: "到期记录先归档再移出列表；未到期的不动。", check: "核对条数和最早到期时间，理由写清依据或工单号。" },
      amplifies: false,
      reasonMin,
      reasonMax: 200,
      confirmLabel: "确认清理",
      confirmTone: "danger",
      run: async (reason) => { await runRetention(reason, preview.retentionMonths); },
    });
  };

  /* ────────────────── 操作记录的筛选 ────────────────── */

  const applyFilter = (next: A2AuditFilter) => {
    setFilterDraft(next);
    setAppliedFilter(next);
    appliedRef.current = next;
    // 上一组条件的结果不能当这组的显示，读完前是读取中（M4）。
    setFiltered(null);
    setRangeError("");
    setLogPage(1);
    setHistPage(1);
    setLogId(null);
    setHistoryId(null);
    void loadFiltered(next);
  };

  const submitFilter = () => {
    const next: A2AuditFilter = {};
    for (const key of FILTER_PARAMS) {
      const value = filterDraft[key]?.trim();
      if (value && !(key === "domain" && value === "all")) Object.assign(next, { [key]: value });
    }
    const problem = validateA2AuditFilterRange(next);
    // 不合法不发请求，就地写原因，输入保留（ST-19）。
    if (problem) { setRangeError(problem); return; }
    applyFilter(next);
  };

  const clearFilter = () => applyFilter({});
  const removeCondition = (key: FilterKey) => {
    const next = { ...appliedFilter };
    delete next[key];
    applyFilter(next);
  };
  const draftChanged = FILTER_PARAMS.some((key) => (filterDraft[key]?.trim() ?? "") !== (appliedFilter[key] ?? ""));
  const moreCount = (["action", "startTime", "endTime"] as const).filter((key) => appliedFilter[key]).length;
  const appliedChips = FILTER_PARAMS.filter((key) => appliedFilter[key]).map((key) => ({
    key,
    label: key === "domain" ? `模块：${DOMAIN_NAMES[appliedFilter.domain as A2AuditDomain]}` : `${FILTER_LABEL[key]}：${appliedFilter[key]}`,
    onRemove: () => removeCondition(key),
  }));
  const setDraft = (key: FilterKey, value: string) => {
    setFilterDraft((current) => ({ ...current, [key]: value }));
    if (key === "startTime" || key === "endTime") setRangeError("");
  };

  /* 带筛选进来时的定位提示；这个对象还有待审批单时给直达（第三节「操作记录」）。 */
  const locatePending = hasApplied && filtered ? filtered.operationQueue.filter((w) => w.status === "pending") : [];
  const openTicketFromRecords = (id: string) => {
    closeDrawers();
    setTab("pending");
    setQType("all");
    setQOperator("all");
    const index = pendingQueue.findIndex((w) => w.id === id);
    if (index >= 0) setQPage(Math.floor(index / qPageSize) + 1);
    setTicketId(id);
  };
  const locateNotice = enteredFilter && sameFilter(enteredFilter, appliedFilter) && (
    <Notice tone={locatePending.length ? "warn" : "neutral"}>
      已按「{appliedText(enteredFilter)}」筛选。
      {locatePending.length === 1 && <> 这个对象还有 1 条待审批 · <button type="button" className="rd-link" onClick={() => openTicketFromRecords(locatePending[0].id)}>打开审批单</button></>}
      {locatePending.length > 1 && <> 这个对象还有 {locatePending.length} 条待审批：{locatePending.slice(0, 3).map((w, index) => <span key={w.id}>{index > 0 && "、"}<button type="button" className="rd-link" onClick={() => openTicketFromRecords(w.id)}>{actionName(w)} {w.id}</button></span>)}{locatePending.length > 3 && " 等"}</>}
    </Notice>
  );

  /* ────────────────── 渲染 ────────────────── */

  const pendingCount = main ? main.stats.pendingTickets : "—";
  const copyId = (value: string) => {
    void navigator.clipboard?.writeText(value).then(() => toast("已复制审批单号", "success"), () => toast("复制失败，请手动选择单号", "error"));
  };

  const pendingNotices = pendingCommands.map((record) => {
    const expired = isRetryExpired(record);
    const amount = retryAmount(record);
    return (
      <Notice key={record.fingerprint} tone="warn" title={`${record.label} · 结果未知`} actionBelow
        action={<>
          <Button size="sm" disabled={!!submitting} onClick={() => void verifyPending(record)}>查询原结果</Button>
          <Button size="sm" disabled={!!submitting} disabledReason={retryBlock(record)} onClick={() => void retryPending(record)}>按原请求重试</Button>
          {retryRejected.includes(record.commandKey) && <Button size="sm" disabled={!!submitting} onClick={() => setReleasing(record)}>解除原操作记录</Button>}
          <Button size="sm" variant="ghost" onClick={() => showInRecords(record)}>在操作记录里查看</Button>
        </>}>
        <p>
          {bizTime(new Date(record.createdAt).toISOString(), "—")}（{zone}）发出，可能已经生效。{expired ? RETRY_EXPIRED : RECOVERY_HINT[record.kind]}
          <Explain label="技术信息" content={`原请求编号 ${record.commandKey} ｜ 操作人 ${record.operator} ｜ 理由 ${record.reason}`} />
        </p>
        {amount && <p>退款金额 {amount.state === "ok" ? <b className="a2-amount">{refundAmountText(amount)}</b> : <span className="a2-warn-text">{refundAmountText(amount)}</span>}
          {amount.state === "error" && recordOrderNo(record) && <> <InlineRetry onRetry={() => void loadMain()} /></>}</p>}
        {(record.kind === "approve" || record.kind === "reject") && recordRule(record).backendChecks && <p>{BACKEND_CHECKS_NOTE}。</p>}
        {pendingNotes[record.fingerprint] && <p>{pendingNotes[record.fingerprint]}</p>}
      </Notice>
    );
  });

  /* 待审批：行内按钮都是小号次按钮，点了只开确认框（D2 新手测试）。整屏主按钮只有抽屉里的「批准」（DP-40）。
     没有这张单的业务权限时不显示批准、驳回（OP-124）；整页一行都没有可做的事时不画「操作」列（建议 3）。 */
  const rowCanAct = (w: A2OperationRow) => isMine(w) || canDecide(w, "reject") || (!w.retiredOperation && canDecide(w, "approve"));
  const rowActions = (w: A2OperationRow) => {
    if (isMine(w)) return <Button size="sm" disabledReason={decideBlock(w, "withdraw")} onClick={() => confirmDecision(w, "withdraw")}>撤回我的申请</Button>;
    if (!rowCanAct(w)) return <Cell main={<span className="rd-weak">{WAIT_OTHERS}</span>} />;
    return <>
      {canDecide(w, "reject") && <Button size="sm" disabledReason={decideBlock(w, "reject")} onClick={() => confirmDecision(w, "reject")}>驳回</Button>}
      {!w.retiredOperation && canDecide(w, "approve") && <Button size="sm" disabledReason={decideBlock(w, "approve")} onClick={() => confirmDecision(w, "approve")}>批准</Button>}
    </>;
  };
  const showActions = qPageRows.some(rowCanAct);
  const queueColumns = showActions ? 5 : 4;

  /** 有结果未确认的操作时这一行也标出来，滚下去看不到上方的待确认条也知道（建议 4）。 */
  const markers = (w: A2OperationRow) => {
    const tags = <>
      {pendingTicketIds.has(w.id) && <StatusTag tone="warn" explain={PENDING_LOCK}>结果未知</StatusTag>}
      {w.sos && <StatusTag tone="danger" icon={Siren}>应急</StatusTag>}
      {w.amplifies && <StatusTag tone="warn" icon={Flame}>多付钱</StatusTag>}
    </>;
    return w.sos || w.amplifies || pendingTicketIds.has(w.id) ? <span className="rd-row-actions">{tags}</span> : TYPE_NAME[w.type];
  };

  const pendingTab = (
    <>
      {mainError && !main ? (
        <BlockState state="error" title="审批单读取失败，不显示旧数据" detail={mainError} onRetry={() => void loadMain().catch(() => undefined)} retrying={mainLoading} />
      ) : <>
        {/* 待审批是数量不是状态，按角色色；应急、资金类只给图标底上色，数字正文色（必须改 4，同提现审核）。 */}
        <StatBand label="待审批汇总" fit>
          <Stat lead tone="role-2" icon={Inbox} label="待审批" value={stats ? stats.pendingTickets : "—"} unit={stats ? "条" : undefined}
            sub={mineCount > 0 ? `其中你发起的 ${mineCount} 条` : undefined} onOpen={() => { setQType("all"); setQPage(1); }} openLabel="看全部待审批" />
          <Stat iconTone="danger" icon={Siren} label="应急" value={stats ? stats.sosTickets : "—"} unit={stats ? "条" : undefined}
            explain="紧急停用的恢复申请和应急预案执行，排在最前。" onOpen={() => { setQType("sos"); setQPage(1); }} openLabel="只看应急" />
          <Stat iconTone="role-1" icon={Coins} label="资金类" value={stats ? stats.fundTickets : "—"} unit={stats ? "条" : undefined}
            explain="会改变用户资金、提现或平台账目的审批单。" onOpen={() => { setQType("fund"); setQPage(1); }} openLabel="只看资金类" />
        </StatBand>

        {/* 没有搜索框占满这一行，发起人下拉靠右，这一行才铺得开（P2-side）。 */}
        <FilterBar scope={<Segments label="审批单类型" value={qType} items={TYPE_ITEMS} onChange={(value) => { setQType(value); setQPage(1); }} />}
          sort={<FilterField><Select aria-label="发起人" value={qOperator} onChange={(value) => { setQOperator(value as QOperator); setQPage(1); }} options={OPERATOR_OPTIONS} /></FilterField>} />

        <Panel flush icon={ClipboardList} tone="role-3" title="待审批的操作" explain="应急在前，资金类其次，其余按提交时间从新到旧。">
          {/* 1024 也要放下：对象多是系统键，名字里通常已经带着，列表不单列，抽屉和确认框里常显（DP-13）。 */}
          <Table label="待审批的操作" data-tight="">
            <thead><tr>
              <Th sticky="start">审批单 · 提交时间（{zone}）</Th>
              <Th>变更</Th>
              <Th icon={Users} tone="users">发起人</Th>
              <Th>标记</Th>
              {showActions && <Th sticky="end">操作</Th>}
            </tr></thead>
            <tbody>
              {!main && mainLoading ? <TableLoading columns={queueColumns} rows={5} />
                : qPageRows.length === 0 ? (
                  <TableMessage columns={queueColumns} role="status">
                    {queueFiltered ? <>没有符合条件的待审批操作 <Button size="sm" onClick={() => { setQType("all"); setQOperator("all"); setQPage(1); }}>清除筛选</Button></> : "没有待审批的操作"}
                  </TableMessage>
                ) : qPageRows.map((w) => {
                  const batch = fBatchTicket(w);
                  const k1 = k1TicketView(w);
                  const boot = w.operationCode === "f_unilevel_bootstrap" ? parseF2BootstrapAfter(w.after) : undefined;
                  const mission = h3MissionView(w);
                  const change = mission ? { main: `${mission.name} · 奖励 ${mission.reward}`, sub: "新建" } : boot ? { main: `L1–L7 合计占订单 ${f2PctSum(boot.map((row) => row.usdtPct))}%`, sub: "首次配置，原来没有规则" } : k1 ? k1ChangeCell(k1) : batch?.items ? { main: `${fBatchLabel(batch.items[0], fBatchPages(batch.items))} ${batch.items[0].after}${batch.count > 1 ? ` 等 ${batch.count} 项` : ""}`, sub: `原 ${batch.items[0].before}` }
                    : isRoleGrantsTicket(w) ? roleGrantsSummary(w.roleGrantsReview) : changeSummary(changeBefore(w), changeAfter(w), g3PolicyExecutionTiming(w) ? ["生效时间"] : [], reviewOperation(w));
                  const name = actionName(w);
                  return (
                    <Tr key={w.id} selected={w.id === ticketId} onOpen={() => { if (!submitting) setTicketId(w.id); }}>
                      <Td sticky="start"><Cell main={w.objDisplayName && !isGParamTicket(w) ? <>{shortCodes(name)} · {w.objDisplayName}{w.objDisplayName !== w.obj && <> <span className="rd-note" data-mono>{w.obj}</span></>}</> : shortCodes(name)} title={`${name}\n对象：${objectText(w)}\n${w.id} · ${bizTime(w.rawTs, w.ts)}`}
                        sub={<>{queueTime(w)} · <span data-mono>{w.id}</span></>} /></Td>
                      <Td grow><Cell main={change.main} sub={change.sub} title={"title" in change ? change.title : `${change.main}${change.sub ? `\n${change.sub}` : ""}`} /></Td>
                      <Td><Cell main={w.operator} sub={`${roleText(w.operatorRole)}${isMine(w) ? " · 你发起的" : ""}`} /></Td>
                      <Td><Cell main={markers(w)} sub={w.retiredOperation ? <StatusTag tone="done">已退役</StatusTag> : undefined} /></Td>
                      {showActions && <Td sticky="end"><span className="rd-row-actions">{rowActions(w)}</span></Td>}
                    </Tr>
                  );
                })}
            </tbody>
          </Table>
          {queueRows.length > 0 && <Pager label="待审批的操作" sizeLabel="待审批" total={queueRows.length} page={qSafePage} pageSize={qPageSize} sizes={[10, 20, 50]}
            loading={mainLoading} onPage={setQPage} onPageSize={(size) => { setQPageSize(size); setQPage(1); }} />}
        </Panel>
      </>}
    </>
  );

  const logColumns = 5;
  // 页签、分段、面板不叫同一个名字：分段写「全部记录」（建议 2），网址参数不变。
  const viewSwitch = <Segments label="操作记录视图" value={view} onChange={(next) => { setLogId(null); setHistoryId(null); setView(next); }}
    items={[{ value: "logs", label: "全部记录" }, { value: "history", label: "审批结果" }]} />;
  const VIEW_NOTE = "两个视图共用上面的筛选，导出只导操作记录。";
  const recordsTab = (
    <>
      {locateNotice}
      {/* 视图切换独占筛选条第一行：先选看哪张表，再筛。放在面板标题右边时分段的字离面板右边线太远（P1-right）。 */}
      <FilterBar
        scope={<div className="rd-filter-scope-row">{viewSwitch}</div>}
        onSubmit={submitFilter}
        querying={recordsLoading}
        onClear={clearFilter}
        canClear={hasApplied}
        moreCount={moreCount}
        more={<>
          <FilterField label="动作"><Input aria-label="审计动作" placeholder="动作关键词" value={filterDraft.action ?? ""} onChange={(event) => setDraft("action", event.target.value)} /></FilterField>
          <FilterField label="开始时间（北京时间）"><Input type="datetime-local" aria-label="审计开始时间" value={filterDraft.startTime ?? ""} onChange={(event) => setDraft("startTime", event.target.value)} /></FilterField>
          <FilterField label={<span>结束时间（北京时间）<Explain label="结束时间的说明" content="含这一分钟，到 59 秒。" /></span>}>
            <Input type="datetime-local" aria-label="审计结束时间" aria-invalid={rangeError ? true : undefined} value={filterDraft.endTime ?? ""} onChange={(event) => setDraft("endTime", event.target.value)} />
          </FilterField>
        </>}
        applied={appliedChips}
        result={draftChanged ? "条件未应用" : undefined}
        notice={rangeError ? `时间有误：${rangeError}。没有查询，下面仍是上次的结果。` : undefined}
      >
        {/* 主行三项不带上方标签，按钮和框在同一条线上（必须改 10，同提现审核）；名字写在占位和读屏名里。 */}
        <FilterField>
          <Select aria-label="审计业务域" value={filterDraft.domain && filterDraft.domain !== "all" ? filterDraft.domain : ""} onChange={(value) => setDraft("domain", value)}
            options={[{ value: "", label: "全部模块" }, ...A2_AUDIT_DOMAINS.map((domain) => ({ value: domain, label: DOMAIN_NAMES[domain] }))]} />
        </FilterField>
        <FilterField><Input aria-label="审计操作者" placeholder="操作者" size={10} value={filterDraft.operator ?? ""} onChange={(event) => setDraft("operator", event.target.value)} /></FilterField>
        <FilterField grow><Input aria-label="审计对象" placeholder="对象编号或类型" value={filterDraft.object ?? ""} onChange={(event) => setDraft("object", event.target.value)} /></FilterField>
      </FilterBar>

      {recordsError && !records ? (
        <Panel flush icon={view === "logs" ? FileText : History} tone="role-3" title={view === "logs" ? "操作记录" : "审批结果"}>
          <Table label={view === "logs" ? "操作记录" : "审批结果"}><tbody>
            <TableMessage columns={logColumns} role="alert">操作记录读取失败，不显示旧数据：{recordsError} <Button size="sm" onClick={() => void (hasApplied ? loadFiltered(appliedFilter) : loadMain().catch(() => undefined))}>重试</Button></TableMessage>
          </tbody></Table>
        </Panel>
      ) : view === "logs" ? (
        <Panel flush icon={FileText} tone="role-3" title="操作记录"
          sub={recordStats ? `今日 ${count(recordStats.todayAuditEvents)} 条 · ${(records?.recentLogs.length ?? 0) >= 200 ? "已显示最近 200 条，更早的缩小时间范围再查" : "最多显示最近 200 条"}` : undefined}
          explain={`「今日」按业务日历的今天，跟着上面的筛选变。${VIEW_NOTE}`}>
          <Table label="操作记录" data-tight="">
            <thead><tr>
              <Th sticky="start">时间（{zone}）</Th>
              <Th icon={Users} tone="users">操作者</Th>
              <Th><span>动作<Explain label="动作名的说明" content="已核对的系统动作显示中文；原始动作码在详情的「技术信息」里，可复制到「动作」筛选中查询。" /></span></Th>
              <Th>对象</Th>
              {/* 「前 → 后」是查有没有生效唯一要看的列，留够宽度，对象列让出来（必须改 8）。 */}
              <Th className="a2-col-delta">前 → 后</Th>
            </tr></thead>
            <tbody>
              {!records && recordsLoading ? <TableLoading columns={logColumns} rows={6} />
                : logPageRows.length === 0 ? (
                  <TableMessage columns={logColumns} role="status">
                    {hasApplied ? <>当前筛选下暂无操作记录 <Button size="sm" onClick={clearFilter}>清除筛选</Button></> : "暂无操作记录"}
                  </TableMessage>
                ) : logPageRows.map((l) => {
                  const act = logActionShown(l.action);
                  const obj = logObject(l);
                  return (
                    <Tr key={l.id} selected={l.id === logId} onOpen={() => setLogId(l.id)}>
                      <Td sticky="start"><Cell num main={thisYear(logTime(l))} title={logTime(l)} /></Td>
                      <Td><Cell main={middle(l.actor, 16)} sub={logRoleText(l.role) || undefined} title={l.actor} /></Td>
                      <Td><Cell main={act.text} title={act.raw ? `${act.text}（原始动作码在详情的技术信息里）` : act.text} /></Td>
                      <Td>{fBatchLogItems(l) || F_BATCH_DIGEST.test(l.obj) ? <Cell main="整批调整的团队参数" title={l.obj} />
                        : obj.id ? <Cell main={obj.id.length > 16 ? `${obj.id.slice(0, 8)}…${obj.id.slice(-6)}` : obj.id} sub={obj.kind} title={[obj.kind, obj.id].filter(Boolean).join(" · ")} />
                          : <Cell main={obj.kind} title={obj.kind} />}</Td>
                      <Td grow>{fBatchLogItems(l) ? <Cell main={fBatchSummary(fBatchLogItems(l)!)} title={l.delta} /> : <Cell mono main={logDeltaText(l.delta)} title={logDeltaText(l.delta)} />}</Td>
                    </Tr>
                  );
                })}
            </tbody>
          </Table>
          {logRows.length > 0 && <Pager label="操作记录" total={logRows.length} page={logSafePage} pageSize={logPageSize} sizes={LOG_PAGE_SIZES}
            loading={recordsLoading} onPage={setLogPage} onPageSize={(size) => { setLogPageSize(size); setLogPage(1); }} />}
        </Panel>
      ) : (
        <Panel flush icon={History} tone="role-3" title="审批结果"
          sub={recordStats ? `按上方筛选 · 累计 已批准 ${count(recordStats.weeklyApproved)} · 已驳回 ${count(recordStats.weeklyRejected)} · 已撤回 ${count(recordStats.weeklyWithdrawn)} · 已过期 ${count(recordStats.weeklyExpired)}` : undefined}
          explain={`按上面的筛选数全部处理过的审批单，不分时间段。${VIEW_NOTE}`}>
          <Table label="审批结果" data-tight="">
            <thead><tr>
              <Th sticky="start">审批单</Th>
              <Th>操作</Th>
              <Th>结果</Th>
              <Th icon={Users} tone="users">处理人</Th>
              <Th>处理时间（{zone}）</Th>
            </tr></thead>
            <tbody>
              {!records && recordsLoading ? <TableLoading columns={5} rows={4} />
                : histPageRows.length === 0 ? (
                  <TableMessage columns={5} role="status">{hasApplied ? "当前筛选下暂无处理历史" : "暂无处理历史"}</TableMessage>
                ) : histPageRows.map((h) => (
                  <Tr key={h.id} selected={h.id === historyId} onOpen={() => setHistoryId(h.id)}>
                    <Td sticky="start"><Cell mono full main={h.id} /></Td>
                    <Td grow><Cell main={actionName(h)} title={actionName(h)} /></Td>
                    <Td><StatusTag tone={HIST_TONE[h.st] ?? "done"}>{HIST_LABEL[h.st] ?? h.st}</StatusTag></Td>
                    <Td><Cell main={historyActorText(h.chain)} /></Td>
                    <Td><Cell num main={thisYear(bizTime(h.t, h.t))} title={bizTime(h.t, h.t)} /></Td>
                  </Tr>
                ))}
            </tbody>
          </Table>
          {historyRows.length > 0 && <Pager label="处理历史" sizeLabel="审批结果" total={historyRows.length} page={histSafePage} pageSize={histPageSize} sizes={[4, 8, 12]}
            loading={recordsLoading} onPage={setHistPage} onPageSize={(size) => { setHistPageSize(size); setHistPage(1); }} />}
        </Panel>
      )}
    </>
  );

  const orderedParams = [...mechanismParams].sort((a, b) => (PARAM_ORDER.indexOf(a.key) + 1 || 99) - (PARAM_ORDER.indexOf(b.key) + 1 || 99));
  const schemaNow = schemaVersion(mechanismParams.find((p) => p.key === "schema")?.value);
  const settingsTab = mainError && !main ? (
    <BlockState state="error" title="机制设置读取失败，不显示旧数据" detail={mainError} onRetry={() => void loadMain().catch(() => undefined)} retrying={mainLoading} />
  ) : !main ? (
    <BlockState state="loading" title="正在读取机制设置…" />
  ) : (
    <>
      <Panel icon={SlidersHorizontal} tone="role-4" title="审批与记录规则">
        <ConfigList label="审批与记录规则">
          {orderedParams.map((p) => {
            const help = A2_MECHANISM_HELP[p.key];
            const name = help?.label ?? p.name;
            const common = { name, what: help?.what, when: help?.when, effect: help?.effect, where: A2_MECHANISM_WHERE, note: p.sub || undefined };
            if (p.key === "reason_required") {
              return <ConfigRow key={p.key} {...common} value={<span className="a2-locked" title="系统固定，不能关闭"><Lock size={13} aria-hidden />必填</span>} />;
            }
            if (p.key === "confirm_list") {
              return <ConfigRow key={p.key} {...common} note={undefined} value={confirmCategories.length ? `${confirmCategories.length} 类` : <span className="rd-weak">暂无分类说明</span>}
                action={(describedBy) => <Button size="sm" aria-describedby={describedBy} onClick={() => setConfirmListOpen(true)}>查看清单</Button>} />;
            }
            if (p.key === "ttl" || p.key === "retention" || p.key === "schema") {
              const key = p.key;
              const top = key === "schema" && !nextSchema(schemaNow || "v3");
              return <ConfigRow key={p.key} {...common} value={operatorCopyText(p.value)}
                action={canWrite ? (describedBy) => <Button size="sm" aria-describedby={describedBy} disabledReason={top ? "已是已登记的最高版本" : paramBlock(key)} onClick={() => adjustParam(key)}>{key === "schema" ? "升级版本" : "调整"}</Button> : undefined} />;
            }
            return <ConfigRow key={p.key} name={p.name} note={p.sub || undefined} value={operatorCopyText(p.value)} />;
          })}
        </ConfigList>
      </Panel>

      <Panel icon={Archive} tone="role-other" title="到期记录清理"
        explain="到期记录先长期归档，再从在线列表移除，不能撤销。后台默认每天定时清理一次；每次最多处理 2,000 条，可清理超过 2,000 条时要再清一次。"
        actions={canWrite ? <Button size="sm" variant="danger-outline" disabledReason={retentionBlock} onClick={confirmRetention}>立即清理</Button> : undefined}>
        {retentionPreviewError ? (
          <BlockState compact state="error" title={`清理范围加载失败，暂不能清理：${retentionPreviewError}`} onRetry={() => void refreshRetentionPreview()} retrying={retentionLoading} />
        ) : !retentionPreview ? (
          <BlockState compact state="loading" title="正在加载清理范围" />
        ) : (
          <dl className="rd-detail-values">
            {/* 0 和「—」弱化（必须改 13，VS-11）。 */}
            <div><dt>可清理</dt><dd data-empty={retentionPreview.eligibleRows === 0 ? "" : undefined}>{count(retentionPreview.eligibleRows)} 条</dd></div>
            <div><dt>最早到期</dt><dd data-empty={retentionPreview.earliestExpireAt ? undefined : ""}>{retentionPreview.earliestExpireAt ? bizTime(retentionPreview.earliestExpireAt, retentionPreview.earliestExpireAt) : "—"}</dd></div>
            <div><dt>未到期</dt><dd data-empty={retentionPreview.notYetExpiredRows === 0 ? "" : undefined}>{count(retentionPreview.notYetExpiredRows)} 条</dd></div>
            <div><dt>旧版历史<Explain label="旧版历史的说明" content="没有到期时间的旧记录，清理不会动它们。" /></dt><dd data-empty={retentionPreview.legacyRowsWithoutExpireAt === 0 ? "" : undefined}>{count(retentionPreview.legacyRowsWithoutExpireAt)} 条</dd></div>
            <div><dt>上次手动清理</dt><dd>{retentionRunError
              ? <>上次清理情况加载失败：{retentionRunError} <InlineRetry onRetry={() => void refreshRetentionRun()} /></>
              : retentionRun
                ? `${bizTime(retentionRun.evaluatedAt, retentionRun.evaluatedAt)}${retentionRun.lockAcquired ? "" : "（当时有其他清理在进行）"} · 归档 ${count(retentionRun.archivedRows)} 条 · 移除 ${count(retentionRun.deletedRows)} 条`
                : "还没有手动清理过"}</dd></div>
          </dl>
        )}
      </Panel>
    </>
  );

  /* 审批单详情抽屉 */
  const shown = ticketShown.current;
  const ticketIndex = shown ? qPageRows.findIndex((w) => w.id === shown.id) : -1;
  const prevTicket = ticketIndex > 0 ? qPageRows[ticketIndex - 1] : undefined;
  const nextTicket = ticketIndex >= 0 ? qPageRows[ticketIndex + 1] : undefined;
  const shownTiming = shown ? g3PolicyExecutionTiming(shown) ?? phoneScheduledAt(shown) : undefined;
  const shownAmount = shown ? refundAmount(shown) : undefined;
  const shownCanApprove = shown ? canDecide(shown, "approve") : false;
  const shownF5Ids = shown ? f5RecordIds(fundTicket(shown)) : [];
  const shownCanReject = shown ? canDecide(shown, "reject") : false;
  // 有结果未确认的操作时抽屉顶上已有一条提示，这里不再写一遍（DT-12）。
  const shownBlock = shown && (pendingTicketIds.has(shown.id) ? undefined
    : shown.retiredOperation ? RETIRED_OPERATION_COPY
      : shown.phoneCalibrationError ?? shown.ambassadorMaterialError
        ?? (isMine(shown) ? OWN_TICKET_REASON : !shownCanApprove ? shown.approveDeniedMessage ?? NO_DECIDE
          : shownAmount && shownAmount.state !== "ok" && shownAmount.state !== "loading" ? REFUND_AMOUNT_REQUIRED : undefined));
  const shownK1 = shown ? k1TicketView(shown) : undefined;
  const shownBoot = shown?.operationCode === "f_unilevel_bootstrap" ? parseF2BootstrapAfter(shown.after) : undefined;
  const judgment: JudgmentRow[] = shown ? [
    // 批准退款是直接出钱、收不回的操作，第一行就是这笔钱（必须改 1，DP-03）。
    ...(shownAmount ? [shownAmount.state === "ok"
      ? { label: "退款金额", value: <span className="a2-amount">{orderAmount(shownAmount.amount)} USDT</span> }
      : { label: "退款金额", state: "warn" as const, value: <>{refundAmountText(shownAmount)}{" "}{shownAmount.state === "error" && shown.refundOrderNo && <InlineRetry onRetry={() => void loadMain()} />}</> }] : []),
    { label: "要做什么", value: actionName(shown) },
    { label: "对象", value: objectNode(shown) },
    ...(shownK1?.kind === "param" ? [{ label: "改动", value: <Change from={`${shownK1.from} 个账户`} to={`${shownK1.to} 个账户`} /> }]
      : shownK1?.kind === "release" ? [{ label: "这笔收益", value: `${k1Amount(shownK1.net)} ${nexGridBrandText(shownK1.asset)} · ${k1Source(shownK1.source)} · 用户 ${userCode(shownK1.userId)}` }] : []),
    ...(shownF5Ids.length === 1 ? [{ label: "这笔奖励", value: <F5CurrentValue id={shownF5Ids[0]} /> }] : []),
    ...(shownBoot ? [{ label: "批准后", value: "七层规则一次建好；整体结算不会自动启用，要另外申请" }] : []),
    { label: "发起人", icon: Users, tone: "users", value: `${shown.operator} · ${roleText(shown.operatorRole)}${isMine(shown) ? "（你发起的）" : ""}`, reason: bizTime(shown.rawTs, shown.ts) },
    { label: "发起理由", value: keepCodes(shown.reason) },
    { label: shown.retiredOperation ? "原执行权限" : "谁能批准", value: approvalExecutorLabel(shown),
      reason: !shown.retiredOperation && decisionRule(shown).backendChecks ? BACKEND_CHECKS_NOTE : undefined },
    ...(shownBlock ? [{ label: "不能批准的原因", state: "warn" as const, value: shownBlock }] : []),
    ...(shownTiming ? [{ label: "生效时间", value: shownTiming }] : []),
  ] : [];
  const shownOwn = shown ? isMine(shown) : false;
  // F4 派奖和结算、F5 提前解锁：被覆盖率挡住时单子留着，可以等恢复后再批，不只是驳回。
  const shownFund = shown ? fundTicket(shown) : undefined;
  const shownCover = shown ? coverageFacts(shown) : undefined;
  const shownFundCheck = shownFund?.kind === "f4Payout" || shownFund?.kind === "f4Settle" ? "真实发钱，不能撤销。批准时先查兑付覆盖率：读不到或低于红线就不发钱，审批单留着待审批。"
    : shownFund?.kind === "f5Status" && shownFund.state === "unlocked" ? "真实放钱，不能撤销。批准时先核对暂停和兑付覆盖率，结算组的奖励还核冷却到没到期；不满足就不放钱，审批单留着待审批。"
      : shownFund?.kind === "f5Reissue" ? `真实补发，不能撤销。${shownCover?.check ?? ""}`
        : shown?.operationCode === "k1_release_param" || shown?.operationCode === "k1_earnings_release" ? `会让平台多付钱。${K1_APPROVAL_CHECK[shown.operationCode === "k1_release_param" ? "param" : "release"]}`
        : `会让平台多付钱。${shownCover?.check ?? `${PAGE_COVERAGE_COPY}可以等覆盖率恢复后再批，或驳回。`}`;
  // 驳回只是不执行，用普通次按钮，仍在左边和「批准」隔开（必须改 2、DP-40）。退役单右下放灰的「批准」写原因，按钮位置不跳（建议 9）。
  const ticketFooter = shown && (shownOwn || shownCanApprove || shownCanReject ? (
    <Decision
      explain={shownCanApprove && !shownOwn && !shown.retiredOperation ? approvalTiming(shown).drawer : undefined}
      danger={shownCanReject ? <Button disabledReason={decideBlock(shown, "reject")} onClick={() => confirmDecision(shown, "reject")}>驳回</Button> : undefined}
      others={shownOwn ? <Button disabledReason={decideBlock(shown, "withdraw")} onClick={() => confirmDecision(shown, "withdraw")}>撤回我的申请</Button> : undefined}
      primary={shownCanApprove ? <Button variant="primary" disabledReason={decideBlock(shown, "approve")} onClick={() => confirmDecision(shown, "approve")}>批准</Button> : undefined} />
  ) : <Decision note={WAIT_OTHERS} />);

  /* 操作记录抽屉 */
  const shownLog = logShown.current;
  const logIndex = shownLog ? logPageRows.findIndex((l) => l.id === shownLog.id) : -1;
  const needIdem = shownLog ? shownLog.action.includes("withdraw") || shownLog.action.includes("balance") || shownLog.action.includes("operation_confirmed") : false;
  const requestNo = shownLog ? shownLog.idempotencyKey || (needIdem ? "缺失" : "—") : "—";
  const shownLogObject = shownLog ? logObject(shownLog) : undefined;

  /* 审批结果抽屉 */
  const shownHistory = historyShown.current;
  const historyIndex = shownHistory ? histPageRows.findIndex((h) => h.id === shownHistory.id) : -1;
  const shownActors = shownHistory ? historyActors(shownHistory.chain) : null;
  const historyNote = shownHistory?.note.startsWith("原因:") ? { label: "原因", text: shownHistory.note.slice(3).trim() || "—" } : { label: "说明", text: shownHistory?.note || "—" };

  const readOnly = canApprove ? undefined : canWithdraw ? "你不能批准，只能看进度和撤回自己发起的申请。" : "你不能批准审批单，只能查看。";

  return (
    <>
      <PageHeader pageId="A2" title="操作记录与审批" summary={<AutoGloss>批准待执行的操作，查谁在什么时候改了什么。</AutoGloss>}
        back={returnTo ? <Link href={returnTo} prefetch={false}><ArrowLeft size={14} aria-hidden /> 返回用户详情</Link> : undefined}
        guideExtra={canApprove ? undefined : <p>你的账号不能批准，「处理一张审批单」的第二步不适用。</p>}
        actions={tab === "records" && canExport ? <Button icon={<Download size={14} aria-hidden />} disabledReason={submitting ? SUBMITTING : exportBlock} onClick={exportAudit}>导出记录</Button> : undefined}
        meta={<span className="rd-toolbar">
          <span>{readAt && `${readAt} 读取（${zone}）`}<Explain label="数据时间说明" content="打开和点「刷新」时读取，不自动刷新。" /></span>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={mainLoading || filteredLoading} onClick={() => void refreshAll()}>刷新</Button>
        </span>}
        readOnly={readOnly} />

      {pendingNotices}

      <PageTabs ids={tabIds} label="操作记录与审批内容" value={tab} onChange={chooseTab} items={[
        { value: "pending", label: "待审批", count: pendingCount },
        { value: "records", label: "操作记录" },
        { value: "settings", label: "机制设置" },
      ]} />

      <div {...tabIds.panel(tab)} className="rd-tab-pane">
        {tab === "pending" && pendingTab}
        {tab === "records" && recordsTab}
        {tab === "settings" && settingsTab}
      </div>

      <Drawer open={Boolean(ticket)} onClose={() => setTicketId(null)} title="审批单详情" icon={ClipboardList} tone="role-3" busy={!!submitting}
        sub={shown && <><span data-mono>{shown.id}</span> <IconButton aria-label="复制审批单号" data-size="sm" onClick={() => copyId(shown.id)}><Copy size={13} aria-hidden /></IconButton><StatusTag tone="warn">待审批</StatusTag></>}
        nav={{ hasPrev: Boolean(prevTicket), hasNext: Boolean(nextTicket), onPrev: () => { if (prevTicket) setTicketId(prevTicket.id); }, onNext: () => { if (nextTicket) setTicketId(nextTicket.id); } }}
        footer={ticketFooter}>
        {shown && <>
          {pendingTicketIds.has(shown.id) && <Notice tone="warn">这张单有一次操作结果未知，先到页面上方查询原结果，不要重复处理；单子状态变了也不算查到结果。</Notice>}
          <JudgmentPoints title={`判断要点 · 时间为${zone}`} rows={judgment} />
          {shown.coverageCheckOnApproval && <Notice tone="warn">{approvalCoverageCopy(shown)}</Notice>}
          {shown.amplifies && !shown.coverageCheckOnApproval && <Notice tone="warn">{shownFundCheck}</Notice>}
          {/* J4 逐步执行，中途失败时前面的步骤不回滚，不能写「失败不改原值」（M3）。 */}
          {shown.sos && <Notice tone="danger">{isJ4Execution(shown)
            ? "应急预案逐步执行：中途失败时，前面的步骤可能已经生效。批准前核对值班授权和影响范围，失败后到「监管要求应急处理」的执行追溯里核对每一步。"
            : "应急操作：涉及紧急停用或恢复，请核对值班授权、影响范围和恢复条件后再处理。"}</Notice>}
          {shownK1 ? <section className="a2-change-review" aria-label="完整变更内容">
              <div className="a2-change-title">完整变更内容<Explain label="技术信息" content={k1Tech(shownK1)} /></div>
              <Facts><K1TicketFacts v={shownK1} /></Facts>
            </section>
            : shownBoot ? <section className="a2-change-review" aria-label="完整变更内容">
              <div className="a2-change-title">完整变更内容 · 七层<Explain label="技术信息" content={`修改前原文 ${shown.before || "—"} ｜ 修改后原文 ${shown.after}`} /></div>
              <F2BootstrapReview rows={shownBoot} label="要建立的七层规则" />
            </section>
            : fBatchTicket(shown)?.items ? <A2BatchReview items={fBatchTicket(shown)!.items!} />
            : isRoleGrantsTicket(shown)
            ? <A2RoleGrantsChange review={shown.roleGrantsReview} fallback={<A2ChangeReview operationCode={reviewOperation(shown)} before={changeBefore(shown)} after={changeAfter(shown)} />} />
            : <A2ChangeReview operationCode={reviewOperation(shown)} before={changeBefore(shown)} after={changeAfter(shown)} omit={g3PolicyExecutionTiming(shown) ? ["生效时间"] : undefined}>
                <A2I5DisclosureReview key={shown.id} ticket={shown} />
              </A2ChangeReview>}
          {reissueList(shown, true)}
          {shown.phoneCalibrationProposal && <PhoneCalibrationReview proposal={shown.phoneCalibrationProposal} />}
          {shown.ambassadorMaterialProposal && <AmbassadorMaterialSummary packet={shown.ambassadorMaterialProposal} expectedMaterialRevision={shown.ambassadorMaterialProposal.applicationDecision === "APPROVE" ? shown.ambassadorMaterialProposal.expectedMaterialRevision : undefined} />}
        </>}
      </Drawer>

      <Drawer open={Boolean(log)} onClose={() => setLogId(null)} title="操作记录" icon={FileText} tone="role-3"
        sub={shownLog && `${bizTimeFull(shownLog.createdAt, shownLog.ts)}（${zone}）`}
        explain="手机号、地址等隐私信息只以加密编号保存，导出时也会隐藏。"
        nav={{ hasPrev: logIndex > 0, hasNext: logIndex >= 0 && logIndex < logPageRows.length - 1, onPrev: () => { if (logIndex > 0) setLogId(logPageRows[logIndex - 1].id); }, onNext: () => { if (logIndex >= 0 && logPageRows[logIndex + 1]) setLogId(logPageRows[logIndex + 1].id); } }}>
        {shownLog && <>
          <JudgmentPoints rows={[
            { label: "动作", value: logActionShown(shownLog.action).text },
            { label: shownLog.action === "A1_SUPER_ADMIN_BREAK_GLASS_RECOVERED" ? "执行人 / 角色" : "操作者 / 角色", icon: Users, tone: "users", value: logRoleText(shownLog.role) ? `${shownLog.actor} · ${logRoleText(shownLog.role)}` : shownLog.actor },
            // 对象是「类型 · 编号」，编号可能是整串 UUID：不用不换行的 a2-code，在「·」后面折行，不把抽屉撑出横向滚动。
            { label: "对象", value: F_BATCH_DIGEST.test(shownLog.obj) || fBatchLogItems(shownLog) ? "整批调整的团队参数" : [shownLogObject?.kind, shownLogObject?.id].filter(Boolean).join(" · ") },
            ...(fBatchLogItems(shownLog) ? [] : [{ label: "前值 → 后值", value: <span data-mono>{logDeltaText(shownLog.delta)}</span> }]),
            { label: "原因", value: shownLog.reason || "—" },
          ]} />
          {fBatchLogItems(shownLog) && <A2BatchReview items={fBatchLogItems(shownLog)!} />}
          <Fold inset title="技术信息" summary={`请求编号 ${requestNo}`}>
            <Facts>
              <Fact k="IP"><span data-mono>{shownLog.ip}</span></Fact>
              <Fact k="请求编号"><span data-mono>{requestNo}</span></Fact>
              {/* 没翻成中文时「动作」已经是原码，不再写一遍（建议 8）。 */}
              {logActionText(shownLog.action) !== shownLog.action || logActionShown(shownLog.action).raw ? <Fact k="原始动作码"><span data-mono>{shownLog.action}</span></Fact> : null}
              {shownLogObject?.raw && !F_BATCH_DIGEST.test(shownLog.obj) && <Fact k="对象原文"><span data-mono className="a2-long-code">{shownLogObject.raw}</span></Fact>}
              <Fact k="角色码"><span data-mono>{shownLog.role}</span></Fact>
              {F_BATCH_DIGEST.test(shownLog.obj) && <Fact k="对象摘要"><span data-mono>{shownLog.obj}</span></Fact>}
              {(fBatchLogItems(shownLog) || logDeltaText(shownLog.delta) !== shownLog.delta) && <Fact k="前值 → 后值原文"><span data-mono>{shownLog.delta}</span></Fact>}
            </Facts>
          </Fold>
        </>}
      </Drawer>

      <Drawer open={Boolean(history)} onClose={() => setHistoryId(null)} title="处理过程" icon={History} tone="role-3"
        sub={shownHistory && <><span data-mono>{shownHistory.id}</span> <StatusTag tone={HIST_TONE[shownHistory.st] ?? "done"}>{HIST_LABEL[shownHistory.st] ?? shownHistory.st}</StatusTag></>}
        nav={{ hasPrev: historyIndex > 0, hasNext: historyIndex >= 0 && historyIndex < histPageRows.length - 1, onPrev: () => { if (historyIndex > 0) setHistoryId(histPageRows[historyIndex - 1].id); }, onNext: () => { if (historyIndex >= 0 && histPageRows[historyIndex + 1]) setHistoryId(histPageRows[historyIndex + 1].id); } }}>
        {shownHistory && <>
          <JudgmentPoints title={`判断要点 · 时间为${zone}`} rows={[
            { label: "操作", value: actionName(shownHistory) },
            { label: "发起人", icon: Users, tone: "users", value: shownActors?.proposer ?? "—" },
            { label: "处理人", value: shownActors ? `${shownActors.role} ${shownActors.actor}` : historyActorText(shownHistory.chain) },
            { label: "处理时间", value: bizTime(shownHistory.t, shownHistory.t) },
            { label: historyNote.label, value: historyNote.text },
          ]} />
          <Fold inset title="技术信息" summary="处理链原文">
            <p className="rd-note" data-mono>{shownHistory.chain}</p>
          </Fold>
        </>}
      </Drawer>

      <Drawer open={confirmListOpen} onClose={() => setConfirmListOpen(false)} title={`需要确认的操作（${confirmCategories.length} 类）`} icon={ListChecks}
        explain="清单只是说明，不改变权限和审批规则。走审批的要另一位管理员批准后才生效，直接执行的确认后立即生效。">
        {confirmCategories.length ? (
          <Table label="需要确认的操作">
            <thead><tr><Th>类别</Th><Th>例子</Th><Th>谁能执行</Th></tr></thead>
            <tbody>
              {confirmCategories.map((c) => (
                <Tr key={c.cat}>
                  <Td><Cell main={operatorCopyText(c.cat)} /></Td>
                  <Td grow><Cell main={operatorCopyText(c.examples)} title={operatorCopyText(c.examples)} /></Td>
                  <Td><Cell main={operatorCopyText(c.roleGate)} /></Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        ) : <Notice tone="neutral">系统暂未提供分类说明，不代表操作无需审批。请按各操作页面的权限和审批提示办理。</Notice>}
      </Drawer>

      {releasing && <ReleaseModal label={releasing.label} onCancel={() => setReleasing(null)} onConfirm={() => releasePending(releasing)}
        explain="重试被拒证明不了原操作的结果，先在操作记录里核对。解除后这次操作不再重试。" />}
    </>
  );
}
