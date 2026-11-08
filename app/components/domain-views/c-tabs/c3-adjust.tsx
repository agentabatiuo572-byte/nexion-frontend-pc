"use client";

/**
 * C3 余额与资产调整（列表页·队列模式，PG-44）。一屏三件事：几笔调整等审批、发起一笔（右边同时算批准后会怎样）、待审批队列；
 * 调整历史收进折叠。三块各自读、各自失败、各自重试，失败只清这一块。
 * 写操作照提现审核：先把原操作存好再发；结果未知转成页面上方的待确认条，对象锁住，只能原样重试，
 * 后端明确拒绝后才能解除（OP-91～OP-96）。
 */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Calculator, Coins, Copy, FilePen, FileText, History, Inbox, Info, RefreshCw, Scale, User } from "lucide-react";
import {
  Button, Cell, Change, ColumnPicker, Conclusion, Decision, Drawer, Explain, Fact, Facts, Field, FilterBar, Fold, IconButton,
  InlineRetry, Input, IrreversibleTag, JudgmentPoints, Notice, PageHeader, Pager, Panel, ReleaseModal, SearchSelect, Segments,
  StatusTag, Table, TableLoading, TableMessage, Td, Textarea, Th, Tr, useTableColumns, BlockState, type JudgmentRow, type StateTone,
} from "@/app/components/rd";
import { AutoGloss } from "@/app/components/kit/gloss";
import { nexGridBrandText, operatorNicknameText } from "@/lib/admin/brand-copy";
import { businessClock, businessZone, formatBusinessTimeCompact, formatBusinessTimeFull } from "@/lib/admin/business-time";
import { formatC1RiskBand } from "@/lib/admin/c1-detail-display";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminError } from "@/lib/admin/error-messages";
import { announcePermissionDenied, isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { isIdempotencyOutcomeOpen } from "@/lib/admin/outcome-classification";
import { createPendingMutationStore, isRetryExpired, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { useReach } from "@/lib/nav/use-reach";
import { fmtConfigPct } from "@/lib/format";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  approveUserAssetAdjustment,
  createUserAssetAdjustment,
  fetchUserAssetAdjustmentAccounts,
  fetchUserAssetAdjustmentContext,
  fetchUserAssetAdjustmentDetail,
  fetchUserAssetAdjustmentOverview,
  fetchUserAssetAdjustments,
  rejectUserAssetAdjustment,
  requestLargeUserAssetAdjustment,
  reverseUserAssetAdjustment,
  UsersOutcomeUnknownError,
  UsersRequestError,
  withdrawUserAssetAdjustment,
  type User360Profile,
  type UserAssetAdjustment,
  type UserAssetAdjustmentContext,
  type UserAssetAdjustmentDetail,
  type UserAssetAdjustmentOverview,
  type UserPage,
} from "@/lib/admin/user360-client";
import type { ActionConfirmReq, CCtx } from "./types";

const OPERATOR = currentAdminOperator;
const ASSETS = ["USDT", "UVT"] as const;
const REASON_CODES = [
  ["SUPPORT_COMPENSATION", "客服补偿"],
  ["SYSTEM_CORRECTION", "系统纠错"],
  ["CAMPAIGN_REISSUE", "活动补发"],
  ["DISPUTE_RETURN", "争议退回"],
] as const;
const REASON_CODE_LABELS: Record<string, string> = {
  SUPPORT_COMPENSATION: "客服补偿",
  SYSTEM_CORRECTION: "系统纠错",
  CAMPAIGN_REISSUE: "活动补发",
  DISPUTE_RETURN: "争议退回",
  REVERSAL: "冲正",
  OPS_USER_ADJUSTMENT: "运营余额调整",
};
const PAGE_SIZES = [5, 10, 20, 50] as const;
const PENDING_STATUSES = ["PENDING_REVIEW", "PENDING"];
/** 状态名按审批单一套（OP-58、OP-59），不用后端的 statusLabel；枚举值不改（TX-34）。 */
const STATUS: Record<string, { label: string; tone: StateTone }> = {
  PENDING_REVIEW: { label: "待审批", tone: "neutral" },
  PENDING: { label: "待审批", tone: "neutral" },
  APPROVED: { label: "已批准", tone: "ok" },
  REJECTED: { label: "已驳回", tone: "done" },
  WITHDRAWN: { label: "已撤回", tone: "done" },
  SUSPENDED: { label: "红线挂起", tone: "warn" },
};
/** 账户状态的叫法和用户详情一致（BANNED 叫「封禁」）。 */
const ACCOUNT_STATUS: Record<string, string> = { ACTIVE: "正常", FROZEN: "冻结", RESTRICTED: "受限", BANNED: "封禁" };
const C01_FLOW = "提交后余额不会马上变，需由另一位同事复核批准后才生效。";
const C01_RULE = "余额调整只用于纠错和补偿。调错了用「冲正」抵消，原记录会保留。";
const RETRY_NO_PERMISSION = "这个账号现在没有这项操作的权限，不能重试，请到操作记录与审批核对";
const UNKNOWN_TOAST = "结果未确认，不要重复操作。到页面上方读回核对或按原操作重试。";
const LOCKED_ROW = "这张单有结果未确认的操作，先到页面上方核对";
const LOCKED_USER = "这个用户有一笔结果未确认的提交，先到页面上方核对";
const MINE = "这是你发起的，需要另一位管理员处理";
/** 行内只有一格宽，写短句；完整的一句在抽屉里（OP-66）。 */
const MINE_SHORT = "需另一位管理员处理";
const WAITING = "等待有批准权限的同事处理";
/** 状态已被别人或系统改了：框不关，读回写最新状态（D2-C89）。 */
const MOVED_CODES = ["ASSET_ADJUSTMENT_REVIEW_RACE_LOST", "INVALID_STATE_TRANSITION", "C3_ADJUSTMENT_WITHDRAW_CONFLICT", "C3_ADJUSTMENT_WITHDRAW_RACE_LOST", "C3_ALREADY_REVERSED", "C3_ONLY_ORIGINAL_APPROVED_ADJUSTMENT_REVERSIBLE"];

type Asset = (typeof ASSETS)[number];
type Direction = "CREDIT" | "DEBIT";
type Row = UserAssetAdjustment;
type Block<T> = { data: T | null; loading: boolean; error: string };
type Kind = "create" | "large" | "approve" | "reject" | "withdraw" | "reverse";
type CreateInput = { asset: Asset; direction: Direction; amount: string; reasonCode: string; reason: string; evidenceRef: string };
type Coverage = { reliable: boolean; ratio: number; redline: number; reserve: number; liabilities: number };

/** 一条未确认的写操作：种类、对象、原内容、操作人、发出时的状态和命令号都存下，重试只能原样（OP-92、OP-94）。 */
type C3Pending = PendingMutationRecord & {
  kind: Kind;
  /** 待确认条上写的说明。 */
  label: string;
  /** 创建是用户的系统编号，其余是调整单号。 */
  target: string;
  userNo?: string;
  input?: CreateInput;
  reason?: string;
  operator: string;
  fromStatus?: string;
};

const KINDS: readonly Kind[] = ["create", "large", "approve", "reject", "withdraw", "reverse"];
const KIND_LABEL: Record<Kind, string> = { create: "提交调整申请", large: "提交大额调整请求", approve: "批准调整申请", reject: "驳回调整申请", withdraw: "撤回调整申请", reverse: "冲正调整" };
const KIND_PREFIX: Record<Kind, string> = { create: "c3-adjust", large: "c3-adjust", approve: "c3-approve", reject: "c3-reject", withdraw: "c3-withdraw", reverse: "c3-reverse" };
/** 按对象锁，不按内容（OP-93）：同一个用户的提交、同一张单的审批、同一张单的冲正各一把锁。 */
const scopeOf = (kind: Kind, target: string) => kind === "create" || kind === "large" ? `create|${target}` : kind === "reverse" ? `reverse|${target}` : `adjustment|${target}`;

function validInput(value: unknown): value is CreateInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Record<string, unknown>;
  return ASSETS.includes(input.asset as Asset) && (input.direction === "CREDIT" || input.direction === "DEBIT")
    && ["amount", "reasonCode", "reason", "evidenceRef"].every((key) => typeof input[key] === "string" && (input[key] as string).length > 0);
}

/** 旧版（v1）只存内容指纹，不能当原操作重试，不迁移（产品决定 4，同闸门 2 决定 53）。 */
const c3Commands = createPendingMutationStore<C3Pending>({
  storageKey: "nexion-admin-c3-adjust-commands-v2",
  // 过期后不能再用原号重试，记录和对象锁都留着（OP-96、决定 03）。
  retainExpiredRecords: true,
  isValidRecord: (record) => KINDS.includes(record.kind)
    && typeof record.target === "string" && record.target.length > 0
    && typeof record.label === "string" && typeof record.operator === "string"
    && record.fingerprint === scopeOf(record.kind, record.target)
    && (record.kind === "create" || record.kind === "large" ? validInput(record.input) : typeof record.reason === "string" && record.reason.length > 0),
});

