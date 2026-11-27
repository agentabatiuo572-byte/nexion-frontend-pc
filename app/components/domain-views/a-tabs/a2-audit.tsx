"use client";
import { approvalShownObject } from "@/lib/admin/a2-approval-summary";
import {
  a2AccountStatusText, a2Pair, a2Shown, a2TicketKey, actionName, approvalActionName, approvalDisplayChanges, approvalQueueChange, approvalReviewValues, approvalTitleParts,
  CHANGE_LABELS, CHANGE_UNAVAILABLE, changeAfter, changeBefore, changeSummary, derivedBaseRateShown,
  F5_STATE_FROM, F5_STATE_NAME, F_BATCH_DIGEST, F_CONFIG_CODES, f1VoucherReverse, fBatchLabel, fBatchLogItems, fBatchPages, fBatchTicket, fundTicket,
  G_PARAM_ACTION, g3PolicyExecutionTiming, gParamText, h3ConfigName, h3MissionView, isG3Policy, isGParamTicket, isRecord,
  isRoleGrantsTicket, isRowList, isV8PromotionAction, isV8PromotionTicket, j1GateName, k1Amount, k1Source, k1TicketView,
  kindNames, objectText, parseReview, reviewOperation, reviewPair, ROW_UNIT, rowsRawCells, same, userCode, valueText,
  type FBatchItem, type FundTicket, type K1TicketView,
} from "@/lib/admin/a2-approval-text";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { AUDIT_ACTION_NAMES as A2_ACTION_NAMES, AUDIT_RESOURCE_NAMES } from "@/lib/admin/audit-action-names";
import { H2_BUY_LIST_ACTION } from "@/lib/admin/h2-trial-purchase";
import { a2ActionText, DIV_BASE_TEXT, operatorCopyText } from "@/lib/admin/operator-copy";
import { PromotionRefundImpact } from "../promotion-refund-impact";
import { PhoneCalibrationReview } from "../e-tabs/phone-calibration-review";
import { AmbassadorMaterialSummary } from "../f-tabs/f4-ambassador-materials";
import { V8PromotionFacts } from "../f-tabs/v8-promotion-facts";
import { aTicketPermissionText } from "@/lib/admin/a-approval-names";
import { F_APPROVAL_PERMISSION_NAMES, fApprovalPermissionText, H8_SETTLEMENT_APPROVAL_PERMISSION } from "@/lib/admin/f-approval-names";
import { fConfigAuthority } from "@/lib/admin/f-config-batch";
import { F4PayoutPreviewFacts, F4SettleFacts } from "../f-tabs/f4-payout-preview";
import { F4_COVERAGE_NEXT, F4_PAYOUT_COVERAGE, F4_PAYOUT_IMPACT, F4_SETTLE_COVERAGE, F4_SETTLE_IMPACT, F4_SETTLEMENT_CONSEQUENCE } from "@/lib/admin/f4-money";
import { F2BootstrapReview, f2AppLimitIssue, f2BootstrapUsesRank, parseF2BootstrapAfter } from "../f-tabs/f2-bootstrap-ticket";
import { fetchF1VRankOverview, fetchF2RatesOverview } from "@/lib/admin/f1-client";
import { fmtConfigPct, fmtPct } from "@/lib/format";
import { F5CurrentFact, F5CurrentValue, F5ReissueOutcome, F5ReissueReadings, readF5Current } from "./a2-f5-current";
import { A2I5DisclosureReview } from "./a2-i5-disclosure-review";
import { A2RoleGrantsChange } from "./a2-role-grants";

/**
 * A2 操作记录与审批（列表页·队列模式，PG-44）。三个页签：待审批（默认）、操作记录（含审批结果）、机制设置。
 *
 * - 待审批和机制设置读不带筛选的总览；操作记录有生效筛选时另读一次带筛选的总览。后端把同一组筛选同时套在
 *   审批单、统计和记录上，不分开读的话待审批数会跟着操作记录的筛选变。
 * - 批准、驳回、撤回、调整机制参数、立即清理、导出：先把命令号和原内容（导出连同已应用的筛选）存进本标签页再发；
 *   结果未知时关框，转成页面上方的待确认条，这张单（这项设置、清理、导出）锁住，只能按原操作重试；
 *   批准、驳回、撤回用原决定回执核对；其他操作重试被明确拒绝后由人解除；超过 24 小时只能核对（OP-92～OP-96、OP-153）。
 * - 批准、驳回入口使用后端返回的当前资格，没有权限的不显示入口（OP-124）。
 * - 记录只追加：没有改、删记录的接口，页面也不给入口。所有写操作都要填理由。
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Archive, ArrowLeft, ClipboardList, CloudOff, Coins, Copy, Download, FileText, Flame, History, Inbox, ListChecks, Lock, RefreshCw, SearchX, Siren, SlidersHorizontal, Users } from "lucide-react";
import { AutoGloss } from "@/app/components/kit/gloss";
import {
  BlockState, Button, Cell, Change, ConfigList, ConfigRow, Decision, DiffList, Drawer, Explain, Fact, Facts, FilterBar, FilterField, Fold, IconButton, Input, InlineRetry,
  IrreversibleTag, JudgmentPoints, KeepText, MoreMenu, Notice, PageHeader, PageTabs, Pager, Panel, ReleaseModal, Segments, Select, Stat, StatBand, StatusTag, Table, TableLoading,
  TableMessage, Td, Th, Tr, useTabIds, type DiffRow, type JudgmentRow, type SegmentItem, type StateTone,
} from "@/app/components/rd";
import {
  approveA2Operation,
  createA2CommandKey,
  exportA2Audit,
  fetchA2ProposalLog,
  fetchA2RetentionLatest,
  fetchA2RetentionPreview,
  fetchA2Overview,
  F4ApprovalBlockedError,
  a2VoucherReversalResult,
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
  type F4ApprovalAttemptResult,
  type F4ApprovalBusinessResult,
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
import { D5_APPROVAL_OP, D5_DIFF_UNREADABLE, d5Trc20ApprovalBlock, TRC20_CHANGES_FEE, TRC20_CLOSED, TRC20_OPENS_WITHDRAWAL, TRC20_REPLAY_UNVERIFIED } from "@/lib/admin/trc20-closed";
import type { WithdrawalProposalChanges } from "@/lib/admin/withdrawal-proposal-changes";
import { H7_VOUCHER_APPROVER, H7_VOUCHER_APPROVAL_PERMISSIONS, isH7VoucherApproval } from "@/lib/admin/h7-voucher-approval";
import { fetchDirectCommandReceiptDetails } from "@/lib/admin/direct-command-receipt";
import { displayAdminError, displayAdminReadError, formatAdminApiError, UNMAPPED_ADMIN_ERROR_TEXT } from "@/lib/admin/error-messages";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { announcePermissionDenied, isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import type { CoverageSnapshot } from "../design-kit";
import { normalizeSessionRole } from "@/lib/admin/session-role";
import { roleLabel } from "@/lib/nav/console-nav";
import { useReach } from "@/lib/nav/use-reach";
import { orderAmount } from "../e-tabs/data";
import { e1DisplayEffect, e1ReviewValue } from "../e-tabs/e1-state";
import { RecoveryPanel, recoveryTitle, type RecoveryItem } from "../recovery-panel";
import { payoutAmount, rewardText } from "../f-tabs/f1-shared";
import type { A4ActionConfirmReq, ActionConfirmReq, ACtx } from "./types";

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
function auditFilterValue(key: FilterKey, value?: string) {
  return key === "action" && value === H2_BUY_LIST_ACTION ? A2_ACTION_NAMES[value] : value;
}
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
const PENDING_LOCK = "这张单有一次操作结果未知，先到页面上方核对";
const RELOADING = "审批单还在读取，读完再处理";
const SUBMITTING = "正在提交";
const NO_WITHDRAW = "你没有撤回申请的权限";
const NO_DECIDE = "这个账号没有处理这张单的权限";
/** 页面判断不了这张单要哪项业务权限或附加条件时，入口照常放出，写这一句（协调人第五轮定）。批准框说明、详情折叠「批准时」、待确认条都用它。 */
const BACKEND_CHECKS_NOTE = "系统再核对业务权限，没有权限会被拒绝并写明原因";
/** 末尾一段整段换行，在批准框说明和详情折叠里都不折出孤字（TL-01）。 */
const backendChecksText = (lead = "", end = "") =>
  <KeepText text={`${lead}${BACKEND_CHECKS_NOTE}${end}`} phrases={["没有权限会被拒绝并写明原因。", "没有权限会被拒绝并写明原因"]} />;
const WAIT_OTHERS = "等待有权限的人处理";
const UNKNOWN_TOAST = "结果未知，不要重复操作。到页面上方查询原操作，或按原操作重试。";
const RETRY_EXPIRED = "已超过 24 小时，不能再重试，请在「操作记录」里按单号核对。";
const RETRY_NO_PERMISSION = "这个账号现在没有这项操作的权限，不能重试，请在「操作记录」里按单号核对";

function approvalCoverageCopy(w: A2OperationRow) {
  return w.ambassadorMaterialProposal?.applicationDecision === "APPROVE"
    ? "批准时系统会重新核对材料、核验结论、认可金额和兑付覆盖率；有一项不满足就不执行，审批单继续待处理，申请和预算额度不变。"
    : w.operationCode === "j1_gate_resume" ? J1_RESTORE_COVERAGE_COPY : isK1ClusterTicket(w) ? K1_CLUSTER_COVERAGE_COPY : COVERAGE_ON_APPROVAL_COPY;
}

function superadminApprovalPermissions(w: A2OperationRow): string | undefined {
  const op = w.operationCode;
  if (op === "h8_referral_settlement" || op === "h8_referral_settlement_user") return fApprovalPermissionText(H8_SETTLEMENT_APPROVAL_PERMISSION);
  const named = (code: string) => fApprovalPermissionText(F_APPROVAL_PERMISSION_NAMES[code]);
  if (w.ambassadorMaterialProposal) return named("network_f4_ambassador_approve");
  if (["f_unilevel_bootstrap", "f_direct_referral_policy"].includes(op ?? "")) return named("network_f2_royalty_rate");
  if (op === "f_seven_layer_activation") return named("network_f2_policy_amplify");
  if (op === "f4_quota_tier_create") return named("network_f4_write");
  if (op === "f4_ambassador_policy_change") return fApprovalPermissionText();
  if (["f4_pool_settle", "f4_leaderboard_period_payout"].includes(op ?? "")) return named("network_f4_pool_fund");
  if (!["f_config", "f_ui_config", "f_unilevel_rule", "f_config_batch"].includes(op ?? "")) return undefined;
  const keys = fBatchTicket(w)?.items?.map(item => item.key) ?? w.obj.split(",").map(key => key.trim());
  const isF2F4 = keys.some(key => /^(?:F\.(?:unilevel|promo|peer|influence|royalty|partner|sunset|pool|quota|ambassador|leaderboard)\.|F\.cooldown$)/.test(key)
    || ["directRoyaltyPct", "networkRoyaltyPct", "maxCombinedOutflowPct", "minPayoutUsdt", "rankWindowDays", "hardwareQuotaPerRank"].includes(key));
  if (!isF2F4) return undefined;
  const permissions = new Set(keys.map(key => key.startsWith("F.pool.votes.") ? "network_f4_pool_fund"
    : key === "F.binary.autoSettle" ? "network_f3_engine_pause" : fConfigAuthority(key)));
  const names = [...permissions].flatMap(code => code && F_APPROVAL_PERMISSION_NAMES[code] ? [F_APPROVAL_PERMISSION_NAMES[code]] : []);
  return names.length === permissions.size
    ? fApprovalPermissionText(...names)
    : `${fApprovalPermissionText()}和这张单各项对应的业务权限`;
}

/** 「需有权限」一行：F2/F4 和 A1/A6 的单；和发起端写的是同一句，有它就不再另写「谁能批准」。 */
function ticketPermissionText(w: A2OperationRow) {
  return superadminApprovalPermissions(w) ?? aTicketPermissionText(w.operationCode);
}

const F4_OLD_PAYOUT_TICKETS = "nexion-admin-a2-old-f4-payout-tickets";
const F4_PAYOUT_REVIEW_REQUIRED = "这张单按旧规则提交。请先撤回或驳回，再查看新预览并重新提交。";
const F4_PAYOUT_APPROVAL_PAUSED = "排行榜已暂停，恢复后再批准，或驳回。";
const F4_RESULT_UNREADABLE = "这次结果读不到，以操作记录为准";

function approvalExecutorLabel(w: A2OperationRow) {
  if (isH7VoucherApproval(w.operationCode)) return `${H7_VOUCHER_APPROVER}（需要${H7_VOUCHER_APPROVAL_PERMISSIONS}）`;
  if (w.operationCode === "f_vrank_override") return "发起人以外、同时有 A2 批准权限和人工调级权限的管理员";
  if (ticketPermissionText(w)) return "另一位超级管理员";
  if (w.operationCode === "h1_phase_dial") return "另一位有审批批准权限和运营阶段修改权限的超级管理员";
  // AuditReplayBusinessPermissionGuard.validateJ1RestoreChecker：超级管理员，且有审批批准权限和业务开关恢复权限。
  if (w.operationCode === "j1_gate_resume") return "另一位有审批批准权限和业务开关恢复权限的超级管理员";
  // K1RiskApproval.validateChecker：有效超级管理员且有审批批准权限，不能是提交人。
  if (w.operationCode === "k1_release_param" || w.operationCode === "k1_earnings_release") return "另一位有审批批准权限的超级管理员";
  if (w.operationCode === "c2_session_revoke_all" || !w.operationCode && w.action.startsWith("强制登出 · ")) return "另一位有审批批准权限和退出全部设备权限的超级管理员";
  // 后端 ROLE_GATE_E1_SKU 原文带权限码 device_e1_write，这里写成同一含义的权限名。
  if (["e1_hosting_centers_update", "e1_sku_create", "e1_sku_update"].includes(w.operationCode ?? "")) return "另一位超级管理员（需有商品修改权限）";
  if (w.operationCode === "h5_earn_milestone_create") return "另一位有审批批准权限的超级管理员";
  // H5GrowthApproval：三类成长审批都要超级管理员且有审批批准权限。
  if (w.operationCode === "h5_streak_milestone" || w.operationCode === "h5_power_up_config" || w.operationCode === "h5_earn_milestone") return "另一位有审批批准权限的超级管理员";
  if (/^(?:兑换|回购)参数调整 · /.test(w.action)) return "另一位有审批批准权限的超级管理员";
  if (/^调整创世参数 · /.test(w.action)) return "另一位有审批批准权限和该参数业务权限的超级管理员";
  if (["提高旧活动奖励", "放宽转盘奖项配置", "新增转盘奖项", "删除转盘奖项并提高安慰奖", "提高转盘奖项概率",
    "首次发布奖励课程", "发布奖励课程版本", "回滚至有奖励的课程版本"].includes(w.action)) return "另一位有审批批准权限的超级管理员";
  if (w.action === "调整设备型号" || w.action === "发布手机可跑任务") return "另一位超级管理员（需有商品修改权限）";
  if (w.action === "发布规则任务") return "另一位超级管理员（需有任务池修改权限和审批批准权限）";
  // 后端存的「门槛者」只是占位叫法（A2-BE-02）。
  return w.roleGate === "超管" ? "另一位超级管理员" : w.roleGate === "门槛者" ? "另一位超级管理员（需有对应业务权限和审批批准权限）" : w.roleGate;
}

/** H5 的服务端前后值摘要有三种格式，分别来自 B72-BE-02 前后及签到倍率。 */
function h5PowerUpAmplifies(w: A2OperationRow) {
  const read = (text: string) => {
    const match = /^连签 ([1-9]\d{0,2}) 天(?:；(?:签到倍率：([0-9]+(?:\.[0-9]{1,4})?)|备注：[\s\S]*))?$/.exec(text);
    if (!match || Number(match[1]) > 365) return undefined;
    const multiplier = match[2] === undefined ? undefined : Number(match[2]);
    if (multiplier !== undefined && (multiplier <= 0 || multiplier >= 100000000)) return undefined;
    return { day: Number(match[1]), multiplier };
  };
  const before = read(w.before);
  const after = read(w.after);
  if (!before || !after) return undefined;
  if (before.multiplier === undefined && after.multiplier === undefined) return false;
  if (before.multiplier === undefined || after.multiplier === undefined) return undefined;
  return after.day < before.day || after.multiplier > before.multiplier;
}

function approvalCoverageMode(w: A2OperationRow) {
  // 旧票在 V8 晋升时也标记为放大，回放时仍免查覆盖率。
  if (isV8PromotionTicket(w)) return undefined;
  if (w.operationCode === "h5_power_up_config") {
    const amplifies = h5PowerUpAmplifies(w);
    if (amplifies !== undefined) return amplifies ? "amplifies" : undefined;
  }
  if (w.coverageCheckOnApproval) return "onApproval";
  if (w.amplifies) return "amplifies";
}

function V8PromotionRewardFact() {
  const readerId = useAdminAuth(s => s.session?.authorities.includes("network_f1_read") ? s.session.adminId : undefined);
  const [reward, setReward] = useState<{ readerId: number; text: string }>();

  useEffect(() => {
    if (readerId === undefined) return;
    let active = true;
    void fetchF1VRankOverview().then(overview => {
      const rank = overview.rows.find(row => row.v === "V8");
      if (!active || !rank) return;
      const rewards = rank.rewards.map(item => {
        const { main, unit, missing } = rewardText(item, overview);
        return missing ? "—" : unit ? `${main} ${unit}` : main;
      });
      setReward({ readerId, text: rewards.length ? `${rewards.join("、")}（现在的模板，执行时按当时的配置；以前到过 V8 的不再发）` : "没有晋级奖励" });
    }).catch(() => { if (active) setReward(undefined); });
    return () => { active = false; };
  }, [readerId]);

  return <Fact k="V8 晋级奖励 · 首次到达发给本人">{reward && reward.readerId === readerId ? reward.text : "—"}</Fact>;
}

