"use client";

/**
 * K6 策略版本历史 + 回滚(SPEC 4 · PRD §14.4)。
 * 列不可变版本快照(发布 / 回滚生成);回滚走二级确认:版本差异对比 + 必填回滚原因 → 生成新版本 + A2 审计。
 */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useJanusC2Store } from "@/lib/store/admin/janus-c2-store";
import { timeAgo } from "@/lib/mock/admin/janus-c2/scoring";
import { ACTION_TYPE_LABEL } from "@/lib/mock/admin/janus-c2/labels";
import { isRuleGroup, type RuleGroup, type Strategy, type StrategyVersion } from "@/lib/mock/admin/janus-c2/types";

function ruleSummary(g: RuleGroup): string {
  const leaves: string[] = [];
  const walk = (node: RuleGroup["rules"][number]) => {
    if (isRuleGroup(node)) node.rules.forEach(walk);
    else leaves.push(node.label);
  };
  walk(g);
  return leaves.join("、") || "无规则";
}

export function VersionPanel({ strategy: s, operatorId, canRollback, onClose }: { strategy: Strategy; operatorId: string; canRollback: boolean; onClose: () => void }) {
  const rollback = useJanusC2Store((st) => st.rollbackStrategy);
  const [pending, setPending] = useState<StrategyVersion | null>(null);
  const [reason, setReason] = useState("");
  const reasonValid = reason.trim().length >= 4;
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") { if (pending) setPending(null); else onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  return (
    <div className="k6-modal-overlay" onClick={onClose}>
      <div className="k6c2 k6-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={`版本历史 ${s.name}`}>
        <div className="k6-modal-head">
          <div className="ttl">
            <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{pending ? `回滚到 v${pending.version}` : `版本历史 · ${s.name}`}</span>
            <span className="k6-bdg dim">当前 v{s.version}</span>
          </div>
          <button className="k6-modal-close" onClick={onClose} aria-label="关闭"><X size={18} aria-hidden /></button>
        </div>

        {pending ? (
          <>
            <div className="k6-modal-body">
              <div className="k6-hint" style={{ marginTop: 0, marginBottom: 10 }}>回滚将以历史版本规则生成新版本 v{s.version + 1} 并立即生效。请确认变更差异:</div>
              <div className="k6-diff">
                <div className="k6-diff-row">
                  <span className="k6-diff-tag cur">当前 v{s.version}</span>
                  <div className="k6-diff-body">{ruleSummary(s.ruleTree)} → {ACTION_TYPE_LABEL[s.action.type]}</div>
                </div>
                <div className="k6-diff-row">
                  <span className="k6-diff-tag tgt">目标 v{pending.version}</span>
                  <div className="k6-diff-body">{ruleSummary(pending.ruleTree)} → {ACTION_TYPE_LABEL[pending.action.type]}</div>
                </div>
              </div>
              <div className="k6-ovr-field" style={{ marginBottom: 0, marginTop: 14 }}>
                <label htmlFor="rb-reason">回滚原因<i>必填</i></label>
                <textarea id="rb-reason" className="k6-field k6-textarea" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="为何回滚到该版本(≥4 字),写入版本历史与审计。" />
                {!reasonValid && reason.length > 0 && <div className="k6-hint" style={{ color: "var(--warning)", marginTop: 4 }}>回滚原因至少 4 字。</div>}
              </div>
            </div>
            <div className="k6-ovr-foot">
              <button className="k6-ovr-cancel" onClick={() => setPending(null)}>返回</button>
              <button className="k6-ovr-confirm" disabled={!reasonValid} onClick={() => { rollback(s.strategyId, pending.version, operatorId, reason.trim()); onClose(); }}>确认回滚</button>
            </div>
          </>
        ) : (
          <>
            <div className="k6-modal-body">
              {s.versions.length === 0 ? (
                <div className="k6-empty-row">尚无版本快照。策略发布或回滚时生成不可变版本,用于对比与回退。</div>
              ) : (
                <div>
                  {s.versions.map((v) => (
                    <div key={v.version} className="k6-ver-row">
                      <span className="k6-ver-tag">v{v.version}</span>
                      <div className="k6-ver-note">
                        {v.note}
                        <div className="k6-ver-meta">{v.actorId} · {timeAgo(v.createdAt)} · {ruleSummary(v.ruleTree)} → {ACTION_TYPE_LABEL[v.action.type]}</div>
                      </div>
                      {canRollback && v.version !== s.version && (
                        <button className="k6-pgbtn" onClick={() => { setPending(v); setReason(""); }}>回滚到此</button>
                      )}
                      {v.version === s.version && <span className="k6-bdg good">当前</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="k6-ovr-foot">
              <button className="k6-ovr-cancel" onClick={onClose}>关闭</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
