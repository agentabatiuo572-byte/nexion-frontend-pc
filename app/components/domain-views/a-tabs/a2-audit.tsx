"use client";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { AUDIT_ACTION_NAMES as A2_ACTION_NAMES } from "@/lib/admin/audit-action-names";
import { a2ActionText, operatorCopyText, shareBaseRateText } from "@/lib/admin/operator-copy";
import { PromotionRefundImpact } from "../promotion-refund-impact";
import { PhoneCalibrationReview } from "../e-tabs/phone-calibration-review";
import { AmbassadorMaterialSummary } from "../f-tabs/f4-ambassador-materials";

/**
 * A2 操作记录与审批（列表页·队列模式，PG-44）。三个页签：待审批（默认）、操作记录（含审批结果）、机制设置。
 *
 * - 待审批和机制设置读不带筛选的总览；操作记录有生效筛选时另读一次带筛选的总览。后端把同一组筛选同时套在
 *   审批单、统计和记录上，不分开读的话待审批数会跟着操作记录的筛选变。
 * - 批准、驳回、撤回、调整机制参数、立即清理、导出：先把命令号和原内容（导出连同已应用的筛选）存进本标签页再发；
 *   结果未知时关框，转成页面上方的待确认条，这张单（这项设置、清理、导出）锁住，只能按原操作重试；
 *   重试被后端明确拒绝（isExplicitRejection）后才能解除，超过 24 小时只能核对（OP-92～OP-96、OP-153）。
 * - 批准、驳回入口按工单类型对齐后端的业务权限（decisionRule），没有权限的不显示入口（OP-124）。
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
import { createPendingMutationStore, isRetryExpired, type PendingMutationExtra, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
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
const COVERAGE_ON_APPROVAL_COPY = "批准执行时，系统会检查兑付覆盖率。低于红线时，审批单继续待处理，账户组状态和提现限制保持原样。";
const PENDING_LOCK = "这条有结果未确认的操作，先到页面上方核对";
const RELOADING = "审批单还在读取，读完再处理";
const SUBMITTING = "正在提交";
const NO_WITHDRAW = "你没有撤回申请的权限";
const NO_DECIDE = "这个账号没有处理这张单的权限";
/** 页面判断不了这张单要哪项业务权限或附加条件时，入口照常放出，写这一句（协调人第五轮定）。 */
const BACKEND_CHECKS_NOTE = "这类单的业务权限由后端在批准时检查，没有权限会被拒绝并写明原因";
const WAIT_OTHERS = "等待有权限的人处理";
const UNKNOWN_TOAST = "结果未确认，不要重复操作。到页面上方读回核对或按原操作重试。";
const RETRY_EXPIRED = "已超过 24 小时，不能再重试，请在「操作记录」里按单号核对。";
const RETRY_NO_PERMISSION = "这个账号现在没有这项操作的权限，不能重试，请在「操作记录」里按单号核对";

function approvalCoverageCopy(w: A2OperationRow) {
  return w.ambassadorMaterialProposal?.applicationDecision === "APPROVE"
    ? "批准执行时，系统会重新核验材料版本、核验结论、认可金额及兑付覆盖率。任一条件不满足时，审批单继续待处理，申请状态和所选类别预算额度保持原样。"
    : COVERAGE_ON_APPROVAL_COPY;
}

