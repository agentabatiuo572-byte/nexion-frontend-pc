"use client";
import { useEffect, useMemo, useState } from "react";
import { Cpu, FilePenLine } from "lucide-react";
import "./e6-hardware-rules.css";
import { Drawer, Decision, Button, Table, Th, Tr, Td, Explain, BlockState, Fold, Field, Input, Textarea, Check, Select, Facts, Fact, StatusTag, Notice } from "@/app/components/rd";
import { formatRange } from "@/lib/admin/ios-model-rules";
import { androidRuleIssues, applyAndroidImport, blankAndroidRule, diffAndroidRules, moveChip, planAndroidImport, removeChip, setChipAliases,
  type AndroidImportPlan, type AndroidPresetCatalog, type AndroidPresetRemovals, type AndroidSocChip, type AndroidSocRule } from "@/lib/admin/android-soc-rules";
import { fetchAndroidSocPresets } from "@/lib/admin/phone-calibration-client";
import { displayAdminError } from "@/lib/admin/error-messages";

const CHANGE_LABELS = { added: "新增", modified: "修改", disabled: "停用", enabled: "启用", removed: "删除" } as const;
type ChipForm = { tierId: string; chip: AndroidSocChip; aliases: string; isNew: boolean };

/**
 * E6 "Android 芯片档": a few tiers, each with one operator-preset range for all of its chips.
 * Chips move between tiers with all of their identifiers; publishing stays with the panel's A2 flow.
 */
