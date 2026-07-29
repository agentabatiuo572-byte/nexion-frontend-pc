"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DataListPager, type BusinessFormSpec, type BusinessFormValue } from "../design-kit";
import {
  K1OutcomeUncertainError,
  newK1CommandKey,
  type K3Dimension,
  type K3DryRunResult,
  type K3Rule,
  type RuleAction,
  type RuleState,
} from "@/lib/admin/k-client";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { KCtx } from "./types";

const fmt = (n: number) => n.toLocaleString("zh-CN");

const RULE_ACT: Record<RuleAction, [string, string]> = {
  pass: ["放行", "ok"], delay: ["延迟", "warn"], freeze: ["冻结", "bad"], manual: ["转人工", "cyan"],
};
const RULE_ST: Record<RuleState, [string, string]> = {
  draft: ["草拟", "dim"], active: ["生效", "ok"], paused: ["停用", "warn"], archived: ["归档", "dim"],
};
const DRY_RUN_STATUS_LABELS: Record<string, string> = { COMPLETED: "已完成" };
const DIMENSION_LABELS: Record<string, string> = {
  amount: "金额", velocity: "速度", newAccount: "新账户", addressReputation: "地址信誉",
  largeAmountUsdt: "金额", velocity24h: "速度", newAccountProtectDays: "新账户", addressReputationSource: "地址信誉",
};

type K3RuleKind = "amount" | "velocity" | "newAccount" | "address";
type K3RuleDimensionName = "金额" | "速度" | "新账户" | "地址信誉";
type ParsedCondition = { value: BusinessFormValue | null; conditionParseError: string | null };

const ACTION_LABELS: Record<RuleAction, string> = { pass: "放行", delay: "延迟", freeze: "冻结", manual: "转人工" };
const ACTION_BY_LABEL: Record<string, RuleAction> = {
  延迟: "delay", 冻结: "freeze", 转人工: "manual", delay: "delay", freeze: "freeze", manual: "manual",
};
const DIMENSION_OPTIONS: K3RuleDimensionName[] = ["金额", "速度", "新账户", "地址信誉"];
const ACTION_OPTIONS = [ACTION_LABELS.delay, ACTION_LABELS.manual, ACTION_LABELS.freeze];
const ADDRESS_SOURCE_OPTIONS = ["内部", "第三方", "组合"];
const ADDRESS_SOURCE_VALUE: Record<string, "internal" | "third-party" | "combined"> = {
  内部: "internal", 第三方: "third-party", 组合: "combined",
};
const ADDRESS_SOURCE_LABEL: Record<string, string> = {
  internal: "内部", "third-party": "第三方", combined: "组合",
};

const DIM_ICONS: Record<string, ReactNode> = {
  card: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10h18" /></svg>,
  wave: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12h3l2-6 4 14 2-8h5" /></svg>,
  user: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="8" r="3" /><path d="M3 19a6 6 0 0112 0M17 5v6M20 8h-6" /></svg>,
  shield: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>,
};

function errorText(error: unknown) { return error instanceof Error ? error.message : "未知错误"; }
function conditionCore(text: string) { return (text.split(/->|→/)[0] ?? "").trim(); }
function formatMoney(value: string | undefined) {
  const parsed = Number(String(value ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) ? parsed.toLocaleString("en-US") : "0";
}
function dimensionLabel(value: string) { return DIMENSION_LABELS[value] ?? value ?? "—"; }
function dryRunStatusLabel(value: string) { return DRY_RUN_STATUS_LABELS[value] ?? "状态未知"; }
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
    ? `来源：内部 · 仅使用内部黑名单（第三方阈值 ${threshold} 不参与）`
    : `来源：${source} · 第三方评分 < ${threshold} 判为低信誉`;
}

