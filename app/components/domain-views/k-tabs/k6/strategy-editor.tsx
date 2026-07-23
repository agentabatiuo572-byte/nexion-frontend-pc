"use client";

/**
 * K6 策略编辑器(SPEC 3 · PRD §6 / §14)。
 * 多字段表单:模板 / 名称 / 说明 / 负责人 / 优先级 / 命中动作 / 远程地址 / 适用范围 / 保护条件。
 * 策略状态由发布、暂停、归档动作驱动,编辑器只展示当前真实状态。
 * 规则树支持交互式增删改:字段 / 操作符 / 取值均使用运营可读控件,不暴露工程枚举。
 */
import { useEffect, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { REMOTE_URL_KEYS, useJanusC2Store } from "@/lib/store/admin/janus-c2-store";
import { STRATEGY_TEMPLATES, strategyFromTemplate } from "@/lib/admin/janus-c2/strategies";
import { strategyDraftIssues } from "@/lib/admin/k6-contract";
import {
  ACTION_TYPE_LABEL,
  CHANNEL_LABEL,
  STRATEGY_STATUS_LABEL,
  channelLabel,
} from "@/lib/admin/janus-c2/labels";
import type { Strategy, StrategyActionType } from "@/lib/admin/janus-c2/types";
import { RuleTreeEditor } from "./rule-tree-editor";

const ACTION_TYPES: StrategyActionType[] = ["BENIGN", "RECOMMEND", "REVERSAL_SESSION_EDGE", "REVERSAL_IMMEDIATE", "ENV_FILTER", "MANUAL_HOLD", "BLOCK", "DRY_RUN_ONLY"];
const CHANNEL_OPTIONS = ["official", "invite", "ad", "test", "internal"];
const isReversal = (t: StrategyActionType): boolean => t === "REVERSAL_SESSION_EDGE" || t === "REVERSAL_IMMEDIATE";

function actionForType(action: Strategy["action"], type: StrategyActionType): Strategy["action"] {
  if (isReversal(type)) {
    return { type, remoteUrlKey: action.remoteUrlKey ?? REMOTE_URL_KEYS[0]?.key };
  }
  return { type };
}

export function StrategyEditor({ initial, isNew, operatorId, onClose }: { initial: Strategy; isNew: boolean; operatorId: string; onClose: () => void }) {
  const save = useJanusC2Store((st) => st.saveStrategy);
  const [s, setS] = useState<Strategy>(initial);
  const patch = (p: Partial<Strategy>) => setS((prev) => ({ ...prev, ...p }));

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => { if (ev.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const applyTemplate = (key: string) => {
    const t = STRATEGY_TEMPLATES.find((x) => x.key === key);
    if (t) setS((prev) => ({ ...strategyFromTemplate(t, prev.strategyId, prev.owner || operatorId, prev.createdAt), status: prev.status }));
  };
  const toggleChannel = (c: string) => {
    const cur = s.scope.channels ?? [];
    patch({ scope: { ...s.scope, channels: cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c] } });
  };
  const inviteRows = (s.scope.inviteCodes?.length ? s.scope.inviteCodes : [""]);
  const setInviteAt = (idx: number, value: string) => {
    const next = [...inviteRows];
    next[idx] = value;
    patch({ scope: { ...s.scope, inviteCodes: next } });
  };
  const addInvite = () => patch({ scope: { ...s.scope, inviteCodes: [...inviteRows, ""] } });
  const removeInviteAt = (idx: number) => {
    const next = inviteRows.filter((_, i) => i !== idx);
    patch({ scope: { ...s.scope, inviteCodes: next.length ? next : [] } });
  };
  const scopeCohortRows = s.scope.cohortIds?.length ? s.scope.cohortIds : [""];
  const setScopeCohortAt = (index: number, value: string) => {
    const cohortIds = [...scopeCohortRows];
    cohortIds[index] = value;
    patch({ scope: { ...s.scope, cohortIds } });
  };
  const removeScopeCohortAt = (index: number) => patch({ scope: { ...s.scope, cohortIds: scopeCohortRows.filter((_, row) => row !== index) } });
  const rolloutCohortRows = s.rollout?.cohortIds?.length ? s.rollout.cohortIds : [""];
  const setRolloutCohortAt = (index: number, value: string) => {
    const cohortIds = [...rolloutCohortRows];
    cohortIds[index] = value;
    patch({ rollout: { ...(s.rollout ?? { percent: 100 }), cohortIds } });
  };
  const removeRolloutCohortAt = (index: number) => patch({ rollout: { ...(s.rollout ?? { percent: 100 }), cohortIds: rolloutCohortRows.filter((_, row) => row !== index) } });
  const normalizeList = (values?: string[]) => Array.from(new Set((values ?? []).map((x) => x.trim()).filter(Boolean)));
  const strategyForSubmit = (): Strategy => ({
    ...s,
    name: s.name.trim(),
    owner: s.owner.trim(),
    scope: { ...s.scope, inviteCodes: normalizeList(s.scope.inviteCodes), cohortIds: normalizeList(s.scope.cohortIds) },
    rollout: { ...(s.rollout ?? { percent: 100 }), cohortIds: normalizeList(s.rollout?.cohortIds) },
  });
  const setGuard = (k: keyof Strategy["safeguards"], v: string) => {
    const n = v === "" ? undefined : Number(v);
    patch({ safeguards: { ...s.safeguards, [k]: n } });
  };

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const issues = strategyDraftIssues(strategyForSubmit());
  const valid = issues.length === 0;
  const onSave = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      await save(strategyForSubmit(), operatorId, isNew);
      onClose();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="k6-modal-overlay" onClick={() => { if (!saving) onClose(); }}>
      <div className="k6c2 k6-modal k6-editor" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={isNew ? "新建策略" : "编辑策略"}>
        <div className="k6-modal-head">
          <div className="ttl"><span style={{ fontSize: 15, fontWeight: 600, color: "var(--ink)" }}>{isNew ? "新建策略" : "编辑策略"}</span></div>
          <button className="k6-modal-close" onClick={onClose} aria-label="关闭"><X size={18} aria-hidden /></button>
        </div>

        <div className="k6-modal-body">
          {isNew && (
            <div className="k6-ovr-field">
              <label htmlFor="st-tpl">从模板开始</label>
              <select id="st-tpl" className="k6-field" defaultValue="" onChange={(e) => e.target.value && applyTemplate(e.target.value)}>
                <option value="">空白(自定义)</option>
                {STRATEGY_TEMPLATES.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
              </select>
            </div>
          )}

          <div className="k6-ovr-field">
            <label htmlFor="st-name">策略名称<i>必填</i></label>
            <input id="st-name" className="k6-field" value={s.name} onChange={(e) => patch({ name: e.target.value })} placeholder="如:成熟度自动建议" />
          </div>
          <div className="k6-ovr-field">
            <label htmlFor="st-desc">策略说明</label>
            <textarea id="st-desc" className="k6-field k6-ovr-textarea" value={s.description} onChange={(e) => patch({ description: e.target.value })} placeholder="一句话说明这条策略的目标与适用设备。" />
          </div>
          <div className="k6-form-row">
            <div className="k6-ovr-field" style={{ marginBottom: 0 }}>
              <label htmlFor="st-owner">负责人</label>
              <input id="st-owner" className="k6-field" value={s.owner} onChange={(e) => patch({ owner: e.target.value })} placeholder={operatorId} />
            </div>
            <div className="k6-ovr-field" style={{ marginBottom: 0 }}>
              <label htmlFor="st-status">状态</label>
              <div id="st-status" className="k6-field" aria-readonly="true">
                {STRATEGY_STATUS_LABEL[s.status]} · 通过策略中心动作变更
              </div>
            </div>
            <div className="k6-ovr-field" style={{ marginBottom: 0 }}>
              <label htmlFor="st-prio">优先级</label>
              <input id="st-prio" className="k6-field" type="number" value={s.priority} onChange={(e) => patch({ priority: Number(e.target.value || 0) })} />
            </div>
          </div>

          <div className="k6-form-row">
            <div className="k6-ovr-field" style={{ marginBottom: 0 }}>
              <label htmlFor="st-action">命中后动作</label>
              <select id="st-action" className="k6-field" value={s.action.type} onChange={(e) => patch({ action: actionForType(s.action, e.target.value as StrategyActionType) })}>
                {ACTION_TYPES.map((a) => <option key={a} value={a}>{ACTION_TYPE_LABEL[a]}</option>)}
              </select>
            </div>
            {isReversal(s.action.type) && (
              <div className="k6-ovr-field" style={{ marginBottom: 0 }}>
                <label htmlFor="st-url">远程地址</label>
                <select id="st-url" className="k6-field" value={s.action.remoteUrlKey ?? "default"} onChange={(e) => patch({ action: { ...s.action, remoteUrlKey: e.target.value } })}>
                  {REMOTE_URL_KEYS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
                </select>
              </div>
            )}
          </div>

          <div className="k6-ovr-field">
            <label>适用渠道</label>
            <div className="k6-chips">
              {CHANNEL_OPTIONS.map((c) => (
                <button key={c} type="button" className={`k6-filter${(s.scope.channels ?? []).includes(c) ? " active" : ""}`} onClick={() => toggleChannel(c)}>{CHANNEL_LABEL[c] ?? c}</button>
              ))}
            </div>
            <div className="k6-hint">不选 = 全部渠道{(s.scope.channels ?? []).length ? ` · 已选 ${(s.scope.channels ?? []).map((c) => channelLabel(c)).join(" / ")}` : ""}</div>
          </div>
          <div className="k6-ovr-field">
            <label>定向邀请码</label>
            <div className="k6-list-editor" aria-label="定向邀请码列表">
              {inviteRows.map((code, idx) => (
                <div className="k6-list-row" key={idx}>
                  <input className="k6-field" value={code} onChange={(e) => setInviteAt(idx, e.target.value)} placeholder={`邀请码 ${idx + 1}`} aria-label={`定向邀请码 ${idx + 1}`} />
                  <button type="button" className="k6-rl-del" onClick={() => removeInviteAt(idx)} aria-label={`删除邀请码 ${idx + 1}`}><Trash2 size={14} aria-hidden /></button>
                </div>
              ))}
              <button type="button" className="k6-pgbtn" onClick={addInvite}><Plus size={13} aria-hidden /> 添加邀请码</button>
            </div>
            <div className="k6-hint">留空 = 不限;每个邀请码单独填写,保存时自动去重。</div>
          </div>

          <div className="k6-ovr-field">
            <label>适用人群队列</label>
            <div className="k6-list-editor" aria-label="适用人群队列列表">
              {scopeCohortRows.map((cohortId, index) => <div className="k6-list-row" key={index}>
                <input className="k6-field" value={cohortId} onChange={(event) => setScopeCohortAt(index, event.target.value)} placeholder={`人群队列 ${index + 1}`} />
                <button type="button" className="k6-rl-del" onClick={() => removeScopeCohortAt(index)} aria-label={`删除适用人群队列 ${index + 1}`}><Trash2 size={14} /></button>
              </div>)}
              <button type="button" className="k6-pgbtn" onClick={() => patch({ scope: { ...s.scope, cohortIds: [...scopeCohortRows, ""] } })}><Plus size={13} /> 添加人群队列</button>
            </div>
            <div className="k6-hint">适用人群队列仅匹配所列队列，并由服务端真实限制适用人群。</div>
          </div>

          <div className="k6-ovr-field">
            <label>保护条件(留空 = 不限)</label>
            <div className="k6-form-row">
              <input className="k6-field" type="number" placeholder="每日最大建议数" value={s.safeguards.maxDailyRecommendations ?? ""} onChange={(e) => setGuard("maxDailyRecommendations", e.target.value)} aria-label="每日最大建议数" />
              <input className="k6-field" type="number" placeholder="每日最大命中数" value={s.safeguards.maxDailyHits ?? ""} onChange={(e) => setGuard("maxDailyHits", e.target.value)} aria-label="每日最大命中数" />
            </div>
            <div className="k6-form-row" style={{ marginTop: 8 }}>
              <input className="k6-field" type="number" placeholder="要求最近上报分钟内" value={s.safeguards.requireFreshReportMinutes ?? ""} onChange={(e) => setGuard("requireFreshReportMinutes", e.target.value)} aria-label="要求最近上报分钟内" />
              <input className="k6-field" type="number" placeholder="最小决策间隔小时" value={s.safeguards.minDecisionIntervalHours ?? ""} onChange={(e) => setGuard("minDecisionIntervalHours", e.target.value)} aria-label="最小决策间隔小时" />
            </div>
          </div>

          <div className="k6-ovr-field">
            <label htmlFor="st-rollout">灰度比例</label>
            <input id="st-rollout" className="k6-field" type="number" min={0} max={100} value={s.rollout?.percent ?? 100}
              onChange={(e) => patch({ rollout: { percent: Math.max(0, Math.min(100, Number(e.target.value || 0))), cohortIds: s.rollout?.cohortIds } })} />
            <div className="k6-hint">100% = 全量生效;小于 100% = 仅对该比例设备灰度放量(可配合上方适用范围的渠道 / 邀请码定向)。</div>
            <div className="k6-list-editor" aria-label="灰度人群队列列表" style={{ marginTop: 8 }}>
              {rolloutCohortRows.map((cohortId, index) => <div className="k6-list-row" key={index}>
                <input className="k6-field" value={cohortId} onChange={(event) => setRolloutCohortAt(index, event.target.value)} placeholder={`灰度队列 ${index + 1}`} />
                <button type="button" className="k6-rl-del" onClick={() => removeRolloutCohortAt(index)} aria-label={`删除灰度队列 ${index + 1}`}><Trash2 size={14} /></button>
              </div>)}
              <button type="button" className="k6-pgbtn" onClick={() => patch({ rollout: { ...(s.rollout ?? { percent: 100 }), cohortIds: [...rolloutCohortRows, ""] } })}><Plus size={13} /> 添加灰度队列</button>
            </div>
            <div className="k6-hint">灰度队列与灰度比例共同参与服务端命中判定。</div>
          </div>

          <div className="k6-ovr-field" style={{ marginBottom: 0 }}>
            <label>命中规则<i>可编辑</i></label>
            <RuleTreeEditor value={s.ruleTree} onChange={(rt) => patch({ ruleTree: rt })} />
            <div className="k6-hint">字段、操作符与枚举取值均下拉选择;组合方式支持全部 / 任一 / 满足 N 条 / 排除 / 加权评分,可嵌套子组。</div>
          </div>

          {issues.length > 0 && <div className="k6-empty k6-error"><b>保存前请修正：</b><ul>{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}
        </div>

        <div className="k6-ovr-foot">
          {saveError && <span className="k6-error">{saveError}</span>}
          <button className="k6-ovr-cancel" onClick={onClose}>取消</button>
          <button className="k6-ovr-confirm" disabled={!valid || saving} onClick={() => void onSave()}>{saving ? "保存中…" : isNew ? "创建策略" : "保存修改"}</button>
        </div>
      </div>
    </div>
  );
}
