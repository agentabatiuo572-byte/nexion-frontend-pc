"use client";
/**
 * 导出业绩的确认框（画板 5a–5h）：业绩榜、我的数据、主管工作台三处同一个框（OP-41）。
 * 用共用的 OperationConfirmModal：理由规则、提交中锁定、失败留表单都在它里面；这里只给月份、范围、导出内容和按钮上的字。
 * 读写都走 PerfExportPorts。
 */
import { canAccessResolvedPath, resolveVisibleDomains } from "@/lib/nav/console-nav";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import { announcePermissionDenied } from "@/lib/admin/operation-confirm-error";
import { useEffect, useRef, useState } from "react";
import { Button, Decision, Explain, Fact, Facts, Field, Fold, InlineRetry, Modal, Notice, Select, StatusTag, CheckGroup } from "@/app/components/rd";
import { OperationConfirmModal } from "@/app/components/domain-views/design-kit";
import { businessZone } from "@/lib/admin/business-time";
import { EXPORT_LABEL, ExportOutcomeUnknownError, exportDownloadMessage, exportReceiptSummary, exportStatus, type ExportColumns, type ExportDialogData, type ExportDownload, type ExportItem, type ExportSubmitted, type ExportType, type PerfExportPorts } from "./perf-view";
import { isExportPermissionDenied, useExportClock } from "./perf-export-ports";
import "./m1-export.css";

const num = (n: number) => n.toLocaleString("en-US");
const DETAIL_TYPES: readonly ExportType[] = ["CUSTOMER_DETAIL", "TRANSACTION_DETAIL"];

/** 「查看 N 个列名」：预检回来的（导出框）或提交时冻结的（审批）真实列名，按组排。 */
export function ExportColumnsFold({ columns, summary }: { columns: ExportColumns; summary: string }) {
  return <Fold title={`查看 ${columns.total} 个列名`} summary={summary} inset>
    <dl className="m1-export-cols">{columns.groups.map(group => <div key={group.name}><dt>{group.name}</dt><dd>{group.columns.map(column => <span key={column} className="m1-export-col">{column}</span>)}</dd></div>)}</dl>
  </Fold>;
}

export function ExportAuditLink() {
  const session = useAdminAuth(state => state.session);
  return session && canAccessResolvedPath(resolveVisibleDomains(session), "/platform/audit")
    ? <a className="rd-link" href="/platform/audit">操作记录与审批</a>
    : <span>没有那一页的权限时，请有权限的管理员核对这次操作。</span>;
}

