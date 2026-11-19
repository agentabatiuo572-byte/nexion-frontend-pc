"use client";

/**
 * E1 托管机房清单（B55）。8 个托管机房：显示名、启用、权重。新设备交付时按启用机房的权重随机分配，已交付的设备不变。
 * 整份清单一起改、一起提交审批（后端按整份清单的修改序号防覆盖），所以这页不按单项保存。
 *
 * 界面由视觉 worker 搭好，逻辑等代码 worker（pc-wire）接：
 * - PLACEHOLDER(pc-wire) 读取：`GET /api/admin/config/hosting-centers` 还没进 lib/admin，也没进 app/api/admin/config 的代理白名单。
 * - PLACEHOLDER(pc-wire) 提交：A2 操作 `e1_hosting_centers_update`（参数 expectedRevision、centers）还没进 high-ops 注册表，提交按钮先拒绝。
 * - PLACEHOLDER(pc-wire) 原操作记录：`receipts` 由提交、查询原结果填写；现在一直为空，面板和每种状态的样子已备好。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Clock3, HelpCircle, Hourglass, Pencil, RefreshCw, Server, ShieldAlert, XCircle } from "lucide-react";
import {
  BlockState, Button, Cell, Check, Conclusion, Decision, DiffList, Drawer, Fact, Facts, Fold, Input, Notice, NumberInput, PageHeader, PageTabs, Panel,
  RatioBar, RdPage, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr, useTabIds, type DiffRow,
} from "@/app/components/rd";
import { OperationConfirmModal } from "../design-kit";
import { E1Page } from "./e1-page";
import { RECOVERY_LINE, RecoveryPanel, recoveryTitle, type RecoveryItem } from "./e-command-check";
import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { APP_VISIBLE_TEXT_HINT, containsHan } from "@/lib/admin/content-language-rules";
import { businessClock, businessStamp, businessZone } from "@/lib/admin/business-time";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useReach } from "@/lib/nav/use-reach";
import "./hosting-centers.css";

type Center = { id: string; name: string; enabled: boolean; weight: number };
type HostingState = { revision: number; centers: Center[] };
type DraftRow = { id: string; name: string; enabled: boolean; weight: string };
/** 一次提交的原操作记录。status 由代码 worker 按审批单读回填写。 */
type HostingReceipt = {
  key: string;
  status: "unknown" | "pending" | "rejected" | "conflict" | "expired";
  createdAt: number;
  changes: DiffRow[];
  ticketId?: string;
  /** 后台写的驳回或拒绝原因（已翻成中文）。 */
  why?: string;
};

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