export function AndroidSocTiersSection({ rules, removals, published, iosRuleIds, editing: editable, canWrite, onChange }: {
  rules: AndroidSocRule[]; removals: AndroidPresetRemovals; published: AndroidSocRule[]; iosRuleIds: string[]; editing: boolean; canWrite: boolean;
  onChange: (rules: AndroidSocRule[], removals: AndroidPresetRemovals) => void;
}) {
  const [chipTouched, setChipTouched] = useState(false);
  const [query, setQuery] = useState("");
  const [chipForm, setChipForm] = useState<ChipForm | null>(null);
  const [presets, setPresets] = useState<{ catalog: AndroidPresetCatalog; plan: AndroidImportPlan; restore: boolean } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { if (!editable) { setChipForm(null); setPresets(null); setImportOpen(false); } }, [editable]);
  async function loadPresets() {
    setImportOpen(true); setPresets(null); setLoading(true); setError("");
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
    setPresets(null); setImportOpen(false);
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

  const chipMissing = chipForm && (!chipForm.chip.socKey ? "请填写芯片编号" : !chipForm.chip.name.trim() ? "请填写芯片名称" : !chipForm.chip.manufacturer.trim() ? "请填写厂商" : !chipForm.aliases.trim() ? "至少填写一个已核验标识" : undefined);
  const actions = canWrite && <div className="e6-hw-actions"><Button disabled={!editable || loading || !!chipForm || importOpen} onClick={() => void loadPresets()}>{loading ? "正在读取预设…" : "载入芯片预设"}</Button>
    <Button disabled={!editable} onClick={() => onChange([...rules, blankAndroidRule(rules, iosRuleIds)], removals)}>新增芯片档</Button></div>;

  return <fieldset className="ios-model-rules e6-hw-directory" aria-label="Android 芯片档">
    <legend><span className="e6-actions">Android 芯片档（{rules.length} 档 · {rules.reduce((sum, rule) => sum + rule.chips.length, 0)} 颗芯片）
      <Explain label="Android 芯片匹配的说明" content="按手机芯片匹配，不区分机型和内存。每档一个运营预设区间，档内所有芯片共用；用户首次校准时服务端在区间内取值并保存。芯片连同它的全部标识一起移档，标识不能拆到别的档。"/></span></legend>
    {rules.length > 0 && <div className="e6-hw-tools"><Field label="搜索芯片或标识"><Input value={query} maxLength={64} onChange={event => setQuery(event.target.value)} /></Field>{actions}</div>}
    {error && !importOpen && <Notice tone="warn">{error}</Notice>}
    {importOpen && <Drawer open title="载入芯片预设" icon={Cpu} sub={<StatusTag tone="done" icon={FilePenLine} filled>仅保存草稿</StatusTag>}
      explain="只补草稿中缺少的芯片档、芯片和标识，不改已有的区间、启停和归档。加入草稿后仍需试算和提交审批。"
      onClose={()=>{setImportOpen(false);setPresets(null);}} footer={<Decision primary={presets && <Button variant="primary" disabledReason={!editable ? "硬件草稿暂不可修改" : presets.plan.tiers.length + presets.plan.chips.length + presets.plan.aliases.length === 0 && !(presets.restore && presets.plan.removed.length) ? "没有可加入草稿的内容" : undefined} onClick={applyPresets}>加入草稿</Button>} others={<Button onClick={()=>{setImportOpen(false);setPresets(null);}}>取消</Button>}/> }>
      <div className="rd-form-stack e6-hw-drawer" aria-label="Android 芯片预设导入预览">
        {!presets ? <BlockState state={loading?"loading":"error"} title={loading?"正在读取预设…":"预设加载失败"} detail={error} onRetry={loading?undefined:()=>void loadPresets()}/> : <>
          <Facts><Fact k="新增芯片" lead unit="颗">{presets.plan.chips.length}</Fact><Fact k="新增芯片档">{presets.plan.tiers.length} 档</Fact><Fact k="补充标识">{presets.plan.aliases.length} 个</Fact><Fact k="标识冲突" tone={presets.plan.conflicts.length ? "warn" : undefined}>{presets.plan.conflicts.length} 项</Fact><Fact k="目录版本">{presets.catalog.catalogVersion}</Fact><Fact k="核验日期">{presets.catalog.verifiedOn}</Fact></Facts>
          {presets.plan.conflicts.length > 0 && <Notice tone="warn" title="标识冲突"><ul className="e6-hw-list">{presets.plan.conflicts.map(conflict => <li key={conflict}>{conflict}</li>)}</ul></Notice>}
          <Fold title="将新增芯片档" summary={`${presets.plan.tiers.length} 档`} inset defaultOpen={presets.plan.tiers.length > 0}><ul className="e6-hw-list">{presets.plan.tiers.map(tier => <li key={tier.id}><strong>{tier.name}</strong><span>{formatRange(tier)}</span></li>)}</ul>{!presets.plan.tiers.length && <p>没有待新增芯片档。</p>}</Fold>
          <Fold title="将新增芯片" summary={`${presets.plan.chips.length} 颗`} inset><ul className="e6-hw-list">{presets.plan.chips.map(({tierId,chip}) => <li key={chip.socKey}><strong>{chip.name}</strong><span>{presets.catalog.tiers.find(tier=>tier.id===tierId)?.name ?? tierId} · {chip.manufacturer} · {chip.aliases.join("、")}</span></li>)}</ul>{!presets.plan.chips.length && <p>没有待新增芯片。</p>}</Fold>
          <Fold title="补充标识" summary={`${presets.plan.aliases.length} 个`} inset><ul className="e6-hw-list">{presets.plan.aliases.map(item=><li key={`${item.socKey}-${item.alias}`}><strong>{presets.catalog.tiers.flatMap(tier=>tier.chips).find(chip=>chip.socKey===item.socKey)?.name ?? item.socKey}</strong><span>{item.alias}</span></li>)}</ul>{!presets.plan.aliases.length && <p>没有待补充标识。</p>}</Fold>
          <Fold title="已有芯片 · 保留" summary={`${presets.catalog.tiers.flatMap(tier=>tier.chips).filter(chip=>rules.some(rule=>rule.chips.some(item=>item.socKey===chip.socKey))).length} 颗`} inset><ul className="e6-hw-list">{presets.catalog.tiers.flatMap(tier=>tier.chips).filter(chip=>rules.some(rule=>rule.chips.some(item=>item.socKey===chip.socKey))).map(chip=><li key={chip.socKey}><strong>{chip.name}</strong><span>保留草稿中的范围、启停和归档</span></li>)}</ul></Fold>
          {presets.plan.removed.length > 0 && <><Check label={`恢复之前主动删除的 ${presets.plan.removed.length} 项`} help="默认不恢复。" checked={presets.restore} onChange={event=>setPresets({...presets,restore:event.target.checked})}/><Fold title="主动删除记录" summary={`${presets.plan.removed.length} 项`} inset><ul className="e6-hw-list">{presets.plan.removed.map(item=><li key={`${item.kind}-${item.key}`}>{item.label}</li>)}</ul></Fold></>}
          <Fold title="未收录的芯片与共用标识" summary={`${presets.catalog.excluded.length + presets.catalog.ambiguousIds.length} 项`} inset><ul className="e6-hw-list">{presets.catalog.excluded.map(item=><li key={item.chip}><strong>{item.chip}</strong><span>{item.reason}</span></li>)}{presets.catalog.ambiguousIds.map(item=><li key={item.id}><strong>{item.id} · {item.chips.join("、")}</strong><span>{item.note}</span></li>)}</ul></Fold>
          <Fold title="技术信息" summary="目录原文与来源" inset><p>{presets.catalog.notice}</p><ul className="e6-hw-list">{presets.catalog.sources.map(source=><li key={source}>{source}</li>)}</ul></Fold>
        </>}
      </div>
    </Drawer>}
    {issues.length > 0 && <Notice tone="warn">{issues[0].index >= 0 ? `第 ${issues[0].index + 1} 档：` : ""}{issues[0].message}</Notice>}
    {changes.length > 0 && <Fold title="Android 草稿变化" summary={`${changes.length} 项，尚未发布`} inset>{changes.map(change=><p key={change.id}>{CHANGE_LABELS[change.kind]}「{change.name || change.id}」</p>)}</Fold>}
    {needle && rules.length > 0 && !rules.some(rule=>rule.chips.some(matches)) && <BlockState state="empty" title="没有匹配芯片" detail={<Button size="sm" onClick={()=>setQuery("")}>清空搜索</Button>}/>}
    {rules.length === 0 ? <BlockState state="empty" title="尚无芯片档，Android 校准将进入待核验" detail={actions}/> : rules.map((rule,index)=>{
      const chips=rule.chips.filter(matches);if(needle && !chips.length)return null;
      const change=changes.find(item=>item.id===rule.id);
      const issue=(field:string)=>issues.find(item=>item.index===index && item.field===field)?.message;
      const chipActions=canWrite && <div className="e6-hw-actions"><Button size="sm" disabled={!editable || !!chipForm || importOpen} onClick={()=>{setChipTouched(false);setChipForm({tierId:rule.id,isNew:true,aliases:"",chip:{socKey:"",name:"",manufacturer:"",aliases:[]}});}}>在本档新增芯片</Button>{!rule.chips.length && <Button size="sm" variant="danger-outline" disabled={!editable} onClick={()=>onChange(rules.filter(item=>item.id!==rule.id),removals)}>删除空档</Button>}</div>;
      return <Fold key={rule.id + index} title={rule.name || "未命名档"} summary={<>{formatRange(rule)} · {rule.chips.length} 颗芯片{!rule.enabled && " · 已停用"}{change && ` · ${CHANGE_LABELS[change.kind]}`}</>} inset defaultOpen={!!needle} open={needle ? true : undefined}>
        <div className="e6-hw-tier-form">
          <Field label="档位名称" error={issue("name")}><Input value={rule.name} maxLength={64} disabled={!editable} onChange={event=>update(rule.id,{name:event.target.value})}/></Field>
          <div className="e6-hw-range"><Field label="算力下限（含）" error={issue("minComputeValue")}><Input type="number" min="0" step="0.01" disabled={!editable} value={Number.isFinite(rule.minComputeValue)?rule.minComputeValue:""} onChange={event=>update(rule.id,{minComputeValue:event.target.value?Number(event.target.value):NaN})}/></Field><Field label="算力上限（含）" error={issue("maxComputeValue")}><Input type="number" min="0" step="0.01" disabled={!editable} value={Number.isFinite(rule.maxComputeValue)?rule.maxComputeValue:""} onChange={event=>update(rule.id,{maxComputeValue:event.target.value?Number(event.target.value):NaN})}/></Field></div>
          <Check label="参加后续校准匹配" checked={rule.enabled} disabled={!editable} onChange={event=>update(rule.id,{enabled:event.target.checked})}/>
          <Field label="运营说明" hint="选填 · 最多 500 字" error={issue("note")}><Input value={rule.note??""} maxLength={500} disabled={!editable} onChange={event=>update(rule.id,{note:event.target.value||null})}/></Field>
        </div>
        {!chips.length ? <BlockState state="empty" title="本档暂无芯片" detail={chipActions}/> : <><Table label="Android 芯片目录" className="e6-hw-android-table" data-tight><colgroup><col/><col/><col/><col/></colgroup><thead><Tr><Th>芯片</Th><Th>厂商</Th><Th>已核验标识</Th><Th align="right">操作</Th></Tr></thead><tbody>{chips.map(chip=><Tr key={chip.socKey}><Td><strong>{chip.name}</strong><Explain label={`${chip.name}的技术信息`} content={<>芯片编号：{chip.socKey}</>}/></Td><Td>{chip.manufacturer}</Td><Td><span className="e6-hw-identifiers" title={chip.aliases.join("、")}>{chip.aliases.join("、")}</span></Td><Td><div className="e6-hw-row-actions" hidden={!canWrite}><Select aria-label={`把 ${chip.name} 移到`} value={rule.id} disabled={!editable} onChange={target=>onChange(moveChip(rules,chip.socKey,target),removals)} options={rules.map(target=>({value:target.id,label:`移到 · ${target.name||target.id}`}))}/><Button size="sm" disabled={!editable || !!chipForm || importOpen} onClick={()=>{setChipTouched(false);setChipForm({tierId:rule.id,chip,aliases:chip.aliases.join("\n"),isNew:false});}}>编辑</Button><Button size="sm" variant="ghost" disabled={!editable} onClick={()=>{const next=removeChip(rules,removals,chip.socKey);onChange(next.rules,next.removals);}}>移除</Button></div></Td></Tr>)}</tbody></Table>{chipActions}</>}
      </Fold>;
    })}
    {chipForm && <Drawer open title={chipForm.isNew ? "新增芯片" : `编辑芯片 · ${chipForm.chip.name}`} icon={Cpu} sub={<StatusTag tone="done" icon={FilePenLine} filled>仅保存草稿</StatusTag>} explain="保存后仍需试算并提交审批，审批通过才生效。" onClose={()=>setChipForm(null)} footer={<Decision note={chipMissing} primary={<Button variant="primary" disabledReason={!editable ? "硬件草稿暂不可修改" : chipMissing || undefined} onBlockedClick={()=>setChipTouched(true)} onClick={saveChip}>保存到草稿</Button>} others={<Button onClick={()=>setChipForm(null)}>取消</Button>}/> }>
      <div className="rd-form-stack e6-hw-drawer" onBlurCapture={()=>setChipTouched(true)}>
        <Facts><Fact k="所属芯片档">{rules.find(rule=>rule.id===chipForm.tierId)?.name || "未命名档"}</Fact></Facts>
        <Field label="芯片编号" required hint="1–64 位" help="小写字母、数字、短横线和下划线；已有编号只读。" error={chipTouched && !chipForm.chip.socKey ? "请填写芯片编号" : undefined}><Input value={chipForm.chip.socKey} maxLength={64} disabled={!chipForm.isNew} placeholder="例如 snapdragon-8-gen-2" onChange={event=>setChipForm({...chipForm,chip:{...chipForm.chip,socKey:event.target.value.trim().toLowerCase()}})}/></Field>
        <Field label="芯片名称" required hint="最多 128 字" error={chipTouched && !chipForm.chip.name.trim() ? "请填写芯片名称" : undefined}><Input value={chipForm.chip.name} maxLength={128} placeholder="例如 骁龙 8 Gen 2" onChange={event=>setChipForm({...chipForm,chip:{...chipForm.chip,name:event.target.value}})}/></Field>
        <Field label="厂商" required hint="最多 64 字" error={chipTouched && !chipForm.chip.manufacturer.trim() ? "请填写厂商" : undefined}><Input value={chipForm.chip.manufacturer} maxLength={64} placeholder="例如 高通" onChange={event=>setChipForm({...chipForm,chip:{...chipForm.chip,manufacturer:event.target.value}})}/></Field>
        <Field label="已核验标识" required help="每行一个，例如 SM8550。需两个独立来源确认，多颗芯片共用的标识不能填。" error={chipTouched && !chipForm.aliases.trim() ? "至少填写一个已核验标识" : undefined}><Textarea rows={4} value={chipForm.aliases} onChange={event=>setChipForm({...chipForm,aliases:event.target.value})}/></Field>
      </div>
    </Drawer>}
  </fieldset>;
}
