"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { adminAuthActivityAllowed, adminAuthLifecycleEpoch } from "@/lib/admin/auth-lifecycle";
import { financeAdminRequest } from "@/lib/admin/d-client";
import { exceptionCommand, exceptionList, exceptionRead, exceptionObject, type ExceptionPage, type ExceptionRecord } from "@/lib/admin/cregis-exceptions";
import { preparationAmount, preparationConfig, PREPARATION_BLOCKER, PREPARATION_STATE, type PreparationConfig, type PreparationKind } from "@/lib/admin/cregis-funds-preparation";
import type { DCtx } from "./types";

const EMPTY: ExceptionPage = { records: [], hasMore: false, nextBeforeId: null };
const ROOT = "/funds-preparation";
const kindLabel = (kind: unknown) => kind === "COLLECTION" ? "归集准备" : "甲方付款准备";
type Props = { canManage: boolean; openActionConfirm: DCtx["openActionConfirm"] };

export function CregisFundsPreparation(props: Props) {
  const session = useAdminAuth(state => state.session), epoch = useAdminAuth(state => state.authEpoch);
  if (!session?.authorities.includes("finance_d1_read")) return null;
  return <OwnedPreparation key={`${session.adminId}:${epoch}:${adminAuthLifecycleEpoch()}:${props.canManage}:${session.authorities.join("|")}`}
    {...props} owner={session.adminId} ownerEpoch={epoch} />;
}

