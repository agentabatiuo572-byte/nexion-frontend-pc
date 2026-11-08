"use client";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { a2ActionText, operatorCopyText, shareBaseRateText } from "@/lib/admin/operator-copy";
import { PromotionRefundImpact } from "../promotion-refund-impact";
import { PhoneCalibrationReview } from "../e-tabs/phone-calibration-review";
import { AmbassadorMaterialSummary } from "../f-tabs/f4-ambassador-materials";

/**
 * A2 操作记录与审批（列表页·队列模式，PG-44）。三个页签：待审批（默认）、操作记录（含审批结果）、机制设置。
 *
 * - 待审批和机制设置读不带筛选的总览；操作记录有生效筛选时另读一次带筛选的总览。后端把同一组筛选同时套在
 *   审批单、统计和记录上，不分开读的话待审批数会跟着操作记录的筛选变。
 * - 批准、驳回、撤回、调整机制参数、立即清理：先把命令号和原内容存进本标签页再发；结果未知时关框，
 *   转成页面上方的待确认条，这张单（这项设置、清理）锁住，只能按原操作重试，重试被后端明确拒绝后才能解除（OP-92～OP-96）。
 * - 导出只下载文件、记一条导出记录，不做页面级待确认：框开着时重试用打开时生成的同一个命令号。
 * - 记录只追加：没有改、删记录的接口，页面也不给入口。所有写操作都要填理由。
 */
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Archive, ArrowLeft, ClipboardList, Coins, Copy, Download, FileText, Flame, History, Inbox, ListChecks, Lock, RefreshCw, Siren, SlidersHorizontal, Users } from "lucide-react";
import { AutoGloss } from "@/app/components/kit/gloss";
import {
  BlockState, Button, Cell, ConfigList, ConfigRow, Decision, Drawer, Explain, Fact, Facts, FilterBar, FilterField, Fold, IconButton, Input, InlineRetry,
  IrreversibleTag, JudgmentPoints, Notice, PageHeader, PageTabs, Pager, Panel, ReleaseModal, Segments, Select, Stat, StatBand, StatusTag, Table, TableLoading,
  TableMessage, Td, Th, Tr, useTabIds, type JudgmentRow, type SegmentItem, type StateTone,
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
  matchesA2AuditFilter,
  matchesA2OperationRole,
  normalizeA2AuditFilter,
  parseA2FilterQuery,
  parseA2ReasonMin,
  parseA2SchemaVersion,
  validateA2MechanismValue,
  validateA2AuditFilterRange,
} from "@/lib/admin/a2-policy";
import { A2_MECHANISM_HELP, A2_MECHANISM_WHERE } from "@/lib/admin/config-help/a2";
import { businessClock, businessZone, formatBusinessTimeCompact, formatBusinessTimeFull } from "@/lib/admin/business-time";
import { createPendingMutationStore, isRetryExpired, type PendingMutationExtra, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { canApprovePending, type AuthPrincipal } from "@/lib/admin/ops-authority";
import { isH7VoucherApproval } from "@/lib/admin/h7-voucher-approval";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { announcePermissionDenied, isPermissionDenied } from "@/lib/admin/operation-confirm-error";
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

/** 本页自己的动作码（需要产品决定 1，按 A 定）。其余原样显示，「动作」筛选仍按原码查。 */
const A2_ACTION_NAMES: Record<string, string> = {
  A2_OPERATION_PROPOSED: "提交审批",
  A2_OPERATION_APPROVED: "批准审批单",
  A2_OPERATION_REJECTED: "驳回审批单",
  A2_OPERATION_WITHDRAWN: "撤回审批单",
  A2_OPERATION_EXECUTED: "直接执行",
  A2_MECHANISM_PARAM_CHANGED: "修改机制参数",
  A2_AUDIT_EXPORTED: "导出操作记录",
  A2_AUDIT_RETENTION_MANUAL_EXECUTED: "手动清理到期记录",
  A2_AUDIT_RETENTION_EXECUTED: "定时清理到期记录",
};

const OWN_TICKET_REASON = "这是你发起的，需要另一位管理员处理";
const RETIRED_OPERATION_COPY = "此操作已退役，不能批准或重新发起；保留原申请和历史记录，待审申请可按原权限驳回或撤回。";
const COVERAGE_ON_APPROVAL_COPY = "批准执行时，系统会检查兑付覆盖率。低于红线时，审批单继续待处理，账户组状态和提现限制保持原样。";
const PENDING_LOCK = "这条有结果未确认的操作，先到页面上方核对";
const RELOADING = "审批单还在读取，读完再处理";
const SUBMITTING = "正在提交";
const NO_WITHDRAW = "你没有撤回申请的权限";
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
  return w.ambassadorMaterialProposal?.applicationDecision === "APPROVE"
    ? "另一位具有审批和大使批准权限、且未参与本版材料核验的管理员"
    : w.roleGate === "超管" ? "超级管理员" : w.roleGate;
}

function isCurrentOperator(w: A2OperationRow, username: string | undefined) {
  return w.mine || (!!username && username === w.operator);
}

function g3PolicyExecutionTiming(w: A2OperationRow) {
  const g3 = w.obj === "weekly" && /^提高周价格计划·D[1-7]·(?:目标价（USDT\/UVT）|上涨概率)$/.test(w.action)
    || w.obj === "currentPrice" && w.action === "提高当前UVT价格"
    || w.obj === "schedule" && w.action === "首次配置UVT自动推进";
  if (!g3) return undefined;
  try {
    const review = JSON.parse(w.after) as Record<string, unknown>;
    if (review && typeof review["生效时间"] === "string") return review["生效时间"];
  } catch { /* Historical incomplete review text retains the G3 timing reminder. */ }
  return "批准后按完整变更内容注明的时点生效，请先核对";
}

