"use client";
import { useEffect, useMemo, useState } from "react";
import { Btn } from "../design-kit";
import { formatRange } from "@/lib/admin/ios-model-rules";
import { androidRuleIssues, applyAndroidImport, blankAndroidRule, diffAndroidRules, moveChip, planAndroidImport, removeChip, setChipAliases,
  type AndroidImportPlan, type AndroidPresetCatalog, type AndroidPresetRemovals, type AndroidSocChip, type AndroidSocRule } from "@/lib/admin/android-soc-rules";
import { fetchAndroidSocPresets } from "@/lib/admin/phone-calibration-client";
import { displayAdminError } from "@/lib/admin/error-messages";

const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 };
const CHANGE_LABELS = { added: "新增", modified: "修改", disabled: "停用", enabled: "启用", removed: "删除" } as const;
type ChipForm = { tierId: string; chip: AndroidSocChip; aliases: string; isNew: boolean };

/**
 * E6 "Android 芯片档": a few tiers, each with one operator-preset range for all of its chips.
 * Chips move between tiers with all of their identifiers; publishing stays with the panel's A2 flow.
 */
export function AndroidSocTiersSection({ rules, removals, published, iosRuleIds, editing: editable, onChange }: {
  rules: AndroidSocRule[]; removals: AndroidPresetRemovals; published: AndroidSocRule[]; iosRuleIds: string[]; editing: boolean;
  onChange: (rules: AndroidSocRule[], removals: AndroidPresetRemovals) => void;
}) {
  const [query, setQuery] = useState("");
  const [chipForm, setChipForm] = useState<ChipForm | null>(null);
  const [presets, setPresets] = useState<{ catalog: AndroidPresetCatalog; plan: AndroidImportPlan; restore: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (!editable) { setChipForm(null); setPresets(null); } }, [editable]);
  async function loadPresets() {
    setLoading(true); setError("");
    try {
      const catalog = await fetchAndroidSocPresets();
      setPresets({ catalog, plan: planAndroidImport(rules, removals, catalog.tiers), restore: false });
    } catch (failure) { setError(displayAdminError(failure)); } finally { setLoading(false); }
  }
  function applyPresets() {
    if (!presets || !editable) return;
    // Re-plan against the current draft so an edit made meanwhile is never overwritten.
    const plan = planAndroidImport(rules, removals, presets.catalog.tiers);
    const next = applyAndroidImport(rules, removals, presets.catalog.tiers, plan, presets.restore);
    onChange(next.rules, next.removals);
    setPresets(null);
  }
  const issues = useMemo(() => androidRuleIssues(rules, iosRuleIds), [rules, iosRuleIds]);
  const changes = useMemo(() => diffAndroidRules(published, rules), [published, rules]);
  const needle = query.trim().toLowerCase();
  const matches = (chip: AndroidSocChip) => !needle || [chip.name, chip.manufacturer, ...chip.aliases].some(value => value.toLowerCase().includes(needle));
  const update = (id: string, change: Partial<AndroidSocRule>) => onChange(rules.map(rule => rule.id === id ? { ...rule, ...change } : rule), removals);

  function saveChip() {
    if (!chipForm) return;
    const aliases = chipForm.aliases.split(/[\r\n,，、]+/).map(alias => alias.trim()).filter(Boolean);
    const chip = { ...chipForm.chip, aliases };
    if (chipForm.isNew) {
      onChange(rules.map(rule => rule.id === chipForm.tierId ? { ...rule, chips: [...rule.chips, chip] } : rule), removals);
    } else {
      const renamed = rules.map(rule => ({ ...rule, chips: rule.chips.map(item => item.socKey === chip.socKey ? { ...chip, aliases: item.aliases } : item) }));
      const next = setChipAliases(renamed, removals, chip.socKey, aliases);
      onChange(next.rules, next.removals);
    }
    setChipForm(null);
  }

  return <fieldset className="ios-model-rules" aria-label="Android 芯片档">
    <legend>Android 芯片档（{rules.length} 档 · {rules.reduce((sum, rule) => sum + rule.chips.length, 0)} 颗芯片）</legend>
    <p className="f-foot">按手机芯片匹配，不区分机型和内存。每档一个运营预设区间，档内所有芯片共用；用户首次校准时服务端在区间内取值并保存。芯片连同它的全部标识一起移档，标识不能拆到别的档。</p>
    <div style={grid}>
      <label>搜索芯片或标识<input value={query} maxLength={64} onChange={event => setQuery(event.target.value)} /></label>
      <div className="ios-clear"><Btn disabled={!editable || loading || !!presets} onClick={() => void loadPresets()}>{loading ? "正在读取预设…" : "载入芯片预设"}</Btn>
        <Btn disabled={!editable} onClick={() => onChange([...rules, blankAndroidRule(rules, iosRuleIds)], removals)}>新增芯片档</Btn></div>
    </div>
    {error && <p role="alert">{error}</p>}
    {presets && <div className="ios-import" role="region" aria-label="Android 芯片预设导入预览">
      <h4>导入预览 · {presets.catalog.catalogVersion}</h4>
      <p>核对于 {presets.catalog.verifiedOn}。只补草稿中缺少的芯片档、芯片和标识，不改已有的区间、启停和归档。</p>
      <div className="ios-stats">
        <div><small>新增芯片档</small><strong>{presets.plan.tiers.length}</strong></div>
        <div><small>新增芯片</small><strong>{presets.plan.chips.length}</strong></div>
        <div><small>补充标识</small><strong>{presets.plan.aliases.length}</strong></div>
        <div><small>标识冲突</small><strong className={presets.plan.conflicts.length ? "danger" : ""}>{presets.plan.conflicts.length}</strong></div>
      </div>
      {presets.plan.conflicts.map(conflict => <p role="alert" key={conflict}>未导入 {conflict}，请先核对。</p>)}
      {presets.plan.removed.length > 0 && <label className="ios-check"><input type="checkbox" checked={presets.restore}
        onChange={event => setPresets({ ...presets, restore: event.target.checked })} />
        同时恢复之前主动删除的 {presets.plan.removed.length} 项（{presets.plan.removed.slice(0, 4).map(item => item.label).join("、")}{presets.plan.removed.length > 4 ? " 等" : ""}）。默认不恢复。</label>}
      <details><summary>未收录的芯片与共用标识</summary>
        <ul>{presets.catalog.excluded.map(item => <li key={item.chip}>{item.chip}：{item.reason}</li>)}
          {presets.catalog.ambiguousIds.map(item => <li key={item.id}><span className="mono">{item.id}</span>（{item.chips.join("、")}）：{item.note}</li>)}</ul>
      </details>
      <p className="f-foot">{presets.catalog.notice}</p>
      <Btn variant="primary" disabled={!editable || presets.plan.tiers.length + presets.plan.chips.length + presets.plan.aliases.length === 0 && !(presets.restore && presets.plan.removed.length)}
        onClick={applyPresets}>加入草稿</Btn>
      <Btn onClick={() => setPresets(null)}>取消</Btn>
      <p className="f-foot">加入草稿后仍需「试算并预览影响」→「提交审批」，审批通过才生效。</p>
    </div>}
    {issues.length > 0 && <p role="alert">{issues[0].index >= 0 ? `第 ${issues[0].index + 1} 档：` : ""}{issues[0].message}</p>}
    <p role="status">草稿相对已发布：{changes.length === 0 ? "没有变化" : changes.map(change => `${CHANGE_LABELS[change.kind]}「${change.name || change.id}」`).join("、")}</p>
    {rules.length === 0 ? <p>尚无芯片档。Android 校准会进入待核验，不授予算力。</p> : rules.map((rule, index) => {
      const chips = rule.chips.filter(matches);
      if (needle && chips.length === 0) return null;
      const change = changes.find(item => item.id === rule.id);
      return <details key={rule.id + index} open={!!needle}>
        <summary>{rule.name || "未命名档"} · {formatRange(rule)} · {rule.chips.length} 颗芯片{rule.enabled ? "" : " · 已停用"}
          {change && <small> · {CHANGE_LABELS[change.kind]}{change.details.length ? `：${change.details.join("；")}` : ""}</small>}</summary>
        <div style={grid}>
          <label>档位名称<input value={rule.name} maxLength={64} disabled={!editable} onChange={event => update(rule.id, { name: event.target.value })} /></label>
          <label>算力下限（含）<input type="number" min="0" step="0.01" disabled={!editable}
            value={Number.isFinite(rule.minComputeValue) ? rule.minComputeValue : ""}
            onChange={event => update(rule.id, { minComputeValue: event.target.value ? Number(event.target.value) : NaN })} /></label>
          <label>算力上限（含）<input type="number" min="0" step="0.01" disabled={!editable}
            value={Number.isFinite(rule.maxComputeValue) ? rule.maxComputeValue : ""}
            onChange={event => update(rule.id, { maxComputeValue: event.target.value ? Number(event.target.value) : NaN })} /></label>
          <label className="ios-check"><input type="checkbox" checked={rule.enabled} disabled={!editable}
            onChange={event => update(rule.id, { enabled: event.target.checked })} />参加后续校准匹配</label>
        </div>
        <label>运营说明（选填）<input value={rule.note ?? ""} maxLength={500} disabled={!editable} onChange={event => update(rule.id, { note: event.target.value || null })} /></label>
        <div className="ios-table"><table>
          <thead><tr>{["芯片", "厂商", "已核验标识", "操作"].map(label => <th key={label}>{label}</th>)}</tr></thead>
          <tbody>{chips.map(chip => <tr key={chip.socKey}>
            <td><strong>{chip.name}</strong><br /><small className="mono">{chip.socKey}</small></td>
            <td>{chip.manufacturer}</td>
            <td style={{ overflowWrap: "anywhere" }}><small className="mono">{chip.aliases.join("、")}</small></td>
            <td><div className="ios-row-actions">
              <label>移到<select aria-label={`把 ${chip.name} 移到`} value={rule.id} disabled={!editable}
                onChange={event => onChange(moveChip(rules, chip.socKey, event.target.value), removals)}>
                {rules.map(target => <option key={target.id} value={target.id}>{target.name || target.id}</option>)}</select></label>
              <Btn sm disabled={!editable || !!chipForm} onClick={() => setChipForm({ tierId: rule.id, chip, aliases: chip.aliases.join("\n"), isNew: false })}>编辑</Btn>
              <Btn sm disabled={!editable} onClick={() => { const next = removeChip(rules, removals, chip.socKey); onChange(next.rules, next.removals); }}>移除</Btn>
            </div></td>
          </tr>)}</tbody>
        </table></div>
        <Btn sm disabled={!editable || !!chipForm} onClick={() => setChipForm({ tierId: rule.id, isNew: true, aliases: "",
          chip: { socKey: "", name: "", manufacturer: "", aliases: [] } })}>在本档新增芯片</Btn>
        <Btn sm disabled={!editable || rule.chips.length > 0} onClick={() => onChange(rules.filter(item => item.id !== rule.id), removals)}>删除空档</Btn>
      </details>;
    })}
    {chipForm && <div className="ios-form" role="region" aria-label={chipForm.isNew ? "新增芯片" : `编辑 ${chipForm.chip.name}`}>
      <h4>{chipForm.isNew ? "新增芯片" : `编辑芯片 · ${chipForm.chip.name}`}</h4>
      <div style={grid}>
        <label>芯片编号（稳定，不随改名变化）<input value={chipForm.chip.socKey} maxLength={64} disabled={!chipForm.isNew} placeholder="例如 snapdragon-8-gen-2"
          onChange={event => setChipForm({ ...chipForm, chip: { ...chipForm.chip, socKey: event.target.value.trim().toLowerCase() } })} /></label>
        <label>芯片名称<input value={chipForm.chip.name} maxLength={128} placeholder="例如 骁龙 8 Gen 2"
          onChange={event => setChipForm({ ...chipForm, chip: { ...chipForm.chip, name: event.target.value } })} /></label>
        <label>厂商<input value={chipForm.chip.manufacturer} maxLength={64} placeholder="例如 高通"
          onChange={event => setChipForm({ ...chipForm, chip: { ...chipForm.chip, manufacturer: event.target.value } })} /></label>
      </div>
      <label>已核验的芯片标识（每行一个，例如 SM8550；需两个独立来源确认，多颗芯片共用的标识不能填）
        <textarea rows={3} value={chipForm.aliases} onChange={event => setChipForm({ ...chipForm, aliases: event.target.value })} /></label>
      <Btn variant="primary" disabled={!editable || !chipForm.chip.socKey || !chipForm.chip.name.trim() || !chipForm.aliases.trim()} onClick={saveChip}>保存到草稿</Btn>
      <Btn onClick={() => setChipForm(null)}>取消</Btn>
      <p className="f-foot">保存后仍需「试算并预览影响」→「提交审批」，审批通过才生效。</p>
    </div>}
  </fieldset>;
}
