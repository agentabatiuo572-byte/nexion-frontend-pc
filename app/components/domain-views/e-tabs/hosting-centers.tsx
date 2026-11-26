"use client";

/**
 * E1 托管机房清单（B55）。8 个托管机房：显示名、启用、权重。新设备交付时按启用机房的权重随机分配，已交付的设备不变。
 * 整份清单一起改、一起提交审批（后端按整份清单的修改序号防覆盖），所以这页不按单项保存。
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Clock3, HelpCircle, Hourglass, Pencil, RefreshCw, Server, ShieldAlert, XCircle } from "lucide-react";
import {
  BlockState, Button, Cell, Check, Conclusion, Decision, DiffList, Drawer, Fact, Facts, Fold, Input, Notice, NumberInput, PageHeader, Panel,
  RatioBar, RdPage, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr, type DiffRow,
} from "@/app/components/rd";
import { OperationConfirmModal } from "../design-kit";
import { E1Page } from "./e1-page";
import { RECOVERY_LINE, RecoveryPanel, recoveryTitle, type RecoveryItem } from "./e-command-check";
import { displayAdminError, formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, type A2OperationRow } from "@/lib/admin/a2-client";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { isDeterministicRejection } from "@/lib/admin/outcome-classification";
import { createPendingMutationStore, isRetryExpired, PENDING_MUTATION_TTL_MS, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { roleLabel } from "@/lib/nav/console-nav";
import { APP_VISIBLE_TEXT_HINT, containsHan } from "@/lib/admin/content-language-rules";
import { businessClock, businessStamp, businessZone } from "@/lib/admin/business-time";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useReach } from "@/lib/nav/use-reach";
import "./hosting-centers.css";

type Center = { id: string; name: string; enabled: boolean; weight: number };
type HostingState = { revision: number; centers: Center[] };
type DraftRow = { id: string; name: string; enabled: boolean; weight: string };
type HostingReceipt = PendingMutationRecord & {
  key: string;
  status: "unknown" | "pending" | "rejected" | "conflict" | "expired";
  changes: DiffRow[];
  request: Parameters<typeof createA2OperationProposal>[0];
  ticketId?: string;
  /** 后台写的驳回或拒绝原因（已翻成中文）。 */
  why?: string;
};

const HOSTING_OPERATION = "e1_hosting_centers_update";
const SLOT = "e1-hosting-centers";
const hostingRecords = createPendingMutationStore<HostingReceipt>({
  storageKey: "nexion-admin-e1-hosting-centers",
  retainExpiredRecords: true,
  isValidRecord: row => row.fingerprint === SLOT && row.commandKey === row.key && Array.isArray(row.changes)
    && ["unknown", "pending", "rejected", "conflict", "expired"].includes(row.status)
    && row.request?.command?.op === HOSTING_OPERATION && row.request?.command?.domain === "E"
    && row.request.obj === "default" && row.request.sourceDomain === "E1"
    && Array.isArray(row.request.command.params?.centers),
});

const NAME_MAX = 128;
const APPROVER = "另一位有审批权限和商品修改权限的管理员";

/** 后台错误码的中文说明；只在这页用到，接逻辑时可以并进 lib/admin/error-messages。 */
const HOSTING_ERRORS: Record<string, string> = {
  HOSTING_CENTERS_UNAVAILABLE: "清单存的内容读不出来。修好之前这页不能修改，请联系值班技术。",
  HOSTING_CENTERS_REVISION_CONFLICT: "清单已被别人改过，这次没有提交。",
  HOSTING_CENTERS_ENABLED_REQUIRED: "至少要启用一个机房，这次没有提交。",
  HOSTING_CENTERS_INVALID: "有机房的名称或权重不合规，这次没有提交。",
};

function hostingError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const code = Object.keys(HOSTING_ERRORS).find(key => message.includes(key));
  return code ? HOSTING_ERRORS[code] : `${message || "读取失败。"}读到之前不能修改。`;
}

