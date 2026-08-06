"use client";

/**
 * K6 策略暂停 / 归档确认(2026-08-06 原型对齐 P0)。
 *
 * 🔴 为什么必须有这道弹窗:暂停一条风控策略 = 该策略的判定**立即失效**,与发布同级的高敏动作。
 *   此前这两个动作是一键直调 setStrategyStatus,无确认、无理由、无审计对象——踩项目不变量
 *   「高敏动作必须有确认 + 理由 + 审计」。原型侧一直强制「原因 + 影响说明」各 ≥4 字。
 *
 * 与发布弹窗(publish-confirm)的差异:发布要干跑预估影响,暂停/归档不需要预演(是撤下不是下发),
 * 但要求运营写明**影响说明**——谁来兜住这段判定空窗,是本弹窗的核心价值。
 * 理由落 note 参数 → store 写审计(而非现在的兜底文案「暂停策略 X」)。
 */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useJanusC2Store } from "@/lib/store/admin/janus-c2-store";
import { displayAdminError } from "@/lib/admin/error-messages";
import type { Strategy } from "@/lib/admin/janus-c2/types";

type Mode = "paused" | "archived";

const COPY: Record<Mode, { title: string; verb: string; warn: string; placeholder: string }> = {
  paused: {
    title: "暂停策略",
    verb: "暂停",
    warn: "暂停后该策略立即停止判定,其覆盖的风险场景在恢复前无人看守。",
    placeholder: "为什么要暂停,以及这段空窗由谁/哪条策略兜住(≥4 字)。",
  },
  archived: {
    title: "归档策略",
    verb: "归档",
    warn: "归档后策略退出运行集且不可再发布(记录保留)。",
    placeholder: "为什么要归档,以及是否已有替代策略接管(≥4 字)。",
  },
};

export function StatusChangeConfirm({
  strategy: s,
  mode,
  operatorId,
  onClose,
}: {
  strategy: Strategy;
  mode: Mode;
  operatorId: string;
  onClose: () => void;
}) {
  const setStatus = useJanusC2Store((st) => st.setStrategyStatus);
  const [reason, setReason] = useState("");
  const [impact, setImpact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const copy = COPY[mode];
  const valid = reason.trim().length >= 4 && impact.trim().length >= 4;

  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !submitting) onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose, submitting]);

  const submit = async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      // 原因与影响说明合并成一条 note 落审计:审计里要能独立读懂「为什么停」与「空窗谁兜」。
      await setStatus(s.strategyId, mode, operatorId, `${reason.trim()} · 影响与兜底:${impact.trim()}`);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? displayAdminError(err) : `${copy.verb}失败，请重试`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="k6-modal-overlay" onClick={() => { if (!submitting) onClose(); }}>
      <div className="k6c2 k6-modal k6-modal-sm" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`${copy.title} ${s.name}`}>
        <div className="k6-modal-head">
          <div className="ttl"><span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{copy.title} · {s.name}</span></div>
          <button className="k6-modal-close" onClick={onClose} aria-label="关闭"><X size={18} aria-hidden /></button>
        </div>
        <div className="k6-modal-body">
          <div className="k6-hint" style={{ marginTop: 0, marginBottom: 12, color: "var(--warning)" }}>{copy.warn}</div>
          {error && <div className="k6-hint" style={{ color: "var(--danger)", marginBottom: 10 }}>{copy.verb}失败：{error}</div>}
          <div className="k6-ovr-field" style={{ marginBottom: 12 }}>
            <label htmlFor="k6-status-reason">{copy.verb}原因<i>必填</i></label>
            <textarea id="k6-status-reason" className="k6-field k6-textarea" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={copy.placeholder} />
            {!!reason.length && reason.trim().length < 4 && <div className="k6-hint" style={{ color: "var(--warning)", marginTop: 4 }}>原因至少 4 字。</div>}
          </div>
          <div className="k6-ovr-field" style={{ marginBottom: 0 }}>
            <label htmlFor="k6-status-impact">影响说明<i>必填</i></label>
            <textarea id="k6-status-impact" className="k6-field k6-textarea" rows={2} value={impact} onChange={(e) => setImpact(e.target.value)} placeholder="这段时间内相关风险由什么兜底(其他策略 / 人工巡检 / 已下线场景)。" />
            {!!impact.length && impact.trim().length < 4 && <div className="k6-hint" style={{ color: "var(--warning)", marginTop: 4 }}>影响说明至少 4 字。</div>}
          </div>
        </div>
        <div className="k6-ovr-foot">
          <button className="k6-ovr-cancel" onClick={onClose} disabled={submitting}>取消</button>
          <button className="k6-ovr-confirm" disabled={!valid || submitting} onClick={() => void submit()}>{submitting ? `${copy.verb}中…` : `确认${copy.verb}`}</button>
        </div>
      </div>
    </div>
  );
}
