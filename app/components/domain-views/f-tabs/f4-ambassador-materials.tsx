"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Drawer, OperationConfirmModal } from "../design-kit";
import { createA2CommandKey } from "@/lib/admin/a2-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { F1OutcomeUncertainError, isF1OutcomeUncertainError } from "@/lib/admin/f1-stable-write";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { ambassadorApprovalBlocker, ambassadorBucketLabel, ambassadorMaterialStateLabel, F4_MATERIAL_PERMISSIONS } from "@/lib/admin/f4-ambassador-display";
import { fetchF4AmbassadorMaterials, F4MaterialReviewNotAppliedError, reviewF4AmbassadorMaterials, type F4AmbassadorApplication, type F4AmbassadorMaterialPacket, type F4AmbassadorMaterialProposal, type F4AmbassadorReview, type F4AmbassadorReviewInput } from "@/lib/admin/f1-client";
import { formatBusinessTime } from "@/lib/admin/business-time";
import type { FViewCtx } from "./types";

type PendingReview = PendingMutationRecord & { actorId: number; applicationId: number; input: F4AmbassadorReviewInput };
const reviewAttempts = createPendingMutationStore<PendingReview>({
  storageKey: "uvel-f4-ambassador-material-reviews", retainExpiredRecords: true,
  isValidRecord: (record) => Number.isSafeInteger(record.actorId) && Number.isSafeInteger(record.applicationId)
    && Number.isSafeInteger(record.input?.expectedMaterialRevision) && ["BUSINESS", "FINANCE"].includes(record.input?.stage)
    && ["PASSED", "NEEDS_MORE"].includes(record.input?.decision) && typeof record.input?.reason === "string",
});

function money(value: number | string | null | undefined) {
  return value == null ? "尚未认可" : `${String(value)} USDT`;
}

