"use client";

import { useEffect, useState, type ReactNode } from "react";
import { DataListPager, type BusinessFormSpec, type BusinessFormValue } from "../design-kit";
import type { K3Dimension, K3Rule, RuleAction, RuleState } from "@/lib/admin/k-client";
import { usePropose } from "@/lib/admin/use-propose";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import type { KCtx } from "./types";

const fmt = (n: number) => n.toLocaleString("en-US");

const RULE_ACT: Record<RuleAction, [string, string]> = {
  pass: ["放行", "ok"],
  delay: ["延迟", "warn"],
  freeze: ["冻结", "bad"],
  manual: ["转人工", "cyan"],
};

const RULE_ST: Record<RuleState, [string, string]> = {
  draft: ["草拟", "dim"],
  active: ["生效", "ok"],
  paused: ["停用", "warn"],
  archived: ["归档", "dim"],
};

type K3RuleKind = "amount" | "velocity" | "newAccount" | "address";
type K3RuleDimensionName = "金额" | "速度" | "新账户" | "地址信誉";

const ACTION_LABELS: Record<RuleAction, string> = {
  pass: "放行",
  delay: "延迟",
  freeze: "冻结",
  manual: "转人工",
};

const ACTION_BY_LABEL: Record<string, RuleAction> = {
  放行: "pass",
  延迟: "delay",
  冻结: "freeze",
  转人工: "manual",
  pass: "pass",
  delay: "delay",
  freeze: "freeze",
  manual: "manual",
};

const DIMENSION_OPTIONS: K3RuleDimensionName[] = ["金额", "速度", "新账户", "地址信誉"];
const ACTION_OPTIONS = [ACTION_LABELS.delay, ACTION_LABELS.manual, ACTION_LABELS.freeze, ACTION_LABELS.pass];
const ADDRESS_SOURCE_OPTIONS = ["黑名单 / 低信誉地址", "内部黑名单 + 链上信誉", "内部黑名单", "链上信誉", "第三方链上信誉", "内部 + 第三方信誉"];

const DIM_ICONS: Record<string, ReactNode> = {
  card: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10h18" /></svg>,
  wave: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12h3l2-6 4 14 2-8h5" /></svg>,
  user: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3" /><path d="M3 19a6 6 0 0112 0" /><path d="M17 5v6M20 8h-6" /></svg>,
  shield: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" /><path d="M9 12l2 2 4-4" /></svg>,
};

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "UNKNOWN_ERROR";
}

const renderCond = (s: string) =>
  s.split("**").map((seg, i) => (i % 2 === 1 ? <b key={i}>{seg}</b> : <span key={i}>{seg}</span>));

function conditionCore(text: string) {
  return (text.split(/->|→/)[0] ?? "").trim();
}

