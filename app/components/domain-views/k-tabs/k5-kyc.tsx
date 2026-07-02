"use client";

import { useEffect, useMemo, useState } from "react";
import { DataListPager, type BusinessFormSpec, type BusinessFormValue } from "../design-kit";
import type { K5Ticket, KRiskParam, TicketSt } from "@/lib/admin/k-client";
import type { KCtx } from "./types";

const fmt = (n: number) => n.toLocaleString("en-US");

const TICKET_ST: Record<TicketSt, [string, string]> = {
  triggered: ["已触发", "dim"],
  "in-review": ["复审中", "warn"],
  overdue: ["已超时", "bad"],
  passed: ["已通过", "ok"],
  rejected: ["已驳回", "bad"],
};

function slaColor(pct: number) {
  return pct >= 0.9 ? "var(--danger)" : pct >= 0.65 ? "var(--warning)" : "var(--success)";
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "UNKNOWN_ERROR";
}

export function K5HeaderActions() {
  return <span className="f-ro"><span className="d" />只触发复审 · 实名状态本身归用户域 C4 管</span>;
}

type Filter = "all" | "大额提现" | "大额兑换" | "累计过线" | "overdue";
const FILTERS: [Filter, string][] = [["all", "全部"], ["大额提现", "大额提现"], ["大额兑换", "大额兑换"], ["累计过线", "累计过线"], ["overdue", "已超时"]];

type LargeWithdrawLine = { kind: "large"; operator: string; amount: string };
type CumulativeLine = { kind: "cumulative"; amount: string };
type SlaLine = { kind: "sla"; days: string };
type ScoreLine = { kind: "score"; operator: string; score: string };
type K5Line = LargeWithdrawLine | CumulativeLine | SlaLine | ScoreLine;

function moneyText(value: string | undefined, fallback: string) {
  const digits = String(value ?? "").replace(/[^\d]/g, "");
  return digits || fallback;
}

