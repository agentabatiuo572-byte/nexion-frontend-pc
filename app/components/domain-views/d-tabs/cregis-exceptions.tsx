"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { adminAuthLifecycleEpoch, adminAuthActivityAllowed } from "@/lib/admin/auth-lifecycle";
import { financeAdminRequest } from "@/lib/admin/d-client";
import { exceptionChallengeId, exceptionCommand, exceptionFee, exceptionId, exceptionList, exceptionObject, exceptionRead, exceptionVersion,
  type ExceptionPage, type ExceptionRecord, type ExceptionRequestScope } from "@/lib/admin/cregis-exceptions";
import type { DCtx } from "./types";

const EMPTY: ExceptionPage = { records: [], hasMore: false, nextBeforeId: null };
const MODE: Record<string, string> = { UNCONFIGURED: "待配置（禁止退款）", PLATFORM_PAYS: "全额退回，平台承担网络费", FIXED_USDT: "扣除固定 USDT 费用" };
const ACTION: Record<string, string> = { REVERSE: "核实重组并冲正", RESTORE: "原入金恢复后还原账务", RELEASE_HOLD: "解除本事件误报冻结", COLLECT_DEBT: "追偿本事件欠款", UNFREEZE: "检查并解除本事件账户冻结" };
const STATE: Record<string, string> = { MAKER_DONE: "等待另一管理员复核", PROPOSED: "等待另一管理员复核", APPROVED: "已批准，等待发送", SUBMITTING: "发送请求处理中", UNKNOWN: "结果未知，保留原单核查", SENT: "已取得供应商订单，等待链确认", COMPLETED: "处置完成", RESOLVED: "处置完成", REJECTED: "已拒绝", CANCELLED: "已取消", FAILED_NO_TRANSFER: "确认未转出，可重新提案", REVERSED: "已冲正", DEBT_OPEN: "尚有欠款", OPEN: "等待处置", RELEASED: "本事件已释放", RESTORED: "原入金已恢复" };
Object.assign(STATE, { CREDITED: "认领已入账", INVESTIGATING: "调查中", REVERSED_DEBT: "已冲正，尚有欠款", REPROPOSED: "已生成新的复核提案", CANCELLED_LATE_EVIDENCE: "原单证据变化，已撤销此提案" });
const label = (value: unknown) => value == null ? "—" : String(value);

function caseCanCheck(row: ExceptionRecord, adminId: unknown): boolean {
  return ["MAKER_DONE", "PROPOSED"].includes(String(row.state ?? row.status))
    && String(row.makerId) !== String(adminId);
}

function CaseSummary({ row }: { row: ExceptionRecord }) {
  const facts = [
    ["用户", row.userId ?? row.targetUserId ?? row.claimantUserId],
    ["毛额（USDT）", row.grossAmount], ["费用（USDT）", row.feeAmount], ["净额（USDT）", row.netAmount],
    ["原转出地址", row.returnAddress], ["Cregis 订单编号", row.providerCid],
    ["待追偿（USDT）", row.outstandingDebt], ["证据摘要", row.evidenceHash], ["理由", row.reason], ["待核查原因", row.lastError],
  ];
  return <dl className="ui-facts-grid">{facts.filter(([, value], index) => index < 4 || value != null && value !== "").map(([title, value]) => <div key={String(title)}><dt>{String(title)}</dt><dd>{label(value)}</dd></div>)}</dl>;
}

