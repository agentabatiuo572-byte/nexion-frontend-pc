"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardList, Plus, RefreshCw } from "lucide-react";
import { BlockState, Button, Cell, ConfigList, ConfigRow, Decision, Drawer, Fact, Facts, Field, Fold, Input, JudgmentPoints, KeyValues, Notice, Panel, Select, StatusTag, Table, Td, Th, Tr } from "@/app/components/rd";
import type { StateTone } from "@/app/components/rd";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { adminAuthActivityAllowed, adminAuthLifecycleEpoch } from "@/lib/admin/auth-lifecycle";
import { d1PendingObjectReason, financeAdminRequest } from "@/lib/admin/d-client";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { exceptionCommand, exceptionList, exceptionRead, exceptionObject, type ExceptionPage, type ExceptionRecord } from "@/lib/admin/cregis-exceptions";
import { preparationAmount, preparationConfig, PREPARATION_BLOCKER, PREPARATION_STATE, type PreparationConfig, type PreparationKind } from "@/lib/admin/cregis-funds-preparation";
import { LongValue, usdt } from "./d1-shared";
import type { DCtx } from "./types";

const EMPTY: ExceptionPage = { records: [], hasMore: false, nextBeforeId: null };
const ROOT = "/funds-preparation";
const kindLabel = (kind: unknown) => kind === "COLLECTION" ? "归集准备" : "甲方付款准备";
const planTone = (state: unknown): StateTone => state === "DRAFT" ? "warn" : state === "REVIEWED" ? "ok" : "done";
type Props = { canManage: boolean; openActionConfirm: DCtx["openActionConfirm"]; onChanged?: () => void };

export function CregisFundsPreparation(props: Props) {
  const session = useAdminAuth(state => state.session), epoch = useAdminAuth(state => state.authEpoch);
  if (!session?.authorities.includes("finance_d1_read")) return null;
  return <OwnedPreparation key={`${session.adminId}:${epoch}:${adminAuthLifecycleEpoch()}:${props.canManage}:${session.authorities.join("|")}`}
    {...props} owner={session.adminId} ownerEpoch={epoch} />;
}