function moneyLabel(value: string | undefined) {
  const parsed = Number(String(value ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(parsed) ? parsed.toLocaleString("en-US") : "0";
}

function intValue(value: string | undefined, min: number, max: number): number | null {
  const parsed = Number(String(value ?? "").replace(/[^\d-]/g, ""));
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function parseK5Line(key: string, value: string): K5Line | null {
  const text = value.trim();
  if (key === "largeWithdrawReviewUsdt") {
    const matched = text.match(/^(>=|>)\s*\$?([\d,]+)$/);
    return matched ? { kind: "large", operator: matched[1], amount: moneyText(matched[2], "1000") } : null;
  }
  if (key === "cumulativeKycThresholdUsdt") {
    const matched = text.match(/^\$?([\d,]+)$/);
    return matched ? { kind: "cumulative", amount: moneyText(matched[1], "100") } : null;
  }
  if (key === "reviewSlaDays") {
    const matched = text.match(/^(\d+)$/);
    return matched ? { kind: "sla", days: matched[1] } : null;
  }
  if (key === "reviewTriggerScore") {
    const matched = text.match(/^(>=|>)\s*(\d+)$/);
    return matched ? { kind: "score", operator: matched[1], score: matched[2] } : null;
  }
  return null;
}

function defaultK5Line(key: string): K5Line | null {
  if (key === "largeWithdrawReviewUsdt") return { kind: "large", operator: ">=", amount: "1000" };
  if (key === "cumulativeKycThresholdUsdt") return { kind: "cumulative", amount: "100" };
  if (key === "reviewSlaDays") return { kind: "sla", days: "7" };
  if (key === "reviewTriggerScore") return { kind: "score", operator: ">=", score: "85" };
  return null;
}

function k5ParamBusinessForm(p: KRiskParam): BusinessFormSpec | null {
  const current = parseK5Line(p.key, p.value) ?? defaultK5Line(p.key);
  if (!current) return null;
  if (current.kind === "large") {
    return {
      kind: "multi-field",
      title: "业务表单 · 大额提现复审线",
      hint: "提交值由字段生成,格式为“比较符 金额”。后端校验范围:$100-$50,000。",
      fields: [
        { key: "operator", label: "比较符", current: current.operator, inputKind: "select", options: [">=", ">"] },
        { key: "amount", label: "单笔提现金额 USDT", current: current.amount, inputKind: "number", min: 100, max: 50000, step: 100 },
      ],
    };
  }
  if (current.kind === "cumulative") {
    return {
      kind: "multi-field",
      title: "业务表单 · 累计金额触发线",
      hint: "累计金额采用终身累计口径,提交值由金额字段生成。后端校验范围:$50-$1,000。",
      fields: [
        { key: "amount", label: "终身累计金额 USDT", current: current.amount, inputKind: "number", min: 50, max: 1000, step: 10 },
      ],
    };
  }
  if (current.kind === "sla") {
    return {
      kind: "multi-field",
      title: "业务表单 · 复审时限",
      hint: "复审 SLA 单独配置,后端校验范围:1-15 个工作日。",
      fields: [
        { key: "days", label: "复审时限(工作日)", current: current.days, inputKind: "number", min: 1, max: 15, step: 1 },
      ],
    };
  }
  return {
    kind: "multi-field",
    title: "业务表单 · 风险分触发线",
    hint: "K4 有效风险分达到该分值后自动生成 K5 复审工单。后端校验范围:70-100 分。",
    fields: [
      { key: "operator", label: "比较符", current: current.operator, inputKind: "select", options: [">=", ">"] },
      { key: "score", label: "K4 有效风险分", current: current.score, inputKind: "number", min: 70, max: 100, step: 1 },
    ],
  };
}

function buildK5ParamValue(key: string, value?: BusinessFormValue): string | null {
  if (!value) return null;
  if (key === "largeWithdrawReviewUsdt") {
    const amount = intValue(value.amount, 100, 50000);
    return amount == null ? null : `${value.operator === ">" ? ">" : ">="} $${amount.toLocaleString("en-US")}`;
  }
  if (key === "cumulativeKycThresholdUsdt") {
    const amount = intValue(value.amount, 50, 1000);
    return amount == null ? null : `$${amount.toLocaleString("en-US")}`;
  }
  if (key === "reviewSlaDays") {
    const days = intValue(value.days, 1, 15);
    return days == null ? null : String(days);
  }
  if (key === "reviewTriggerScore") {
    const score = intValue(value.score, 70, 100);
    return score == null ? null : `${value.operator === ">" ? ">" : ">="} ${score}`;
  }
  return null;
}

function K5ParamValue({ param }: { param: KRiskParam }) {
  const line = parseK5Line(param.key, param.value);
  if (!line) return <>{param.value}</>;
  if (line.kind === "large") {
    return (
      <span className="threshold-parts">
        <span className="seg op">{line.operator}</span>
        <span className="seg num">${moneyLabel(line.amount)}</span>
      </span>
    );
  }
  if (line.kind === "cumulative") {
    return (
      <span className="threshold-parts">
        <span className="seg num">${moneyLabel(line.amount)}</span>
        <span className="seg">终身累计</span>
      </span>
    );
  }
  if (line.kind === "sla") {
    return (
      <span className="threshold-parts">
        <span className="seg num">{line.days}</span>
        <span className="seg">工作日</span>
      </span>
    );
  }
  return (
    <span className="threshold-parts">
      <span className="seg op">{line.operator}</span>
      <span className="seg num">{line.score}</span>
      <span className="seg">分</span>
    </span>
  );
}

export function K5Kyc({ ctx }: { ctx: KCtx }) {
  const overview = ctx.risk.kycReview;
  const stats = overview?.stats ?? {};
  const params = overview?.params ?? [];
  const [filter, setFilter] = useState<Filter>("all");
  const [ticketPage, setTicketPage] = useState(1);
  const [ticketPageSize, setTicketPageSize] = useState(5);
  const ticketsPage = overview?.tickets;
  const tickets = ticketsPage?.records ?? [];
  const alerts = overview?.alerts ?? [];
  const [sel, setSel] = useState("");
  const pageQuery = useMemo(() => ({
    ticketPageNum: ticketPage,
    ticketPageSize,
    ticketFilter: filter === "all" ? undefined : filter,
  }), [filter, ticketPage, ticketPageSize]);
  const cur = tickets.find((t) => t.id === sel) ?? tickets[0];
  const stat = (key: string) => Number(stats[key] ?? 0);

  useEffect(() => {
    void ctx.reloadKRisk({ kycReview: pageQuery });
  }, [ctx.reloadKRisk, pageQuery]);

  useEffect(() => {
    setSel("");
  }, [filter, ticketPage, ticketPageSize]);

  const runAction = async (work: () => Promise<void>, ok: string) => {
    try {
      await work();
      await ctx.reloadKRisk({ kycReview: pageQuery });
      ctx.toast(ok);
    } catch (error) {
      ctx.toast(`K5 操作失败 · ${errorText(error)}`);
    }
  };

  const decide = (t: K5Ticket, pass: boolean) =>
    ctx.openActionConfirm({
      action: `${pass ? "通过" : "驳回"} KYC 复审 · ${t.id}`,
      detail: `${t.user} · ${t.type} · ${t.amt !== "—" ? t.amt : t.cum}。${pass ? "通过后回写实名和冻结单据的后续流转。" : "驳回后维持冻结并进入退回 / 驳回路径。"}裁决写后端并保留审计。`,
      amplifies: pass,
      run: (reason) => void runAction(
        () => ctx.actions.decideK5Ticket(t.id, pass ? "passed" : "rejected", reason),
        `${t.id} ${pass ? "已通过" : "已驳回"} · 后端已记录`,
      ),
    });

  const manualTrigger = () =>
    ctx.openConfirm({
      action: "手动补触发复审",
      detail: "对没踩到自动线但有可疑迹象的账户,手动拉一单增强复审。账户存在性和落库由后端接口校验。",
      chips: [["仅触发 · 不改状态", "done"], ["后端落库 + 审计", "ready"]],
      reason: true,
      input: { label: "用户编号", placeholder: "如 usr_31E8" },
      okLabel: "确认触发",
      run: (reason, userNo) => {
        const id = (userNo || "").trim();
        if (!id) return;
        void runAction(() => ctx.actions.createK5ManualTicket(id, reason), `已手动触发复审工单(${id})`);
      },
    });

  const subAlert = () =>
    ctx.openConfirm({
      action: "告警订阅配置",
      detail: "选择接收哪些告警和接收渠道。只影响个人通知,不动业务数据。",
      chips: [["个人订阅 · 不动业务", "done"]],
      okLabel: "保存订阅",
      run: () => ctx.toast("告警订阅已保存"),
    });

  const adjParam = (p: KRiskParam) => {
    const businessForm = k5ParamBusinessForm(p);
    if (!businessForm) {
      ctx.toast("K5 参数暂不支持在此页面调整");
      return;
    }
    ctx.openActionConfirm({
      action: `触发线调整 · ${p.name}`,
      detail: `${p.name} · 当前 ${p.value}${p.unit ? ` ${p.unit}` : ""}。${p.note}`,
      amplifies: true,
      businessForm,
      run: (reason, _newVal, businessValue) => {
        const value = buildK5ParamValue(p.key, businessValue);
        if (!value) {
          ctx.toast("K5 触发线配置不完整");
          return;
        }
        void runAction(() => ctx.actions.updateK5Param(p.key, value, reason), `${p.name} 已更新为 ${value}`);
      },
    });
  };

  if (ctx.contentLoading && !overview) {
    return <section className="l-card"><div className="l-h"><span className="ttl">K5 数据加载中</span><span className="sub">· 正在读取后端 risk 接口</span></div></section>;
  }

  return (
    <div>
      <div className="f-stats">
        <div className="f-stat warn"><div className="k">待复审工单</div><div className="v">{stat("openTickets")}</div><div className="sub">来自后端复审队列</div></div>
        <div className="f-stat danger"><div className="k">超时工单</div><div className="v">{stat("reviewOverdue")}</div><div className="sub">已自动告警 + 升级</div></div>
        <div className="f-stat"><div className="k">本月已裁决</div><div className="v">{stat("reviewDecidedMonth")}</div><div className="sub">通过 {stat("reviewDecidedPass")} · 驳回 {stat("reviewDecidedMonth") - stat("reviewDecidedPass")}</div></div>
        <div className="f-stat cyan"><div className="k">复审期冻结金额</div><div className="v">${fmt(stat("reviewFrozenUsd") / 1000)}K</div><div className="sub">对应提现单冻结中</div></div>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">触发线</span>
          <span className="sub">· 兑换相关阈值归兑换风控配置,这里只消费兑换事件</span>
          <div className="r"><span className="kcode lock">兑换阈值归 G2 · 只读</span></div>
        </div>
        <div className="l-b">
          <div className="param-grid">
            {params.map((p) => (
              <div className="p" key={p.key}>
                <div className="k">{p.name}</div>
                <div className="v">
                  <K5ParamValue param={p} />
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
          <span className="ttl">复审触发队列</span>
          <span className="sub">· 点任意一行看工单 · 时限条变红 = 快超时</span>
          <div className="r">
            <div className="chips">
              {FILTERS.map(([v, lb]) => (
                <button
                  key={v}
                  className={`chip${filter === v ? " sel" : ""}`}
                  onClick={() => {
                    setFilter(v);
                    setTicketPage(1);
                  }}
                >
                  {lb}
                </button>
              ))}
            </div>
            <button className="l-btn" onClick={manualTrigger}>手动补触发</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1020 }}>
            <thead><tr><th>工单</th><th>触发类型</th><th>账户</th><th className="num">金额 / 累计</th><th>实名状态(C4)</th><th>复审状态</th><th>时限</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
            <tbody>
              {tickets.map((t) => {
                const [stLb, stTone] = TICKET_ST[t.st];
                const open = t.st !== "passed" && t.st !== "rejected";
                return (
                  <tr key={t.id} className="click" onClick={() => setSel(t.id)} style={t.st === "overdue" ? { background: "var(--danger-soft)" } : undefined}>
                    <td className="mono" style={{ color: "var(--ink)", fontWeight: 600 }}>{t.id}</td>
                    <td><span className="bdg dim">{t.type}</span></td>
                    <td className="mono">{t.user}</td>
                    <td className="num mono" style={{ fontWeight: 700 }}>{t.amt !== "—" ? t.amt : t.cum}</td>
                    <td style={{ fontSize: 12 }}>{t.kyc}</td>
                    <td><span className={`bdg ${stTone}`}>{stLb}</span></td>
                    <td>
                      <span className="sla">
                        <span className="track"><i style={{ width: `${t.slaPct * 100}%`, background: slaColor(t.slaPct) }} /></span>
                        <span className="t" style={{ color: slaColor(t.slaPct) }}>{t.slaTxt}</span>
                      </span>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {open ? (
                        <span style={{ display: "inline-flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
                          <button className="l-btn sm mc" onClick={() => decide(t, true)}>通过</button>
                          <button className="l-btn sm mc" onClick={() => decide(t, false)}>驳回</button>
                        </span>
                      ) : (
                        <span className="bdg dim">已裁决</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {!tickets.length && <tr><td colSpan={8} style={{ textAlign: "center", color: "var(--ink-4)", padding: 24 }}>暂无复审工单</td></tr>}
            </tbody>
          </table>
        </div>
        <DataListPager
          label="复审触发队列"
          page={ticketsPage?.pageNum ?? ticketPage}
          pageSize={ticketsPage?.pageSize ?? ticketPageSize}
          total={ticketsPage?.total ?? tickets.length}
          onPageChange={setTicketPage}
          onPageSizeChange={(next) => {
            setTicketPageSize(next);
            setTicketPage(1);
          }}
          pageSizeOptions={[5, 10, 20, 50]}
        />
      </section>

      <div className="two-col r14">
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">复审工单 · {cur?.id ?? "暂无"}</span>
            <span className="sub">· 材料引用自实名服务商 · 裁决回写用户域</span>
            <div className="r">
              {cur && cur.st !== "passed" && cur.st !== "rejected" ? (
                <>
                  <button className="l-btn mc" onClick={() => decide(cur, true)}>通过</button>
                  <button className="l-btn mc" onClick={() => decide(cur, false)}>驳回</button>
                </>
              ) : cur ? (
                <span className={`bdg ${TICKET_ST[cur.st][1]}`}>{TICKET_ST[cur.st][0]}</span>
              ) : null}
            </div>
          </div>
          <div className="tk-split">
            <div>
              {(cur?.info ?? []).map((kv) => (
                <div className="kv2" key={kv[0]}><span className="k">{kv[0]}</span><span className="v">{kv[1]}</span></div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--ink)" }}>复审历史</div>
              {(cur?.hist ?? []).map((h, i) => (
                <div className="alert-row" key={`${h[0]}-${i}`}>
                  <span className="d3" style={{ background: h[2] === "bad" ? "var(--danger)" : h[2] === "warn" ? "var(--warning)" : "var(--ink-4)" }} />
                  <div className="tx">{h[1]}</div>
                  <span className="ts">{h[0]}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">异常告警</span>
            <span className="sub">· 命中 / 超时 / 批量集中</span>
            <div className="r"><button className="l-btn sm" onClick={subAlert}>订阅配置</button></div>
          </div>
          <div className="l-b">
            {alerts.map((a) => (
              <div className="alert-row" key={a.title + a.timeText}>
                <span className="d3" style={{ background: a.tone === "bad" ? "var(--danger)" : "var(--warning)" }} />
                <div className="tx"><b>{a.title}</b> · {a.body}</div>
                <span className="ts">{a.timeText}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

    </div>
  );
}
