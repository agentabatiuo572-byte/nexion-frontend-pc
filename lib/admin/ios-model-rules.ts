/**
 * iPhone model rules: one rule per model regardless of storage, colour or
 * regional SKU, with an operator-preset compute range. The server validates the
 * same constraints; these checks only give the operator field-level feedback.
 */
export type IosCatalogClass = "APPLE_CURRENT_SNAPSHOT" | "APPLE_RELEASED_HISTORICAL" | "OPERATOR_ADDED";
export interface IosModelRule {
  id: string; model: string; aliases: string[]; minComputeValue: number; maxComputeValue: number;
  enabled: boolean; valueSource: "OPERATOR_PRESET"; catalogClass: IosCatalogClass | null; note: string | null;
  /** Device facts for the model consistency checks; empty skips that check. */
  minOsVersion: string | null; maxOsMajor: number | null; scales: number[]; screens: string[];
}
export interface IosModelPresetCatalog {
  catalogVersion: string; verifiedOn: string; scope: string; sources: string[]; notice: string; models: IosModelRule[];
}
export type IosRuleField = "id" | "model" | "aliases" | "minComputeValue" | "maxComputeValue" | "note"
  | "minOsVersion" | "maxOsMajor" | "scales" | "screens";
export interface IosRuleIssue { index: number; field: IosRuleField; message: string }

export const IOS_CATALOG_LABELS: Record<IosCatalogClass, string> = {
  APPLE_CURRENT_SNAPSHOT: "官方在售机型", APPLE_RELEASED_HISTORICAL: "历史已售", OPERATOR_ADDED: "运营新增",
};
/** Names that identify no specific model; the server refuses them as well. */
const GENERIC = new Set(["iphone", "apple iphone", "apple", "ios", "unknown"]);
const MAX_VALUE = 1_000_000;
const MAX_RULES = 500;

/** Same normalization as the server: NFKC, trimmed, single spaces, lower case. */
export function normalizeModel(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
function hasControl(value: string): boolean {
  for (const char of value) { const code = char.codePointAt(0)!; if (code < 32 || (code >= 127 && code < 160)) return true; }
  return false;
}
function nameError(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return "请填写机型名称。";
  if (value.length > 128 || hasControl(value)) return "机型名称最多 128 个字符，且不能含控制字符。";
  if (GENERIC.has(normalizeModel(value))) return "「iPhone」等通称不能指向具体机型。";
  return null;
}
function valueError(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > MAX_VALUE) return "请输入 0 到 1000000 之间的正数。";
  if (Math.round(value * 100) / 100 !== value) return "最多保留 2 位小数。";
  return null;
}
/** "17", "17.5" or "17.5.1" as [major, minor]; anything else is null. Same as the server. */
export function osVersionParts(value: string): [number, number] | null {
  const text = value.trim();
  if (!/^\d{1,2}(\.\d{1,2}){0,2}$/.test(text)) return null;
  const [major, minor = "0"] = text.split(".");
  return Number(major) < 1 ? null : [Number(major), Number(minor)];
}
/** "WxH" in points as "short x long", so either orientation compares equal. */
export function screenKey(value: string): string | null {
  if (!/^\d{3,4}x\d{3,4}$/.test(value)) return null;
  const [a, b] = value.split("x").map(Number);
  return `${Math.min(a, b)}x${Math.max(a, b)}`;
}
function factIssues(rule: IosModelRule, add: (field: IosRuleField, message: string) => void) {
  // A rule written before these facts existed has none of them, which skips the checks.
  const minOs = rule.minOsVersion ?? null, maxOs = rule.maxOsMajor ?? null, scales = rule.scales ?? [], screens = rule.screens ?? [];
  const min = minOs === null ? null : osVersionParts(minOs);
  if (minOs !== null && !min) add("minOsVersion", "请填写如 17.0 的系统版本。");
  if (maxOs !== null && (!Number.isInteger(maxOs) || maxOs < 1 || maxOs > 99)) add("maxOsMajor", "请填写 1 到 99 的整数大版本。");
  else if (maxOs !== null && min && maxOs < min[0]) add("maxOsMajor", "最高大版本不能低于出厂系统版本。");
  if (!Array.isArray(scales) || scales.length > 3 || new Set(scales).size !== scales.length
      || scales.some(scale => ![1, 2, 3].includes(scale))) add("scales", "倍率只能是 1、2 或 3，不能重复。");
  if (!Array.isArray(screens) || screens.length > 10 || new Set(screens).size !== screens.length
      || screens.some(screen => !screenKey(screen))) add("screens", "屏幕尺寸写成 402x874，最多 10 组，不能重复。");
}