export function PerfExportDialog({ ports, initialMonth, initialScope, onClose, onRecords }: {
  ports: PerfExportPorts; initialMonth?: string; initialScope?: string; onClose: () => void; onRecords?: () => void;
}) {
  const [initial] = useState({ month: initialMonth, scope: initialScope });
  const [data, setData] = useState<ExportDialogData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [month, setMonth] = useState("");
  const [scope, setScope] = useState("");
  const [items, setItems] = useState<ExportItem[]>([]);
  const [selected, setSelected] = useState<ExportType[]>([]);
  /** 勾着时没加载出来、后来取消勾选的项：写「这次不导出」。 */
  const [dropped, setDropped] = useState<ExportType[]>([]);
  const [result, setResult] = useState<ExportSubmitted[] | null>(null);
  const [downloadFailed, setDownloadFailed] = useState<{ taskId: string; outcome: Exclude<ExportDownload, { kind: "downloaded" }> } | null>(null);
  /** 提交没收到结果：选择和理由都锁住，只给「查询原操作」（OP-91–96）。 */
  const [original, setOriginal] = useState(() => ports.pendingSubmit());
  const [originalReason, setOriginalReason] = useState(() => original?.reason ?? ports.recoveredSubmit()?.reason);
  const [confirmationRevision, setConfirmationRevision] = useState(0);
  const unknown = !!original;
  const expired = useExportClock([original]) >= (original?.expiresAt ?? Infinity);
  const [lookupText, setLookupText] = useState<string | null>(null);
  const [querying, setQuerying] = useState(false);
  const [found, setFound] = useState(false);
  const [preview, setPreview] = useState<"checking" | "ready" | "failed">("checking");
  const checkGeneration = useRef(0);
  const zone = businessZone().label;
  const permissionLost = () => {
    checkGeneration.current++;
    announcePermissionDenied();
    onClose();
    ports.invalidateAccess();
  };

  const load = () => {
    setLoadFailed(false);
    setPreview("checking");
    const generation = ++checkGeneration.current;
    ports.open(initial).then(next => {
      if (generation !== checkGeneration.current) return;
      setData(next); setMonth(next.month); setScope(next.scope); setItems(next.items); setSelected(next.selected);
      setPreview("ready");
    }, error => {
      if (generation !== checkGeneration.current) return;
      if (isExportPermissionDenied(error)) { permissionLost(); return; }
      setLoadFailed(true); setPreview("failed");
    });
  };
  useEffect(() => { load(); return () => { checkGeneration.current++; }; }, [ports]);

  /** 重新检查这几项（只读）。只认最后一次检查的结果；没查到的这一项写没加载出来。 */
  const recheck = (types: readonly ExportType[], next = { month, scope }) => {
    const generation = ++checkGeneration.current;
    setPreview("checking");
    setData(previous => previous && { ...previous, asOf: "—", blocked: undefined });
    const permitted = data?.scopes.find(choice => choice.value === next.scope)?.types;
    setItems(rows => rows.filter(row => permitted?.includes(row.type)).map(row => ({
      ...row, columns: { total: 0, summary: "", groups: [] }, check: { state: "checking" },
    })));
    ports.check({ month: next.month, scope: next.scope, types: [...types] }).then(found => {
      if (generation !== checkGeneration.current) return;
      setItems(found.items);
      setData(previous => previous && { ...previous, asOf: found.asOf, blocked: found.blocked });
      setPreview("ready");
    }, error => {
      if (generation !== checkGeneration.current) return;
      if (isExportPermissionDenied(error)) { permissionLost(); return; }
      setPreview("failed");
      setItems(rows => rows.map(row => ({ ...row, check: { state: "failed", text: "没加载出来。" } })));
    });
  };
  const toggle = (item: ExportItem) => {
    const on = selected.includes(item.type);
    const next = on ? selected.filter(type => type !== item.type) : [...selected, item.type];
    setSelected(next);
    if (on && item.check.state === "failed") setDropped(rows => [...rows, item.type]);
    if (!on) setDropped(rows => rows.filter(type => type !== item.type));
    // 取消勾选没加载出来的一项后，马上对剩下勾着的重新检查，用这次的结果提交（5h）。
    recheck(next);
  };
  const changeScope = (value: string) => {
    const types = data?.scopes.find(choice => choice.value === value)?.types;
    const next = selected.filter(type => types?.includes(type));
    setSelected(next); setScope(value); setDropped([]);
    recheck(next, { month, scope: value });
  };
  const changeMonth = (value: string) => { setMonth(value); setDropped([]); recheck(selected, { month: value, scope }); };

  if (result) {
    const pending = result.some(row => row.state === "PENDING_APPROVAL");
    const scopeLabel = data?.scopes.find(row => row.value === scope)?.label ?? "—";
    const download = (taskId: string) => {
      setDownloadFailed(null);
      const generation = checkGeneration.current;
      void ports.download(taskId).then(outcome => {
        if (generation !== checkGeneration.current || outcome.kind === "downloaded") return;
        if (outcome.permissionDenied) { permissionLost(); return; }
        setDownloadFailed({ taskId, outcome });
        setResult(rows => rows?.map(row => row.taskId !== taskId ? row : {
          ...row, ...outcome.task, state: outcome.task?.state ?? (outcome.kind === "expired" ? "EXPIRED" : row.state),
          canDownload: outcome.kind === "retry",
          rows: outcome.task ? outcome.task.rows : outcome.kind === "forbidden" ? null : row.rows,
        }) ?? null);
      });
    };
    return <Modal title={`已提交 ${result.length} 项导出`} onClose={onClose}
      footer={<Decision others={onRecords && <Button onClick={onRecords}>去导出记录</Button>} primary={<Button variant="primary" onClick={onClose}>知道了</Button>} />}>
      <Facts>
        <Fact k="范围">{scopeLabel}</Fact>
        <Fact k="月份">{month}（截至 {data?.asOf}，{zone}）</Fact>
      </Facts>
      {found && <Notice tone="ok">{exportReceiptSummary(result)}</Notice>}
      {downloadFailed && <Notice tone="warn" title="下载没有完成" actionBelow action={downloadFailed.outcome.kind === "retry" && <Button size="sm" onClick={() => download(downloadFailed.taskId)}>重新获取下载链接</Button>}>{exportDownloadMessage(downloadFailed.outcome.kind)}</Notice>}
      <ul className="m1-export-results">{result.map(row => {
        const status = exportStatus(row);
        return <li key={row.taskId} className="m1-export-result">
        <div className="m1-export-result-main">
          <div className="m1-export-result-head"><span className="m1-export-result-name">{EXPORT_LABEL[row.type]}</span><StatusTag tone={status.tone}>{status.label}</StatusTag></div>
          <div className="m1-export-result-sub">{row.state === "READY" && row.canDownload ? `${row.rows === null ? "—" : num(row.rows)} 行 · CSV` : status.line}</div>
        </div>
        {row.state === "READY" && row.canDownload && downloadFailed?.taskId !== row.taskId && <Button size="sm" onClick={() => download(row.taskId)}>下载</Button>}
      </li>;
      })}</ul>
      {pending && <p className="rd-note">明细批准后才生成文件，生成好后在「导出记录」下载。</p>}
      <Fold title="技术信息" summary="任务编号">{result.map(row => <p key={row.taskId} data-mono="">{EXPORT_LABEL[row.type]} · 任务编号 {row.taskId}</p>)}</Fold>
    </Modal>;
  }

  const selectable = items.filter(item => item.check.state === "ok");
  const chosen = items.filter(item => selected.includes(item.type));
  const hasSummary = selected.includes("SUMMARY"), hasDetail = selected.some(type => DETAIL_TYPES.includes(type));
  const confirmLabel = hasSummary && hasDetail ? "导出汇总并提交明细审批" : hasDetail ? "提交审批" : "提交导出";
  const notReady = chosen.find(item => item.check.state !== "ok");
  // 要人处理的才出橙黄提示条：页面那一版刷新没成功、提交结果未知（VS-107）。
  const blockedReason = !data ? undefined
    : unknown ? "提交后没收到结果，原来的选择和理由已保存。先查询原操作，不要再点提交。"
    : data.blocked;
  // 空、没勾选、正在检查、勾着的项没加载出来：那一项自己在内容区写清楚，这里只写进确认按钮的灰色原因，不另出提示条（VS-107，一件事只说一处）。
  const quietReason = blockedReason ? undefined
    : preview === "checking" ? "正在检查…"
    : preview === "failed" || !data ? "导出内容没加载出来"
    : !selectable.length && !notReady ? items[0]?.check.state === "empty" ? "这个月还没有记录" : "没有能导出的内容"
    : notReady ? notReady.check.state === "checking" ? "正在检查…" : notReady.check.state === "failed" ? `${EXPORT_LABEL[notReady.type]}没加载出来` : `${EXPORT_LABEL[notReady.type]}这次不能导出`
    : (!chosen.length || chosen.length !== selected.length) ? "还没勾选导出内容" : chosen.some(item => item.check.state === "ok" && item.check.rows === null) ? "行数暂时无法确认" : undefined;
  // 没有能提交的项时不要求填理由，也不显示理由框（5f、5g）。
  const requireReason = unknown || !data || (!data.blocked && (selectable.length > 0 || !!notReady));
  const scopeLabel = data?.scopes.find(row => row.value === scope)?.label ?? "—";

  const recovery = unknown && <div className="m1-export-recover"><Button size="sm" loading={querying} loadingText="正在查询…" onClick={() => {
        setQuerying(true); setLookupText(null);
        ports.lookupSubmit().then(outcome => {
          if (outcome.kind === "pending") { setLookupText(outcome.expired ? RETRY_EXPIRED_TEXT : "还没查到这次提交的结果，先保持锁定，稍后再查。"); return; }
          if (outcome.kind === "missing") { setLookupText("找不到本标签页保存的原操作。"); return; }
          if (outcome.kind === "cleared") {
            setOriginal(undefined); setOriginalReason(outcome.draft.reason);
            setConfirmationRevision(value => value + 1); load();
            return;
          }
          setFound(true);
          setResult(outcome.rows);
        }, error => {
          if (isExportPermissionDenied(error)) { permissionLost(); return; }
          setLookupText("这次查询没连上，原操作还没确定。稍后再点「查询原操作」。");
        }).finally(() => setQuerying(false));
      }}>查询原操作</Button>{lookupText && lookupText !== RETRY_EXPIRED_TEXT && <span role="status">{lookupText}</span>}{expired && <span role="status">{RETRY_EXPIRED_TEXT} <ExportAuditLink /></span>}</div>;
  const content = !data && unknown ? recovery : loadFailed
    ? <Notice tone="danger" action={<Button size="sm" onClick={load}>重试</Button>}>导出内容没加载出来，月份、范围和已填的理由都还在。</Notice>
    : !data ? <p className="m1-export-loading" role="status">正在读取导出内容…</p>
    : <div className="m1-export">
      {recovery}
      <div className="m1-export-scope">
        <Field label="月份" help={data.since}>{control => data.months.length > 1
          ? <Select {...control} aria-label="月份" value={month} options={data.months} onChange={changeMonth} disabled={unknown} />
          : <div id={control.id} className="m1-export-static">{month}</div>}</Field>
        <Field label="范围">{control => data.scopes.length > 1
          ? <Select {...control} aria-label="范围" value={scope} options={data.scopes} onChange={changeScope} disabled={unknown} />
          : <div id={control.id} className="m1-export-static">{scopeLabel}</div>}</Field>
      </div>
      <p className="m1-export-fixed">
        <span><em>统计截至</em>{data.asOf}（{zone}）</span>
        <span><em>币种</em>USDT，越南盾只作参考列</span>
        <span><em>下载人</em>{data.downloader}</span>
      </p>
      {!items.length && preview === "checking" && <p className="m1-export-loading" role="status">正在检查…</p>}
      {!items.length && preview === "failed" && <Notice tone="danger" action={<Button size="sm" onClick={() => recheck(selected)}>重试</Button>}>导出内容没加载出来。</Notice>}
      <CheckGroup legend="导出内容" summary={`已选 ${selected.length} 项`}>
        <div className="m1-export-items">{items.map(item => {
          const on = selected.includes(item.type), label = EXPORT_LABEL[item.type], check = item.check;
          const rows = check.state === "ok" || check.state === "stale" ? check.rows : null;
          const meta = check.state === "empty" ? item.grain
            : check.state === "checking" ? `${item.grain} · 正在检查…`
            : `${item.grain}${rows !== null ? ` · ${num(rows)} 行` : ""} · 上限 ${num(item.limit)} 行（拟设）`;
          const showColumns = check.state === "ok" || check.state === "stale";
          return <div key={item.type} className="m1-export-item" data-state={check.state}>
            <input type="checkbox" className="rd-check" aria-label={label} checked={on} disabled={unknown || (!on && check.state !== "ok")} onChange={() => toggle(item)} />
            <div className="m1-export-item-main">
              <div className="m1-export-item-head"><span className="m1-export-item-name">{label}</span>
                {check.state === "ok" && <StatusTag tone="neutral">{DETAIL_TYPES.includes(item.type) ? "批准后才能下载" : "提交后就能下载"}</StatusTag>}</div>
              <div className="m1-export-item-meta">{meta}
                {showColumns && <span className="m1-export-item-cols">{item.columns.total} 列<Explain label={`${label}有哪些列`} content={item.columns.summary} /></span>}</div>
              {check.state === "ok" && check.rows === null && <p className="m1-export-item-note">新的一版还没核完，行数要等核完才知道。</p>}
              {check.state === "ok" && check.note && <p className="m1-export-item-note">{check.note}</p>}
              {check.state === "empty" && <p className="m1-export-item-note">{check.text}</p>}
              {check.state === "unavailable" && <p className="m1-export-item-note">{check.text}</p>}
              {check.state === "ok" && item.type === "CUSTOMER_DETAIL" && <p className="m1-export-item-note">看不到明细的客户，记录合成一行匿名小计。</p>}
              {check.state === "over" && <p className="m1-export-item-note" data-tone="warn">{check.text}</p>}
              {check.state === "failed" && <p className="m1-export-item-error" role="alert">
                {on ? `${check.text}点「重试」，或取消勾选。` : dropped.includes(item.type) ? "没加载出来，这次不导出。" : check.text}
                <InlineRetry onRetry={() => recheck(selected)} />
              </p>}
              {/* 列名展开只给勾着的项：打开时不用滚就看得到理由框（FP-5）；没勾的项看「N 列」的问号。 */}
              {check.state === "ok" && on && <ExportColumnsFold columns={item.columns} summary="这次检查的列" />}
            </div>
          </div>;
        })}</div>
      </CheckGroup>
    </div>;

  const effect = hasSummary || hasDetail ? <>{hasSummary && <StatusTag tone="progress" filled>汇总立即生成</StatusTag>}{hasDetail && <StatusTag tone="progress" filled>明细批准后生成</StatusTag>}</> : undefined;
  return <OperationConfirmModal key={confirmationRevision} briefKind="export" title="导出业绩" action="导出客服业绩" detail={`${month} · ${scopeLabel}`}
    effect={effect} content={content} initialReason={originalReason} reasonReadOnly={unknown} reasonMin={data?.minReasonChars} reasonMax={data?.maxReasonChars} confirmLabel={confirmLabel} blockedReason={blockedReason} requireReason={requireReason}
    // 共用框没有「只灰按钮、不出提示条」的属性：借多字段表单的跨字段校验，field 指向页面自己画的「导出内容」，
    // 共用框不在别处再写这句，只把它放进确认按钮的灰色原因。表单本身没有字段，页面样式里收起（m1-export.css）。
    // businessFormRevision 让共用框每次重读这份表单（原因跟着勾选、检查结果变）。
    businessForm={{ kind: "multi-field", fields: [], feedback: () => quietReason ? { invalid: true, message: quietReason, field: "items" } : { invalid: false, message: "" } }} businessFormRevision={0}
    reasonPlaceholder="写清导出用途和接收人，例如：对账工单号、发给谁"
    onClose={onClose}
    onConfirm={async reason => {
      try {
        setResult(await ports.submit({ month, scope, types: selected }, reason));
      } catch (error) {
        if (isExportPermissionDenied(error)) {
          ports.invalidateAccess();
          throw error;
        }
        if (!(error instanceof ExportOutcomeUnknownError)) {
          recheck(selected);
          throw error;
        }
        setOriginalReason(reason);
        setOriginal(ports.pendingSubmit());
        setConfirmationRevision(value => value + 1);
      }
    }} />;
}