function v8PromotionFacts(ticket: A2OperationRow) {
  const snapshot = ticket.v8PromotionSnapshot;
  if (!snapshot) return <V8PromotionRewardFact />;
  const fromV7 = snapshot.originalRank === "V7";
  return <V8PromotionFacts rewards={snapshot.v8Rewards} v7={fromV7 ? snapshot.v7 : undefined} v8={fromV7 ? snapshot.v8 : undefined} snapshot />;
}

/** 批准后 App 读不到团队奖励配置：首次配置单看票上的七层；单层比例单只带这一层，其余各层按现在读到的算（OP-69）。 */
const F2_LIMIT_APPROVE_COPY = "App 最多读到合计 25%，批准后会读不到团队奖励配置。";
function F2LayerLimitNotice({ level, after }: { level: string; after: string }) {
  const readerId = useAdminAuth((s) => s.session?.authorities.includes("network_f2_read") ? s.session.adminId : undefined);
  const [read, setRead] = useState<{ readerId: number; known: boolean; issue?: string }>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (readerId === undefined) return;
    let active = true;
    void fetchF2RatesOverview().then((overview) => {
      if (!active) return;
      const rates = overview.unilevel, next = after.trim().replace(/%$/, "").trim();
      const known = rates.length === 7 && rates.every((row) => row.usdtText) && next !== "" && Number.isFinite(Number(next));
      setRead({ readerId, known, issue: known ? f2AppLimitIssue(rates.map((row) => row.l === level ? next : row.usdtText!)) : undefined });
    }).catch(() => { if (active) setRead({ readerId, known: false }); });
    return () => { active = false; };
  }, [readerId, level, after, attempt]);
  if (readerId !== undefined && read?.readerId !== readerId) return <Notice tone="neutral" title="正在加载七层现在的比例…" />;
  if (readerId === undefined || !read?.known) return <Notice tone="neutral" title="没读到七层现在的比例，看不出批准后会不会超过 App 读取上限 25%"
    action={readerId !== undefined ? <Button size="sm" onClick={() => { setRead(undefined); setAttempt((n) => n + 1); }}>重试</Button> : undefined} />;
  return read.issue ? <Notice tone="warn" title={read.issue}>{F2_LIMIT_APPROVE_COPY}</Notice> : null;
}

function isCurrentOperator(w: A2OperationRow, username: string | undefined) {
  return w.mine || (!!username && username === w.operator);
}
const F4_COVERAGE_COPY = "批准时如果该周期未结算，先查兑付覆盖率。读不到或低于红线就不发钱，审批单留着待审批。";
const F4_RESULT_REASONS: Record<string, string> = {
  F4_LEADERBOARD_ALREADY_SETTLED: "这一期已经派过",
  F4_LEADERBOARD_NO_CANDIDATES: "没有合格的上榜名单",
  F4_LEADERBOARD_POOL_NOT_CONFIGURED: "没有可发放的奖池",
  F4_LEADERBOARD_NO_PAYABLE_AMOUNT: "没有可发金额",
  F4_POOL_ALREADY_SETTLED: "本周已经结算",
  F4_POOL_NO_ELIGIBLE_VOTERS: "没有合格的投票人",
  F4_POOL_NO_VOLUME: "本周没有符合条件的成交额",
  F4_POOL_MONTHLY_CAP_REACHED: "本月额度已满",
  F4_POOL_NO_PAYABLE_AMOUNT: "没有可发金额",
  F4_LEADERBOARD_PAUSED: "排行榜已暂停",
  COVERAGE_BELOW_REDLINE: "兑付覆盖率低于红线",
};

/**
 * F4 审批的真实结果，原因同一套词，前面的说法按场合换（OP-79、OP-90）：
 * 结了单的写「入账 N 笔，合计…」或「没有发钱：原因」；被暂停、覆盖率挡下的是批准没有执行，单子还待审批，写「没有执行：原因」和下一步。
 */
function f4ResultReason(result: { reasonCode: string }) {
  return F4_RESULT_REASONS[result.reasonCode] ?? "原因暂时无法显示";
}

function f4ApprovalResultText(result: F4ApprovalBusinessResult) {
  if (result.status === "NOT_EXECUTED") return `没有发钱：${f4ResultReason(result)}`;
  const amounts = Object.entries(result.amountsByCurrency).map(([currency, amount]) => `${payoutAmount(amount)} ${currency}`);
  return `入账 ${count(result.creditedCount)} 笔，合计 ${amounts.join("、")}`;
}

function f4BlockedText(reasonCode: F4ApprovalAttemptResult["reasonCode"]) {
  return `${f4ResultReason({ reasonCode })}。审批单仍待审批。这次没有执行。关掉后重新打开，按最新读数再批准，或驳回。`;
}
/**
 * E1 商品提案的操作记录：拆出冻结的前后值，按审批单详情展示。日志没有商品操作码，B97 新建的前侧只冻结两项展示默认值。
 */
function e1SkuLogSides(log: Pick<A2AuditLogRow, "action" | "domain" | "resourceType" | "delta">): { before: string; after: string; operationCode: "e1_sku_create" | "e1_sku_update" } | undefined {
  const isSku = (text: string) => {
    try { const value: unknown = JSON.parse(text); return isRecord(value) && typeof value.skuId === "string"; } catch { return false; }
  };
  if (log.delta.startsWith("— → ") && isSku(log.delta.slice(4))) return { before: "", after: log.delta.slice(4), operationCode: "e1_sku_create" };
  const proposal = log.action === "A2_OPERATION_PROPOSED" && log.domain === "E";
  // 后端的决定记录直接提供 " -> "，域可能由动作和对象推断。
  const decision = log.resourceType === "A2_OPERATION"
    && ["A2_OPERATION_APPROVED", "A2_OPERATION_REJECTED", "A2_OPERATION_WITHDRAWN"].includes(log.action);
  for (const boundary of log.delta.matchAll(/\} (→|->) \{/g)) {
    const arrow = boundary[1] === "→";
    if (!arrow && !decision) continue;
    const before = log.delta.slice(0, boundary.index + 1), after = log.delta.slice(boundary.index + boundary[0].length - 1);
    if (!isSku(after)) continue;
    if (arrow && isSku(before)) return { before, after, operationCode: "e1_sku_update" };
    if (proposal || decision) {
      const defaults = parseReview(before);
      if (defaults?.kind === "object" && Object.keys(defaults.value).length === 2
        && defaults.value.displaySoldBase === 0 && defaults.value.liveActivityVisible === true) {
        return { before, after, operationCode: "e1_sku_create" };
      }
    }
  }
  return undefined;
}
function e1ApprovalTicket(log: A2AuditLogRow) {
  if (log.action === "E1_SKU_UPDATED") return /^a2-approve-(WO-\d+-\d+)-/.exec(log.idempotencyKey ?? "")?.[1];
}

/** The execution audit only records price. Look up the frozen proposal by the ticket in the approval command. */
function e1ApprovedLog(log: A2AuditLogRow, proposals?: ReadonlyMap<string, A2AuditLogRow | undefined>): { ticket?: string; sides?: ReturnType<typeof e1SkuLogSides>; price?: string } | undefined {
  if (log.action !== "E1_SKU_UPDATED") return undefined;
  const ticket = e1ApprovalTicket(log);
  const proposal = ticket ? proposals?.get(ticket) : undefined;
  const sides = proposal && e1SkuLogSides(proposal);
  if (sides) return { ticket, sides };
  const [before, after] = log.delta.split(" → ");
  if (!/^\d+(\.\d+)?$/.test(before ?? "") || !/^\d+(\.\d+)?$/.test(after ?? "")) return undefined;
  // 有没有变按原文比；售价按全站金额写法，原文不同而写法一样时两边照原文写（a2Pair）。
  const [shownBefore, shownAfter] = a2Pair("price", `${before} USD`, `${after} USD`);
  return { ticket, price: before === after ? `价格 ${shownAfter}，没变` : `价格 ${shownBefore} → ${shownAfter}` };
}
const E1_PRICE_ONLY = "这条只记价格，其他改动没记在这里";
const fBatchSummary = (items: readonly FBatchItem[]) => { const [before, after] = a2Pair(items[0].key, items[0].before, items[0].after); return `${fBatchLabel(items[0], fBatchPages(items))} ${before} → ${after}${items.length > 1 ? ` 等 ${items.length} 项` : ""}`; };

/** 整批申请的完整变更内容：每项一行「现在 → 改后」；各项配置键和对象原文放抽屉底部的「技术信息」折叠。 */
function A2BatchReview({ items }: { items: readonly FBatchItem[] }) {
  const pages = fBatchPages(items);
  return (
    <section className="a2-change-review" aria-label="完整变更内容">
      <div className="a2-change-title">完整变更内容 · {items.length} 项</div>
      <DiffList rows={items.map((item) => { const [before, after] = a2Pair(item.key, item.before, item.after); return { key: item.key, label: fBatchLabel(item, pages), before, after }; })}
        restTitle="没有改动的项" emptyNote="这些项没有改动" />
    </section>
  );
}
const REISSUE_INLINE = 5;
/** 申请单上能按记录号读的奖励记录：补发按原顺序，冲正和状态变更一笔；暂停、恢复只有用户和类型，不读。 */
const f5RecordIds = (fund: FundTicket | undefined): string[] => fund?.kind === "f5Reissue" ? fund.ids
  : (fund?.kind === "f5Status" || fund?.kind === "f5Reverse") && fund.eventId ? [fund.eventId] : [];
/** 兑付覆盖率：批准时后端到底查不查，按各类的回放方法核过的（8cf61c07）。认不出的类型只写页面自己拦的那一步。 */
const PAGE_COVERAGE_COPY = "页面读到的兑付覆盖率低于红线时不能批准。";
const F2_POLICY_COVERAGE = "批准时先查兑付覆盖率：读不到或低于红线就不执行，审批单留着待审批。";
// F3 自动发放、全平台封顶：批准时读不到覆盖率也拦（BinarySettlementPolicyProvider.currentCoverageBlock）；其余放宽类 F 键只比红线（OpsTeamService.coverageBelowRedline），读不到不拦。
const F3_PAYOUT_COVERAGE = "批准时先查兑付覆盖率：读不到或低于红线就不改，审批单留着待审批。";
/** 改 F2 单层 USDT 比例的单：返回是哪一层。 */
const f2RateLevel = (fund: FundTicket | undefined) => fund?.kind === "fConfig" ? /^F\.unilevel\.(L[1-7])$/.exec(fund.key)?.[1] : undefined;
/** 开启自动发放：没有「调高、调低」的方向，不按「多付钱」写。 */
const enablesAutoPayout = (fund: FundTicket | undefined) => fund?.kind === "fConfig" && fund.spec?.payoutControlAmplification === "enable";
/**
 * 放大类单的后果一句：审批单详情和批准框用同一句（DT-14），没有专门说法的写「会让平台多付钱」。
 * 不能撤销不写在这里：批准框有「不能撤销」标签（VS-106），详情在句尾补（DT-10）。
 * F4 派奖、结算批准时按那一刻重算，奖池为 0、没人上榜、已结算或暂停时不发（LeadershipPoolService、OpsTeamService 回放）：不写成一定发钱。
 */
