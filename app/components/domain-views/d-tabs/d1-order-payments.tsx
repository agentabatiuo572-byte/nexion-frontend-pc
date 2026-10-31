"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { formatBusinessTimeCompact, businessZoneText } from "@/lib/admin/business-time";
import { Modal, DataListPager } from "../design-kit";
import { purchasePaymentMethods, purchasePaymentStates, purchaseMoney, purchaseWasDelivered, validPurchaseChannel, type PurchasePaymentChannel, type PurchasePaymentPolicy, type PurchasePaymentPage, type PurchasePaymentRecord } from "@/lib/admin/purchase-payment-contract";
import { fetchPurchasePaymentPolicy, fetchPurchasePaymentRecords, fetchPurchasePaymentRecord, updatePurchasePaymentPolicy, revalidatePurchasePayment, pendingPurchasePayments, retryPurchasePayment, canRetryPurchasePayment, type PendingPurchasePayment } from "@/lib/admin/purchase-payment-client";
import type { DCtx } from "./types";
import "./d1-order-payments.css";

const methodText = { HDPAY_BANK: "HDPay 银行直付", CREGIS_USDT_BSC: "USDT-BSC 链上直付", CREGIS_USDT_ERC20: "USDT-ERC20 链上直付" };
const stateText = { CREATING: "正在创建付款单", SUBMIT_UNKNOWN: "创建结果待核实", AWAITING_PAYMENT: "等待付款", FUNDS_CONFIRMED: "已核实收款，待交付", DELIVERED: "业务已交付", MANUAL_REVIEW: "待人工核查", EXPIRED: "付款单已过期" };
const kindText: Record<string, string> = { ORDER_PAY: "订单购买", TRIAL_CONVERT: "试用转购买", TRADE_IN: "升级置换", CAPACITY_REPLACE: "容量替换", CAPACITY_KEEP: "保留扩容" };
const message = (failure: unknown) => failure instanceof Error ? failure.message : "订单付款信息未确认，请重新查询。";
const time = (value: string) => formatBusinessTimeCompact(value);
const channelInput = (row: PurchasePaymentChannel) => ({ ...row, networkConfirmFeeUsdt: row.paymentMethod === "HDPAY_BANK" ? "0" : row.networkConfirmFeeUsdt });
const allowed = (authority: string) => { const session = useAdminAuth.getState().session; return !!session && (session.authorities.includes(authority) || ["superadmin", "super"].includes(session.role)); };

export function D1OrderPayments({ ctx }: { ctx: DCtx }) {
  const session = useAdminAuth(s => s.session), epoch = useAdminAuth(s => s.authEpoch);
  if (!session || !allowed("finance_d1_read")) return null;
  return <Workspace key={`${session.adminId}:${epoch}`} ctx={ctx} owner={session.adminId} epoch={epoch} />;
}

