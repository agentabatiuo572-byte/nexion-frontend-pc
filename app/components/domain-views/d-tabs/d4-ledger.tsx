"use client";
import { useReach } from "@/lib/nav/use-reach";
import { operatorNicknameText } from "@/lib/admin/brand-copy";
import { nexGridBrandText } from "@/lib/admin/brand-copy";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeftRight, CheckCircle2, Clock3, Coins, Copy, Download, Layers, Receipt, RefreshCw, Scale, Wallet } from "lucide-react";
import { AutoGloss } from "@/app/components/kit/gloss";
import {
  BlockState, Button, Cell, Check, ColumnPicker, Conclusion, Decision, Drawer, Explain, Fact, Facts, FilterBar, FilterField, Fold, IconButton, InlineRetry, Input,
  JudgmentPoints, Notice, PageHeader, PageTabs, Pager, Panel, Segments, Select, Stat, StatBand, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr,
  useTabIds, useTableColumns, type JudgmentRow, type StateTone,
} from "@/app/components/rd";
import { displayAdminError } from "@/lib/admin/error-messages";
import { businessClock, businessZone, formatBusinessTimeCompact, formatBusinessTimeFull } from "@/lib/admin/business-time";
import {
  downloadD4BillsCsv,
  fetchD4Bills,
  fetchD4RunningBalance,
  fetchD4UserLedger,
  type D4Bill,
  type D4BillQuery,
  type D4BillType,
  type D4RunningBalance,
  type D4RunningBalanceRow,
  type D4UserLedger,
  type PageResult,
} from "@/lib/admin/d-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { formatD4Remark, formatD4Subtype } from "@/lib/admin/d4-ledger-display";
import type { DCtx } from "./types";

const BILL_TYPES: ReadonlyArray<readonly [D4BillType | "", string]> = [
  ["", "全部"],
  ["swap", "兑换"],
  ["topup", "充值"],
  ["withdraw", "提现"],
  ["earning", "收益"],
  ["commission", "团队奖励"],
  ["refund", "退款"],
  ["bonus", "奖励"],
  ["purchase", "商品购买"],
];

const BILL_TYPE_LABELS: Record<D4BillType, string> = Object.fromEntries(BILL_TYPES.slice(1)) as Record<D4BillType, string>;
/** 账本状态的显示名。SUCCESS 和 POSTED 都是已结算，名字分开写，和筛选下拉一致（TX-32）。 */
const BILL_STATUS: Record<string, { label: string; tone: StateTone }> = {
  POSTED: { label: "已入账", tone: "ok" },
  SUCCESS: { label: "成功", tone: "ok" },
  COMPLETED: { label: "已完成", tone: "ok" },
  CONFIRMED: { label: "已确认", tone: "ok" },
  PENDING: { label: "处理中", tone: "progress" },
  PROCESSING: { label: "处理中", tone: "progress" },
  FAILED: { label: "失败", tone: "danger" },
  REJECTED: { label: "已拒绝", tone: "danger" },
  CANCELLED: { label: "已取消", tone: "done" },
};
const STATUS_FILTERS = ["POSTED", "SUCCESS", "PENDING", "FAILED", "REJECTED", "CANCELLED"];
const EMPTY_PAGE: PageResult<D4Bill> = { total: 0, pageNum: 1, pageSize: 10, records: [] };
const PAGE_SIZES = [10, 20, 50] as const;
/** 后端单次核对、导出的上限（OpsTreasuryService D4_MAX_AUDIT_ROWS）。 */
const MAX_ROWS = 100_000;
const TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const USER_HINT = "请输入用户编码或系统编号，比如 U00000005 或 5";

type View = "all" | "user";
type Applied = { userId?: number; keyword: string; status: string; from: string; to: string };
type Counts = { state: "loading" } | { state: "failed" } | { state: "ok"; pending: number; failed: number; rejected: number };
type UserData = { ledger: D4UserLedger; running: D4RunningBalance; from: string; to: string; readAt: number };
type Problem = { kind: "user" | "time"; reason: string };

const billStatus = (status: string) => BILL_STATUS[status.toUpperCase()] ?? { label: "状态未知", tone: "warn" as StateTone };
const credit = (row: D4Bill) => row.direction === "IN" || row.direction === "CREDIT";
const unit = (asset: string) => nexGridBrandText(asset);
const listTime = (value: string) => formatBusinessTimeCompact(value, "—");

/** 接口给的小数位数，金额是 Number。 */
function decimals(value: number) {
  const text = Math.abs(value).toString();
  const [mantissa, exponent] = text.split("e-");
  const fraction = mantissa.split(".")[1]?.length ?? 0;
  return exponent ? fraction + Number(exponent) : fraction;
}

/** 同一列按最多的小数位补零，至少 2 位，最多 8 位（TX-20）。 */
const digitsOf = (values: readonly number[]) => Math.min(8, Math.max(2, ...values.map(decimals)));

