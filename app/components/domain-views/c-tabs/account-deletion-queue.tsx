"use client";

/**
 * C2「注销申请」页签。列表、状态筛选、详情抽屉在这里；理由在确认框里填（OP-24），命令由页面统一发，
 * 结果未知时转成页面上方的待确认条（OP-91～OP-96）。读写只认后端的精确码：读 user_c1_read，写 user_c1_write，角色不绕过。
 * 会话变化清列表和详情，晚到的响应不覆盖新的（代次判断原样）。
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Copy, FileText } from "lucide-react";
import {
  BlockState, Button, Cell, Change, Decision, Drawer, Explain, Fact, Facts, IconButton, IrreversibleTag, JudgmentPoints, KeepText, Notice, Panel,
  Select, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr, type JudgmentRow, type StateTone,
} from "@/app/components/rd";
import {
  ACCOUNT_DELETION_STATUSES,
  AccountDeletionRequestError,
  fetchAccountDeletion,
  fetchAccountDeletions,
  type AccountDeletionRequest,
  type AccountDeletionStatus,
} from "@/lib/admin/account-deletion-client";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { displayAdminReadError } from "@/lib/admin/error-messages";
import { announcePermissionDenied } from "@/lib/admin/operation-confirm-error";
import { adminShellSessionKey } from "@/lib/admin/shell-authorities";
import { useAdminAuth } from "@/lib/store/admin-auth";
import {
  isCurrentAccountDeletionListRead,
  isCurrentAccountDeletionSelection,
  syncSelectedAccountDeletion,
} from "./account-deletion-queue-state";
import type { ActionConfirmReq, CCtx } from "./types";

export const DELETION_STATUS_LABELS: Record<string, string> = {
  REQUESTED: "待审核",
  IN_REVIEW: "审核中",
  BLOCKED: "已拒绝",
  COMPLETED: "已完成",
  CANCELLED: "已取消",
};
const STATUS_TONE: Record<string, StateTone> = { REQUESTED: "warn", IN_REVIEW: "progress", BLOCKED: "danger", COMPLETED: "done", CANCELLED: "done" };

export type DeletionAction = "review" | "block" | "complete" | "cancel";
const ACTION_LABELS: Record<DeletionAction, string> = { review: "开始审核", block: "拒绝申请", complete: "完成注销", cancel: "取消申请" };
export const deletionActionLabel = (action: DeletionAction, fromStatus?: string) => action === "review" && fromStatus === "BLOCKED" ? "重新审核" : ACTION_LABELS[action];

/** 被系统拦下的原因写中文，财务读不到写当时的事实；运营写的理由原样。 */
const BLOCK_REASONS: Record<string, string> = {
  UNSETTLED_FUNDS_OR_ORDERS: "可用 USDT、可用 NEX、提现冻结金额任一大于 0，或有未结束的提现、充值、兑换、质押、设备订单",
  UNSETTLED_STATE_UNAVAILABLE: "当时读不到财务状态，没有注销",
  USER_REQUESTED_CANCEL: "用户主动取消申请",
};
/** 系统拦下的两个原因码；列表里加「系统拦下：」，分得清是系统拦的还是运营拒的。 */
const SYSTEM_BLOCKS = ["UNSETTLED_FUNDS_OR_ORDERS", "UNSETTLED_STATE_UNAVAILABLE"];
const PAGE_SIZE = 20;
const LOCKED = "这张申请有结果未确认的操作，先到页面上方核对";
const SUBMITTING = "正在提交，稍候";
/** 状态已被别人或系统改了：框不关，读回写最新状态（D2-C89）。 */
const MOVED_CODES = ["ACCOUNT_DELETION_VERSION_CONFLICT", "ACCOUNT_DELETION_INVALID_STATE_TRANSITION", "ACCOUNT_DELETION_CONCURRENT_UPDATE"];

