/**
 * Android chip tiers: one operator-preset range per tier, chips as alias groups with stable keys.
 * The server validates the same constraints; these checks only give the operator field-level feedback.
 */
import { formatRange, normalizeModel } from "./ios-model-rules";

export interface AndroidSocChip { socKey: string; name: string; manufacturer: string; aliases: string[] }
export interface AndroidSocRule {
  id: string; name: string; minComputeValue: number; maxComputeValue: number; enabled: boolean;
  valueSource: "OPERATOR_PRESET"; note: string | null; chips: AndroidSocChip[];
}
/** Preset chips and aliases removed on purpose, so a reload of the presets does not bring them back. */
export interface AndroidPresetRemovals { socKeys: string[]; aliases: string[] }
export const NO_REMOVALS: AndroidPresetRemovals = { socKeys: [], aliases: [] };

/** Identifiers that name a vendor or nothing; the server refuses them as aliases as well. */
export const GENERIC_SOC_IDS = new Set(["qcom", "qualcomm", "mediatek", "mtk", "samsung", "exynos", "google", "unisoc",
  "sprd", "spreadtrum", "unknown", "default", "0", "null"]);
/** Identifiers verified to be shared by different chips; never an alias, a report with only them waits. */
export const AMBIGUOUS_SOC_IDS = new Set(["mt6833"]);
const MAX_TIER_ALIASES = 100;

export type AndroidRuleField = "id" | "name" | "minComputeValue" | "maxComputeValue" | "note" | "chips";
export interface AndroidRuleIssue { index: number; field: AndroidRuleField; message: string }

function valueError(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 1_000_000) return "请输入 0 到 1000000 之间的正数。";
  if (Math.round(value * 100) / 100 !== value) return "最多保留 2 位小数。";
  return null;
}
const text = (value: unknown, max: number) => typeof value === "string" && !!value.trim() && value.length <= max;

/** Field-level problems of the whole tier list; otherRuleIds are the iPhone rule ids sharing one id space. */
export function androidRuleIssues(rules: AndroidSocRule[], otherRuleIds: string[] = []): AndroidRuleIssue[] {
  const issues: AndroidRuleIssue[] = [];
  const ids = new Set(otherRuleIds), socKeys = new Set<string>(), owners = new Map<string, string>();
  if (rules.length > 50) issues.push({ index: -1, field: "id", message: "最多维护 50 个芯片档。" });
  rules.forEach((rule, index) => {
    const add = (field: AndroidRuleField, message: string) => issues.push({ index, field, message });
    if (typeof rule.id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(rule.id)) add("id", "规则编号只支持字母、数字、短横线和下划线，最多 64 位。");
    else if (ids.has(rule.id)) add("id", "规则编号已被其他规则使用。");
    else ids.add(rule.id);
    if (!text(rule.name, 64)) add("name", "请填写档位名称，最多 64 字。");
    const minError = valueError(rule.minComputeValue), maxError = valueError(rule.maxComputeValue);
    if (minError) add("minComputeValue", minError);
    if (maxError) add("maxComputeValue", maxError);
    if (!minError && !maxError && rule.minComputeValue > rule.maxComputeValue) add("maxComputeValue", "上限不能低于下限。");
    if (rule.note !== null && (typeof rule.note !== "string" || rule.note.length > 500)) add("note", "运营说明最多 500 字。");
    let aliases = 0;
    for (const chip of rule.chips) {
      if (!/^[a-z0-9_-]{1,64}$/.test(chip.socKey) || socKeys.has(chip.socKey)) { add("chips", `芯片编号「${chip.socKey}」无效或重复。`); continue; }
      socKeys.add(chip.socKey);
      if (!text(chip.name, 128) || !text(chip.manufacturer, 64)) add("chips", `芯片「${chip.socKey}」请填写名称和厂商。`);
      if (chip.aliases.length === 0) add("chips", `${chip.name || chip.socKey} 至少需要一个已核验的芯片标识。`);
      for (const alias of chip.aliases) {
        const id = normalizeModel(alias);
        if (!text(alias, 128) || GENERIC_SOC_IDS.has(id)) add("chips", `「${alias}」是通称，不能指向具体芯片。`);
        else if (AMBIGUOUS_SOC_IDS.has(id)) add("chips", `「${alias}」被多颗芯片共用，不能作为匹配标识。`);
        else if (owners.has(id)) add("chips", `「${alias}」已属于 ${owners.get(id)}，一个标识只能指向一颗芯片。`);
        else owners.set(id, chip.name || chip.socKey);
      }
      aliases += chip.aliases.length;
    }
    if (aliases > MAX_TIER_ALIASES) add("chips", `每档芯片标识合计最多 ${MAX_TIER_ALIASES} 个。`);
  });
  return issues;
}

/** Shape check for tiers read from the server; any mismatch makes the whole response unreadable. */
export function isAndroidSocRule(value: unknown): value is AndroidSocRule {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const rule = value as Record<string, unknown>;
  return typeof rule.id === "string" && typeof rule.name === "string" && typeof rule.minComputeValue === "number"
    && typeof rule.maxComputeValue === "number" && typeof rule.enabled === "boolean" && rule.valueSource === "OPERATOR_PRESET"
    && (rule.note === null || rule.note === undefined || typeof rule.note === "string") && Array.isArray(rule.chips)
    && rule.chips.every(chip => !!chip && typeof chip === "object" && typeof chip.socKey === "string" && typeof chip.name === "string"
      && typeof chip.manufacturer === "string" && Array.isArray(chip.aliases) && chip.aliases.every((alias: unknown) => typeof alias === "string"));
}
export function normalizeAndroidRule(rule: AndroidSocRule): AndroidSocRule {
  return { ...rule, note: rule.note ?? null, chips: rule.chips.map(chip => ({ ...chip, aliases: [...chip.aliases] })) };
}
export function normalizeRemovals(value: unknown): AndroidPresetRemovals {
  const list = (items: unknown) => Array.isArray(items) ? items.filter((item): item is string => typeof item === "string") : [];
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return { socKeys: list(record.socKeys), aliases: list(record.aliases) };
}

