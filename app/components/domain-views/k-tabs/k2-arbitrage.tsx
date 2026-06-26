"use client";

import { useState } from "react";
import Link from "next/link";
import { PaginationExemptionList } from "../design-kit";
import type { BusinessFormSpec, BusinessFormValue } from "../design-kit";
import type { K2Row, KRiskParam } from "@/lib/admin/k-client";
import type { KCtx } from "./types";

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "UNKNOWN_ERROR";
}

export function K2HeaderActions() {
  return <span className="f-ro"><span className="d" />看的是行为闭环,不是单点</span>;
}

const lvlBadge = (n: number) => <span className={`bdg ${n >= 3 ? "bad" : n === 2 ? "warn" : "dim"}`}>{n} / 3 层</span>;
const judge = (n: number): [string, string] => (n >= 3 ? ["闭环套利", "bad"] : n === 2 ? ["可疑预警", "warn"] : ["观察", "dim"]);

type TrialThreshold = { kind: "trial"; operator: string; count: string; days: string };
type GiftThreshold = { kind: "gift"; operator: string; count: string; scope: string };
type BoardThreshold = { kind: "board"; operator: string; multiplier: string; baseline: string };
type K2Threshold = TrialThreshold | GiftThreshold | BoardThreshold;

const K2_PARAM_HELP: Record<string, string> = {
  trialCycleThreshold: "同一实体或账户簇在周期内反复开试用的次数阈值。",
  welcomeGiftAnomalyThreshold: "同一口径下重复领取新人礼的笔数阈值。",
  leaderboardVelocityMultiplier: "排行榜、邀请或佣金增长速度相对基线的倍数阈值。",
};

function parseK2Threshold(key: string, value: string): K2Threshold | null {
  const text = value.trim().replace(/X/g, "x");
  if (key === "trialCycleThreshold") {
    const match = text.match(/^(>=|>)\s*(\d+)\s*次\s*\/\s*(\d+)\s*天$/);
    return match ? { kind: "trial", operator: match[1], count: match[2], days: match[3] } : null;
  }
  if (key === "welcomeGiftAnomalyThreshold") {
    const match = text.match(/^(>=|>)\s*(\d+)\s*笔\s*\/\s*(实体|账户簇|手机号|设备)$/);
    return match ? { kind: "gift", operator: match[1], count: match[2], scope: match[3] } : null;
  }
  if (key === "leaderboardVelocityMultiplier") {
    const match = text.match(/^(>=|>)\s*(\d+)x\s*(基线|上周期|7日均值|同层级均值)$/);
    return match ? { kind: "board", operator: match[1], multiplier: match[2], baseline: match[3] } : null;
  }
  return null;
}

function defaultK2Threshold(key: string): K2Threshold | null {
  if (key === "trialCycleThreshold") return { kind: "trial", operator: ">=", count: "3", days: "30" };
  if (key === "welcomeGiftAnomalyThreshold") return { kind: "gift", operator: ">=", count: "2", scope: "实体" };
  if (key === "leaderboardVelocityMultiplier") return { kind: "board", operator: ">", multiplier: "5", baseline: "基线" };
  return null;
}