function amountText(value: number, digits = digitsOf([value])) {
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** 入账 +，出账 -，0 不带符号。 */
function signed(row: D4Bill, digits?: number) {
  return `${row.amount === 0 ? "" : credit(row) ? "+" : "-"}${amountText(row.amount, digits)}`;
}

function signedDiff(value: number, digits?: number) {
  return `${value > 0 ? "+" : value < 0 ? "-" : ""}${amountText(Math.abs(value), digits)}`;
}

/** 用户编码 U00000005 和系统编号 5 都认：后端的用户编码是 U 加 8 位补零的系统编号。 */
function parseUser(value: string) {
  const match = /^[Uu]?(\d{1,15})$/.exec(value.trim());
  const id = match ? Number(match[1]) : 0;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const userCode = (id: number) => `U${String(id).padStart(8, "0")}`;

function userLabel(row: Pick<D4Bill, "userNo" | "nickname"> | Pick<D4UserLedger, "userNo" | "nickname"> | null | undefined) {
  return row ? [row.userNo, operatorNicknameText(row.nickname ?? "")].filter(Boolean).join(" · ") || "—" : "—";
}

/** 时间框是存储时钟，后端原样解析，写的就是北京时间。 */
function timeText(value: string) {
  return value.replace("T", " ").slice(0, 16);
}

function appliedTimeRange({ from, to }: { from: string; to: string }) {
  if (from && to) return `${timeText(from)} 至 ${timeText(to)}（北京时间）`;
  if (from) return `${timeText(from)} 起（北京时间）`;
  return to ? `截至 ${timeText(to)}（北京时间）` : "不限时间";
}

/** Names the conditions the table was really loaded with, so a refused query can say what is still on screen. */
function appliedConditions(applied: Applied, type: D4BillType | "", bizNo: string) {
  const parts = [
    type && BILL_TYPE_LABELS[type],
    applied.userId && `用户 ${userCode(applied.userId)}`,
    applied.status && billStatus(applied.status).label,
    (applied.from || applied.to) && appliedTimeRange(applied),
    applied.keyword && (bizNo && applied.keyword === bizNo ? `账单号 ${bizNo}` : `关键词「${applied.keyword}」`),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "全部账单";
}

/** 网址参数不合法时回默认值（ST-26），进页读一次（ST-59）。 */
function queryFromUrl(params: { get: (name: string) => string | null } | null) {
  const read = (value: string | null | undefined) => value?.trim() ?? "";
  const bizNo = read(params?.get("bizNo"));
  const status = read(params?.get("status")).toUpperCase();
  const typeParam = read(params?.get("type"));
  const viewParam = read(params?.get("view"));
  const fromParam = read(params?.get("from"));
  const toParam = read(params?.get("to"));
  let from = TIME_PATTERN.test(fromParam) ? fromParam : "";
  let to = TIME_PATTERN.test(toParam) ? toParam : "";
  if (from && to && from >= to) [from, to] = ["", ""];
  const page = Number(read(params?.get("page")));
  const pageSize = Number(read(params?.get("pageSize")));
  const userId = parseUser(read(params?.get("userId")));
  return {
    bizNo,
    keyword: bizNo || read(params?.get("keyword")),
    status: /^[A-Z][A-Z0-9_]{1,31}$/.test(status) ? status : "",
    userId,
    ledgerUserId: parseUser(read(params?.get("ledgerUserId"))) ?? userId,
    type: (BILL_TYPES.some(([value]) => value && value === typeParam) ? typeParam : "") as D4BillType | "",
    from,
    to,
    page: Number.isSafeInteger(page) && page > 0 ? page : 1,
    pageSize: PAGE_SIZES.some((size) => size === pageSize) ? pageSize : 10,
    // 写明的 view 优先；没写时带账单号进来定位，只带用户进来看这个用户（D4-Q04）。
    view: (viewParam === "user" || viewParam === "all" ? viewParam : !bizNo && userId ? "user" : "all") as View,
  };
}

/** 查询状态写网址，替换方式，不加浏览器历史（ST-23）。只动这页的参数，默认值不写。 */
function writeQueryToUrl(entries: readonly (readonly [string, string])[]) {
  const params = new URLSearchParams(window.location.search);
  for (const [name, value] of entries) {
    if (value) params.set(name, value);
    else params.delete(name);
  }
  const search = params.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`);
}

export function D4Ledger({ ctx }: { ctx: DCtx }) {
  const reach = useReach();
  const searchParams = useSearchParams();
  const [initial] = useState(() => queryFromUrl(searchParams));
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const isSuperAdmin = session?.role === "superadmin";
  const canGlobalRead = isSuperAdmin || authorities.includes("finance_d4_read");
  const canUserRead = canGlobalRead || authorities.includes("finance_d4_user_read");
  const canExport = isSuperAdmin || authorities.includes("finance_d4_export");
  const tabIds = useTabIds();

  const [view, setView] = useState<View>(initial.view);
  const tab: View = canGlobalRead ? view : "user";
  const [bizNo, setBizNo] = useState(initial.bizNo);
  const [bills, setBills] = useState<PageResult<D4Bill>>(EMPTY_PAGE);
  const [billsReadAt, setBillsReadAt] = useState<number | null>(null);
  const [counts, setCounts] = useState<Counts>({ state: "loading" });
  const [draft, setDraft] = useState({ userId: initial.userId ? userCode(initial.userId) : "", keyword: initial.keyword, status: initial.status });
  // 时间两个页签共用：草稿一份，应用一份（D4-H01）。
  const [timeDraft, setTimeDraft] = useState({ from: initial.from, to: initial.to });
  const [applied, setApplied] = useState<Applied>({ userId: initial.userId ?? undefined, keyword: initial.keyword, status: initial.status, from: initial.from, to: initial.to });
  const [type, setType] = useState<D4BillType | "">(initial.type);
  const [page, setPage] = useState(initial.page);
  const [pageSize, setPageSize] = useState(initial.pageSize);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(initial.ledgerUserId);
  const [userInput, setUserInput] = useState(initial.ledgerUserId ? userCode(initial.ledgerUserId) : "");
  const [userData, setUserData] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(canGlobalRead);
  const [userLoading, setUserLoading] = useState(false);
  const [error, setError] = useState("");
  const [userError, setUserError] = useState("");
  // Refused before any request: nothing was queried, so the last results stay and these say so.
  const [filterProblem, setFilterProblem] = useState("");
  const [userProblem, setUserProblem] = useState<Problem | null>(null);
  const [billsReload, setBillsReload] = useState(0);
  const [countsReload, setCountsReload] = useState(0);
  const [userReload, setUserReload] = useState(0);
  const [onlyBreaks, setOnlyBreaks] = useState(true);
  const [userPage, setUserPage] = useState(1);
  const [userPageSize, setUserPageSize] = useState(10);
  const [detail, setDetail] = useState<{ tab: View; id: number } | null>(null);
  const billsRequest = useRef(0);
  const countsRequest = useRef(0);
  const userRequest = useRef(0);
  const columns = useTableColumns("d4-bills", [
    { key: "bill", label: "账单", locked: "第一列不能关" },
    { key: "type", label: "类型", locked: "类型不能关" },
    { key: "amount", label: "金额", locked: "金额不能关" },
    { key: "status", label: "状态", locked: "状态不能关" },
    { key: "remark", label: "备注", extra: true },
    { key: "time", label: "时间", locked: "时间不能关" },
    { key: "action", label: "操作", locked: "操作列不能关" },
  ]);

  const exactBizNo = bizNo && applied.keyword === bizNo ? bizNo : undefined;

  useEffect(() => {
    if (!canGlobalRead) {
      setBills(EMPTY_PAGE);
      setLoading(false);
      return;
    }
    const requestId = ++billsRequest.current;
    setLoading(true);
    setError("");
    setDetail((current) => (current?.tab === "all" ? null : current));
    // 翻页时保留上一份 total/pageSize:清成 EMPTY_PAGE 会让分页短暂显示「共 0 条 · 第 2 / 1 页」
    // 这种违反分页约束的中间态。记录本身清空由 loading 占位行表达。
    setBills((current) => ({ ...current, pageNum: page, pageSize, records: [] }));
    const query: D4BillQuery = {
      type,
      userId: applied.userId,
      bizNo: exactBizNo,
      keyword: exactBizNo ? undefined : applied.keyword,
      status: applied.status,
      from: applied.from,
      to: applied.to,
      pageNum: page,
      pageSize,
    };
    void fetchD4Bills(query).then((next) => {
      if (requestId !== billsRequest.current) return;
      setBills(next);
      setBillsReadAt(Date.now());
    }).catch((reason) => {
      if (requestId !== billsRequest.current) return;
      setBills(EMPTY_PAGE);
      setError(reason instanceof Error ? displayAdminError(reason) : "资金账单加载失败");
    }).finally(() => {
      if (requestId === billsRequest.current) setLoading(false);
    });
  }, [applied, canGlobalRead, exactBizNo, page, pageSize, billsReload, type]);

  // 处理中、失败的数量算全部匹配的账单，不跟账单状态筛选和页码变。
  useEffect(() => {
    if (!canGlobalRead) return;
    const requestId = ++countsRequest.current;
    setCounts({ state: "loading" });
    const base: D4BillQuery = {
      type, userId: applied.userId, bizNo: exactBizNo, keyword: exactBizNo ? undefined : applied.keyword,
      from: applied.from, to: applied.to, pageNum: 1, pageSize: 1,
    };
    void Promise.all(["PENDING", "FAILED", "REJECTED"].map((status) => fetchD4Bills({ ...base, status }))).then(([pending, failed, rejected]) => {
      if (requestId === countsRequest.current) setCounts({ state: "ok", pending: pending.total, failed: failed.total, rejected: rejected.total });
    }, () => {
      if (requestId === countsRequest.current) setCounts({ state: "failed" });
    });
  }, [applied.from, applied.keyword, applied.to, applied.userId, canGlobalRead, countsReload, exactBizNo, billsReload, type]);

  useEffect(() => {
    if (!selectedUserId || !canUserRead) {
      setUserData(null);
      return;
    }
    const requestId = ++userRequest.current;
    // 换用户、换时间先清掉上一份，不让旧用户的账单和核对暂留（D4-C61、ST-27）。
    setUserData(null);
    setUserLoading(true);
    setUserError("");
    setDetail((current) => (current?.tab === "user" ? null : current));
    const from = applied.from;
    const to = applied.to;
    const range = { from: from || undefined, to: to || undefined };
    void Promise.all([
      fetchD4UserLedger(selectedUserId, range),
      fetchD4RunningBalance(selectedUserId, range),
    ]).then(([ledger, running]) => {
      if (requestId !== userRequest.current) return;
      setUserData({ ledger, running, from, to, readAt: Date.now() });
      setOnlyBreaks(true);
      setUserPage(1);
    }).catch((reason) => {
      if (requestId !== userRequest.current) return;
      setUserData(null);
      setUserError(reason instanceof Error ? displayAdminError(reason) : "该用户账单加载失败");
    }).finally(() => {
      if (requestId === userRequest.current) setUserLoading(false);
    });
  }, [applied.from, applied.to, canUserRead, userReload, selectedUserId]);

  useEffect(() => {
    writeQueryToUrl([
      // 默认不写；全平台页签带用户筛选时写 all，刷新不跳到按用户查账单。
      ["view", !canGlobalRead ? "" : view === "user" ? "user" : applied.userId && !bizNo ? "all" : ""],
      ["bizNo", bizNo],
      ["keyword", exactBizNo ? "" : applied.keyword],
      ["status", applied.status],
      ["userId", applied.userId ? String(applied.userId) : ""],
      ["type", type],
      ["from", applied.from],
      ["to", applied.to],
      ["page", page === 1 ? "" : String(page)],
      ["pageSize", pageSize === 10 ? "" : String(pageSize)],
      ["ledgerUserId", selectedUserId ? String(selectedUserId) : ""],
    ]);
  }, [applied, bizNo, canGlobalRead, exactBizNo, page, pageSize, selectedUserId, type, view]);

  const stats = useMemo(() => {
    const inflow = bills.records.filter(credit).length;
    const outflow = bills.records.length - inflow;
    const pending = bills.records.filter((row) => ["PENDING", "PROCESSING"].includes(row.status.toUpperCase())).length;
    return { inflow, outflow, pending };
  }, [bills.records]);
  const amountDigits = digitsOf(bills.records.map((row) => row.amount));
  const balanceDigits = digitsOf(bills.records.map((row) => row.balanceAfter));

  const draftUserId = draft.userId.trim() ? parseUser(draft.userId) ?? -1 : undefined;
  const timeChanged = timeDraft.from !== applied.from || timeDraft.to !== applied.to;
  const draftChanged = draft.keyword.trim() !== applied.keyword || draft.status !== applied.status || draftUserId !== applied.userId || timeChanged;
  const hasConditions = Boolean(type || applied.keyword || applied.status || applied.userId || applied.from || applied.to || bizNo);

  const timeProblem = () => (timeDraft.from && timeDraft.to && timeDraft.from >= timeDraft.to ? "开始时间必须早于结束时间" : "");

  const applyFilters = () => {
    const parsedUserId = draft.userId.trim() ? parseUser(draft.userId) : null;
    if (draft.userId.trim() && !parsedUserId) {
      setFilterProblem(USER_HINT);
      return;
    }
    if (timeProblem()) {
      setFilterProblem(timeProblem());
      return;
    }
    setFilterProblem("");
    const keyword = draft.keyword.trim();
    if (keyword !== bizNo) setBizNo("");
    setDraft((value) => ({ ...value, keyword, userId: parsedUserId ? userCode(parsedUserId) : "" }));
    setApplied({ userId: parsedUserId ?? undefined, keyword, status: draft.status, from: timeDraft.from, to: timeDraft.to });
    setPage(1);
  };

  const removeCondition = (patch: Partial<Applied>) => {
    setFilterProblem("");
    setApplied((value) => ({ ...value, ...patch }));
    if ("userId" in patch) setDraft((value) => ({ ...value, userId: "" }));
    if ("from" in patch) setTimeDraft((value) => ({ ...value, from: "" }));
    if ("to" in patch) setTimeDraft((value) => ({ ...value, to: "" }));
    setPage(1);
  };

  const clearFilters = () => {
    setFilterProblem("");
    setType("");
    setBizNo("");
    setDraft({ userId: "", keyword: "", status: "" });
    setTimeDraft({ from: "", to: "" });
    setApplied({ keyword: "", status: "", from: "", to: "" });
    setPage(1);
  };

  const onlyStatus = (status: string) => {
    setFilterProblem("");
    setDraft((value) => ({ ...value, status }));
    setApplied((value) => ({ ...value, status }));
    setPage(1);
  };

  const openUser = () => {
    const userId = parseUser(userInput);
    if (!userId) {
      setUserProblem({ kind: "user", reason: USER_HINT });
      return;
    }
    if (timeProblem()) {
      setUserProblem({ kind: "time", reason: timeProblem() });
      return;
    }
    setUserProblem(null);
    setUserInput(userCode(userId));
    if (timeChanged) {
      setApplied((value) => ({ ...value, from: timeDraft.from, to: timeDraft.to }));
      setPage(1);
    }
    if (userId === selectedUserId && !timeChanged) setUserReload((value) => value + 1);
    setSelectedUserId(userId);
  };

  const viewAccount = (row: D4Bill) => {
    setUserProblem(null);
    setUserInput(parseUser(row.userNo) === row.userId ? row.userNo : String(row.userId));
    if (row.userId === selectedUserId) setUserReload((value) => value + 1);
    setSelectedUserId(row.userId);
    setView("user");
  };

  const refresh = () => {
    if (tab === "all") setBillsReload((value) => value + 1);
    else setUserReload((value) => value + 1);
  };

  // A failed export rejects into the confirm dialog, which stays open with the reason; the loaded bills are unaffected.
  const exportCsv = async (reason: string) => {
    await downloadD4BillsCsv(
      { type, ...applied, bizNo: exactBizNo, keyword: exactBizNo ? undefined : applied.keyword },
      reason,
    );
    ctx.toast("账单 CSV 已下载", "success");
  };
  const requestExport = () => ctx.openActionConfirm({ briefKind: "export",
    action: "导出账单明细",
    title: "导出账单",
    detail: null,
    facts: (
      <Facts>
        {canGlobalRead && <Fact k="账单条数" lead unit="条">{bills.total.toLocaleString("en-US")}</Fact>}
        <Fact k="范围">{appliedConditions(applied, type, bizNo)}</Fact>
        <Fact k="去向">浏览器直接下载</Fact>
        <Fact k="隐藏内容">不含昵称和备注，用户编码只留首尾</Fact>
      </Facts>
    ),
    statedBrief: { impact: "这次导出记入操作记录。", check: "核对导出内容，理由写明导出依据或工单号。" },
    effect: <StatusTag tone="progress" filled>立即生效</StatusTag>,
    confirmLabel: "确认导出",
    reasonMin: 8,
    reasonMax: 200,
    run: (reason) => exportCsv(reason),
  });
  const exportBlocked = !canGlobalRead ? undefined
    : loading ? "账单还在读取，读完再导出"
      : error ? "账单加载失败，暂不能导出"
        : filterProblem ? "查询条件有误，改好后再导出"
          : bills.total === 0 ? "当前条件下没有账单，不用导出"
            : bills.total > MAX_ROWS ? "超过 10 万条，缩小时间范围后再导出" : undefined;

  const copyBizNo = (value: string) => {
    void navigator.clipboard?.writeText(value).then(() => ctx.toast("已复制账单号", "success"), () => ctx.toast("复制失败，请手动选中账单号复制", "error"));
  };

  // ── 按用户查账单 ──
  const running = userData?.running;
  const rowBreaks = running ? running.rows.filter((row) => row.breakDetected).length : 0;
  // 决定 09：设了开始时间时，期初余额还没带进核对，钱包差额会误报。只看逐笔断点，不比钱包，等 BE-09 交付。
  const walletChecked = Boolean(running && running.reconciliationScope === "CURRENT_WALLET" && running.reconciliation && !userData?.from);
  const breakCount = running ? (walletChecked ? running.breakCount : rowBreaks) : 0;
  // 不和钱包比、区间里又没有账单时，没有东西可核对，不说「都对得上」，也不把没账单当余额 0（决定 09）。
  const nothingToCheck = Boolean(running && !walletChecked && running.rows.length === 0);
  const newestFirst = useMemo(() => (running ? [...running.rows].reverse() : []), [running]);
  const shownChecks = onlyBreaks && rowBreaks > 0 ? newestFirst.filter((row) => row.breakDetected) : newestFirst;
  const userPages = Math.max(1, Math.ceil(shownChecks.length / userPageSize));
  const pageChecks = shownChecks.slice((Math.min(userPage, userPages) - 1) * userPageSize, Math.min(userPage, userPages) * userPageSize);
  const checkAmountDigits = digitsOf(pageChecks.map((row) => row.bill.amount));
  const checkBalanceDigits = digitsOf(pageChecks.flatMap((row) => [row.bill.balanceAfter, ...(row.expectedBalanceAfter === null ? [] : [row.expectedBalanceAfter])]));
  const categories = userData ? BILL_TYPES.slice(1).map(([key, label]) => ({
    key, label, usdt: userData.ledger.categoryTotals[`${key}:USDT`] ?? 0, uvt: userData.ledger.categoryTotals[`${key}:UVT`] ?? 0,
  })).filter((row) => row.usdt !== 0 || row.uvt !== 0) : [];
  const userTimeChanged = timeChanged;
  const userDraftChanged = Boolean(selectedUserId) && (parseUser(userInput) !== selectedUserId || userTimeChanged);

  // ── 详情抽屉：读的是列表行，不发请求 ──
  const drawerRows: { bill: D4Bill; check?: D4RunningBalanceRow }[] = detail?.tab === "user"
    ? pageChecks.map((row) => ({ bill: row.bill, check: row }))
    : bills.records.map((bill) => ({ bill }));
  const drawerIndex = detail && detail.tab === tab ? drawerRows.findIndex((row) => row.bill.id === detail.id) : -1;
  const shown = drawerIndex >= 0 ? drawerRows[drawerIndex] : undefined;
  useEffect(() => {
    if (detail && !shown) setDetail(null);
  }, [detail, shown]);
  const openDetail = (source: View, id: number) => setDetail({ tab: source, id });

  const judgment = (row: { bill: D4Bill; check?: D4RunningBalanceRow }): JudgmentRow[] => {
    const { bill, check } = row;
    const rows: JudgmentRow[] = [
      { label: "金额", value: `${signed(bill)} ${unit(bill.asset)}` },
      { label: "变动后余额", value: `${amountText(bill.balanceAfter)} ${unit(bill.asset)}` },
      { label: "账户", tone: "users", value: userLabel(bill) },
      { label: "时间", value: formatBusinessTimeFull(bill.createdAt, "—") },
    ];
    if (check) {
      rows.push(check.breakDetected
        ? { label: "核对结果", state: "danger", value: `断点，差 ${signedDiff(check.difference)} ${unit(bill.asset)}`, reason: check.expectedBalanceAfter === null ? undefined : `按上一笔算应为 ${amountText(check.expectedBalanceAfter)} ${unit(bill.asset)}` }
        : { label: "核对结果", value: check.settlementBucket === "UNSETTLED" ? "未结算 · 不参与钱包核对" : "连续" });
    }
    return rows;
  };

  const readAt = tab === "all" ? billsReadAt : userData?.readAt ?? null;
  const header = (
    <PageHeader pageId="D4" title="账本与账单核对" summary={<AutoGloss>查账单，核对用户余额和钱包是否一致。</AutoGloss>}
      guideExtra={canGlobalRead ? undefined : <p>你的账号只能按用户查账单，「全平台账单」相关的步骤不适用。</p>}
      meta={canUserRead ? (
        <span className="rd-toolbar">
          <span>{readAt ? `${businessClock(readAt)} 读取（${businessZone().label}），` : ""}不自动刷新</span>
          <Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={tab === "all" ? loading : userLoading} onClick={refresh}>刷新</Button>
        </span>
      ) : undefined}
      readOnly={canUserRead && !canGlobalRead ? "你只能按用户查账单，不能查看全平台账单。" : undefined}
      actions={canExport && (tab === "all" || !canGlobalRead)
        ? <Button icon={<Download size={14} aria-hidden />} disabledReason={exportBlocked} onClick={requestExport}>导出 CSV</Button>
        : undefined} />
  );

  if (!canUserRead) {
    return <>
      {header}
      <BlockState state="denied" title="无权限访问" detail="这个账号没有账单的读取权限，需要时联系超级管理员。" />
    </>;
  }

  const notFound = !loading && !error && bills.records.length === 0;
  const failedTotal = counts.state === "ok" ? counts.failed + counts.rejected : 0;
  const globalConclusion = counts.state === "loading"
    ? <Conclusion state="unknown">正在读取…</Conclusion>
    : counts.state === "failed"
      ? <Conclusion state="unknown" action={<InlineRetry onRetry={() => setCountsReload((value) => value + 1)} />}>暂时读不到处理中和失败的数量</Conclusion>
      : (
        <Conclusion state={failedTotal > 0 ? "warn" : "neutral"} icon={failedTotal === 0 && counts.pending > 0 ? Clock3 : undefined}
          explain="数量算当前条件下的全部账单，不随账单状态筛选变；失败含已拒绝。处理中的账单还没结算，余额核对不算它们。这句话不代表账都对，核对要到「按用户查账单」。"
          action={(counts.pending > 0 || failedTotal > 0) && <>
            {counts.pending > 0 && <button type="button" className="rd-link rd-link-button" onClick={() => onlyStatus("PENDING")}>只看处理中</button>}
            {counts.failed > 0 && <button type="button" className="rd-link rd-link-button" onClick={() => onlyStatus("FAILED")}>只看失败</button>}
            {counts.rejected > 0 && <button type="button" className="rd-link rd-link-button" onClick={() => onlyStatus("REJECTED")}>只看已拒绝</button>}
          </>}>
          {failedTotal > 0
            ? `当前条件下有 ${counts.pending > 0 ? `${counts.pending} 条处理中、` : ""}${failedTotal} 条失败`
            : counts.pending > 0 ? `当前条件下有 ${counts.pending} 条处理中` : "没有处理中或失败的账单"}
        </Conclusion>
      );

  const statusOptions = [
    { value: "", label: "全部状态" },
    ...STATUS_FILTERS.map((value) => ({ value, label: billStatus(value).label })),
    ...[...new Set([draft.status, applied.status])].filter((value) => value && !STATUS_FILTERS.includes(value)).map((value) => ({ value, label: billStatus(value).label })),
  ];
  const appliedChips = [
    applied.userId ? { key: "user", label: `用户 ${userCode(applied.userId)}`, onRemove: () => removeCondition({ userId: undefined }) } : null,
    applied.from ? { key: "from", label: `开始 ${timeText(applied.from)}`, onRemove: () => removeCondition({ from: "" }) } : null,
    applied.to ? { key: "to", label: `结束 ${timeText(applied.to)}（不含）`, onRemove: () => removeCondition({ to: "" }) } : null,
  ].filter((chip) => chip !== null);
  const TIME_EXPLAIN = "时间范围两个页签共用：在一边改了查询，另一边也按新时间重读。结束时间不含当时那一分钟。";
  const setFrom = (from: string) => setTimeDraft((value) => ({ ...value, from }));
  const setTo = (to: string) => setTimeDraft((value) => ({ ...value, to }));
  const columnCount = 6 + (columns.isVisible("remark") ? 1 : 0);

  const globalPane = <>
    {bizNo && (
      <div data-proof="d4-deep-link">
        <Notice tone={notFound ? "warn" : "neutral"}>正在查找相关账单 · <span data-mono>{bizNo}</span>{notFound ? " · 未找到匹配账单" : ""}</Notice>
      </div>
    )}
    {!error && globalConclusion}
    <FilterBar
      scope={<div className="rd-filter-scope-row"><Segments label="账单类型" value={type} onChange={(next) => { setType(next); setPage(1); }}
        items={BILL_TYPES.map(([value, label]) => ({ value, label }))} /></div>}
      onSubmit={applyFilters}
      querying={loading}
      onClear={clearFilters}
      canClear={hasConditions || draftChanged}
      moreCount={appliedChips.length}
      more={<>
        <FilterField label="用户编码或系统编号"><Input aria-label="用户编码或系统编号" placeholder="比如 U00000005 或 5" value={draft.userId} onChange={(event) => setDraft((value) => ({ ...value, userId: event.target.value }))} /></FilterField>
        <FilterField label={<span>开始时间（北京时间）<Explain label="时间范围的说明" content={TIME_EXPLAIN} /></span>}>
          <Input aria-label="开始时间" type="datetime-local" value={timeDraft.from} onChange={(event) => setFrom(event.target.value)} />
        </FilterField>
        <FilterField label="结束时间（北京时间，不含）">
          <Input aria-label="结束时间" type="datetime-local" value={timeDraft.to} onChange={(event) => setTo(event.target.value)} />
        </FilterField>
      </>}
      applied={appliedChips}
      result={draftChanged ? "条件未应用" : undefined}
      notice={filterProblem && (
        <span data-proof="d4-filter-refused">
          查询条件有误：{filterProblem}。这次没有查询{error ? "。" : `，下方表格仍是上次查询的结果（${appliedConditions(applied, type, bizNo)}）。`}
        </span>
      )}
    >
      <FilterField grow><Input aria-label="账单关键词" placeholder="账单号 / 用户编码 / 昵称 / 备注" value={draft.keyword} onChange={(event) => setDraft((value) => ({ ...value, keyword: event.target.value }))} /></FilterField>
      <FilterField><Select aria-label="账单状态" value={draft.status} onChange={(status) => setDraft((value) => ({ ...value, status }))} options={statusOptions} /></FilterField>
    </FilterBar>
    <Panel flush icon={Receipt} tone="role-2" title="全平台账单" actions={<ColumnPicker columns={columns} />}>
      <Table label="全平台账单" aria-busy={loading} data-tight="">
        <thead><tr>
          <Th sticky="start">账单</Th>
          <Th>类型</Th>
          <Th align="right" icon={Coins} tone="money">金额</Th>
          <Th>状态</Th>
          {columns.isVisible("remark") && <Th>备注</Th>}
          <Th>时间（{businessZone().label}）</Th>
          <Th sticky="end">操作</Th>
        </tr></thead>
        <tbody>
          {loading ? <TableLoading columns={columnCount} rows={Math.min(pageSize, 10)} />
            : error ? (
              <TableMessage columns={columnCount} role="alert">
                <span data-proof="d4-fail-closed">全平台账单已停止展示旧数据 · {error}</span> <Button size="sm" onClick={() => setBillsReload((value) => value + 1)}>重试</Button>
              </TableMessage>
            )
              : bills.records.length === 0 ? (
                <TableMessage columns={columnCount} role="status">
                  暂无匹配账单流水；空数据不代表已经对平{hasConditions && <> <Button size="sm" onClick={clearFilters}>清除筛选</Button></>}
                </TableMessage>
              )
                : bills.records.map((row) => {
                  const status = billStatus(row.status);
                  const remark = formatD4Remark(row.remark);
                  return (
                    <Tr key={row.id} selected={detail?.tab === "all" && detail.id === row.id} mark={bizNo && row.bizNo === bizNo ? "hit" : undefined} onOpen={() => openDetail("all", row.id)}>
                      <Td sticky="start"><Cell title={row.bizNo} main={<span data-mono>{row.bizNo}</span>} sub={userLabel(row)} /></Td>
                      <Td><Cell main={BILL_TYPE_LABELS[row.billType]} sub={formatD4Subtype(row.subtype)} /></Td>
                      <Td align="right"><Cell num main={`${signed(row, amountDigits)} ${unit(row.asset)}`} sub={`余 ${amountText(row.balanceAfter, balanceDigits)} ${unit(row.asset)}`} /></Td>
                      <Td><StatusTag tone={status.tone}>{status.label}</StatusTag></Td>
                      {columns.isVisible("remark") && <Td><Cell title={remark.label} main={remark.label} /></Td>}
                      <Td><Cell num main={listTime(row.createdAt)} /></Td>
                      <Td sticky="end"><Button size="sm" onClick={() => viewAccount(row)}>查看账户</Button></Td>
                    </Tr>
                  );
                })}
        </tbody>
      </Table>
      {/* 服务端分页：Pager 按服务端返回的总数翻页 */}
      {!error && bills.total > 0 && (
        <Pager label="全平台账单" total={bills.total} page={page} pageSize={pageSize} sizes={PAGE_SIZES} loading={loading}
          note={loading ? undefined : `本页入账 ${stats.inflow} 笔 · 出账 ${stats.outflow} 笔 · 处理中 ${stats.pending} 笔`}
          onPage={setPage} onPageSize={(size) => { setPageSize(size); setPage(1); }} />
      )}
    </Panel>
  </>;

  const userRefused = userProblem && (
    <span data-proof="d4-user-refused">
      {userProblem.kind === "user" ? "用户编码或系统编号有误" : "查询条件有误"}：{userProblem.reason}。这次没有查询{userData ? `，下方仍是用户 ${userLabel(userData.ledger)} 的账单和余额核对（时间范围：${appliedTimeRange(userData)}）。` : "。"}
    </span>
  );
  const userConclusion = running && userData && (
    <div data-proof="d4-running-balance">
      <Conclusion state={breakCount > 0 ? "danger" : nothingToCheck ? "neutral" : "ok"} lead={breakCount > 0} icon={breakCount > 0 ? undefined : CheckCircle2}
        explain={running.reconciliationScope === "HISTORICAL_RANGE"
          ? <><p>历史时段不与当前钱包对比。</p><p>{running.reconciliationNote}</p></>
          : userData.from
            ? "设了开始时间时，只核对这段时间里每一笔余额是否连续，不和当前钱包比，也不显示钱包差额：开始时间之前的余额还没带进核对，比了会误报。要和钱包比，清空开始时间后再加载。"
            : "逐笔看每一笔的变动后余额是不是等于上一笔余额加减这笔金额，再拿最后一笔已结算账单的余额和当前钱包比。处理中的账单不参与。"}
        hint={running.unsettledCount > 0 ? `（另有 ${running.unsettledCount} 条未结算的不参与核对）` : undefined}
        action={breakCount > 0 && reach("/users/assets", "user_c3_read") ? <Link className="rd-link" href="/users/assets" prefetch={false}>余额与资产调整</Link> : undefined}>
        {breakCount > 0
          ? `发现 ${breakCount} 处余额对不上，请到对应业务单核查`
          : nothingToCheck ? "这段时间没有账单，没有可核对的余额"
            : walletChecked ? "余额都对得上，且最终余额与钱包一致" : "这段时间的账单余额都对得上"}
      </Conclusion>
    </div>
  );
  const diffDigits = running?.reconciliation ? digitsOf([running.reconciliation.USDT, running.reconciliation.UVT]) : 2;
  const changeDigits = userData ? digitsOf([userData.ledger.totals.USDT ?? 0, userData.ledger.totals.UVT ?? 0]) : 2;
  const PERIOD_EXPLAIN = "这段时间里全部账单的合计，入账加、出账减，处理中的也算。这次没和钱包比（设了开始时间，或结束时间早于现在），所以这里不写钱包差额。";
  const userPane = <>
    <FilterBar onSubmit={openUser} action={<Button type="submit" disabled={userLoading}>加载账户</Button>}
      result={userDraftChanged ? "条件未应用" : undefined} notice={userRefused}>
      <FilterField grow><Input aria-label="按用户查账单的用户编码或系统编号" placeholder="输入用户编码或系统编号，比如 U00000005 或 5" value={userInput} onChange={(event) => setUserInput(event.target.value)} /></FilterField>
      <div className="rd-filter-line">
        <label className="rd-note" htmlFor="d4-user-from">开始时间（北京时间）</label>
        <Input id="d4-user-from" aria-label="开始时间" type="datetime-local" value={timeDraft.from} onChange={(event) => setFrom(event.target.value)} />
        <label className="rd-note" htmlFor="d4-user-to">结束时间（不含）</label>
        <Input id="d4-user-to" aria-label="结束时间" type="datetime-local" value={timeDraft.to} onChange={(event) => setTo(event.target.value)} />
        <Explain label="时间范围的说明" content={TIME_EXPLAIN} />
      </div>
    </FilterBar>
    {!selectedUserId ? <BlockState state="empty" title="输入用户编码或系统编号，查看这个用户的账单和余额核对。" />
      : userError ? (
        <div data-proof="d4-fail-closed">
          <BlockState state="error" title="用户账单已停止展示旧数据" detail={userError} onRetry={() => setUserReload((value) => value + 1)} />
        </div>
      )
        : !userData || !running ? <>
          <Conclusion state="unknown">正在读取…</Conclusion>
          <Panel flush icon={Scale} tone="role-1" title="余额核对">
            <Table label="余额核对" aria-busy><tbody><TableLoading columns={5} rows={5} /></tbody></Table>
          </Panel>
        </> : <>
          {userConclusion}
          <StatBand label="用户余额">
            <Stat tone="role-1" icon={Wallet} label="USDT 当前余额" value={amountText(userData.ledger.balance.USDT)} unit={unit("USDT")} explain="当前余额取自用户钱包，不随时间范围变。" />
            <Stat tone="role-1" icon={Coins} label="UVT 当前余额" value={amountText(userData.ledger.balance.UVT)} unit={unit("UVT")} explain="当前余额取自用户钱包，不随时间范围变。" />
            {walletChecked && running.reconciliation ? <>
              <Stat tone={running.reconciliation.USDT === 0 ? undefined : "danger"} icon={Scale} label="USDT 钱包差额" value={signedDiff(running.reconciliation.USDT, diffDigits)} unit={unit("USDT")} explain="用户钱包余额减最后一笔已结算账单的余额，0 表示一致。" />
              <Stat tone={running.reconciliation.UVT === 0 ? undefined : "danger"} icon={Scale} label="UVT 钱包差额" value={signedDiff(running.reconciliation.UVT, diffDigits)} unit={unit("UVT")} explain="用户钱包余额减最后一笔已结算账单的余额，0 表示一致。" />
            </> : <>
              {/* 不和钱包比时没有差额（决定 09、D4-V13），换成这段时间的净变动，不写 0 差额。 */}
              <Stat tone="role-2" icon={ArrowLeftRight} label="这段时间 USDT 变动" value={signedDiff(userData.ledger.totals.USDT ?? 0, changeDigits)} unit={unit("USDT")} explain={PERIOD_EXPLAIN} />
              <Stat tone="role-2" icon={ArrowLeftRight} label="这段时间 UVT 变动" value={signedDiff(userData.ledger.totals.UVT ?? 0, changeDigits)} unit={unit("UVT")} explain={PERIOD_EXPLAIN} />
            </>}
          </StatBand>
          <Panel flush icon={Scale} tone="role-1" title="余额核对" sub={`${userLabel(userData.ledger)} · 共 ${running.total} 笔 · 最新在前`}
            actions={rowBreaks > 0 ? <Check label={`只看对不上的（${rowBreaks} 笔）`} checked={onlyBreaks} onChange={(event) => { setOnlyBreaks(event.target.checked); setUserPage(1); }} /> : undefined}>
            <Table label="余额核对" data-tight="">
              <thead><tr>
                <Th>账单</Th>
                <Th align="right" icon={Coins} tone="money">金额</Th>
                <Th align="right">变动后余额</Th>
                <Th>核对结果</Th>
                <Th>时间（{businessZone().label}）</Th>
              </tr></thead>
              <tbody>
                {pageChecks.length === 0
                  ? <TableMessage columns={5} role="status">{userData.from || userData.to ? "这段时间该用户没有账单。" : "该用户暂无账单。"}</TableMessage>
                  : pageChecks.map((row) => (
                    <Tr key={row.bill.id} selected={detail?.tab === "user" && detail.id === row.bill.id} mark={row.breakDetected ? "danger" : undefined} onOpen={() => openDetail("user", row.bill.id)}>
                      <Td><Cell title={row.bill.bizNo} main={<span data-mono>{row.bill.bizNo}</span>} sub={`${BILL_TYPE_LABELS[row.bill.billType]} · ${formatD4Subtype(row.bill.subtype)}`} /></Td>
                      <Td align="right"><Cell num main={`${signed(row.bill, checkAmountDigits)} ${unit(row.bill.asset)}`} /></Td>
                      <Td align="right"><Cell num main={`${amountText(row.bill.balanceAfter, checkBalanceDigits)} ${unit(row.bill.asset)}`}
                        sub={row.breakDetected && row.expectedBalanceAfter !== null ? `期望 ${amountText(row.expectedBalanceAfter, checkBalanceDigits)}` : undefined} /></Td>
                      <Td>{row.breakDetected
                        ? <StatusTag tone="danger">断点 差 {signedDiff(row.difference)}</StatusTag>
                        : row.settlementBucket === "UNSETTLED"
                          ? <StatusTag tone="done">未结算 · 不参与钱包核对</StatusTag>
                          : <StatusTag tone="neutral" icon={CheckCircle2}>连续</StatusTag>}</Td>
                      <Td><Cell num main={listTime(row.bill.createdAt)} /></Td>
                    </Tr>
                  ))}
              </tbody>
            </Table>
            {shownChecks.length > 0 && (
              <Pager label="余额核对" total={shownChecks.length} page={Math.min(userPage, userPages)} pageSize={userPageSize} sizes={PAGE_SIZES}
                onPage={setUserPage} onPageSize={(size) => { setUserPageSize(size); setUserPage(1); }} />
            )}
          </Panel>
          <Fold title="分类合计" icon={Layers} summary={categories.length ? `${categories.length} 类有变动` : "这段时间没有变动"} explain="按时间范围内的账单合计，入账加、出账减。">
            {categories.length > 0 ? <>
              <Table label="分类合计">
                <thead><tr><Th>类型</Th><Th align="right">USDT</Th><Th align="right">UVT</Th></tr></thead>
                <tbody>
                  {categories.map((row) => (
                    <Tr key={row.key}>
                      <Td>{row.label}</Td>
                      <Td align="right"><Cell num main={signedDiff(row.usdt)} /></Td>
                      <Td align="right"><Cell num main={signedDiff(row.uvt)} /></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
              {categories.length < BILL_TYPES.length - 1 && <p className="rd-note">其余类型为 0</p>}
            </> : <p className="rd-note">八类账单的合计都是 0。</p>}
          </Fold>
        </>}
  </>;

  const links = [
    reach("/users/assets", "user_c3_read") && <Link key="assets" className="rd-link" href="/users/assets" prefetch={false}>余额与资产调整</Link>,
    reach("/finance/recon", "finance_d1_read") && <Link key="recon" className="rd-link" href="/finance/recon" prefetch={false}>充值对账</Link>,
    reach("/finance/withdrawals") && <Link key="withdrawals" className="rd-link" href="/finance/withdrawals" prefetch={false}>提现审核</Link>,
    reach("/finance/pool") && <Link key="pool" className="rd-link" href="/finance/pool" prefetch={false}>资金储备</Link>,
    reach("/platform/audit", "platform_a2_read") && <Link key="audit" className="rd-link" href="/platform/audit" prefetch={false}>操作记录</Link>,
    reach("/platform/events") && <Link key="events" className="rd-link" href="/platform/events" prefetch={false}>用户行为事件</Link>,
    reach("/analytics/export", "bi_l5_read") && <Link key="export" className="rd-link" href="/analytics/export" prefetch={false}>数据导出</Link>,
  ].filter(Boolean);

  return <>
    {header}
    {canGlobalRead ? <>
      <PageTabs ids={tabIds} label="账本内容" value={tab} onChange={setView}
        items={[{ value: "all", label: "全平台账单" }, { value: "user", label: "按用户查账单" }]} />
      <div {...tabIds.panel(tab)} className="rd-tab-pane">{tab === "all" ? globalPane : userPane}</div>
    </> : userPane}
    {links.length > 0 && (
      <nav className="rd-links" aria-label="相关页面">
        <span>相关页面</span>
        {links}
      </nav>
    )}

    <Drawer open={Boolean(shown)} onClose={() => setDetail(null)} title="账单详情" icon={Receipt} tone="role-2"
      sub={shown && <>
        <span data-mono>{shown.bill.bizNo}</span>
        <IconButton aria-label="复制账单号" data-size="sm" onClick={() => copyBizNo(shown.bill.bizNo)}><Copy size={13} aria-hidden /></IconButton>
        <StatusTag tone={billStatus(shown.bill.status).tone}>{billStatus(shown.bill.status).label}</StatusTag>
      </>}
      nav={{
        hasPrev: drawerIndex > 0,
        hasNext: drawerIndex >= 0 && drawerIndex < drawerRows.length - 1,
        onPrev: () => { if (drawerIndex > 0) openDetail(tab, drawerRows[drawerIndex - 1].bill.id); },
        onNext: () => { if (drawerIndex < drawerRows.length - 1) openDetail(tab, drawerRows[drawerIndex + 1].bill.id); },
      }}
      footer={shown && detail?.tab === "all" ? <Decision primary={<Button variant="primary" onClick={() => viewAccount(shown.bill)}>查看账户</Button>} /> : undefined}>
      {shown && <>
        <JudgmentPoints title={`判断要点 · 时间为${businessZone().label}`} rows={judgment(shown)} />
        <Facts>
          <Fact k="类型">{BILL_TYPE_LABELS[shown.bill.billType]}</Fact>
          <Fact k="明细">{formatD4Subtype(shown.bill.subtype)}</Fact>
          <Fact k="备注">{formatD4Remark(shown.bill.remark).label}</Fact>
        </Facts>
        <Fold inset title="技术详情" summary={`账单记录号 ${shown.bill.id}`}>
          <Facts>
            <Fact k="原始备注">{shown.bill.remark ? <span data-mono>{shown.bill.remark}</span> : "—"}</Fact>
            <Fact k="业务类型原值"><span data-mono>{shown.bill.bizType}</span></Fact>
            <Fact k="方向"><span data-mono>{shown.bill.direction}</span></Fact>
            <Fact k="账单记录号"><span data-mono>{shown.bill.id}</span></Fact>
            <Fact k="更新时间">{`${formatBusinessTimeFull(shown.bill.updatedAt, "—")}（${businessZone().label}）`}</Fact>
          </Facts>
        </Fold>
      </>}
    </Drawer>
  </>;
}