function text(value: unknown, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function upper(value: unknown) {
  return text(value, "").trim().toUpperCase();
}

function statusOf(row: Pick<Row, "status">) {
  return STATUS[upper(row.status)] ?? { label: "状态未知", tone: "warn" as StateTone };
}

function isPendingRow(row: Pick<Row, "status">) {
  return PENDING_STATUSES.includes(upper(row.status));
}

function reasonCodeLabel(value: unknown) {
  return REASON_CODE_LABELS[upper(value)] ?? "其他";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? displayAdminError(error) : "余额调整请求失败，请刷新后重试";
}

function accountId(account: Pick<User360Profile, "userId" | "id"> | null | undefined) {
  const id = account?.userId ?? account?.id;
  return id === null || id === undefined || id === "" ? "" : String(id);
}

function userText(account: { userNo?: string | null; nickname?: string | null } | null | undefined) {
  return account ? `${text(account.userNo)} · ${operatorNicknameText(text(account.nickname))}` : "—";
}

/** 长单号中间省略，留前缀和末 6 位（TX-28），全文在悬停和抽屉里。 */
function shortNo(no: string) {
  const match = /^([A-Z]+-)(.+)$/.exec(no);
  return match && match[2].length > 8 ? `${match[1]}…${match[2].slice(-6)}` : no;
}

function newCommandKey(kind: Kind) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${KIND_PREFIX[kind]}-${suffix}`;
}

function isOutcomeUnknown(error: unknown) {
  return error instanceof UsersOutcomeUnknownError || (error instanceof UsersRequestError && isIdempotencyOutcomeOpen(error.code));
}

function reasonCodeOf(error: unknown) {
  return error instanceof UsersRequestError ? error.code ?? "" : "";
}

/* ── 金额：接口给的全部小数，十进制加减，不用浮点（TX-20） ── */

const DECIMAL = /^-?\d+(?:\.\d+)?$/;

function decimal(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return DECIMAL.test(trimmed) ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 });
  return null;
}

function fractionOf(value: string) {
  const dot = value.indexOf(".");
  return dot < 0 ? "" : value.slice(dot + 1);
}

function scaled(value: string, digits: number) {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  const units = BigInt(whole + fraction.padEnd(digits, "0"));
  return negative ? -units : units;
}

function unscaled(value: bigint, digits: number) {
  const negative = value < BigInt(0);
  const raw = (negative ? -value : value).toString().padStart(digits + 1, "0");
  const fraction = digits ? `.${raw.slice(-digits)}` : "";
  return `${negative ? "-" : ""}${raw.slice(0, raw.length - digits)}${fraction}`;
}

/** 批准后余额：按两边最多的小数位放大成整数后加减。 */
function shifted(balance: string, amount: string, direction: Direction) {
  const digits = Math.max(fractionOf(balance).length, fractionOf(amount).length);
  const delta = scaled(amount, digits);
  return unscaled(scaled(balance, digits) + (direction === "CREDIT" ? delta : -delta), digits);
}

function isNegative(value: string) {
  return value.startsWith("-") && /[1-9]/.test(value);
}

/** 这一列要补到几位小数：本页最多的那一位，至少 2 位（ST-02）。 */
function digitsOf(values: readonly unknown[]) {
  return values.reduce<number>((most, value) => {
    const shown = decimal(value);
    return shown ? Math.max(most, fractionOf(shown).replace(/0+$/, "").length) : most;
  }, 2);
}

function money(value: string, digits = 2) {
  const sign = value.startsWith("-") ? "-" : "";
  const [whole, fraction = ""] = value.replace(/^-/, "").split(".");
  return `${sign}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.replace(/0+$/, "").padEnd(Math.max(2, digits), "0")}`;
}

function moneyOf(value: unknown, digits = 2) {
  const shown = decimal(value);
  return shown === null ? "—" : money(shown, digits);
}

function signedAmount(row: Pick<Row, "amount" | "direction">, digits = 2, flip = false) {
  const amount = decimal(row.amount);
  if (amount === null) return "—";
  const credit = (upper(row.direction) === "CREDIT") !== flip;
  return `${credit ? "+" : "-"}${money(amount, digits)}`;
}

/** USDT 等值：2–8 位，非零又小于 0.000001 时至少 8 位（原规则）。 */
function usdEquivalent(value: number) {
  const tiny = value !== 0 && Math.abs(value) < 0.000001;
  return value.toLocaleString("en-US", { minimumFractionDigits: tiny ? 8 : 2, maximumFractionDigits: 8 });
}

function pct(value: number) {
  return `${value.toFixed(1)}%`;
}

function coverageOf(value: unknown): Coverage | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const ratio = Number(source.coverageRatio);
  const redline = Number(source.redlinePct);
  return {
    reliable: source.reliable === true && Number.isFinite(ratio) && Number.isFinite(redline),
    ratio,
    redline,
    reserve: Number(source.reserveUsd),
    liabilities: Number(source.liabilitiesUsd),
  };
}

/** 和后端 projectedCoverageRatio 同一公式；应付款扣到 0 时返回 null（不写 999999.0%）。 */
function projectedCoverage(coverage: Coverage, direction: Direction, amountUsd: number): number | null {
  if (!(coverage.reserve > 0) || !(coverage.liabilities > 0)) return coverage.ratio;
  const next = direction === "CREDIT" ? coverage.liabilities + amountUsd : Math.max(0, coverage.liabilities - amountUsd);
  return next === 0 ? null : coverage.reserve * 100 / next;
}

/** 增加余额被覆盖率挡住的原因（产品决定 2：批准和发起一样拦）。 */
function creditCoverageBlock(coverage: Coverage | null, amountUsd: number): "unreliable" | "below" | null {
  if (!coverage?.reliable) return "unreliable";
  const after = projectedCoverage(coverage, "CREDIT", amountUsd);
  return after !== null && after < coverage.redline ? "below" : null;
}

function positiveInt(value: string | null, fallback: number) {
  return value && /^[1-9]\d{0,5}$/.test(value) ? Number(value) : fallback;
}

function pageSizeOf(value: string | null, fallback: number) {
  const size = Number(value);
  return (PAGE_SIZES as readonly number[]).includes(size) ? size : fallback;
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

const emptyBlock = <T,>(): Block<T> => ({ data: null, loading: true, error: "" });

export function C3Adjust({ ctx }: { ctx: CCtx }) {
  const { toast, openActionConfirm, openConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authEpoch = useAdminAuth((state) => state.authEpoch);
  const params = useSearchParams();
  const reach = useReach();
  const focusUserId = params?.get("userId") ?? "";
  const back = backOf(params?.get("returnTo") ?? "");
  const makerUsername = session?.username?.trim().toLowerCase() ?? "";
  const authorities = session?.authorities ?? [];
  const canCreate = authorities.includes("user_c3_adjust_create");
  const canApprove = authorities.includes("user_c3_adjust_approve");
  const canReverse = authorities.includes("user_c3_adjust_reverse");
  const canWriteAny = canCreate || canApprove || canReverse;
  const isSupport = session?.role === "support";
  const isFinance = session?.role === "finance";
  const canReadLedger = reach("/finance/ledger", "finance_d4_read");
  const canReadPool = reach("/finance/pool", "finance_d3_read");
  const canReadAudit = reach("/platform/audit", "platform_a2_read");
  const zone = businessZone().label;

  /* ── 网址里的分页和折叠（ST-23） ── */
  const [queuePage, setQueuePage] = useState(() => positiveInt(params?.get("queuePage") ?? null, 1));
  const [queueSize, setQueueSize] = useState(() => pageSizeOf(params?.get("queueSize") ?? null, 5));
  const [historyOpen, setHistoryOpen] = useState(() => params?.get("history") === "1");
  const [historyAsset, setHistoryAsset] = useState<"" | Asset>(() => {
    const value = params?.get("historyAsset") ?? "";
    return ASSETS.includes(value as Asset) ? value as Asset : "";
  });
  const [historyPage, setHistoryPage] = useState(() => positiveInt(params?.get("historyPage") ?? null, 1));
  const [historySize, setHistorySize] = useState(() => pageSizeOf(params?.get("historySize") ?? null, 10));
  useEffect(() => {
    writeQuery({
      queuePage: queuePage === 1 ? null : String(queuePage),
      queueSize: queueSize === 5 ? null : String(queueSize),
      history: historyOpen ? "1" : null,
      historyAsset: historyAsset || null,
      historyPage: historyPage === 1 ? null : String(historyPage),
      historySize: historySize === 10 ? null : String(historySize),
    });
  }, [queuePage, queueSize, historyOpen, historyAsset, historyPage, historySize]);

  /* ── 三块各自读 ── */
  const [overview, setOverview] = useState<Block<UserAssetAdjustmentOverview>>(emptyBlock);
  const [queue, setQueue] = useState<Block<UserPage<Row>>>(emptyBlock);
  const [history, setHistory] = useState<Block<UserPage<Row>>>(emptyBlock);
  const [readAt, setReadAt] = useState<number | null>(null);
  const overviewSeq = useRef(0);
  const queueSeq = useRef(0);
  const historySeq = useRef(0);

  const loadOverview = useCallback(async () => {
    const seq = ++overviewSeq.current;
    setOverview((block) => ({ ...block, loading: true, error: "" }));
    try {
      const data = await fetchUserAssetAdjustmentOverview();
      if (seq !== overviewSeq.current) return;
      setOverview({ data, loading: false, error: "" });
      setReadAt(Date.now());
    } catch (cause) {
      if (seq === overviewSeq.current) setOverview({ data: null, loading: false, error: errorMessage(cause) });
    }
  }, []);

  const loadQueue = useCallback(async () => {
    const seq = ++queueSeq.current;
    setQueue((block) => ({ ...block, loading: true, error: "" }));
    try {
      const page = await fetchUserAssetAdjustments({ status: "PENDING_REVIEW", pageNum: queuePage, pageSize: queueSize });
      if (seq !== queueSeq.current) return;
      const pages = Math.max(1, Math.ceil(page.total / queueSize));
      // 超过末页收敛到最后一页，再读一次（原规则）。
      if (queuePage > pages) { setQueuePage(pages); return; }
      setQueue({ data: page, loading: false, error: "" });
      setReadAt(Date.now());
    } catch (cause) {
      if (seq === queueSeq.current) setQueue({ data: null, loading: false, error: errorMessage(cause) });
    }
  }, [queuePage, queueSize]);

  const loadHistory = useCallback(async () => {
    const seq = ++historySeq.current;
    setHistory((block) => ({ ...block, loading: true, error: "" }));
    try {
      const page = await fetchUserAssetAdjustments({ asset: historyAsset || undefined, historyOnly: true, pageNum: historyPage, pageSize: historySize });
      if (seq !== historySeq.current) return;
      const pages = Math.max(1, Math.ceil(page.total / historySize));
      if (historyPage > pages) { setHistoryPage(pages); return; }
      setHistory({ data: page, loading: false, error: "" });
      setReadAt(Date.now());
    } catch (cause) {
      if (seq === historySeq.current) setHistory({ data: null, loading: false, error: errorMessage(cause) });
    }
  }, [historyAsset, historyPage, historySize]);

  useEffect(() => { void loadOverview(); }, [loadOverview, authEpoch]);
  useEffect(() => { void loadQueue(); }, [loadQueue, authEpoch]);
  useEffect(() => { void loadHistory(); }, [loadHistory, authEpoch]);
  // 历史读不到时展开，失败送到眼前（DP-04）。
  useEffect(() => { if (history.error) setHistoryOpen(true); }, [history.error]);

  /* ── 选用户和这个用户的余额 ── */
  const [query, setQuery] = useState("");
  const [searchArmed, setSearchArmed] = useState(false);
  const [searchRetry, setSearchRetry] = useState(0);
  const [accounts, setAccounts] = useState<{ records: User360Profile[]; loading: boolean; error: string }>({ records: [], loading: false, error: "" });
  const [selectedUser, setSelectedUser] = useState<User360Profile | null>(null);
  const [context, setContext] = useState<Block<UserAssetAdjustmentContext>>({ data: null, loading: false, error: "" });
  const [focusError, setFocusError] = useState("");
  const [focusRetry, setFocusRetry] = useState(0);
  const contextGeneration = useRef(0);
  const selectedUserId = accountId(selectedUser);
  const selectedDisplay = selectedUser ? userText(selectedUser) : "";

  useEffect(() => {
    if (!searchArmed) return;
    let active = true;
    // 框里还是已选用户的名字时，按他的用户编码查，下拉里看得到他自己。
    const keyword = selectedUser && query === selectedDisplay ? text(selectedUser.userNo, "") : query.trim();
    const timer = window.setTimeout(() => {
      setAccounts((current) => ({ ...current, loading: true, error: "" }));
      fetchUserAssetAdjustmentAccounts(keyword || undefined)
        .then((page) => { if (active) setAccounts({ records: page.records, loading: false, error: "" }); })
        .catch((cause) => { if (active) setAccounts({ records: [], loading: false, error: errorMessage(cause) }); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
    // selectedUser 只用来取编码，换人时 query 一定跟着变。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, searchArmed, searchRetry]);

  const loadContext = useCallback(async (id: string, generation: number) => {
    // 刷新同一个用户时旧余额先留着，读完再换；换了人就清掉，不沿用上一个用户的余额。
    setContext((block) => ({ data: accountId(block.data?.account) === id ? block.data : null, loading: true, error: "" }));
    try {
      const next = await fetchUserAssetAdjustmentContext(id);
      if (generation !== contextGeneration.current) return;
      // 身份不符不用这份余额（原规则）。
      if (accountId(next.account) !== id) throw new Error("账户信息不一致，请重新选择");
      setContext({ data: next, loading: false, error: "" });
    } catch (cause) {
      if (generation === contextGeneration.current) setContext({ data: null, loading: false, error: errorMessage(cause) });
    }
  }, []);

  const selectUser = (account: User360Profile) => {
    const id = accountId(account);
    const generation = ++contextGeneration.current;
    setSelectedUser(account);
    setFocusError("");
    setQuery(userText(account));
    if (!id) {
      setContext({ data: null, loading: false, error: "该账户没有有效的用户编号" });
      return;
    }
    void loadContext(id, generation);
  };

  // 从用户详情、专属会话带 userId 来：精确读这个用户（C3-L01）。userCode 照旧不消费。
  useEffect(() => {
    if (!focusUserId) return;
    const generation = ++contextGeneration.current;
    let active = true;
    setFocusError("");
    setSelectedUser(null);
    setContext({ data: null, loading: false, error: "" });
    if (!/^[1-9]\d*$/.test(focusUserId)) { setFocusError("网址里的用户编号无效，请返回上一页核对。"); return; }
    setContext({ data: null, loading: true, error: "" });
    fetchUserAssetAdjustmentContext(focusUserId).then((next) => {
      if (!active || generation !== contextGeneration.current) return;
      if (!next.account || accountId(next.account) !== focusUserId) throw new Error("账户和网址里的用户不一致，请返回上一页核对。");
      setSelectedUser(next.account);
      setQuery(userText(next.account));
      setContext({ data: next, loading: false, error: "" });
    }).catch((cause) => {
      if (!active || generation !== contextGeneration.current) return;
      setContext({ data: null, loading: false, error: "" });
      setFocusError(errorMessage(cause));
    });
    return () => { active = false; };
  }, [focusUserId, authEpoch, focusRetry]);

  /* ── 表单 ── */
  const [asset, setAsset] = useState<Asset>("USDT");
  const [direction, setDirection] = useState<Direction>("CREDIT");
  // 钱的输入不给默认值（C3-Q04）。
  const [amountText, setAmountText] = useState("");
  const [reasonCode, setReasonCode] = useState<string>("SUPPORT_COMPENSATION");
  const [reason, setReason] = useState("");
  const [evidenceRef, setEvidenceRef] = useState("");
  const [touched, setTouched] = useState<{ amount?: boolean; reason?: boolean; evidence?: boolean }>({});
  const [attempted, setAttempted] = useState(false);

  /* ── 待确认和提交中 ── */
  const [pending, setPending] = useState<C3Pending[]>([]);
  const [pendingNotes, setPendingNotes] = useState<Record<string, string>>({});
  const [retryRejected, setRetryRejected] = useState<string[]>([]);
  const [releasing, setReleasing] = useState<C3Pending | null>(null);
  const [submitting, setSubmitting] = useState("");
  const [opening, setOpening] = useState("");
  const syncPending = useCallback(() => setPending(c3Commands.list().sort((a, b) => a.createdAt - b.createdAt)), []);
  useEffect(() => { syncPending(); }, [syncPending, authEpoch]);
  const notePending = (record: C3Pending, note: string) => setPendingNotes((current) => ({ ...current, [record.fingerprint]: note }));
  const lockedUsers = useMemo(() => new Set(pending.filter((record) => record.kind === "create" || record.kind === "large").map((record) => record.target)), [pending]);
  const lockedRows = useMemo(() => new Set(pending.filter((record) => record.kind !== "create" && record.kind !== "large").map((record) => record.target)), [pending]);

  /* ── 抽屉 ── */
  const [current, setCurrent] = useState<{ row: Row; source: "queue" | "history" } | null>(null);
  const [detail, setDetail] = useState<UserAssetAdjustmentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const detailSeq = useRef(0);
  const currentRef = useRef(current);
  currentRef.current = current;

  const openDetail = useCallback(async (row: Row, source: "queue" | "history") => {
    const no = text(row.adjustmentNo, "");
    if (!no) return;
    const seq = ++detailSeq.current;
    // 先用列表行显示，再读详情换成最新内容。
    setCurrent({ row, source });
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      const latest = await fetchUserAssetAdjustmentDetail(no);
      if (seq === detailSeq.current) setDetail(latest);
    } catch (cause) {
      if (seq === detailSeq.current) setDetailError(errorMessage(cause));
    } finally {
      if (seq === detailSeq.current) setDetailLoading(false);
    }
  }, []);

  const closeDetail = () => {
    detailSeq.current += 1;
    setCurrent(null);
    setDetail(null);
    setDetailError("");
    setDetailLoading(false);
  };

  const refreshAll = useCallback(async () => {
    const reloads: Promise<unknown>[] = [loadOverview(), loadQueue(), loadHistory()];
    if (selectedUserId) reloads.push(loadContext(selectedUserId, contextGeneration.current));
    await Promise.all(reloads);
    const open = currentRef.current;
    if (open) {
      const no = text(open.row.adjustmentNo, "");
      const seq = ++detailSeq.current;
      await fetchUserAssetAdjustmentDetail(no).then((latest) => { if (seq === detailSeq.current) { setDetail(latest); setDetailError(""); } })
        .catch((cause) => { if (seq === detailSeq.current) setDetailError(errorMessage(cause)); });
    }
  }, [loadOverview, loadQueue, loadHistory, loadContext, selectedUserId]);

  /* ── 计算：发起区 ── */
  const contextAccount = selectedUserId && accountId(context.data?.account) === selectedUserId ? context.data?.account ?? null : null;
  const contextCoverage = coverageOf(context.data?.coverage);
  const overviewCoverage = coverageOf(overview.data?.coverage);
  const rate = Number(context.data?.nexUsdRate ?? overview.data?.nexUsdRate);
  const rateOk = Number.isFinite(rate) && rate > 0;
  const maxAmount = Number(context.data?.maxAdjustmentAmount ?? overview.data?.maxAdjustmentAmount ?? 10000);
  const largeThreshold = Number(context.data?.largeThresholdUsd ?? overview.data?.singleCreditReviewCapUsd ?? 500);
  const amountInput = amountText.trim();
  const amountValid = /^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(amountInput);
  const amountPositive = amountValid && /[1-9]/.test(amountInput);
  const amountUsd = !amountPositive ? 0 : asset === "USDT" ? Number(amountInput) : rateOk ? Number(amountInput) * rate : Number.NaN;
  const balanceNow = contextAccount ? decimal(asset === "USDT" ? contextAccount.walletUsdt : contextAccount.walletNex) : null;
  const balanceAfter = balanceNow !== null && amountPositive ? shifted(balanceNow, amountInput, direction) : null;
  const debitInsufficient = direction === "DEBIT" && balanceAfter !== null && isNegative(balanceAfter);
  const largeAdjustment = Number.isFinite(amountUsd) && amountUsd > largeThreshold;
  const supportLargeRequest = isSupport && largeAdjustment;
  const formCoverageBlock = direction === "CREDIT" && amountPositive && Number.isFinite(amountUsd) && !supportLargeRequest ? creditCoverageBlock(contextCoverage, amountUsd) : null;
  const reasonTrim = reason.trim();
  const evidenceTrim = evidenceRef.trim();

  const amountIssue = !amountInput ? "请填写金额"
    : !amountValid ? "请输入数字，最多 6 位小数"
      : !amountPositive ? "金额必须大于 0"
        : Number.isFinite(amountUsd) && amountUsd > maxAmount ? `单笔不能超过 ${maxAmount.toLocaleString("en-US")} USDT 等值` : "";
  const reasonIssue = reasonTrim.length < 8 || reasonTrim.length > 200 ? "详细原因需填写 8–200 个字符"
    : /^[{[]/.test(reasonTrim) || reasonTrim.toLowerCase().includes("://") ? "详细原因只写事实，链接和凭证号放到凭证里" : "";
  const evidenceIssue = !evidenceTrim ? "请填写工单号、凭证号等证据引用"
    : evidenceTrim.length < 3 || evidenceTrim.length > 255 || /^[{[]/.test(evidenceTrim) ? "凭证要 3–255 个字，不能以 { 或 [ 开头" : "";
  const shownAmountIssue = (touched.amount || attempted) ? amountIssue : "";
  const shownReasonIssue = (touched.reason || attempted) ? reasonIssue : "";
  const shownEvidenceIssue = (touched.evidence || attempted) ? evidenceIssue : "";
  const contextReading = context.loading || (overview.loading && !overview.data && !overview.error);

  // 业务阻断：常显在操作行左边（OP-126），按顺序取第一条。
  const businessBlock = !contextAccount ? ""
    : lockedUsers.has(selectedUserId) ? LOCKED_USER
      : amountIssue ? ""
        : asset === "UVT" && !rateOk ? "当前 UVT 价格不可用，暂不能提交 UVT 调整"
          : debitInsufficient ? `扣减后余额不足（现在 ${money(balanceNow ?? "0")} ${nexGridBrandText(asset)}）`
            : formCoverageBlock === "unreliable" ? "兑付覆盖率暂时算不出来，暂不能加余额"
              : formCoverageBlock === "below" ? "加完后兑付覆盖率会低于红线"
                : largeAdjustment && isFinance ? "超过 500 USDT 等值需由财务主管或超级管理员执行" : "";
  const submitBlock = contextReading ? "正在读取…"
    : !contextAccount ? "请先选择账户"
      : businessBlock || amountIssue || reasonIssue || evidenceIssue || (submitting ? "正在提交" : "");

  /* ── 写操作共用一条路（照 D2 sendCommand） ── */

  /**
   * 先把原操作存好再发（OP-92），存不下就不发。确定失败丢号，留在框里；结果未知保号、关框，转成页面上方的待确认条（OP-93）。
   * 重试的是保留下来的原命令时，确定失败也证明不了原命令的结果，继续保留（CP-33）；只有成功才解除。
   */
  const sendCommand = async <T,>(record: Omit<C3Pending, keyof PendingMutationRecord>, send: (key: string) => Promise<T>, done: (result: T) => Promise<unknown> | unknown, retry = false): Promise<"done" | "unknown"> => {
    const scope = scopeOf(record.kind, record.target);
    const retained = c3Commands.get(scope);
    if (retained && !retry) throw new Error(record.kind === "create" || record.kind === "large" ? LOCKED_USER : LOCKED_ROW);
    const key = retained ?? newCommandKey(record.kind);
    c3Commands.remember(scope, key, record);
    if (!c3Commands.isDurablyStored(scope, key)) {
      if (!retained) c3Commands.forget(scope, key);
      throw new Error("浏览器存不下这次操作，没有提交。换一个窗口再试。");
    }
    setSubmitting(scope);
    try {
      let result: T;
      try {
        result = await send(key);
      } catch (cause) {
        const unknown = isOutcomeUnknown(cause);
        if (!unknown && !retained) c3Commands.forget(scope, key);
        syncPending();
        if (unknown) {
          toast(UNKNOWN_TOAST, "warn");
          void refreshAll();
          return "unknown";
        }
        throw cause;
      }
      c3Commands.forget(scope, key);
      syncPending();
      setPendingNotes((notes) => { const next = { ...notes }; delete next[scope]; return next; });
      await done(result);
      return "done";
    } finally {
      setSubmitting("");
    }
  };

  const createCommand = (kind: "create" | "large", userId: string, userNo: string, input: CreateInput, operator: string, retry = false) => sendCommand(
    { kind, label: `${KIND_LABEL[kind]} · ${userNo} · ${input.direction === "CREDIT" ? "+" : "-"}${money(input.amount)} ${nexGridBrandText(input.asset)}`, target: userId, userNo, input, operator },
    (key) => (kind === "large" ? requestLargeUserAssetAdjustment : createUserAssetAdjustment)(userId, { ...input, operator, idempotencyKey: key }),
    async (result) => {
      if (!retry) {
        setAmountText("");
        setReason("");
        setEvidenceRef("");
        setTouched({});
        setAttempted(false);
      }
      toast(kind === "large" ? `大额调整请求已提交 · ${text(result.requestNo)}` : `调整申请已提交 · ${text(result.adjustmentNo)} · 等待审批`, "success");
      await refreshAll();
    },
    retry,
  );

  const reviewCommand = (kind: "approve" | "reject" | "withdraw", no: string, reasonText: string, operator: string, retry = false) => sendCommand(
    { kind, label: `${KIND_LABEL[kind]} · ${no}`, target: no, reason: reasonText, operator, fromStatus: "PENDING_REVIEW" },
    (key) => (kind === "approve" ? approveUserAssetAdjustment : kind === "reject" ? rejectUserAssetAdjustment : withdrawUserAssetAdjustment)(no, reasonText, operator, key),
    async () => {
      toast(kind === "approve" ? `${no} 已批准，余额已更新` : kind === "reject" ? `${no} 已驳回` : `${no} 已撤回`, "success");
      await refreshAll();
    },
    retry,
  );

  const reverseCommand = (no: string, reasonText: string, operator: string, retry = false) => sendCommand(
    { kind: "reverse", label: `${KIND_LABEL.reverse} · ${no}`, target: no, reason: reasonText, operator, fromStatus: "APPROVED" },
    (key) => reverseUserAssetAdjustment(no, reasonText, operator, key),
    async (result) => {
      toast(`冲正已执行 · ${text(result.adjustmentNo)}`, "success");
      await refreshAll();
    },
    retry,
  );

  /* ── 提交调整申请 ── */
  const submitAdjustment = () => {
    if (submitBlock || !contextAccount) { setAttempted(true); return; }
    const userId = accountId(contextAccount);
    const userNo = text(contextAccount.userNo);
    const input: CreateInput = { asset, direction, amount: amountInput, reasonCode, reason: reasonTrim, evidenceRef: evidenceTrim };
    const large = supportLargeRequest;
    const generation = contextGeneration.current;
    const shownAmount = `${direction === "CREDIT" ? "+" : "-"}${money(amountInput)}`;
    openConfirm({
      briefKind: "funds",
      action: large
        ? `提交大额调整请求 · ${money(amountInput)} ${nexGridBrandText(asset)}`
        : `提交${direction === "CREDIT" ? "增加" : "扣减"}调整申请 · ${money(amountInput)} ${nexGridBrandText(asset)}`,
      title: large ? "提交大额调整请求" : "提交调整申请",
      effect: <StatusTag tone="progress" filled explain={large ? "超过 500 USDT 等值，由财务主管或超级管理员处理；处理前余额不变。" : "由另一位有批准权限的同事批准；批准前余额不变。"}>批准后生效</StatusTag>,
      content: <div className="rd-confirm-facts"><Facts>
        <Fact k="调整金额" lead tone="role-1" unit={nexGridBrandText(asset)}>{shownAmount}</Fact>
        <Fact k="用户">{userText(contextAccount)}</Fact>
        <Fact k="余额">{balanceNow !== null && balanceAfter !== null ? <><Change from={money(balanceNow)} to={`约 ${money(balanceAfter)}`} /> {nexGridBrandText(asset)}</> : "—"}</Fact>
        {asset === "UVT" && <Fact k="USDT 等值">≈ {usdEquivalent(amountUsd)} USDT</Fact>}
        <Fact k="原因分类">{reasonCodeLabel(reasonCode)}</Fact>
        <Fact k="凭证">{evidenceTrim}</Fact>
      </Facts></div>,
      detail: large
        ? `${userText(contextAccount)}；超过 500 USDT 等值，提交后需由财务主管或超级管理员处理，余额暂不变。`
        : `${userText(contextAccount)}；提交后需由另一位同事复核，批准后余额才会变化。同一次提交重试不会多建单。`,
      statedBrief: { impact: "提交后进入待审批，余额暂不变。批准后余额才变化，并生成账单。", check: "核对用户、方向、金额和凭证。" },
      remarkHint: "选填，不会保存",
      reason: false,
      okLabel: "确认提交",
      run: async () => {
        if (generation !== contextGeneration.current) {
          toast("账户信息已变化，请重新核对后提交", "warn");
          return false;
        }
        await createCommand(large ? "large" : "create", userId, userNo, input, OPERATOR());
      },
    });
  };

  /* ── 批准、驳回、撤回、冲正 ── */
  const detailBalance = (latest: UserAssetAdjustmentDetail, flip = false) => {
    const row = latest.adjustment ?? {};
    const now = decimal(upper(row.asset) === "UVT" ? latest.user?.walletNex : latest.user?.walletUsdt);
    const amount = decimal(row.amount);
    if (now === null || amount === null) return null;
    const credit = (upper(row.direction) === "CREDIT") !== flip;
    return { now, after: shifted(now, amount, credit ? "CREDIT" : "DEBIT") };
  };

  /** 批准现在能不能点：结果未确认、读取中、登录名、发起人、余额、覆盖率（产品决定 2）。 */
  const approveBlock = (row: Row, latest?: UserAssetAdjustmentDetail | null) => {
    const no = text(row.adjustmentNo, "");
    if (lockedRows.has(no)) return LOCKED_ROW;
    if (queue.loading) return "正在刷新列表";
    if (!makerUsername) return "读不到当前登录名，刷新后再试";
    if (text(row.maker, "").trim().toLowerCase() === makerUsername) return MINE;
    if (latest) {
      const balance = detailBalance(latest);
      if (balance && isNegative(balance.after)) return `扣减后余额不足（现在 ${money(balance.now)} ${nexGridBrandText(text(row.asset))}），批准会被拒`;
    }
    if (upper(row.direction) !== "CREDIT") return undefined;
    const coverage = latest ? coverageOf(latest.coverage) : overviewCoverage;
    if (!latest && overview.loading && !overview.data) return "正在读取…";
    if (!latest && overview.error) return "兑付覆盖率暂时读不到，刷新后再批准增加余额";
    const block = creditCoverageBlock(coverage, Number(row.amountUsd ?? row.amount));
    if (block === "unreliable") return "兑付覆盖率暂时算不出来，现在不能批准增加余额。";
    if (block === "below") return `按现在的覆盖率算，批准后会低于红线 ${fmtConfigPct(coverage!.redline)}，现在不能批准。可以先驳回，或等覆盖率回升。`;
    return undefined;
  };

  const rowBlock = (row: Row, kind: Kind) => {
    const no = text(row.adjustmentNo, "");
    if (lockedRows.has(no)) return LOCKED_ROW;
    if (kind === "reverse" ? history.loading : queue.loading) return "正在刷新列表";
    if ((kind === "approve" || kind === "reject") && !makerUsername) return "读不到当前登录名，刷新后再试";
    return undefined;
  };

  const isMine = (row: Row) => Boolean(makerUsername) && text(row.maker, "").trim().toLowerCase() === makerUsername;

  const reversibleReason = (row: Row) => row.reversalOf ? "冲正单不能再冲正"
    : row.reversedBy ? "这笔已冲正过"
      : upper(row.status) !== "APPROVED" ? "只有已批准的原单能冲正" : undefined;

  const decisionFacts = (latest: UserAssetAdjustmentDetail, kind: Kind) => {
    const row = latest.adjustment ?? {};
    const no = text(row.adjustmentNo, "");
    const unit = nexGridBrandText(text(row.asset));
    const uvt = upper(row.asset) === "UVT";
    const amountUsdValue = Number(row.amountUsd);
    const flip = kind === "reverse";
    const balance = kind === "approve" || kind === "reverse" ? detailBalance(latest, flip) : null;
    const original = `${upper(row.direction) === "CREDIT" ? "增加" : "扣减"} ${moneyOf(row.amount)} ${unit}`;
    return (
      <Facts>
        <Fact k={kind === "reverse" ? "冲正金额" : "调整金额"} lead tone="role-1" unit={unit}>{signedAmount(row, 2, flip)}</Fact>
        <Fact k={kind === "reverse" ? "原调整单" : "调整单"}><span data-mono>{no}</span>{kind === "reverse" && ` · ${original}`}</Fact>
        <Fact k="用户">{userText(row)}</Fact>
        {balance && <Fact k="余额"><Change from={money(balance.now)} to={`约 ${money(balance.after)}`} tone={isNegative(balance.after) ? "warn" : undefined} /> {unit}</Fact>}
        {uvt && kind === "approve" && Number.isFinite(amountUsdValue) && <Fact k="USDT 等值">≈ {usdEquivalent(amountUsdValue)} USDT</Fact>}
        {(kind === "approve" || kind === "reject") && <Fact k="提交人">{text(row.maker)}</Fact>}
        {(kind === "approve" || kind === "reject") && <Fact k="原因分类">{reasonCodeLabel(row.reasonCode)}</Fact>}
        {(kind === "approve" || kind === "reject") && <Fact k="凭证">{text(row.evidenceRef)}</Fact>}
        {kind === "approve" && <Fact k="能否撤销" tone="warn">批准后不能撤回；调错了可以冲正一次</Fact>}
      </Facts>
    );
  };

  const decisionRequest = (latest: UserAssetAdjustmentDetail, kind: "approve" | "reject" | "withdraw" | "reverse", blockedReason?: ReactNode): ActionConfirmReq => {
    const row = latest.adjustment ?? {};
    const no = text(row.adjustmentNo, "");
    const unit = nexGridBrandText(text(row.asset));
    const credit = upper(row.direction) === "CREDIT";
    const coverage = coverageOf(latest.coverage);
    const label = { approve: "批准", reject: "驳回", withdraw: "撤回", reverse: "冲正" }[kind];
    const run = async (reasonText: string) => {
      try {
        if (kind === "reverse") await reverseCommand(no, reasonText, OPERATOR());
        else await reviewCommand(kind, no, reasonText, OPERATOR());
      } catch (cause) {
        const code = reasonCodeOf(cause);
        if (kind === "approve" && code === "COVERAGE_BELOW_REDLINE") {
          // 后端先把这张单改成已驳回再回 422（OP-70），框里写真实结果，页面回读。
          openActionConfirm(decisionRequest(latest, kind, "批准时兑付覆盖率不足，系统已把这张单改成已驳回，余额没有变。"));
          void refreshAll();
        } else if (MOVED_CODES.includes(code)) {
          const fresh = await fetchUserAssetAdjustmentDetail(no).catch(() => null);
          const moved = fresh?.adjustment && (kind === "reverse" ? Boolean(reversibleReason(fresh.adjustment)) : !isPendingRow(fresh.adjustment));
          // 读回的状态真的变了才写「现在是…」，没变就照常显示后端的原因。
          if (moved && fresh?.adjustment) {
            openActionConfirm(decisionRequest(fresh, kind, kind === "reverse" && fresh.adjustment.reversedBy
              ? `这张单已经冲正过（冲正单 ${text(fresh.adjustment.reversedBy)}），这次冲正没有执行。关闭后按最新状态处理。`
              : `这张单现在是「${statusOf(fresh.adjustment).label}」，这次${label}没有执行。关闭后按最新状态处理。`));
          }
          void refreshAll();
        }
        throw cause;
      }
    };
    if (kind === "approve") {
      return {
        briefKind: "funds",
        action: `${kind === "approve" ? "批准" : "驳回"}调整申请 · ${no}`,
        title: "批准调整申请",
        detail: `${userText(row)} · ${signedAmount(row)} ${unit} · ${text(row.reason)}`,
        effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
        facts: decisionFacts(latest, kind),
        amplifies: credit,
        coverage: credit && coverage?.reliable ? { coverageRatio: coverage.ratio, redlinePct: coverage.redline } : undefined,
        coverageLead: `批准后用户余额增加，平台多付 ${usdEquivalent(Number(row.amountUsd ?? row.amount))} USDT`,
        coverageCheck: "批准时系统按当时的覆盖率再算一次；不够会拒绝，并把这张单改成已驳回。",
        completionCopy: "批准后余额立即变化，并生成账单。",
        statedBrief: { impact: "批准后余额立即变化，并生成账单。", check: "核对用户、金额、原因和凭证，理由写清依据或工单号。" },
        confirmTone: "danger",
        confirmLabel: "确认批准",
        reasonMin: 8,
        reasonMax: 200,
        reasonPlaceholder: "例如：已核对工单 20260718-001，金额无误",
        blockedReason,
        run,
      };
    }
    if (kind === "reject") {
      return {
        briefKind: "record",
        action: `${kind === "reject" ? "驳回" : "批准"}调整申请 · ${no}`,
        title: "驳回调整申请",
        detail: `${userText(row)} · ${signedAmount(row)} ${unit} · ${text(row.reason)}`,
        effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
        facts: decisionFacts(latest, kind),
        amplifies: false,
        completionCopy: "驳回后余额不变。",
        statedBrief: { impact: "驳回后这张单结束，余额不变；要调整需要重新提交。", check: "核对操作对象和凭证，理由写清依据或工单号。" },
        confirmLabel: "确认驳回",
        reasonMin: 8,
        reasonMax: 200,
        reasonPlaceholder: "例如：凭证和工单对不上，请补充后重新提交",
        blockedReason,
        run,
      };
    }
    if (kind === "withdraw") {
      return {
        briefKind: "record",
        action: `撤回调整申请 · ${no}`,
        title: "撤回调整申请",
        detail: "只有提交人能撤回，撤回后余额不变。",
        effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
        facts: decisionFacts(latest, kind),
        amplifies: false,
        completionCopy: "撤回后不能再批准或驳回。",
        statedBrief: { impact: "撤回后不能再批准或驳回，余额不变。", check: "核对是不是要撤回的这张单，理由写清原因。" },
        confirmLabel: "确认撤回",
        reasonMin: 8,
        reasonMax: 200,
        reasonPlaceholder: "例如：金额填错，撤回后重新提交",
        blockedReason,
        run,
      };
    }
    return {
      briefKind: "funds",
      action: `冲正调整 · ${no}`,
      title: "冲正调整",
      detail: "生成一笔金额相同、方向相反的调整，把原来那笔抵消掉。原记录保留，每笔只能冲正一次。",
      effect: <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag /></>,
      facts: decisionFacts(latest, kind),
      // 冲正不查兑付覆盖率（PCM-21、OP-57），摘要也不提。
      amplifies: false,
      completionCopy: "确认后立即生效。",
      statedBrief: { impact: "立即生成一笔反向调整并入账，原记录保留。冲正单不能再冲正。", check: "核对原单的用户、方向和金额，理由写清依据或工单号。" },
      confirmTone: "danger",
      confirmLabel: "确认冲正",
      reasonMin: 8,
      reasonMax: 200,
      reasonPlaceholder: "例如：工单 20260718-001 金额录错，冲正后重新提交",
      blockedReason,
      run,
    };
  };

  /** 点了先读一次详情：已经不是能处理的状态就不开框，提示原因并刷新（死路不开框）。 */
  const confirmDecision = async (row: Row, kind: "approve" | "reject" | "withdraw" | "reverse") => {
    const no = text(row.adjustmentNo, "");
    if (!no || opening) return;
    setOpening(`${kind}|${no}`);
    try {
      const latest = await fetchUserAssetAdjustmentDetail(no).catch(() => null);
      if (!latest?.adjustment) {
        toast("这张单暂时读不到，请刷新后重试", "warn");
        return;
      }
      const fresh = latest.adjustment;
      if (kind === "reverse") {
        const why = reversibleReason(fresh);
        if (why) { toast(`这张单不能冲正：${why}`, "warn"); void loadHistory(); return; }
        const balance = detailBalance(latest, true);
        if (balance && isNegative(balance.after)) { toast(`冲正后余额不足（现在 ${money(balance.now)} ${nexGridBrandText(text(fresh.asset))}），冲正会被拒`, "warn"); return; }
      } else {
        if (!isPendingRow(fresh)) { toast(`这张单已被处理：${statusOf(fresh).label}`, "warn"); void Promise.all([loadOverview(), loadQueue(), loadHistory()]); return; }
        if (kind === "approve") {
          const block = approveBlock(fresh, latest);
          if (block) { toast(block, "warn"); void loadOverview(); return; }
        }
      }
      openActionConfirm(decisionRequest(latest, kind));
    } finally {
      setOpening("");
    }
  };

  /* ── 待确认：读回、重试、解除 ── */
  const canRetry = (record: C3Pending) => record.kind === "create" || record.kind === "large" || record.kind === "withdraw" ? canCreate
    : record.kind === "reverse" ? canReverse : canApprove;

  /** 按原操作重试：同命令号、同内容、同操作人，不接受新输入（OP-94）。只有成功才解除。 */
  const retryPending = async (record: C3Pending) => {
    if (isRetryExpired(record)) { notePending(record, `${RETRY_EXPIRED_TEXT}。`); return; }
    if (!canRetry(record)) { notePending(record, `${RETRY_NO_PERMISSION}。`); return; }
    if (!c3Commands.isDurablyStored(record.fingerprint, record.commandKey)) {
      notePending(record, "浏览器里查不到这条记录，本次没有发送。待确认继续保留，请到操作记录与审批核对。");
      return;
    }
    setRetryRejected((keys) => keys.filter((key) => key !== record.commandKey));
    try {
      const outcome = record.kind === "create" || record.kind === "large"
        ? await createCommand(record.kind, record.target, text(record.userNo), record.input as CreateInput, record.operator, true)
        : record.kind === "reverse"
          ? await reverseCommand(record.target, record.reason ?? "", record.operator, true)
          : await reviewCommand(record.kind, record.target, record.reason ?? "", record.operator, true);
      if (outcome === "unknown") notePending(record, "还是没有确认，原命令继续保留。");
    } catch (cause) {
      if (isPermissionDenied(cause)) announcePermissionDenied();
      notePending(record, `重试没有成功：${errorMessage(cause)} 这说明不了原操作的结果，原命令继续保留。`);
      setRetryRejected((keys) => [...keys, record.commandKey]);
    }
  };

  /** 读回只给现在的事实，不当成原操作的回执，待确认继续保留（OP-93、OP-95）。 */
  const verifyPending = async (record: C3Pending) => {
    if (record.kind === "create" || record.kind === "large") {
      const page = await fetchUserAssetAdjustments({ status: "PENDING_REVIEW", userId: record.target, pageNum: 1, pageSize: 5 }).catch(() => null);
      if (!page) { notePending(record, "读回失败，这个用户的待审批暂时读不到。待确认继续保留。"); return; }
      const [latest] = page.records;
      notePending(record, latest
        ? `读回：这个用户现在有 ${page.total} 笔待审批的调整，最新一笔 ${text(latest.adjustmentNo)} · ${signedAmount(latest)} ${nexGridBrandText(text(latest.asset))} · ${formatBusinessTimeCompact(latest.createdAt, "—")}（${zone}）。这不能证明原操作的结果，待确认继续保留。`
        : "读回：这个用户现在没有待审批的调整。这不能证明原操作的结果，待确认继续保留。");
      return;
    }
    const latest = await fetchUserAssetAdjustmentDetail(record.target).catch(() => null);
    if (!latest?.adjustment) { notePending(record, "读回失败，这张单暂时读不到。待确认继续保留。"); return; }
    const row = latest.adjustment;
    notePending(record, record.kind === "reverse"
      ? `读回：这张单现在${row.reversedBy ? `已冲正，冲正单 ${row.reversedBy}` : "还没有冲正"}，发出时还没有冲正。状态可能是别人改的，待确认继续保留。`
      : `读回：这张单现在是「${statusOf(row).label}」，发出时是「待审批」。状态可能是别人改的，待确认继续保留。`);
    setCurrent({ row, source: isPendingRow(row) ? "queue" : "history" });
    setDetail(latest);
    setDetailError("");
  };

  /** 重试被拒后，人核实过原操作的结果才解除：只清本页这条记录，不发请求，后端仍按这张单现在的状态校验。 */
  const releasePending = (record: C3Pending) => {
    c3Commands.forget(record.fingerprint, record.commandKey);
    syncPending();
    setPendingNotes((notes) => { const next = { ...notes }; delete next[record.fingerprint]; return next; });
    setReleasing(null);
    setRetryRejected((keys) => keys.filter((key) => key !== record.commandKey));
    toast("已解除待确认，可以重新处理", "success");
  };

  /* ── 渲染用的值 ── */
  const pendingCount = overview.data ? Number(overview.data.pending) : null;
  const coverageBelow = !!overviewCoverage?.reliable && overviewCoverage.ratio < overviewCoverage.redline;
  const coverageUnknown = !!overview.data && !overviewCoverage?.reliable;
  const queueRows = queue.data?.records ?? [];
  const historyRows = history.data?.records ?? [];
  const queueDigits = digitsOf(queueRows.map((row) => row.amount));
  const historyDigits = digitsOf(historyRows.map((row) => row.amount));
  const columns = useTableColumns("c3-history", [
    { key: "no", label: "调整单", locked: "第一列不能关" },
    { key: "user", label: "用户" },
    { key: "amount", label: "金额" },
    { key: "status", label: "状态", locked: "状态列不能关" },
    { key: "time", label: "时间" },
    { key: "reason", label: "原因", extra: true },
    { key: "evidence", label: "凭证", extra: true },
    { key: "ledger", label: "账单", extra: true },
    ...(canReverse ? [{ key: "action", label: "操作", locked: "操作列不能关" }] : []),
  ]);
  const historyColumnCount = columns.all.filter((column) => columns.isVisible(column.key)).length;

  const goQueue = () => {
    const panel = document.getElementById("c3-queue");
    panel?.scrollIntoView({ behavior: "smooth", block: "start" });
    panel?.querySelector<HTMLElement>("[data-section-focus]")?.focus({ preventScroll: true });
  };

  const copyNo = (value: string) => {
    void navigator.clipboard?.writeText(value).then(() => toast("已复制调整单号", "success"), () => toast("复制失败，请手动选择单号", "error"));
  };

  const ledgerCell = (row: Row) => row.ledgerId == null || row.ledgerId === ""
    ? "—"
    : canReadLedger
      ? <Link className="rd-link" data-num="" href={`/finance/ledger?bizNo=${encodeURIComponent(text(row.adjustmentNo, ""))}`} prefetch={false}>#{text(row.ledgerId)} →</Link>
      : <span title="当前角色无账本查看权限">已生成</span>;

  /* ── 发起区 ── */
  const accountStatus = upper(contextAccount?.status);
  // 选中的用户名已经在账户框里，这里不再写一遍（DP-61）；系统编号和注册时间进「账户」旁的问号。
  const targetCard = contextAccount && (
    <dl className="rd-detail-values" data-proof="c3-target-card">
      <div><dt>账户状态</dt><dd>{accountStatus === "ACTIVE" ? "正常" : <StatusTag tone="warn">{ACCOUNT_STATUS[accountStatus] ?? "状态未知"}</StatusTag>}</dd></div>
      <div><dt>风险</dt><dd>{formatC1RiskBand(contextAccount.riskBand)}{contextAccount.riskScore != null && contextAccount.riskScore !== "" ? `（${text(contextAccount.riskScore)} 分）` : ""}</dd></div>
      <div><dt>USDT 余额</dt><dd>{moneyOf(contextAccount.walletUsdt)}</dd></div>
      <div><dt>UVT 余额</dt><dd>{moneyOf(contextAccount.walletNex)}</dd></div>
      <div><dt>提现中</dt><dd>{moneyOf(context.data?.pendingWithdraw)} USDT</dd></div>
    </dl>
  );

  const accountOptions = accounts.records.map((account) => ({
    value: accountId(account) || text(account.userNo),
    label: <><span data-mono>{text(account.userNo)}</span> · {operatorNicknameText(text(account.nickname))}</>,
    extra: account.phoneMasked ? text(account.phoneMasked) : undefined,
    disabled: !accountId(account),
  }));

  const formTone = businessBlock ? "warn" : undefined;
  const form = (
    <div className="rd-stack">
      <Field label="账户" required explain={contextAccount ? `选中的用户：系统编号 ${accountId(contextAccount)}，注册 ${formatBusinessTimeCompact(contextAccount.registeredAt, "—")}（${zone}）` : undefined}>
        {(control) => <SearchSelect {...control} aria-label="选择资产调整账户" placeholder="搜索用户编码、昵称或邀请码"
          value={query}
          onChange={(next) => {
            setQuery(next);
            // 改动已选的文字就清掉已选用户和上下文（03 第 386 行）。
            if (selectedUser && next !== selectedDisplay) {
              contextGeneration.current += 1;
              setSelectedUser(null);
              setContext({ data: null, loading: false, error: "" });
            }
          }}
          onOpen={() => setSearchArmed(true)}
          options={accountOptions}
          selected={selectedUserId || undefined}
          onSelect={(value) => { const account = accounts.records.find((item) => accountId(item) === value); if (account) selectUser(account); }}
          loading={accounts.loading}
          error={accounts.error ? `没有查到：${accounts.error}` : undefined}
          onRetry={() => setSearchRetry((count) => count + 1)}
          empty="无匹配用户" />}
      </Field>
      {focusError && <Notice tone="warn" action={/^[1-9]\d*$/.test(focusUserId) ? <Button size="sm" loading={context.loading} onClick={() => setFocusRetry((count) => count + 1)}>重试</Button> : undefined}>
        {/^[1-9]\d*$/.test(focusUserId) ? `没有读到网址里的用户：${focusError}` : focusError}
      </Notice>}
      {selectedUser && context.error && <Notice tone="warn" action={<Button size="sm" onClick={() => void loadContext(selectedUserId, contextGeneration.current)}>重试</Button>}>没有读到这个用户的余额：{context.error}</Notice>}
      {context.loading && !contextAccount && <BlockState state="loading" title="正在读取这个用户的余额…" compact />}
      {targetCard}
      <div className="rd-form-grid">
        <Field label="资产"><Segments label="资产" value={asset} onChange={setAsset} items={ASSETS.map((item) => ({ value: item, label: nexGridBrandText(item) }))} /></Field>
        <Field label="方向"><Segments<Direction> label="方向" value={direction} onChange={setDirection} items={[{ value: "CREDIT", label: "增加" }, { value: "DEBIT", label: "扣减" }]} /></Field>
      </div>
      <Field label="金额" required error={shownAmountIssue || undefined}
        help={asset === "UVT" ? rateOk ? `按 UVT 价格 ${rate.toLocaleString("en-US", { maximumFractionDigits: 8 })} USDT 换算成 USDT 等值` : "当前 UVT 价格不可用" : undefined}>
        {(control) => <span className="rd-number">
          <Input {...control} aria-label="调整金额" inputMode="decimal" autoComplete="off" placeholder="例如 120" value={amountText}
            onChange={(event) => setAmountText(event.target.value)} onBlur={() => setTouched((state) => ({ ...state, amount: true }))} />
          <span className="rd-number-unit">{nexGridBrandText(asset)}</span>
        </span>}
      </Field>
      <Field label="原因分类">
        <Segments label="原因分类" value={reasonCode} onChange={setReasonCode} items={REASON_CODES.map(([value, label]) => ({ value, label }))} />
      </Field>
      <Field label="详细原因" required error={shownReasonIssue || undefined}>
        {(control) => <Textarea {...control} aria-label="详细原因" rows={3} maxLength={400} placeholder="8–200 字，说明事实、判断和处理依据" value={reason} count={`${reasonTrim.length}/200`}
          onChange={(event) => setReason(event.target.value)} onBlur={() => setTouched((state) => ({ ...state, reason: true }))} />}
      </Field>
      <Field label="凭证" required error={shownEvidenceIssue || undefined}>
        {(control) => <Input {...control} aria-label="证据引用" maxLength={300} placeholder="例如：工单 20260718-001" value={evidenceRef}
          onChange={(event) => setEvidenceRef(event.target.value)} onBlur={() => setTouched((state) => ({ ...state, evidence: true }))} />}
      </Field>
      {canCreate && <div className="rd-toolbar" data-end="">
        <span className="rd-toolbar-note" data-tone={formTone}>{businessBlock || C01_FLOW}</span>
        <Button variant="primary" loading={submitting.startsWith("create|")} disabledReason={submitBlock || undefined} onBlockedClick={() => setAttempted(true)} onClick={submitAdjustment}>提交调整申请</Button>
      </div>}
    </div>
  );

  /* ── 批准后会怎样 ── */
  const coverageAfter = contextCoverage && amountPositive && Number.isFinite(amountUsd) ? projectedCoverage(contextCoverage, direction, amountUsd) : undefined;
  const preview = !contextAccount ? (
    <p className="rd-detail-empty">选好账户后，这里写批准后的余额和覆盖率。</p>
  ) : (
    <Facts>
      <Fact k={`余额（${nexGridBrandText(asset)}）`} unit={balanceNow === null ? undefined : nexGridBrandText(asset)}>
        {balanceNow === null ? "—" : balanceAfter === null ? money(balanceNow) : <Change from={money(balanceNow)} to={money(balanceAfter)} tone={debitInsufficient ? "warn" : undefined} />}
      </Fact>
      {asset === "UVT" && <Fact k="USDT 等值" unit={amountPositive && rateOk ? "USDT" : undefined}>{amountPositive && rateOk ? usdEquivalent(amountUsd) : "—"}</Fact>}
      <Fact k="兑付覆盖率" unit={contextCoverage?.reliable ? `红线 ${fmtConfigPct(contextCoverage.redline)}` : undefined} tone={!contextCoverage?.reliable ? "warn" : undefined}>
        {!contextCoverage?.reliable ? "算不出来"
          : coverageAfter === undefined ? pct(contextCoverage.ratio)
            : <Change from={pct(contextCoverage.ratio)} to={coverageAfter === null ? "批准后应付款为 0" : pct(coverageAfter)}
              tone={direction === "CREDIT" && coverageAfter !== null && coverageAfter < contextCoverage.redline ? "danger" : undefined} />}
      </Fact>
    </Facts>
  );

  const initiation = (
    <div className="rd-split">
      {/* 只读账号的试算区：折叠标题已经说了是什么，不再写「发起调整」。 */}
      <Panel title={canCreate ? "发起调整" : undefined} icon={canCreate ? FilePen : undefined} tone="role-1" plain={!canCreate} headingLevel={canCreate ? 2 : 3}>{form}</Panel>
      <Panel title="批准后会怎样" icon={Scale} tone="role-1" plain={!canCreate} headingLevel={canCreate ? 2 : 3}
        explain="按现在读到的余额和覆盖率估算，不是批准结果。批准时系统按当时的余额和覆盖率重新检查。">{preview}</Panel>
    </div>
  );

  /* ── 待审批队列 ── */
  const queueAction = (row: Row) => {
    const no = text(row.adjustmentNo, "");
    const mine = isMine(row);
    const busy = Boolean(submitting) || Boolean(opening);
    const loadingKind = (kind: Kind) => opening === `${kind}|${no}`;
    const withdraw = mine && canCreate && <Button size="sm" disabled={busy && !loadingKind("withdraw")} loading={loadingKind("withdraw")} disabledReason={rowBlock(row, "withdraw")} onClick={() => void confirmDecision(row, "withdraw")}>撤回</Button>;
    if (canApprove && !mine) {
      return <span className="rd-row-actions">
        <Button size="sm" disabled={busy && !loadingKind("approve")} loading={loadingKind("approve")} disabledReason={approveBlock(row)} onClick={() => void confirmDecision(row, "approve")}>批准</Button>
        <Button size="sm" disabled={busy && !loadingKind("reject")} loading={loadingKind("reject")} disabledReason={rowBlock(row, "reject")} onClick={() => void confirmDecision(row, "reject")}>驳回</Button>
      </span>;
    }
    if (canApprove && mine) return <Cell main={withdraw ? <span className="rd-row-actions">{withdraw}</span> : <span className="rd-cell-sub" title={MINE}>{MINE_SHORT}</span>} sub={withdraw ? <span title={MINE}>{MINE_SHORT}</span> : undefined} />;
    if (withdraw) return <span className="rd-row-actions">{withdraw}</span>;
    return <span className="rd-cell-sub">{WAITING}</span>;
  };

  const queueTable = (
    <Table label="待审批的调整" data-tight="">
      <thead><tr>
        <Th>调整单 · 提交时间（{zone}）</Th>
        <Th icon={User} tone="users">用户</Th>
        <Th align="right" icon={Coins} tone="money">金额</Th>
        <Th>原因 · 凭证</Th>
        <Th>提交人</Th>
        <Th sticky="end">操作</Th>
      </tr></thead>
      <tbody>
        {queue.loading && !queue.data ? <TableLoading columns={6} rows={3} />
          : queue.error ? <TableMessage columns={6} role="alert">待审批的调整读取失败，不显示旧数据：{queue.error} <InlineRetry onRetry={() => void loadQueue()} /></TableMessage>
            : queueRows.length === 0 ? <TableMessage columns={6}>暂无待审批的调整</TableMessage>
              : queueRows.map((row) => {
                const no = text(row.adjustmentNo, "");
                const uvt = upper(row.asset) === "UVT";
                const amountSub = [uvt ? `≈ ${usdEquivalent(Number(row.amountUsd))} USDT` : "", row.escalated ? "超过 500 USDT 等值" : ""].filter(Boolean).join(" · ");
                return (
                  <Tr key={no} selected={current?.row.adjustmentNo === no} onOpen={() => void openDetail(row, "queue")}>
                    <Td><Cell main={<span data-mono>{shortNo(no)}</span>} sub={formatBusinessTimeCompact(row.createdAt, "—")} title={no} /></Td>
                    <Td><Cell main={userText(row)} title={userText(row)} /></Td>
                    <Td align="right"><Cell num main={`${signedAmount(row, queueDigits)} ${nexGridBrandText(text(row.asset))}`} sub={amountSub || undefined} /></Td>
                    <Td grow><Cell main={text(row.reason)} sub={`${reasonCodeLabel(row.reasonCode)} · 凭证 ${text(row.evidenceRef)}`} title={text(row.reason)} /></Td>
                    <Td><Cell main={text(row.maker)} sub={isMine(row) ? "你提交的" : undefined} /></Td>
                    <Td sticky="end">{queueAction(row)}</Td>
                  </Tr>
                );
              })}
      </tbody>
    </Table>
  );

  /* ── 调整历史 ── */
  const historyTime = (row: Row) => row.reviewedAt ?? row.updatedAt ?? row.createdAt;
  const historySummary = history.loading && !history.data ? "正在读取…"
    : history.error ? "读取失败"
      : !history.data?.total ? "暂无调整历史"
        : `${historyAsset ? `${historyAsset} ` : ""}共 ${history.data.total} 笔，最近 ${formatBusinessTimeCompact(historyTime(historyRows[0]), "—")}（${zone}）`;

  const historyTable = (
    <Table label="调整历史">
      <thead><tr>
        <Th>调整单</Th>
        {columns.isVisible("user") && <Th icon={User} tone="users">用户</Th>}
        {columns.isVisible("amount") && <Th align="right" icon={Coins} tone="money">金额</Th>}
        <Th>状态</Th>
        {columns.isVisible("time") && <Th>时间（{zone}）</Th>}
        {columns.isVisible("reason") && <Th>原因</Th>}
        {columns.isVisible("evidence") && <Th>凭证</Th>}
        {columns.isVisible("ledger") && <Th>账单</Th>}
        {canReverse && <Th sticky="end">操作</Th>}
      </tr></thead>
      <tbody>
        {history.loading && !history.data ? <TableLoading columns={historyColumnCount} rows={3} />
          : history.error ? <TableMessage columns={historyColumnCount} role="alert">调整历史读取失败，不显示旧数据：{history.error} <InlineRetry onRetry={() => void loadHistory()} /></TableMessage>
            : historyRows.length === 0 ? <TableMessage columns={historyColumnCount}>暂无调整历史</TableMessage>
              : historyRows.map((row) => {
                const no = text(row.adjustmentNo, "");
                const status = statusOf(row);
                const coverageRejected = upper(row.status) === "REJECTED" && text(row.reviewReason, "").startsWith("COVERAGE_BELOW_REDLINE:");
                const relation = row.reversalOf ? `冲正单 · 原单 ${shortNo(text(row.reversalOf))}` : row.reversedBy ? `已冲正 · ${shortNo(text(row.reversedBy))}` : coverageRejected ? "批准时覆盖率不足，系统驳回" : undefined;
                const notReversible = reversibleReason(row);
                return (
                  <Tr key={no} selected={current?.row.adjustmentNo === no} onOpen={() => void openDetail(row, "history")}>
                    <Td><Cell main={<span data-mono>{shortNo(no)}</span>} sub={reasonCodeLabel(row.reasonCode)} title={no} /></Td>
                    {columns.isVisible("user") && <Td><Cell main={userText(row)} title={userText(row)} /></Td>}
                    {columns.isVisible("amount") && <Td align="right"><Cell num main={`${signedAmount(row, historyDigits)} ${nexGridBrandText(text(row.asset))}`} sub={upper(row.asset) === "UVT" ? `≈ ${usdEquivalent(Number(row.amountUsd))} USDT` : undefined} /></Td>}
                    <Td><Cell main={<StatusTag tone={status.tone}>{status.label}</StatusTag>} sub={relation && (coverageRejected && !row.reversalOf && !row.reversedBy ? <span data-tone="warn">{relation}</span> : relation)} /></Td>
                    {columns.isVisible("time") && <Td><Cell num main={formatBusinessTimeCompact(historyTime(row), "—")} /></Td>}
                    {columns.isVisible("reason") && <Td><Cell main={text(row.reason)} title={text(row.reason)} /></Td>}
                    {columns.isVisible("evidence") && <Td><Cell main={text(row.evidenceRef)} title={text(row.evidenceRef)} /></Td>}
                    {columns.isVisible("ledger") && <Td>{ledgerCell(row)}</Td>}
                    {canReverse && <Td sticky="end">{notReversible
                      ? <span className="rd-cell-sub" title={notReversible}>不可冲正</span>
                      : <Button size="sm" disabled={(Boolean(submitting) || Boolean(opening)) && opening !== `reverse|${no}`} loading={opening === `reverse|${no}`} disabledReason={rowBlock(row, "reverse")} onClick={() => void confirmDecision(row, "reverse")}>冲正</Button>}</Td>}
                  </Tr>
                );
              })}
      </tbody>
    </Table>
  );

  /* ── 抽屉 ── */
  const shown = detail?.adjustment ?? current?.row ?? null;
  const shownNo = text(shown?.adjustmentNo, "");
  const shownPending = shown ? isPendingRow(shown) : false;
  const listRows = current?.source === "history" ? historyRows : queueRows;
  const index = shown ? listRows.findIndex((row) => row.adjustmentNo === shownNo) : -1;
  const prevRow = index > 0 ? listRows[index - 1] : undefined;
  const nextRow = index >= 0 ? listRows[index + 1] : undefined;
  const shownUnit = nexGridBrandText(text(shown?.asset));
  const shownBalance = detail ? detailBalance(detail) : null;
  const shownCoverage = detail ? coverageOf(detail.coverage) : null;
  const shownCredit = upper(shown?.direction) === "CREDIT";
  const shownMine = shown ? isMine(shown) : false;
  const shownApproveBlock = shown && shownPending && canApprove && !shownMine ? (detailLoading ? "正在读取…" : detailError ? "详情读取失败，先重试" : approveBlock(shown, detail)) : undefined;
  const shownCoverageAfter = shownCoverage?.reliable ? projectedCoverage(shownCoverage, "CREDIT", Number(shown?.amountUsd ?? shown?.amount)) : undefined;
  const coverageReviewReason = text(shown?.reviewReason, "");
  const reviewReasonText = coverageReviewReason.startsWith("COVERAGE_BELOW_REDLINE:")
    ? `批准时兑付覆盖率不足，系统驳回。${coverageReviewReason.slice("COVERAGE_BELOW_REDLINE:".length).trim()}`
    : text(shown?.reviewReason);

  const judgment: JudgmentRow[] = !shown ? [] : [
    { label: "金额", icon: Coins, tone: "money", value: `${signedAmount(shown)} ${shownUnit}`, reason: upper(shown.asset) === "UVT" ? `≈ ${usdEquivalent(Number(shown.amountUsd))} USDT` : undefined },
    { label: "用户", icon: User, tone: "users", value: userText(shown), state: detail?.user && upper(detail.user.status) !== "ACTIVE" ? "warn" : undefined, reason: detail?.user ? `账户${ACCOUNT_STATUS[upper(detail.user.status)] ?? "状态未知"}` : undefined },
    shownPending
      ? { label: "余额", state: shownBalance && isNegative(shownBalance.after) ? "warn" : undefined,
        value: detailLoading ? "正在读取…" : !shownBalance ? "读不到" : `现在 ${money(shownBalance.now)} → 批准后约 ${money(shownBalance.after)} ${shownUnit}`,
        reason: shownBalance && isNegative(shownBalance.after) ? "余额不足，批准会被拒" : undefined }
      : { label: "执行后余额", value: shown.balanceAfter == null ? "—" : `${moneyOf(shown.balanceAfter)} ${shownUnit}` },
    ...(shownPending && shownCredit ? [{
      label: "兑付覆盖率",
      state: detailLoading || !detail ? undefined : !shownCoverage?.reliable || (shownCoverageAfter != null && shownCoverageAfter < shownCoverage.redline) ? "danger" as const : undefined,
      value: detailLoading ? "正在读取…" : !detail ? "读不到" : !shownCoverage?.reliable ? "算不出来，现在不能批准增加余额"
        : `现在 ${pct(shownCoverage.ratio)} → 批准后约 ${shownCoverageAfter == null ? "应付款为 0" : pct(shownCoverageAfter)}，红线 ${fmtConfigPct(shownCoverage.redline)}`,
    }] : []),
    { label: "提交人", value: text(shown.maker), reason: formatBusinessTimeFull(shown.createdAt, "—") },
    ...(shownPending ? [{ label: "能不能批", value: !canApprove ? WAITING : shownMine ? MINE : shownApproveBlock ? "现在不能批" : "你能批", state: canApprove && !shownMine && shownApproveBlock ? "warn" as const : undefined }] : []),
  ];

  const shownLocked = lockedRows.has(shownNo);
  // 历史单的冲正：详情读到了钱包余额，扣回后为负就先禁用并写原因，不开框（死路不开框）。
  const reverseBalance = detail && !shownPending ? detailBalance(detail, true) : null;
  const reverseBalanceBlock = reverseBalance && isNegative(reverseBalance.after) ? `冲正后余额不足（现在 ${money(reverseBalance.now)} ${shownUnit}），冲正会被拒` : undefined;
  const drawerNote = !shown ? undefined
    : shownLocked ? LOCKED_ROW
      : shownPending
        ? !canApprove ? (shownMine && canCreate ? undefined : WAITING)
          : shownMine ? MINE : shownApproveBlock
        : undefined;
  const drawerBusy = Boolean(submitting) || Boolean(opening);
  const drawerFooter = shown && (shownPending ? (
    <Decision note={drawerNote}
      danger={canApprove ? <Button variant="danger-outline" disabled={drawerBusy} disabledReason={shownMine ? MINE : rowBlock(shown, "reject") ?? (detailLoading ? "正在读取…" : undefined)} onClick={() => void confirmDecision(shown, "reject")}>驳回</Button> : undefined}
      others={shownMine && canCreate ? <Button disabled={drawerBusy} disabledReason={rowBlock(shown, "withdraw")} onClick={() => void confirmDecision(shown, "withdraw")}>撤回</Button> : undefined}
      primary={canApprove ? <Button variant="primary" disabled={drawerBusy} disabledReason={shownMine ? MINE : shownApproveBlock} onClick={() => void confirmDecision(shown, "approve")}>批准</Button> : undefined} />
  ) : (canReverse && !reversibleReason(shown)) || (shown.ledgerId != null && shown.ledgerId !== "" && canReadLedger) || shownLocked ? (
    <Decision note={shownLocked ? LOCKED_ROW : canReverse && !reversibleReason(shown) ? reverseBalanceBlock : undefined}
      danger={canReverse && !reversibleReason(shown) ? <Button variant="danger-outline" disabled={drawerBusy} disabledReason={rowBlock(shown, "reverse") ?? reverseBalanceBlock} onClick={() => void confirmDecision(shown, "reverse")}>冲正</Button> : undefined}
      primary={shown.ledgerId != null && shown.ledgerId !== "" && canReadLedger ? <Link className="rd-btn" data-variant="secondary" href={`/finance/ledger?bizNo=${encodeURIComponent(shownNo)}`} prefetch={false}><span className="rd-btn-face">定位关联账单 →</span></Link> : undefined} />
  ) : undefined);

  /* ── 待确认条 ── */
  const pendingNotices = pending.map((record) => {
    const expired = isRetryExpired(record);
    return (
      <Notice key={record.fingerprint} tone="warn" title={`${record.label} · 结果未确认`} actionBelow
        action={<>
          <Button size="sm" disabled={!!submitting} onClick={() => void verifyPending(record)}>读回核对</Button>
          <Button size="sm" disabled={!!submitting} loading={submitting === record.fingerprint} disabledReason={expired ? RETRY_EXPIRED_TEXT : canRetry(record) ? undefined : RETRY_NO_PERMISSION} onClick={() => void retryPending(record)}>按原操作重试</Button>
          {retryRejected.includes(record.commandKey) && <Button size="sm" disabled={!!submitting} onClick={() => setReleasing(record)}>解除待确认</Button>}
        </>}>
        <p>
          {formatBusinessTimeCompact(new Date(record.createdAt).toISOString(), "—")}（{zone}）发出，可能已经生效。
          {expired ? `${RETRY_EXPIRED_TEXT}。` : "按原操作重试会用同一个命令号重新发送，不会多建单，也不会重复入账。"}
          {canReadAudit ? <> <Link className="rd-link" href="/platform/audit" prefetch={false}>到操作记录与审批按单号核对</Link></> : "请有操作记录读权限的同事按单号核对。"}
          <Explain label="这次操作的技术信息" rows={[
            { k: "命令号", v: <span data-mono>{record.commandKey}</span> },
            { k: "操作人", v: record.operator },
            { k: "理由", v: record.reason ?? record.input?.reason },
          ]} />
        </p>
        {pendingNotes[record.fingerprint] && <p>{pendingNotes[record.fingerprint]}</p>}
      </Notice>
    );
  });

  return <>
    <PageHeader pageId="C3" title="余额与资产调整" summary={<AutoGloss>补偿或纠错时增减用户余额，另一位同事批准后才入账。</AutoGloss>}
      back={back ? <Link className="rd-link" href={back.href} prefetch={false}>{back.label}</Link> : undefined}
      meta={<span className="rd-toolbar">
        <span>{readAt ? `${businessClock(readAt)} 读取（${zone}），` : ""}不自动刷新</span>
        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={overview.loading || queue.loading || history.loading} onClick={() => void refreshAll()}>刷新</Button>
      </span>}
      readOnly={canWriteAny ? undefined : "你只能查看；发起、批准和冲正要有对应权限的同事办。"}
      guideExtra={canWriteAny ? undefined : <p>你的账号只能查看，「发起」「批准」「冲正」的步骤要有对应权限的同事办。</p>} />

    {pendingNotices}
    {(canCreate || canApprove) && coverageBelow && overviewCoverage && <Notice tone="danger" title={`兑付覆盖率 ${pct(overviewCoverage.ratio)}，低于红线 ${fmtConfigPct(overviewCoverage.redline)}`}
      action={canReadPool ? <Link className="rd-link" href="/finance/pool" prefetch={false}>去资金储备与应付款</Link> : undefined}>
      现在不能增加用户余额：提交和批准都会被拒。扣减照常。
    </Notice>}
    {(canCreate || canApprove) && coverageUnknown && <Notice tone="warn"
      action={canReadPool ? <Link className="rd-link" href="/finance/pool" prefetch={false}>去资金储备与应付款</Link> : undefined}>
      兑付覆盖率暂时算不出来，现在不能增加用户余额。扣减照常。
    </Notice>}

    {overview.loading && !overview.data ? <Conclusion state="unknown">正在读取…</Conclusion>
      : overview.error || pendingCount === null || !Number.isFinite(pendingCount) ? <Conclusion state="unknown" action={<InlineRetry onRetry={() => void loadOverview()} />}>暂时读不到待审批的数量</Conclusion>
        : pendingCount > 0 ? <Conclusion state="warn" lead icon={Inbox} explain="只算待审批的单。批准、驳回和撤回在下面的队列里做。"
          hint={canApprove ? undefined : "由有批准权限的同事处理，批准前余额不变。"}
          action={<button type="button" className="rd-link rd-link-button" onClick={goQueue}>到待审批 ↓</button>}>
          <b>{pendingCount.toLocaleString("en-US")}</b> 笔调整等待审批
        </Conclusion>
          : <Conclusion state="neutral" icon={Info} explain="只算待审批的单。批准、驳回和撤回在下面的队列里做。">没有等待审批的调整</Conclusion>}

    {canCreate ? initiation : <Fold title="试算一笔调整" summary="你只能试算，不能提交" icon={Calculator} tone="role-1">{initiation}</Fold>}

    <Panel id="c3-queue" title={<span tabIndex={-1} data-section-focus="">待审批的调整</span>} explainLabel="待审批的调整" icon={Inbox} tone="role-3" flush
      sub="最新提交的在前" data-restored-capability="c3-pending-request-withdrawal">
      {queueTable}
      {queue.data && !queue.error && queue.data.total > 0 && <Pager label="待审批的调整" total={queue.data.total} page={queuePage} pageSize={queueSize} sizes={PAGE_SIZES} loading={queue.loading}
        onPage={setQueuePage} onPageSize={(size) => { setQueueSize(size); setQueuePage(1); }} />}
    </Panel>

    <Fold title="调整历史" icon={History} tone="role-3" summary={historySummary} alert={!!history.error} alertTone="danger" explain={C01_RULE}
      open={historyOpen} onOpenChange={setHistoryOpen}>
      <FilterBar scope={<Segments label="调整历史资产筛选" value={historyAsset} onChange={(next) => { setHistoryAsset(next); setHistoryPage(1); }}
        items={[{ value: "", label: "全部" }, ...ASSETS.map((item) => ({ value: item, label: nexGridBrandText(item) }))]} />}
        sort={<ColumnPicker columns={columns} />} />
      {historyTable}
      {history.data && !history.error && history.data.total > 0 && <Pager label="余额调整历史" total={history.data.total} page={historyPage} pageSize={historySize} sizes={PAGE_SIZES} loading={history.loading}
        onPage={setHistoryPage} onPageSize={(size) => { setHistorySize(size); setHistoryPage(1); }} />}
    </Fold>

    <Drawer open={Boolean(current)} onClose={closeDetail} title="调整单详情" icon={FileText} tone="role-1" busy={Boolean(submitting)}
      sub={shown && <><span data-mono>{shownNo}</span> <IconButton aria-label="复制调整单号" data-size="sm" onClick={() => copyNo(shownNo)}><Copy size={13} aria-hidden /></IconButton>
        <StatusTag tone={statusOf(shown).tone}>{statusOf(shown).label}</StatusTag>
        {shown.reversalOf && <StatusTag tone="neutral">冲正单</StatusTag>}
        {shown.reversedBy && <StatusTag tone="done">已冲正</StatusTag>}</>}
      nav={{ hasPrev: Boolean(prevRow), hasNext: Boolean(nextRow), onPrev: () => { if (prevRow) void openDetail(prevRow, current?.source ?? "queue"); }, onNext: () => { if (nextRow) void openDetail(nextRow, current?.source ?? "queue"); } }}
      footer={drawerFooter}>
      {shown && <>
        {detailError && <BlockState compact state="error" title="详情读取失败，下面是列表里的信息" detail={detailError} onRetry={() => void openDetail(shown, current?.source ?? "queue")} />}
        <JudgmentPoints title={`判断要点 · 时间为${zone}`} rows={judgment} />
        <Facts>
          <Fact k="原因分类">{reasonCodeLabel(shown.reasonCode)}</Fact>
          <Fact k="详细原因">{text(shown.reason)}</Fact>
          <Fact k="凭证">{text(shown.evidenceRef)}</Fact>
          {!shownPending && <Fact k="复核人">{text(shown.checker)}</Fact>}
          {!shownPending && <Fact k="复核理由">{reviewReasonText}</Fact>}
          {!shownPending && <Fact k="复核时间">{formatBusinessTimeFull(shown.reviewedAt, "—")}</Fact>}
          {shown.reversalOf && <Fact k="原调整单"><span data-mono>{text(shown.reversalOf)}</span></Fact>}
          {shown.reversedBy && <Fact k="冲正单"><span data-mono>{text(shown.reversedBy)}</span></Fact>}
        </Facts>
        <div className="rd-fold-flush">
          <Fold inset title="技术详情" summary={`请求编号 ${text(shown.idempotencyKey).slice(0, 8)}…`}>
            <Facts>
              <Fact k="请求编号"><span data-mono>{text(shown.idempotencyKey)}</span></Fact>
              <Fact k="系统编号">{text(shown.userId)}</Fact>
              <Fact k="账单记录号">{text(shown.ledgerId)}</Fact>
            </Facts>
          </Fold>
        </div>
      </>}
    </Drawer>

    {releasing && <ReleaseModal label={releasing.label} onCancel={() => setReleasing(null)} onConfirm={() => releasePending(releasing)}
      explain="重试被拒说明不了原操作的结果。先读回核对，或请有操作记录读权限的同事核对。解除后原操作不再重试，系统仍按这张单现在的状态校验。" />}
  </>;
}
