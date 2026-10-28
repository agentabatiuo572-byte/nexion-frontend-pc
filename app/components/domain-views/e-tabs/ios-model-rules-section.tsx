"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Btn } from "../design-kit";
import { displayAdminError } from "@/lib/admin/error-messages";
import { fetchIosModelPresets } from "@/lib/admin/phone-calibration-client";
import { IOS_CATALOG_LABELS, IOS_CHANGE_LABELS, blankIosRule, diffIosRules, formatFacts, formatRange, iosRuleFormIssues, normalizeModel, planIosImport,
  type IosCatalogClass, type IosImportPlan, type IosModelPresetCatalog, type IosModelRule } from "@/lib/admin/ios-model-rules";

const grid = { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12 };
type StatusFilter = "all" | "enabled" | "disabled";
/** `id` is the edited rule's id when the form opened (null for a new rule), so list changes never retarget the form. */
/** Multi-value fields are edited as text and parsed on save. */
type Editing = { id: string | null; rule: IosModelRule; aliases: string; scales: string; screens: string };
const editing = (id: string | null, rule: IosModelRule): Editing => ({ id, rule: { ...rule }, aliases: rule.aliases.join("\n"),
  scales: (rule.scales ?? []).join(", "), screens: (rule.screens ?? []).join("\n") });

