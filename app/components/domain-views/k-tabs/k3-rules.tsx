"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Archive, Check as CheckIcon, Clock, Coins, FileText, Gauge, History, Pause, Play, Plus, RefreshCw, ShieldAlert, ShieldCheck, SlidersHorizontal, UserCheck, Users } from "lucide-react";
import { BlockState, Button, Cell, Change, Check, ColumnPicker, Conclusion, ConflictBar, Decision, DiffList, Drawer, Explain, Fact, Facts, Field, Fold, JudgmentPoints, KeepText, KeyValues, Modal, MoreMenu, Notice, NumberInput, PageHeader, Pager, Panel, ReleaseBody, Segments, Select, Stat, StatBand, StatusDistributionBar, StatusTag, Table, TableLoading, TableMessage, Td, Textarea, Th, Tr, useTableColumns, type StateTone } from "@/app/components/rd";
import { TipSide } from "@/app/components/rd/button";
import { OperationConfirmModal, type BusinessFormSpec, type BusinessFormValue } from "../design-kit";
import { displayAdminError } from "@/lib/admin/error-messages";
import { executeK3Command, K1OutcomeUncertainError, K1RequestError, newK1CommandKey, type K3CommandRequest, type K3DryRunResult, type K3Hit, type K3RouteCount, type K3Rule, type RuleAction, type RuleState } from "@/lib/admin/k-client";
import { fetchA2ReasonPolicy, visibleReasonLength } from "@/lib/admin/a2-client";
import { announcePermissionDenied, isPermissionDenied } from "@/lib/admin/operation-confirm-error";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { createPendingMutationStore, isRetryExpired, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { businessZone, formatBusinessTimeFull } from "@/lib/admin/business-time";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { useReach } from "@/lib/nav/use-reach";
import { K3_FIELD_HELP } from "@/lib/admin/config-help/k3-rules";
import type { KCtx } from "./types";

const fmt = (n: number) => n.toLocaleString("en-US");
const DIMENSION_LABELS: Record<string, string> = { amount: "金额", velocity: "速度", newAccount: "新账户", addressReputation: "地址信誉", largeAmountUsdt: "金额", velocity24h: "速度", newAccountProtectDays: "新账户", addressReputationSource: "地址信誉" };
type K3RuleKind = "amount" | "velocity" | "newAccount" | "address";
type K3RuleDimensionName = "金额" | "速度" | "新账户" | "地址信誉";
type ParsedCondition = { value: BusinessFormValue | null; conditionParseError: string | null };

const ACTION_LABELS: Record<RuleAction, string> = { pass: "放行", delay: "延迟", freeze: "冻结", manual: "转人工" };
const ACTION_BY_LABEL: Record<string, RuleAction> = {
  延迟: "delay", 冻结: "freeze", 转人工: "manual", delay: "delay", freeze: "freeze", manual: "manual",
};
const DIMENSION_OPTIONS: K3RuleDimensionName[] = ["金额", "速度", "新账户", "地址信誉"];
/** 引擎声明的四个风险维度。服务端评估器支持全部四个,但只有已配置生效规则的维度才真正参与判定。 */
const DECLARED_DIMENSIONS: K3RuleDimensionName[] = ["金额", "速度", "新账户", "地址信誉"];
const ACTION_OPTIONS = [ACTION_LABELS.delay, ACTION_LABELS.manual, ACTION_LABELS.freeze];
const ADDRESS_SOURCE_OPTIONS = ["内部", "第三方", "组合"];
const ADDRESS_SOURCE_VALUE: Record<string, "internal" | "third-party" | "combined"> = {
  内部: "internal", 第三方: "third-party", 组合: "combined",
};
const ADDRESS_SOURCE_LABEL: Record<string, string> = {
  internal: "内部", "third-party": "第三方", combined: "组合",
};

function errorText(error: unknown) { return error instanceof K1OutcomeUncertainError ? UNKNOWN_RESULT_TEXT : error instanceof Error ? displayAdminError(error) : "未知错误"; }
function conditionCore(text: string) { return (text.split(/->|→/)[0] ?? "").trim(); }
function formatMoney(value: string | undefined) {
  const raw = (value ?? "").replaceAll(",", "");
  if (!/^\d+(?:\.0+)?$/.test(raw)) return "";
  const integer = raw.split(".")[0].replace(/^0+(?=\d)/, "");
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}
function dimensionLabel(value: string) { return DIMENSION_LABELS[value] ?? value ?? "—"; }
function conditionDisplay(text: string) {
  return text.replace(/\$([\d,]+(?:\.\d+)?)/g, "$1 USD").replace(/addressReputationSource=(internal|third-party|combined)\s*;\s*addressReputationLowThreshold=([\d.]+)/gi, (_m, source: string, threshold: string) => "地址信誉来源：" + ADDRESS_SOURCE_LABEL[source.toLowerCase()] + "；低信誉阈值：" + threshold).replaceAll(">=", "≥").replaceAll("<=", "≤").replace(/single/gi, "单笔").replace(/24h/gi, "24小时").replace(/withdrawals?/gi, "笔").replace(/registered/gi, "注册").replace(/days?/gi, "天").replace(/\bor\b/gi, "或");
}
function operatorCopy(value: string, fallback: string) {
  return !value || /\bnx_|数据库|database|\bdb\b|mybatis|表字段/i.test(value) ? fallback : value;
}
function k3KindFromDimension(dimension: string, ruleKey = ""): K3RuleKind {
  const text = `${dimension} ${ruleKey}`;
  if (/速度|velocity/i.test(text)) return "velocity";
  if (/新账户|new.?account/i.test(text)) return "newAccount";
  if (/地址信誉|address.?reputation/i.test(text)) return "address";
  return "amount";
}
function dimensionFromForm(value: string | undefined): K3RuleDimensionName {
  return DIMENSION_OPTIONS.includes(value as K3RuleDimensionName) ? value as K3RuleDimensionName : "金额";
}

function parseAddressCondition(core: string): BusinessFormValue | null {
  const canonical = core.match(/^addressReputationSource=(internal|third-party|combined)\s*;\s*addressReputationLowThreshold=(\d+(?:\.\d+)?)$/i);
  if (canonical) {
    const threshold = Number(canonical[2]);
    if (threshold < 0 || threshold > 1) return null;
    return { addressSource: ADDRESS_SOURCE_LABEL[canonical[1].toLowerCase()], addressThreshold: canonical[2] };
  }
  const legacyInternal = /^(?:内部|内部黑名单|黑名单\s*\/\s*低信誉地址)$/;
  const legacyThirdParty = /^(?:第三方|链上信誉|第三方链上信誉)$/;
  const legacyCombined = /^(?:组合|内部黑名单\s*\+\s*链上信誉|内部\s*\+\s*第三方信誉)$/;
  const addressSource = legacyInternal.test(core) ? "内部"
    : legacyThirdParty.test(core) ? "第三方"
      : legacyCombined.test(core) ? "组合" : null;
  return addressSource ? { addressSource, addressThreshold: "0.4" } : null;
}

function addressConditionCopy(text: string) {
  const parsed = parseAddressCondition(conditionCore(text));
  if (!parsed) return text;
  const source = parsed.addressSource;
  const threshold = parsed.addressThreshold;
  return source === "内部"
    ? `来源：内部 · 低信誉 / 黑名单标记（阈值 ${threshold} 不参与）`
    : source === "组合" ? `来源：组合 · 内部低信誉 / 黑名单，或第三方评分 < ${threshold}`
      : `来源：第三方 · 评分 < ${threshold} 判为低信誉`;
}

function parseK3Condition(kind: K3RuleKind, text: string): ParsedCondition {
  const core = conditionCore(text).replace("，", ",");
  if (kind === "amount") {
    const matched = core.match(/^(?:单笔|single)\s*(>=|>)\s*\$?([\d,]+)$/i);
    return matched
      ? { value: { amountOp: matched[1], amount: matched[2].replaceAll(",", "") }, conditionParseError: null }
      : { value: null, conditionParseError: "这条规则的条件格式无法在页面编辑" };
  }
  if (kind === "velocity") {
    const matched = core.match(/^24h\s*(>=|>)\s*(\d+)\s*(?:笔|withdrawals?)\s*(?:或|or)\s*(>=|>)\s*\$?([\d,]+)$/i);
    return matched
      ? { value: { countOp: matched[1], count: matched[2], velocityAmountOp: matched[3], velocityAmount: matched[4].replaceAll(",", "") }, conditionParseError: null }
      : { value: null, conditionParseError: "这条规则的条件格式无法在页面编辑" };
  }
  if (kind === "newAccount") {
    const matched = core.match(/^(?:注册|registered)\s*(<|<=)\s*(\d+)\s*(?:天|days?)$/i);
    return matched
      ? { value: { accountOp: matched[1], days: matched[2] }, conditionParseError: null }
      : { value: null, conditionParseError: "这条规则的条件格式无法在页面编辑" };
  }
  const address = parseAddressCondition(core);
  return address
    ? { value: address, conditionParseError: null }
    : { value: null, conditionParseError: "这条规则的条件格式无法在页面编辑" };
}

function k3RuleBusinessForm(kind: K3RuleKind, current: string, action: RuleAction, priority: number): BusinessFormSpec | null {
  const parsed = parseK3Condition(kind, current);
  if (!parsed.value || parsed.conditionParseError) return null;
  const common = [
    { key: "action", label: "命中处置", current: ACTION_LABELS[action], inputKind: "select" as const, options: ACTION_OPTIONS },
    { key: "priority", label: "优先级", current: String(priority), inputKind: "number" as const, min: 1, max: 100, step: 1 },
  ];
  if (kind === "amount") return { kind: "multi-field", fields: [
    { key: "amountOp", label: "比较符", current: parsed.value.amountOp, inputKind: "select", options: [">=", ">"] },
    { key: "amount", label: "单笔金额（USD）", current: parsed.value.amount, inputKind: "number", min: 100, max: 50000, step: 100 }, ...common,
  ] };
  if (kind === "velocity") return { kind: "multi-field", fields: [
    { key: "countOp", label: "笔数比较符", current: parsed.value.countOp, inputKind: "select", options: [">=", ">"] },
    { key: "count", label: "24小时笔数", current: parsed.value.count, inputKind: "number", min: 1, max: 20, step: 1 },
    { key: "velocityAmountOp", label: "金额比较符", current: parsed.value.velocityAmountOp, inputKind: "select", options: [">=", ">"] },
    { key: "velocityAmount", label: "24小时累计金额（USD）", current: parsed.value.velocityAmount, inputKind: "number", min: 500, max: 50000, step: 500 }, ...common,
  ] };
  if (kind === "newAccount") return { kind: "multi-field", fields: [
    { key: "accountOp", label: "注册天数比较符", current: parsed.value.accountOp, inputKind: "select", options: ["<", "<="] },
    { key: "days", label: "注册天数", current: parsed.value.days, inputKind: "number", min: 0, max: 30, step: 1 }, ...common,
  ] };
  return { kind: "multi-field", fields: [
    { key: "addressSource", label: "信誉来源", current: parsed.value.addressSource, inputKind: "select", options: ADDRESS_SOURCE_OPTIONS, wide: true }, ...common,
    { key: "addressThreshold", label: "低信誉阈值", current: parsed.value.addressThreshold, inputKind: "number", min: 0, max: 1, step: 0.01 },
  ] };
}

function newK3RuleBusinessForm(initialDimension: K3RuleDimensionName = "金额"): BusinessFormSpec {
  return { kind: "multi-field", fields: [
    { key: "dimension", label: "规则类型", current: initialDimension, inputKind: "select", options: DIMENSION_OPTIONS },
    { key: "action", label: "命中处置", current: "延迟", inputKind: "select", options: ACTION_OPTIONS },
    { key: "priority", label: "优先级", current: "50", inputKind: "number", min: 1, max: 100, step: 1 },
    { key: "amountOp", label: "金额比较符", current: ">=", inputKind: "select", options: [">=", ">"], visibleWhen: { key: "dimension", equals: "金额" } },
    { key: "amount", label: "单笔金额（USD）", current: "1000", inputKind: "number", min: 100, max: 50000, step: 100, visibleWhen: { key: "dimension", equals: "金额" } },
    { key: "countOp", label: "笔数比较符", current: ">", inputKind: "select", options: [">=", ">"], visibleWhen: { key: "dimension", equals: "速度" } },
    { key: "count", label: "24小时笔数", current: "3", inputKind: "number", min: 1, max: 20, step: 1, visibleWhen: { key: "dimension", equals: "速度" } },
    { key: "velocityAmountOp", label: "24小时金额比较符", current: ">", inputKind: "select", options: [">=", ">"], visibleWhen: { key: "dimension", equals: "速度" } },
    { key: "velocityAmount", label: "24小时累计金额（USD）", current: "5000", inputKind: "number", min: 500, max: 50000, step: 500, visibleWhen: { key: "dimension", equals: "速度" } },
    { key: "accountOp", label: "注册天数比较符", current: "<", inputKind: "select", options: ["<", "<="], visibleWhen: { key: "dimension", equals: "新账户" } },
    { key: "days", label: "注册天数", current: "7", inputKind: "number", min: 0, max: 30, step: 1, visibleWhen: { key: "dimension", equals: "新账户" } },
    { key: "addressSource", label: "地址信誉来源", current: ADDRESS_SOURCE_OPTIONS[0], inputKind: "select", options: ADDRESS_SOURCE_OPTIONS, wide: true, visibleWhen: { key: "dimension", equals: "地址信誉" } },
    { key: "addressThreshold", label: "低信誉阈值", current: "0.4", inputKind: "number", min: 0, max: 1, step: 0.01, visibleWhen: { key: "dimension", equals: "地址信誉" } },
  ] };
}

function buildK3Condition(kind: K3RuleKind, value?: BusinessFormValue) {
  if (!value) return "";
  if (kind === "amount") return `单笔 ${value.amountOp} $${formatMoney(value.amount)}`;
  if (kind === "velocity") return `24h ${value.countOp} ${Number(value.count)} 笔 或 ${value.velocityAmountOp} $${formatMoney(value.velocityAmount)}`;
  if (kind === "newAccount") return `注册 ${value.accountOp} ${Number(value.days)} 天`;
  const source = ADDRESS_SOURCE_VALUE[value.addressSource ?? ""];
  const threshold = Number(value.addressThreshold);
  if (!source || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) return "";
  return `addressReputationSource=${source}; addressReputationLowThreshold=${threshold}`;
}
function actionFromBusinessValue(value?: BusinessFormValue): RuleAction | null { return ACTION_BY_LABEL[value?.action ?? ""] ?? null; }
function priorityFromBusinessValue(value?: BusinessFormValue) {
  const priority = Number(value?.priority);
  return Number.isInteger(priority) && priority >= 1 && priority <= 100 ? priority : null;
}

const ACTION_TONE: Record<RuleAction, StateTone> = { pass: "ok", delay: "warn", manual: "progress", freeze: "danger" };
const ACTION_ICON = { pass: CheckIcon, delay: Clock, manual: UserCheck, freeze: ShieldAlert };
const STATE_LABEL: Record<RuleState, string> = { draft: "草稿", active: "已启用", paused: "已停用", archived: "已归档" };
const STATE_TONE: Record<RuleState, StateTone> = { draft: "neutral", active: "ok", paused: "done", archived: "done" };
const STATE_ICON = { draft: FileText, active: CheckIcon, paused: Pause, archived: Archive };
const DIM_ICON = { 金额: Coins, 速度: Gauge, 新账户: Users, 地址信誉: ShieldCheck };
const REASON_PLACEHOLDER = "例如：依据提现风险复核工单，调整新账户的检查条件";
const UNKNOWN_RESULT_TEXT = "结果尚未确认，已保留原请求和命令号。请读回核对或按原操作重试。";
const CASH_NOTICE = "这项操作可能让平台多付钱。K3 接口目前不检查资金。";
const ACTIVE_EFFECT = "保存后直接用于后续评估；已创建提现在放行复核时也可能按当前规则判断。";
const CREATE_EFFECT = "先保存草稿，不参与提现检查；启用后才参与后续评估。";
const PAUSE_EFFECT = "之后评估不再使用此规则，可能减少拦截；已有延迟或冻结单不会因此立即打款。";
const ENABLE_EFFECT = "确认后参与之后的提现风控评估；不是放行已有提现。";
const ARCHIVE_EFFECT = "归档后不能编辑或重新启用，此操作不可撤销。";
const SIMULATE_EFFECT = "只产生模拟批次与操作记录，不改变真实提现或账目。";
const SIMULATE_SCOPE = "用当前已启用规则，评估近30天符合后台样本条件的最新最多200笔；使用第三方信誉时最多50笔。草稿与已停用规则不参与。";
type WriteKind = "create" | "edit" | "active" | "paused" | "archived" | "dry-run";
type WriteDraft = { kind: WriteKind; rule?: K3Rule; initialDimension?: K3RuleDimensionName };
type SavedCommand = PendingMutationRecord & {
  actorId: number; kind: WriteKind; target: string; label: string; reason: string;
  request: K3CommandRequest; original: K3Rule | null; activeRules: string[];
  businessValue?: BusinessFormValue; rejected?: boolean; message?: string;
};
/** Session storage is the unknown-input boundary. Old key-only records stay visible, never replayed. */
function isSavedCommand(record: PendingMutationRecord): record is SavedCommand {
  const value = record as Partial<SavedCommand>;
  if (!Number.isSafeInteger(value.actorId) || Number(value.actorId) < 1 || !["create", "edit", "active", "paused", "archived", "dry-run"].includes(value.kind ?? "")
    || typeof value.target !== "string" || typeof value.label !== "string" || typeof value.reason !== "string"
    || !value.request || typeof value.request.body !== "string" || !Array.isArray(value.activeRules)) return false;
  const expectedPath = value.kind === "create" ? "/withdraw-rules" : value.kind === "dry-run" ? "/withdraw-rules/dry-runs"
    : `/withdraw-rules/${encodeURIComponent(value.target)}/${value.kind === "edit" ? "condition" : "status"}`;
  if (value.request.path !== expectedPath || value.request.method !== (value.kind === "create" || value.kind === "dry-run" ? "POST" : "PATCH")) return false;
  try {
    const body = JSON.parse(value.request.body);
    return body !== null && typeof body === "object" && body.reason === value.reason && typeof body.operator === "string";
  } catch { return false; }
}
const commands = createPendingMutationStore<PendingMutationRecord | SavedCommand>({ storageKey: "nexion-admin-k3-rules-commands-v1", retainExpiredRecords: true });
const legacyTarget = (record: PendingMutationRecord) => record.fingerprint.startsWith("dryrun|") ? "sandbox"
  : record.fingerprint.startsWith("create:") ? "create" : record.fingerprint.match(/^(?:edit|state|archive):([^:]+):/)?.[1];
const targetOf = (kind: WriteKind, rule?: K3Rule) => kind === "create" ? "create" : kind === "dry-run" ? "sandbox" : rule!.ruleId;
const targetLabel = (target?: string) => target === "create" ? "新建规则" : target === "sandbox" ? "模拟运行" : target ?? "原对象信息不完整";
const labelOf = (kind: WriteKind, rule?: K3Rule) => kind === "create" ? "新建提现风控规则" : kind === "dry-run" ? "模拟运行（用历史数据试跑）"
  : `${kind === "edit" ? "编辑" : kind === "active" ? "启用" : kind === "paused" ? "停用" : "归档"}规则 · ${rule!.ruleId}`;
const conditionCopy = (rule: Pick<K3Rule, "dimension" | "conditionText">) => k3KindFromDimension(rule.dimension) === "address" ? addressConditionCopy(rule.conditionText) : conditionDisplay(rule.conditionText);
const editableReason = (rule: K3Rule) => rule.state === "archived" ? "已归档规则不能编辑"
  : rule.action === "pass" ? "历史放行规则只可按原权限停用、归档"
    : parseK3Condition(k3KindFromDimension(rule.dimension), rule.conditionText).conditionParseError ?? undefined;
function ConditionText({ text }: { text: string }) {
  return <KeepText text={text} phrases={text.match(/[≥>≤<]\s*[\d,.]+(?:\s*(?:USD|天|笔))?/g) ?? []} />;
}
const hitSummary = (hit: K3Hit) => `${dimensionLabel(hit.dimension)}规则 ${hit.ruleId} 命中 · ${ACTION_LABELS[hit.action]}`;
/** Compare the hit sets defined by the backend evaluator, then the disposition severity. */
function loosensRule(rule: K3Rule, before: BusinessFormValue, after: BusinessFormValue) {
  if (rule.state !== "active") return false;
  const kind = k3KindFromDimension(rule.dimension);
  if ((kind === "newAccount" && before.accountOp === "<" && Number(before.days) === 0) || (kind === "address" && before.addressSource === "第三方" && Number(before.addressThreshold) === 0)) return false;
  const severity = { pass: 0, delay: 1, manual: 2, freeze: 3 };
  if (severity[actionFromBusinessValue(after)!] < severity[rule.action]) return true;
  const lowerNarrows = (value: string, op: string, next: string, nextOp: string) => Number(next) > Number(value) || (Number(next) === Number(value) && op === ">=" && nextOp === ">");
  switch (kind) {
    case "amount": return lowerNarrows(before.amount, before.amountOp, after.amount, after.amountOp);
    case "velocity": {
      const countBefore = Number(before.count) + (before.countOp === ">" ? 1 : 0);
      const countAfter = Number(after.count) + (after.countOp === ">" ? 1 : 0);
      // At least one withdrawal subsumes the old positive count and sum predicates.
      return countAfter > countBefore || (countAfter > 1 && lowerNarrows(before.velocityAmount, before.velocityAmountOp, after.velocityAmount, after.velocityAmountOp));
    }
    case "newAccount": return Number(after.days) - (after.accountOp === "<" ? 1 : 0) < Number(before.days) - (before.accountOp === "<" ? 1 : 0);
    case "address": {
      const losesInternal = before.addressSource !== "第三方" && after.addressSource === "第三方";
      const losesExternal = before.addressSource !== "内部" && Number(before.addressThreshold) > 0 && (after.addressSource === "内部" || Number(after.addressThreshold) < Number(before.addressThreshold));
      return losesInternal || losesExternal;
    }
  }
}
const readPage = (value: string | null) => /^\d+$/.test(value ?? "") && Number.isSafeInteger(Number(value)) && Number(value) >= 1 ? Number(value) : 1;
const readSize = (value: string | null, hits = false) => (hits ? [5, 10, 20, 50] : [5, 10, 20]).includes(Number(value)) ? Number(value) : 5;
function ActionTag({ action }: { action: RuleAction }) { return <StatusTag tone={ACTION_TONE[action]} icon={ACTION_ICON[action]}>{action === "pass" ? "历史放行" : ACTION_LABELS[action]}</StatusTag>; }
function RuleTag({ state }: { state: RuleState }) { return <StatusTag tone={STATE_TONE[state]} icon={STATE_ICON[state]}>{STATE_LABEL[state]}</StatusTag>; }
function RuleFacts({ rule }: { rule: K3Rule }) {
  return <Facts><Fact k="规则">{rule.ruleId}</Fact><Fact k="条件">{conditionCopy(rule)}</Fact><Fact k="命中处置"><ActionTag action={rule.action} /></Fact><Fact k="优先级 / 版本">P{rule.priority} / v{rule.version}</Fact></Facts>;
}
function Distribution({ rows, total, simulation = false }: { rows: K3RouteCount[]; total: number; simulation?: boolean }) {
  const counts = new Map(rows.map((row) => [row.key, row.count]));
  const all = (["pass", "delay", "manual", "freeze"] as const).map((key) => ({ key, label: ACTION_LABELS[key], value: counts.get(key) ?? 0,
    text: `${fmt(counts.get(key) ?? 0)} ${simulation ? "笔" : "条"}${total ? ` · ${((counts.get(key) ?? 0) / total * 100).toFixed(1)}%` : ""}`, tone: ACTION_TONE[key] }));
  return <><StatusDistributionBar label={simulation ? "模拟样本裁决分布" : "历史命中处置分布"} segments={all}
    state={rows.reduce((sum, row) => sum + row.count, 0) !== total ? "failed" : total ? "ready" : "empty"}
    failedText="分布与总数不一致，暂时无法绘制" emptyText={simulation ? "没有评估样本，无法判断模拟裁决构成" : "暂无命中记录，无法判断处置构成"} />
    {simulation && total === 0 && <KeyValues rows={all.map((row) => ({ key: row.key, label: row.label, value: row.text }))} />}</>;
}
/** Decimal text stays text: no rounding or conversion through Number. */
function hitAmount(raw: string) {
  const value = raw.replace(/^\$\s*/, "").replaceAll(",", "");
  if (!/^\d+(?:\.\d+)?$/.test(value)) return raw.replaceAll("$", "") || "—";
  const [whole, decimals = ""] = value.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${decimals.replace(/0+$/, "").padEnd(2, "0")}`;
}

type WriteDialogProps = {
  draft: WriteDraft; pending?: SavedCommand; submitting?: boolean; onSubmit: (reason: string, value?: BusinessFormValue, rule?: K3Rule) => Promise<void>;
  onClose: () => void; onRebase: (rule: K3Rule) => Promise<K3Rule>; lastInDimension: boolean; activeRules: number;
};
function WriteDialog(props: WriteDialogProps) {
  return props.draft.kind === "create" || props.draft.kind === "edit" ? <RuleEditor {...props} /> : <RuleConfirmation {...props} />;
}
function RuleConfirmation({ draft, pending, submitting, onSubmit, onClose, onRebase, lastInDimension, activeRules }: WriteDialogProps) {
  const { kind } = draft;
  const [rule, setRule] = useState(draft.rule);
  const [revision, setRevision] = useState(0);
  const [conflict, setConflict] = useState(false);
  const allowedState = kind === "dry-run" || (kind === "active" && rule?.action !== "pass" && (rule?.state === "draft" || rule?.state === "paused")) || (kind === "paused" && rule?.state === "active") || (kind === "archived" && rule?.state === "paused");
  const effect = kind === "active" ? ENABLE_EFFECT : kind === "paused" && lastInDimension ? `停用后，这类提现没有生效规则可检查。${PAUSE_EFFECT}` : kind === "paused" ? PAUSE_EFFECT : kind === "archived" ? ARCHIVE_EFFECT : SIMULATE_EFFECT;
  return <OperationConfirmModal key={revision} action={labelOf(kind, rule)}
    title={kind === "dry-run" ? labelOf(kind) : `${kind === "active" ? "启用" : kind === "paused" ? "停用" : "归档"}提现风控规则`}
    briefKind={kind === "dry-run" ? "record" : "config"} completionCopy={kind === "dry-run" ? "有规则编辑权限的人员可直接运行，无需审批；完成后显示本次模拟结果。" : kind === "archived" ? "有归档权限的人员可直接执行，无需审批；确认后立即归档。" : "有启停权限的人员可直接执行，无需审批；确认后立即变更规则状态。"} detail="" statedBrief={{ impact: effect, check: kind === "dry-run" ? "核对当前生效规则与历史样本范围，并填写模拟依据。" : "核对规则条件、处置、优先级与版本，并填写操作依据。" }}
    facts={rule ? <><RuleFacts rule={rule} /><Facts><Fact k="状态"><Change from={STATE_LABEL[rule.state]} to={STATE_LABEL[kind as RuleState]} /></Fact></Facts></> : <Facts><Fact k="样本范围">{SIMULATE_SCOPE}</Fact></Facts>}
    reasonMin={8} reasonMax={200} reasonPlaceholder={REASON_PLACEHOLDER} getPendingReason={() => commands.list().filter(isSavedCommand).find((record) => record.target === targetOf(kind, rule))?.reason}
    effect={<StatusTag tone={kind === "dry-run" ? "neutral" : "progress"} filled>{kind === "dry-run" ? "不影响线上" : "直接生效"}</StatusTag>}
    content={<div className="k3-write-impact" data-last-pause={kind === "paused" && lastInDimension ? "" : undefined}>
      {kind === "dry-run" && <Explain label="模拟样本条件" content="旧状态为 PENDING、REVIEWING、FROZEN、REJECTED、PENDING_CHAIN；第三方请求总预算10秒。没有生效规则时评估0笔。" />}
      {kind === "dry-run" && activeRules === 0 && <Notice tone="warn">没有生效规则，本次不会评估提现样本。</Notice>}
      {kind === "paused" && <p className="k3-secondary-warning">{CASH_NOTICE}</p>}
    </div>}
    blockedReason={pending && !submitting ? UNKNOWN_RESULT_TEXT : !allowedState ? "规则当前状态不支持原操作，请关闭后核对最新规则" : conflict && <ConflictBar message="这条规则刚被别人改过。读取最新后请重新核对并填写理由。" onRead={async () => {
      setRule(await onRebase(rule!)); setRevision((n) => n + 1); setConflict(false);
    }} />}
    confirmLabel={kind === "dry-run" ? "开始模拟" : kind === "active" ? "确认启用" : kind === "paused" ? "确认停用" : "确认归档"}
    confirmTone={kind === "archived" ? "danger" : "primary"} onClose={onClose} onConfirm={async (reason) => {
      try { await onSubmit(reason, undefined, rule); } catch (error) { if (error instanceof K1RequestError && error.status === 409 && isExplicitRejection(error)) setConflict(true); throw error; }
    }} />;
}

export function K3Rules({ ctx }: { ctx: KCtx }) {
  const session = useAdminAuth((state) => state.session);
  const authorities = session?.authorities ?? [];
  const canRead = authorities.includes("risk_k3_read");
  const canWrite = authorities.includes("risk_k3_write");
  const canCreate = authorities.includes("risk_k3_rule_create");
  const canToggle = authorities.includes("risk_k3_rule_toggle");
  const canArchive = authorities.includes("risk_k3_rule_archive");
  const reach = useReach();
  const params = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const rulePage = readPage(params.get("rulePage"));
  const rulePageSize = readSize(params.get("rulePageSize"));
  const hitPage = readPage(params.get("hitPage"));
  const hitPageSize = readSize(params.get("hitPageSize"), true);
  const hitAction = (["all", "delay", "freeze", "manual"] as const).find((value) => value === params.get("hitAction")) ?? "all";
  const hitsOpen = params.get("section") === "hits";
  const query = { withdrawRules: { rulePageNum: rulePage, rulePageSize, hitPageNum: hitPage, hitPageSize, hitAction } };
  const setQuery = (values: Record<string, string | number | null>) => {
    const next = new URLSearchParams(params.toString());
    Object.entries(values).forEach(([key, value]) => value === null ? next.delete(key) : next.set(key, String(value)));
    router.push(`${pathname}${next.size ? `?${next}` : ""}`, { scroll: false });
  };
  const [readAt, setReadAt] = useState<number | null>(null);
  const [lastRulePage, setLastRulePage] = useState<{ total: number; pageNum: number; pageSize: number } | null>(null);
  const [, tickExpiry] = useState(0);
  const [dryRunResult, setDryRunResult] = useState<K3DryRunResult | null>(null);
  const [simulationOpen, setSimulationOpen] = useState(false);
  const [detail, setDetail] = useState<K3Rule | null>(null);
  const [hitDetail, setHitDetail] = useState<K3Hit | null>(null);
  const [draft, setDraft] = useState<WriteDraft | null>(null);
  const [pending, setPending] = useState<(SavedCommand | PendingMutationRecord)[]>([]);
  const [inspecting, setInspecting] = useState<PendingMutationRecord | null>(null);
  const [releasing, setReleasing] = useState<SavedCommand | null>(null);
  const [releaseVerified, setReleaseVerified] = useState(false);
  useEffect(() => { setReleaseVerified(false); }, [releasing?.commandKey]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [readback, setReadback] = useState<string | null>(null);
  const [acknowledgedReadFailure, setAcknowledgedReadFailure] = useState<string | null>(null);
  const inFlight = useRef(false);
  const syncPending = useCallback(() => setPending(commands.list().filter((record) => !isSavedCommand(record) || record.actorId === session?.adminId)), [session?.adminId]);
  const reload = async () => { await ctx.reloadKRisk(query); setReadAt(Date.now()); };
  useEffect(() => { syncPending(); }, [syncPending]);
  useEffect(() => {
    const next = Math.min(...pending.map((record) => record.expiresAt).filter((expiry) => expiry > Date.now()));
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(() => tickExpiry((value) => value + 1), next - Date.now() + 1);
    return () => window.clearTimeout(timer);
  }, [pending]);
  useEffect(() => { if (canRead) void ctx.reloadKRisk({ withdrawRules: { rulePageNum: rulePage, rulePageSize, hitPageNum: hitPage, hitPageSize, hitAction } }).then(() => setReadAt(Date.now())).catch(() => undefined); }, [canRead, ctx.reloadKRisk, rulePage, rulePageSize, hitPage, hitPageSize, hitAction]);
  const overview = ctx.risk.withdrawRules;
  useEffect(() => { if (overview) setLastRulePage({ total: overview.rules.total, pageNum: overview.rules.pageNum, pageSize: overview.rules.pageSize }); }, [overview]);
  // A successful read replaces the snapshot; a failed read must not present it as current.
  useEffect(() => {
    if (ctx.contentError) { setDetail(null); return; }
    if (ctx.contentLoading || !overview) return;
    setAcknowledgedReadFailure(null);
    setDetail((current) => {
      if (!current) return null;
      const row = overview.rules.records.find((rule) => rule.ruleId === current.ruleId);
      if (row) return row;
      const active = overview.dimensions.find((rule) => rule.ruleId === current.ruleId);
      return active ? { ...current, state: "active", conditionText: active.conditionText, cond: active.conditionText, action: active.action, act: active.action, priority: active.priority!, version: active.version! } : null;
    });
  }, [overview, ctx.contentLoading, ctx.contentError]);
  const rules = overview?.rules.records ?? [];
  const dimensions = overview?.dimensions ?? [];
  const hits = overview?.hits.records ?? [];
  const needsInvestigation = (dimension: typeof dimensions[number]) => !DECLARED_DIMENSIONS.includes(dimensionLabel(dimension.name) as K3RuleDimensionName) || dimension.action === "pass" || !!parseK3Condition(k3KindFromDimension(dimension.name, dimension.ruleKey), dimension.conditionText).conditionParseError;
  const invalidActive = dimensions.some(needsInvestigation);
  const readError = ctx.contentError?.startsWith("操作未完成") ? "没有读到最新规则，请刷新重试。" : ctx.contentError;
  const healthy = canRead && !ctx.contentLoading && !ctx.contentError && !!overview;
  const byDimension = DECLARED_DIMENSIONS.map((name) => ({ name, rules: dimensions.filter((dimension) => dimensionLabel(dimension.name) === name && !needsInvestigation(dimension)), investigate: dimensions.filter((dimension) => dimensionLabel(dimension.name) === name && needsInvestigation(dimension)) }));
  const missing = byDimension.filter((group) => !group.rules.length).map((group) => group.name);
  const locked = (target: string) => pending.some((record) => isSavedCommand(record) ? record.target === target : !legacyTarget(record) || legacyTarget(record) === target);
  const permissionFor = (kind: WriteKind) => kind === "create" ? canCreate : kind === "archived" ? canArchive : kind === "active" || kind === "paused" ? canToggle : canWrite;
  const blocked = (target: string, kind?: WriteKind) => !healthy ? "请先完整读取提现风险规则" : invalidActive && kind !== "paused" && kind !== "archived" ? "生效规则包含历史放行或未知条件，请先由风控负责人核查；仅保留合法停用与归档" : locked(target) ? "这个对象有原操作结果待确认，请先核对" : undefined;
  const openWrite = (kind: WriteKind, rule?: K3Rule, initialDimension?: K3RuleDimensionName) => {
    if (!canRead || !permissionFor(kind) || blocked(targetOf(kind, rule), kind)) return;
    setDraft({ kind, rule, initialDimension });
  };
  useEffect(() => {
    if (!overview || ctx.contentLoading) return;
    const ruleActual = Math.max(1, Math.ceil(overview.rules.total / rulePageSize));
    const hitActual = Math.max(1, Math.ceil(overview.hits.total / hitPageSize));
    if (rulePage > ruleActual || hitPage > hitActual) {
      const next = new URLSearchParams(params.toString());
      if (rulePage > ruleActual) next.set("rulePage", String(ruleActual));
      if (hitPage > hitActual) next.set("hitPage", String(hitActual));
      router.replace(`${pathname}?${next}`, { scroll: false });
    }
  }, [overview, ctx.contentLoading, rulePage, rulePageSize, hitPage, hitPageSize, pathname, router, params]);
  const showActions = canWrite || rules.some((rule) => (canToggle && (rule.state === "active" || (rule.action !== "pass" && ["draft", "paused"].includes(rule.state)))) || (canArchive && rule.state === "paused"));
  const columns = useTableColumns("k3-rules", [
    { key: "rule", label: "规则 / 维度", locked: "规则编号必须保留" }, { key: "condition", label: "条件", locked: "条件必须保留" },
    { key: "action", label: "命中处置", locked: "命中处置必须保留" }, { key: "state", label: "状态", locked: "状态必须保留" },
    { key: "version", label: "窄屏显示优先级 / 版本", extra: true }, ...(showActions ? [{ key: "actions", label: "操作", locked: "操作必须保留" }] : []),
    { key: "builtIn", label: "内置标记", extra: true },
  ]);
  const hitColumns = useTableColumns("k3-hits", [
    { key: "withdrawal", label: "提现 / 账户", locked: "提现与账户必须保留" }, { key: "amount", label: "金额", locked: "金额必须保留" },
    { key: "rule", label: "规则 / 维度", locked: "规则必须保留" }, { key: "action", label: "命中处置", locked: "命中处置必须保留" },
    { key: "reason", label: "触发原因", extra: true }, { key: "time", label: "时间", extra: true },
  ]);
  const execute = async (record: SavedCommand, retry = false) => {
    if (inFlight.current) throw new Error("原操作正在提交，请等待结果");
    if (!canRead || record.actorId !== session?.adminId || !permissionFor(record.kind)) throw new Error("当前账号没有原操作权限，请联系有权限人员核对；原记录仍保留");
    if (isRetryExpired(record)) throw new Error(RETRY_EXPIRED_TEXT);
    inFlight.current = true; setBusyKey(record.commandKey);
    let result: K3DryRunResult | void;
    try {
      result = await executeK3Command(record.request, record.commandKey);
    } catch (error) {
      const message = isExplicitRejection(error) ? errorText(error) : UNKNOWN_RESULT_TEXT;
      if (isExplicitRejection(error) && !retry) commands.forget(record.fingerprint, record.commandKey);
      else commands.remember(record.fingerprint, record.commandKey, { ...record, rejected: retry && isExplicitRejection(error), message });
      syncPending();
      if (!isExplicitRejection(error)) throw new K1OutcomeUncertainError(UNKNOWN_RESULT_TEXT, record.commandKey);
      throw error;
    } finally { inFlight.current = false; setBusyKey(null); }
    commands.forget(record.fingerprint, record.commandKey); syncPending(); setDraft(null);
    const ok = record.kind === "dry-run" ? `模拟完成 · 批次 ${result!.batchNo}` : record.kind === "create" ? "新规则已创建为草稿"
      : `${record.target} 已${record.kind === "edit" ? "更新" : record.kind === "active" ? "启用" : record.kind === "paused" ? "停用" : "归档"}`;
    if (result) { setDryRunResult(result); setSimulationOpen(true); ctx.toast(ok, "success"); return; }
    try { await reload(); } catch { setAcknowledgedReadFailure(`${ok}；最新列表读取失败，请刷新查看。`); setDetail(null); return; }
    ctx.toast(ok, "success");
  };
  const submit = async (reason: string, businessValue?: BusinessFormValue, currentRule?: K3Rule) => {
    if (!draft || !session || !healthy || !permissionFor(draft.kind)) throw new Error("请先完整读取规则并核对当前操作权限");
    const { kind } = draft;
    if (invalidActive && kind !== "paused" && kind !== "archived") throw new Error("生效规则需要风控负责人核查，暂时只能合法停用与归档");
    const rule = currentRule ?? draft.rule;
    const target = targetOf(kind, rule);
    if (locked(target)) throw new Error("原操作结果待确认，不能更换内容发起新请求");
    let body: Record<string, unknown>;
    let path: string;
    if (kind === "create" || kind === "edit") {
      const dimension = kind === "create" ? dimensionFromForm(businessValue?.dimension) : rule!.dimension;
      const conditionText = buildK3Condition(k3KindFromDimension(dimension), businessValue);
      const action = actionFromBusinessValue(businessValue);
      const priority = priorityFromBusinessValue(businessValue);
      if (!conditionText || !action || priority === null) throw new Error("规则配置不完整");
      body = kind === "create" ? { dimension, conditionText, action, priority } : { conditionText, action, priority, expectedVersion: rule!.version };
      path = kind === "create" ? "/withdraw-rules" : `/withdraw-rules/${encodeURIComponent(rule!.ruleId)}/condition`;
    } else if (kind === "dry-run") { path = "/withdraw-rules/dry-runs"; body = {}; }
    else { path = `/withdraw-rules/${encodeURIComponent(rule!.ruleId)}/status`; body = { state: kind, expectedVersion: rule!.version }; }
    const fingerprint = `k3:${session.adminId}:${target}`;
    const commandKey = newK1CommandKey();
    commands.remember(fingerprint, commandKey, { actorId: session.adminId, target, kind, label: labelOf(kind, rule), reason,
      original: rule ?? null, activeRules: dimensions.map((dimension) => dimension.ruleId), businessValue,
      request: { path, method: kind === "create" || kind === "dry-run" ? "POST" : "PATCH", body: JSON.stringify({ ...body, operator: currentAdminOperator(), reason }) } });
    if (!commands.isDurablyStored(fingerprint, commandKey)) {
      commands.forget(fingerprint, commandKey); throw new Error("无法安全保存原操作，本次未提交；请检查浏览器会话存储后重试");
    }
    const record = commands.list().find((item) => item.commandKey === commandKey)!;
    if (!isSavedCommand(record)) throw new Error("无法恢复完整原请求，本次未提交");
    syncPending(); await execute(record);
  };
  const ruleActions = (rule: K3Rule, full = false) => <div className="k3-row-actions">
    {canWrite && <Button size="sm" disabledReason={blocked(rule.ruleId) ?? editableReason(rule)} onClick={() => openWrite("edit", rule)}>编辑</Button>}
    {canToggle && (rule.state === "active" || (rule.action !== "pass" && (rule.state === "paused" || rule.state === "draft"))) && <Button size="sm" disabledReason={blocked(rule.ruleId, rule.state === "active" ? "paused" : "active")} onClick={() => openWrite(rule.state === "active" ? "paused" : "active", rule)}>{rule.state === "active" ? "停用" : "启用"}</Button>}
    {canArchive && rule.state === "paused" && (full ? <Button size="sm" variant="danger-outline" disabledReason={blocked(rule.ruleId, "archived")} onClick={() => openWrite("archived", rule)}>归档</Button>
      : <MoreMenu label={`更多操作 · ${rule.ruleId}`} items={[{ key: "archive", label: "归档", danger: true, disabledReason: blocked(rule.ruleId, "archived"), onSelect: () => openWrite("archived", rule) }]} />)}
  </div>;
  const projectionRule = (dimension: typeof dimensions[number]): K3Rule => ({ ruleId: dimension.ruleId, id: dimension.ruleId, dimension: dimension.name, dim: dimension.name,
    conditionText: dimension.conditionText, cond: dimension.conditionText, action: dimension.action, act: dimension.action,
    priority: dimension.priority!, version: dimension.version!, state: "active", builtIn: false });
  return <div className="k3-page">
    <PageHeader pageId="K3" title="提现风险规则" summary="维护提现检查条件和命中后的处置。" meta={readAt && healthy ? `读取于 ${formatBusinessTimeFull(new Date(readAt).toISOString())}（${businessZone().label}）· 手动刷新` : undefined}
      readOnly={canRead && !canWrite && !canCreate && !canToggle && !canArchive ? "当前账号只能查看这页" : undefined}
      actions={canRead && <><Button onClick={() => void reload().catch(() => undefined)} loading={ctx.contentLoading}><RefreshCw size={14} />刷新</Button>
        <Button disabledReason={!healthy ? "请先完整读取提现风险规则" : undefined} onClick={() => setQuery({ section: "hits" })}><History size={14} />触发记录</Button>
        {canWrite && <Button disabledReason={blocked("sandbox")} onClick={() => openWrite("dry-run")}><Play size={14} />模拟运行（不影响线上）</Button>}
        {canCreate && <Button variant="primary" disabledReason={blocked("create")} onClick={() => openWrite("create")}><Plus size={14} />新建规则</Button>}</>} />
    {pending.map((record) => {
      const saved = isSavedCommand(record) ? record : null;
      const noRetry = !saved ? "旧记录只有命令号，不能猜测原内容或理由重发" : isRetryExpired(record) ? RETRY_EXPIRED_TEXT : !canRead || !permissionFor(saved.kind) ? "当前账号缺少原操作权限，原记录仍保留" : saved.rejected ? "原操作已明确拒绝，请人工核实后解除本页待确认" : undefined;
      return <Notice key={record.commandKey} tone="warn" title={`${saved?.label ?? "旧操作"} · ${busyKey === record.commandKey ? "提交中…" : saved?.rejected ? "已被拒绝" : "结果待确认"}`} actionBelow action={<>
        <Button size="sm" loading={busyKey === `read:${record.commandKey}`} disabledReason={!canRead ? "缺少查看提现风险规则权限" : undefined} onClick={async () => {
          setBusyKey(`read:${record.commandKey}`);
          try { await reload(); setReadback("已读回当前规则与命中记录；当前值不能单独证明原命令成功，请继续核对操作记录与审批。"); }
          catch (error) { setReadback(`读回失败 · ${errorText(error)}`); } finally { setBusyKey(null); }
        }}>读回核对</Button>
        <Button size="sm" disabledReason={noRetry} loading={busyKey === record.commandKey} loadingText="提交中…" onClick={() => saved && void execute(saved, true).catch(() => undefined)}>按原操作重试</Button>
        {saved?.rejected && <Button size="sm" onClick={() => setReleasing(saved)}>解除待确认</Button>}
        <Button size="sm" variant="ghost" onClick={() => setInspecting(record)}>技术信息</Button>
      </>}>
        <p>{targetLabel(saved?.target ?? legacyTarget(record))} · 提交于 {formatBusinessTimeFull(new Date(record.createdAt).toISOString())}（{businessZone().label}）</p>
        <p>{busyKey === record.commandKey ? "正在提交原请求，请等待结果。" : isRetryExpired(record) ? RETRY_EXPIRED_TEXT : !saved ? "旧记录缺少完整原请求，不能重发；请核对原命令号与操作记录。" : saved.rejected ? saved.message : UNKNOWN_RESULT_TEXT}</p>
        {isRetryExpired(record) && (reach("/platform/audit") ? <Link href="/platform/audit">操作记录与审批</Link> : <p>请有权限的人员核对操作记录与审批。</p>)}
        {readback && <p>{readback}</p>}
      </Notice>;
    })}
    {acknowledgedReadFailure && <Notice tone="ok" title="原操作已成功">{acknowledgedReadFailure}</Notice>}
    {!canRead ? <BlockState state="denied" title="无权查看提现风险规则" detail="需要提现风险规则查看权限，请联系管理员核对。" />
      : ctx.contentError ? <BlockState state="error" title="提现风险规则读取失败" detail={readError} onRetry={() => void reload().catch(() => undefined)} />
      : ctx.contentLoading || !overview ? <><div className="k3-cover-loading" aria-label="正在读取四类检查">{DECLARED_DIMENSIONS.map((name) => <div key={name} className="rd-skeleton" />)}</div><Panel title="规则总表" flush><Table label="规则总表"><tbody><TableLoading columns={6} /></tbody></Table>{lastRulePage && lastRulePage.total > 0 && <Pager label="规则总表" total={lastRulePage.total} page={lastRulePage.pageNum} pageSize={lastRulePage.pageSize} sizes={[5, 10, 20]} loading onPage={(page) => setQuery({ rulePage: page })} onPageSize={(size) => setQuery({ rulePage: 1, rulePageSize: size })} />}</Panel></>
      : <>
        {invalidActive && <Notice tone="warn">生效规则包含历史放行或未知格式条件，请由风控负责人核查；只按原权限停用、归档。</Notice>}
        <Conclusion state={invalidActive || missing.length ? "warn" : "neutral"} icon={missing.length ? ShieldAlert : ShieldCheck}
          hint={missing.length === 4 ? "仅指本页检查未拦截，提现仍按审核与合规规则处理。" : missing.length ? "缺少的类别尚未参与检查，请核对是否需要补齐规则。" : undefined}
          explain="只计算完整概览中的已启用规则投影；草稿、已停用和已归档规则不参与检查。四类齐全不代表所有提现安全，也不表示立即打款。">
          {invalidActive ? "生效规则需要核查，暂时无法判断检查是否完整" : missing.length === 4 ? "尚未配置生效规则，目前提现按默认规则放行" : missing.length ? `检查不完整 · 缺${missing.join("、")}` : "金额、速度、新账户、地址信誉均有生效规则"}
        </Conclusion>
        <StatBand cards label="四类检查覆盖">{byDimension.map((group) => {
          const investigate = group.investigate.length > 0;
          const absent = !group.rules.length && !investigate;
          return <Stat key={group.name} label={group.name} value={investigate ? "待核查" : absent ? "待配置" : fmt(group.rules.length)} unit={!investigate && !absent ? "条生效规则" : undefined}
            icon={investigate || absent ? ShieldAlert : DIM_ICON[group.name]} tone={investigate || absent ? "warn" : "neutral"} surface={investigate || absent ? "warn" : undefined}
            explain={group.name === "金额" ? "按单笔金额比较，阈值显示为USD；引擎按收到的数值判断，不换汇。" : group.name === "速度" ? "滚动24小时次数或金额任一满足即命中；线上计入本次提交。" : group.name === "新账户" ? "按注册天数及边界判断；0天是合法值。" : "按内部标记、第三方评分或两者组合判断；第三方不可用不当作放行。"}>
            <p className="k3-cover-summary">{investigate ? "存在需要核查的生效规则，暂不计入正常检查" : absent ? "还没有生效规则，这类提现不会被检查" : `${invalidActive ? "规则已配置 · 当前评估待核查" : "已参与检查"} · 含${[...new Set(group.rules.map((rule) => ACTION_LABELS[rule.action]))].join("、")}`}</p>
            <div className="k3-cover-actions">{absent && canCreate && <Button size="sm" disabledReason={blocked("create")} onClick={() => openWrite("create", undefined, group.name)}>新建规则</Button>}
              {canWrite && group.rules.map((dimension) => {
                const rule = rules.find((row) => row.ruleId === dimension.ruleId) ?? projectionRule(dimension);
                return <Button size="sm" key={dimension.ruleId} disabledReason={blocked(rule.ruleId) ?? editableReason(rule)} onClick={() => openWrite("edit", rule)}>调整 · {dimension.ruleId}</Button>;
              })}
            </div>
          </Stat>;
        })}</StatBand>
        <Panel title="规则总表" className="k3-table-frame" flush actions={<ColumnPicker columns={columns} />} explain="按已启用、已停用、草稿、已归档的服务端顺序分页。数值越大的优先级越高；同维度未归档规则不能使用相同优先级。">
          <Table label="规则总表" className="k3-rules-table" data-readonly={!showActions ? "" : undefined} data-show-version={columns.isVisible("version") ? "" : undefined} data-extra={columns.isVisible("builtIn") ? "" : undefined}>
            <thead><tr><Th className="k3-rule-col">规则 / 维度</Th><Th className="k3-condition-col">条件</Th><Th className="k3-action-col">命中处置</Th><Th className="k3-state-col">状态</Th><Th className="k3-version-col">优先级 / 版本</Th>{columns.isVisible("builtIn") && <Th className="k3-builtin-col">内置标记</Th>}{showActions && <Th sticky="end" className="k3-actions-col">操作</Th>}</tr></thead>
            <tbody>{rules.length === 0 && <TableMessage columns={5 + Number(showActions) + Number(columns.isVisible("builtIn"))}>暂无提现风控规则{canCreate && <Button variant="ghost" onClick={() => openWrite("create")}>新建规则</Button>}</TableMessage>}
              {rules.map((rule) => <Tr key={rule.ruleId} selected={detail?.ruleId === rule.ruleId} onOpen={() => setDetail(rule)}>
                <Td><Cell main={<span className="k3-id"><span>{rule.ruleId.slice(0, -8)}</span><span>{rule.ruleId.slice(-8)}</span></span>} sub={dimensionLabel(rule.dimension)} mono title={rule.ruleId} /></Td>
                <Td><Cell main={<ConditionText text={conditionCopy(rule)} />} title={conditionCopy(rule)} /><Explain label={`${rule.ruleId}条件全文`} content={conditionCopy(rule)} /></Td>
                <Td><ActionTag action={rule.action} /></Td><Td><RuleTag state={rule.state} />{locked(rule.ruleId) && <div className="k3-pending-marker"><StatusTag tone="warn">{pending.some((record) => isSavedCommand(record) && record.target === rule.ruleId && busyKey === record.commandKey) ? "提交中…" : "待确认"}</StatusTag></div>}</Td><Td className="k3-version-col"><Cell main={`P${rule.priority}`} sub={`v${rule.version}`} num /></Td>
                {columns.isVisible("builtIn") && <Td>{rule.builtIn ? "内置" : "自建"}</Td>}{showActions && <Td sticky="end">{ruleActions(rule)}</Td>}
              </Tr>)}
            </tbody></Table>
          {overview.rules.total > 0 && <Pager label="规则总表" total={overview.rules.total} page={overview.rules.pageNum} pageSize={overview.rules.pageSize} sizes={[5, 10, 20]} loading={ctx.contentLoading}
            onPage={(page) => setQuery({ rulePage: page })} onPageSize={(size) => setQuery({ rulePage: 1, rulePageSize: size })} />}
        </Panel>
        <Fold title="最近一次模拟" open={simulationOpen} onOpenChange={setSimulationOpen} summary={dryRunResult ? `${dryRunResult.status === "COMPLETED" ? "已完成" : "状态未知"} · 实际评估 ${fmt(dryRunResult.evaluatedWithdrawals)} 笔` : "尚未模拟"}>
          {dryRunResult ? <><div className="k3-simulation-facts"><KeyValues rows={[
            { key: "batch", label: "模拟批次", value: dryRunResult.batchNo, mono: true }, { key: "window", label: "样本窗口", value: `${dryRunResult.sampleWindowDays} 天` },
            { key: "evaluated", label: "实际评估", value: `${fmt(dryRunResult.evaluatedWithdrawals)} 笔` }, { key: "active", label: "已启用规则", value: `${fmt(dryRunResult.activeRules)} 条`, explain: "模拟实际执行时读取的当前生效规则，不是草稿预览。" },
            { key: "hits", label: "命中次数", value: `${fmt(dryRunResult.hitCount)} 次`, explain: "按匹配规则次数累计；同一提现可命中多条，因此可以大于样本笔数。" },
          ]} /></div><Panel title="模拟样本裁决分布" explain="这一批实际评估的样本，每笔只计一次最终K3裁决；放行只表示K3没有拦截，不等于已打款。"><Distribution rows={dryRunResult.routeCounts} total={dryRunResult.evaluatedWithdrawals} simulation /></Panel></>
            : <BlockState state="empty" title="尚未模拟" detail="最近一次结果只在当前页面保留，刷新后不承诺找回。" />}
        </Fold>
        <div className="rd-links">{[["提现审核", "/finance/withdrawals"], ["USDT 提现参数", "/finance/params"], ["多账户风险排查", "/risk/multi-account"], ["操作记录与审批", "/platform/audit"]].map(([label, href]) => reach(href) && <Link key={href} href={href}>{label}</Link>)}</div>
      </>}
    <Drawer open={hitsOpen && canRead} onClose={() => { setHitDetail(null); setQuery({ section: null }); }} title="触发记录" icon={History} wide explain="一条记录是一条规则命中，同一提现可以有多条记录；不是最终提现单状态。">
      {!healthy ? <BlockState state={ctx.contentError ? "error" : "loading"} title={ctx.contentError ? "触发记录读取失败" : "正在读取触发记录"} detail={readError} onRetry={ctx.contentError ? () => void reload().catch(() => undefined) : undefined} /> : <>
        <Panel title="历史命中处置分布" explain="累计现存的全部命中记录，没有时间筛选、不随下方动作筛选改变；不是全部提现的放行率。"><Distribution rows={overview!.routeCounts} total={overview!.routeTotal} /></Panel>
        <div className="k3-hit-filters"><Segments label="命中处置筛选" value={hitAction} items={[{ value: "all", label: "全部" }, { value: "delay", label: "延迟" }, { value: "freeze", label: "冻结" }, { value: "manual", label: "转人工" }]} onChange={(value) => setQuery({ hitPage: 1, hitAction: value })} />
          <Button variant="ghost" disabledReason={hitAction === "all" ? "当前没有动作筛选" : undefined} onClick={() => setQuery({ hitAction: "all", hitPage: 1 })}>清除筛选</Button><ColumnPicker columns={hitColumns} /></div>
        <div className="k3-table-frame"><Table label="触发记录" className="k3-hits-table"><thead><tr><Th>提现 / 账户</Th><Th align="right">金额<Explain label="触发金额口径" content={<KeepText text="接口未提供币种。保留原金额，不作币种推定。" />} /></Th><Th>规则 / 维度</Th><Th>命中处置</Th>{hitColumns.isVisible("reason") && <Th>触发原因</Th>}{hitColumns.isVisible("time") && <Th>时间<Explain label="服务端时间" content="服务端时间，时区尚未提供；保留原值，不按浏览器时区转换。" /></Th>}</tr></thead>
          <tbody>{hits.length === 0 && <TableMessage columns={4 + Number(hitColumns.isVisible("reason")) + Number(hitColumns.isVisible("time"))}>{hitAction === "all" ? "暂无触发记录" : "当前处置没有匹配的触发记录"}</TableMessage>}
            {hits.map((hit, index) => <Tr key={`${hit.withdrawalNo}-${hit.ruleId}-${index}`} selected={hitDetail === hit} onOpen={() => setHitDetail(hit)}>
              <Td><Cell mono main={<span className="k3-id"><span>{hit.withdrawalNo.slice(0, -8)}</span><span>{hit.withdrawalNo.slice(-8)}</span></span>} sub={hit.userNo} title={`${hit.withdrawalNo} / ${hit.userNo}`} /></Td>
              <Td align="right"><Cell num main={hitAmount(hit.amount)} sub="币种未提供" title={hit.amount} /></Td>
              <Td><Cell main={hit.ruleId} sub={dimensionLabel(hit.dimension)} title={hit.ruleId} mono /></Td><Td><ActionTag action={hit.action} /></Td>
              {hitColumns.isVisible("reason") && <Td><Cell main={hitSummary(hit)} title={hitSummary(hit)} /></Td>}{hitColumns.isVisible("time") && <Td><Cell num main={hit.timeText} sub="时区未提供" title={hit.timeText} /></Td>}
            </Tr>)}
          </tbody></Table></div>
        {overview!.hits.total > 0 && <Pager label="触发记录" total={overview!.hits.total} page={overview!.hits.pageNum} pageSize={overview!.hits.pageSize} sizes={[5, 10, 20, 50]} onPage={(page) => setQuery({ hitPage: page })} onPageSize={(size) => setQuery({ hitPage: 1, hitPageSize: size })} />}
      </>}
    </Drawer>
    <Drawer open={!!detail} onClose={() => setDetail(null)} title="规则详情" sub={detail?.ruleId} icon={ShieldCheck}
      nav={detail ? { hasPrev: rules.findIndex((rule) => rule.ruleId === detail.ruleId) > 0, hasNext: rules.findIndex((rule) => rule.ruleId === detail.ruleId) < rules.length - 1,
        onPrev: () => setDetail(rules[rules.findIndex((rule) => rule.ruleId === detail.ruleId) - 1]), onNext: () => setDetail(rules[rules.findIndex((rule) => rule.ruleId === detail.ruleId) + 1]) } : undefined}
      footer={detail && <Decision others={ruleActions(detail, true)} />}>
      {detail && <><JudgmentPoints rows={[{ label: "当前状态", value: <RuleTag state={detail.state} /> }, { label: "条件", value: conditionCopy(detail) }, { label: "命中处置", value: <ActionTag action={detail.action} /> }, { label: "优先级 / 版本", value: `P${detail.priority} / v${detail.version}` }]} />
        {editableReason(detail) && <Notice tone="warn">{editableReason(detail)}</Notice>}{locked(detail.ruleId) && <Notice tone="warn">这条规则有原操作结果待确认，暂时不能发起新的变更。</Notice>}
        <KeyValues rows={[{ key: "dimension", label: "检查维度", value: dimensionLabel(detail.dimension) }, { key: "builtIn", label: "内置标记", value: detail.builtIn ? "内置" : "自建" }]} />
        <Fold title="技术信息" inset summary="原条件与接口字段"><KeyValues rows={[{ key: "raw", label: "conditionText", value: detail.conditionText }, { key: "state", label: "state", value: detail.state }, { key: "action", label: "action", value: detail.action }]} /></Fold></>}
    </Drawer>
    <Drawer open={!!hitDetail} onClose={() => setHitDetail(null)} title="触发记录详情" sub={hitDetail?.withdrawalNo} icon={History}>
      {hitDetail && <><KeyValues rows={[
        { key: "withdrawal", label: "提现单号", value: hitDetail.withdrawalNo, mono: true }, { key: "user", label: "账户", value: hitDetail.userNo, mono: true },
        { key: "amount", label: "金额", value: `${hitAmount(hitDetail.amount)} · 币种未提供` }, { key: "rule", label: "触发规则", value: hitDetail.ruleId, mono: true },
        { key: "dim", label: "维度", value: dimensionLabel(hitDetail.dimension) }, { key: "action", label: "命中处置", value: <ActionTag action={hitDetail.action} /> },
        { key: "reason", label: "触发原因", value: hitSummary(hitDetail) },
        ...(rules.find((rule) => rule.ruleId === hitDetail.ruleId) ? [{ key: "condition", label: "当前规则条件", value: <ConditionText text={conditionCopy(rules.find((rule) => rule.ruleId === hitDetail.ruleId)!)} /> }] : []), { key: "time", label: "服务端时间", value: `${hitDetail.timeText} · 时区未提供` },
      ]} /><div className="rd-toolbar"><Button size="sm" onClick={() => void navigator.clipboard.writeText(`${hitDetail.withdrawalNo}\n${hitDetail.userNo}`).then(() => ctx.toast("提现单号和账户已复制", "success")).catch(() => ctx.toast("复制失败，请手动选择复制", "error"))}>复制单号与账户</Button></div>
        <Fold title="技术信息" inset summary="后端原始原因、金额与统计口径"><KeyValues rows={[{ key: "reason", label: "reason 原值", value: hitDetail.reason || "—" }, { key: "amount", label: "amountText 原值", value: hitDetail.amount }, { key: "scope", label: "统计口径", value: "逐规则命中记录，不是提现最终状态；原因不承诺为触发时的不可变快照。" }]} /></Fold></>}
    </Drawer>
    {draft && <WriteDialog key={`${draft.kind}:${draft.rule?.ruleId ?? "new"}`} draft={draft} submitting={!!busyKey && inFlight.current} pending={pending.find((record): record is SavedCommand => isSavedCommand(record) && record.target === targetOf(draft.kind, draft.rule))}
      onSubmit={submit} onClose={() => setDraft(null)} activeRules={dimensions.length} lastInDimension={!!draft.rule && dimensions.filter((dimension) => dimensionLabel(dimension.name) === dimensionLabel(draft.rule!.dimension)).length === 1}
      onRebase={async (rule) => {
        const latest = await import("@/lib/admin/k-client").then((client) => client.fetchK3WithdrawRuleOverview(query.withdrawRules));
        const next = latest.rules.records.find((item) => item.ruleId === rule.ruleId) ?? latest.dimensions.filter((item) => item.ruleId === rule.ruleId).map(projectionRule)[0];
        if (!next) throw new Error("当前分页未找到原规则，请读回规则总表后重新核对");
        if (draft.kind === "edit" && editableReason(next)) throw new Error(editableReason(next));
        setDraft({ kind: draft.kind, rule: next }); return next;
      }} />}
    {inspecting && <Modal title="原操作技术信息" onClose={() => setInspecting(null)} footer={<><Button onClick={() => setInspecting(null)}>关闭</Button>
      <Button onClick={() => void navigator.clipboard.writeText(JSON.stringify(isSavedCommand(inspecting) ? { commandKey: inspecting.commandKey, ...inspecting.request } : inspecting, null, 2)).then(() => ctx.toast("原请求技术信息已复制", "success")).catch(() => ctx.toast("复制失败，请手动复制", "error"))}>复制技术信息</Button></>}>
      <pre className="k3-request">{JSON.stringify(isSavedCommand(inspecting) ? { commandKey: inspecting.commandKey, ...inspecting.request } : inspecting, null, 2)}</pre>
      <p>保留这次实际使用的方法、路径、原请求内容与命令号。本地记录属于本标签页，不提供跨设备恢复。</p>
      {reach("/platform/audit") ? <Link href="/platform/audit">操作记录与审批</Link> : <p>请有权限的风控或超级管理员核对原操作。</p>}
    </Modal>}
    {releasing && <Modal title="解除待确认" icon={ShieldCheck} onClose={() => setReleasing(null)} dirty={releaseVerified}
      footer={<><Button onClick={() => setReleasing(null)}>取消</Button><Button variant="primary" disabledReason={!releaseVerified ? "请先勾选已核实原操作" : undefined} onClick={() => {
        if (!releaseVerified || !releasing.rejected) return;
        commands.forget(releasing.fingerprint, releasing.commandKey); syncPending(); setReleasing(null); ctx.toast("已解除本页待确认，请继续核对后端原操作记录", "info");
      }}>确认解除</Button></>}>
      <ReleaseBody label={releasing.label} />
      <KeyValues rows={[{ key: "target", label: "原对象", value: targetLabel(releasing.target) }, { key: "key", label: "原命令号", value: releasing.commandKey, mono: true }, { key: "reason", label: "原操作理由", value: releasing.reason }]} />
      <Fold title="原请求技术信息" summary="方法、路径、原内容与版本" inset><pre className="k3-request">{JSON.stringify({ request: releasing.request, original: releasing.original }, null, 2)}</pre></Fold>
      <Check label="我已核实原操作的对象、请求和结果" checked={releaseVerified} onChange={(event) => setReleaseVerified(event.target.checked)} />
    </Modal>}
  </div>;
}

/** Long, typed rule form uses shared modal/fields so abandoning can save the same draft and reason. */
function RuleEditor({ draft, pending, onSubmit, onClose, onRebase }: {
  draft: WriteDraft; pending?: SavedCommand; submitting?: boolean; onSubmit: (reason: string, value?: BusinessFormValue, rule?: K3Rule) => Promise<void>;
  onClose: () => void; onRebase: (rule: K3Rule) => Promise<K3Rule>;
}) {
  const [rule, setRule] = useState(draft.rule);
  const form = (draft.kind === "create" ? newK3RuleBusinessForm(draft.initialDimension) : k3RuleBusinessForm(k3KindFromDimension(rule!.dimension), rule!.conditionText, rule!.action, rule!.priority)) as Extract<BusinessFormSpec, { kind: "multi-field" }>;
  const [value, setValue] = useState<BusinessFormValue>(() => Object.fromEntries(form.fields.map((field) => [field.key, field.current ?? ""])));
  const [reason, setReason] = useState("");
  const [policy, setPolicy] = useState<{ min: number; max: number } | null>(null);
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let live = true;
    void fetchA2ReasonPolicy().then((next) => { if (live) setPolicy({ min: Math.max(8, next.minChars), max: Math.min(200, next.maxChars) }); }).catch(() => { if (live) setPolicyError("理由规则加载失败，暂时无法提交。请关闭后重试。"); });
    return () => { live = false; };
  }, []);
  const visibleFields = form.fields.filter((field) => !field.visibleWhen || value[field.visibleWhen.key] === field.visibleWhen.equals);
  const issues = Object.fromEntries(visibleFields.map((field) => {
    const raw = value[field.key] ?? "";
    if (field.inputKind !== "number") return [field.key, raw ? undefined : `请选择${field.label}`];
    const number = Number(raw);
    const valid = raw.trim() !== "" && Number.isFinite(number) && (field.key === "addressThreshold" || Number.isInteger(number))
      && number >= field.min! && number <= field.max! && Math.abs((number - field.min!) / field.step! - Math.round((number - field.min!) / field.step!)) < 1e-8;
    return [field.key, valid ? undefined : `请填${field.min}–${field.max}${field.key === "addressThreshold" ? "的数值" : "的整数"}，每档${field.step}`];
  }));
  const dimension = draft.kind === "create" ? dimensionFromForm(value.dimension) : rule!.dimension;
  const condition = visibleFields.some((field) => !["dimension", "action", "priority"].includes(field.key) && issues[field.key]) ? "" : buildK3Condition(k3KindFromDimension(dimension), value);
  const reasonLength = visibleReasonLength(reason);
  const reasonError = policy && (reasonLength < policy.min ? `操作理由还差 ${policy.min - reasonLength} 字` : reasonLength > policy.max ? `操作理由不能超过 ${policy.max} 字` : undefined);
  const hasDraftChanges = form.fields.some((field) => value[field.key] !== field.current);
  const originalValue = Object.fromEntries(form.fields.map((field) => [field.key, field.current ?? ""]));
  const changed = draft.kind === "create" ? hasDraftChanges : condition !== buildK3Condition(k3KindFromDimension(dimension), originalValue)
    || actionFromBusinessValue(value) !== rule!.action || priorityFromBusinessValue(value) !== rule!.priority;
  const dirty = hasDraftChanges || reason.length > 0;
  const disabledReason = pending ? "原操作结果待确认，内容已锁定；请关闭后读回核对或按原操作重试" : rule && editableReason(rule) ? editableReason(rule) : conflict ? "请先读取最新版本并重新核对" : !policy ? policyError ?? "正在读取理由规则" : Object.values(issues).find(Boolean) ?? reasonError ?? (draft.kind === "edit" && !changed ? "条件、命中处置和优先级都没有改动" : undefined);
  const effect = draft.kind === "create" ? CREATE_EFFECT : rule!.state === "active" ? ACTIVE_EFFECT : rule!.state === "draft" ? "仍为草稿，启用后才参与检查。" : "仍为已停用，重新启用后才参与检查。";
  const save = async () => {
    if (busy || disabledReason) return;
    setBusy(true); setError(null);
    try { await onSubmit(reason.trim(), value, rule); }
    catch (cause) {
      if (isPermissionDenied(cause)) { announcePermissionDenied(); onClose(); return; }
      setLeaving(false); setError(errorText(cause));
      if (cause instanceof K1RequestError && cause.status === 409 && isExplicitRejection(cause)) setConflict(true);
    } finally { setBusy(false); }
  };
  return <Modal title={leaving ? "放弃未保存的规则改动" : draft.kind === "create" ? "新建提现风控规则" : "编辑提现风控规则"} icon={SlidersHorizontal} wide busy={busy} dirty={!leaving && dirty}
    sub={!leaving && <StatusTag tone={draft.kind === "create" || rule?.state !== "active" ? "neutral" : "progress"} filled>{draft.kind === "create" ? "保存为草稿" : rule?.state === "active" ? "直接生效" : "保持当前状态"}</StatusTag>}
    onClose={() => leaving ? setLeaving(false) : pending || !dirty ? onClose() : setLeaving(true)}
    footer={leaving ? <><Button onClick={() => setLeaving(false)}>继续编辑</Button><Button onClick={onClose}>放弃改动并返回</Button><Button variant="primary" disabledReason={disabledReason} onClick={() => void save()}>{draft.kind === "create" ? "保存草稿后继续" : "保存修改后继续"}</Button></>
      : <TipSide side="top"><Button disabled={busy} onClick={() => pending || !dirty ? onClose() : setLeaving(true)}>取消</Button><Button variant="primary" loading={busy} loadingText="提交中…" disabledReason={busy ? undefined : disabledReason} onClick={() => void save()}>{draft.kind === "create" ? "保存草稿" : "保存规则修改"}</Button></TipSide>}>
    {leaving ? <p>这次填写的条件和操作理由还没有保存。可以继续编辑、放弃改动，或沿原提交路径保存。</p> : <div className="k3-editor-content">
      {draft.kind === "create" ? <Facts><Fact k="规则类型">{dimension}</Fact><Fact k="拟建条件">{condition ? conditionDisplay(condition) : "待填写条件"}</Fact><Fact k="命中处置">{value.action}</Fact><Fact k="优先级">{value.priority}</Fact></Facts>
        : <><Facts><Fact k="规则">{rule!.ruleId}</Fact><Fact k="维度 / 版本">{dimensionLabel(rule!.dimension)} / v{rule!.version}</Fact></Facts><DiffList emptyNote="" rows={[
          { key: "condition", label: "条件", before: conditionCopy(rule!), after: condition ? conditionCopy({ dimension, conditionText: condition }) : "待填写条件" }, { key: "action", label: "命中处置", before: ACTION_LABELS[rule!.action], after: value.action }, { key: "priority", label: "优先级", before: String(rule!.priority), after: value.priority },
        ]} /></>}
      <Notice tone="progress">{effect}</Notice>
      {draft.kind === "edit" && condition && !Object.values(issues).some(Boolean) && loosensRule(rule!, originalValue, value) && <Notice tone="warn">{CASH_NOTICE}</Notice>}
      {conflict && <ConflictBar message="这条规则刚被别人改过。你的编辑草稿仍保留，读取最新后请重新核对并填写理由。" onRead={async () => { setRule(await onRebase(rule!)); setReason(""); setConflict(false); setError(null); }} />}
      {pending && !busy && <Notice tone="warn">{UNKNOWN_RESULT_TEXT}</Notice>}
      {error && !pending && !conflict && <Notice tone="danger">{error}</Notice>}
      <fieldset disabled={busy || !!pending} className="k3-editor-fields"><div className="rd-form-grid k3-form-grid" data-cols="2">{[
        ...visibleFields.filter((field) => ["dimension", "action", "priority"].includes(field.key)),
        ...visibleFields.filter((field) => !["dimension", "action", "priority"].includes(field.key)),
      ].map((field) => <div className="k3-field-slot" data-wide={field.key === "dimension" || field.key === "addressSource" ? "" : undefined} data-compare={field.key.endsWith("Op") ? "" : undefined} key={field.key}>
        <Field label={field.label} required explain={K3_FIELD_HELP[field.key]} error={touched[field.key] ? issues[field.key] : undefined}
          help={field.inputKind === "number" ? `${field.min}–${field.max}，每档${field.step}` : undefined}>
          {(control) => field.inputKind === "select" ? <Select {...control} aria-label={field.label} value={value[field.key]} options={field.options!.map((option) => ({ value: option, label: option === ">=" ? "≥" : option === "<=" ? "≤" : option }))} onChange={(next) => setValue((current) => ({ ...current, [field.key]: next }))} />
            : <NumberInput {...control} aria-label={field.label} value={value[field.key]} min={field.min} max={field.max} step={field.step} unit={field.key === "amount" || field.key === "velocityAmount" ? "USD" : field.key === "days" ? "天" : field.key === "count" ? "笔" : undefined}
              onBlur={() => setTouched((current) => ({ ...current, [field.key]: true }))} onChange={(event) => setValue((current) => ({ ...current, [field.key]: event.target.value }))} />}
        </Field>
      </div>)}</div>
      <Field label="操作理由" required hint={policy ? `至少 ${policy.min} 字` : "正在读取理由规则"} error={touched.reason ? reasonError : undefined}>
        {(control) => <Textarea {...control} value={pending?.reason ?? reason} maxLength={policy?.max ?? 200} count={`${visibleReasonLength(pending?.reason ?? reason)}/${policy?.max ?? 200}`} placeholder={REASON_PLACEHOLDER} onBlur={() => setTouched((current) => ({ ...current, reason: true }))} onChange={(event) => setReason(event.target.value)} />}
      </Field></fieldset>
      {policyError && <Notice tone="danger">{policyError}</Notice>}
      <Fold title="填写与执行说明" summary="优先级、条件与理由" inset><p>同维度所有未归档规则的优先级不能重复；当前分页不能证明优先级可用，后端保存时检查。</p><p>规则按冻结、转人工、延迟的严重度裁决，同严重度才比较优先级。理由只记录这次操作依据。</p></Fold>
    </div>}
  </Modal>;
}
