"use client";

import { useReach } from "@/lib/nav/use-reach";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Coins, CreditCard, ReceiptText, RefreshCw, User } from "lucide-react";
import {
  BlockState, Button, Cell, Decision, DiffList, Drawer, Explain, Fact, Facts, FilterBar, FilterField, Fold, JudgmentPoints, KeyValues,
  Modal, Notice, NumberInput, Pager, Panel, Select, StatusTag, Table, TableLoading, TableMessage, Td, Th, Tr,
} from "@/app/components/rd";
import type { StateTone } from "@/app/components/rd";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { purchasePaymentMethods, purchaseWasDelivered, validPurchaseChannel, type PurchasePaymentChannel, type PurchasePaymentMethod, type PurchasePaymentPolicy, type PurchasePaymentPage, type PurchasePaymentRecord, type PurchasePaymentState } from "@/lib/admin/purchase-payment-contract";
import { fetchPurchasePaymentPolicy, fetchPurchasePaymentRecords, fetchPurchasePaymentRecord, updatePurchasePaymentPolicy, revalidatePurchasePayment, pendingPurchasePayments, retryPurchasePayment, releasePurchasePayment, canRetryPurchasePayment, type PendingPurchasePayment } from "@/lib/admin/purchase-payment-client";
import { PendingNotices, readPage, readParam, usdt, vnd, writeParams, zoneLabel, type D1Activity, type D1Count, type D1PendingItem } from "./d1-shared";
import type { DCtx } from "./types";

const methodText: Record<PurchasePaymentMethod, string> = { HDPAY_BANK: "银行卡支付", CREGIS_USDT_BSC: "USDT（BEP20）", CREGIS_USDT_ERC20: "USDT（ERC20）" };
const methodNote: Record<PurchasePaymentMethod, string> = { HDPAY_BANK: "按手续费收取，不收网络费，不需要支付密码。", CREGIS_USDT_BSC: "按手续费和网络费收取，不需要支付密码。", CREGIS_USDT_ERC20: "以太坊网络费较高，单独设置，不需要支付密码。" };
const stateText: Record<PurchasePaymentState, string> = { CREATING: "正在创建", SUBMIT_UNKNOWN: "创建结果未确认", AWAITING_PAYMENT: "等待付款", FUNDS_CONFIRMED: "已收款，待完成", DELIVERED: "已完成", MANUAL_REVIEW: "需人工处理", EXPIRED: "已过期" };
const stateTone = (state: PurchasePaymentState): StateTone => state === "MANUAL_REVIEW" ? "warn" : state === "DELIVERED" ? "ok" : state === "EXPIRED" ? "done" : "progress";
const STATE_GROUPS: readonly { label: string; states: readonly PurchasePaymentState[] }[] = [
  { label: "要处理", states: ["MANUAL_REVIEW"] },
  { label: "系统处理中", states: ["CREATING", "SUBMIT_UNKNOWN", "AWAITING_PAYMENT", "FUNDS_CONFIRMED"] },
  { label: "已结束", states: ["DELIVERED", "EXPIRED"] },
];
const kindText: Record<string, string> = { ORDER_PAY: "购买", TRIAL_CONVERT: "试用转购买", TRADE_IN: "升级置换", CAPACITY_REPLACE: "替换设备位", CAPACITY_KEEP: "扩容" };
const FEE_FIELDS = ["channelFeeRatePct", "channelFeeFixed", "networkConfirmFeeUsdt", "minTopupPrincipal"] as const;
type FeeField = typeof FEE_FIELDS[number];
const feeLabel: Record<FeeField, string> = { channelFeeRatePct: "手续费比例", channelFeeFixed: "每笔固定费", networkConfirmFeeUsdt: "网络费", minTopupPrincipal: "最低充值金额" };
const feeUnit: Record<FeeField, string> = { channelFeeRatePct: "%", channelFeeFixed: "USDT", networkConfirmFeeUsdt: "USDT", minTopupPrincipal: "USDT" };
const message = (failure: unknown) => displayAdminReadError(failure);
const time = (value: string) => formatBusinessTimeCompact(value, "—");
const channelInput = (row: PurchasePaymentChannel) => ({ ...row, networkConfirmFeeUsdt: row.paymentMethod === "HDPAY_BANK" ? "0" : row.networkConfirmFeeUsdt });
const allowed = (authority: string) => { const session = useAdminAuth.getState().session; return !!session && (session.authorities.includes(authority) || ["superadmin", "super"].includes(session.role)); };
const RETRY_WINDOW_TEXT = "已超过 10 分钟，不能再重试，请到操作记录与审批核对";
const PAGE_SIZE = 20;