function fundLead(w: A2OperationRow): string {
  const fund = fundTicket(w);
  if (fund?.kind === "f4Payout" || fund?.kind === "f4Settle") return F4_SETTLEMENT_CONSEQUENCE;
  if (fund?.kind === "f5Status" && fund.state === "unlocked") return "真实放钱";
  const k1 = k1TicketView(w);
  if (k1) return k1.kind === "release" ? "批准后这笔钱不再锁住" : "放宽后可能多放收益";
  if (w.operationCode === "f_unilevel_bootstrap") return "启用结算后，平台按这些比例付团队奖励";
  return coverageFacts(w)?.lead ?? "会让平台多付钱";
}
function coverageFacts(w: { operationCode?: string | null; obj?: string; after?: string; action?: string }) {
  const fund = fundTicket(w);
  if (fund?.kind === "fConfig" && fund.spec?.loosen) return { lead: `这次${fund.spec.loosen}，会让平台多付钱`, check: fund.spec.payoutControlAmplification ? F3_PAYOUT_COVERAGE : "批准时先查兑付覆盖率：低于红线就不改，审批单留着待审批。" };
  // 后果写成和团队平衡奖励页确认框同一句。
  if (enablesAutoPayout(fund)) return { lead: "开启后系统按周期自动发钱", check: F3_PAYOUT_COVERAGE };
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
function approvalRefusedText(operationCode: string | null | undefined, code: string) {
  if (code === "ONBOARDING_COMPARISON_VERSION_CONFLICT") return "这个对比位已被别人改过，这次批准没有执行；审批单还是待审批。请驳回，或请发起人撤回后重新提交。";
  // A6 授权单：后端在改授权之前拒（OpsPlatformRoleService 审计角色只读门），授权、单子和锁都不动。
  if (code === "AUDIT_ROLE_WRITE_FORBIDDEN") return "审计角色只能有查看权限，这次批准没有执行，角色权限没有变；审批单还是待审批，不会自己结束。请驳回，或请发起人撤回。";
  // F 域配置（放宽方向）和 F5 补发：后端在改之前拒（OpsTeamService.updateUiConfig 等、F5CommissionService.reissueInternal），单子和锁都不动。
  if (code === "COVERAGE_BELOW_REDLINE" && F_CONFIG_CODES.includes(operationCode ?? "")) return "兑付覆盖率低于红线，这次批准没有执行，设置没有改；审批单还是待审批。等覆盖率恢复后再批准，或驳回。";
  // F3 自动发放、全平台封顶批准时覆盖率读不到（BinarySettlementPolicyProvider.currentCoverageBlock），同样在改之前拒。
  if (code === "B1_COVERAGE_UNRELIABLE" && F_CONFIG_CODES.includes(operationCode ?? "")) return "兑付覆盖率暂时读不到，这次批准没有执行，设置没有改；审批单还是待审批。等能读到后再批准，或驳回。";
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
  if (["e1_hosting_centers_update", "h5_earn_milestone_create", "f4_quota_tier_create"].includes(code)) return {};
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
/** 商品编辑单改了展示基础销量、购买动态时的实际效果，句子和商品页送审确认框同一个函数（e1DisplayEffect）。冻结的前值不含累计销量，所以写「累计销量 + 基础值」；后端在后侧写入的 sold 不算改动。 */
function e1DisplayChange(w: Pick<A2OperationRow, "operationCode" | "before" | "after">) {
  if (w.operationCode !== "e1_sku_update") return "";
  const { b, a } = reviewPair(w.before, w.after, w.operationCode);
  if (b?.kind !== "object" || a?.kind !== "object") return "";
  const changed = [...new Set([...Object.keys(b.value), ...Object.keys(a.value)])]
    .filter(key => key !== "sold" && !same(e1ReviewValue(key, b.value[key]), e1ReviewValue(key, a.value[key])));
  const base = changed.includes("displaySoldBase") ? Number(e1ReviewValue("displaySoldBase", a.value.displaySoldBase) ?? 0) : undefined;
  const live = changed.includes("liveActivityVisible") && typeof a.value.liveActivityVisible === "boolean" ? a.value.liveActivityVisible : undefined;
  const raw = parseReview(w.after);
  const status = raw?.kind === "object" ? raw.value.status : undefined;
  return e1DisplayEffect({ base, live, liveAfter: a.value.liveActivityVisible !== false, listed: status === undefined || status === null || status === "on" },
    changed.every(key => key === "displaySoldBase" || key === "liveActivityVisible"));
}

function monthlyTargetChange(w: Pick<A2OperationRow, "action" | "before" | "after" | "operationCode">) {
  // B97 起商品编辑单叫「编辑商品 · 名称」，按操作类型和月目标前后值认（显示规则 7）。
  const e1Update = w.operationCode === "e1_sku_update";
  if (w.action !== "调整设备型号" && !e1Update) return null;
  const before = parseReview(w.before), after = parseReview(w.after);
  if (after?.kind !== "object") return null;
  const was = before?.kind === "object" ? before.value : {};
  if (after.value.clearMonthlyTarget === true) return "close";
  return ["monthlyTargetUsdt", "monthlyTargetBandPct"].some((key) => e1Update ? !same(e1ReviewValue(key, was[key]), e1ReviewValue(key, after.value[key])) : !same(was[key] ?? null, after.value[key] ?? null)) ? "target" : null;
}

/**
 * A1 启停单批准后对这个账号的影响，和发起时确认框同一套说法（OP-69，a1-accounts 停用、启用确认框）。
 * 停用在批准执行时踢下线（OpsAdminAccountService 状态改为 disabled 后 revokeSessions）。拟改值认不出时不写。
 */
function a1StatusImpact(w: A2OperationRow) {
  if (w.operationCode !== "a1_account_status_update") return undefined;
  const after = w.after.trim().toLowerCase();
  // short、detail：批准框的影响一行和「说明」；row、note：详情抽屉判断要点「批准后」一行和它的第二行。
  if (["已停用", "停用", "disabled"].includes(after)) return { short: "批准后账号所有设备下线、不能再登录。", detail: "角色保留。它发起的待审批单不会自动撤回；有主管资格时要先交接负责的组。",
    row: "账号所有设备下线、不能再登录，角色保留", note: "它发起的待审批单不会自动撤回；有主管资格时要先交接负责的组" };
  if (["启用", "已启用", "enabled", "active"].includes(after)) return { short: "批准后可以重新登录，角色不变。", detail: "两步验证保持原样；之前撤掉的客服资格不会自动恢复。",
    row: "可以重新登录，角色和两步验证不变", note: "之前撤掉的客服资格不会自动恢复" };
  return undefined;
}

function approvalTiming(w: A2OperationRow) {
  const coverageMode = approvalCoverageMode(w);
  const monthlyChange = monthlyTargetChange(w);
  if (monthlyChange) {
    // 框顶的影响句只写这次改了什么，一行写完；不变的部分进「说明」（OP-48），理由框打开就看得到（D8-reason）。
    const impact = monthlyChange === "close"
      ? "批准后关闭月收益目标，发布过的型号之后新建的任务按单计价。"
      : "批准后保存新目标，发布过的型号之后按新目标建任务。";
    const note = "未首次发布的草稿在首次上架时发布；已建任务和历史到账不变。";
    return { tag: "批准后保存", impact, note, drawer: `${impact}${note}点「驳回」原操作不执行。` };
  }
  const scheduled = phoneScheduledAt(w);
  if (scheduled) return { tag: `按计划在 ${scheduled} 生效`, impact: "批准后登记排程，到点才生效。", drawer: `点「批准」确认后登记排程，到 ${scheduled} 生效；点「驳回」原操作不执行。` };
  if (isJ4Execution(w)) return { tag: "立即逐步执行", impact: "批准后逐步执行，可能只执行一部分；失败时到「监管要求应急处理」的执行追溯里看哪些步骤已生效。", drawer: "点「批准」确认后逐步执行，可能只执行一部分；点「驳回」原操作不执行。" };
  if (coverageMode === "onApproval") return { tag: "通过覆盖率检查后执行", impact: "", drawer: "点「批准」确认后先检查兑付覆盖率，够了才执行；点「驳回」原操作不执行。" };
  if (w.operationCode === "k1_release_param") return { tag: "核对通过后执行", impact: "", drawer: "点「批准」确认后先核对规则没被改过、兑付覆盖率够，才改；点「驳回」原操作不执行。" };
  if (w.operationCode === "k1_earnings_release") return { tag: "核对通过后执行", impact: "", drawer: "点「批准」确认后先核对这笔收益没变、兑付覆盖率够，才放行；点「驳回」原操作不执行。" };
  const fund = fundTicket(w);
  // 已结算的周期批准时不查覆盖率（BE-27），标签不写「通过覆盖率检查」。
  if (fund?.kind === "f4Payout" || fund?.kind === "f4Settle") return { tag: "核对通过后执行", impact: "", drawer: "点「批准」确认后先核对，还没结算的先查兑付覆盖率，算出有应发的金额才发钱；点「驳回」原操作不执行。" };
  if (fund?.kind === "f5Status" && fund.state === "unlocked") return { tag: "核对通过后执行", impact: "", drawer: "点「批准」确认后先核对，通过了才放钱；点「驳回」原操作不执行。" };
  if (coverageMode === "amplifies" && fund?.kind === "fConfig" && (fund.spec?.loosen || enablesAutoPayout(fund))) return { tag: "通过覆盖率检查后执行", impact: "", drawer: "点「批准」确认后先查兑付覆盖率，够了才改；点「驳回」原操作不执行。" };
  if (fund?.kind === "f5Reissue") return { tag: "通过覆盖率检查后执行", impact: "", drawer: "点「批准」确认后先查兑付覆盖率，够了才补发；点「驳回」原操作不执行。" };
  if (g3PolicyExecutionTiming(w)) return { tag: "按计划时点生效", impact: "", drawer: "点「批准」确认后按生效时间执行；点「驳回」原操作不执行。" };
  // 披露发布只封存这一版，用户看哪版另走「设置／调整生效版本」审批（I5，PRD I5 发布批准）。
  if (w.operationCode === "i5_disclosure_publish" || w.operationCode === "i4_disclosure_publish") return { tag: "批准后封存", impact: "", drawer: "点「批准」后这版封存，用户看到的版本不变，生效版本另行审批；点「驳回」原操作不执行。" };
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

/** 本页的码翻中文；别的模块的码原样，等宽显示。 */
function logActionText(code: string) {
  return A2_ACTION_NAMES[code] ?? a2ActionText(code);
}

/** 日志前后值只在显示时转换，技术信息仍使用记录原文。 */
function logDeltaText({ delta, approvalAction, action, resourceType }: A2AuditLogRow) {
  const sides = delta.split(/ -> | → /);
  if (sides.length === 2) {
    const [before, after] = sides;
    const account = resourceType === "A2_OPERATION" && a2AccountStatusText(before) && a2AccountStatusText(after);
    const operationCode = account ? "a1_account_status_update" : action === "FX_QUOTE_UPDATED" ? "d6_fx_quote" : undefined;
    const changes = approvalDisplayChanges({ action: approvalAction ?? "", before, after, operationCode }, a2AccountStatusText);
    if (changes === null) return CHANGE_UNAVAILABLE;
    if (changes) return [...changes.facts.map(({ label, before, after }) => `${label} ${before} → ${after}`),
      ...(changes.forced ? ["强制保存倒挂价"] : [])].join("，");
    const batch = fBatchTicket({ action: approvalAction, before, after });
    if (batch?.items) {
      const pages = fBatchPages(batch.items);
      return batch.items.map((item) => {
        const [from, to] = a2Pair(item.key, item.before, item.after);
        return `${fBatchLabel(item, pages)} ${from} → ${to}`;
      }).join("，");
    }
    if (approvalAction && G_PARAM_ACTION.test(approvalAction)) return sides.map(gParamText).join(" → ");
  }
  return delta.split(" → ").map((part) => part === "true" ? "是" : part === "false" ? "否" : part).join(" → ");
}

/** 动作名的显示：认得出的写中文；没收录的动作码写「未识别的操作」，原码在抽屉的技术信息里；本来就是中文的照写。 */
function logActionShown({ action: code, actionLabel }: A2AuditLogRow) {
  const text = actionLabel ?? logActionText(code);
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
  if (l.action === "I2_NOVA_SOCIAL_EVENTS_SYNCED" && (l.resourceId === "social-events" || l.obj === "social-events")) {
    return { kind: "消息推送", raw: l.obj };
  }
  if (l.approvalAction?.startsWith("兑换参数调整 · ")) {
    const name = objectText({ action: l.approvalAction, obj: l.obj });
    if (name !== l.obj) return { id: name, raw: l.obj };
  }
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

type A2DecisionKind = "approve" | "reject" | "withdraw";
type A2CommandKind = A2DecisionKind | "param" | "retention" | "export";
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
/** D5 审批单动到 TRC20：写这张单（或保存的原批准）会做什么、为什么不能做、下一步（OP-126、OP-93）。 */
function d5Trc20Reason(block: string, retry: boolean) {
  if (block === TRC20_OPENS_WITHDRAWAL || block === TRC20_CHANGES_FEE)
    return retry ? `原批准${block}，TRC20 ${TRC20_CLOSED}，不能按原操作重试` : `这张单${block}，TRC20 ${TRC20_CLOSED}；可以驳回，或由发起人撤回`;
  return retry && block === D5_DIFF_UNREADABLE ? "审批单的变更详情读不懂，暂不能按原操作重试" : block;
}
const RECOVERY_HINT: Record<A2CommandKind, string> = {
  approve: "可以查询这次批准的结果，或按原操作重试，不会重复执行。",
  reject: "可以查询这次驳回的结果，或按原操作重试，不会重复执行。",
  withdraw: "可以查询这次撤回的结果，或按原操作重试，不会重复执行。",
  param: "读到的是现在的值，值相同也可能是别人改的。可以按原操作重试，不会重复执行。",
  retention: "「读取最近清理」只能看到最近一次手动清理，证明不了这次清理成没成。可以按原操作重试，不会重复清理。",
  export: "查询只能看到有没有这次的导出记录。可以按原操作重试，按当时的条件重新下载。",
};
/**
 * 查询原决定（A2-BE-17）后留在待确认条上的结果：只按这次决定自己的记录说，不拿这张单现在的状态推断。
 * 「已确认完成」「明确被拒」由查询自己解除记录，用轻提示，见 DECISION_DONE、DECISION_REFUSED。
 */
type DecisionCheck = "processing" | "unconfirmed" | "readFailed";
/**
 * 标签已经说了查到什么，后面这句只写下一步；查询失败的正文是读取错误本身，所以只有标签。
 * retried：刚才按原操作重试被拒，前面已经写了重试被拒的原因，这句要说清「原来那次」还没有结果。
 */
const DECISION_CHECK: Record<DecisionCheck, { tone: "progress" | "warn"; icon?: typeof SearchX; label: string; text?: (verb: string, retried: boolean) => string }> = {
  processing: { tone: "progress", label: "仍在处理", text: (verb, retried) => retried ? `原来那次${verb}还在处理，稍后再查。` : "查过，稍后再查。" },
  unconfirmed: { tone: "warn", icon: SearchX, label: "没查到结果", text: (verb, retried) => `${retried ? `原来那次${verb}` : "查过，"}还不能确认有没有执行，稍后再查。` },
  readFailed: { tone: "warn", icon: CloudOff, label: "查询失败" },
};
const DECISION_DONE = (verb: string, id: string) => `已确认：${id} 已${verb}`;
/** 被拒提示不自动消失、能叠几条，所以和成功提示一样带单号。 */
const DECISION_REFUSED = (verb: string, id: string, why?: string) => why
  ? `${id} 的${verb}没有执行：${why}。`
  : `${id} 的${verb}被系统拒绝，没有执行。这张单现在的状态看「待审批」或「操作记录」。`;
/**
 * 决定被拒的原因（批准、驳回、撤回能收到的 A2 码）：共用说明里叫人「刷新」「保留原操作记录」「到操作记录与审批核对」，
 * 可这时页面已经自动刷新、原记录已经解除、人就在这页，所以在这里换成只说原因的句子，不改共用表。
 */
const DECISION_REFUSED_REASON: Record<string, string> = {
  A2_OPERATION_ALREADY_TERMINAL: "这张单已经处理完成",
  A2_OPERATION_NOT_FOUND: "这张单不存在或已经处理完成",
  A2_WITHDRAW_STALE: "这张单的状态已经变了",
  A2_BUSINESS_CONTEXT_MISMATCH: "这张单的对象和审批内容对不上",
  A2_MAKER_ID_UNVERIFIED: "发起人身份无法核实，这张单现在不能处理，请联系值班人员",
  A2_DISCLOSURE_SNAPSHOT_CHANGED: "申请后披露草稿变了，这张单按的是旧内容，不能批准",
  A2_REASON_POLICY_UNAVAILABLE: "理由规则暂时读不到，稍后重新处理这张单",
  A2_REQUEST_HASH_FAILED: "请求无法处理，稍后重新处理这张单",
  PERMISSION_DENIED: "这个账号没有这项操作的业务权限，请核对授权",
};
/** 共用表认不出的机器码会落到这句兜底；被拒已经确认，它的「请刷新后重试」不对，按没有原因写。 */
const decisionRefusedReason = (code: string | undefined, fallback: string, approvalReason?: string) => {
  const reason = approvalReason ?? ((code && DECISION_REFUSED_REASON[code.split(":")[0]]) || formatAdminApiError(code, fallback));
  if (reason === UNMAPPED_ADMIN_ERROR_TEXT) return undefined;
  // 被拒后页面已自动重读：共用说明里叫人刷新的半句不写，只留原因。
  return reason.split(/(?<=[，；。])/).filter((part) => !part.includes("刷新")).join("").replace(/[，；。.]+$/, "") || undefined;
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
const k1Bucket = (bucket: string) => bucket === "bonus_locked" ? "锁定奖励" : "审核中";
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
const ROWS_SHOWN = 5;

/** 成组的记录画成小表，每组一行，列头用字段名；超过 5 行的收在「查看全部」后面（VS-109）。 */
/** 金额字段的格按金额写法；raw(行号, 列) 为 true 的格照原文写：和对照的另一张表同一格原文不同、按写法显示后却一样（rowsRawCells）。 */
function ReviewRows({ name, rows, labels = CHANGE_LABELS, raw }: { name: string; rows: readonly Record<string, unknown>[]; labels?: Record<string, string>; raw?: (index: number, column: string) => boolean }) {
  const cell = (column: string, value: unknown, index: number) => raw?.(index, column) ? valueText(column, value, labels) : a2Shown(column, valueText(column, value, labels), value);
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const unit = ROW_UNIT[name] ?? "行";
  const table = (part: readonly Record<string, unknown>[], label: string, offset: number) => (
    <Table label={label} data-tight="">
      <thead><tr>{columns.map((column) => <Th key={column}>{labels[column] ?? column}</Th>)}</tr></thead>
      <tbody>{part.map((row, index) => <Tr key={index}>{columns.map((column) => <Td key={column}><Cell main={cell(column, row[column], offset + index)} title={cell(column, row[column], offset + index)} /></Td>)}</Tr>)}</tbody>
    </Table>
  );
  const title = labels[name] ?? name;
  return (
    <div className="a2-change-rows">
      {table(rows.slice(0, ROWS_SHOWN), title, 0)}
      {rows.length > ROWS_SHOWN && <Fold inset title={`查看全部 ${rows.length} ${unit}`} summary={`还有 ${rows.length - ROWS_SHOWN} ${unit}`}>{table(rows.slice(ROWS_SHOWN), `${title}（续）`, ROWS_SHOWN)}</Fold>}
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
/** F1 券冲正批准后的实际券处置（F1-BE-19）：只翻译批准时记下的结果，不从申请时的选择或券面额推断。原码只进「技术信息」。 */
const F1_VOUCHER_RESULT: Record<string, string> = {
  CLAWED_BACK: "已用券，已从 USDT 可用余额扣回",
  SKIPPED_BY_OPERATOR: "已用券，按申请选择不扣回",
  SKIPPED: "已用券，没有扣回",
  AVAILABLE_REVOKED: "券还没用，已作废",
  ORDER_VOUCHER_REVOKED: "订单还没付款，券已撤回",
  NO_GRANT_RECORD: "找不到这张券的发放记录，没有扣款",
};
const F1_VOUCHER_SKIP_REASON: Record<string, string> = {
  REDEEMED_AMOUNT_UNKNOWN: "旧订单没有记下实际抵扣金额",
  REDEEMED_AMOUNT_ZERO: "实际抵扣金额为 0",
  ORDER_SETTLEMENT_UNKNOWN: "订单付款状态无法确认",
  ORDER_NOT_SETTLED: "订单还没付款",
};
const f1VoucherResultText = (disposition?: string) => !disposition ? "—"
  : F1_VOUCHER_RESULT[disposition] ?? (disposition.startsWith("GRANT_STATUS_") ? "券已不可用，没有扣款" : "系统记下的处置暂时无法显示");

function g3ControlReviewAfter(before: Record<string, unknown>, after: Record<string, unknown>, operationCode?: string) {
  if (operationCode !== "g3_market_policy_change") return undefined;
  if ("引擎状态" in before && "引擎状态" in after && "恢复后推进" in after) return after;
  if (!("钉住控制" in before) || !("钉住控制" in after)) return undefined;

  // For a pin proposal, B1 values the same target price that the frozen review proposes to publish.
  const currentPrice = "当前全站价格（USDT/UVT）";
  const day = after["钉住控制"];
  const price = after["B1拟估值价格（USDT/UVT）"];
  if (!(currentPrice in before) || currentPrice in after || typeof day !== "string" || !/^D[1-7]$/.test(day)
    || typeof price !== "number" || !Number.isFinite(price) || price <= 0) return after;
  return { ...after, [currentPrice]: `拟按 ${day} 目标价 ${valueText(currentPrice, price)} 发布` };
}

export function A2ChangeReview({ before, after, omit = [], operationCode, amountKey, facts, children, withdrawalChanges }: { before: string; after: string; omit?: readonly string[]; operationCode?: string; /** 整张单是哪个字段（a2TicketKey）：文字型前后值和 F 配置的一组值按它判断是不是金额。 */ amountKey?: string; /** 跟在「变更」后面同一块里的说明行，比如 F1 券冲正的「批准后」。 */ facts?: ReactNode; children?: ReactNode; withdrawalChanges?: WithdrawalProposalChanges | null }) {
  const { b, a, labels } = reviewPair(before, after, operationCode);
  const created = withdrawalChanges === undefined && !b;
  let body: ReactNode;
  if (withdrawalChanges === null) {
    body = <Facts><Fact k="变更">{CHANGE_UNAVAILABLE}</Fact></Facts>;
  } else if (withdrawalChanges) {
    body = <Facts>{withdrawalChanges.facts.map(({ key, label, before, after }) => (
      <Fact key={key} k={label}><Change from={before} to={after} /></Fact>
    ))}{withdrawalChanges.forced && <Fact k="倒挂价">强制保存</Fact>}</Facts>;
  } else if (!a) {
    body = <Facts><Fact k="变更后">—</Fact></Facts>;
  } else if (a.kind === "text" && b?.kind === "text" && fieldPairs(b.text, a.text)) {
    // 「显示名：甲；工作邮箱：乙」这类逐项摘要：两边字段一一对应时每项一行，不拼成一长句折行。
    body = <Facts>{fieldPairs(b.text, a.text)!.map(([label, from, to]) => <Fact key={label} k={label}><Change from={from} to={to} /></Fact>)}</Facts>;
  } else if (a.kind === "text") {
    const [shownFrom, shownTo] = a2Pair(amountKey, b ? b.kind === "text" ? b.text : valueText(undefined, b.kind === "object" ? b.value : b.rows, labels) : undefined, a.text);
    body = <Facts><Fact k={created ? "内容" : "变更"}>{!b ? shownTo : <Change from={shownFrom} to={shownTo} />}</Fact>{facts}</Facts>;
  } else if (a.kind === "rows") {
    body = <>
      <ReviewRows labels={labels} name="" rows={a.rows} raw={b?.kind === "rows" ? rowsRawCells(a.rows, b.rows, labels) : undefined} />
      {b && <Fold inset title="变更前" summary={b.kind === "rows" ? `共 ${b.rows.length} 行` : "原来的内容"}>{b.kind === "rows" ? <ReviewRows labels={labels} name="" rows={b.rows} raw={rowsRawCells(b.rows, a.rows, labels)} /> : <p className="rd-note">{a2Shown(amountKey, b.kind === "text" ? b.text : valueText(undefined, b.value, labels))}</p>}</Fold>}
    </>;
  } else {
    const was = b?.kind === "object" ? b.value : undefined;
    const g3Control = was && g3ControlReviewAfter(was, a.value, operationCode);
    const next = g3Control ?? a.value;
    const keys = Object.keys(next).filter((key) => !omit.includes(key));
    const removed = was ? Object.keys(was).filter((key) => !omit.includes(key) && !(key in next)) : [];
    const groups = keys.filter((key) => isRowList(next[key]));
    const plain = [...keys.filter((key) => !isRowList(next[key])), ...removed];
    // 有没有改由 DiffList 按两边文字比；a2Pair 只改金额字段，且不会把原来不同的两边变成一样。
    const rows: DiffRow[] = plain.map((key) => {
      const [before, after] = a2Pair(amountKey ?? key, g3Control && was && !(key in was) ? undefined : valueText(key, was?.[key], labels),
        g3Control && !(key in next) ? undefined : valueText(key, next[key], labels), [was?.[key], next[key]]);
      return { key, ...derivedBaseRateShown(key, labels[key] ?? key, was?.[key], next[key], !was, before, after) };
    });
    body = <>
      {b && b.kind !== "object" && <Facts><Fact k="变更前">{a2Shown(amountKey, b.kind === "text" ? b.text : valueText(undefined, b.rows, labels))}</Fact></Facts>}
      {plain.length > 0 && (was
        ? <DiffList rows={rows} restTitle="其余内容" emptyNote="这些项没有改动" />
        : <Facts>{rows.map((row) => <Fact key={row.key} k={String(row.label)}>{row.after}</Fact>)}</Facts>)}
      {groups.map((key) => {
        const old = was?.[key];
        return (
          <div key={key} className="a2-change-group">
            <div className="a2-change-sub">{labels[key] ?? key}{was && same(old, next[key]) && <span className="rd-weak"> · 没有改动</span>}</div>
            <ReviewRows labels={labels} name={key} rows={next[key] as Record<string, unknown>[]} raw={rowsRawCells(next[key], old, labels)} />
            {isRowList(old) && !same(old, next[key]) && <Fold inset title={`变更前的${labels[key] ?? key}`} summary={`${old.length} ${ROW_UNIT[key] ?? "行"}`}><ReviewRows labels={labels} name={key} rows={old} raw={rowsRawCells(old, next[key], labels)} /></Fold>}
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

export function A2Audit({ ctx, coverage, h5CoverageBlock, refreshCoverage }: {
  ctx: ACtx;
  coverage?: CoverageSnapshot;
  h5CoverageBlock?: string;
  refreshCoverage: () => Promise<unknown>;
}) {
  const { toast, openActionConfirm } = ctx;
  const oldPayoutTickets = useRef(new Set<string>());
  const refusedPayoutReasons = useRef(new Map<string, string>());
  const [, redrawPayoutBlocks] = useState(0);
  useEffect(() => {
    try {
      const ids: unknown = JSON.parse(sessionStorage.getItem(F4_OLD_PAYOUT_TICKETS) ?? "[]");
      if (Array.isArray(ids)) {
        ids.filter((id): id is string => typeof id === "string").forEach(id => oldPayoutTickets.current.add(id));
        redrawPayoutBlocks(value => value + 1);
      }
    } catch { /* The current tab can still retain new refusals in memory. */ }
  }, []);
  const rememberOldPayout = (ticketId: string) => {
    oldPayoutTickets.current.add(ticketId);
    try { sessionStorage.setItem(F4_OLD_PAYOUT_TICKETS, JSON.stringify([...oldPayoutTickets.current])); } catch { /* In-memory block remains. */ }
    redrawPayoutBlocks(value => value + 1);
  };
  const legacyPayoutRefusal = (kind: A2DecisionKind, id: string, op: string | undefined, code: string | undefined) => {
    if (kind !== "approve" || op !== "f4_leaderboard_period_payout" || code !== "F4_LEADERBOARD_PAYOUT_REVIEW_REQUIRED") return false;
    rememberOldPayout(id);
    return true;
  };
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
  const h5ApproveBlock = (w: A2OperationRow) =>
    w.operationCode === "h5_power_up_config" && approvalCoverageMode(w) ? h5CoverageBlock : undefined;
  const canWrite = canAccessA2Write(principal.authorities);
  const canPropose = principal.authorities.includes("platform_a2_proposal_create");
  const canMakeV8 = canWrite && ["network_f1_read", "network_f1_promote_user"].every((code) => principal.authorities.includes(code));
  /** V8 晋升单按发起它要的权限撤回（B88-BE-03），其余单要通用发起权限。 */
  const canWithdraw = (w: A2OperationRow) => isV8PromotionTicket(w) ? canMakeV8 : canPropose;
  const isMine = (w: A2OperationRow) => isCurrentOperator(w, session?.username);
  const zone = businessZone().label;

  /* 网址：进页读一次，之后回写（ST-23）。 */
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<A2Tab>("pending");
  // 决定被拒的提示：记录已解除，原因只在这里；留在页签上方直到点「知道了」或切页签，不盖页头和统计。
  const [refusals, setRefusals] = useState<string[]>([]);
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
  const [e1ProposalRead, setE1ProposalRead] = useState<{
    rows: readonly A2AuditLogRow[];
    session: typeof session;
    proposals: ReadonlyMap<string, A2AuditLogRow | undefined>;
  }>();
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
  const [pendingNotes, setPendingNotes] = useState<Record<string, { text: string; check?: DecisionCheck }>>({});
  const decisionRetryRefusals = useRef(new Map<string, string>());
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
      refreshCoverage(),
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
    : amount.state === "loading" ? "正在加载" : "退款金额未读取";

  // 已应用的条件后端查过了，以后端的结果为准；对象还会命中详情里的命令号这类字段，前端再按窄的字段筛会把查到的记录删掉（M4）。
  const logRows = records?.recentLogs ?? [];
  const logPages = Math.max(1, Math.ceil(logRows.length / logPageSize));
  const logSafePage = Math.min(logPage, logPages);
  const logPageRows = useMemo(() => (records?.recentLogs ?? []).slice((logSafePage - 1) * logPageSize, logSafePage * logPageSize),
    [records, logSafePage, logPageSize]);
  useEffect(() => {
    if (tab !== "records" || view !== "logs" || recordsLoading || !session) return;
    const tickets = [...new Set(logPageRows.map(e1ApprovalTicket).filter(ticket => ticket !== undefined))];
    if (!tickets.length) return;
    const controller = new AbortController();
    void Promise.all(tickets.map(async ticket => {
      const proposal = await fetchA2ProposalLog(ticket, controller.signal).catch(() => undefined);
      return [ticket, proposal] as const;
    })).then(entries => {
      if (!controller.signal.aborted) setE1ProposalRead({ rows: logPageRows, session, proposals: new Map(entries) });
    });
    return () => controller.abort();
  }, [logPageRows, recordsLoading, session, tab, view]);
  const e1Proposals = e1ProposalRead?.rows === logPageRows && e1ProposalRead.session === session ? e1ProposalRead.proposals : undefined;
  const historyRows = records?.operationHistory ?? [];
  const f4ResultTexts = useMemo(() => new Map((records?.operationQueue ?? []).flatMap(ticket => {
    if (ticket.status !== "approved") return [];
    const text = ticket.f4ResultUnreadable ? F4_RESULT_UNREADABLE : ticket.businessResult && f4ApprovalResultText(ticket.businessResult);
    return text ? [[ticket.id, text] as const] : [];
  })), [records]);
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
  const chooseTab = (next: A2Tab) => { closeDrawers(); setRefusals([]); setTab(next); };

  /* ────────────────── 写操作的共用路 ────────────────── */

  const refreshAfterWrite = () => Promise.all([loadMain().catch(() => undefined), loadFiltered(appliedRef.current)]);

  /**
   * 先把原操作存好再发（OP-92）；明确被拒丢号，留在确认框；结果未知保号，关框，转成页面上方的待确认条，
   * 这张单在确认前不能再处理（OP-93）。接口成功但读回看不到目标结果，也算结果未知（OP-88）。
   * 重试的是保留下来的原命令时这里不丢号，由 retryPending 按命令类型决定结案还是待人核实（CP-33）。成功并读回到目标状态才解除。
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
        const retentionRefused = extra.kind === "retention" && isExplicitRejection(cause)
          && ["RETENTION_PARAMETERS_STALE", "RETENTION_EXPECTED_MONTHS_REQUIRED"].includes((cause as { backendMessage?: string }).backendMessage ?? "");
        if (!unknown && (!retained || retentionRefused)) a2Commands.forget(scope, key);
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
  const runDecision = async (kind: A2DecisionKind, w: DecisionTicket, reason: string, by = operator) => {
    if (kind === "approve" && oldPayoutTickets.current.has(w.id)) throw new Error(F4_PAYOUT_REVIEW_REQUIRED);
    let businessResult: F4ApprovalBusinessResult | undefined;
    const outcome = await sendCommand(
    `${kind}|${w.id}`,
    { kind, label: `${DECISION_VERB[kind]} · ${actionName(w)}`, target: w.id, reason, operator: by, rule: w.rule !== undefined ? w.rule : decisionRule(w),
      operationCode: w.operationCode, obj: w.obj, fundEffect: w.fundEffect, refundOrderNo: w.refundOrderNo, refundAmountUsdtText: w.refundAmountUsdtText ?? undefined, action: w.action, ruleTaskAction: w.ruleTaskAction },
    `a2-${kind}-${w.id}`,
    async (key) => {
      if (kind === "reject") return rejectA2Operation(w.id, reason, key);
      if (kind === "withdraw") return withdrawA2Operation(w.id, reason, by, key);
      try { return await approveA2Operation(w.id, reason, key, w.operationCode); }
      catch (cause) {
        legacyPayoutRefusal(kind, w.id, w.operationCode, backendCode(cause));
        throw cause;
      }
    },
    async (receipt) => {
      if (receipt.id !== w.id || receipt.status !== DECISION_STATUS[kind]) return false;
      const next = await loadMain();
      void loadFiltered(appliedRef.current);
      const decided = next.operationQueue.find((item) => item.id === w.id && item.status === DECISION_STATUS[kind]);
      if (kind === "approve" && decided?.f4ResultUnreadable) return false;
      businessResult = decided?.businessResult;
      return !!decided || next.operationHistory.some((item) => item.id === w.id && item.st === DECISION_STATUS[kind]);
    },
    );
    return { outcome, businessResult };
  };

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

  const notePending = (record: A2PendingCommand, text: string, check?: DecisionCheck) => {
    const refusal = decisionRetryRefusals.current.get(record.commandKey);
    const note = refusal ? `${refusal}${text}` : text;
    setPendingNotes((current) => ({ ...current, [record.fingerprint]: { text: `${businessClock(Date.now())} ${note}`, check } }));
  };

  const clearDecisionPendingNote = (record: A2PendingCommand) => {
    decisionRetryRefusals.current.delete(record.commandKey);
    setPendingNotes((current) => {
      const next = { ...current };
      delete next[record.fingerprint];
      return next;
    });
  };

  const verifyDecisionPending = async (record: A2PendingCommand, kind: A2DecisionKind, afterRefusedRetry = false) => {
    const owner = record.commandOwnerId;
    const hasOriginal = () => owner !== undefined && isPendingCommandOwnedBy(record, owner)
      && record.fingerprint === `${kind}|${record.target}` && a2Commands.isDurablyStored(record.fingerprint, record.commandKey);
    if (owner === undefined || !hasOriginal()) return;
    const receipt = await fetchDirectCommandReceiptDetails("A2_COMMAND", record.commandKey, owner)
      .catch((error: unknown) => ({ state: "READ_FAILED" as const, error }));
    if (!hasOriginal()) return;
    if (receipt.state === "READ_FAILED") {
      notePending(record, displayAdminReadError(receipt.error), "readFailed");
      return receipt;
    }
    if (receipt.state === "SUCCEEDED" || receipt.state === "REJECTED") {
      a2Commands.forget(record.fingerprint, record.commandKey);
      syncPending();
      clearDecisionPendingNote(record);
      if (receipt.state === "REJECTED") {
        // 记录随即解除，拒绝原因只在这条提示里：不自动消失，运营点「知道了」或切页签才收起（协调人定，不另外常留）。
        const code = receipt.businessMessage;
        legacyPayoutRefusal(kind, record.target, record.operationCode ?? recordTicket(record)?.operationCode, code);
        const approvalReason = code && kind === "approve" ? approvalRefusedText(record.operationCode ?? recordTicket(record)?.operationCode, code) : undefined;
        const why = code ? decisionRefusedReason(code, code, approvalReason) : undefined;
        // 专项原因本身已写明「这次批准没有执行」和单子现状，不再套「…没有执行：」。
        setRefusals((current) => [...current, approvalReason && why ? `${record.target}：${why}。` : DECISION_REFUSED(DECISION_VERB[kind], record.target, why)]);
      } else toast(DECISION_DONE(DECISION_VERB[kind], record.target), "success");
    } else {
      const check = receipt.state === "PROCESSING" ? "processing" : "unconfirmed";
      if (!afterRefusedRetry) decisionRetryRefusals.current.delete(record.commandKey);
      notePending(record, DECISION_CHECK[check].text!(DECISION_VERB[kind], decisionRetryRefusals.current.has(record.commandKey)), check);
    }
    await refreshAfterWrite();
    return receipt;
  };

  /** 重试也是写操作，按这个账号现在的权限判断，和原入口一样（OP-124）。读回核对不受影响。 */
  const canRetry = (record: A2PendingCommand) => {
    if (!isPendingCommandOwnedBy(record)) return false;
    if (record.kind === "withdraw") {
      const queued = recordTicket(record);
      if (queued) return canWithdraw(queued);
      // 单子不在队列里时按保存的动作认；旧记录没存动作的改级单分不清是不是 V8 晋升，先查询，读回后再重试。
      if (record.operationCode !== "f_vrank_override") return canPropose;
      return !!record.action && (isV8PromotionAction(record.operationCode, record.action) ? canMakeV8 : canPropose);
    }
    if (record.kind === "approve" && oldPayoutTickets.current.has(record.target)) return false;
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
  /** 保存的 D5 批准会打开 TRC20 或改它的确认费：只能查询，不能按原操作重试。 */
  const d5RetryBlock = (record: A2PendingCommand) => {
    const ticket = recordTicket(record);
    if (record.kind !== "approve" || (record.operationCode ?? ticket?.operationCode) !== D5_APPROVAL_OP) return undefined;
    const block = ticket ? d5Trc20ApprovalBlock(ticket.before, ticket.after) : TRC20_REPLAY_UNVERIFIED;
    return block && d5Trc20Reason(block, true);
  };
  const retryBlock = (record: A2PendingCommand) => {
    if (isRetryExpired(record)) return RETRY_EXPIRED;
    if (!canRetry(record)) return RETRY_NO_PERMISSION;
    const d5Block = d5RetryBlock(record);
    if (d5Block) return d5Block;
    const amount = retryAmount(record);
    if (amount?.state === "loading") return "正在加载退款金额，读完再重试";
    if (amount && amount.state !== "ok") return REFUND_AMOUNT_REQUIRED;
    return undefined;
  };

  /**
   * 按原操作重试：同命令号、同内容、同理由，不接受新输入（OP-94）。只有成功并读回到目标状态才解除待确认。
   * 决定重试遇到业务拒绝时查原回执：回放前的校验可能先拒绝重试请求。
   * 机制参数、清理、导出重试明确被拒后仍由人核实，再解除待确认。
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
      const { outcome, businessResult } = record.kind === "param" ? { outcome: await runParam(record.target as "ttl" | "retention" | "schema", record.value ?? "", record.reason, record.operator) }
        : record.kind === "retention" ? { outcome: await runRetention(record.reason, record.expectedRetentionMonths, record.operator) }
          : record.kind === "export" ? { outcome: await runExport(record.reason, record.filter ?? {}, record.operator) }
            : await runDecision(record.kind, ticketLike, record.reason, record.operator);
      // 导出和清理自己会提示「已下载」「清理完成」，不再多弹一条。
      if (outcome === "ok") {
        if (decisionRetryRefusals.current.has(record.commandKey)) clearDecisionPendingNote(record);
        // 披露发布批准只封存这一版，不说「已生效」（和 approvalTiming 同一单类判断）。
        const sealed = record.kind === "approve" && (record.operationCode === "i5_disclosure_publish" || record.operationCode === "i4_disclosure_publish");
        if (record.kind !== "export" && record.kind !== "retention") toast(businessResult ? `已确认：${record.label}，${f4ApprovalResultText(businessResult)}`
          : `已确认：${record.label}${sealed ? "，这版已封存" : "已生效"}`, businessResult?.status === "NOT_EXECUTED" ? "info" : "success");
      } else notePending(record, "重试的结果仍然未知，原记录继续保留。");
    } catch (cause) {
      if (isPermissionDenied(cause)) announcePermissionDenied();
      const code = backendCode(cause);
      const approvalReason = cause instanceof F4ApprovalBlockedError ? `${f4ResultReason(cause.result)}，批准没有执行`
        : record.kind === "approve" ? approvalRefusedText(record.operationCode ?? recordTicket(record)?.operationCode, code) : undefined;
      const why = (approvalReason
        ?? (record.kind === "approve" || record.kind === "reject" ? decisionDeniedText(record.kind, cause, true) : undefined) ?? displayAdminError(cause)).replace(/[。.]$/, "");
      if (!a2Commands.list().some(row => row.commandKey === record.commandKey)) {
        toast(why, "error");
        return;
      }
      const rejected = isExplicitRejection(cause);
      if ((rejected || (cause as { f5StatusRejected?: boolean })?.f5StatusRejected === true)
        && (record.kind === "approve" || record.kind === "reject" || record.kind === "withdraw")) {
        const reason = decisionRefusedReason(code || undefined, why, approvalReason) ?? "系统没有给出原因";
        decisionRetryRefusals.current.set(record.commandKey, `按原操作重试被拒：${reason}。`);
        await verifyDecisionPending(record, record.kind, true);
        return;
      }
      if (rejected) {
        notePending(record, `重试没有成功：${why}。这说明不了原操作的结果，原记录继续保留。`);
        setRetryRejected((current) => [...current, record.commandKey]);
      } else notePending(record, `这次没查到结果：${why}。原记录继续保留，稍后再查询或重试。`);
    }
  };

  /** 决定按原命令读回，其余只核对现状（OP-93、OP-95）。 */
  const verifyPending = async (record: A2PendingCommand) => {
    if (!isPendingCommandOwnedBy(record)) return;
    if (record.kind === "approve" || record.kind === "reject" || record.kind === "withdraw") {
      return verifyDecisionPending(record, record.kind);
    }
    if (record.kind === "export") {
      // 后端把命令号写进这次导出记录的详情，按对象查得到；查到也只说明后端生成过，文件没下到时按原操作重试。
      const found = await fetchA2Overview({ action: "A2_AUDIT_EXPORTED", object: record.commandKey }).catch(() => null);
      if (!found) { notePending(record, "查询失败，导出记录暂时读不到。原记录继续保留。"); return; }
      const hit = found.recentLogs[0];
      notePending(record, hit
        ? `查到：${logTime(hit)} 有这次的导出记录（${hit.obj.split(" · ").pop()}）。没下到文件就按原操作重试。原记录继续保留。`
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
    if (!next) { notePending(record, "查询失败，这项设置暂时读不到。原记录继续保留。"); return; }
    const now = next.mechanismParams.find((item) => item.key === record.target)?.value;
    notePending(record, `查到：${PARAM_NAME[record.target] ?? record.target}现在是 ${now ? operatorCopyText(now) : "—"}，你提交的是 ${record.value}。原记录继续保留。`);
  };

  /** 重试被拒后，人核实过原操作的结果才解除。只放开本页的锁，不发请求，后端仍按这张单现在的状态校验。 */
  const releasePending = (record: A2PendingCommand) => {
    if (!isPendingCommandOwnedBy(record)) return;
    a2Commands.forget(record.fingerprint, record.commandKey);
    syncPending();
    setReleasing(null);
    toast(record.kind === "param" ? "已解除原操作记录，这项设置可以重新调整" : record.kind === "retention" ? "已解除原操作记录，可以重新清理"
      : record.kind === "export" ? "已解除原操作记录，可以重新导出" : "已解除原操作记录，按这张单现在的状态处理", "success");
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
  const subject = (name: string) => <span className="a2-confirm-subject" title={name}>{shortCodes(name)}</span>;

  /** 本人、已退役、解析不了、有未确认操作、正在加载、读不到退款金额：入口先禁用并写原因（第五节）。没有业务权限的入口不显示（OP-124），这里只兜底。 */
  const decideBlock = (w: A2OperationRow, kind: "approve" | "reject" | "withdraw") => {
    if (submitting) return SUBMITTING;
    if (pendingTicketIds.has(w.id)) return PENDING_LOCK;
    if (mainLoading) return RELOADING;
    if (kind === "withdraw") return canWithdraw(w) ? undefined : NO_WITHDRAW;
    if (isMine(w)) return OWN_TICKET_REASON;
    if (kind === "approve" && oldPayoutTickets.current.has(w.id)) return F4_PAYOUT_REVIEW_REQUIRED;
    if (kind === "approve" && w.retiredOperation) return RETIRED_OPERATION_COPY;
    if (kind === "approve" && (w.phoneCalibrationError || w.ambassadorMaterialError)) return w.phoneCalibrationError ?? w.ambassadorMaterialError;
    if (!canDecide(w, kind)) return (kind === "approve" ? w.approveDeniedMessage : w.rejectDeniedMessage) ?? NO_DECIDE;
    if (kind === "approve" && w.operationCode === D5_APPROVAL_OP) {
      const block = d5Trc20ApprovalBlock(w.before, w.after);
      if (block) return d5Trc20Reason(block, false);
    }
    // 读不到退款金额时不能批准（协调人定，同 C3 读不到详情）；驳回不受影响。
    const amount = kind === "approve" ? refundAmount(w) : undefined;
    if (amount?.state === "loading") return "正在加载退款金额，读完再批准";
    if (amount && amount.state !== "ok") return REFUND_AMOUNT_REQUIRED;
    return kind === "approve" ? h5ApproveBlock(w) : undefined;
  };

  /** 已被别人处理（终态、状态变了）：框留着，写最新状态，确认按钮禁用（OP-97）。 */
  const staleReason = (w: A2OperationRow, kind: "approve" | "reject" | "withdraw", cause: unknown) => {
    if (!["A2_OPERATION_ALREADY_TERMINAL", "A2_WITHDRAW_STALE"].includes(backendCode(cause))) return undefined;
    const found = ticketStatus(mainRef.current, w.id);
    const now = found && found.status !== "pending" ? `「${HIST_LABEL[found.status] ?? found.status}」` : "已处理";
    return `这张单现在${found && found.status !== "pending" ? `是${now}` : now}，这次${DECISION_VERB[kind]}没有执行。关闭后看最新状态。`;
  };

  /** 对象一格：认得出的写运营的话，编号等宽跟在后面。配置键这类原文只在审批单详情底部的「技术信息」折叠里，这里和确认框都不放气泡（DT-22）。 */
  const objectNode = (w: A2OperationRow): ReactNode => {
    const fund = fundTicket(w);
    if (fund?.kind === "f5Status" && fund.eventId || fund?.kind === "f5Reverse" && fund.eventId) return <>奖励记录 <span data-mono className="a2-code">{fund.eventId}</span></>;
    if (fund?.kind === "f4Settle") return <>本周团队激励池<span className="rd-note">（按批准那一刻所在的周）</span></>;
    if (fund?.kind === "f4Payout" && fund.period) return fund.period;
    if (fund?.kind === "fConfig") return objectText(w);
    if (fund?.kind === "f5Suspension") return <>用户 <span data-mono className="a2-code">{fund.userId ? userCode(fund.userId) : "—"}</span> · {fund.kinds.length ? kindNames(fund.kinds) : "所选奖励"}</>;
    if (fund?.kind === "f5Reissue" && fund.ids.length) return fund.ids.length <= REISSUE_INLINE
      ? <>奖励记录 <span data-mono className="a2-code">{fund.ids.join("、")}</span></> : `${fund.ids.length} 笔奖励记录（记录号见下方）`;
    if (w.operationCode === "f_unilevel_bootstrap") return objectText(w);
    // 整组政策单（七层结算、好友奖励政策、首次配置等）后端写的对象是 current，不是运营要对照的编号。
    if (w.obj === "current" && !w.objDisplayName) {
      const object = objectText(w);
      return object === w.obj ? "当前设置" : object;
    }
    // 整批申请的对象是配置键清单或摘要，运营看不懂：写涉及的页面和项数，原文进技术信息。
    if (fBatchTicket(w)) return objectText(w);
    const ambassador = !w.objDisplayName && /^F\.ambassador\.(\d+)\.status$/.exec(w.obj);
    if (ambassador) return <>区域大使申请 <span data-mono className="a2-code">#{ambassador[1]}</span></>;
    if (w.operationCode === "j1_gate_resume") return j1GateName(w.obj);
    if (w.operationCode === "h3_mission_create") return <>任务 <span data-mono className="a2-code">{w.obj}</span></>;
    if (w.operationCode === "h3_quest_config" && h3ConfigName(w.obj)) return h3ConfigName(w.obj);
    // 收益记录号是 ER- 加 32 位，不能整串不换行：写全、允许在号里换行，框不出横向滚动。
    if (w.operationCode === "k1_earnings_release") return <>收益记录 <span data-mono className="a2-long-code">{w.obj}</span></>;
    // 发放单号带连字符，按正文写，在连字符处换行，不出横向滚动。
    if (w.operationCode === "f_reward_payout_action") return objectText(w);
    if (isGParamTicket(w)) return objectText(w);
    // 认得出的名字（商品名、账号名、参数名）按正文写；只有回落到原编号时才等宽（TX-28、VS-52）。「名字（编号）」只把编号等宽。
    const text = objectText(w);
    if (text === w.obj) return <span data-mono className="a2-code">{text}</span>;
    const code = `（${w.obj}）`;
    if (text.endsWith(code)) return <>{text.slice(0, -code.length)}（<span data-mono className="a2-code">{w.obj}</span>）</>;
    return text;
  };
  /** 补发两笔以上：逐笔读现在的样子，按申请单上的顺序列出（一笔时写在「这笔奖励」一行）。批准框里不折叠（flat，OP-151），抽屉里收在折叠里。 */
  const reissueList = (w: A2OperationRow, open = false, flat = false) => {
    const fund = fundTicket(w);
    if (fund?.kind !== "f5Reissue" || fund.ids.length < 2) return null;
    return <F5ReissueReadings ids={fund.ids} open={open} flat={flat} />;
  };

  /** 框里的关键信息：退款单第一行是退款金额（VS-102）。动作名在标题下面，这里不再写「操作」，单号只写一次（建议 8）。 */
  const ticketFacts = (w: A2OperationRow, kind: "approve" | "reject", lead?: ReactNode) => {
    const amount = refundAmount(w);
    const name = kind === "approve" ? "退款金额" : "申请退款金额";
    const timing = kind === "approve" ? g3PolicyExecutionTiming(w, true) ?? phoneScheduledAt(w) : undefined;
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
        {/* 批准框和详情的判断要点同一个样子：理由一行，谁发起的写在下面一行弱字（OP-69、DT-22）；这一行不用「 · 」，值里不像拼起来的几条记录（VS-109）。 */}
        {kind === "approve"
          ? <Fact k="发起理由">{keepCodes(w.reason)}<span className="a2-fact-by">{`${w.operator}（${roleText(w.operatorRole)}）发起`}</span></Fact>
          : <Fact k="发起人">{`${w.operator} · ${roleText(w.operatorRole)}`}</Fact>}
        {kind === "approve" && ticketPermissionText(w) && <>
          <Fact k="谁来批">{approvalExecutorLabel(w)}</Fact>
          <Fact k="需有权限">{ticketPermissionText(w)}{w.ambassadorMaterialProposal?.applicationDecision === "APPROVE" && "。不能核验过这一版材料。"}</Fact>
        </>}
        {timing && <Fact k="生效时间">{timing}</Fact>}
      </Facts>
    );
  };

  /**
   * F4 派奖、F4 本周结算、F5 奖励状态变更的批准框：先写这一次批的是什么、批准后会怎样，再放这一次的结果，规则收进折叠。
   * 句子和发起人那边（f4-confirmations、f5-audit）同一套说法；没有的事实不写；F5 单子里没有用户和金额，按记录号读现在的样子（a2-f5-current）。
   */
  type FundSpec = { irreversible: boolean; impact: string; completion?: string; check: string; detail: string;
    coverageCheck?: string; facts?: ReactNode; lead?: ReactNode; review?: boolean; extra?: ReactNode };
  const fundSpec = (w: A2OperationRow, onPayoutStateChange?: (settled: boolean, paused?: boolean) => void): FundSpec | undefined => {
    const fund = fundTicket(w);
    if (!fund) return undefined;
    // 影响句、后果句和覆盖率说明与 F4 发起框同一套（OP-69）；覆盖率说明只在问号里写一次（DT-12）。
    if (fund.kind === "f4Payout") return {
      irreversible: true,
      impact: fund.period === "总榜" ? F4_PAYOUT_IMPACT : "名单和金额以批准那一刻的排行榜为准。",
      check: "核对预计发放、名单和发起理由，理由写清依据或工单号。",
      detail: "奖池为 0 或没人上榜时不发钱。按旧规则提交的单须先撤回或驳回，再看新预览后重新提交。",
      coverageCheck: `${fund.period === "总榜" ? F4_PAYOUT_COVERAGE : F4_COVERAGE_COPY}${F4_COVERAGE_NEXT}`,
      facts: undefined,
      // 只有总榜的预览接口能按单子里的信息读到；别的榜要哪一期，单子里没有。
      lead: fund.period === "总榜" ? <F4PayoutPreviewFacts approving rules onPayoutStateChange={onPayoutStateChange} /> : undefined,
    };
    if (fund.kind === "f4Settle") return {
      irreversible: true,
      impact: F4_SETTLE_IMPACT,
      check: "核对本周奖池和发起理由，理由写清依据或工单号。",
      detail: "没有合格票时不发钱。",
      coverageCheck: `${F4_SETTLE_COVERAGE}${F4_COVERAGE_NEXT}`,
      facts: undefined,
      lead: <F4SettleFacts onSettlementChange={onPayoutStateChange} />,
    };
    if (fund.kind === "fConfig") {
      const item = fund.spec;
      const cover = w.amplifies ? coverageFacts(w) : undefined;
      const [shownFrom, shownTo] = a2Pair(fund.key, changeBefore(w), changeAfter(w));
      const change = <Fact k={item ? item.item : "这一项"}><Change from={shownFrom} to={shownTo} /></Fact>;
      return {
        irreversible: false,
        impact: item?.impact ?? "批准后立即改这项设置，失败不改原值。",
        completion: cover?.check,
        check: "核对修改前后的值和发起理由，理由写清依据或工单号。",
        detail: item?.detail ? `${item.detail}` : item ? "" : "这一项在团队相关页面上找不到，原配置键在审批单详情底部的「技术信息」里。",
        coverageCheck: cover?.check,
        // 一组值（各榜奖池、头衔、门槛）逐项比，放「完整变更内容」；单个值一行写在事实区。
        facts: item?.json ? undefined : change,
        extra: f2RateLevel(fund) && <F2LayerLimitNotice key={w.id} level={f2RateLevel(fund)!} after={w.after} />,
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
        coverageCheck: undefined,
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
        coverageCheck: cover?.check,
        facts: <>
          {fund.ids.length === 1 && <F5CurrentFact id={fund.ids[0]} />}
          <Fact k="补发后"><F5ReissueOutcome ids={fund.ids} /></Fact>
          <Fact k="能不能撤回">不能；新记录可以再冲正</Fact>
        </>,
        lead: undefined,
        extra: reissueList(w, true, true),
      };
    }
    if (fund.kind === "f5Reverse") return {
      irreversible: true,
      impact: "批准后收回这笔奖励。",
      completion: undefined,
      check: "核对这笔奖励和发起理由，理由写清收回的原因。",
      detail: "余额不足时，结算组奖励和等级月薪扣不够的部分记为待追回。其余没有结算组的旧奖励整次冲正失败。",
      coverageCheck: undefined,
      facts: <>{fund.eventId && <F5CurrentFact id={fund.eventId} />}<Fact k="状态"><Change from={changeBefore(w)} to="按收回结果显示" /></Fact><Fact k="凭证单号">申请单里没有，批准时系统再核对</Fact></>,
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
      coverageCheck: undefined,
      facts: state,
      lead: undefined,
    };
    return undefined;
  };

  const approveRequest = (w: A2OperationRow): A4ActionConfirmReq => {
    const name = approvalActionName(w);
    const f4Payout = w.operationCode === "f4_pool_settle" || w.operationCode === "f4_leaderboard_period_payout";
    const draftKey = `${session?.adminId}:${w.id}`;
    const v8Promotion = isV8PromotionTicket(w);
    const coverageMode = approvalCoverageMode(w);
    const amplifies = coverageMode === "amplifies";
    const requiresH5ApprovalCoverage = w.operationCode === "h5_power_up_config" && !!coverageMode;
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
    const impact = v8Promotion ? "立即升到 V8，首次到达按配置发奖。"
      : scheduled || monthlyTargetChange(w) ? timing.impact
      : j4 ? "逐步执行，失败时可能只执行了一部分。"
        // 新增商品批准后只是草稿（显示规则 5）；覆盖率检查提示另在事实区。
        : w.operationCode === "e1_sku_create" ? "批准后创建商品草稿，上架前 App / H5 Lite 上看不到。"
        : coverageMode === "onApproval" ? "先查兑付覆盖率，够了才执行，不够不动。"
          : g3 ? "按生效时间执行，改线上配置。"
            // 发布只封存这一版，用户看哪版由 I5 的生效版本决定（i5-disclosures 发布框同一说法）。
            : i5Publish ? "用户看到的版本不变，生效版本另行审批。"
            // F1 奖励发放按奖励类型影响不同（商品、自定义奖励不动钱），实际影响写在改动里。
            : w.operationCode === "f_reward_payout_action" ? "立即执行，影响见改动；失败不改原值。"
            : w.operationCode === "h5_power_up_config" && h5PowerUpAmplifies(w) === false ? "立即执行，改成长权益设置；失败不改原值。"
            : isFunds ? "立即执行，改资金或账目；失败不改原值。"
              : a1StatusImpact(w) ? a1StatusImpact(w)!.short
              : w.type === "acct" ? "立即执行，改账号或权限；失败不改原值。"
                : w.type === "sos" ? "立即执行，停用或恢复业务；失败不改原值。"
                  : "立即执行，改线上配置；失败不改原值。";
    const e1Display = scheduled ? "" : e1DisplayChange(w);
    const shownImpact = !e1Display ? impact : e1Display.endsWith("设备不变。") ? e1Display : `${impact}${e1Display}`;
    const check = isRefund ? "核对退款金额、订单和发起理由，理由写清依据或工单号。"
      : isFunds ? "核对对象、变更前后和发起理由，理由写清依据或工单号。"
        : w.type === "acct" ? "核对目标账号、申请的角色和发起理由，理由写清依据或工单号。"
          : w.type === "sos" ? "核对值班授权、影响范围和恢复条件，理由写清依据或工单号。"
            : i5Publish || w.operationCode === "i5_matrix_configure" ? "核对这次披露改了什么，理由写清版本依据。"
            : "核对修改前后的值和影响范围，理由写清依据或工单号。";
    const k1 = k1TicketView(w);
    const k1Spec: FundSpec | undefined = k1 && (k1.kind === "release" ? {
      irreversible: true,
      impact: "批准后这笔收益放行，钱不再锁住。",
      check: "核对用户、净额、来源和发起理由，理由写清依据或工单号。",
      detail: "只放行这一笔，不另发奖、不生成提现单。",
      coverageCheck: K1_APPROVAL_CHECK.release,
      facts: <K1TicketFacts v={k1} />,
    } : {
      irreversible: false,
      impact: k1.key === "duplicateAccountFreezeFrom" ? "批准后新值生效，已有余额可能恢复提现。" : "批准后新值生效，可能增加可提现收益。",
      check: "核对修改前后的值和发起理由，理由写清依据或工单号。",
      detail: "",
      coverageCheck: K1_APPROVAL_CHECK.param,
      facts: <K1TicketFacts v={k1} />,
    });
    // F2 首次配置：七层逐行列出后端写在单上的数，不显示原文的修改前后。
    const boot = w.operationCode === "f_unilevel_bootstrap" ? parseF2BootstrapAfter(w.after) : undefined;
    const rankedBootstrap = f2BootstrapUsesRank(boot?.[0]?.usdtPct, boot?.[1]?.usdtPct);
    const bootSpec: FundSpec | undefined = boot && {
      irreversible: false,
      impact: "批准后七层规则一次建好；整体结算不会自动启用。",
      check: "逐层核对下表和发起理由，理由写清依据或工单号。",
      detail: "七层都没有规则时才能执行，以前配置过的会被拒。",
      coverageCheck: "批准时先查兑付覆盖率：低于红线就不建规则，审批单留着待审批。",
      facts: <><Fact k="要建立">L1–L7 七层规则</Fact>{rankedBootstrap && <Fact k="七层合计占订单">第 1、2 层按受益人等级</Fact>}<Fact k="整体结算">不会自动启用，要另外申请</Fact></>,
      extra: <F2BootstrapReview rows={boot} label="要建立的七层规则" ranked={rankedBootstrap ? null : undefined} limitCopy={F2_LIMIT_APPROVE_COPY} />,
    };
    const belowRedline = !!coverage && (coverage.redlineBreached === true || coverage.coverageRatio < coverage.redlinePct);
    const coverageBlock = !requiresH5ApprovalCoverage && amplifies && belowRedline
      ? "兑付覆盖率低于红线，现在不能批准；恢复后再批，或驳回。" : undefined;
    const blockAfterWrite = (approvalWriteBlock: string) => {
      openActionConfirm(current => current?.run === request.run ? { ...current, approvalWriteBlock } : current);
    };
    const fund = fundSpec(w, (settled, paused) => {
      // The modal and its coverage gate use the same read. Ignore a result after this confirmation has closed.
      const blockedReason = paused ? F4_PAYOUT_APPROVAL_PAUSED
        : oldPayoutTickets.current.has(w.id) ? F4_PAYOUT_REVIEW_REQUIRED : settled ? undefined : coverageBlock;
      openActionConfirm(current => current?.run === request.run && !current.approvalWriteBlock && current.blockedReason !== blockedReason
        ? { ...current, blockedReason } : current);
    }) ?? k1Spec ?? bootSpec;
    const request: A4ActionConfirmReq = {
      briefKind,
      title: "批准审批单",
      action: <>确认执行 · {w.id}({name})</>,
      effect: <>{subject(name)}<StatusTag tone="progress" filled>{timing.tag}</StatusTag>{(isRefund || fund?.irreversible) && <IrreversibleTag />}</>,
      detail: fund ? <>{fund.detail}{!ticketPermissionText(w) && `谁能批准：${approvalExecutorLabel(w)}。`}</> : j4
        ? <>中途失败时，前面的步骤可能已经生效。到「监管要求应急处理」的执行追溯里核对每一步。谁能批准：{approvalExecutorLabel(w)}。</>
        : coverageMode === "onApproval" ? <>{timing.note}{approvalCoverageCopy(w)}</> : <>{a1StatusImpact(w)?.detail}{timing.note}{!ticketPermissionText(w) && `谁能批准：${approvalExecutorLabel(w)}。`}{decisionRule(w).backendChecks && backendChecksText("批准时", "。")}</>,
      completionCopy: fund?.completion,
      // 派奖、结算：这一次的结果放在关键信息层（和发起人那边同一块），审批单信息放在后面。
      facts: fund?.lead ?? ticketFacts(w, "approve", fund?.facts),
      content: fund?.lead ? <div className="rd-confirm-facts">{ticketFacts(w, "approve")}</div> : fund?.facts && !fund.review ? fund.extra ?? undefined : (
        <div className="rd-stack">
          {fund?.extra}
          {fBatchTicket(w)?.items ? <A2BatchReview items={fBatchTicket(w)!.items!} />
            : isRoleGrantsTicket(w)
            ? <A2RoleGrantsChange limit={4} review={w.roleGrantsReview} fallback={<A2ChangeReview operationCode={reviewOperation(w)} amountKey={a2TicketKey(w)} before={changeBefore(w)} after={changeAfter(w)} />} />
            : <A2ChangeReview operationCode={reviewOperation(w)} amountKey={a2TicketKey(w)} {...approvalReviewValues(w)} omit={g3 ? ["生效时间"] : undefined}
                facts={v8Promotion ? v8PromotionFacts(w) : f1VoucherReverse(w) && <Fact k="批准后">{f1VoucherReverse(w)!.impact}</Fact>}>
                {/* I5 发布、设置／切换生效版本：列表上直接批准也看同一份对照，和详情抽屉一样（BUG-503）。 */}
                <A2I5DisclosureReview key={w.id} ticket={w} />
              </A2ChangeReview>}
          {w.phoneCalibrationProposal && <PhoneCalibrationReview proposal={w.phoneCalibrationProposal} />}
          {w.ambassadorMaterialProposal && <AmbassadorMaterialSummary packet={w.ambassadorMaterialProposal} expectedMaterialRevision={w.ambassadorMaterialProposal.applicationDecision === "APPROVE" ? w.ambassadorMaterialProposal.expectedMaterialRevision : undefined} />}
          {isRefund && w.refundOrderNo && <PromotionRefundImpact orderNo={w.refundOrderNo} />}
        </div>
      ),
      statedBrief: fund ? { impact: fund.impact, check: fund.check } : { impact: shownImpact, check },
      amplifies,
      // 有覆盖率时事实区写「兑付覆盖率 X，红线 Y」，多付钱和检查时点进问号；读不到时橙黄写出来，不是一句白字（必须改 12）。
      // 低于红线时共用框写的是发起人的话（「暂时不能提交」）：这里不把读数交给共用框，自己写读数和批准人的话，按钮照样禁用。
      coverage: amplifies && !belowRedline ? coverage : undefined,
      // 低于红线时覆盖率照旧写在这一行，资金后果仍是同一句，不被覆盖率顶掉（DT-10、DT-14）。
      coverageLead: amplifies && belowRedline ? <span className="a2-coverage-unknown">{`${fundLead(w)}。`}兑付覆盖率 {fmtPct(coverage.coverageRatio)}，低于红线 {fmtConfigPct(coverage.redlinePct)}</span>
        : amplifies && !coverage ? <span className="a2-coverage-unknown">{`${fundLead(w)}，兑付覆盖率暂时读不到`}</span> : fundLead(w),
      coverageCheck: v8Promotion ? undefined : fund?.coverageCheck ?? coverageFacts(w)?.check ?? PAGE_COVERAGE_COPY,
      requiresH5ApprovalCoverage,
      blockedReason: oldPayoutTickets.current.has(w.id) ? F4_PAYOUT_REVIEW_REQUIRED : coverageBlock,
      initialReason: f4Payout ? refusedPayoutReasons.current.get(draftKey) : undefined,
      reasonMin,
      reasonMax: 200,
      confirmLabel: "确认批准",
      // 直接动钱的确认用红（决定 50）。
      confirmTone: w.amplifies || isRefund ? "danger" : "primary",
      run: async (reason) => {
        if (f4Payout) refusedPayoutReasons.current.delete(draftKey);
        if (oldPayoutTickets.current.has(w.id)) throw new Error(F4_PAYOUT_REVIEW_REQUIRED);
        const block = w.operationCode === D5_APPROVAL_OP ? d5Trc20ApprovalBlock(w.before, w.after) : undefined;
        if (block) throw new Error(d5Trc20Reason(block, false));
        try {
          const { outcome, businessResult } = await runDecision("approve", w, reason);
          if (outcome === "ok") {
            if (businessResult) toast(`${w.id} 已批准，${f4ApprovalResultText(businessResult)}`, businessResult.status === "NOT_EXECUTED" ? "info" : "success");
            else decisionToast("approve", w.id);
            setTicketId(null);
          }
        } catch (cause) {
          const code = cause instanceof F4ApprovalBlockedError ? cause.result.reasonCode : backendCode(cause);
          if (f4Payout && (code === "F4_LEADERBOARD_PAUSED" || code === "COVERAGE_BELOW_REDLINE")) {
            refusedPayoutReasons.current.set(draftKey, reason);
            blockAfterWrite(f4BlockedText(code));
            if (code === "COVERAGE_BELOW_REDLINE") await refreshCoverage();
            return false;
          }
          if (w.operationCode === "f4_leaderboard_period_payout" && backendCode(cause) === "F4_LEADERBOARD_PAYOUT_REVIEW_REQUIRED") {
            openActionConfirm(approveRequest(w));
            throw new Error(F4_PAYOUT_REVIEW_REQUIRED);
          }
          const stale = staleReason(w, "approve", cause);
          if (stale) {
            blockAfterWrite(stale);
            return false;
          }
          // 共用的说法对直接编辑、演练都成立；审批这里还要写下一步（M8）。
          if (backendCode(cause) === "J4_PLAYBOOK_NOT_FOUND") throw new Error("应急预案不存在，可能已被删除，这张单不能批准。请驳回后按最新的预案重新发起。");
          const refused = approvalRefusedText(w.operationCode, backendCode(cause));
          if (refused) throw new Error(refused);
          const denied = decisionDeniedText("approve", cause);
          if (denied) throw new Error(denied);
          throw cause;
        }
      },
    };
    return request;
  };

  /** 驳回只是不执行，业务什么都没变，还能重新发起：不标「不能撤销」，不用红（必须改 2，VS-106、VS-107）。 */
  const rejectRequest = (w: A2OperationRow): ActionConfirmReq => ({
    briefKind: "record",
    title: "驳回审批单",
    action: <>取消执行 · {w.id} · {w.operationCode === "j1_gate_resume" ? actionName(w) : a2ActionText(w.action)}</>,
    effect: <>{subject(actionName(w))}{immediate}</>,
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
        const { outcome } = await runDecision("reject", w, reason);
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
    effect: <>{subject(actionName(w))}{immediate}</>,
    detail: <>撤回后原操作不会执行。只有申请人本人能撤回。</>,
    facts: <Facts><Fact k="审批单"><span data-mono>{w.id}</span></Fact><Fact k="对象">{objectNode(w)}</Fact></Facts>,
    statedBrief: { impact: "改为已撤回，原操作不执行。", check: "理由写清撤回原因或工单号。" },
    amplifies: false,
    reasonMin,
    reasonMax: 200,
    confirmLabel: "确认撤回",
    run: async (reason) => {
      try {
        const { outcome } = await runDecision("withdraw", w, reason);
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
    label: key === "domain" ? `模块：${DOMAIN_NAMES[appliedFilter.domain as A2AuditDomain]}` : `${FILTER_LABEL[key]}：${auditFilterValue(key, appliedFilter[key])}`,
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
      已按「{appliedText({ ...enteredFilter, action: auditFilterValue("action", enteredFilter.action) })}」筛选。
      {locatePending.length === 1 && <> 这个对象还有 1 条待审批 · <button type="button" className="rd-link" onClick={() => openTicketFromRecords(locatePending[0].id)}>打开审批单</button></>}
      {locatePending.length > 1 && <> 这个对象还有 {locatePending.length} 条待审批：{locatePending.slice(0, 3).map((w, index) => <span key={w.id}>{index > 0 && "、"}<button type="button" className="rd-link" onClick={() => openTicketFromRecords(w.id)}>{actionName(w)} {w.id}</button></span>)}{locatePending.length > 3 && " 等"}</>}
    </Notice>
  );

  /* ────────────────── 渲染 ────────────────── */

  const pendingCount = main ? main.stats.pendingTickets : "—";
  const copyId = (value: string) => {
    void navigator.clipboard?.writeText(value).then(() => toast("已复制审批单号", "success"), () => toast("复制失败，请手动选择单号", "error"));
  };

  // 结果未知的决定收成一个面板：每条一行，细节点开看，默认露三条（提示不能盖住正事）。
  const pendingItems: RecoveryItem[] = pendingCommands.map((record) => {
    const expired = isRetryExpired(record);
    const amount = retryAmount(record);
    const note = pendingNotes[record.fingerprint];
    const check = note?.check ? DECISION_CHECK[note.check] : undefined;
    const sealed = record.kind === "approve" && (record.operationCode === "i5_disclosure_publish" || record.operationCode === "i4_disclosure_publish");
    const d5Block = d5RetryBlock(record);
    return {
      key: record.fingerprint, object: record.label, createdAt: record.createdAt,
      tag: <StatusTag tone="warn">结果未知</StatusTag>,
      line: `${sealed ? "这版可能已经封存" : "可能已经生效"}。${expired ? RETRY_EXPIRED : d5Block ? `${d5Block}。点「查询原操作」看这次批准执行没有，或点「在操作记录里查看」。` : RECOVERY_HINT[record.kind]}`,
      result: note ? { tag: check ? <StatusTag tone={check.tone} icon={check.icon}>{check.label}</StatusTag> : <StatusTag tone="warn">结果未知</StatusTag>, line: note.text } : undefined,
      // 查询的回答已在 result 里替换这一行的结论；noteKey 只让回答变了时自动展开，不在展开内容里再写一遍。
      noteKey: note?.text,
      actions: <>
        <Button size="sm" disabled={!!submitting} onClick={() => void verifyPending(record)}>{record.kind === "param" ? "读取当前值" : record.kind === "retention" ? "读取最近清理" : "查询原操作"}</Button>
        <Button size="sm" disabled={!!submitting} disabledReason={retryBlock(record)} onClick={() => void retryPending(record)}>按原操作重试</Button>
        {retryRejected.includes(record.commandKey) && <Button size="sm" disabled={!!submitting} onClick={() => setReleasing(record)}>核实后解除</Button>}
      </>,
      detail: <>
        <p>理由：{record.reason}</p>
        {amount && <p>退款金额 {amount.state === "ok" ? <b className="a2-amount">{refundAmountText(amount)}</b> : <span className="a2-warn-text">{refundAmountText(amount)}</span>}
          {amount.state === "error" && recordOrderNo(record) && <> <InlineRetry onRetry={() => void loadMain()} /></>}</p>}
        {/* 只有批准会再核对业务权限；这类单驳回、撤回时后端不核对（AuditReplayBusinessPermissionGuard.validateDecisionPermission）。 */}
        {record.kind === "approve" && recordRule(record).backendChecks && <p>{backendChecksText("批准时", "。")}</p>}
        <p><Button size="sm" variant="ghost" onClick={() => showInRecords(record)}>在操作记录里查看</Button></p>
      </>,
      tech: <Fold inset title="技术信息" summary="操作编号、操作人">
        <Facts><Fact k="操作编号"><span data-mono className="a2-long-code">{record.commandKey}</span></Fact><Fact k="操作人">{record.operator}</Fact></Facts>
      </Fold>,
    };
  });
  const pendingNotices = <RecoveryPanel title={recoveryTitle(pendingItems.length)} items={pendingItems}
    explain="有结论前不要重复处理这几张单。点行首的箭头看理由和操作编号。" />;

  /* 待审批：行内按钮都是小号次按钮，点了只开确认框（D2 新手测试）。整屏主按钮只有抽屉里的「批准」（DP-40）。
     没有这张单的业务权限时不显示批准、驳回（OP-124）；整页一行都没有可做的事时不画「操作」列（建议 3）。 */
  const rowCanAct = (w: A2OperationRow) => isMine(w) ? canWithdraw(w) : canDecide(w, "reject") || (!w.retiredOperation && canDecide(w, "approve"));
  const rowActions = (w: A2OperationRow) => {
    // 自己发起的单：有批准权的照样看到批准、驳回，禁用并写原因（OP-66，同抽屉）；行上最多露两个，驳回进「更多」，原因写在那一项下面（OP-05、OP-126）。
    if (isMine(w) && canWithdraw(w)) {
      const withdraw = <Button size="sm" disabledReason={decideBlock(w, "withdraw")} onClick={() => confirmDecision(w, "withdraw")}>撤回我的申请</Button>;
      if (!canApprove) return withdraw;
      // 批准、驳回灰着的原因在动作区常显一次，不只在按钮提示里（OP-126、OP-66）；布局不变：露两项，驳回在「更多」里。
      return <span className="a2-own-actions">
        <span className="rd-row-actions">
          {withdraw}
          <Button size="sm" disabledReason={decideBlock(w, "approve")} onClick={() => confirmDecision(w, "approve")}>批准</Button>
          <MoreMenu items={[{ key: "reject", label: "驳回", disabledReason: decideBlock(w, "reject"), onSelect: () => confirmDecision(w, "reject") }]} />
        </span>
        <span className="a2-own-reason">{OWN_TICKET_REASON}</span>
      </span>;
    }
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
    const amplifies = (w.operationCode === "h5_power_up_config" ? h5PowerUpAmplifies(w) : undefined) ?? w.amplifies;
    const tags = <>
      {pendingTicketIds.has(w.id) && <StatusTag tone="warn" explain={PENDING_LOCK}>结果未知</StatusTag>}
      {w.sos && <StatusTag tone="danger" icon={Siren}>应急</StatusTag>}
      {amplifies && (enablesAutoPayout(fundTicket(w)) ? <StatusTag tone="warn" icon={Coins}>批准时查覆盖率</StatusTag> : <StatusTag tone="warn" icon={Flame}>多付钱</StatusTag>)}
      {/* 覆盖率挡住批准：行里标「暂不能批准」，完整原因和下一步常显在列表上方（OP-126）。 */}
      {canDecide(w, "approve") && h5ApproveBlock(w) && <StatusTag tone="warn">暂不能批准</StatusTag>}
    </>;
    return w.sos || amplifies || pendingTicketIds.has(w.id) ? <span className="rd-row-actions">{tags}</span> : TYPE_NAME[w.type];
  };

  // 重试读到后焦点落在这一块的标题「待审批」页签上（BUG-677）。
  const pendingTitle = { get current() { return document.getElementById(tabIds.panel("pending")["aria-labelledby"]); } };
  const pendingTab = (
    <>
      {mainError && !main ? (
        <BlockState state="error" title="审批单加载失败，不显示旧数据" detail={mainError} onRetry={() => void loadMain().catch(() => undefined)} retrying={mainLoading} afterRetryFocus={pendingTitle} />
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

        {h5CoverageBlock && qPageRows.some(w => canDecide(w, "approve") && h5ApproveBlock(w)) && <Notice tone="warn">签到倍率提前解锁或调高倍率的单：{h5CoverageBlock}</Notice>}
        <Panel flush icon={ClipboardList} tone="role-3" title="待审批的操作" explain="应急在前，资金类其次，其余按提交时间从新到旧。">
          {/* 对象不单列：写在「审批单」格第二行，弱化；动作名里已有的不重复，认不出、原样是系统键的不上列表，抽屉和确认框里常显（ST-04、DP-13、DP-30）。 */}
          <Table label="待审批的操作" className="a2-queue" data-tight="">
            <thead><tr>
              <Th sticky="start">审批单</Th>
              <Th>变更</Th>
              <Th icon={Users} tone="users">发起人</Th>
              <Th fit={!showActions}>标记</Th>
              {showActions && <Th sticky="end" fit>操作</Th>}
            </tr></thead>
            <tbody>
              {!main && mainLoading ? <TableLoading columns={queueColumns} rows={5} />
                : qPageRows.length === 0 ? (
                  <TableMessage columns={queueColumns} role="status">
                    {queueFiltered ? <>没有符合条件的待审批操作 <Button size="sm" onClick={() => { setQType("all"); setQOperator("all"); setQPage(1); }}>清除筛选</Button></> : "没有待审批的操作"}
                  </TableMessage>
                ) : qPageRows.map((w) => {
                  const change = approvalQueueChange(w);
                  const { action: name, object } = approvalTitleParts(w);
                  // 和首页、消息中心同一个判断（approvalChangeSummary）；objectText 认不出时原样返回系统键（current、配置键），这种不写。
                  const showObject = approvalShownObject(w);
                  return (
                    <Tr key={w.id} selected={w.id === ticketId} onOpen={() => { if (!submitting) setTicketId(w.id); }}>
                      <Td sticky="start"><Cell main={name} sub={showObject ? object : undefined} title={`${name}\n对象：${object || "—"}\n${w.id} · ${bizTime(w.rawTs, w.ts)}（${zone}）${isH7VoucherApproval(w.operationCode) ? `\n谁能批准：${approvalExecutorLabel(w)}` : ""}`} /></Td>
                      <Td><Cell main={change.main} sub={change.sub} title={change.title ?? `${change.main}${change.sub ? `\n${change.sub}` : ""}`} /></Td>
                      <Td><Cell main={w.operator} sub={`${roleText(w.operatorRole)}${isMine(w) ? " · 你发起的" : ""}`} /></Td>
                      {/* 上次被挡下的原因常显；时间在悬停提示里，完整时间在详情（ST-04、TX-25）。 */}
                      <Td fit={!showActions}><Cell main={markers(w)} sub={w.lastApprovalAttemptResult ? `上次批准没有执行：${f4ResultReason(w.lastApprovalAttemptResult)}`
                        : w.f4ResultUnreadable ? F4_RESULT_UNREADABLE : w.retiredOperation ? <StatusTag tone="done">已退役</StatusTag> : undefined}
                        title={w.lastApprovalAttemptResult ? `上次批准没有执行：${f4ResultReason(w.lastApprovalAttemptResult)}\n${bizTime(w.lastApprovalAttemptResult.attemptedAt, "—")}（${zone}）`
                          : w.f4ResultUnreadable ? F4_RESULT_UNREADABLE : undefined} /></Td>
                      {showActions && <Td sticky="end" fit><span className="rd-row-actions">{rowActions(w)}</span></Td>}
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
                  const act = logActionShown(l);
                  const obj = logObject(l);
                  const e1Approved = e1ApprovedLog(l, e1Proposals);
                  const e1Sides = e1SkuLogSides(l) ?? e1Approved?.sides;
                  const e1Change = e1Sides && changeSummary(e1Sides.before, e1Sides.after, [], e1Sides.operationCode);
                  const deltaText = logDeltaText(l);
                  return (
                    <Tr key={l.id} selected={l.id === logId} onOpen={() => setLogId(l.id)}>
                      <Td sticky="start"><Cell num main={thisYear(logTime(l))} title={logTime(l)} /></Td>
                      <Td><Cell main={middle(l.actor, 16)} sub={logRoleText(l.role) || undefined} title={l.actor} /></Td>
                      <Td><Cell main={act.text} title={act.raw ? `${act.text}（原始动作码在详情的技术信息里）` : act.text} /></Td>
                      <Td>{fBatchLogItems(l) || F_BATCH_DIGEST.test(l.obj) ? <Cell main="整批调整的团队参数" title={l.obj} />
                        : obj.id ? <Cell main={obj.id.length > 16 ? `${obj.id.slice(0, 8)}…${obj.id.slice(-6)}` : obj.id} sub={obj.kind} title={[obj.kind, obj.id].filter(Boolean).join(" · ")} />
                          : <Cell main={obj.kind} title={obj.kind} />}</Td>
                      <Td grow>{fBatchLogItems(l) ? <Cell main={fBatchSummary(fBatchLogItems(l)!)} title={l.delta} /> : e1Change ? <Cell main={e1Change.main} sub={e1Change.sub} title={e1Change.main} /> : e1Approved?.price ? <Cell main={e1Approved.price} sub={E1_PRICE_ONLY} title={e1Approved.price} /> : <Cell mono main={deltaText} title={deltaText} />}</Td>
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
                ) : histPageRows.map((h) => {
                  const resultText = f4ResultTexts.get(h.id);
                  const status = <StatusTag tone={HIST_TONE[h.st] ?? "done"}>{HIST_LABEL[h.st] ?? h.st}</StatusTag>;
                  return <Tr key={h.id} selected={h.id === historyId} onOpen={() => setHistoryId(h.id)}>
                    <Td sticky="start"><Cell mono full main={h.id} /></Td>
                    <Td grow><Cell main={actionName(h)} title={actionName(h)} /></Td>
                    <Td>{resultText ? <Cell main={status} sub={resultText} title={resultText} /> : status}</Td>
                    <Td><Cell main={historyActorText(h.chain)} /></Td>
                    <Td><Cell num main={thisYear(bizTime(h.t, h.t))} title={bizTime(h.t, h.t)} /></Td>
                  </Tr>;
                })}
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
    <BlockState retryKey="a2-audit-3198" state="error" title="机制设置加载失败，不显示旧数据" detail={mainError} onRetry={() => void loadMain().catch(() => undefined)} retrying={mainLoading} />
  ) : !main ? (
    <BlockState state="loading" title="正在加载机制设置…" />
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
          <BlockState retryKey="a2-audit-3231" compact state="error" title={`清理范围加载失败，暂不能清理：${retentionPreviewError}`} onRetry={() => void refreshRetentionPreview()} retrying={retentionLoading} />
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
  const shownTiming = shown ? g3PolicyExecutionTiming(shown, true) ?? phoneScheduledAt(shown) : undefined;
  const shownAmount = shown ? refundAmount(shown) : undefined;
  const shownCanApprove = shown ? canDecide(shown, "approve") : false;
  const shownF5Ids = shown ? f5RecordIds(fundTicket(shown)) : [];
  const shownCanReject = shown ? canDecide(shown, "reject") : false;
  // 有结果未确认的操作时抽屉顶上已有一条提示，这里不再写一遍（DT-12）。
  // D5 单会打开 TRC20 或改它的确认费：不能批准的原因常显在判断要点里（OP-126），不只在按钮提示里。
  const shownD5Trc20 = shown?.operationCode === D5_APPROVAL_OP ? d5Trc20ApprovalBlock(shown.before, shown.after) : undefined;
  const shownD5Block = shownD5Trc20 && d5Trc20Reason(shownD5Trc20, false);
  const shownBlock = shown && (pendingTicketIds.has(shown.id) ? undefined
    : shown.retiredOperation ? RETIRED_OPERATION_COPY
      : shown.phoneCalibrationError ?? shown.ambassadorMaterialError
        ?? (isMine(shown) ? OWN_TICKET_REASON : !shownCanApprove ? shown.approveDeniedMessage ?? NO_DECIDE
          : shownAmount && shownAmount.state !== "ok" && shownAmount.state !== "loading" ? REFUND_AMOUNT_REQUIRED : shownD5Block ?? h5ApproveBlock(shown)));
  const shownK1 = shown ? k1TicketView(shown) : undefined;
  const shownA1Impact = shown ? a1StatusImpact(shown) : undefined;
  const shownTitle = shown ? approvalTitleParts(shown) : undefined;
  const shownBoot = shown?.operationCode === "f_unilevel_bootstrap" ? parseF2BootstrapAfter(shown.after) : undefined;
  // 改值类单：判断要点直接写第一项的「原值 → 新值」，多项写「等 N 项」，完整变更留在下面（OP-149）。
  // 提现参数和账号启停有逐项的前后值；其余用队列同一句（新值一行、原值一行），队列写不出原值时不加这一行。K1 自己有「改动」。
  const shownFacts = shown && !shownK1 ? approvalDisplayChanges(shown) : undefined;
  const shownFirst = shownFacts?.facts[0];
  const shownQueue = shown && !shownK1 && shownFacts === undefined ? approvalQueueChange(shown) : undefined;
  const shownChange: JudgmentRow | undefined = shownFacts === null ? { label: "改动", state: "warn", value: CHANGE_UNAVAILABLE }
    : shownFacts && shownFirst ? { label: "改动", value: <>{shownFirst.label} <Change from={shownFirst.before} to={shownFirst.after} />{shownFacts.facts.length > 1 && ` 等 ${shownFacts.facts.length} 项`}{shownFacts.forced && " · 强制保存倒挂价"}</> }
      : shownQueue?.sub?.startsWith("原 ") && shownQueue.sub !== "原 见详情" ? { label: "改动", value: shownQueue.main, reason: shownQueue.sub } : undefined;
  const judgment: JudgmentRow[] = shown ? [
    // 批准退款是直接出钱、收不回的操作，第一行就是这笔钱（必须改 1，DP-03）。
    ...(shownAmount ? [shownAmount.state === "ok"
      ? { label: "退款金额", value: <span className="a2-amount">{orderAmount(shownAmount.amount)} USDT</span> }
      : { label: "退款金额", state: "warn" as const, value: <>{refundAmountText(shownAmount)}{" "}{shownAmount.state === "error" && shown.refundOrderNo && <InlineRetry onRetry={() => void loadMain()} />}</> }] : []),
    // 动作名里已带对象（A1「停用账号 · 账号名」）时这里只写动作，对象在下一行写一次（VS-105）。
    { label: "要做什么", value: shownTitle && shownTitle.objectInAction && shownTitle.action.endsWith(` · ${shownTitle.object}`) ? shownTitle.action.slice(0, -` · ${shownTitle.object}`.length) : approvalActionName(shown) },
    { label: "对象", value: objectNode(shown) },
    ...(shownChange ? [shownChange] : []),
    ...(shownK1?.kind === "param" ? [{ label: "改动", value: <Change from={`${shownK1.from} 个账户`} to={`${shownK1.to} 个账户`} /> }]
      : shownK1?.kind === "release" ? [{ label: "这笔收益", value: `${k1Amount(shownK1.net)} ${nexGridBrandText(shownK1.asset)} · ${k1Source(shownK1.source)} · 用户 ${userCode(shownK1.userId)}` }] : []),
    ...(shownF5Ids.length === 1 ? [{ label: "这笔奖励", value: <F5CurrentValue id={shownF5Ids[0]} /> }] : []),
    ...(shownBoot ? [{ label: "批准后", value: "七层规则一次建好；整体结算不会自动启用，要另外申请" }] : []),
    // A1 启停：批准后对这个账号的影响，和批准框、发起时确认框同一句（OP-69）。
    ...(shownA1Impact ? [{ label: "批准后", value: shownA1Impact.row, reason: shownA1Impact.note }] : []),
    // 发起人和理由合一行（OP-149 A2-A02）：理由是要读的句子，用正文；谁在什么时候发起写在第二行。
    { label: "发起理由", value: keepCodes(shown.reason), reason: `${shown.operator} · ${roleText(shown.operatorRole)}${isMine(shown) ? "（你发起的）" : ""} · ${bizTime(shown.rawTs, shown.ts)} 发起` },
    ...(shown.lastApprovalAttemptResult ? [{ label: "最近一次批准", value: `没有执行：${f4ResultReason(shown.lastApprovalAttemptResult)}`,
      reason: bizTimeFull(shown.lastApprovalAttemptResult.attemptedAt, "—") }]
      : shown.f4ResultUnreadable ? [{ label: "最近一次批准", value: F4_RESULT_UNREADABLE }] : []),
    ...(shownTiming ? [{ label: "生效时间", value: shownTiming }] : []),
  ] : [];
  // 谁能批准、要什么权限：不是做决定要看的，收进判断要点下面的折叠，标题写结论（DP-04）。不能批准的原因写在底部决定区（OP-126、VS-108）。
  // 底部原因写清挡的是哪个动作：本人单批准、驳回都不能做，写原句；其余只挡批准，不带「批准」二字的前面加「不能批准：」，免得读成驳回也不能做。
  const shownBlockNote = !shownBlock ? undefined : shownBlock === OWN_TICKET_REASON || shownBlock.includes("批准") ? shownBlock : `不能批准：${shownBlock}`;
  const shownApprover = shown && {
    label: shown.retiredOperation ? "原执行权限" : ticketPermissionText(shown) ? "谁来批" : "谁能批准",
    value: approvalExecutorLabel(shown),
    permission: ticketPermissionText(shown) ? `${ticketPermissionText(shown)}${shown.ambassadorMaterialProposal?.applicationDecision === "APPROVE" ? "。不能核验过这一版材料。" : ""}` : undefined,
    backend: !shown.retiredOperation && decisionRule(shown).backendChecks,
  };
  // 技术信息：上面写运营的话，这里给查证用的原文，只列和上面写法不同的（TX-06、TX-34、OP-154）。
  // 对象一格、确认框都不放原文气泡，原文只在这里（DT-22）；和上面写法相同的不再列（VS-105）。
  const shownFundKind = shown ? fundTicket(shown) : undefined;
  const objectRawInTip = !!shown && (shownFundKind?.kind === "fConfig" || shown.operationCode === "f_unilevel_bootstrap" || !!fBatchTicket(shown)
    || !shown.objDisplayName && /^F\.ambassador\.\d+\.status$/.test(shown.obj) || shown.operationCode === "j1_gate_resume"
    || shown.operationCode === "h3_quest_config" && !!h3ConfigName(shown.obj) || isGParamTicket(shown));
  const changeRawInTip = !!shownK1 || !!shownBoot || shownFundKind?.kind === "fConfig" && (!!shownFundKind.spec?.cron || !shownFundKind.spec)
    || !!shown && isGParamTicket(shown) && shown.obj === "divBase";
  const shownValues = shown ? approvalReviewValues(shown) : undefined;
  const changeReworded = !!shown && !!shownValues && (shownValues.withdrawalChanges !== undefined || shownValues.before !== shown.before || shownValues.after !== shown.after
    || [shown.before, shown.after].some((text) => { const parsed = parseReview(text); return !!parsed && parsed.kind !== "text"; }));
  // 这个抽屉里技术信息只有一种样子：底部的折叠（对象一格、完整变更标题旁不再放气泡）。
  const shownTech = !shown ? [] : [
    ...(shown.action !== approvalActionName(shown) ? [{ k: "原动作名", v: shown.action }] : []),
    ...(shownFundKind?.kind === "fConfig" ? [{ k: "配置键", v: shownFundKind.key }]
      : isGParamTicket(shown) ? [{ k: "参数键", v: shown.obj }]
        : shown.operationCode === "h3_quest_config" && h3ConfigName(shown.obj) ? [{ k: "配置键", v: shown.obj }]
          : objectRawInTip || shown.obj !== objectText(shown) ? [{ k: "对象原文", v: `${shown.obj}${fBatchTicket(shown)?.digest ? "（清单太长，只存了摘要）" : ""}` }] : []),
    ...(fBatchTicket(shown)?.items ? [{ k: "各项配置键", v: fBatchTicket(shown)!.items!.map((item) => item.key).join("、") }] : []),
    ...(shownK1 ? [{ k: shownK1.kind === "param" ? "参数原文" : "收益原文", v: k1Tech(shownK1) }] : []),
    ...(!shownK1 && (changeRawInTip || changeReworded) ? [{ k: "修改前原文", v: shown.before || "—" }, { k: "修改后原文", v: shown.after || "—" }] : []),
  ];
  const shownOwn = shown ? isMine(shown) : false;
  const shownCoverageMode = shown && approvalCoverageMode(shown);
  // F4 派奖和结算、F5 提前解锁：被覆盖率挡住时单子留着，可以等恢复后再批，不只是驳回。
  const shownFund = shown ? fundTicket(shown) : undefined;
  const shownCover = shown ? coverageFacts(shown) : undefined;
  // 放大类单的后果（lead）常显；批准时怎么查覆盖率（check）在覆盖率够红线时收进问号（DT-10、DP-06）。
  // 后果和批准框同一句（fundLead，DT-14）；批准框不能撤销的另有标签，详情没有标签，句尾写「不能撤销」（VS-106、DT-10）。
  const shownIrreversible = !!shown && (!!fundSpec(shown)?.irreversible || k1TicketView(shown)?.kind === "release");
  const shownFundCopy = {
    lead: shown ? `${fundLead(shown)}${!shownIrreversible ? "" : shownFund?.kind === "f4Payout" || shownFund?.kind === "f4Settle" ? "，发了不能撤销" : "，不能撤销"}` : "",
    check: shownFund?.kind === "f4Payout" ? shownFund.period === "总榜" ? F4_PAYOUT_COVERAGE : F4_COVERAGE_COPY
      : shownFund?.kind === "f4Settle" ? F4_SETTLE_COVERAGE
      : shownFund?.kind === "f5Status" && shownFund.state === "unlocked" ? "批准时先核对暂停和兑付覆盖率，结算组的奖励还核冷却到没到期；不满足就不放钱，审批单留着待审批。"
        : shownFund?.kind === "f5Reissue" ? shownCover?.check ?? ""
          : shown?.operationCode === "k1_release_param" || shown?.operationCode === "k1_earnings_release" ? K1_APPROVAL_CHECK[shown.operationCode === "k1_release_param" ? "param" : "release"]
            : enablesAutoPayout(shownFund) && shownCover ? shownCover.check
              : shownCover?.check ?? `${PAGE_COVERAGE_COPY}可以等覆盖率恢复后再批，或驳回。`,
  };
  // 最近一次批准已经写了被覆盖率挡下，提示条只留后果，不把同一个原因再说一遍（DT-12）。
  const shownFundCheck = shown?.lastApprovalAttemptResult?.reasonCode === "COVERAGE_BELOW_REDLINE" ? `${shownFundCopy.lead}。` : `${shownFundCopy.lead}。${shownFundCopy.check}`;
  // 和批准框同一条件、同一写法：读到覆盖率且没低于红线时是安静的一行，数字强其余弱，不带警告图标（VS-107、DP-05）。
  const shownCoverageCalm = coverage && !(coverage.redlineBreached === true || coverage.coverageRatio < coverage.redlinePct) ? coverage : undefined;
  // 驳回只是不执行，用普通次按钮，仍在左边和「批准」隔开（必须改 2、DP-40）。退役单右下放灰的「批准」写原因，按钮位置不跳（建议 9）。
  const shownCanWithdraw = !!shown && shownOwn && canWithdraw(shown);
  // 自己发起的单：有批准权的照样看到批准、驳回，禁用，原因在按钮提示里（OP-66）；没有批准权的不显示（OP-124）。
  const shownOwnLocked = shownOwn && canApprove;
  const ticketFooter = shown && (shownCanWithdraw || shownCanApprove || shownCanReject || shownOwnLocked ? (
    <Decision note={shownBlockNote}
      explain={shownCanApprove && !shownOwn && !shown.retiredOperation ? approvalTiming(shown).drawer : undefined}
      danger={shownCanReject || shownOwnLocked ? <Button disabledReason={decideBlock(shown, "reject")} onClick={() => confirmDecision(shown, "reject")}>驳回</Button> : undefined}
      others={shownCanWithdraw ? <Button disabledReason={decideBlock(shown, "withdraw")} onClick={() => confirmDecision(shown, "withdraw")}>撤回我的申请</Button> : undefined}
      primary={shownCanApprove || shownOwnLocked ? <Button variant="primary" disabledReason={decideBlock(shown, "approve")} onClick={() => confirmDecision(shown, "approve")}>批准</Button> : undefined} />
  ) : <Decision note={shownBlock && shownBlock !== NO_DECIDE ? shownBlockNote : WAIT_OTHERS} />);

  /* 操作记录抽屉 */
  const shownLog = logShown.current;
  const shownLogApproved = shownLog ? e1ApprovedLog(shownLog, e1Proposals) : undefined;
  const shownLogE1 = shownLog ? e1SkuLogSides(shownLog) ?? shownLogApproved?.sides : undefined;
  const shownLogDelta = shownLog ? logDeltaText(shownLog) : undefined;
  const logIndex = shownLog ? logPageRows.findIndex((l) => l.id === shownLog.id) : -1;
  const needIdem = shownLog ? shownLog.action.includes("withdraw") || shownLog.action.includes("balance") || shownLog.action.includes("operation_confirmed") : false;
  const requestNo = shownLog?.action === H2_BUY_LIST_ACTION
    ? shownLog.bizNo || "—"
    : shownLog?.idempotencyKey || (needIdem ? "缺失" : "—");
  const shownLogObject = shownLog ? logObject(shownLog) : undefined;
  const shownLogTech: { k: string; v: string; long?: boolean }[] = shownLog ? [
    { k: "IP", v: shownLog.ip },
    { k: "操作编号", v: requestNo },
    // 没翻成中文时「动作」已经是原码，不再写一遍（建议 8）。
    ...(logActionShown(shownLog).text !== shownLog.action || logActionShown(shownLog).raw ? [{ k: "原始动作码", v: shownLog.action }] : []),
    ...(shownLogObject?.raw && !F_BATCH_DIGEST.test(shownLog.obj) ? [{ k: "对象原文", v: shownLogObject.raw, long: true }] : []),
    { k: "角色码", v: shownLog.role },
    ...(F_BATCH_DIGEST.test(shownLog.obj) ? [{ k: "对象摘要", v: shownLog.obj }] : []),
    ...(fBatchLogItems(shownLog) ? [{ k: "各项配置键", v: fBatchLogItems(shownLog)!.map((item) => item.key).join("、"), long: true }] : []),
    ...(fBatchLogItems(shownLog) || shownLogE1 || shownLogApproved?.price || shownLogDelta !== shownLog.delta ? [{ k: "前值 → 后值原文", v: shownLog.delta }] : []),
  ] : [];

  /* 审批结果抽屉 */
  const shownHistory = historyShown.current;
  const historyResultText = shownHistory ? f4ResultTexts.get(shownHistory.id) : undefined;
  const historyIndex = shownHistory ? histPageRows.findIndex((h) => h.id === shownHistory.id) : -1;
  const shownActors = shownHistory ? historyActors(shownHistory.chain) : null;
  const historyNote = shownHistory?.note.startsWith("原因:") ? { label: "原因", text: shownHistory.note.slice(3).trim() || "—" } : { label: "说明", text: shownHistory?.note || "—" };
  // 已批准的券冲正：和历史表同一份总览里的审批单按单号对上，读批准时记下的结果（F1-BE-19）。
  const voucherResult = a2VoucherReversalResult(shownHistory, records?.operationQueue ?? []);
  // 同一份总览按单号找有权读取的终态审批单，处理历史自己不带快照。
  const historyV8Ticket = shownHistory && records?.operationQueue.find(w => w.id === shownHistory.id
    && (w.status === "approved" || w.status === "rejected" || w.status === "withdrawn")
    && w.v8PromotionSnapshot && isV8PromotionTicket(w));
  // 技术信息和待审批详情同一种样子：底部折叠里一项一行（DT-22）。
  const historyTech = !shownHistory ? [] : [
    { k: "处理链原文", v: shownHistory.chain },
    ...(historyV8Ticket && historyV8Ticket.obj !== objectText(historyV8Ticket) ? [{ k: "对象原文", v: historyV8Ticket.obj }] : []),
    ...(voucherResult?.state === "available" ? [
      { k: "券处置原文", v: voucherResult.disposition ?? "—" },
      ...(voucherResult.skippedReason ? [{ k: "未扣回原因原文", v: voucherResult.skippedReason }] : []),
      ...(voucherResult.amountUsdt ? [{ k: "已扣回原文", v: `${voucherResult.amountUsdt} USDT` }] : []),
    ] : []),
  ];

  const readOnly = canApprove ? undefined : canPropose ? "你不能批准，只能看进度和撤回自己发起的申请。" : canMakeV8 ? "你不能批准，只能看进度和撤回自己发起的 V8 晋升申请。" : "你不能批准审批单，只能查看。";

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

      {refusals.length > 0 && <Notice tone="warn" title={refusals.length === 1 ? refusals[0] : `${refusals.length} 个决定没有执行`}
        action={<Button size="sm" onClick={() => setRefusals([])}>知道了</Button>}>{refusals.length > 1 && refusals.map((text, index) => <p key={index}>{text}</p>)}</Notice>}
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
          {pendingTicketIds.has(shown.id) && <Notice tone="warn">这张单有一次决定结果未知，先到页面上方「查询原操作」，查清前不要重复处理。</Notice>}
          <JudgmentPoints title={`判断要点 · 时间为${zone}`} rows={judgment} />
          {shownCoverageMode === "onApproval" && <Notice tone="warn">{approvalCoverageCopy(shown)}</Notice>}
          {shownCoverageMode === "amplifies" && (shownCoverageCalm ? <p className="rd-funding-calm">
            <KeepText text={`${shownFundCopy.lead}。`} />
            <span className="rd-keep">兑付覆盖率 <b>{fmtPct(shownCoverageCalm.coverageRatio)}</b>，红线 <b>{shownCoverageCalm.redlinePctText !== undefined ? `${shownCoverageCalm.redlinePctText}%` : fmtConfigPct(shownCoverageCalm.redlinePct)}</b>
              <Explain label="这项操作对资金的影响" content={<><p>{shownFundCopy.check}</p>{shownCoverageCalm.healthyPct !== undefined && <p>健康线 {fmtConfigPct(shownCoverageCalm.healthyPct)}。</p>}</>} /></span>
          </p> : <Notice tone="warn">{shownFundCheck}</Notice>)}
          {/* J4 逐步执行，中途失败时前面的步骤不回滚，不能写「失败不改原值」（M3）。 */}
          {shown.sos && <Notice tone="danger">{isJ4Execution(shown)
            ? "应急预案逐步执行：中途失败时，前面的步骤可能已经生效。批准前核对值班授权和影响范围，失败后到「监管要求应急处理」的执行追溯里核对每一步。"
            : "应急操作：涉及紧急停用或恢复，请核对值班授权、影响范围和恢复条件后再处理。"}</Notice>}
          {shownK1 ? <section className="a2-change-review" aria-label="完整变更内容">
              <div className="a2-change-title">完整变更内容</div>
              <Facts><K1TicketFacts v={shownK1} /></Facts>
            </section>
            : shownBoot ? <section className="a2-change-review" aria-label="完整变更内容">
              <div className="a2-change-title">完整变更内容 · 七层</div>
              <F2BootstrapReview rows={shownBoot} label="要建立的七层规则" ranked={f2BootstrapUsesRank(shownBoot[0].usdtPct, shownBoot[1].usdtPct) ? null : undefined} limitCopy={F2_LIMIT_APPROVE_COPY} />
            </section>
            : fBatchTicket(shown)?.items ? <A2BatchReview items={fBatchTicket(shown)!.items!} />
            : isRoleGrantsTicket(shown)
            ? <A2RoleGrantsChange review={shown.roleGrantsReview} fallback={<A2ChangeReview operationCode={reviewOperation(shown)} amountKey={a2TicketKey(shown)} before={changeBefore(shown)} after={changeAfter(shown)} />} />
            : <A2ChangeReview operationCode={reviewOperation(shown)} amountKey={a2TicketKey(shown)} {...approvalReviewValues(shown)} omit={g3PolicyExecutionTiming(shown) ? ["生效时间"] : undefined}
                facts={isV8PromotionTicket(shown) ? v8PromotionFacts(shown)
                  : shownFund?.kind === "f5Reissue" ? <Fact k="补发后"><F5ReissueOutcome ids={shownFund.ids} /></Fact>
                  : f1VoucherReverse(shown) && <Fact k={shown.status === "pending" ? "批准后" : "申请时说明"}>{f1VoucherReverse(shown)!.impact}</Fact>}>
                <A2I5DisclosureReview key={shown.id} ticket={shown} />
              </A2ChangeReview>}
          {shownFund?.kind === "fConfig" && f2RateLevel(shownFund) && <F2LayerLimitNotice key={shown.id} level={f2RateLevel(shownFund)!} after={shown.after} />}
          {reissueList(shown, true)}
          {shown.phoneCalibrationProposal && <PhoneCalibrationReview proposal={shown.phoneCalibrationProposal} />}
          {shown.ambassadorMaterialProposal && <AmbassadorMaterialSummary packet={shown.ambassadorMaterialProposal} expectedMaterialRevision={shown.ambassadorMaterialProposal.applicationDecision === "APPROVE" ? shown.ambassadorMaterialProposal.expectedMaterialRevision : undefined} />}
          {/* 折叠标题已写谁来批，里面只放权限和批准时的核对，不重复（VS-105）；没有这两项时一行写完，不折。 */}
          {shownApprover && (shownApprover.permission || shownApprover.backend ? <Fold inset title={shownApprover.label} summary={shownApprover.value}>
            <Facts>
              {shownApprover.permission && <Fact k="需有权限">{shownApprover.permission}</Fact>}
              {shownApprover.backend && <Fact k="批准时">{backendChecksText()}</Fact>}
            </Facts>
          </Fold> : <Facts><Fact k={shownApprover.label}>{shownApprover.value}</Fact></Facts>)}
          {shownTech.length > 0 && <Fold inset title="技术信息" summary={[...new Set(shownTech.map(({ k }) => k.startsWith("修改") ? "修改前后原文" : k))].join("、")}>
            <Facts>{shownTech.map(({ k, v }) => <Fact key={k} k={k}><span data-mono className="a2-long-code">{v}</span></Fact>)}</Facts>
          </Fold>}
        </>}
      </Drawer>

      <Drawer open={Boolean(log)} onClose={() => setLogId(null)} title="操作记录" icon={FileText} tone="role-3"
        sub={shownLog && `${bizTimeFull(shownLog.createdAt, shownLog.ts)}（${zone}）`}
        explain="手机号、地址等隐私信息只以加密编号保存，导出时也会隐藏。"
        nav={{ hasPrev: logIndex > 0, hasNext: logIndex >= 0 && logIndex < logPageRows.length - 1, onPrev: () => { if (logIndex > 0) setLogId(logPageRows[logIndex - 1].id); }, onNext: () => { if (logIndex >= 0 && logPageRows[logIndex + 1]) setLogId(logPageRows[logIndex + 1].id); } }}>
        {shownLog && <>
          <JudgmentPoints rows={[
            { label: "动作", value: logActionShown(shownLog).text },
            { label: shownLog.action === "A1_SUPER_ADMIN_BREAK_GLASS_RECOVERED" ? "执行人 / 角色" : "操作者 / 角色", icon: Users, tone: "users", value: logRoleText(shownLog.role) ? `${shownLog.actor} · ${logRoleText(shownLog.role)}` : shownLog.actor },
            // 对象是「类型 · 编号」，编号可能是整串 UUID：不用不换行的 a2-code，在「·」后面折行，不把抽屉撑出横向滚动。
            { label: "对象", value: F_BATCH_DIGEST.test(shownLog.obj) || fBatchLogItems(shownLog) ? "整批调整的团队参数" : [shownLogObject?.kind, shownLogObject?.id].filter(Boolean).join(" · ") },
            ...(shownLogApproved?.ticket ? [{ label: "审批单", value: shownLogApproved.ticket }] : []),
            ...(fBatchLogItems(shownLog) || shownLogE1 ? [] : [{ label: "前值 → 后值", value: shownLogApproved?.price ? `${shownLogApproved.price}；${E1_PRICE_ONLY}` : <span data-mono>{shownLogDelta}</span> }]),
            { label: "原因", value: shownLog.reason || "—" },
          ]} />
          {fBatchLogItems(shownLog) && <A2BatchReview items={fBatchLogItems(shownLog)!} />}
          {shownLogE1 && <A2ChangeReview before={shownLogE1.before} after={shownLogE1.after} operationCode={shownLogE1.operationCode} />}
          {/* 折叠关着时摘要只写里面有哪几项，不露编号（OP-154、DP-30、DP-04）。 */}
          <Fold inset title="技术信息" summary={shownLogTech.map(({ k }) => k).join("、")}>
            <Facts>{shownLogTech.map(({ k, v, long }) => <Fact key={k} k={k}><span data-mono className={long ? "a2-long-code" : undefined}>{v}</span></Fact>)}</Facts>
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
            ...(historyResultText ? [{ label: "实际结果", value: historyResultText }] : []),
            { label: historyV8Ticket ? "处理理由" : historyNote.label, value: historyNote.text },
          ]} />
          {historyV8Ticket && <A2ChangeReview before={changeBefore(historyV8Ticket)} after={changeAfter(historyV8Ticket)}
            operationCode={reviewOperation(historyV8Ticket)} amountKey={a2TicketKey(historyV8Ticket)} facts={<>
              <Fact k="对象">{objectNode(historyV8Ticket)}</Fact>
              <Fact k="发起理由">{keepCodes(historyV8Ticket.reason)}</Fact>
              {v8PromotionFacts(historyV8Ticket)}
            </>} />}
          {voucherResult && <section className="a2-change-review" aria-label="实际结果">
            <div className="a2-change-title">实际结果<Explain label="实际结果说明" content="批准执行时系统记下的券处置和扣款，不是申请时的选择。" /></div>
            {voucherResult.state === "available" ? <Facts>
              {voucherResult.amountUsdt && <Fact k="实际扣回" lead tone="role-1" unit="USDT">{payoutAmount(voucherResult.amountUsdt)}</Fact>}
              <Fact k="券处置">{f1VoucherResultText(voucherResult.disposition)}</Fact>
              {voucherResult.skippedReason && <Fact k="没有扣回的原因">{F1_VOUCHER_SKIP_REASON[voucherResult.skippedReason] ?? "系统记下的原因暂时无法显示"}</Fact>}
            </Facts> : <p className="rd-note">没读到这张单的实际结果，可能是较早批准的单没有记下。到{reach("/finance/ledger") ? <Link className="rd-link" href="/finance/ledger" prefetch={false}>「账本与账单核对」</Link> : "「账本与账单核对」"}核对这笔冲正的 USDT 流水。</p>}
          </section>}
          <Fold inset title="技术信息" summary={historyTech.map(({ k }) => k).join("、")}>
            <Facts>{historyTech.map(({ k, v }) => <Fact key={k} k={k}><span data-mono className="a2-long-code">{v}</span></Fact>)}</Facts>
          </Fold>
        </>}
      </Drawer>

      <Drawer open={confirmListOpen} onClose={() => setConfirmListOpen(false)} title={`需要确认的操作（${confirmCategories.length} 类）`} icon={ListChecks}
        explain="清单只是说明，不改变权限和审批规则。走审批的一般由另一位超级管理员批准后才生效，人工调整等级由发起人以外、有人工调级权限和审批批准权限的管理员批；业务里的第二人复核（如调账）按各页写的复核人；直接执行的确认后立即生效。">
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
