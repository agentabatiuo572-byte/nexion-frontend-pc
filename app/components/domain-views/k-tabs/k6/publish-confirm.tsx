"use client";

/**
 * K6 策略发布确认(SPEC 4 · PRD §14.3)。
 * 发布前强制:① 干跑预估影响(命中/命中率/冲突/动作) ② 必填发布说明 → 写入版本快照 + A2 审计。
 * 发布(草稿/暂停 → 生效)是 §15 高风险动作,仅管理员可达(调用方已门控)。
 */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useJanusC2Store } from "@/lib/store/admin/janus-c2-store";
import { runK6DryRun, type DryRun } from "@/lib/admin/k6-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { ACTION_TYPE_LABEL } from "@/lib/admin/janus-c2/labels";
import type { Strategy } from "@/lib/admin/janus-c2/types";

export function PublishConfirm({ strategy: s, operatorId, onClose }: { strategy: Strategy; operatorId: string; onClose: () => void }) {
  const setStatus = useJanusC2Store((st) => st.setStrategyStatus);
  const [dry, setDry] = useState<DryRun | null>(null);
  const [dryError, setDryError] = useState("");
  const [note, setNote] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState("");
  const valid = note.trim().length >= 4;
  useEffect(() => {
    let cancelled = false;
    setDry(null);
    setDryError("");
    runK6DryRun(s.strategyId, s.lockVersion ?? 0, `发布前真实预演 ${s.name}`)
      .then((result) => { if (!cancelled) setDry(result); })
      .catch((error: unknown) => { if (!cancelled) setDryError(error instanceof Error ? displayAdminError(error) : "预演失败"); });
    return () => { cancelled = true; };
  }, [s.lockVersion, s.name, s.strategyId]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  const publish = async () => {
    if (!valid || !dry || publishing) return;
    setPublishing(true);
    setPublishError("");
    try {
      await setStatus(s.strategyId, "active", operatorId, note.trim(), dry);
      onClose();
    } catch (error) {
      setPublishError(error instanceof Error ? displayAdminError(error) : "发布失败，请重试");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="k6-modal-overlay" onClick={() => { if (!publishing) onClose(); }}>
      <div className="k6c2 k6-modal k6-modal-sm" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`发布策略 ${s.name}`}>
        <div className="k6-modal-head">
          <div className="ttl"><span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>发布策略 · {s.name}</span></div>
          <button className="k6-modal-close" onClick={onClose} aria-label="关闭"><X size={18} aria-hidden /></button>
        </div>
        <div className="k6-modal-body">
          <div className="k6-hint" style={{ marginTop: 0, marginBottom: 10 }}>发布后立即生效,生成不可变版本 v{s.version + 1}。以下为对当前有效设备集的干跑预估影响:</div>
          <div className="k6-dryrun-grid" style={{ marginBottom: 14 }}>
            <div className="k6-dryrun-cell hit"><div className="v">{dry?.hit ?? "…"}</div><div className="k">预计命中</div></div>
            <div className="k6-dryrun-cell"><div className="v">{dry ? `${dry.hitRate}%` : "…"}</div><div className="k">命中率</div></div>
            <div className="k6-dryrun-cell"><div className="v">{dry?.conflicts ?? "…"}</div><div className="k">策略冲突</div></div>
            <div className="k6-dryrun-cell"><div className="v" style={{ fontSize: 13 }}>{ACTION_TYPE_LABEL[s.action.type]}</div><div className="k">下发动作</div></div>
          </div>
          {dryError && <div className="k6-hint" style={{ color: "var(--danger)", marginBottom: 10 }}>后端真实预演失败：{dryError}</div>}
          {publishError && <div className="k6-hint" style={{ color: "var(--danger)", marginBottom: 10 }}>发布失败：{publishError}</div>}
          <div className="k6-ovr-field" style={{ marginBottom: 0 }}>
            <label htmlFor="pub-note">发布说明<i>必填</i></label>
            <textarea id="pub-note" className="k6-field k6-textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="本次发布的变更要点与目的(≥4 字),写入版本历史与审计。" />
            {!valid && note.length > 0 && <div className="k6-hint" style={{ color: "var(--warning)", marginTop: 4 }}>发布说明至少 4 字。</div>}
          </div>
        </div>
        <div className="k6-ovr-foot">
          <button className="k6-ovr-cancel" onClick={onClose}>取消</button>
          <button className="k6-ovr-confirm" disabled={!valid || !dry || publishing} onClick={() => void publish()}>{publishing ? "发布中…" : "确认发布"}</button>
        </div>
      </div>
    </div>
  );
}