function OwnedPreparation({ canManage, openActionConfirm, owner, ownerEpoch }: Props & { owner: number; ownerEpoch: number }) {
  const lifecycle = useRef(adminAuthLifecycleEpoch()).current;
  const live = useRef(true), mutation = useRef(false), selection = useRef(0), readEpoch = useRef(0);
  const [config, setConfig] = useState<PreparationConfig | null>(null);
  const [page, setPage] = useState<ExceptionPage>(EMPTY);
  const [kind, setKind] = useState<PreparationKind>("COLLECTION");
  const [source, setSource] = useState(""), [amount, setAmount] = useState(""), [reference, setReference] = useState("");
  const [preflight, setPreflight] = useState<ExceptionRecord | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [loading, setLoading] = useState(true);
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
      if (owns() && at === readEpoch.current) { setConfig(null); setPage(EMPTY); setError(failure instanceof Error ? failure.message : "资金准备读取失败"); }
    } finally { if (owns() && at === readEpoch.current) setLoading(false); }
  }, [scope, owns]);
  useEffect(() => { live.current = true; void refresh(); return () => { live.current = false; selection.current++; }; }, [refresh]);
  const edit = (action: () => void) => { selection.current++; setPreflight(null); action(); };
  const payload = () => {
    if (!config) throw new Error("请先读取资金准备配置");
    if (kind === "COLLECTION" && !config.sources.some(row => row.address === source)) throw new Error("请选择可归集的来源地址");
    return { kind, sourceAddress: kind === "COLLECTION" ? source : config.platformAddress, amountUsdt: preparationAmount(amount) };
  };
  const check = async () => {
    const request = scope(true); request.assertOwner(); if (mutation.current) return;
    let body; try { body = payload(); } catch (failure) { setError((failure as Error).message); return; }
    const at = selection.current; mutation.current = true; setBusy(true); setError(""); setPreflight(null);
    try {
      const response = exceptionObject(await financeAdminRequest<unknown>(`/cregis${ROOT}/preflight`, {
        method: "POST", body: JSON.stringify(body), bankManualAuthEpoch: request.authEpoch,
      }));
      request.assertOwner();
      if (response.executionEnabled !== false || !Array.isArray(response.blockers)
          || response.blockers.some(item => typeof item !== "string")) throw new Error("资金检查结果无效，请重新读取");
      if (at === selection.current) setPreflight(response);
    } catch (failure) { if (owns()) setError(failure instanceof Error ? failure.message : "资金检查失败"); }
    finally { mutation.current = false; if (owns()) setBusy(false); }
  };
  const command = async (path: string, body: ExceptionRecord) => {
    const request = scope(true); request.assertOwner();
    if (mutation.current) throw new Error("上一项操作仍在处理，请刷新核对");
    mutation.current = true; setBusy(true); setError("");
    try { await exceptionCommand(`${ROOT}${path}`, body, request); request.assertOwner(); await refresh(); }
    catch (failure) { if (owns()) setError(failure instanceof Error ? failure.message : "结果未知，请保留原请求号刷新核对"); throw failure; }
    finally { mutation.current = false; if (owns()) setBusy(false); }
  };
  const create = () => {
    try {
      assertOwner(true); const body = payload();
      if (!reference.trim() || reference.length > 100 || /[\u0000-\u001f\u007f]/.test(reference)) throw new Error("请填写不超过 100 字的业务参考号");
      const snapshot = { ...body, businessReference: reference.trim() };
      openActionConfirm({ action: "创建资金准备单", detail: `${kindLabel(kind)} · ${body.amountUsdt} USDT · 来源 ${body.sourceAddress} · 接收 ${kind === "COLLECTION" ? config!.platformAddress : config!.counterpartyAddress} · 业务参考 ${snapshot.businessReference}。仅保存准备记录，不发送资金。`,
        reasonMin: 10, reasonMax: 300, completionCopy: "准备单已保存，尚未转账", run: reason => command("/plans", { ...snapshot, reason }) });
    } catch (failure) { setError((failure as Error).message); }
  };
  const decide = (row: ExceptionRecord, decision: "REVIEW" | "CANCEL") => {
    assertOwner(true);
    openActionConfirm({ action: decision === "REVIEW" ? "复核准备单" : "取消准备单",
      detail: `${kindLabel(row.kind)} · ${row.amountUsdt} USDT · ${row.sourceAddress} → ${row.targetAddress} · ${row.businessReference}。复核只确认准备信息，不授权或执行转账。`,
      reasonMin: 10, reasonMax: 300, completionCopy: decision === "REVIEW" ? "准备信息已复核，尚未转账" : "准备单已取消",
      run: reason => command(`/plans/${row.planNo}/decision`, { expectedVersion: row.version, decision, reason }) });
  };
  const more = async () => {
    const request = scope(); request.assertOwner(); setBusy(true);
    try { const next = await exceptionList(`${ROOT}/plans`,page.nextBeforeId ?? undefined,request); request.assertOwner(); setPage({ ...next, records: [...page.records,...next.records] }); }
    catch (failure) { if (owns()) setError((failure as Error).message); }
    finally { if (owns()) setBusy(false); }
  };
  const balance = preflight?.balance && typeof preflight.balance === "object" ? preflight.balance as ExceptionRecord : null;

  return <section className="cregis-exceptions" aria-label="归集与甲方付款准备">
    <div className="cregis-section-title">USDT-BSC 归集与甲方付款准备 <button className="l-btn sm" disabled={busy || loading} onClick={() => void refresh()}>刷新准备记录</button></div>
    <p className="dtint warn">这里只保存准备单和复核意见，不会转出资金。真实转账须另行授权后在 Cregis 执行，审批不自动发送。</p>
    {error && <p role="alert" className="dtint bad">{error}</p>}
    {loading && <p>正在读取资金准备记录…</p>}
    {config && <>
      <dl><dt>归集接收 / 甲方付款来源</dt><dd style={{ overflowWrap: "anywhere" }}>{config.platformAddress}</dd><dt>甲方 USDT-BSC 接收地址</dt><dd style={{ overflowWrap: "anywhere" }}>{config.counterpartyAddress}</dd></dl>
      <ol><li>选择本项目充值子地址，核对金额后创建归集准备单。</li><li>由另一管理员复核，后续另行授权后在 Cregis 将资金归集到平台钱包。</li><li>平台钱包到账后，按业务金额创建并复核甲方付款准备单；后续在 Cregis 单独付款，保存原单号和交易哈希。</li></ol>
      {canWrite && <div style={{ display: "grid", gap: 8 }}>
        <label>操作类型 <select aria-label="资金准备操作类型" value={kind} disabled={busy} onChange={event => edit(() => setKind(event.target.value as PreparationKind))}><option value="COLLECTION">归集准备</option><option value="SUPPLIER_PAYMENT">甲方付款准备</option></select></label>
        {kind === "COLLECTION" && <label>来源子地址 <select aria-label="归集来源子地址" value={source} disabled={busy} onChange={event => edit(() => setSource(event.target.value))}><option value="">请选择</option>{config.sources.map(row => <option key={row.address} value={row.address}>{row.address} · 用户 {row.userId}</option>)}</select></label>}
        {kind === "COLLECTION" && config.sources.length === 0 && <p>当前没有已分配且可用于准备的充值子地址。</p>}
        <label>金额 USDT <input aria-label="准备金额 USDT" value={amount} inputMode="decimal" disabled={busy} onChange={event => edit(() => setAmount(event.target.value))} /></label>
        <label>业务参考号 <input aria-label="资金准备业务参考号" value={reference} maxLength={100} disabled={busy} onChange={event => edit(() => setReference(event.target.value))} /></label>
        <div><button className="l-btn" disabled={busy || loading} onClick={() => void check()}>只读检查余额与条件</button> <button className="l-btn primary" disabled={busy || loading} onClick={create}>创建准备单</button></div>
      </div>}
      {preflight && <div role="status"><p>检查时间：{String(preflight.checkedAt)} · 仅供准备核对，仍未授权转账。</p>
        <p>来源 USDT：{balance ? String(balance.usdt) : "待核实"} · 来源 BNB：{balance ? String(balance.bnb) : "待核实"}</p>
        <p>须在执行前重新核对项目钱包绑定及实际手续费；BNB 余额大于零不表示足以支付网络费。</p>
        {(preflight.blockers as string[]).map(item => <p className="dtint warn" key={item}>{PREPARATION_BLOCKER[item] ?? "仍有条件待核实，请联系管理员"}</p>)}
      </div>}
      <h4>准备记录 · 不代表已转账</h4>
      {page.records.length === 0 && !loading && <p>暂无准备单</p>}
      {page.records.map(row => <article key={String(row.planNo)} style={{ border: "1px solid var(--border)", padding: 12, overflowWrap: "anywhere" }}>
        <strong>{kindLabel(row.kind)} · {String(row.amountUsdt)} USDT · {PREPARATION_STATE[String(row.state)] ?? "状态待核实"}</strong>
        <p>准备单：{String(row.planNo)} · 业务参考：{String(row.businessReference)}</p><p>{String(row.sourceAddress)} → {String(row.targetAddress)}</p>
        <p>发起理由：{String(row.reason)}{row.decisionReason ? ` · 复核/取消理由：${String(row.decisionReason)}` : ""}</p>
        {canWrite && row.state === "DRAFT" && String(row.makerId) !== String(owner) && <button className="l-btn" disabled={busy || loading} onClick={() => decide(row,"REVIEW")}>复核准备</button>}
        {canWrite && ["DRAFT","REVIEWED"].includes(String(row.state)) && <button className="l-btn" disabled={busy || loading} onClick={() => decide(row,"CANCEL")}>取消准备单</button>}
      </article>)}
      {page.hasMore && <button className="l-btn" disabled={busy || loading} onClick={() => void more()}>加载更早准备单</button>}
    </>}
  </section>;
}