function k2ParamBusinessForm(p: KRiskParam): BusinessFormSpec | null {
  const current = parseK2Threshold(p.key, p.value) ?? defaultK2Threshold(p.key);
  if (!current) return null;
  if (current.kind === "trial") {
    return {
      kind: "multi-field",
      title: "业务表单 · 试用循环阈值",
      hint: "提交值由字段生成,格式为“比较符 数值 次 / 周期 天”。后端校验范围:次数 2-10,周期 7-60 天。",
      fields: [
        { key: "operator", label: "比较符", current: current.operator, inputKind: "select", options: [">=", ">"] },
        { key: "count", label: "循环次数", current: current.count, inputKind: "number", min: 2, max: 10, step: 1 },
        { key: "days", label: "统计周期(天)", current: current.days, inputKind: "select", options: ["7", "14", "30", "60"] },
      ],
    };
  }
  if (current.kind === "gift") {
    return {
      kind: "multi-field",
      title: "业务表单 · 新人礼异常阈值",
      hint: "提交值由字段生成,格式为“比较符 数值 笔 / 口径”。后端校验范围:笔数 1-5,口径只能从下拉选择。",
      fields: [
        { key: "operator", label: "比较符", current: current.operator, inputKind: "select", options: [">=", ">"] },
        { key: "count", label: "异常笔数", current: current.count, inputKind: "number", min: 1, max: 5, step: 1 },
        { key: "scope", label: "统计口径", current: current.scope, inputKind: "select", options: ["实体", "账户簇", "手机号", "设备"] },
      ],
    };
  }
  return {
    kind: "multi-field",
    title: "业务表单 · 刷榜增速阈值",
    hint: "提交值由字段生成,格式为“比较符 倍数x 基线”。后端校验范围:倍数 2-20,基线只能从下拉选择。",
    fields: [
      { key: "operator", label: "比较符", current: current.operator, inputKind: "select", options: [">", ">="] },
      { key: "multiplier", label: "增速倍数", current: current.multiplier, inputKind: "number", min: 2, max: 20, step: 1 },
      { key: "baseline", label: "对比基线", current: current.baseline, inputKind: "select", options: ["基线", "上周期", "7日均值", "同层级均值"] },
    ],
  };
}

function intValue(value: string | undefined, min: number, max: number): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

function buildK2ThresholdValue(key: string, value?: BusinessFormValue): string | null {
  if (!value) return null;
  const operator = value.operator === ">" ? ">" : ">=";
  if (key === "trialCycleThreshold") {
    const count = intValue(value.count, 2, 10);
    const days = intValue(value.days, 7, 60);
    return count && days ? `${operator} ${count} 次 / ${days} 天` : null;
  }
  if (key === "welcomeGiftAnomalyThreshold") {
    const count = intValue(value.count, 1, 5);
    const scope = ["实体", "账户簇", "手机号", "设备"].includes(value.scope ?? "") ? value.scope : null;
    return count && scope ? `${operator} ${count} 笔 / ${scope}` : null;
  }
  if (key === "leaderboardVelocityMultiplier") {
    const multiplier = intValue(value.multiplier, 2, 20);
    const baseline = ["基线", "上周期", "7日均值", "同层级均值"].includes(value.baseline ?? "") ? value.baseline : null;
    return multiplier && baseline ? `${operator} ${multiplier}x ${baseline}` : null;
  }
  return null;
}

function K2ParamValue({ param }: { param: KRiskParam }) {
  const parts = parseK2Threshold(param.key, param.value);
  if (!parts) return <>{param.value}</>;
  if (parts.kind === "trial") {
    return (
      <span className="threshold-parts">
        <span className="seg op">{parts.operator}</span>
        <span className="seg num">{parts.count}</span>
        <span className="seg">次</span>
        <span className="sep">/</span>
        <span className="seg num">{parts.days}</span>
        <span className="seg">天</span>
      </span>
    );
  }
  if (parts.kind === "gift") {
    return (
      <span className="threshold-parts">
        <span className="seg op">{parts.operator}</span>
        <span className="seg num">{parts.count}</span>
        <span className="seg">笔</span>
        <span className="sep">/</span>
        <span className="seg scope">{parts.scope}</span>
      </span>
    );
  }
  return (
    <span className="threshold-parts">
      <span className="seg op">{parts.operator}</span>
      <span className="seg num">{parts.multiplier}x</span>
      <span className="seg scope">{parts.baseline}</span>
    </span>
  );
}