function roleText(role: string) {
  return ["super", "superadmin", "super_admin", "超管"].includes(role.trim().toLowerCase()) ? "超级管理员" : role;
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

type A2CommandKind = "approve" | "reject" | "withdraw" | "param" | "retention";
type A2PendingCommand = PendingMutationRecord & {
  kind: A2CommandKind;
  /** 待确认条上写的「做了什么」。 */
  label: string;
  /** 审批单号、参数键或 retention。 */
  target: string;
  reason: string;
  operator: string;
  /** 机制参数的新值。 */
  value?: string;
  /** 重试时按这个判断批准权（J1 恢复、A4 登记、代金券）。 */
  operationCode?: string;
  /** 审批单的原动作，重试时写进标签。 */
  action?: string;
};
type A2PendingExtra = PendingMutationExtra<A2PendingCommand>;

const a2Commands = createPendingMutationStore<A2PendingCommand>({
  storageKey: "nexion-admin-a2-commands-v1",
  // 过期后不能再用原号重试，记录和锁都留着（OP-96）。
  retainExpiredRecords: true,
});

const DECISION_VERB: Record<"approve" | "reject" | "withdraw", string> = { approve: "批准", reject: "驳回", withdraw: "撤回" };
const DECISION_STATUS: Record<"approve" | "reject" | "withdraw", A2OperationRow["status"]> = { approve: "approved", reject: "rejected", withdraw: "withdrawn" };
const RECOVERY_HINT: Record<A2CommandKind, string> = {
  approve: "读回只看这张单现在的状态，说明不了这次操作的结果。可以按原操作重试，不会重复执行。",
  reject: "读回只看这张单现在的状态，说明不了这次操作的结果。可以按原操作重试，不会重复执行。",
  withdraw: "读回只看这张单现在的状态，说明不了这次操作的结果。可以按原操作重试，不会重复执行。",
  param: "读回只看现在的值，值相同也可能是别人改的。可以按原操作重试，不会重复执行。",
  retention: "按原操作重试会用原来的命令号，已完成的清理不会再做一次。",
};
const PARAM_NAME: Record<string, string> = { ttl: "操作理由最短长度", retention: "操作记录保留期", schema: "记录字段版本" };
const PARAM_AUDIT_OBJECT: Record<A2CommandKind, string | undefined> = { approve: undefined, reject: undefined, withdraw: undefined, param: "A2_MECHANISM_PARAM", retention: "A2_AUDIT_RETENTION" };

function backendCode(error: unknown) {
  return error instanceof Error && "backendMessage" in error && typeof error.backendMessage === "string" ? error.backendMessage : "";
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

/** 详情与批准确认均完整展示已持久化的前后值。 */
export function A2ChangeReview({ before, after }: { before: string; after: string }) {
  const labels: Record<string, string> = {
    skuId: "商品编号", id: "商品编号", name: "商品名称", tier: "商品档位", tagline: "卖点", badge: "角标",
    gpu: "GPU", vram: "显存", hashRate: "算力", power: "功耗", datacenter: "数据中心", uptime: "在线率",
    warranty: "保修", phoneDailyEarn: "手机日产收益", phoneDailyEarnNex: "手机日产 UVT", price: "价格", computePoints: "每件算力点",
    dailyEarn: "日产收益", dailyEarnNex: "日产 UVT", shareYieldMin: "份额收益下限", shareYieldMax: "份额收益上限",
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
  const format = (value: unknown): string => {
    if (value === null) return "未设置";
    if (Array.isArray(value)) return value.length ? value.map(format).join("\n\n") : "无";
    if (typeof value === "object") return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `${labels[key] ?? key}：${key === "peerBonusRate" && typeof item === "number" ? `${(item * 100).toFixed(2)}%` : key === "baseRate" && typeof item === "string" ? shareBaseRateText(item) : format(item)}`).join("\n") || "无（新建）";
    return typeof value === "boolean" ? (value ? "是" : "否") : String(value);
  };
  const review = (value: string) => {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" ? format(parsed) : value;
    } catch { return value; }
  };
  return <dl className="a2-change-review" aria-label="完整变更内容">
    <div><dt>变更前</dt><dd>{review(before)}</dd></div>
    <div><dt>变更后</dt><dd>{review(after)}</dd></div>
  </dl>;
}

/* ────────────────── 页面 ────────────────── */

export function A2Audit({ ctx }: { ctx: ACtx }) {
  const { toast, openActionConfirm } = ctx;
  const operator = useAdminAuth((s) => s.operator || s.session?.operator || s.session?.username || "");
  const session = useAdminAuth((s) => s.session);
  const principal = {
    name: session?.operator || session?.username || operator,
    role: session?.role,
    authorities: session?.authorities ?? [],
  } as AuthPrincipal;
  const canApprove = canApprovePending(principal);
  const canDecide = (ticket: Pick<A2OperationRow, "operationCode">) => canApprove
    && (ticket.operationCode !== "j1_gate_resume"
      || principal.role === "superadmin" && principal.authorities.includes("emergency_j1_gate_resume"))
    && (!["a4_schema_register", "a4_schema_property_add", "a4_domain_extension_register"].includes(ticket.operationCode ?? "")
      || principal.role === "superadmin")
    && (!isH7VoucherApproval(ticket.operationCode) || principal.authorities.includes("growth_h7_write"));
  const canExport = canAccessA2Export(principal.authorities);
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

  /** 页头「刷新」：重读当前需要的总览（一次或两次）、清理范围和上次手动清理，不动已应用条件（ST-50）。 */
  const refreshAll = () => Promise.all([
    loadMain().catch(() => undefined),
    loadFiltered(appliedRef.current),
    refreshRetentionPreview(),
    refreshRetentionRun(),
  ]);

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
  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    const write = (name: string, value: string | number, fallback: string | number) => {
      if (value === fallback || value === "") url.searchParams.delete(name);
      else url.searchParams.set(name, String(value));
    };
    write("tab", tab, "pending");
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

  const logRows = useMemo(() => (records?.recentLogs ?? []).filter((l) => matchesA2AuditFilter(l, appliedFilter)), [records, appliedFilter]);
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

  const runDecision = (kind: "approve" | "reject" | "withdraw", w: Pick<A2OperationRow, "id" | "action" | "operationCode">, reason: string, by = operator) => sendCommand(
    `${kind}|${w.id}`,
    { kind, label: `${DECISION_VERB[kind]} · ${actionName(w.action)}`, target: w.id, reason, operator: by, operationCode: w.operationCode, action: w.action },
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
    { kind: "param", label: key === "schema" ? "升级记录字段版本" : `调整${PARAM_NAME[key]}`, target: key, value, reason, operator: by },
    `a2-mechanism-${key}`,
    (commandKey) => updateA2MechanismParam(key, value, reason, commandKey),
    async () => paramReadback(await loadMain(), key) === value,
  );

  const runRetention = async (reason: string, by = operator) => {
    const box: { result?: RetentionExecution } = {};
    const outcome = await sendCommand(
      "retention",
      { kind: "retention", label: "立即清理到期记录", target: "retention", reason, operator: by },
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

  const decisionToast = (kind: "approve" | "reject" | "withdraw", id: string) => toast(`${id} 已${DECISION_VERB[kind]}`, "success");
  const paramToast = (key: "ttl" | "retention" | "schema", value: string) => toast(key === "ttl" ? `理由最短长度已改为 ${value} 字`
    : key === "retention" ? `保留期已改为 ${value} 个月` : `字段版本已升级为 ${value}`, "success");

  /* ────────────────── 待确认条 ────────────────── */

  const notePending = (record: A2PendingCommand, text: string) =>
    setPendingNotes((current) => ({ ...current, [record.fingerprint]: `${businessClock(Date.now())} ${text}` }));

  /** 重试也是写操作，按这个账号现在的权限判断，和原入口一样（OP-124）。读回核对不受影响。 */
  const canRetry = (record: A2PendingCommand) => record.kind === "withdraw" ? canWithdraw
    : record.kind === "param" || record.kind === "retention" ? canWrite
      : canDecide({ operationCode: record.operationCode });

  /** 按原操作重试：同命令号、同内容、同理由，不接受新输入（OP-94）。只有成功并读回到目标状态才解除待确认。 */
  const retryPending = async (record: A2PendingCommand) => {
    if (isRetryExpired(record)) { notePending(record, RETRY_EXPIRED); return; }
    if (!canRetry(record)) { notePending(record, RETRY_NO_PERMISSION); return; }
    if (!a2Commands.isDurablyStored(record.fingerprint, record.commandKey)) {
      notePending(record, "浏览器里查不到这条记录，本次没有发送。待确认继续保留，请在「操作记录」里核对。");
      return;
    }
    setRetryRejected((current) => current.filter((key) => key !== record.commandKey));
    try {
      const ticketLike = { id: record.target, action: record.action ?? record.target, operationCode: record.operationCode };
      const outcome = record.kind === "param" ? await runParam(record.target as "ttl" | "retention" | "schema", record.value ?? "", record.reason, record.operator)
        : record.kind === "retention" ? await runRetention(record.reason, record.operator)
          : await runDecision(record.kind, ticketLike, record.reason, record.operator);
      if (outcome === "ok") toast(`已确认：${record.label}已生效`, "success");
      else notePending(record, "重试的结果仍未确认，待确认继续保留。");
    } catch (cause) {
      if (isPermissionDenied(cause)) announcePermissionDenied();
      notePending(record, `重试没有成功：${displayAdminError(cause)} 这说明不了原操作的结果，原记录继续保留。`);
      setRetryRejected((current) => [...current, record.commandKey]);
    }
  };

  /** 读回只给现在的事实，不解除（OP-93、OP-95）。 */
  const verifyPending = async (record: A2PendingCommand) => {
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
    toast(record.kind === "param" ? "已解除待确认，这项设置可以重新调整" : record.kind === "retention" ? "已解除待确认，可以重新清理" : "已解除待确认，这张单可以重新处理", "success");
  };

  /** 「在操作记录里查看」：切到操作记录，对象填审批单号或机制、清理的资源名，模块不限。 */
  const showInRecords = (record: A2PendingCommand) => {
    const next: A2AuditFilter = { object: PARAM_AUDIT_OBJECT[record.kind] ?? record.target };
    applyFilter(next);
    chooseTab("records");
    setView("logs");
  };

  /* ────────────────── 确认框 ────────────────── */

  const immediate = <StatusTag tone="progress" filled>立即生效</StatusTag>;

  /** 本人、已退役、解析不了、没有权限、有未确认操作、正在读取：入口先禁用并写原因（第五节）。 */
  const decideBlock = (w: A2OperationRow, kind: "approve" | "reject" | "withdraw") => {
    if (submitting) return SUBMITTING;
    if (pendingTicketIds.has(w.id)) return PENDING_LOCK;
    if (mainLoading) return RELOADING;
    if (kind === "withdraw") return canWithdraw ? undefined : NO_WITHDRAW;
    if (isMine(w)) return OWN_TICKET_REASON;
    if (kind === "approve" && w.retiredOperation) return RETIRED_OPERATION_COPY;
    if (kind === "approve" && (w.phoneCalibrationError || w.ambassadorMaterialError)) return w.phoneCalibrationError ?? w.ambassadorMaterialError;
    return canDecide(w) ? undefined : "这个账号没有批准权限";
  };

  /** 已被别人处理（终态、状态变了）：框留着，写最新状态，确认按钮禁用（OP-97）。 */
  const staleReason = (w: A2OperationRow, kind: "approve" | "reject" | "withdraw", cause: unknown) => {
    if (!["A2_OPERATION_ALREADY_TERMINAL", "A2_WITHDRAW_STALE"].includes(backendCode(cause))) return undefined;
    const found = ticketStatus(mainRef.current, w.id);
    const now = found && found.status !== "pending" ? `「${HIST_LABEL[found.status] ?? found.status}」` : "已处理";
    return `这张单现在${found && found.status !== "pending" ? `是${now}` : now}，这次${DECISION_VERB[kind]}没有执行。关闭后看最新状态。`;
  };

  const ticketFacts = (w: A2OperationRow, withReason: boolean) => (
    <Facts>
      <Fact k="操作">{actionName(w.action)}</Fact>
      <Fact k="审批单"><span data-mono>{w.id}</span></Fact>
      <Fact k="对象">{w.obj}</Fact>
      <Fact k="发起人">{`${w.operator} · ${roleText(w.operatorRole)}`}</Fact>
      {withReason && <Fact k="发起理由">{w.reason}</Fact>}
    </Facts>
  );

  const approveRequest = (w: A2OperationRow): ActionConfirmReq => {
    const isRefund = w.fundEffect === "ORDER_REFUND";
    const isFunds = w.type === "fund" || isRefund || w.fundEffect === "REWARD_SUSPENSION" || w.fundEffect === "REWARD_RESUMPTION";
    const briefKind = isFunds ? "funds" : w.type === "acct" ? "security" : w.type === "sos" ? "emergency" : "config";
    const timing = g3PolicyExecutionTiming(w);
    const brief = isFunds
      ? { impact: "批准后立即执行，会改变用户资金或平台账目；执行失败不改原值，单子继续待审批。", check: "核对对象、金额、变更前后和发起理由，理由写清依据或工单号。" }
      : w.type === "acct"
        ? { impact: "批准后立即执行，会改变后台账号、权限或用户登录；执行失败不改原值。", check: "核对目标账号、申请的角色和发起理由，理由写清依据或工单号。" }
        : w.type === "sos"
          ? { impact: "批准后立即执行，会改变业务的停用或恢复状态；执行失败不改原值。", check: "核对值班授权、影响范围和恢复条件，理由写清依据或工单号。" }
          : { impact: "批准后立即执行，按完整变更内容改线上配置；执行失败不改原值。", check: "核对修改前后的值和影响范围，理由写清依据或工单号。" };
    return {
      briefKind,
      title: "批准审批单",
      action: <>确认执行 · {w.id}({a2ActionText(w.action)})</>,
      effect: <StatusTag tone="progress" filled>{w.coverageCheckOnApproval ? "通过覆盖率检查后执行" : timing ? "按变更内容注明的时点生效" : "立即生效"}</StatusTag>,
      detail: <>谁能批准：{approvalExecutorLabel(w)}。</>,
      facts: ticketFacts(w, true),
      content: (
        <div className="rd-stack">
          <A2ChangeReview before={w.before} after={w.after} />
          {w.phoneCalibrationProposal && <PhoneCalibrationReview proposal={w.phoneCalibrationProposal} />}
          {w.ambassadorMaterialProposal && <AmbassadorMaterialSummary packet={w.ambassadorMaterialProposal} expectedMaterialRevision={w.ambassadorMaterialProposal.applicationDecision === "APPROVE" ? w.ambassadorMaterialProposal.expectedMaterialRevision : undefined} />}
          {isRefund && w.refundOrderNo && <PromotionRefundImpact orderNo={w.refundOrderNo} />}
        </div>
      ),
      completionCopy: w.coverageCheckOnApproval ? approvalCoverageCopy(w) : timing,
      statedBrief: brief,
      amplifies: w.amplifies && !w.coverageCheckOnApproval,
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
          throw cause;
        }
      },
    };
  };

  const rejectRequest = (w: A2OperationRow): ActionConfirmReq => ({
    briefKind: "record",
    title: "驳回审批单",
    action: <>取消执行 · {w.id} · {a2ActionText(w.action)}</>,
    effect: <>{immediate}<IrreversibleTag /></>,
    detail: <>{w.retiredOperation ? "此操作已退役。驳回后保留历史记录，不能重新发起。" : "驳回后不能恢复，如需再做请重新发起。"}</>,
    facts: ticketFacts(w, false),
    statedBrief: w.retiredOperation
      ? { impact: "审批单改为已驳回，原操作不执行。", check: "理由写清驳回依据或工单号。" }
      : { impact: "审批单改为已驳回，原操作不执行，这个对象可以重新发起修改。", check: "理由写清驳回依据或工单号。" },
    amplifies: false,
    reasonMin,
    reasonMax: 200,
    confirmLabel: "确认驳回",
    confirmTone: "danger",
    run: async (reason) => {
      try {
        const outcome = await runDecision("reject", w, reason);
        if (outcome === "ok") { decisionToast("reject", w.id); setTicketId(null); }
      } catch (cause) {
        const stale = staleReason(w, "reject", cause);
        if (stale) openActionConfirm({ ...rejectRequest(w), blockedReason: stale });
        throw cause;
      }
    },
  });

  const withdrawRequest = (w: A2OperationRow): ActionConfirmReq => ({
    briefKind: "record",
    title: "撤回我的申请",
    action: <>撤回我的申请 · {w.id}</>,
    effect: immediate,
    detail: <>撤回后原操作不会执行。只有申请人本人能撤回。</>,
    facts: <Facts><Fact k="操作">{actionName(w.action)}</Fact><Fact k="审批单"><span data-mono>{w.id}</span></Fact></Facts>,
    statedBrief: { impact: "审批单改为已撤回，原操作不执行。", check: "理由写清撤回原因或工单号。" },
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

  /* 导出：按已查询的条件（appliedFilter），不做页面级待确认，见文件头。 */
  const exportBlock = !canExport ? undefined
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
    const commandKey = createA2CommandKey("a2-audit-export");
    const scope = appliedText(appliedFilter);
    openActionConfirm({
      briefKind: "export",
      action: "导出操作记录",
      effect: immediate,
      detail: null,
      facts: (
        <Facts>
          <Fact k="范围">{scope || "全部模块，不限时间"}</Fact>
          <Fact k="文件">CSV，最多 5,000 条</Fact>
          <Fact k="隐藏">操作者、资源编号、业务编号只留首尾两位</Fact>
        </Facts>
      ),
      statedBrief: { impact: "按已查询的条件生成 CSV 并下载，这次导出记入操作记录。", check: "核对导出范围，理由写明导出依据或工单号。" },
      amplifies: false,
      reasonMin,
      reasonMax: 200,
      confirmLabel: "确认导出",
      run: async (reason) => {
        const file = await exportA2Audit(reason, normalizeA2AuditFilter(appliedRef.current), commandKey);
        toast(`已下载 ${file.fileName}`, "success");
        void refreshAfterWrite();
      },
    });
  };

  /* 机制参数：理由最短长度、保留期、字段版本。e2e 认框名「操作理由最短长度」和默认按钮「确认提交」，不传 title 和 confirmLabel。 */
  const paramBlock = (key: string) => submitting ? SUBMITTING
    : pendingParams.has(key) ? "这项有结果未确认的调整，先到页面上方核对"
      : mainLoading ? "设置还在读取，读完再调整" : undefined;

  const adjustParam = (key: "ttl" | "retention" | "schema") => {
    if (paramBlock(key)) return;
    const raw = mechanismParams.find((p) => p.key === key)?.value;
    const current = key === "schema" ? schemaVersion(raw) || "v3" : raw?.match(/\d+/)?.[0] ?? (key === "ttl" ? "8" : "13");
    const edit: ActionConfirmReq["edit"] = key === "ttl"
      ? { kind: "number", current, unit: "字", min: 8, max: 200, step: 1, disallowCurrent: true, hint: "8–200 的整数",
        preview: (v) => `改成 ${v} 字：之后所有确认框的理由少于 ${v} 个可见字符就不能提交，已有记录不受影响。` }
      : key === "retention"
        ? { kind: "number", current, unit: "月", min: 13, max: 36, step: 1, disallowCurrent: true, hint: "13–36 的整数，至少覆盖一个完整的 12 个月运营周期",
          preview: (v) => `改成 ${v} 个月：之后新写的记录在线保留 ${v} 个月，已有记录按原到期时间。` }
        : { kind: "text", current, unit: "", disallowCurrent: true, hint: "只能逐版升级到已登记的版本（目前有 v3、v4）。新事件或字段请先在「用户行为事件」登记。",
          validate: (v) => { const result = validateA2MechanismValue("schema", v, current); return result.ok ? undefined : `${result.message}。`; } };
    const brief = key === "ttl"
      ? { impact: "全后台的确认框按新字数检查理由，已有记录不受影响。", check: "核对新字数，理由写清依据或工单号。" }
      : key === "retention"
        ? { impact: "只对之后新写的操作记录生效，已有记录按自己的到期时间。", check: "核对新值，理由写清依据或工单号。" }
        : { impact: "之后的新记录和导出带新版本号，历史记录不改。", check: "核对目标版本，理由写清依据或工单号。" };
    openActionConfirm({
      briefKind: "config",
      action: key === "ttl" ? "操作理由最短长度" : key === "retention" ? "操作记录保留期" : "升级记录字段版本",
      effect: immediate,
      detail: null,
      edit,
      statedBrief: brief,
      amplifies: false,
      reasonMin,
      reasonMax: 200,
      run: async (reason, v) => {
        const validation = validateA2MechanismValue(key, v ?? "", key === "schema" ? current : undefined);
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
          : !main || mainLoading ? "设置还在读取，读完再清理" : undefined;

  const confirmRetention = () => {
    // 服务端预览拿不到时不允许执行：操作前说不清范围的不可撤销操作，宁可挡住。
    if (!canWrite || retentionBlock || !retentionPreview) return;
    const preview = retentionPreview;
    openActionConfirm({
      briefKind: "record",
      action: <>归档并清理已到期操作记录</>,
      effect: <>{immediate}<IrreversibleTag /></>,
      detail: null,
      facts: (
        <Facts>
          <Fact k="可清理" lead unit="条">{count(preview.eligibleRows)}</Fact>
          <Fact k="最早到期">{preview.earliestExpireAt ? bizTime(preview.earliestExpireAt, preview.earliestExpireAt) : "—"}</Fact>
          <Fact k="未到期（不受影响）">{`${count(preview.notYetExpiredRows)} 条`}</Fact>
          <Fact k="旧版历史（不受影响）">{`${count(preview.legacyRowsWithoutExpireAt)} 条`}</Fact>
          <Fact k="保留期">{`${preview.retentionMonths} 个月`}</Fact>
          <Fact k="每次最多处理">2,000 条</Fact>
        </Facts>
      ),
      statedBrief: { impact: "到期记录先长期归档，再从在线列表移除，不能撤销；未到期和旧版历史记录不动。", check: "核对可清理条数和最早到期时间，理由写清依据或工单号。" },
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
    return (
      <Notice key={record.fingerprint} tone="warn" title={`${record.label} · 结果未确认`} actionBelow
        action={<>
          <Button size="sm" disabled={!!submitting} onClick={() => void verifyPending(record)}>读回核对</Button>
          <Button size="sm" disabled={!!submitting} disabledReason={expired ? RETRY_EXPIRED : canRetry(record) ? undefined : RETRY_NO_PERMISSION} onClick={() => void retryPending(record)}>按原操作重试</Button>
          {retryRejected.includes(record.commandKey) && <Button size="sm" disabled={!!submitting} onClick={() => setReleasing(record)}>解除待确认</Button>}
          <Button size="sm" variant="ghost" onClick={() => showInRecords(record)}>在操作记录里查看</Button>
        </>}>
        <p>
          {bizTimeFull(new Date(record.createdAt).toISOString(), "—")}（{zone}）发出，可能已经生效。{expired ? RETRY_EXPIRED : RECOVERY_HINT[record.kind]}
          <Explain label="技术信息" content={`命令号 ${record.commandKey} ｜ 操作人 ${record.operator} ｜ 理由 ${record.reason}`} />
        </p>
        {pendingNotes[record.fingerprint] && <p>{pendingNotes[record.fingerprint]}</p>}
      </Notice>
    );
  });

  /* 待审批：行内按钮都是小号次按钮，点了只开确认框（D2 新手测试）。整屏主按钮只有抽屉里的「批准」（DP-40）。 */
  const rowActions = (w: A2OperationRow) => {
    const own = isMine(w);
    if (w.retiredOperation && !own && !canDecide(w)) return <span className="rd-weak">{WAIT_OTHERS}</span>;
    if (own) return <Button size="sm" disabledReason={decideBlock(w, "withdraw")} onClick={() => confirmDecision(w, "withdraw")}>撤回我的申请</Button>;
    if (!canDecide(w)) return <span className="rd-weak">{WAIT_OTHERS}</span>;
    return <>
      <Button size="sm" disabledReason={decideBlock(w, "reject")} onClick={() => confirmDecision(w, "reject")}>驳回</Button>
      {!w.retiredOperation && <Button size="sm" disabledReason={decideBlock(w, "approve")} onClick={() => confirmDecision(w, "approve")}>批准</Button>}
    </>;
  };

  const markers = (w: A2OperationRow) => {
    const tags = <>
      {w.sos && <StatusTag tone="danger" icon={Siren}>应急</StatusTag>}
      {w.amplifies && <StatusTag tone="warn" icon={Flame}>多付钱</StatusTag>}
    </>;
    return w.sos || w.amplifies ? <span className="rd-row-actions">{tags}</span> : TYPE_NAME[w.type];
  };

  const pendingTab = (
    <>
      {mainError && !main ? (
        <BlockState state="error" title="审批单读取失败，不显示旧数据" detail={mainError} onRetry={() => void loadMain().catch(() => undefined)} retrying={mainLoading} />
      ) : <>
        <StatBand label="待审批汇总" fit>
          <Stat lead tone="warn" icon={Inbox} label="待审批" value={stats ? stats.pendingTickets : "—"} unit={stats ? "条" : undefined}
            sub={mineCount > 0 ? `其中你发起的 ${mineCount} 条` : undefined} onOpen={() => { setQType("all"); setQPage(1); }} openLabel="看全部待审批" />
          <Stat tone="danger" icon={Siren} label="应急" value={stats ? stats.sosTickets : "—"} unit={stats ? "条" : undefined}
            explain="紧急停用的恢复申请和应急预案执行，排在最前。" onOpen={() => { setQType("sos"); setQPage(1); }} openLabel="只看应急" />
          <Stat tone="role-1" icon={Coins} label="资金类" value={stats ? stats.fundTickets : "—"} unit={stats ? "条" : undefined}
            explain="会改变用户资金、提现或平台账目的审批单。" onOpen={() => { setQType("fund"); setQPage(1); }} openLabel="只看资金类" />
        </StatBand>

        <FilterBar scope={<Segments label="审批单类型" value={qType} items={TYPE_ITEMS} onChange={(value) => { setQType(value); setQPage(1); }} />}>
          <FilterField><Select aria-label="发起人" value={qOperator} onChange={(value) => { setQOperator(value as QOperator); setQPage(1); }} options={OPERATOR_OPTIONS} /></FilterField>
        </FilterBar>

        <Panel flush icon={ClipboardList} tone="role-3" title="待审批的操作" sub={`应急在前，资金类其次，其余按提交时间从新到旧 · 时间为${zone}`}>
          <Table label="待审批的操作">
            <thead><tr>
              <Th sticky="start">审批单</Th>
              <Th>对象</Th>
              <Th>变更</Th>
              <Th icon={Users} tone="users">发起人</Th>
              <Th>标记</Th>
              <Th sticky="end">操作</Th>
            </tr></thead>
            <tbody>
              {!main && mainLoading ? <TableLoading columns={6} rows={5} />
                : qPageRows.length === 0 ? (
                  <TableMessage columns={6} role="status">
                    {queueFiltered ? <>没有符合条件的待审批操作 <Button size="sm" onClick={() => { setQType("all"); setQOperator("all"); setQPage(1); }}>清除筛选</Button></> : "没有待审批的操作"}
                  </TableMessage>
                ) : qPageRows.map((w) => {
                  const changeText = w.action.startsWith("首次配置 V0–V8") ? "创建 V0–V8 共 9 个等级，点击本行核对完整配置" : w.after;
                  return (
                    <Tr key={w.id} selected={w.id === ticketId} onOpen={() => { if (!submitting) setTicketId(w.id); }}>
                      <Td sticky="start"><Cell main={actionName(w.action)} title={actionName(w.action)} sub={<><span data-mono>{w.id}</span> · {bizTime(w.rawTs, w.ts)}</>} /></Td>
                      <Td><Cell main={w.obj} title={w.obj} /></Td>
                      <Td grow><Cell main={changeText} sub={`原 ${w.before}`} title={`变更前：${w.before}\n变更后：${changeText}`} /></Td>
                      <Td><Cell main={w.operator} sub={`${roleText(w.operatorRole)}${isMine(w) ? " · 你发起的" : ""}`} /></Td>
                      <Td><Cell main={markers(w)} sub={w.retiredOperation ? <StatusTag tone="done">已退役</StatusTag> : undefined} /></Td>
                      <Td sticky="end"><span className="rd-row-actions">{rowActions(w)}</span></Td>
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
  const recordsTab = (
    <>
      {locateNotice}
      <FilterBar
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
        <FilterField label="模块">
          <Select aria-label="审计业务域" value={filterDraft.domain && filterDraft.domain !== "all" ? filterDraft.domain : ""} onChange={(value) => setDraft("domain", value)}
            options={[{ value: "", label: "全部模块" }, ...A2_AUDIT_DOMAINS.map((domain) => ({ value: domain, label: DOMAIN_NAMES[domain] }))]} />
        </FilterField>
        <FilterField label="操作者"><Input aria-label="审计操作者" placeholder="账号或姓名" value={filterDraft.operator ?? ""} onChange={(event) => setDraft("operator", event.target.value)} /></FilterField>
        <FilterField label="对象"><Input aria-label="审计对象" placeholder="对象编号或类型" value={filterDraft.object ?? ""} onChange={(event) => setDraft("object", event.target.value)} /></FilterField>
      </FilterBar>

      <div className="rd-toolbar">
        <Segments label="操作记录视图" value={view} onChange={(next) => { setLogId(null); setHistoryId(null); setView(next); }}
          items={[{ value: "logs", label: "操作记录" }, { value: "history", label: "审批结果" }]} />
        <Explain label="两个视图的说明" content="两个视图共用上面的筛选，导出只导操作记录。" />
      </div>

      {recordsError && !records ? (
        <Panel flush icon={view === "logs" ? FileText : History} tone="role-3" title={view === "logs" ? "操作记录" : "审批结果"}>
          <Table label={view === "logs" ? "操作记录" : "审批结果"}><tbody>
            <TableMessage columns={logColumns} role="alert">操作记录读取失败，不显示旧数据：{recordsError} <Button size="sm" onClick={() => void (hasApplied ? loadFiltered(appliedFilter) : loadMain().catch(() => undefined))}>重试</Button></TableMessage>
          </tbody></Table>
        </Panel>
      ) : view === "logs" ? (
        <Panel flush icon={FileText} tone="role-3" title="操作记录"
          sub={recordStats ? `今日 ${count(recordStats.todayAuditEvents)} 条 · ${(records?.recentLogs.length ?? 0) >= 200 ? "已显示最近 200 条，更早的缩小时间范围再查" : "最多显示最近 200 条"}` : undefined}
          explain="「今日」按业务日历的今天，跟着上面的筛选变。">
          <Table label="操作记录">
            <thead><tr>
              <Th sticky="start">时间（{zone}）</Th>
              <Th icon={Users} tone="users">操作者</Th>
              <Th><span>动作<Explain label="动作名的说明" content="中文是本页的操作；英文是系统动作名，可以复制到「动作」筛选里查。" /></span></Th>
              <Th>对象</Th>
              <Th>前 → 后</Th>
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
                      <Td sticky="start"><Cell num main={logTime(l)} /></Td>
                      <Td><Cell main={l.actor} sub={l.role} /></Td>
                      <Td><Cell mono={!translated} main={logActionText(l.action)} title={logActionText(l.action)} /></Td>
                      <Td><Cell main={l.obj} title={l.obj} /></Td>
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
          explain="按上面的筛选数全部处理过的审批单，不分时间段。">
          <Table label="审批结果">
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
                    <Td><Cell num main={bizTime(h.t, h.t)} /></Td>
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
              return <ConfigRow key={p.key} {...common} value={<span className="a2-locked"><Lock size={13} aria-hidden />必填<Explain label="操作理由必填的说明" content="系统固定，不能关闭" /></span>} />;
            }
            if (p.key === "confirm_list") {
              return <ConfigRow key={p.key} {...common} note={undefined} value={confirmCategories.length ? `${confirmCategories.length} 类` : "暂无分类说明"}
                action={(describedBy) => <Button size="sm" aria-describedby={describedBy} onClick={() => setConfirmListOpen(true)}>查看清单</Button>} />;
            }
            if (p.key === "ttl" || p.key === "retention" || p.key === "schema") {
              const key = p.key;
              const top = key === "schema" && schemaNow === "v4";
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
            <div><dt>可清理</dt><dd>{count(retentionPreview.eligibleRows)} 条</dd></div>
            <div><dt>最早到期</dt><dd>{retentionPreview.earliestExpireAt ? bizTime(retentionPreview.earliestExpireAt, retentionPreview.earliestExpireAt) : "—"}</dd></div>
            <div><dt>未到期</dt><dd>{count(retentionPreview.notYetExpiredRows)} 条</dd></div>
            <div><dt>旧版历史<Explain label="旧版历史的说明" content="没有到期时间的旧记录，清理不会动它们。" /></dt><dd>{count(retentionPreview.legacyRowsWithoutExpireAt)} 条</dd></div>
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
  const shownTiming = shown ? g3PolicyExecutionTiming(shown) : undefined;
  const shownBlock = shown && (pendingTicketIds.has(shown.id) ? PENDING_LOCK
    : shown.retiredOperation ? RETIRED_OPERATION_COPY
      : shown.phoneCalibrationError ?? shown.ambassadorMaterialError
        ?? (isMine(shown) ? OWN_TICKET_REASON : canDecide(shown) ? undefined : "这个账号没有批准权限"));
  const judgment: JudgmentRow[] = shown ? [
    { label: "要做什么", value: actionName(shown.action) },
    { label: "对象", value: shown.obj },
    { label: "发起人", icon: Users, tone: "users", value: `${shown.operator} · ${roleText(shown.operatorRole)}${isMine(shown) ? "（你发起的）" : ""}`, reason: bizTime(shown.rawTs, shown.ts) },
    { label: "发起理由", value: shown.reason },
    { label: shown.retiredOperation ? "原执行权限" : "谁能批准", value: approvalExecutorLabel(shown) },
    ...(shownBlock ? [{ label: "不能批准的原因", state: "warn" as const, value: shownBlock }] : []),
    ...(shownTiming ? [{ label: "生效时间", value: shownTiming }] : []),
  ] : [];
  const shownOwn = shown ? isMine(shown) : false;
  const shownCanDecide = shown ? canDecide(shown) : false;
  const ticketFooter = shown && (shownOwn || shownCanDecide ? (
    <Decision
      explain={shownCanDecide && !shownOwn && !shown.retiredOperation ? "点「批准」并确认后立即执行；执行失败不改原值，单子继续待审批。点「驳回」后原操作不执行。" : undefined}
      danger={shownCanDecide || shownOwn ? <Button variant="danger-outline" disabledReason={decideBlock(shown, "reject")} onClick={() => confirmDecision(shown, "reject")}>驳回</Button> : undefined}
      others={shownOwn ? <Button disabledReason={decideBlock(shown, "withdraw")} onClick={() => confirmDecision(shown, "withdraw")}>撤回我的申请</Button> : undefined}
      primary={!shown.retiredOperation ? <Button variant="primary" disabledReason={decideBlock(shown, "approve")} onClick={() => confirmDecision(shown, "approve")}>批准</Button> : undefined} />
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
          {shown.sos && <Notice tone="danger">应急操作：涉及紧急停用或恢复，请核对值班授权、影响范围和恢复条件后再处理。</Notice>}
          <A2ChangeReview before={shown.before} after={shown.after} />
          {shown.phoneCalibrationProposal && <PhoneCalibrationReview proposal={shown.phoneCalibrationProposal} />}
          {shown.ambassadorMaterialProposal && <AmbassadorMaterialSummary packet={shown.ambassadorMaterialProposal} expectedMaterialRevision={shown.ambassadorMaterialProposal.applicationDecision === "APPROVE" ? shown.ambassadorMaterialProposal.expectedMaterialRevision : undefined} />}
        </>}
      </Drawer>

      <Drawer open={Boolean(log)} onClose={() => setLogId(null)} title={shownLog ? `操作记录 · ${logActionText(shownLog.action)}` : "操作记录"} icon={FileText} tone="role-3"
        sub={shownLog && `${bizTimeFull(shownLog.createdAt, shownLog.ts)}（${zone}）`}
        explain="手机号、地址等隐私信息只以加密编号保存，导出时也会隐藏。"
        nav={{ hasPrev: logIndex > 0, hasNext: logIndex >= 0 && logIndex < logPageRows.length - 1, onPrev: () => { if (logIndex > 0) setLogId(logPageRows[logIndex - 1].id); }, onNext: () => { if (logIndex >= 0 && logPageRows[logIndex + 1]) setLogId(logPageRows[logIndex + 1].id); } }}>
        {shownLog && <>
          <JudgmentPoints rows={[
            { label: shownLog.action === "A1_SUPER_ADMIN_BREAK_GLASS_RECOVERED" ? "执行人 / 角色" : "操作者 / 角色", icon: Users, tone: "users", value: `${shownLog.actor} · ${shownLog.role}` },
            { label: "对象", value: shownLog.obj },
            { label: "前值 → 后值", value: <span data-mono>{shownLog.delta}</span> },
            { label: "原因", value: shownLog.reason || "—" },
          ]} />
          <Fold inset title="技术信息" summary={`请求编号 ${requestNo}`}>
            <Facts>
              <Fact k="IP"><span data-mono>{shownLog.ip}</span></Fact>
              <Fact k="请求编号"><span data-mono>{requestNo}</span></Fact>
              <Fact k="原始动作码"><span data-mono>{shownLog.action}</span></Fact>
            </Facts>
          </Fold>
        </>}
      </Drawer>

      <Drawer open={Boolean(history)} onClose={() => setHistoryId(null)} title={shownHistory ? `处理过程 · ${shownHistory.id}` : "处理过程"} icon={History} tone="role-3"
        sub={shownHistory && <StatusTag tone={HIST_TONE[shownHistory.st] ?? "done"}>{HIST_LABEL[shownHistory.st] ?? shownHistory.st}</StatusTag>}
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
        ) : <BlockState state="empty" title="系统暂未提供分类说明，不代表操作无需审批。请按各操作页面的权限和审批提示办理。" />}
      </Drawer>

      {releasing && <ReleaseModal label={releasing.label} onCancel={() => setReleasing(null)} onConfirm={() => releasePending(releasing)}
        explain="重试被拒说明不了原操作的结果，先在操作记录里核对。解除后原操作不再重试，系统仍按这张单现在的状态校验。" />}
    </>
  );
}