function parseK3Condition(kind: K3RuleKind, text: string): ParsedCondition {
  const core = conditionCore(text).replace("，", ",");
  if (kind === "amount") {
    const matched = core.match(/^(?:单笔|single)\s*(>=|>)\s*\$?([\d,]+)$/i);
    return matched
      ? { value: { amountOp: matched[1], amount: matched[2].replaceAll(",", "") }, conditionParseError: null }
      : { value: null, conditionParseError: "当前条件格式无法安全编辑" };
  }
  if (kind === "velocity") {
    const matched = core.match(/^24h\s*(>=|>)\s*(\d+)\s*(?:笔|withdrawals?)\s*(?:或|or)\s*(>=|>)\s*\$?([\d,]+)$/i);
    return matched
      ? { value: { countOp: matched[1], count: matched[2], velocityAmountOp: matched[3], velocityAmount: matched[4].replaceAll(",", "") }, conditionParseError: null }
      : { value: null, conditionParseError: "当前条件格式无法安全编辑" };
  }
  if (kind === "newAccount") {
    const matched = core.match(/^(?:注册|registered)\s*(<|<=)\s*(\d+)\s*(?:天|days?)$/i);
    return matched
      ? { value: { accountOp: matched[1], days: matched[2] }, conditionParseError: null }
      : { value: null, conditionParseError: "当前条件格式无法安全编辑" };
  }
  const address = parseAddressCondition(core);
  return address
    ? { value: address, conditionParseError: null }
    : { value: null, conditionParseError: "当前条件格式无法安全编辑" };
}

function k3RuleBusinessForm(kind: K3RuleKind, current: string, action: RuleAction, priority: number): BusinessFormSpec | null {
  const parsed = parseK3Condition(kind, current);
  if (!parsed.value || parsed.conditionParseError) return null;
  const common = [
    { key: "action", label: "命中动作", current: ACTION_LABELS[action], inputKind: "select" as const, options: ACTION_OPTIONS },
    { key: "priority", label: "优先级", current: String(priority), inputKind: "number" as const, min: 1, max: 100, step: 1 },
  ];
  if (kind === "amount") return { kind: "multi-field", title: "金额规则", hint: "金额范围 $100-$50,000；同时保存命中动作与优先级。", fields: [
    { key: "amountOp", label: "比较符", current: parsed.value.amountOp, inputKind: "select", options: [">=", ">"] },
    { key: "amount", label: "单笔金额 USD", current: parsed.value.amount, inputKind: "number", min: 100, max: 50000, step: 100 }, ...common,
  ] };
  if (kind === "velocity") return { kind: "multi-field", title: "速度规则", hint: "24 小时内笔数或累计金额任一命中即触发。", fields: [
    { key: "countOp", label: "笔数比较符", current: parsed.value.countOp, inputKind: "select", options: [">=", ">"] },
    { key: "count", label: "24h 笔数", current: parsed.value.count, inputKind: "number", min: 1, max: 20, step: 1 },
    { key: "velocityAmountOp", label: "金额比较符", current: parsed.value.velocityAmountOp, inputKind: "select", options: [">=", ">"] },
    { key: "velocityAmount", label: "24h 金额 USD", current: parsed.value.velocityAmount, inputKind: "number", min: 500, max: 50000, step: 500 }, ...common,
  ] };
  if (kind === "newAccount") return { kind: "multi-field", title: "新账户保护", hint: "注册天数范围 0-30 天。", fields: [
    { key: "accountOp", label: "注册天数比较符", current: parsed.value.accountOp, inputKind: "select", options: ["<", "<="] },
    { key: "days", label: "注册天数", current: parsed.value.days, inputKind: "number", min: 0, max: 30, step: 1 }, ...common,
  ] };
  return { kind: "multi-field", title: "地址信誉源", hint: "内部不调用外部服务；第三方或组合使用真实链上信誉服务，服务不可用时提现失败关闭。", fields: [
    { key: "addressSource", label: "信誉来源", current: parsed.value.addressSource, inputKind: "select", options: ADDRESS_SOURCE_OPTIONS, wide: true }, ...common,
    { key: "addressThreshold", label: "低信誉阈值", current: parsed.value.addressThreshold, inputKind: "number", min: 0, max: 1, step: 0.01 },
  ] };
}

