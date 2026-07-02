"use client";

/** F5 · 佣金事件审计 —— 数据源为后端 /api/admin/teams/commissions。 */
import { useMemo, useState } from "react";
import { Badge, DataListPager, useDataListPager } from "../design-kit";
import type { F5CommissionEvent } from "@/lib/admin/f1-client";
import type { FViewCtx } from "./types";

type Row = F5CommissionEvent;

function stateBadge(eff: string): { label: string; tone: "ok" | "warn" | "err" | "neutral" } {
  if (eff === "可提" || eff === "unlocked") return { label: "已解锁可提", tone: "ok" };
  if (eff === "frozen") return { label: "已冻结", tone: "warn" };
  if (eff === "rejected") return { label: "已驳回", tone: "neutral" };
  if (eff === "异常回退") return { label: "异常回退", tone: "err" };
  return { label: "冷却计提中", tone: "warn" };
}

function matchState(eff: string, filter: string): boolean {
  if (filter === "all") return true;
  if (filter === "可提") return eff === "可提" || eff === "unlocked";
  return eff === filter;
}

function levelColor(level: string) {
  if (level === "HIGH") return "var(--danger)";
  if (level === "MEDIUM") return "var(--warning)";
  return "var(--ink-4)";
}

export function F5Audit({ ctx }: { ctx: FViewCtx }) {
  const [curKind, setCurKind] = useState("all");
  const [curState, setCurState] = useState("all");
  const data = ctx.f5Overview;
  const events = data?.commissionEvents ?? [];
  const hasRows = events.length > 0;

  const dispose = (kind: "freeze" | "unlock" | "unfreeze" | "reject", c: Row): void => {
    const amt = `${c.amt.toLocaleString()} ${c.cur}`;
    const map = {
      freeze: { name: `佣金冻结 ${c.id}`, amp: false, fv: "frozen", detail: `冻结佣金 ${c.id} · ${amt} · 暂停其解锁与提现 · 记录处置结果 · 可解冻。` },
      unlock: { name: `佣金提前解锁 ${c.id}`, amp: true, fv: "unlocked", detail: `提前解锁佣金 ${c.id} · ${amt} · 跳过剩余冷却进入可提余额 · 放大资金流出。` },
      unfreeze: { name: `佣金解冻 ${c.id}`, amp: true, fv: "unlocked", detail: `解冻 ${c.id} · ${amt} · 恢复其冷却 / 解锁链路 · 放大资金流出。` },
      reject: { name: `佣金驳回 ${c.id}`, amp: false, fv: "rejected", detail: `驳回异常佣金 ${c.id} · 红冲该笔计提(联动 D4)· 不可逆 · 记录处置结果。` },
    }[kind];
    ctx.openActionConfirm({ name: map.name, amplify: map.amp, op: "dispose", paramKey: c.auditKey, fixedVal: map.fv, status: map.fv, detail: map.detail });
  };

  const rows = useMemo(
    () => events.filter((c) => (curKind === "all" || c.kind === curKind) && matchState(c.state, curState)),
    [curKind, curState, events],
  );
  const pager = useDataListPager(rows, { initialPageSize: Math.min(data?.pagination.defaultPageSize ?? 20, 20), resetKey: `${curKind}|${curState}` });

  if (ctx.f5Loading && !data) {
    return <section className="pane"><div className="pane-h"><span className="ph-ttl">F5 佣金事件审计</span><span className="ph-sub">数据加载中</span></div><div style={{ padding: 18, color: "var(--ink-4)", fontSize: 13 }}>F5 数据加载中...</div></section>;
  }

  if (ctx.f5Error && !data) {
    return (
      <section className="pane">
        <div className="pane-h"><span className="ph-ttl">F5 佣金事件审计</span><span className="ph-sub">数据加载失败</span></div>
        <div style={{ padding: 18, color: "var(--ink-3)", fontSize: 13 }}>F5 数据加载失败 · {ctx.f5Error}</div>
        <div style={{ padding: "0 18px 18px" }}><button className="fbtn primary" onClick={() => void ctx.refreshF5()}>重试</button></div>
      </section>
    );
  }

  if (!data || !hasRows) {
    return <section className="pane"><div className="pane-h"><span className="ph-ttl">F5 佣金事件审计</span><span className="ph-sub">暂无数据</span></div><div style={{ padding: 18, color: "var(--ink-4)", fontSize: 13 }}>F5 暂无佣金事件数据</div></section>;
  }

  const kindLbl = curKind === "all" ? "全部类型" : (data.commissionKinds.find((k) => k.key === curKind)?.code ?? "All");
  const summary = data.summary;

  return (
    <>
      {ctx.f5Error && (
        <section className="pane">
          <div className="pane-h"><span className="ph-ttl">F5 数据刷新失败</span><span className="ph-sub">{ctx.f5Error}</span></div>
        </section>
      )}

      <div className="f-stats">
        <div className="f-stat"><div className="k">本月佣金支出</div><div className="v">{summary.monthlyCommissionSpendLabel}</div><div className="sub">6 类合计</div></div>
        <div className="f-stat warn"><div className="k">冷却中余额</div><div className="v">{summary.coolingBalanceLabel}</div><div className="sub">佣金冷却未解锁</div></div>
        <div className="f-stat ok"><div className="k">本月可提佣金</div><div className="v">{summary.withdrawableThisMonthLabel}</div><div className="sub">已解锁 · 用户可申请</div></div>
        <div className="f-stat danger"><div className="k">异常 / 已冻结</div><div className="v">{summary.abnormalOrFrozenCount}</div><div className="sub">K2 套利联动</div></div>
      </div>

      <div className="kinds">
        {data.commissionKinds.map((k) => (
          <div key={k.key} className={`kind ${k.cls}${curKind === k.key ? " active" : ""}`} onClick={() => setCurKind(k.key)}>
            <div className="nm">{k.code}</div>
            <div className="lbl">{k.lbl}</div>
            <div className="amt" style={k.amtColor ? { color: k.amtColor } : undefined}>{k.amt}</div>
            <div className="kct">{k.ct}</div>
          </div>
        ))}
      </div>

      <div className="f5-main">
        <section className="audit">
          <div className="audit-h">
            <span className="ph-ttl">佣金流水 · {data.pagination.defaultWindow}</span>
            <span className="ph-sub">{kindLbl}</span>
            <span className="ph-r"><span className="tag" style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-4)", border: "1px solid var(--border)", padding: "2px 7px", borderRadius: 6 }}>F.commission.*</span></span>
          </div>
          <div className="filter-bar">
            {data.commissionFilters.map((f) => (
              <span key={f.key} className={`fchip${curState === f.key ? " on" : ""}`} onClick={() => setCurState(f.key)}>{f.lbl}</span>
            ))}
          </div>
          <table className="ctbl">
            <thead><tr><th>佣金 ID</th><th>类型</th><th>用户</th><th className="num">金额</th><th>币种</th><th>冷却态</th><th>状态</th><th className="num">动作</th></tr></thead>
            <tbody>
              {pager.pageRows.length === 0 && <tr className="empty-row"><td colSpan={8}>当前筛选无匹配记录</td></tr>}
              {pager.pageRows.map((c) => {
                const eff = c.state;
                const rev = eff === "rejected" || eff === "异常回退" || eff === "frozen";
                const done = eff === "可提" || eff === "unlocked";
                const sb = stateBadge(eff);
                const coolLb = eff === "unlocked" ? "已解锁(运营)" : c.coolLb;
                return (
                  <tr key={c.id} className={eff === "rejected" ? "rejected" : undefined}>
                    <td><span className="cid">{c.id}</span></td>
                    <td><span className={`kind-tag ${c.kind}`}>{c.kind}</span></td>
                    <td><span className="uid">{c.user}</span></td>
                    <td className="amt">{c.amt.toLocaleString()}</td>
                    <td><span className={`cur ${c.cur === "NEX" ? "nex" : "usdt"}`}>{c.cur}</span></td>
                    <td>
                      <span className={`cool${rev ? " rev" : done ? " done" : ""}`}>
                        <span className={`bar${done ? " done" : ""}`}><span className="f" style={{ width: `${done || rev ? 100 : c.coolPct}%` }} /></span>
                        <span className="lb">{coolLb}</span>
                      </span>
                    </td>
                    <td><Badge tone={sb.tone}>{sb.label}</Badge></td>
                    <td>
                      <div className="row-acts">
                        {eff === "计提" && <><button className="freeze" onClick={() => dispose("freeze", c)}>冻结</button><button className="unlock" onClick={() => dispose("unlock", c)}>解锁</button></>}
                        {eff === "异常回退" && <button className="reject" onClick={() => dispose("reject", c)}>驳回</button>}
                        {eff === "frozen" && <button className="unlock" onClick={() => dispose("unfreeze", c)}>解冻</button>}
                        {(eff === "可提" || eff === "unlocked" || eff === "rejected") && <span className="none">--</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <DataListPager
            label="佣金流水"
            page={pager.page}
            pageSize={pager.pageSize}
            total={pager.total}
            rawTotal={events.length}
            onPageChange={pager.setPage}
            onPageSizeChange={pager.setPageSize}
          />
        </section>

        <aside className="rail">
          <div className="rail-card">
            <div className="rc-h">状态分布 · 全量</div>
            {data.statusDistribution.map((s) => (
              <div key={s.nm} className="stbar"><span className="dot2" style={{ background: s.dot }} /><span className="nm">{s.nm}</span><span className="ct">{s.ct}</span></div>
            ))}
          </div>
          <div className="rail-card">
            <div className="rc-h">最近处置</div>
            {data.recentAuditFeed.map((f, i) => (
              <div key={`${f.when}-${i}`} className="feed-it"><span className="when">{f.when}</span><span className="ft"><b style={{ color: levelColor(f.level) }}>{f.level}</b> · {f.text}</span></div>
            ))}
          </div>
          <div className="rail-card cyan-card">
            <div className="rc-h">处置口径</div>
            <div className="dispo">
              <div><b>冻结</b> · 暂停解锁与提现,可解冻。</div>
              <div><b>解锁</b> · 提前进入可提余额(放大流出)。</div>
              <div><b>驳回</b> · 红冲该笔计提(联动 D4),不可逆。</div>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
