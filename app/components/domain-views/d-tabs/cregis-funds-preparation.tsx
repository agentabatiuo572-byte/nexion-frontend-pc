"use client";

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from "react";
import { ClipboardList, Plus, RefreshCw } from "lucide-react";
import { BlockState, Button, Cell, ConfigList, ConfigRow, Decision, Drawer, Fact, Facts, Field, Fold, Input, JudgmentPoints, KeyValues, Notice, Panel, Segments, Select, StatusTag, Table, Td, Th, Tr } from "@/app/components/rd";
import type { StateTone } from "@/app/components/rd";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { adminAuthActivityAllowed, adminAuthLifecycleEpoch } from "@/lib/admin/auth-lifecycle";
import { DRequestError, d1PendingObjectReason, financeAdminRequest } from "@/lib/admin/d-client";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { exceptionId, exceptionObject, exceptionPage, exceptionRead, type ExceptionPage, type ExceptionRecord, type ExceptionRequestScope } from "@/lib/admin/cregis-exceptions";
import { preparationAmount, preparationConfig, PREPARATION_BLOCKER, PREPARATION_GAS, PREPARATION_NETWORKS, PREPARATION_STATE, type PreparationConfig, type PreparationKind, type PreparationNetwork } from "@/lib/admin/cregis-funds-preparation";
import { LongValue, usdt, zoneLabel } from "./d1-shared";
import { businessStamp, parseBusinessTime } from "@/lib/admin/business-time";
import type { DCtx } from "./types";

const EMPTY: ExceptionPage = { records: [], hasMore: false, nextBeforeId: null };
const ROOT = "/funds-preparation";
const configurationTitle = (network: PreparationNetwork) => `${network} 收款配置还没完成`;
const configurationRequired = (failure: unknown) => failure instanceof DRequestError && failure.status === 503
  && failure.reasonCode === "CREGIS_PREPARATION_CONFIGURATION_REQUIRED";
const kindLabel = (kind: unknown) => kind === "COLLECTION" ? "归集到 Cregis 准备" : "Cregis 转平台收款钱包准备";
const planTone = (state: unknown): StateTone => state === "DRAFT" ? "warn" : state === "REVIEWED" ? "ok" : "done";
type Props = { canManage: boolean; openActionConfirm: DCtx["openActionConfirm"]; onChanged?: () => void; reloadKey?: number };

async function readPlans(network: PreparationNetwork, beforeId: string | null, request: ExceptionRequestScope) {
  const result = await exceptionRead(`${ROOT}/plans?network=${network}&limit=20&beforeId=${beforeId ? exceptionId(beforeId) : "0"}`, request);
  const page = exceptionPage(result);
  if (result.preparationNetwork !== network || page.records.some(row => row.network !== network)) {
    throw new Error("资金准备列表读取失败，请刷新核对");
  }
  return page;
}

export function CregisFundsPreparation(props: Props) {
  const [network, setNetwork] = useState<PreparationNetwork>("BEP20");
  // 切网络会换掉整块（key 带网络），新块挂上后把焦点还给网络选择，键盘用户不丢位置。
  const switched = useRef(false);
  const session = useAdminAuth(state => state.session), epoch = useAdminAuth(state => state.authEpoch);
  if (!session?.authorities.includes("finance_d1_read")) return null;
  return <OwnedPreparation key={`${network}:${props.reloadKey}:${session.adminId}:${epoch}:${adminAuthLifecycleEpoch()}:${props.canManage}:${session.authorities.join("|")}`}
    {...props} owner={session.adminId} ownerEpoch={epoch} network={network} switched={switched} onNetworkChange={next => { if (next === network) return; switched.current = true; setNetwork(next); }} />;
}