/** PLACEHOLDER(pc-wire)：接口和代理白名单接好后搬进 lib/admin。只在这里校验一次后端给的形状。 */
async function readHostingCenters(): Promise<HostingState> {
  const response = await guardedFetch("/api/admin/config/hosting-centers", { cache: "no-store" });
  const result = await response.json().catch(() => null) as { code?: number; message?: string; data?: { revision?: unknown; centers?: unknown } } | null;
  if (!response.ok || !result || result.code !== 0) {
    const code = Object.keys(HOSTING_ERRORS).find(key => result?.message?.includes(key));
    throw new Error(code ?? formatAdminApiError(result?.message, `HOSTING_CENTERS_READ_FAILED_${response.status}`));
  }
  const { revision, centers } = result.data ?? {};
  const rows = Array.isArray(centers) ? centers as Record<string, unknown>[] : [];
  const valid = Number.isSafeInteger(revision) && (revision as number) >= 0 && rows.length === 8 && rows.every(row =>
    typeof row.id === "string" && typeof row.name === "string" && typeof row.enabled === "boolean" && Number.isSafeInteger(row.weight) && (row.weight as number) >= 1);
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

export function HostingCentersPage() {
  const authorities = useAdminAuth(s => s.session?.authorities ?? []);
  const canRead = authorities.includes("device_e1_read");
  const canWrite = canRead && authorities.includes("device_e1_write") && authorities.some(code => code === "platform_a2_proposal_create" || code === "platform_a2_write");
  const reach = useReach();
  const canOpenAudit = reach("/platform/audit", "platform_a2_read");
  const [state, setState] = useState<HostingState | null>(null);
  const [loading, setLoading] = useState(canRead);
  const [error, setError] = useState<string | null>(null);
  const [readAt, setReadAt] = useState<number | null>(null);
  const [draft, setDraft] = useState<DraftRow[] | null>(null);
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // PLACEHOLDER(pc-wire)：提交和查询原结果填写；被别人改过时由提交失败写入 conflict。
  const [receipts, setReceipts] = useState<HostingReceipt[]>([]);
  const [conflict, setConflict] = useState<DraftRow[] | null>(null);

  const reload = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    try {
      setState(await readHostingCenters());
      setReadAt(Date.now());
      setError(null);
    } catch (cause) {
      setError(hostingError(cause));
    } finally {
      setLoading(false);
    }
  }, [canRead]);
  useEffect(() => { void reload(); }, [reload]);

  const centers = state?.centers ?? [];
  const enabled = centers.filter(center => center.enabled);
  const total = enabled.reduce((sum, center) => sum + center.weight, 0);
  const pending = receipts.find(receipt => receipt.status === "pending" || receipt.status === "unknown");
  const editBlock = !state ? "清单读到之后才能编辑" : pending ? pending.status === "pending" ? "有一份修改在等批准，批准或驳回后才能再改" : "上一次提交结果未知，先查询原结果" : undefined;

  const draftChanges = draft && state ? changesOf(state.centers, draft) : [];
  const draftIssues = draft ? draft.map(row => ({ id: row.id, name: nameIssue(row.name), weight: weightIssue(row.weight) })) : [];
  const draftEnabled = draft?.filter(row => row.enabled) ?? [];
  const draftTotal = draftEnabled.reduce((sum, row) => sum + (weightIssue(row.weight) ? 0 : Number(row.weight)), 0);
  const draftInvalid = draftIssues.some(issue => issue.name || issue.weight);
  const submitBlock = !draft ? undefined : !draftChanges.length ? "还没有改动" : !draftEnabled.length ? "至少要启用一个机房" : draftInvalid ? "有名称或权重要改" : undefined;

  const openEdit = (from?: DraftRow[]) => { setDraft(from ?? toDraft(centers)); setTouched(false); };
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
        {(receipt.status === "unknown" || receipt.status === "pending") && <Button size="sm" onClick={() => undefined /* PLACEHOLDER(pc-wire) 查询原结果 */}>查询原结果</Button>}
        {receipt.status === "unknown" && <Button size="sm" disabledReason={canWrite ? undefined : "当前账号没有提交权限"} onClick={() => undefined /* PLACEHOLDER(pc-wire) 按原请求重试 */}>按原请求重试</Button>}
        {receipt.status !== "unknown" && receipt.status !== "pending" && <Button size="sm" variant="ghost" onClick={() => setReceipts(rows => rows.filter(row => row.key !== receipt.key))}>知道了</Button>}
      </>,
      detail: <Facts>
        <Fact k="提交时间">{`${businessStamp(receipt.createdAt)}（${businessZone().label}）`}</Fact>
        <Fact k="改了什么"><DiffList rows={receipt.changes} /></Fact>
        {receipt.why && <Fact k="原因">{receipt.why}</Fact>}
      </Facts>,
      tech: receipt.ticketId ? <Facts><Fact k="审批单">{receipt.ticketId}</Fact></Facts> : undefined,
    };
  });
  const waiting = receipts.filter(receipt => receipt.status === "pending").length;
  const unknown = receipts.filter(receipt => receipt.status === "unknown").length;
  const ended = receipts.length - waiting - unknown;

  const header = (
    <PageHeader pageId="E1H" title="托管机房"
      summary="新设备交付时按权重随机分到启用的机房，已交付的设备不变。"
      meta={readAt ? `${businessClock(readAt)} 读取（${businessZone().label}）` : undefined}
      readOnly={canRead && !canWrite ? "当前账号只能查看" : undefined}
      actions={canRead ? <>
        <Button icon={<RefreshCw size={14} aria-hidden />} loading={loading} loadingText="读取中…" onClick={() => void reload()}>刷新</Button>
        {canWrite && <Button variant="primary" icon={<Pencil size={14} aria-hidden />} disabledReason={editBlock} onClick={() => openEdit()}>编辑清单</Button>}
      </> : undefined} />
  );

  const recovery = recoveryItems.length > 0 && (
    <RecoveryPanel tone={unknown ? "warn" : "progress"} title={recoveryTitle(unknown, waiting, ended)} label="托管机房清单的修改"
      explain={<>
        <p>整份清单一次只能有一份修改在等批准；批准或驳回之前，这页不能再提交。</p>
        <p>结果未知：提交时没收到确定结果。先查询原结果；查不到、又没过 24 小时，可以按原请求重试，不会建第二张审批单。</p>
        <p>批准时会再核对清单有没有被别人改过；改过就不执行，要按现在的清单重新提交。</p>
      </>}
      foot={canOpenAudit ? <Link className="rd-link" href="/platform/audit?domain=E" prefetch={false}>到操作记录与审批核对</Link> : undefined}
      items={recoveryItems} />
  );

  const conflictNotice = conflict && (
    <Notice tone="warn" title="没有提交：清单已被别人改过"
      action={<><Button size="sm" onClick={() => { openEdit(conflict); setConflict(null); }}>按现在的清单重新编辑</Button><Button size="sm" variant="ghost" onClick={() => setConflict(null)}>放弃这次修改</Button></>}>
      已读到最新清单。你这次填的内容还留着，重新编辑时会带上，核对后再提交。
    </Notice>
  );

  let body;
  if (!canRead) body = <BlockState state="denied" title="没有查看托管机房的权限" detail="要有商品管理的查看权限。" />;
  else if (loading && !state) body = <Panel title="机房和分配比例" icon={Server} tone="role-2" flush><Table label="托管机房"><tbody><TableLoading columns={4} /></tbody></Table></Panel>;
  else if (error && !state) body = <BlockState state="error" title="托管机房清单读取失败" detail={error} onRetry={() => void reload()} retrying={loading} />;
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
        {unknown > 0 && "；上一次提交结果未知，先查询原结果"}
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
    <Fact k="谁来批">{`${APPROVER}，不能是提交人`}</Fact>
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
          const showName = issue.name && (touched || row.name !== state.centers[index].name);
          const showWeight = issue.weight && (touched || row.weight !== String(state.centers[index].weight));
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
          <li>名称会写进新交付的设备，App 订单和设备详情里能看到，所以要用英文。</li>
          <li>权重越大，分到的新设备越多；停用的机房也要留一个权重，重新启用时按它分。</li>
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
      onConfirm={async () => {
        // PLACEHOLDER(pc-wire)：按 e1_hosting_centers_update 提交 { expectedRevision: state.revision, centers }，成功后写 receipts、关框、重读。
        throw new Error("提交还没接上后台，这次没有提交。");
      }} />}
  </RdPage>;
}

type Area = "catalog" | "hosting";

/** E1 路由下的两个区域：商品管理与上架条件、托管机房。用网址里的 area=hosting 记住当前区域。 */
export function E1Area() {
  const canRead = useAdminAuth(s => s.session?.authorities.includes("device_e1_read") ?? false);
  const ids = useTabIds();
  const [area, setArea] = useState<Area>("catalog");
  useEffect(() => { if (new URLSearchParams(window.location.search).get("area") === "hosting") setArea("hosting"); }, []);
  const change = (next: Area) => {
    setArea(next);
    const url = new URL(window.location.href);
    if (next === "hosting") url.searchParams.set("area", "hosting"); else url.searchParams.delete("area");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  };
  const items = useMemo(() => [{ value: "catalog" as const, label: "商品与上架条件" }, { value: "hosting" as const, label: "托管机房" }], []);
  if (!canRead) return <E1Page />;
  return <div className="hc-area">
    <div className="hc-area-tabs"><PageTabs label="商品管理分区" value={area} items={items} ids={ids} onChange={change} /></div>
    <div {...ids.panel(area)}>{area === "hosting" ? <HostingCentersPage /> : <E1Page />}</div>
  </div>;
}