function moneyText(value: string | undefined, fallback: string) {
  const parsed = Number(String(value ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? String(Math.round(parsed)) : fallback;
}

function formatMoney(value: string | undefined) {
  const parsed = Number(String(value ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) ? parsed.toLocaleString("en-US") : "0";
}

function k3KindFromDimension(dimension: string, ruleKey = ""): K3RuleKind {
  const text = `${dimension} ${ruleKey}`;
  if (text.includes("速度") || text.includes("velocity")) return "velocity";
  if (text.includes("新账户") || text.includes("newAccount")) return "newAccount";
  if (text.includes("地址信誉") || text.includes("addressReputation")) return "address";
  return "amount";
}

function dimensionFromForm(value: string | undefined): K3RuleDimensionName {
  return DIMENSION_OPTIONS.includes(value as K3RuleDimensionName) ? (value as K3RuleDimensionName) : "金额";
}

function parseK3Condition(kind: K3RuleKind, text: string): BusinessFormValue {
  const core = conditionCore(text).replace("，", ",");
  if (kind === "amount") {
    const matched = core.match(/^单笔\s*(>=|>)\s*\$?([\d,]+)$/);
    return { amountOp: matched?.[1] ?? ">=", amount: moneyText(matched?.[2], "1000") };
  }
  if (kind === "velocity") {
    const matched = core.match(/^24h\s*(>=|>)\s*(\d+)\s*笔\s*或\s*(>=|>)\s*\$?([\d,]+)$/i);
    return {
      countOp: matched?.[1] ?? ">",
      count: matched?.[2] ?? "3",
      velocityAmountOp: matched?.[3] ?? ">",
      velocityAmount: moneyText(matched?.[4], "5000"),
    };
  }
  if (kind === "newAccount") {
    const matched = core.match(/^注册\s*(<|<=)\s*(\d+)\s*天$/);
    return { accountOp: matched?.[1] ?? "<", days: matched?.[2] ?? "7" };
  }
  return {
    addressSource: ADDRESS_SOURCE_OPTIONS.includes(core) ? core : "黑名单 / 低信誉地址",
  };
}

function k3RuleBusinessForm(kind: K3RuleKind, current: string): BusinessFormSpec {
  const parsed = parseK3Condition(kind, current);
  if (kind === "amount") {
    return {
      kind: "multi-field",
      title: "金额规则",
      hint: "单笔提现金额达到阈值后进入对应路由,范围 $100-$50,000。",
      fields: [
        { key: "amountOp", label: "比较符", current: parsed.amountOp, inputKind: "select", options: [">=", ">"] },
        { key: "amount", label: "单笔金额 USD", current: parsed.amount, inputKind: "number", min: 100, max: 50000, step: 100 },
      ],
    };
  }
  if (kind === "velocity") {
    return {
      kind: "multi-field",
      title: "速度规则",
      hint: "24 小时内笔数或累计金额任一命中即触发,笔数 1-20,金额 $500-$50,000。",
      fields: [
        { key: "countOp", label: "笔数比较符", current: parsed.countOp, inputKind: "select", options: [">=", ">"] },
        { key: "count", label: "24h 笔数", current: parsed.count, inputKind: "number", min: 1, max: 20, step: 1 },
        { key: "velocityAmountOp", label: "金额比较符", current: parsed.velocityAmountOp, inputKind: "select", options: [">=", ">"] },
        { key: "velocityAmount", label: "24h 金额 USD", current: parsed.velocityAmount, inputKind: "number", min: 500, max: 50000, step: 500 },
      ],
    };
  }
  if (kind === "newAccount") {
    return {
      kind: "multi-field",
      title: "新账户保护",
      hint: "注册天数命中新账户保护窗口后进入延迟或人工复核,范围 0-30 天。",
      fields: [
        { key: "accountOp", label: "注册天数比较符", current: parsed.accountOp, inputKind: "select", options: ["<", "<="] },
        { key: "days", label: "注册天数", current: parsed.days, inputKind: "number", min: 0, max: 30, step: 1 },
      ],
    };
  }
  return {
    kind: "multi-field",
    title: "地址信誉源",
    hint: "地址信誉源从枚举项选择,不允许手写来源名称。",
    fields: [
      { key: "addressSource", label: "信誉来源", current: parsed.addressSource, inputKind: "select", options: ADDRESS_SOURCE_OPTIONS, wide: true },
    ],
  };
}

function newK3RuleBusinessForm(): BusinessFormSpec {
  return {
    kind: "multi-field",
    title: "新建规则",
    hint: "先选择规则维度,系统只提交该维度对应字段并生成规范规则条件。",
    fields: [
      { key: "dimension", label: "规则维度", current: "金额", inputKind: "select", options: DIMENSION_OPTIONS },
      { key: "action", label: "命中动作", current: "延迟", inputKind: "select", options: ACTION_OPTIONS },
      { key: "amountOp", label: "金额比较符", current: ">=", inputKind: "select", options: [">=", ">"] },
      { key: "amount", label: "单笔金额 USD", current: "1000", inputKind: "number", min: 100, max: 50000, step: 100 },
      { key: "countOp", label: "笔数比较符", current: ">", inputKind: "select", options: [">=", ">"] },
      { key: "count", label: "24h 笔数", current: "3", inputKind: "number", min: 1, max: 20, step: 1 },
      { key: "velocityAmountOp", label: "24h 金额比较符", current: ">", inputKind: "select", options: [">=", ">"] },
      { key: "velocityAmount", label: "24h 金额 USD", current: "5000", inputKind: "number", min: 500, max: 50000, step: 500 },
      { key: "accountOp", label: "注册天数比较符", current: "<", inputKind: "select", options: ["<", "<="] },
      { key: "days", label: "注册天数", current: "7", inputKind: "number", min: 0, max: 30, step: 1 },
      { key: "addressSource", label: "地址信誉来源", current: "黑名单 / 低信誉地址", inputKind: "select", options: ADDRESS_SOURCE_OPTIONS, wide: true },
    ],
  };
}

function buildK3Condition(kind: K3RuleKind, value?: BusinessFormValue) {
  if (!value) return "";
  if (kind === "amount") return `单笔 ${value.amountOp || ">="} $${formatMoney(value.amount)}`;
  if (kind === "velocity") return `24h ${value.countOp || ">"} ${value.count || "3"} 笔 或 ${value.velocityAmountOp || ">"} $${formatMoney(value.velocityAmount)}`;
  if (kind === "newAccount") return `注册 ${value.accountOp || "<"} ${value.days || "7"} 天`;
  return value.addressSource || "黑名单 / 低信誉地址";
}

function actionFromBusinessValue(value?: BusinessFormValue): RuleAction {
  return ACTION_BY_LABEL[value?.action ?? ""] ?? "delay";
}

function pct1(n: number, total: number) {
  if (!total) return "0.0";
  return (Math.round((n / total) * 1000) / 10).toFixed(1);
}

export function K3HeaderActions({ ctx }: { ctx: KCtx }) {
  const dryRun = () =>
    ctx.openConfirm({
      action: "沙盒模拟(对历史样本试跑)",
      detail: "拿最近 30 天历史提现样本按当前规则试跑。只读模拟,不写生产。",
      chips: [["只读 · 不写生产", "done"], ["模拟批次落审计", "ready"]],
      reason: true,
      okLabel: "开始模拟",
      run: (reason) => {
        ctx.actions.dryRunK3(reason)
          .then(() => ctx.toast("模拟已开始 · 后端已记录 dry-run 批次"))
          .catch((error) => ctx.toast(`K3 模拟失败 · ${errorText(error)}`));
      },
    });
  return (
    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
      <span className="f-ro"><span className="d" />规则在服务器评估 · 提现请求跳不过去</span>
      <button className="f-cta" onClick={dryRun}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M10 9l5 3-5 3z" /></svg>
        沙盒模拟(不写生产)
      </button>
    </span>
  );
}

export function K3Rules({ ctx }: { ctx: KCtx }) {
  const propose = usePropose();
  const [filter, setFilter] = useState<"all" | RuleAction>("all");
  const [rulePage, setRulePage] = useState(1);
  const [rulePageSize, setRulePageSize] = useState(5);
  const [hitPage, setHitPage] = useState(1);
  const [hitPageSize, setHitPageSize] = useState(5);
  const overview = ctx.risk.withdrawRules;
  const dimensions = overview?.dimensions ?? [];
  const rulesPage = overview?.rules;
  const rules = rulesPage?.records ?? [];
  const routeCounts = overview?.routeCounts ?? [];
  const routeTotal = overview?.routeTotal ?? 0;
  const hitsPage = overview?.hits;
  const hits = hitsPage?.records ?? [];

  useEffect(() => {
    void ctx.reloadKRisk({
      withdrawRules: {
        rulePageNum: rulePage,
        rulePageSize,
        hitPageNum: hitPage,
        hitPageSize,
        hitAction: filter,
      },
    });
  }, [ctx.reloadKRisk, rulePage, rulePageSize, hitPage, hitPageSize, filter]);

  const runAction = async (work: () => Promise<void>, ok: string) => {
    try {
      await work();
      await ctx.reloadKRisk({
        withdrawRules: {
          rulePageNum: rulePage,
          rulePageSize,
          hitPageNum: hitPage,
          hitPageSize,
          hitAction: filter,
        },
      });
      ctx.toast(ok);
    } catch (error) {
      ctx.toast(`K3 操作失败 · ${errorText(error)}`);
    }
  };

  const toggleRule = (r: K3Rule, to: "active" | "paused") =>
    ctx.openActionConfirm({
      action: `${to === "active" ? "启用规则" : "停用规则"} · ${r.ruleId}`,
      detail: `${r.ruleId}(${r.dimension} · ${r.conditionText} → ${RULE_ACT[r.action][0]})${to === "active" ? "重新生效" : "停用"}。改后下一笔提现校验生效。`,
      amplifies: to === "paused",
      run: (reason) => {
        const def = findHighOp("k3_rule_toggle")!;
        void propose(ctx.toast, {
          action: `${to === "active" ? "启用规则" : "停用规则"} · ${r.ruleId}`,
          obj: r.ruleId,
          before: r.state,
          after: to,
          type: "param",
          amplifies: to === "paused",
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "K3",
          command: def.buildCommand({ ruleId: r.ruleId, state: to }),
          target: def.buildTarget({ ruleId: r.ruleId }),
        });
      },
    });

  const archiveRule = (r: K3Rule) =>
    ctx.openConfirm({
      action: `归档规则 · ${r.ruleId}`,
      detail: "归档是软删除终态,归档后不能再启用。",
      chips: [["终态 · 不可再启用", "done"], ["复用须新建草稿", "ready"]],
      reason: true,
      okLabel: "确认归档",
      run: (reason) => {
        const def = findHighOp("k3_rule_archive")!;
        void propose(ctx.toast, {
          action: `归档规则 · ${r.ruleId}`,
          obj: r.ruleId,
          before: r.state,
          after: "archived",
          type: "param",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "K3",
          command: def.buildCommand({ ruleId: r.ruleId }),
          target: def.buildTarget({ ruleId: r.ruleId }),
        });
      },
    });

  const newRule = () =>
    ctx.openActionConfirm({
      action: "新建提现风控规则",
      detail: "选择规则维度、命中动作和阈值,新规则由服务器分配编号并先进草拟状态。",
      businessForm: newK3RuleBusinessForm(),
      run: (reason, _newVal, businessValue) => {
        const dimension = dimensionFromForm(businessValue?.dimension);
        const kind = k3KindFromDimension(dimension);
        const condition = buildK3Condition(kind, businessValue);
        if (!condition) {
          ctx.toast("K3 规则配置不完整");
          return;
        }
        const action = actionFromBusinessValue(businessValue);
        const def = findHighOp("k3_rule_create")!;
        void propose(ctx.toast, {
          action: `新建提现风控规则 · ${dimension}`,
          obj: `${dimension}:${condition}`,
          before: "—",
          after: `${dimension} · ${condition} → ${ACTION_LABELS[action]}`,
          type: "param",
          amplifies: false,
          gate: { roles: [] },
          gateLabel: def.gateLabel,
          reason,
          sourceDomain: "K3",
          command: def.buildCommand({ dimension, conditionText: condition, action }),
          target: def.buildTarget({ dimension, conditionText: condition }),
        });
      },
    });

  const adjRule = (d: K3Dimension) => {
    const kind = k3KindFromDimension(d.name, d.ruleKey);
    ctx.openActionConfirm({
      action: `规则阈值调整 · ${d.name}`,
      detail: `${d.name} · 当前「${d.conditionText}」· ${d.note}`,
      amplifies: true,
      businessForm: k3RuleBusinessForm(kind, d.conditionText),
      run: (reason, _newVal, businessValue) => {
        const condition = buildK3Condition(kind, businessValue);
        if (!condition || !d.ruleId) {
          ctx.toast("K3 规则配置不完整");
          return;
        }
        void runAction(() => ctx.actions.updateK3RuleCondition(d.ruleId, condition, reason), `${d.name} 条件已更新`);
      },
    });
  };

  if (ctx.contentLoading && !overview) {
    return <section className="l-card"><div className="l-h"><span className="ttl">K3 数据加载中</span><span className="sub">· 正在读取后端 risk 接口</span></div></section>;
  }

  const byKey = Object.fromEntries(routeCounts.map((row) => [row.key, row]));

  return (
    <div>
      <div className="f-stats">
        {(["pass", "delay", "manual", "freeze"] as RuleAction[]).map((key) => {
          const row = byKey[key];
          const [label, tone] = RULE_ACT[key];
          return (
            <div className={`f-stat ${tone}`} key={key}>
              <div className="k">{label}</div>
              <div className="v">{pct1(row?.count ?? 0, routeTotal)}%</div>
              <div className="sub">{fmt(row?.count ?? 0)} / {fmt(routeTotal)} 笔</div>
            </div>
          );
        })}
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">四道关 · 规则配置</span>
          <span className="sub">· 改阈值 / 改命中动作都走操作确认</span>
          <div className="r"><span className="kcode electric">命中动作:pass / delay / freeze / manual</span></div>
        </div>
        <div className="l-b">
          <div className="dim-grid">
            {dimensions.map((d) => (
              <div className="dim" key={d.ruleKey}>
                <div className="top"><span className="ic">{DIM_ICONS[d.icon] ?? DIM_ICONS.shield}</span><div className="nm">{d.name}</div></div>
                <div className="cond">{renderCond(d.conditionText)}</div>
                <div className="why">{d.why}</div>
                <div className="ft">
                  <span className={`act ${d.action}`}>{d.action}</span>
                  <button className="l-btn sm mc" onClick={() => adjRule(d)}>调整</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <div className="two-col r135">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">规则总表</span>
            <span className="sub">· 已归档规则不能再启用</span>
            <div className="r"><button className="l-btn mc" onClick={newRule}>+ 新建规则</button></div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl" style={{ minWidth: 660 }}>
              <thead><tr><th>规则</th><th>维度</th><th>条件</th><th>命中动作</th><th>状态</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
              <tbody>
                {rules.map((r) => {
                  const [stLb, stTone] = RULE_ST[r.state];
                  const [actLb, actTone] = RULE_ACT[r.action];
                  return (
                    <tr key={r.ruleId}>
                      <td className="mono" style={{ color: "var(--ink)", fontWeight: 600 }}>{r.ruleId}</td>
                      <td>{r.dimension}</td>
                      <td className="mono" style={{ fontSize: 12, color: "var(--ink-2)" }}>{r.conditionText}</td>
                      <td><span className={`bdg ${actTone}`}>{actLb}</span></td>
                      <td><span className={`bdg ${stTone}`}>{stLb}</span></td>
                      <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          {r.state === "active" && <button className="l-btn sm mc" onClick={() => toggleRule(r, "paused")}>停用</button>}
                          {r.state === "paused" && <><button className="l-btn sm mc" onClick={() => toggleRule(r, "active")}>启用</button><button className="l-btn sm" onClick={() => archiveRule(r)}>归档</button></>}
                          {r.state === "archived" && <button className="l-btn sm" onClick={() => ctx.toast("服务器拒绝:已归档规则不能再启用,请新建草稿复制条件")}>启用?</button>}
                          {r.state === "draft" && <button className="l-btn sm mc" onClick={() => toggleRule(r, "active")}>提交生效</button>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <DataListPager
            label="规则总表"
            page={rulesPage?.pageNum ?? rulePage}
            pageSize={rulesPage?.pageSize ?? rulePageSize}
            total={rulesPage?.total ?? rules.length}
            onPageChange={setRulePage}
            onPageSizeChange={(next) => {
              setRulePageSize(next);
              setRulePage(1);
            }}
            pageSizeOptions={[5, 10, 20]}
          />
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">路由结果分布</span>
            <span className="sub">· 评估规则松紧用</span>
          </div>
          <div className="l-b">
            <div className="route-bar">
              {routeCounts.map((r) => (
                <i key={r.key} style={{ width: `${pct1(r.count, routeTotal)}%`, background: r.color }} title={`${r.label} ${pct1(r.count, routeTotal)}%`} />
              ))}
            </div>
            <div className="route-legend">
              {routeCounts.map((r) => (
                <span className="it" key={r.key}><span className="d2" style={{ background: r.color }} />{r.label} {pct1(r.count, routeTotal)}%</span>
              ))}
            </div>
          </div>
        </section>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">命中日志</span>
          <span className="sub">· 最近命中规则的提现请求</span>
          <div className="r">
            <div className="chips">
              {([["all", "全部"], ["delay", "延迟"], ["freeze", "冻结"], ["manual", "转人工"]] as const).map(([v, lb]) => (
                <button
                  key={v}
                  className={`chip${filter === v ? " sel" : ""}`}
                  onClick={() => {
                    setFilter(v);
                    setHitPage(1);
                  }}
                >
                  {lb}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1040 }}>
            <thead><tr><th>提现单</th><th>账户</th><th className="num">金额</th><th>命中规则</th><th>维度</th><th>路由结论</th><th>命中原因</th><th>时间</th></tr></thead>
            <tbody>
              {hits.map((h) => {
                const [actLb, actTone] = RULE_ACT[h.action];
                return (
                  <tr key={`${h.withdrawalNo}-${h.ruleId}-${h.action}`}>
                    <td className="mono" style={{ color: "var(--ink)" }}>{h.withdrawalNo}</td>
                    <td className="mono">{h.userNo}</td>
                    <td className="num mono" style={{ fontWeight: 700 }}>{h.amount}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{h.ruleId}</td>
                    <td style={{ fontSize: 12.5 }}>{h.dimension}</td>
                    <td><span className={`bdg ${actTone}`}>{actLb}</span></td>
                    <td title={h.reason || undefined} style={{ maxWidth: 260, fontSize: 12.5, color: "var(--ink-2)" }}>{h.reason || "—"}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{h.timeText}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <DataListPager
          label="命中日志"
          page={hitsPage?.pageNum ?? hitPage}
          pageSize={hitsPage?.pageSize ?? hitPageSize}
          total={hitsPage?.total ?? hits.length}
          onPageChange={setHitPage}
          onPageSizeChange={(next) => {
            setHitPageSize(next);
            setHitPage(1);
          }}
          pageSizeOptions={[5, 10, 20, 50]}
        />
      </section>
    </div>
  );
}
