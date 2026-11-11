"use client";

/**
 * C1 查找用户与查看资料（列表页，PG-43）。
 * 列表、统计读 /api/admin/users/profiles、/overview；导出走 /profiles/export，带幂等键，原操作先存会话存储再发（OP-92）。
 * 点一行进 /users/search/<userNo> 的用户详情；冻结、调余额、安全处理在 C2、C3、C5 和详情的处理入口。
 */
import Link from "next/link";
import { Fragment, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, CircleHelp, Coins, Download, Lock, RefreshCw, ShieldAlert, ShieldCheck, Snowflake, Users, type LucideIcon } from "lucide-react";
import { AutoGloss } from "@/app/components/kit/gloss";
import {
  Button, Cell, ColumnPicker, Decision, Explain, Fact, Facts, Field, FilterBar, FilterField, InlineRetry, Input, KeepText, Modal, Notice, PageHeader,
  Pager, Panel, ReleaseBody, Segments, Select, Stat, StatBand, StatusTag, Table, TableLoading, TableMessage, Td, Textarea, Th, Tr,
  useTableColumns, type StateTone,
} from "@/app/components/rd";
import {
  exportUserProfilesCsv,
  fetchC1Overview,
  fetchUserProfilesPage,
  UsersRequestError,
  type User360Profile,
  type UserPage,
  type UserProfileQuery,
} from "@/lib/admin/user360-client";
import { ADMIN_ERROR_MESSAGES, displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { businessClock, businessStamp, businessZone } from "@/lib/admin/business-time";
import { userNicknameText } from "@/lib/admin/brand-copy";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { isDeterministicRejection, isIdempotencyOutcomeOpen } from "@/lib/admin/outcome-classification";
import { announcePermissionDenied, isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { createPendingMutationStore, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { useReach } from "@/lib/nav/use-reach";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { CCtx } from "./types";

type Seg = "all" | "frozen" | "highrisk";
type FilterKey = "tier" | "vRank" | "referralCode" | "depositMin" | "depositMax" | "usdtMin" | "usdtMax" | "nexMin" | "nexMax" | "riskBand" | "joinedFrom" | "joinedTo";
type Filters = Record<FilterKey, string>;
/** 已应用的条件：列表、导出、网址都用这一份（ST-24、BUG-203）。 */
type Applied = { seg: Seg; keyword: string; filters: Filters };
type Overview = Awaited<ReturnType<typeof fetchC1Overview>>;
type ExportQuery = Omit<UserProfileQuery, "pageNum" | "pageSize">;
/** 导出的原操作：命令号、条件、理由、操作者都留着，重试只能原样（OP-94）。 */
type PendingExport = PendingMutationRecord & { query: ExportQuery; reason: string; operator: string };
type Problem = { text: string; fields: readonly FilterKey[]; keyword?: boolean };
type DialogNotice = { tone: "danger" | "warn"; title: string; text: string };
/** 导出框三种样子：新导出、原操作、解除待确认。解除在同一个框里换内容，不叠第二个框。 */
type Dialog = { mode: "new"; query: ExportQuery; total: number } | { mode: "pending" } | { mode: "release" };

const FILTER_KEYS: readonly FilterKey[] = ["tier", "vRank", "referralCode", "depositMin", "depositMax", "usdtMin", "usdtMax", "nexMin", "nexMax", "riskBand", "joinedFrom", "joinedTo"];
const EMPTY_FILTERS = Object.fromEntries(FILTER_KEYS.map((key) => [key, ""])) as Filters;
const AMOUNT_PAIRS = [["depositMin", "depositMax", "累计充值"], ["usdtMin", "usdtMax", "USDT 余额"], ["nexMin", "nexMax", "UVT 余额"]] as const;
const TIERS = ["L0", "L1", "L2", "L3", "L4", "L5"];
const V_RANKS = Array.from({ length: 13 }, (_, value) => `V${value}`);
const RISK_BANDS: Record<string, string> = { LOW: "低风险", MEDIUM: "中风险", HIGH: "高风险" };
const PAGE_SIZES = [20, 50, 100, 200] as const;
const DEFAULT_PAGE_SIZE = 50;
/** 后端最多读 25 页 × 200 条，按系统编号倒序（OpsUserService.buildProfileExport）。 */
const EXPORT_MAX_ROWS = 5000;
const REASON_RULE = "操作理由要 8–200 字";
const REASON_FORMAT = "操作理由不能以 { 或 [ 开头，也不能带网址";
/** 后端按角色给列：这三个角色 15 列，含风险分、设备数和余额，其他能导出的账号 9 列（OpsUserService.exportProfileExcel）。 */
const FULL_EXPORT_ROLES = ["superadmin", "risk", "auditor"];
const CHIP_PREFIX: Record<FilterKey, string> = {
  tier: "用户分层", vRank: "团队等级", referralCode: "推荐码", riskBand: "风险等级",
  depositMin: "累计充值 ≥", depositMax: "累计充值 ≤", usdtMin: "USDT 余额 ≥", usdtMax: "USDT 余额 ≤", nexMin: "UVT 余额 ≥", nexMax: "UVT 余额 ≤",
  joinedFrom: "注册日期起", joinedTo: "注册日期止",
};
/** 导出框里的条件和条件条一个叫法（DT-14）。 */
const EXPORT_PREFIX: Record<keyof ExportQuery, string> = {
  ...CHIP_PREFIX, keyword: "关键词", status: "账户状态", riskMin: "风险分 ≥", userId: "系统编号", phoneHash: "手机号哈希", phoneMasked: "脱敏手机号",
};
const STATUS: Record<string, { label: string; tone: StateTone; icon: LucideIcon }> = {
  ACTIVE: { label: "正常", tone: "neutral", icon: CheckCircle2 },
  FROZEN: { label: "冻结", tone: "warn", icon: Snowflake },
  RESTRICTED: { label: "受限", tone: "warn", icon: Lock },
  BANNED: { label: "封禁", tone: "danger", icon: ShieldAlert },
};
const UNKNOWN_STATUS = { label: "状态未知", tone: "warn" as StateTone, icon: CircleHelp };
const SEARCH_EXPLAIN = "可以搜用户编码、系统编号、昵称、推荐码、脱敏手机号（138****8010）和手机号哈希。为保护隐私，不能按完整手机号查。停止输入后自动查询。";
const RETRY_EXPLAIN = "用原编号重新发送。原操作已经生成过文件时，后端按原编号直接给回那个文件，不会再记一条导出。";

const exportStore = createPendingMutationStore<PendingExport>({
  storageKey: "nexion-admin-pending-c1-export-v1",
  // 过了 24 小时不能再用原号重试，记录留着核对（OP-96）。
  retainExpiredRecords: true,
  isValidRecord: (record) => typeof record.reason === "string" && typeof record.operator === "string"
    && !!record.query && typeof record.query === "object" && !Array.isArray(record.query),
});
/** 一个账号同时只有一条原导出。 */
const exportScope = (adminId: number | string | undefined) => `c1-user-export:${adminId ?? "anonymous"}`;

const statusOf = (value: unknown) => STATUS[String(value ?? "").toUpperCase()] ?? UNKNOWN_STATUS;
const countText = (value: number) => value.toLocaleString("en-US");
const present = (value: unknown) => value !== null && value !== undefined && value !== "";
const textOf = (value: unknown, fallback = "—") => present(value) ? String(value) : fallback;
const amountOk = (value: string) => value === "" || (Number.isFinite(Number(value)) && Number(value) >= 0);
/** 和后端同一条规则（OpsUserService.containsRawJsonOrUrl），发请求前先挡住。 */
const reasonProblem = (value: string) => {
  const reason = value.trim();
  if (reason.length < 8 || reason.length > 200) return REASON_RULE;
  return /^[{[]/.test(reason) || reason.includes("://") ? REASON_FORMAT : undefined;
};
const dateOk = (value: string) => {
  if (value === "") return true;
  const time = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00Z`) : NaN;
  return Number.isFinite(time) && new Date(time).toISOString().startsWith(value);
};

/** 高风险红、中风险橙黄、低风险灰；后端返回中文档名，也认英文码。 */
function riskOf(value: unknown): { label: string; tone: StateTone; icon: LucideIcon } | null {
  const band = typeof value === "string" ? value.trim() : "";
  if (!band) return null;
  const code = band.toUpperCase();
  if (code === "HIGH" || band.includes("高")) return { label: "高风险", tone: "danger", icon: ShieldAlert };
  if (code === "MEDIUM" || band.includes("中")) return { label: "中风险", tone: "warn", icon: ShieldAlert };
  if (code === "LOW" || band.includes("低")) return { label: "低风险", tone: "neutral", icon: ShieldCheck };
  return { label: band, tone: "neutral", icon: ShieldCheck };
}

/** 余额原值的字符串，不经过舍入。读不到返回 null。 */
function rawAmount(value: unknown): string | null {
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("en-US", { useGrouping: false, maximumFractionDigits: 20 }) : null;
  if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) return value.trim();
  return null;
}

/** 千分位，小数位补到这一列的位数，不舍入（TX-20）。 */
function amountText(raw: string, digits: number) {
  const [whole, fraction = ""] = raw.split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  return `${sign}${whole.replace("-", "").replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction.padEnd(digits, "0")}`;
}

function keywordQuery(value: string): Pick<UserProfileQuery, "keyword" | "userId" | "phoneHash" | "phoneMasked"> {
  const keyword = value.trim();
  if (!keyword) return {};
  if (/^[+0-9()\s-]+$/.test(keyword)) {
    const digits = keyword.replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) {
      throw new Error("C1_RAW_PHONE_SEARCH_FORBIDDEN");
    }
  }
  if (/^[0-9]{1,9}$/.test(keyword)) return { userId: keyword };
  if (/^[0-9a-f]{64}$/i.test(keyword)) return { phoneHash: keyword.toLowerCase() };
  if (/^[0-9]{3}\*{4}[0-9]{4}$/.test(keyword)) return { phoneMasked: keyword };
  return { keyword };
}

function keywordAccepted(value: string) {
  try {
    keywordQuery(value);
    return true;
  } catch {
    return false;
  }
}

const optionalNumber = (value: string) => value === "" ? undefined : Number(value);

/** 分段和更多筛选合成一份接口条件；「高风险」分段就是 riskBand=HIGH（BUG-203）。 */
function exportQueryOf(applied: Applied): ExportQuery {
  const { filters } = applied;
  return {
    ...keywordQuery(applied.keyword),
    tier: filters.tier || undefined,
    vRank: filters.vRank || undefined,
    referralCode: filters.referralCode || undefined,
    depositMin: optionalNumber(filters.depositMin),
    depositMax: optionalNumber(filters.depositMax),
    usdtMin: optionalNumber(filters.usdtMin),
    usdtMax: optionalNumber(filters.usdtMax),
    nexMin: optionalNumber(filters.nexMin),
    nexMax: optionalNumber(filters.nexMax),
    riskBand: filters.riskBand || undefined,
    joinedFrom: filters.joinedFrom || undefined,
    joinedTo: filters.joinedTo || undefined,
    ...(applied.seg === "frozen" ? { status: "FROZEN,BANNED,RESTRICTED" } : applied.seg === "highrisk" ? { riskBand: "HIGH" } : {}),
  };
}

/** 导出框里一行一个条件，没有条件写「全部用户」。 */
function exportScopeLines(query: ExportQuery) {
  const lines = (Object.entries(query) as [keyof ExportQuery, unknown][])
    .filter(([, value]) => present(value))
    .map(([key, value]) => `${EXPORT_PREFIX[key]} ${key === "riskBand"
      ? RISK_BANDS[String(value)] ?? String(value)
      : key === "status" ? String(value).split(",").map((status) => statusOf(status).label).join("、") : String(value)}`);
  return lines.length ? lines : ["全部用户"];
}

/** 进页时逐个校验网址参数，不合法的回默认；成对的反了两个都丢（ST-26）。 */
function readQuery(params: URLSearchParams, canReadRisk: boolean) {
  const text = (value: string | null) => value?.trim() ?? "";
  const amount = (value: string | null) => amountOk(text(value)) ? text(value) : "";
  const date = (value: string | null) => dateOk(text(value)) ? text(value) : "";
  const rawSeg = text(params.get("seg"));
  const seg: Seg = rawSeg === "frozen" ? "frozen" : rawSeg === "highrisk" && canReadRisk ? "highrisk" : "all";
  const q = text(params.get("q"));
  const tier = text(params.get("tier"));
  const vRank = text(params.get("vRank"));
  const riskBand = text(params.get("riskBand"));
  const filters: Filters = {
    tier: TIERS.includes(tier) ? tier : "",
    vRank: V_RANKS.includes(vRank) ? vRank : "",
    referralCode: text(params.get("referralCode")),
    depositMin: amount(params.get("depositMin")),
    depositMax: amount(params.get("depositMax")),
    usdtMin: amount(params.get("usdtMin")),
    usdtMax: amount(params.get("usdtMax")),
    nexMin: amount(params.get("nexMin")),
    nexMax: amount(params.get("nexMax")),
    // 没有风险读权的账号带着风险条件进来，后端会回 403，这里先丢掉；「高风险」分段带来的风险条件不重复记。
    riskBand: canReadRisk && seg !== "highrisk" && Object.hasOwn(RISK_BANDS, riskBand) ? riskBand : "",
    joinedFrom: date(params.get("joinedFrom")),
    joinedTo: date(params.get("joinedTo")),
  };
  for (const [min, max] of AMOUNT_PAIRS) {
    if (filters[min] && filters[max] && Number(filters[min]) > Number(filters[max])) filters[min] = filters[max] = "";
  }
  if (filters.joinedFrom && filters.joinedTo && filters.joinedFrom > filters.joinedTo) filters.joinedFrom = filters.joinedTo = "";
  const page = Number(text(params.get("page")));
  const pageSize = Number(text(params.get("pageSize")));
  return {
    applied: { seg, keyword: keywordAccepted(q) ? q : "", filters },
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZES.some((size) => size === pageSize) ? pageSize : DEFAULT_PAGE_SIZE,
  };
}

/** 写已应用的条件，替换方式，默认值不写，别的参数不动（ST-23）。原始手机号进不了这里：没通过校验的关键词不会被应用。 */
function writeQuery(applied: Applied, page: number, pageSize: number) {
  const params = new URLSearchParams(window.location.search);
  if (applied.seg === "all") params.delete("seg"); else params.set("seg", applied.seg);
  if (applied.keyword) params.set("q", applied.keyword); else params.delete("q");
  if (page === 1) params.delete("page"); else params.set("page", String(page));
  if (pageSize === DEFAULT_PAGE_SIZE) params.delete("pageSize"); else params.set("pageSize", String(pageSize));
  for (const key of FILTER_KEYS) {
    if (applied.filters[key]) params.set(key, applied.filters[key]);
    else params.delete(key);
  }
  const search = params.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
}

/** 条件有误时不发请求（ST-19）：一次只说一处，出错的框描边。 */
function draftProblem(keyword: string, filters: Filters, badFields: readonly FilterKey[]): Problem | null {
  if (!keywordAccepted(keyword)) return { text: `${ADMIN_ERROR_MESSAGES.C1_RAW_PHONE_SEARCH_FORBIDDEN}。`, fields: [], keyword: true };
  const bad = FILTER_KEYS.filter((key) => badFields.includes(key) && !filters[key]);
  if (bad.length) return { text: bad.some((key) => key.startsWith("joined")) ? "注册日期有误：请选一个完整的日期。" : "金额要填数字。", fields: bad };
  const negative = AMOUNT_PAIRS.flatMap(([min, max]) => [min, max]).filter((key) => !amountOk(filters[key]));
  if (negative.length) return { text: "金额不能小于 0。", fields: negative };
  for (const [min, max, label] of AMOUNT_PAIRS) {
    if (filters[min] && filters[max] && Number(filters[min]) > Number(filters[max])) return { text: `${label}有误：下限不能大于上限。`, fields: [min, max] };
  }
  if (filters.joinedFrom && filters.joinedTo && filters.joinedFrom > filters.joinedTo) return { text: "注册日期有误：开始日期不能晚于结束日期。", fields: ["joinedFrom", "joinedTo"] };
  return null;
}

/** 新导出：后端明确拒绝的才算没导出，丢掉这次的编号；幂等层说还在处理、结果查不清的，和 5xx、断网一样算结果未知（OP-91）。 */
const exportRejected = (error: unknown) => error instanceof UsersRequestError
  && isDeterministicRejection(error.status) && !isIdempotencyOutcomeOpen(error.code);

/**
 * 按原操作重试被拒后能不能「解除待确认」，只按共用的 isExplicitRejection（OP-153）：带原因码的 4xx 才算，
 * 401、403、408、425、429 和 IDEMPOTENCY_* 不算。UsersRequestError 的原因码字段叫 code，这里换成 reasonCode 交给它。
 */
const retryVerdict = (error: unknown) => isExplicitRejection(error instanceof UsersRequestError ? { status: error.status, reasonCode: error.code } : error);

/** 没有状态码（断网、请求没出去）、408、5xx：不知道这次有没有生效。 */
const outcomeUnknown = (error: unknown) => !(error instanceof UsersRequestError) || error.status === 0 || error.status === 408 || error.status >= 500;

/** 幂等层的码用这页的话说，通用句里的「稍后刷新」「重新发起」在原操作框里做不到。 */
const IDEMPOTENCY_CAUSE: Record<string, string> = {
  IDEMPOTENCY_KEY_PAYLOAD_MISMATCH: "服务端认为这次重试和原操作对不上，没有执行",
  IDEMPOTENCY_REQUEST_IN_PROGRESS: "原操作还在处理",
  IDEMPOTENCY_RETRY_CONFLICT: "原操作还在处理",
  IDEMPOTENCY_RECLAIM_CONFLICT: "原操作还在处理",
  IDEMPOTENCY_RESULT_UNKNOWN: "服务端也查不清原操作的结果",
  IDEMPOTENCY_SUCCESS_STATE_LOST: "服务端没记下原操作的结果",
  IDEMPOTENCY_FAILURE_STATE_LOST: "服务端没记下原操作的结果",
  IDEMPOTENCY_INVESTIGATION_CONFIRMED_SUCCEEDED: "人工核查确认原操作已经生效",
  IDEMPOTENCY_INVESTIGATION_CONFIRMED_NOT_EXECUTED: "人工核查确认原操作没有执行",
};

/**
 * 结果未知、重试失败时的原因，用这页自己的话（看图复查 2）。导出的结果页面查不到，筛选和理由也改不了，
 * 通用错误句里的「刷新确认是否已生效」「把输入恢复为首次提交时的内容」在这里做不到。普通业务拒绝照用接口的中文原因。
 */
function exportCause(error: unknown) {
  if (!(error instanceof UsersRequestError) || error.status === 0 || error.status === 408) return "网络断了或服务没有响应";
  if (error.status >= 500) return "服务暂时异常";
  if (error.code?.startsWith("IDEMPOTENCY_")) return IDEMPOTENCY_CAUSE[error.code] ?? "服务端没有处理这次请求";
  if (error.status === 429) return "请求太频繁，这次没有处理";
  if (error.status === 401 || error.status === 403) return "这个账号现在没有这项权限，这次没有处理";
  return displayAdminError(error).replace(/[。；]$/, "");
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1200);
}

export function C1Search({ ctx }: { ctx: CCtx }) {
  const router = useRouter();
  const reach = useReach();
  const searchParams = useSearchParams();
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const canReadRisk = session?.role === "superadmin" || authorities.includes("risk_k4_read");
  const canExport = authorities.includes("user_c1_export");
  const fullExport = FULL_EXPORT_ROLES.includes(session?.role ?? "");
  const canOpenDetail = reach("/users/search", "user_c1hub_read");
  const scope = exportScope(session?.adminId);

  const [initial] = useState(() => readQuery(searchParams, canReadRisk));
  const [applied, setApplied] = useState<Applied>(initial.applied);
  const [draftKeyword, setDraftKeyword] = useState(initial.applied.keyword);
  const [draftFilters, setDraftFilters] = useState<Filters>(initial.applied.filters);
  // 「高风险」分段时风险等级下拉显示高风险；在下拉里改过再点查询，分段回到「全部」，用下拉的值（BUG-203）。
  const [riskTouched, setRiskTouched] = useState(false);
  const [badFields, setBadFields] = useState<FilterKey[]>([]);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [page, setPage] = useState(initial.page);
  const [pageSize, setPageSize] = useState(initial.pageSize);

  const [list, setList] = useState<{ key: string; data: UserPage<User360Profile> } | null>(null);
  const [listError, setListError] = useState("");
  const [listLoading, setListLoading] = useState(true);
  const [listReload, setListReload] = useState(0);
  const [readAt, setReadAt] = useState<number | null>(null);
  // 后端按角色裁掉字段（UserProfileListView）：读到相应字段才显示列及选项；零行不推断可见，读取中沿用上一次。
  const [shape, setShape] = useState({ balance: false, device: false });
  const [overview, setOverview] = useState<Overview | null>(null);
  const [overviewFailed, setOverviewFailed] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewReload, setOverviewReload] = useState(0);
  const listRequest = useRef(0);
  const overviewRequest = useRef(0);

  const [pending, setPending] = useState<PendingExport | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [reason, setReason] = useState("");
  const [reasonTouched, setReasonTouched] = useState(false);
  // 后端说理由不合格时理由框也标出来，改了就收起。
  const [reasonRejected, setReasonRejected] = useState("");
  const [exporting, setExporting] = useState(false);
  const [dialogNotice, setDialogNotice] = useState<DialogNotice | null>(null);
  const [retryRejected, setRetryRejected] = useState(false);
  const releaseButton = useRef<HTMLButtonElement>(null);
  const exportingRef = useRef(false);
  const exportCooldownUntil = useRef(0);

  const listKey = JSON.stringify([applied, page, pageSize]);

  useEffect(() => {
    const requestId = ++listRequest.current;
    setListLoading(true);
    setListError("");
    void fetchUserProfilesPage({ ...exportQueryOf(applied), pageNum: page, pageSize }).then((data) => {
      if (requestId !== listRequest.current) return;
      setList({ key: listKey, data });
      setReadAt(Date.now());
      if (data.records.length) setShape({ balance: data.records.some((row) => present(row.walletUsdt)), device: data.records.some((row) => present(row.deviceCount)) });
      const pages = Math.max(1, Math.ceil(data.total / pageSize));
      if (page > pages) setPage(pages);
    }, (error) => {
      if (requestId !== listRequest.current) return;
      setList(null);
      setListError(displayAdminReadError(error));
    }).finally(() => {
      if (requestId === listRequest.current) setListLoading(false);
    });
    // listKey 已含 applied、page、pageSize。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, listReload]);

  useEffect(() => {
    const requestId = ++overviewRequest.current;
    setOverviewLoading(true);
    void fetchC1Overview().then((data) => {
      if (requestId !== overviewRequest.current) return;
      setOverview(data);
      setOverviewFailed(false);
    }, () => {
      if (requestId !== overviewRequest.current) return;
      setOverview(null);
      setOverviewFailed(true);
    }).finally(() => {
      if (requestId === overviewRequest.current) setOverviewLoading(false);
    });
  }, [overviewReload]);

  useEffect(() => {
    writeQuery(applied, page, pageSize);
  }, [applied, page, pageSize]);

  useEffect(() => {
    setPending(exportStore.list().find((record) => record.fingerprint === scope) ?? null);
  }, [scope]);

  // 搜索框停 300 毫秒查询，只改关键词，不带上更多筛选里没点查询的草稿（ST-16、ST-17）。
  useEffect(() => {
    if (draftKeyword.trim() === applied.keyword) {
      setProblem((current) => current?.keyword ? null : current);
      return;
    }
    const timer = window.setTimeout(() => {
      if (!keywordAccepted(draftKeyword)) {
        setProblem(draftProblem(draftKeyword, draftFilters, badFields));
        return;
      }
      setProblem(null);
      setApplied((current) => ({ ...current, keyword: draftKeyword.trim() }));
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
    // 只跟关键词走，筛选草稿在点查询时才校验。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKeyword, applied.keyword]);

  const syncPending = () => setPending(exportStore.list().find((record) => record.fingerprint === scope) ?? null);

  const submitFilters = () => {
    const found = draftProblem(draftKeyword, draftFilters, badFields);
    setProblem(found);
    if (found) return;
    setApplied((current) => ({
      seg: riskTouched && current.seg === "highrisk" ? "all" : current.seg,
      keyword: draftKeyword.trim(),
      filters: { ...draftFilters, referralCode: draftFilters.referralCode.trim() },
    }));
    setDraftFilters((current) => ({ ...current, referralCode: current.referralCode.trim() }));
    setRiskTouched(false);
    setPage(1);
  };

  const changeSeg = (seg: Seg) => {
    setProblem(null);
    setRiskTouched(false);
    // 选「高风险」分段时清掉风险等级，两处是同一个条件。
    if (seg === "highrisk") setDraftFilters((current) => ({ ...current, riskBand: "" }));
    setApplied((current) => ({ ...current, seg, filters: seg === "highrisk" ? { ...current.filters, riskBand: "" } : current.filters }));
    setPage(1);
  };

  const removeFilter = (key: FilterKey) => {
    setProblem(null);
    setBadFields((current) => current.filter((item) => item !== key));
    setDraftFilters((current) => ({ ...current, [key]: "" }));
    setApplied((current) => ({ ...current, filters: { ...current.filters, [key]: "" } }));
    setPage(1);
  };

  const clearAll = () => {
    setProblem(null);
    setRiskTouched(false);
    setBadFields([]);
    setDraftKeyword("");
    setDraftFilters(EMPTY_FILTERS);
    setApplied({ seg: "all", keyword: "", filters: EMPTY_FILTERS });
    setPage(1);
  };

  const editFilter = (key: FilterKey, value: string, badInput = false) => {
    setDraftFilters((current) => ({ ...current, [key]: value }));
    setBadFields((current) => badInput ? [...new Set([...current, key])] : current.filter((item) => item !== key));
    if (key === "riskBand") setRiskTouched(true);
  };

  const refresh = () => {
    setListReload((value) => value + 1);
    setOverviewReload((value) => value + 1);
  };

  const openProfile = (profile: User360Profile) => {
    const userNo = textOf(profile.userNo, "");
    if (!userNo) {
      ctx.toast("该用户没有用户编码，无法打开详情", "warn");
      return;
    }
    const returnTo = `${window.location.pathname}${window.location.search}`;
    router.push(`/users/search/${encodeURIComponent(userNo)}?returnTo=${encodeURIComponent(returnTo)}`);
  };

  const shown = list?.key === listKey ? list.data : null;
  const total = shown?.total ?? 0;
  const exportBlocked = listLoading && !shown ? "名单还在读取，读完再导出"
    : listError ? "用户列表加载失败，暂不能导出"
      : problem ? "查询条件有误，改好后再导出"
        : listLoading ? "名单还在读取，读完再导出"
          : total === 0 ? "当前条件下没有用户，不用导出" : undefined;

  const pendingExpired = pending ? pending.expiresAt <= Date.now() : false;
  // 原操作按风险条件筛过，这个账号现在没有风险读权：不重发，也不能删掉风险条件再用原号发（F04）。
  const pendingNeedsRisk = !!pending && (present(pending.query.riskBand) || present(pending.query.riskMin));
  const retryBlocked = !pending ? undefined
    : pendingExpired ? RETRY_EXPIRED_TEXT
      : pendingNeedsRisk && !canReadRisk ? "原操作按风险条件筛选，你的账号现在没有风险读权，不能按原操作重试，请到操作记录与审批核对" : undefined;

  const closeDialog = () => {
    if (exporting) return;
    setDialog(null);
    setDialogNotice(null);
    setReasonTouched(false);
    setReasonRejected("");
  };

  /** 有原操作时只能打开原操作：结果没确认前不能换新编号另发一次（OP-94、OP-96）。 */
  const openExport = () => {
    setDialogNotice(null);
    setReasonTouched(false);
    setReasonRejected("");
    setRetryRejected(false);
    if (pending) {
      setDialog({ mode: "pending" });
      return;
    }
    setReason("");
    setDialog({ mode: "new", query: exportQueryOf(applied), total });
  };

  const backToPending = () => {
    setDialog({ mode: "pending" });
    window.requestAnimationFrame(() => releaseButton.current?.focus());
  };

  const throttled = () => {
    if (exportingRef.current || Date.now() < exportCooldownUntil.current) {
      ctx.toast("正在生成用户名单，请稍候", "info");
      return true;
    }
    return false;
  };

  /**
   * 后端给回文件才清掉原操作：名单生成时后端就记了导出，浏览器有没有存下文件页面不知道，也不影响那条记录（F05）。
   */
  const send = async (record: Pick<PendingExport, "commandKey" | "query" | "reason" | "operator">) => {
    const file = await exportUserProfilesCsv(record.query, record.commandKey, record.reason, record.operator);
    downloadBlob(file.blob, file.fileName);
    exportStore.forget(scope, record.commandKey);
    syncPending();
    setDialog(null);
    setDialogNotice(null);
    setReason("");
    ctx.toast(`名单已生成，已发起下载 · ${file.fileName}`, "success");
  };

  /**
   * 新导出：先把原操作存进会话存储，存不下就不发（OP-92）。这时不能有别的原操作，有就转去原操作，不覆盖（F01）。
   * 明确拒绝丢掉这次的编号，框不关、理由留着；结果未知留着原操作，框转成原操作的样子（OP-93）。
   */
  const runNewExport = async () => {
    if (dialog?.mode !== "new" || exporting || throttled()) return;
    if (reasonProblem(reason)) {
      setReasonTouched(true);
      return;
    }
    if (exportStore.list().some((item) => item.fingerprint === scope)) {
      syncPending();
      setDialog({ mode: "pending" });
      return;
    }
    const commandKey = `c1-user-profile-export-${crypto.randomUUID()}`;
    const record = { query: dialog.query, reason: reason.trim(), operator: currentAdminOperator() };
    exportStore.remember(scope, commandKey, record);
    if (!exportStore.isDurablyStored(scope, commandKey)) {
      exportStore.forget(scope, commandKey);
      setDialogNotice({ tone: "danger", title: "名单没有导出", text: "浏览器存不下这次操作，换一个窗口再试。" });
      return;
    }
    exportingRef.current = true;
    setExporting(true);
    setDialogNotice(null);
    setReasonRejected("");
    try {
      await send({ commandKey, ...record });
    } catch (error) {
      if (exportRejected(error)) {
        exportStore.forget(scope, commandKey);
        syncPending();
        if (isPermissionDenied(error)) {
          announcePermissionDenied();
          setDialog(null);
          return;
        }
        if (error instanceof UsersRequestError && error.code === "C1_EXPORT_REASON_INVALID") {
          setReasonRejected(displayAdminError(error));
          setDialogNotice({ tone: "danger", title: "名单没有导出", text: "操作理由没有通过检查，改好后再导出。" });
          return;
        }
        setDialogNotice({ tone: "danger", title: "名单没有导出", text: displayAdminError(error) });
        return;
      }
      syncPending();
      setDialog({ mode: "pending" });
      setDialogNotice({ tone: "warn", title: "导出结果未确认", text: `${exportCause(error)}，不知道名单生成没有。可能已生成文件并记录导出，请先到操作记录与审批核对，或按原操作重试。` });
    } finally {
      exportCooldownUntil.current = Date.now() + 1_000;
      exportingRef.current = false;
      setExporting(false);
    }
  };

  /**
   * 按原操作重试：同编号、同条件、同理由（OP-94）。过期、没有风险读权了都不发（F04）。
   * 失败不管什么原因都不解除；只有 retryVerdict 认的明确拒绝才给「解除待确认」（F03）。
   */
  const retryExport = async () => {
    if (!pending || exporting || throttled() || retryBlocked) return;
    // retryBlocked 是上次渲染时算的：框开着跨过 24 小时再点，要用现在的时间再判断一次，过期就不发，原记录照旧留着（F06）。
    if (pending.expiresAt <= Date.now()) {
      setDialogNotice({ tone: "warn", title: "不能再重试", text: `${RETRY_EXPIRED_TEXT}。` });
      return;
    }
    if (!exportStore.isDurablyStored(pending.fingerprint, pending.commandKey)) {
      setDialogNotice({ tone: "warn", title: "没有重试", text: "浏览器里查不到这条记录，本次没有发送。待确认继续保留，请到操作记录与审批核对。" });
      return;
    }
    exportingRef.current = true;
    setExporting(true);
    setDialogNotice(null);
    setRetryRejected(false);
    try {
      await send(pending);
    } catch (error) {
      if (isPermissionDenied(error)) announcePermissionDenied();
      const verdict = retryVerdict(error);
      setRetryRejected(verdict);
      setDialogNotice(outcomeUnknown(error)
        ? { tone: "warn", title: "重试结果未确认", text: `${exportCause(error)}，不知道这次重试生效没有。原操作继续保留，可以稍后再按原操作重试。` }
        : { tone: "warn", title: "重试没有成功", text: `${exportCause(error)}。原操作的结果仍不确定，${verdict ? "核实后可以解除待确认，再发起新导出。" : "继续保留，请到操作记录与审批核对。"}` });
    } finally {
      exportCooldownUntil.current = Date.now() + 1_000;
      exportingRef.current = false;
      setExporting(false);
    }
  };

  /** 解除只清本标签页的记录，不发请求，不进操作记录，后端那条导出记录不变。 */
  const releasePending = () => {
    exportStore.forget(scope);
    syncPending();
    setDialog(null);
    setDialogNotice(null);
    setRetryRejected(false);
    ctx.toast("已解除待确认，可以发起新导出", "success");
  };

  // ---- 显示 ----
  const rows = shown?.records ?? [];
  const hasConditions = applied.seg !== "all" || applied.keyword !== "" || FILTER_KEYS.some((key) => applied.filters[key] !== "");
  const filtersChanged = riskTouched || FILTER_KEYS.some((key) => draftFilters[key] !== applied.filters[key]);
  const draftChanged = filtersChanged || (problem?.keyword === true && draftKeyword.trim() !== applied.keyword);
  const invalid = (key: FilterKey) => problem?.fields.includes(key) || undefined;
  const chips = FILTER_KEYS.filter((key) => applied.filters[key] !== "").map((key) => ({
    key,
    label: `${CHIP_PREFIX[key]} ${key === "riskBand" ? RISK_BANDS[applied.filters.riskBand] : applied.filters[key]}`,
    onRemove: () => removeFilter(key),
  }));

  const showBalance = shape.balance;
  const showDevice = shape.device;
  const columns = useTableColumns("c1-users", [
    { key: "user", label: "用户", locked: "第一列不能关" },
    { key: "status", label: "状态", locked: "状态不能关" },
    { key: "level", label: "等级", locked: "等级不能关" },
    ...(canReadRisk ? [{ key: "risk", label: "风险", locked: "风险列不能关" }] : []),
    ...(showBalance ? [{ key: "balance", label: "USDT 余额", locked: "余额不能关" }] : []),
    ...(showDevice ? [{ key: "device", label: "设备", extra: true }] : []),
    ...(canOpenDetail ? [{ key: "action", label: "操作", locked: "操作列不能关" }] : []),
  ]);
  const deviceVisible = showDevice && columns.isVisible("device");
  const columnCount = 3 + (canReadRisk ? 1 : 0) + (showBalance ? 1 : 0) + (deviceVisible ? 1 : 0) + (canOpenDetail ? 1 : 0);
  // 用表头的名字，新手才对得上（DT-14）。
  const hidden = [!canReadRisk && "风险", !showBalance && "USDT 余额", !showDevice && "设备"].filter(Boolean);
  const balances = rows.map((row) => rawAmount(row.walletUsdt));
  // 同一列按本页最多的小数位补零，至少 2 位、最多 6 位（钱包 DECIMAL(18,6)）。
  const balanceDigits = Math.min(6, Math.max(2, ...balances.map((raw) => raw?.split(".")[1]?.length ?? 0)));

  const riskValue = !overview ? "—" : overview.riskAuthorityAvailable && overview.highRisk !== null ? countText(overview.highRisk) : "暂无评分";
  const statFailed = overviewFailed && !overview;
  const auditHref = reach("/platform/audit", "platform_a2_read") ? "/platform/audit?domain=C" : null;
  const links = [
    reach("/users/actions", "user_c2_read") && <Link key="c2" className="rd-link" href="/users/actions">账户操作</Link>,
    reach("/users/assets", "user_c3_read") && <Link key="c3" className="rd-link" href="/users/assets">余额与资产调整</Link>,
    reach("/users/security", "user_c5_read") && <Link key="c5" className="rd-link" href="/users/security">安全与登录设备</Link>,
  ].filter(Boolean);
  const reasonError = reasonProblem(reason);
  const auditLink = auditHref ? <Link className="rd-link" href={auditHref}>操作记录与审批</Link> : "操作记录与审批";
  const readOnly = canExport ? (canOpenDetail ? undefined : "你的账号不能打开用户详情")
    : `你只能查看；导出名单需要「导出脱敏用户清单」权限${canOpenDetail ? "" : "；你的账号不能打开用户详情"}`;

  return <>
    <PageHeader pageId="C1" title="查找用户与查看资料" summary={<AutoGloss>按用户编码、昵称或推荐码找用户，点一行看完整资料。</AutoGloss>}
      guideExtra={canExport ? undefined : <p>你的账号不能导出名单，「导出名单」这件事不适用。</p>}
      meta={<span className="rd-toolbar">
        <span>{readAt ? `${businessClock(readAt)} 读取（${businessZone().label}），` : ""}不自动刷新</span>
        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={listLoading && !!shown} onClick={refresh}>刷新</Button>
      </span>}
      readOnly={readOnly}
      actions={canExport ? (
        <Button icon={<Download size={14} aria-hidden />} disabledReason={pending ? undefined : exportBlocked} onClick={openExport}>
          {pending ? (retryBlocked ? "查看原导出" : "继续原导出") : "导出名单"}
        </Button>
      ) : undefined} />

    {pending && (
      <Notice tone="warn" title="导出用户名单 · 结果未确认">
        {/* 按逗号、句号分段整段换行，不在「24 小 / 时」「原操 / 作」这种词中间断开；链接放进句子里只写一遍。 */}
        <KeepText text={`${businessStamp(pending.createdAt)}（${businessZone().label}）发起，可能已生成文件并记录导出，确认前不能发起新导出。`} />
        {!canExport ? <><span className="rd-keep">你的账号现在不能导出名单，</span><span className="rd-keep">请到{auditLink}核对。</span></>
          : pendingExpired ? <><KeepText text="已超过 24 小时，不能再重试，" /><span className="rd-keep">请到{auditLink}核对。</span></>
            : retryBlocked ? <><KeepText text="你的账号现在没有风险读权，不能按原操作重试，" /><span className="rd-keep">请到{auditLink}核对。</span></>
              : <><span className="rd-keep">点右上角「继续原导出」按原操作重试，</span><span className="rd-keep">或到{auditLink}核对。</span></>}
        <Explain label="技术信息" content={`命令号 ${pending.commandKey} ｜ 操作者 ${pending.operator} ｜ 理由 ${pending.reason}`} />
      </Notice>
    )}

    <StatBand label="用户汇总" fit>
      <Stat icon={Users} tone="role-3" label="注册用户" value={overview ? countText(overview.totalUsers) : "—"} unit={overview ? "人" : undefined}
        sub={statFailed ? <>统计读取失败 <InlineRetry retrying={overviewLoading} onRetry={() => setOverviewReload((value) => value + 1)} /></> : undefined}
        explain="全部注册账户，不随下面的筛选变。" />
      {canReadRisk && (
        <Stat icon={ShieldAlert} iconTone={riskValue === "暂无评分" ? undefined : "danger"} label="高风险用户" value={riskValue} unit={riskValue === "—" || riskValue === "暂无评分" ? undefined : "人"}
          sub={overview?.riskAuthorityAvailable && overview.highRiskThreshold !== null ? `风险分 ≥ ${overview.highRiskThreshold}` : undefined}
          explain={overview && !overview.riskAuthorityAvailable
            ? "风险评分规则没有生效的版本，或最近 24 小时没有评分，这时不统计高风险用户。"
            : "风险分取最近 24 小时内的评分，达到高风险分数线就算。分数线在「风险评分规则」里定。"} />
      )}
      {/* 三个数是一次请求，读取失败只在第一格写一次（DT-12）。 */}
      <Stat icon={Snowflake} iconTone="warn" label="冻结账户" value={overview ? countText(overview.frozen) : "—"} unit={overview ? "人" : undefined}
        explain="只算状态是冻结的账户，不含受限和封禁。" />
    </StatBand>

    <FilterBar
      // 分段独占一行：1024 下和搜索框、三个按钮排一行放不下，「清除筛选」会单个掉到下一行。
      scope={<div className="rd-filter-scope-row"><Segments label="用户状态快捷筛选" value={applied.seg} onChange={changeSeg}
        items={[
          { value: "all" as Seg, label: "全部" },
          { value: "frozen" as Seg, label: "冻结、受限、封禁" },
          ...(canReadRisk ? [{ value: "highrisk" as Seg, label: "高风险" }] : []),
        ]} /></div>}
      onSubmit={submitFilters}
      querying={listLoading}
      onClear={clearAll}
      canClear={hasConditions || draftChanged || draftKeyword !== ""}
      moreCount={chips.length}
      more={<>
        <FilterField label={<span>用户分层<Explain label="用户分层的说明" content="L0–L5，只在后台用，用户在 App 里看不到。" /></span>}>
          <Select aria-label="用户分层" value={draftFilters.tier} onChange={(value) => editFilter("tier", value)}
            options={[{ value: "", label: "全部分层" }, ...TIERS.map((tier) => ({ value: tier, label: tier }))]} />
        </FilterField>
        <FilterField label={<span>团队等级<Explain label="团队等级的说明" content="现行团队等级是 V0–V8，V9–V12 只用来查历史用户。用户在 App 里能看到自己的团队等级。" /></span>}>
          <Select aria-label="团队等级" value={draftFilters.vRank} onChange={(value) => editFilter("vRank", value)}
            options={[{ value: "", label: "全部团队等级" }, ...V_RANKS.map((rank) => ({ value: rank, label: rank }))]} />
        </FilterField>
        {canReadRisk && (
          <FilterField label={<span>风险等级<Explain label="风险等级的说明" content="按最近 24 小时内的风险分分档。在这里改了再点「查询」，「高风险」快捷分段会取消。" /></span>}>
            <Select aria-label="风险等级" value={applied.seg === "highrisk" && !riskTouched ? "HIGH" : draftFilters.riskBand} onChange={(value) => editFilter("riskBand", value)}
              options={[{ value: "", label: "全部风险等级" }, ...Object.entries(RISK_BANDS).map(([value, label]) => ({ value, label }))]} />
          </FilterField>
        )}
        <FilterField label="推荐码">
          <Input aria-label="推荐码" value={draftFilters.referralCode} onChange={(event) => editFilter("referralCode", event.target.value)} />
        </FilterField>
        <FilterField label={<span>累计充值<Explain label="累计充值的口径" content="按确认、已入账、成功三种状态的充值单金额合计。" /></span>}>
          <span className="rd-filter-range">
            <Input aria-label="累计充值下限" aria-invalid={invalid("depositMin")} type="number" min="0" step="any" inputMode="decimal" placeholder="下限" value={draftFilters.depositMin}
              onChange={(event) => editFilter("depositMin", event.target.value, event.target.validity.badInput)} />
            <span aria-hidden>–</span>
            <Input aria-label="累计充值上限" aria-invalid={invalid("depositMax")} type="number" min="0" step="any" inputMode="decimal" placeholder="上限" value={draftFilters.depositMax}
              onChange={(event) => editFilter("depositMax", event.target.value, event.target.validity.badInput)} />
          </span>
        </FilterField>
        <FilterField label={<span>USDT 余额<Explain label="USDT 余额的口径" content="钱包可用余额。" /></span>}>
          <span className="rd-filter-range">
            <Input aria-label="USDT 余额下限" aria-invalid={invalid("usdtMin")} type="number" min="0" step="any" inputMode="decimal" placeholder="下限" value={draftFilters.usdtMin}
              onChange={(event) => editFilter("usdtMin", event.target.value, event.target.validity.badInput)} />
            <span aria-hidden>–</span>
            <Input aria-label="USDT 余额上限" aria-invalid={invalid("usdtMax")} type="number" min="0" step="any" inputMode="decimal" placeholder="上限" value={draftFilters.usdtMax}
              onChange={(event) => editFilter("usdtMax", event.target.value, event.target.validity.badInput)} />
          </span>
        </FilterField>
        <FilterField label={<span>UVT 余额<Explain label="UVT 余额的口径" content="钱包可用余额。" /></span>}>
          <span className="rd-filter-range">
            <Input aria-label="UVT 余额下限" aria-invalid={invalid("nexMin")} type="number" min="0" step="any" inputMode="decimal" placeholder="下限" value={draftFilters.nexMin}
              onChange={(event) => editFilter("nexMin", event.target.value, event.target.validity.badInput)} />
            <span aria-hidden>–</span>
            <Input aria-label="UVT 余额上限" aria-invalid={invalid("nexMax")} type="number" min="0" step="any" inputMode="decimal" placeholder="上限" value={draftFilters.nexMax}
              onChange={(event) => editFilter("nexMax", event.target.value, event.target.validity.badInput)} />
          </span>
        </FilterField>
        <FilterField wide label={<span>注册日期（北京时间）<Explain label="注册日期的说明" content="开始日期从当天 0 点算起，结束日期含当天。" /></span>}>
          <span className="rd-filter-range">
            <Input aria-label="注册日期起" aria-invalid={invalid("joinedFrom")} type="date" value={draftFilters.joinedFrom}
              onChange={(event) => editFilter("joinedFrom", event.target.value, event.target.validity.badInput)} />
            <span aria-hidden>–</span>
            <Input aria-label="注册日期止" aria-invalid={invalid("joinedTo")} type="date" value={draftFilters.joinedTo}
              onChange={(event) => editFilter("joinedTo", event.target.value, event.target.validity.badInput)} />
          </span>
        </FilterField>
      </>}
      applied={chips}
      result={draftChanged ? "条件未应用" : undefined}
      notice={problem && <span data-proof="c1-filter-refused">{problem.text}{listError ? "这次没有查询。" : "下面仍是上次的结果。"}</span>}
    >
      <FilterField grow>
        <Input data-search aria-label="检索用户" aria-invalid={problem?.keyword} placeholder="用户编码 / 昵称 / 推荐码 / 脱敏手机号" value={draftKeyword}
          onChange={(event) => setDraftKeyword(event.target.value)} />
      </FilterField>
      <Explain label="搜索支持什么" content={SEARCH_EXPLAIN} />
    </FilterBar>

    <Panel flush icon={Users} tone="role-3" title="用户" sub="新注册的在前"
      explain={hidden.length ? <><p>你的账号看不到这几列，所以不显示：</p><p>{hidden.join("、")}</p></> : undefined}
      actions={showDevice ? <ColumnPicker columns={columns} /> : undefined}>
      <Table label="用户列表" aria-busy={listLoading} data-tight="">
        <thead><tr>
          <Th sticky="start" icon={Users} tone="users">用户</Th>
          <Th>状态</Th>
          <Th>等级</Th>
          {canReadRisk && <Th icon={ShieldAlert} tone="risk"><Explain label="风险分怎么来" content="风险分取最近 24 小时内的评分，没有评分写「—」。">风险</Explain></Th>}
          {showBalance && <Th align="right" icon={Coins} tone="money"><Explain label="余额这一列的口径" content="钱包可用余额。">USDT 余额</Explain></Th>}
          {deviceVisible && <Th align="right"><Explain label="设备数的口径" content="上面是设备总数，下面是活跃的台数。活跃算在线、忙碌、已激活、运行中的设备。">设备</Explain></Th>}
          {canOpenDetail && <Th sticky="end">操作</Th>}
        </tr></thead>
        <tbody>
          {listError ? (
            <TableMessage columns={columnCount} role="alert">
              <span data-proof="c1-list-failed">用户列表加载失败，不显示旧数据：{listError}</span> <Button size="sm" onClick={() => setListReload((value) => value + 1)}>重试</Button>
            </TableMessage>
          ) : !shown && listLoading ? (
            <TableLoading columns={columnCount} rows={Math.min(pageSize, 10)} />
          ) : rows.length === 0 ? (
            <TableMessage columns={columnCount} role="status">
              {hasConditions
                ? <>没有找到用户，换个关键词或筛选条件试试 <Button size="sm" onClick={clearAll}>清除筛选</Button></>
                : "暂无注册用户"}
            </TableMessage>
          ) : rows.map((row, index) => {
            const userNo = textOf(row.userNo, "");
            const nickname = present(row.nickname) ? userNicknameText(String(row.nickname), row.phoneMasked) : "";
            const status = statusOf(row.status);
            const risk = riskOf(row.riskBand);
            const balance = balances[index];
            return (
              <Tr key={userNo || textOf(row.id, String(index))} onOpen={canOpenDetail ? () => openProfile(row) : undefined}>
                <Td sticky="start">
                  <Cell title={nickname || userNo || undefined} main={nickname || (userNo ? <span data-mono>{userNo}</span> : "—")}
                    sub={nickname && userNo ? <span data-mono>{userNo}</span> : undefined} />
                </Td>
                <Td><StatusTag tone={status.tone} icon={status.icon}>{status.label}</StatusTag></Td>
                <Td><Cell main={`${textOf(row.userLevel)} · ${textOf(row.vRank)}`} /></Td>
                {canReadRisk && (
                  <Td>
                    {risk || present(row.riskScore)
                      ? <Cell main={risk ? <StatusTag tone={risk.tone} icon={risk.icon}>{risk.label}</StatusTag> : "—"} sub={present(row.riskScore) ? `风险分 ${row.riskScore}` : undefined} />
                      : <span className="rd-weak">—</span>}
                  </Td>
                )}
                {showBalance && (
                  // 余额列只占最长那个数的宽，多出的宽度分给前面几列，数字不贴着「查看资料」（建议 1）。
                  <Td align="right" data-fit="">
                    <Cell num main={balance === null ? <span className="rd-weak">—</span>
                      : Number(balance) === 0 ? <span className="rd-weak">{amountText(balance, balanceDigits)}</span>
                        : amountText(balance, balanceDigits)} />
                  </Td>
                )}
                {deviceVisible && <Td align="right"><Cell num main={textOf(row.deviceCount)} sub={present(row.activeDeviceCount) ? `活跃 ${row.activeDeviceCount}` : undefined} /></Td>}
                {canOpenDetail && (
                  // 列少时操作列只占按钮宽，按钮不和左边的列隔一大段（DT-04）。
                  <Td sticky="end" data-fit="">
                    <Button size="sm" variant="ghost" aria-label={`查看用户详情 ${userNo || "未生成"}`} onClick={() => openProfile(row)}>查看资料</Button>
                  </Td>
                )}
              </Tr>
            );
          })}
        </tbody>
      </Table>
      {/* 服务端分页：总数只在这里写一次（DP-61），换条件时暂留上一次的总数（ST-32）。 */}
      {!listError && list && list.data.total > 0 && (
        <Pager label="用户列表" total={list.data.total} page={page} pageSize={pageSize} sizes={PAGE_SIZES} loading={listLoading}
          onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} />
      )}
    </Panel>

    {links.length > 0 && (
      <nav className="rd-links" aria-label="相关页面">
        <span>相关页面</span>
        {links}
      </nav>
    )}

    {dialog?.mode === "release" ? (
      // 解除在同一个框里换内容（PG-38）：「返回」回到原操作，× 关掉整个框。
      <Modal title="解除待确认" icon={ShieldCheck} onClose={closeDialog} footer={<>
        <Button autoFocus onClick={backToPending}>返回</Button>
        <Button variant="primary" onClick={releasePending}>确认解除</Button>
      </>}>
        <ReleaseBody label="导出用户名单" explain="先到操作记录与审批核对这次导出有没有记下。" />
      </Modal>
    ) : dialog && (
      <Modal title="导出用户名单" icon={Download} sub={<StatusTag tone="progress" filled>立即生效</StatusTag>} busy={exporting}
        dirty={dialog.mode === "new" && reason.trim() !== ""} onClose={closeDialog}
        footer={dialog.mode === "new" ? (
          <Decision
            others={<Button disabled={exporting} onClick={closeDialog}>取消</Button>}
            primary={<Button variant="primary" loading={exporting} loadingText="生成中…" disabledReason={reasonError}
              onBlockedClick={() => setReasonTouched(true)} onClick={() => void runNewExport()}>确认并导出</Button>} />
        ) : (
          <Decision
            explain={<><p>按原操作重试：{RETRY_EXPLAIN}</p><p>原操作结果确认前不能发起新导出。重试被明确拒绝后，核实原操作的结果，可以解除待确认。</p></>}
            others={<>
              <Button disabled={exporting} onClick={closeDialog}>稍后处理</Button>
              {retryRejected && <Button ref={releaseButton} disabled={exporting} onClick={() => setDialog({ mode: "release" })}>解除待确认</Button>}
            </>}
            primary={<Button variant="primary" loading={exporting} loadingText="生成中…" disabledReason={retryBlocked}
              onClick={() => void retryExport()}>按原操作重试</Button>} />
        )}>
        <div className="rd-stack">
          {dialogNotice ? <Notice tone={dialogNotice.tone} title={dialogNotice.title}><KeepText text={dialogNotice.text} /></Notice>
            // 不能重试的原因写在框里，不只藏在灰按钮的悬停里（建议 3）。
            : dialog.mode === "pending" && retryBlocked && <Notice tone="warn" title="不能再重试"><KeepText text={`${retryBlocked}。`} /></Notice>}
          <Facts>
            {dialog.mode === "new" && dialog.total > EXPORT_MAX_ROWS ? <>
              {/* 最大的数写这次实际导出多少（VS-102），符合条件的人数放下一行。 */}
              <Fact k="导出条数" lead unit="条">{countText(EXPORT_MAX_ROWS)}</Fact>
              <Fact k="符合条件">{countText(dialog.total)} 条</Fact>
              <Fact k="导出上限" tone="warn">只导出最新注册的 {countText(EXPORT_MAX_ROWS)} 条，其余请缩小范围</Fact>
            </> : dialog.mode === "new" ? (
              <Fact k="名单条数" lead unit="条">{countText(dialog.total)}</Fact>
            ) : pending && (
              <Fact k="发起时间">{businessStamp(pending.createdAt)}（{businessZone().label}）</Fact>
            )}
            <Fact k={dialog.mode === "new" ? "本次导出筛选" : "原操作筛选"}>
              {exportScopeLines(dialog.mode === "new" ? dialog.query : pending?.query ?? {}).map((line, index) => <Fragment key={line}>{index > 0 && <br />}{line}</Fragment>)}
            </Fact>
            {/* 原操作的理由只读，写成事实行，不放一个看着能填的框（VS-104）。 */}
            {dialog.mode === "pending" && pending && <Fact k="操作理由">{pending.reason}</Fact>}
            {/* 两件事各一行，520 宽的框里一句话折行会剩下「出过。」这类孤字。 */}
            <Fact k="导出内容">{fullExport ? "15 列脱敏 CSV，含风险分、设备数和余额" : "9 列脱敏 CSV"}<br />手机号只显示脱敏号</Fact>
            <Fact k="去向">浏览器直接下载</Fact>
            <Fact k="记录">名单生成时记入操作记录。<br />浏览器没存下文件也算导出过。</Fact>
          </Facts>
          {dialog.mode === "new" && (
            <Field label="操作理由" required hint="至少 8 字" error={reasonRejected || (reasonTouched ? reasonError : undefined)}>
              {(control) => (
                <Textarea {...control} aria-label="导出用户名单理由" placeholder="写清导出用途和接收人" rows={3}
                  value={reason} disabled={exporting} count={`${reason.trim().length}/200`} onBlur={() => setReasonTouched(true)}
                  onChange={(event) => { setReason(event.target.value); setReasonRejected(""); }} />
              )}
            </Field>
          )}
        </div>
      </Modal>
    )}
  </>;
}
