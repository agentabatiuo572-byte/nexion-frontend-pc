"use client";
/**
 * 客服工作台「导出记录」页签（画板 6a–6l，审批入口按已定的甲）：我的申请、待我审批、申请详情抽屉、批准 / 驳回 / 撤回确认框、
 * 下载失败后重新获取、批准结果未知的待确认。读写都走 PerfExportPorts（接线前只有开发夹具给）。
 */
import { useCallback, useEffect, useState } from "react";
import { BlockState, Button, Cell, Decision, Drawer, Fact, Facts, Fold, Notice, Pager, Panel, Segments, StatusTag, Steps, Table, Td, Th, Tr } from "@/app/components/rd";
import { OperationConfirmModal } from "@/app/components/domain-views/design-kit";
import { businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { ExportColumnsFold } from "./perf-export";
import { EXPORT_LABEL, ExportOutcomeUnknownError, exportStatus, type DecisionLookup, type ExportTask, type PendingDecision, type PerfExportPorts } from "./perf-view";
import "./m1-export.css";

type View = "MINE" | "APPROVALS";
type Confirm = { kind: "approve" | "reject" | "withdraw"; task: ExportTask };
const DETAIL = (task: ExportTask) => task.type !== "SUMMARY";
const clock = (iso: string) => formatBusinessTimeCompact(iso, "—").slice(-5);
const VERB: Record<PendingDecision["decision"], string> = { APPROVE: "批准", REJECT: "驳回", WITHDRAW: "撤回" };

export function PerfExportRecords({ ports }: { ports: PerfExportPorts }) {
  const persona = ports.persona;
  const zone = businessZone().label;
  const [view, setView] = useState<View>(persona.views[0]);
  const [rows, setRows] = useState<ExportTask[] | null>(null);
  const [readError, setReadError] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [pending, setPending] = useState<PendingDecision[]>(() => ports.pendingDecisions());
  const [lookup, setLookup] = useState<DecisionLookup | "loading" | null>(null);
  const [retryRejected, setRetryRejected] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState<string | null>(null);

  const load = useCallback((next: View) => {
    setRows(null); setReadError(false);
    ports.tasks(next).then(setRows, () => setReadError(true));
  }, [ports]);
  useEffect(() => load(view), [load, view]);

  const put = (task: ExportTask) => setRows(list => list?.map(row => row.taskId === task.taskId ? task : row) ?? list);
  const download = (task: ExportTask) => { setDownloadFailed(null); ports.download(task.taskId).catch(() => { setDownloadFailed(task.taskId); setOpenId(task.taskId); }); };
  const query = (p: PendingDecision) => {
    setLookup("loading"); setRetryRejected(false);
    ports.lookupDecision(p).then(found => {
      setLookup(found);
      if (found.kind === "matched") { put(found.task); setPending(ports.pendingDecisions()); }
    }, () => setLookup({ kind: "failed", text: "这次查询没连上，原操作还没确定。稍后再点「查询原操作」。" }));
  };
  const retryOriginal = (p: PendingDecision, task: ExportTask) => {
    (p.decision === "WITHDRAW" ? ports.withdraw(task, p.reason) : ports.decide(task, p.decision, p.reason)).then(next => { put(next); setPending(ports.pendingDecisions()); setLookup(null); }, () => setRetryRejected(true));
  };

  const single = persona.views.length === 1;
  const sub = !rows ? undefined : view === "MINE" ? `本人提交的 · ${rows.length} 条` : single ? `待我审批 · ${rows.length} 条` : `共 ${rows.length} 条`;
  const open = rows?.find(row => row.taskId === openId) ?? null;

  return <>
    <Panel title="导出记录" sub={sub} explain="汇总提交后就能下载；明细要另一位有审批权的管理员批准后才生成。下载链接每次获取后 24 小时内有效。"
      actions={!single && <Segments label="导出记录视图" value={view} items={[{ value: "MINE", label: "我的申请" }, { value: "APPROVALS", label: "待我审批" }]} onChange={next => { setOpenId(null); setView(next); }} />}>
      {readError ? <BlockState state="error" title="导出记录加载失败" onRetry={() => load(view)} />
        : !rows ? <BlockState state="loading" title="正在读取导出记录…" />
        : !rows.length ? <BlockState state="empty" title={view === "MINE" ? "还没有导出申请" : "没有等你审批的申请"} />
        : <>
          {rows.some(row => row.scopeLost) && <p className="m1-export-lost">这些申请的范围和行数现在看不到。</p>}
          <Table label="导出记录" className="m1-export-table"><thead><Tr>
            <Th>导出内容</Th><Th>范围 · 月份</Th><Th>状态</Th><Th>提交时间（{zone}）</Th><Th align="right">行数</Th><Th sticky="end" fit>操作</Th>
          </Tr></thead><tbody>{rows.map(task => {
            const status = exportStatus(task);
            const reviewing = view === "APPROVALS" && task.state === "PENDING_APPROVAL";
            const who = view === "APPROVALS" ? `${task.mine ? "你" : task.requester} · ` : "";
            return <Tr key={task.taskId} selected={openId === task.taskId} onOpen={() => setOpenId(task.taskId)}>
              <Td><Cell main={EXPORT_LABEL[task.type]} sub={<span data-mono="">{task.taskId}</span>} /></Td>
              <Td>{task.scopeLost ? "—" : <Cell main={`${who}${task.scope ?? "—"}`} sub={task.month ?? "—"} />}</Td>
              <Td><Cell main={<StatusTag tone={status.tone}>{status.label}</StatusTag>} sub={reviewing && task.mine ? "你发起的，要另一位有审批权的管理员处理" : status.line} /></Td>
              <Td><span className="sa-nowrap">{formatBusinessTimeCompact(task.requestedAt, "—")}</span></Td>
              <Td align="right"><Cell num main={task.rows === null ? "—" : String(task.rows)} /></Td>
              <Td sticky="end" fit>{task.state === "READY"
                ? <Button size="sm" disabledReason={task.canDownload ? undefined : "你现在不能下载"} onClick={() => download(task)}>下载</Button>
                : reviewing ? <Button size="sm" disabledReason={task.mine ? "你发起的，要另一位有审批权的管理员处理" : undefined} onClick={() => setOpenId(task.taskId)}>审批</Button>
                : <Button size="sm" onClick={() => setOpenId(task.taskId)}>查看</Button>}</Td>
            </Tr>;
          })}</tbody></Table>
          <Pager label="导出记录" sizeLabel="导出记录每页条数" total={rows.length} page={1} pageSize={10} sizes={[10]} onPage={() => undefined} onPageSize={() => undefined} />
        </>}
    </Panel>

    {open && <TaskDrawer task={open} view={view} zone={zone} rows={rows ?? []}
      pending={pending.find(p => p.taskId === open.taskId)} lookup={lookup} retryRejected={retryRejected} downloadFailed={downloadFailed === open.taskId}
      onNav={id => { setOpenId(id); setLookup(null); setRetryRejected(false); }}
      onClose={() => { setOpenId(null); setLookup(null); setRetryRejected(false); }}
      onConfirm={kind => setConfirm({ kind, task: open })} onDownload={() => download(open)}
      onQuery={p => query(p)} onRetry={p => retryOriginal(p, open)}
      onRelease={p => { setPending(list => list.filter(row => row !== p)); setLookup(null); setRetryRejected(false); }} />}

    {confirm && <TaskConfirm confirm={confirm} zone={zone} onClose={() => setConfirm(null)}
      onConfirm={async reason => {
        const { kind, task } = confirm;
        try {
          put(kind === "withdraw" ? await ports.withdraw(task, reason) : await ports.decide(task, kind === "approve" ? "APPROVE" : "REJECT", reason));
        } catch (error) {
          // 批准、驳回、撤回没收到结果：关框，抽屉顶上换成待确认条，只给「查询原操作」（OP-91–96）。
          if (!(error instanceof ExportOutcomeUnknownError)) throw error;
          setPending(ports.pendingDecisions());
        }
        setConfirm(null);
      }} />}
  </>;
}

function TaskDrawer({ task, view, zone, rows, pending, lookup, retryRejected, downloadFailed, onNav, onClose, onConfirm, onDownload, onQuery, onRetry, onRelease }: {
  task: ExportTask; view: View; zone: string; rows: ExportTask[];
  pending?: PendingDecision; lookup: DecisionLookup | "loading" | null; retryRejected: boolean; downloadFailed: boolean;
  onNav: (id: string) => void; onClose: () => void; onConfirm: (kind: Confirm["kind"]) => void; onDownload: () => void;
  onQuery: (p: PendingDecision) => void; onRetry: (p: PendingDecision) => void; onRelease: (p: PendingDecision) => void;
}) {
  const status = exportStatus(task);
  const label = EXPORT_LABEL[task.type];
  const reviewing = view === "APPROVALS" && task.state === "PENDING_APPROVAL";
  const index = rows.findIndex(row => row.taskId === task.taskId);
  const submitted = clock(task.requestedAt);
  const approved = task.state === "APPROVED" || task.state === "READY" && DETAIL(task) || task.state === "EXPIRED" && DETAIL(task);
  const steps = [
    { label: "提交", sub: submitted, state: "done" as const },
    ...(DETAIL(task) ? [{ label: "审批", sub: task.state === "PENDING_APPROVAL" ? reviewing ? "你" : "另一位审批人" : task.decidedAt ? `${task.decidedAt} ${task.state === "REJECTED" ? "驳回" : "批准"}` : "—", state: task.state === "PENDING_APPROVAL" ? "current" as const : "done" as const }] : []),
    { label: "生成文件", sub: task.state === "READY" || task.state === "EXPIRED" ? DETAIL(task) ? "已生成" : submitted : task.state === "APPROVED" ? task.failure ? "没生成" : "进行中" : "批准后", state: task.state === "APPROVED" ? "current" as const : task.state === "READY" || task.state === "EXPIRED" ? "done" as const : "todo" as const },
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
    : task.state === "APPROVED" && task.failure === "GENERATE_FAILED" ? "文件没生成出来，不能下载。批准记录还在；生成出错请重新导出，明细要重新审批。"
    : task.state === "APPROVED" && task.failure === "SCOPE_LOST_BEFORE_GENERATE" ? "已批准，但生成前你已没有这个范围的权限，文件没有生成。要导出请先恢复权限，再重新申请。"
    : task.state === "APPROVED" ? "还不能下载：已批准，文件还在生成。生成好会变成「可下载」。"
    : task.state === "READY" && !task.canDownload ? "文件还在，但你现在没有这个范围的权限，不能下载。恢复权限、文件还在保留期内时，可以下载同一份。"
    : task.state === "REJECTED" ? "已驳回，不会生成文件。要导出请按理由改好后重新申请。"
    : task.state === "EXPIRED" ? "文件已过保留期，不能再下载，也不能重新获取。要用请重新导出，明细要重新审批。"
    : undefined;
  const footer = reviewing
    ? <Decision note={note}
        danger={<Button variant="danger-outline" disabledReason={pending ? "查询有结果前不能驳回" : task.mine ? "你发起的，要另一位有审批权的管理员处理" : undefined} onClick={() => onConfirm("reject")}>驳回</Button>}
        primary={<Button variant="primary" disabledReason={pending ? "查询有结果前不能批准" : task.mine ? "你发起的，要另一位有审批权的管理员处理" : task.approveBlocked} onClick={() => onConfirm("approve")}>批准</Button>} />
    : <Decision note={note}
        others={<>{task.canWithdraw && task.state === "PENDING_APPROVAL" && <Button disabledReason={pending ? "查询有结果前不能再撤回" : undefined} onClick={() => onConfirm("withdraw")}>撤回申请</Button>}<Button onClick={onClose}>关闭</Button></>}
        primary={task.state === "READY" && task.canDownload && !downloadFailed ? <Button variant="primary" onClick={onDownload}>下载</Button> : undefined} />;

  return <Drawer open wide title={reviewing ? `审批${label}导出` : `${label}导出`} sub={<StatusTag tone={status.tone}>{status.label}</StatusTag>} onClose={onClose}
    nav={{ onPrev: () => onNav(rows[index - 1].taskId), onNext: () => onNav(rows[index + 1].taskId), hasPrev: index > 0, hasNext: index >= 0 && index < rows.length - 1 }}
    footer={footer}>
    {pending && <Notice tone="warn" title={`${VERB[pending.decision]}结果未知`} actionBelow action={<>
      <Button size="sm" loading={lookup === "loading"} loadingText="正在查询…" onClick={() => onQuery(pending)}>查询原操作</Button>
      {lookup !== "loading" && lookup?.kind === "not-received" && !retryRejected && <Button size="sm" onClick={() => onRetry(pending)}>按原操作重试</Button>}
      {retryRejected && <Button size="sm" onClick={() => onRelease(pending)}>解除待确认</Button>}
    </>}>
      <p>{pending.at} 点{VERB[pending.decision]}后没收到结果，原操作和理由已保存。先查询原操作，不要再点{VERB[pending.decision]}。</p>
      {lookup && lookup !== "loading" && !retryRejected && <p>{lookup.text}</p>}
      {lookup && lookup !== "loading" && (lookup.kind === "mismatch" || lookup.kind === "expired") && <p className="rd-note">没有那一页的权限时，请有权限的管理员核对这次操作。</p>}
      {retryRejected && <><p>按原操作重试被拒绝了。先核实原操作的结果，再解除待确认。</p><p className="rd-note">解除只在这个页面生效，不进操作记录。</p></>}
    </Notice>}
    {!pending && lookup && lookup !== "loading" && lookup.kind === "matched" && <Notice tone="ok">{lookup.text}</Notice>}
    {downloadFailed && <Notice tone="warn" title="下载没有完成" actionBelow action={<Button size="sm" onClick={onDownload}>重新获取下载链接</Button>}>文件还在，重新获取下载链接再下，不会重新生成。</Notice>}
    <Steps label="导出进度" items={steps} />
    <Facts>
      {task.scopeLost ? <>
        <Fact k="内容">{label}</Fact>
        <Fact k="提交时间">{formatBusinessTimeCompact(task.requestedAt, "—")}（{zone}）</Fact>
        <Fact k="范围、月份和行数">—</Fact>
      </> : <>
        {!task.mine && <Fact k="申请人">{task.requester}（{task.requesterRole}）</Fact>}
        {task.state === "APPROVED" || (task.state === "READY" && DETAIL(task)) ? <><Fact k="谁批的">{task.decidedBy} · {task.decidedAt}</Fact><Fact k="批准理由">{task.decisionReason}</Fact></> : null}
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
function TaskConfirm({ confirm, zone, onClose, onConfirm }: { confirm: Confirm; zone: string; onClose: () => void; onConfirm: (reason: string) => Promise<void> }) {
  const { kind, task } = confirm;
  const label = EXPORT_LABEL[task.type];
  const month = task.month ? `${task.month}（截至 ${task.asOf ? formatBusinessTimeCompact(task.asOf, "—") : "—"}，${zone}）` : "—";
  const summary = <Facts>
    <Fact k="申请人">{task.requester}（{task.requesterRole}）</Fact>
    <Fact k="范围">{task.scope ?? "—"}</Fact>
    <Fact k="月份">{month}</Fact>
    <Fact k="内容">{label}（{task.rows ?? "—"} 行，{task.columns.total} 列）</Fact>
    <Fact k="数据覆盖">{task.coverage ?? "—"}</Fact>
    <Fact k="申请理由">{task.requestReason}</Fact>
  </Facts>;
  if (kind === "withdraw") return <OperationConfirmModal briefKind="export" title={`撤回${label}导出申请`} action="撤回业绩导出申请" detail={task.taskId}
    effect={<StatusTag tone="progress" filled>立即生效</StatusTag>} confirmLabel="确认撤回" onClose={onClose} onConfirm={onConfirm}
    facts={task.scopeLost
      ? <Facts><Fact k="内容">{label}</Fact><Fact k="编号"><span data-mono="">{task.taskId}</span></Fact><Fact k="提交时间">{formatBusinessTimeCompact(task.requestedAt, "—")}（{zone}）</Fact><Fact k="撤回后">不再审批，也不生成文件；要导出得重新申请</Fact></Facts>
      : <Facts><Fact k="内容">{label}（{task.rows ?? "—"} 行）</Fact><Fact k="范围">{task.scope ?? "—"}</Fact><Fact k="提交时间">{formatBusinessTimeCompact(task.requestedAt, "—")}（{zone}）</Fact><Fact k="撤回后">不再审批，也不生成文件；要导出得重新申请</Fact></Facts>} />;
  const approve = kind === "approve";
  return <OperationConfirmModal briefKind="export" title={approve ? `批准${label}导出` : `驳回${label}导出申请`} action={approve ? "批准业绩明细导出" : "驳回业绩明细导出"} detail={task.taskId}
    effect={<StatusTag tone="progress" filled>{approve ? "批准后生成文件" : "立即生效"}</StatusTag>} confirmLabel={approve ? "确认批准" : "确认驳回"}
    facts={summary}
    content={<><ExportColumnsFold columns={task.columns} summary="提交时的列" />
      <Facts><Fact k={approve ? "批准后" : "驳回后"}>{approve ? "生成文件，不能撤回；申请人有权限才能下载" : "不生成文件；申请人看到理由，可重新申请"}</Fact></Facts></>}
    onClose={onClose} onConfirm={onConfirm} />;
}