/** 已完成没有、钱和业务的关系，一句话（D1-C61）。 */
function deliveryNote(record: PurchasePaymentRecord) {
  if (purchaseWasDelivered(record)) {
    if (record.status !== "DELIVERED") return "业务已完成，但资金有异常需要核查。不会再次完成、自动退款或转进钱包。";
    return record.receipt ? "业务已完成。" : "状态是已完成，但没有业务回执，请核对原业务记录。";
  }
  return record.receipt ? "已有业务回执，完成状态待确认；请核对原业务记录，不会重复完成。" : "收到钱不等于已完成。系统不会自动退款，也不会把钱转进用户钱包。";
}

/** 重新核对到账为什么不能点，按顺序写第一条（OP-126）。 */
function revalidateBlock(record: PurchasePaymentRecord | null, pending: boolean) {
  if (!record) return "正在读取这笔付款";
  if (pending) return "这笔有一次操作还没确认结果";
  if (purchaseWasDelivered(record)) return "已完成";
  if (record.receipt) return "已有业务回执，请核对原业务记录";
  if (record.status === "EXPIRED") return "已过期的付款不能重新核对";
  if (record.status === "CREATING") return "付款单正在创建，等创建完再核对";
  if (record.version == null) return "缺付款单版本，不能核对";
  return undefined;
}

/** 数字框：空、填错、0 分开说（OP-141）。 */
function feeIssue(field: FeeField, value: string | null, policy: PurchasePaymentPolicy) {
  const raw = (value ?? "").trim();
  if (!raw) return "请填写";
  const c = policy.constraints;
  if (!c) return undefined;
  if (field === "minTopupPrincipal") {
    return /^[1-9]\d*$/.test(raw) && Number(raw) >= Number(c.minTopupPrincipal.min) && Number(raw) <= Number(c.minTopupPrincipal.max)
      ? undefined : `填 ${c.minTopupPrincipal.min}–${Number(c.minTopupPrincipal.max).toLocaleString("en-US")} 的整数`;
  }
  const range = field === "channelFeeRatePct" ? c.ratePct : c.feeUsdt;
  return /^(0|[1-9]\d*)(\.\d{1,2})?$/.test(raw) && Number(raw) >= Number(range.min) && Number(raw) <= Number(range.max)
    ? undefined : `填 ${range.min}–${Number(range.max).toLocaleString("en-US")}，最多两位小数`;
}

export function D1OrderPayments({ ctx, onCount, onActivity, reloadTick }: { ctx: DCtx; onCount: (count: D1Count) => void; onActivity: (lines: D1Activity) => void; reloadTick: number }) {
  const session = useAdminAuth(s => s.session), epoch = useAdminAuth(s => s.authEpoch);
  if (!session || !allowed("finance_d1_read")) return null;
  return <Workspace key={`${session.adminId}:${epoch}`} ctx={ctx} owner={session.adminId} epoch={epoch} onCount={onCount} onActivity={onActivity} reloadTick={reloadTick} />;
}

