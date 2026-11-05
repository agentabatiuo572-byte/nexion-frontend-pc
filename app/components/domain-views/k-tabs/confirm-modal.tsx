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
import { Button as RdButton } from "@/app/components/rd/button";
import { useRdSurface } from "@/app/components/rd/surface";
import { visibleReasonLength } from "@/lib/admin/a2-client";
import { Modal, Btn, Chip, OperatorBriefBlock } from "../design-kit";
import type { ConfirmReq } from "./types";

export function KConfirmModal({ req, onClose }: { req: ConfirmReq; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 刚打开不报错：字数不够等失焦或点过提交才用警告色（DP-06）。
  const [attempted, setAttempted] = useState(false);
  const [reasonLeft, setReasonLeft] = useState(false);
  const fieldId = useId();
  // 改版页面里和 OperationConfirmModal 同一个样子；旧页面不变。
  const surface = useRdSurface();
  // 理由规则读得到就按它，读不到按默认 8–200 继续，紧急关停不能被规则服务挡住（Q-06）。
  const [policy, setPolicy] = useState<{ minChars: number; maxChars: number } | null>(null);
  useEffect(() => {
    if (!req.reason) return;
    let active = true;
    void fetchA2ReasonPolicy().then((next) => { if (active) setPolicy(next); }, () => { if (active) setPolicy(null); });
    return () => { active = false; };
  }, [req.reason]);
  const reasonMin = policy?.minChars ?? 8;
  const reasonMax = policy?.maxChars ?? 200;
  const reasonLength = visibleReasonLength(reason);
  const reasonOk = !req.reason || (reasonLength >= reasonMin && reasonLength <= reasonMax);
  // chips 模式:所选项即非空,用精确判空(防空串 option 误配后按钮静默禁用);文本模式:仍要求 trim 后非空(拒纯空白)。
  const inputOk = !req.input || req.input.required === false || (req.input.options ? value !== "" : value.trim().length >= 1);
  const can = reasonOk && inputOk;
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
      if (!handled) setError(displayAdminError(cause));
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <Modal
      title={req.action}
      icon={req.confirmTone === "danger" ? "alert" : "check"}
      className={surface ? "rd-confirm" : undefined}
      busy={submitting}
      dirty={value !== ""}
      onClose={() => { if (!submitting) onClose(); }}
      footer={
        <>
          <Btn disabled={submitting} onClick={onClose}>取消</Btn>
          {surface ? (
            <RdButton
              variant={req.confirmTone ?? "primary"}
              loading={submitting}
              loadingText="提交中…"
              disabledReason={can || submitting ? undefined : [!inputOk && `填写${req.input?.label}`, !reasonOk && (reasonLength < reasonMin ? `操作理由${reasonShort}` : `操作理由不能超过 ${reasonMax} 字`)].filter(Boolean).join("；")}
              onBlockedClick={() => setAttempted(true)}
              onClick={() => void submit()}
            >
              {req.okLabel ?? "确认"}
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
      <fieldset disabled={submitting} style={{ display: "contents" }}>
      {surface && req.effect && <div className="rd-effect">{req.effect}</div>}
      {error && <div role="alert" className="tint danger">{error}</div>}
      <OperatorBriefBlock kind={req.briefKind} action={req.action} detail={req.detail} hasEdit={!!req.input} stated={req.statedBrief} />
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
        <div style={{ marginTop: 13 }}>
          <label htmlFor={`${fieldId}-value`} style={{ display: "block", fontSize: 12, color: "var(--ink-3)", marginBottom: 6 }}>{req.input.label}</label>
          {req.input.options && req.input.options.length > 0 ? (
            // 枚举值:勾选 chips 不让手输(能勾选的不要手输铁律);value=所选项,inputOk 同文本框(选中即非空、确认按钮才启用)。
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {req.input.options.map((o) => (
                <Chip key={o} tab sel={value === o} onClick={() => setValue(o)}>{o}</Chip>
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
              placeholder={req.input.placeholder}
              style={{
                width: "100%", background: "var(--surface-2)", border: "1px solid var(--border-strong)", borderRadius: 8,
                padding: "8px 12px", color: "var(--ink)", fontFamily: "var(--mono)", fontSize: 13, outline: "none",
              }}
            />
          )}
        </div>
      )}
      <div className={surface ? "field" : undefined} style={surface ? undefined : { marginTop: 13 }}>
        <label htmlFor={`${fieldId}-reason`} style={surface ? undefined : { display: "block", fontSize: 12, color: "var(--ink-3)", marginBottom: 6 }}>
          {req.reason ? `操作理由（必填，${reasonMin}–${reasonMax} 字）` : "备注（可选，最多 200 字）"}
        </label>
        <div className={surface ? "rd-reason-box" : undefined}>
          <textarea
            id={`${fieldId}-reason`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setReasonLeft(true)}
            rows={2}
            maxLength={req.reason ? reasonMax : 200}
            placeholder={req.reasonPlaceholder ?? (req.reason ? "写清场景和依据，例如：合租办公网络、已知合作账户、客服举报线索" : "可以补充处理依据")}
            style={surface ? undefined : {
              width: "100%", background: "var(--surface-2)", border: "1px solid var(--border-strong)", borderRadius: 8,
              padding: "8px 12px", color: "var(--ink)", fontSize: 12.5, outline: "none", resize: "vertical", fontFamily: "inherit",
            }}
          />
          {surface && req.reason && <span className="rd-reason-count">{reasonLength}/{reasonMax}</span>}
        </div>
        {req.reason && (surface ? !reasonOk && (attempted || reasonLeft) : true) && (
          <div className="tiny" style={{ marginTop: 7, color: reasonOk ? "var(--ink-3)" : "var(--warning)" }}>{reasonShort}</div>
        )}
      </div>
      </fieldset>
    </Modal>
  );
}
