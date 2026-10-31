"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { financeAdminRequest } from "@/lib/admin/d-client";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { depositPolicyUnits as units, validDepositPolicy as valid, parseDepositPolicy as parsePolicy, type DepositPolicy as Policy } from "@/lib/admin/cregis-deposit-policy";
import type { DCtx } from "./types";

type ProposalInput = Parameters<typeof createA2OperationProposal>[0];
type Pending = PendingMutationRecord & { owner: number; input: ProposalInput; ticketId?: string; terminal?: string };
const RETRY_WINDOW_MS = 10 * 60 * 1000;
const proposals = createPendingMutationStore<Pending>({ storageKey: "nexion-admin-cregis-deposit-policy-proposals-v1", retainExpiredRecords: true,
  isValidRecord: row => Number.isSafeInteger(row.owner) && !!row.input && !!row.input.command });

export type DepositProposalActivity = { unknown: number; awaitingApproval: number };

export function CregisDepositPolicy({ canManage, openActionConfirm, onActivityChange }: { canManage: boolean; openActionConfirm: DCtx["openActionConfirm"]; onActivityChange?: (activity: DepositProposalActivity) => void }) {
  const session = useAdminAuth(s => s.session), epoch = useAdminAuth(s => s.authEpoch);
  if (!session) return null;
  return <Editor key={`${session.adminId}:${epoch}`} owner={session.adminId} epoch={epoch} operator={session.operator || session.username}
    canManage={canManage} openActionConfirm={openActionConfirm} onActivityChange={onActivityChange} />;
}

