"use client";

/**
 * C2 账户操作（工作台页，PG-45）。一页四件事，分四个页签：账户处置（默认）、注销申请、用户数据只读视图、账户名单。
 * 首屏一句话说有没有注销申请等处理，统计带写全量；账户处置有查找框，表格只是最近注册的 50 个样本。
 * 写操作照提现审核：先把原操作存好再发；结果未知转成页面上方的待确认条，对象锁住，只能原样重试，
 * 后端明确拒绝后才能解除（OP-91～OP-96）。退出全部设备走审批，未决记录和安全与登录设备共用一份。
 */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Ban, CheckCircle2, Copy, Eye, Inbox, Info, ListChecks, LogOut, RefreshCw, ShieldCheck, Snowflake, User, UserRound } from "lucide-react";
import {
  BlockState, Button, Cell, Change, Conclusion, Decision, Drawer, Explain, Fact, Facts, FilterBar, FilterField, Fold, IconButton,
  InlineMeter, InlineRetry, Input, JudgmentPoints, MoreMenu, Notice, PageHeader, PageTabs, Pager, Panel, ReleaseModal,
  Segments, Stat, StatBand, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr, useTabIds,
  type JudgmentRow, type MoreMenuItem,
} from "@/app/components/rd";
import { AutoGloss } from "@/app/components/kit/gloss";
import { fetchAccountDeletion, fetchAccountDeletions, updateAccountDeletion, AccountDeletionRequestError, type AccountDeletionRequest, type AccountDeletionStatus } from "@/lib/admin/account-deletion-client";
import { A2OutcomeUncertainError, createA2OperationProposal, fetchA2ProposalByKey, isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { nexGridBrandText, operatorNicknameText, platformSessionDeviceText, userNicknameText } from "@/lib/admin/brand-copy";
import { businessClock, businessDay, businessZone, formatBusinessTimeCompact, formatBusinessTimeFull, parseBusinessTime } from "@/lib/admin/business-time";
import { formatAccountStatus, formatC1DeviceStatus, formatC1RiskBand, formatC1SessionStatus, riskBandFromScore, riskBandTone } from "@/lib/admin/c1-detail-display";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { announcePermissionDenied } from "@/lib/admin/operation-confirm-error";
import { isIdempotencyOutcomeOpen, outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import { createPendingMutationStore, isRetryExpired, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { listSessionRevocationApprovals, pendingSessionRevocationApproval, proposeSessionRevocation } from "@/lib/admin/session-revocation-approval";
import {
  fetchImpersonationReadonlyView,
  fetchUserAccountActionAccount,
  fetchUserAccountActionContext,
  fetchUserAccountActionOverview,
  isUsersRequestNotFound,
  removeUserAccountList,
  startUserImpersonation,
  terminateUserImpersonation,
  updateUserStatus,
  upsertUserAccountList,
  UsersOutcomeUnknownError,
  UsersRequestError,
  type JsonRecord,
  type User360Profile,
  type UserAccountActionContext,
  type UserAccountActionOverview,
  type UserAccountListEntry,
  type UserImpersonationSession,
  type UserSession,
} from "@/lib/admin/user360-client";
import { roleLabel } from "@/lib/nav/console-nav";
import { useReach } from "@/lib/nav/use-reach";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { AccountDeletionQueue, DELETION_STATUS_LABELS, deletionActionLabel, deletionResultToast, type DeletionAction } from "./account-deletion-queue";
import type { ActionConfirmReq, CCtx } from "./types";

const OPERATOR = currentAdminOperator;
const K1_PATH = "/risk/multi-account";
const D1_PATH = "/finance/recon";
const FOCUS_SOURCES: Record<string, string> = { C1: "用户详情", M1: "客服工作台", M3: "专属会话", J3: "篡改防御监控" };
const PAGE_SIZES = [10, 20, 50] as const;
const TABS = ["accounts", "deletions", "views", "lists"] as const;
type Tab = (typeof TABS)[number];

/** 排序不变：冻结、受限、封禁、正常，同状态风险分高的在前（C2-V05）。 */
const STATUS_WEIGHT: Record<string, number> = { FROZEN: 0, RESTRICTED: 1, BANNED: 2, ACTIVE: 3 };
const FREEZE_SOURCE: Record<string, string> = {
  C2_DIRECT: "账户操作直接冻结",
  K1_MULTI_ACCOUNT_CLUSTER: "随多账户风险排查的账户组冻结",
  CREGIS_DEPOSIT_INCIDENT: "USDT 充值异常",
};
/** 充值异常冻结时后端把事件状态码写进冻结原因（CregisDepositService），用充值对账页的叫法。 */
const CREGIS_REASONS: Record<string, string> = {
  REORG_INVESTIGATING: "链重组调查中",
  PROVIDER_CONFLICT_HOLD: "收款服务与链上记录冲突待处理",
};
const IMPERSONATION_STATUS: Record<string, { label: string; tone: "progress" | "done" }> = {
  ACTIVE: { label: "进行中", tone: "progress" },
  TERMINATED: { label: "已结束", tone: "done" },
  EXPIRED: { label: "已到期", tone: "done" },
};
const MIRROR_PAGES = [
  { value: "HOME", label: "首页" },
  { value: "WALLET", label: "钱包" },
  { value: "DEVICES", label: "设备" },
  { value: "PROFILE", label: "我的" },
] as const;

const K1_BLOCK = "这个账户是随多账户风险排查的账户组冻结的，要在那里解除，这里不能恢复。";
/** 系统不会自己解冻：要在充值异常处置里单独提交解冻，另一位同事复核（后端 CregisReorgResolutionService 的 UNFREEZE）。 */
const CREGIS_BLOCK = "这个账户因 USDT 充值异常冻结，这里不能恢复，需要单独解冻处置：异常和欠款处理完后，在「充值与收款对账」提交解冻，另一位同事复核后解除。";
const LOCKED_USER = "这个账户有结果未确认的操作，先到页面上方核对";
const LOCKED_LIST = "这个用户的名单有结果未确认的操作，先到页面上方核对";
const LOCKED_VIEW = "这次查看有结果未确认的操作，先到页面上方核对";
const SUBMITTING = "正在提交，稍候";
const REFRESHING = "正在刷新，稍候";
const STALE = "账户数据没刷新成功，先重试读取";
const NO_CONTEXT = "账户详情还没读到，先重新加载";
const NO_ID = "该账户没有系统编号，无法加载详情";
const NO_SESSION_TO_REVOKE = "没有在线设备，不用退出";
const VIEW_NEEDS_ACTIVE = "只有正常账户能打开用户数据只读视图";
const VIEW_ALREADY_OPEN = "这个用户已有进行中的只读视图，先结束它";
const STORE_FAILED = "浏览器存不下这次操作，没有提交。换一个窗口再试。";
const UNKNOWN_TOAST = "结果未确认，不要重复操作。到页面上方读回核对或按原操作重试。";
const RETRY_NO_PERMISSION = "这个账号现在没有这项操作的权限，不能重试，请到操作记录与审批核对";
const PERMISSION_DENIED_CODES = ["无权限访问", "ADMIN_PERMISSION_DENIED", "ACCESS_DENIED"];
const REASON_CODES = ["RISK_HIT", "AML_REVIEW", "USER_APPEAL", "JUDICIAL_ASSISTANCE", "OTHER"];
const REASON_CODE_LABELS: Record<string, string> = { RISK_HIT: "触发风控规则", AML_REVIEW: "反洗钱审查", USER_APPEAL: "用户申诉", JUDICIAL_ASSISTANCE: "配合司法调查", OTHER: "其他" };

/* ── 未确认的写操作：按对象存原命令（OP-92～OP-94） ── */

type Kind = "freeze" | "unfreeze" | "impStart" | "impEnd" | "listAdd" | "listRemove" | "deletion";
type ProposalInput = Parameters<typeof createA2OperationProposal>[0];
const KINDS: readonly Kind[] = ["freeze", "unfreeze", "impStart", "impEnd", "listAdd", "listRemove", "deletion"];
const KIND_PREFIX: Record<Kind, string> = {
  freeze: "c2-user-status", unfreeze: "c2-user-status", impStart: "c2-user-impersonation-start", impEnd: "c2-user-impersonation-end",
  listAdd: "c2-account-list-upsert", listRemove: "c2-account-list-remove", deletion: "c2-account-deletion",
};

/** 一条未确认的写操作：种类、对象、原内容、操作人、发出时的状态和命令号都存下，重试只能原样。 */
type C2Pending = PendingMutationRecord & {
  kind: Kind;
  /** 待确认条上写的说明。 */
  label: string;
  /** 账户、名单、开始查看是系统编号；结束查看是查看编号；注销是申请号。 */
  target: string;
  userNo?: string;
  reason: string;
  operator: string;
  /** 发出时对象的状态，读回时对照。 */
  fromStatus?: string;
  reasonCode?: string | null;
  ttlMinutes?: number;
  listKind?: "ALLOW" | "BLOCK";
  /** 名单失效日期（不能叫 expiresAt：那是这条记录自己的 24 小时期限）。 */
  listExpiresAt?: string | null;
  action?: DeletionAction;
  version?: number;
  /** 财务提交审批的原内容（EX-11）：重试先按原号查审批单，查不到才原样再提交。 */
  proposal?: ProposalInput;
};

/** 按对象锁，不按内容（OP-93）：同一个账户、同一个人的名单、同一次查看、同一张注销申请各一把锁。 */
const scopeOf = (kind: Kind, target: string) => kind === "listAdd" || kind === "listRemove" ? `list|${target}`
  : kind === "impEnd" ? `view|${target}` : kind === "deletion" ? `deletion|${target}` : `user|${target}`;

/** 旧表（按「方法｜路径｜请求体」指纹存）里的记录不迁，同闸门 2 决定 53。 */
const c2Commands = createPendingMutationStore<C2Pending>({
  storageKey: "nexion-admin-c2-account-commands-v1",
  // 过期后不能再用原号重试，记录和对象锁都留着（OP-96、决定 03）。
  retainExpiredRecords: true,
  isValidRecord: (record) => KINDS.includes(record.kind)
    && typeof record.target === "string" && record.target.length > 0
    && typeof record.label === "string" && typeof record.operator === "string" && typeof record.reason === "string"
    && record.fingerprint === scopeOf(record.kind, record.target),
});

type Block<T> = { data: T | null; loading: boolean; error: string };
type RevocationRecord = ReturnType<typeof listSessionRevocationApprovals>[number];

/* ── 小工具 ── */

function text(value: unknown, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function upper(value: unknown) {
  return text(value, "").trim().toUpperCase();
}

/** 接口给的计数：读不懂就是 null，不当 0。 */
function count(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") { const n = Number(value); return Number.isFinite(n) ? n : null; }
  return null;
}

function accountId(account: Pick<User360Profile, "id" | "userId"> | null | undefined) {
  const id = account?.id ?? account?.userId;
  return id === null || id === undefined || id === "" ? "" : String(id);
}

function displayAccount(account: Pick<User360Profile, "userNo" | "nickname" | "phoneMasked"> | null | undefined) {
  if (!account) return "—";
  const code = text(account.userNo);
  const name = userNicknameText(text(account.nickname, ""), account.phoneMasked);
  return name ? `${code} · ${name}` : code;
}

/**
 * 风险写「3 · 低风险」，同用户详情（DT-14）：后端给了档就用后端的（概况给的是中文档名，也可能是 LOW 这类码），
 * 没给时按和用户详情共用的兜底按分数落档。
 */
function riskOf(account: Pick<User360Profile, "riskBand" | "riskScore"> | null | undefined) {
  if (!account) return { text: "—", tone: "done" as const };
  const raw = account.riskScore;
  const hasScore = raw !== null && raw !== undefined && raw !== "";
  const score = Number(raw);
  const label = text(account.riskBand, "").trim();
  const code = formatC1RiskBand(label);
  const band = code !== "未分档" ? code
    : label && !["NONE", "UNKNOWN"].includes(label.toUpperCase()) ? label
      : hasScore && Number.isFinite(score) ? riskBandFromScore(score) : "暂无风险分";
  return { text: hasScore ? `${text(raw)} · ${band}` : band, tone: riskBandTone(band) };
}

/** 表格里只给中、高风险上色，低风险和没有档的不上色（VS-21）。 */
function RiskCell({ account }: { account: Pick<User360Profile, "riskBand" | "riskScore"> }) {
  const risk = riskOf(account);
  return risk.tone === "danger" || risk.tone === "warn" ? <StatusTag tone={risk.tone}>{risk.text}</StatusTag> : <Cell main={risk.text} />;
}

/** 金额按接口原值显示，至少两位小数，不舍入，千分位（TX-20，同用户详情）。读不到写「—」，不当成 0。 */
function amountValue(value: unknown) {
  const raw = typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 })
    : typeof value === "string" ? value.trim() : "";
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return raw || "—";
  // 两位以后的尾零去掉（无损），同一笔钱在抽屉和只读视图写一样的位数。
  return `${match[1]}${match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${(match[3] ?? "").replace(/(?<=\d{2})0+$/, "").padEnd(2, "0")}`;
}

function amountWith(value: unknown, unit: string) {
  const shown = amountValue(value);
  return shown === "—" ? "—" : `${shown} ${unit}`;
}

function timeText(value: unknown) {
  return formatBusinessTimeCompact(value, "—");
}

function isActiveSession(session: UserSession) {
  return upper(session.status) === "ACTIVE";
}

/** 名单只认生效中且没到期的（C2-S05）；到期按业务时钟比，不按浏览器时区。 */
function isActiveListEntry(entry: UserAccountListEntry | null | undefined) {
  if (!entry || upper(entry.status) !== "ACTIVE") return false;
  if (!entry.expiresAt) return true;
  const at = parseBusinessTime(String(entry.expiresAt));
  return Number.isFinite(at) && at > Date.now();
}

/** 生效中是名单的默认状态，灰字加勾，不用绿（VS-21、DT-13）；已移出、已到期灰。 */
function listStatus(entry: UserAccountListEntry): { label: string; tone: "neutral" | "done"; icon?: typeof CheckCircle2 } {
  if (isActiveListEntry(entry)) return { label: "生效中", tone: "neutral", icon: CheckCircle2 };
  const status = upper(entry.status);
  return status === "REMOVED" ? { label: "已移出", tone: "done" }
    : status === "EXPIRED" || status === "ACTIVE" ? { label: "已到期", tone: "done" }
      : { label: "状态未知", tone: "done" };
}

function listKindText(kind: unknown) {
  return upper(kind) === "BLOCK" ? "禁入" : "信任";
}

function listEntryText(entry: UserAccountListEntry | null | undefined) {
  if (!entry || !isActiveListEntry(entry)) return "不在名单上";
  return `${listKindText(entry.kind)} · ${entry.expiresAt ? `${formatBusinessTimeCompact(entry.expiresAt, "—").slice(0, 10)} 到期` : "长期"}`;
}

/** 解除禁入后能不能登录还看账户状态：后端登录只放正常账户（AppUserAuthService）。 */
function loginAfterUnblock(status: unknown) {
  const now = upper(status);
  return now === "ACTIVE" ? "用户可以重新登录" : now ? `账户是「${formatAccountStatus(now).label}」，仍登录不了` : "账户冻结、封禁或受限时仍登录不了";
}

function impersonationStatus(session: UserImpersonationSession | null | undefined) {
  return IMPERSONATION_STATUS[upper(session?.status)] ?? { label: "状态未知", tone: "done" as const };
}

function isActiveImpersonation(session: UserImpersonationSession | null | undefined) {
  return upper(session?.status) === "ACTIVE";
}

function freezeReasonText(fact: { freezeSource?: unknown; freezeReason?: unknown } | null | undefined) {
  const reason = text(fact?.freezeReason, "未记录");
  return upper(fact?.freezeSource) === "CREGIS_DEPOSIT_INCIDENT" ? CREGIS_REASONS[upper(reason)] ?? reason : reason;
}

function freezeSourceText(source: unknown) {
  if (!source) return "历史冻结（没有记录来源）";
  return FREEZE_SOURCE[upper(source)] ?? "其他来源";
}

function maskedSessionId(value: unknown) {
  const raw = text(value, "");
  if (!raw) return "—";
  return raw.length <= 8 ? `••••${raw.slice(-2)}` : `${raw.slice(0, 3)}••••${raw.slice(-4)}`;
}

function formatCountdown(totalSeconds: number) {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function jsonRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function jsonRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value) ? value.map(jsonRecord) : [];
}

function errorMessage(error: unknown) {
  return displayAdminError(error);
}

/** 接两句话时句号补齐，不留空格（「流程。这说明」）。 */
function sentence(value: string) {
  return /[。！？；]$/.test(value) ? value : `${value.replace(/[.\s]+$/, "")}。`;
}

function readError(error: unknown) {
  return displayAdminReadError(error);
}

/** 名单的事件登记缺失时用页面专用句（原文不改）。 */
function accountListErrorMessage(error: unknown) {
  if (error instanceof UsersRequestError && error.code === "A4_SCHEMA_NOT_REGISTERED") {
    return "名单未生效：系统配置缺失，请联系技术人员处理后重试。";
  }
  return errorMessage(error);
}

function codeOf(error: unknown) {
  if (error instanceof UsersRequestError) return error.code ?? "";
  if (error instanceof AccountDeletionRequestError) return error.reasonCode ?? "";
  if (error && typeof error === "object" && "backendMessage" in error) return String((error as { backendMessage?: unknown }).backendMessage ?? "");
  return "";
}

/** 共用层只认 ADMIN_PERMISSION_DENIED、ACCESS_DENIED；@PreAuthorize 的「无权限访问」和 C2_ACTION_FORBIDDEN:{码} 页面自己认（第五节）。 */
function isC2PermissionDenied(error: unknown) {
  if (!(error instanceof UsersRequestError) || error.status !== 403) return false;
  const code = error.code ?? "";
  return PERMISSION_DENIED_CODES.includes(code) || code.startsWith("C2_ACTION_FORBIDDEN");
}

function isOutcomeUnknown(error: unknown) {
  if (error instanceof UsersOutcomeUnknownError || isA2OutcomeUncertainError(error)) return true;
  if (error instanceof UsersRequestError) return isIdempotencyOutcomeOpen(error.code);
  if (error instanceof AccountDeletionRequestError) return outcomeStaysUnknown(error.status, error.apiCode) || isIdempotencyOutcomeOpen(error.reasonCode);
  // 审批接口的确定拒绝带 status 和 backendMessage（结果未知的已是 A2OutcomeUncertainError）。
  if (error instanceof Error && "backendMessage" in error) return isIdempotencyOutcomeOpen(String((error as { backendMessage?: unknown }).backendMessage ?? ""));
  // 注销接口断网时是普通 Error（guardedFetch 转的网络句）；页面自己的参数检查不算未知。
  return error instanceof Error && error.message !== "ACCOUNT_DELETION_COMMAND_INVALID";
}

/** 重试被明确拒绝（带原因码的 4xx）：用户接口的原因码在 code 上，交给共用判断时换成 reasonCode。 */
function explicitlyRejected(error: unknown) {
  return error instanceof UsersRequestError ? isExplicitRejection({ status: error.status, reasonCode: error.code }) : isExplicitRejection(error);
}

/**
 * 财务提交冻结、恢复审批（EX-11）：原内容先存进待确认再发，用固定命令号。重试先按原号查审批单，查到就是原来那张；
 * 后端明确回 A2_PROPOSAL_NOT_FOUND 才算没有原单，用原号原内容再提交，不会多出一张（同 withdrawal-config-approval.ts）。
 * 其他查询失败（比如读不到原单回执时的 404 OPERATION_RESULT_UNKNOWN）说明不了原单在不在，按结果未知保留原命令。
 */
async function submitStatusProposal(input: ProposalInput, key: string, retry: boolean) {
  let found: Awaited<ReturnType<typeof fetchA2ProposalByKey>> = null;
  if (retry) {
    try {
      found = await fetchA2ProposalByKey(key, true);
    } catch {
      throw new A2OutcomeUncertainError("暂时查不到原审批单，请到操作记录与审批核对。", key);
    }
  }
  const ticket = found ?? await createA2OperationProposal(input, key, true);
  if (!ticket.mine || ticket.obj !== input.obj) throw new A2OutcomeUncertainError("审批回执与原操作不符，请到操作记录核对。", key);
  return ticket;
}

function newCommandKey(kind: Kind) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${KIND_PREFIX[kind]}-${suffix}`;
}

/** 长单号中间省略，留前缀和末 6 位（TX-28），全文在悬停和抽屉里。 */
function shortNo(no: string) {
  const match = /^([A-Z]+-)(.+)$/.exec(no);
  return match && match[2].length > 8 ? `${match[1]}…${match[2].slice(-6)}` : no;
}

/** 替换写入，不加浏览器历史；默认值不写，其他参数原样留着（ST-23）。 */
function writeQuery(entries: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [name, value] of Object.entries(entries)) {
    if (value === null) url.searchParams.delete(name);
    else url.searchParams.set(name, value);
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", next);
}

/** 带来源进来的返回入口（PG-17、X08、SPM-03）：只接受后台内部地址。 */
function backOf(returnTo: string) {
  if (!returnTo.startsWith("/") || returnTo.startsWith("//")) return null;
  const label = returnTo.startsWith("/users/search/") ? "返回用户详情"
    : returnTo.startsWith("/service/sessions") ? "返回原会话"
      : returnTo.startsWith("/service/overview") ? "返回工作台"
        : "返回上一页";
  return { href: returnTo, label };
}

function AccountStatusTag({ status, table }: { status: unknown; table?: boolean }) {
  const meta = formatAccountStatus(status);
  // 表格里正常是默认状态，用灰（VS-21）；抽屉里同用户详情。
  // 中性色默认是时钟（待处理），正常用灰色的勾。
  return <StatusTag tone={table && meta.tone === "ok" ? "neutral" : meta.tone} icon={meta.icon ?? (meta.tone === "ok" ? CheckCircle2 : undefined)}>{meta.label}</StatusTag>;
}

/* ── 用户数据只读视图的四组内容 ── */

function deviceDailyReference(device: JsonRecord): string {
  if (upper(device.deviceType) === "SHARE") return device.dailyNex == null ? "UVT/天 —" : `${amountValue(device.dailyNex)} UVT/天`;
  return `${amountWith(device.dailyUsdt, "USDT")} · ${amountWith(device.dailyNex, "UVT")}`;
}

/** 名字和值挨着（Facts，同账户抽屉），不用两端对齐的 KeyValues（VS-65）。 */
function ImpersonationUserScreen({ screen }: { screen: JsonRecord }) {
  const template = text(screen.template, "");
  if (template === "H5_HOME") {
    const devices = jsonRecord(screen.deviceSummary);
    return <div data-testid="impersonation-home-screen"><Facts>
      <Fact k="问候语">{text(screen.greeting).replace(/^(你好，)(.+)$/, (_, greeting: string, name: string) => greeting + operatorNicknameText(name))}</Fact>
      {jsonRecords(screen.assetSummary).map((asset) => <Fact key={`asset-${text(asset.symbol)}`} k={`${nexGridBrandText(text(asset.symbol))} 可用余额`}>{amountWith(asset.available, nexGridBrandText(text(asset.symbol)))}</Fact>)}
      <Fact k="设备概况">{`活跃 ${text(devices.active, "0")} / 共 ${text(devices.total, "0")}`}</Fact>
      <Fact k="首页入口">{Array.isArray(screen.entries) && screen.entries.length ? screen.entries.join(" · ") : "—"}</Fact>
    </Facts></div>;
  }
  if (template === "H5_WALLET") {
    return <div data-testid="impersonation-wallet-screen" className="rd-stack">
      <Facts>
        {jsonRecords(screen.assets).map((asset) => <Fact key={text(asset.symbol)} k={`${nexGridBrandText(text(asset.symbol))} 可用余额`}>{amountWith(asset.available, nexGridBrandText(text(asset.symbol)))}</Fact>)}
      </Facts>
      {Boolean(screen.readOnlyHint) && <p className="rd-weak">{text(screen.readOnlyHint)}</p>}
    </div>;
  }
  if (template === "H5_DEVICES") {
    const devices = jsonRecords(screen.devices);
    return <div data-testid="impersonation-devices-screen" className="rd-stack">
      <Facts><Fact k="设备概况">{`活跃 ${text(screen.active, "0")} / 共 ${text(screen.total, "0")}`}</Fact></Facts>
      {Boolean(screen.truncated) && <Notice tone="done">该用户共有 {text(screen.total, "0")} 台设备，这里只显示最近 {text(screen.shown, String(devices.length))} 台。</Notice>}
      <Table label="用户的设备">
        <thead><tr><Th>设备</Th><Th>状态</Th><Th align="right">算力</Th><Th align="right">日收益参考</Th></tr></thead>
        <tbody>
          {devices.length === 0 ? <TableMessage columns={4}>该用户暂无设备。</TableMessage> : devices.map((device) => (
            <Tr key={text(device.instanceNo)}>
              <Td grow><Cell main={text(device.name)} sub={<span data-mono>{text(device.instanceNo)}</span>} /></Td>
              <Td><StatusTag tone={["ONLINE", "RUNNING", "BUSY", "ACTIVE"].includes(upper(device.status)) ? "ok" : "done"}>{formatC1DeviceStatus(device.status)}</StatusTag></Td>
              <Td align="right"><Cell num main={amountValue(device.hashrate)} /></Td>
              <Td align="right"><Cell num main={deviceDailyReference(device)} /></Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </div>;
  }
  return <div data-testid="impersonation-profile-screen">
    <Facts>
      <Fact k="用户编码"><span data-mono>{text(screen.userNo)}</span></Fact>
      <Fact k="昵称">{operatorNicknameText(text(screen.nickname))}</Fact>
      <Fact k="账户状态">{formatAccountStatus(screen.accountStatus).label}</Fact>
      <Fact k="分层">{`${text(screen.userLevel)} · ${text(screen.vRank)}`}</Fact>
      <Fact k="安全">{`两步验证 ${screen.twoFactorEnabled ? "已开启" : "未开启"} · 在线设备 ${text(screen.activeSessions, "0")}`}</Fact>
    </Facts>
  </div>;
}

/* ── 页面 ── */

export function C2Actions({ ctx }: { ctx: CCtx }) {
  const { toast, openActionConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authEpoch = useAdminAuth((state) => state.authEpoch);
  const reach = useReach();
  const params = useSearchParams();
  const zone = businessZone().label;
  const authorities = session?.authorities ?? [];
  const canReadC2 = authorities.includes("user_c2_read");
  // 注销申请只认后端控制器的精确码，角色不绕过（OpsAccountDeletionController）。
  const canReadDeletions = authorities.includes("user_c1_read");
  const canWriteDeletions = authorities.includes("user_c1_write");
  const canFreeze = authorities.includes("user_c2_account_freeze");
  const canUnfreeze = authorities.includes("user_c2_account_unfreeze");
  // 退出全部设备是审批：C2 或 C5 的退出码都认，加审批提交权（后端 AuditReplayBusinessPermissionGuard、A2AccessPolicy 同样）。
  const canRevoke = authorities.some((authority) => ["user_c2_session_revoke_all", "user_c5_session_revoke_all"].includes(authority))
    && authorities.some((authority) => ["platform_a2_write", "platform_a2_proposal_create"].includes(authority));
  const canStartImpersonation = authorities.includes("user_c2_impersonate_start");
  const canTerminateImpersonation = authorities.includes("user_c2_impersonate_terminate");
  const canManageLists = authorities.includes("user_c2_blocklist_add");
  const canWriteAny = canFreeze || canUnfreeze || canRevoke || canStartImpersonation || canTerminateImpersonation || canManageLists || canWriteDeletions;
  const canOpenK1 = reach(K1_PATH, "risk_k1_read");
  const canOpenD1 = reach(D1_PATH, "finance_d1_read");
  const canReadAudit = reach("/platform/audit", "platform_a2_read");
  const canReadUserDetail = reach("/users/search", "user_c1hub_read");
  const canReadAssetAdjustments = reach("/users/assets", "user_c3_read");
  // 财务提交审批分支保留（EX-11）：B30 下内置财务进不来，自定义角色还可能走到。
  const freezeProposalOnly = session?.role === "finance"
    && authorities.includes("platform_a2_proposal_create")
    && !authorities.includes("platform_a2_operation_approve");

  const focusUserCode = (params?.get("userCode") ?? "").trim().toUpperCase();
  const source = params?.get("source") ?? "";
  const focusSource = Object.hasOwn(FOCUS_SOURCES, source) ? FOCUS_SOURCES[source] : undefined;
  const back = backOf(params?.get("returnTo") ?? "");

  /* ── 页签和网址（ST-23、PG-33） ── */
  const readable = useMemo(() => TABS.filter((value) => value === "deletions" ? canReadDeletions : canReadC2), [canReadC2, canReadDeletions]);
  const [tabParam, setTabParam] = useState<string>(() => params?.get("tab") ?? "");
  const tab: Tab = focusUserCode && canReadC2 && !tabParam ? "accounts"
    : (readable as readonly string[]).includes(tabParam) ? tabParam as Tab : readable[0] ?? "accounts";
  const [deletionStatus, setDeletionStatus] = useState<AccountDeletionStatus | "">(() => {
    const value = params?.get("deletionStatus") ?? "";
    return (Object.keys(DELETION_STATUS_LABELS) as string[]).includes(value) ? value as AccountDeletionStatus : "";
  });
  useEffect(() => {
    writeQuery({ tab: tab === readable[0] ? null : tab, deletionStatus: deletionStatus || null });
  }, [tab, readable, deletionStatus]);
  const tabIds = useTabIds();
  // 注销、视图、名单的抽屉跟着各自页签，切走就关；账户抽屉是当前对象，留着（PG-45）。
  const changeTab = (next: Tab) => { setTabParam(next); setTrace(null); };

  /* ── 概况：统计带和三个页签的列表 ── */
  const [overview, setOverview] = useState<Block<UserAccountActionOverview>>({ data: null, loading: canReadC2, error: "" });
  const [readAt, setReadAt] = useState<number | null>(null);
  const overviewSeq = useRef(0);
  const loadOverview = useCallback(async () => {
    if (!canReadC2) return;
    const seq = ++overviewSeq.current;
    setOverview((block) => ({ ...block, loading: true, error: "" }));
    try {
      const data = await fetchUserAccountActionOverview();
      if (seq !== overviewSeq.current) return;
      setOverview({ data, loading: false, error: "" });
      setReadAt(Date.now());
    } catch (cause) {
      // 写后或刷新时失败：旧数留着，写入口暂停（OP-128）。
      if (seq === overviewSeq.current) setOverview((block) => ({ data: block.data, loading: false, error: readError(cause) }));
    }
  }, [canReadC2]);
  useEffect(() => { void loadOverview(); }, [loadOverview, authEpoch]);

  /* ── 等处理的注销申请数：待审核、审核中各读一次（第三节结论句） ── */
  const [deletionCounts, setDeletionCounts] = useState<Block<{ requested: number; inReview: number }>>({ data: null, loading: canReadDeletions, error: "" });
  const countSeq = useRef(0);
  const loadDeletionCounts = useCallback(async () => {
    if (!canReadDeletions) return;
    const seq = ++countSeq.current;
    setDeletionCounts((block) => ({ ...block, loading: true, error: "" }));
    try {
      const [requested, inReview] = await Promise.all([fetchAccountDeletions("REQUESTED", 1, 1), fetchAccountDeletions("IN_REVIEW", 1, 1)]);
      if (seq !== countSeq.current) return;
      // 任一读不到总数就写「暂时读不到」，不拿一半当全部。
      if (requested.total === null || inReview.total === null) throw new Error("ACCOUNT_DELETION_RESPONSE_INVALID");
      setDeletionCounts({ data: { requested: requested.total, inReview: inReview.total }, loading: false, error: "" });
    } catch (cause) {
      if (seq === countSeq.current) setDeletionCounts({ data: null, loading: false, error: readError(cause) });
    }
  }, [canReadDeletions]);
  useEffect(() => { void loadDeletionCounts(); }, [loadDeletionCounts, authEpoch]);
  const [deletionRefresh, setDeletionRefresh] = useState(0);
  const [deletionFocus, setDeletionFocus] = useState(0);

  /* ── 账户抽屉 ── */
  const [acct, setAcct] = useState<User360Profile | null>(null);
  const [context, setContext] = useState<Block<UserAccountActionContext>>({ data: null, loading: false, error: "" });
  const contextGeneration = useRef(0);
  const loadContext = useCallback(async (id: string, generation: number) => {
    setContext((block) => ({ data: accountId(block.data?.account) === id ? block.data : null, loading: true, error: "" }));
    try {
      const next = await fetchUserAccountActionContext(id);
      if (generation !== contextGeneration.current) return;
      if (!next.account || accountId(next.account) !== id) throw new Error("账户详情加载失败");
      setContext({ data: next, loading: false, error: "" });
      setAcct(next.account);
    } catch (cause) {
      if (generation === contextGeneration.current) setContext({ data: null, loading: false, error: readError(cause) });
    }
  }, []);
  const openAccount = (account: User360Profile) => {
    const id = accountId(account);
    const generation = ++contextGeneration.current;
    setAcct(account);
    if (!id) { setContext({ data: null, loading: false, error: NO_ID }); return; }
    void loadContext(id, generation);
  };
  const openFromContext = (next: UserAccountActionContext) => {
    contextGeneration.current += 1;
    setAcct(next.account ?? null);
    setContext({ data: next, loading: false, error: "" });
  };
  const reloadContext = () => {
    const id = accountId(acct);
    if (id) void loadContext(id, ++contextGeneration.current);
  };
  const closeAccount = () => {
    contextGeneration.current += 1;
    setAcct(null);
    setContext({ data: null, loading: false, error: "" });
  };

  /* ── 带 userCode 进来：直接打开这个用户（C2-S03，原文不改） ── */
  const [focusState, setFocusState] = useState<"idle" | "loading" | "found" | "not-found" | "error">("idle");
  const [focusRetry, setFocusRetry] = useState(0);
  useEffect(() => {
    if (!focusUserCode || !canReadC2) { setFocusState("idle"); return; }
    let active = true;
    setFocusState("loading");
    fetchUserAccountActionContext(focusUserCode).then((next) => {
      if (!active) return;
      if (!next.account || upper(next.account.userNo) !== focusUserCode) { setFocusState("not-found"); return; }
      openFromContext(next);
      setFocusState("found");
    }).catch((cause: unknown) => {
      if (active) setFocusState(isUsersRequestNotFound(cause) ? "not-found" : "error");
    });
    return () => { active = false; };
    // openFromContext 只写状态，不随渲染变。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusUserCode, canReadC2, focusRetry]);

  /* ── 查找账户 ── */
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<{ state: "idle" | "loading" | "empty" | "not-found" | "error"; error: string }>({ state: "idle", error: "" });
  const lookupSeq = useRef(0);
  const findAccount = async () => {
    const key = query.trim();
    if (!key) { setLookup({ state: "empty", error: "" }); return; }
    const seq = ++lookupSeq.current;
    setLookup({ state: "loading", error: "" });
    try {
      const next = await fetchUserAccountActionContext(key);
      if (seq !== lookupSeq.current) return;
      if (!next.account) { setLookup({ state: "not-found", error: "" }); return; }
      openFromContext(next);
      setLookup({ state: "idle", error: "" });
    } catch (cause) {
      if (seq !== lookupSeq.current) return;
      setLookup(isUsersRequestNotFound(cause) ? { state: "not-found", error: "" } : { state: "error", error: readError(cause) });
    }
  };

  /* ── 写操作的状态 ── */
  const [submitting, setSubmitting] = useState("");
  const [opening, setOpening] = useState("");
  const [pending, setPending] = useState<C2Pending[]>([]);
  const [revocations, setRevocations] = useState<RevocationRecord[]>([]);
  const [pendingNotes, setPendingNotes] = useState<Record<string, string>>({});
  const [retryRejected, setRetryRejected] = useState<string[]>([]);
  const [releasing, setReleasing] = useState<C2Pending | null>(null);
  const syncPending = useCallback(() => {
    setPending(c2Commands.list().sort((a, b) => a.createdAt - b.createdAt));
    setRevocations(session ? listSessionRevocationApprovals(session.adminId) : []);
  }, [session]);
  useEffect(() => { syncPending(); }, [syncPending, authEpoch]);
  const notePending = (fingerprint: string, note: string) => setPendingNotes((notes) => ({ ...notes, [fingerprint]: `${businessClock(Date.now())} ${note}` }));
  const locked = useMemo(() => {
    const scopes = new Set(pending.map((record) => record.fingerprint));
    for (const record of revocations) scopes.add(`user|${record.userId}`);
    return scopes;
  }, [pending, revocations]);

  /* ── 只读视图、查看记录 ── */
  const [mirror, setMirror] = useState<JsonRecord | null>(null);
  const [mirrorToken, setMirrorToken] = useState("");
  const [mirrorPage, setMirrorPage] = useState("HOME");
  const [mirrorLoading, setMirrorLoading] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [trace, setTrace] = useState<UserImpersonationSession | null>(null);
  const closeMirror = () => { setMirror(null); setMirrorToken(""); setMirrorPage("HOME"); };

  useEffect(() => {
    if (!mirror) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [mirror]);

  useEffect(() => {
    if (!mirror?.expiresAt) return;
    const expiresAt = new Date(String(mirror.expiresAt)).getTime();
    if (!Number.isFinite(expiresAt) || nowMs < expiresAt) return;
    closeMirror();
    toast("用户数据只读视图已到期，已自动关闭。");
    void loadOverview();
  }, [loadOverview, mirror, nowMs, toast]);

  /* ── 列表：账户、名单、只读视图 ── */
  const data = overview.data;
  const accounts = useMemo(() => [...(data?.accounts ?? [])]
    .filter((account) => !!account && !!accountId(account))
    .sort((a, b) => {
      const statusDiff = (STATUS_WEIGHT[upper(a.status)] ?? 9) - (STATUS_WEIGHT[upper(b.status)] ?? 9);
      if (statusDiff !== 0) return statusDiff;
      return (count(b.riskScore) ?? 0) - (count(a.riskScore) ?? 0);
    }), [data]);
  const sessions = useMemo(() => data?.sessions ?? [], [data]);
  const sessionsTruncated = (count(data?.totalSessions) ?? 0) > sessions.length;
  const sessionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of sessions) {
      if (!isActiveSession(row) || row.userId === null || row.userId === undefined) continue;
      counts.set(String(row.userId), (counts.get(String(row.userId)) ?? 0) + 1);
    }
    return counts;
  }, [sessions]);
  // 生效中在前，再按加入时间新的在前；按时间值比，不按格式化后的字符串。
  const listRows = useMemo(() => [...(data?.accountLists ?? [])].sort((a, b) => {
    const activeDiff = Number(isActiveListEntry(b)) - Number(isActiveListEntry(a));
    if (activeDiff !== 0) return activeDiff;
    return (parseBusinessTime(text(b.createdAt, "")) || 0) - (parseBusinessTime(text(a.createdAt, "")) || 0);
  }), [data]);
  // 进行中在前，同组按开始时间新的在前（C2-V06）。
  const impersonations = useMemo(() => [...(data?.impersonations ?? [])].sort((a, b) => {
    const activeDiff = Number(isActiveImpersonation(b)) - Number(isActiveImpersonation(a));
    if (activeDiff !== 0) return activeDiff;
    return (parseBusinessTime(text(b.createdAt, "")) || 0) - (parseBusinessTime(text(a.createdAt, "")) || 0);
  }), [data]);

  const [accountPage, setAccountPage] = useState(1);
  const [accountSize, setAccountSize] = useState<number>(10);
  const [listPage, setListPage] = useState(1);
  const [listSize, setListSize] = useState<number>(10);
  // 刷新后名单回第 1 页（C2-Q11）；账户页码超出时收回末页。
  useEffect(() => { setListPage(1); }, [data]);
  const accountPages = Math.max(1, Math.ceil(accounts.length / accountSize));
  useEffect(() => { if (accountPage > accountPages) setAccountPage(accountPages); }, [accountPage, accountPages]);
  const accountRows = accounts.slice((accountPage - 1) * accountSize, accountPage * accountSize);
  const listPageRows = listRows.slice((listPage - 1) * listSize, listPage * listSize);

  /* ── 写入后回读 ── */
  const refreshAfterWrite = async () => {
    await Promise.all([loadOverview(), acct ? Promise.resolve(reloadContext()) : Promise.resolve()]);
  };
  const refreshAll = () => {
    void loadOverview();
    void loadDeletionCounts();
    setDeletionRefresh((value) => value + 1);
    if (acct) reloadContext();
  };

  /**
   * 先把原操作存好再发（OP-92），存不下就不发。确定失败丢号，留在框里；结果未知保号、关框，转成页面上方的待确认条（OP-93）。
   * 重试的是保留下来的原命令时，确定失败也证明不了原命令的结果，继续保留（CP-33）；只有成功才解除。
   */
  const sendCommand = async <T,>(record: Omit<C2Pending, keyof PendingMutationRecord>, send: (key: string) => Promise<T>, done: (result: T) => Promise<unknown> | unknown, retry = false): Promise<"done" | "unknown"> => {
    const scope = scopeOf(record.kind, record.target);
    const retained = c2Commands.get(scope);
    if (!retry && (retained || locked.has(scope))) {
      throw new Error(scope.startsWith("list|") ? LOCKED_LIST : scope.startsWith("view|") ? LOCKED_VIEW : scope.startsWith("deletion|") ? "这张申请有结果未确认的操作，先到页面上方核对" : LOCKED_USER);
    }
    const key = retained ?? newCommandKey(record.kind);
    c2Commands.remember(scope, key, record);
    if (!c2Commands.isDurablyStored(scope, key)) {
      if (!retained) c2Commands.forget(scope, key);
      throw new Error(STORE_FAILED);
    }
    setSubmitting(scope);
    try {
      let result: T;
      try {
        result = await send(key);
      } catch (cause) {
        const unknown = isOutcomeUnknown(cause);
        if (!unknown && !retained) c2Commands.forget(scope, key);
        syncPending();
        if (unknown) {
          toast(UNKNOWN_TOAST, "warn");
          void refreshAfterWrite();
          if (record.kind === "deletion") { void loadDeletionCounts(); setDeletionRefresh((value) => value + 1); }
          return "unknown";
        }
        throw cause;
      }
      c2Commands.forget(scope, key);
      syncPending();
      setPendingNotes((notes) => { const next = { ...notes }; delete next[scope]; return next; });
      await done(result);
      return "done";
    } finally {
      setSubmitting("");
    }
  };

  /* ── 各写操作的命令 ── */
  const statusCommand = (kind: "freeze" | "unfreeze", id: string, userNo: string, display: string, reason: string, operator: string, reasonCode: string | null, proposal?: ProposalInput, retry = false) => sendCommand(
    { kind, label: `${kind === "freeze" ? "冻结账户" : "恢复账户"}${proposal ? "审批" : ""} · ${userNo}`, target: id, userNo, reason, operator, reasonCode, fromStatus: kind === "freeze" ? "ACTIVE" : "FROZEN", ...(proposal ? { proposal } : {}) },
    (key): Promise<unknown> => proposal ? submitStatusProposal(proposal, key, retry) : updateUserStatus(id, kind === "freeze" ? "FROZEN" : "ACTIVE", reasonCode, reason, operator, key),
    async () => {
      toast(proposal ? `已提交${kind === "freeze" ? "冻结" : "恢复"}审批，批准后生效` : kind === "freeze" ? `${display} 已冻结` : `${display} 已恢复`, "success");
      await refreshAfterWrite();
    },
    retry,
  );

  const openMirrorAfterStart = async (result: JsonRecord, display: string) => {
    const accessToken = text(result.accessToken, "");
    // 开始已经成功：令牌读不到也按成功处理并刷新，查看记录里能看到这次，可以立即结束。
    if (!accessToken) { toast("打开失败，请重试", "warn"); await loadOverview(); return; }
    try {
      const view = await fetchImpersonationReadonlyView(accessToken, "HOME");
      setMirrorToken(accessToken);
      setMirrorPage("HOME");
      setMirror(view);
      toast(`已打开 ${display} 的用户数据只读视图`, "success");
    } catch {
      toast("打开失败，请重试", "warn");
    }
    await loadOverview();
  };

  const impStartCommand = (id: string, userNo: string, display: string, ttlMinutes: number, reasonCode: string, reason: string, operator: string, retry = false) => sendCommand(
    { kind: "impStart", label: `开始查看用户数据 · ${userNo}`, target: id, userNo, reason, operator, reasonCode, ttlMinutes, fromStatus: "ACTIVE" },
    (key) => startUserImpersonation(id, reasonCode, reason, operator, ttlMinutes, key),
    (result) => openMirrorAfterStart(result, display),
    retry,
  );

  const impEndCommand = (sessionNo: string, userNo: string, reason: string, operator: string, fromMirror: boolean, retry = false) => sendCommand(
    { kind: "impEnd", label: `结束只读视图 · ${sessionNo}`, target: sessionNo, userNo, reason, operator, fromStatus: "ACTIVE" },
    (key) => terminateUserImpersonation(sessionNo, reason, operator, key),
    async () => {
      if (fromMirror || text(mirror?.sessionNo, "") === sessionNo) closeMirror();
      toast(`只读视图 ${sessionNo} 已结束`, "success");
      await refreshAfterWrite();
    },
    retry,
  );

  const listAddCommand = (id: string, userNo: string, display: string, listKind: "ALLOW" | "BLOCK", expiresAt: string | null, reason: string, operator: string, retry = false) => sendCommand(
    { kind: "listAdd", label: `${listKind === "BLOCK" ? "加入禁入名单" : "加入信任名单"} · ${userNo}`, target: id, userNo, reason, operator, listKind, listExpiresAt: expiresAt },
    (key) => upsertUserAccountList(id, listKind, reason, operator, expiresAt, key),
    async () => {
      toast(`${display} 名单已生效`, "success");
      await refreshAfterWrite();
    },
    retry,
  );

  const listRemoveCommand = (id: string, userNo: string, display: string, reason: string, operator: string, retry = false) => sendCommand(
    { kind: "listRemove", label: `移出名单 · ${userNo}`, target: id, userNo, reason, operator, fromStatus: "ACTIVE" },
    (key) => removeUserAccountList(id, reason, operator, key),
    async () => {
      toast(`${display} 已移出名单`, "success");
      await refreshAfterWrite();
    },
    retry,
  );

  /* ── 框里被拒：读回对象，框不关（D2-C89） ── */

  /** 权限层拒绝：提示后关框，外壳重读权限（OP-132）。返回 true 表示已处理，调用方正常返回让框关掉。 */
  const deniedClosesModal = (cause: unknown) => {
    if (!isC2PermissionDenied(cause)) return false;
    announcePermissionDenied();
    return true;
  };

  const readLatestContext = async (id: string) => {
    const latest = await fetchUserAccountActionContext(id).catch(() => null);
    if (latest?.account && accountId(latest.account) === id && accountId(acct) === id) openFromContext(latest);
    return latest?.account && accountId(latest.account) === id ? latest : null;
  };

  /* ── 冻结、恢复 ── */
  const statusRequest = (kind: "freeze" | "unfreeze", latest: UserAccountActionContext, blockedReason?: ReactNode): ActionConfirmReq => {
    const account = latest.account!;
    const id = accountId(account);
    const userNo = text(account.userNo);
    const display = displayAccount(account);
    const fact = latest.controlFact ?? null;
    const devices = count(latest.activeSessions);
    const withdrawals = count(fact?.d2FrozenWithdrawalCount);
    const risk = riskOf(account);
    const effect = freezeProposalOnly
      ? <StatusTag tone="progress" filled explain="由有审批权限的同事在「操作记录与审批」批准；批准前账户和提现都不变。">批准后生效</StatusTag>
      : <StatusTag tone="progress" filled>立即生效</StatusTag>;
    const run = async (reason: string, _value?: string, businessValue?: Record<string, string>) => {
      const reasonCode = kind === "freeze" ? businessValue?.reasonCode ?? "" : null;
      if (kind === "freeze" && !reasonCode) throw new Error("请选择冻结原因分类后再提交。");
      // 财务走审批：原内容先存好再发，结果未知时同样转成待确认，只能按原号查、原样重试（R3）。
      const def = freezeProposalOnly ? findHighOp(kind === "freeze" ? "c2_account_freeze" : "c2_account_unfreeze")! : null;
      const proposal: ProposalInput | undefined = def && session ? {
        action: `${kind === "freeze" ? "冻结账户" : "恢复账户"} · ${display}`, obj: id,
        beforeValue: kind === "freeze" ? "ACTIVE" : "FROZEN", afterValue: kind === "freeze" ? "FROZEN" : "ACTIVE",
        operator: OPERATOR(), operatorRole: roleLabel(session.role), type: "acct", amplifies: kind === "unfreeze", sos: false,
        roleGate: def.gateLabel, reason, sourceDomain: "C2",
        command: def.buildCommand(kind === "freeze" ? { userId: id, reasonCode } : { userId: id }), target: def.buildTarget({ userId: id }),
      } : undefined;
      if (freezeProposalOnly && !proposal) throw new Error("请登录后再提交");
      try {
        await statusCommand(kind, id, userNo, display, reason, OPERATOR(), reasonCode, proposal);
      } catch (cause) {
        if (deniedClosesModal(cause)) return;
        const code = codeOf(cause);
        if (code === "USER_FROZEN_BY_K1_CLUSTER" || code === "USER_FROZEN_BY_CREGIS_INCIDENT") {
          openActionConfirm(statusRequest(kind, latest, code === "USER_FROZEN_BY_K1_CLUSTER" ? K1_BLOCK : CREGIS_BLOCK));
          void readLatestContext(id);
        } else if (code === "C2_STATUS_TRANSITION_NOT_ALLOWED" || code === "C2_STATUS_CONCURRENTLY_CHANGED") {
          const fresh = await readLatestContext(id);
          const now = upper(fresh?.account?.status);
          if (fresh && now !== (kind === "freeze" ? "ACTIVE" : "FROZEN")) {
            openActionConfirm(statusRequest(kind, fresh, `这个账户现在是「${formatAccountStatus(now).label}」，这次${kind === "freeze" ? "冻结" : "恢复"}没有执行。关闭后按最新状态处理。`));
          }
          void loadOverview();
        }
        throw cause;
      }
    };
    if (kind === "freeze") {
      // 后果和禁入框同一套写法：登录、设备、提现、怎么解除（冻结的用户登录被拒，后端 AppUserAuthService 只放 ACTIVE）。
      const impact = freezeProposalOnly
        ? "提交审批，批准后生效：账户冻结，用户登录不了，已登录的设备全部下线，待处理的提现一起冻结。"
        : "确认后账户立即冻结，用户登录不了，已登录的设备全部下线，待处理的提现一起冻结。恢复前一直这样。";
      return {
        briefKind: "security",
        action: `冻结账户 · ${display}`,
        title: "冻结账户",
        effect,
        facts: <Facts>
          <Fact k="会下线的设备" lead unit="台">{devices === null ? "—" : String(devices)}</Fact>
          <Fact k="用户">{display}</Fact>
          <Fact k="账户状态"><Change from="正常" to="冻结" /></Fact>
          <Fact k="待处理的提现">一起冻结，恢复账户时回到冻结前的状态</Fact>
          <Fact k="登录">冻结期间登录不了，恢复后要重新登录</Fact>
          <Fact k="风险" tone={risk.tone === "danger" || risk.tone === "warn" ? risk.tone : undefined}>{risk.text}</Fact>
        </Facts>,
        detail: impact,
        amplifies: false,
        statedBrief: { impact, check: "核对用户和冻结原因，理由写清工单号和处理依据。" },
        confirmLabel: freezeProposalOnly ? "提交审批" : "确认冻结",
        reasonMin: 8,
        reasonMax: 200,
        reasonPlaceholder: "例如：工单 20261108-001，风控命中后暂停账户",
        businessForm: {
          kind: "multi-field",
          fields: [{ key: "reasonCode", label: "原因分类", inputKind: "select", required: true, current: "RISK_HIT", options: REASON_CODES, optionLabels: REASON_CODE_LABELS }],
        },
        blockedReason,
        run,
      };
    }
    const impact = freezeProposalOnly
      ? "提交审批，批准后生效：账户恢复正常，因这次冻结暂停的提现一起恢复。"
      : "确认后账户恢复正常，因这次冻结暂停的提现一起恢复；已下线的设备要用户重新登录。";
    return {
      briefKind: "security",
      action: `恢复账户 · ${display}`,
      title: "恢复账户",
      effect,
      facts: <Facts>
        <Fact k="一起恢复的提现" lead unit="笔">{withdrawals === null ? "—" : String(withdrawals)}</Fact>
        <Fact k="用户">{display}</Fact>
        <Fact k="账户状态"><Change from="冻结" to="正常" /></Fact>
        <Fact k="冻结来源">{freezeSourceText(fact?.freezeSource)}</Fact>
        <Fact k="冻结原因">{freezeReasonText(fact)}</Fact>
        <Fact k="冻结时间">{fact?.frozenAt ? `${timeText(fact.frozenAt)}（${zone}）` : "—"}</Fact>
      </Facts>,
      detail: impact,
      amplifies: true,
      // 恢复链只改状态、恢复提现，不查兑付覆盖率（后端 OpsUserService 直接更新链、FinanceWithdrawalControlFacadeAdapter）。
      coverageLead: withdrawals ? "恢复后这些提现回到冻结前的状态，之后按原来的提现流程处理。" : "这个账户没有因冻结暂停的提现。",
      coverageCheck: "恢复时不查兑付覆盖率，也不重新审核。",
      statedBrief: { impact, check: "核对冻结来源和原因，理由写清依据或工单号。" },
      confirmLabel: freezeProposalOnly ? "提交审批" : "确认恢复",
      reasonMin: 8,
      reasonMax: 200,
      reasonPlaceholder: "例如：工单 20261108-002，申诉核实无误",
      blockedReason,
      run,
    };
  };

  /** 点了先读一次上下文：已经不是能处理的状态就不开框，提示原因并刷新（死路不开框）。 */
  const confirmStatus = async (account: User360Profile, kind: "freeze" | "unfreeze") => {
    const id = accountId(account);
    if (!id || opening) return;
    setOpening(`${kind}|${id}`);
    try {
      const latest = await fetchUserAccountActionContext(id).catch((cause: unknown) => { toast(`账户详情暂时读不到：${readError(cause)}`, "warn"); return null; });
      if (!latest?.account || accountId(latest.account) !== id) return;
      if (accountId(acct) === id) openFromContext(latest);
      const now = upper(latest.account.status);
      if (kind === "freeze" && now !== "ACTIVE") { toast(`这个账户现在是「${formatAccountStatus(now).label}」，不能冻结`, "warn"); void loadOverview(); return; }
      if (kind === "unfreeze" && now !== "FROZEN") { toast(`这个账户现在是「${formatAccountStatus(now).label}」，不能恢复`, "warn"); void loadOverview(); return; }
      const sourceCode = upper(latest.controlFact?.freezeSource);
      if (kind === "unfreeze" && (sourceCode === "K1_MULTI_ACCOUNT_CLUSTER" || sourceCode === "CREGIS_DEPOSIT_INCIDENT")) {
        toast(sourceCode === "K1_MULTI_ACCOUNT_CLUSTER" ? K1_BLOCK : CREGIS_BLOCK, "warn");
        void loadOverview();
        return;
      }
      openActionConfirm(statusRequest(kind, latest));
    } finally {
      setOpening("");
    }
  };

  /* ── 退出全部设备（产品决定 1 按建议 B：留在账户抽屉，提交审批） ── */
  const revokeAll = (latest: UserAccountActionContext) => {
    const account = latest.account!;
    const id = accountId(account);
    const display = displayAccount(account);
    const activeCount = count(latest.activeSessions) ?? 0;
    const pendingRevoke = session ? pendingSessionRevocationApproval(session.adminId, id) : undefined;
    openActionConfirm({
      briefKind: "security",
      action: `强制登出 · ${display}`,
      title: "退出全部设备",
      effect: <StatusTag tone="progress" filled explain="由另一位超级管理员在「操作记录与审批」批准；批准前用户的设备不会下线。">批准后生效</StatusTag>,
      facts: <Facts>
        <Fact k="在线设备" lead unit="台">{String(activeCount)}</Fact>
        <Fact k="用户">{display}</Fact>
        <Fact k="退出范围">批准时在线的全部设备</Fact>
      </Facts>,
      // 没有未决记录时说明和影响是一件事，只写影响（VS-105）。
      detail: pendingRevoke ? "审批提交结果尚未确认，重试原操作会使用原理由和操作编号。" : "批准后这个用户的全部设备立即退出登录，要重新登录才能用。",
      amplifies: false,
      statedBrief: { impact: "批准后这个用户的全部设备立即退出登录，要重新登录才能用。", check: "核对用户和在线设备数，理由写清工单号和处理依据。" },
      confirmLabel: "提交审批",
      reasonMin: 8,
      reasonMax: 200,
      reasonPlaceholder: "例如：工单 20261108-003，疑似盗号，退出全部设备",
      getPendingReason: () => session ? pendingSessionRevocationApproval(session.adminId, id)?.reason : undefined,
      run: async (reason) => {
        if (!session) throw new Error("请登录后再提交");
        setSubmitting(`user|${id}`);
        try {
          await proposeSessionRevocation(session, id, display, reason);
          toast("已提交退出全部设备的审批，批准后生效", "success");
        } catch (cause) {
          if (isA2OutcomeUncertainError(cause)) { toast(UNKNOWN_TOAST, "warn"); return; }
          throw cause;
        } finally {
          setSubmitting("");
          syncPending();
        }
      },
    });
  };

  /* ── 开始查看（用户数据只读视图） ── */

  /** 目标解析不变：先在列表样本里按系统编号、用户编码、昵称完全匹配，找不到再读账户接口（原规则）。 */
  const resolveAccount = async (rawValue: string | undefined) => {
    const raw = (rawValue ?? "").trim();
    if (!raw) throw new Error("请选择用户。");
    const needle = raw.toUpperCase();
    const local = accounts.find((account) => accountId(account) === raw || upper(account.userNo) === needle || upper(account.nickname) === needle);
    if (local) return local;
    const detail = await fetchUserAccountActionAccount(raw).catch((cause: unknown) => {
      if (isUsersRequestNotFound(cause)) return null;
      throw cause;
    });
    if (!detail || !accountId(detail)) throw new Error("没有找到这个用户，请重新选择。");
    return detail;
  };

  const startView = (target: User360Profile | null) => {
    const fixed = Boolean(target);
    openActionConfirm({
      briefKind: "security",
      action: "用户数据只读视图",
      title: "开始查看用户数据",
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      facts: target ? <Facts>
        <Fact k="用户">{displayAccount(target)}</Fact>
        <Fact k="账户状态">{formatAccountStatus(target.status).label}</Fact>
      </Facts> : undefined,
      detail: "能看这个用户的账户、钱包、设备和资料，不能改；打开和每次切页都记进操作记录，到时间自动关闭。",
      amplifies: false,
      statedBrief: { impact: "能看这个用户的账户、钱包、设备和资料，不能改；打开和每次切页都记进操作记录，到时间自动关闭。", check: "核对用户和查看原因，理由写清工单号或用户反馈。" },
      confirmLabel: "开始查看",
      reasonMin: 8,
      reasonMax: 200,
      reasonPlaceholder: "例如：工单 20261108-004，用户反馈钱包余额显示不对",
      businessForm: {
        kind: "multi-field",
        fields: [
          ...(fixed ? [] : [{ key: "userCode", label: "用户编码或系统编号", inputKind: "text" as const, required: true, placeholder: "例如 U00000010", explain: "可以填用户编码或系统编号" }]),
          { key: "ttlMinutes", label: "可查看时长", inputKind: "select", required: true, current: "15", options: ["5", "10", "15", "30"], optionLabels: { "5": "5 分钟", "10": "10 分钟", "15": "15 分钟", "30": "30 分钟" } },
          { key: "reasonCode", label: "原因", inputKind: "select", required: true, current: "USER_ISSUE_REPRO", options: ["USER_ISSUE_REPRO", "DISPLAY_ANOMALY", "OTHER"], optionLabels: { USER_ISSUE_REPRO: "复现用户反馈的问题", DISPLAY_ANOMALY: "排查显示异常", OTHER: "其他" } },
        ],
      },
      run: async (reason, _value, businessValue) => {
        const account = target ?? await resolveAccount(businessValue?.userCode);
        const id = accountId(account);
        const ttlMinutes = Number(businessValue?.ttlMinutes);
        const reasonCode = businessValue?.reasonCode ?? "";
        if (!id || ![5, 10, 15, 30].includes(ttlMinutes) || !reasonCode) throw new Error("请填写完整");
        if (locked.has(`user|${id}`)) throw new Error(LOCKED_USER);
        try {
          await impStartCommand(id, text(account.userNo), displayAccount(account), ttlMinutes, reasonCode, reason, OPERATOR());
        } catch (cause) {
          if (deniedClosesModal(cause)) return;
          void loadOverview();
          throw cause;
        }
      },
    });
  };

  /* ── 结束查看 ── */
  const endViewRequest = (row: UserImpersonationSession, fromMirror: boolean, blockedReason?: ReactNode): ActionConfirmReq => {
    const sessionNo = text(row.sessionNo, "");
    const left = count(row.leftMinutes);
    return {
      briefKind: "security",
      // action 是进操作记录的名字，原样不改；框上的标题和页签同名（看图建议 6）。
      action: fromMirror ? `退出并结束只读查看 · ${sessionNo}` : `结束只读查看 · ${sessionNo}`,
      title: fromMirror ? "退出并结束" : "结束只读视图",
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      facts: <Facts>
        <Fact k="查看编号"><span data-mono>{sessionNo}</span></Fact>
        <Fact k="用户">{text(row.userNo)}</Fact>
        <Fact k="查看人">{text(row.operator)}</Fact>
        <Fact k="剩余时间">{left === null ? "—" : `${left} 分钟`}</Fact>
      </Facts>,
      detail: fromMirror ? "确认后这次查看立即结束并关闭窗口，令牌失效，不能再看。" : "确认后这次查看立即结束，令牌失效，不能再看。",
      amplifies: false,
      statedBrief: { impact: fromMirror ? "确认后这次查看立即结束并关闭窗口，令牌失效，不能再看。" : "确认后这次查看立即结束，令牌失效，不能再看。", check: "核对编号和用户，理由写清结束原因。" },
      confirmLabel: fromMirror ? "退出并结束" : "确认结束",
      reasonMin: 8,
      reasonMax: 200,
      reasonPlaceholder: "例如：问题已复现，结束查看",
      blockedReason,
      run: async (reason) => {
        try {
          await impEndCommand(sessionNo, text(row.userNo), reason, OPERATOR(), fromMirror);
        } catch (cause) {
          if (deniedClosesModal(cause)) return;
          const code = codeOf(cause);
          if (code === "INVALID_STATE_TRANSITION" || code === "IMPERSONATION_SESSION_CONCURRENTLY_CHANGED") {
            const fresh = await fetchUserAccountActionOverview().catch(() => null);
            if (fresh) setOverview({ data: fresh, loading: false, error: "" });
            const now = fresh?.impersonations?.find((item) => item.sessionNo === sessionNo);
            if (now && !isActiveImpersonation(now)) openActionConfirm(endViewRequest(now, fromMirror, `这次查看现在是「${impersonationStatus(now).label}」，这次结束没有执行。关闭后按最新状态处理。`));
          }
          throw cause;
        }
      },
    };
  };

  const confirmEndView = async (row: UserImpersonationSession) => {
    const sessionNo = text(row.sessionNo, "");
    if (!sessionNo || opening) return;
    setOpening(`impEnd|${sessionNo}`);
    try {
      const fresh = await fetchUserAccountActionOverview().catch(() => null);
      if (fresh) setOverview({ data: fresh, loading: false, error: "" });
      const now = fresh?.impersonations?.find((item) => item.sessionNo === sessionNo) ?? row;
      if (fresh && !isActiveImpersonation(now)) { toast(`这次查看现在是「${impersonationStatus(now).label}」，不用再结束`, "warn"); return; }
      openActionConfirm(endViewRequest(now, false));
    } finally {
      setOpening("");
    }
  };

  const exitMirror = () => {
    const sessionNo = text(mirror?.sessionNo, "");
    if (!sessionNo) { toast("找不到这次查看的编号，请在列表中结束。", "warn"); return; }
    const listed = impersonations.find((item) => item.sessionNo === sessionNo);
    openActionConfirm(endViewRequest(listed ?? { sessionNo, userNo: text(jsonRecord(mirror?.user).userNo, ""), operator: OPERATOR(), leftMinutes: Math.max(0, Math.ceil((mirrorExpiresMs - nowMs) / 60000)) }, true));
  };

  /* ── 名单 ── */
  /**
   * 每个用户只有一条名单记录，加入另一种会替换现在的（后端 upsert）。禁入换成信任就是解除禁入，框里要写出来（F01）：
   * 名单页签进来时还不知道是谁，先按填的用户读一次现在的名单，在名单上就带着它重开这个框，确认后才提交。
   */
  const addList = (listKind: "ALLOW" | "BLOCK", latest: UserAccountActionContext | null, blockedReason?: ReactNode, fromPanel = false): ActionConfirmReq => {
    // 抽屉进来对象固定；名单页签进来对象由框里填的编码定，读到的名单只用来写事实，提交前按填的编码再核一次。
    const target = fromPanel ? null : latest?.account ?? null;
    const shownAccount = latest?.account ?? null;
    const current = latest?.accountList && isActiveListEntry(latest.accountList) ? latest.accountList : null;
    const other = current && upper(current.kind) !== listKind ? current : null;
    const devices = count(latest?.activeSessions);
    const today = businessDay(0);
    const check = listKind === "BLOCK" ? "核对用户和有效期，理由写清工单号和处理依据。" : "核对用户和有效期，理由写清依据或工单号。";
    // 有效期按选的写：长期没有失效日期（VS-105「写的必须是真的」）。
    const until = (value: Record<string, string>) => value.expiryMode === "SPECIFIED" && value.expiresAt ? `到 ${value.expiresAt} 23:59:59（${zone}）后自动失效` : "一直有效，直到移出";
    const brief = (value: Record<string, string>) => listKind === "BLOCK"
      ? { impact: `加入后这个用户登录不了 App，已登录的设备全部立即下线；${until(value)}。`, check }
      : other
        ? { impact: `禁入会被替换成信任，等于解除禁入，${loginAfterUnblock(shownAccount?.status)}；信任${until(value)}。`, check }
        : { impact: `加入后这个用户标为信任，目前没有哪项检查按它放宽，只做记录；${until(value)}。`, check };
    return {
      briefKind: "security",
      action: listKind === "ALLOW" ? "加入信任名单" : "加入禁入名单",
      title: listKind === "ALLOW" ? "加入信任名单" : "加入禁入名单",
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      facts: shownAccount ? <Facts>
        {listKind === "BLOCK" && <Fact k="会下线的设备" lead unit="台">{devices === null ? "—" : String(devices)}</Fact>}
        <Fact k="用户">{displayAccount(shownAccount)}</Fact>
        {other
          ? <Fact k="现在的名单" tone="warn">{listKind === "BLOCK" ? "信任 · 会被替换成禁入" : `禁入 · 会被替换成信任，禁入解除`}</Fact>
          : <Fact k="现在的名单">{listEntryText(current)}</Fact>}
      </Facts> : undefined,
      detail: "",
      amplifies: false,
      statedBrief: brief,
      confirmLabel: other ? "确认替换" : "确认加入",
      reasonMin: 8,
      reasonMax: 200,
      reasonPlaceholder: listKind === "BLOCK" ? "例如：工单 20261108-005，确认盗号，禁止登录" : "例如：工单 20261108-006，核实为内部测试账号",
      businessForm: {
        kind: "multi-field",
        feedback: (value) => value.expiryMode === "SPECIFIED" && value.expiresAt && value.expiresAt < today
          ? { message: `失效日期不能早于今天；选的日期当天 23:59:59（${zone}）后失效。`, invalid: true, field: "expiresAt" }
          : { message: "", invalid: false },
        fields: [
          ...(target ? [] : [{ key: "userCode", label: "用户编码或系统编号", inputKind: "text" as const, required: true, placeholder: "例如 U00000010", explain: "可以填用户编码或系统编号" }]),
          { key: "expiryMode", label: "有效期", inputKind: "select", required: true, current: "PERMANENT", options: ["PERMANENT", "SPECIFIED"], optionLabels: { PERMANENT: "长期", SPECIFIED: "指定日期" } },
          { key: "expiresAt", label: "失效日期", inputKind: "date", required: true, wide: true, help: `这天 23:59:59（${zone}）后失效`, visibleWhen: { key: "expiryMode", equals: "SPECIFIED" } },
        ],
      },
      blockedReason,
      run: async (reason, _value, businessValue) => {
        const account = target ?? await resolveAccount(businessValue?.userCode).catch((cause: unknown) => { throw new Error(accountListErrorMessage(cause)); });
        const id = accountId(account);
        const expiresAt = businessValue?.expiryMode === "SPECIFIED" ? businessValue.expiresAt ?? "" : null;
        if (!id || expiresAt === "") throw new Error("请填写用户和失效日期");
        if (locked.has(`list|${id}`)) throw new Error(LOCKED_LIST);
        if (!target) {
          // 先读这个用户现在的名单：在名单上、而框里还没写出来（或换了人、名单变了），就带着它重开，这次不提交。
          const fresh = await fetchUserAccountActionContext(id).catch((cause: unknown) => { throw new Error(`这个用户现在的名单读不到，没有提交：${readError(cause)}`); });
          const now = fresh.accountList && isActiveListEntry(fresh.accountList) ? fresh.accountList : null;
          if (shownAccount && accountId(shownAccount) !== id) {
            openActionConfirm(addList(listKind, fresh, undefined, true));
            toast("框里的用户换了，核对上面的用户和名单后再确认。", "warn");
            return false;
          }
          const shownEntry = shownAccount ? current : undefined;
          if (now && (upper(now.kind) === listKind || shownEntry === undefined || upper(shownEntry?.kind) !== upper(now.kind))) {
            const same = upper(now.kind) === listKind;
            openActionConfirm(addList(listKind, fresh, undefined, true));
            toast(same ? `这个用户已经在${listKindText(now.kind)}名单上，不用再加入。` : `这个用户现在在${listKindText(now.kind)}名单上，加入会替换掉它。核对框里的名单后再确认。`, "warn");
            return false;
          }
        }
        try {
          await listAddCommand(id, text(account.userNo), displayAccount(account), listKind, expiresAt, reason, OPERATOR());
        } catch (cause) {
          if (deniedClosesModal(cause)) return;
          if (codeOf(cause) === "INVALID_STATE_TRANSITION") {
            const fresh = await readLatestContext(id);
            if (fresh) openActionConfirm(addList(listKind, target ? fresh : null, `这个用户现在是「${listEntryText(fresh.accountList)}」，这次加入没有执行。关闭后按最新状态处理。`));
            void loadOverview();
          }
          throw new Error(accountListErrorMessage(cause));
        }
      },
    };
  };

  const removeList = (entry: UserAccountListEntry, accountStatus: unknown, blockedReason?: ReactNode): ActionConfirmReq => {
    const id = text(entry.userId, "");
    const block = upper(entry.kind) === "BLOCK";
    const impact = "移出后这条名单不再生效，记录保留。";
    return {
      briefKind: "security",
      action: `移出名单 · ${displayAccount(entry)}`,
      title: "移出名单",
      effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
      facts: <Facts>
        <Fact k="用户">{displayAccount(entry)}</Fact>
        <Fact k="名单">{`${listKindText(entry.kind)} · ${entry.expiresAt ? `${timeText(entry.expiresAt)}（${zone}）失效` : "长期"}`}</Fact>
        {block && <Fact k="移出后">{`禁入解除，${loginAfterUnblock(accountStatus)}`}</Fact>}
      </Facts>,
      detail: impact,
      amplifies: false,
      statedBrief: { impact, check: "核对用户和名单种类，理由写清移出依据。" },
      confirmLabel: "确认移出",
      reasonMin: 8,
      reasonMax: 200,
      reasonPlaceholder: "例如：工单 20261108-007，申诉核实无误",
      blockedReason,
      run: async (reason) => {
        if (!id) throw new Error("这条名单没有用户编号");
        try {
          await listRemoveCommand(id, text(entry.userNo), displayAccount(entry), reason, OPERATOR());
        } catch (cause) {
          if (deniedClosesModal(cause)) return;
          const code = codeOf(cause);
          if (code === "INVALID_STATE_TRANSITION" || code === "ACCOUNT_LIST_ENTRY_NOT_FOUND") {
            const fresh = await readLatestContext(id);
            if (fresh) openActionConfirm(removeList(entry, fresh.account?.status ?? accountStatus, `这个用户现在是「${listEntryText(fresh.accountList)}」，这次移出没有执行。关闭后按最新状态处理。`));
            void loadOverview();
          }
          throw new Error(accountListErrorMessage(cause));
        }
      },
    };
  };

  const confirmRemoveList = async (entry: UserAccountListEntry) => {
    const id = text(entry.userId, "");
    if (!id || opening) return;
    setOpening(`listRemove|${id}`);
    try {
      const fresh = await fetchUserAccountActionContext(id).catch(() => null);
      if (fresh && !isActiveListEntry(fresh.accountList)) { toast(`这个用户现在是「${listEntryText(fresh.accountList)}」，不用再移出`, "warn"); void loadOverview(); return; }
      // 上下文里的名单行不一定带用户编码和昵称，用账户的补上，框里的「用户」不写成「—」。
      openActionConfirm(removeList({ ...entry, ...(fresh?.accountList ?? {}), userId: entry.userId, userNo: fresh?.account?.userNo ?? entry.userNo, nickname: fresh?.account?.nickname ?? entry.nickname, phoneMasked: fresh?.account?.phoneMasked ?? entry.phoneMasked }, fresh?.account?.status));
    } finally {
      setOpening("");
    }
  };

  /* ── 注销申请的写操作：页签里开框，命令在这里发，待确认条在页面上方 ── */
  const deletionCommand = (requestNo: string, userId: number, action: DeletionAction, version: number, fromStatus: string, reason: string, operator: string, onDone?: (row: AccountDeletionRequest) => unknown, retry = false) => sendCommand(
    { kind: "deletion", label: `${deletionActionLabel(action, fromStatus)} · ${shortNo(requestNo)}`, target: requestNo, userNo: String(userId), reason, operator, action, version, fromStatus },
    (key) => updateAccountDeletion(requestNo, action, version, reason, key),
    async (row) => {
      if (onDone) await onDone(row);
      else { const [message, kind] = deletionResultToast(action, row, fromStatus); toast(message, kind); }
      await loadDeletionCounts();
    },
    retry,
  );

  /* ── 待确认：读回、重试、解除 ── */
  // 重试要原操作的精确权限，财务身份不能顶替；审批的原操作还要审批提交权（F08）。
  const canPropose = authorities.includes("platform_a2_proposal_create");
  const canRetry = (record: C2Pending) => record.kind === "freeze" ? canFreeze && (!record.proposal || canPropose)
    : record.kind === "unfreeze" ? canUnfreeze && (!record.proposal || canPropose)
      : record.kind === "impStart" ? canStartImpersonation
        : record.kind === "impEnd" ? canTerminateImpersonation
          : record.kind === "deletion" ? canWriteDeletions : canManageLists;

  /** 按原操作重试：同命令号、同内容、同操作人，不接受新输入（OP-94）。只有成功才解除。 */
  const retryPending = async (record: C2Pending) => {
    if (isRetryExpired(record)) { notePending(record.fingerprint, `${RETRY_EXPIRED_TEXT}。`); return; }
    if (!canRetry(record)) { notePending(record.fingerprint, `${RETRY_NO_PERMISSION}。`); return; }
    if (!c2Commands.isDurablyStored(record.fingerprint, record.commandKey)) {
      notePending(record.fingerprint, "浏览器里查不到这条记录，本次没有发送。待确认继续保留，请到操作记录与审批核对。");
      return;
    }
    setRetryRejected((keys) => keys.filter((key) => key !== record.commandKey));
    const userNo = text(record.userNo);
    try {
      let outcome: "done" | "unknown";
      if (record.kind === "freeze" || record.kind === "unfreeze") outcome = await statusCommand(record.kind, record.target, userNo, userNo, record.reason, record.operator, record.reasonCode ?? null, record.proposal, true);
      else if (record.kind === "impStart") outcome = await impStartCommand(record.target, userNo, userNo, record.ttlMinutes ?? 15, record.reasonCode ?? "", record.reason, record.operator, true);
      else if (record.kind === "impEnd") outcome = await impEndCommand(record.target, userNo, record.reason, record.operator, false, true);
      else if (record.kind === "listAdd") outcome = await listAddCommand(record.target, userNo, userNo, record.listKind ?? "BLOCK", record.listExpiresAt ?? null, record.reason, record.operator, true);
      else if (record.kind === "listRemove") outcome = await listRemoveCommand(record.target, userNo, userNo, record.reason, record.operator, true);
      else {
        outcome = await deletionCommand(record.target, Number(record.userNo), record.action ?? "review", record.version ?? 0, record.fromStatus ?? "", record.reason, record.operator, undefined, true);
        setDeletionRefresh((value) => value + 1);
      }
      if (outcome === "unknown") notePending(record.fingerprint, record.proposal
        ? "还是没有确认，原命令继续保留。原审批单可能已经提交，请到操作记录与审批核对。"
        : "还是没有确认，原命令继续保留。");
    } catch (cause) {
      if (isC2PermissionDenied(cause)) announcePermissionDenied();
      // 系统要求核查、核查已有结论这些幂等层的码不算明确拒绝（共用分类），原命令和锁都留着，不放「解除待确认」。
      if (explicitlyRejected(cause)) {
        notePending(record.fingerprint, `重试没有成功：${sentence(errorMessage(cause))}这说明不了原操作的结果，原命令继续保留。`);
        setRetryRejected((keys) => [...keys, record.commandKey]);
      } else notePending(record.fingerprint, `这次没能确认结果：${sentence(errorMessage(cause))}原命令继续保留。`);
    }
  };

  /** 读回只给现在的事实，不当成原操作的回执，待确认继续保留（OP-93、OP-95）。 */
  const verifyPending = async (record: C2Pending) => {
    if (record.kind === "deletion") {
      const fresh = await fetchAccountDeletion(record.target).catch(() => null);
      if (!fresh) { notePending(record.fingerprint, "读回失败，暂时读不到。待确认继续保留。"); return; }
      notePending(record.fingerprint, `读回：这张申请现在是「${DELETION_STATUS_LABELS[fresh.status] ?? "状态未知"}」，版本 ${fresh.version}；发出时是「${DELETION_STATUS_LABELS[record.fromStatus ?? ""] ?? "状态未知"}」，版本 ${record.version ?? "—"}。状态可能是别人改的，待确认继续保留。`);
      return;
    }
    if (record.kind === "impEnd") {
      const fresh = await fetchUserAccountActionOverview().catch(() => null);
      if (!fresh) { notePending(record.fingerprint, "读回失败，暂时读不到。待确认继续保留。"); return; }
      setOverview({ data: fresh, loading: false, error: "" });
      const row = fresh.impersonations?.find((item) => item.sessionNo === record.target);
      notePending(record.fingerprint, row
        ? `读回：这次查看现在是「${impersonationStatus(row).label}」，发出时是「进行中」。状态可能是别人改的，待确认继续保留。`
        : "读回：最近 50 次查看里找不到这一次。待确认继续保留。");
      return;
    }
    const fresh = await fetchUserAccountActionContext(record.target).catch(() => null);
    if (!fresh?.account) { notePending(record.fingerprint, "读回失败，暂时读不到。待确认继续保留。"); return; }
    openFromContext(fresh);
    if (record.kind === "listAdd" || record.kind === "listRemove") {
      notePending(record.fingerprint, `读回：这个用户现在是「${listEntryText(fresh.accountList)}」。这不能证明原操作的结果，待确认继续保留。`);
    } else if (record.kind === "impStart") {
      const active = fresh.impersonations?.find(isActiveImpersonation);
      notePending(record.fingerprint, active
        ? `读回：这个用户现在有进行中的只读视图 ${text(active.sessionNo)}，查看人 ${text(active.operator)}。这不能证明原操作的结果，待确认继续保留。`
        : "读回：这个用户现在没有进行中的只读视图。这不能证明原操作的结果，待确认继续保留。");
    } else {
      notePending(record.fingerprint, `读回：这个账户现在是「${formatAccountStatus(fresh.account.status).label}」，发出时是「${formatAccountStatus(record.fromStatus).label}」。状态可能是别人改的，待确认继续保留。`);
    }
  };

  /** 重试被拒后，人核实过原操作的结果才解除：只清本页这条记录，不发请求，后端仍按对象现在的状态校验。 */
  const releasePending = (record: C2Pending) => {
    c2Commands.forget(record.fingerprint, record.commandKey);
    syncPending();
    setPendingNotes((notes) => { const next = { ...notes }; delete next[record.fingerprint]; return next; });
    setReleasing(null);
    setRetryRejected((keys) => keys.filter((key) => key !== record.commandKey));
    toast("已解除待确认，可以重新处理", "success");
  };

  /** 退出全部设备的未决记录：按原命令号先查审批单，查不到再按原内容提交（甲档，现有逻辑）。 */
  const retryRevocation = async (record: RevocationRecord) => {
    if (!session) return;
    const fingerprint = `revoke|${record.userId}`;
    setSubmitting(`user|${record.userId}`);
    try {
      await proposeSessionRevocation(session, record.userId, record.label, record.reason);
      toast("已提交退出全部设备的审批，批准后生效", "success");
    } catch (cause) {
      notePending(fingerprint, isA2OutcomeUncertainError(cause) ? "还是没有确认，原命令继续保留。" : `重试没有成功：${errorMessage(cause)}`);
      // 共用库只在明确拒绝后清掉原命令，其他情况记录照旧留着（F04）。
    } finally {
      setSubmitting("");
      syncPending();
    }
  };

  /* ── 渲染用的值 ── */
  const overviewFailedFirst = !data && !!overview.error;
  const overviewStale = !!data && !!overview.error;
  const firstLoading = overview.loading && !data;
  const frozenUsers = count(data?.frozenUsers);
  const activeViews = count(data?.activeImpersonations);
  const trustCount = count(data?.trustListCount);
  const blockedCount = count(data?.blockedListCount);
  const activeImpRows = impersonations.filter(isActiveImpersonation);
  const longestLeft = activeImpRows.length ? Math.max(...activeImpRows.map((row) => count(row.leftMinutes) ?? 0)) : null;
  const totalAccounts = count(data?.totalAccounts);
  const totalLists = count(data?.totalAccountLists);
  const totalViews = count(data?.totalImpersonations);
  const pendingDeletions = deletionCounts.data ? deletionCounts.data.requested + deletionCounts.data.inReview : null;
  const mirrorExpiresMs = mirror?.expiresAt ? new Date(String(mirror.expiresAt)).getTime() : Number.NaN;
  const mirrorRemainingSeconds = Number.isFinite(mirrorExpiresMs) ? Math.max(0, Math.ceil((mirrorExpiresMs - nowMs) / 1000)) : 0;
  const busy = Boolean(submitting) || Boolean(opening);

  /** 行内和名单页签的写入口：依赖概况，概况刷新中或刷新失败时暂停（OP-128）。 */
  const listBlock = (scope: string) => locked.has(scope) ? (scope.startsWith("list|") ? LOCKED_LIST : scope.startsWith("view|") ? LOCKED_VIEW : LOCKED_USER)
    : submitting ? SUBMITTING : overview.loading ? REFRESHING : overviewStale ? STALE : undefined;

  const copyText = (value: string, label: string) => {
    void navigator.clipboard?.writeText(value).then(() => toast(`已复制${label}`, "success"), () => toast(`复制失败，请手动选择${label}`, "error"));
  };

  const goDeletions = () => {
    setDeletionStatus(deletionCounts.data && deletionCounts.data.requested === 0 && deletionCounts.data.inReview > 0 ? "IN_REVIEW" : "REQUESTED");
    changeTab("deletions");
    setDeletionFocus((value) => value + 1);
  };

  /* ── 页头、待确认、带入、结论、统计带 ── */
  const header = (
    <PageHeader pageId="C2" title="账户操作" summary={<AutoGloss>冻结或恢复用户账户，管理名单和注销申请。</AutoGloss>}
      back={back ? <Link className="rd-link" href={back.href} prefetch={false}>{back.label}</Link> : undefined}
      meta={<span className="rd-toolbar">
        <span>{readAt ? `${businessClock(readAt)} 读取（${zone}）· ` : ""}不自动刷新</span>
        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={overview.loading || deletionCounts.loading} onClick={refreshAll}>刷新</Button>
      </span>}
      readOnly={canWriteAny ? undefined : "你只能查看；冻结、名单和注销审核要有对应权限的同事办。"}
      guideExtra={canWriteAny ? undefined : <p>你的账号只能查看，上面的操作步骤要有对应权限的同事办。</p>} />
  );

  const pendingNotices = <>
    {pending.map((record) => {
      const expired = isRetryExpired(record);
      return (
        <Notice key={record.fingerprint} tone="warn" title={`${record.label} · 结果未确认`} actionBelow
          action={<>
            <Button size="sm" disabled={busy} onClick={() => void verifyPending(record)}>读回核对</Button>
            <Button size="sm" disabled={busy} loading={submitting === record.fingerprint} disabledReason={expired ? RETRY_EXPIRED_TEXT : canRetry(record) ? undefined : RETRY_NO_PERMISSION} onClick={() => void retryPending(record)}>按原操作重试</Button>
            {retryRejected.includes(record.commandKey) && <Button size="sm" disabled={busy} onClick={() => setReleasing(record)}>解除待确认</Button>}
          </>}>
          <p>
            {formatBusinessTimeCompact(new Date(record.createdAt).toISOString(), "—")}（{zone}）发出，可能已经生效。
            {expired ? `${RETRY_EXPIRED_TEXT}。` : "按原操作重试用同一个命令号和原内容，已经执行过的不会再执行一次；系统要求先核查时原命令继续保留。"}
            {canReadAudit ? <> <Link className="rd-link" href="/platform/audit" prefetch={false}>到操作记录与审批核对</Link></> : "请有操作记录读权限的同事核对。"}
            <Explain label="这次操作的技术信息" rows={[
              { k: "命令号", v: <span data-mono>{record.commandKey}</span> },
              { k: "操作人", v: record.operator },
              { k: "理由", v: record.reason },
            ]} />
          </p>
          {pendingNotes[record.fingerprint] && <p>{pendingNotes[record.fingerprint]}</p>}
        </Notice>
      );
    })}
    {revocations.map((record) => {
      const fingerprint = `revoke|${record.userId}`;
      return (
        <Notice key={record.fingerprint} tone="warn" title={`退出全部设备 · ${record.label} · 结果未确认`} actionBelow
          action={<Button size="sm" disabled={busy} loading={submitting === `user|${record.userId}`} disabledReason={canRevoke ? undefined : RETRY_NO_PERMISSION} onClick={() => void retryRevocation(record)}>按原操作重试</Button>}>
          <p>
            {formatBusinessTimeCompact(new Date(record.createdAt).toISOString(), "—")}（{zone}）提交审批，可能已经提交成功。按原操作重试会先按原命令号查审批单，查不到再用原理由提交，不会重复提交。
            {canReadAudit ? <> <Link className="rd-link" href="/platform/audit" prefetch={false}>到操作记录与审批核对</Link></> : "请有操作记录读权限的同事核对。"}
            <Explain label="这次操作的技术信息" rows={[
              { k: "命令号", v: <span data-mono>{record.commandKey}</span> },
              { k: "操作人", v: record.operator },
              { k: "理由", v: record.reason },
            ]} />
          </p>
          {pendingNotes[fingerprint] && <p>{pendingNotes[fingerprint]}</p>}
        </Notice>
      );
    })}
  </>;

  const focusNotice = focusUserCode && canReadC2 && (
    <Notice tone={focusState === "not-found" || focusState === "error" ? "warn" : "neutral"}
      action={focusState === "error" ? <Button size="sm" onClick={() => setFocusRetry((value) => value + 1)}>重试</Button> : undefined}>
      {focusSource ? `从「${focusSource}」带入用户 ` : "带入用户 "}<b>{focusUserCode}</b>：
      {focusState === "loading" && "正在查找该账户…"}
      {focusState === "found" && "已打开该用户。"}
      {focusState === "not-found" && `没有找到该用户，请${focusSource ? `回到「${focusSource}」核对用户编码` : "核对用户编码"}后重试。`}
      {focusState === "error" && "查找失败，请检查网络后刷新重试。"}
    </Notice>
  );

  const conclusionExplain = "待审核和审核中的注销申请都要人处理。已拒绝的申请可以重新审核或取消；用户也可以在 App 取消。";
  const conclusion = !canReadDeletions ? null
    : deletionCounts.loading && !deletionCounts.data ? <Conclusion state="unknown">正在读取…</Conclusion>
      : deletionCounts.error || pendingDeletions === null ? <Conclusion state="unknown" action={<InlineRetry onRetry={() => void loadDeletionCounts()} />}>暂时读不到注销申请的数量</Conclusion>
        : pendingDeletions > 0 ? (
          <Conclusion state="warn" lead icon={Inbox} explain={conclusionExplain}
            hint={[deletionCounts.data!.requested > 0 ? `${deletionCounts.data!.requested} 个待审核` : "", deletionCounts.data!.inReview > 0 ? `${deletionCounts.data!.inReview} 个审核中` : ""].filter(Boolean).join("、") + "。"}
            action={<button type="button" className="rd-link rd-link-button" onClick={goDeletions}>去处理</button>}>
            <b>{pendingDeletions.toLocaleString("en-US")}</b> 个注销申请等处理
          </Conclusion>
        ) : <Conclusion state="neutral" icon={Info} explain={conclusionExplain}>没有等处理的注销申请</Conclusion>;

  const statValue = (value: number | null) => firstLoading ? "" : value === null ? "—" : value.toLocaleString("en-US");
  const statBand = canReadC2 && (
    <StatBand label="账户操作概况">
      {/* 读不到时四格都写「—」，重试在下面页签里的失败块上，不挂在第一格下（看着像只重试这一格）。 */}
      <Stat tone="role-3" icon={Snowflake} label="冻结中账户" value={statValue(frozenUsers)} unit={frozenUsers === null ? undefined : "个"}
        explain="现在冻结中的全部账户，含随账户组冻结和充值异常冻结的。下面的列表只有最近注册的 50 个，不一定都在。" />
      <Stat tone="progress" icon={Eye} label="只读视图进行中" value={statValue(activeViews)} unit={activeViews === null ? undefined : "个"}
        sub={longestLeft !== null && activeViews ? `最长剩 ${longestLeft} 分钟` : undefined}
        explain={activeViews ? "「最长剩」按页面读取时算，不会自己倒数，点「刷新」更新。" : "现在打开着的用户数据只读视图。"} onOpen={() => changeTab("views")} openLabel="到用户数据只读视图" />
      <Stat tone="role-2" icon={ShieldCheck} label="信任名单" value={statValue(trustCount)} unit={trustCount === null ? undefined : "人"}
        explain="标为信任的用户。目前没有哪项检查按它放宽，只做记录。" onOpen={() => changeTab("lists")} openLabel="到账户名单" />
      <Stat tone="role-4" icon={Ban} label="禁入名单" value={statValue(blockedCount)} unit={blockedCount === null ? undefined : "人"}
        explain="名单里的用户登录不了 App。加入时已登录的设备全部下线。" onOpen={() => changeTab("lists")} openLabel="到账户名单" />
    </StatBand>
  );

  /* ── 账户处置 ── */
  const overviewBlock = (what: string) => firstLoading ? null : overviewFailedFirst
    ? <BlockState state="error" title={`${what}读取失败，不显示旧数据`} detail={overview.error} onRetry={() => void loadOverview()} retrying={overview.loading} />
    : null;
  const staleNotice = overviewStale && (
    <Notice tone="warn" action={<Button size="sm" loading={overview.loading} onClick={() => void loadOverview()}>重试</Button>}>
      刷新没成功，下面是 {readAt ? businessClock(readAt) : "—"}（{zone}）读取的数据；列表内的冻结、恢复、结束只读视图及名单操作先暂停。
    </Notice>
  );

  const rowAction = (account: User360Profile) => {
    const id = accountId(account);
    const status = upper(account.status);
    const reason = listBlock(`user|${id}`);
    if (status === "ACTIVE" && canFreeze) {
      return <Button size="sm" aria-label={`冻结 ${displayAccount(account)}`} disabled={busy && opening !== `freeze|${id}`} loading={opening === `freeze|${id}`} disabledReason={reason} onClick={() => void confirmStatus(account, "freeze")}>冻结</Button>;
    }
    if (status === "FROZEN" && canUnfreeze) {
      // 随账户组、充值异常冻结的这里不能恢复：概况里有冻结来源时行内就禁用，完整原因在抽屉（OP-127）。
      const source = upper(data?.controlFacts?.find((item) => String(item.userId) === id)?.freezeSource);
      const sourceBlock = source === "K1_MULTI_ACCOUNT_CLUSTER" ? K1_BLOCK : source === "CREGIS_DEPOSIT_INCIDENT" ? CREGIS_BLOCK : undefined;
      return <Button size="sm" aria-label={`恢复 ${displayAccount(account)}`} disabled={busy && opening !== `unfreeze|${id}`} loading={opening === `unfreeze|${id}`} disabledReason={reason ?? sourceBlock} onClick={() => void confirmStatus(account, "unfreeze")}>恢复</Button>;
    }
    return null;
  };

  // 一个写权都没有时不放操作列（OP-124）：只读账号不看一列空格子。
  const accountActions = canFreeze || canUnfreeze;
  // 样本截断时「至少」写在表头一次，格子里只写数（建议 1）。
  const sessionCell = (account: User360Profile) => {
    const n = sessionCounts.get(accountId(account)) ?? 0;
    if (!sessionsTruncated) return n === 0 ? <span className="rd-weak">0 台</span> : `${n} 台`;
    return n === 0 ? <span className="rd-weak" title="最近 200 条登录里没有这个账户的，准确数打开详情看">—</span> : `${n} 台`;
  };
  // 时区只在面板标题旁写一次，表头不再写（TX-25）。
  const zoneNote = `时间为${zone}`;

  const accountsPane = (
    <div className="rd-stack">
      {/* 右端写列表的范围：为什么要用查找框，也让定宽的框右边不空着（量尺 P2-side）。 */}
      <FilterBar onSubmit={() => void findAccount()} querying={lookup.state === "loading"}
        action={<Button type="submit" loading={lookup.state === "loading"}>打开</Button>}
        sort={!overviewFailedFirst ? <span className="rd-filter-result">列表只取最近注册的 50 个账户</span> : undefined}
        notice={lookup.state === "empty" ? "填用户编码、系统编号、邀请码或邮箱。" : lookup.state === "error" ? <>{lookup.error} <InlineRetry onRetry={() => void findAccount()} /></> : undefined}>
        {/* 定宽查找框，「打开」紧贴右边（同 Ant Input.Search、提现审核），不横跨整行。 */}
        <FilterField>
          <Input aria-label="查找账户" placeholder="用户编码、系统编号、邀请码或邮箱" size={46} value={query} aria-invalid={lookup.state === "empty" ? true : undefined}
            onChange={(event) => { setQuery(event.target.value); if (lookup.state === "empty" || lookup.state === "not-found") setLookup({ state: "idle", error: "" }); }} />
        </FilterField>
      </FilterBar>
      {/* 没找到不是错误：灰字写在框下，不带重试。 */}
      {lookup.state === "not-found" && <p className="rd-weak" role="status">没有找到这个用户，核对后再查。</p>}
      {staleNotice}
      {overviewBlock("账户概况") ?? (
        <Panel title="账户" icon={UserRound} tone="role-3" flush
          sub={firstLoading ? undefined : totalAccounts !== null && totalAccounts > accounts.length ? `共 ${totalAccounts.toLocaleString("en-US")} 个账户 · ${zoneNote}` : zoneNote}
          explain="冻结的排在前面；冻结中的账户不一定都在这里，找具体用户用上面的查找。在线设备按最近 200 条登录记录数，可能少算，准确数在详情里。">
          <Table label="账户">
            <thead><tr>
              <Th icon={User} tone="users">账户</Th>
              <Th>账户状态</Th>
              <Th>风险</Th>
              <Th>注册 · 最近登录</Th>
              <Th align="right">{sessionsTruncated ? "在线设备（至少）" : "在线设备"}</Th>
              {accountActions && <Th sticky="end">操作</Th>}
            </tr></thead>
            <tbody>
              {firstLoading ? <TableLoading columns={accountActions ? 6 : 5} rows={5} />
                : accountRows.length === 0 ? <TableMessage columns={accountActions ? 6 : 5}>暂无账户</TableMessage>
                  : accountRows.map((account) => {
                    const id = accountId(account);
                    return (
                      <Tr key={id} selected={accountId(acct) === id} aria-label={`查看账户 ${displayAccount(account)}`} onOpen={() => openAccount(account)}>
                        {/* 账户列伸缩，时间列按内容定宽，在线设备紧跟在后面（第 6 列的列宽）。 */}
                        <Td grow><Cell main={<span data-mono>{text(account.userNo, id)}</span>} sub={userNicknameText(text(account.nickname), account.phoneMasked)} /></Td>
                        <Td><AccountStatusTag status={account.status} table /></Td>
                        <Td><RiskCell account={account} /></Td>
                        {/* 最近登录帮着判断账户还在不在用；列表是最近注册的 50 个，注册时间说明排在这里的是谁。 */}
                        <Td data-fit=""><Cell num main={timeText(account.registeredAt)} sub={account.lastLoginAt ? timeText(account.lastLoginAt) : "没有登录记录"} /></Td>
                        <Td align="right"><Cell num main={sessionCell(account)} /></Td>
                        {accountActions && <Td sticky="end">{rowAction(account)}</Td>}
                      </Tr>
                    );
                  })}
            </tbody>
          </Table>
          {!firstLoading && accounts.length > 0 && <Pager label="账户" total={accounts.length} page={accountPage} pageSize={accountSize} sizes={PAGE_SIZES} loading={overview.loading}
            onPage={setAccountPage} onPageSize={(size) => { setAccountSize(size); setAccountPage(1); }} />}
        </Panel>
      )}
    </div>
  );

  /* ── 用户数据只读视图页签 ── */
  const viewsPane = (
    <div className="rd-stack">
      {staleNotice}
      {overviewBlock("用户数据只读视图") ?? (
        <Panel title="用户数据只读视图" icon={Eye} tone="progress" flush
          sub={firstLoading ? undefined : `${totalViews !== null && totalViews > impersonations.length ? `最近 ${impersonations.length} 次 · 共 ${totalViews.toLocaleString("en-US")} 次` : `共 ${impersonations.length} 次`} · ${zoneNote}`}
          explain="按这个用户的数据显示账户、钱包、设备和资料四组内容，不是用户看到的 App 页面。只能看不能改，到时间自动关闭；打开和每次切页都记进操作记录。"
          actions={canStartImpersonation ? <Button disabled={busy} disabledReason={submitting ? SUBMITTING : undefined} onClick={() => startView(null)}>开始查看</Button> : undefined}>
          <Table label="用户数据只读视图记录">
            <thead><tr>
              <Th>查看 · 开始时间</Th>
              <Th icon={User} tone="users">查看人 → 用户</Th>
              <Th>状态</Th>
              <Th>剩余</Th>
              <Th>原因</Th>
              {canTerminateImpersonation && <Th sticky="end">操作</Th>}
            </tr></thead>
            <tbody>
              {firstLoading ? <TableLoading columns={canTerminateImpersonation ? 6 : 5} rows={4} />
                : impersonations.length === 0 ? <TableMessage columns={canTerminateImpersonation ? 6 : 5}>暂无记录。{canStartImpersonation && <><br /><span className="rd-weak">在账户详情底部「…」或上面「开始查看」打开。</span></>}</TableMessage>
                  : impersonations.map((row) => {
                    const no = text(row.sessionNo, "");
                    const status = impersonationStatus(row);
                    const active = isActiveImpersonation(row);
                    const left = count(row.leftMinutes) ?? 0;
                    const ttl = count(row.ttlMinutes) ?? 0;
                    return (
                      <Tr key={no} selected={trace?.sessionNo === no} aria-label={`查看记录 ${no}`} onOpen={() => setTrace(row)}>
                        <Td><Cell main={<span data-mono>{no}</span>} sub={timeText(row.createdAt)} /></Td>
                        <Td><Cell main={<>{text(row.operator)} → <span data-mono>{text(row.userNo)}</span></>} /></Td>
                        <Td><StatusTag tone={status.tone}>{status.label}</StatusTag></Td>
                        <Td>{active ? <InlineMeter value={ttl > 0 ? left / ttl : 0} text={`剩 ${left} 分钟`} tone="progress" /> : <span className="rd-weak">—</span>}</Td>
                        <Td grow><Cell main={text(row.reason)} title={text(row.reason)} /></Td>
                        {canTerminateImpersonation && <Td sticky="end">{active && <Button size="sm" disabled={busy && opening !== `impEnd|${no}`} loading={opening === `impEnd|${no}`} disabledReason={listBlock(`view|${no}`)} onClick={() => void confirmEndView(row)}>立即结束</Button>}</Td>}
                      </Tr>
                    );
                  })}
            </tbody>
          </Table>
        </Panel>
      )}
    </div>
  );

  /* ── 账户名单页签 ── */
  const listsExplain = "禁入：用户登录不了 App，加入时已登录的设备全部下线。信任：目前没有哪项检查按它放宽，只做记录。每个用户只有一条，加入另一种会替换掉现在的。";
  const listsPane = (
    <div className="rd-stack">
      {staleNotice}
      {overviewBlock("账户名单") ?? (
        <Panel title="信任和禁入名单" icon={ListChecks} tone="role-4" flush explain={listsExplain}
          sub={firstLoading ? undefined : totalLists !== null && totalLists > listRows.length ? `最近更新的 ${listRows.length} 条 · 共 ${totalLists.toLocaleString("en-US")} 条 · ${zoneNote}` : zoneNote}
          actions={canManageLists ? <span className="rd-row-actions">
            <Button disabled={busy} disabledReason={submitting ? SUBMITTING : overviewStale ? STALE : undefined} onClick={() => openActionConfirm(addList("ALLOW", null))}>+ 加入信任名单</Button>
            <Button disabled={busy} disabledReason={submitting ? SUBMITTING : overviewStale ? STALE : undefined} onClick={() => openActionConfirm(addList("BLOCK", null))}>+ 加入禁入名单</Button>
          </span> : undefined}>
          <Table label="信任和禁入名单">
            <thead><tr>
              <Th icon={User} tone="users">用户</Th>
              <Th>名单</Th>
              <Th>状态</Th>
              <Th>失效时间</Th>
              <Th>理由 · 加入人</Th>
              {canManageLists && <Th sticky="end">操作</Th>}
            </tr></thead>
            <tbody>
              {firstLoading ? <TableLoading columns={canManageLists ? 6 : 5} rows={4} />
                : listPageRows.length === 0 ? <TableMessage columns={canManageLists ? 6 : 5}>暂无名单{canManageLists && <><br /><span className="rd-weak">从账户详情底部「…」或上面的按钮加入。</span></>}</TableMessage>
                  : listPageRows.map((entry) => {
                    const id = text(entry.userId, "");
                    const status = listStatus(entry);
                    const active = isActiveListEntry(entry);
                    return (
                      <Tr key={`${id}-${text(entry.kind)}-${text(entry.status)}`}>
                        <Td><Cell main={<span data-mono>{text(entry.userNo)}</span>} sub={userNicknameText(text(entry.nickname), entry.phoneMasked)} /></Td>
                        {/* 只有生效中的禁入用红；已移出、已到期降成灰，图标留着分得清禁入和信任（VS-21）。 */}
                        <Td><StatusTag tone={!active ? "done" : upper(entry.kind) === "BLOCK" ? "danger" : "neutral"} icon={upper(entry.kind) === "BLOCK" ? Ban : ShieldCheck}>{listKindText(entry.kind)}</StatusTag></Td>
                        <Td><StatusTag tone={status.tone} icon={status.icon}>{status.label}</StatusTag></Td>
                        <Td><Cell num main={active ? (entry.expiresAt ? timeText(entry.expiresAt) : "长期") : <span className="rd-weak">{entry.expiresAt ? timeText(entry.expiresAt) : "长期"}</span>} /></Td>
                        <Td grow><Cell main={text(entry.reason)} sub={`${text(entry.createdBy)} · ${timeText(entry.createdAt)}`} title={text(entry.reason)} /></Td>
                        {canManageLists && <Td sticky="end">{active && <Button size="sm" disabled={busy && opening !== `listRemove|${id}`} loading={opening === `listRemove|${id}`} disabledReason={listBlock(`list|${id}`)} onClick={() => void confirmRemoveList(entry)}>移出名单</Button>}</Td>}
                      </Tr>
                    );
                  })}
            </tbody>
          </Table>
          {!firstLoading && listRows.length > 0 && <Pager label="信任和禁入名单" total={listRows.length} page={listPage} pageSize={listSize} sizes={PAGE_SIZES} loading={overview.loading}
            onPage={setListPage} onPageSize={(size) => { setListSize(size); setListPage(1); }} />}
        </Panel>
      )}
    </div>
  );

  /* ── 账户抽屉 ── */
  const ctxData = context.data && accountId(context.data.account) === accountId(acct) ? context.data : null;
  const shown = ctxData?.account ?? accounts.find((account) => accountId(account) === accountId(acct)) ?? acct;
  const shownId = accountId(shown);
  const shownStatus = upper(shown?.status);
  const fact = ctxData?.controlFact ?? null;
  const shownSessions = ctxData?.sessions ?? [];
  const shownActiveCount = count(ctxData?.activeSessions);
  const shownList = ctxData?.accountList && isActiveListEntry(ctxData.accountList) ? ctxData.accountList : null;
  const shownActiveView = ctxData?.impersonations?.find(isActiveImpersonation);
  const sourceCode = upper(fact?.freezeSource);
  const pendingRevoke = session && shownId ? pendingSessionRevocationApproval(session.adminId, shownId) : undefined;
  const accountIndex = accountRows.findIndex((account) => accountId(account) === shownId);
  const prevAccount = accountIndex > 0 ? accountRows[accountIndex - 1] : undefined;
  const nextAccount = accountIndex >= 0 ? accountRows[accountIndex + 1] : undefined;

  const drawerBase = !ctxData ? (context.loading ? "正在读取…" : NO_CONTEXT) : locked.has(`user|${shownId}`) ? LOCKED_USER : submitting ? SUBMITTING : undefined;
  const unfreezeBlock = drawerBase ?? (sourceCode === "K1_MULTI_ACCOUNT_CLUSTER" ? K1_BLOCK : sourceCode === "CREGIS_DEPOSIT_INCIDENT" ? CREGIS_BLOCK : undefined);
  const revokeBlock = drawerBase ?? (!pendingRevoke && (shownActiveCount ?? 0) <= 0 ? NO_SESSION_TO_REVOKE : undefined);
  const viewBlock = drawerBase ?? (shownStatus !== "ACTIVE" ? VIEW_NEEDS_ACTIVE : shownActiveView ? VIEW_ALREADY_OPEN : undefined);
  const listBase = !ctxData ? (context.loading ? "正在读取…" : NO_CONTEXT) : locked.has(`list|${shownId}`) ? LOCKED_LIST : submitting ? SUBMITTING : undefined;

  const moreItems: MoreMenuItem[] = !shown ? [] : [
    ...(canStartImpersonation ? [{ key: "view", label: "查看这个用户的数据", disabledReason: viewBlock, onSelect: () => startView(shown) }] : []),
    ...(canManageLists && upper(shownList?.kind) !== "ALLOW" ? [{ key: "allow", label: "加入信任名单", disabledReason: listBase, onSelect: () => ctxData && openActionConfirm(addList("ALLOW", ctxData)) }] : []),
    ...(canManageLists && upper(shownList?.kind) !== "BLOCK" ? [{ key: "block", label: "加入禁入名单", disabledReason: listBase, onSelect: () => ctxData && openActionConfirm(addList("BLOCK", ctxData)) }] : []),
    ...(canManageLists && shownList ? [{ key: "remove", label: "移出名单", disabledReason: listBase, onSelect: () => openActionConfirm(removeList({ ...shownList, userNo: shown.userNo, nickname: shown.nickname }, shown.status)) }] : []),
  ];
  const primaryKind = shownStatus === "ACTIVE" && canFreeze ? "freeze" : shownStatus === "FROZEN" && canUnfreeze ? "unfreeze" : null;
  const primaryBlock = primaryKind === "unfreeze" ? unfreezeBlock : primaryKind === "freeze" ? drawerBase : undefined;
  // 常显的阻断原因：先写主决定的，没有时写退出全部设备的；读取中不写（判断要点在转圈）。
  const drawerNote = context.loading && !ctxData ? undefined : primaryBlock ?? (canRevoke ? revokeBlock : undefined);
  const hasFooter = Boolean(primaryKind) || canRevoke || moreItems.length > 0;
  const accountFooter = shown && hasFooter && (
    <Decision note={drawerNote ? <>{drawerNote}{primaryBlock === K1_BLOCK && canOpenK1 && <> <Link className="rd-link" href={K1_PATH} prefetch={false}>去多账户风险排查</Link></>}{primaryBlock === CREGIS_BLOCK && canOpenD1 && <> <Link className="rd-link" href={D1_PATH} prefetch={false}>去充值与收款对账</Link></>}</> : undefined}
      others={<>
        {canRevoke && <Button icon={<LogOut size={14} aria-hidden />} disabled={busy} disabledReason={revokeBlock} onClick={() => ctxData && revokeAll(ctxData)}>退出全部设备</Button>}
        {moreItems.length > 0 && <MoreMenu label="更多操作" items={moreItems} disabled={busy} />}
      </>}
      primary={primaryKind ? <Button variant="primary" aria-label={primaryKind === "freeze" ? `冻结 ${displayAccount(shown)}` : `恢复 ${displayAccount(shown)}`} disabled={busy && opening !== `${primaryKind}|${shownId}`} loading={opening === `${primaryKind}|${shownId}`}
        disabledReason={primaryBlock} onClick={() => void confirmStatus(shown, primaryKind)}>{primaryKind === "freeze" ? "冻结" : "恢复"}</Button> : undefined} />
  );

  const shownRisk = riskOf(shown);
  const statusMeta = formatAccountStatus(shown?.status);
  // 正常时标题旁的标签已经写了，这一行不重复；其他状态跟标签同色（建议 3）。
  const judgment: JudgmentRow[] = !shown ? [] : [
    ...(shownStatus === "ACTIVE" ? [] : [{ label: "账户状态", value: shownStatus === "FROZEN" ? `冻结 · ${freezeSourceText(fact?.freezeSource)}` : statusMeta.label,
      state: statusMeta.tone === "ok" ? undefined : statusMeta.tone,
      reason: shownStatus === "FROZEN" && fact?.freezeSource && !FREEZE_SOURCE[sourceCode] ? <Explain label="冻结来源的原码" content={`来源原码 ${text(fact.freezeSource)}`} /> : undefined }]),
    { label: "在线设备", value: shownActiveCount === null ? "—" : shownActiveCount === 0 ? <span className="rd-weak">0 台</span> : `${shownActiveCount} 台` },
    { label: "名单", value: listEntryText(shownList), state: upper(shownList?.kind) === "BLOCK" ? "danger" : undefined },
    { label: "风险", value: shownRisk.text, state: shownRisk.tone === "done" ? undefined : shownRisk.tone },
    ...(shownStatus === "FROZEN" ? [{ label: "一起冻结的提现", value: count(fact?.d2FrozenWithdrawalCount) === null ? "—" : `${count(fact?.d2FrozenWithdrawalCount)} 笔 · 恢复账户时一起恢复` }] : []),
  ];

  const accountDrawer = (
    <Drawer open={Boolean(acct) && !mirror} onClose={closeAccount} title="账户详情" icon={UserRound} tone="role-3" busy={Boolean(submitting)}
      sub={shown && <>
        <span data-mono>{text(shown.userNo)}</span> <IconButton aria-label="复制用户编码" data-size="sm" onClick={() => copyText(text(shown.userNo, ""), "用户编码")}><Copy size={13} aria-hidden /></IconButton>
        <AccountStatusTag status={shown.status} />
      </>}
      nav={{ hasPrev: Boolean(prevAccount), hasNext: Boolean(nextAccount), onPrev: () => { if (prevAccount) openAccount(prevAccount); }, onNext: () => { if (nextAccount) openAccount(nextAccount); } }}
      footer={accountFooter}>
      {shown && <>
        {/* 读取失败用带图标的红色提示和次按钮；底栏已经写了还没读到，这里不再写「已暂停处理」（建议 4）。 */}
        {context.error && <Notice tone="danger" action={context.error === NO_ID ? undefined : <Button size="sm" loading={context.loading} onClick={reloadContext}>重新加载</Button>}>
          {context.error === NO_ID ? NO_ID : `账户详情加载失败：${sentence(context.error)}`}
        </Notice>}
        <JudgmentPoints title="判断要点" loading={context.loading && !ctxData} rows={ctxData ? judgment : judgment.filter((row) => row.label === "账户状态" || row.label === "风险")} />
        {ctxData && shownStatus === "FROZEN" && (
          <Panel plain headingLevel={3} title="冻结情况" sub={zoneNote}>
            <Facts>
              <Fact k="来源单号">{fact?.freezeSourceRef ? <span data-mono>{text(fact.freezeSourceRef)}</span> : "—"}</Fact>
              <Fact k="原因">{freezeReasonText(fact)}</Fact>
              <Fact k="操作人">{text(fact?.freezeOperator)}</Fact>
              <Fact k="冻结时间">{timeText(fact?.frozenAt)}</Fact>
            </Facts>
          </Panel>
        )}
        <Panel plain headingLevel={3} title="账户">
          <Facts>
            <Fact k="昵称">{userNicknameText(text(shown.nickname), shown.phoneMasked)}</Fact>
            <Fact k="手机号">{text(shown.phoneMasked)}</Fact>
            {/* 名字同用户详情：分层、可用余额（DT-14）。 */}
            <Fact k="分层">{`${text(shown.userLevel)} · ${text(shown.vRank)}`}</Fact>
            <Fact k="USDT 可用余额">{amountWith(shown.walletUsdt, "USDT")}</Fact>
            <Fact k="UVT 可用余额">{amountWith(shown.walletNex, "UVT")}</Fact>
          </Facts>
        </Panel>
        {ctxData && <div className="rd-fold-flush">
          <Fold inset title="登录记录" summary={`最近 ${shownSessions.length} 条，${shownSessions.filter(isActiveSession).length} 条活跃 · ${zoneNote}`}>
            <Table label="登录记录">
              <thead><tr><Th>设备 · 编号 · IP</Th><Th>状态</Th><Th>到期</Th></tr></thead>
              <tbody>
                {shownSessions.length === 0 ? <TableMessage columns={3}>暂无登录记录。</TableMessage> : shownSessions.map((row) => (
                  <Tr key={text(row.refreshTokenId)}>
                    {/* 抽屉只有 540 宽：编号和 IP 进设备的第二行，到期不用横向滚动就看得到（D6-key）。 */}
                    <Td grow><Cell main={platformSessionDeviceText(text(row.deviceName))} sub={<span data-mono>{maskedSessionId(row.refreshTokenId)} · {text(row.clientIpMasked)}</span>} /></Td>
                    <Td><StatusTag tone={isActiveSession(row) ? "ok" : "done"}>{formatC1SessionStatus(row.status)}</StatusTag></Td>
                    {/* 已撤销、已过期的登录没有「到期」可言，写「—」（建议 10）。 */}
                    <Td><Cell num main={isActiveSession(row) ? timeText(row.expiresAt) : <span className="rd-weak">—</span>} /></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
            {ctxData.sessionsTruncated && <p className="rd-weak">该用户共有 {text(ctxData.totalSessions, "0")} 条登录记录，这里显示最近 {shownSessions.length} 条。</p>}
          </Fold>
          <Fold inset title="技术详情" summary={`系统编号 ${shownId || "—"}`}>
            <Facts>
              <Fact k="系统编号">{shownId || "—"}</Fact>
              {shownStatus === "FROZEN" && <Fact k="冻结时间">{formatBusinessTimeFull(fact?.frozenAt, "—")}</Fact>}
            </Facts>
          </Fold>
        </div>}
        {canOpenK1 && <nav className="rd-links" aria-label="这个用户的相关页面"><Link className="rd-link" href={K1_PATH} prefetch={false}>查看关联账户 →</Link></nav>}
      </>}
    </Drawer>
  );

  /* ── 查看记录抽屉 ── */
  const traceRow = trace ? impersonations.find((row) => row.sessionNo === trace.sessionNo) ?? trace : null;
  const traceNo = text(traceRow?.sessionNo, "");
  const traceActive = isActiveImpersonation(traceRow);
  const traceDrawer = (
    <Drawer open={Boolean(traceRow) && tab === "views" && !mirror} onClose={() => setTrace(null)} title="查看记录" icon={Eye} tone="progress" busy={Boolean(submitting)}
      sub={traceRow && <><span data-mono>{traceNo}</span> <StatusTag tone={impersonationStatus(traceRow).tone}>{traceActive ? `进行中 · 剩 ${count(traceRow.leftMinutes) ?? 0} 分钟` : impersonationStatus(traceRow).label}</StatusTag> <span className="rd-weak">{zoneNote}</span></>}
      footer={traceRow && traceActive && canTerminateImpersonation && <Decision note={listBlock(`view|${traceNo}`) === LOCKED_VIEW ? LOCKED_VIEW : undefined}
        primary={<Button variant="primary" disabled={busy && opening !== `impEnd|${traceNo}`} loading={opening === `impEnd|${traceNo}`} disabledReason={listBlock(`view|${traceNo}`)} onClick={() => void confirmEndView(traceRow)}>立即结束</Button>} />}>
      {traceRow && <>
        <Facts>
          <Fact k="用户编码"><span data-mono>{text(traceRow.userNo)}</span></Fact>
          <Fact k="查看人">{text(traceRow.operator)}</Fact>
          <Fact k="原因">{text(traceRow.reason)}</Fact>
          <Fact k="开始时间">{timeText(traceRow.createdAt)}</Fact>
          <Fact k="到期时间">{timeText(traceRow.expiresAt)}</Fact>
          <Fact k="结束人">{text(traceRow.endedBy)}</Fact>
          <Fact k="结束原因">{text(traceRow.endReason)}</Fact>
        </Facts>
        <p className="rd-weak">具体看了哪些页面，可在{canReadAudit ? <>「<Link className="rd-link" href="/platform/audit" prefetch={false}>操作记录与审批</Link>」</> : "「操作记录与审批」"}查询。</p>
      </>}
    </Drawer>
  );

  /* ── 只读视图抽屉 ── */
  const switchMirror = async (page: string) => {
    if (!mirrorToken || page === mirrorPage) return;
    setMirrorLoading(true);
    try {
      setMirror(await fetchImpersonationReadonlyView(mirrorToken, page));
      setMirrorPage(page);
    } catch (cause) {
      toast(readError(cause), "warn");
    } finally {
      setMirrorLoading(false);
    }
  };
  const mirrorDrawer = (
    // 和账户抽屉同为 540 宽（VS-64）；当前页面写成按钮左边一行弱文字，不留孤零零的问号。
    <Drawer open={Boolean(mirror)} onClose={closeMirror} title={`用户数据只读视图 · ${text(jsonRecord(mirror?.user).userNo)}`} icon={Eye} tone="progress" busy={Boolean(submitting)}
      footer={mirror && canTerminateImpersonation && <Decision others={<span className="rd-toolbar-note">当前在「{MIRROR_PAGES.find((item) => item.value === text(mirror.currentPage, mirrorPage))?.label ?? text(mirror.currentPage, mirrorPage)}」，每次切页都记进操作记录</span>}
        primary={<Button variant="primary" disabled={busy} disabledReason={locked.has(`view|${text(mirror.sessionNo, "")}`) ? LOCKED_VIEW : undefined} onClick={exitMirror}>退出并结束</Button>} />}>
      {mirror && <div className="rd-stack">
        <Notice tone="warn">
          <p>剩余 <b className="inline-block min-w-[5ch] tabular-nums" data-testid="impersonation-countdown">{formatCountdown(mirrorRemainingSeconds)}</b> · 到期 {timeText(mirror.expiresAt)}（{zone}）</p>
          <p>关掉这个窗口后不能再打开这次的视图，计时还在走；看完请点「退出并结束」。</p>
        </Notice>
        <Segments label="用户数据只读视图页面" value={mirrorPage} onChange={(page) => void switchMirror(page)}
          items={MIRROR_PAGES.map((item) => ({ ...item, disabled: mirrorLoading || busy }))} />
        {mirrorLoading ? <BlockState state="loading" title="正在读取…" /> : <ImpersonationUserScreen screen={jsonRecord(mirror.screen)} />}
      </div>}
    </Drawer>
  );

  /* ── 页面 ── */
  if (!canReadC2 && !canReadDeletions) {
    return <>
      {header}
      <BlockState state="denied" title="无权限访问" detail="这个账号没有账户操作和注销申请的读取权限。" />
    </>;
  }

  const tabItems = readable.map((value) => value === "accounts" ? { value, label: "账户处置" }
    : value === "deletions" ? { value, label: "注销申请", count: deletionCounts.data ? pendingDeletions ?? undefined : deletionCounts.error ? "—" : undefined }
      : value === "views" ? { value, label: "用户数据只读视图" }
        : { value, label: "账户名单" });

  const related = [
    reach("/users/security", "user_c5_read") && <Link key="c5" className="rd-link" href="/users/security" prefetch={false}>安全与登录设备</Link>,
    canOpenK1 && <Link key="k1" className="rd-link" href={K1_PATH} prefetch={false}>多账户风险排查</Link>,
    canReadAudit && <Link key="a2" className="rd-link" href="/platform/audit" prefetch={false}>操作记录与审批</Link>,
  ].filter(Boolean);

  return <>
    {header}
    {pendingNotices}
    {focusNotice}
    {conclusion}
    {statBand}
    <PageTabs ids={tabIds} label="账户操作内容" value={tab} onChange={changeTab} items={tabItems} />
    <div {...tabIds.panel(tab)} className="rd-tab-pane">
      {tab === "accounts" && accountsPane}
      {tab === "deletions" && <AccountDeletionQueue ctx={ctx} canWrite={canWriteDeletions} status={deletionStatus} onStatus={setDeletionStatus}
        refreshKey={deletionRefresh} focusKey={deletionFocus} onChanged={() => void loadDeletionCounts()} canReadUserDetail={canReadUserDetail} canReadAssetAdjustments={canReadAssetAdjustments}
        locked={(requestNo) => locked.has(`deletion|${requestNo}`)} submitting={Boolean(submitting)} send={deletionCommand} />}
      {tab === "views" && viewsPane}
      {tab === "lists" && listsPane}
    </div>
    {related.length > 0 && <nav className="rd-links" aria-label="相关页面"><span>相关页面</span>{related}</nav>}

    {accountDrawer}
    {traceDrawer}
    {mirrorDrawer}
    {releasing && <ReleaseModal label={releasing.label} onCancel={() => setReleasing(null)} onConfirm={() => releasePending(releasing)}
      explain="重试被拒说明不了原操作的结果，先读回核对或到操作记录确认。这里只清理本页的待确认，不是系统结案；之后的操作仍须通过系统校验。" />}
  </>;
}