function OwnedPreparation({ canManage, openActionConfirm, onChanged, owner, ownerEpoch }: Props & { owner: number; ownerEpoch: number }) {
  const lifecycle = useRef(adminAuthLifecycleEpoch()).current;
  const live = useRef(true), mutation = useRef(false), selection = useRef(0), readEpoch = useRef(0);
  const [config, setConfig] = useState<PreparationConfig | null>(null);
  const [page, setPage] = useState<ExceptionPage>(EMPTY);
  const [kind, setKind] = useState<PreparationKind>("COLLECTION");
  const [source, setSource] = useState(""), [amount, setAmount] = useState(""), [reference, setReference] = useState("");
  const [preflight, setPreflight] = useState<ExceptionRecord | null>(null);
  const [error, setError] = useState(""), [formError, setFormError] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
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
    const request = scope(); request.assertOwner(); const at = ++readEpoch.current; setLoading(true); setError("");
    try {
      const [nextConfig, nextPage] = await Promise.all([exceptionRead(`${ROOT}/status`, request), exceptionList(`${ROOT}/plans`, undefined, request)]);
      request.assertOwner(); if (at !== readEpoch.current) return;
      setConfig(preparationConfig(nextConfig)); setPage(nextPage); setPreflight(null); selection.current++;
    } catch (failure) {
      if (owns() && at === readEpoch.current) { setConfig(null); setPage(EMPTY); setError(displayAdminReadError(failure)); }
    } finally { if (owns() && at === readEpoch.current) setLoading(false); }
  }, [scope, owns]);
  useEffect(() => { live.current = true; void refresh(); return () => { live.current = false; selection.current++; }; }, [refresh]);
  const edit = (action: () => void) => { selection.current++; setPreflight(null); setFormError(""); action(); };
  const payload = () => {
    if (!config) throw new Error("请先读取资金准备配置");
    if (kind === "COLLECTION" && !config.sources.some(row => row.address === source)) throw new Error("请选择可归集的来源地址");
    return { kind, sourceAddress: kind === "COLLECTION" ? source : config.platformAddress, amountUsdt: preparationAmount(amount) };
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
      if (response.executionEnabled !== false || !Array.isArray(response.blockers)
          || response.blockers.some(item => typeof item !== "string")) throw new Error("资金检查结果无效，请重新读取");
      if (at === selection.current) setPreflight(response);
    } catch (failure) { if (owns()) setFormError(displayAdminError(failure)); }
    finally { mutation.current = false; if (owns()) setBusy(false); }
  };
  const command = async (path: string, body: ExceptionRecord) => {
    const request = scope(true); request.assertOwner();
    if (mutation.current) throw new Error("上一项操作仍在处理，请刷新核对");
    mutation.current = true; setBusy(true);
    try { await exceptionCommand(`${ROOT}${path}`, body, request); request.assertOwner(); }
    finally { mutation.current = false; onChanged?.(); if (owns()) { setBusy(false); await refresh(); } }
  };
  const create = () => {
    try {
      assertOwner(true); const body = payload();
      const held = d1PendingObjectReason(`/cregis${ROOT}/plans`); if (held) throw new Error(held);
      if (!reference.trim() || reference.length > 100 || /[\u0000-\u001f\u007f]/.test(reference)) throw new Error("请填写不超过 100 字的业务参考号");
      const snapshot = { ...body, businessReference: reference.trim() };
      const target = kind === "COLLECTION" ? config!.platformAddress : config!.counterpartyAddress;
      openActionConfirm({ briefKind: "record", action: "创建资金准备单", title: "创建资金准备单", confirmLabel: "确认创建",
        effect: <StatusTag tone="neutral" filled>只保存准备记录</StatusTag>,
        facts: <Facts><Fact k="金额" lead tone="role-1" unit="USDT">{usdt(body.amountUsdt)}</Fact><Fact k="类型">{kindLabel(kind)}</Fact><Fact k="来源">{body.sourceAddress}</Fact><Fact k="接收">{target}</Fact><Fact k="业务参考">{snapshot.businessReference}</Fact></Facts>,
        detail: `${kindLabel(kind)} · ${body.amountUsdt} USDT · 来源 ${body.sourceAddress} · 接收 ${target} · 业务参考 ${snapshot.businessReference}。仅保存准备记录，不发送资金。`,
        reasonMin: 10, reasonMax: 300, completionCopy: "只保存准备记录，不发送资金。", run: async reason => { await command("/plans", { ...snapshot, reason }); setCreating(false); } });
    } catch (failure) { setFormError((failure as Error).message); }
  };
  const decide = (row: ExceptionRecord, decision: "REVIEW" | "CANCEL") => {
    assertOwner(true);
    const held = d1PendingObjectReason(`/cregis${ROOT}/plans/${String(row.planNo)}/decision`); if (held) { setError(held); return; }
    openActionConfirm({ briefKind: "record", action: decision === "REVIEW" ? "复核准备单" : "取消准备单", title: decision === "REVIEW" ? "复核准备单" : "取消准备单",
      confirmLabel: decision === "REVIEW" ? "确认复核" : "确认取消", effect: <StatusTag tone="neutral" filled>不转账</StatusTag>,
      facts: <Facts><Fact k="金额" lead tone="role-1" unit="USDT">{usdt(String(row.amountUsdt))}</Fact><Fact k="类型">{kindLabel(row.kind)}</Fact><Fact k="来源">{String(row.sourceAddress)}</Fact><Fact k="接收">{String(row.targetAddress)}</Fact><Fact k="业务参考">{String(row.businessReference)}</Fact></Facts>,
      detail: `${kindLabel(row.kind)} · ${row.amountUsdt} USDT · ${row.sourceAddress} → ${row.targetAddress} · ${row.businessReference}。复核只确认准备信息，不授权或执行转账。`,
      reasonMin: 10, reasonMax: 300, completionCopy: decision === "REVIEW" ? "准备信息已复核，尚未转账" : "准备单已取消",
      run: reason => command(`/plans/${row.planNo}/decision`, { expectedVersion: row.version, decision, reason }) });
  };
  const more = async () => {
    const request = scope(); request.assertOwner(); setBusy(true);
    try { const next = await exceptionList(`${ROOT}/plans`,page.nextBeforeId ?? undefined,request); request.assertOwner(); setPage({ ...next, records: [...page.records,...next.records] }); }
    catch (failure) { if (owns()) setError(displayAdminReadError(failure)); }
    finally { if (owns()) setBusy(false); }
  };
  const balance = preflight?.balance && typeof preflight.balance === "object" ? preflight.balance as ExceptionRecord : null;
  const block = loading ? "正在读取最新数据" : busy ? "正在提交" : undefined;
  const records = page.records, index = records.findIndex(row => String(row.planNo) === selected), plan = index >= 0 ? records[index] : null;
  const planActions = (row: ExceptionRecord) => canWrite ? [
    ...(row.state === "DRAFT" && String(row.makerId) !== String(owner) ? [{ key: "review", label: "复核准备", primary: true, run: () => decide(row, "REVIEW") }] : []),
    ...(["DRAFT", "REVIEWED"].includes(String(row.state)) ? [{ key: "cancel", label: "取消准备单", primary: false, run: () => decide(row, "CANCEL") }] : []),
  ] : [];
  const amountIssue = amount && !/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,6})?$/.test(amount) ? "金额须大于零，最多十二位整数和六位小数" : undefined;
  const createBlock = block ?? (kind === "COLLECTION" && !source ? "先选来源子地址" : !amount ? "先填金额" : amountIssue ? amountIssue : !reference.trim() ? "先填业务参考号" : undefined);

  return <Panel icon={ClipboardList} tone="role-2" title="BEP20 归集与甲方付款准备"
    explain={<><p>这里只保存准备单和复核意见，不会转出资金。真实转账须另行授权后在收款服务后台执行，审批不自动发送。</p><p>1. 选择本项目充值子地址，核对金额后创建归集准备单。2. 由另一管理员复核，后续另行授权后在收款服务后台将资金归集到平台钱包。3. 平台钱包到账后，按业务金额创建并复核甲方付款准备单；后续在收款服务后台单独付款，保存原单号和交易哈希。</p></>}
    actions={<>
      <Button size="sm" variant="ghost" icon={<RefreshCw size={14} aria-hidden />} loading={loading} disabled={busy} onClick={() => void refresh()}>刷新准备记录</Button>
      {canWrite && config && <Button size="sm" icon={<Plus size={14} aria-hidden />} disabledReason={block} onClick={() => setCreating(true)}>新建准备单</Button>}
    </>}>
    {error && config && <Notice tone="warn">{error}</Notice>}
    {loading && !config ? <BlockState state="loading" title="正在读取资金准备记录…" />
      : !config ? <BlockState state="error" title="资金准备读取失败" detail={error} onRetry={() => void refresh()} />
        : <div className="rd-stack">
          <p className="rd-note">只保存准备单和复核意见，不会转出资金。</p>
          <ConfigList label="准备地址">
            <ConfigRow name="归集接收 / 甲方付款来源" value={<span data-mono="">{config.platformAddress}</span>} />
            <ConfigRow name="甲方 BEP20 接收地址" value={<span data-mono="">{config.counterpartyAddress}</span>} />
          </ConfigList>
          {records.length === 0 ? <p className="rd-note">暂无准备单</p> : <Table label="准备记录 · 不代表已转账">
            <thead><tr><Th>准备单 · 业务参考</Th><Th align="right">金额（USDT）</Th><Th>状态</Th><Th sticky="end" align="right">操作</Th></tr></thead>
            <tbody>{records.map(row => { const actions = planActions(row); return <Tr key={String(row.planNo)} selected={String(row.planNo) === selected} onOpen={() => setSelected(String(row.planNo))}>
              <Td><Cell mono main={String(row.planNo)} sub={String(row.businessReference)} /></Td>
              <Td align="right"><Cell num main={usdt(String(row.amountUsdt))} sub={kindLabel(row.kind)} /></Td>
              <Td><Cell main={<StatusTag tone={planTone(row.state)}>{PREPARATION_STATE[String(row.state)] ?? "状态未知"}</StatusTag>} sub={row.state === "DRAFT" && String(row.makerId) === String(owner) ? "你发起的，等另一位管理员复核" : undefined} /></Td>
              <Td sticky="end" align="right">{actions[0] ? <Button size="sm" disabledReason={block} onClick={actions[0].run}>{actions[0].label}</Button> : <Button size="sm" variant="ghost" onClick={() => setSelected(String(row.planNo))}>查看详情</Button>}</Td>
            </Tr>; })}</tbody>
          </Table>}
          {page.hasMore && <div><Button size="sm" disabled={busy || loading} onClick={() => void more()}>加载更早准备单</Button></div>}
        </div>}

    <Drawer open={creating} onClose={() => setCreating(false)} title="新建准备单" icon={ClipboardList} tone="role-2" busy={busy}
      footer={<Decision note={createBlock} explain="只读检查不保存任何东西；创建准备单只保存准备记录，不发送资金。"
        others={<Button variant="ghost" disabledReason={createBlock} onClick={() => void check()}>只读检查余额与条件</Button>}
        primary={<Button variant="primary" disabledReason={createBlock} onClick={create}>创建准备单</Button>} />}>
      {config && <>
        <Field label="操作类型" required>
          <Select aria-label="资金准备操作类型" value={kind} disabled={busy} onChange={value => edit(() => setKind(value as PreparationKind))} options={[{ value: "COLLECTION", label: "归集准备" }, { value: "SUPPLIER_PAYMENT", label: "甲方付款准备" }]} />
        </Field>
        {kind === "COLLECTION" && (config.sources.length === 0
          ? <p className="rd-note">当前没有已分配且可用于准备的充值子地址。</p>
          : <Field label="来源子地址" required>
            <Select aria-label="归集来源子地址" value={source} disabled={busy} onChange={value => edit(() => setSource(value))} placeholder="请选择" required
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
          { label: "来源 BNB", value: balance ? String(balance.bnb) : "待核实", reason: "须在执行前重新核对项目钱包绑定及实际手续费；BNB 余额大于零不表示足以支付网络费。" },
          { label: "检查时间", value: String(preflight.checkedAt), reason: "仅供准备核对，仍未授权转账。" },
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