function newK3RuleBusinessForm(): BusinessFormSpec {
  return { kind: "multi-field", title: "新建规则", hint: "选择维度后，只显示并校验该维度的业务字段。", fields: [
    { key: "dimension", label: "规则维度", current: "金额", inputKind: "select", options: DIMENSION_OPTIONS },
    { key: "action", label: "命中动作", current: "延迟", inputKind: "select", options: ACTION_OPTIONS },
    { key: "priority", label: "优先级", current: "50", inputKind: "number", min: 1, max: 100, step: 1 },
    { key: "amountOp", label: "金额比较符", current: ">=", inputKind: "select", options: [">=", ">"], visibleWhen: { key: "dimension", equals: "金额" } },
    { key: "amount", label: "单笔金额 USD", current: "1000", inputKind: "number", min: 100, max: 50000, step: 100, visibleWhen: { key: "dimension", equals: "金额" } },
    { key: "countOp", label: "笔数比较符", current: ">", inputKind: "select", options: [">=", ">"], visibleWhen: { key: "dimension", equals: "速度" } },
    { key: "count", label: "24h 笔数", current: "3", inputKind: "number", min: 1, max: 20, step: 1, visibleWhen: { key: "dimension", equals: "速度" } },
    { key: "velocityAmountOp", label: "24h 金额比较符", current: ">", inputKind: "select", options: [">=", ">"], visibleWhen: { key: "dimension", equals: "速度" } },
    { key: "velocityAmount", label: "24h 金额 USD", current: "5000", inputKind: "number", min: 500, max: 50000, step: 500, visibleWhen: { key: "dimension", equals: "速度" } },
    { key: "accountOp", label: "注册天数比较符", current: "<", inputKind: "select", options: ["<", "<="], visibleWhen: { key: "dimension", equals: "新账户" } },
    { key: "days", label: "注册天数", current: "7", inputKind: "number", min: 0, max: 30, step: 1, visibleWhen: { key: "dimension", equals: "新账户" } },
    { key: "addressSource", label: "地址信誉来源", current: ADDRESS_SOURCE_OPTIONS[0], inputKind: "select", options: ADDRESS_SOURCE_OPTIONS, wide: true, visibleWhen: { key: "dimension", equals: "地址信誉" } },
    { key: "addressThreshold", label: "低信誉阈值", current: "0.4", inputKind: "number", min: 0, max: 1, step: 0.01, visibleWhen: { key: "dimension", equals: "地址信誉" } },
  ] };
}