export function namesOf(rule: Pick<IosModelRule, "model" | "aliases">): string[] {
  return [rule.model, ...rule.aliases].map(normalizeModel);
}

/** Field-level problems of the whole list, in order; an empty list means the server would accept it. */
export function iosRuleIssues(rules: IosModelRule[], otherRuleIds: string[] = []): IosRuleIssue[] {
  const issues: IosRuleIssue[] = [];
  const ids = new Set(otherRuleIds);
  const owners = new Map<string, number>();
  if (rules.length > MAX_RULES) issues.push({ index: -1, field: "id", message: "最多维护 500 个 iPhone 机型。" });
  rules.forEach((rule, index) => {
    const add = (field: IosRuleField, message: string) => issues.push({ index, field, message });
    if (typeof rule.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(rule.id)) add("id", "规则编号只支持字母、数字、短横线和下划线，最多 64 位。");
    else if (ids.has(rule.id)) add("id", "规则编号已被其他规则使用。");
    else ids.add(rule.id);
    const modelError = nameError(rule.model);
    if (modelError) add("model", modelError);
    if (!Array.isArray(rule.aliases) || rule.aliases.length > 20) add("aliases", "每个机型最多 20 个别名。");
    else for (const alias of rule.aliases) { const error = nameError(alias); if (error) { add("aliases", `别名「${alias}」：${error}`); break; } }
    const minError = valueError(rule.minComputeValue), maxError = valueError(rule.maxComputeValue);
    if (minError) add("minComputeValue", minError);
    if (maxError) add("maxComputeValue", maxError);
    if (!minError && !maxError && rule.minComputeValue > rule.maxComputeValue) add("maxComputeValue", "上限不能低于下限。");
    if (rule.note !== null && (typeof rule.note !== "string" || rule.note.length > 500 || hasControl(rule.note))) add("note", "运营说明最多 500 字。");
    factIssues(rule, add);
    if (modelError || !Array.isArray(rule.aliases)) return;
    for (const name of new Set(namesOf(rule))) {
      const owner = owners.get(name);
      if (owner !== undefined) { add(name === normalizeModel(rule.model) ? "model" : "aliases", `「${name}」已属于 ${rules[owner].model}，同一名称只能指向一个机型。`); break; }
      owners.set(name, index);
    }
  });
  return issues;
}

/** Problems of one edited rule. It is checked last, so a clash with any other rule is reported on it, not on the other rule. */
export function iosRuleFormIssues(rules: IosModelRule[], index: number | null, candidate: IosModelRule, otherRuleIds: string[] = []): IosRuleIssue[] {
  const others = rules.filter((_, i) => i !== index);
  return iosRuleIssues([...others, candidate], otherRuleIds).filter(issue => issue.index === others.length);
}

