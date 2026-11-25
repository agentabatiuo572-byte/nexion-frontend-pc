"use client";

/**
 * 普通确认弹窗 — K 域原语(与 OperationConfirmModal 形成对照,SPEC 三类弹窗之二):
 * 标记类 / 拦截未发放新人礼(预防性阻断) / 手动补触发 / 白名单 —— 不动已入账资产,
 * 强制留痕(业务服务必达审计);reason=true 时原因必填,input 为可选输入框。
 */
import { displayAdminError, displayAdminReadError } from "@/lib/admin/error-messages";
import { ConfirmReadConflict, PendingConfirmRejected } from "@/lib/admin/h-conflict-review";
import { announcePermissionDenied, isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { fetchA2ReasonPolicy, visibleReasonLength, type A2ReasonPolicy } from "@/lib/admin/a2-client";
import { useEffect, useId, useState } from "react";
import { Notice } from "@/app/components/rd/block-state";
import { Button as RdButton } from "@/app/components/rd/button";
import { useRdSurface } from "@/app/components/rd/surface";
import { Modal, Btn, Chip, OperatorBriefBlock, usePendingConfirmRecovery } from "../design-kit";
import type { ConfirmReq } from "./types";

const POLICY_LOADING = "正在加载，稍候即可提交。";
const POLICY_FAILED = "理由规则加载失败，暂时无法提交。请关闭弹窗后重试。";

export function KConfirmModal({ req, onClose }: { req: ConfirmReq; onClose: () => void }) {
  const [pendingReason, setPendingReason] = useState(() => req.freezePendingInput ? req.getPendingReason?.() : undefined);
  const pendingRecovery = usePendingConfirmRecovery(pendingReason, req.getPendingRecovery);
  const [draftReason, setReason] = useState(pendingReason ?? req.initialReason ?? "");
  const reason = pendingReason ?? draftReason;
  const [value, setValue] = useState(() => (req.freezePendingInput ? req.getPendingValue?.() : undefined) ?? req.initialInputValue ?? "");
  const [submitting, setSubmitting] = useState(false);
  const rejection = req.initialRejection;
  const [error, setError] = useState(() => rejection && !(rejection instanceof ConfirmReadConflict && rejection.review) ? displayAdminError(rejection) : null);
  const shownError = req.initialError ?? error;
  const [readConflict, setReadConflict] = useState<ConfirmReadConflict | null>(() => rejection instanceof ConfirmReadConflict ? rejection : null);
  const [readingConflict, setReadingConflict] = useState(false);
  // 对象状态变了或已不在：框里只留橙黄提示和「取消」（VS-107），不再画过期的改动和理由框。
  const finalConflict = !!readConflict && !readConflict.review && readConflict.final;
  // 刚打开不报错：字数不够等失焦或点过提交才用警告色（DP-06）。
  const [attempted, setAttempted] = useState(false);
  const [reasonLeft, setReasonLeft] = useState(false);
  const [valueLeft, setValueLeft] = useState(false);
  const fieldId = useId();
  // 改版页面里和 OperationConfirmModal 使用同一套样式。
  const surface = useRdSurface();
  const [policy, setPolicy] = useState<A2ReasonPolicy | "loading" | "failed">("loading");
  useEffect(() => {
    setPolicy("loading");
    if (!req.reason) return;
    let active = true;
    void fetchA2ReasonPolicy().then(
      next => { if (active) setPolicy(next); },
      () => { if (active) setPolicy("failed"); },
    );
    return () => { active = false; };
  }, [req.reason]);
  const loadedPolicy = typeof policy === "object" ? policy : undefined;
  const policyReady = !!loadedPolicy || policy === "failed" && !!req.reasonPolicyOptional;
  const replaying = !!req.replayPendingInput && pendingReason !== undefined;
  const policyMessage = req.reason && !replaying && !policyReady ? policy === "failed" ? POLICY_FAILED : POLICY_LOADING : undefined;
  const reasonMin = Math.max(8, req.reasonMin ?? 8, loadedPolicy?.minChars ?? 8);
  const reasonMax = Math.min(200, loadedPolicy?.maxChars ?? 200);
  const reasonLength = visibleReasonLength(reason);
  const reasonOk = !req.reason || (reasonLength >= reasonMin && reasonLength <= reasonMax);
  // chips 模式:所选项即非空,用精确判空(防空串 option 误配后按钮静默禁用);文本模式:仍要求 trim 后非空(拒纯空白)。
  const inputOk = !req.input || req.input.required === false || (req.input.options ? value !== "" : value.trim().length >= 1);
  const valueProblem = req.input?.validate?.(value);
  const pendingBlockReason = readConflict ? readConflict.review ? "请先读取最新" : displayAdminReadError(readConflict)
    : pendingRecovery?.blockedReason ?? (req.freezePendingInput ? req.getPendingBlockReason?.() : undefined);
  const can = !pendingBlockReason && (replaying || !policyMessage && reasonOk && inputOk && !valueProblem);
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
      if (cause instanceof ConfirmReadConflict) {
        if (!cause.review?.preserveReason) setReason("");
        setReadConflict(cause);
        if (!cause.review) setError(displayAdminReadError(cause));
        return;
      }
      const handled = typeof req.errorHandled === "function" ? req.errorHandled(cause) : req.errorHandled;
      if (!handled) setError(displayAdminError(cause));
    } finally {
      if (req.freezePendingInput) {
        const retained = req.getPendingReason?.();
        setPendingReason(retained);
        if (pendingReason !== undefined && retained === undefined) onClose();
      }
      setSubmitting(false);
    }
  };
  const readLatestConflict = async () => {
    if (!readConflict?.review || readingConflict) return;
    setReadingConflict(true);
    setError(null);
    try { if (await readConflict.review.readLatest()) setReadConflict(null); }
    catch (cause) {
      if (isPermissionDenied(cause)) { announcePermissionDenied(); onClose(); }
      else {
        if (cause instanceof ConfirmReadConflict) {
          if (!cause.review?.preserveReason) setReason("");
          setReadConflict(cause);
          if (cause.review) return;
        }
        setError(displayAdminReadError(cause));
      }
    }
    finally { setReadingConflict(false); }
  };
  const queryPending = async () => {
    if (!pendingRecovery?.query || submitting || readingConflict) return;
    setReadingConflict(true);
    setError(null);
    try { await pendingRecovery.query(); }
    catch (cause) {
      if (cause instanceof ConfirmReadConflict) {
        setReason(""); setReadConflict(cause);
        if (!cause.review) setError(displayAdminError(cause));
      } else if (cause instanceof PendingConfirmRejected) {
        setReason(""); setError(displayAdminError(cause));
      } else if (isPermissionDenied(cause)) { announcePermissionDenied(); onClose(); }
      else setError(displayAdminReadError(cause));
    }
    finally { setPendingReason(req.getPendingReason?.()); setReadingConflict(false); }
  };
  return (
    <Modal
      title={req.title ?? req.action}
      icon={req.confirmTone === "danger" ? "alert" : surface ? "shield" : "check"}
      tone={req.confirmTone === "danger" ? "danger" : "neutral"}
      // 终态只剩提示和「取消」，不再挂原来的生效标签。
      sub={finalConflict ? undefined : req.effect}
      className={surface ? "rd-confirm" : undefined}
      busy={submitting || readingConflict}
      dirty={value !== ""}
      onClose={() => { if (!submitting && !readingConflict) onClose(); }}
      footer={
        <>
          <Btn disabled={submitting || readingConflict} onClick={onClose}>取消</Btn>
          {pendingRecovery?.query && <Btn disabled={submitting || readingConflict} onClick={() => void queryPending()}>查询原操作</Btn>}
          {finalConflict ? null : surface ? (
            <RdButton
              variant={req.confirmTone ?? "primary"}
              loading={submitting || readingConflict}
              loadingText={readingConflict ? "正在读取…" : "提交中…"}
              disabledReason={can || submitting || readingConflict ? undefined : pendingBlockReason ?? policyMessage ?? [!inputOk ? `填写${req.input?.label}` : valueProblem, !reasonOk && (reasonLength < reasonMin ? `操作理由${reasonShort}` : `操作理由不能超过 ${reasonMax} 字`)].filter(Boolean).join("；")}
              onBlockedClick={() => setAttempted(true)}
              onClick={() => void submit()}
            >
              {pendingRecovery ? "按原操作重试" : req.okLabel ?? "确认"}
            </RdButton>
          ) : (
            <Btn
              variant={req.confirmTone ?? "primary"}
              disabled={!can || submitting}
              style={!can ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
              onClick={() => void submit()}
            >
              {submitting ? "提交中…" : (req.okLabel ?? "确认")}
            </Btn>
          )}
        </>
      }
    >
      {/* 提交中锁住框里全部输入和选项，失败后恢复（OP-33）。display: contents 不影响排版。 */}
      {readConflict?.review && <div className="rd-confirm-alert">{readConflict.review.renderNotice(() => void readLatestConflict())}</div>}
      {finalConflict ? <div className="rd-confirm-alert" role="alert"><Notice tone="warn">{shownError}</Notice></div> : <fieldset disabled={submitting || !!readConflict || pendingReason !== undefined} className="rd-contents">
      {shownError && (surface
        ? <div className="rd-confirm-alert"><Notice tone="danger">{shownError}</Notice></div>
        : <div role="alert" className="tint danger">{shownError}</div>)}
      {policyMessage === POLICY_FAILED && (surface
        ? <div className="rd-confirm-alert" role="alert"><Notice tone="warn">{policyMessage}</Notice></div>
        : <div role="alert" className="tint danger">{policyMessage}</div>)}
      <OperatorBriefBlock kind={req.briefKind} action={req.action} detail={req.detail} hasEdit={!!req.input} stated={req.statedBrief} />
      {req.content}
      {req.chips && req.chips.length > 0 && (
        <div style={{ display: "flex", gap: 7, flexWrap: "wrap", marginTop: 12 }}>
          {req.chips.map(([t, tone]) => (
            <span
              key={t}
              style={{
                fontFamily: "var(--mono)", fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 5,
                background: tone === "done" ? "var(--success-soft)" : "var(--surface-3)",
                color: tone === "done" ? "var(--success)" : "var(--ink-3)",
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
      {req.input && (
        <div className={surface ? "field" : "k-confirm-field"}>
          <label htmlFor={`${fieldId}-value`} className={surface ? undefined : "k-confirm-label"}>{req.input.label}</label>
          {req.input.options && req.input.options.length > 0 ? (
            // 枚举值:勾选 chips 不让手输(能勾选的不要手输铁律);value=所选项,inputOk 同文本框(选中即非空、确认按钮才启用)。
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {req.input.options.map((o) => (
                <Chip key={o} tab sel={value === o} onClick={() => setValue(o)}>{req.input?.optionLabels?.[o] ?? o}</Chip>
              ))}
            </div>
          ) : (
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
              className={surface ? undefined : "k-confirm-input"}
            />
          )}
          {valueProblem && (valueLeft || attempted) && <div id={`${fieldId}-value-error`} className="rd-form-error" role="alert">{valueProblem}</div>}
        </div>
      )}
      <div className={surface ? "field rd-reason-field" : "k-confirm-field"}>
        {surface ? (
          // 字段名强，下限跟在后面，上限在框角的字数里，各写一处（VS-104、VS-105）。
          <label htmlFor={`${fieldId}-reason`}>
            {req.reason ? <>操作理由<span className="rd-form-required" aria-hidden="true">*</span>{(policyReady || policyMessage === POLICY_LOADING) && <span className="rd-form-hint">{policyReady ? `至少 ${reasonMin} 字` : policyMessage}</span>}</> : <>备注<span className="rd-form-hint">{req.remarkHint ?? "选填，最多 200 字"}</span></>}
          </label>
        ) : (
          <label htmlFor={`${fieldId}-reason`} style={{ display: "block", fontSize: 12, color: "var(--ink-3)", marginBottom: 6 }}>
            {req.reason ? <>操作理由<span className="rd-form-required" aria-hidden="true">*</span>{policyReady ? ` 至少 ${reasonMin} 字` : policyMessage === POLICY_LOADING ? policyMessage : null}</> : "备注（可选，最多 200 字）"}
          </label>
        )}
        <div className={surface ? "rd-reason-box" : undefined}>
          <textarea
            id={`${fieldId}-reason`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setReasonLeft(true)}
            rows={2}
            aria-required={req.reason || undefined}
            maxLength={req.reason ? reasonMax : 200}
            placeholder={req.reasonPlaceholder ?? (req.reason ? "写清场景和依据，例如：合租办公网络、已知合作账户、客服举报线索" : "可以补充处理依据")}
            className={surface ? undefined : "k-confirm-textarea"}
          />
          {surface && req.reason && policyReady && <span className="rd-reason-count">{reasonLength}/{reasonMax}</span>}
        </div>
        {req.reason && policyReady && (surface ? !reasonOk && (attempted || reasonLeft) : true) && (
          <div className={surface ? "rd-form-error" : "tiny k-confirm-count"} data-ok={reasonOk ? "" : undefined}>{reasonShort}</div>
        )}
      </div>
      </fieldset>}
    </Modal>
  );
}