function Workspace({ ctx, owner, epoch }: { ctx: DCtx; owner: number; epoch: number }) {
  const [policy, setPolicy] = useState<PurchasePaymentPolicy | null>(null), [draft, setDraft] = useState<PurchasePaymentChannel[]>([]);
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
  async function recover(row: PendingPurchasePayment, retry: boolean) {
    if (mutation.current || !owns()) return;
    mutation.current = true; setBusy(true); setOperationError(""); setNotice("");
    try {
      if (retry) {
        const result = await retryPurchasePayment(row);
        if (!owns()) return;
        setNotice(row.scope === "policy" ? "原请求已返回生效规则，请核对下方当前版本；操作审计可在既有操作记录中查询。" : `原请求已返回：${stateText[(result as PurchasePaymentRecord).status]}。请查看付款单详情。`);
      } else if (row.scope === "policy") {
        const current = await fetchPurchasePaymentPolicy();
        if (!owns()) return;
        setNotice(`当前规则版本 v${current.version}。当前值不能单独证明原请求结果，请继续使用原请求核实或查询操作记录。`);
      } else {
        const current = await fetchPurchasePaymentRecord(row.scope);
        if (!owns()) return;
        setSelected(current.intentNo); setNotice(`当前付款单状态：${stateText[current.status]}。原请求的恢复记录仍保留。`);
      }
      if (retry) { syncPending(); await Promise.all([loadPolicy(), loadRecords()]); }
    } catch (failure) { if (owns()) setOperationError(message(failure)); }
    finally { mutation.current = false; if (owns()) { syncPending(); setBusy(false); } }
  }
  function savePolicy() {
    if (!policy || !valid || !changed || policyPending || busy || !allowed("finance_d1_fx_manage")) return;
    const currentPolicy = policy, channels = changedChannels.filter(row => validPurchaseChannel(row, policy.constraints)).map(({ configured: _configured, ...row }) => row);
    ctx.openActionConfirm({ action: "调整订单直付费用与最低充值额", reasonMin: 10, reasonMax: 300,
      detail: <><p>以当前版本 v{currentPolicy.version} 校验后保存。仅保存本次明确填写的渠道；未调整渠道保持原状态。仅之后创建的报价使用新费用，既有付款单保留费用快照。</p><table className="l-tbl"><thead><tr><th>渠道</th><th>调整前</th><th>调整后</th></tr></thead><tbody>{channels.map(row => { const before = currentPolicy.channels.find(item => item.paymentMethod === row.paymentMethod)!; const label = (item: typeof row) => `${item.channelFeeRatePct}% + ${purchaseMoney(item.channelFeeFixed)}；网络 ${purchaseMoney(item.networkConfirmFeeUsdt)}；充值最低 ${purchaseMoney(item.minTopupPrincipal)}`; return <tr key={row.paymentMethod}><td>{methodText[row.paymentMethod]}</td><td>{before.configured && validPurchaseChannel(before) ? label(before) : `费用未配置；充值最低 ${purchaseMoney(before.minTopupPrincipal)}`}</td><td>{label(row)}</td></tr>; })}</tbody></table><p>BEP20 / ERC20 最低充值额在原 Cregis 规则中经另一管理员审批调整。</p></>,
      completionCopy: "保存后以服务端返回的生效规则为准；不会执行收款、退款或入账。",
      run: async reason => {
        if (mutation.current || !owns()) throw new Error("操作状态已变化，请重新打开页面。");
        mutation.current = true; setBusy(true); setOperationError(""); setNotice("");
        try {
          await updatePurchasePaymentPolicy(owner, currentPolicy.version, channels, reason);
          if (!owns()) return;
          setNotice("服务端已返回本次生效规则，请核对当前值和版本。既有付款单保留原费用快照。");
          await loadPolicy();
        } catch (failure) { if (owns()) { setOperationError(message(failure)); await loadPolicy(); } throw failure; }
        finally { mutation.current = false; if (owns()) { syncPending(); setBusy(false); } }
      } });
  }
  return <section className="l-card d1-order-payments" aria-label="订单直付与费用">
    <div className="l-h"><span className="ttl">订单直付与费用</span><span className="sub">购买、试用转购买、升级置换与扩容</span></div>
    <div className="l-b">
      <p className="dtint">钱包余额付款的渠道费和网络费均为 0，仍按钱包支付密码规则验证。HDPay 银行直付和 USDT-BSC / ERC20 链上直付无需支付密码，不受其锁定影响。收款核实与业务交付分别展示。</p>
      {operationError && <p className="dtint warn" role="alert">{operationError}</p>}{notice && <p className="dtint" role="status">{notice}</p>}
      {pending.length > 0 && <div className="dtint warn" aria-label="待核实的订单付款请求"><strong>有操作结果待核实，恢复记录跨刷新保留</strong>{pending.map(row => <div className="p-row" key={row.commandKey}><div className="txt"><div className="k">{row.scope === "policy" ? "费用与最低充值额配置" : row.scope}</div><div className="s">请求号：{row.commandKey}</div></div><button className="l-btn sm" disabled={busy} onClick={() => void recover(row, false)}>查看当前状态</button>{canRetryPurchasePayment(row) ? <button className="l-btn sm" disabled={busy || !allowed(row.scope === "policy" ? "finance_d1_fx_manage" : "finance_d1_bank_reconcile")} onClick={() => void recover(row, true)}>使用原请求重试</button> : <span>原请求已超过重试时间，请查询操作记录继续核实。</span>}</div>)}<Link href="/platform/audit?domain=D">查看操作记录</Link></div>}
      <details className="d1-payment-config"><summary>费用及最低充值额配置{policy ? ` · 当前版本 v${policy.version}` : " · 尚未确认"}</summary>
        {policyLoading && <p role="status">正在读取生效规则…</p>}{policyError && <p className="dtint warn" role="alert">{policyError}</p>}
        <button className="l-btn sm" disabled={busy || policyLoading} onClick={() => void loadPolicy()}>重新读取规则</button>
        {policy && <><div className="d1-payment-scroll"><table className="l-tbl" aria-label="订单直付费用规则"><thead><tr><th>渠道</th><th>渠道费率（%）</th><th>固定渠道费（USDT）</th><th>网络确认费（USDT）</th><th>最低充值本金</th></tr></thead><tbody>
          <tr><td>钱包余额</td><td>0.00</td><td>0.00</td><td>0.00</td><td>不适用</td></tr>
          {draft.map((row, index) => <tr key={row.paymentMethod}><td>{methodText[row.paymentMethod]}{!policy.channels.find(item => item.paymentMethod === row.paymentMethod)!.configured && <div className="sub">费用未配置，直付暂不可用</div>}</td>{(["channelFeeRatePct", "channelFeeFixed", "networkConfirmFeeUsdt", "minTopupPrincipal"] as const).map(field => {
            const readOnly = !policy.constraints || !allowed("finance_d1_fx_manage") || field === "minTopupPrincipal" && row.paymentMethod !== "HDPAY_BANK" || field === "networkConfirmFeeUsdt" && row.paymentMethod === "HDPAY_BANK";
            const label = { channelFeeRatePct: "渠道费率", channelFeeFixed: "固定渠道费", networkConfirmFeeUsdt: "网络确认费", minTopupPrincipal: "最低充值本金" }[field];
            const bounds = field === "channelFeeRatePct" ? policy.constraints?.ratePct : field === "minTopupPrincipal" ? policy.constraints?.minTopupPrincipal : policy.constraints?.feeUsdt;
            const current = policy.channels.find(item => item.paymentMethod === row.paymentMethod)!;
            const effective = current[field];
            return <td key={field}><input aria-label={`${methodText[row.paymentMethod]}${label}`} type="number" inputMode={field === "minTopupPrincipal" ? "numeric" : "decimal"} placeholder={field === "networkConfirmFeeUsdt" && row.paymentMethod === "HDPAY_BANK" ? "不收网络费" : "请明确填写"} min={bounds ? Number(bounds.min) : undefined} max={bounds ? Number(bounds.max) : undefined} step={field === "minTopupPrincipal" ? 1 : "0.01"} value={row[field] ?? ""} readOnly={readOnly} disabled={busy || policyPending} onChange={event => setDraft(current => current.map((item, i) => i === index ? { ...item, [field]: event.target.value } : item))} /><div className="sub">生效值 {effective === null ? "—（未配置）" : `${purchaseMoney(effective)}${field === "channelFeeRatePct" ? "%" : row.paymentMethod === "HDPAY_BANK" && field === "minTopupPrincipal" ? " USD / USDT 本金" : " USDT"}`}</div></td>;
          })}</tr>)}
        </tbody></table></div><p className="sub">渠道费 = 本金 × 费率 + 固定费；USDT-BSC / ERC20 另收网络确认费，HDPay 不收网络费。费率 0–100%，费用非负、最多两位小数；最低充值本金必须为正整数，显示两位小数。最低充值额不限制订单直付金额，订单及费用可有小数。</p>
          <p className="sub">BEP20 / ERC20 最低充值本金只读，前往下方 Cregis「充值与地址设置」按原 A2 流程申请，另一管理员批准后生效。</p>
          <p className="sub">未配置费用的渠道不能创建直付报价，不影响既有付款单恢复或原充值最低额。费率、固定费及各链网络费须明确填写；明确保存全 0 表示免费。</p>
          <p className="sub">{policy.constraints ? `服务端允许范围：费率 ${policy.constraints.ratePct.min}–${policy.constraints.ratePct.max}%；单项费用 ${policy.constraints.feeUsdt.min}–${policy.constraints.feeUsdt.max} USDT；最低充值本金 ${policy.constraints.minTopupPrincipal.min}–${policy.constraints.minTopupPrincipal.max} 的整数。` : "服务端尚未提供完整调整范围，当前仅可查看。"}</p>
          {allowed("finance_d1_fx_manage") && <button className="l-btn sm mc" disabled={busy || policyLoading || policyPending || !valid || !changed} onClick={savePolicy}>核对并保存费用规则</button>}
        </>}
      </details>
      <div className="d1-payment-toolbar"><h3>订单付款记录 / 异常</h3><label>状态<select aria-label="订单付款状态" value={status} disabled={busy} onChange={event => { setStatus(event.target.value); setPage(1); }}><option value="">全部状态</option>{purchasePaymentStates.map(value => <option key={value} value={value}>{stateText[value]}</option>)}</select></label><label>渠道<select aria-label="订单付款渠道" value={method} disabled={busy} onChange={event => { setMethod(event.target.value); setPage(1); }}><option value="">全部渠道</option>{purchasePaymentMethods.map(value => <option key={value} value={value}>{methodText[value]}</option>)}</select></label><button className="l-btn sm" disabled={busy || recordsLoading} onClick={() => void loadRecords()}>刷新付款记录</button></div>
      {recordsError && <p className="dtint warn" role="alert">{recordsError}</p>}{recordsLoading && <p role="status">正在读取付款记录…</p>}
      {records && <><div className="d1-payment-scroll"><table className="l-tbl" aria-label="订单付款记录"><thead><tr><th>付款单 / 用户</th><th>业务 / 渠道</th><th>本金 USDT</th><th>渠道费 / 网络费</th><th>总额 USDT</th><th>状态</th><th>创建时间（{businessZoneText()}）</th><th>操作</th></tr></thead><tbody>{records.items.map(row => <tr key={row.intentNo}><td>{row.intentNo}<div className="sub">用户 {row.userId}</div></td><td>{kindText[row.kind] ?? "业务类型待核实"}<div className="sub">{methodText[row.paymentMethod]}</div></td><td>{purchaseMoney(row.subtotalUsdt)}</td><td>{purchaseMoney(row.channelFeeUsdt)} / {purchaseMoney(row.networkConfirmFeeUsdt)}</td><td>{purchaseMoney(row.totalUsdt)}</td><td><span className={`bdg ${row.status === "DELIVERED" ? "ok" : "warn"}`}>{stateText[row.status]}</span>{purchaseWasDelivered(row) && row.status !== "DELIVERED" && <div className="sub">原业务已交付</div>}{row.reason && <div className="sub">{row.reason}</div>}</td><td>{time(row.createdAt)}</td><td><button className="l-btn sm" onClick={() => setSelected(row.intentNo)}>查看详情</button></td></tr>)}{records.items.length === 0 && <tr><td colSpan={8}>当前筛选暂无订单付款记录。</td></tr>}</tbody></table></div><DataListPager label="订单付款记录" page={records.pageNum} pageSize={20} total={records.total} pageSizeOptions={[20]} onPageChange={next => setPage(next)} onPageSizeChange={() => setPage(1)} /></>}
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
    ctx.openActionConfirm({ action: `重新核验并尝试交付 · ${intentNo}`, reasonMin: 10, reasonMax: 300,
      detail: `用户 ${current.userId}，当前${stateText[current.status]}，总额 ${purchaseMoney(current.totalUsdt)} USDT，版本 v${current.version}。将查询原支付商记录或原网络链上凭证，并重新检查库存、资格、六槽位等当前业务条件。短付、超付、迟到或核验未通过仍留待人工核查。`,
      completionCopy: "只按原付款单重新核验，不重新收款、不强制交付、不退款，也不转为钱包余额。",
      run: async reason => {
        if (mutation.current || !live.current || !owns()) throw new Error("付款单或登录身份已变化，请重新打开详情。");
        mutation.current = true; setBusy(true); setError(""); setNotice("");
        try {
          const next = await revalidatePurchasePayment(owner, intentNo, current.version, reason) as PurchasePaymentRecord;
          if (!live.current || !owns()) return;
          setRecord(next); setNotice(`原付款单重新核验已返回：${stateText[next.status]}。${purchaseWasDelivered(next) ? "原业务已交付，交付事实以服务端回执为准。" : "尚未确认业务交付完成，请按当前状态继续核查。"}`); onChanged();
        } catch (failure) { if (live.current && owns()) { setRecord(null); setError(message(failure)); onChanged(); } throw failure; }
        finally { mutation.current = false; if (live.current && owns()) setBusy(false); }
      } });
  }
  return <Modal title={`订单付款详情 · ${intentNo}`} wide busy={busy} onClose={onClose} footer={<><button className="l-btn" disabled={busy} onClick={onClose}>关闭</button><button className="l-btn" disabled={busy} onClick={() => void load()}>重新查询</button>{allowed("finance_d1_bank_reconcile") && <button className="l-btn primary" disabled={busy || pending || !record || purchaseWasDelivered(record) || !!record.receipt || ["EXPIRED", "CREATING"].includes(record.status)} onClick={revalidate}>重新核验并尝试交付</button>}</>}>
    <div className="d1-order-payments">{busy && !record && <p role="status">正在读取付款单…</p>}{error && <p className="dtint warn" role="alert">{error}</p>}{pending && <p className="dtint warn">有一笔原请求等待核实，请在订单直付的恢复记录中查询或使用原请求重试。</p>}{notice && <p className="dtint" role="status">{notice}</p>}
      {record && <><dl className="d1-payment-facts">{[["用户", record.userId], ["显示时区", businessZoneText()], ["原业务交付", purchaseWasDelivered(record) ? "已交付" : record.receipt ? "已有回执，交付状态待核实" : "尚未确认交付"], ["业务", kindText[record.kind] ?? "业务类型待核实"], ["渠道", methodText[record.paymentMethod]], ["状态", stateText[record.status]], ["原业务金额", record.businessAmountUsdt == null ? "尚未提供" : `${record.businessAmountUsdt} USDT`], ["收款本金", `${purchaseMoney(record.subtotalUsdt)} USDT`], ["本金舍入差额", record.roundingAdjustmentUsdt == null ? "尚未提供" : `${record.roundingAdjustmentUsdt} USDT`], ["用户渠道费", `${purchaseMoney(record.channelFeeUsdt)} USDT`], ["用户网络确认费", `${purchaseMoney(record.networkConfirmFeeUsdt)} USDT`], ["用户实付总额", `${purchaseMoney(record.totalUsdt)} USDT`], ["支付商实际费用", record.providerActualFeeUsdt == null ? "尚未提供" : `${purchaseMoney(record.providerActualFeeUsdt)} USDT`], ["费用快照版本", `v${record.feePolicyVersion}`], ["付款单版本", `v${record.version}`], ["原支付商单号", record.providerReference || "尚未提供"], ["创建 / 更新", `${time(record.createdAt)} / ${time(record.updatedAt)}`], ["异常说明", record.reason || "暂无异常说明"]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        {record.paymentMethod === "HDPAY_BANK" ? <dl className="d1-payment-facts"><div><dt>锁定 VND 汇率</dt><dd>{record.fxRateVndPerUsdt ? `1 USDT = ${record.fxRateVndPerUsdt} VND` : "尚未提供"}</dd></div><div><dt>实际 VND 应付</dt><dd>{record.amountVnd ? `${BigInt(record.amountVnd).toLocaleString("zh-CN")} VND` : "尚未提供"}</dd></div></dl> : <p className="sub">外部钱包另付的 {record.paymentMethod === "CREGIS_USDT_ERC20" ? "ETH" : "BNB"} Gas 不包含在平台网络确认费和实付总额中。</p>}
        <p className="dtint">{purchaseWasDelivered(record) ? record.status === "DELIVERED" ? record.receipt ? "服务端已确认业务交付并返回回执。" : "服务端状态为已交付，但未提供业务回执，请继续核对原业务记录。" : "原业务已交付，资金异常待核查；不会再次交付、自动退款或增加钱包余额。" : record.receipt ? "已返回原业务回执，交付状态待核实；请核对原业务记录，不会重复交付。" : "付款处理中或已收到资金均不代表业务已交付。当前不会自动退款或转入钱包余额。"}</p>{record.arrivals && <><h3>链上到款凭证</h3><div className="d1-payment-scroll"><table className="l-tbl" aria-label="链上到款凭证"><thead><tr><th>交易 / 日志</th><th>金额 USDT</th><th>区块 / 确认数</th><th>核验状态</th></tr></thead><tbody>{record.arrivals.map(row => <tr key={`${row.txid}:${row.log_index}`}><td>{row.txid}<div className="sub">日志 {row.log_index}</div></td><td>{row.amount}</td><td>{row.block_number} / {row.confirmations}<div className="sub">{row.block_hash}</div></td><td>{row.status === "CONFIRMED" ? "链上已核验" : row.status === "MANUAL_REVIEW" ? "待人工核查" : "凭证状态待核实"}</td></tr>)}{record.arrivals.length === 0 && <tr><td colSpan={4}>尚无链上到款凭证。</td></tr>}</tbody></table></div></>}<Link href="/platform/audit?domain=D">查询处置审计</Link></>}
    </div>
  </Modal>;
}