function Workspace({ ctx, owner, epoch, onCount, onActivity, reloadTick }: { ctx: DCtx; owner: number; epoch: number; onCount: (count: D1Count) => void; onActivity: (lines: D1Activity) => void; reloadTick: number }) {
  const reach = useReach();
  const [policy, setPolicy] = useState<PurchasePaymentPolicy | null>(null), [draft, setDraft] = useState<PurchasePaymentChannel[]>([]);
  const [records, setRecords] = useState<PurchasePaymentPage | null>(null);
  const [status, setStatus] = useState(() => readParam("paymentStatus", [...STATE_GROUPS.flatMap(group => group.states)]) ?? "");
  const [method, setMethod] = useState(() => readParam("paymentMethod", purchasePaymentMethods) ?? "");
  const [page, setPage] = useState(() => readPage("paymentPage"));
  const [pending, setPending] = useState<PendingPurchasePayment[]>([]), [selected, setSelected] = useState<string | null>(null);
  const [policyError, setPolicyError] = useState(""), [recordsError, setRecordsError] = useState(""), [notice, setNotice] = useState("");
  const [policyLoading, setPolicyLoading] = useState(true), [recordsLoading, setRecordsLoading] = useState(true), [busy, setBusy] = useState(false);
  const [manualCount, setManualCount] = useState<D1Count>(undefined);
  const [feeOpen, setFeeOpen] = useState<boolean | null>(null), [refreshAsk, setRefreshAsk] = useState(false), [touched, setTouched] = useState(false);
  const live = useRef(true), policySequence = useRef(0), recordSequence = useRef(0), countSequence = useRef(0), mutation = useRef(false);
  const owns = useCallback(() => live.current && useAdminAuth.getState().session?.adminId === owner && useAdminAuth.getState().authEpoch === epoch, [owner, epoch]);
  const syncPending = useCallback(() => setPending(pendingPurchasePayments(owner)), [owner]);
  const loadPolicy = useCallback(async () => {
    const sequence = ++policySequence.current; setPolicyLoading(true); setPolicyError(""); setPolicy(null); setDraft([]); setTouched(false);
    try { const next = await fetchPurchasePaymentPolicy(); if (owns() && sequence === policySequence.current) { setPolicy(next); setDraft(next.channels.map(row => ({ ...row }))); } }
    catch (failure) { if (owns() && sequence === policySequence.current) setPolicyError(message(failure)); }
    finally { if (owns() && sequence === policySequence.current) setPolicyLoading(false); }
  }, [owns]);
  const loadRecords = useCallback(async () => {
    const sequence = ++recordSequence.current; setRecordsLoading(true); setRecordsError(""); setRecords(null);
    try { const next = await fetchPurchasePaymentRecords({ status, paymentMethod: method, pageNum: page, pageSize: PAGE_SIZE }); if (owns() && sequence === recordSequence.current) setRecords(next); }
    catch (failure) { if (owns() && sequence === recordSequence.current) setRecordsError(message(failure)); }
    finally { if (owns() && sequence === recordSequence.current) setRecordsLoading(false); }
  }, [status, method, page, owns]);
  // 要处理的数：需人工处理的总数，不跟筛选走（需求第 28 条）。
  const loadCount = useCallback(async () => {
    const sequence = ++countSequence.current; setManualCount(undefined);
    try { const next = await fetchPurchasePaymentRecords({ status: "MANUAL_REVIEW", paymentMethod: "", pageNum: 1, pageSize: 1 }); if (owns() && sequence === countSequence.current) setManualCount({ n: next.total }); }
    catch { if (owns() && sequence === countSequence.current) setManualCount("failed"); }
  }, [owns]);
  useEffect(() => { live.current = true; syncPending(); void loadPolicy(); void loadCount(); return () => { live.current = false; policySequence.current++; recordSequence.current++; countSequence.current++; }; }, [loadPolicy, loadCount, syncPending]);
  useEffect(() => { void loadRecords(); }, [loadRecords]);
  const firstTick = useRef(reloadTick);
  useEffect(() => { if (reloadTick !== firstTick.current) { void loadCount(); void loadRecords(); } }, [reloadTick, loadCount, loadRecords]);
  useEffect(() => { onCount(manualCount); }, [onCount, manualCount]);
  useEffect(() => { writeParams({ paymentStatus: status || null, paymentMethod: method || null, paymentPage: page > 1 ? page : null }); }, [status, method, page]);

  const policyPending = pending.some(row => row.scope === "policy");
  const changedChannels = draft.filter(row => JSON.stringify(policy?.channels.find(item => item.paymentMethod === row.paymentMethod)) !== JSON.stringify(row)).map(channelInput);
  const valid = !!policy?.constraints && changedChannels.length > 0 && changedChannels.every(row => validPurchaseChannel(row, policy.constraints));
  const changed = changedChannels.length > 0;
  const canEdit = allowed("finance_d1_fx_manage");
  const unconfigured = policy?.channels.filter(row => !row.configured).length ?? 0;
  const activity = useMemo(() => [
    ...(changed ? [`付款手续费有 ${changedChannels.length} 种付款方式没保存`] : []),
    ...(pending.length ? [`有 ${pending.length} 次操作结果未确认`] : []),
  ], [changed, changedChannels.length, pending.length]);
  useEffect(() => { onActivity(activity); }, [onActivity, activity]);

  const afterRecovery = () => { syncPending(); void loadPolicy(); void loadRecords(); void loadCount(); };
  const pendingItems: D1PendingItem[] = pending.map((row) => {
    const isPolicy = row.scope === "policy";
    const permitted = allowed(isPolicy ? "finance_d1_fx_manage" : "finance_d1_bank_reconcile");
    return {
      key: row.commandKey,
      label: isPolicy ? "修改付款手续费" : `重新核对到账 · ${row.scope}`,
      createdAt: row.createdAt,
      hint: "先读回核对；按原操作重试不会重复执行。",
      blocked: !canRetryPurchasePayment(row) ? RETRY_WINDOW_TEXT : permitted ? undefined : "这个账号没有这项权限",
      auditHref: isPolicy ? "/platform/audit?domain=D" : `/platform/audit?domain=D&object=${encodeURIComponent(row.scope)}`,
      verify: async () => {
        if (isPolicy) {
          const current = await fetchPurchasePaymentPolicy();
          if (owns()) { setPolicy(current); if (!changed) setDraft(current.channels.map(item => ({ ...item }))); }
          return `读回：手续费现在是第 ${current.version} 版。那次修改是否生效，请到操作记录确认。待确认继续保留。`;
        }
        const current = await fetchPurchasePaymentRecord(row.scope);
        if (owns()) setSelected(current.intentNo);
        return `读回：这笔付款现在是「${stateText[current.status]}」。状态可能是别人改的，待确认继续保留。`;
      },
      retry: async () => {
        if (mutation.current || !owns()) throw new Error("上一项操作还在处理，请稍后再试");
        mutation.current = true; setBusy(true);
        try {
          const result = await retryPurchasePayment(row);
          if (owns()) ctx.toast(isPolicy ? "已确认结果，请核对手续费" : `已确认结果：${stateText[(result as PurchasePaymentRecord).status]}`, "success");
        } finally { mutation.current = false; if (owns()) setBusy(false); }
      },
      release: () => releasePurchasePayment(row),
      after: afterRecovery,
    };
  });

  function savePolicy() {
    if (!policy || !valid || !changed || policyPending || busy || !canEdit) return;
    const currentPolicy = policy, channels = changedChannels.filter(row => validPurchaseChannel(row, policy.constraints)).map(({ configured: _configured, ...row }) => row);
    const shown = (row: { paymentMethod: PurchasePaymentMethod } & Record<FeeField, string | null>, field: FeeField) =>
      row[field] == null ? "未配置" : `${usdt(row[field])} ${feeUnit[field]}`;
    const rows = channels.flatMap(row => {
      const before = currentPolicy.channels.find(item => item.paymentMethod === row.paymentMethod)!;
      return FEE_FIELDS.filter(field => !(field === "networkConfirmFeeUsdt" && row.paymentMethod === "HDPAY_BANK") && !(field === "minTopupPrincipal" && row.paymentMethod !== "HDPAY_BANK"))
        .map(field => ({ key: `${row.paymentMethod}:${field}`, label: `${methodText[row.paymentMethod]} · ${feeLabel[field]}`, before: before.configured || field === "minTopupPrincipal" ? shown(before, field) : "未配置", after: shown(row, field) }));
    });
    ctx.openActionConfirm({ briefKind: "config", action: "修改付款手续费", title: "修改付款手续费", reasonMin: 10, reasonMax: 300,
      effect: <StatusTag tone="progress" filled>保存后立即生效</StatusTag>,
      confirmLabel: "确认保存",
      detail: "新手续费只用于之后发起的付款，已下单的按原费用。",
      content: <DiffList rows={rows} restTitle="没改的项" />,
      completionCopy: "新手续费只用于之后发起的付款，已下单的按原费用。只修改手续费，不会收款、退款或改动用户余额。",
      run: async reason => {
        if (mutation.current || !owns()) throw new Error("页面状态已变化，请刷新后重试。");
        mutation.current = true; setBusy(true); setNotice("");
        try {
          await updatePurchasePaymentPolicy(owner, currentPolicy.version, channels, reason);
          if (!owns()) return;
          ctx.toast("已保存。新手续费只用于之后发起的付款，已下单的按原费用。", "success");
          await loadPolicy();
        } catch (failure) { if (owns()) { syncPending(); if ((failure as { status?: number }).status === 409) setNotice("手续费已被别人改过，没有保存。点「刷新」读取最新再改，你的修改还在框里。"); } throw failure; }
        finally { mutation.current = false; if (owns()) { syncPending(); setBusy(false); } }
      } });
  }

  const issues = policy ? draft.map(row => Object.fromEntries(FEE_FIELDS.map(field => {
    if (field === "networkConfirmFeeUsdt" && row.paymentMethod === "HDPAY_BANK") return [field, undefined];
    if (field === "minTopupPrincipal" && row.paymentMethod !== "HDPAY_BANK") return [field, undefined];
    const before = policy.channels.find(item => item.paymentMethod === row.paymentMethod)!;
    if (!before.configured && row[field] === null) return [field, undefined];
    return [field, feeIssue(field, row[field], policy)];
  })) as Record<FeeField, string | undefined>) : [];
  const saveBlock = !canEdit ? "只有超级管理员能改" : policyLoading ? "正在读取最新数据" : busy ? "正在提交" : policyPending ? "上次保存结果未确认，先在本页上方核对"
    : !policy?.constraints ? "暂时拿不到可填范围，只能查看" : !changed ? "还没有修改" : !valid ? "有填错的项，按框下的提示改" : undefined;
  const feeSummary = policyLoading ? "正在读取" : policyError ? "读取失败" : policy
    ? `${policy.channels.length} 种付款方式${unconfigured ? `，${unconfigured} 种未配置` : "，都已配置"}${changed ? "，有修改没保存" : ""}` : "—";
  const feeFoldOpen = feeOpen ?? (unconfigured > 0 || changed);
  const doRefreshPolicy = () => { setRefreshAsk(false); void loadPolicy(); };

  const items = records?.items ?? [];
  const index = items.findIndex(row => row.intentNo === selected);
  const statusOptions = STATE_GROUPS.map(group => ({ label: group.label, options: group.states.map(value => ({ value, label: stateText[value] })) }));
  const columns = 6;
  const filtered = status !== "" || method !== "";
  return <>
    <PendingNotices items={pendingItems} disabled={busy} />
    {notice && <Notice tone="warn">{notice}</Notice>}
    {manualCount !== undefined && manualCount !== "failed" && manualCount.n > 0 && status !== "MANUAL_REVIEW" && (
      <Notice tone="warn" title="有付款需人工处理" action={<Button size="sm" onClick={() => { setStatus("MANUAL_REVIEW"); setMethod(""); setPage(1); }}>只看需人工处理</Button>}>
        金额不对、到账太晚或核对没通过的付款，系统不会自动完成，要人核对后处理。
      </Notice>
    )}
    <FilterBar
      scope={<>
        <FilterField><Select aria-label="付款状态" value={status} onChange={value => { setStatus(value); setPage(1); }} options={[{ value: "", label: "全部状态" }]} groups={statusOptions} /></FilterField>
        <FilterField><Select aria-label="付款方式" value={method} onChange={value => { setMethod(value); setPage(1); }} options={[{ value: "", label: "全部方式" }, ...purchasePaymentMethods.map(value => ({ value, label: methodText[value] }))]} /></FilterField>
      </>}
      onSubmit={() => void loadRecords()}
      action={<Button size="sm" variant="ghost" icon={<RefreshCw size={14} aria-hidden />} loading={recordsLoading} onClick={() => { void loadRecords(); void loadCount(); }}>刷新</Button>}
      onClear={() => { setStatus(""); setMethod(""); setPage(1); }}
      canClear={filtered}
      result={records && filtered ? `当前筛选 ${records.total} 笔` : undefined}
    />
    <Panel flush icon={ReceiptText} tone="role-2" title="付款记录" explain="用户购买设备、试用转购买、升级置换和扩容时的付款。钱包余额付款不在这里。">
      <Table label="付款记录" aria-busy={recordsLoading}>
        <thead><tr>
          <Th sticky="start">付款单 · 用户</Th>
          <Th>用途 · 付款方式</Th>
          <Th align="right" icon={Coins} tone="money">用户实付（USDT）</Th>
          <Th>状态</Th>
          <Th>创建时间（{zoneLabel()}）</Th>
          <Th sticky="end" align="right">操作</Th>
        </tr></thead>
        <tbody>
          {recordsLoading ? <TableLoading columns={columns} rows={5} />
            : recordsError ? <TableMessage columns={columns} role="alert">付款记录读取失败。{recordsError} <Button size="sm" onClick={() => void loadRecords()}>重试</Button></TableMessage>
              : items.length === 0 ? <TableMessage columns={columns} role="status">{filtered ? <>没有符合条件的付款记录。 <Button size="sm" onClick={() => { setStatus(""); setMethod(""); setPage(1); }}>清除筛选</Button></> : "暂无付款记录。用户用银行卡或 USDT 付款后会出现在这里。"}</TableMessage>
                : items.map(row => {
                  const rowPending = pending.some(item => item.scope === row.intentNo);
                  return <Tr key={row.intentNo} selected={row.intentNo === selected} onOpen={() => setSelected(row.intentNo)}>
                    <Td sticky="start"><Cell mono full main={row.intentNo} sub={`用户 ${row.userId}`} /></Td>
                    <Td><Cell main={kindText[row.kind] ?? "用途待确认"} sub={methodText[row.paymentMethod]} /></Td>
                    <Td align="right"><Cell num main={usdt(row.totalUsdt)} sub={`订单 ${usdt(row.subtotalUsdt)}`} /></Td>
                    <Td><Cell main={<StatusTag tone={stateTone(row.status)}>{stateText[row.status]}</StatusTag>} sub={rowPending ? "有操作结果未确认" : purchaseWasDelivered(row) && row.status !== "DELIVERED" ? "业务已完成" : row.reason ?? undefined} title={row.reason ?? undefined} /></Td>
                    <Td><Cell num main={time(row.createdAt)} /></Td>
                    <Td sticky="end" align="right"><Button size="sm" variant="ghost" onClick={() => setSelected(row.intentNo)}>查看详情</Button></Td>
                  </Tr>;
                })}
        </tbody>
      </Table>
      {records && records.total > 0 && <Pager label="付款记录" total={records.total} page={records.pageNum} pageSize={PAGE_SIZE} sizes={[PAGE_SIZE]} loading={recordsLoading} onPage={next => setPage(next)} onPageSize={() => setPage(1)} />}
    </Panel>

    <Fold title="付款手续费" icon={CreditCard} tone="role-4" summary={feeSummary} alert={unconfigured > 0 || changed || !!policyError} alertTone={policyError ? "danger" : "warn"}
      open={feeFoldOpen} onOpenChange={setFeeOpen}
      explain={<><p>用户实付 = 订单金额 + 订单金额 × 手续费比例 + 每笔固定费 + 网络费（仅 USDT）。全部填 0 表示免费。</p><p>新手续费只用于之后发起的付款，已下单的按原费用。没配置的付款方式，用户在付款弹窗里看不到。</p><p>银行卡和 USDT 付款不需要支付密码。钱包余额付款不收手续费，要输入支付密码。</p></>}
      actions={<>
        {reach("/platform/audit", "platform_a2_read") && <Link className="rd-link" href="/platform/audit?domain=D">修改历史</Link>}
        <Button size="sm" variant="ghost" icon={<RefreshCw size={14} aria-hidden />} disabled={busy} loading={policyLoading} onClick={() => changed ? setRefreshAsk(true) : doRefreshPolicy()}>刷新</Button>
      </>}>
      {policyLoading && !policy ? <BlockState state="loading" title="正在读取付款手续费…" />
        : policyError ? <BlockState state="error" title="付款手续费读取失败" detail={policyError} onRetry={() => void loadPolicy()} />
          : policy && <div className="rd-stack">
            {!canEdit && <p className="rd-note">只有超级管理员能改付款手续费。</p>}
            {canEdit && !policy.constraints && <p className="rd-note">暂时拿不到可填范围，只能查看，不能修改。</p>}
            <Table label="付款手续费">
              <thead><tr>
                <Th>付款方式</Th>
                {FEE_FIELDS.map(field => <Th key={field} align={canEdit && policy.constraints ? "left" : "right"}>{feeLabel[field]}（{feeUnit[field]}）</Th>)}
              </tr></thead>
              <tbody>{draft.map((row, rowIndex) => {
                const saved = policy.channels.find(item => item.paymentMethod === row.paymentMethod)!;
                return <tr key={row.paymentMethod}>
                  <Td><Cell main={<>{methodText[row.paymentMethod]} <Explain label={`${methodText[row.paymentMethod]}怎么收费`} content={methodNote[row.paymentMethod]} /></>} sub={saved.configured ? undefined : <StatusTag tone="warn">未配置</StatusTag>} /></Td>
                  {FEE_FIELDS.map(field => {
                    if (field === "networkConfirmFeeUsdt" && row.paymentMethod === "HDPAY_BANK") return <Td key={field} align={canEdit && policy.constraints ? "left" : "right"}><Cell main="不收" /></Td>;
                    if (field === "minTopupPrincipal" && row.paymentMethod !== "HDPAY_BANK") {
                      return <Td key={field} align={canEdit && policy.constraints ? "left" : "right"}><Cell main={<>{usdt(saved.minTopupPrincipal)} <Explain label="USDT 最低充值金额在哪改" content="USDT 的最低充值金额在「USDT 充值 › 充值与地址设置」改。" /></>} /></Td>;
                    }
                    if (!canEdit || !policy.constraints) return <Td key={field} align="right"><Cell num main={saved[field] == null ? "未配置" : usdt(saved[field])} /></Td>;
                    const issue = touched || row[field] !== saved[field] ? issues[rowIndex]?.[field] : undefined;
                    return <Td key={field}>
                      <NumberInput aria-label={`${methodText[row.paymentMethod]}${feeLabel[field]}`} aria-invalid={issue ? true : undefined} unit={feeUnit[field]} inputMode={field === "minTopupPrincipal" ? "numeric" : "decimal"}
                        placeholder="未配置" step={field === "minTopupPrincipal" ? 1 : 0.01} value={row[field] ?? ""} disabled={busy || policyPending || policyLoading}
                        onChange={event => { const next = event.target.value; setDraft(current => current.map(item => item.paymentMethod === row.paymentMethod ? { ...item, [field]: next === "" && !saved.configured && field !== "minTopupPrincipal" ? null : next } : item)); }} />
                      {issue ? <div className="rd-form-error" role="alert">{issue}</div>
                        : row[field] !== saved[field] && <div className="rd-note">现在 {saved[field] == null ? "未配置" : usdt(saved[field])}</div>}
                    </Td>;
                  })}
                </tr>;
              })}</tbody>
            </Table>
            {canEdit && policy.constraints && <div className="rd-toolbar" data-end="">
              <span className="rd-note">{changed ? `没保存：${changedChannels.map(row => methodText[row.paymentMethod]).join("、")}。切页签不会丢。` : ""}</span>
              <span className="rd-row-actions">
                <Button disabled={busy || policyLoading || policyPending} disabledReason={changed ? undefined : "还没有修改"} onClick={() => { setDraft(policy.channels.map(row => ({ ...row }))); setTouched(false); }}>撤销修改</Button>
                <Button variant="primary" disabledReason={saveBlock} onBlockedClick={() => setTouched(true)} onClick={savePolicy}>保存修改</Button>
              </span>
            </div>}
          </div>}
    </Fold>

    {refreshAsk && (
      <Modal title="有未保存的修改，刷新后会丢失" onClose={() => setRefreshAsk(false)}
        footer={<><Button onClick={() => setRefreshAsk(false)}>继续编辑</Button><Button variant="danger" onClick={doRefreshPolicy}>放弃修改并刷新</Button></>}>
        <p className="rd-note">没保存：{changedChannels.map(row => methodText[row.paymentMethod]).join("、")}。刷新会读取最新的手续费，这些修改不再保留。</p>
      </Modal>
    )}

    <PaymentDetail key={selected ?? "none"} intentNo={selected} owner={owner} owns={owns} ctx={ctx}
      pending={!!selected && pending.some(row => row.scope === selected)}
      nav={{ hasPrev: index > 0, hasNext: index >= 0 && index < items.length - 1, onPrev: () => setSelected(items[index - 1]?.intentNo ?? selected), onNext: () => setSelected(items[index + 1]?.intentNo ?? selected) }}
      onChanged={() => { syncPending(); void loadRecords(); void loadCount(); }} onClose={() => setSelected(null)} />
  </>;
}

