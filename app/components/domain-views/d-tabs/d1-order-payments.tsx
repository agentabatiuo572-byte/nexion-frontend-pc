"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { formatBusinessTimeCompact, businessZoneText } from "@/lib/admin/business-time";
import { Modal, DataListPager } from "../design-kit";
import { TabGroup } from "@/app/components/kit/tab-group";
import { purchasePaymentMethods, purchasePaymentStates, purchaseMoney, purchaseWasDelivered, validPurchaseChannel, type PurchasePaymentChannel, type PurchasePaymentPolicy, type PurchasePaymentPage, type PurchasePaymentRecord } from "@/lib/admin/purchase-payment-contract";
import { fetchPurchasePaymentPolicy, fetchPurchasePaymentRecords, fetchPurchasePaymentRecord, updatePurchasePaymentPolicy, revalidatePurchasePayment, pendingPurchasePayments, retryPurchasePayment, canRetryPurchasePayment, type PendingPurchasePayment } from "@/lib/admin/purchase-payment-client";
import type { DCtx } from "./types";
import "./d1-order-payments.css";

const methodText = { HDPAY_BANK: "银行卡支付", CREGIS_USDT_BSC: "USDT（BEP20）", CREGIS_USDT_ERC20: "USDT（ERC20）" };
// Spaced so Latin names read naturally inside the Chinese sentence.
const methodShort = { HDPAY_BANK: "银行卡", CREGIS_USDT_BSC: " BEP20 ", CREGIS_USDT_ERC20: " ERC20 " };
const methodNote = { HDPAY_BANK: "按下方手续费收取，不需要支付密码", CREGIS_USDT_BSC: "按下方手续费和网络费收取，不需要支付密码", CREGIS_USDT_ERC20: "以太坊网络费较高，单独设置，不需要支付密码" };
const stateText = { CREATING: "正在创建", SUBMIT_UNKNOWN: "创建结果未确认", AWAITING_PAYMENT: "等待付款", FUNDS_CONFIRMED: "已收款，待完成", DELIVERED: "已完成", MANUAL_REVIEW: "需人工处理", EXPIRED: "已过期" };
const kindText: Record<string, string> = { ORDER_PAY: "购买", TRIAL_CONVERT: "试用转购买", TRADE_IN: "升级置换", CAPACITY_REPLACE: "替换设备位", CAPACITY_KEEP: "扩容" };
const message = (failure: unknown) => failure instanceof Error ? failure.message : "加载失败，请刷新重试。";
const time = (value: string) => formatBusinessTimeCompact(value);
const channelInput = (row: PurchasePaymentChannel) => ({ ...row, networkConfirmFeeUsdt: row.paymentMethod === "HDPAY_BANK" ? "0" : row.networkConfirmFeeUsdt });
const allowed = (authority: string) => { const session = useAdminAuth.getState().session; return !!session && (session.authorities.includes(authority) || ["superadmin", "super"].includes(session.role)); };

export type D1PaymentActivity = { dirtyChannels: number; pendingCommands: number };

export function D1OrderPayments({ ctx, onActivityChange }: { ctx: DCtx; onActivityChange: (activity: D1PaymentActivity) => void }) {
  const session = useAdminAuth(s => s.session), epoch = useAdminAuth(s => s.authEpoch);
  if (!session || !allowed("finance_d1_read")) return null;
  return <Workspace key={`${session.adminId}:${epoch}`} ctx={ctx} owner={session.adminId} epoch={epoch} onActivityChange={onActivityChange} />;
}

