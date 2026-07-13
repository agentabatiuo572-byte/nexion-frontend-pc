"use client";

// K6 client-only；挂载后从鉴权接口加载业务数据。

/**
 * K6 策略中心(SPEC 3 · PRD §6 / §14)。headline①:策略可增删改 + 状态编辑。
 * 列表展示全部策略(状态/版本/优先级/负责人/动作),支持新建 / 编辑 / 复制 / 发布 / 暂停 / 归档 / 删除。
 * viewer 角色只读;删除走二次确认;所有写动作落 A2 审计(store)。规则编辑器 = SPEC 4 高级模式。
 */
import { useState } from "react";
import { Plus } from "lucide-react";
import { useJanusC2Store } from "@/lib/store/admin/janus-c2-store";
import { blankStrategy } from "@/lib/admin/janus-c2/strategies";
import {
  ACTION_TYPE_LABEL,
  STRATEGY_STATUS_LABEL,
  STRATEGY_STATUS_TONE,
  channelLabel,
} from "@/lib/admin/janus-c2/labels";
import { ROLE_ORDER } from "@/lib/admin/janus-c2/transitions";
import type { Strategy } from "@/lib/admin/janus-c2/types";
import { StrategyEditor } from "./strategy-editor";
import { VersionPanel } from "./version-panel";
import { PublishConfirm } from "./publish-confirm";
import { useK6Operator } from "./use-operator";

function scopeText(s: Strategy): string {
  const ch = s.scope.channels?.length ? `渠道 ${s.scope.channels.map((c) => channelLabel(c)).join("/")}` : "全部渠道";
  const inv = s.scope.inviteCodes?.length ? ` · 邀请码 ${s.scope.inviteCodes.join("/")}` : "";
  return ch + inv;
}
function guardText(s: Strategy): string {
  const g = s.safeguards;
  const parts: string[] = [];
  if (g.maxDailyRecommendations != null) parts.push(`日建议≤${g.maxDailyRecommendations}`);
  if (g.maxDailyHits != null) parts.push(`日命中≤${g.maxDailyHits}`);
  if (g.requireFreshReportMinutes != null) parts.push(`需${g.requireFreshReportMinutes}分内上报`);
  if (g.minDecisionIntervalHours != null) parts.push(`决策间隔≥${g.minDecisionIntervalHours}h`);
  return parts.length ? parts.join(" · ") : "无额外保护";
}

let newSeq = 0;

