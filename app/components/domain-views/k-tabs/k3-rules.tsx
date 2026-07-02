"use client";

/**
 * K3 提现风控规则引擎 — 四维规则卡(金额/速度/新账户/地址信誉)+ 规则状态机(archived 终态)+
 * 路由分布 + 命中日志 + 沙盒模拟(只读占位)。
 * 优先级:K3 delay/freeze/manual > D2 小额快速通道;pass 不产事件(隐式放行约定,与 D2 对齐)。
 * 真写:规则态 K.rule.state.<id> / 新建 K.rule.new.<名> / 调参 K.rule.<ruleKey>(沿用既有键)。
 */
import { useMemo, useState } from "react";
import { PaginationExemptionList, type BusinessFormSpec } from "../design-kit";
import { K3_DIMS, K3_RULES, K3_HITS, K3_ROUTE_COUNTS, K3_ROUTE_TOTAL, RULE_ACT, RULE_ST, type K3Rule, type RuleState } from "./data";
import { WITHDRAW_RULE_PARAMS, withdrawRuleParamKey, type WithdrawRouteSeed, type WithdrawRuleParamDef } from "@/lib/mock/admin/compute-config";
import type { KCtx } from "./types";

const fmt = (n: number) => n.toLocaleString("en-US");
const pct1 = (n: number) => (Math.round((n / K3_ROUTE_TOTAL) * 1000) / 10).toFixed(1);

const WITHDRAW_ROUTE_LABELS: Record<WithdrawRouteSeed, string> = {
  pass: "放行",
  delay: "延迟审核",
  manual: "转人工审核",
  freeze: "冻结",
  reject: "拒绝",
};
const WITHDRAW_ROUTE_OPTIONS = Object.values(WITHDRAW_ROUTE_LABELS);
const WITHDRAW_ROUTE_BY_LABEL = Object.fromEntries(
  Object.entries(WITHDRAW_ROUTE_LABELS).map(([key, label]) => [label, key]),
) as Record<string, WithdrawRouteSeed>;

type K3EditableAct = Extract<K3Rule["act"], "delay" | "freeze" | "manual">;
type MultiFieldSpec = Extract<BusinessFormSpec, { kind: "multi-field" }>;

const K3_ACTION_LABELS: Record<K3EditableAct, string> = {
  delay: "延迟",
  manual: "转人工",
  freeze: "冻结",
};
const K3_ACTION_OPTIONS = Object.values(K3_ACTION_LABELS);
const K3_ACTION_BY_LABEL = Object.fromEntries(
  Object.entries(K3_ACTION_LABELS).map(([key, label]) => [label, key]),
) as Record<string, K3EditableAct>;
const NEW_RULE_CONDITIONS = ["达到/超过阈值", "低于阈值", "命中名单或低信誉"];
const ADDRESS_SOURCE_OPTIONS = ["内部黑名单 + 链上信誉", "内部黑名单", "链上信誉服务"];

function routeLabel(value: string): string {
  return WITHDRAW_ROUTE_LABELS[value as WithdrawRouteSeed] ?? "转人工审核";
}

function k3ActionFromLabel(label: string | undefined, fallback: K3EditableAct = "delay"): K3EditableAct {
  return label ? K3_ACTION_BY_LABEL[label] ?? fallback : fallback;
}

function k3ActionLabel(act: string): string {
  return K3_ACTION_LABELS[act as K3EditableAct] ?? RULE_ACT[act]?.[0] ?? K3_ACTION_LABELS.delay;
}

function inferK3Action(value: string, fallback: K3EditableAct = "delay"): K3EditableAct {
  return (Object.entries(K3_ACTION_LABELS).find(([, label]) => value.includes(label))?.[0] as K3EditableAct | undefined) ?? fallback;
}

function pickNumber(value: string, re: RegExp, fallback: string): string {
  return re.exec(value)?.[1]?.replace(/,/g, "") ?? fallback;
}