function PaymentDetail({ intentNo, owner, owns, ctx, pending, nav, onChanged, onClose }: { intentNo: string | null; owner: number; owns: () => boolean; ctx: DCtx; pending: boolean; nav: { hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void }; onChanged: () => void; onClose: () => void }) {
  const reach = useReach();
  const [record, setRecord] = useState<PurchasePaymentRecord | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const live = useRef(true), sequence = useRef(0), mutation = useRef(false);
  const load = useCallback(async () => {
    if (!intentNo) return;
    const id = ++sequence.current; setLoading(true); setError(""); setRecord(null);
    try { const next = await fetchPurchasePaymentRecord(intentNo); if (live.current && owns() && id === sequence.current) setRecord(next); }
    catch (failure) { if (live.current && owns() && id === sequence.current) setError(message(failure)); }
    finally { if (live.current && owns() && id === sequence.current) setLoading(false); }
  }, [intentNo, owns]);
  useEffect(() => { live.current = true; void load(); return () => { live.current = false; sequence.current++; }; }, [load]);
  const canReconcile = allowed("finance_d1_bank_reconcile");
  const block = loading ? "正在读取最新数据" : busy ? "正在提交" : error ? "这笔付款读取失败，刷新后再试" : revalidateBlock(record, pending);
  function revalidate() {
    if (!record || block || !intentNo || !canReconcile) return;
    const current = record;
    const expectedVersion = record.version!;
    ctx.openActionConfirm({ briefKind: "funds", action: `重新核对到账 · ${intentNo}`, title: "重新核对到账", reasonMin: 10, reasonMax: 300,
      confirmLabel: "确认核对",
      effect: <StatusTag tone="progress" filled>立即核对</StatusTag>,
      facts: <Facts>
        <Fact k="用户实付" lead tone="role-1" unit="USDT">{usdt(current.totalUsdt)}</Fact>
        <Fact k="付款单">{intentNo}</Fact>
        <Fact k="用户">{current.userId}</Fact>
        <Fact k="现在状态">{stateText[current.status]}</Fact>
      </Facts>,
      detail: "会再查一次支付商或链上记录，并重新检查库存、资格和设备位。",
      completionCopy: "不会重新收款、强制完成、退款，也不会转进钱包余额。金额不对、到账太晚或核对不通过的，仍然留给人工处理。",
      run: async reason => {
        if (mutation.current || !live.current || !owns()) throw new Error("付款信息或登录身份已变化，请重新打开详情。");
        mutation.current = true; setBusy(true); setError("");
        try {
          const next = await revalidatePurchasePayment(owner, intentNo, expectedVersion, reason) as PurchasePaymentRecord;
          if (!live.current || !owns()) return;
          setRecord(next); ctx.toast(`已重新核对：${stateText[next.status]}。${purchaseWasDelivered(next) ? "业务已完成。" : "业务还没完成，请按当前状态继续处理。"}`, "success"); onChanged();
        } catch (failure) { if (live.current && owns()) { onChanged(); void load(); } throw failure; }
        finally { mutation.current = false; if (live.current && owns()) setBusy(false); }
      } });
  }
  const r = record;
  return <Drawer open={!!intentNo} onClose={onClose} title="付款详情" sub={intentNo ?? undefined} icon={ReceiptText} tone="role-2" busy={busy} nav={nav}
    footer={<Decision
      note={canReconcile ? block : undefined}
      explain="再查一次支付商或链上记录。不会重新收款、强制完成、退款，也不会转进钱包余额。"
      others={reach("/platform/audit", "platform_a2_read") && intentNo ? <Link className="rd-link" href={`/platform/audit?domain=D&object=${encodeURIComponent(intentNo)}`}>到「操作记录」查看处理过程</Link> : undefined}
      primary={canReconcile ? <Button variant="primary" disabledReason={block} onClick={revalidate}>重新核对到账</Button> : undefined} />}>
    {error ? <BlockState state="error" title="付款详情读取失败" detail={error} onRetry={() => void load()} />
      : <JudgmentPoints loading={loading || !r} rows={r ? [
        { label: "用户实付", icon: Coins, tone: "money", value: `${usdt(r.totalUsdt)} USDT`, reason: `订单 ${usdt(r.subtotalUsdt)} · 手续费 ${usdt(r.channelFeeUsdt)} · 网络费 ${usdt(r.networkConfirmFeeUsdt)}` },
        { label: "用户", icon: User, tone: "users", value: r.userId, reason: `${kindText[r.kind] ?? "用途待确认"} · ${methodText[r.paymentMethod]}` },
        { label: "状态", state: stateTone(r.status) === "progress" ? undefined : stateTone(r.status), value: stateText[r.status], reason: r.reason ?? undefined },
        { label: "完成", state: purchaseWasDelivered(r) && r.status === "DELIVERED" && r.receipt ? undefined : "warn", value: purchaseWasDelivered(r) ? "已完成" : r.receipt ? "已有回执，待确认" : "还没完成", reason: deliveryNote(r) },
        ...(pending ? [{ label: "待确认", state: "warn" as const, value: "这笔付款有一次操作还没确认结果，请在页面上方的提醒里查看。" }] : []),
      ] : []} />}
    {r && <>
      <Fold inset title="金额明细" summary={r.paymentMethod === "HDPAY_BANK" ? (r.amountVnd ? `应付 ${vnd(r.amountVnd)} VND` : "应付越南盾尚未提供") : "矿工费由用户另付"}>
        <KeyValues rows={[
          { key: "business", label: "订单金额", value: r.businessAmountUsdt == null ? "尚未提供" : `${usdt(r.businessAmountUsdt)} USDT` },
          { key: "subtotal", label: "收款金额", value: `${usdt(r.subtotalUsdt)} USDT` },
          { key: "round", label: "取整差额", value: r.roundingAdjustmentUsdt == null ? "尚未提供" : `${usdt(r.roundingAdjustmentUsdt)} USDT` },
          { key: "fee", label: "手续费", value: `${usdt(r.channelFeeUsdt)} USDT` },
          { key: "network", label: "网络费", value: `${usdt(r.networkConfirmFeeUsdt)} USDT` },
          { key: "cost", label: "通道实际成本", value: r.providerActualFeeUsdt == null ? "尚未提供" : `${usdt(r.providerActualFeeUsdt)} USDT` },
          ...(r.paymentMethod === "HDPAY_BANK" ? [
            { key: "fx", label: "锁定汇率", value: r.fxRateVndPerUsdt ? `1 USDT = ${vnd(r.fxRateVndPerUsdt)} VND` : "尚未提供" },
            { key: "vnd", label: "应付越南盾", value: r.amountVnd ? `${vnd(r.amountVnd)} VND` : "尚未提供" },
          ] : [{ key: "gas", label: "矿工费", value: `用户在自己钱包里另付的 ${r.paymentMethod === "CREGIS_USDT_ERC20" ? "ETH" : "BNB"} 矿工费不算在内。` }]),
        ]} />
      </Fold>
      {r.arrivals && <Fold inset title="链上到账" summary={r.arrivals.length ? `${r.arrivals.length} 笔` : "还没有链上到账记录"}>
        {r.arrivals.length === 0 ? <p className="rd-note">还没有链上到账记录。</p> : <Table label="链上到账">
          <thead><tr><Th>交易号</Th><Th align="right">到账（USDT）</Th><Th align="right">确认数</Th><Th>核对结果</Th></tr></thead>
          <tbody>{r.arrivals.map(row => <tr key={`${row.txid}:${row.log_index}`}>
            <Td><Cell mono main={row.txid} title={row.txid} sub={`日志 ${row.log_index} · 区块 ${row.block_number}`} /></Td>
            <Td align="right"><Cell num main={usdt(row.amount)} /></Td>
            <Td align="right"><Cell num main={row.confirmations} /></Td>
            <Td><Cell main={row.status === "CONFIRMED" ? "已核对" : row.status === "MANUAL_REVIEW" ? "需人工处理" : "待确认"} /></Td>
          </tr>)}</tbody>
        </Table>}
      </Fold>}
      <Fold inset title="单号和版本" summary={`付款单版本 ${r.version ?? "尚未提供"}`}>
        <KeyValues rows={[
          { key: "version", label: "付款单版本", value: r.version ?? "尚未提供" },
          { key: "fee", label: "锁定费用版本", value: r.feePolicyVersion ?? "尚未提供" },
          { key: "provider", label: "支付商单号", value: r.providerReference || "尚未提供", mono: !!r.providerReference },
          { key: "created", label: `创建时间（${zoneLabel()}）`, value: time(r.createdAt) },
          { key: "updated", label: `更新时间（${zoneLabel()}）`, value: time(r.updatedAt) },
        ]} />
      </Fold>
    </>}
  </Drawer>;
}
