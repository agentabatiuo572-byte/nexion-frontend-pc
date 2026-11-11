"use client";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { FilePenLine, Smartphone } from "lucide-react";
import "./e6-hardware-rules.css";
import { Drawer, Decision, Button, Table, Th, Tr, Td, Explain, BlockState, Fold, Field, Input, Textarea, Check, Select, Facts, Fact, StatusTag, Notice, MoreMenu } from "@/app/components/rd";
import { displayAdminError } from "@/lib/admin/error-messages";
import { fetchIosModelPresets } from "@/lib/admin/phone-calibration-client";
import { IOS_CATALOG_LABELS, IOS_CHANGE_LABELS, blankIosRule, diffIosRules, formatFacts, formatRange, iosRuleFormIssues, normalizeModel, planIosImport,
  type IosCatalogClass, type IosImportPlan, type IosModelPresetCatalog, type IosModelRule } from "@/lib/admin/ios-model-rules";

type StatusFilter = "all" | "enabled" | "disabled";
/** `id` is the edited rule's id when the form opened (null for a new rule), so list changes never retarget the form. */
/** Multi-value fields are edited as text and parsed on save. */
type Editing = { id: string | null; rule: IosModelRule; aliases: string; scales: string; screens: string };
const editing = (id: string | null, rule: IosModelRule): Editing => ({ id, rule: { ...rule }, aliases: rule.aliases.join("\n"),
  scales: (rule.scales ?? []).join(", "), screens: (rule.screens ?? []).join("\n") });