function approvalExecutorLabel(w: A2OperationRow) {
  if (["提高旧活动奖励", "放宽转盘奖项配置", "回滚至有奖励的课程版本"].includes(w.action))
    return "另一位有批准权限的超级管理员";
  if (w.action === "调整设备型号" || w.action === "发布手机可跑任务") return "另一位有批准权限和商品修改权限的管理员";
  if (w.action === "发布规则任务") return "另一位有批准权限和任务池修改权限的管理员";
  return w.ambassadorMaterialProposal?.applicationDecision === "APPROVE"
    ? "另一位具有审批和大使批准权限、且未参与本版材料核验的管理员"
    : w.roleGate === "超管" ? "超级管理员" : w.roleGate;
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
type Need = string | readonly string[];
type DecisionRule = { superadmin?: boolean; approve?: readonly Need[]; reject?: readonly Need[]; backendChecks?: boolean };
/**
 * 后端 scopedMakerMayPropose 的增长委托例外：角色是增长、有发起审批权、没有 A2 写权限时，
 * E5 强制激活、解绑不要那两项设备权限（批准时 validateApproval 回到 validateProposal 用同一条，U03）。
 */
const GROWTH_DELEGATE = "@growth-delegate";
type TicketIdentity = Pick<A2OperationRow, "action" | "obj" | "operationCode" | "fundEffect" | "before" | "after">
  & Partial<Pick<A2OperationRow, "phoneCalibrationProposal" | "ambassadorMaterialProposal" | "roleGate" | "canApprove" | "canReject">>;
const A4_REGISTRY_CODES = ["a4_schema_register", "a4_schema_property_add", "a4_domain_extension_register"];
const J4_CODE = /^SOP-[A-Z0-9-]{1,64}$/;
/** 有专项审批、要另一位超管处理的单（各自的 validateChecker：超管＋A2 批准权，批准、驳回一样）。 */
const SUPER_ONLY: DecisionRule = { superadmin: true };
const SUPER_ACTIONS = new Set([
  "放宽任务定价", "变更正式任务目录", // E2TaskPricingApproval
  "降低兑付覆盖率红线", "提高提现压力红线", // TreasuryThresholdApproval
  "首次发布奖励课程", "发布奖励课程版本", "回滚至较高奖励课程版本", "回滚至有奖励的课程版本", // LearningCourseActivationApproval
  "放宽用户任务配置", // H3GrowthApproval
  "提高旧活动奖励", "开放旧活动资金奖励", "新增转盘奖项", "放宽转盘奖项配置", "删除转盘奖项并提高安慰奖", "提高转盘奖项概率",
  "启用活动或放宽转盘资金护栏", "发布历史活动只读记录", // H4GrowthApproval
  "放宽连签权益", "放宽收益里程碑", // H5GrowthApproval
  "提高新人 USDT 基础额", "提高新人 UVT 基础额", "提高邀请人 UVT 基础额", "改为符合资格就直接发", "启用新人礼与邀请奖励", // H8RewardParamApproval
  "手动结算团队平衡奖励", "提高区域大使申请预算", // TeamFundApproval
]);
const SUPER_ACTION_PATTERNS = [/^首次配置验证码设置 · /, /^放宽 \S+ 晋升条件$/, /^\S+ (?:新增|增加)资金奖励$/];
/**
 * 后端写死的动作名 → 批准要的业务权限（validateApproval 走 approvalAuthority 或 requiredAuthority）。
 * 这些单驳回只要 A2 批准权（validateRejection 对它们放行）。
 */
const CANONICAL_APPROVE: Readonly<Record<string, Need>> = {
  调整设备型号: "device_e1_write",
  "结束未确认任务（不计收益）": "device_e5_write",
  发布手机校准规则: "device_e6_read",
  发布手机换机策略: "device_e6_read",
  开启手机换绑: "device_e6_read",
  关闭手机换绑: "device_e6_read",
  开启电脑共享算力入口: "device_e6_read",
  关闭电脑共享算力入口: "device_e6_read",
  发布手机可跑任务: "device_e1_write",
  发布规则任务: "device_e2_write",
  "USDT BEP20 充值政策": "finance_d1_channel_manage",
  "首次配置 V0–V8": "network_f1_write",
  七层结算启用: "network_f2_policy_amplify",
  七层结算暂停: "network_f2_policy_amplify",
  七层结算恢复: "network_f2_policy_amplify",
  好友奖励双币政策: "network_f2_royalty_rate",
  批准区域大使申请: "network_f4_ambassador_approve",
  驳回区域大使申请: "network_f4_ambassador_approve",
  调整每周任务地区映射: "growth_h3_write",
  批准取消成交奖励: "growth_promotion_reward_cancel",
  批准追回成交奖励: "growth_promotion_reward_reverse",
  执行指定新人邀请奖励结算: "growth_h8_settle",
  执行邀请奖励真实结算: "growth_h8_settle",
};
/** 后端写成「名字 · 对象」的（descriptor、deviceDescriptor），驳回同样只要 A2 批准权。 */
const CANONICAL_WITH_OBJECT: Readonly<Record<string, Need>> = {
  冻结账户: "user_c2_account_freeze",
  恢复账户: "user_c2_account_unfreeze",
  强制登出: ["user_c2_session_revoke_all", "user_c5_session_revoke_all"],
  用户数据只读视图: "user_c2_impersonate_start",
  加入信任名单: "user_c2_blocklist_add",
  加入禁入名单: "user_c2_blocklist_add",
  移出账户名单: "user_c2_blocklist_add",
  终止模拟会话: "user_c2_impersonate_terminate",
  批量冻结关联账户: "risk_k1_cluster_freeze",
  解除误判: "risk_k1_cluster_release",
  判定为正常: "risk_k1_cluster_cleared",
  标记可疑账户簇: "risk_k1_cluster_flag",
  标记套利账户: "risk_k2_row_flag",
  拦截新人礼: "risk_k2_row_blockgift",
  标记刷榜账户: "risk_k2_row_boardflag",
  "联动 K1 批量冻结": "risk_k2_row_freeze",
  强制激活设备: ["device_e5_device_force_activate", GROWTH_DELEGATE],
  解绑设备资产: ["device_e5_device_unbind", GROWTH_DELEGATE],
  编辑账号资料: "platform_a1_write",
  变更角色: "platform_a1_account_role_change",
  重置两步验证: "platform_a1_account_2fa_reset",
  "启用/禁用账号": "platform_a1_account_disable",
};
/** 动作名前面是后端写死的部分，后面接对象。 */
const CANONICAL_APPROVE_PREFIX: readonly (readonly [string, Need])[] = [
  ["更新 E3 生命周期配置 · ", "device_e3_read"],
  ["批量更新算力配置参数 · ", "device_e6_read"],
  ["调整通知优先级 CAP · ", "content_i3_cap_adjust"],
  ["撤销奖励记录 ", "network_f5_commission_reverse"],
  ["批量补发奖励 · ", "network_f5_commission_reissue"],
  ["暂停用户奖励 ", "network_f5_commission_suspend"],
  ["恢复用户奖励 ", "network_f5_commission_suspend"],
  ["冻结奖励记录 ", "network_f5_commission_freeze"],
  ["解冻奖励记录 ", "network_f5_commission_freeze"],
  ["驳回奖励记录 ", "network_f5_commission_reverse"],
  ["提前解锁奖励记录 ", "network_f5_commission_release"],
  ["结算奖励记录 ", "network_f5_commission_release"],
  ["发放奖励记录 ", "network_f5_commission_release"],
  // 「操作员账号」页自己提交时写的动作名（后端按发起时同一项权限核批准人）。
  ["编辑账号 · ", "platform_a1_write"],
  ["变更角色 · ", "platform_a1_account_role_change"],
  ["重置两步验证 · ", "platform_a1_account_2fa_reset"],
  ["禁用账号 · ", "platform_a1_account_disable"],
  ["启用账号 · ", "platform_a1_account_disable"],
];

/** 「F 域配置调整 · 键」批准要的权限，照后端 fConfigAuthority 按键分（三种 F 配置命令的键不重叠）。 */
function fConfigAuthority(key: string) {
  if (/^F\.unilevel\.(?:nex\.)?L[1-7]$/.test(key) || ["directRoyaltyPct", "networkRoyaltyPct", "binaryPairRatePct", "maxCombinedOutflowPct",
    "minPayoutUsdt", "F.promo.weekMultiplier", "F.peer.rate"].includes(key)) return "network_f2_royalty_rate";
  if (["rankWindowDays", "hardwareQuotaPerRank"].includes(key)) return "network_f2_write";
  if (["F.prize.name", "F.vrank.titles"].includes(key)) return "network_f1_write";
  if (key === "F.vrank.permanent") return "network_f1_permanent_protection";
  if (["F.influence.clampMin", "F.influence.clampMax", "F.cooldown", "F.partner.tiers", "F.royalty.minPayout", "F.unilevel.depthGate",
    "F.unilevel.nexCap", "F.unilevel.backfill", "F.unilevel.depth", "F.sunset.exclusions"].includes(key) || /^F\.unilevel\.L[1-7]\.paused$/.test(key)) return "network_f2_policy_amplify";
  if (key === "F.binary.paused") return "network_f3_engine_pause";
  if (key.startsWith("F.binary.")) return "network_f3_match_rate";
  if (key.startsWith("F3.dailyCap.")) return "network_f3_write";
  if (key.startsWith("F.pool.votes.") || key.startsWith("F.quota.")) return "network_f4_write";
  if (key.startsWith("F.ambassador.") && key.endsWith(".status")) return "network_f4_ambassador_approve";
  if (["F.pool.monthlyCap", "F.pool.settleCron", "F.pool.unlockVRank", "F.leaderboard.minUsd"].includes(key)) return "network_f4_write";
  if (key === "F.leaderboard.poolUsd") return "network_f4_pool_fund";
  if (key.startsWith("F.leaderboard.")) return "network_f4_leaderboard_control";
  if (key.startsWith("F.pool.")) return "network_f4_pool_fund";
  return undefined;
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

function decisionRule(w: TicketIdentity): DecisionRule {
  const code = w.operationCode ?? "";
  if (w.fundEffect === "ORDER_REFUND" || code === "e4_order_refund") return { superadmin: true, approve: ["device_e4_order_refund"], reject: ["device_e4_order_refund"] };
  if (code === "j1_gate_resume") return { superadmin: true, approve: ["emergency_j1_gate_resume"], reject: ["emergency_j1_gate_resume"] };
  if (A4_REGISTRY_CODES.includes(code)) return SUPER_ONLY;
  // 代金券删除和批量作废：有券操作权限的审批人就行，不要求超管（角色例外）。
  if (isH7VoucherApproval(code)) return { approve: ["growth_h7_write"], reject: ["growth_h7_write"] };
  if (code === "f5_commission_suspension") return { approve: ["network_f5_commission_suspend"] };
  if (code === "h2_trial_charge") return { approve: ["growth_h2_session_charge"] };
  if (w.obj === "current" && w.action === "调整敏感汇率") return { superadmin: true, approve: ["finance_d6_manage"], reject: ["finance_d6_manage"] };
  if (w.obj === "current" && w.action === "放宽越南盾提现参数") {
    const forced = d7ForceInverted(w.after);
    return forced === undefined ? { superadmin: true, backendChecks: true } : { superadmin: true, approve: forced ? ["finance_d7_force_inverted"] : [] };
  }
  if (w.obj === "current" && w.action === "放宽提现参数") return SUPER_ONLY;
  if (SUPER_ACTIONS.has(w.action) || SUPER_ACTION_PATTERNS.some((pattern) => pattern.test(w.action)) || isG3Policy(w)) return SUPER_ONLY;
  // 创世节点价格档位：改价要价格权限，动了总供应量还要写权限（T03）；读不出动没动时由后端核写权限。
  if (w.obj === "tiers" && w.action === "调整创世节点价格档位") {
    const supply = g4ChangesSupply(w);
    const need = supply ? ["finprod_g4_price_write", "finprod_g4_write"] : ["finprod_g4_price_write"];
    return { superadmin: true, approve: need, reject: need, ...(supply === undefined ? { backendChecks: true } : {}) };
  }
  // 创世分红：改分红率要分红率权限，重跑一批分红要 G4 写权限。
  if (w.action === "批准创世分红操作") {
    const need = [w.obj === "dividend" ? "finprod_g4_dividend_rate_write" : "finprod_g4_write"];
    return { superadmin: true, approve: need, reject: need };
  }
  // 课程奖励调整：动作名是发起页写的，前后值是后端按课程现状写的（「版本 · r修订 · 奖励 UVT」）。
  if (w.roleGate === "超管" && /^.+ · r\d+ · \S+ UVT$/.test(w.before) && /^.+ · \S+ UVT$/.test(w.after)) {
    return { superadmin: true, approve: ["content_i7_course_reward_adjust"], reject: ["content_i7_course_reward_adjust"] };
  }
  if (isJ4Execution(w)) return { approve: ["emergency_j4_playbook_execute"] };
  if (w.phoneCalibrationProposal || w.obj === "phone-calibration") return { approve: ["device_e6_read"] };
  if (w.ambassadorMaterialProposal) return { approve: ["network_f4_ambassador_approve"] };
  if (w.obj.startsWith("E.compute.")) return { approve: ["device_e6_read"] };
  const exact = CANONICAL_APPROVE[w.action];
  if (exact) return { approve: [exact] };
  const suffix = ` · ${w.obj}`;
  const named = w.obj && w.action.endsWith(suffix) ? CANONICAL_WITH_OBJECT[w.action.slice(0, -suffix.length)] : undefined;
  if (named) return { approve: [named] };
  const f = w.action === `F 域配置调整 · ${w.obj}` ? fConfigAuthority(w.obj) : undefined;
  if (f) return { approve: [f] };
  const prefixed = CANONICAL_APPROVE_PREFIX.find(([prefix]) => w.action.startsWith(prefix));
  return prefixed ? { approve: [prefixed[1]] } : { backendChecks: true };
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
  const [kind, ...rest] = obj.split(" · ");
  if (!rest.length) return { main: middle(shortCodes(obj), 20), sub: undefined };
  const id = rest.join(" · ");
  return { main: id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-6)}` : id, sub: kind };
}

/** 没翻成中文的动作码太长时中间省略：前面是模块，后面是动作，两头都要留。 */
function middle(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 9)}…${text.slice(-8)}` : text;
}

function actionName(action: string) {
  return a2ActionText(nexGridBrandText(action));
}

/** 本页的码翻中文；别的模块的码原样，等宽显示。 */
function logActionText(code: string) {
  return A2_ACTION_NAMES[code] ?? a2ActionText(code);
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
  /** 重试时按发出时这张单要的业务权限判断（decisionRule 的结果）。第二轮的记录没有这项，第三轮的可能是 null，第四轮的标记叫 unmapped。 */
  rule?: (DecisionRule & { unmapped?: boolean }) | null;
  operationCode?: string;
  obj?: string;
  fundEffect?: A2OperationRow["fundEffect"];
  /** 退款单的原订单号：重试前要先读到退款金额（F01）。 */
  refundOrderNo?: string;
  /** 审批单的原动作，重试时写进标签。 */
  action?: string;
  /** 导出时已应用的筛选：重试只用这一份，不读页面上现在的条件（M2）。 */
  filter?: A2AuditFilter;
};
type A2PendingExtra = PendingMutationExtra<A2PendingCommand>;

const a2Commands = createPendingMutationStore<A2PendingCommand>({
  storageKey: "nexion-admin-a2-commands-v1",
  // 过期后不能再用原号重试，记录和锁都留着（OP-96）。
  retainExpiredRecords: true,
});

type RefundAmount = { state: "loading" } | { state: "ok"; amount: number } | { state: "error"; message: string };
const REFUND_AMOUNT_REQUIRED = "先读到退款金额才能批准";

const DECISION_VERB: Record<"approve" | "reject" | "withdraw", string> = { approve: "批准", reject: "驳回", withdraw: "撤回" };
const DECISION_STATUS: Record<"approve" | "reject" | "withdraw", A2OperationRow["status"]> = { approve: "approved", reject: "rejected", withdraw: "withdrawn" };
const RECOVERY_HINT: Record<A2CommandKind, string> = {
  approve: "读回只看这张单现在的状态，说明不了这次操作的结果。可以按原操作重试，不会重复执行。",
  reject: "读回只看这张单现在的状态，说明不了这次操作的结果。可以按原操作重试，不会重复执行。",
  withdraw: "读回只看这张单现在的状态，说明不了这次操作的结果。可以按原操作重试，不会重复执行。",
  param: "读回只看现在的值，值相同也可能是别人改的。可以按原操作重试，不会重复执行。",
  retention: "读回只看最近一次手动清理。可以按原操作重试，不会重复清理。",
  export: "读回只看有没有这次的导出记录。可以按原操作重试，按当时的条件重新下载。",
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
  const denied = `后端按业务权限拒绝了这次${kind === "approve" ? "批准" : "驳回"}，这个账号没有这张单要的业务权限${missing ? `（权限码 ${missing}）` : ""}`;
  // 重试被拒说明不了原操作的结果，后半句由重试那边写。
  return retry ? denied : `${denied}。${kind === "approve" ? "原操作没有执行" : "这张单没有驳回"}，还是待审批；请换有这项权限的管理员处理。`;
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
  purchaseGate: "购买限制", imageAssetId: "产品图标识", imageObjectKey: "产品图对象键", imagePreviewUrl: "产品图预览",
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
  expectedSignature: "提交时奖池签名", wheelSignature: "奖池签名", tiers: "奖池档位",
  wheelEvidence: "核对证据", wheelSnapshot: "原奖池快照",
  courseId: "课程编号", version: "课程版本", revision: "修订号", rewardNex: "奖励（UVT）",
  sourceStatus: "目标版本原状态", expectedRevision: "目标修订号", expectedCurrentVersion: "当前课程版本",
  expectedCurrentRevision: "当前课程修订号", expectedCurrentStatus: "当前课程状态",
  tier: "奖项编号", status: "状态", reward: "奖励名称", prob: "概率（%）", kind: "奖励类型", amount: "发放数量", real: "实际资金流出",
};
const WHEEL_REVIEW_OPERATIONS = ["h4_wheel_tier_create", "h4_wheel_tier_update", "h4_wheel_tier_delete", "h4_wheel_probabilities_update"];
const hiReviewLabels = (operationCode?: string) => ["h4_legacy_event_reward_update", "i7_course_version_rollback", ...WHEEL_REVIEW_OPERATIONS].includes(operationCode ?? "") ? HI_CHANGE_LABELS : CHANGE_LABELS;
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
  const b = parseReview(before);
  const a = parseReview(after);
  const labels = hiReviewLabels(operationCode);
  const original = { b, a, labels, evidenceKeys: [] as string[] };
  if (!WHEEL_REVIEW_OPERATIONS.includes(operationCode ?? "") || b?.kind !== "object" || a?.kind !== "object"
    || typeof b.value.tiers !== "string") return original;
  let snapshot: unknown;
  try { snapshot = JSON.parse(b.value.tiers); }
  catch { return original; }
  if (!Array.isArray(snapshot) || !snapshot.every(isRecord)) return original;

  // Decimal strings and JSON numbers compare without rounding or false scale-only changes.
  const decimal = (value: unknown) => String(value).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  const tiers = snapshot.map(tier => ({
    tierName: tier.tier, rewardName: tier.reward, probabilityPct: decimal(tier.prob),
    realOutflow: tier.real === true || tier.real === 1, rewardKind: tier.kind,
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
      rewardKind: values.rewardKind ?? target?.rewardKind ?? "uvt",
      rewardAmount: decimal(values.rewardAmount ?? target?.rewardAmount ?? 0),
      voucherId: values.voucherId == null ? target?.voucherId ?? "无" : String(values.voucherId).trim() || "无",
      dailyStock: values.dailyStock ?? target?.dailyStock ?? 0,
    };
  }
  // Existing row groups keep verification evidence out of the business-field diff.
  next.wheelEvidence = [{ wheelSignature: b.value.wheelSignature, expectedSignature: values.expectedSignature }];
  next.wheelSnapshot = snapshot;
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
export function A2ChangeReview({ before, after, omit = [], operationCode }: { before: string; after: string; omit?: readonly string[]; operationCode?: string }) {
  const { b, a, labels } = reviewPair(before, after, operationCode);
  const created = !b;
  let body: ReactNode;
  if (!a) {
    body = <Facts><Fact k="变更后">—</Fact></Facts>;
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
  /** 按读到的权限判断，不按角色名写死（B38 后财务主管有 D 域读权、没有批准权）。 */
  const growthDelegate = principal.role === "growth" && principal.authorities.includes("platform_a2_proposal_create")
    && !principal.authorities.includes("platform_a2_write");
  const holds = (authority: string) => authority === GROWTH_DELEGATE ? growthDelegate : principal.authorities.includes(authority);
  const has = (need: Need) => typeof need === "string" ? holds(need) : need.some(holds);
  /** backendChecks 的单只看规则里能确认的部分（多数只剩 A2 批准权），其余由后端在批准时检查（第五轮）。 */
  const allowed = (rule: DecisionRule, kind: "approve" | "reject") => {
    if (!canApprove) return false;
    if (rule.superadmin && principal.role !== "superadmin") return false;
    return (kind === "approve" ? rule.approve : rule.reject)?.every(has) ?? true;
  };
  const canDecide = (ticket: TicketIdentity, kind: "approve" | "reject") => {
    const qualified = kind === "approve" ? ticket.canApprove : ticket.canReject;
    return canApprove && (qualified ?? allowed(decisionRule(ticket), kind));
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
    ? w.refundAmountUsdt !== undefined ? { state: "ok", amount: w.refundAmountUsdt }
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
        if (!unknown && !retained) a2Commands.forget(scope);
        syncPending();
        await refreshAfterWrite();
        if (unknown) { toast(UNKNOWN_TOAST, "warn"); return "unknown"; }
        throw cause;
      }
      const confirmed = await confirm(result).catch(() => false);
      if (!confirmed) { syncPending(); toast(UNKNOWN_TOAST, "warn"); return "unknown"; }
      a2Commands.forget(scope);
      syncPending();
      return "ok";
    } finally {
      setSubmitting("");
    }
  };

  type DecisionTicket = TicketIdentity & Pick<A2OperationRow, "id" | "refundOrderNo"> & { rule?: DecisionRule | null };
  const runDecision = (kind: "approve" | "reject" | "withdraw", w: DecisionTicket, reason: string, by = operator) => sendCommand(
    `${kind}|${w.id}`,
    { kind, label: `${DECISION_VERB[kind]} · ${actionName(w.action)}`, target: w.id, reason, operator: by, rule: w.rule !== undefined ? w.rule : decisionRule(w),
      operationCode: w.operationCode, obj: w.obj, fundEffect: w.fundEffect, refundOrderNo: w.refundOrderNo, action: w.action },
    `a2-${kind}-${w.id}`,
    (key) => kind === "approve" ? approveA2Operation(w.id, reason, key)
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

  const runRetention = async (reason: string, by = operator) => {
    const box: { result?: RetentionExecution } = {};
    const outcome = await sendCommand(
      "retention",
      { kind: "retention", label: RETENTION_TITLE, target: "retention", reason, operator: by },
      "a2-retention-run",
      (key) => runA2RetentionNow(reason, key),
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
  const canRetry = (record: A2PendingCommand) => record.kind === "withdraw" ? canWithdraw
    : record.kind === "param" || record.kind === "retention" ? canWrite
      : record.kind === "export" ? canExport
        : allowed(recordRule(record), record.kind);

  /** 重试前退款单要先读到退款金额，和新开的批准框同一个前提（F01）；读不到只能读回核对，原命令照旧保留。 */
  const retryAmount = (record: A2PendingCommand): RefundAmount | undefined => {
    if (record.kind !== "approve" || record.fundEffect !== "ORDER_REFUND") return undefined;
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
      notePending(record, "浏览器里查不到这条记录，本次没有发送。待确认继续保留，请在「操作记录」里核对。");
      return;
    }
    setRetryRejected((current) => current.filter((key) => key !== record.commandKey));
    try {
      const queued = recordTicket(record);
      const ticketLike = { id: record.target, action: record.action ?? queued?.action ?? record.target, obj: record.obj ?? queued?.obj ?? "",
        before: queued?.before ?? "", after: queued?.after ?? "", operationCode: record.operationCode ?? queued?.operationCode,
        fundEffect: record.fundEffect ?? queued?.fundEffect, refundOrderNo: recordOrderNo(record), rule: recordRule(record) };
      const outcome = record.kind === "param" ? await runParam(record.target as "ttl" | "retention" | "schema", record.value ?? "", record.reason, record.operator)
        : record.kind === "retention" ? await runRetention(record.reason, record.operator)
          : record.kind === "export" ? await runExport(record.reason, record.filter ?? {}, record.operator)
            : await runDecision(record.kind, ticketLike, record.reason, record.operator);
      // 导出和清理自己会提示「已下载」「清理完成」，不再多弹一条。
      if (outcome === "ok") { if (record.kind !== "export" && record.kind !== "retention") toast(`已确认：${record.label}已生效`, "success"); }
      else notePending(record, "重试的结果仍未确认，待确认继续保留。");
    } catch (cause) {
      if (isPermissionDenied(cause)) announcePermissionDenied();
      const why = ((record.kind === "approve" || record.kind === "reject" ? decisionDeniedText(record.kind, cause, true) : undefined) ?? displayAdminError(cause)).replace(/[。.]$/, "");
      if (isExplicitRejection(cause)) {
        notePending(record, `重试没有成功：${why}。这说明不了原操作的结果，原记录继续保留。`);
        setRetryRejected((current) => [...current, record.commandKey]);
      } else notePending(record, `这次没能确认结果：${why}。原操作继续保留，稍后再读回或重试。`);
    }
  };

  /** 读回只给现在的事实，不解除（OP-93、OP-95）。 */
  const verifyPending = async (record: A2PendingCommand) => {
    if (record.kind === "export") {
      // 后端把命令号写进这次导出记录的详情，按对象查得到；查到也只说明后端生成过，文件没下到时按原操作重试。
      const found = await fetchA2Overview({ action: "A2_AUDIT_EXPORTED", object: record.commandKey }).catch(() => null);
      if (!found) { notePending(record, "读回失败，导出记录暂时读不到。待确认继续保留。"); return; }
      const hit = found.recentLogs[0];
      notePending(record, hit
        ? `读回：${logTime(hit)} 有这次的导出记录（${hit.obj.split(" · ").pop()}）。没下到文件就按原操作重试。待确认继续保留。`
        : "读回：没找到这次导出的记录，可能没有生成。待确认继续保留。");
      return;
    }
    if (record.kind === "retention") {
      const latest = await fetchA2RetentionLatest().catch(() => undefined);
      if (latest === undefined) { notePending(record, "读回失败，上次手动清理暂时读不到。待确认继续保留。"); return; }
      setRetentionRun(latest);
      notePending(record, latest
        ? `读回：最近一次手动清理在 ${bizTime(latest.evaluatedAt, latest.evaluatedAt)}，归档 ${latest.archivedRows} 条、移除 ${latest.deletedRows} 条。说明不了是不是这次的结果，待确认继续保留。`
        : "读回：还没有手动清理过的记录。待确认继续保留。");
      return;
    }
    const next = await loadMain().catch(() => null);
    if (!next) { notePending(record, record.kind === "param" ? "读回失败，这项设置暂时读不到。待确认继续保留。" : "读回失败，这张单暂时读不到。待确认继续保留。"); return; }
    if (record.kind === "param") {
      const now = next.mechanismParams.find((item) => item.key === record.target)?.value;
      notePending(record, `读回：${PARAM_NAME[record.target] ?? record.target}现在是 ${now ? operatorCopyText(now) : "—"}，你提交的是 ${record.value}。值相同也可能是别人改的，待确认继续保留。`);
      return;
    }
    const found = ticketStatus(next, record.target);
    notePending(record, found
      ? `读回：这张单现在是「${HIST_LABEL[found.status] ?? found.status}」${found.actor ? `，处理人 ${found.actor}` : ""}，发出时是「待审批」。状态可能是别人处理的，待确认继续保留。`
      : "读回失败，这张单暂时读不到。待确认继续保留。");
  };

  /** 重试被拒后，人核实过原操作的结果才解除。只放开本页的锁，不发请求，后端仍按这张单现在的状态校验。 */
  const releasePending = (record: A2PendingCommand) => {
    a2Commands.forget(record.fingerprint, record.commandKey);
    syncPending();
    setReleasing(null);
    toast(record.kind === "param" ? "已解除待确认，这项设置可以重新调整" : record.kind === "retention" ? "已解除待确认，可以重新清理"
      : record.kind === "export" ? "已解除待确认，可以重新导出" : "已解除待确认，这张单可以重新处理", "success");
  };

  /** 「在操作记录里查看」：切到操作记录，对象填审批单号或机制、清理的资源名，导出按这次的命令号查，模块不限。 */
  const showInRecords = (record: A2PendingCommand) => {
    const next: A2AuditFilter = record.kind === "export" ? { action: "A2_AUDIT_EXPORTED", object: record.commandKey } : { object: PARAM_AUDIT_OBJECT[record.kind] ?? record.target };
    applyFilter(next);
    chooseTab("records");
    setView("logs");
  };

  /* ────────────────── 确认框 ────────────────── */

  const immediate = <StatusTag tone="progress" filled>立即生效</StatusTag>;

  /** 框标题只写「批准审批单」，动作名放在标题下面一行，长了省略、悬停看全文（设计偏差二选一的第一种）。 */
  const subject = (w: A2OperationRow) => <span className="a2-confirm-subject" title={actionName(w.action)}>{shortCodes(actionName(w.action))}</span>;

  /** 本人、已退役、解析不了、有未确认操作、正在读取、读不到退款金额：入口先禁用并写原因（第五节）。没有业务权限的入口不显示（OP-124），这里只兜底。 */
  const decideBlock = (w: A2OperationRow, kind: "approve" | "reject" | "withdraw") => {
    if (submitting) return SUBMITTING;
    if (pendingTicketIds.has(w.id)) return PENDING_LOCK;
    if (mainLoading) return RELOADING;
    if (kind === "withdraw") return canWithdraw ? undefined : NO_WITHDRAW;
    if (isMine(w)) return OWN_TICKET_REASON;
    if (kind === "approve" && w.retiredOperation) return RETIRED_OPERATION_COPY;
    if (kind === "approve" && (w.phoneCalibrationError || w.ambassadorMaterialError)) return w.phoneCalibrationError ?? w.ambassadorMaterialError;
    if (!canDecide(w, kind)) return NO_DECIDE;
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

  /** 框里的关键信息：退款单第一行是退款金额（VS-102）。动作名在标题下面，这里不再写「操作」，单号只写一次（建议 8）。 */
  const ticketFacts = (w: A2OperationRow, kind: "approve" | "reject") => {
    const amount = refundAmount(w);
    const name = kind === "approve" ? "退款金额" : "申请退款金额";
    const timing = kind === "approve" ? g3PolicyExecutionTiming(w) ?? phoneScheduledAt(w) : undefined;
    return (
      <Facts>
        {amount && (amount.state === "ok"
          ? <Fact k={name} lead tone="role-1" unit="USDT">{orderAmount(amount.amount)}</Fact>
          : <Fact k={name} tone="warn">{refundAmountText(amount)}</Fact>)}
        <Fact k="审批单"><span data-mono>{w.id}</span></Fact>
        <Fact k="对象"><span data-mono className="a2-code">{w.obj}</span></Fact>
        <Fact k="发起人">{`${w.operator} · ${roleText(w.operatorRole)}`}</Fact>
        {kind === "approve" && <Fact k="发起理由">{keepCodes(w.reason)}</Fact>}
        {timing && <Fact k="生效时间">{timing}</Fact>}
      </Facts>
    );
  };

  const approveRequest = (w: A2OperationRow): ActionConfirmReq => {
    const isRefund = w.fundEffect === "ORDER_REFUND";
    const isFunds = w.type === "fund" || isRefund || w.fundEffect === "REWARD_SUSPENSION" || w.fundEffect === "REWARD_RESUMPTION";
    const briefKind = isFunds ? "funds" : w.type === "acct" ? "security" : w.type === "sos" ? "emergency" : "config";
    const timing = approvalTiming(w);
    const j4 = isJ4Execution(w);
    const scheduled = phoneScheduledAt(w);
    const g3 = g3PolicyExecutionTiming(w);
    // 一行放得下（必须改 14）；时点只写在「生效时间」一处（建议 8）。
    // 摘要标题行只放得下 20 字左右，长了会折出孤字（D10）；细节写在「说明」和事实区。
    const impact = scheduled || monthlyTargetChange(w) ? timing.impact
      : j4 ? "逐步执行，失败时可能只执行了一部分。"
        : w.coverageCheckOnApproval ? "先查兑付覆盖率，够了才执行，不够不动。"
          : g3 ? "按生效时间执行，改线上配置。"
            : isFunds ? "立即执行，改资金或账目；失败不改原值。"
              : w.type === "acct" ? "立即执行，改账号或权限；失败不改原值。"
                : w.type === "sos" ? "立即执行，停用或恢复业务；失败不改原值。"
                  : "立即执行，改线上配置；失败不改原值。";
    const check = isRefund ? "核对退款金额、订单和发起理由，理由写清依据或工单号。"
      : isFunds ? "核对对象、变更前后和发起理由，理由写清依据或工单号。"
        : w.type === "acct" ? "核对目标账号、申请的角色和发起理由，理由写清依据或工单号。"
          : w.type === "sos" ? "核对值班授权、影响范围和恢复条件，理由写清依据或工单号。"
            : "核对修改前后的值和影响范围，理由写清依据或工单号。";
    const amplifies = w.amplifies && !w.coverageCheckOnApproval;
    return {
      briefKind,
      title: "批准审批单",
      action: <>确认执行 · {w.id}({a2ActionText(w.action)})</>,
      effect: <>{subject(w)}<StatusTag tone="progress" filled>{timing.tag}</StatusTag>{isRefund && <IrreversibleTag />}</>,
      detail: j4
        ? <>中途失败时，前面的步骤可能已经生效。到「监管要求应急处理」的执行追溯里核对每一步。谁能批准：{approvalExecutorLabel(w)}。</>
        : w.coverageCheckOnApproval ? <>{approvalCoverageCopy(w)}</> : <>谁能批准：{approvalExecutorLabel(w)}。{decisionRule(w).backendChecks && `${BACKEND_CHECKS_NOTE}。`}</>,
      facts: ticketFacts(w, "approve"),
      content: (
        <div className="rd-stack">
          <A2ChangeReview operationCode={w.operationCode} before={w.before} after={w.after} omit={g3 ? ["生效时间"] : undefined} />
          {w.phoneCalibrationProposal && <PhoneCalibrationReview proposal={w.phoneCalibrationProposal} />}
          {w.ambassadorMaterialProposal && <AmbassadorMaterialSummary packet={w.ambassadorMaterialProposal} expectedMaterialRevision={w.ambassadorMaterialProposal.applicationDecision === "APPROVE" ? w.ambassadorMaterialProposal.expectedMaterialRevision : undefined} />}
          {isRefund && w.refundOrderNo && <PromotionRefundImpact orderNo={w.refundOrderNo} />}
        </div>
      ),
      statedBrief: { impact, check },
      amplifies,
      // 有覆盖率时事实区写「兑付覆盖率 X，红线 Y」，多付钱和检查时点进问号；读不到时橙黄写出来，不是一句白字（必须改 12）。
      coverage: amplifies ? coverage : undefined,
      coverageLead: amplifies && !coverage ? <span className="a2-coverage-unknown"><AlertTriangle size={14} aria-hidden />会让平台多付钱，兑付覆盖率暂时读不到</span> : undefined,
      coverageCheck: "批准时系统检查兑付覆盖率，低于红线不执行。",
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
    action: <>取消执行 · {w.id} · {a2ActionText(w.action)}</>,
    effect: <>{subject(w)}{immediate}</>,
    detail: <>{w.retiredOperation ? "此操作已退役。驳回后保留历史记录，不能重新发起。" : "驳回后这张单结束，要做需重新发起。"}</>,
    facts: ticketFacts(w, "reject"),
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
    facts: <Facts><Fact k="审批单"><span data-mono>{w.id}</span></Fact><Fact k="对象"><span data-mono className="a2-code">{w.obj}</span></Fact></Facts>,
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
    openActionConfirm(kind === "approve" ? approveRequest(w) : kind === "reject" ? rejectRequest(w) : withdrawRequest(w));
  };

  /* 导出：按已查询的条件（appliedFilter），和其他写操作一样先存原命令（M2）。能不能导按后端查到的结果判断（M4）。 */
  const exportPending = pendingCommands.some((record) => record.kind === "export");
  const exportBlock = !canExport ? undefined
    : exportPending ? "导出有结果未确认，先到页面上方核对"
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
          <Fact k="隐藏">操作者、资源编号、业务编号超过 4 个字符时只留首尾两位；不超过 4 个字符时全部隐藏</Fact>
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
    : pendingParams.has(key) ? "这项有结果未确认的调整，先到页面上方核对"
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
        : { impact: "之后新写的记录带新版本号，历史记录不改。", check: "核对目标版本，理由写清依据或工单号。" };
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
    : retentionPending ? "清理有结果未确认，先到页面上方核对"
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
      run: async (reason) => { await runRetention(reason); },
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
      {locatePending.length > 1 && <> 这个对象还有 {locatePending.length} 条待审批：{locatePending.slice(0, 3).map((w, index) => <span key={w.id}>{index > 0 && "、"}<button type="button" className="rd-link" onClick={() => openTicketFromRecords(w.id)}>{actionName(w.action)} {w.id}</button></span>)}{locatePending.length > 3 && " 等"}</>}
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
      <Notice key={record.fingerprint} tone="warn" title={`${record.label} · 结果未确认`} actionBelow
        action={<>
          <Button size="sm" disabled={!!submitting} onClick={() => void verifyPending(record)}>读回核对</Button>
          <Button size="sm" disabled={!!submitting} disabledReason={retryBlock(record)} onClick={() => void retryPending(record)}>按原操作重试</Button>
          {retryRejected.includes(record.commandKey) && <Button size="sm" disabled={!!submitting} onClick={() => setReleasing(record)}>解除待确认</Button>}
          <Button size="sm" variant="ghost" onClick={() => showInRecords(record)}>在操作记录里查看</Button>
        </>}>
        <p>
          {bizTimeFull(new Date(record.createdAt).toISOString(), "—")}（{zone}）发出，可能已经生效。{expired ? RETRY_EXPIRED : RECOVERY_HINT[record.kind]}
          <Explain label="技术信息" content={`命令号 ${record.commandKey} ｜ 操作人 ${record.operator} ｜ 理由 ${record.reason}`} />
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
      {pendingTicketIds.has(w.id) && <StatusTag tone="warn" explain={PENDING_LOCK}>待核对</StatusTag>}
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
                  const change = changeSummary(w.before, w.after, g3PolicyExecutionTiming(w) ? ["生效时间"] : [], w.operationCode);
                  const name = actionName(w.action);
                  return (
                    <Tr key={w.id} selected={w.id === ticketId} onOpen={() => { if (!submitting) setTicketId(w.id); }}>
                      <Td sticky="start"><Cell main={shortCodes(name)} title={`${name}\n对象：${w.obj}\n${w.id} · ${bizTime(w.rawTs, w.ts)}`} sub={<>{queueTime(w)} · <span data-mono>{w.id}</span></>} /></Td>
                      <Td grow><Cell main={change.main} sub={change.sub} title={`${change.main}${change.sub ? `\n${change.sub}` : ""}`} /></Td>
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
                  const translated = A2_ACTION_NAMES[l.action] !== undefined || a2ActionText(l.action) !== l.action;
                  return (
                    <Tr key={l.id} selected={l.id === logId} onOpen={() => setLogId(l.id)}>
                      <Td sticky="start"><Cell num main={thisYear(logTime(l))} title={logTime(l)} /></Td>
                      <Td><Cell main={middle(l.actor, 16)} sub={logRoleText(l.role) || undefined} title={l.actor} /></Td>
                      <Td><Cell mono={!translated} main={translated ? logActionText(l.action) : middle(l.action, 18)} title={logActionText(l.action)} /></Td>
                      <Td><Cell main={objectCell(l.obj).main} sub={objectCell(l.obj).sub} title={l.obj} /></Td>
                      <Td grow><Cell mono main={l.delta} title={l.delta} /></Td>
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
                    <Td grow><Cell main={actionName(h.action)} title={actionName(h.action)} /></Td>
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
  const shownCanReject = shown ? canDecide(shown, "reject") : false;
  // 有结果未确认的操作时抽屉顶上已有一条提示，这里不再写一遍（DT-12）。
  const shownBlock = shown && (pendingTicketIds.has(shown.id) ? undefined
    : shown.retiredOperation ? RETIRED_OPERATION_COPY
      : shown.phoneCalibrationError ?? shown.ambassadorMaterialError
        ?? (isMine(shown) ? OWN_TICKET_REASON : !shownCanApprove ? NO_DECIDE
          : shownAmount && shownAmount.state !== "ok" && shownAmount.state !== "loading" ? REFUND_AMOUNT_REQUIRED : undefined));
  const judgment: JudgmentRow[] = shown ? [
    // 批准退款是直接出钱、收不回的操作，第一行就是这笔钱（必须改 1，DP-03）。
    ...(shownAmount ? [shownAmount.state === "ok"
      ? { label: "退款金额", value: <span className="a2-amount">{orderAmount(shownAmount.amount)} USDT</span> }
      : { label: "退款金额", state: "warn" as const, value: <>{refundAmountText(shownAmount)}{" "}{shownAmount.state === "error" && shown.refundOrderNo && <InlineRetry onRetry={() => void loadMain()} />}</> }] : []),
    { label: "要做什么", value: actionName(shown.action) },
    { label: "对象", value: <span data-mono className="a2-code">{shown.obj}</span> },
    { label: "发起人", icon: Users, tone: "users", value: `${shown.operator} · ${roleText(shown.operatorRole)}${isMine(shown) ? "（你发起的）" : ""}`, reason: bizTime(shown.rawTs, shown.ts) },
    { label: "发起理由", value: keepCodes(shown.reason) },
    { label: shown.retiredOperation ? "原执行权限" : "谁能批准", value: approvalExecutorLabel(shown),
      reason: !shown.retiredOperation && decisionRule(shown).backendChecks ? BACKEND_CHECKS_NOTE : undefined },
    ...(shownBlock ? [{ label: "不能批准的原因", state: "warn" as const, value: shownBlock }] : []),
    ...(shownTiming ? [{ label: "生效时间", value: shownTiming }] : []),
  ] : [];
  const shownOwn = shown ? isMine(shown) : false;
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
          <span>{readAt ? `${readAt} 读取（${zone}）· ` : ""}不自动刷新</span>
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
          {pendingTicketIds.has(shown.id) && <Notice tone="warn">这条有结果未确认的操作，不要重复处理。状态变了也不算确认。到页面上方核对。</Notice>}
          <JudgmentPoints title={`判断要点 · 时间为${zone}`} rows={judgment} />
          {shown.coverageCheckOnApproval && <Notice tone="warn">{approvalCoverageCopy(shown)}</Notice>}
          {shown.amplifies && !shown.coverageCheckOnApproval && <Notice tone="warn">会让平台多付钱：批准时系统检查兑付覆盖率，低于红线不执行。如已跌破红线请驳回并写明原因。</Notice>}
          {/* J4 逐步执行，中途失败时前面的步骤不回滚，不能写「失败不改原值」（M3）。 */}
          {shown.sos && <Notice tone="danger">{isJ4Execution(shown)
            ? "应急预案逐步执行：中途失败时，前面的步骤可能已经生效。批准前核对值班授权和影响范围，失败后到「监管要求应急处理」的执行追溯里核对每一步。"
            : "应急操作：涉及紧急停用或恢复，请核对值班授权、影响范围和恢复条件后再处理。"}</Notice>}
          <A2ChangeReview operationCode={shown.operationCode} before={shown.before} after={shown.after} omit={g3PolicyExecutionTiming(shown) ? ["生效时间"] : undefined} />
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
            { label: "动作", value: A2_ACTION_NAMES[shownLog.action] !== undefined || a2ActionText(shownLog.action) !== shownLog.action ? logActionText(shownLog.action) : <span data-mono>{shownLog.action}</span> },
            { label: shownLog.action === "A1_SUPER_ADMIN_BREAK_GLASS_RECOVERED" ? "执行人 / 角色" : "操作者 / 角色", icon: Users, tone: "users", value: logRoleText(shownLog.role) ? `${shownLog.actor} · ${logRoleText(shownLog.role)}` : shownLog.actor },
            { label: "对象", value: <span className="a2-code">{shownLog.obj}</span> },
            { label: "前值 → 后值", value: <span data-mono>{shownLog.delta}</span> },
            { label: "原因", value: shownLog.reason || "—" },
          ]} />
          <Fold inset title="技术信息" summary={`请求编号 ${requestNo}`}>
            <Facts>
              <Fact k="IP"><span data-mono>{shownLog.ip}</span></Fact>
              <Fact k="请求编号"><span data-mono>{requestNo}</span></Fact>
              {/* 没翻成中文时「动作」已经是原码，不再写一遍（建议 8）。 */}
              {logActionText(shownLog.action) !== shownLog.action && <Fact k="原始动作码"><span data-mono>{shownLog.action}</span></Fact>}
              <Fact k="角色码"><span data-mono>{shownLog.role}</span></Fact>
            </Facts>
          </Fold>
        </>}
      </Drawer>

      <Drawer open={Boolean(history)} onClose={() => setHistoryId(null)} title="处理过程" icon={History} tone="role-3"
        sub={shownHistory && <><span data-mono>{shownHistory.id}</span> <StatusTag tone={HIST_TONE[shownHistory.st] ?? "done"}>{HIST_LABEL[shownHistory.st] ?? shownHistory.st}</StatusTag></>}
        nav={{ hasPrev: historyIndex > 0, hasNext: historyIndex >= 0 && historyIndex < histPageRows.length - 1, onPrev: () => { if (historyIndex > 0) setHistoryId(histPageRows[historyIndex - 1].id); }, onNext: () => { if (historyIndex >= 0 && histPageRows[historyIndex + 1]) setHistoryId(histPageRows[historyIndex + 1].id); } }}>
        {shownHistory && <>
          <JudgmentPoints title={`判断要点 · 时间为${zone}`} rows={[
            { label: "操作", value: actionName(shownHistory.action) },
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
        explain="分类说明不改变各操作的权限和审批规则。此清单仅作说明。提交审批的操作须由另一位有权管理员批准后生效；直接执行的操作按各页面提示立即生效并保留操作记录。">
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
        explain="重试被拒说明不了原操作的结果，先在操作记录里核对。解除后原操作不再重试，系统仍按这张单现在的状态校验。" />}
    </>
  );
}