function moneyText(value: string): string {
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n.toLocaleString("en-US") : value;
}

function ruleParamSuffix(value: string): string {
  return value.trim().replace(/\s+/g, "-").replace(/[.#/\\]/g, "-").slice(0, 96) || "custom-rule";
}

function actionField(act: K3EditableAct) {
  return {
    key: "action",
    label: "命中后处理",
    current: k3ActionLabel(act),
    inputKind: "select" as const,
    options: K3_ACTION_OPTIONS,
  };
}

function adjustRuleForm(d: (typeof K3_DIMS)[number], current: string): MultiFieldSpec {
  const act = inferK3Action(current, d.act);
  if (d.ruleKey === "largeAmountUsdt") {
    return {
      kind: "multi-field",
      title: "规则调整",
      hint: "改动后下一笔提现校验生效,历史单不回写。",
      fields: [
        { key: "amount", label: "单笔金额线(USDT)", current: pickNumber(current, /\$\s*([\d,]+(?:\.\d+)?)/, "1000"), inputKind: "number", min: 100, max: 50000 },
        actionField(act),
      ],
    };
  }
  if (d.ruleKey === "velocity24h") {
    return {
      kind: "multi-field",
      title: "规则调整",
      hint: "笔数线和累计金额线独立填写,不再把多项规则写进一个文本框。",
      fields: [
        { key: "count", label: "24小时笔数线", current: pickNumber(current, />\s*([\d,]+)\s*笔/, "3"), inputKind: "number", min: 1, max: 20 },
        { key: "amount", label: "24小时累计金额线(USDT)", current: pickNumber(current, /\$\s*([\d,]+(?:\.\d+)?)/, "5000"), inputKind: "number", min: 500, max: 50000 },
        actionField(act),
      ],
    };
  }
  if (d.ruleKey === "newAccountProtectDays") {
    return {
      kind: "multi-field",
      title: "规则调整",
      hint: "天数为 0 时等于关闭新账户保护线。",
      fields: [
        { key: "days", label: "注册天数保护期", current: pickNumber(current, /(\d+(?:\.\d+)?)\s*天/, "7"), inputKind: "number", min: 0, max: 30 },
        actionField(act),
      ],
    };
  }
  const source = ADDRESS_SOURCE_OPTIONS.find((item) => current.includes(item)) ?? ADDRESS_SOURCE_OPTIONS[0];
  return {
    kind: "multi-field",
    title: "规则调整",
    hint: "信誉来源用下拉选择,避免人工手写来源名称导致规则失配。",
    fields: [
      { key: "source", label: "信誉来源", current: source, inputKind: "select", options: ADDRESS_SOURCE_OPTIONS },
      actionField(act),
    ],
  };
}

function nextAdjustedRuleText(d: (typeof K3_DIMS)[number], v: Record<string, string> | undefined): string | undefined {
  if (!v) return undefined;
  const action = k3ActionFromLabel(v.action, d.act);
  const label = k3ActionLabel(action);
  if (d.ruleKey === "largeAmountUsdt") return `单笔 ≥ $${moneyText(v.amount)} → ${label}`;
  if (d.ruleKey === "velocity24h") return `24h > ${v.count} 笔 或 > $${moneyText(v.amount)} → ${label}`;
  if (d.ruleKey === "newAccountProtectDays") return `注册 < ${v.days} 天 → ${label}`;
  return `${v.source || ADDRESS_SOURCE_OPTIONS[0]} → ${label}`;
}

// cond **粗体** 标记渲染:关键阈值橙色强调(对应 .kdom .dim .cond b);pget 覆盖值为纯文本时原样展示。
const renderCond = (s: string) =>
  s.split("**").map((seg, i) => (i % 2 === 1 ? <b key={i}>{seg}</b> : <span key={i}>{seg}</span>));

const DIM_ICONS: Record<string, React.ReactNode> = {
  card: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10h18" /></svg>,
  wave: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h3l2-6 4 14 2-8h5" /></svg>,
  user: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3" /><path d="M3 19a6 6 0 0112 0" /><path d="M17 5v6M20 8h-6" /></svg>,
  shield: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>,
};

export function K3HeaderActions({ ctx }: { ctx: KCtx }) {
  const dryRun = () =>
    ctx.openConfirm({
      action: "沙盒模拟(对历史样本试跑)",
      detail: "拿最近 30 天的历史提现样本,把当前(含草拟)规则跑一遍,看放行 / 延迟 / 冻结 / 转人工的分布会变成什么样 —— 只读模拟,不写生产、不影响任何在途提现;跑完后生成对比报告。",
      chips: [["只读 · 不写生产", "done"], ["模拟批次落审计", "ready"]],
      okLabel: "开始模拟",
      run: () => ctx.toast("模拟已开始 · 跑完出对比报告(原型占位)"),
    });
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <span className="f-ro"><span className="d" />规则在服务器评估 · 提现请求跳不过去</span>
      <button className="f-cta" onClick={dryRun} title="规则沙盒模拟 · 只读">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M10 9l5 3-5 3z" /></svg>
        沙盒模拟(不写生产)
      </button>
    </span>
  );
}

type RuleRow = K3Rule & { stateKey?: string };

export function K3Rules({ ctx }: { ctx: KCtx }) {
  const [filter, setFilter] = useState<"all" | "delay" | "freeze" | "manual">("all");

  const ruleState = (r: RuleRow): RuleState => (ctx.pget(`K.rule.state.${r.stateKey ?? r.id}`) as RuleState | undefined) ?? r.state;
  const withdrawParamValue = (p: WithdrawRuleParamDef): string =>
    String(ctx.pget(withdrawRuleParamKey(p.key)) ?? p.defaultVal);

  const editWithdrawParam = (p: WithdrawRuleParamDef) => {
    if (p.kind === "boolean") {
      const current = withdrawParamValue(p) === "true" ? "开启" : "关闭";
      ctx.openActionConfirm({
        action: `提现前置参数调整 · ${p.label}`,
        detail: `${p.label} · 当前 ${current}。${p.desc}${p.frontendEffect} 改动后下一笔提现请求生效,在途单不回写。`,
        amplifies: true,
        edit: { kind: "select", current, options: ["开启", "关闭"] },
        run: (reason, newVal) => {
          if (!newVal) return;
          const next = newVal === "开启" ? "true" : "false";
          ctx.setParam(withdrawRuleParamKey(p.key), next, { action: `调整提现前置参数 ${p.label}为${newVal}`, reason });
          ctx.toast(`${p.label} 已更新为${newVal} · 下一笔提现生效`);
        },
      });
      return;
    }
    if (p.key === "sameAddressRoute") {
      const currentLabel = routeLabel(withdrawParamValue(p));
      ctx.openActionConfirm({
        action: `提现前置参数调整 · ${p.label}`,
        detail: `${p.label} · 当前 ${currentLabel}。${p.desc}${p.frontendEffect} 改动后下一笔提现请求生效,在途单不回写。`,
        amplifies: true,
        edit: { kind: "select", current: currentLabel, options: WITHDRAW_ROUTE_OPTIONS },
        run: (reason, newVal) => {
          const next = newVal ? WITHDRAW_ROUTE_BY_LABEL[newVal] : undefined;
          if (!next) return;
          ctx.setParam(withdrawRuleParamKey(p.key), next, { action: `调整提现前置参数 ${p.label}为${WITHDRAW_ROUTE_LABELS[next]}`, reason });
          ctx.toast(`${p.label} 已更新为${WITHDRAW_ROUTE_LABELS[next]} · 下一笔提现生效`);
        },
      });
      return;
    }
    ctx.openActionConfirm({
      action: `提现前置参数调整 · ${p.label}`,
      detail: `${p.label} · 当前 ${withdrawParamValue(p)} ${p.unit}。${p.desc}${p.frontendEffect} 改动后下一次提交提现生效,历史账单不回写。`,
      amplifies: false,
      edit: { kind: "number", current: withdrawParamValue(p), unit: p.unit, gt: 0 },
      run: (reason, newVal) => {
        if (!newVal) return;
        ctx.setParam(withdrawRuleParamKey(p.key), newVal, { action: `调整提现前置参数 ${p.label}`, reason });
        ctx.toast(`${p.label} 已更新 · 下一次提交提现生效`);
      },
    });
  };

  // 新建规则派生:key 后缀 = 输入的条件表达式(同时作为 cond 展示与状态键),id 按序派生 WR-C{n}。
  const customRules: RuleRow[] = useMemo(
    () =>
      Object.entries(ctx.params)
        .filter(([k]) => k.startsWith("K.rule.new."))
        .map(([k, v], i) => {
          const cond = k.slice("K.rule.new.".length);
          const text = String(v) || cond;
          return { id: `WR-C${i + 1}`, dim: "自定义", cond: text, act: inferK3Action(text), state: ((ctx.params[`K.rule.state.${cond}`] as RuleState | undefined) ?? "draft"), stateKey: cond };
        }),
    [ctx.params],
  );
  const allRules: RuleRow[] = [...K3_RULES, ...customRules];

  const toggleRule = (r: RuleRow, to: "active" | "paused") =>
    ctx.openActionConfirm({
      action: `${to === "active" ? "启用规则" : "停用规则"} · ${r.id}`,
      detail: `${r.id}(${r.dim} · ${r.cond} → ${RULE_ACT[r.act][0]})${to === "active" ? "重新生效" : "停用"}。启停直接改变资金出口的摩擦,所以操作确认;通过后下一笔提现校验生效并写入审计。`,
      amplifies: to === "paused", // 停用规则 = 减摩擦放大流出 → B1 预检;启用 = 收紧不挂
      run: (reason) => {
        ctx.setParam(`K.rule.state.${r.stateKey ?? r.id}`, to, { action: `${to === "active" ? "启用" : "停用"}提现风控规则 ${r.id}`, reason });
        ctx.toast(`${r.id} 已${to === "active" ? "启用" : "停用"} · 理由留痕`);
      },
    });

  const archiveRule = (r: RuleRow) =>
    ctx.openConfirm({
      action: `归档规则 · ${r.id}`,
      detail: "归档是软删除终态:归档后不能再启用,服务器会拒绝这次操作。以后要复用这条规则的逻辑,得新建草稿并复制条件。",
      chips: [["终态 · 不可再启用", "done"], ["复用须新建草稿", "ready"]],
      reason: true,
      okLabel: "确认归档",
      run: (reason) => {
        ctx.setParam(`K.rule.state.${r.stateKey ?? r.id}`, "archived", { action: `归档提现风控规则 ${r.id}`, reason });
        ctx.toast(`${r.id} 已归档`);
      },
    });

  const newRule = () =>
    ctx.openActionConfirm({
      action: "新建提现风控规则",
      detail: "选择维度、判断方式、阈值和命中后处理。新规则由系统自动编号并先进「草拟」,经操作确认后生效;规则批改属于参数批改,一律操作确认并写入审计。",
      businessForm: {
        kind: "multi-field",
        title: "新规则配置",
        hint: "维度和处理方式用下拉选择,阈值用数字框填写,避免把多项业务含义写进一个文本框。",
        fields: [
          { key: "dimension", label: "规则维度", current: K3_DIMS[0]?.name ?? "金额", inputKind: "select", options: K3_DIMS.map((d) => d.name) },
          { key: "condition", label: "判断方式", current: NEW_RULE_CONDITIONS[0], inputKind: "select", options: NEW_RULE_CONDITIONS },
          { key: "threshold", label: "阈值", current: "1000", inputKind: "number", min: 0 },
          { key: "action", label: "命中后处理", current: K3_ACTION_LABELS.delay, inputKind: "select", options: K3_ACTION_OPTIONS },
        ],
      },
      run: (reason, _newVal, businessValue) => {
        const dim = businessValue?.dimension ?? K3_DIMS[0]?.name ?? "金额";
        const condition = businessValue?.condition ?? NEW_RULE_CONDITIONS[0];
        const threshold = businessValue?.threshold ?? "";
        const act = k3ActionFromLabel(businessValue?.action);
        const action = k3ActionLabel(act);
        const comparator = condition === "低于阈值" ? "<" : condition === "命中名单或低信誉" ? "命中" : "≥";
        const ruleText = comparator === "命中" ? `${dim} 命中名单或低信誉 → ${action}` : `${dim} ${comparator} ${threshold} → ${action}`;
        const key = ruleParamSuffix(ruleText);
        ctx.setParam(`K.rule.new.${key}`, ruleText, { action: `新建提现风控规则:${ruleText}`, reason });
        ctx.toast(`新规则「${ruleText}」已进草拟 · 待操作确认生效`);
      },
    });

  const adjRule = (d: (typeof K3_DIMS)[number]) => {
    const cur = String(ctx.pget(`K.rule.${d.ruleKey}`) ?? d.condDefault);
    ctx.openActionConfirm({
      action: `规则阈值调整 · ${d.name}`,
      detail: `${d.name} · 当前「${cur}」· ${d.note}。改后下一笔提现校验生效,不影响在途单;放宽方向放大资金流出,须先核验 B1 覆盖率并写入审计。`,
      amplifies: true,
      businessForm: adjustRuleForm(d, cur),
      run: (reason, _newVal, businessValue) => {
        const next = nextAdjustedRuleText(d, businessValue);
        if (!next) return;
        ctx.setParam(`K.rule.${d.ruleKey}`, next, { action: `调整提现风控规则 ${d.name}`, reason });
        ctx.toast(`提现风控规则「${d.name}」已更新阈值`);
      },
    });
  };

  const hits = K3_HITS.filter((h) => filter === "all" || h[5] === filter);

  return (
    <div>
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">自动放行率(7 天)</div><div className="v">{pct1(K3_ROUTE_COUNTS[0].n)}%</div><div className="sub">{fmt(K3_ROUTE_COUNTS[0].n)} / {fmt(K3_ROUTE_TOTAL)} 笔直接过</div></div>
        <div className="f-stat warn"><div className="k">延迟处理</div><div className="v">{pct1(K3_ROUTE_COUNTS[1].n)}%</div><div className="sub">多为提速超限 + 新账户</div></div>
        <div className="f-stat cyan"><div className="k">转人工</div><div className="v">{pct1(K3_ROUTE_COUNTS[2].n)}%</div><div className="sub">大额为主 · 进 D2 队列分诊</div></div>
        <div className="f-stat danger"><div className="k">冻结</div><div className="v">{pct1(K3_ROUTE_COUNTS[3].n)}%</div><div className="sub">低信誉地址 · {K3_ROUTE_COUNTS[3].n} 笔</div></div>
      </div>

      {/* SPEC-7 提现前置参数 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">提现前置参数</span>
          <span className="sub">· 最低金额、同地址多账号处理结论全部后台可调 · 改动走操作确认和审计</span>
          <div className="r"><span className="kcode electric">下次提交生效</span></div>
        </div>
        <div className="l-b">
          <div className="param-list" data-proof="k3-withdraw-rule-params">
            {WITHDRAW_RULE_PARAMS.map((p) => {
              const current = withdrawParamValue(p);
              const display = p.key === "sameAddressRoute"
                ? routeLabel(current)
                : p.kind === "boolean"
                  ? (current === "true" ? "开启" : "关闭")
                  : `${current} ${p.unit}`;
              return (
                <div className="p" key={p.key}>
                  <div className="txt">
                    <div className="k">{p.label}</div>
                    <div className="s">{p.desc}</div>
                  </div>
                  <span className="v">{display}</span>
                  <button className="l-btn sm mc" onClick={() => editWithdrawParam(p)}>调整</button>
                </div>
              );
            })}
          </div>
          <div className="ktint warn" style={{ marginTop: 12 }}>
            <b>落地规则</b> · 同一收款地址被多账号使用时,服务端先给出处理结论,提现页只展示提交结果,不会靠客户端倒计时自动变成已打款。
          </div>
        </div>
      </section>

      {/* 四维规则卡 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">四道关 · 规则配置</span>
          <span className="sub">· 改阈值 / 改命中动作都走操作确认 · 改后下一笔提现校验生效</span>
          <div className="r"><span className="kcode electric">命中动作:延迟 / 冻结 / 转人工</span></div>
        </div>
        <div className="l-b">
          <div className="dim-grid">
            {K3_DIMS.map((d) => {
              const cur = ctx.pget(`K.rule.${d.ruleKey}`);
              return (
                <div className="dim" key={d.ruleKey}>
                  <div className="top"><span className="ic">{DIM_ICONS[d.icon]}</span><div className="nm">{d.name}</div></div>
                  <div className="cond">{cur ? <>{cur}<span style={{ color: "var(--ink-4)" }}> · 已调整</span></> : renderCond(d.cond)}</div>
                  <div className="why">{d.why}</div>
                  <div className="ft">
                    <span className={`act ${d.act}`}>{RULE_ACT[d.act][0]}</span>
                    <button className="l-btn sm mc" onClick={() => adjRule(d)} title={`PRD K3③ ${d.name}`}>调整</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <div className="two-col r135">
        {/* 规则总表 + 状态机 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">规则总表</span>
            <span className="sub">· 已归档的规则不能再启用,要复用得新建草稿复制条件</span>
            <div className="r"><button className="l-btn mc" onClick={newRule}>+ 新建规则(操作确认)</button></div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 660 }}>
              <thead><tr><th>规则</th><th>维度</th><th>条件</th><th>命中动作</th><th>状态</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
              <tbody>
                {allRules.map((r) => {
                  const st = ruleState(r);
                  const [stLb, stTone] = RULE_ST[st];
                  const [actLb, actTone] = RULE_ACT[r.act];
                  return (
                    <tr key={r.id}>
                      <td className="mono" style={{ color: "var(--ink)", fontWeight: 600 }}>{r.id}</td>
                      <td>{r.dim}</td>
                      <td className="mono" style={{ fontSize: 12, color: "var(--ink-2)" }}>{r.cond}</td>
                      <td><span className={`bdg ${actTone}`}>{actLb}</span></td>
                      <td><span className={`bdg ${stTone}`}>{stLb}</span></td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          {st === "active" && <button className="l-btn sm mc" onClick={() => toggleRule(r, "paused")}>停用</button>}
                          {st === "paused" && <><button className="l-btn sm mc" onClick={() => toggleRule(r, "active")}>启用</button><button className="l-btn sm" onClick={() => archiveRule(r)}>归档</button></>}
                          {st === "archived" && <button className="l-btn sm" onClick={() => ctx.toast("已归档规则不能再启用,请新建草稿复制其条件")}>启用?</button>}
                          {st === "draft" && <button className="l-btn sm mc" onClick={() => toggleRule(r, "active")}>提交生效</button>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="l-b" style={{ paddingTop: 12 }}>
            <div className="sm-strip">
              <span className="st">草拟</span><span className="ar">操作确认 →</span>
              <span className="st ok">生效中</span><span className="ar">⇄ 操作确认</span>
              <span className="st warn">已停用</span><span className="ar">→</span>
              <span className="st">已归档(终态 · 不可再启用)</span>
            </div>
          </div>
        </section>

        {/* 路由分布 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">路由结果分布(7 天)</span>
            <span className="sub">· 评估规则松紧用</span>
          </div>
          <div className="l-b">
            <div className="route-bar">
              {K3_ROUTE_COUNTS.map((r) => (
                <i key={r.key} style={{ width: `${pct1(r.n)}%`, background: r.color }} title={`${r.label} ${pct1(r.n)}%`} />
              ))}
            </div>
            <div className="route-legend">
              {K3_ROUTE_COUNTS.map((r) => (
                <span className="it" key={r.key}><span className="d2" style={{ background: r.color }} />{r.label} {pct1(r.n)}%</span>
              ))}
            </div>
            <div className="ktint" style={{ marginTop: 14, fontSize: 12 }}>
              <b>两条优先级规矩</b> · ① 这里给出延迟 / 冻结 / 转人工结论时,提现队列的「小额快速通道」<b>不能盖过它</b> —— 只有这里放行的小额,那边才能单人即时放行;② 大额提现上,这里的路由和大额 KYC 复审(K5)<b>同时叠加、互不替代</b>:一个管钱的出口,一个管身份合规。
            </div>
            <div className="ktint" style={{ marginTop: 10, fontSize: 12 }}>
              <b>「放行」不发事件</b> · 只有延迟 / 冻结 / 转人工会产命中事件给提现队列;没收到事件就是放行 —— 这一隐式约定已和 D2 对齐,别把「没事件」当漏检。
            </div>
          </div>
        </section>
      </div>

      {/* 命中日志 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">命中日志</span>
          <span className="sub">· 最近命中规则的提现请求 · 结论已下发提现队列</span>
          <div className="r">
            <div className="chips">
              {([["all", "全部"], ["delay", "延迟"], ["freeze", "冻结"], ["manual", "转人工"]] as const).map(([v, lb]) => (
                <button key={v} className={`chip${filter === v ? " sel" : ""}`} onClick={() => setFilter(v)}>{lb}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 880 }}>
            <thead><tr><th>提现单</th><th>账户</th><th className="num">金额</th><th>命中规则</th><th>维度</th><th>路由结论</th><th>时间</th></tr></thead>
            <tbody>
              {hits.map((h, i) => {
                const [actLb, actTone] = RULE_ACT[h[5]];
                return (
                  <tr key={`${h[0]}-${h[3]}-${i}`}>
                    <td className="mono" style={{ color: "var(--ink)" }}>{h[0]}</td>
                    <td className="mono">{h[1]}</td>
                    <td className="num mono" style={{ fontWeight: 700 }}>{h[2]}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{h[3]}</td>
                    <td style={{ fontSize: 12.5 }}>{h[4]}</td>
                    <td><span className={`bdg ${actTone}`}>{actLb}</span></td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>今天 {h[6]}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <p className="f-foot">
        <b>所有评估都在服务器</b>:提现请求到达时服务端逐条过规则,客户端没有任何办法跳过;KYC 地址匹配、提现惩罚费率/NEX 抵扣这些既有门槛照常二次校验,这里的路由结论叠加在它们之上。命中冻结的提现单进「冻结」状态(客户端只能看),延迟的延长审核停留,转人工的进 D2 队列由人分诊 —— D2 同时展示风险评分(K4)+ 命中规则(本页),两套信号配合分诊。<b>提现冷却天数、提现惩罚费率不在这里设</b> —— 那是运营节奏参数,归 H1 派发、在提现配置(D5)生效。命中事件同时喂风险雷达(B5)。
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "规则总表",
            kind: "reference-catalog",
            maxRows: 6,
            reason: "提现规则固定六条,需要同屏校验四道关和动作",
          },
          {
            label: "命中日志",
            kind: "sample-ledger",
            maxRows: 7,
            reason: "命中日志当前七条样本,真实提现处置回 D2 队列",
          },
        ]}
      />
    </div>
  );
}