function OwnedPreparation({ canManage, openActionConfirm, onChanged, owner, ownerEpoch, network, switched, onNetworkChange }: Props & {
  owner: number; ownerEpoch: number; network: PreparationNetwork; switched: MutableRefObject<boolean>; onNetworkChange: (network: PreparationNetwork) => void;
}) {
  const lifecycle = useRef(adminAuthLifecycleEpoch()).current;
  const live = useRef(true), mutation = useRef(false), selection = useRef(0), readEpoch = useRef(0);
  const [config, setConfig] = useState<PreparationConfig | null>(null);
  const [page, setPage] = useState<ExceptionPage>(EMPTY);
  const [kind, setKind] = useState<PreparationKind>("COLLECTION");
  const [source, setSource] = useState(""), [amount, setAmount] = useState(""), [reference, setReference] = useState("");
  const [preflight, setPreflight] = useState<ExceptionRecord | null>(null);
  const [error, setError] = useState(""), [formError, setFormError] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
  const [unconfigured, setUnconfigured] = useState(false);
  const [creating, setCreating] = useState(false), [selected, setSelected] = useState<string | null>(null);
  const session = useAdminAuth(state => state.session);
  const canWrite = canManage && Boolean(session?.authorities.includes("finance_d1_channel_manage")
    && session?.authorities.includes("finance_d2_withdrawal_approve"));
  const assertOwner = useCallback((write = false) => {
    const current = useAdminAuth.getState(), rights = current.session?.authorities ?? [];
    if (!live.current || !current.isAuthenticated || current.session?.adminId !== owner || current.authEpoch !== ownerEpoch
        || adminAuthLifecycleEpoch() !== lifecycle || !adminAuthActivityAllowed() || !rights.includes("finance_d1_read")
        || write && (!canManage || !rights.includes("finance_d1_channel_manage") || !rights.includes("finance_d2_withdrawal_approve")))
      throw new Error("登录身份或权限已变化，请重新打开资金准备后核对");
  }, [owner, ownerEpoch, lifecycle, canManage]);
  const owns = useCallback(() => { try { assertOwner(); return true; } catch { return false; } }, [assertOwner]);
  const scope = useCallback((write = false) => ({ authEpoch: lifecycle, assertOwner: () => assertOwner(write) }), [assertOwner,lifecycle]);

  const refresh = useCallback(async () => {
    const request = scope(); request.assertOwner(); const at = ++readEpoch.current; setLoading(true); setError(""); setUnconfigured(false);
    try {
      const [nextConfig, nextPage] = await Promise.all([exceptionRead(`${ROOT}/status?network=${network}`, request), readPlans(network, null, request)]);
      request.assertOwner(); if (at !== readEpoch.current) return;
      setConfig(preparationConfig(nextConfig, network)); setPage(nextPage); setPreflight(null); selection.current++;
    } catch (failure) {
      if (owns() && at === readEpoch.current) {
        setConfig(null); setPage(EMPTY);
        if (configurationRequired(failure)) setUnconfigured(true);
        else setError(displayAdminReadError(failure));
      }
    } finally { if (owns() && at === readEpoch.current) setLoading(false); }
  }, [scope, owns, network]);
  useEffect(() => { live.current = true; void refresh(); return () => { live.current = false; selection.current++; }; }, [refresh]);
  useEffect(() => {
    if (!switched.current) return;
    switched.current = false;
    document.querySelector<HTMLElement>('[role="radiogroup"][aria-label="人工资金准备网络"] [aria-checked="true"]')?.focus();
  }, [switched]);
  const edit = (action: () => void) => { selection.current++; setPreflight(null); setFormError(""); action(); };
  const payload = () => {
    if (!config) throw new Error("请先读取资金准备配置");
    if (kind === "COLLECTION" && !config.sources.some(row => row.address === source)) throw new Error("请选择归集到cregis的来源地址");
    return { ...(network === "ERC20" ? { network } : {}), kind, sourceAddress: kind === "COLLECTION" ? source : config.platformAddress, amountUsdt: preparationAmount(amount) };
  };
  const check = async () => {
    const request = scope(true); request.assertOwner(); if (mutation.current) return;
    let body; try { body = payload(); } catch (failure) { setFormError((failure as Error).message); return; }
    const at = selection.current; mutation.current = true; setBusy(true); setFormError(""); setPreflight(null);
    try {
      const response = exceptionObject(await financeAdminRequest<unknown>(`/cregis${ROOT}/preflight`, {
        method: "POST", body: JSON.stringify(body), bankManualAuthEpoch: request.authEpoch,
      }));
      request.assertOwner();
      const balance = response.balance === null ? null : exceptionObject(response.balance);
      if (response.preparationNetwork !== network || response.executionEnabled !== false || !Array.isArray(response.blockers)
          || (balance && (balance.gasSymbol !== PREPARATION_GAS[network]
            || typeof balance.nativeBalance !== "string" || typeof balance.usdt !== "string"))
          || response.blockers.some(item => typeof item !== "string")) throw new Error("资金检查结果无效，请重新读取");
      if (at === selection.current) setPreflight(response);
    } catch (failure) {
      if (owns()) setFormError(configurationRequired(failure) ? configurationTitle(network) : displayAdminError(failure));
    }
    finally { mutation.current = false; if (owns()) setBusy(false); }
  };
  const command = async (path: string, body: ExceptionRecord, preparationNetwork: PreparationNetwork) => {
    const request = scope(true); request.assertOwner();
    if (mutation.current) throw new Error("上一项操作仍在处理，请刷新核对");
    mutation.current = true; setBusy(true);
    try {
      await financeAdminRequest(`/cregis${ROOT}${path}`, {
        method: "POST", body: JSON.stringify(body), idempotencyPrefix: "cregis-exception",
        bankManualAuthEpoch: request.authEpoch, preparationNetwork,
      });
      request.assertOwner();
    }
    finally { mutation.current = false; onChanged?.(); if (owns()) { setBusy(false); await refresh(); } }
  };
  const create = () => {
    try {
      assertOwner(true); const body = payload();
      const held = d1PendingObjectReason(`/cregis${ROOT}/plans`, body); if (held) throw new Error(held);
      if (!reference.trim() || reference.length > 100 || /[\u0000-\u001f\u007f]/.test(reference)) throw new Error("请填写不超过 100 字的业务参考号");
      const snapshot = { ...body, businessReference: reference.trim() };
      const target = kind === "COLLECTION" ? config!.platformAddress : config!.counterpartyAddress;
      openActionConfirm({ briefKind: "record", action: "创建资金准备单", title: "创建资金准备单", confirmLabel: "确认创建",
        effect: <StatusTag tone="neutral" filled>只保存准备记录</StatusTag>,
        facts: <Facts><Fact k="金额" lead tone="role-1" unit="USDT">{usdt(body.amountUsdt)}</Fact><Fact k="类型">{kindLabel(kind)}</Fact><Fact k="网络">{network}</Fact><Fact k="来源"><LongValue value={body.sourceAddress} label="来源地址" /></Fact><Fact k="接收"><LongValue value={target} label="接收地址" /></Fact><Fact k="业务参考">{snapshot.businessReference}</Fact></Facts>,
        detail: `${network} · 提交后等另一位管理员复核；真实转账须另行授权，在收款服务后台执行。`,
        reasonMin: 10, reasonMax: 300, completionCopy: "不发送资金。", run: async reason => { await command("/plans", { ...snapshot, reason }, network); setCreating(false); } });
    } catch (failure) { setFormError((failure as Error).message); }
  };
  const decide = (row: ExceptionRecord, decision: "REVIEW" | "CANCEL") => {
    assertOwner(true);
    const planNetwork = row.network;
    if (planNetwork !== "BEP20" && planNetwork !== "ERC20") return;
    const held = d1PendingObjectReason(`/cregis${ROOT}/plans/${String(row.planNo)}/decision`); if (held) { setError(held); return; }
    openActionConfirm({ briefKind: "record", action: decision === "REVIEW" ? "复核准备单" : "取消准备单", title: decision === "REVIEW" ? "复核准备单" : "取消准备单",
      confirmLabel: decision === "REVIEW" ? "确认复核" : "确认取消", effect: <StatusTag tone="neutral" filled>不转账</StatusTag>,
      facts: <Facts><Fact k="金额" lead tone="role-1" unit="USDT">{usdt(String(row.amountUsdt))}</Fact><Fact k="类型">{kindLabel(row.kind)}</Fact><Fact k="网络">{planNetwork}</Fact><Fact k="来源"><LongValue value={String(row.sourceAddress)} label="来源地址" /></Fact><Fact k="接收"><LongValue value={String(row.targetAddress)} label="接收地址" /></Fact><Fact k="业务参考">{String(row.businessReference)}</Fact></Facts>,
      detail: decision === "REVIEW" ? `${planNetwork} · 核对金额、地址和业务参考与原业务单一致；真实转账须另行授权，在收款服务后台执行。` : `${planNetwork} · 准备单改为已取消，没有资金需要撤回。`,
      reasonMin: 10, reasonMax: 300, completionCopy: decision === "REVIEW" ? "复核只确认准备信息，仍不转账" : "取消后这张准备单不能再复核",
      run: reason => command(`/plans/${row.planNo}/decision`, { expectedVersion: row.version, decision, reason }, planNetwork) });
  };
  const more = async () => {
    const request = scope(); request.assertOwner(); setBusy(true);
    try { const next = await readPlans(network, page.nextBeforeId, request); request.assertOwner(); setPage({ ...next, records: [...page.records,...next.records] }); }
    catch (failure) { if (owns()) setError(displayAdminReadError(failure)); }
    finally { if (owns()) setBusy(false); }
  };
  const balance = preflight?.balance && typeof preflight.balance === "object" ? preflight.balance as ExceptionRecord : null;
  const gasSymbol = balance?.gasSymbol ?? PREPARATION_GAS[network];
  const block = loading ? "正在读取最新数据" : busy ? "正在提交" : undefined;
  const records = page.records, index = records.findIndex(row => String(row.planNo) === selected), plan = index >= 0 ? records[index] : null;
  const planActions = (row: ExceptionRecord) => canWrite ? [
    ...(row.state === "DRAFT" && String(row.makerId) !== String(owner) ? [{ key: "review", label: "复核准备", primary: true, run: () => decide(row, "REVIEW") }] : []),
    ...(["DRAFT", "REVIEWED"].includes(String(row.state)) ? [{ key: "cancel", label: "取消准备单", primary: false, run: () => decide(row, "CANCEL") }] : []),
  ] : [];
  const amountIssue = amount && !/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/.test(amount) ? "金额须大于零，最多十二位整数和六位小数" : undefined;
  const checkBlock = block ?? (kind === "COLLECTION" && !source ? (config?.sources.length === 0 ? "没有可用的来源子地址，不能建归集准备单" : "先选来源子地址") : !amount ? "先填金额" : amountIssue);
  const createBlock = checkBlock ?? (!reference.trim() ? "先填业务参考号" : undefined);

  return <Panel icon={ClipboardList} tone="role-2" title={network === "BEP20" ? "BEP20 人工资金准备" : "ERC20 人工资金准备"}
    explain={<><p>真实转账须另行授权后在收款服务后台执行，这里的复核不会自动发送。</p><p>1. 选择本项目充值子地址，核对金额后创建归集到 Cregis 准备单。</p><p>2. 由另一位管理员复核，之后另行授权，在收款服务后台将资金归集到 Cregis 钱包。</p><p>3. Cregis 钱包到账后，按业务金额创建并复核 Cregis 转平台收款钱包准备单；之后在收款服务后台单独付款，保存原单号和交易哈希。</p></>}
    actions={<>
      {/* 网络选择放在标题行右侧，和上面自动资金流程标题下的三网选择分开（位置不同，一眼看出是两块各自的选择）。 */}
      <Segments label="人工资金准备网络" value={network} onChange={onNetworkChange} items={PREPARATION_NETWORKS.map(value => ({ value, label: value }))} />
      <Button size="sm" variant="ghost" icon={<RefreshCw size={14} aria-hidden />} loading={loading} disabled={busy} onClick={() => void refresh()}>刷新</Button>
      {canWrite && config && <Button size="sm" icon={<Plus size={14} aria-hidden />} disabledReason={block} onClick={() => setCreating(true)}>新建准备单</Button>}
    </>}>
    {error && config && <Notice tone="warn">{error}</Notice>}
    {loading && !config ? <BlockState state="loading" title="正在读取资金准备记录…" />
      : unconfigured ? <BlockState state="empty" title={configurationTitle(network)} detail={`请联系管理员核对 ${network} 的收款服务项目和钱包地址配置，配好后点「刷新」。`} />
      : !config ? <BlockState state="error" title="资金准备读取失败" detail={error} onRetry={() => void refresh()} />
        : <div className="rd-stack">
          <p className="rd-note">只保存准备单和复核意见，不会转出资金。</p>
          <ConfigList label="准备地址">
            <ConfigRow name="Cregis 归集钱包 / 转出来源" value={<span data-mono="">{config.platformAddress}</span>} />
            <ConfigRow name={`平台收款钱包（${network}）`} value={<span data-mono="">{config.counterpartyAddress}</span>} />
          </ConfigList>
          {records.length === 0 ? <p className="rd-note">暂无准备单</p> : <Table label="准备记录 · 不代表已转账">
            <thead><tr><Th>准备单 · 业务参考</Th><Th align="right">金额（USDT）</Th><Th>状态</Th><Th sticky="end" align="right">操作</Th></tr></thead>
            <tbody>{records.map(row => { const actions = planActions(row); return <Tr key={String(row.planNo)} selected={String(row.planNo) === selected} onOpen={() => setSelected(String(row.planNo))}>
              <Td><Cell mono main={String(row.planNo)} sub={<span data-mono>{String(row.businessReference)}</span>} /></Td>
              <Td align="right"><Cell num main={usdt(String(row.amountUsdt))} sub={kindLabel(row.kind)} /></Td>
              <Td><Cell main={<StatusTag tone={planTone(row.state)}>{PREPARATION_STATE[String(row.state)] ?? "状态未知"}</StatusTag>} sub={row.state === "DRAFT" && String(row.makerId) === String(owner) ? "你发起的，等另一位管理员复核" : undefined} /></Td>
              <Td sticky="end" align="right">{actions[0] ? <Button size="sm" disabledReason={block} onClick={actions[0].run}>{actions[0].label}</Button> : <Button size="sm" variant="ghost" onClick={() => setSelected(String(row.planNo))}>查看详情</Button>}</Td>
            </Tr>; })}</tbody>
          </Table>}
          {page.hasMore && <div><Button size="sm" disabled={busy || loading} onClick={() => void more()}>加载更早准备单</Button></div>}
        </div>}

    <Drawer open={creating} onClose={() => setCreating(false)} title="新建准备单" sub={network} icon={ClipboardList} tone="role-2" busy={busy}
      footer={<Decision note={createBlock} explain="只读检查不保存任何东西；创建准备单只保存准备记录，不发送资金。"
        others={<Button variant="ghost" disabledReason={checkBlock} onClick={() => void check()}>只读检查余额与条件</Button>}
        primary={<Button variant="primary" disabledReason={createBlock} onClick={create}>创建准备单</Button>} />}>
      {config && <>
        <Field label="操作类型" required>
          <Select aria-label="资金准备操作类型" value={kind} disabled={busy} onChange={value => edit(() => setKind(value as PreparationKind))} options={[{ value: "COLLECTION", label: "归集到 Cregis 准备" }, { value: "SUPPLIER_PAYMENT", label: "Cregis 转平台收款钱包准备" }]} />
        </Field>
        {kind === "COLLECTION" && (config.sources.length === 0
          ? <p className="rd-note">当前没有已分配且可用于准备的充值子地址。</p>
          : <Field label="来源子地址" required>
            <Select aria-label="归集到 Cregis 来源子地址" value={source} disabled={busy} onChange={value => edit(() => setSource(value))} placeholder="请选择" required
              options={[{ value: "", label: "请选择" }, ...config.sources.map(row => ({ value: row.address, label: `${row.address} · 用户 ${row.userId}` }))]} />
          </Field>)}
        <Field label="金额" required hint="USDT，最多六位小数" error={amountIssue}>
          <Input aria-label="准备金额 USDT" value={amount} inputMode="decimal" disabled={busy} onChange={event => edit(() => setAmount(event.target.value.trim()))} />
        </Field>
        <Field label="业务参考号" required hint="不超过 100 字">
          <Input aria-label="资金准备业务参考号" value={reference} maxLength={100} disabled={busy} onChange={event => edit(() => setReference(event.target.value))} />
        </Field>
        {formError && <BlockState state="error" compact title="这一步没有完成" detail={formError} />}
        {preflight && <JudgmentPoints title="只读检查结果" rows={[
          { label: "来源 USDT", value: balance ? String(balance.usdt) : "待核实" },
          { label: `来源 ${gasSymbol}`, value: balance ? String(balance.nativeBalance) : "待核实", reason: `须在执行前重新核对项目钱包绑定及实际手续费；${gasSymbol} 余额大于零不表示足以支付网络费。` },
          { label: "检查时间", value: Number.isFinite(parseBusinessTime(String(preflight.checkedAt))) ? `${businessStamp(parseBusinessTime(String(preflight.checkedAt)))}（${zoneLabel()}）` : "待核实", reason: "仅供准备核对，仍未授权转账。" },
          ...(preflight.blockers as string[]).map(item => ({ label: "条件", state: "warn" as const, value: PREPARATION_BLOCKER[item] ?? "仍有条件待核实，请联系管理员" })),
        ]} />}
      </>}
    </Drawer>

    <Drawer open={!!plan} onClose={() => setSelected(null)} title="准备单" sub={plan ? String(plan.planNo) : undefined} icon={ClipboardList} tone="role-2" busy={busy}
      nav={{ hasPrev: index > 0, hasNext: index >= 0 && index < records.length - 1, onPrev: () => setSelected(String(records[index - 1]?.planNo ?? selected)), onNext: () => setSelected(String(records[index + 1]?.planNo ?? selected)) }}
      footer={plan && (() => { const actions = planActions(plan); return actions.length ? <Decision note={block}
        others={actions.filter(item => !item.primary).map(item => <Button key={item.key} variant="ghost" disabledReason={block} onClick={item.run}>{item.label}</Button>)}
        primary={actions.filter(item => item.primary).map(item => <Button key={item.key} variant="primary" disabledReason={block} onClick={item.run}>{item.label}</Button>)} />
        : <Decision note={plan.state === "DRAFT" && String(plan.makerId) === String(owner) ? "你发起的，等另一位管理员复核" : canWrite ? undefined : "没有修改权限，只能查看"} />; })()}>
      {plan && <>
        <JudgmentPoints rows={[
          { label: "金额", value: `${usdt(String(plan.amountUsdt))} USDT`, reason: kindLabel(plan.kind) },
          { label: "状态", state: planTone(plan.state) === "done" ? undefined : planTone(plan.state), value: PREPARATION_STATE[String(plan.state)] ?? "状态未知" },
          { label: "发起理由", value: String(plan.reason), reason: plan.decisionReason ? `复核/取消理由：${String(plan.decisionReason)}` : undefined },
        ]} />
        {/* 和自动任务抽屉一个样子：地址收进折叠，长地址写前后几位加复制（对齐原则、DT-09）。 */}
        <Fold inset title="原单和地址" summary={String(plan.businessReference)}>
          <KeyValues rows={[
            { key: "ref", label: "业务参考", value: String(plan.businessReference) },
            { key: "from", label: "来源", value: <LongValue value={String(plan.sourceAddress)} label="来源地址" />, mono: true },
            { key: "to", label: "接收", value: <LongValue value={String(plan.targetAddress)} label="接收地址" />, mono: true },
          ]} />
        </Fold>
      </>}
    </Drawer>
  </Panel>;
}
