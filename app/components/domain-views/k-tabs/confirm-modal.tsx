"use client";

/**
 * 普通确认弹窗 — K 域原语(与 OperationConfirmModal 形成对照,SPEC 三类弹窗之二):
 * 标记类 / 拦截未发放新人礼(预防性阻断) / 手动补触发 / 白名单 —— 不动已入账资产,
 * 强制留痕(写 setParam → A2 审计);reason=true 时原因必填,input 为可选输入框。
 */
import { useState } from "react";
import { Modal, Btn, OperatorBriefBlock } from "../design-kit";
import type { ConfirmReq } from "./types";

export function KConfirmModal({ req, onClose }: { req: ConfirmReq; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [value, setValue] = useState("");
  const reasonMin = 8;
  const reasonOk = !req.reason || reason.trim().length >= reasonMin;
  const inputOk = !req.input || value.trim().length >= 1;
  const can = reasonOk && inputOk;
  return (
    <Modal
      title={req.action}
      icon="check"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>取消</Btn>
          <Btn
            variant="primary"
            disabled={!can}
            style={!can ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
            onClick={() => { if (!can) return; req.run(reason.trim(), req.input ? value.trim() : undefined); onClose(); }}
          >
            {req.okLabel ?? "确认"}
          </Btn>
        </>
      }
    >
      <OperatorBriefBlock action={req.action} detail={req.detail} hasEdit={!!req.input} />
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
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 6 }}>{req.input.label}</div>
          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={req.input.placeholder}
            style={{
              width: "100%", background: "var(--surface-2)", border: "1px solid var(--border-strong)", borderRadius: 8,
              padding: "8px 12px", color: "var(--ink)", fontFamily: "var(--mono)", fontSize: 13, outline: "none",
            }}
          />
        </div>
      )}
      <div style={{ marginTop: 13 }}>
        <div style={{ fontSize: 12, color: "var(--ink-3)", marginBottom: 6 }}>
          {req.reason ? "操作理由(必填 · 8 字以上 · 写入 A2 审计)" : "备注(可选 · 写入 A2 审计)"}
        </div>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          placeholder={req.reason ? "写清场景与依据,如:合租办公网 / 已知合作账户 / 客服举报线索…" : "可补充处置依据"}
          style={{
            width: "100%", background: "var(--surface-2)", border: "1px solid var(--border-strong)", borderRadius: 8,
            padding: "8px 12px", color: "var(--ink)", fontSize: 12.5, outline: "none", resize: "vertical", fontFamily: "inherit",
          }}
        />
      </div>
    </Modal>
  );
}