/** E6 "iPhone 机型预设": the draft list, its editor and the preset import. Publishing stays with the panel's A2 flow. */
export function IosModelRulesSection({ rules, published, androidRuleIds, editing: editable, onChange }: {
  rules: IosModelRule[]; published: IosModelRule[]; androidRuleIds: string[]; editing: boolean;
  onChange: (next: IosModelRule[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [catalog, setCatalog] = useState<IosCatalogClass | "all">("all");
  const [form, setForm] = useState<Editing | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [presets, setPresets] = useState<{ catalog: IosModelPresetCatalog; plan: IosImportPlan; selected: Set<string> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  // A lock, reload or pending confirmation ends every open edit, so nothing stale is written into the new list.
  useEffect(() => { if (!editable) { setForm(null); setPresets(null); setConfirmRemove(null); } }, [editable]);

  const changes = useMemo(() => diffIosRules(published, rules), [published, rules]);
  const changeById = useMemo(() => new Map(changes.map(change => [change.id, change])), [changes]);
  const publishedIds = useMemo(() => new Set(published.map(rule => rule.id)), [published]);
  const counts = changes.reduce((sum, change) => ({ ...sum, [change.kind]: (sum[change.kind] ?? 0) + 1 }), {} as Record<string, number>);
  const needle = normalizeModel(query);
  const visible = rules.map((rule, index) => ({ rule, index })).filter(({ rule }) =>
    (!needle || [rule.model, ...rule.aliases].some(name => normalizeModel(name).includes(needle)))
    && (status === "all" || (status === "enabled") === rule.enabled)
    && (catalog === "all" || rule.catalogClass === catalog));
  const filtered = !!needle || status !== "all" || catalog !== "all";
  const clearFilters = () => { setQuery(""); setStatus("all"); setCatalog("all"); };

  const formIndex = form?.id == null ? null : rules.findIndex(rule => rule.id === form.id);
  const formGone = formIndex === -1;
  useEffect(() => { if (formGone) setForm(null); }, [formGone]);
  const formIssues = form && !formGone ? iosRuleFormIssues(rules, formIndex, formRule(form), androidRuleIds) : [];
  const fieldIssue = (field: string) => formIssues.find(issue => issue.field === field)?.message;

  function formRule(value: Editing): IosModelRule {
    return { ...value.rule, aliases: value.aliases.split(/\r?\n/).map(alias => alias.trim()).filter(Boolean),
      scales: value.scales.split(/[,，\s]+/).filter(Boolean).map(Number),
      screens: value.screens.split(/[\r\n,，]+/).map(screen => screen.trim().replace(/\s*[x×*]\s*/i, "x")).filter(Boolean) };
  }
  function save() {
    if (!form || !editable || formGone || formIssues.length) return;
    const rule = formRule(form);
    onChange(formIndex === null ? [...rules, rule] : rules.map((item, index) => index === formIndex ? rule : item));
    setForm(null);
  }
  function toggle(id: string) {
    onChange(rules.map(rule => rule.id === id ? { ...rule, enabled: !rule.enabled } : rule));
  }
  function remove(id: string) {
    onChange(rules.filter(rule => rule.id !== id));
    setConfirmRemove(null);
  }
  async function loadPresets() {
    setLoading(true); setError("");
    try {
      const result = await fetchIosModelPresets();
      if (!live.current) return;
      const plan = planIosImport(rules, result.models, androidRuleIds);
      setPresets({ catalog: result, plan, selected: new Set(plan.added.map(rule => rule.id)) });
    } catch (failure) {
      if (live.current) setError(displayAdminError(failure));
    } finally { if (live.current) setLoading(false); }
  }
  function applyImport() {
    if (!presets || !editable) return;
    // Re-plan against the current draft so an edit made meanwhile is never overwritten.
    const plan = planIosImport(rules, presets.catalog.models.filter(rule => presets.selected.has(rule.id)), androidRuleIds);
    onChange([...rules, ...plan.added]);
    setPresets(null);
  }

  // Not a disabled fieldset: search and filters stay usable for read-only viewers.
  return <fieldset className="ios-model-rules" aria-label="iPhone 机型预设">
    <legend>iPhone 机型预设（{rules.length}/500）</legend>
    <div className="ios-head">
      <p>按机型匹配，不区分容量、颜色和地区版本。范围是运营预设的平台算力，不是 Apple 性能指标或实测跑分。用户首次校准时，系统在范围内随机取一个值并保存。</p>
      <div className="ios-actions">
        <Btn disabled={!editable || loading || !!presets} onClick={() => void loadPresets()}>{loading ? "正在读取预设…" : "载入 iPhone 机型预设"}</Btn>
        <Btn variant="primary" disabled={!editable || rules.length >= 500 || !!form}
          onClick={() => setForm(editing(null, blankIosRule(rules, androidRuleIds)))}>新增机型</Btn>
      </div>
    </div>
    {error && <p role="alert">{error}</p>}

    {presets && <div className="ios-import" role="region" aria-label="iPhone 预设导入预览">
      <h4>导入预览 · {presets.catalog.catalogVersion}</h4>
      <p>核对于 {presets.catalog.verifiedOn}，从 iPhone 6 起共 {presets.catalog.models.length} 个已售机型。只补草稿中缺少的机型，不覆盖已维护的范围、别名和停用状态。</p>
      <div className="ios-stats">
        <div><small>将新增</small><strong>{presets.plan.added.length}</strong></div>
        <div><small>已存在 · 跳过</small><strong>{presets.plan.skipped.length}</strong></div>
        <div><small>名称冲突</small><strong className={presets.plan.conflicts.length ? "danger" : ""}>{presets.plan.conflicts.length}</strong></div>
      </div>
      {presets.plan.conflicts.map(({ preset, reason }) => <p role="alert" key={preset.id}>未导入「{preset.model}」：{reason}，请先核对。</p>)}
      {presets.plan.added.length > 0 && <>
        <label className="ios-check"><input type="checkbox" checked={presets.selected.size === presets.plan.added.length}
          onChange={event => setPresets({ ...presets, selected: new Set(event.target.checked ? presets.plan.added.map(rule => rule.id) : []) })} />
          全选 {presets.plan.added.length} 个待新增机型（已选 {presets.selected.size}）</label>
        <div className="ios-preset-list">{presets.plan.added.map(rule => <label className="ios-check" key={rule.id}>
          <input type="checkbox" checked={presets.selected.has(rule.id)} onChange={event => {
            const selected = new Set(presets.selected);
            if (event.target.checked) selected.add(rule.id); else selected.delete(rule.id);
            setPresets({ ...presets, selected });
          }} />{rule.model} · {formatRange(rule)} · {rule.catalogClass ? IOS_CATALOG_LABELS[rule.catalogClass] : "未分类"}</label>)}</div>
      </>}
      <p className="f-foot">取消勾选只是本次不导入，不代表该机型不支持；以后可再次载入补齐。{presets.catalog.notice}</p>
      <Btn variant="primary" disabled={!editable || presets.selected.size === 0} onClick={applyImport}>加入草稿</Btn>
      <Btn onClick={() => setPresets(null)}>取消</Btn>
      <p className="f-foot">加入草稿后仍需「试算并预览影响」→「提交审批」，审批通过才生效。</p>
    </div>}

    <div style={grid}>
      <label>搜索机型或别名<input value={query} maxLength={128} onChange={event => setQuery(event.target.value)} /></label>
      <label>状态<select value={status} onChange={event => setStatus(event.target.value as StatusFilter)}>
        <option value="all">全部</option><option value="enabled">启用</option><option value="disabled">停用</option></select></label>
      <label>目录分类<select value={catalog} onChange={event => setCatalog(event.target.value as IosCatalogClass | "all")}>
        <option value="all">全部</option>{Object.entries(IOS_CATALOG_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <div className="ios-clear"><Btn disabled={!filtered} onClick={clearFilters}>清空筛选</Btn></div>
    </div>
    <p role="status">共 {rules.length} 个机型{filtered ? ` · 显示 ${visible.length} 个` : ""} · 草稿相对已发布：新增 {counts.added ?? 0}、修改 {counts.modified ?? 0}、停用 {counts.disabled ?? 0}、启用 {counts.enabled ?? 0}、删除 {counts.removed ?? 0}</p>

    {rules.length === 0 ? <p>尚无 iPhone 机型规则。iOS 校准会进入待核验，不授予算力。可载入预设或新增机型。</p>
      : visible.length === 0 ? <p>没有符合筛选条件的机型。<Btn sm onClick={clearFilters}>清空筛选</Btn></p>
      : <div className="ios-table"><table>
        <thead><tr>{["机型", "已核验别名", "运营预设范围", "设备信息", "状态", "目录分类", "草稿变化", "操作"].map(label => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{visible.map(({ rule, index }) => {
          const removing = confirmRemove === rule.id;
          const change = changeById.get(rule.id);
          return <tr key={rule.id + index}>
            <td><strong>{rule.model || "未填写机型"}</strong><br /><small className="mono">{rule.id}</small></td>
            <td>{rule.aliases.join("、") || "—"}</td>
            <td>{formatRange(rule)}</td>
            <td><small>{formatFacts(rule)}</small></td>
            <td><span className={rule.enabled ? "ios-pill on" : "ios-pill"}>{rule.enabled ? "启用" : "停用"}</span></td>
            <td>{rule.catalogClass ? IOS_CATALOG_LABELS[rule.catalogClass] : "—"}</td>
            <td>{change ? <>{IOS_CHANGE_LABELS[change.kind]}{change.details.length > 0 && <><br /><small>{change.details.join("；")}</small></>}</> : "—"}</td>
            <td><div className="ios-row-actions">
              <Btn sm disabled={!editable || !!form} onClick={() => setForm(editing(rule.id, rule))}>编辑</Btn>
              <Btn sm disabled={!editable} onClick={() => toggle(rule.id)}>{rule.enabled ? "停用" : "启用"}</Btn>
              {removing
                ? <><Btn sm variant="danger" onClick={() => remove(rule.id)}>确认{publishedIds.has(rule.id) ? "删除" : "移除"}</Btn><Btn sm onClick={() => setConfirmRemove(null)}>取消</Btn></>
                : <Btn sm disabled={!editable} onClick={() => setConfirmRemove(rule.id)}>{publishedIds.has(rule.id) ? "删除" : "移除"}</Btn>}
            </div>
            {removing && <small role="status">{publishedIds.has(rule.id)
              ? "删除只影响后续校准；已分配的算力、已激活设备和历史记录保留。审批后生效。" : "这是尚未发布的草稿条目，移除后不会提交。"}</small>}</td>
          </tr>;
        })}</tbody>
      </table></div>}

    {form && !formGone && <div className="ios-form" role="region" aria-label={formIndex === null ? "新增 iPhone 机型" : `编辑 ${form.rule.model}`}>
      <h4>{formIndex === null ? "新增机型" : `编辑机型 · ${rules[formIndex].model || "未填写"}`}</h4>
      <div style={grid}>
        <Field label="规则编号" error={fieldIssue("id")}><input value={form.rule.id} maxLength={64} disabled={form.id !== null && publishedIds.has(form.id)}
          onChange={event => setForm({ ...form, rule: { ...form.rule, id: event.target.value } })} /></Field>
        <Field label="规范机型名" error={fieldIssue("model")}><input value={form.rule.model} maxLength={128} placeholder="例如 iPhone 16 Pro"
          onChange={event => setForm({ ...form, rule: { ...form.rule, model: event.target.value } })} /></Field>
        <Field label="算力下限（含）" error={fieldIssue("minComputeValue")}><input type="number" min="0" step="0.01"
          value={Number.isFinite(form.rule.minComputeValue) ? form.rule.minComputeValue : ""}
          onChange={event => setForm({ ...form, rule: { ...form.rule, minComputeValue: event.target.value ? Number(event.target.value) : NaN } })} /></Field>
        <Field label="算力上限（含）" error={fieldIssue("maxComputeValue")}><input type="number" min="0" step="0.01"
          value={Number.isFinite(form.rule.maxComputeValue) ? form.rule.maxComputeValue : ""}
          onChange={event => setForm({ ...form, rule: { ...form.rule, maxComputeValue: event.target.value ? Number(event.target.value) : NaN } })} /></Field>
        <label>目录分类<select value={form.rule.catalogClass ?? "OPERATOR_ADDED"}
          onChange={event => setForm({ ...form, rule: { ...form.rule, catalogClass: event.target.value as IosCatalogClass } })}>
          {Object.entries(IOS_CATALOG_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="ios-check"><input type="checkbox" checked={form.rule.enabled}
          onChange={event => setForm({ ...form, rule: { ...form.rule, enabled: event.target.checked } })} />参加后续校准匹配</label>
      </div>
      <Field label="已核验别名（每行一个，SDK 返回的名称或硬件标识符）" error={fieldIssue("aliases")}>
        <textarea rows={3} value={form.aliases} onChange={event => setForm({ ...form, aliases: event.target.value })} /></Field>
      <h5>设备信息（选填，用于机型风控；不确定就留空，留空不检查）</h5>
      <div style={grid}>
        <Field label="出厂系统版本" error={fieldIssue("minOsVersion")}><input value={form.rule.minOsVersion ?? ""} maxLength={8} placeholder="例如 18.0"
          onChange={event => setForm({ ...form, rule: { ...form.rule, minOsVersion: event.target.value.trim() || null } })} /></Field>
        <Field label="最高可升级大版本" error={fieldIssue("maxOsMajor")}><input type="number" min="1" max="99" step="1"
          value={form.rule.maxOsMajor ?? ""} placeholder="仍支持就留空"
          onChange={event => setForm({ ...form, rule: { ...form.rule, maxOsMajor: event.target.value ? Number(event.target.value) : null } })} /></Field>
        <Field label="屏幕倍率" error={fieldIssue("scales")}><input value={form.scales} maxLength={16} placeholder="例如 3"
          onChange={event => setForm({ ...form, scales: event.target.value })} /></Field>
      </div>
      <Field label="屏幕尺寸（逻辑点，每行一组，含放大显示模式）" error={fieldIssue("screens")}>
        <textarea rows={2} value={form.screens} placeholder="402x874" onChange={event => setForm({ ...form, screens: event.target.value })} /></Field>
      <Field label="运营说明（选填，最多 500 字）" error={fieldIssue("note")}><input value={form.rule.note ?? ""} maxLength={500}
        onChange={event => setForm({ ...form, rule: { ...form.rule, note: event.target.value || null } })} /></Field>
      <p className="f-foot">上下限相等时为固定值，最多 2 位小数。不需要填写 SoC、GPU、内存或容量。</p>
      <Btn variant="primary" disabled={!editable || formIssues.length > 0} onClick={save}>保存到草稿</Btn>
      <Btn onClick={() => setForm(null)}>取消</Btn>
    </div>}
  </fieldset>;
}

function Field({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return <label className={error ? "ios-field invalid" : "ios-field"}>{label}{children}{error && <small role="alert">{error}</small>}</label>;
}