type OperationsProps = {
  canManage: boolean; openActionConfirm: DCtx["openActionConfirm"]; sources: { sourceType: string; sourceId: string; title: string }[];
};
export function CregisExceptionOperations(props: OperationsProps) {
  const session = useAdminAuth(state => state.session), epoch = useAdminAuth(state => state.authEpoch);
  if (!session?.authorities.includes("finance_d1_read")) return null;
  return <OwnedExceptionOperations key={`${session.adminId}:${epoch}:${adminAuthLifecycleEpoch()}:${props.canManage}:${session.authorities.join("|")}`}
    {...props} owner={session.adminId} ownerEpoch={epoch} />;
}
function OwnedExceptionOperations({ canManage, openActionConfirm, sources, owner, ownerEpoch }: OperationsProps & { owner: number; ownerEpoch: number }) {
  const session = useAdminAuth(state => state.session);
  const canRefund = canManage && (session?.authorities ?? []).includes("finance_d2_withdrawal_approve");
  const lifecycleEpoch = useRef(adminAuthLifecycleEpoch()).current;
  const live = useRef(true);
  const assertOwner = useCallback((write = false, refund = false) => {
    const current = useAdminAuth.getState();
    const rights = current.session?.authorities ?? [];
    if (!live.current || !current.isAuthenticated || current.session?.adminId !== owner || current.authEpoch !== ownerEpoch
        || adminAuthLifecycleEpoch() !== lifecycleEpoch || !adminAuthActivityAllowed()
        || !rights.includes("finance_d1_read") || write && (!canManage || !rights.includes("finance_d1_channel_manage"))
        || refund && !rights.includes("finance_d2_withdrawal_approve"))
      throw new Error("登录身份或权限已变化，请重新打开异常处置后核对");
  }, [owner, ownerEpoch, lifecycleEpoch, canManage]);
  const owns = useCallback(() => { try { assertOwner(); return true; } catch { return false; } }, [assertOwner]);
  const scopeFor = useCallback((write = false, refund = false): ExceptionRequestScope => ({
    authEpoch: lifecycleEpoch, assertOwner: () => assertOwner(write, refund),
  }), [assertOwner, lifecycleEpoch]);
  const [policy, setPolicy] = useState<ExceptionRecord | null>(null);
  const [policyCases, setPolicyCases] = useState<ExceptionRecord[]>([]);
  const [refunds, setRefunds] = useState(EMPTY);
  const [claims, setClaims] = useState(EMPTY);
  const [incidents, setIncidents] = useState(EMPTY);
  const [reorgCases, setReorgCases] = useState(EMPTY);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sourceKey, setSourceKey] = useState("");
  const [intent, setIntent] = useState("CLAIM_CREDIT");
  const [userId, setUserId] = useState("");
  const [signature, setSignature] = useState("");
  const [challenge, setChallenge] = useState<ExceptionRecord | null>(null);
  const [evidence, setEvidence] = useState<ExceptionRecord | null>(null);
  const selectedSource = sources.find(row => `${row.sourceType}:${row.sourceId}` === sourceKey);
  const claimUnavailable = selectedSource?.sourceType === "EVENT";
  const selectionEpoch = useRef(0);
  const refreshEpoch = useRef(0);
  const mutationLock = useRef(false);
  const clearProof = () => { selectionEpoch.current++; setChallenge(null); setEvidence(null); setSignature(""); };

  const refresh = useCallback(async () => {
    const scope = scopeFor(); scope.assertOwner();
    const epoch = ++refreshEpoch.current;
    setLoading(true); setError("");
    try {
      const [p, pc, rf, cl, ri, rc] = await Promise.all([
        exceptionRead("/refunds/fee-policy", scope), financeAdminRequest<unknown>("/cregis/refunds/fee-policy/cases", { bankManualAuthEpoch: scope.authEpoch }),
        exceptionList("/refunds/cases", undefined, scope), exceptionList("/exception-claims", undefined, scope),
        exceptionList("/reorg/incidents", undefined, scope), exceptionList("/reorg/proposals", undefined, scope),
      ]);
      scope.assertOwner();
      if (epoch !== refreshEpoch.current || !live.current || adminAuthLifecycleEpoch() !== lifecycleEpoch) return;
      if (!(String(p.mode) in MODE) || !Array.isArray(pc)) throw new Error("退款配置响应无效");
      exceptionVersion(p.version);
      setPolicy(p); setPolicyCases(pc.map(exceptionObject)); setRefunds(rf); setClaims(cl); setIncidents(ri); setReorgCases(rc);
    } catch (failure) {
      if (epoch !== refreshEpoch.current || !owns()) return;
      setPolicy(null); setError(failure instanceof Error ? failure.message : "异常资金状态读取失败");
    } finally { if (epoch === refreshEpoch.current && owns()) setLoading(false); }
  }, [scopeFor, lifecycleEpoch, owns]);
  useEffect(() => { live.current = true; void refresh(); return () => { live.current = false; refreshEpoch.current++; selectionEpoch.current++; }; }, [refresh]);

  const mutate = async (path: string, body: ExceptionRecord) => {
    const scope = scopeFor(true, path.startsWith("/refunds")); scope.assertOwner();
    if (mutationLock.current) throw new Error("上一项操作仍在处理，请先核对结果");
    mutationLock.current = true; setBusy(true); setError("");
    try {
      await exceptionCommand(path, body, scope); scope.assertOwner();
      clearProof(); await refresh();
    } catch (failure) {
      if (owns()) setError(failure instanceof Error ? failure.message : "结果未确认，请刷新查看"); throw failure;
    } finally { mutationLock.current = false; if (owns()) setBusy(false); }
  };
  const confirm = (action: string, path: string, body: ExceptionRecord, detail: string) => openActionConfirm({
    action, detail, reasonMin: 10, reasonMax: 200, completionCopy: "需另一位管理员复核的操作，复核后才执行。",
    run: reason => mutate(path, { ...body, reason }),
  });
  const pageMore = async (path: string, page: ExceptionPage, setter: (page: ExceptionPage) => void) => {
    const scope = scopeFor(); scope.assertOwner();
    setBusy(true); setError("");
    try { const next = await exceptionList(path, page.nextBeforeId ?? undefined, scope); scope.assertOwner(); setter({ ...next, records: [...page.records, ...next.records] }); }
    catch (failure) { if (owns()) setError(failure instanceof Error ? failure.message : "读取失败"); }
    finally { if (owns()) setBusy(false); }
  };
  const prepare = async () => {
    const scope = scopeFor(true, intent === "REFUND_ORIGIN"); scope.assertOwner();
    setBusy(true); setError(""); const epoch = ++selectionEpoch.current;
    setChallenge(null); setEvidence(null); setSignature("");
    try {
      const source = sources.find(row => `${row.sourceType}:${row.sourceId}` === sourceKey);
      if (!source) throw new Error("请选择当前待处理的资金记录");
      const result = await exceptionCommand("/exception-ownership/challenges", { sourceType: source.sourceType,
        sourceId: exceptionId(source.sourceId), action: intent, targetUserId: intent === "CLAIM_CREDIT" ? exceptionId(userId) : null }, scope);
      scope.assertOwner();
      if (epoch === selectionEpoch.current) setChallenge(result);
    } catch (failure) { if (epoch === selectionEpoch.current && owns()) setError(failure instanceof Error ? failure.message : "生成证明失败"); }
    finally { if (owns()) setBusy(false); }
  };
  const preview = async () => {
    const scope = scopeFor(true, intent === "REFUND_ORIGIN"); scope.assertOwner();
    if (!challenge) return;
    setBusy(true); setError(""); const epoch = selectionEpoch.current;
    try {
      const result = await exceptionCommand(intent === "CLAIM_CREDIT" ? "/exception-claims/preview" : "/refunds/preview", {
        challengeId: exceptionChallengeId(challenge.challengeId), signature, ...(intent === "CLAIM_CREDIT" ? { targetUserId: exceptionId(userId) } : {}),
      }, scope);
      scope.assertOwner();
      if (epoch === selectionEpoch.current) setEvidence(result);
    } catch (failure) { if (epoch === selectionEpoch.current && owns()) { setEvidence(null); setError(failure instanceof Error ? failure.message : "证明核验失败"); } }
    finally { if (owns()) setBusy(false); }
  };
  const configureFee = () => openActionConfirm({ action: "提议异常退款费用规则", completionCopy: "提案提交后，须由另一管理员复核才生效", detail: "另一管理员复核后仅对新工单生效，已有工单保留原毛额、费用与净额快照。",
    reasonMin: 10, reasonMax: 200, businessForm: { kind: "multi-field", fields: [
      { key: "mode", label: "退款费用方式", inputKind: "select", current: String(policy?.mode ?? "UNCONFIGURED"), options: Object.keys(MODE), optionLabels: MODE, required: true },
      { key: "fee", label: "固定扣费（USDT）", current: "0", inputKind: "text", visibleWhen: { key: "mode", equals: "FIXED_USDT" }, pattern: "^(0|[1-9][0-9]{0,11})(\\.[0-9]{1,6})?$", required: true },
    ] }, run: (reason, _value, form) => mutate("/refunds/fee-policy/cases", { expectedVersion: exceptionVersion(policy?.version),
      mode: form?.mode, feeUsdt: exceptionFee(form?.mode ?? "", form?.fee ?? ""), reason }),
  });
  const recover = (row: ExceptionRecord) => openActionConfirm({ action: "核对并恢复原退款单 CID", completionCopy: "只核对原退款单，不重新发送退款", detail: "只核对原业务号、返款地址及净额，不重新发送退款。",
    reasonMin: 10, reasonMax: 200, businessForm: { kind: "multi-field", fields: [{ key: "cid", label: "供应商原单 CID", inputKind: "text", required: true, pattern: "^[1-9][0-9]{0,18}$", maxLength: 19 }] },
    run: (reason, _v, form) => mutate(`/refunds/cases/${exceptionId(row.id)}/recover`, { expectedVersion: exceptionVersion(row.version), providerCid: exceptionId(form?.cid), reason }),
  });
  const proposeReorg = async (row: ExceptionRecord, action: string) => {
    const scope = scopeFor(true); scope.assertOwner();
    setBusy(true); setError("");
    try {
      const proof = await exceptionRead(`/reorg/incidents/${exceptionId(row.id)}/evidence?action=${action}`, scope); scope.assertOwner();
      confirm(ACTION[action], `/reorg/incidents/${exceptionId(row.id)}/proposals`, { action, expectedVersion: exceptionVersion(row.version), evidenceHash: proof.evidenceHash },
        `用户 ${label(row.userId)}，原净入账 ${label(row.netAmount)} USDT，待追偿 ${label(row.outstandingDebt)} USDT。证据 ${label(proof.evidenceHash)}。只处置本事件，不自动重开资金开关。`);
    } catch (failure) { if (owns()) setError(failure instanceof Error ? failure.message : "读取事件证明失败"); }
    finally { if (owns()) setBusy(false); }
  };
  const list = (title: string, path: string, page: ExceptionPage, setter: (page: ExceptionPage) => void, actions: (row: ExceptionRecord) => React.ReactNode) => <section className="cregis-panel">
    <h4>{title}</h4>{page.records.length === 0 ? <p>暂无记录</p> : page.records.map(row => <div className="cregis-case" key={String(row.id)}>
      <strong>#{label(row.id)} · {STATE[String(row.state ?? row.status)] ?? "状态未知"}</strong><CaseSummary row={row} />{actions(row)}
    </div>)}{page.hasMore && <button className="l-btn sm" disabled={busy || loading} onClick={() => void pageMore(path, page, setter)}>加载更早{title}</button>}
  </section>;

  return <section className="cregis-panel ui-exception-panel" aria-label="异常入金处置">
    <h3>异常入金处置</h3><button className="l-btn sm" disabled={busy || loading} onClick={() => void refresh()}>刷新异常处置</button>
    {error && <div role="alert" className="dtint warn">{error}</div>}
    {loading && <p>正在核对费用规则与处置工单…</p>}
    {policy && <>
      <div className="dtint">异常退款手续费：{MODE[String(policy.mode)]} {policy.mode === "FIXED_USDT" ? `${label(policy.feeUsdt)} USDT` : ""} · 版本 {label(policy.version)}
        {canRefund && <button className="l-btn sm" disabled={busy || loading} onClick={configureFee}>配置退款手续费</button>}</div>
      {policyCases.map(row => <div className="cregis-case" key={label(row.id)}>费用提案 #{label(row.id)} · {MODE[String(row.mode)]} · 固定费 {label(row.feeUsdt)} USDT · {STATE[String(row.state ?? row.status)] ?? "状态未知"} · 发起人 {label(row.makerId)}
        {canRefund && caseCanCheck(row, session?.adminId) && ["APPROVE", "REJECT"].map(decision => <button key={decision} className="l-btn sm" disabled={busy || loading} onClick={() => confirm(decision === "APPROVE" ? "复核费用规则" : "拒绝费用规则", `/refunds/fee-policy/cases/${exceptionId(row.id)}/decision`, { expectedVersion: exceptionVersion(row.version), decision }, `请独立核对费用规则 ${MODE[String(row.mode)]}、固定费用 ${label(row.feeUsdt)} USDT。`)}>{decision === "APPROVE" ? "复核费用规则" : "拒绝"}</button>)}
      </div>)}
      {canManage && <div className="cregis-case ui-exception-form">
        <h4>认领或原路退款申请</h4><p>由原转出钱包签名证明归属。交易所或合约不能提供该证明时，保留待核查并联系原平台补证；公开交易哈希不能代替签名。</p>
        <label>待处理入金 <select className="ui-control" aria-label="待处理入金" value={sourceKey} disabled={busy} onChange={e => { setSourceKey(e.target.value); clearProof(); }}><option value="">请选择</option>{sources.map(row => <option key={`${row.sourceType}:${row.sourceId}`} value={`${row.sourceType}:${row.sourceId}`}>{row.title}</option>)}</select></label>
        <label>处置方式 <select className="ui-control" aria-label="异常处置方式" value={intent} disabled={busy} onChange={e => { setIntent(e.target.value); clearProof(); }}><option value="CLAIM_CREDIT" disabled={claimUnavailable}>认领并入账</option>{canRefund && <option value="REFUND_ORIGIN" disabled={policy.mode === "UNCONFIGURED"}>原路退款{policy.mode === "UNCONFIGURED" ? "（费用待配置）" : ""}</option>}</select></label>
        {intent === "CLAIM_CREDIT" && <label>认领用户编号 <input className="ui-control" aria-label="认领用户编号" value={userId} disabled={busy} inputMode="numeric" onChange={e => { setUserId(e.target.value); clearProof(); }} /></label>}
        <button className="l-btn sm" disabled={busy || loading || !sourceKey || (intent === "REFUND_ORIGIN" && (!canRefund || policy.mode === "UNCONFIGURED")) || (intent === "CLAIM_CREDIT" && (claimUnavailable || !/^[1-9][0-9]{0,18}$/.test(userId)))} onClick={() => void prepare()}>生成钱包签名原文</button>
        {claimUnavailable && <p>这笔低额入金已有归属，仅支持原路退款；费用待配置时请先配置规则。</p>}
        {sources.length === 0 && <p>当前没有可提交的低额或未归属入金。</p>}
        {challenge && <><label>钱包签名原文 <textarea className="ui-control" aria-label="钱包签名原文" readOnly rows={8} value={label(challenge.message)} /></label><p>有效期至 {label(challenge.expiresAt)}。请将以上原文交给原转出钱包签名，无须转账或提供私钥。</p>
          <label>签名结果 <textarea className="ui-control" aria-label="钱包签名结果" rows={3} value={signature} disabled={busy} onChange={e => { setSignature(e.target.value); setEvidence(null); }} /></label>
          <button className="l-btn sm" disabled={busy || !/^0x[0-9a-fA-F]{130}$/.test(signature)} onClick={() => void preview()}>核对归属与资金证据</button></>}
        {evidence && challenge && <div className="cregis-case"><CaseSummary row={evidence} />{intent === "REFUND_ORIGIN" && evidence.canPropose === false && <p>当前费用规则下不能提交退款，请核对净额及费用配置。</p>}<button className="l-btn sm" disabled={busy || loading || (intent === "REFUND_ORIGIN" && evidence.canPropose !== true)} onClick={() => confirm(intent === "CLAIM_CREDIT" ? "提交认领入账提案" : "提交原路退款提案", intent === "CLAIM_CREDIT" ? "/exception-claims" : "/refunds/cases", { challengeId: exceptionChallengeId(challenge.challengeId), signature, ...(intent === "CLAIM_CREDIT" ? { targetUserId: exceptionId(userId) } : {}), evidenceHash: evidence.evidenceHash }, `证据 ${label(evidence.evidenceHash)}。另一管理员须独立复核后才会执行。`)}>提交处置提案</button></div>}
      </div>}
      {list("认领工单", "/exception-claims", claims, setClaims, row => canManage && caseCanCheck(row, session?.adminId) && ["APPROVE", "REJECT"].map(decision => <button className="l-btn sm" key={decision} disabled={busy || loading} onClick={() => confirm(decision === "APPROVE" ? "复核认领入账" : "拒绝认领", `/exception-claims/${exceptionId(row.id)}/decision`, { expectedVersion: exceptionVersion(row.version), decision }, `目标用户 ${label(row.userId ?? row.targetUserId ?? row.claimantUserId)}，净额 ${label(row.netAmount)} USDT，证据 ${label(row.evidenceHash)}。系统将再次独立核验原资金及钱包归属。`)}>{decision === "APPROVE" ? "复核认领" : "拒绝"}</button>))}
      {list("退款工单", "/refunds/cases", refunds, setRefunds, row => canRefund && <>
        {caseCanCheck(row, session?.adminId) && ["APPROVE", "REJECT"].map(decision => <button className="l-btn sm" key={decision} disabled={busy || loading} onClick={() => confirm(decision === "APPROVE" ? "复核链上原路退款" : "拒绝退款", `/refunds/cases/${exceptionId(row.id)}/decision`, { expectedVersion: exceptionVersion(row.version), decision }, `原地址 ${label(row.returnAddress)}，毛额 ${label(row.grossAmount)}，费用 ${label(row.feeAmount)}，实退 ${label(row.netAmount)} USDT。证据 ${label(row.evidenceHash)}。`)}>{decision === "APPROVE" ? "复核退款" : "拒绝"}</button>)}
        {String(row.state) === "MAKER_DONE" && String(row.makerId) === String(session?.adminId) && <button className="l-btn sm" disabled={busy || loading} onClick={() => confirm("取消退款提案", `/refunds/cases/${exceptionId(row.id)}/decision`, { expectedVersion: exceptionVersion(row.version), decision: "CANCEL" }, "取消尚未批准的原退款提案并释放其资金占用。")}>取消提案</button>}
        {String(row.state) === "UNKNOWN" && !row.providerCid && <button className="l-btn sm" disabled={busy || loading} onClick={() => recover(row)}>核对原单 CID</button>}
        {String(row.state) === "FAILED_NO_TRANSFER" && <button className="l-btn sm" disabled={busy || loading} onClick={() => confirm("重新提交退款审核", `/refunds/cases/${exceptionId(row.id)}/retry`, { expectedVersion: exceptionVersion(row.version) }, "仅在原单已确认未转出后申请新工单，仍须另一管理员重新复核。")}>重新提案</button>}
      </>)}
      {list("重组事件", "/reorg/incidents", incidents, setIncidents, row => canManage && Array.isArray(row.allowedActions) && row.allowedActions.filter(action => typeof action === "string" && action in ACTION).map(action => <button className="l-btn sm" key={String(action)} disabled={busy || loading} onClick={() => void proposeReorg(row, String(action))}>{ACTION[String(action)]}</button>))}
      {list("重组处置提案", "/reorg/proposals", reorgCases, setReorgCases, row => canManage && caseCanCheck(row, session?.adminId) && ["APPROVE", "REJECT"].map(decision => <button className="l-btn sm" key={decision} disabled={busy || loading} onClick={() => confirm(decision === "APPROVE" ? `复核：${ACTION[String(row.action)] ?? "重组处置"}` : "拒绝重组处置", `/reorg/proposals/${exceptionId(row.id)}/decision`, { expectedVersion: exceptionVersion(row.version), decision }, `事件 ${label(row.incidentId)}，${ACTION[String(row.action)] ?? label(row.action)}，证据 ${label(row.evidenceHash)}。只处置本事件，其他冻结和资金开关保持原规则。`)}>{decision === "APPROVE" ? "复核处置" : "拒绝"}</button>))}
    </>}
  </section>;
}
