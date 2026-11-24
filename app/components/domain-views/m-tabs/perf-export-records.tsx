"use client";
/**
 * 客服工作台「导出记录」页签（画板 6a–6l，审批入口按已定的甲）：我的申请、待我审批、申请详情抽屉、批准 / 驳回 / 撤回确认框、
 * 下载失败后重新获取、批准结果未知的待确认。读写都走 PerfExportPorts。
 */
import { useEffect, useState, type ReactNode } from "react";
import { BlockState, Button, Cell, Decision, Drawer, Fact, Facts, Fold, Notice, Pager, Panel, Segments, StatusTag, Steps, Table, Td, Th, Tr } from "@/app/components/rd";
import { OperationConfirmModal } from "@/app/components/domain-views/design-kit";
import { RecoveryPanel, SettledLine, TechInfo, recoveryTitle, type RecoveryItem } from "@/app/components/domain-views/recovery-panel";
import { RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import { announcePermissionDenied } from "@/lib/admin/operation-confirm-error";
import { businessStamp, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { ExportAuditLink, ExportColumnsFold } from "./perf-export";
import { EXPORT_LABEL, EXPORT_PARTIAL_RECEIPT, ExportOutcomeUnknownError, exportDownloadMessage, exportVisibleReceiptSummary, exportReceiptSummary, exportStatus, type DecisionLookup, type ExportDownload, type ExportTask, type PendingDecision, type PendingSubmit, type PerfExportPorts } from "./perf-view";
import { exportDecisionConflict, exportTaskHidden, isExportPermissionDenied, useExportClock } from "./perf-export-ports";
import "./m1-export.css";

type View = "MINE" | "APPROVALS";
type Confirm = { kind: "approve" | "reject" | "withdraw"; task: ExportTask };
const DETAIL = (task: ExportTask) => task.type !== "SUMMARY";
const clock = (iso: string) => formatBusinessTimeCompact(iso, "—").slice(-5);
const VERB: Record<PendingDecision["decision"], string> = { APPROVE: "批准", REJECT: "驳回", WITHDRAW: "撤回" };
const ACTION = { approve: "APPROVE", reject: "REJECT", withdraw: "WITHDRAW" } as const;

function exportListLocation(views: readonly View[]): { view: View; page: number } {
  const defaults = { view: views.includes("APPROVALS") ? "APPROVALS" as const : "MINE" as const, page: 1 };
  if (typeof window === "undefined") return defaults;
  const params = new URLSearchParams(window.location.search);
  const view = params.get("exportView");
  if (params.getAll("exportView").length !== 1 || (view !== "MINE" && view !== "APPROVALS") || !views.includes(view)) return defaults;
  const requested = params.get("page") ?? "";
  const page = /^[1-9]\d*$/.test(requested) && params.getAll("page").length === 1 ? Number(requested) : 1;
  return { view, page: Number.isSafeInteger(page) && (page - 1) * 10 <= 2_147_483_647 ? page : 1 };
}

export function PerfExportRecords({ ports }: { ports: PerfExportPorts }) {
  const persona = ports.persona;
  const zone = businessZone().label;
  const [location] = useState(() => exportListLocation(persona.views));
  const [view, setView] = useState<View>(location.view);
  const [rows, setRows] = useState<ExportTask[] | null>(null);
  const [readError, setReadError] = useState(false);
  const [page, setPage] = useState(location.page), [pageSize, setPageSize] = useState(10), [total, setTotal] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [taskRefresh, setTaskRefresh] = useState(0);
  const [detail, setDetail] = useState<ExportTask | null>(null);
  const [detailStatus, setDetailStatus] = useState<"loading" | "error" | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [pending, setPending] = useState<PendingDecision[]>(() => ports.pendingDecisions());
  const [lookup, setLookup] = useState<DecisionLookup | "loading" | null>(null);
  const [downloadFailed, setDownloadFailed] = useState<{ taskId: string; outcome: Exclude<ExportDownload, { kind: "downloaded" }> } | null>(null);
  // 待确认面板：本标签页存着的原操作（提交导出、批准、驳回、撤回），审批成功但回包丢了、任务已不在列表里时也能从这里查。
  const [pendingSubmit, setPendingSubmit] = useState(() => ports.pendingSubmit());
  const [answers, setAnswers] = useState<Record<string, { tag: ReactNode; line: string }>>({});
  const [querying, setQuerying] = useState<string | null>(null);
  const [settled, setSettled] = useState<{ key: string; label: string; text: string; taskId?: string; mine?: boolean }[]>([]);
  const now = useExportClock([pendingSubmit, ...pending]);

  useEffect(() => {
    const sync = () => { setPendingSubmit(ports.pendingSubmit()); setPending(ports.pendingDecisions()); };
    const unsubscribe = ports.subscribePending(sync);
    sync();
    return unsubscribe;
  }, [ports]);
  useEffect(() => {
    if (!persona.views.includes(view)) {
      setView(exportListLocation(persona.views).view); setPage(1); setOpenId(null); setConfirm(null); setDetail(null); setRows(null);
      return;
    }
    const url = new URL(window.location.href);
    url.searchParams.set("view", "exports");
    url.searchParams.set("exportView", view);
    url.searchParams.set("page", String(page));
    window.history.replaceState(null, "", url);
  }, [view, page, persona.views]);

  const clearPrivateRead = () => {
    setRows(null); setDetail(null); setOpenId(null); setConfirm(null); setLookup(null); setDownloadFailed(null);
  };
  const permissionLost = () => {
    clearPrivateRead();
    announcePermissionDenied();
    ports.invalidateAccess();
  };
  const forgetTaskRead = (taskId: string) => {
    setRows(list => list?.filter(row => row.taskId !== taskId) ?? null);
    if (openId === taskId) { setDetail(null); setOpenId(null); setConfirm(null); setLookup(null); }
    setRefresh(value => value + 1);
  };

  useEffect(() => {
    if (!persona.views.includes(view)) return;
    const controller = new AbortController();
    setRows(null); setReadError(false);
    ports.tasks(view, page, pageSize, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
      if (page > lastPage) { setPage(lastPage); return; }
      setRows(result.rows); setTotal(result.total);
    }, error => {
      if (controller.signal.aborted) return;
      if (isExportPermissionDenied(error)) { permissionLost(); return; }
      setReadError(true);
    });
    return () => controller.abort();
  }, [ports, view, page, pageSize, refresh]);

  useEffect(() => {
    setDetail(null); setDetailStatus(null);
    if (!openId) return;
    let active = true;
    setDetailStatus("loading");
    ports.task(openId).then(task => {
      if (active) { setDetail(task); setDetailStatus(null); }
    }, error => {
      if (!active) return;
      if (isExportPermissionDenied(error)) { permissionLost(); return; }
      if (exportTaskHidden(error)) { forgetTaskRead(openId); return; }
      setDetailStatus("error");
    });
    return () => { active = false; };
  }, [openId, ports, taskRefresh]);

  const put = (task: ExportTask) => {
    if (task.taskId === openId) setDetail(task);
    setRefresh(value => value + 1);
  };
  const download = (task: ExportTask) => {
    setDownloadFailed(null);
    void ports.download(task.taskId).then(outcome => {
      if (outcome.kind === "downloaded") return;
      if (outcome.permissionDenied) { permissionLost(); return; }
      setDownloadFailed({ taskId: task.taskId, outcome });
      setRows(list => list?.flatMap(row => row.taskId !== task.taskId ? [row] : outcome.task ? [outcome.task] : []) ?? null);
      if (outcome.task) {
        setDetail(outcome.task); setOpenId(task.taskId);
      } else {
        setDetail(null); setOpenId(null);
        setSettled(list => [{ key: `download:${task.taskId}`, label: "下载没有完成", text: exportDownloadMessage(outcome.kind) },
          ...list.filter(row => row.key !== `download:${task.taskId}`)]);
      }
    });
  };
  const query = (p: PendingDecision) => {
    setLookup("loading");
    ports.lookupDecision(p).then(found => {
      if (found.kind === "hidden") { forgetTaskRead(p.taskId); return; }
      setLookup(found);
      if (found.kind === "matched") put(found.task);
      if (found.kind === "cleared") setTaskRefresh(value => value + 1);
    }, error => {
      if (isExportPermissionDenied(error)) { permissionLost(); return; }
      if (exportTaskHidden(error)) { forgetTaskRead(p.taskId); return; }
      setLookup({ kind: "failed", text: "这次查询没连上，原操作还没确定。稍后再点「查询原操作」。" });
    });
  };
  const stillUnknown = (key: string, line: string) => setAnswers(map => ({ ...map, [key]: { tag: <StatusTag tone="warn">{line === RETRY_EXPIRED_TEXT ? "已过期" : "仍未知"}</StatusTag>, line } }));
  const queryOriginal = (p: PendingDecision) => {
    const key = p.operationId, label = `${VERB[p.decision]}导出申请 ${p.taskId}`;
    setQuerying(key);
    ports.lookupDecision(p).then(found => {
      if (found.kind === "matched") {
        setSettled(list => [{ key, label, text: `已查到这次${VERB[p.decision]}：这条申请现在是「${exportStatus(found.task).label}」。`, taskId: p.taskId }, ...list]);
        setRefresh(value => value + 1);
      } else if (found.kind === "cleared") {
        setSettled(list => [{ key, label, text: found.text, taskId: p.taskId }, ...list]);
        setRefresh(value => value + 1);
      } else {
        if (found.kind === "hidden") forgetTaskRead(p.taskId);
        stillUnknown(key, found.text);
      }
      if (openId === p.taskId) setTaskRefresh(value => value + 1);
    }, error => {
      if (isExportPermissionDenied(error)) { permissionLost(); return; }
      if (exportTaskHidden(error)) {
        forgetTaskRead(p.taskId);
        stillUnknown(key, "当前无法查看这条申请，原操作继续保留。");
        return;
      }
      stillUnknown(key, "这次查询没连上，原操作还没确定。稍后再点「查询原结果」。");
    }).finally(() => setQuerying(null));
  };
  const querySubmit = (original: PendingSubmit) => {
    const key = original.operationId;
    setQuerying(key);
    ports.lookupSubmit().then(found => {
      if (found.kind === "matched") {
        setSettled(list => [{ key, label: "提交导出", text: exportReceiptSummary(found.rows), mine: true }, ...list]);
        setRefresh(value => value + 1);
      } else if (found.kind === "partial") {
        setAnswers(map => ({ ...map, [key]: { tag: acceptedTag, line: EXPORT_PARTIAL_RECEIPT + exportVisibleReceiptSummary(found.rows) } }));
        setRefresh(value => value + 1);
      } else if (found.kind === "cleared") setSettled(list => [{ key, label: "提交导出", text: "这次提交没有执行，原理由已保留，可以重新导出。", mine: true }, ...list]);
      else if (!original.acceptedRequestId) stillUnknown(key, found.kind === "missing" ? "找不到本标签页保存的原操作。"
        : found.expired ? RETRY_EXPIRED_TEXT : "还没查到这次提交的结果，先保持锁定，稍后再查。");
    }, error => {
      if (isExportPermissionDenied(error)) { permissionLost(); return; }
      if (!original.acceptedRequestId) stillUnknown(key, "这次查询没连上，原操作还没确定。稍后再点「查询原结果」。");
    }).finally(() => setQuerying(null));
  };
  const queryButton = (key: string, onClick: () => void) => <Button size="sm" loading={querying === key} loadingText="正在查询…" disabledReason={querying && querying !== key ? "等上一条查完" : undefined} onClick={onClick}>查询原结果</Button>;
  const unknownTag = <StatusTag tone="warn">结果未知</StatusTag>;
  const acceptedTag = <StatusTag tone="ok">已受理</StatusTag>;
  const expiredResult = { tag: <StatusTag tone="warn">已过期</StatusTag>, line: RETRY_EXPIRED_TEXT };
  const recovery: RecoveryItem[] = [
    ...(pendingSubmit ? [{
      key: pendingSubmit.operationId, createdAt: pendingSubmit.createdAt, object: `提交导出 · ${pendingSubmit.query.month} · ${pendingSubmit.query.types.map(type => EXPORT_LABEL[type]).join("、")}`,
      tag: pendingSubmit.acceptedRequestId ? acceptedTag : unknownTag,
      line: pendingSubmit.acceptedRequestId ? EXPORT_PARTIAL_RECEIPT : `${businessStamp(pendingSubmit.createdAt)} 发出后没收到结果；先查询原结果，不要再点提交。`,
      result: !pendingSubmit.acceptedRequestId && now >= pendingSubmit.expiresAt ? expiredResult : answers[pendingSubmit.operationId],
      actions: queryButton(pendingSubmit.operationId, () => querySubmit(pendingSubmit)), detail: <p>理由：{pendingSubmit.reason}</p>, tech: <TechInfo commandKey={pendingSubmit.operationId} />,
    }] : []),
    ...pending.map(p => ({
      key: p.operationId, createdAt: p.createdAt, object: p.objectHidden ? "导出操作" : `${VERB[p.decision]}导出申请 ${p.taskId}`,
      tag: unknownTag, line: p.objectHidden ? `${p.at} 发出；这条申请现在不在你能看的范围内，原操作继续保留，可以再查询。` : `${p.at} 发出后没收到结果；先查询原结果，不要再点${VERB[p.decision]}。`,
      result: now >= p.expiresAt ? expiredResult : p.objectHidden ? undefined : answers[p.operationId],
      actions: queryButton(p.operationId, () => queryOriginal(p)), detail: p.reason && <p>理由：{p.reason}</p>, tech: <TechInfo commandKey={p.operationId} />,
    })),
  ];
  const acceptedOriginals = pendingSubmit?.acceptedRequestId ? 1 : 0;
  const anyExpired = now >= (pendingSubmit?.expiresAt ?? Infinity) || pending.some(row => now >= row.expiresAt);
  const single = persona.views.length === 1;
  const sub = !rows ? undefined : view === "MINE" ? `本人提交的 · ${total} 条` : single ? `待我审批 · ${total} 条` : `共 ${total} 条`;
  const open = detail?.taskId === openId ? detail : null;

  return <>
    <RecoveryPanel title={recoveryTitle(recovery.length - acceptedOriginals, 0, 0, acceptedOriginals)} label={`导出操作：${recoveryTitle(recovery.length - acceptedOriginals, 0, 0, acceptedOriginals)}`} items={recovery}
      explain="提交导出、批准、驳回、撤回没收到结果时，原操作和理由存在这个浏览器标签页里。先按原操作查询，查到之前不要重做；关掉标签页这些记录就没了。"
      foot={anyExpired ? <ExportAuditLink /> : undefined} />
    {settled.map(row => <SettledLine key={row.key} label={row.label} text={row.text}
      action={row.taskId ? <Button size="sm" variant="ghost" onClick={() => setOpenId(row.taskId!)}>查看</Button>
        : row.mine && persona.views.includes("MINE") ? <Button size="sm" variant="ghost" onClick={() => { setOpenId(null); setPage(1); setView("MINE"); setRefresh(value => value + 1); }}>看我的申请</Button> : undefined}
      onDismiss={() => setSettled(list => list.filter(item => item.key !== row.key))} />)}
    <Panel title="导出记录" sub={sub} explain="汇总提交后就能下载；明细要另一位有审批权的管理员批准后才生成。下载链接每次获取后 24 小时内有效。"
      actions={!single && <Segments label="导出记录视图" value={view} items={[{ value: "MINE", label: "我的申请" }, { value: "APPROVALS", label: "待我审批" }]} onChange={next => { setOpenId(null); setPage(1); setView(next); }} />}>
      {readError ? <BlockState state="error" title="导出记录加载失败" onRetry={() => setRefresh(value => value + 1)} />
        : !rows ? <BlockState state="loading" title="正在读取导出记录…" />
        : !rows.length ? <BlockState state="empty" title={view === "MINE" ? "还没有导出申请" : "没有等你审批的申请"} />
        : <>
          {rows.some(row => row.scopeLost) && <p className="m1-export-lost">这些申请的范围和行数现在看不到。</p>}
          <Table label="导出记录" className="m1-export-table"><thead><Tr>
            <Th>导出内容</Th><Th>范围 · 月份</Th><Th>状态</Th><Th>提交时间（{zone}）</Th><Th align="right">行数</Th><Th sticky="end" fit>操作</Th>
          </Tr></thead><tbody>{rows.map(task => {
            const status = exportStatus(task);
            const reviewing = view === "APPROVALS" && task.state === "PENDING_APPROVAL";
            return <Tr key={task.taskId} selected={openId === task.taskId} onOpen={() => setOpenId(task.taskId)}>
              {/* 申请人单独一行，范围列只写范围；任务编号写成「编号 40」，不和行数挨着。 */}
              <Td><Cell main={EXPORT_LABEL[task.type]} sub={view === "APPROVALS" ? task.mine ? "你提交的" : `申请人 ${task.requester}` : <span data-mono="">编号 {task.taskId}</span>} /></Td>
              <Td>{task.scopeLost ? "—" : <Cell main={task.scope ?? "—"} sub={task.month ?? "—"} />}</Td>
              <Td><Cell main={<StatusTag tone={status.tone}>{status.label}</StatusTag>} sub={reviewing && task.mine ? "你发起的，要另一位有审批权的管理员处理" : status.line} /></Td>
              <Td><span className="sa-nowrap">{formatBusinessTimeCompact(task.requestedAt, "—")}</span></Td>
              <Td align="right"><Cell num main={task.rows === null ? "—" : String(task.rows)} /></Td>
              <Td sticky="end" fit>{task.state === "READY"
                ? <Button size="sm" disabledReason={task.canDownload ? undefined : "你现在不能下载"} onClick={() => download(task)}>下载</Button>
                : reviewing ? <Button size="sm" disabledReason={task.mine ? "你发起的，要另一位有审批权的管理员处理" : undefined} onClick={() => setOpenId(task.taskId)}>审批</Button>
                : <Button size="sm" onClick={() => setOpenId(task.taskId)}>查看</Button>}</Td>
            </Tr>;
          })}</tbody></Table>
          <Pager label="导出记录" sizeLabel="导出记录每页条数" total={total} page={page} pageSize={pageSize} sizes={[10]} onPage={setPage} onPageSize={size => { setPageSize(size); setPage(1); }} />
        </>}
    </Panel>

    {openId && detailStatus && <Drawer open title="导出记录" onClose={() => setOpenId(null)}>
      <BlockState state={detailStatus} title={detailStatus === "loading" ? "正在加载…" : "导出记录加载失败"} onRetry={detailStatus === "error" ? () => setTaskRefresh(value => value + 1) : undefined} />
    </Drawer>}
    {open && <TaskDrawer task={open} view={view} zone={zone} rows={rows ?? []}
      pending={pending.find(p => p.taskId === open.taskId)} now={now} lookup={lookup} downloadFailed={downloadFailed?.taskId === open.taskId ? downloadFailed.outcome : undefined}
      onNav={id => { setOpenId(id); setLookup(null); }}
      onClose={() => { setOpenId(null); setLookup(null); }}
      onConfirm={kind => setConfirm({ kind, task: open })} onDownload={() => download(open)}
      onQuery={p => query(p)} />}

    {confirm && <TaskConfirm confirm={confirm} zone={zone} initialReason={ports.recoveredDecision(confirm.task.taskId, ACTION[confirm.kind])} onClose={() => setConfirm(null)}
      onConfirm={async reason => {
        const { kind, task } = confirm;
        try {
          put(kind === "withdraw" ? await ports.withdraw(task, reason) : await ports.decide(task, kind === "approve" ? "APPROVE" : "REJECT", reason));
        } catch (error) {
          if (isExportPermissionDenied(error)) {
            clearPrivateRead();
            ports.invalidateAccess();
            throw error;
          }
          if (exportDecisionConflict(error)) {
            setConfirm(null); setDetail(null); setDetailStatus("loading");
            setRows(list => list?.filter(row => row.taskId !== task.taskId) ?? null);
            setTaskRefresh(value => value + 1); setRefresh(value => value + 1);
            return;
          }
          if (exportTaskHidden(error)) { forgetTaskRead(task.taskId); setConfirm(null); return; }
          // 批准、驳回、撤回没收到结果：关框，抽屉顶上换成待确认条，只给「查询原操作」（OP-91–96）。
          if (!(error instanceof ExportOutcomeUnknownError)) throw error;
        }
        setConfirm(null);
      }} />}
  </>;
}

function TaskDrawer({ task, view, zone, rows, pending, now, lookup, downloadFailed, onNav, onClose, onConfirm, onDownload, onQuery }: {
  task: ExportTask; view: View; zone: string; rows: ExportTask[];
  pending?: PendingDecision; now: number; lookup: DecisionLookup | "loading" | null; downloadFailed?: Exclude<ExportDownload, { kind: "downloaded" }>;
  onNav: (id: string) => void; onClose: () => void; onConfirm: (kind: Confirm["kind"]) => void; onDownload: () => void;
  onQuery: (p: PendingDecision) => void;
}) {
  const status = exportStatus(task);
  const expired = pending !== undefined && now >= pending.expiresAt;
  const generating = task.state === "PENDING_GENERATION" || task.state === "APPROVED";
  const label = EXPORT_LABEL[task.type];
  const reviewing = view === "APPROVALS" && task.state === "PENDING_APPROVAL";
  const index = rows.findIndex(row => row.taskId === task.taskId);
  const submitted = clock(task.requestedAt);
  const approved = task.state === "APPROVED" || task.state === "READY" && DETAIL(task) || task.state === "EXPIRED" && DETAIL(task);
  const steps = [
    { label: "提交", sub: submitted, state: "done" as const },
    // 撤回的申请停在审批前：这一步写「已撤回」，不算走完。
    ...(DETAIL(task) ? [{ label: "审批", sub: task.state === "WITHDRAWN" ? "已撤回" : task.state === "PENDING_APPROVAL" ? reviewing ? "你" : "另一位审批人" : task.decidedAt ? <span className="sa-nowrap">{task.decidedAt.slice(-5)} {task.state === "REJECTED" ? "驳回" : "批准"}</span> : "—", state: task.state === "PENDING_APPROVAL" ? "current" as const : task.state === "WITHDRAWN" ? "todo" as const : "done" as const }] : []),
    { label: "生成文件", sub: task.state === "READY" || task.state === "EXPIRED" ? DETAIL(task) ? "已生成" : submitted : task.state === "FAILED" ? "没生成" : generating ? task.failure ? "没生成" : "进行中" : "批准后", state: generating || task.state === "FAILED" ? "current" as const : task.state === "READY" || task.state === "EXPIRED" ? "done" as const : "todo" as const },
    { label: "下载", sub: task.mine ? "你本人" : "申请人", state: task.state === "READY" ? "current" as const : "todo" as const },
  ];
  const month = task.month ? `${task.month}（截至 ${task.asOf ? formatBusinessTimeCompact(task.asOf, "—") : "—"}，${zone}）` : "—";
  const content = `${label}（${task.rows ?? "—"} 行，${task.columns.total} 列）`;
  // 底部常显：现在为什么不能下载、为什么不能批准（各写一处）。
  const note = pending ? pending.decision === "WITHDRAW" ? "查询有结果前，不能再撤回。" : "查询有结果前，批准和驳回都不能点。"
    : reviewing && task.mine ? "这是你发起的，需要另一位有审批权的管理员处理"
    : reviewing && task.approveBlocked ? `批准不了：${task.approveBlocked}。驳回照常可以。`
    : task.scopeLost && task.state === "PENDING_APPROVAL" ? "恢复权限前这条不能批准；可以撤回。"
    : task.state === "PENDING_APPROVAL" && task.mine ? "还不能下载：没批准，文件还没生成。"
    : task.failure === "SCOPE_HIDDEN" ? "生成前你已没有这个范围的权限，文件没有生成。请超级管理员在「客服与分组」恢复负责组，或在「运营账号与权限」恢复导出权限。"
    : (task.state === "APPROVED" || task.state === "FAILED") && task.failure === "SCOPE_LOST_BEFORE_GENERATE" ? task.decidedAt ? "已批准，但生成前你已没有这个范围的权限，文件没有生成。要导出请先恢复权限，再重新申请。" : "生成前你已没有这个范围的权限，文件没有生成。要导出请先恢复权限，再重新申请。"
    : (task.state === "APPROVED" || task.state === "FAILED") && task.failure ? task.decidedAt ? "文件没生成出来，不能下载。批准记录还在；请重新导出，明细要重新审批。" : "文件没生成出来，不能下载。请重新导出。"
    : task.state === "APPROVED" ? "还不能下载：已批准，文件还在生成。生成好会变成「可下载」。"
    : task.state === "PENDING_GENERATION" ? "文件还在等待生成。"
    : task.state === "READY" && !task.canDownload ? "文件还在，但你现在没有这个范围的权限，不能下载。恢复权限、文件还在保留期内时，可以下载同一份。"
    : task.state === "REJECTED" ? "已驳回，不会生成文件。要导出请按理由改好后重新申请。"
    : task.state === "EXPIRED" ? "文件已过保留期，不能再下载，也不能重新获取。要用请重新导出，明细要重新审批。"
    : undefined;
  const footer = reviewing
    ? <Decision note={note}
        danger={<Button variant="danger-outline" disabledReason={pending ? "查询有结果前不能驳回" : task.mine ? "你发起的，要另一位有审批权的管理员处理" : task.canReject ? undefined : "当前不能驳回"} onClick={() => onConfirm("reject")}>驳回</Button>}
        primary={<Button variant="primary" disabledReason={pending ? "查询有结果前不能批准" : task.mine ? "你发起的，要另一位有审批权的管理员处理" : task.canApprove ? undefined : task.approveBlocked} onClick={() => onConfirm("approve")}>批准</Button>} />
    : <Decision note={note}
        others={<>{task.canWithdraw && task.state === "PENDING_APPROVAL" && <Button disabledReason={pending ? "查询有结果前不能再撤回" : undefined} onClick={() => onConfirm("withdraw")}>撤回申请</Button>}<Button onClick={onClose}>关闭</Button></>}
        primary={task.state === "READY" && task.canDownload && !downloadFailed ? <Button variant="primary" onClick={onDownload}>下载</Button> : undefined} />;

  return <Drawer open title={reviewing ? `审批${label}导出` : `${label}导出`} sub={<StatusTag tone={status.tone}>{status.label}</StatusTag>} onClose={onClose}
    nav={{ onPrev: () => onNav(rows[index - 1].taskId), onNext: () => onNav(rows[index + 1].taskId), hasPrev: index > 0, hasNext: index >= 0 && index < rows.length - 1 }}
    footer={footer}>
    {pending && <Notice tone="warn" title={`${VERB[pending.decision]}结果未知`} actionBelow action={<>
      <Button size="sm" loading={lookup === "loading"} loadingText="正在查询…" onClick={() => onQuery(pending)}>查询原操作</Button>
    </>}>
      <p>{pending.at} 点{VERB[pending.decision]}后没收到结果，原操作和理由已保存。先查询原操作，不要再点{VERB[pending.decision]}。</p>
      {lookup && lookup !== "loading" && lookup.kind !== "expired" && <p>{lookup.text}</p>}
      {expired && <p>{RETRY_EXPIRED_TEXT}</p>}
      {(expired || lookup && lookup !== "loading" && lookup.kind === "mismatch") && <p className="rd-note"><ExportAuditLink /></p>}
    </Notice>}
    {!pending && lookup && lookup !== "loading" && (lookup.kind === "matched" || lookup.kind === "cleared") && <Notice tone="ok">{lookup.text}</Notice>}
    {downloadFailed && <Notice tone="warn" title="下载没有完成" actionBelow action={downloadFailed.kind === "retry" && <Button size="sm" onClick={onDownload}>重新获取下载链接</Button>}>{exportDownloadMessage(downloadFailed.kind)}</Notice>}
    <Steps label="导出进度" items={steps} />
    <Facts>
      {task.scopeLost ? <>
        <Fact k="内容">{label}</Fact>
        <Fact k="提交时间">{formatBusinessTimeCompact(task.requestedAt, "—")}（{zone}）</Fact>
        <Fact k="范围、月份和行数">—</Fact>
      </> : <>
        {!task.mine && <Fact k="申请人">{task.requester}{task.requesterRole && `（${task.requesterRole}）`}</Fact>}
        {task.state === "APPROVED" || (task.state === "READY" && DETAIL(task)) || (task.state === "FAILED" && !!task.decidedAt) ? <><Fact k="谁批的">{task.decidedBy} · {task.decidedAt}</Fact><Fact k="批准理由">{task.decisionReason}</Fact></> : null}
        {task.state === "REJECTED" && <Fact k="驳回理由">{task.decisionReason}</Fact>}
        {task.state === "READY" && <><Fact k="文件">{label}（{task.rows ?? "—"} 行，{task.columns.total} 列，CSV）</Fact><Fact k="下载链接">每次获取后 24 小时内有效</Fact></>}
        <Fact k="范围">{task.scope ?? "—"}</Fact>
        <Fact k="月份">{month}</Fact>
        {task.state !== "READY" && <Fact k="内容">{content}</Fact>}
        {task.state === "PENDING_APPROVAL" && <Fact k="数据覆盖">{task.coverage ?? "—"}</Fact>}
        <Fact k="申请理由">{task.requestReason}</Fact>
      </>}
    </Facts>
    {reviewing && <ExportColumnsFold columns={task.columns} summary="提交时的列" />}
    <Fold title="技术信息" summary={pending ? "任务编号、原操作号" : "任务编号"}>
      <p data-mono="">任务编号 {task.taskId}</p>
      {pending && <p data-mono="">原操作号 {pending.operationId}</p>}
    </Fold>
  </Drawer>;
}

/** 批准、驳回、撤回：同一种共用确认框，同一份申请摘要（OP-69），后果写在「…后」一行，理由必填。 */
function TaskConfirm({ confirm, zone, initialReason, onClose, onConfirm }: { confirm: Confirm; zone: string; initialReason?: string; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const { kind, task } = confirm;
  const label = EXPORT_LABEL[task.type];
  const month = task.month ? `${task.month}（截至 ${task.asOf ? formatBusinessTimeCompact(task.asOf, "—") : "—"}，${zone}）` : "—";
  const summary = <Facts>
    <Fact k="申请人">{task.requester}{task.requesterRole && `（${task.requesterRole}）`}</Fact>
    <Fact k="范围">{task.scope ?? "—"}</Fact>
    <Fact k="月份">{month}</Fact>
    <Fact k="内容">{label}（{task.rows ?? "—"} 行，{task.columns.total} 列）</Fact>
    <Fact k="数据覆盖">{task.coverage ?? "—"}</Fact>
    <Fact k="申请理由">{task.requestReason}</Fact>
  </Facts>;
  if (kind === "withdraw") return <OperationConfirmModal initialReason={initialReason} briefKind="export" title={`撤回${label}导出申请`} action="撤回业绩导出申请" detail={task.taskId}
    effect={<StatusTag tone="progress" filled>立即生效</StatusTag>} confirmLabel="确认撤回" onClose={onClose} onConfirm={onConfirm}
    facts={task.scopeLost
      ? <Facts><Fact k="内容">{label}</Fact><Fact k="编号"><span data-mono="">{task.taskId}</span></Fact><Fact k="提交时间">{formatBusinessTimeCompact(task.requestedAt, "—")}（{zone}）</Fact><Fact k="撤回后">不再审批，也不生成文件；要导出得重新申请</Fact></Facts>
      : <Facts><Fact k="内容">{label}（{task.rows ?? "—"} 行）</Fact><Fact k="范围">{task.scope ?? "—"}</Fact><Fact k="提交时间">{formatBusinessTimeCompact(task.requestedAt, "—")}（{zone}）</Fact><Fact k="撤回后">不再审批，也不生成文件；要导出得重新申请</Fact></Facts>} />;
  const approve = kind === "approve";
  return <OperationConfirmModal initialReason={initialReason} briefKind="export" title={approve ? `批准${label}导出` : `驳回${label}导出申请`} action={approve ? "批准业绩明细导出" : "驳回业绩明细导出"} detail={task.taskId}
    effect={<StatusTag tone="progress" filled>{approve ? "批准后生成文件" : "立即生效"}</StatusTag>} confirmLabel={approve ? "确认批准" : "确认驳回"}
    facts={summary}
    content={<><ExportColumnsFold columns={task.columns} summary="提交时的列" />
      <Facts><Fact k={approve ? "批准后" : "驳回后"}>{approve ? "生成文件，不能撤回；申请人有权限才能下载" : "不生成文件；申请人看到理由，可重新申请"}</Fact></Facts></>}
    onClose={onClose} onConfirm={onConfirm} />;
}
