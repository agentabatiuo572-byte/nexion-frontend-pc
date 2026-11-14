"use client";

/**
 * A9 开发者访问审批（改版）。外部开发者在 App 提交申请，运营在这里看队列、点开看申请人和用途，
 * 对待审批的批准或驳回，对已批准的撤销访问。三个动作都直接执行，不走 A2 审批单。
 * 读取、提交、命令号保存和恢复的逻辑沿用旧页面（load、submitReview、review、developerAccessAttempts），
 * 这次只换界面：确认框、抽屉、结果未知的逐条提醒。请求内容和旧页面逐字节相同。
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Ban, Building2, CheckCircle2, CircleHelp, Clock3, Copy, FlaskConical, Hourglass, Inbox, KeyRound, RefreshCw,
  Server, ShieldCheck, ShieldOff, TriangleAlert, User, XCircle, type LucideIcon,
} from "lucide-react";
import {
  Button, Cell, Conclusion, Decision, Drawer, Explain, Fact, Facts, Field, FilterBar, FilterField, IconButton, Input,
  IrreversibleTag, JudgmentPoints, Modal, MoreMenu, Notice, PageHeader, Pager, Panel, Segments, StatusTag, Table, TableLoading,
  TableMessage, Td, Textarea, Th, Timeline, Tr, type JudgmentRow, type StateTone, type TimelineEntry,
} from "@/app/components/rd";
import { useToast } from "../design-kit";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useReach } from "@/lib/nav/use-reach";
import { businessStamp, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import {
  approveDeveloperAccess,
  fetchDeveloperAccessRequests,
  rejectDeveloperAccess,
  revokeDeveloperAccess,
  isDeveloperAccessOutcomeUnknownError,
  type DeveloperAccessPage,
  type DeveloperAccessRequest,
} from "@/lib/admin/developer-access-client";
import { canReviewDeveloperAccess, developerAccessResourceGuard } from "@/lib/admin/developer-access-policy";
import { createPendingMutationStore, type SlotAttemptRecord } from "@/lib/admin/pending-mutation-store";

type ReviewAction = "approve" | "reject" | "revoke";
type DeveloperAccessAttempt = SlotAttemptRecord & { adminId?: number; reason?: string };
const reviewActionLabel: Record<ReviewAction, string> = { approve: "批准", reject: "驳回", revoke: "撤销" };

const developerAccessAttempts = createPendingMutationStore<DeveloperAccessAttempt>({
  storageKey: "nexion-admin-a9-developer-access-attempts-v1",
  isValidRecord: (record) => typeof record.inputFingerprint === "string"
    && (record.reason === undefined || (typeof record.reason === "string" && Number.isSafeInteger(record.adminId))),
});

/** Real server-backed developer access governance. Navigation ownership remains with the A-domain integrator. */
const developerStatusText = (value: string) => ({ PENDING: "待审批", APPROVED: "已批准", REJECTED: "已驳回", REVOKED: "已撤销", EXPIRED: "已过期" } as Record<string,string>)[value] ?? "未知状态";

type StatusFilter = "" | DeveloperAccessRequest["status"];
const STATUS_ORDER: readonly StatusFilter[] = ["PENDING", "APPROVED", "REJECTED", "REVOKED", "EXPIRED", ""];
const PAGE_SIZES = [10, 20, 50] as const;

const STATUS_LOOK: Record<string, { tone: StateTone; icon: LucideIcon; explain: string }> = {
  PENDING: { tone: "warn", icon: Clock3, explain: "等运营批准或驳回。批准前他没有开发者资格。" },
  APPROVED: { tone: "ok", icon: CheckCircle2, explain: "开发者资格有效，可以撤销。" },
  REJECTED: { tone: "done", icon: XCircle, explain: "这条申请已结束，没有给资格。申请人可以在 App 重新申请。" },
  REVOKED: { tone: "done", icon: Ban, explain: "资格已收回。申请人可以在 App 重新申请。" },
  EXPIRED: { tone: "done", icon: Hourglass, explain: "已结束，只能查看。后台没有设为过期的操作，也不会到期自动过期。" },
};
const UNKNOWN_LOOK = { tone: "neutral" as StateTone, icon: CircleHelp, explain: "后端返回了这页不认识的状态，不能操作。" };

