"use client";

/**
 * 视图参数弹窗 — L 域普通确认批原语(与 OperationConfirmModal 形成对照):
 * 仅调整看板呈现参数(黄灯偏移 / 承接率告警线),实时生效、不落 操作确认、不写业务口径。
 * 数字输入 + 范围校验;会话级生效(不持久,刷新回默认 —— 视图参数语义)。
 */
import { useState } from "react";
import { Modal, Btn, Icon } from "../design-kit";

export type ViewParamReq = {
  title: string;
  detail: string;
  current: number;
  unit: string;
  min: number;
  max: number;
  onApply: (n: number) => void;
};

export function ViewParamModal({ req, onClose }: { req: ViewParamReq; onClose: () => void }) {
  const [val, setVal] = useState("");
  const n = parseFloat(val);
  const valid = !isNaN(n) && n >= req.min && n <= req.max;
  return (
    <Modal
      title={req.title}
      icon="filter"
      onClose={onClose}
      footer={<>
        <Btn onClick={onClose}>取消</Btn>
        <Btn variant="primary" disabled={!valid} onClick={() => { if (valid) { req.onApply(n); onClose(); } }}>
          <Icon name="check" size={15} /> 应用 · 实时生效
        </Btn>
      </>}
    >
      <div className="tint brand" style={{ marginBottom: 14, border: 0 }}>
        <div style={{ fontWeight: 600, marginBottom: 10, color: "var(--ink)" }}>执行摘要</div>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "grid", gridTemplateColumns: "72px 1fr", gap: 10 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--brand)" }}>要做什么</span>
            <span className="tiny" style={{ color: "var(--ink-2)", lineHeight: 1.65 }}>调整「{req.title}」在当前看板里的显示方式。</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "72px 1fr", gap: 10 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--brand)" }}>影响</span>
            <span className="tiny" style={{ color: "var(--ink-2)", lineHeight: 1.65 }}>只影响你当前看到的图表阈值,不改业务规则、不改报表口径,刷新后回到默认值。</span>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "72px 1fr", gap: 10 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--brand)" }}>提交前</span>
            <span className="tiny" style={{ color: "var(--ink-2)", lineHeight: 1.65 }}>输入 {req.min}–{req.max}{req.unit} 之间的数字。若要改真实业务口径,请回到对应权威模块。</span>
          </div>
        </div>
        <details style={{ marginTop: 12 }}>
          <summary className="tiny" style={{ cursor: "pointer", color: "var(--ink-3)" }}>查看业务规则详情</summary>
          <div className="muted tiny" style={{ marginTop: 8, lineHeight: 1.7 }}>{req.detail}</div>
        </details>
      </div>
      <div className="tint tiny" style={{ marginBottom: 14, border: 0 }}>
        <b>仅视图参数</b> · 实时生效 · 不走高敏操作确认,不改任何业务口径。
      </div>
      <div className="field">
        <label>新值 *(当前 {req.current}{req.unit} · 范围 {req.min}–{req.max}{req.unit})</label>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <input className="fld" type="number" min={req.min} max={req.max} value={val} placeholder={String(req.current)}
            onChange={(e) => setVal(e.target.value)} style={{ maxWidth: 200 }} />
          <span className="muted tiny">{req.unit}</span>
        </div>
      </div>
    </Modal>
  );
}