function Workspace({ ctx, owner, epoch, onActivityChange }: { ctx: DCtx; owner: number; epoch: number; onActivityChange: (activity: D1PaymentActivity) => void }) {
  const [policy, setPolicy] = useState<PurchasePaymentPolicy | null>(null), [draft, setDraft] = useState<PurchasePaymentChannel[]>([]);
  const [feeGroup, setFeeGroup] = useState<"bank" | "usdt">("bank"), [feeNetwork, setFeeNetwork] = useState<"CREGIS_USDT_BSC" | "CREGIS_USDT_ERC20">("CREGIS_USDT_BSC");
  const [records, setRecords] = useState<PurchasePaymentPage | null>(null), [status, setStatus] = useState(""), [method, setMethod] = useState(""), [page, setPage] = useState(1);
  const [pending, setPending] = useState<PendingPurchasePayment[]>([]), [selected, setSelected] = useState<string | null>(null);
  const [policyError, setPolicyError] = useState(""), [recordsError, setRecordsError] = useState(""), [operationError, setOperationError] = useState(""), [notice, setNotice] = useState("");
  const [policyLoading, setPolicyLoading] = useState(true), [recordsLoading, setRecordsLoading] = useState(true), [busy, setBusy] = useState(false);
  const live = useRef(true), policySequence = useRef(0), recordSequence = useRef(0), mutation = useRef(false);
  const owns = useCallback(() => live.current && useAdminAuth.getState().session?.adminId === owner && useAdminAuth.getState().authEpoch === epoch, [owner, epoch]);
  const syncPending = useCallback(() => setPending(pendingPurchasePayments(owner)), [owner]);
  const loadPolicy = useCallback(async () => {
    const sequence = ++policySequence.current; setPolicyLoading(true); setPolicyError(""); setPolicy(null); setDraft([]);
    try { const next = await fetchPurchasePaymentPolicy(); if (owns() && sequence === policySequence.current) { setPolicy(next); setDraft(next.channels.map(row => ({ ...row }))); } }
    catch (failure) { if (owns() && sequence === policySequence.current) setPolicyError(message(failure)); }
    finally { if (owns() && sequence === policySequence.current) setPolicyLoading(false); }
  }, [owns]);
  const loadRecords = useCallback(async () => {
    const sequence = ++recordSequence.current; setRecordsLoading(true); setRecordsError(""); setRecords(null);
    try { const next = await fetchPurchasePaymentRecords({ status, paymentMethod: method, pageNum: page, pageSize: 20 }); if (owns() && sequence === recordSequence.current) setRecords(next); }
    catch (failure) { if (owns() && sequence === recordSequence.current) setRecordsError(message(failure)); }
    finally { if (owns() && sequence === recordSequence.current) setRecordsLoading(false); }
  }, [status, method, page, owns]);
  useEffect(() => { live.current = true; syncPending(); void loadPolicy(); return () => { live.current = false; policySequence.current++; recordSequence.current++; }; }, [loadPolicy, syncPending]);
  useEffect(() => { void loadRecords(); }, [loadRecords]);
  const policyPending = pending.some(row => row.scope === "policy");
  const changedChannels = draft.filter(row => JSON.stringify(policy?.channels.find(item => item.paymentMethod === row.paymentMethod)) !== JSON.stringify(row)).map(channelInput);
  const valid = !!policy?.constraints && changedChannels.length > 0 && changedChannels.every(row => validPurchaseChannel(row, policy.constraints));
  const changed = changedChannels.length > 0;
  useEffect(() => { onActivityChange({ dirtyChannels: changedChannels.length, pendingCommands: pending.length }); }, [onActivityChange, changedChannels.length, pending.length]);
  async function recover(row: PendingPurchasePayment, retry: boolean) {
    if (mutation.current || !owns()) return;
    mutation.current = true; setBusy(true); setOperationError(""); setNotice("");
    try {
      if (retry) {
        const result = await retryPurchasePayment(row);
        if (!owns()) return;
        setNotice(row.scope === "policy" ? "已确认结果，请核对下方手续费。" : `已确认结果：${stateText[(result as PurchasePaymentRecord).status]}。请查看付款详情。`);
      } else if (row.scope === "policy") {
        const current = await fetchPurchasePaymentPolicy();
        if (!owns()) return;
        setNotice(`已刷新手续费（共 ${current.channels.length} 种付款方式）。那次修改是否生效，请到「操作记录」确认。`);
      } else {
        const current = await fetchPurchasePaymentRecord(row.scope);
        if (!owns()) return;
        setSelected(current.intentNo); setNotice(`这笔付款现在是：${stateText[current.status]}。`);
      }
      if (retry) { syncPending(); await Promise.all([loadPolicy(), loadRecords()]); }
    } catch (failure) { if (owns()) setOperationError(message(failure)); }
    finally { mutation.current = false; if (owns()) { syncPending(); setBusy(false); } }
  }
  function savePolicy() {
    if (!policy || !valid || !changed || policyPending || busy || !allowed("finance_d1_fx_manage")) return;
    const currentPolicy = policy, channels = changedChannels.filter(row => validPurchaseChannel(row, policy.constraints)).map(({ configured: _configured, ...row }) => row);
    ctx.openActionConfirm({ action: "修改付款手续费", reasonMin: 10, reasonMax: 300,
      detail: <><p>新手续费只用于之后发起的付款，已下单的按原费用。</p><table className="l-tbl"><thead><tr><th>付款方式</th><th>修改前</th><th>修改后</th></tr></thead><tbody>{channels.map(row => { const before = currentPolicy.channels.find(item => item.paymentMethod === row.paymentMethod)!; const label = (item: typeof row) => `${item.channelFeeRatePct}% + ${purchaseMoney(item.channelFeeFixed)} USDT${item.paymentMethod === "HDPAY_BANK" ? `，最低充值 ${purchaseMoney(item.minTopupPrincipal)} USDT` : `，网络费 ${purchaseMoney(item.networkConfirmFeeUsdt)} USDT`}`; return <tr key={row.paymentMethod}><td>{methodText[row.paymentMethod]}</td><td>{before.configured && validPurchaseChannel(before) ? label(before) : "未设置"}</td><td>{label(row)}</td></tr>; })}</tbody></table>{channels.some(row => !currentPolicy.channels.find(item => item.paymentMethod === row.paymentMethod)!.configured) && <p>保存后费用配置生效；能否付款仍取决于通道及收款地址是否可用。</p>}</>,
      completionCopy: "只修改手续费，不会收款、退款或改动用户余额。",
      run: async reason => {
        if (mutation.current || !owns()) throw new Error("页面状态已变化，请刷新后重试。");
        mutation.current = true; setBusy(true); setOperationError(""); setNotice("");
        try {
          await updatePurchasePaymentPolicy(owner, currentPolicy.version, channels, reason);
          if (!owns()) return;
          setNotice("已保存。新手续费只用于之后发起的付款，已下单的按原费用。");
          await loadPolicy();
        } catch (failure) { if (owns()) { setOperationError(message(failure)); await loadPolicy(); } throw failure; }
        finally { mutation.current = false; if (owns()) { syncPending(); setBusy(false); } }
      } });
  }
  const configuredMethods: PurchasePaymentChannel["paymentMethod"][] = policy ? policy.channels.map(row => row.paymentMethod) : ["HDPAY_BANK", "CREGIS_USDT_BSC"];
  const activeFeeNetwork = configuredMethods.includes(feeNetwork) ? feeNetwork : "CREGIS_USDT_BSC";
  const selectedFeeMethod = feeGroup === "bank" ? "HDPAY_BANK" : activeFeeNetwork;
  const canEdit = allowed("finance_d1_fx_manage");
  return <section className="l-card d1-order-payments" aria-label="订单付款与手续费">
    <div className="l-h"><span className="ttl">订单付款与手续费</span><span className="sub">用户购买设备、试用转购买、升级置换和扩容时的付款</span></div>
    <div className="l-b">
      <p className="dtint"><strong>钱包余额</strong> · 不收手续费，需要输入支付密码。银行卡和 USDT 付款不需要支付密码。</p>
      {operationError && <p className="dtint warn" role="alert">{operationError}</p>}{notice && <p className="dtint" role="status">{notice}</p>}
      {pending.length > 0 && <div className="dtint warn" role="alert" aria-label="还没确认结果的操作"><strong>有 {pending.length} 次操作还没确认结果</strong>{pending.map(row => <div className="p-row" key={row.commandKey}><div className="txt"><div className="k">{row.scope === "policy" ? "修改付款手续费" : `付款 ${row.scope}`}</div><div className="s">请求号 {row.commandKey}</div></div><button className="l-btn sm" disabled={busy} onClick={() => void recover(row, false)}>查看最新结果</button>{canRetryPurchasePayment(row) ? <button className="l-btn sm" disabled={busy || !allowed(row.scope === "policy" ? "finance_d1_fx_manage" : "finance_d1_bank_reconcile")} onClick={() => void recover(row, true)}>再提交一次（不会重复执行）</button> : <span>已超过可重试时间，请到「操作记录」核对。</span>}</div>)}<div className="d1-payment-actions"><Link className="l-btn sm" href="/platform/audit?domain=D">到「操作记录」查看</Link></div></div>}
      <div className="d1-payment-config" aria-label="付款手续费">
        <div className="d1-payment-head"><h3>付款手续费</h3><div className="d1-payment-actions"><Link className="l-btn sm" href="/platform/audit?domain=D">修改历史</Link><button className="l-btn sm" disabled={busy || policyLoading} onClick={() => void loadPolicy()}>刷新</button></div></div>
        <div className="d1-payment-tabs"><TabGroup label="手续费付款方式" value={feeGroup} items={["bank", "usdt"] as const} onSelect={setFeeGroup} className="chips" itemClassName={(_value, selected) => `chip${selected ? " sel" : ""}`}>
          {value => value === "bank" ? "银行卡" : "USDT"}
        </TabGroup>{feeGroup === "usdt" && <TabGroup label="手续费 USDT 网络" value={activeFeeNetwork} items={configuredMethods.filter((value): value is typeof feeNetwork => value !== "HDPAY_BANK")} onSelect={setFeeNetwork} className="chips" itemClassName={(_value, selected) => `chip${selected ? " sel" : ""}`}>
          {value => value === "CREGIS_USDT_BSC" ? "BEP20" : "ERC20"}
        </TabGroup>}</div>
        {policyLoading && <p role="status">正在加载…</p>}{policyError && <p className="dtint warn" role="alert">{policyError}</p>}
        {policy && <><div className="d1-payment-scroll"><table className="l-tbl" aria-label="付款手续费"><thead><tr><th>付款方式</th><th>手续费比例（%）</th><th>每笔固定费（USDT）</th><th>网络费（USDT）</th><th>最低充值金额（USDT）</th></tr></thead><tbody>
          {draft.filter(row => row.paymentMethod === selectedFeeMethod).map(row => <tr key={row.paymentMethod}><td>{methodText[row.paymentMethod]}<div className="sub">{methodNote[row.paymentMethod]}</div>{!policy.channels.find(item => item.paymentMethod === row.paymentMethod)!.configured && <div className="sub warn">未设置手续费，用户暂时不能用{methodShort[row.paymentMethod]}付款</div>}</td>{(["channelFeeRatePct", "channelFeeFixed", "networkConfirmFeeUsdt", "minTopupPrincipal"] as const).map(field => {
            const readOnly = !policy.constraints || !canEdit || field === "minTopupPrincipal" && row.paymentMethod !== "HDPAY_BANK" || field === "networkConfirmFeeUsdt" && row.paymentMethod === "HDPAY_BANK";
            const label = { channelFeeRatePct: "手续费比例", channelFeeFixed: "每笔固定费", networkConfirmFeeUsdt: "网络费", minTopupPrincipal: "最低充值金额" }[field];
            const bounds = field === "channelFeeRatePct" ? policy.constraints?.ratePct : field === "minTopupPrincipal" ? policy.constraints?.minTopupPrincipal : policy.constraints?.feeUsdt;
            const current = policy.channels.find(item => item.paymentMethod === row.paymentMethod)!;
            const effective = current[field];
            if (field === "networkConfirmFeeUsdt" && row.paymentMethod === "HDPAY_BANK") return <td key={field}>不收</td>;
            return <td key={field}><input aria-label={`${methodText[row.paymentMethod]}${label}`} type="number" inputMode={field === "minTopupPrincipal" ? "numeric" : "decimal"} placeholder="请填写" min={bounds ? Number(bounds.min) : undefined} max={bounds ? Number(bounds.max) : undefined} step={field === "minTopupPrincipal" ? 1 : "0.01"} value={row[field] ?? ""} readOnly={readOnly} disabled={busy || policyPending} onChange={event => setDraft(current => current.map(item => item.paymentMethod === row.paymentMethod ? { ...item, [field]: event.target.value } : item))} /><div className="sub">{effective === null ? "当前未设置" : `当前 ${purchaseMoney(effective)}${field === "channelFeeRatePct" ? "%" : ""}`}{field === "minTopupPrincipal" && row.paymentMethod !== "HDPAY_BANK" ? " · 在「USDT 充值 → 充值与地址设置」修改" : ""}</div></td>;
          })}</tr>)}
        </tbody></table></div>
          <p className="sub">用户实付 = 订单金额 + 订单金额 × 手续费比例 + 每笔固定费 + 网络费（仅 USDT）。全部填 0 表示免费。</p>
          <p className="sub">没设置手续费的付款方式，用户暂时不能用它付款。修改后只用于之后发起的付款，已下单的按原费用。</p>
          <p className="sub">{policy.constraints ? `可填范围：比例 ${policy.constraints.ratePct.min}–${policy.constraints.ratePct.max}%，单项费用 ${policy.constraints.feeUsdt.min}–${policy.constraints.feeUsdt.max} USDT，最多两位小数；最低充值金额填 ${policy.constraints.minTopupPrincipal.min}–${policy.constraints.minTopupPrincipal.max} 的整数，只限制充值，不限制订单付款。USDT 的最低充值金额在「USDT 充值 → 充值与地址设置」申请，另一位管理员批准后生效。` : "暂时拿不到可填范围，只能查看，不能修改。"}</p>
          {changed && <p className="sub" role="status">待保存：{changedChannels.map(row => methodText[row.paymentMethod]).join("、")}。切换付款方式保留修改，保存会提交这些渠道。</p>}
          {canEdit && <div className="d1-payment-actions"><button className="l-btn sm" disabled={busy || policyLoading || policyPending || !changed} onClick={() => setDraft(policy.channels.map(row => ({ ...row })))}>撤销修改</button><button className="l-btn sm mc" disabled={busy || policyLoading || policyPending || !valid || !changed} onClick={savePolicy}>保存修改</button></div>}
        </>}
      </div>
      <div className="d1-payment-toolbar"><h3>付款记录</h3><label>状态<select className="ui-control" aria-label="付款状态" value={status} disabled={busy} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">全部状态</option>{purchasePaymentStates.map(value => <option key={value} value={value}>{stateText[value]}</option>)}</select></label><label>付款方式<select className="ui-control" aria-label="付款方式" value={method} disabled={busy} onChange={event => { setMethod(event.target.value); setPage(1); }}><option value="">全部方式</option>{purchasePaymentMethods.map(value => <option key={value} value={value}>{methodText[value]}</option>)}</select></label><button className="l-btn sm" disabled={busy || recordsLoading} onClick={() => void loadRecords()}>刷新</button></div>
      {recordsError && <p className="dtint warn" role="alert">{recordsError}</p>}{recordsLoading && <p role="status">正在加载…</p>}
      {records && <><div className="d1-payment-scroll"><table className="l-tbl" aria-label="付款记录"><thead><tr><th>付款单号 / 用户</th><th>用途 / 付款方式</th><th>订单金额（USDT）</th><th>手续费 / 网络费</th><th>用户实付</th><th>状态</th><th>创建时间（{businessZoneText()}）</th><th>操作</th></tr></thead><tbody>{records.items.map(row => <tr key={row.intentNo}><td>{row.intentNo}<div className="sub">用户 {row.userId}</div></td><td>{kindText[row.kind] ?? "用途待确认"}<div className="sub">{methodText[row.paymentMethod]}</div></td><td>{purchaseMoney(row.subtotalUsdt)}</td><td>{purchaseMoney(row.channelFeeUsdt)} / {purchaseMoney(row.networkConfirmFeeUsdt)}</td><td>{purchaseMoney(row.totalUsdt)}</td><td><span className={`bdg ${row.status === "DELIVERED" ? "ok" : "warn"}`}>{stateText[row.status]}</span>{purchaseWasDelivered(row) && row.status !== "DELIVERED" && <div className="sub">业务已完成</div>}{row.reason && <div className="sub">{row.reason}</div>}</td><td>{time(row.createdAt)}</td><td><button className="l-btn sm" onClick={() => setSelected(row.intentNo)}>查看详情</button></td></tr>)}{records.items.length === 0 && <tr><td colSpan={8}>没有符合条件的付款记录。</td></tr>}</tbody></table></div><DataListPager label="付款记录" page={records.pageNum} pageSize={20} total={records.total} pageSizeOptions={[20]} onPageChange={next => setPage(next)} onPageSizeChange={() => setPage(1)} /></>}
      {selected && <PaymentDetail key={selected} intentNo={selected} owner={owner} owns={owns} ctx={ctx} pending={pending.some(row => row.scope === selected)} onChanged={() => { syncPending(); void loadRecords(); }} onClose={() => setSelected(null)} />}
    </div>
  </section>;
}