function Editor({ owner, epoch, operator, canManage, openActionConfirm, onActivityChange }: { owner: number; epoch: number; operator: string; canManage: boolean; openActionConfirm: DCtx["openActionConfirm"]; onActivityChange?: (activity: DepositProposalActivity) => void }) {
  const [policy, setPolicy] = useState<Policy | null>(null), [min, setMin] = useState(""), [fee, setFee] = useState(""), [confirmations, setConfirmations] = useState("");
  const [pending, setPending] = useState<Pending | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const live = useRef(true), sequence = useRef(0), mutation = useRef(false);
  const owns = useCallback(() => live.current && useAdminAuth.getState().isAuthenticated && useAdminAuth.getState().session?.adminId === owner && useAdminAuth.getState().authEpoch === epoch, [owner, epoch]);
  const syncPending = useCallback(() => setPending(proposals.list().find(row => row.owner === owner) ?? null), [owner]);
  const refresh = useCallback(async () => {
    const current = ++sequence.current; setBusy(true); setError(""); setPolicy(null);
    try {
      const next = parsePolicy(await financeAdminRequest<unknown>("/cregis/deposit-policy"));
      if (owns() && current === sequence.current) { setPolicy(next); setMin(String(Number(next.minDepositUsdt))); setFee(next.feeUsdt); setConfirmations(String(next.confirmations)); }
    } catch (failure) { if (owns() && current === sequence.current) setError(failure instanceof Error ? failure.message : "读取充值规则失败。"); }
    finally { if (owns() && current === sequence.current) setBusy(false); }
  }, [owns]);
  useEffect(() => { live.current = true; syncPending(); void refresh(); return () => { live.current = false; sequence.current++; }; }, [refresh, syncPending]);
  const unknown = pending && !pending.terminal && !pending.ticketId ? 1 : 0;
  const awaitingApproval = pending && !pending.terminal && pending.ticketId ? 1 : 0;
  useEffect(() => { onActivityChange?.({ unknown, awaitingApproval }); }, [onActivityChange, unknown, awaitingApproval]);

  function submit() {
    if (!policy || pending || busy || !canManage || !owns() || !/^[1-9]\d*$/.test(min) || !valid(min, fee, Number(confirmations)) || !/^\d+$/.test(confirmations)) return;
    const before = `最低 ${policy.minDepositUsdt} USDT；手续费 ${policy.feeUsdt} USDT；确认数 ${policy.confirmations}；版本 ${policy.version}`;
    const after = `最低 ${min} USDT；手续费 ${fee} USDT；确认数 ${confirmations}`;
    openActionConfirm({ action: "提交 USDT BEP20 / ERC20 共同充值规则", detail: `当前：${before}。目标：${after}。提交后需另一位管理员审批，批准前不生效。`,
      reasonMin: 10, reasonMax: 200, completionCopy: "提交审批后，请在操作记录与审批中查看处理结果。",
      run: async reason => {
        const auth = useAdminAuth.getState().session;
        if (!owns() || !auth || !(auth.role === "superadmin" || auth.role === "super" || auth.authorities.includes("finance_d1_channel_manage"))) throw new Error("登录身份或权限已变化，请重新打开页面。");
        if (mutation.current || proposals.list().some(row => row.owner === owner)) throw new Error("已有提案待核实，请先查询原提案。");
        mutation.current = true; setBusy(true); setError(""); setMessage("");
        const input: ProposalInput = { action: "调整 USDT BEP20 / ERC20 共同充值规则", obj: "current", beforeValue: before, afterValue: after,
          operator, operatorRole: "运营人员", type: "param", amplifies: true, sos: false, roleGate: "另一位有审批权的管理员", reason, sourceDomain: "D1",
          command: { domain: "D", op: "d_cregis_deposit_policy", params: { minDepositUsdt: min, feeUsdt: fee, confirmations: Number(confirmations), expectedVersion: policy.version, reason } },
          target: { domain: "D", type: "cregis_deposit_policy", id: "current" } };
        const key = createA2CommandKey("cregis-deposit-policy"), fingerprint = `${owner}|${key}`;
        proposals.remember(fingerprint, key, { owner, input });
        if (!proposals.isDurablyStored(fingerprint, key)) { proposals.forget(fingerprint, key); mutation.current = false; setBusy(false); throw new Error("浏览器无法保存恢复记录，请允许会话存储后重试。"); }
        syncPending();
        try {
          const ticket = await createA2OperationProposal(input, key, true);
          proposals.remember(fingerprint, key, { owner, input, ticketId: ticket.id });
          if (owns()) { syncPending(); setMessage("提案已提交，尚未生效。请另一位管理员审批。"); }
        } catch (failure) {
          if (!isA2OutcomeUncertainError(failure)) proposals.forget(fingerprint, key);
          if (owns()) { syncPending(); setError(isA2OutcomeUncertainError(failure) ? "提交结果待核实，请查询原提案，或使用原请求重试。" : failure instanceof Error ? failure.message : "提案未提交，请核对后重试。"); }
          throw failure;
        } finally { mutation.current = false; if (owns()) setBusy(false); }
      } });
  }
  async function check() {
    if (!pending || mutation.current || !owns()) return;
    mutation.current = true; setBusy(true); setError("");
    try {
      const result = await fetchA2ProposalByKey(pending.commandKey);
      if (!owns()) return;
      if (!result) { setMessage("暂未查到原提案。可在首次提交后 10 分钟内使用原请求重试，或继续核实。"); return; }
      const status = result.status.toLowerCase();
      const terminal = ["approved", "rejected", "withdrawn", "expired"].includes(status) ? status : undefined;
      proposals.remember(pending.fingerprint, pending.commandKey, { owner, input: pending.input, ticketId: result.id, terminal });
      syncPending(); setMessage(terminal === "approved" ? "提案已批准，请重新读取生效规则并核对。" : terminal ? "提案已结束，请核对审批记录。" : "提案仍待处理，尚未确认生效。");
    } catch { if (owns()) setError("查询提案失败，请稍后重试或前往操作记录与审批。"); }
    finally { mutation.current = false; if (owns()) setBusy(false); }
  }
  async function retry() {
    const auth = useAdminAuth.getState().session;
    if (!pending || pending.ticketId || pending.terminal || mutation.current || !owns() || !canManage
      || !auth || !(auth.role === "superadmin" || auth.role === "super" || auth.authorities.includes("finance_d1_channel_manage"))) return;
    if (Date.now() < pending.createdAt || Date.now() >= Math.min(pending.expiresAt, pending.createdAt + RETRY_WINDOW_MS)) {
      setError("原请求已超过重试时间或本机时间异常，请通过操作记录继续核实。"); return;
    }
    mutation.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const ticket = await createA2OperationProposal(pending.input, pending.commandKey, true);
      if (owns()) {
        proposals.remember(pending.fingerprint, pending.commandKey, { owner, input: pending.input, ticketId: ticket.id });
        syncPending(); setMessage("原提案已提交，尚未生效。请另一位管理员审批。");
      }
    } catch (failure) {
      if (owns()) {
        const rejection = failure as { status?: number; backendMessage?: string } | null;
        if ((rejection?.status === 409 && rejection.backendMessage === "CREGIS_DEPOSIT_POLICY_VERSION_CONFLICT")
          || (rejection?.status === 422 && rejection.backendMessage === "CREGIS_DEPOSIT_POLICY_INVALID")) {
          proposals.forget(pending.fingerprint, pending.commandKey);
          syncPending();
          await refresh();
          if (owns()) setMessage("原提案未创建，请核对最新规则后重新提交。");
        } else setError("原提案结果仍待核实，请查询原提案；恢复记录已保留。");
      }
    } finally { mutation.current = false; if (owns()) setBusy(false); }
  }
  const isValid = /^[1-9]\d*$/.test(min) && valid(min, fee, Number(confirmations)) && /^\d+$/.test(confirmations);
  return <div className="cregis-history cregis-settings-card">
    <div className="cregis-section-title">USDT BEP20 / ERC20 共同充值规则 <button className="l-btn sm" disabled={busy} onClick={() => void refresh()}>刷新规则</button></div>
    <p className="sub">调整三项规则后一起提交审批，另一管理员批准后生效。已发现交易保留原规则；未入账交易仍须满足环境安全确认数下限。</p>
    {error && <div className="dtint warn" role="alert">{error}</div>}{message && <div className="dtint" role="status">{message}</div>}
    {!policy && !error && <p>正在读取充值规则…</p>}
    {policy && <><div className="cregis-policy-current" aria-label="当前生效规则">
      {[["最低充值额", Number(policy.minDepositUsdt).toFixed(2), "USDT"], ["固定手续费", policy.feeUsdt, "USDT"], ["链上确认数", policy.confirmations, "次"]].map(([title, value, unit]) => <div key={title}><span>{title}</span><strong>{value} <small>{unit}</small></strong></div>)}
      <span className="cregis-version">生效版本 v{policy.version}</span></div>
      <fieldset className="cregis-form-grid" disabled={!canManage || busy || !!pending}><legend>拟调整为 · 审批后生效</legend>
        <label>最低充值额（USDT，正整数）<input aria-label="最低充值额（USDT）" type="number" inputMode="numeric" min={1} step={1} value={min} onChange={e => setMin(e.target.value)} /></label>{" "}
        <label>固定手续费（USDT）<input aria-label="固定手续费（USDT）" inputMode="decimal" value={fee} onChange={e => setFee(e.target.value)} /></label>{" "}
        <label>链上确认数<input aria-label="链上确认数" type="number" min={15} max={10000} step={1} value={confirmations} onChange={e => setConfirmations(e.target.value)} /></label>
      </fieldset>
      <p className="sub">最低充值本金须为正整数，统一显示两位小数；手续费最多六位小数，不得小于零且须低于最低额；确认数为 15–10000 的整数，并须满足服务端可能更高的安全下限。订单直付及其手续费仍可有小数，不受充值最低额限制。</p>
      {canManage && <button className="l-btn sm mc" disabled={busy || !!pending || !isValid || (units(min) === units(policy.minDepositUsdt) && units(fee) === units(policy.feeUsdt) && Number(confirmations) === policy.confirmations)} onClick={submit}>提交审批</button>}
    </>}
    {pending && <div className="cregis-case"><p>原提案：{pending.ticketId ?? "结果待核实"} · 操作标识 {pending.commandKey}</p>
      <button className="l-btn sm" disabled={busy} onClick={() => void check()}>查询原提案</button>{" "}
      {!pending.ticketId && !pending.terminal && canManage && (Date.now() >= pending.createdAt && Date.now() < Math.min(pending.expiresAt, pending.createdAt + RETRY_WINDOW_MS)
        ? <button className="l-btn sm" disabled={busy} onClick={() => void retry()}>使用原请求重试</button>
        : <p>原请求已超过重试时间或本机时间异常，请通过操作记录继续核实。</p>)}{" "}
      {pending.terminal && <button className="l-btn sm" disabled={busy} onClick={() => { proposals.forget(pending.fingerprint, pending.commandKey); syncPending(); void refresh(); }}>核对完成，准备新变更</button>}{" "}
      <Link href="/platform/audit?domain=D">查看操作记录与审批</Link></div>}
  </div>;
}
