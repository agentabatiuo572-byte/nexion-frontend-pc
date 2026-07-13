"use client";

// K6 client-only；提交由后端完成权限、状态机和乐观锁重验。

/**
 * K6 手动状态修改弹窗(SPEC 2 · PRD §9.2)。
 * 🔴 多字段表单,每值独立字段;枚举值(原因分类/生效时机/过期/远程地址)一律下拉,禁单框多值。
 * 原因必填 ≥8 字;高风险(§15)需单人强确认 checkbox;提交走 store applyOverride → A2 审计。
 */
import { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { REMOTE_URL_KEYS, useJanusC2Store, type OverrideForm } from "@/lib/store/admin/janus-c2-store";
import { EFFECTIVE_TIMING_LABEL, REASON_CATEGORIES, STATUS_LABEL, STATUS_TONE } from "@/lib/admin/janus-c2/labels";
import type { Device, EffectiveTiming } from "@/lib/admin/janus-c2/types";
import type { Transition } from "@/lib/admin/janus-c2/transitions";

const EXPIRE_OPTIONS: [number, string][] = [[1, "1 小时"], [2, "2 小时"], [6, "6 小时"], [24, "24 小时"]];

export function ManualOverrideModal({ device, transition: t, operatorId, onClose }: {
  device: Device; transition: Transition; operatorId: string; onClose: () => void;
}) {
  const apply = useJanusC2Store((s) => s.applyOverride);
  const [reasonCategory, setReasonCategory] = useState("");
  const [reasonText, setReasonText] = useState("");
  const [effectiveTiming, setEffectiveTiming] = useState<EffectiveTiming>("session_edge");
  const [expireHours, setExpireHours] = useState(2);
  const [remoteUrlKey, setRemoteUrlKey] = useState("default");
  const [strong, setStrong] = useState(false);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const reasonOk = reasonText.trim().length >= 8;
  const valid = !!reasonCategory && reasonOk && (!t.needsRemoteUrl || !!remoteUrlKey) && (!t.strong || strong);

  const confirm = async () => {
    if (!valid || pending) return;
    const form: OverrideForm = {
      reasonCategory,
      reasonText: reasonText.trim(),
      effectiveTiming,
      expireAt: t.needsExpire ? Date.now() + expireHours * 3600_000 : undefined,
      remoteUrlKey: t.needsRemoteUrl ? remoteUrlKey : undefined,
      confirmationMode: t.strong ? "strong_single" : "standard",
    };
    setPending(true);
    setSubmitError(null);
    try {
      await apply(device, t, form, operatorId);
      onClose();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "修改失败，请重试");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="k6-modal-overlay" onClick={() => { if (!pending) onClose(); }}>
      <div className="k6c2 k6-modal k6-ovr" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="手动状态修改">
        <div className="k6-modal-head">
          <div className="ttl">
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>手动状态修改</span>
            <span className={`k6-bdg ${STATUS_TONE[t.to]}`}>{STATUS_LABEL[t.to]}</span>
          </div>
          <button className="k6-modal-close" onClick={onClose} aria-label="关闭"><X size={18} aria-hidden /></button>
        </div>

        <div className="k6-modal-body">
          <div className="k6-ovr-brief">
            <div className="k6-ovr-flow">
              <span className={`k6-bdg ${STATUS_TONE[device.status]}`}>{STATUS_LABEL[device.status]}</span>
              <span className="arr" aria-hidden>→</span>
              <span className={`k6-bdg ${STATUS_TONE[t.to]}`}>{STATUS_LABEL[t.to]}</span>
              <code className="sid">{device.sid}</code>
            </div>
            <p>{t.note}</p>
          </div>

          {t.highRisk && (
            <div className="k6-ovr-warn">
              <AlertTriangle size={16} aria-hidden />
              <span>高风险动作 · 单人强确认 · 不可批量 · 完整写入 A2 审计与前后状态快照。</span>
            </div>
          )}

          <div className="k6-ovr-field">
            <label htmlFor="ovr-cat">原因分类<i>必填</i></label>
            <select id="ovr-cat" className="k6-field" value={reasonCategory} onChange={(e) => setReasonCategory(e.target.value)}>
              <option value="">请选择原因分类</option>
              {REASON_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>

          <div className="k6-ovr-field">
            <label htmlFor="ovr-reason">详细原因<i className={reasonOk ? "ok" : ""}>{reasonOk ? "已满足" : "必填 · 至少 8 字"}</i></label>
            <textarea id="ovr-reason" className="k6-field k6-ovr-textarea" value={reasonText} onChange={(e) => setReasonText(e.target.value)}
              placeholder="写清场景与依据,如:已知合作设备 / 客诉线索跟进 / 现场演示需要…" />
          </div>

          <div className="k6-ovr-field">
            <label htmlFor="ovr-timing">生效时机</label>
            <select id="ovr-timing" className="k6-field" value={effectiveTiming} onChange={(e) => setEffectiveTiming(e.target.value as EffectiveTiming)}>
              <option value="session_edge">{EFFECTIVE_TIMING_LABEL.session_edge}(体验更平滑)</option>
              <option value="immediate">{EFFECTIVE_TIMING_LABEL.immediate}</option>
            </select>
          </div>

          {t.needsExpire && (
            <div className="k6-ovr-field">
              <label htmlFor="ovr-expire">挂起过期时间</label>
              <select id="ovr-expire" className="k6-field" value={expireHours} onChange={(e) => setExpireHours(Number(e.target.value))}>
                {EXPIRE_OPTIONS.map(([h, l]) => <option key={h} value={h}>{l}后恢复策略评估</option>)}
              </select>
            </div>
          )}

          {t.needsRemoteUrl && (
            <div className="k6-ovr-field">
              <label htmlFor="ovr-url">远程地址<i>必填</i></label>
              <select id="ovr-url" className="k6-field" value={remoteUrlKey} onChange={(e) => setRemoteUrlKey(e.target.value)}>
                {REMOTE_URL_KEYS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
              </select>
            </div>
          )}

          {t.strong && (
            <label className="k6-ovr-strong">
              <input type="checkbox" checked={strong} onChange={(e) => setStrong(e.target.checked)} />
              <span>我确认这是高风险单人操作,已核对设备身份与处置依据。</span>
            </label>
          )}
        </div>

        <div className="k6-ovr-foot">
          {submitError && <span className="k6-error">{submitError}</span>}
          <button className="k6-ovr-cancel" onClick={onClose}>取消</button>
          <button className="k6-ovr-confirm" disabled={!valid || pending} onClick={() => void confirm()}>{pending ? "提交中…" : "确认修改"}</button>
        </div>
      </div>
    </div>
  );
}