type DetailRead = { status: "loading" | "ready" | "error" | "stale"; sessionKey: string } | null;

function currentSessionKey() {
  const { session, authEpoch } = useAdminAuth.getState();
  return `${adminShellSessionKey(session, authEpoch)}|${session?.role ?? ""}`;
}

export function reasonText(value: string | null | undefined) {
  const raw = (value ?? "").trim();
  return raw ? BLOCK_REASONS[raw] ?? raw : "—";
}

/** 最近理由：已拒绝时写拦下原因，其他写这一次流转的理由。 */
function latestReason(row: AccountDeletionRequest) {
  if (row.status !== "BLOCKED") return reasonText(row.reason);
  const raw = (row.blockReason || row.reason || "").trim();
  return SYSTEM_BLOCKS.includes(raw) ? `系统拦下：${reasonText(raw)}` : reasonText(raw);
}

function statusLabel(status: string) {
  return DELETION_STATUS_LABELS[status] ?? "状态未知";
}

function availableActions(status: string): DeletionAction[] {
  if (status === "REQUESTED") return ["review", "block", "cancel"];
  if (status === "IN_REVIEW") return ["block", "complete", "cancel"];
  if (status === "BLOCKED") return ["review", "cancel"];
  return [];
}

/** 长单号中间省略，留前缀和末 6 位（TX-28），全文在悬停和抽屉里。 */
function shortNo(no: string) {
  const match = /^([A-Z]+-)(.+)$/.exec(no);
  return match && match[2].length > 8 ? `${match[1]}…${match[2].slice(-6)}` : no;
}

const TARGET: Record<DeletionAction, string> = { review: "IN_REVIEW", block: "BLOCKED", complete: "COMPLETED", cancel: "CANCELLED" };

/** 动作做完后的提示：完成注销按返回的最终状态说话，被拦下不算成功（OP-90）。 */
export function deletionResultToast(action: DeletionAction, row: AccountDeletionRequest, fromStatus?: string): [string, "success" | "warn"] {
  // 原因只写在抽屉的「拦下原因」一处，提示只说结果（DT-12）。
  if (action === "complete" && row.status === "BLOCKED") return ["系统没有注销，申请已改成已拒绝。原因见「拦下原因」。", "warn"];
  if (action === "complete") return [`${row.requestNo} 已完成注销`, "success"];
  if (action === "review") return [`${row.requestNo} 已${deletionActionLabel(action, fromStatus)}`, "success"];
  if (action === "block") return [`${row.requestNo} 已拒绝`, "success"];
  return [`${row.requestNo} 已取消`, "success"];
}

export type DeletionSend = (
  requestNo: string, userId: number, action: DeletionAction, version: number, fromStatus: string, reason: string, operator: string,
  onDone?: (row: AccountDeletionRequest) => unknown,
) => Promise<"done" | "unknown">;