function buildK3Condition(kind: K3RuleKind, value?: BusinessFormValue) {
  if (!value) return "";
  if (kind === "amount") return `单笔 ${value.amountOp} $${formatMoney(value.amount)}`;
  if (kind === "velocity") return `24h ${value.countOp} ${value.count} 笔 或 ${value.velocityAmountOp} $${formatMoney(value.velocityAmount)}`;
  if (kind === "newAccount") return `注册 ${value.accountOp} ${value.days} 天`;
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
function pct1(n: number, total: number) { return total ? (Math.round(n / total * 1000) / 10).toFixed(1) : "0.0"; }
function isOutcomeUncertain(error: unknown): error is K1OutcomeUncertainError {
  return error instanceof K1OutcomeUncertainError
    || (error instanceof Error
      && error.name === "K1OutcomeUncertainError"
      && typeof (error as Error & { commandKey?: unknown }).commandKey === "string");
}

export function K3HeaderActions({ ctx, onResult }: { ctx: KCtx; onResult: (result: K3DryRunResult) => void }) {
  const authorities = useAdminAuth((state) => state.session?.authorities ?? []);
  const commandAttempt = useRef<string | null>(null);
  const [dryRunError, setDryRunError] = useState<string | null>(null);
  const canDryRun = authorities.includes("risk_k3_write") && !ctx.contentLoading && !ctx.contentError;
  const dryRun = () => ctx.openConfirm({
    action: "沙盒模拟（历史样本试跑）",
    detail: "用最近 30 天历史提现样本按当前规则试跑；只读模拟，不写生产命中记录。",
    chips: [["只读 · 不写生产", "done"], ["返回本次模拟结果", "ready"]], reason: true, okLabel: "开始模拟",
    run: async (reason) => {
      const commandKey = commandAttempt.current ?? newK1CommandKey();
      commandAttempt.current = commandKey;
      try {
        const result = await ctx.actions.dryRunK3(reason, commandKey);
        commandAttempt.current = null;
        setDryRunError(null);
        onResult(result);
        ctx.toast(`模拟完成 · 批次 ${result.batchNo}`);
      } catch (error) {
        const outcomeUncertain = isOutcomeUncertain(error);
        if (!outcomeUncertain) commandAttempt.current = null;
        const message = `${outcomeUncertain ? "结果暂不确定，请使用原操作重试" : "K3 模拟失败"} · ${errorText(error)}`;
        setDryRunError(message);
        ctx.toast(message);
        throw error;
      }
    },
  });
  return <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
    <span className="f-ro"><span className="d" />规则由服务器统一评估</span>
    <button
      className="f-cta"
      disabled={!canDryRun}
      title={ctx.contentError ? "K3 权威数据不可用，已禁用模拟" : !canDryRun ? "缺少 risk_k3_write 权限" : undefined}
      onClick={dryRun}
    >
      沙盒模拟（不写生产）
    </button>
    {dryRunError && <span role="alert" style={{ color: "var(--danger)", fontSize: 12 }}>{dryRunError}</span>}
  </span>;
}

export function K3Rules({ ctx, dryRunResult }: { ctx: KCtx; dryRunResult: K3DryRunResult | null }) {
  const authorities = useAdminAuth((state) => state.session?.authorities ?? []);
  const canRead = authorities.includes("risk_k3_read");
  const canWrite = authorities.includes("risk_k3_write");
  const canCreate = authorities.includes("risk_k3_rule_create");
  const canToggle = authorities.includes("risk_k3_rule_toggle");
  const canArchive = authorities.includes("risk_k3_rule_archive");
  const commandAttempt = useRef(new Map<string, string>());
  const [filter, setFilter] = useState<"all" | RuleAction>("all");
  const [rulePage, setRulePage] = useState(1);
  const [rulePageSize, setRulePageSize] = useState(5);
  const [hitPage, setHitPage] = useState(1);
  const [hitPageSize, setHitPageSize] = useState(5);
  const query = { withdrawRules: { rulePageNum: rulePage, rulePageSize, hitPageNum: hitPage, hitPageSize, hitAction: filter } };

  useEffect(() => { if (canRead) void ctx.reloadKRisk(query).catch(() => undefined); }, [canRead, ctx.reloadKRisk, rulePage, rulePageSize, hitPage, hitPageSize, filter]);

  const overview = ctx.risk.withdrawRules;
  const dimensions = overview?.dimensions ?? [];
  const rulesPage = overview?.rules;
  const rules = rulesPage?.records ?? [];
  const routeCounts = overview?.routeCounts ?? [];
  const routeTotal = overview?.routeTotal ?? 0;
  const hitsPage = overview?.hits;
  const hits = hitsPage?.records ?? [];

  const runAction = async (scope: string, work: (commandKey: string) => Promise<void>, ok: string) => {
    const commandKey = commandAttempt.current.get(scope) ?? newK1CommandKey();
    commandAttempt.current.set(scope, commandKey);
    let writeConfirmed = false;
    try {
      await work(commandKey);
      writeConfirmed = true;
      await ctx.reloadKRisk(query);
      commandAttempt.current.delete(scope);
      ctx.toast(ok);
    } catch (error) {
      if (!writeConfirmed && !(error instanceof K1OutcomeUncertainError)) commandAttempt.current.delete(scope);
      ctx.toast(`${error instanceof K1OutcomeUncertainError ? "结果暂不确定，请使用原操作重试" : "K3 操作失败"} · ${errorText(error)}`);
      throw error;
    }
  };

  const toggleRule = (rule: K3Rule, state: "active" | "paused") => ctx.openActionConfirm({
    action: `${state === "active" ? "启用" : "停用"}规则 · ${rule.ruleId}`,
    detail: `当前版本 v${rule.version}；保存后下一笔提现评估生效。`, amplifies: state === "paused",
    run: (reason) => runAction(`state:${rule.ruleId}:${state}:${rule.version}`, (key) => ctx.actions.updateK3RuleState(rule.ruleId, state, rule.version, reason, key), `${rule.ruleId} 已${state === "active" ? "启用" : "停用"}`),
  });
  const archiveRule = (rule: K3Rule) => ctx.openConfirm({
    action: `归档规则 · ${rule.ruleId}`, detail: "归档是软删除终态，归档后不能再次启用。", chips: [["终态 · 不可再启用", "done"]], reason: true, okLabel: "确认归档",
    run: (reason) => runAction(`archive:${rule.ruleId}:${rule.version}`, (key) => ctx.actions.archiveK3Rule(rule.ruleId, rule.version, reason, key), `${rule.ruleId} 已归档`),
  });
  const editRule = (rule: K3Rule) => {
    const kind = k3KindFromDimension(rule.dimension);
    const businessForm = rule.action === "pass" ? null : k3RuleBusinessForm(kind, rule.conditionText, rule.action, rule.priority);
    if (!businessForm) { ctx.toast("当前条件格式无法安全编辑"); return; }
    ctx.openActionConfirm({
      action: `编辑规则 · ${rule.ruleId}`, detail: `同时保存条件、命中动作、优先级；按版本 v${rule.version} 防止覆盖他人更新。`, businessForm,
      run: (reason, _value, businessValue) => {
        const conditionText = buildK3Condition(kind, businessValue);
        const action = actionFromBusinessValue(businessValue);
        const priority = priorityFromBusinessValue(businessValue);
        if (!conditionText || !action || priority == null) throw new Error("规则配置不完整");
        return runAction(`edit:${rule.ruleId}:${rule.version}:${conditionText}:${action}:${priority}`, (key) => ctx.actions.updateK3Rule(rule.ruleId, conditionText, action, priority, rule.version, reason, key), `${rule.ruleId} 已更新`);
      },
    });
  };
  const newRule = () => ctx.openActionConfirm({
    action: "新建提现风控规则", detail: "新规则由服务器分配编号并进入草拟状态。", businessForm: newK3RuleBusinessForm(),
    run: (reason, _value, businessValue) => {
      const dimension = dimensionFromForm(businessValue?.dimension);
      const conditionText = buildK3Condition(k3KindFromDimension(dimension), businessValue);
      const action = actionFromBusinessValue(businessValue);
      const priority = priorityFromBusinessValue(businessValue);
      if (!conditionText || !action || priority == null) throw new Error("规则配置不完整");
      return runAction(`create:${dimension}:${conditionText}:${action}:${priority}`, (key) => ctx.actions.createK3Rule(dimension, conditionText, action, priority, reason, key), "新规则已创建为草稿");
    },
  });

  if (!canRead) return <section className="l-card"><div className="l-h"><span className="ttl">无权查看提现风控规则</span><span className="sub">· 需要 risk_k3_read 权限</span></div></section>;
  if (ctx.contentLoading) return <section className="l-card"><div className="l-h"><span className="ttl">K3 数据加载中</span><span className="sub">· 正在读取提现规则</span></div></section>;
  if (ctx.contentError) return <section className="l-card"><div className="l-h"><span className="ttl">K3 数据加载失败</span><span className="sub">· {ctx.contentError}</span><div className="r"><button className="l-btn" onClick={() => void ctx.reloadKRisk(query).catch(() => undefined)}>仅重试 K3</button></div></div></section>;
  if (!overview) return <section className="l-card"><div className="l-h"><span className="ttl">K3 暂无可展示数据</span></div></section>;

  const byKey = Object.fromEntries(routeCounts.map((row) => [row.key, row]));
  return <div>
    <div className="f-stats">{(["pass", "delay", "manual", "freeze"] as RuleAction[]).map((key) => {
      const row = byKey[key]; const [label, tone] = RULE_ACT[key];
      return <div className={`f-stat ${tone}`} key={key}><div className="k">{label}</div><div className="v">{pct1(row?.count ?? 0, routeTotal)}%</div><div className="sub">{fmt(row?.count ?? 0)} / {fmt(routeTotal)} 笔</div></div>;
    })}</div>

    {dryRunResult && <section className="l-card"><div className="l-h"><span className="ttl">最近一次沙盒模拟</span><span className="sub">· {dryRunStatusLabel(dryRunResult.status)}</span></div><div className="l-b">
      <div className="f-stats"><div className="f-stat"><div className="k">模拟批次</div><div className="v" style={{ fontSize: 15 }}>{dryRunResult.batchNo}</div><div className="sub">样本窗口 {dryRunResult.sampleWindowDays} 天</div></div><div className="f-stat"><div className="k">评估提现</div><div className="v">{fmt(dryRunResult.evaluatedWithdrawals)}</div><div className="sub">启用规则 {dryRunResult.activeRules} 条</div></div><div className="f-stat warn"><div className="k">命中次数</div><div className="v">{fmt(dryRunResult.hitCount)}</div><div className="sub">本次历史样本模拟</div></div><div className="f-stat cyan"><div className="k">路由结果</div><div className="v">{dryRunResult.routeCounts.length}</div><div className="sub">{dryRunResult.routeCounts.map((r) => `${RULE_ACT[r.key][0]} ${r.count}`).join(" · ") || "无路由命中"}</div></div></div>
    </div></section>}

    <section className="l-card"><div className="l-h"><span className="ttl">四道关 · 规则配置</span><span className="sub">· 条件、动作、优先级均以服务器返回为准</span></div><div className="l-b"><div className="dim-grid">
      {dimensions.length === 0 && <div className="sub">暂无生效中的四道关配置</div>}
      {dimensions.map((dimension) => {
        const parsed = parseK3Condition(k3KindFromDimension(dimension.name, dimension.ruleKey), dimension.conditionText);
        const matchingRule = rules.find((rule) => rule.ruleId === dimension.ruleId);
        const projectionComplete = dimension.priority != null && dimension.priority >= 1 && dimension.priority <= 100
          && dimension.version != null && dimension.version >= 0;
        const editableRule: K3Rule | null = matchingRule ?? (projectionComplete ? {
          ruleId: dimension.ruleId, id: dimension.ruleId, dimension: dimension.name, dim: dimension.name,
          conditionText: dimension.conditionText, cond: dimension.conditionText, action: dimension.action, act: dimension.action,
          priority: dimension.priority!, version: dimension.version!, state: "active" as const, builtIn: false,
        } : null);
        const editable = canWrite && !!dimension.ruleId && !parsed.conditionParseError && dimension.action !== "pass" && !!editableRule;
        const unavailableReason = !projectionComplete && !matchingRule ? "当前规则版本未完整加载，请在规则总表定位后编辑" : undefined;
        const conditionCopy = k3KindFromDimension(dimension.name, dimension.ruleKey) === "address"
          ? addressConditionCopy(dimension.conditionText) : dimension.conditionText;
        return <div className="dim" key={`${dimension.ruleKey}-${dimension.ruleId}`}><div className="top"><span className="ic">{DIM_ICONS[dimension.icon] ?? DIM_ICONS.shield}</span><div className="nm">{dimensionLabel(dimension.name)}</div></div><div className="cond">{conditionCopy}</div><div className="why">{operatorCopy(dimension.why, "用于评估该维度的提现风险")}</div>{parsed.conditionParseError && <div className="sub" style={{ color: "var(--danger)" }}>当前条件格式无法安全编辑</div>}<div className="ft"><span className={`act ${dimension.action}`}>{RULE_ACT[dimension.action][0]}</span><span className="mono">{dimension.priority == null ? "优先级未加载" : `P${dimension.priority}`}</span><button className="l-btn sm mc" disabled={!editable} title={!canWrite ? "缺少 risk_k3_write 权限" : parsed.conditionParseError ?? unavailableReason} onClick={() => editableRule && editRule(editableRule)}>调整</button></div></div>;
      })}
    </div></div></section>

    <div className="two-col r135"><section className="l-card"><div className="l-h"><span className="ttl">规则总表</span><span className="sub">· 已归档规则不能再启用</span><div className="r"><button className="l-btn mc" disabled={!canCreate} title={!canCreate ? "缺少 risk_k3_rule_create 权限" : undefined} onClick={newRule}>+ 新建规则</button></div></div><div style={{ overflowX: "auto" }}><table className="l-tbl" style={{ minWidth: 820 }}><thead><tr><th>规则</th><th>维度</th><th>条件</th><th>动作</th><th>优先级</th><th>版本</th><th>状态</th><th style={{ textAlign: "right" }}>操作</th></tr></thead><tbody>
      {rules.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--ink-4)" }}>暂无提现风控规则</td></tr>}
      {rules.map((rule) => { const [stateLabel, stateTone] = RULE_ST[rule.state]; const [actionLabel, actionTone] = RULE_ACT[rule.action]; return <tr key={rule.ruleId}><td className="mono">{rule.ruleId}</td><td>{dimensionLabel(rule.dimension)}</td><td className="mono">{rule.conditionText}</td><td><span className={`bdg ${actionTone}`}>{actionLabel}</span></td><td className="mono">{rule.priority}</td><td className="mono">v{rule.version}</td><td><span className={`bdg ${stateTone}`}>{stateLabel}</span></td><td style={{ textAlign: "right", whiteSpace: "nowrap" }}><span style={{ display: "inline-flex", gap: 6 }}><button className="l-btn sm" disabled={!canWrite || rule.state === "archived" || rule.action === "pass" || !!parseK3Condition(k3KindFromDimension(rule.dimension), rule.conditionText).conditionParseError} onClick={() => editRule(rule)}>编辑</button>{rule.state === "active" && <button className="l-btn sm mc" disabled={!canToggle} onClick={() => toggleRule(rule, "paused")}>停用</button>}{(rule.state === "paused" || rule.state === "draft") && <button className="l-btn sm mc" disabled={!canToggle} onClick={() => toggleRule(rule, "active")}>启用</button>}{rule.state === "paused" && <button className="l-btn sm" disabled={!canArchive} onClick={() => archiveRule(rule)}>归档</button>}{rule.state === "archived" && <button className="l-btn sm" disabled title="归档规则是终态">已归档</button>}</span></td></tr>; })}
    </tbody></table></div><DataListPager label="规则总表" page={rulesPage?.pageNum ?? rulePage} pageSize={rulesPage?.pageSize ?? rulePageSize} total={rulesPage?.total ?? rules.length} onPageChange={setRulePage} onPageSizeChange={(next) => { setRulePageSize(next); setRulePage(1); }} pageSizeOptions={[5, 10, 20]} /></section>

    <section className="l-card"><div className="l-h"><span className="ttl">路由结果分布</span><span className="sub">· 评估规则松紧</span></div><div className="l-b">{routeCounts.length === 0 ? <div className="sub">暂无路由结果数据</div> : <><div className="route-bar">{routeCounts.map((route) => <i key={route.key} style={{ width: `${pct1(route.count, routeTotal)}%`, background: route.color }} title={`${RULE_ACT[route.key][0]} ${pct1(route.count, routeTotal)}%`} />)}</div><div className="route-legend">{routeCounts.map((route) => <span className="it" key={route.key}><span className="d2" style={{ background: route.color }} />{RULE_ACT[route.key][0]} {pct1(route.count, routeTotal)}%</span>)}</div></>}</div></section></div>

    <section className="l-card"><div className="l-h"><span className="ttl">命中日志</span><span className="sub">· 最近命中规则的提现请求</span><div className="r"><div className="chips">{([["all", "全部"], ["delay", "延迟"], ["freeze", "冻结"], ["manual", "转人工"]] as const).map(([value, label]) => <button key={value} className={`chip${filter === value ? " sel" : ""}`} onClick={() => { setFilter(value); setHitPage(1); }}>{label}</button>)}</div></div></div><div style={{ overflowX: "auto" }}><table className="l-tbl" style={{ minWidth: 1040 }}><thead><tr><th>提现单</th><th>账户</th><th className="num">金额</th><th>命中规则</th><th>维度</th><th>路由结论</th><th>命中原因</th><th>时间</th></tr></thead><tbody>
      {hits.length === 0 && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--ink-4)" }}>暂无命中日志</td></tr>}
      {hits.map((hit) => { const [actionLabel, tone] = RULE_ACT[hit.action]; return <tr key={`${hit.withdrawalNo}-${hit.ruleId}-${hit.action}`}><td className="mono">{hit.withdrawalNo}</td><td className="mono">{hit.userNo}</td><td className="num mono">{hit.amount}</td><td className="mono">{hit.ruleId}</td><td>{dimensionLabel(hit.dimension)}</td><td><span className={`bdg ${tone}`}>{actionLabel}</span></td><td>{hit.reason || "—"}</td><td className="mono">{hit.timeText}</td></tr>; })}
    </tbody></table></div><DataListPager label="命中日志" page={hitsPage?.pageNum ?? hitPage} pageSize={hitsPage?.pageSize ?? hitPageSize} total={hitsPage?.total ?? hits.length} onPageChange={setHitPage} onPageSizeChange={(next) => { setHitPageSize(next); setHitPage(1); }} pageSizeOptions={[5, 10, 20, 50]} /></section>
  </div>;
}
