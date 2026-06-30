"use client";

/**
 * K6 策略发布确认(SPEC 4 · PRD §14.3)。
 * 发布前强制:① 干跑预估影响(命中/命中率/冲突/动作) ② 必填发布说明 → 写入版本快照 + A2 审计。
 * 发布(草稿/暂停 → 生效)是 §15 高风险动作,仅管理员可达(调用方已门控)。
 */
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { effectiveDevices, useJanusC2Store } from "@/lib/store/admin/janus-c2-store";
import { dryRunStrategy } from "@/lib/mock/admin/janus-c2/evaluate";
import { ACTION_TYPE_LABEL } from "@/lib/mock/admin/janus-c2/labels";
import type { Strategy } from "@/lib/mock/admin/janus-c2/types";

export function PublishConfirm({ strategy: s, operatorId, onClose }: { strategy: Strategy; operatorId: string; onClose: () => void }) {
  const setStatus = useJanusC2Store((st) => st.setStrategyStatus);
  const overrides = useJanusC2Store((st) => st.overrides);
  const allStrategies = useJanusC2Store((st) => st.strategies);
  const dry = useMemo(() => dryRunStrategy(s, effectiveDevices(overrides), allStrategies), [s, overrides, allStrategies]);
  const [note, setNote] = useState("");
  const valid = note.trim().length >= 4;
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);

  return (
    <div className="k6-modal-overlay" onClick={onClose}>
      <div className="k6c2 k6-modal k6-modal-sm" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`发布策略 ${s.name}`}>
        <div className="k6-modal-head">
          <div className="ttl"><span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>发布策略 · {s.name}</span></div>
          <button className="k6-modal-close" onClick={onClose} aria-label="关闭"><X size={18} aria-hidden /></button>
        </div>
        <div className="k6-modal-body">
          <div className="k6-hint" style={{ marginTop: 0, marginBottom: 10 }}>发布后立即生效,生成不可变版本 v{s.version + 1}。以下为对当前有效设备集的干跑预估影响:</div>
          <div className="k6-dryrun-grid" style={{ marginBottom: 14 }}>
            <div className="k6-dryrun-cell hit"><div className="v">{dry.hit}</div><div className="k">预计命中</div></div>
            <div className="k6-dryrun-cell"><div className="v">{dry.hitRate}%</div><div className="k">命中率</div></div>
            <div className="k6-dryrun-cell"><div className="v">{dry.conflicts}</div><div className="k">策略冲突</div></div>
            <div className="k6-dryrun-cell"><div className="v" style={{ fontSize: 13 }}>{ACTION_TYPE_LABEL[s.action.type]}</div><div className="k">下发动作</div></div>
          </div>
          <div className="k6-ovr-field" style={{ marginBottom: 0 }}>
            <label htmlFor="pub-note">发布说明<i>必填</i></label>
            <textarea id="pub-note" className="k6-field k6-textarea" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="本次发布的变更要点与目的(≥4 字),写入版本历史与审计。" />
            {!valid && note.length > 0 && <div className="k6-hint" style={{ color: "var(--warning)", marginTop: 4 }}>发布说明至少 4 字。</div>}
          </div>
        </div>
        <div className="k6-ovr-foot">
          <button className="k6-ovr-cancel" onClick={onClose}>取消</button>
          <button className="k6-ovr-confirm" disabled={!valid} onClick={() => { setStatus(s.strategyId, "active", operatorId, note.trim()); onClose(); }}>确认发布</button>
        </div>
      </div>
    </div>
  );
}