export function AccountDeletionQueue({ ctx, canWrite, status, onStatus, refreshKey, focusKey, onChanged, canReadUserDetail, canReadAssetAdjustments, locked, submitting, send }: {
  ctx: CCtx;
  canWrite: boolean;
  status: AccountDeletionStatus | "";
  onStatus: (status: AccountDeletionStatus | "") => void;
  /** 页头「刷新」和待确认重试后加一，重读列表和打开的详情。 */
  refreshKey: number;
  /** 结论句「去处理」后加一，焦点放到面板标题上。 */
  focusKey: number;
  onChanged: () => void;
  canReadUserDetail: boolean;
  canReadAssetAdjustments: boolean;
  locked: (requestNo: string) => boolean;
  submitting: boolean;
  send: DeletionSend;
}) {
  const { toast, openActionConfirm } = ctx;
  const session = useAdminAuth((state) => state.session);
  const authEpoch = useAdminAuth((state) => state.authEpoch);
  const sessionKey = `${adminShellSessionKey(session, authEpoch)}|${session?.role ?? ""}`;
  const zone = businessZone().label;
  const [rows, setRows] = useState<AccountDeletionRequest[]>([]);
  const [selected, setSelected] = useState<AccountDeletionRequest | null>(null);
  const [detailRead, setDetailRead] = useState<DetailRead>(null);
  const [blockedNote, setBlockedNote] = useState<{ requestNo: string; text: string } | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedRef = useRef<AccountDeletionRequest | null>(null);
  const detailReadRef = useRef<DetailRead>(null);
  const detailGenerationRef = useRef(0);
  const listGenerationRef = useRef(0);
  const loadingListGenerationRef = useRef(0);
  const listLoadingRef = useRef(false);
  const titleRef = useRef<HTMLSpanElement>(null);

  const publishDetailRead = (next: DetailRead) => {
    detailReadRef.current = next;
    setDetailRead(next);
  };

  useEffect(() => {
    listGenerationRef.current += 1;
    detailGenerationRef.current += 1;
    selectedRef.current = null;
    listLoadingRef.current = false;
    setSelected(null);
    publishDetailRead(null);
    setRows([]);
    setTotal(null);
    setError(null);
    setLoading(false);
    return () => {
      listGenerationRef.current += 1;
      detailGenerationRef.current += 1;
      selectedRef.current = null;
      detailReadRef.current = null;
      listLoadingRef.current = false;
    };
  }, [sessionKey]);

  const refresh = useCallback(async (quiet = false) => {
    if (sessionKey !== currentSessionKey()) return;
    const generation = listGenerationRef.current + 1;
    listGenerationRef.current = generation;
    if (!quiet) {
      listLoadingRef.current = true;
      loadingListGenerationRef.current = generation;
      setLoading(true);
    } else if (listLoadingRef.current) {
      // A quiet mutation read can supersede an in-flight visible list read.
      loadingListGenerationRef.current = generation;
    }
    setError(null);
    try {
      const result = await fetchAccountDeletions(status, page, PAGE_SIZE);
      if (sessionKey !== currentSessionKey() || !isCurrentAccountDeletionListRead(listGenerationRef.current, generation)) return;
      setRows(result.records);
      setTotal(result.total);
      const current = selectedRef.current;
      const next = syncSelectedAccountDeletion(current, result.records);
      if (next !== current) {
        detailGenerationRef.current += 1;
        selectedRef.current = next;
        setSelected((active) => active?.requestNo === current?.requestNo ? next : active);
        publishDetailRead({ status: "stale", sessionKey });
      }
    } catch (cause) {
      if (sessionKey === currentSessionKey() && isCurrentAccountDeletionListRead(listGenerationRef.current, generation)) setError(displayAdminReadError(cause));
    } finally {
      if (sessionKey === currentSessionKey() && listLoadingRef.current && loadingListGenerationRef.current === generation) {
        listLoadingRef.current = false;
        setLoading(false);
      }
    }
  }, [page, status, sessionKey]);

  useEffect(() => { void refresh(); }, [refresh]);

  const openDetail = useCallback(async (row: AccountDeletionRequest) => {
    if (sessionKey !== currentSessionKey()) return;
    const generation = detailGenerationRef.current + 1;
    detailGenerationRef.current = generation;
    selectedRef.current = row;
    setSelected(row);
    publishDetailRead({ status: "loading", sessionKey });
    try {
      const detail = await fetchAccountDeletion(row.requestNo);
      if (sessionKey !== currentSessionKey() || !isCurrentAccountDeletionSelection(selectedRef.current?.requestNo ?? null, row.requestNo, detailGenerationRef.current, generation)) return null;
      if (detail.requestNo !== row.requestNo || detail.userId !== row.userId) throw new Error("ACCOUNT_DELETION_DETAIL_MISMATCH");
      if (detail.version < row.version) {
        publishDetailRead({ status: "stale", sessionKey });
        return null;
      }
      selectedRef.current = detail;
      setSelected(detail);
      publishDetailRead({ status: "ready", sessionKey });
      return detail;
    } catch {
      if (sessionKey === currentSessionKey() && isCurrentAccountDeletionSelection(selectedRef.current?.requestNo ?? null, row.requestNo, detailGenerationRef.current, generation)) {
        publishDetailRead({ status: "error", sessionKey });
      }
      return null;
    }
  }, [sessionKey]);

  // 页头刷新、待确认重试后：重读列表和打开的详情；不动筛选和页码（ST-50）。
  const firstRefresh = useRef(true);
  useEffect(() => {
    if (firstRefresh.current) { firstRefresh.current = false; return; }
    void refresh();
    if (selectedRef.current) void openDetail(selectedRef.current);
    // 只跟 refreshKey 走。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  useEffect(() => {
    if (focusKey) titleRef.current?.focus({ preventScroll: false });
  }, [focusKey]);

  const closeDetail = () => {
    detailGenerationRef.current += 1;
    selectedRef.current = null;
    setSelected(null);
    publishDetailRead(null);
  };

  const changeStatus = (next: AccountDeletionStatus | "") => {
    onStatus(next);
    setPage(1);
  };

  /* ── 确认框：理由在框里填，8–200 字（OP-20、OP-24；后端 1–255 不动） ── */
  const request = (row: AccountDeletionRequest, action: DeletionAction, blockedReason?: ReactNode): ActionConfirmReq => {
    const label = deletionActionLabel(action, row.status);
    const reviewingAgain = action === "review" && row.status === "BLOCKED";
    const previousReason = (row.blockReason || row.reason || "").trim();
    const facts = (
      <Facts>
        <Fact k="申请号"><span data-mono>{row.requestNo}</span></Fact>
        <Fact k="系统编号">{String(row.userId)}</Fact>
        <Fact k="状态"><Change from={statusLabel(row.status)} to={statusLabel(TARGET[action])} /></Fact>
        {reviewingAgain && <Fact k={SYSTEM_BLOCKS.includes(previousReason) ? "原拦下原因" : "原拒绝理由"}><KeepText text={reasonText(previousReason)} phrases={["提现冻结金额", "设备订单", "提现、", "充值、", "兑换、", "质押、"]} /></Fact>}
        {action === "block" && <Fact k="理由会显示给用户" tone="warn">App「我的 › 安全设置」写「注销受阻：{"{理由}"}」</Fact>}
        {action === "complete" && <Fact k="系统先查" tone="warn">可用 USDT、可用 NEX、提现冻结金额任一大于 0，或有未结束的提现、充值、兑换、质押、设备订单，就不注销，改成已拒绝</Fact>}
      </Facts>
    );
    const impact = {
      review: reviewingAgain ? "改回审核中，可以再完成注销或拒绝。" : "改成审核中，用户在 App 还能取消。",
      block: "改成已拒绝，账号不注销；用户能看到这次的理由。",
      complete: "通过检查后账号立即注销、全部设备下线，个人信息匿名化。",
      cancel: "申请结束，账号不注销；用户可以再提交。",
    }[action];
    return {
      briefKind: "security",
      action: `${label} · ${row.requestNo}`,
      title: { review: label, block: "拒绝注销申请", complete: "完成注销", cancel: "取消注销申请" }[action],
      effect: action === "complete" ? <><StatusTag tone="progress" filled>立即生效</StatusTag><IrreversibleTag /></> : <StatusTag tone="progress" filled>立即生效</StatusTag>,
      facts,
      detail: impact,
      amplifies: false,
      statedBrief: { impact, check: "核对申请号和用户，理由写清依据或工单号。" },
      confirmLabel: { review: `确认${label}`, block: "确认拒绝", complete: "确认完成注销", cancel: "确认取消" }[action],
      confirmTone: action === "complete" ? "danger" : undefined,
      reasonMin: 8,
      reasonMax: 200,
      reasonPlaceholder: action === "block" ? "例如：账户还有未结清的提现，请先处理完" : "例如：工单 20261108-008，已核对资金和订单",
      blockedReason,
      run: async (reason) => {
        try {
          await send(row.requestNo, row.userId, action, row.version, row.status, reason, currentAdminOperator(), async (next) => {
            const [message, kind] = deletionResultToast(action, next, row.status);
            toast(message, kind);
            setBlockedNote(action === "complete" && next.status === "BLOCKED" ? { requestNo: next.requestNo, text: message } : null);
            if (selectedRef.current?.requestNo === next.requestNo) {
              selectedRef.current = next;
              setSelected(next);
              publishDetailRead({ status: "ready", sessionKey });
            }
            onChanged();
            await refresh(true);
          });
        } catch (cause) {
          if (cause instanceof AccountDeletionRequestError && cause.status === 403 && ["无权限访问", "ADMIN_PERMISSION_DENIED", "ACCESS_DENIED"].includes(cause.reasonCode ?? "")) {
            announcePermissionDenied();
            return;
          }
          if (cause instanceof AccountDeletionRequestError && MOVED_CODES.includes(cause.reasonCode ?? "")) {
            const fresh = await openDetail(row);
            if (fresh && (fresh.status !== row.status || fresh.version !== row.version)) {
              openActionConfirm(request(fresh, action, `这个申请现在是「${statusLabel(fresh.status)}」，这次${label}没有执行。关闭后按最新状态处理。`));
            }
            onChanged();
            void refresh(true);
          }
          throw cause;
        }
      },
    };
  };

  /* ── 渲染 ── */
  const detailReady = detailRead?.status === "ready" && detailRead.sessionKey === sessionKey;
  const index = selected ? rows.findIndex((row) => row.requestNo === selected.requestNo) : -1;
  const prevRow = index > 0 ? rows[index - 1] : undefined;
  const nextRow = index >= 0 ? rows[index + 1] : undefined;
  const lastPage = total === null ? rows.length < PAGE_SIZE : page * PAGE_SIZE >= total;
  const actions = selected && canWrite && detailReady ? availableActions(selected.status) : [];
  const actionBlock = selected && locked(selected.requestNo) ? LOCKED : submitting ? SUBMITTING : undefined;
  const copyNo = (value: string) => {
    void navigator.clipboard?.writeText(value).then(() => toast("已复制申请号", "success"), () => toast("复制失败，请手动选择申请号", "error"));
  };

  const blockedRaw = selected?.status === "BLOCKED" ? (selected.blockReason || selected.reason || "").trim() : "";
  // 已拒绝时标题旁已有标签，状态行不再写一遍；被系统拦下是正常的业务结果，不用红（VS-107），原因只写这一处。
  const judgment: JudgmentRow[] = !selected ? [] : [
    ...(selected.status === "BLOCKED" ? [] : [{ label: "状态", value: statusLabel(selected.status), state: STATUS_TONE[selected.status] === "warn" || STATUS_TONE[selected.status] === "progress" ? STATUS_TONE[selected.status] : undefined }]),
    { label: "用户", value: <>系统编号 {selected.userId}{canReadUserDetail && <> · <Link className="rd-link" href={`/users/search/${selected.userId}`} prefetch={false}>到用户详情</Link></>}</>,
      reason: selected.status === "IN_REVIEW" || selected.status === "REQUESTED" ? "完成注销前到用户详情核对资金和订单" : undefined },
    { label: "申请时间", value: formatBusinessTimeCompact(selected.requestedAt, "—") },
    ...(selected.status === "BLOCKED" ? [{ label: SYSTEM_BLOCKS.includes(blockedRaw) ? "拦下原因" : "拒绝理由", value: <><span className="rd-point-mark" data-tone="warn"><AlertTriangle size={14} aria-hidden /></span>{reasonText(blockedRaw)}{blockedRaw === "UNSETTLED_FUNDS_OR_ORDERS" && <> <Explain label="零头余额的处理方法" content={<>低于最低提现额或最低兑换量的零头余额，用户联系客服后由财务在「{canReadAssetAdjustments
        ? <a className="rd-link" href={`/users/assets?userId=${selected.userId}&returnTo=${encodeURIComponent(`/users/actions?tab=deletions${status ? `&deletionStatus=${status}` : ""}`)}`}>余额与资产调整</a>
        : "余额与资产调整"}<KeepText text="」写理由，经审批清零，之后运营点「重新审核」再「完成注销」。" phrases={["「重新审核」", "「完成注销」。"]} /></>} /></>}</>,
      reason: <KeepText text={blockedRaw === "UNSETTLED_FUNDS_OR_ORDERS"
        ? "用户结清后，点「重新审核」再「完成注销」；用户也可以在 App 取消申请。"
        : blockedRaw === "UNSETTLED_STATE_UNAVAILABLE"
          ? "财务状态恢复且已结清后，点「重新审核」再「完成注销」；用户也可以在 App 取消申请。"
          : "核对拒绝理由后，可以重新审核或取消申请；用户也可以在 App 取消。"} /> }] : []),
    ...(selected.status === "IN_REVIEW" ? [{ label: "完成后会怎样", value: "账号注销并立即下线，个人信息匿名化。" }] : []),
  ];

  const footer = actions.length > 0 && selected && (
    <Decision note={actionBlock === LOCKED ? LOCKED : undefined}
      danger={actions.includes("block") ? <Button variant="danger-outline" disabledReason={actionBlock} onClick={() => openActionConfirm(request(selected, "block"))}>拒绝申请</Button> : undefined}
      others={actions.includes("cancel") ? <Button disabledReason={actionBlock} onClick={() => openActionConfirm(request(selected, "cancel"))}>取消申请</Button> : undefined}
      primary={actions.includes("review")
        ? <Button variant="primary" disabledReason={actionBlock} onClick={() => openActionConfirm(request(selected, "review"))}>{deletionActionLabel("review", selected.status)}</Button>
        : actions.includes("complete") ? <Button variant="primary" disabledReason={actionBlock} onClick={() => openActionConfirm(request(selected, "complete"))}>完成注销</Button> : undefined} />
  );

  return (
    <Panel data-testid="account-deletion-queue" title={<span ref={titleRef} tabIndex={-1} data-section-focus="">注销申请</span>} explainLabel="注销申请" icon={FileText} tone="role-3" flush
      sub={`时间为${zone}`}
      explain="用户在 App 里申请注销后，在这里审核处理。"
      actions={<Select aria-label="注销申请状态筛选" value={status} onChange={(value) => changeStatus(value as AccountDeletionStatus | "")}
        options={[{ value: "", label: "全部状态" }, ...ACCOUNT_DELETION_STATUSES.map((value) => ({ value, label: DELETION_STATUS_LABELS[value] }))]} />}>
      <Table label="注销申请">
        <thead><tr>
          <Th>申请 · 申请时间</Th>
          <Th>用户</Th>
          <Th>状态</Th>
          <Th>最近理由 <Explain label="最近理由的说明" content="每次审核、拒绝或取消都会换成那一次填的理由；被系统拦下的写拦下原因。" /></Th>
        </tr></thead>
        <tbody>
          {loading && rows.length === 0 && !error ? <TableLoading columns={4} rows={4} />
            : error ? <TableMessage columns={4} role="alert">注销申请读取失败，不显示旧数据：{error} <Button size="sm" onClick={() => void refresh()}>重试</Button></TableMessage>
              : rows.length === 0 ? <TableMessage columns={4}>暂无申请。{status === "" && <><br /><span className="rd-weak">用户在 App 提交注销后出现在这里。</span></>}</TableMessage>
                : rows.map((row) => (
                  <Tr key={row.requestNo} selected={selected?.requestNo === row.requestNo} aria-label={`查看注销申请 ${row.requestNo}`} onOpen={() => void openDetail(row)}>
                    <Td><Cell main={<span data-mono>{shortNo(row.requestNo)}</span>} sub={formatBusinessTimeCompact(row.requestedAt, "—")} title={row.requestNo} /></Td>
                    <Td><Cell main={canReadUserDetail ? <Link className="rd-link" href={`/users/search/${row.userId}`} prefetch={false}>系统编号 {row.userId}</Link> : `系统编号 ${row.userId}`} /></Td>
                    <Td><StatusTag tone={STATUS_TONE[row.status] ?? "done"}>{statusLabel(row.status)}</StatusTag></Td>
                    <Td grow><Cell main={latestReason(row)} title={latestReason(row)} /></Td>
                  </Tr>
                ))}
        </tbody>
      </Table>
      {!error && (rows.length > 0 || page > 1) && (
        <div className="rd-pager" data-list-pager="" data-list-label="注销申请">
          <span className="rd-pager-range">第 {page} 页 · {total === null ? "共 — 条" : `共 ${total} 条`}</span>
          <div className="rd-pager-tools">
            <Button size="sm" aria-label="注销申请 上一页" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>上一页</Button>
            <Button size="sm" aria-label="注销申请 下一页" disabled={lastPage || loading} onClick={() => setPage(page + 1)}>下一页</Button>
          </div>
        </div>
      )}

      <Drawer open={Boolean(selected) && detailRead?.sessionKey === sessionKey} onClose={closeDetail} title="注销申请详情" icon={FileText} tone="role-3" busy={submitting}
        sub={selected && <><span data-mono>{selected.requestNo}</span> <IconButton aria-label="复制申请号" data-size="sm" onClick={() => copyNo(selected.requestNo)}><Copy size={13} aria-hidden /></IconButton>
          <StatusTag tone={STATUS_TONE[selected.status] ?? "done"}>{statusLabel(selected.status)}</StatusTag></>}
        nav={{ hasPrev: Boolean(prevRow), hasNext: Boolean(nextRow), onPrev: () => { if (prevRow) void openDetail(prevRow); }, onNext: () => { if (nextRow) void openDetail(nextRow); } }}
        footer={footer}>
        {selected && <div className="rd-stack">
          {detailRead?.status === "error" && <BlockState compact state="error" title="详情加载失败，请重试。" onRetry={() => void openDetail(selected)} />}
          {detailRead?.status === "stale" && <Notice tone="warn" action={<Button size="sm" onClick={() => void openDetail(selected)}>刷新</Button>}>申请状态已变化，请刷新后再审核。</Notice>}
          {blockedNote?.requestNo === selected.requestNo && selected.status === "BLOCKED" && <Notice tone="warn">{blockedNote.text}</Notice>}
          <JudgmentPoints title={`判断要点 · 时间为${zone}`} loading={detailRead?.status === "loading"} rows={judgment} />
          {/* 判断要点和处理记录之间用小标题分开，字段名同一条左边线（对齐）。 */}
          {detailReady && <Panel plain headingLevel={3} title="处理记录">
            <Facts>
              <Fact k="审核时间">{formatBusinessTimeCompact(selected.reviewedAt, "—")}</Fact>
              <Fact k="完成时间">{formatBusinessTimeCompact(selected.completedAt, "—")}</Fact>
              {/* 已拒绝时理由就是上面那一行，同一句不写两次（DP-61）。 */}
              {!(selected.status === "BLOCKED" && blockedRaw === (selected.reason ?? "").trim()) && <Fact k="原因">{reasonText(selected.reason)}</Fact>}
            </Facts>
          </Panel>}
        </div>}
      </Drawer>
    </Panel>
  );
}