/** 表格里不带解释（一行一个可点的词太吵），抽屉和确认框里带。 */
function StatusBadge({ status, quiet, bare }: { status: string; quiet?: boolean; bare?: boolean }) {
  const look = STATUS_LOOK[status] ?? UNKNOWN_LOOK;
  return <StatusTag tone={quiet ? "neutral" : look.tone} icon={look.icon} explain={bare ? undefined : look.explain}>{developerStatusText(status)}</StatusTag>;
}

const environmentText = (row: DeveloperAccessRequest) => row.sourceEnvironment === "SANDBOX" ? "测试环境" : "正式环境";
function EnvironmentTag({ row }: { row: DeveloperAccessRequest }) {
  const Icon = row.sourceEnvironment === "SANDBOX" ? FlaskConical : Server;
  return <span className="a9-env" data-env={row.sourceEnvironment === "SANDBOX" ? "sandbox" : "production"}><Icon size={13} aria-hidden />{environmentText(row)}</span>;
}
/** 环境加运行批次，写成一句：测试环境的批次是资格范围的一部分。 */
const scopeText = (row: DeveloperAccessRequest) => row.runId ? `${environmentText(row)} · 批次 ${row.runId}` : environmentText(row);

const timeText = (value?: string | null) => formatBusinessTimeCompact(value ?? "", "—");