/** Shape check for rules read from the server; any mismatch makes the whole response unreadable. */
export function isIosModelRule(value: unknown): value is IosModelRule {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rule = value as Record<string, unknown>;
  return typeof rule.id === "string" && typeof rule.model === "string" && Array.isArray(rule.aliases)
    && rule.aliases.every(alias => typeof alias === "string") && typeof rule.minComputeValue === "number"
    && typeof rule.maxComputeValue === "number" && typeof rule.enabled === "boolean" && rule.valueSource === "OPERATOR_PRESET"
    && (rule.catalogClass === null || rule.catalogClass === undefined || (typeof rule.catalogClass === "string" && rule.catalogClass in IOS_CATALOG_LABELS))
    && (rule.note === null || rule.note === undefined || typeof rule.note === "string")
    && (rule.minOsVersion === null || rule.minOsVersion === undefined || typeof rule.minOsVersion === "string")
    && (rule.maxOsMajor === null || rule.maxOsMajor === undefined || typeof rule.maxOsMajor === "number")
    && (rule.scales === null || rule.scales === undefined || (Array.isArray(rule.scales) && rule.scales.every(scale => typeof scale === "number")))
    && (rule.screens === null || rule.screens === undefined || (Array.isArray(rule.screens) && rule.screens.every(screen => typeof screen === "string")));
}
/** Rules stored before the device facts existed read as having none. */
export function normalizeIosRule(rule: IosModelRule): IosModelRule {
  return { ...rule, aliases: [...rule.aliases], catalogClass: rule.catalogClass ?? null, note: rule.note ?? null,
    minOsVersion: rule.minOsVersion ?? null, maxOsMajor: rule.maxOsMajor ?? null, scales: [...(rule.scales ?? [])], screens: [...(rule.screens ?? [])] };
}
/** Device facts as one line for lists and diffs. */
export function formatFacts(rule: Pick<IosModelRule, "minOsVersion" | "maxOsMajor" | "scales" | "screens">): string {
  const parts = [
    rule.minOsVersion || rule.maxOsMajor ? `iOS ${rule.minOsVersion ?? "?"}–${rule.maxOsMajor ?? "最新"}` : "",
    rule.scales?.length ? `@${rule.scales.join("/")}x` : "",
    rule.screens?.length ? rule.screens.join("、") : "",
  ].filter(Boolean);
  return parts.join(" · ") || "未填写";
}

export type IosDeviceFacts = Pick<IosModelRule, "minOsVersion" | "maxOsMajor" | "scales" | "screens">;
/** factsFilled: models already in the draft without any device facts, which the preset fills in. */
export interface IosImportPlan { added: IosModelRule[]; skipped: IosModelRule[]; conflicts: Array<{ preset: IosModelRule; reason: string }>;
  factsFilled: Array<{ id: string; model: string; facts: IosDeviceFacts }> }
const factsOf = (rule: IosModelRule): IosDeviceFacts => ({ minOsVersion: rule.minOsVersion ?? null, maxOsMajor: rule.maxOsMajor ?? null,
  scales: [...(rule.scales ?? [])], screens: [...(rule.screens ?? [])] });
const hasFacts = (facts: IosDeviceFacts) => facts.minOsVersion !== null || facts.maxOsMajor !== null || facts.scales.length > 0 || facts.screens.length > 0;
/**
 * Only fills models the draft lacks. A preset whose model already exists is skipped, so ranges,
 * aliases and the disabled state an operator maintained are never overwritten; it only supplies
 * device facts to an existing model that has none.
 * Android rule ids share one id space with iPhone rules on the server.
 */
export function planIosImport(draft: IosModelRule[], presets: IosModelRule[], otherRuleIds: string[] = []): IosImportPlan {
  const plan: IosImportPlan = { added: [], skipped: [], conflicts: [], factsFilled: [] };
  const byModel = new Map(draft.map(rule => [normalizeModel(rule.model), rule]));
  const owners = new Map<string, string>();
  for (const rule of draft) for (const name of namesOf(rule)) owners.set(name, rule.model);
  const ids = new Set([...otherRuleIds, ...draft.map(rule => rule.id)]);
  for (const preset of presets) {
    const existing = byModel.get(normalizeModel(preset.model));
    if (existing) {
      // Device facts are only added where the operator has none; ranges, aliases and states stay untouched.
      if (!hasFacts(factsOf(existing)) && hasFacts(factsOf(preset))) plan.factsFilled.push({ id: existing.id, model: existing.model, facts: factsOf(preset) });
      plan.skipped.push(preset);
      continue;
    }
    const taken = namesOf(preset).find(name => owners.has(name));
    if (taken) { plan.conflicts.push({ preset, reason: `「${taken}」已属于 ${owners.get(taken)}` }); continue; }
    if (ids.has(preset.id)) { plan.conflicts.push({ preset, reason: `规则编号 ${preset.id} 已被使用` }); continue; }
    if (draft.length + plan.added.length >= MAX_RULES) { plan.conflicts.push({ preset, reason: `已达 ${MAX_RULES} 个机型上限` }); continue; }
    plan.added.push(normalizeIosRule(preset));
    for (const name of namesOf(preset)) owners.set(name, preset.model);
    ids.add(preset.id);
  }
  return plan;
}