async function readHostingCenters(): Promise<HostingState> {
  const response = await guardedFetch("/api/admin/config/hosting-centers", { cache: "no-store" });
  const result = await response.json().catch(() => null) as { code?: number; message?: string; data?: { revision?: unknown; centers?: unknown } } | null;
  if (!response.ok || !result || result.code !== 0) {
    const code = Object.keys(HOSTING_ERRORS).find(key => result?.message?.includes(key));
    throw new Error(code ?? formatAdminApiError(result?.message, `HOSTING_CENTERS_READ_FAILED_${response.status}`, "read"));
  }
  const { revision, centers } = result.data ?? {};
  const rows = Array.isArray(centers) ? centers as Record<string, unknown>[] : [];
  const valid = Number.isSafeInteger(revision) && (revision as number) >= 0 && rows.length === 8 && rows.every(row =>
    row != null && typeof row.id === "string" && typeof row.name === "string" && typeof row.enabled === "boolean" && Number.isSafeInteger(row.weight) && (row.weight as number) >= 1);
  if (!valid) throw new Error("HOSTING_CENTERS_UNAVAILABLE");
  return { revision: revision as number, centers: rows.map(row => ({ id: row.id as string, name: row.name as string, enabled: row.enabled as boolean, weight: row.weight as number })) };
}

/** 新设备分到这个机房的机会：权重 ÷ 启用机房的权重合计。停用的不分。 */
function shareText(weight: number, total: number) {
  if (total <= 0) return "—";
  const pct = (weight / total) * 100;
  return `${Number.isInteger(pct) ? pct : pct.toFixed(1)}%`;
}

function nameIssue(name: string) {
  const value = name.trim();
  if (!value) return "请填写机房名称";
  if (containsHan(value)) return "名称不能包含中文，请改成英文";
  if (value.length > NAME_MAX) return `名称最多 ${NAME_MAX} 个字符`;
  if (/[\u0000-\u001f\u007f]/.test(value)) return "名称里有不可见的控制字符";
}

function weightIssue(weight: string) {
  return /^[1-9]\d{0,8}$/.test(weight.trim()) ? undefined : "填正整数";
}

const toDraft = (centers: Center[]): DraftRow[] => centers.map(center => ({ ...center, weight: String(center.weight) }));
const stateText = (enabled: boolean) => enabled ? "启用" : "停用";

function changesOf(before: Center[], draft: DraftRow[]): DiffRow[] {
  return draft.flatMap((row) => {
    const old = before.find(center => center.id === row.id)!;
    const parts: DiffRow[] = [];
    if (row.name.trim() !== old.name) parts.push({ key: `${row.id}:name`, label: `${old.name} · 名称`, before: old.name, after: row.name.trim() });
    if (row.enabled !== old.enabled) parts.push({ key: `${row.id}:enabled`, label: `${old.name} · 状态`, before: stateText(old.enabled), after: stateText(row.enabled) });
    if (row.weight.trim() !== String(old.weight)) parts.push({ key: `${row.id}:weight`, label: `${old.name} · 权重`, before: String(old.weight), after: row.weight.trim() });
    return parts;
  });
}