/** E6 "iPhone 机型预设": the draft list, its editor and the preset import. Publishing stays with the panel's A2 flow. */
export function IosModelRulesSection({ rules, published, androidRuleIds, editing: editable, canWrite, onChange }: {
  rules: IosModelRule[]; published: IosModelRule[]; androidRuleIds: string[]; editing: boolean; canWrite: boolean;
  onChange: (next: IosModelRule[]) => void;
}) {
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [catalog, setCatalog] = useState<IosCatalogClass | "all">("all");
  const [form, setForm] = useState<Editing | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  // fillFacts: an operator may have cleared a model's facts on purpose, so refilling them is opted into.
  const [presets, setPresets] = useState<{ catalog: IosModelPresetCatalog; plan: IosImportPlan; selected: Set<string>; fillFacts: boolean } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  // A lock, reload or pending confirmation ends every open edit, so nothing stale is written into the new list.
  useEffect(() => { if (!editable) { setForm(null); setPresets(null); setImportOpen(false); setConfirmRemove(null); } }, [editable]);

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
  const fieldIssue = (field: string) => touched.has(field) ? formIssues.find(issue => issue.field === field)?.message : undefined;
  function openForm(value: Editing) { setTouched(new Set()); setForm(value); }

  function formRule(value: Editing): IosModelRule {
    return { ...value.rule, aliases: value.aliases.split(/\r?\n/).map(alias => alias.trim()).filter(Boolean),
      // The list shows "@2/3x" and "375x667、414x736"; both forms are accepted back.
      scales: value.scales.replace(/[@x]/gi, " ").split(/[,，、/\s]+/).filter(Boolean).map(Number),
      screens: value.screens.split(/[\r\n,，、]+/).map(screen => screen.trim().replace(/\s*[x×*]\s*/i, "x")).filter(Boolean) };
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
    setImportOpen(true); setPresets(null); setLoading(true); setError("");
    try {
      const result = await fetchIosModelPresets();
      if (!live.current) return;
      const plan = planIosImport(rules, result.models, androidRuleIds);
      setPresets({ catalog: result, plan, selected: new Set(plan.added.map(rule => rule.id)), fillFacts: false });
    } catch (failure) {
      if (live.current) setError(displayAdminError(failure));
    } finally { if (live.current) setLoading(false); }
  }
  function applyImport() {
    if (!presets || !editable) return;
    // Re-plan against the current draft so an edit made meanwhile is never overwritten.
    const plan = planIosImport(rules, presets.catalog.models, androidRuleIds);
    const facts = new Map(presets.fillFacts ? plan.factsFilled.map(fill => [fill.id, fill.facts]) : []);
    onChange([...rules.map(rule => facts.has(rule.id) ? { ...rule, ...facts.get(rule.id) } : rule),
      ...plan.added.filter(rule => presets.selected.has(rule.id))]);
    setPresets(null); setImportOpen(false);
  }

  const actions = canWrite && <div className="e6-hw-actions">
    <Button disabled={!editable || loading || importOpen || !!form} onClick={()=>void loadPresets()}>{loading ? "正在读取预设…" : "载入 iPhone 机型预设"}</Button>
    <Button variant="primary" disabled={!editable || rules.length >= 500 || !!form || importOpen || loading} onClick={()=>openForm(editing(null,blankIosRule(rules,androidRuleIds)))}>新增机型</Button>
  </div>;

  return <fieldset className="ios-model-rules e6-hw-directory" aria-label="iPhone 机型预设">
    <legend><span className="e6-actions">iPhone 机型预设（{rules.length}/500）<Explain label="iPhone 匹配范围的说明" content="按机型匹配，不区分容量、颜色和地区版本。范围是运营预设的平台算力，不是 Apple 性能指标或实测跑分。用户首次校准时，系统在范围内随机取一个值并保存。"/></span></legend>
    {rules.length > 0 && actions}
    {error && !importOpen && <Notice tone="warn">{error}</Notice>}
    {importOpen && <Drawer open title="载入 iPhone 机型预设" icon={Smartphone} sub={<StatusTag tone="done" icon={FilePenLine} filled>仅保存草稿</StatusTag>}
      explain="只补草稿中缺少的机型，不覆盖已维护的范围、别名和停用状态。加入草稿后仍需试算和提交审批。"
      onClose={()=>{setImportOpen(false);setPresets(null);}} footer={<Decision primary={presets && <Button variant="primary" disabledReason={!editable ? "硬件草稿暂不可修改" : presets.selected.size === 0 && !(presets.fillFacts && presets.plan.factsFilled.length > 0) ? "请选择待新增机型或补充设备信息" : undefined} onClick={applyImport}>加入草稿</Button>} others={<Button onClick={()=>{setImportOpen(false);setPresets(null);}}>取消</Button>}/> }>
      <div className="rd-form-stack e6-hw-drawer" aria-label="iPhone 预设导入预览">
        {!presets ? <BlockState state={loading?"loading":"error"} title={loading?"正在读取预设…":"预设加载失败"} detail={error} onRetry={loading?undefined:()=>void loadPresets()}/> : <>
          <Facts><Fact k="将新增" lead unit="个">{presets.plan.added.length}</Fact><Fact k="已存在 · 跳过">{presets.plan.skipped.length} 个</Fact><Fact k="补充设备信息">{presets.plan.factsFilled.length} 个</Fact><Fact k="名称冲突" tone={presets.plan.conflicts.length ? "warn" : undefined}>{presets.plan.conflicts.length} 个</Fact><Fact k="目录版本">{presets.catalog.catalogVersion}</Fact><Fact k="核验日期">{presets.catalog.verifiedOn}</Fact></Facts>
          {presets.plan.conflicts.length > 0 && <Notice tone="warn" title="名称或编号冲突"><ul className="e6-hw-list">{presets.plan.conflicts.map(({preset,reason})=><li key={preset.id}><strong>{preset.model}</strong><span>{reason}</span></li>)}</ul></Notice>}
          {presets.plan.added.length > 0 && <><Check label={`全选 ${presets.plan.added.length} 个待新增机型（已选 ${presets.selected.size}）`} checked={presets.selected.size === presets.plan.added.length} onChange={event=>setPresets({...presets,selected:new Set(event.target.checked ? presets.plan.added.map(rule=>rule.id) : [])})}/>
            <div className="e6-hw-preset-models">{presets.plan.added.map(rule=><Check key={rule.id} label={rule.model} help={`${formatRange(rule)} · ${rule.catalogClass ? IOS_CATALOG_LABELS[rule.catalogClass] : "未分类"}`} checked={presets.selected.has(rule.id)} onChange={event=>{const selected=new Set(presets.selected);if(event.target.checked)selected.add(rule.id);else selected.delete(rule.id);setPresets({...presets,selected});}}/>)}</div></>}
          <Fold title="已存在 · 跳过" summary={`${presets.plan.skipped.length} 个`} inset><ul className="e6-hw-list">{presets.plan.skipped.map(rule=><li key={rule.id}><strong>{rule.model}</strong><span>保留已维护的范围、别名和停用状态</span></li>)}</ul>{!presets.plan.skipped.length && <p>没有已存在机型。</p>}</Fold>
          {presets.plan.factsFilled.length > 0 && <><Check label={`补充 ${presets.plan.factsFilled.length} 个已有机型的设备信息`} help="默认不补充；特意留空的机型请不要勾选。" checked={presets.fillFacts} onChange={event=>setPresets({...presets,fillFacts:event.target.checked})}/><Fold title="可补充设备信息的机型" summary={`${presets.plan.factsFilled.length} 个`} inset><ul className="e6-hw-list">{presets.plan.factsFilled.map(fill=><li key={fill.id}><strong>{fill.model}</strong><span>{formatFacts(fill.facts)}</span></li>)}</ul></Fold></>}
          <Fold title="技术信息" summary="目录原文与来源" inset><p>{presets.catalog.notice}</p><ul className="e6-hw-list">{presets.catalog.sources.map(source=><li key={source}>{source}</li>)}</ul></Fold>
        </>}
      </div>
    </Drawer>}
    {rules.length > 0 && <div className="e6-hw-tools e6-hw-ios-filters">
      <Field label="搜索机型或别名"><Input value={query} maxLength={128} onChange={event=>setQuery(event.target.value)}/></Field>
      <Field label="状态"><Select aria-label="机型状态" value={status} onChange={value=>setStatus(value as StatusFilter)} options={[{value:"all",label:"全部"},{value:"enabled",label:"已启用"},{value:"disabled",label:"已停用"}]}/></Field>
      <Field label="目录分类"><Select aria-label="目录分类" value={catalog} onChange={value=>setCatalog(value as IosCatalogClass | "all")} options={[{value:"all",label:"全部"},...Object.entries(IOS_CATALOG_LABELS).map(([value,label])=>({value,label}))]}/></Field>
      <Button disabled={!filtered} onClick={clearFilters}>清空筛选</Button>
    </div>}
    {filtered && <div className="e6-hardware-summary" role="status">显示 {visible.length} / {rules.length} 个机型</div>}
    {Object.values(counts).some(count=>count > 0) && <Fold title="iPhone 草稿变化" summary="尚未发布" inset>新增 {counts.added ?? 0}、修改 {counts.modified ?? 0}、停用 {counts.disabled ?? 0}、启用 {counts.enabled ?? 0}、删除 {counts.removed ?? 0}</Fold>}
    {rules.length === 0 ? <BlockState state="empty" title="尚无 iPhone 机型规则，iOS 校准将进入待核验" detail={actions}/> : visible.length === 0 ? <BlockState state="empty" title="没有符合筛选条件的机型" detail={<Button size="sm" onClick={clearFilters}>清空筛选</Button>}/> :
      <Table label="iPhone 机型目录" className="e6-hw-ios-table" data-tight><colgroup><col/><col/><col/><col/><col/><col/></colgroup><thead><Tr>{["机型 · 草稿变化","运营预设范围","设备信息","目录分类","状态"].map(label=><Th key={label}>{label}</Th>)}<Th align="right">操作</Th></Tr></thead><tbody>{visible.map(({rule,index})=>{
        const removing=confirmRemove===rule.id,change=changeById.get(rule.id);
        return <Fragment key={rule.id + index}><Tr>
          <Td><div className="e6-hw-model-name"><strong title={rule.model}>{rule.model || "未填写机型"}</strong><Explain label={`${rule.model}的别名与技术信息`} content={<>规则编号：{rule.id}<br/>已核验别名：{rule.aliases.join("、")||"—"}<br/>{change?.details.join("；")||"草稿无变化"}</>}/></div>{change && <small className="e6-hw-cell-sub">{IOS_CHANGE_LABELS[change.kind]}</small>}</Td>
          <Td><span className="e6-hw-nowrap">{formatRange(rule)}</span></Td><Td><div className="e6-hw-facts-cell"><span title={formatFacts(rule)}>{formatFacts(rule)}</span><Explain label={`${rule.model}的设备信息`} content={formatFacts(rule)}/></div></Td><Td>{rule.catalogClass ? IOS_CATALOG_LABELS[rule.catalogClass] : "—"}</Td><Td><StatusTag tone={rule.enabled ? "ok" : "done"}>{rule.enabled ? "已启用" : "已停用"}</StatusTag></Td>
          <Td><div className="e6-hw-row-actions" hidden={!canWrite}><Button size="sm" disabled={!editable || !!form} onClick={()=>openForm(editing(rule.id,rule))}>编辑</Button><MoreMenu label={`${rule.model}更多操作`} disabled={!editable} items={[{key:"status",label:rule.enabled ? "停用" : "启用",onSelect:()=>toggle(rule.id)},{key:"remove",label:publishedIds.has(rule.id)?"删除":"移除",danger:true,onSelect:()=>setConfirmRemove(rule.id)}]}/></div></Td>
        </Tr>{removing && <Tr><Td colSpan={6}><div className="e6-hw-remove"><div><strong>{publishedIds.has(rule.id)?"删除":"移除"}「{rule.model}」？</strong><p>{publishedIds.has(rule.id)?"删除只影响后续校准；已分配的算力、已激活设备和历史记录保留。审批后生效。":"这是尚未发布的草稿条目，移除后不会提交。"}</p></div><div className="e6-hw-actions"><Button size="sm" onClick={()=>setConfirmRemove(null)}>取消</Button><Button size="sm" variant="danger" onClick={()=>remove(rule.id)}>确认{publishedIds.has(rule.id)?"删除":"移除"}</Button></div></div></Td></Tr>}</Fragment>;
      })}</tbody></Table>}
    {form && !formGone && <Drawer open title={formIndex === null ? "新增 iPhone 机型" : `编辑机型 · ${rules[formIndex].model || "未填写"}`} icon={Smartphone} sub={<StatusTag tone="done" icon={FilePenLine} filled>仅保存草稿</StatusTag>} explain="保存后仍需试算并提交审批，审批通过才生效。" onClose={()=>setForm(null)} footer={<Decision note={formIssues[0]?.message} primary={<Button variant="primary" disabledReason={!editable ? "硬件草稿暂不可修改" : formIssues[0]?.message} onBlockedClick={()=>setTouched(new Set(formIssues.map(issue=>issue.field)))} onClick={save}>保存到草稿</Button>} others={<Button onClick={()=>setForm(null)}>取消</Button>}/> }>
      <div className="rd-form-stack e6-hw-drawer" onBlurCapture={event=>{const name=(event.target as HTMLInputElement).name;if(name)setTouched(old=>new Set([...old,name]));}}>
        <Facts><Fact k="机型">{formIndex === null ? "新增机型" : rules[formIndex].model}</Fact><Fact k="匹配范围">运营预设的平台算力</Fact></Facts>
        <Field label="规则编号" required hint="1–64 位" help="字母、数字、短横线和下划线；已发布编号只读。" error={fieldIssue("id")}><Input name="id" value={form.rule.id} maxLength={64} disabled={form.id !== null && publishedIds.has(form.id)} onChange={event=>setForm({...form,rule:{...form.rule,id:event.target.value}})}/></Field>
        <Field label="规范机型名" required hint="最多 128 字" error={fieldIssue("model")}><Input name="model" value={form.rule.model} maxLength={128} placeholder="例如 iPhone 16 Pro" onChange={event=>setForm({...form,rule:{...form.rule,model:event.target.value}})}/></Field>
        <Field label="算力下限（含）" required hint="正数 · 最多 2 位小数" error={fieldIssue("minComputeValue")}><Input name="minComputeValue" type="number" min="0" step="0.01" value={Number.isFinite(form.rule.minComputeValue)?form.rule.minComputeValue:""} onChange={event=>setForm({...form,rule:{...form.rule,minComputeValue:event.target.value?Number(event.target.value):NaN}})}/></Field>
        <Field label="算力上限（含）" required hint="不低于下限 · 最高 1000000" help="上下限相等时为固定值。" error={fieldIssue("maxComputeValue")}><Input name="maxComputeValue" type="number" min="0" step="0.01" value={Number.isFinite(form.rule.maxComputeValue)?form.rule.maxComputeValue:""} onChange={event=>setForm({...form,rule:{...form.rule,maxComputeValue:event.target.value?Number(event.target.value):NaN}})}/></Field>
        <Field label="目录分类"><Select aria-label="机型目录分类" value={form.rule.catalogClass??"OPERATOR_ADDED"} onChange={value=>setForm({...form,rule:{...form.rule,catalogClass:value as IosCatalogClass}})} options={Object.entries(IOS_CATALOG_LABELS).map(([value,label])=>({value,label}))}/></Field>
        <Check label="参加后续校准匹配" checked={form.rule.enabled} onChange={event=>setForm({...form,rule:{...form.rule,enabled:event.target.checked}})}/>
        <Field label="已核验别名" hint="最多 20 个" help="每行一个 SDK 返回的名称或硬件标识符，每个最多 128 字。" error={fieldIssue("aliases")}><Textarea name="aliases" rows={3} value={form.aliases} onChange={event=>setForm({...form,aliases:event.target.value})}/></Field>
        <div className="e6-hw-form-heading"><strong>设备信息</strong><Explain label="设备信息的说明" content="选填，用于机型风控；不确定就留空，留空不检查。"/></div>
        <Field label="出厂系统版本" hint="选填 · 最多 8 字符" error={fieldIssue("minOsVersion")}><Input name="minOsVersion" value={form.rule.minOsVersion??""} maxLength={8} placeholder="例如 18.0" onChange={event=>setForm({...form,rule:{...form.rule,minOsVersion:event.target.value.trim()||null}})}/></Field>
        <Field label="最高可升级大版本" hint="选填 · 1–99 整数" error={fieldIssue("maxOsMajor")}><Input name="maxOsMajor" type="number" min="1" max="99" step="1" value={form.rule.maxOsMajor??""} placeholder="仍支持就留空" onChange={event=>setForm({...form,rule:{...form.rule,maxOsMajor:event.target.value?Number(event.target.value):null}})}/></Field>
        <Field label="屏幕倍率" hint="选填 · 1、2 或 3" error={fieldIssue("scales")}><Input name="scales" value={form.scales} maxLength={16} placeholder="例如 3" onChange={event=>setForm({...form,scales:event.target.value})}/></Field>
        <Field label="屏幕尺寸" hint="选填 · 最多 10 组" help="逻辑点，每行一组，含放大显示模式；横竖视为同组。" error={fieldIssue("screens")}><Textarea name="screens" rows={2} value={form.screens} placeholder="402x874" onChange={event=>setForm({...form,screens:event.target.value})}/></Field>
        <Field label="运营说明" hint="选填 · 最多 500 字" error={fieldIssue("note")}><Input name="note" value={form.rule.note??""} maxLength={500} onChange={event=>setForm({...form,rule:{...form.rule,note:event.target.value||null}})}/></Field>
      </div>
    </Drawer>}
  </fieldset>;
}