function PaymentDetail({ intentNo, owner, owns, ctx, pending, onChanged, onClose }: { intentNo: string; owner: number; owns: () => boolean; ctx: DCtx; pending: boolean; onChanged: () => void; onClose: () => void }) {
  const [record, setRecord] = useState<PurchasePaymentRecord | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const live = useRef(true), sequence = useRef(0), mutation = useRef(false);
  const load = useCallback(async () => {
    const id = ++sequence.current; setBusy(true); setError(""); setRecord(null);
    try { const next = await fetchPurchasePaymentRecord(intentNo); if (live.current && owns() && id === sequence.current) setRecord(next); }
    catch (failure) { if (live.current && owns() && id === sequence.current) setError(message(failure)); }
    finally { if (live.current && owns() && id === sequence.current) setBusy(false); }
  }, [intentNo, owns]);
  useEffect(() => { live.current = true; void load(); return () => { live.current = false; sequence.current++; }; }, [load]);
  function revalidate() {
    if (!record || purchaseWasDelivered(record) || record.receipt || busy || pending || !allowed("finance_d1_bank_reconcile")) return;
    const current = record;
    ctx.openActionConfirm({ action: `重新核对到账 · ${intentNo}`, reasonMin: 10, reasonMax: 300,
      detail: `用户 ${current.userId}，当前${stateText[current.status]}，用户实付 ${purchaseMoney(current.totalUsdt)} USDT。会再查一次支付商或链上记录，并重新检查库存、资格和设备位。金额不对、到账太晚或核对不通过的，仍然留给人工处理。`,
      completionCopy: "不会重新收款、强制完成、退款，也不会转进钱包余额。",
      run: async reason => {
        if (mutation.current || !live.current || !owns()) throw new Error("付款信息或登录身份已变化，请重新打开详情。");
        mutation.current = true; setBusy(true); setError(""); setNotice("");
        try {
          const next = await revalidatePurchasePayment(owner, intentNo, current.version, reason) as PurchasePaymentRecord;
          if (!live.current || !owns()) return;
          setRecord(next); setNotice(`已重新核对：${stateText[next.status]}。${purchaseWasDelivered(next) ? "业务已完成。" : "业务还没完成，请按当前状态继续处理。"}`); onChanged();
        } catch (failure) { if (live.current && owns()) { setRecord(null); setError(message(failure)); onChanged(); } throw failure; }
        finally { mutation.current = false; if (live.current && owns()) setBusy(false); }
      } });
  }
  const facts = (rows: Array<[string, string | number]>) => <dl className="d1-payment-facts">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>;
  return <Modal title={`付款详情 · ${intentNo}`} wide busy={busy} onClose={onClose} footer={<><button className="l-btn" disabled={busy} onClick={onClose}>关闭</button><button className="l-btn" disabled={busy} onClick={() => void load()}>刷新</button>{allowed("finance_d1_bank_reconcile") && <button className="l-btn primary" disabled={busy || pending || !record || purchaseWasDelivered(record) || !!record.receipt || ["EXPIRED", "CREATING"].includes(record.status)} onClick={revalidate}>重新核对到账</button>}</>}>
    <div className="d1-order-payments">{busy && !record && <p role="status">正在加载…</p>}{error && <p className="dtint warn" role="alert">{error}</p>}{pending && <p className="dtint warn">这笔付款有一次操作还没确认结果，请在页面上方的提醒里查看。</p>}{notice && <p className="dtint" role="status">{notice}</p>}
      {record && <><p className="dtint">{purchaseWasDelivered(record) ? record.status === "DELIVERED" ? record.receipt ? "业务已完成。" : "状态是已完成，但没有业务回执，请核对原业务记录。" : "业务已完成，但资金有异常需要核查。不会再次完成、自动退款或转进钱包。" : record.receipt ? "已有业务回执，完成状态待确认；请核对原业务记录，不会重复完成。" : "收到钱不等于已完成。系统不会自动退款，也不会把钱转进用户钱包。"}</p>
        <h3>基本信息</h3>{facts([["用户", record.userId], ["用途", kindText[record.kind] ?? "用途待确认"], ["付款方式", methodText[record.paymentMethod]], ["状态", stateText[record.status]], ["是否已完成", purchaseWasDelivered(record) ? "已完成" : record.receipt ? "已有回执，待确认" : "还没完成"], ["支付商单号", record.providerReference || "尚未提供"], ["创建 / 更新时间", `${time(record.createdAt)} / ${time(record.updatedAt)}（${businessZoneText()}）`], ["异常说明", record.reason || "无"]])}
        <h3>金额（USDT）</h3>{facts([["订单金额", record.businessAmountUsdt == null ? "尚未提供" : record.businessAmountUsdt], ["收款金额", purchaseMoney(record.subtotalUsdt)], ["取整差额", record.roundingAdjustmentUsdt == null ? "尚未提供" : record.roundingAdjustmentUsdt], ["手续费", purchaseMoney(record.channelFeeUsdt)], ["网络费", purchaseMoney(record.networkConfirmFeeUsdt)], ["用户实付", purchaseMoney(record.totalUsdt)], ["通道实际成本", record.providerActualFeeUsdt == null ? "尚未提供" : purchaseMoney(record.providerActualFeeUsdt)]])}
        {record.paymentMethod === "HDPAY_BANK" ? facts([["锁定汇率", record.fxRateVndPerUsdt ? `1 USDT = ${record.fxRateVndPerUsdt} VND` : "尚未提供"], ["应付越南盾", record.amountVnd ? `${BigInt(record.amountVnd).toLocaleString("zh-CN")} VND` : "尚未提供"]]) : <p className="sub">用户在自己钱包里另付的 {record.paymentMethod === "CREGIS_USDT_ERC20" ? "ETH" : "BNB"} 矿工费不算在内。</p>}
        {record.arrivals && <><h3>链上到账</h3><div className="d1-payment-scroll"><table className="l-tbl" aria-label="链上到账"><thead><tr><th>交易号</th><th>到账金额（USDT）</th><th>区块 / 确认数</th><th>核对结果</th></tr></thead><tbody>{record.arrivals.map(row => <tr key={`${row.txid}:${row.log_index}`}><td>{row.txid}<div className="sub">日志 {row.log_index}</div></td><td>{row.amount}</td><td>{row.block_number} / {row.confirmations}<div className="sub">{row.block_hash}</div></td><td>{row.status === "CONFIRMED" ? "已核对" : row.status === "MANUAL_REVIEW" ? "需人工处理" : "待确认"}</td></tr>)}{record.arrivals.length === 0 && <tr><td colSpan={4}>还没有链上到账记录。</td></tr>}</tbody></table></div></>}<div className="d1-payment-actions"><Link className="l-btn sm" href="/platform/audit?domain=D">到「操作记录」查看处理过程</Link></div></>}
    </div>
  </Modal>;
}