export function HostingCentersPage({ onBack }: { onBack?: () => void } = {}) {
  const authorities = useAdminAuth(s => s.session?.authorities ?? []);
  const canRead = authorities.includes("device_e1_read");
  const canWrite = canRead && authorities.includes("device_e1_write") && authorities.some(code => code === "platform_a2_proposal_create" || code === "platform_a2_write");
  const owner = useAdminAuth(s => s.session?.adminId);
  const reach = useReach();
  const canOpenAudit = reach("/platform/audit", "platform_a2_read");
  const [state, setState] = useState<HostingState | null>(null);
  const [loading, setLoading] = useState(canRead);
  const [error, setError] = useState<string | null>(null);
  const [readAt, setReadAt] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftRow[] | null>(null);
  const [baseline, setBaseline] = useState<HostingState | null>(null);
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [receipts, setReceipts] = useState<HostingReceipt[]>([]);
  const [conflict, setConflict] = useState<{ draft: DraftRow[]; changes: DiffRow[] } | null>(null);
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  useEffect(() => { setReceipts(hostingRecords.list()); }, [owner]);

  function remember(receipt: HostingReceipt) {
    hostingRecords.remember(receipt.fingerprint, receipt.key, receipt);
    setReceipts(hostingRecords.list());
  }

  function dismiss(receipt: HostingReceipt) {
    hostingRecords.forget(receipt.fingerprint, receipt.key);
    setReceipts(hostingRecords.list());
  }

  const reload = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    try {
      const latest = await readHostingCenters();
      setState(latest);
      setReadAt(Date.now());
      setError(null);
      return latest;
    } catch (cause) {
      setState(null);
      setError(hostingError(cause));
    } finally {
      setLoading(false);
    }
  }, [canRead]);
  useEffect(() => { void reload(); }, [reload]);

  async function handleCreationConflict(receipt: HostingReceipt) {
    dismiss(receipt);
    setConflict({ draft: toDraft(receipt.request.command.params.centers as Center[]), changes: receipt.changes });
    setConfirming(false);
    setDraft(null);
    await reload();
  }

  async function applyTicket(receipt: HostingReceipt, ticket: A2OperationRow) {
    if (!ticket.mine || ticket.obj !== "default" || ticket.operationCode !== HOSTING_OPERATION) {
      throw new Error("A2_RESPONSE_UNREADABLE");
    }
    if (ticket.status === "approved") {
      dismiss(receipt);
      await reload();
    } else {
      const status = ticket.status === "pending" || ticket.status === "expired" ? ticket.status : "rejected";
      remember({ ...receipt, status, ticketId: ticket.id });
    }
  }

  async function recover(receipt: HostingReceipt, retry: boolean) {
    if (receiptBusy) return;
    setReceiptBusy(true);
    setReceiptError(null);
    let resending = false;
    try {
      const ticket = await fetchA2ProposalByKey(receipt.key, true, "metadata");
      if (ticket) await applyTicket(receipt, ticket);
      else if (retry && canWrite && receipt.status === "unknown") {
        if (isRetryExpired(receipt)) throw new Error(RETRY_EXPIRED_TEXT);
        resending = true;
        await applyTicket(receipt, await createA2OperationProposal(receipt.request, receipt.key, "proposal"));
      }
    } catch (cause) {
      const code = (cause as { backendMessage?: string }).backendMessage;
      if (resending && code === "HOSTING_CENTERS_REVISION_CONFLICT" && isExplicitRejection(cause)) {
        await handleCreationConflict(receipt);
      } else if (resending && isExplicitRejection(cause)) {
        remember({ ...receipt, status: "rejected", why: code ? HOSTING_ERRORS[code] ?? displayAdminError(cause) : displayAdminError(cause) });
        await reload();
      } else setReceiptError(displayAdminError(cause));
    } finally {
      setReceiptBusy(false);
    }
  }

  const centers = state?.centers ?? [];
  const enabled = centers.filter(center => center.enabled);
  const total = enabled.reduce((sum, center) => sum + center.weight, 0);
  const pending = receipts.find(receipt => receipt.status === "pending" || receipt.status === "unknown");
  const editBlock = !state ? "清单读到之后才能编辑" : pending ? pending.status === "pending" ? "有一份修改在等批准，批准或驳回后才能再改" : "上一次提交结果未知，先查询原操作" : undefined;

  const draftChanges = draft && baseline ? changesOf(baseline.centers, draft) : [];
  const draftIssues = draft ? draft.map(row => ({ id: row.id, name: nameIssue(row.name), weight: weightIssue(row.weight) })) : [];
  const draftEnabled = draft?.filter(row => row.enabled) ?? [];
  const draftTotal = draftEnabled.reduce((sum, row) => sum + (weightIssue(row.weight) ? 0 : Number(row.weight)), 0);
  const draftInvalid = draftIssues.some(issue => issue.name || issue.weight);
  const submitBlock = !draft ? undefined : !draftChanges.length ? "还没有改动" : !draftEnabled.length ? "至少要启用一个机房" : draftInvalid ? "有名称或权重要改" : undefined;

  const openEdit = (from?: DraftRow[]) => {
    if (!state) return;
    setBaseline(state);
    setDraft(from ?? toDraft(centers));
    setTouched(false);
  };
  const setRow = (id: string, patch: Partial<DraftRow>) => setDraft(rows => rows && rows.map(row => row.id === id ? { ...row, ...patch } : row));

  const recoveryItems: RecoveryItem[] = receipts.map(receipt => {
    const tag = {
      unknown: <StatusTag tone="warn" icon={HelpCircle}>结果未知</StatusTag>,
      pending: <StatusTag tone="warn" icon={Clock3}>待审批</StatusTag>,
      rejected: <StatusTag tone="neutral" icon={XCircle}>已驳回</StatusTag>,
      conflict: <StatusTag tone="neutral" icon={ShieldAlert}>批准时被拒</StatusTag>,
      expired: <StatusTag tone="neutral" icon={Hourglass}>已过期</StatusTag>,
    }[receipt.status];
    const line = {
      unknown: RECOVERY_LINE.unknown,
      pending: `等${APPROVER}批准，批准前仍按现在的清单分配。`,
      rejected: "原修改没有生效；需要时按现在的清单重新提交。",
      conflict: "批准时清单已被别人改过，原修改没有生效；核对现在的清单后重新提交。",
      expired: "过期没人处理，原修改没有生效；需要时重新提交。",
    }[receipt.status];
    return {
      key: receipt.key,
      object: `调整托管机房清单 · 改 ${receipt.changes.length} 处`,
      createdAt: receipt.createdAt,
      tag,
      line,
      actions: <>
        {(receipt.status === "unknown" || receipt.status === "pending") && <Button size="sm" loading={receiptBusy} onClick={() => void recover(receipt, false)}>查询原操作</Button>}
        {receipt.status === "unknown" && <Button size="sm" disabledReason={canWrite ? undefined : "当前账号没有提交权限"} loading={receiptBusy} onClick={() => void recover(receipt, true)}>按原操作重试</Button>}
        {receipt.status !== "unknown" && receipt.status !== "pending" && <Button size="sm" variant="ghost" onClick={() => dismiss(receipt)}>知道了</Button>}
      </>,
      detail: <Facts>
        <Fact k="提交时间">{`${businessStamp(receipt.createdAt)}（${businessZone().label}）`}</Fact>
        <Fact k="改了什么"><DiffList rows={receipt.changes} /></Fact>
        {(receipt.why || (receipt === pending && receiptError)) && <Fact k="原因">{receipt.why || receiptError}</Fact>}
      </Facts>,
      tech: receipt.ticketId ? <Facts><Fact k="审批单">{receipt.ticketId}</Fact></Facts> : undefined,
    };
  });
  const waiting = receipts.filter(receipt => receipt.status === "pending").length;
  const unknown = receipts.filter(receipt => receipt.status === "unknown").length;
  const ended = receipts.length - waiting - unknown;

  const header = (
    <PageHeader pageId="E1H" title="托管机房"
      back={onBack ? <button type="button" id="hc-back" className="rd-link hc-back" onClick={onBack}><ArrowLeft size={14} aria-hidden />返回商品管理与上架条件</button> : undefined}
      summary="新设备交付时按权重随机分到启用的机房，已交付的设备不变。"
      meta={readAt ? `${businessClock(readAt)} 读取（${businessZone().label}）` : undefined}
      readOnly={canRead && !canWrite ? "当前账号只能查看" : undefined}
      actions={canRead ? <>
        <Button icon={<RefreshCw size={14} aria-hidden />} loading={loading} loadingText="正在加载…" onClick={() => void reload()}>刷新</Button>
        {canWrite && <Button variant="primary" icon={<Pencil size={14} aria-hidden />} disabledReason={editBlock} onClick={() => openEdit()}>编辑清单</Button>}
      </> : undefined} />
  );

  const recovery = recoveryItems.length > 0 && (
    <RecoveryPanel tone={unknown ? "warn" : "progress"} title={recoveryTitle(unknown, waiting, ended)} label="托管机房清单的修改"
      explain={<>
        <p>整份清单一次只能有一份修改在等批准；批准或驳回之前，这页不能再提交。</p>
        <p>结果未知：提交时没收到确定结果。先查询原操作；查不到、又没过 24 小时，可以按原操作重试，不会建第二张审批单。</p>
        <p>批准时会再核对清单有没有被别人改过；改过就不执行，要按现在的清单重新提交。</p>
      </>}
      foot={canOpenAudit ? <Link className="rd-link" href="/platform/audit?domain=E" prefetch={false}>到操作记录与审批核对</Link> : undefined}
      items={recoveryItems} />
  );

  const conflictNotice = conflict && state && (
    <Notice tone="warn" title="没有提交：清单已被别人改过"
      action={<><Button size="sm" onClick={() => { openEdit(toDraft(centers).map(row => {
        const edited = conflict.draft.find(item => item.id === row.id);
        if (!edited) return row;
        const changed = (field: string) => conflict.changes.some(change => change.key === `${row.id}:${field}`);
        return { ...row,
          name: changed("name") ? edited.name : row.name,
          enabled: changed("enabled") ? edited.enabled : row.enabled,
          weight: changed("weight") ? edited.weight : row.weight,
        };
      })); setConflict(null); }}>按现在的清单重新编辑</Button><Button size="sm" variant="ghost" onClick={() => setConflict(null)}>放弃这次修改</Button></>}>
      已读到最新清单。你这次填的内容还留着，重新编辑时会带上，核对后再提交。
    </Notice>
  );

  // 重试读到后焦点落在「机房和分配比例」标题，不落到整页外框（BUG-710）。
  const centersTitle = { get current() { return document.querySelector(".hc-table")?.closest("section")?.querySelector<HTMLElement>(".rd-panel-title") ?? null; } };
  let body;
  if (!canRead) body = <BlockState state="denied" title="没有查看托管机房的权限" detail="要有商品管理的查看权限。" />;
  // 读取失败后重试：失败块留在原处写「重试中…」，焦点不掉；读到了再换成表格（BlockState 交接焦点）。
  else if (error && !state) body = <BlockState state="error" title="托管机房清单加载失败" detail={error} onRetry={() => void reload()} retrying={loading} afterRetryFocus={centersTitle} />;
  else if (loading && !state) body = <Panel title="机房和分配比例" icon={Server} tone="role-2" flush><Table label="托管机房"><tbody><TableLoading columns={4} /></tbody></Table></Panel>;
  else if (state) {
    const defaults = state.revision === 0;
    body = <>
      <Conclusion state={!enabled.length ? "danger" : waiting || unknown ? "warn" : "neutral"} icon={Server}
        explain={<>
          <p>新设备交付时，按启用机房的权重随机分配：权重 2 的机房被分到的机会是权重 1 的两倍。停用的机房不再分到新设备，已经分在那里的设备不变。</p>
          <p>{defaults ? "还没人改过清单，用的是系统默认：8 个都启用，权重都是 1。" : "清单改过后，以最近一次批准的为准。"}</p>
        </>}>
        {!enabled.length ? "没有启用的机房，新设备分不到机房" : enabled.length === centers.length ? `${centers.length} 个机房都启用` : `${enabled.length} 个机房启用，${centers.length - enabled.length} 个停用`}
        {defaults && enabled.length > 0 && "；用的是系统默认清单"}
        {waiting > 0 && "；有一份修改在等批准"}
        {unknown > 0 && "；上一次提交结果未知，先查询原操作"}
      </Conclusion>
      <Panel title="机房和分配比例" icon={Server} tone="role-2" flush sub={`${centers.length} 个 · 启用的权重合计 ${total}`}
        explain="「新设备约占」是一台新设备分到这个机房的机会，等于它的权重除以启用机房的权重合计。实际分配是随机的，台数少时会和比例有出入。">
        <Table label="托管机房" className="hc-table">
          <thead><tr><Th>机房</Th><Th>状态</Th><Th align="right">权重</Th><Th>新设备约占</Th></tr></thead>
          <tbody>
            {centers.length ? centers.map(center => <Tr key={center.id}>
              <Td><Cell main={center.name} title={center.name} /></Td>
              <Td>{center.enabled ? <StatusTag tone="ok">启用</StatusTag> : <StatusTag tone="done">停用</StatusTag>}</Td>
              <Td align="right" data-num="">{center.weight}</Td>
              <Td grow>{center.enabled
                ? <span className="hc-share"><RatioBar label={`${center.name} 新设备约占`} value={center.weight} total={total} valueText={`约占 ${shareText(center.weight, total)}`} tone="role-2" compact quiet /><span className="hc-share-num">{shareText(center.weight, total)}</span></span>
                : <span className="hc-muted">停用，不分配新设备</span>}</Td>
            </Tr>) : <TableMessage columns={4}>没有机房</TableMessage>}
          </tbody>
        </Table>
      </Panel>
    </>;
  }

  const confirmFacts = state && draft && <Facts>
    <Fact k="改后">{`${draftEnabled.length} 个启用 · 权重合计 ${draftTotal}`}</Fact>
    <Fact k="谁来批">另一位管理员，不能是提交人</Fact>
    <Fact k="需有权限">审批权限和商品修改权限</Fact>
  </Facts>;
  const confirmChanges = state && draft && <div className="rd-impact">
    <div className="rd-impact-title">{`改了 ${draftChanges.length} 处`}</div>
    <Table label="改了什么" className="hc-change-table">
      <thead><tr><Th>机房</Th><Th>改了</Th><Th>现在</Th><Th>改后</Th></tr></thead>
      <tbody>{draftChanges.map(row => { const [center, field] = String(row.label).split(" · "); return <Tr key={row.key}>
        <Td>{center}</Td><Td>{field}</Td><Td>{row.before}</Td><Td><b>{row.after}</b></Td>
      </Tr>; })}</tbody>
    </Table>
  </div>;

  return <RdPage className="hc-page">
    {header}
    {recovery}
    {conflictNotice}
    {body}
    {draft && state && <Drawer open title="编辑托管机房清单" icon={Server} tone="role-2" sub={`${draftEnabled.length} 个启用 · 权重合计 ${draftTotal || "—"}`}
      explain="整份清单一起提交审批，批准后才生效；批准前仍按现在的清单分配。"
      busy={confirming} onClose={() => setDraft(null)}
      footer={<Decision note={touched ? submitBlock : undefined}
        others={<Button onClick={() => setDraft(null)}>取消</Button>}
        primary={<Button variant="primary" disabledReason={submitBlock} onBlockedClick={() => setTouched(true)} onClick={() => setConfirming(true)}>核对并提交审批</Button>} />}>
      {!draftEnabled.length && <Notice tone="warn" title="至少要启用一个机房">全部停用后新设备分不到机房，这样的清单不能提交。</Notice>}
      <Table label="编辑托管机房" className="hc-edit-table">
        <thead><tr><Th>机房名称</Th><Th>启用</Th><Th>权重</Th><Th>新设备约占</Th></tr></thead>
        <tbody>{draft.map((row, index) => {
          const issue = draftIssues[index];
          const showName = issue.name && (touched || row.name !== baseline?.centers[index].name);
          const showWeight = issue.weight && (touched || row.weight !== String(baseline?.centers[index].weight));
          return <Tr key={row.id}>
            <Td grow>
              <Input aria-label={`第 ${index + 1} 个机房的名称`} value={row.name} maxLength={NAME_MAX + 8} aria-invalid={showName ? true : undefined} onChange={event => setRow(row.id, { name: event.target.value })} />
              {showName && <span className="hc-field-error" role="alert">{issue.name}</span>}
            </Td>
            <Td><Check label={<span className="rd-sr-only">{`启用 ${row.name || `第 ${index + 1} 个机房`}`}</span>} checked={row.enabled} onChange={event => setRow(row.id, { enabled: event.target.checked })} /></Td>
            <Td>
              <NumberInput aria-label={`${row.name || `第 ${index + 1} 个机房`}的权重`} value={row.weight} min={1} step={1} onChange={event => setRow(row.id, { weight: event.target.value })} />
              {showWeight && <span className="hc-field-error" role="alert">{issue.weight}</span>}
            </Td>
            <Td data-num="">{row.enabled ? weightIssue(row.weight) || !draftTotal ? "—" : shareText(Number(row.weight), draftTotal) : <span className="hc-muted">不分配</span>}</Td>
          </Tr>;
        })}</tbody>
      </Table>
      <Fold title="怎么填" summary={`名称 ${APP_VISIBLE_TEXT_HINT}，最多 ${NAME_MAX} 个字符；权重是 1 起的整数`} inset>
        <ul className="hc-help">
          <li>名称写进新交付的设备，显示在 App 订单和设备详情里。</li>
          <li>权重越大，分到的新设备越多；停用的机房也要留着权重，重新启用后按这个权重分配。</li>
          <li>已交付的设备不会因为改名、停用或调权重而换机房。</li>
        </ul>
      </Fold>
    </Drawer>}
    {confirming && draft && state && <OperationConfirmModal briefKind="config"
      action="调整托管机房清单" title="提交托管机房清单"
      detail="批准后，之后交付的新设备按新清单分配；已交付的设备不变。"
      effect={<StatusTag tone="progress" filled explain={`${APPROVER}批准后才生效，提交人不能批自己的；批准前仍按现在的清单分配。`}>批准后生效</StatusTag>}
      facts={confirmFacts}
      content={confirmChanges}
      statedBrief={{ impact: "批准后，之后交付的新设备按新清单分配；已交付的设备不变。", check: "核对改了的名称、启用和权重；理由写清依据。" }}
      confirmLabel="提交审批" reasonPlaceholder="例如：托管合同编号、机房变更通知"
      onClose={() => setConfirming(false)}
      onConfirm={async (reason) => {
        const auth = useAdminAuth.getState();
        const session = auth.session;
        if (!canWrite || !session || session.adminId !== owner || !auth.isAuthenticated || auth.logoutPending) throw new Error("ADMIN_PERMISSION_DENIED");
        if (!baseline || submitBlock || hostingRecords.list().some(r => r.status === "unknown" || r.status === "pending")) {
          throw new Error(submitBlock ?? "OBJECT_ALREADY_PENDING");
        }
        const now = Date.now();
        const key = createA2CommandKey(SLOT);
        const receipt: HostingReceipt = {
          fingerprint: SLOT, commandKey: key, key, createdAt: now, expiresAt: now + PENDING_MUTATION_TTL_MS,
          status: "unknown", changes: draftChanges,
          request: {
            action: "调整托管机房清单", obj: "default", beforeValue: "托管机房当前清单", afterValue: "托管机房拟发布清单",
            operator: session.operator || session.username, operatorRole: roleLabel(session.role),
            type: "param", amplifies: false, sos: false, roleGate: APPROVER, reason, sourceDomain: "E1",
            command: { domain: "E", op: HOSTING_OPERATION, params: {
              expectedRevision: baseline.revision,
              centers: draft.map(row => ({ ...row, name: row.name.trim(), weight: Number(row.weight) })),
            } },
            target: { domain: "E", type: "hosting_centers", id: "default" },
          },
        };
        remember(receipt);
        if (!hostingRecords.isDurablyStored(SLOT, key)) {
          dismiss(receipt);
          throw new Error("浏览器无法保存原请求，这次没有提交。");
        }
        try {
          await applyTicket(receipt, await createA2OperationProposal(receipt.request, key, "proposal"));
        } catch (cause) {
          const { backendMessage: code, httpStatus, apiCode } = cause as { backendMessage?: string; httpStatus?: number; apiCode?: number };
          if (httpStatus === undefined || !isDeterministicRejection(httpStatus, apiCode)) {
            setConfirming(false);
            setDraft(null);
            return;
          }
          if (code === "HOSTING_CENTERS_REVISION_CONFLICT") {
            await handleCreationConflict(receipt);
            return;
          }
          dismiss(receipt);
          throw code && HOSTING_ERRORS[code] ? new Error(HOSTING_ERRORS[code]) : cause;
        }
        setConfirming(false);
        setDraft(null);
        await reload();
      }} />}
  </RdPage>;
}

type Area = "catalog" | "hosting";

/** E1 路由下的两个视图：商品管理与上架条件（默认）、托管机房（页头按钮进入）。用网址里的 area=hosting 记住当前视图。 */
export function E1Area() {
  const canRead = useAdminAuth(s => s.session?.authorities.includes("device_e1_read") ?? false);
  const [area, setArea] = useState<Area>("catalog");
  const [focusTo, setFocusTo] = useState<string | null>(null);
  useEffect(() => { if (new URLSearchParams(window.location.search).get("area") === "hosting") setArea("hosting"); }, []);
  useEffect(() => { if (focusTo) { document.getElementById(focusTo)?.focus(); setFocusTo(null); } }, [focusTo, area]);
  const change = (next: Area) => {
    setArea(next);
    setFocusTo(next === "hosting" ? "hc-back" : "e1-hosting-entry");
    const url = new URL(window.location.href);
    if (next === "hosting") url.searchParams.set("area", "hosting"); else url.searchParams.delete("area");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };
  if (!canRead) return <E1Page />;
  return area === "hosting" ? <HostingCentersPage onBack={() => change("catalog")} /> : <E1Page onOpenHosting={() => change("hosting")} />;
}