/** Moves a chip with all of its aliases; aliases are never split across tiers. */
export function moveChip(rules: AndroidSocRule[], socKey: string, toRuleId: string): AndroidSocRule[] {
  const chip = rules.flatMap(rule => rule.chips).find(item => item.socKey === socKey);
  if (!chip) return rules;
  return rules.map(rule => ({ ...rule, chips: rule.id === toRuleId
    ? [...rule.chips.filter(item => item.socKey !== socKey), chip] : rule.chips.filter(item => item.socKey !== socKey) }));
}
/** Removing a chip or alias records it, so reloading the presets does not quietly restore it. */
export function removeChip(rules: AndroidSocRule[], removals: AndroidPresetRemovals, socKey: string) {
  return { rules: rules.map(rule => ({ ...rule, chips: rule.chips.filter(chip => chip.socKey !== socKey) })),
    removals: { ...removals, socKeys: [...new Set([...removals.socKeys, socKey])] } };
}
export function setChipAliases(rules: AndroidSocRule[], removals: AndroidPresetRemovals, socKey: string, aliases: string[]) {
  const before = rules.flatMap(rule => rule.chips).find(chip => chip.socKey === socKey)?.aliases ?? [];
  const kept = new Set(aliases.map(normalizeModel));
  const dropped = before.filter(alias => !kept.has(normalizeModel(alias)));
  return { rules: rules.map(rule => ({ ...rule, chips: rule.chips.map(chip => chip.socKey === socKey ? { ...chip, aliases } : chip) })),
    removals: { ...removals, aliases: [...new Set([...removals.aliases, ...dropped])] } };
}

export type AndroidChangeKind = "added" | "modified" | "disabled" | "enabled" | "removed";
export interface AndroidRuleChange { kind: AndroidChangeKind; id: string; name: string; details: string[] }
/** Tier changes from the published rules to the draft by stable id: range, state, and chips moved, added or removed. */
export function diffAndroidRules(before: AndroidSocRule[], after: AndroidSocRule[]): AndroidRuleChange[] {
  const old = new Map(before.map(rule => [rule.id, rule]));
  const tierOf = (rules: AndroidSocRule[]) => new Map(rules.flatMap(rule => rule.chips.map(chip => [chip.socKey, rule] as const)));
  const oldTier = tierOf(before), oldChips = new Map(before.flatMap(rule => rule.chips).map(chip => [chip.socKey, chip]));
  const changes: AndroidRuleChange[] = [];
  for (const rule of after) {
    const prior = old.get(rule.id);
    old.delete(rule.id);
    const details: string[] = [];
    if (!prior) {
      changes.push({ kind: "added", id: rule.id, name: rule.name, details: [`范围 ${formatRange(rule)}`, `芯片 ${rule.chips.length} 颗`] });
      continue;
    }
    if (prior.name !== rule.name) details.push(`名称 ${prior.name} → ${rule.name}`);
    if (formatRange(prior) !== formatRange(rule)) details.push(`范围 ${formatRange(prior)} → ${formatRange(rule)}`);
    for (const chip of rule.chips) {
      const from = oldTier.get(chip.socKey);
      if (!from) details.push(`新增芯片 ${chip.name}`);
      else if (from.id !== rule.id) details.push(`${chip.name} 从「${from.name}」移入`);
      const priorAliases = new Set((oldChips.get(chip.socKey)?.aliases ?? []).map(normalizeModel));
      const added = chip.aliases.filter(alias => !priorAliases.has(normalizeModel(alias)));
      const removed = (oldChips.get(chip.socKey)?.aliases ?? []).filter(alias => !chip.aliases.some(item => normalizeModel(item) === normalizeModel(alias)));
      if (from && (added.length || removed.length)) details.push(`${chip.name} 标识 ${[...added.map(a => `+${a}`), ...removed.map(a => `−${a}`)].join(" ")}`);
    }
    const afterKeys = new Set(after.flatMap(item => item.chips.map(chip => chip.socKey)));
    for (const chip of prior.chips) if (!afterKeys.has(chip.socKey)) details.push(`删除芯片 ${chip.name}`);
    if (prior.enabled !== rule.enabled) changes.push({ kind: rule.enabled ? "enabled" : "disabled", id: rule.id, name: rule.name, details });
    else if (details.length) changes.push({ kind: "modified", id: rule.id, name: rule.name, details });
  }
  for (const rule of old.values()) changes.push({ kind: "removed", id: rule.id, name: rule.name, details: [`范围 ${formatRange(rule)}`, `芯片 ${rule.chips.length} 颗`] });
  return changes;
}

export function blankAndroidRule(existing: AndroidSocRule[], otherRuleIds: string[] = []): AndroidSocRule {
  const ids = new Set([...otherRuleIds, ...existing.map(rule => rule.id)]);
  let n = existing.length + 1;
  while (ids.has(`soc-tier-${n}`)) n++;
  return { id: `soc-tier-${n}`, name: "", minComputeValue: NaN, maxComputeValue: NaN, enabled: true, valueSource: "OPERATOR_PRESET", note: null, chips: [] };
}
