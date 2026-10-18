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
  const label = { ACTIVATE: "启用七层结算", PAUSE: "暂停新来源", RESUME: "恢复七层结算" }[action];
  const state = !policy ? "状态暂不可用" : !policy.sevenLayerEnabled ? "未启用" : policy.sevenLayerPaused ? "已启用 · 已暂停新来源" : "已启用 · 正常处理";
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
        ? "按当前已配置的七层规则启用新结算。生效时间由另一位管理员批准时确定；此前来源保留原规则与快照，不补发历史奖励，也不自动启用直属拆分。费率与冷却设置不变。"
        : action === "PAUSE"
          ? "暂停首次处理新来源，已冻结来源及退款、解锁仍按原规则处理。原生效时间与历史快照保留，恢复后继续处理因暂停滞留的原来源。"
          : "恢复后继续处理因暂停滞留的原来源及新来源，保留原生效时间与历史快照，不重复生成启用时间。费率与冷却设置不变。",
      completionCopy: "提交后进入 A2 待审批，由另一位管理员批准后生效；结果未确认时检查原工单，不要重复申请。",
      run: async reason => { await ctx.changeF2SevenLayerActivation(action, revision, policyVersion, reason); setSubmitted(true); },
    });
  }
  return <section className="pane f2-direct-policy" aria-label="七层结算启用状态">
    <div className="pane-h"><div><span className="ph-ttl">七层结算</span><span className="ph-sub">启用、暂停与恢复独立审批，费率设置保持不变</span></div></div>
    <div className="f2-policy-body">
      <p role="status" className="f2-policy-status">{busy ? "正在读取七层结算与审批状态…" : state}</p>
      {policy?.cutoverAt && <p className="f2-help">实际启用时间：<time dateTime={policy.cutoverAt}>{formatBusinessTime(policy.cutoverAt, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></p>}
      <p className="f2-help">启用时间前的来源保留原规则与历史快照；暂停、恢复不会移动启用时间，也不补发历史奖励。直属购买拆分需另行配置。</p>
      {ctx.f2DirectPolicyError && <p role="alert" className="f2-policy-notice">结算状态读取失败，请重新读取后继续。</p>}
      {ctx.f2ActivationPendingError && <p role="alert" className="f2-policy-notice">{ctx.f2ActivationPendingError}</p>}
      {policy && !supported && <p className="f2-policy-notice">启用服务暂不可用，当前仅可查看。请稍后重新读取。</p>}
      {!allowed && <p className="f2-policy-notice">当前角色仅可查看，申请需要七层结算调整及审批申请权限。</p>}
      {(ctx.f2ActivationPending || submitted) && <p role="status" className="f2-policy-notice">{ctx.f2ActivationPending?.action ?? "原申请"}已提交；{ctx.f2ActivationPending ? "待另一位管理员审批，当前生效状态尚未改变。" : "请核对当前结算状态与原工单，尚未批准的申请需另一位管理员审批。"}{ctx.can("platform_a2_read") && <Link href="/platform/audit">查看原工单与审批进度</Link>}</p>}
      {ctx.f2ActivationAttempt && <div className="f2-policy-notice" role="status"><p>{ctx.f2ActivationAttempt.spec.action}结果未确认，请检查原申请；原理由：{ctx.f2ActivationAttempt.spec.reason}</p><p>检查会沿用原申请内容与命令号，不另建申请。超过重试时限后请到 A2 核对原工单。</p>{allowed && <button className="fbtn" disabled={recovering || busy || ctx.f2ActivationAttempt.expiresAt <= Date.now()} onClick={() => void recover()}>{recovering ? "正在检查原申请…" : "检查原申请"}</button>}{ctx.can("platform_a2_read") && <Link href="/platform/audit">查看原工单与审批进度</Link>}</div>}
      {recoveryError && <p role="alert" className="f2-policy-notice">{recoveryError}</p>}
      <div className="f2-policy-actions">
        {allowed && <button className="fbtn primary" disabled={blocked} onClick={submit}>{label}</button>}
        <button className="fbtn" disabled={busy} onClick={() => void ctx.refreshF2()}>重新读取</button>
      </div>
    </div>
  </section>;
}