function ReviewRecord({ review, title }: { review: F4AmbassadorReview; title: string }) {
  return <div className="amb-review-record">
    <div><b>{title}</b><span className={`bdg ${review.status === "PASSED" ? "ok" : review.status === "NEEDS_MORE" ? "warn" : "dim"}`}>
      {review.status === "PASSED" ? "通过" : review.status === "NEEDS_MORE" ? "需补材料" : "待核验"}
    </span></div>
    {review.reviewerLabel && <p>核验人：{review.reviewerLabel} · {review.reviewedAt ? formatBusinessTime(review.reviewedAt, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "时间待核实"}</p>}
    {review.reason && <p>理由：{review.reason}</p>}
    {review.verifiedAttendees != null && <p>有效去重人数：{review.verifiedAttendees} 人</p>}
    {review.recognizedBudgetUsdt != null && <p>认可金额：<span className="mono">{money(review.recognizedBudgetUsdt)}</span></p>}
  </div>;
}

export function AmbassadorMaterialSummary({ packet, expectedMaterialRevision }: {
  packet: Pick<F4AmbassadorMaterialProposal, "applicationId" | "bucket" | "budgetUsdt" | "materialRevision" | "materialState" | "businessReview" | "financeReview">;
  expectedMaterialRevision?: number | null;
}) {
  return <div className="amb-material-summary">
    <dl className="amb-facts">
      <div><dt>原申请</dt><dd>#{packet.applicationId} · {ambassadorBucketLabel(packet.bucket)}</dd></div>
      <div><dt>材料状态</dt><dd>{ambassadorMaterialStateLabel(packet.materialState)}</dd></div>
      <div><dt>申请金额</dt><dd className="mono">{money(packet.budgetUsdt)}</dd></div>
      <div><dt>认可金额</dt><dd className="mono">{money(packet.financeReview.recognizedBudgetUsdt)}</dd></div>
      {expectedMaterialRevision !== undefined && <div><dt>提案材料版本</dt><dd className="mono">{expectedMaterialRevision == null ? "原提案未保存版本" : `V${expectedMaterialRevision}`}</dd></div>}
      <div><dt>当前材料版本</dt><dd className="mono">V{packet.materialRevision}</dd></div>
    </dl>
    <ReviewRecord title="业务核验" review={packet.businessReview} />
    <ReviewRecord title="财务核验" review={packet.financeReview} />
  </div>;
}

export function F4AmbassadorMaterials(props: { application: F4AmbassadorApplication; ctx: FViewCtx; onClose: () => void }) {
  const actorId = useAdminAuth((state) => state.session?.adminId);
  return <MaterialDrawer key={`${actorId}:${props.application.id}`} {...props} actorId={actorId} />;
}

function MaterialDrawer({ application, ctx, onClose, actorId }: {
  application: F4AmbassadorApplication; ctx: FViewCtx; onClose: () => void; actorId: number | undefined;
}) {
  const fingerprint = `${actorId}|${application.id}`;
  const [packet, setPacket] = useState<F4AmbassadorMaterialPacket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(() => reviewAttempts.list().find((item) => item.fingerprint === fingerprint));
  const pendingRef = useRef(pending);
  const [confirmation, setConfirmation] = useState<Omit<F4AmbassadorReviewInput, "reason"> | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const next = await fetchF4AmbassadorMaterials(application.id);
      if (next.applicationId !== application.id || !Number.isSafeInteger(next.materialRevision)
        || !Array.isArray(next.requirements) || !Array.isArray(next.attachments) || !Array.isArray(next.approvalBlockers) || !Array.isArray(next.proposalBlockers) || !Array.isArray(next.missingKinds)
        || !next.businessReview || !next.financeReview) throw new Error("材料详情不完整，请重新加载。");
      setPacket(next);
    } catch (cause) { setPacket(null); setError(displayAdminError(cause)); }
    finally { setLoading(false); }
  }, [application.id]);
  useEffect(() => { void refresh(); }, [refresh]);
  const operable = !!packet && !loading && !error && !pending;
  const final = application.status.toUpperCase() !== "PENDING" || packet?.approvalBlockers.includes("APPLICATION_NOT_PENDING") === true;
  const canProposeApproval = operable && !final && packet.canProposeApproval === true && ctx.can("network_f4_ambassador_approve");

  const approve = () => {
    if (!packet || !canProposeApproval) return;
    ctx.openActionConfirm({ briefKind: "funds", name: `批准大使申请 #${application.id}`, amplify: true,
      op: "dispose", paramKey: `F.ambassador.${application.id}.status`, fixedVal: "approved",
      expectedMaterialRevision: packet.materialRevision,
      detail: `${ambassadorBucketLabel(packet.bucket)} · 申请金额 ${money(packet.budgetUsdt)} · 认可金额 ${money(packet.financeReview.recognizedBudgetUsdt)} · 材料 V${packet.materialRevision}。业务核验与财务核验均已通过。本次仅开通所选类别的申请额度。`,
      completionCopy: "提交到「操作记录与审批」，由另一位有最终批准权限且未参与本版材料核验的管理员批准后生效。执行时重新检查材料、金额及兑付覆盖率。",
    });
  };

  return <>
    <Drawer title={`大使申请 #${application.id} · 材料详情`} sub={`${application.applicantName} · ${application.region}${application.city ? ` / ${application.city}` : ""}`} onClose={onClose}
      footer={<div className="amb-material-actions">
        <button className="btn" onClick={onClose}>关闭</button>
        {!final && ctx.can("network_f4_ambassador_approve") && <>
          <button className="btn danger" disabled={!operable} onClick={() => ctx.openActionConfirm({ briefKind: "record", name: `驳回大使申请 #${application.id}`,
            op: "dispose", paramKey: `F.ambassador.${application.id}.status`, fixedVal: "rejected", detail: "驳回这一份申请，提交审批后由另一位有权限的管理员执行。" })}>驳回申请</button>
          <button className="btn primary" disabled={!canProposeApproval} onClick={approve}>发起批准</button>
        </>}
      </div>}>
      <div className="amb-materials" aria-busy={loading}>
        {recoveryNotice && <div className="amb-note" role="status">{recoveryNotice}</div>}
        <div className="amb-material-heading"><span>活动／服务日期：{packet?.eventDate || application.eventDate || "待核实"}</span><button className="btn sm" disabled={loading} onClick={() => void refresh()}>刷新材料</button></div>
        {loading ? <p role="status">正在读取当前材料与核验状态…</p> : error ? <div role="alert" className="amb-alert">材料读取失败：{error}。请刷新重试。</div> : packet && <>
          {packet.legacyApproved && <div className="amb-note">历史已批准申请：保留原额度与状态，不补作核验通过。</div>}
          <AmbassadorMaterialSummary packet={packet} />
          <section className="amb-section"><h3>提交材料</h3>
            {packet.requirements.length ? packet.requirements.map((requirement) => {
              const files = packet.attachments.filter((file) => file.kind === requirement.kind);
              return <div key={requirement.kind} className="amb-file-group">
                <div className="amb-file-heading"><b>{requirement.label}</b><span className={packet.missingKinds.includes(requirement.kind) ? "amb-missing" : "muted"}>{packet.missingKinds.includes(requirement.kind) ? "缺项／需补充" : `${files.length} 份`}</span></div>
                {files.length ? files.map((file) => <a key={file.fileId} className="amb-file" href={`/api/admin/teams/ambassador-applications/${application.id}/materials/files/${encodeURIComponent(file.fileId)}`} target="_blank" rel="noopener noreferrer">
                  <span>{file.name}</span><small>{(file.sizeBytes / 1024 / 1024).toFixed(2)} MB · 查看 ↗</small>
                </a>) : <p className="muted">尚未提交{requirement.required ? "必要" : "此项"}材料</p>}
              </div>;
            }) : <p className="muted">{packet.bucket ? "暂无材料要求" : "等待申请人明确补齐申请类别"}</p>}
          </section>
          <section className="amb-section"><h3>材料来源说明</h3><p className="amb-statement">{packet.statement || "申请人尚未填写说明"}</p></section>
          {pending && <div className="amb-alert" role="alert"><p>原{pending.input.stage === "BUSINESS" ? "业务" : "财务"}核验结果尚未确认 · 材料 V{pending.input.expectedMaterialRevision}。原内容与命令号已保留，请继续原操作。</p>
            <button className="btn" onClick={() => setConfirmation(pending.input)}>核对原核验结果</button>
            <p>始终使用原命令号与原内容恢复已保留的回执；结果未知时不会换号重新操作。</p>
          </div>}
          {!final && <>
            <p className="amb-note">核验人与最终批准人必须不同。申请人补交后形成新材料版本，旧结论需重新核验。</p>
            {(["BUSINESS", "FINANCE"] as const).map((stage, index) => <ReviewForm key={`${packet.materialRevision}:${stage}`} packet={packet} stage={stage}
              writable={operable && (stage === "BUSINESS" ? packet.canReviewBusiness : packet.canReviewFinance) === true && ctx.can(F4_MATERIAL_PERMISSIONS[index].code)}
              onReview={setConfirmation} />)}
            {packet.proposalBlockers.length > 0 && <div className="amb-alert"><b>暂不能发起批准</b><ul>{[...new Set(packet.proposalBlockers.map(ambassadorApprovalBlocker))].map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></div>}
          </>}
          {!!packet.reviewHistory?.length && <details className="amb-section"><summary>核验历史 · {packet.reviewHistory.length} 条</summary>{packet.reviewHistory.map((review, index) => <div key={index}><p className="muted">材料 V{review.materialRevision}</p><ReviewRecord review={review} title={review.stage === "BUSINESS" ? "业务核验" : "财务核验"} /></div>)}</details>}
        </>}
      </div>
    </Drawer>
    {confirmation && <OperationConfirmModal briefKind="record" action={`${confirmation.stage === "BUSINESS" ? "业务" : "财务"}材料核验 · #${application.id}`}
      detail={<div className="amb-materials"><p>材料 V{confirmation.expectedMaterialRevision} · 结论：{confirmation.decision === "PASSED" ? "通过" : "需补材料"}</p>
        {confirmation.verifiedAttendees != null && <p>有效去重人数：{confirmation.verifiedAttendees} 人</p>}
        {confirmation.recognizedBudgetUsdt != null && <p>认可金额：{money(confirmation.recognizedBudgetUsdt)}</p>}
        {!!confirmation.missingKinds?.length && <p>补充项目：{confirmation.missingKinds.map((kind) => packet?.requirements.find((item) => item.kind === kind)?.label ?? "材料项目").join("、")}</p>}
      </div>}
      completionCopy={pending ? "使用原命令号、原版本、原结论与理由核对原核验，已保存的成功回执持续有效；不会换号重做结果未知的操作。" : "核验结论与理由立即记录到本版材料；需补材料时，申请人在原申请中补交。本操作不会批准预算。"}
      getPendingReason={() => pendingRef.current?.input.reason}
      onClose={() => setConfirmation(null)}
      onConfirm={async (reason) => {
        if (!actorId || useAdminAuth.getState().session?.adminId !== actorId) throw new Error("登录账号已变化，请重新打开申请。");
        const original = pendingRef.current;
        const attempt = original ?? { actorId, applicationId: application.id, input: { ...confirmation, reason }, fingerprint,
          commandKey: createA2CommandKey("f4-material-review"), createdAt: Date.now(), expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
        reviewAttempts.remember(fingerprint, attempt.commandKey, { actorId, applicationId: application.id, input: attempt.input });
        pendingRef.current = attempt; setPending(attempt);
        try {
          const next = await reviewF4AmbassadorMaterials(application.id, attempt.input, attempt.commandKey);
          if (!next || next.applicationId !== application.id || next.materialRevision !== attempt.input.expectedMaterialRevision) throw new F1OutcomeUncertainError("核验回执需重新核对，请刷新材料后继续原核验。", attempt.commandKey);
          reviewAttempts.forget(fingerprint, attempt.commandKey); pendingRef.current = undefined; setPending(undefined);
          setPacket(next); setConfirmation(null); ctx.toast("材料核验已记录"); await refresh(); await ctx.refreshF4();
        } catch (cause) {
          if (cause instanceof F4MaterialReviewNotAppliedError) {
            reviewAttempts.forget(fingerprint, attempt.commandKey); pendingRef.current = undefined; setPending(undefined);
            setRecoveryNotice(`原材料 V${attempt.input.expectedMaterialRevision} 的核验未执行，${cause.code === "MATERIAL_REVISION_STALE" ? "材料版本已变化，请核对当前材料后重新核验。" : "申请已处理，已刷新原申请。"}`);
            setConfirmation(null); await refresh(); await ctx.refreshF4(); return;
          }
          if (!original && !isF1OutcomeUncertainError(cause)) { reviewAttempts.forget(fingerprint, attempt.commandKey); pendingRef.current = undefined; setPending(undefined); }
          throw cause;
        }
      }} />}
  </>;
}

function ReviewForm({ packet, stage, writable, onReview }: {
  packet: F4AmbassadorMaterialPacket; stage: "BUSINESS" | "FINANCE"; writable: boolean;
  onReview: (input: Omit<F4AmbassadorReviewInput, "reason">) => void;
}) {
  const [decision, setDecision] = useState<"PASSED" | "NEEDS_MORE" | "">("");
  const [attendees, setAttendees] = useState("");
  const [recognized, setRecognized] = useState("");
  const [missing, setMissing] = useState<string[]>([]);
  const business = stage === "BUSINESS";
  return <section className="amb-section"><h3>{business ? "业务材料核验" : "费用材料核验"}</h3>
    {writable ? <form onSubmit={(event) => {
      event.preventDefault(); if (!decision) return;
      onReview({ expectedMaterialRevision: packet.materialRevision, stage, decision,
        ...(business && attendees !== "" ? { verifiedAttendees: Number(attendees) } : {}),
        ...(!business && recognized !== "" ? { recognizedBudgetUsdt: recognized } : {}),
        ...(decision === "NEEDS_MORE" ? { missingKinds: missing } : {}),
      });
    }}>
      <div className="amb-form-grid"><label>核验结论<select className="fld" required value={decision} onChange={(event) => setDecision(event.target.value as typeof decision)}>
        <option value="">请选择核验结论</option><option value="PASSED">通过</option><option value="NEEDS_MORE">需补材料</option>
      </select></label>
      {business && packet.bucket === "venue" && <label>有效去重人数<input className="fld" type="number" min={decision === "PASSED" ? 100 : 0} step="1" required={decision === "PASSED"} value={attendees} onChange={(event) => setAttendees(event.target.value)} /></label>}
      {!business && <label>认可金额（USDT）<input className="fld" type="number" min="0" step="0.000001" required={decision === "PASSED"} value={recognized} onChange={(event) => setRecognized(event.target.value)} /></label>}</div>
      {decision === "NEEDS_MORE" && <fieldset className="amb-missing-fields"><legend>需要补充的材料项目</legend>{packet.requirements.map((requirement) => <label key={requirement.kind}>
        <input type="checkbox" checked={missing.includes(requirement.kind)} onChange={(event) => setMissing(event.target.checked ? [...missing, requirement.kind] : missing.filter((kind) => kind !== requirement.kind))} />{requirement.label}
      </label>)}</fieldset>}
      <button className="btn" type="submit" disabled={!decision}>核对并填写理由</button>
    </form> : <p className="muted">当前为只读。核验需独立授权、已提交的材料版本和待审申请。</p>}
  </section>;
}
