"use client";

/**
 * 普通确认弹窗 — K 域原语(与 OperationConfirmModal 形成对照,SPEC 三类弹窗之二):
 * 标记类 / 拦截未发放新人礼(预防性阻断) / 手动补触发 / 白名单 —— 不动已入账资产,
 * 强制留痕(业务服务必达审计);reason=true 时原因必填,input 为可选输入框。
 */
import { displayAdminError } from "@/lib/admin/error-messages";
import { fetchA2ReasonPolicy } from "@/lib/admin/a2-client";
import { useEffect, useId, useState } from "react";
import { useRdSurface } from "@/app/components/rd/surface";
import { Modal, Btn, Chip, OperatorBriefBlock, reasonVisibleLength } from "../design-kit";
import type { ConfirmReq } from "./types";

export function KConfirmModal({ req, onClose }: { req: ConfirmReq; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const reasonLength = reasonVisibleLength(reason);
  const reasonOk = !req.reason || (reasonLength >= reasonMin && reasonLength <= reasonMax);
  // chips 模式:所选项即非空,用精确判空(防空串 option 误配后按钮静默禁用);文本模式:仍要求 trim 后非空(拒纯空白)。
  const inputOk = !req.input || req.input.required === false || (req.input.options ? value !== "" : value.trim().length >= 1);
  const can = reasonOk && inputOk;
  return (
    <Modal
      title={req.action}
      icon="check"
      className={surface ? "rd-confirm" : undefined}
      onClose={() => { if (!submitting) onClose(); }}
      footer={
        <>
          <Btn disabled={submitting} onClick={onClose}>取消</Btn>
          <Btn
            variant="primary"
            disabled={!can || submitting}
            style={!can ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
            onClick={async () => {
              if (!can || submitting) return;
              setSubmitting(true);
              setError(null);
              try {
                const succeeded = await req.run(reason.trim(), req.input ? value.trim() : undefined);
                if (succeeded !== false) onClose();
              } catch (cause) {
                const handled = typeof req.errorHandled === "function" ? req.errorHandled(cause) : req.errorHandled;
                if (!handled) setError(displayAdminError(cause));
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting ? "提交中…" : (req.okLabel ?? "确认")}
          </Btn>
        </>
      }
    >
      {/* 提交中锁住框里全部输入和选项，失败后恢复（OP-33）。display: contents 不影响排版。 */}
      <fieldset disabled={submitting} style={{ display: "contents" }}>
      {surface && req.effect && <div className="rd-effect">{req.effect}</div>}
      {error && <div role="alert" className="tint danger">{error}</div>}
      <OperatorBriefBlock action={req.action} detail={req.detail} hasEdit={!!req.input} stated={req.statedBrief} />
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
        <textarea
          id={`${fieldId}-reason`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          maxLength={req.reason ? reasonMax : 200}
          placeholder={req.reasonPlaceholder ?? (req.reason ? "写清场景和依据，例如：合租办公网络、已知合作账户、客服举报线索" : "可以补充处理依据")}
          style={surface ? undefined : {
            width: "100%", background: "var(--surface-2)", border: "1px solid var(--border-strong)", borderRadius: 8,
            padding: "8px 12px", color: "var(--ink)", fontSize: 12.5, outline: "none", resize: "vertical", fontFamily: "inherit",
          }}
        />
        {req.reason && (
          <div className="tiny" style={{ marginTop: 7, color: reasonOk ? "var(--ink-3)" : "var(--warning)" }}>
            {reasonLength < reasonMin ? `还差 ${reasonMin - reasonLength} 字` : `已填写 ${reasonLength}/${reasonMax} 字`}
          </div>
        )}
      </div>
      </fieldset>
    </Modal>
  );
}
