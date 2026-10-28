"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatBusinessTime } from "@/lib/admin/business-time";
import { displayAdminError } from "@/lib/admin/error-messages";
import type { FViewCtx } from "./types";

export function F2SevenLayerActivation({ ctx }: { ctx: FViewCtx }) {
  const policy = ctx.f2DirectPolicy;
  const [submitted, setSubmitted] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryError, setRecoveryError] = useState<string | null>(null);
  useEffect(() => { setSubmitted(false); }, [policy?.sevenLayerRevision, ctx.f2ActivationPending?.id]);
  const busy = ctx.f2DirectPolicyLoading || ctx.f2ActivationPendingLoading;
  const allowed = ctx.can("network_f2_policy_amplify") && ctx.can("platform_a2_proposal_create");
  const supported = policy?.sevenLayerActivationContractVersion === 1;
  const action = !policy?.sevenLayerEnabled ? "ACTIVATE" : policy.sevenLayerPaused ? "RESUME" : "PAUSE";
  const label = { ACTIVATE: "启用七层结算", PAUSE: "暂停七层结算", RESUME: "恢复七层结算" }[action];
  const state = !policy ? "状态暂不可用" : !policy.sevenLayerEnabled ? "未启用" : policy.sevenLayerPaused ? "已启用 · 已暂停" : "已启用 · 正常运行";
  const blocked = busy || !policy || !!ctx.f2DirectPolicyError || !!ctx.f2ActivationPendingError || !supported || !!ctx.f2ActivationPending || !!ctx.f2ActivationAttempt || submitted || recovering;
  async function recover() {
    if (!allowed || recovering) return;
    setRecovering(true); setRecoveryError(null);
    try { await ctx.recoverF2SevenLayerActivation(); setSubmitted(true); }
    catch (error) { setRecoveryError(displayAdminError(error)); }
    finally { setRecovering(false); }
  }
  function submit() {
    if (!allowed || blocked || !policy) return;
    const revision = policy.sevenLayerRevision, policyVersion = policy.policyVersion;
    ctx.openActionConfirm({
      name: label, amplify: action !== "PAUSE",
      detail: action === "ACTIVATE"
        ? "按现在设置好的七层比例启用新版结算，另一位管理员批准时生效。之前的订单仍按旧规则，不补发；直属拆分需要另外开启。比例和冷却设置不变。"
        : action === "PAUSE"
          ? "暂停后，新订单的奖励先不计算；已在冷却中的奖励、退款和解锁照常处理。恢复后会补算暂停期间积压的订单。"
          : "恢复后补算暂停期间积压的订单，新订单也照常计算。比例和冷却设置不变。",
      completionCopy: "提交后需另一位管理员在「操作记录与审批」批准才生效。如果提示结果未知，请先查看原申请，不要重复提交。",
      run: async reason => { await ctx.changeF2SevenLayerActivation(action, revision, policyVersion, reason); setSubmitted(true); },
    });
  }
  return <section className="pane f2-direct-policy" aria-label="七层结算启用状态">
    <div className="pane-h"><div><span className="ph-ttl">七层结算</span><span className="ph-sub">启用、暂停、恢复都需要另一位管理员批准，不改比例设置</span></div></div>
    <div className="f2-policy-body">
      <p role="status" className="f2-policy-status">{busy ? "正在加载…" : state}</p>
      {policy?.cutoverAt && <p className="f2-help">启用时间：<time dateTime={policy.cutoverAt}>{formatBusinessTime(policy.cutoverAt, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></p>}
      <p className="f2-help">启用前的订单仍按旧规则；暂停、恢复不会改变启用时间，也不补发以前的奖励。直属拆分需要在下方另外设置。</p>
      {ctx.f2DirectPolicyError && <p role="alert" className="f2-policy-notice">结算状态加载失败，请刷新后继续。</p>}
      {ctx.f2ActivationPendingError && <p role="alert" className="f2-policy-notice">{ctx.f2ActivationPendingError}</p>}
      {policy && !supported && <p className="f2-policy-notice">暂时不能提交申请，只能查看。请稍后刷新。</p>}
      {!allowed && <p className="f2-policy-notice">你只能查看，提交申请需要「七层结算调整」权限。</p>}
      {(ctx.f2ActivationPending || submitted) && <p role="status" className="f2-policy-notice">{ctx.f2ActivationPending?.action ?? "原申请"}已提交；{ctx.f2ActivationPending ? "等待另一位管理员审批，批准前状态不变。" : "请核对当前状态；还没批准的申请需要另一位管理员审批。"}{ctx.can("platform_a2_read") && <Link href="/platform/audit">查看审批进度</Link>}</p>}
      {ctx.f2ActivationAttempt && <div className="f2-policy-notice" role="status"><p>{ctx.f2ActivationAttempt.spec.action}结果暂未确认，请先查看原申请。填写的理由：{ctx.f2ActivationAttempt.spec.reason}</p><p>查看不会重复提交。时间过长无法查看时，请到「操作记录与审批」核对。</p>{allowed && <button className="fbtn" disabled={recovering || busy || ctx.f2ActivationAttempt.expiresAt <= Date.now()} onClick={() => void recover()}>{recovering ? "正在查看原申请…" : "查看原申请"}</button>}{ctx.can("platform_a2_read") && <Link href="/platform/audit">查看审批进度</Link>}</div>}
      {recoveryError && <p role="alert" className="f2-policy-notice">{recoveryError}</p>}
      <div className="f2-policy-actions">
        {allowed && <button className="fbtn primary" disabled={blocked} onClick={submit}>{label}</button>}
        <button className="fbtn" disabled={busy} onClick={() => void ctx.refreshF2()}>刷新</button>
      </div>
    </div>
  </section>;
}
