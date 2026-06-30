"use client";

/**
 * K6 交互式规则树编辑器(SPEC 4 · PRD §6.2 / §6.3 / §14)。headline②。
 * 递归编辑 RuleGroup:组合方式(全部/任一/满足N条/排除/加权评分)+ 规则增删改 + 嵌套组。
 * 🔴 字段 / 操作符 / 枚举值一律下拉(不手输工程字段名);label 由 field+op+value 自动生成自然语言。
 */
import { Plus, Trash2 } from "lucide-react";
import { OP_SYMBOL, RULE_FIELDS, autoRuleLabel, ruleFieldDef } from "@/lib/mock/admin/janus-c2/rules-catalog";
import { CHANNEL_LABEL, RULE_MODE_LABEL, STATUS_LABEL } from "@/lib/mock/admin/janus-c2/labels";
import { isRuleGroup, type Rule, type RuleGroup, type RuleMode, type RuleOp } from "@/lib/mock/admin/janus-c2/types";

const MODES: RuleMode[] = ["ALL", "ANY", "N_OF_M", "NOT", "WEIGHTED_SCORE"];
const CATEGORIES = [...new Set(RULE_FIELDS.map((f) => f.category))];

function defaultRule(): Rule {
  const d = RULE_FIELDS[0];
  return { field: d.field, op: d.ops[0], value: d.defaultValue, label: autoRuleLabel(d.field, d.ops[0], d.defaultValue) };
}
function enumOptionLabel(field: string, opt: string): string {
  if (field === "channel") return CHANNEL_LABEL[opt] ?? opt;
  if (field === "status") return STATUS_LABEL[opt as keyof typeof STATUS_LABEL] ?? opt;
  return opt;
}

const toValueArray = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((x) => String(x ?? ""));
  const single = String(value ?? "");
  return single ? [single] : [];
};

const defaultMultiValue = (value: unknown, fallback = ""): string[] => {
  const rows = toValueArray(value);
  return rows.length ? rows : [fallback];
};

function MultiValueInput({ value, onValue }: { value: unknown; onValue: (v: unknown[]) => void }) {
  const rows = defaultMultiValue(value);
  const setAt = (idx: number, nextValue: string) => {
    const next = [...rows];
    next[idx] = nextValue;
    onValue(next);
  };
  const removeAt = (idx: number) => {
    const next = rows.filter((_, i) => i !== idx);
    onValue(next.length ? next : []);
  };
  return (
    <span className="k6-multi-values" aria-label="取值列表">
      {rows.map((v, idx) => (
        <span className="k6-multi-value" key={idx}>
          <input className="k6-field" value={v} onChange={(e) => setAt(idx, e.target.value)} placeholder={`取值 ${idx + 1}`} aria-label={`取值 ${idx + 1}`} />
          <button type="button" className="k6-rl-del" onClick={() => removeAt(idx)} aria-label={`删除取值 ${idx + 1}`}><Trash2 size={14} aria-hidden /></button>
        </span>
      ))}
      <button type="button" className="k6-pgbtn" onClick={() => onValue([...rows, ""])}><Plus size={13} aria-hidden /> 添加取值</button>
    </span>
  );
}

function MultiEnumInput({ field, value, options, onValue }: { field: string; value: unknown; options: string[]; onValue: (v: unknown[]) => void }) {
  const first = options[0] ?? "";
  const rows = defaultMultiValue(value, first);
  const setAt = (idx: number, nextValue: string) => {
    const next = [...rows];
    next[idx] = nextValue;
    onValue(next.filter(Boolean));
  };
  const removeAt = (idx: number) => {
    const next = rows.filter((_, i) => i !== idx).filter(Boolean);
    onValue(next);
  };
  return (
    <span className="k6-multi-values" aria-label="取值列表">
      {rows.map((v, idx) => (
        <span className="k6-multi-value" key={idx}>
          <select className="k6-field" value={v || first} onChange={(e) => setAt(idx, e.target.value)} aria-label={`取值 ${idx + 1}`}>
            {options.map((o) => <option key={o} value={o}>{enumOptionLabel(field, o)}</option>)}
          </select>
          <button type="button" className="k6-rl-del" onClick={() => removeAt(idx)} aria-label={`删除取值 ${idx + 1}`}><Trash2 size={14} aria-hidden /></button>
        </span>
      ))}
      <button type="button" className="k6-pgbtn" onClick={() => onValue([...rows.filter(Boolean), first])}><Plus size={13} aria-hidden /> 添加取值</button>
    </span>
  );
}

