"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ExternalLink, FileCheck2 } from "lucide-react";
import { BlockState, Button, Check, CheckGroup, Decision, Drawer, Fact, Facts, Field, Fold, KeyValues, Notice, NumberInput, Segments, StatusTag, Steps } from "@/app/components/rd";
import { OperationConfirmModal } from "../design-kit";
import { SETTLED_REJECTED } from "../recovery-panel";
import { createA2CommandKey } from "@/lib/admin/a2-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { F1OutcomeUncertainError, isF1OutcomeUncertainError } from "@/lib/admin/f1-stable-write";
import { createPendingMutationStore, isRetryExpired, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { isDeterministicRejection } from "@/lib/admin/outcome-classification";
import { f4MaterialCommandOrigin, queryF4MaterialCommand } from "@/lib/admin/f4-material-command";
import { isOriginalCommandOrigin } from "@/lib/admin/original-command-query";
import type { FundCommandOrigin } from "@/lib/admin/fund-command-investigation";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { ambassadorApprovalBlocker, ambassadorBucketLabel, ambassadorMaterialStateLabel, F4_MATERIAL_PERMISSIONS } from "@/lib/admin/f4-ambassador-display";
import { fetchF4AmbassadorMaterials, F4MaterialReviewNotAppliedError, reviewF4AmbassadorMaterials, type F4AmbassadorApplication, type F4AmbassadorMaterialPacket, type F4AmbassadorMaterialProposal, type F4AmbassadorReview, type F4AmbassadorReviewInput } from "@/lib/admin/f1-client";
import { businessStamp, businessZone, formatBusinessTimeCompact } from "@/lib/admin/business-time";
import { maskAuditActor } from "@/lib/admin/audit-actor";
import { operatorNicknameText } from "@/lib/admin/brand-copy";
import { applicationStage } from "./f4-quota";
import { count, decimalText, stamp, unknownTag, zoneNote } from "./f4-shared";
import type { FViewCtx } from "./types";
import { f4Confirmation } from "./f4-confirmations";

type PendingReview = PendingMutationRecord & { actorId: number; applicationId: number; input: F4AmbassadorReviewInput; application?: F4AmbassadorApplication; commandOrigin?: FundCommandOrigin };
const reviewAttempts = createPendingMutationStore<PendingReview>({
  storageKey: "uvel-f4-ambassador-material-reviews", retainExpiredRecords: true,
  isValidRecord: (record) => Number.isSafeInteger(record.actorId) && Number.isSafeInteger(record.applicationId)
    && record.fingerprint === `${record.actorId}|${record.applicationId}`
    && Number.isSafeInteger(record.input?.expectedMaterialRevision) && ["BUSINESS", "FINANCE"].includes(record.input?.stage)
    && ["PASSED", "NEEDS_MORE"].includes(record.input?.decision) && typeof record.input?.reason === "string"
    && isOriginalCommandOrigin(record.commandOrigin, { originalMethod: "POST", originalPath: `/api/admin/teams/ambassador-applications/${record.applicationId}/materials/review`, readAuthority: "network_f4_read" })
    && (record.commandOrigin === undefined || record.commandOrigin.originalAdminId === String(record.actorId)),
});

function money(value: number | string | null | undefined) {
  return value == null ? "尚未认可" : `${String(value)} USDT`;
}

function ReviewRecord({ review, title }: { review: F4AmbassadorReview; title: string }) {
  return <div className="amb-review-record">
    <div><b>{title}</b><span className={`bdg ${review.status === "PASSED" ? "ok" : review.status === "NEEDS_MORE" ? "warn" : "dim"}`}>
      {review.status === "PASSED" ? "通过" : review.status === "NEEDS_MORE" ? "需补材料" : "待核验"}
    </span></div>
    {review.reviewerLabel && <p>核验人：{review.reviewerLabel} · {review.reviewedAt ? `${formatBusinessTimeCompact(review.reviewedAt, "时间待核实")}（${businessZone().label}）` : "时间待核实"}</p>}
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

/** 这台电脑上保存的、当前账号的材料核验原请求（结果未知）。只读，恢复仍在材料详情里按原请求进行。 */
export function materialReviewAttempts(actorId: number): PendingReview[] {
  return reviewAttempts.list().filter((record) => record.actorId === actorId);
}

export function F4AmbassadorMaterials(props: { application: F4AmbassadorApplication; ctx: FViewCtx; onClose: () => void }) {
  const actorId = useAdminAuth((state) => state.session?.adminId);
  return <MaterialDrawer key={`${actorId}:${props.application.id}`} {...props} actorId={actorId} />;
}

const REVIEW_TAG: Record<F4AmbassadorReview["status"], { text: string; tone: "ok" | "warn" | "neutral" }> = {
  PASSED: { text: "通过", tone: "ok" },
  NEEDS_MORE: { text: "需补材料", tone: "warn" },
  PENDING: { text: "待核验", tone: "neutral" },
};

/** 一次核验的结论卡：结论、谁、什么时候、理由、人数或认可金额。null 的认可金额是「尚未认可」，不是 0。 */
function ReviewCard({ review, title, stage, venue }: { review: F4AmbassadorReview; title: string; stage: "BUSINESS" | "FINANCE"; venue: boolean }) {
  const tag = REVIEW_TAG[review.status] ?? REVIEW_TAG.PENDING;
  return <div className="f4-review-card" data-status={review.status}>
    <span className="f4-review-head"><b>{title}</b><StatusTag tone={tag.tone} icon={review.status === "NEEDS_MORE" ? AlertCircle : undefined}>{tag.text}</StatusTag></span>
    <KeyValues rows={[
      { key: "who", label: "核验人", value: review.reviewerLabel ? maskAuditActor(review.reviewerLabel) : "—", sub: review.reviewedAt ? stamp(review.reviewedAt) : undefined },
      ...(stage === "FINANCE" ? [{ key: "amount", label: "认可金额", value: review.recognizedBudgetUsdt == null ? "尚未认可" : `${decimalText(review.recognizedBudgetUsdt)} USDT` }]
        : venue ? [{ key: "people", label: "有效去重人数", value: review.verifiedAttendees == null ? "—" : `${count(review.verifiedAttendees)} 人` }] : []),
      { key: "reason", label: "理由", value: review.reason || "—" },
    ]} />
  </div>;
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
    setLoading(true); setError(null); setPacket(null);
    try {
      const next = await fetchF4AmbassadorMaterials(application.id);
      if (next.applicationId !== application.id) throw new Error("材料详情不完整，请重新加载。");
      setPacket(next);
      return next;
    } catch (cause) { setPacket(null); setError(displayAdminError(cause)); return null; }
    finally { setLoading(false); }
  }, [application.id]);
  useEffect(() => { void refresh(); }, [refresh]);
  const queryOriginal = async () => {
    const original = pendingRef.current;
    if (!original || original.actorId !== useAdminAuth.getState().session?.adminId) throw new Error("登录账号已变化，请重新打开申请。");
    const { outcome } = await queryF4MaterialCommand(original);
    if (original.actorId !== useAdminAuth.getState().session?.adminId) throw new Error("COMMAND_INVESTIGATION_FORBIDDEN");
    if (outcome) {
      reviewAttempts.forget(original.fingerprint, original.commandKey); pendingRef.current = undefined; setPending(undefined);
      setPacket(null); setConfirmation(null);
      if (outcome === "SUCCEEDED") ctx.toast("材料核验已记录");
      else if (outcome === "REJECTED") setRecoveryNotice(SETTLED_REJECTED);
      else setRecoveryNotice(displayAdminError(new Error("IDEMPOTENCY_INVESTIGATION_CONFIRMED_NOT_EXECUTED")));
      await refresh(); await ctx.refreshF4();
      return true;
    }
    const next = await refresh();
    if (!next) throw new Error("材料没读到，刷新后再试");
    if (original.actorId !== useAdminAuth.getState().session?.adminId) throw new Error("登录账号已变化，请重新打开申请。");
    const input = original.input;
    // Every successful review is appended to the complete immutable history.
    // An old revision/finished application plus no possible matching review proves non-execution.
    // Old history rows may have no command key. Keep the existing non-execution proof for those records.
    const closed = next.materialRevision > input.expectedMaterialRevision || next.approvalBlockers.includes("APPLICATION_NOT_PENDING");
    if (closed && next.reviewHistory && !next.reviewHistory.some(review => review.materialRevision === input.expectedMaterialRevision
      && review.stage === input.stage && review.status === input.decision && review.reason === input.reason.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, ""))) {
      reviewAttempts.forget(original.fingerprint, original.commandKey); pendingRef.current = undefined; setPending(undefined);
      setConfirmation(null);
      setRecoveryNotice(`原材料 V${input.expectedMaterialRevision} 的核验未执行，${next.materialRevision > input.expectedMaterialRevision ? "材料版本已变化，请核对当前材料后重新核验。" : "申请已处理，已刷新原申请。"}`);
      await ctx.refreshF4();
    } else setRecoveryNotice(displayAdminError(new Error("RBAC_READBACK_ONLY")));
    return true;
  };
  const operable = !!packet && !loading && !error && !pending;
  const final = application.status.toUpperCase() !== "PENDING" || packet?.approvalBlockers.includes("APPLICATION_NOT_PENDING") === true;
  const canProposeApproval = operable && !final && packet.canProposeApproval === true && ctx.can("network_f4_ambassador_approve");
  const stage = applicationStage({ ...application, ...(packet ? { materialRevision: packet.materialRevision, materialState: packet.materialState, businessReview: packet.businessReview, financeReview: packet.financeReview, legacyApproved: packet.legacyApproved } : {}) });
  const requested = packet ? packet.budgetUsdt : application.requestedBudgetUsd;
  const missingLabels = packet ? packet.missingKinds.map((kind) => packet.requirements.find((item) => item.kind === kind)?.label ?? "材料项目") : [];
  const proposalBlockers = packet ? [...new Set(packet.proposalBlockers.map(ambassadorApprovalBlocker))] : [];

  const approve = () => {
    if (!packet || !canProposeApproval) return;
    ctx.openActionConfirm(f4Confirmation(ctx, { action: "approve", overview: ctx.f4Overview!, policy: ctx.f4AmbassadorPolicy, application, material: packet ?? undefined }));
  };
  const reject = () => ctx.openActionConfirm(f4Confirmation(ctx, { action: "reject", overview: ctx.f4Overview!, policy: ctx.f4AmbassadorPolicy, application, material: packet ?? undefined }));

  const reviewWritable = (stageKey: "BUSINESS" | "FINANCE", index: number) => !!packet && operable
    && (stageKey === "BUSINESS" ? packet.canReviewBusiness : packet.canReviewFinance) === true && ctx.can(F4_MATERIAL_PERMISSIONS[index].code);

  return <>
    <Drawer open onClose={onClose} icon={FileCheck2} tone="role-3"
      title={`大使申请 #${application.id}`}
      sub={`${operatorNicknameText(application.applicantName)} · ${application.region}${application.city ? ` / ${application.city}` : ""} · ${application.currentRank}`}
      explain="核验结论直接记录到当前这一版材料，不批准预算。批准和驳回要另一位管理员批准；核验过这一版材料的人不能做最终批准。申请人补交材料会形成新的一版，旧结论要重新核验。"
      footer={<Decision
        note={!final && !ctx.can("network_f4_ambassador_approve") ? "当前账号没有大使最终批准权限，只能查看和核验。" : final ? "这份申请已经处理，只能查看。" : undefined}
        danger={!final && ctx.can("network_f4_ambassador_approve") ? <Button variant="danger-outline" disabledReason={operable ? undefined : loading ? "正在读取材料" : pending ? "有一次核验结果未知，先处理它" : "材料没读到，刷新后再试"} onClick={reject}>驳回申请</Button> : undefined}
        others={<Button onClick={onClose}>关闭</Button>}
        primary={!final && ctx.can("network_f4_ambassador_approve") ? <Button variant="primary" disabledReason={canProposeApproval ? undefined : !operable ? (loading ? "正在读取材料" : pending ? "有一次核验结果未知，先处理它" : "材料没读到，刷新后再试") : proposalBlockers[0] ?? "还不满足批准条件"} onClick={approve}>发起批准</Button> : undefined} />}>
      <div className="f4-materials" aria-busy={loading}>
        {recoveryNotice && <Notice tone="progress">{recoveryNotice}</Notice>}
        {pending && (() => {
          // 过期或这个账号已没有这项核验权限时，恢复框里只能查询（和恢复框的 expired 判断一致）。
          const expired = isRetryExpired(pending);
          const revoked = !ctx.can(pending.input.stage === "BUSINESS" ? "network_f4_ambassador_material_review" : "network_f4_ambassador_finance_review");
          return <Notice tone="warn" title={<>{pending.input.stage === "BUSINESS" ? "业务" : "财务"}核验结果未知{expired ? <StatusTag tone="neutral">已过期</StatusTag> : unknownTag("direct")}</>}
          action={<Button size="sm" onClick={() => setConfirmation(pending.input)}>{expired || revoked ? "查询原结果" : "按原请求重试"}</Button>}>
          {`材料第 ${pending.input.expectedMaterialRevision} 版 · ${pending.input.decision === "PASSED" ? "通过" : "需补材料"} · ${businessStamp(pending.createdAt)} 提交（${zoneNote()}）。${expired ? "原请求超过 24 小时，只能查询，不能再重试。" : revoked ? "这个账号已经没有这项核验权限，只能查询，不能再重试。" : "原内容和理由已保留，可以按原请求重试，不能改。"}`}
        </Notice>;
        })()}
        <Steps label="申请进度" items={["提交材料", "业务核验", "财务核验", "最终批准"].map((label, index) => ({
          label, sub: index === 3 ? "开通所选类别额度" : undefined,
          state: stage.done > index ? "done" as const : stage.done === index && !final ? "current" as const : "todo" as const,
        }))} />
        <Facts>
          <Fact k="申请金额" lead tone="role-1" unit="USDT">{decimalText(requested)}</Fact>
          <Fact k="现在">{stage.text}</Fact>
          <Fact k="类别">{ambassadorBucketLabel(packet?.bucket ?? application.bucket)}</Fact>
          <Fact k="活动或服务日期">{packet?.eventDate || application.eventDate || "—"}</Fact>
          <Fact k="材料">{packet ? `${ambassadorMaterialStateLabel(packet.materialState)} · 第 ${packet.materialRevision} 版` : "—"}</Fact>
        </Facts>
        {loading ? <BlockState state="loading" title="正在读取当前材料和核验状态…" />
          : error ? <BlockState state="error" title="材料读取失败" detail={error} onRetry={() => void refresh()} retryLabel="刷新材料" />
          : packet && <>
            {packet.legacyApproved && <Notice tone="neutral">历史已批准的申请：保留原额度和状态，没有材料，不补作核验通过。</Notice>}
            {missingLabels.length > 0 && <Notice tone="warn" title="需要申请人补材料">缺：{missingLabels.join("、")}。申请人在 App 的原申请里补交，补交后形成新的一版，要重新核验。</Notice>}
            <section className="f4-mat-section" aria-labelledby={`f4-mat-files-${application.id}`}>
              <h3 id={`f4-mat-files-${application.id}`}>提交的材料<Button size="sm" variant="ghost" loading={loading} onClick={() => void refresh()}>刷新材料</Button></h3>
              {packet.requirements.length ? <ul className="f4-files">
                {packet.requirements.map((requirement) => {
                  const files = packet.attachments.filter((file) => file.kind === requirement.kind);
                  const missing = packet.missingKinds.includes(requirement.kind);
                  return <li key={requirement.kind} data-missing={missing ? "" : undefined}>
                    <span className="f4-file-kind">{requirement.label}{requirement.required ? "" : <small>可选</small>}</span>
                    <span className="f4-file-list">
                      {files.length ? files.map((file) => <a key={file.fileId} className="rd-link" href={`/api/admin/teams/ambassador-applications/${application.id}/materials/files/${encodeURIComponent(file.fileId)}`} target="_blank" rel="noopener noreferrer">
                        {file.name}<small>{(file.sizeBytes / 1024 / 1024).toFixed(2)} MB</small><ExternalLink size={12} aria-hidden />
                      </a>) : <span className="f4-muted">尚未提交{requirement.required ? "必要" : "此项"}材料</span>}
                    </span>
                    {missing ? <StatusTag tone="warn" icon={AlertCircle}>需补充</StatusTag> : <span className="f4-muted">{files.length} 份</span>}
                  </li>;
                })}
              </ul> : <p className="f4-muted">{packet.bucket ? "暂无材料要求" : "等待申请人明确补齐申请类别"}</p>}
              <KeyValues rows={[{ key: "statement", label: "申请人说明", value: packet.statement || "申请人尚未填写说明" }]} />
            </section>
            <section className="f4-mat-section" aria-labelledby={`f4-mat-reviews-${application.id}`}>
              <h3 id={`f4-mat-reviews-${application.id}`}>两次核验（第 {packet.materialRevision} 版材料）</h3>
              <div className="f4-review-pair">
                <ReviewCard title="业务核验" stage="BUSINESS" venue={packet.bucket === "venue"} review={packet.businessReview} />
                <ReviewCard title="财务核验" stage="FINANCE" venue={packet.bucket === "venue"} review={packet.financeReview} />
              </div>
              {!final && (["BUSINESS", "FINANCE"] as const).map((stageKey, index) => <ReviewForm key={`${packet.materialRevision}:${stageKey}`} packet={packet} stage={stageKey}
                writable={reviewWritable(stageKey, index)} onReview={setConfirmation} />)}
              {!final && !reviewWritable("BUSINESS", 0) && !reviewWritable("FINANCE", 1) && <p className="f4-muted">当前只能查看核验结果。记录核验要有对应的核验权限，并且材料已提交、申请还在待处理。</p>}
              {!final && proposalBlockers.length > 0 && <Notice tone="neutral" title="暂不能发起批准"><ul className="f4-list">{proposalBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul></Notice>}
            </section>
            {!!packet.reviewHistory?.length && <Fold title="核验历史" summary={`${packet.reviewHistory.length} 条 · 含旧版材料`} explain={`每一版材料的每次核验都保留，新的在前；时间为${zoneNote()}。`}>
              <ul className="f4-history">{packet.reviewHistory.map((review, index) => {
                const tag = REVIEW_TAG[review.status] ?? REVIEW_TAG.PENDING;
                return <li key={index}>
                  <span className="f4-history-head"><b>{review.stage === "BUSINESS" ? "业务核验" : "财务核验"}</b><StatusTag tone={tag.tone}>{tag.text}</StatusTag><span className="f4-muted">第 {review.materialRevision ?? "—"} 版 · {review.reviewerLabel ? maskAuditActor(review.reviewerLabel) : "—"} · {review.reviewedAt ? stamp(review.reviewedAt) : "—"}</span></span>
                  {review.reason && <span className="f4-history-reason">{review.reason}</span>}
                  {review.verifiedAttendees != null && <span className="f4-muted">有效去重人数 {count(review.verifiedAttendees)} 人</span>}
                  {review.recognizedBudgetUsdt != null && <span className="f4-muted">认可金额 {decimalText(review.recognizedBudgetUsdt)} USDT</span>}
                </li>;
              })}</ul>
            </Fold>}
          </>}
      </div>
    </Drawer>
    {confirmation && <OperationConfirmModal briefKind="record" action={`${confirmation.stage === "BUSINESS" ? "业务" : "财务"}材料核验 · #${application.id}`}
      title={`${confirmation.stage === "BUSINESS" ? "业务" : "财务"}核验 · 申请 #${application.id}`}
      effect={<StatusTag tone="ok" filled>确认后立即记录</StatusTag>}
      statedBrief={{
        impact: confirmation.decision === "PASSED"
          ? "这一版材料的这次核验记为通过，立即记录；不批准预算，也不付款。"
          : "这一版材料记为需补材料，申请人在原申请里补交；补交后形成新的一版，要重新核验。",
        check: "材料版本变了或申请已处理时不会记录，并刷新到当前材料。",
      }}
      facts={<Facts>
        <Fact k="结论" tone={confirmation.decision === "PASSED" ? "ok" : "warn"}>{confirmation.decision === "PASSED" ? "通过" : "需补材料"}</Fact>
        <Fact k="材料">第 {confirmation.expectedMaterialRevision} 版</Fact>
        {confirmation.verifiedAttendees != null && <Fact k="有效去重人数">{count(confirmation.verifiedAttendees)} 人</Fact>}
        {confirmation.recognizedBudgetUsdt != null && <Fact k="认可金额">{decimalText(confirmation.recognizedBudgetUsdt)} USDT</Fact>}
        {!!confirmation.missingKinds?.length && <Fact k="要补的材料">{confirmation.missingKinds.map((kind) => packet?.requirements.find((item) => item.kind === kind)?.label ?? "材料项目").join("、")}</Fact>}
      </Facts>}
      detail={`材料 V${confirmation.expectedMaterialRevision} · 结论：${confirmation.decision === "PASSED" ? "通过" : "需补材料"}`}
      confirmLabel="记录核验结论"
      completionCopy={pending ? isRetryExpired(pending) || !ctx.can(pending.input.stage === "BUSINESS" ? "network_f4_ambassador_material_review" : "network_f4_ambassador_finance_review")
        ? "只能查询原结果：查到已经记下或确定没记下，都会解除这条记录；查不出就继续保留。"
        : "按原请求重试：原版本、原结论和原理由不变，已经记录过的不会记两次。" : "核验结论和理由立即记录到这一版材料，不经审批。"}
      getPendingReason={() => pendingRef.current?.input.reason}
      inlineApproval={{
        resolve: () => undefined,
        pending: !!pending,
        initialRecovery: "retry",
        expired: !!pending && (isRetryExpired(pending) || !ctx.can(pending.input.stage === "BUSINESS" ? "network_f4_ambassador_material_review" : "network_f4_ambassador_finance_review")),
        recover: queryOriginal,
      }}
      onClose={() => setConfirmation(null)}
      onConfirm={async (reason) => {
        if (!actorId || useAdminAuth.getState().session?.adminId !== actorId) throw new Error("登录账号已变化，请重新打开申请。");
        const original = pendingRef.current;
        const authority = (original?.input ?? confirmation).stage === "BUSINESS" ? "network_f4_ambassador_material_review" : "network_f4_ambassador_finance_review";
        if (!useAdminAuth.getState().session?.authorities.includes(authority)) throw new Error("ADMIN_PERMISSION_DENIED");
        if (original && isRetryExpired(original)) { setPending({ ...original }); throw new F1OutcomeUncertainError("原操作已超过 24 小时，只能查询原结果。", original.commandKey); }
        if (!original && (!packet || loading || error || final)) throw new Error("材料没读到，刷新后再试");
        const attempt: PendingReview = original ?? { actorId, applicationId: application.id, input: { ...confirmation, reason }, fingerprint, commandOrigin: f4MaterialCommandOrigin(application.id),
          commandKey: createA2CommandKey("f4-material-review"), createdAt: Date.now(), expiresAt: Date.now() + 24 * 60 * 60 * 1000 };
        reviewAttempts.remember(fingerprint, attempt.commandKey, { actorId, applicationId: application.id, input: attempt.input, application,
          commandOrigin: attempt.commandOrigin });
        if (!reviewAttempts.isDurablyStored(fingerprint, attempt.commandKey)) {
          if (!original) reviewAttempts.forget(fingerprint, attempt.commandKey);
          throw new Error(original ? "F4_OPERATION_RETRY_STORAGE_UNAVAILABLE" : "F4_OPERATION_STORAGE_UNAVAILABLE");
        }
        pendingRef.current = attempt; setPending(attempt);
        try {
          const next = await reviewF4AmbassadorMaterials(application.id, attempt.input, attempt.commandKey);
          if (!next || next.applicationId !== application.id || next.materialRevision !== attempt.input.expectedMaterialRevision) throw new F1OutcomeUncertainError("核验后返回的内容对不上，请刷新材料后继续原核验。", attempt.commandKey);
          reviewAttempts.forget(fingerprint, attempt.commandKey); pendingRef.current = undefined; setPending(undefined);
          setPacket(null); setConfirmation(null); ctx.toast("材料核验已记录"); await refresh(); await ctx.refreshF4();
        } catch (cause) {
          if (cause instanceof F4MaterialReviewNotAppliedError) {
            reviewAttempts.forget(fingerprint, attempt.commandKey); pendingRef.current = undefined; setPending(undefined);
            setRecoveryNotice(`原材料 V${attempt.input.expectedMaterialRevision} 的核验未执行，${cause.code === "MATERIAL_REVISION_STALE" ? "材料版本已变化，请核对当前材料后重新核验。" : "申请已处理，已刷新原申请。"}`);
            setConfirmation(null); await refresh(); await ctx.refreshF4(); return;
          }
          const failure = cause as { httpStatus?: number; apiCode?: number };
          if (original ? isExplicitRejection(cause) : !isF1OutcomeUncertainError(cause)
            && failure.httpStatus !== undefined && isDeterministicRejection(failure.httpStatus, failure.apiCode)) {
            reviewAttempts.forget(fingerprint, attempt.commandKey); pendingRef.current = undefined; setPending(undefined);
            if (original) { setConfirmation(null); await refresh(); await ctx.refreshF4(); }
          }
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
  const [attempted, setAttempted] = useState(false);
  const business = stage === "BUSINESS";
  const venue = business && packet.bucket === "venue";
  const title = business ? "业务核验" : "财务核验";
  // 和旧页面原生输入框的约束一样：人数是整数，通过时至少 100；认可金额不小于 0、最多 6 位小数，通过时必填。
  const attendeesIssue = !venue ? undefined
    : attendees === "" ? (decision === "PASSED" ? "通过时要填有效去重人数。" : undefined)
    : !/^\d+$/.test(attendees) ? "人数要填整数。"
    : decision === "PASSED" && Number(attendees) < 100 ? "线下活动通过时，有效去重人数至少 100 人。" : undefined;
  const recognizedIssue = business ? undefined
    : recognized === "" ? (decision === "PASSED" ? "通过时要填认可金额。" : undefined)
    : !/^\d+(?:\.\d{1,6})?$/.test(recognized) ? "认可金额填 0 或正数，最多 6 位小数。" : undefined;
  const issue = !decision ? "选择核验结论" : attendeesIssue ?? recognizedIssue;
  if (!writable) {
    return null;
  }
  return <form className="f4-review-form" onSubmit={(event) => {
    event.preventDefault(); setAttempted(true); if (!decision || issue) return;
    onReview({ expectedMaterialRevision: packet.materialRevision, stage, decision,
      ...(business && attendees !== "" ? { verifiedAttendees: Number(attendees) } : {}),
      ...(!business && recognized !== "" ? { recognizedBudgetUsdt: recognized } : {}),
      ...(decision === "NEEDS_MORE" ? { missingKinds: missing } : {}),
    });
  }}>
    <h4>记录{title}</h4>
    <div className="f4-review-fields">
      <Field label="核验结论" required error={attempted && !decision ? "选择核验结论。" : undefined}>
        {() => <Segments label={`${title}结论`} value={decision} onChange={setDecision} items={[{ value: "PASSED", label: "通过" }, { value: "NEEDS_MORE", label: "需补材料" }]} />}
      </Field>
      {venue && <Field label="有效去重人数" hint={decision === "PASSED" ? "至少 100 人" : "整数"} required={decision === "PASSED"} error={attempted || attendees ? attendeesIssue : undefined}>
        <NumberInput unit="人" min={decision === "PASSED" ? 100 : 0} step={1} value={attendees} onChange={(event) => setAttendees(event.target.value)} />
      </Field>}
      {!business && <Field label="认可金额" hint="最多 6 位小数" required={decision === "PASSED"} error={attempted || recognized ? recognizedIssue : undefined}>
        <NumberInput unit="USDT" min={0} step="0.000001" value={recognized} onChange={(event) => setRecognized(event.target.value)} />
      </Field>}
    </div>
    {decision === "NEEDS_MORE" && <CheckGroup legend="要申请人补哪些材料" summary={missing.length ? `已选 ${missing.length} 项` : "可以不选"}>
      {packet.requirements.map((requirement) => <Check key={requirement.kind} label={requirement.label} checked={missing.includes(requirement.kind)}
        onChange={(event) => setMissing(event.target.checked ? [...missing, requirement.kind] : missing.filter((kind) => kind !== requirement.kind))} />)}
    </CheckGroup>}
    <div className="f4-review-submit"><Button type="submit" disabledReason={issue && attempted ? issue : undefined}>填写理由并记录</Button></div>
  </form>;
}