/** 已等多久：从提交时间到现在。算不出（时间缺失或在将来）写「—」。 */
function waitedText(createdAt: string, now: number) {
  const at = Date.parse(createdAt);
  if (!Number.isFinite(at) || at > now) return "—";
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 60) return "不到 1 小时";
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} 小时` : `${Math.floor(hours / 24)} 天`;
}

type Outcome = { kind: "ok" } | { kind: "unknown" | "failed"; message: string } | { kind: "skipped" };
type ReviewDialogState = { row: DeveloperAccessRequest; action: ReviewAction; previous?: DeveloperAccessAttempt; mode: "new" | "legacy" | "recovery" };

export function A9DeveloperAccess() {
  const adminId = useAdminAuth((s) => s.session?.adminId);
  const authorities = useAdminAuth((s) => s.session?.authorities ?? []);
  const isSuper = authorities.includes("ROLE_SUPER_ADMIN");
  const reviewPermissions = {
    approve: isSuper || authorities.includes("developer_access_approve"),
    reject: isSuper || authorities.includes("developer_access_reject"),
    revoke: isSuper || authorities.includes("developer_access_revoke"),
  };
  const reach = useReach();
  const [, toast] = useToast();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [status, setStatus] = useState<StatusFilter>("PENDING");
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [data, setData] = useState<DeveloperAccessPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [readAt, setReadAt] = useState<number | null>(null);
  const [dialog, setDialog] = useState<ReviewDialogState | null>(null);
  const [dialogBusy, setDialogBusy] = useState(false);
  const [dialogFailure, setDialogFailure] = useState<string | null>(null);
  const [reasonDraft, setReasonDraft] = useState("");
  const [reasonTouched, setReasonTouched] = useState(false);
  const [currentNo, setCurrentNo] = useState<string | null>(null);
  const [, setAttemptsTick] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => { setKeyword(keywordInput.trim()); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [keywordInput]);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchDeveloperAccessRequests({ pageNum: page, pageSize, status: status || undefined, keyword })
      .then((result) => { if (!cancelled) { setData(result); setReadAt(Date.now()); } })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "开发者访问申请加载失败"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [page, pageSize, status, keyword, reloadKey]);

  useEffect(() => load(), [load]);

  const submitReview = async (row: DeveloperAccessRequest, action: ReviewAction, reason: string,
    previous?: DeveloperAccessAttempt): Promise<Outcome> => {
    if (!adminId || useAdminAuth.getState().session?.adminId !== adminId
      || !reviewPermissions[action] || !canReviewDeveloperAccess(row.status, action)) return { kind: "skipped" };
    const identity = `${action}:${row.requestNo}`;
    const key = previous?.commandKey ?? globalThis.crypto?.randomUUID?.() ?? `developer-access-${action}-${row.requestNo}`;
    if (!previous) developerAccessAttempts.forget(identity);
    if (!previous) {
      developerAccessAttempts.remember(identity, key, { inputFingerprint: `${identity}:${row.status}`, adminId, reason });
    }
    try {
      if (action === "approve") await approveDeveloperAccess(row, reason, key);
      if (action === "reject") await rejectDeveloperAccess(row, reason, key);
      if (action === "revoke") await revokeDeveloperAccess(row, reason, key);
      developerAccessAttempts.forget(identity, key);
      setError(null);
      setReloadKey((value) => value + 1);
      return { kind: "ok" };
    } catch (cause) {
      const unknown = isDeveloperAccessOutcomeUnknownError(cause);
      if (!unknown && (!previous || previous.reason !== undefined)) {
        developerAccessAttempts.forget(identity, key);
      }
      return { kind: unknown ? "unknown" : "failed", message: cause instanceof Error ? cause.message : "操作失败，结果未确认，请刷新后查看" };
    } finally {
      setAttemptsTick((value) => value + 1);
    }
  };

  const review = (row: DeveloperAccessRequest, action: ReviewAction) => {
    if (!adminId || !reviewPermissions[action] || !canReviewDeveloperAccess(row.status, action)) return;
    const identity = `${action}:${row.requestNo}`;
    const previous = developerAccessAttempts.list().find((record) => record.fingerprint === identity
      && record.inputFingerprint === `${identity}:${row.status}` && (record.adminId === undefined || record.adminId === adminId));
    setDialogFailure(null);
    setReasonDraft("");
    setReasonTouched(false);
    // 有原备注的原操作只能原样重试；旧版本存的记录没有原备注，要运营填上次的原备注。
    setDialog({ row, action, previous, mode: previous?.reason !== undefined ? "recovery" : previous ? "legacy" : "new" });
  };

  const records = data?.records ?? [];
  const now = Date.now();
  const zone = businessZone().label;
  const canWriteAny = reviewPermissions.approve || reviewPermissions.reject || reviewPermissions.revoke;
  const shown = currentNo ? records.find((row) => row.requestNo === currentNo) : undefined;
  const shownIndex = shown ? records.indexOf(shown) : -1;

  // 抽屉里的那条在新读到的列表里没有了（处理完不在这个状态里、翻页、筛选变了），就关上。
  useEffect(() => {
    if (currentNo && !loading && !records.some((row) => row.requestNo === currentNo)) setCurrentNo(null);
  }, [currentNo, loading, records]);

  const attempts = developerAccessAttempts.list().filter((record) => record.adminId === undefined || record.adminId === adminId);
  const attemptFor = (row: DeveloperAccessRequest) => attempts.find((record) => record.fingerprint.endsWith(`:${row.requestNo}`));

  const rowActions = (row: DeveloperAccessRequest) => {
    const guard = developerAccessResourceGuard(row.status);
    return {
      approve: guard.canApprove && reviewPermissions.approve,
      reject: guard.canReject && reviewPermissions.reject,
      revoke: guard.canRevoke && reviewPermissions.revoke,
    };
  };
  const staleReason = error ? "列表没读到，重新读到后才能处理" : undefined;

  const confirmDialog = async () => {
    if (!dialog) return;
    const reason = dialog.mode === "recovery" ? dialog.previous?.reason ?? "" : reasonDraft.trim();
    if (dialog.mode !== "recovery" && reason.length < 8) { setReasonTouched(true); return; }
    setDialogBusy(true);
    setDialogFailure(null);
    const { row, action } = dialog;
    const outcome = await submitReview(row, action, reason, dialog.previous);
    setDialogBusy(false);
    if (outcome.kind === "ok") {
      setDialog(null);
      const done = { approve: "已批准", reject: "已驳回", revoke: "已撤销访问" }[action];
      // 在抽屉里处理完，自动到这一页的下一条还能处理的申请。
      if (currentNo === row.requestNo) {
        const rest = records.slice(shownIndex + 1).concat(records.slice(0, Math.max(0, shownIndex)));
        const next = rest.find((item) => item.requestNo !== row.requestNo && item.status === "PENDING");
        if (next) setCurrentNo(next.requestNo);
        toast(next ? `${done} ${row.requestNo}，已切到下一条` : `${done} ${row.requestNo}`, "success");
      } else {
        toast(`${done} ${row.requestNo}`, "success");
      }
      return;
    }
    if (outcome.kind === "unknown") {
      setDialog(null);
      toast(`${reviewActionLabel[action]}结果未知，到页面上方按原请求重试`, "warn");
      return;
    }
    if (outcome.kind === "failed") setDialogFailure(outcome.message);
    else setDialogFailure("这个账号现在不能做这项操作，或申请状态已经变了。刷新列表后再看。");
  };

  const statusLabel = status ? developerStatusText(status) : "全部";
  const conclusion = (() => {
    if (error) return <Conclusion state="danger" icon={TriangleAlert} hint="看下方原因后重试；读到之前不能处理申请。">申请列表没读到，这部分没有判断</Conclusion>;
    if (!data) return <Conclusion state="neutral" icon={Clock3}>正在加载申请…</Conclusion>;
    const total = data.total;
    if (status === "PENDING" && !keyword) {
      if (total === 0) return <Conclusion state="ok" icon={CheckCircle2}>没有等待审批的申请</Conclusion>;
      const oldest = records.length > 0 && total <= records.length ? records[records.length - 1] : undefined;
      return <Conclusion state="warn" lead icon={Inbox}
        explain="数的是「待审批」的申请条数，不是人数。列表按提交时间从新到旧排，最早的在最后一页。"
        hint={oldest ? `最早的 ${timeText(oldest.createdAt)}（${zone}）提交，已等 ${waitedText(oldest.createdAt, now)}` : "最早提交的在最后一页"}>
        {total} 个申请在等审批
      </Conclusion>;
    }
    return <Conclusion state="neutral" icon={Inbox} explain="数的是当前筛选下的申请条数，不是人数。">
      {keyword ? `「${statusLabel}」里匹配「${keyword}」的申请共 ${total} 条` : `「${statusLabel}」的申请共 ${total} 条`}
    </Conclusion>;
  })();

  const recoveryRows = attempts.map((record) => {
    const [action, requestNo] = record.fingerprint.split(":") as [ReviewAction, string];
    const fromStatus = record.inputFingerprint.split(":").pop() ?? "";
    const row = records.find((item) => item.requestNo === requestNo);
    const expired = record.expiresAt <= now;
    const reason = !reviewPermissions[action] ? `这个账号现在没有${reviewActionLabel[action]}的权限`
      : expired ? "已超过 24 小时，不能再重试"
        : !row ? undefined
          : row.status !== fromStatus ? `这条申请现在是「${developerStatusText(row.status)}」，这里不能再按原请求重试`
            : staleReason;
    return (
      <li key={record.fingerprint}>
        <span className="a9-rec-name">{reviewActionLabel[action]}{row ? ` · ${row.company}` : ""}</span>
        <span className="a9-rec-no" data-mono>{requestNo}</span>
        <span className="a9-rec-time">{businessStamp(record.createdAt)} 提交</span>
        <span className="a9-rec-state">
          {expired
            ? <StatusTag tone="neutral" icon={Hourglass} explain="原请求超过 24 小时，不能再重试。">已过期</StatusTag>
            : <StatusTag tone="warn" icon={CircleHelp} explain="提交时没收到确定结果，可能已经生效。按原请求重试用的是同一次提交的编号和备注，后端认得出，不会重复执行。">结果未知</StatusTag>}
        </span>
        <span className="a9-rec-actions">
          {row || expired || !reviewPermissions[action]
            ? <Button size="sm" disabled={!row} disabledReason={reason} onClick={() => row && review(row, action)}>按原请求重试</Button>
            : <Button size="sm" onClick={() => { setStatus(fromStatus as StatusFilter); setKeywordInput(requestNo); setPage(1); }}>在列表里找到它</Button>}
        </span>
      </li>
    );
  });

  const columnCount = 6;
  const judgment: JudgmentRow[] = shown ? [
    { label: "申请人", icon: Building2, tone: "users", value: shown.company, reason: shown.email },
    { label: "平台用户", icon: User, tone: "users", value: <>用户编号 {shown.userId}{reach("/users/search") && <> · 到<Link className="rd-link" href={`/users/search?q=${encodeURIComponent(String(shown.userId))}`}>查找用户与查看资料</Link>里打开</>}</> },
    { label: "申请的环境", icon: Server, value: scopeText(shown), reason: shown.sourceEnvironment === "SANDBOX" ? "批准只对这个测试批次有效" : undefined },
    { label: "提交时间", icon: Clock3, value: shown.status === "PENDING" ? `${timeText(shown.createdAt)} · 已等 ${waitedText(shown.createdAt, now)}` : timeText(shown.createdAt) },
    { label: "现在", value: <StatusBadge status={shown.status} />, state: shown.status === "PENDING" ? "warn" : undefined,
      reason: (STATUS_LOOK[shown.status] ?? UNKNOWN_LOOK).explain },
  ] : [];
  const history: TimelineEntry[] = shown ? [
    { id: "submit", action: "提交申请", actor: shown.email, at: shown.createdAt },
    ...(shown.reviewedAt || shown.reviewer ? [{
      id: "review",
      action: ({ APPROVED: "批准访问", REJECTED: "驳回申请", REVOKED: "撤销访问" } as Record<string, string>)[shown.status] ?? "处理",
      actor: shown.reviewer || "—",
      at: shown.reviewedAt ?? "",
      detail: shown.reviewReason ? <span className="a9-reason">备注：{shown.reviewReason}</span> : undefined,
    }] : []),
  ] : [];
  const shownActions = shown ? rowActions(shown) : null;
  const shownAttempt = shown ? attemptFor(shown) : undefined;
  const missingNote = shown && shownActions && (() => {
    if (shown.status === "PENDING" && !shownActions.approve && !shownActions.reject) return "这个账号没有批准和驳回的权限，只能查看";
    if (shown.status === "PENDING" && !shownActions.approve) return "这个账号没有批准权限";
    if (shown.status === "PENDING" && !shownActions.reject) return "这个账号没有驳回权限";
    if (shown.status === "APPROVED" && !shownActions.revoke) return "这个账号没有撤销权限，只能查看";
    return undefined;
  })();
  const copyNo = (value: string) => {
    void navigator.clipboard?.writeText(value).then(() => toast("已复制申请编号", "success"), () => toast("复制失败，请手动选择编号", "error"));
  };

  return <div className="a9-page">
    <PageHeader pageId="A9" title="开发者访问审批" summary="审批外部开发者使用开发者接口的申请。"
      meta={<span className="rd-toolbar">
        <span>{readAt ? `${businessStamp(readAt)}（${zone}）读取 · ` : ""}不自动刷新</span>
        <Button variant="ghost" size="sm" icon={<RefreshCw size={14} aria-hidden />} loading={loading} onClick={() => setReloadKey((value) => value + 1)}>刷新</Button>
      </span>}
      readOnly={canWriteAny ? undefined : "你只能查看；批准、驳回、撤销各要单独的权限"} />

    {conclusion}

    {recoveryRows.length > 0 && <Notice tone="warn" title={<>{recoveryRows.length} 个操作结果未知<Explain label="结果未知怎么处理" content={<>
      <p>提交时没收到确定结果，可能已经生效。按原请求重试用同一次提交的编号和备注，后端认得出，不会重复执行。</p>
      <p>这页没有按原请求查询结果的接口；列表里的状态只说明现在的状态，不能证明原操作成没成。</p>
    </>} /></>}>
      <ul className="a9-rec" aria-label="结果未知的操作">{recoveryRows}</ul>
      <p className="a9-rec-zone">提交时间为{zone}</p>
    </Notice>}

    <FilterBar
        scope={<Segments label="开发者访问申请状态筛选" value={status}
          items={STATUS_ORDER.map((value) => ({ value, label: value ? developerStatusText(value) : "全部", count: value === status && data && !error ? data.total : undefined }))}
          onChange={(value) => { setStatus(value); setPage(1); }} />}
        onClear={keywordInput ? () => setKeywordInput("") : undefined} canClear clearLabel="清除搜索">
        <FilterField grow><Input aria-label="开发者访问申请搜索" placeholder="申请编号 / 公司 / 邮箱 / 用途" value={keywordInput} onChange={(event) => setKeywordInput(event.target.value)} /></FilterField>
      </FilterBar>

    <Panel flush icon={KeyRound} tone="role-3" title={status ? `${statusLabel}的申请` : "全部申请"} sub={`时间为${zone}`}>
      <Table label="开发者访问申请列表" className="a9-table" aria-busy={loading}>
        <thead><tr>
          <Th data-col="who" icon={Building2} tone="users">申请人</Th>
          <Th data-col="no">申请编号 · 提交时间</Th>
          <Th data-col="env">环境</Th>
          <Th data-col="state">状态</Th>
          <Th data-col="use">用途</Th>
          <Th data-col="op" sticky="end">操作</Th>
        </tr></thead>
        <tbody>
          {loading ? <TableLoading columns={columnCount} rows={Math.min(pageSize, 8)} />
            : error ? <TableMessage columns={columnCount} role="alert">读取失败：{error} <Button size="sm" onClick={() => setReloadKey((value) => value + 1)}>重试</Button></TableMessage>
              : records.length === 0 ? <TableMessage columns={columnCount} role="status">
                {keyword ? <>没有匹配「{keyword}」的申请。 <Button size="sm" onClick={() => setKeywordInput("")}>清除搜索</Button></>
                  : status === "PENDING" ? <>现在没有等待审批的申请。开发者在 App 提交后会出现在这里。 <Button size="sm" onClick={() => { setStatus(""); setPage(1); }}>看全部申请</Button></>
                    : status ? `暂无${statusLabel}的申请` : "暂无申请"}
              </TableMessage>
                : records.map((row) => {
                  const actions = rowActions(row);
                  const pendingAttempt = attemptFor(row);
                  const look = STATUS_LOOK[row.status];
                  return <Tr key={row.requestNo} selected={row.requestNo === currentNo} onOpen={() => setCurrentNo(row.requestNo)}>
                    <Td><Cell main={row.company} sub={row.email} title={`${row.company} · ${row.email} · 用户编号 ${row.userId}`} /></Td>
                    <Td><Cell mono full main={row.requestNo} sub={timeText(row.createdAt)} /></Td>
                    <Td><Cell main={<EnvironmentTag row={row} />} sub={row.runId ? <span data-mono title={`批次 ${row.runId}`}>批次 {row.runId}</span> : undefined} /></Td>
                    <Td><Cell main={<StatusBadge bare status={row.status} quiet={Boolean(status) && Boolean(look)} />}
                      sub={pendingAttempt ? "有操作结果未知" : row.status === "PENDING" ? `已等 ${waitedText(row.createdAt, now)}` : row.reviewedAt ? timeText(row.reviewedAt) : undefined} /></Td>
                    <Td grow data-col="use"><Cell main={row.useCase || "—"} title={row.useCase} /></Td>
                    <Td sticky="end" data-fit=""><span className="rd-row-actions">
                      {actions.approve
                        ? <Button size="sm" disabledReason={staleReason} onClick={() => review(row, "approve")}>批准</Button>
                        : <Button size="sm" variant="ghost" aria-label={`查看申请 ${row.requestNo}`} onClick={() => setCurrentNo(row.requestNo)}>查看</Button>}
                      {(actions.reject || actions.revoke) && <MoreMenu label={`申请 ${row.requestNo} 的更多操作`} items={[
                        ...(actions.reject ? [{ key: "reject", label: "驳回", danger: true, disabledReason: staleReason, onSelect: () => review(row, "reject") }] : []),
                        ...(actions.revoke ? [{ key: "revoke", label: "撤销访问", danger: true, disabledReason: staleReason, onSelect: () => review(row, "revoke") }] : []),
                      ]} />}
                    </span></Td>
                  </Tr>;
                })}
        </tbody>
      </Table>
      {!error && (data?.total ?? 0) > 0 && <Pager label="开发者访问申请" sizeLabel="开发者访问申请" total={data?.total ?? 0} page={page} pageSize={pageSize} sizes={PAGE_SIZES} loading={loading}
        onPage={setPage} onPageSize={(size: number) => { setPageSize(size); setPage(1); }} />}
    </Panel>

    <Drawer open={Boolean(shown)} onClose={() => setCurrentNo(null)} title="申请详情" icon={KeyRound} tone="role-3" busy={dialogBusy}
      sub={shown && <>{shown.requestNo} <IconButton aria-label="复制申请编号" data-size="sm" onClick={() => copyNo(shown.requestNo)}><Copy size={13} aria-hidden /></IconButton><StatusBadge status={shown.status} /></>}
      nav={{ hasPrev: shownIndex > 0, hasNext: shownIndex >= 0 && shownIndex < records.length - 1,
        onPrev: () => { if (shownIndex > 0) setCurrentNo(records[shownIndex - 1].requestNo); },
        onNext: () => { if (shownIndex < records.length - 1) setCurrentNo(records[shownIndex + 1].requestNo); } }}
      footer={shown && shownActions && (staleReason || missingNote || shownActions.approve || shownActions.reject || shownActions.revoke) && <Decision note={staleReason ?? missingNote}
        explain={shown.status === "PENDING" ? "批准：他在这个环境拿到开发者资格，可以自己创建 API 密钥、管理 Webhook；之后可以撤销。驳回：这条申请结束，他可以在 App 重新申请。都立即生效。"
          : shown.status === "APPROVED" ? "撤销：他在这个环境的密钥认证和密钥、Webhook 管理随即被拒；已有密钥和 Webhook 不删除。他可以在 App 重新申请。" : undefined}
        danger={shownActions.reject ? <Button variant="danger-outline" disabledReason={staleReason} onClick={() => review(shown, "reject")}>驳回</Button>
          : shownActions.revoke ? <Button variant="danger-outline" disabledReason={staleReason} onClick={() => review(shown, "revoke")}>撤销访问</Button> : undefined}
        primary={shownActions.approve ? <Button variant="primary" disabledReason={staleReason} onClick={() => review(shown, "approve")}>批准</Button> : undefined} />}>
      {shown && <>
        {shownAttempt && <Notice tone="warn">这条申请有一个结果未知的{reviewActionLabel[shownAttempt.fingerprint.split(":")[0] as ReviewAction]}，先按原请求重试，不要另外提交。</Notice>}
        <JudgmentPoints title={`判断要点 · 时间为${zone}`} rows={judgment} />
        <Panel plain headingLevel={3} title="申请用途" explain="申请人在 App 提交时填的，10–2000 字。">
          <p className="a9-usecase">{shown.useCase || "—"}</p>
        </Panel>
        <Panel plain headingLevel={3} title="处理记录" explain="这条申请只存最近一次处理：撤销会覆盖批准时的处理人、时间和备注。">
          <Timeline label="处理记录" entries={history} />
        </Panel>
      </>}
    </Drawer>

    {dialog && (dialog.mode !== "recovery" || (dialog.previous?.adminId === adminId && reviewPermissions[dialog.action])) && (
      <ReviewDialog state={dialog} busy={dialogBusy} failure={dialogFailure} reason={reasonDraft} touched={reasonTouched}
        onReason={setReasonDraft} onTouch={() => setReasonTouched(true)}
        onClose={() => setDialog(null)} onConfirm={() => void confirmDialog()} onReload={() => { setDialog(null); setReloadKey((value) => value + 1); }} />
    )}
  </div>;
}

const DIALOG = {
  approve: { title: "批准开发者访问", icon: ShieldCheck, confirm: "批准申请", danger: false },
  reject: { title: "驳回开发者访问申请", icon: XCircle, confirm: "驳回申请", danger: true },
  revoke: { title: "撤销开发者访问", icon: ShieldOff, confirm: "撤销访问", danger: true },
} as const;

function afterText(action: ReviewAction): ReactNode {
  if (action === "approve") return "他可以在上面这个环境自己创建 API 密钥、管理 Webhook；批准不会替他发密钥。";
  if (action === "reject") return "这条申请结束，他拿不到开发者资格。他可以在 App 重新申请。";
  return <>{`他在这个环境的密钥认证、密钥和 Webhook 管理随即被拒；已有密钥和 Webhook 不删除，已执行的请求不撤回。`}<Explain label="撤销的范围" content="按同一用户、同一环境（测试环境还按批次）判断：他在这个范围里没有别的有效批准时才会被拒。他之后可以在 App 重新申请。" /></>;
}

function ReviewDialog({ state, busy, failure, reason, touched, onReason, onTouch, onClose, onConfirm, onReload }: {
  state: ReviewDialogState; busy: boolean; failure: string | null; reason: string; touched: boolean;
  onReason: (value: string) => void; onTouch: () => void; onClose: () => void; onConfirm: () => void; onReload: () => void;
}) {
  const { row, action, previous, mode } = state;
  const look = DIALOG[action];
  const retrying = mode !== "new";
  const length = reason.trim().length;
  const short = mode !== "recovery" && length < 8;
  const reasonError = touched && short ? (length === 0 ? "请填写备注" : `还差 ${8 - length} 字`) : length > 500 ? "超过 500 字，后端会拒绝，请删短" : undefined;
  const zone = businessZone().label;
  return (
    <Modal title={retrying ? "按原请求重试" : look.title} icon={look.icon} tone={look.danger && !retrying ? "danger" : "neutral"} busy={busy}
      sub={retrying
        ? <StatusTag tone="warn" icon={CircleHelp}>结果未知</StatusTag>
        : <><StatusTag tone="progress" filled>立即生效</StatusTag>{look.danger ? <IrreversibleTag /> : <StatusTag tone="neutral" icon={ShieldOff}>之后可以撤销</StatusTag>}</>}
      onClose={onClose}
      footer={<Decision others={<Button variant="secondary" disabled={busy} onClick={onClose}>取消</Button>}
        primary={<Button variant={look.danger && !retrying ? "danger" : "primary"} loading={busy} loadingText="正在提交…"
          disabledReason={short ? (length === 0 ? "先填写备注" : `备注还差 ${8 - length} 字`) : undefined} onBlockedClick={onTouch} onClick={onConfirm}>
          {retrying ? "按原请求重试" : look.confirm}
        </Button>} />}>
      {retrying && <Notice tone="warn">{mode === "recovery"
        ? `上次${reviewActionLabel[action]}没收到确定结果，可能已经生效。重试用同一次提交的编号和备注，后端认得出，不会重复执行。`
        : "这条记录是旧版本保存的，没有存原备注。填上次提交的原备注，一字不差，后端才认得出是同一次提交。"}</Notice>}
      <Facts>
        {retrying && <Fact k="原操作">{reviewActionLabel[action]}</Fact>}
        <Fact k="申请人">{row.company}</Fact>
        <Fact k="邮箱">{row.email}</Fact>
        <Fact k="平台用户">用户编号 {row.userId}</Fact>
        <Fact k="环境">{scopeText(row)}</Fact>
        <Fact k="申请编号"><span data-mono>{row.requestNo}</span></Fact>
        {retrying && previous && <Fact k="原请求提交">{`${businessStamp(previous.createdAt)}（${zone}）`}</Fact>}
        {mode === "recovery" && <Fact k="原备注"><span className="a9-reason">{previous?.reason}</span></Fact>}
        {!retrying && <Fact k={{ approve: "批准后", reject: "驳回后", revoke: "撤销后" }[action]} >{afterText(action)}</Fact>}
      </Facts>
      {mode !== "recovery" && <Field label={mode === "legacy" ? "上次提交的原备注" : "备注"} required hint="至少 8 字" error={reasonError} help="只留在后台记录里，申请人看不到。">
        {(control) => <Textarea {...control} rows={3} value={reason} disabled={busy} count={`${length}/500`}
          placeholder={action === "approve" ? "例如：已核实公司和用途" : "例如：用途和公司资料对不上"}
          onChange={(event) => onReason(event.target.value)} onBlur={onTouch} />}
      </Field>}
      {failure && <Notice tone="danger" title={retrying ? "重试被拒绝" : "没有执行"} action={<Button size="sm" onClick={onReload}>刷新列表</Button>}>
        {failure}{retrying ? " 这不能说明原操作没有生效。" : ""}
      </Notice>}
    </Modal>
  );
}