export function K6StrategyCenter() {
  const strategies = useJanusC2Store((s) => s.strategies);
  const setStatus = useJanusC2Store((s) => s.setStrategyStatus);
  const del = useJanusC2Store((s) => s.deleteStrategy);
  const dup = useJanusC2Store((s) => s.duplicateStrategy);
  const operator = useK6Operator();
  // PRD §15:编辑 / 新建草稿策略需高级运营+;发布策略需管理员。
  const canWrite = ROLE_ORDER[operator.role] >= ROLE_ORDER.senior_operator;
  const canPublish = operator.role === "admin";
  const [editing, setEditing] = useState<{ strategy: Strategy; isNew: boolean } | null>(null);
  const [versioning, setVersioning] = useState<Strategy | null>(null);
  const [publishing, setPublishing] = useState<Strategy | null>(null);
  const [pendingDel, setPendingDel] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const runAction = async (key: string, action: () => Promise<void>) => {
    if (actionPending) return;
    setActionPending(key);
    setActionError(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "操作失败，请重试");
      throw error;
    } finally {
      setActionPending(null);
    }
  };

  const newStrategy = () => {
    const at = Date.now();
    setEditing({ strategy: blankStrategy(`strat_${at.toString(36)}_${(newSeq += 1)}`, operator.id, at), isNew: true });
  };

  return (
    <div className="k6-panel">
      <div className="k6-sec-head">
        <div><div className="k6-kicker">策略中心</div><h3>多策略管理</h3><p>新建、编辑、发布、暂停、归档与删除决策策略;每条策略可独立配置状态、优先级、动作与适用范围。</p></div>
        {canWrite
          ? <button className="k6-ovr-confirm" style={{ minHeight: 36 }} onClick={newStrategy}><Plus size={15} aria-hidden style={{ marginRight: 5 }} />新建策略</button>
          : <span className="k6-bdg dim">只读身份</span>}
      </div>
      <div className="k6-body">
        {actionError && <div className="k6-empty k6-error">操作失败：{actionError}</div>}
        <div className="k6-strat-list">
          {strategies.length === 0 && <div className="k6-empty-row">暂无策略,点「新建策略」从模板或空白创建。</div>}
          {strategies.map((s) => (
            <div key={s.strategyId} className="k6-strat-card">
              <div className="k6-strat-top">
                <div className="k6-strat-name">{s.name || "(未命名)"}<span className="k6-strat-ver">v{s.version}</span></div>
                <span className={`k6-bdg ${STRATEGY_STATUS_TONE[s.status]}`}>{STRATEGY_STATUS_LABEL[s.status]}</span>
                <span className="k6-bdg dim">优先级 {s.priority}</span>
                <span className="k6-bdg cyan">{ACTION_TYPE_LABEL[s.action.type]}</span>
              </div>
              <p className="k6-strat-desc">{s.description || "—"}</p>
              <div className="k6-strat-meta">负责人 {s.owner || "—"} · {scopeText(s)} · {guardText(s)}</div>

              {canWrite && (
                pendingDel === s.strategyId ? (
                  <div className="k6-strat-actions">
                    <span className="k6-strat-confirm">确认删除「{s.name}」?不可恢复。</span>
                    <button className="k6-pgbtn" disabled={actionPending !== null} style={{ color: "var(--danger)", borderColor: "var(--danger)" }} onClick={() => void runAction(`delete:${s.strategyId}`, () => del(s.strategyId, operator.id)).then(() => setPendingDel(null)).catch(() => undefined)}>{actionPending === `delete:${s.strategyId}` ? "删除中…" : "确认删除"}</button>
                    <button className="k6-pgbtn" onClick={() => setPendingDel(null)}>取消</button>
                  </div>
                ) : (
                  <div className="k6-strat-actions">
                    {s.status === "draft" && <button className="k6-pgbtn" onClick={() => setEditing({ strategy: s, isNew: false })}>编辑</button>}
                    <button className="k6-pgbtn" disabled={actionPending !== null} onClick={() => void runAction(`copy:${s.strategyId}`, () => dup(s.strategyId, operator.id)).catch(() => undefined)}>{actionPending === `copy:${s.strategyId}` ? "复制中…" : "复制"}</button>
                    <button className="k6-pgbtn" onClick={() => setVersioning(s)}>版本{s.versions.length ? ` (${s.versions.length})` : ""}</button>
                    {canPublish && (s.status === "draft" || s.status === "paused") && <button className="k6-pgbtn" onClick={() => setPublishing(s)}>发布</button>}
                    {s.status === "active" && <button className="k6-pgbtn" disabled={actionPending !== null} onClick={() => void runAction(`pause:${s.strategyId}`, () => setStatus(s.strategyId, "paused", operator.id)).catch(() => undefined)}>{actionPending === `pause:${s.strategyId}` ? "暂停中…" : "暂停"}</button>}
                    {s.status === "paused" && <button className="k6-pgbtn" disabled={actionPending !== null} onClick={() => void runAction(`archive:${s.strategyId}`, () => setStatus(s.strategyId, "archived", operator.id)).catch(() => undefined)}>{actionPending === `archive:${s.strategyId}` ? "归档中…" : "归档"}</button>}
                    {(s.status === "draft" || s.status === "archived") && <button className="k6-pgbtn" style={{ color: "var(--danger)" }} onClick={() => setPendingDel(s.strategyId)}>删除</button>}
                  </div>
                )
              )}
            </div>
          ))}
        </div>
      </div>

      {editing && <StrategyEditor initial={editing.strategy} isNew={editing.isNew} operatorId={operator.id} onClose={() => setEditing(null)} />}
      {versioning && <VersionPanel strategy={versioning} operatorId={operator.id} canRollback={canPublish} onClose={() => setVersioning(null)} />}
      {publishing && <PublishConfirm strategy={publishing} operatorId={operator.id} onClose={() => setPublishing(null)} />}
    </div>
  );
}
