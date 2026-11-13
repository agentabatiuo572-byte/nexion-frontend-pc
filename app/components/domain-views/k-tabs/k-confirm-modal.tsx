"use client";

/**
 * 普通确认弹窗 — K 域原语(与 OperationConfirmModal 形成对照,SPEC 三类弹窗之二):
 * 标记类 / 拦截未发放新人礼(预防性阻断) / 手动补触发 / 白名单 —— 不动已入账资产,
 * 强制留痕(业务服务必达审计);reason=true 时原因必填,input 为可选输入框。
 */
import { displayAdminError } from "@/lib/admin/error-messages";
import { announcePermissionDenied, isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { fetchA2ReasonPolicy } from "@/lib/admin/a2-client";
import { useEffect, useId, useState } from "react";
import { Notice } from "@/app/components/rd/block-state";
import { Button as RdButton } from "@/app/components/rd/button";
import { visibleReasonLength } from "@/lib/admin/a2-client";
import { RETRY_EXPIRED_TEXT } from "@/lib/admin/pending-mutation-store";
import { K1OutcomeUncertainError } from "@/lib/admin/k-client";
import { Modal, Btn, OperatorBriefBlock } from "../design-kit";
import type { ConfirmReq } from "./types";

/**
 * K 域（K1–K4）自己的确认框：在 `confirm-modal.tsx` 的基础上加了「重试原操作」的显示（标题、按钮、框内的结果未知提示、理由锁定、被拒原因留在框里）。
 * `confirm-modal.tsx` 还被 A、C、D、G、H、I、M 域引用，保持不动；两份的合并留给共用确认框那一轮。
 */
export function KConfirmModal({ req, onClose }: { req: ConfirmReq; onClose: () => void }) {
  const [pendingReason, setPendingReason] = useState(() => req.getPendingReason?.());
  const [reopened] = useState(() => Boolean(req.recoveryUi) && pendingReason !== undefined);
  // Only a still-retained original request is a retry, including after a failed submit.
  const retrying = Boolean(req.recoveryUi) && pendingReason !== undefined;
  // 提交后结果未知：框里留一条看得见的提示，按钮改成按原请求重试（提示条会消失）。
  const [unknown, setUnknown] = useState(false);
  const [draftReason, setReason] = useState(pendingReason ?? "");
  const reason = pendingReason ?? draftReason;
  const [pendingValue, setPendingValue] = useState(() => req.getPendingValue?.());
  const [draftValue, setValue] = useState("");
  const value = pendingValue ?? draftValue;
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 刚打开不报错：字数不够等失焦或点过提交才用警告色（DP-06）。
  const [attempted, setAttempted] = useState(false);
  const [reasonLeft, setReasonLeft] = useState(false);
  const [valueLeft, setValueLeft] = useState(false);
  const fieldId = useId();
  // K1–K4 都在 RdPage 里，只有改版的样子（和 OperationConfirmModal 同一个样子）；旧页面那一支和 chips、枚举勾选没有 K 页面用到，不保留。
  // 理由规则读得到就按它，读不到按默认 8–200 继续，紧急关停不能被规则服务挡住（Q-06）。
  const [policy, setPolicy] = useState<{ minChars: number; maxChars: number } | null>(null);
  // 读取中还不知道规则，不放行；读失败才按默认继续。
  const [policySettled, setPolicySettled] = useState(!req.reason);
  useEffect(() => {
    if (!req.reason) return;
    let active = true;
    void fetchA2ReasonPolicy().then((next) => { if (active) setPolicy(next); }, () => { if (active) setPolicy(null); }).finally(() => { if (active) setPolicySettled(true); });
    return () => { active = false; };
  }, [req.reason]);
  const reasonMin = policy?.minChars ?? 8;
  const reasonMax = policy?.maxChars ?? 200;
  const reasonLength = visibleReasonLength(reason);
  const reasonOk = !req.reason || (reasonLength >= reasonMin && reasonLength <= reasonMax);
  // 文本框要求 trim 后非空（拒纯空白）。
  const inputOk = !req.input || req.input.required === false || value.trim().length >= 1;
  const valueProblem = req.input?.validate?.(value);
  const can = !req.blockedReason && (pendingReason !== undefined || (reasonOk && inputOk && !valueProblem && policySettled));
  const reasonShort = reasonLength < reasonMin ? `还差 ${reasonMin - reasonLength} 字` : `已填写 ${reasonLength}/${reasonMax} 字`;
  const submit = async () => {
    if (!can || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const succeeded = await req.run(reason.trim(), req.input ? value.trim() : undefined);
      if (succeeded !== false) onClose();
    } catch (cause) {
      // 没权限再填也没用：提示、关框、重读权限（OP-81、OP-132）。
      if (isPermissionDenied(cause)) {
        announcePermissionDenied();
        onClose();
        return;
      }
      const handled = typeof req.errorHandled === "function" ? req.errorHandled(cause) : req.errorHandled;
      // K 域的恢复框：被明确拒绝后框回到普通新操作，拒绝原因要留在框里，不只靠会消失的提示条。
      if (!(req.recoveryUi && cause instanceof K1OutcomeUncertainError && cause.commandKey) && (!handled || req.recoveryUi)) setError(displayAdminError(cause));
    } finally {
      const retainedReason = req.getPendingReason?.();
      setPendingReason(retainedReason);
      if (req.recoveryUi) setUnknown(retainedReason !== undefined);
      setPendingValue(req.getPendingValue?.());
      setSubmitting(false);
    }
  };
  return (
    <Modal
      title={retrying || unknown ? <>重试原操作 · {req.title ?? req.action}</> : req.title ?? req.action}
      icon={req.confirmTone === "danger" ? "alert" : "shield"}
      tone={req.confirmTone === "danger" ? "danger" : "neutral"}
      sub={req.effect}
      className="rd-confirm"
      busy={submitting}
      dirty={value !== ""}
      onClose={() => { if (!submitting) onClose(); }}
      footer={
        <>
          <Btn disabled={submitting} onClick={onClose}>取消</Btn>
          <RdButton
            variant={req.confirmTone ?? "primary"}
            loading={submitting}
            loadingText="提交中…"
            disabledReason={can || submitting ? undefined : req.blockedReason ?? [!policySettled && "正在读取理由规则", !inputOk ? `填写${req.input?.label}` : valueProblem, !reasonOk && (reasonLength < reasonMin ? `操作理由${reasonShort}` : `操作理由不能超过 ${reasonMax} 字`)].filter(Boolean).join("；")}
            onBlockedClick={() => setAttempted(true)}
            onClick={() => void submit()}
          >
            {retrying || unknown ? "按原请求重试" : req.okLabel ?? "确认"}
          </RdButton>
        </>
      }
    >
      {/* 提交中锁住框里全部输入和选项，失败后恢复（OP-33）。display: contents 不影响排版。 */}
      <fieldset disabled={submitting || pendingReason !== undefined} className="rd-contents">
      {(retrying || unknown) && (
        <div className="rd-confirm-alert">
          {req.blockedReason === RETRY_EXPIRED_TEXT
            ? <Notice tone="warn" title="已过期，只能查询">原请求超过 24 小时，不能再重试。关掉这个框，在页面上方的提醒里点「查询原结果」，或到「操作记录与审批」核对。</Notice>
            : req.blockedReason
              ? <Notice tone="warn" title="结果未知，当前账号不能重试">{req.blockedReason}原请求和理由继续保留；关掉这个框，在页面上方的提醒里点「查询原结果」。</Notice>
            : <Notice tone="warn" title="结果未知">{unknown && !reopened ? "刚才提交时没收到确定结果，可能已经生效。" : "这是之前提交、结果未知的原操作。"}按原请求重试会原样再发一次（理由和内容都不变），后端认得出是同一次提交，不会重复执行。也可以关掉，在页面上方的提醒里查询原结果。</Notice>}
        </div>
      )}
      {error && <div className="rd-confirm-alert"><Notice tone="danger">{error}</Notice></div>}
      <OperatorBriefBlock kind={req.briefKind} action={req.action} detail={req.detail} hasEdit={!!req.input} stated={req.statedBrief} />
      {req.content}
      {req.input && (
        <div className="field">
          <label htmlFor={`${fieldId}-value`}>{req.input.label}</label>
          <input
              id={`${fieldId}-value`}
              type={req.input.kind ?? "text"}
              min={req.input.min}
              max={req.input.max}
              step={req.input.step}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onBlur={() => setValueLeft(true)}
              aria-invalid={valueProblem && (valueLeft || attempted) ? true : undefined}
              aria-describedby={valueProblem && (valueLeft || attempted) ? `${fieldId}-value-error` : undefined}
              placeholder={req.input.placeholder}
            />
          {valueProblem && (valueLeft || attempted) && <div id={`${fieldId}-value-error`} className="rd-form-error" role="alert">{valueProblem}</div>}
        </div>
      )}
      <div className="field rd-reason-field">
        {/* 字段名强，下限跟在后面，上限在框角的字数里，各写一处（VS-104、VS-105）。 */}
        <label htmlFor={`${fieldId}-reason`}>
          {req.reason ? <>操作理由<span className="rd-form-required" aria-hidden="true">*</span>{!req.recoveryUi && <span className="rd-form-hint">至少 {reasonMin} 字</span>}</> : <>备注<span className="rd-form-hint">{req.remarkHint ?? "选填，最多 200 字"}</span></>}
        </label>
        <div className={`rd-reason-box${req.recoveryUi && pendingReason !== undefined ? " k-reason-locked" : ""}`}>
          <textarea
            id={`${fieldId}-reason`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setReasonLeft(true)}
            rows={2}
            maxLength={req.reason ? reasonMax : 200}
            placeholder={req.reasonPlaceholder ?? (req.reason ? "写清场景和依据，例如：合租办公网络、已知合作账户、客服举报线索" : "可以补充处理依据")}
          />
          {req.reason && <span className="rd-reason-count">{reasonLength}/{reasonMax}</span>}
        </div>
        {req.recoveryUi && pendingReason !== undefined && <p className="k-locked-hint">保存的原理由，重试时原样发送，不能修改</p>}
        {req.reason && !(req.recoveryUi && pendingReason !== undefined) && !reasonOk && (attempted || reasonLeft) ? (
          <div className="rd-form-error">{reasonShort}</div>
        ) : req.recoveryUi && req.reason && pendingReason === undefined && <div className="rd-form-help">{reasonMin}–{reasonMax} 字</div>}
      </div>
      </fieldset>
    </Modal>
  );
}