function ValueInput({ rule, onValue }: { rule: Rule; onValue: (v: unknown) => void }) {
  const def = ruleFieldDef(rule.field);
  if (!def) return null;
  if (def.type === "enum" && (rule.op === "in" || rule.op === "notIn")) {
    return <MultiEnumInput field={def.field} options={def.options ?? []} value={rule.value} onValue={onValue} />;
  }
  if (def.type === "multi" || rule.op === "in" || rule.op === "notIn") {
    return <MultiValueInput value={rule.value} onValue={onValue} />;
  }
  if (def.type === "boolean") {
    return (
      <select className="k6-field k6-rl-val" value={String(rule.value)} onChange={(e) => onValue(e.target.value === "true")} aria-label="取值">
        <option value="true">是</option><option value="false">否</option>
      </select>
    );
  }
  if (def.type === "enum") {
    return (
      <select className="k6-field k6-rl-val" value={String(rule.value)} onChange={(e) => onValue(e.target.value)} aria-label="取值">
        {def.options?.map((o) => <option key={o} value={o}>{enumOptionLabel(def.field, o)}</option>)}
      </select>
    );
  }
  if (rule.op === "between") {
    const v = Array.isArray(rule.value) ? (rule.value as number[]) : [0, 0];
    return (
      <span className="k6-rl-between">
        <input className="k6-field" type="number" value={v[0] ?? 0} onChange={(e) => onValue([Number(e.target.value), v[1] ?? 0])} aria-label="下限" />
        <span>–</span>
        <input className="k6-field" type="number" value={v[1] ?? 0} onChange={(e) => onValue([v[0] ?? 0, Number(e.target.value)])} aria-label="上限" />
      </span>
    );
  }
  return <input className="k6-field k6-rl-val" type="number" value={Number(rule.value) || 0} onChange={(e) => onValue(Number(e.target.value))} aria-label="取值" />;
}

function RuleLeaf({ rule, onChange, onRemove, weighted }: { rule: Rule; onChange: (r: Rule) => void; onRemove: () => void; weighted: boolean }) {
  const def = ruleFieldDef(rule.field);
  const apply = (field: string, op: RuleOp, value: unknown, weight?: number) => onChange({ field, op, value, label: autoRuleLabel(field, op, value), weight });
  const normalizeValueForOp = (d: NonNullable<typeof def>, op: RuleOp, current: unknown): unknown => {
    if (op === "between") return Array.isArray(current) ? current : [0, 0];
    if (op === "in" || op === "notIn") {
      const rows = toValueArray(current);
      const fallback = d.type === "enum" ? String(d.defaultValue ?? d.options?.[0] ?? "") : "";
      return rows.length ? rows : (fallback ? [fallback] : []);
    }
    return Array.isArray(current) ? (d.defaultValue ?? "") : current;
  };
  const setField = (field: string) => {
    const d = ruleFieldDef(field);
    if (d) apply(field, d.ops[0], normalizeValueForOp(d, d.ops[0], d.defaultValue), rule.weight);
  };
  return (
    <div className="k6-rl">
      <select className="k6-field k6-rl-field" value={rule.field} onChange={(e) => setField(e.target.value)} aria-label="规则字段">
        {CATEGORIES.map((cat) => (
          <optgroup key={cat} label={cat}>
            {RULE_FIELDS.filter((f) => f.category === cat).map((f) => <option key={f.field} value={f.field}>{f.label}</option>)}
          </optgroup>
        ))}
      </select>
      <select className="k6-field k6-rl-op" value={rule.op} onChange={(e) => {
        const newOp = e.target.value as RuleOp;
        if (def) apply(rule.field, newOp, normalizeValueForOp(def, newOp, rule.value), rule.weight);
      }} aria-label="操作符">
        {def?.ops.map((o) => <option key={o} value={o}>{OP_SYMBOL[o]}</option>)}
      </select>
      <ValueInput rule={rule} onValue={(v) => apply(rule.field, rule.op, v, rule.weight)} />
      {weighted && <input className="k6-field k6-rl-weight" type="number" value={rule.weight ?? 0} onChange={(e) => onChange({ ...rule, weight: Number(e.target.value) })} placeholder="权重" aria-label="权重" />}
      <button className="k6-rl-del" onClick={onRemove} aria-label="删除规则"><Trash2 size={14} aria-hidden /></button>
    </div>
  );
}