export type IosRuleChangeKind = "added" | "modified" | "disabled" | "enabled" | "removed";
export interface IosRuleChange { kind: IosRuleChangeKind; id: string; before: IosModelRule | null; after: IosModelRule | null; details: string[] }
export const IOS_CHANGE_LABELS: Record<IosRuleChangeKind, string> = {
  added: "新增", modified: "修改", disabled: "停用", enabled: "启用", removed: "删除",
};
const bound = (value: number | null | undefined) => typeof value === "number" && Number.isFinite(value) ? String(value) : "?";
/** The one display form of a range, also for a half-filled draft. */
export const formatRange = (rule: { minComputeValue?: number | null; maxComputeValue?: number | null }) =>
  `${bound(rule.minComputeValue)}–${bound(rule.maxComputeValue)}`;
/** Changes from the published rules to the draft, matched by stable rule id. */
export function diffIosRules(before: IosModelRule[], after: IosModelRule[]): IosRuleChange[] {
  const old = new Map(before.map(rule => [rule.id, rule]));
  const changes: IosRuleChange[] = [];
  for (const rule of after) {
    const prior = old.get(rule.id);
    old.delete(rule.id);
    if (!prior) {
      changes.push({ kind: "added", id: rule.id, before: null, after: rule, details: [`范围 ${formatRange(rule)}`, ...(rule.enabled ? [] : ["停用"])] });
      continue;
    }
    const details: string[] = [];
    if (prior.model !== rule.model) details.push(`机型 ${prior.model} → ${rule.model}`);
    if (formatRange(prior) !== formatRange(rule)) details.push(`范围 ${formatRange(prior)} → ${formatRange(rule)}`);
    if (prior.aliases.join("\n") !== rule.aliases.join("\n")) details.push(`别名 ${prior.aliases.join("、") || "无"} → ${rule.aliases.join("、") || "无"}`);
    if ((prior.note ?? "") !== (rule.note ?? "") || (prior.catalogClass ?? null) !== (rule.catalogClass ?? null)) details.push("说明或目录分类已修改");
    if (formatFacts(prior) !== formatFacts(rule)) details.push(`设备信息 ${formatFacts(prior)} → ${formatFacts(rule)}`);
    if (prior.enabled !== rule.enabled) changes.push({ kind: rule.enabled ? "enabled" : "disabled", id: rule.id, before: prior, after: rule, details });
    else if (details.length) changes.push({ kind: "modified", id: rule.id, before: prior, after: rule, details });
  }
  for (const rule of old.values()) changes.push({ kind: "removed", id: rule.id, before: rule, after: null, details: [`范围 ${formatRange(rule)}`] });
  return changes;
}

export function blankIosRule(existing: IosModelRule[], otherRuleIds: string[] = []): IosModelRule {
  const ids = new Set([...otherRuleIds, ...existing.map(rule => rule.id)]);
  let n = existing.length + 1;
  while (ids.has(`ios-operator-${n}`)) n++;
  return { id: `ios-operator-${n}`, model: "", aliases: [], minComputeValue: NaN, maxComputeValue: NaN,
    enabled: true, valueSource: "OPERATOR_PRESET", catalogClass: "OPERATOR_ADDED", note: null,
    minOsVersion: null, maxOsMajor: null, scales: [], screens: [] };
}