export function K2Arbitrage({ ctx }: { ctx: KCtx }) {
  const overview = ctx.risk.arbitrage;
  const views = overview?.views ?? [];
  const [viewKey, setViewKey] = useState("trial");
  const current = views.find((item) => item.key === viewKey) ?? views[0];

  const runAction = async (work: () => Promise<void>, ok: string) => {
    try {
      await work();
      await ctx.reloadKRisk();
      ctx.toast(ok);
    } catch (error) {
      ctx.toast(`K2 操作失败 · ${errorText(error)}`);
    }
  };

  const markArb = (r: K2Row) =>
    ctx.openConfirm({
      action: `标记套利账户 · ${r.cells[0]}`,
      detail: "打上套利标记并附证据链,不冻结、不动钱。标记会进风险评分和风险雷达。",
      chips: [["仅标记 · 附证据链", "done"], ["后端审计", "ready"]],
      reason: true,
      okLabel: "确认标记",
      run: (reason) => void runAction(() => ctx.actions.executeK2Action(r.rowId, "flag", reason), `${r.cells[0]} 已标记套利`),
    });

  const blockGift = (r: K2Row) =>
    ctx.openConfirm({
      action: `拦截新人礼 · ${r.cells[0]}`,
      detail: "停发后续新人礼,不动任何已入账资产。",
      chips: [["预防性阻断", "done"], ["台账留痕", "ready"]],
      reason: true,
      okLabel: "确认拦截",
      run: (reason) => void runAction(() => ctx.actions.executeK2Action(r.rowId, "blockgift", reason), `${r.cells[0]} 后续新人礼已停发`),
    });

  const boardFlag = (r: K2Row) =>
    ctx.openConfirm({
      action: `标记刷榜账户 · ${r.cells[0]}`,
      detail: "产出刷榜信号给排行榜反欺诈和风险雷达;取消资格由对应业务域执行。",
      chips: [["仅标记 + 产信号", "done"], ["后端审计", "ready"]],
      reason: true,
      okLabel: "确认标记",
      run: (reason) => void runAction(() => ctx.actions.executeK2Action(r.rowId, "boardflag", reason), `${r.cells[0]} 刷榜信号已记录`),
    });

  const linkFreeze = (r: K2Row) =>
    ctx.openActionConfirm({
      action: `联动 K1 批量冻结 · ${r.cells[0]}`,
      detail: `复用 K1 冻结链路提交 ${r.cluster || r.rowId} 的冻结处置,并把套利证据链写入审计。`,
      run: (reason) => void runAction(() => ctx.actions.executeK2Action(r.rowId, "freeze", reason), `${r.cells[0]} 已联动 K1 冻结`),
    });

  const adjParam = (p: KRiskParam) => {
    const businessForm = k2ParamBusinessForm(p);
    if (!businessForm) {
      ctx.toast(`${p.name} 暂未配置结构化编辑器`);
      return;
    }
    ctx.openActionConfirm({
      action: `检测阈值调整 · ${p.name}`,
      detail: `${p.name} · 当前 ${p.value}。${K2_PARAM_HELP[p.key] ?? p.note}`,
      amplifies: true,
      businessForm,
      run: (reason, _newVal, businessValue) => {
        const nextValue = buildK2ThresholdValue(p.key, businessValue);
        if (!nextValue) {
          ctx.toast(`${p.name} 参数不完整或超出范围`);
          return;
        }
        void runAction(() => ctx.actions.updateK2Param(p.key, nextValue, reason), `${p.name} 已更新为 ${nextValue}`);
      },
    });
  };

  if (ctx.contentLoading && !overview) {
    return <section className="l-card"><div className="l-h"><span className="ttl">K2 数据加载中</span><span className="sub">· 正在读取后端 risk 接口</span></div></section>;
  }

  return (
    <div>
      <div className="f-stats">
        {(overview?.stats ?? []).map((s) => (
          <div className={`f-stat ${s.tone}`} key={s.key}>
            <div className="k">{s.name}</div>
            <div className="v">{s.value}</div>
            <div className="sub">{s.sub}</div>
          </div>
        ))}
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">闭环怎么判</span>
          <span className="sub">· 分级预警,不是单点命中</span>
          <div className="r"><span className="kcode electric">多层叠加判定</span></div>
        </div>
        <div className="l-b">
          <div className="loop-strip" style={{ marginBottom: 14 }}>
            <span className="st">注册小号</span><span className="ar">→</span>
            <span className="st">绑上级</span><span className="ar">→</span>
            <span className="st hit">领新人礼</span><span className="ar">→</span>
            <span className="st hit">开免费试用</span><span className="ar">→</span>
            <span className="st">取消</span><span className="ar">→</span>
            <span className="st hit">清缓存 · 再来一轮</span>
            <span className="tail">单步正常,连起来才是闭环</span>
          </div>
          <div className="grade-row">
            <div className="ktint warn"><b>≥ 2 层可疑</b> → 预警 + 转人工核查</div>
            <div className="ktint bad"><b>3 层全中</b> → 判定闭环套利,联动 K1 批量冻结</div>
          </div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">检测阈值</span>
          <span className="sub">· 换新最短持有月数归 E3 管,这里只读引用</span>
          <div className="r">
            <Link className="kcode lock" href="/devices/trade-in">换新门槛归 E3 · 只读 {overview?.minHoldingMonths ?? "6"} 个月</Link>
          </div>
        </div>
        <div className="l-b">
          <div className="param-grid">
            {(overview?.params ?? []).map((p) => (
              <div className="p" key={p.key}>
                <div className="k">{p.name}</div>
                <div className="v">
                  <K2ParamValue param={p} />
                  {p.unit ? <span className="vu">{p.unit}</span> : null}
                  <button className="l-btn sm mc" onClick={() => adjParam(p)}>调整</button>
                </div>
                <div className="s">{p.sub}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">检测命中</span>
          <span className="sub">{current?.sub ?? "后端暂无命中视图"}</span>
          <div className="r">
            <div className="chips">
              {views.map((view) => (
                <button key={view.key} className={`chip${current?.key === view.key ? " sel" : ""}`} onClick={() => setViewKey(view.key)}>{view.label}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1020 }}>
            <thead>
              <tr>
                {(current?.head ?? []).map((h) => <th key={h}>{h}</th>)}
                {current?.key !== "board" && <th>层数</th>}
                {(current?.key === "trial" || current?.key === "board") && <th>判定</th>}
                <th style={{ textAlign: "right" }}>动作</th>
              </tr>
            </thead>
            <tbody>
              {(current?.rows ?? []).map((r) => {
                const disposed = r.disposition;
                return (
                  <tr key={r.rowId} style={disposed ? { opacity: 0.62 } : undefined}>
                    {r.cells.map((cell, index) => (
                      <td key={`${r.rowId}-${index}`} className={index === 0 ? "mono" : undefined} style={index === 0 ? { color: "var(--ink)", fontWeight: 600 } : { fontSize: 12.5 }}>{cell}</td>
                    ))}
                    {current?.key !== "board" && <td>{lvlBadge(r.level)}</td>}
                    {(current?.key === "trial" || current?.key === "board") && (() => { const [label, tone] = judge(r.level); return <td><span className={`bdg ${tone}`}>{label}</span></td>; })()}
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {disposed ? (
                        <span className="bdg dim">{disposed}</span>
                      ) : (
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          {r.actions.map((action) =>
                            action === "flag" ? <button key={action} className="l-btn sm" onClick={() => markArb(r)}>标记套利</button>
                            : action === "freeze" ? <button key={action} className="l-btn sm mc" onClick={() => linkFreeze(r)}>联动 K1 冻结</button>
                            : action === "blockgift" ? <button key={action} className="l-btn sm" onClick={() => blockGift(r)}>拦截新人礼</button>
                            : <button key={action} className="l-btn sm" onClick={() => boardFlag(r)}>标记刷榜</button>,
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!current?.rows?.length && <tr><td colSpan={(current?.head?.length ?? 0) + 3} style={{ textAlign: "center", color: "var(--ink-4)", padding: 24 }}>暂无命中记录</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 12 }}>
          <div className="ktint" style={{ fontSize: 12 }}><b>读法</b> · {current?.note ?? "命中结果由后端判定。"}</div>
        </div>
      </section>

      <PaginationExemptionList
        items={[{ label: "检测命中", maxRows: Math.max(current?.rows.length ?? 0, 1), reason: "K2 命中由后端风险接口返回,按视图切换查看" }]}
      />
    </div>
  );
}