function GroupEditor({ group, onChange, onRemove, depth }: { group: RuleGroup; onChange: (g: RuleGroup) => void; onRemove?: () => void; depth: number }) {
  const setChild = (i: number, child: Rule | RuleGroup) => onChange({ ...group, rules: group.rules.map((r, idx) => (idx === i ? child : r)) });
  const removeChild = (i: number) => onChange({ ...group, rules: group.rules.filter((_, idx) => idx !== i) });
  return (
    <div className="k6-rg" style={{ marginLeft: depth ? 14 : 0 }}>
      <div className="k6-rg-head">
        <select className="k6-field k6-rg-mode" value={group.mode} onChange={(e) => onChange({ ...group, mode: e.target.value as RuleMode })} aria-label="组合方式">
          {MODES.map((m) => <option key={m} value={m}>{RULE_MODE_LABEL[m]}</option>)}
        </select>
        {group.mode === "N_OF_M" && (
          <label className="k6-rg-num">满足<input className="k6-field" type="number" value={group.required ?? 1} onChange={(e) => onChange({ ...group, required: Number(e.target.value) })} aria-label="满足条数" />条</label>
        )}
        {group.mode === "WEIGHTED_SCORE" && (
          <label className="k6-rg-num">阈值≥<input className="k6-field" type="number" value={group.threshold ?? 0} onChange={(e) => onChange({ ...group, threshold: Number(e.target.value) })} aria-label="命中阈值" /></label>
        )}
        {onRemove && <button className="k6-rl-del" onClick={onRemove} aria-label="删除规则组" style={{ marginLeft: "auto" }}><Trash2 size={14} aria-hidden /></button>}
      </div>
      <div className="k6-rg-body">
        {group.rules.length === 0 && <div className="k6-hint">空规则组,添加规则或子组。</div>}
        {group.rules.map((r, i) => isRuleGroup(r)
          ? <GroupEditor key={i} group={r} onChange={(c) => setChild(i, c)} onRemove={() => removeChild(i)} depth={depth + 1} />
          : <RuleLeaf key={i} rule={r} onChange={(c) => setChild(i, c)} onRemove={() => removeChild(i)} weighted={group.mode === "WEIGHTED_SCORE"} />)}
      </div>
      <div className="k6-rg-add">
        <button className="k6-pgbtn" onClick={() => onChange({ ...group, rules: [...group.rules, defaultRule()] })}><Plus size={13} aria-hidden /> 添加规则</button>
        <button className="k6-pgbtn" onClick={() => onChange({ ...group, rules: [...group.rules, { mode: "ALL", rules: [] }] })}><Plus size={13} aria-hidden /> 添加规则组</button>
      </div>
    </div>
  );
}

export function RuleTreeEditor({ value, onChange }: { value: RuleGroup; onChange: (g: RuleGroup) => void }) {
  return (
    <div className="k6-rule-editor">
      <GroupEditor group={value} onChange={onChange} depth={0} />
    </div>
  );
}
