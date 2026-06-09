"use client";

/** F5 · 佣金事件审计 —— 6 类佣金拆分卡(可点过滤)+ 流水表(冷却 bar 三态 · Maker-Checker 处置)+ 右栏状态分布 / A2 审计 feed / 处置口径。 */
import { useState } from "react";
import { Badge } from "../design-kit";
import { fmtM } from "@/lib/mock/admin/design-data";
import { LEDGER } from "@/lib/mock/admin/ledger";
import { COMMISSIONS, F5_KINDS, F5_FILTERS, F5_STATUS_DIST, F5_FEED } from "./data";
import type { FViewCtx } from "./types";

type Row = (typeof COMMISSIONS)[number];

// 状态 → Badge 文案/色调
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

export function F5Audit({ ctx }: { ctx: FViewCtx }) {
  const [curKind, setCurKind] = useState("all");
  const [curState, setCurState] = useState("all");
  const coolUsd = fmtM(LEDGER.accounts.find((a) => a.key === "commission_cool")!.amount); // 科目 #7 · 单源 LEDGER
  const effState = (c: Row): string => ctx.pget(`F.commission.${c.id}.status`) ?? c.state;

  const dispose = (kind: "freeze" | "unlock" | "unfreeze" | "reject", c: Row): void => {
    const amt = `${c.amt.toLocaleString()} ${c.cur}`;
    const map = {
      freeze: { name: `佣金冻结 ${c.id}`, amp: false, fv: "frozen", detail: `冻结佣金 ${c.id} · ${amt} · 暂停其解锁与提现 · 写 A2 审计 · 可解冻。` },
      unlock: { name: `佣金提前解锁 ${c.id}`, amp: true, fv: "unlocked", detail: `提前解锁佣金 ${c.id} · ${amt} · 跳过剩余冷却进入可提余额 · 放大资金流出。` },
      unfreeze: { name: `佣金解冻 ${c.id}`, amp: true, fv: "unlocked", detail: `解冻 ${c.id} · ${amt} · 恢复其冷却 / 解锁链路 · 放大资金流出。` },
      reject: { name: `佣金驳回 ${c.id}`, amp: false, fv: "rejected", detail: `驳回异常佣金 ${c.id} · 红冲该笔计提(联动 D4)· 不可逆 · 写 A2 审计。` },
    }[kind];
    ctx.openMc({ name: map.name, amplify: map.amp, op: "dispose", paramKey: `F.commission.${c.id}.status`, fixedVal: map.fv, status: map.fv, detail: map.detail });
  };

  const rows = COMMISSIONS.filter((c) => (curKind === "all" || c.kind === curKind) && matchState(effState(c), curState));
  const kindLbl = curKind === "all" ? "全部类型" : (F5_KINDS.find((k) => k.key === curKind)?.code ?? "All");

  return (
    <>
      <div className="f-stats">
        <div className="f-stat"><div className="k">本月佣金支出</div><div className="v">$8.42M</div><div className="sub">6 类合计</div></div>
        <div className="f-stat warn"><div className="k">冷却中余额</div><div className="v">{coolUsd}</div><div className="sub">科目 #7 · 未解锁</div></div>
        <div className="f-stat ok"><div className="k">本月可提佣金</div><div className="v">$5.96M</div><div className="sub">已解锁 · 用户可申请</div></div>
        <div className="f-stat danger"><div className="k">异常 / 已冻结</div><div className="v">14</div><div className="sub">K2 套利联动</div></div>
      </div>

      <div className="kinds">
        {F5_KINDS.map((k) => (
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
            <span className="ph-ttl">佣金流水 · 最近 24h</span>
            <span className="ph-sub">{kindLbl}</span>
            <span className="ph-r"><span className="tag" style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--cyan)", border: "1px solid var(--cyan-border)", background: "var(--cyan-soft)", padding: "2px 7px", borderRadius: 6 }}>A2 append-only</span><span className="tag" style={{ fontFamily: "var(--mono)", fontSize: 10, color: "var(--ink-4)", border: "1px solid var(--border)", padding: "2px 7px", borderRadius: 6 }}>F.commission.*</span></span>
          </div>
          <div className="filter-bar">
            {F5_FILTERS.map((f) => (
              <span key={f.key} className={`fchip${curState === f.key ? " on" : ""}`} onClick={() => setCurState(f.key)}>{f.lbl}</span>
            ))}
          </div>
          <table className="ctbl">
            <thead><tr><th>佣金 ID</th><th>类型</th><th>用户</th><th className="num">金额</th><th>币种</th><th>冷却态</th><th>状态</th><th className="num">动作</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr className="empty-row"><td colSpan={8}>当前筛选无匹配记录</td></tr>}
              {rows.map((c) => {
                const eff = effState(c);
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
                        {eff === "计提" && <><button className="freeze" onClick={() => dispose("freeze", c)}>冻结</button><button className="unlock" onClick={() => dispose("unlock", c)}>解锁 ⚡</button></>}
                        {eff === "异常回退" && <button className="reject" onClick={() => dispose("reject", c)}>驳回</button>}
                        {eff === "frozen" && <button className="unlock" onClick={() => dispose("unfreeze", c)}>解冻 ⚡</button>}
                        {(eff === "可提" || eff === "unlocked" || eff === "rejected") && <span className="none">—</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <aside className="rail">
          <div className="rail-card">
            <div className="rc-h">状态分布 · 全量</div>
            {F5_STATUS_DIST.map((s) => (
              <div key={s.nm} className="stbar"><span className="dot2" style={{ background: s.dot }} /><span className="nm">{s.nm}</span><span className="ct">{s.ct}</span></div>
            ))}
          </div>
          <div className="rail-card">
            <div className="rc-h">最近处置(A2 审计)</div>
            {F5_FEED.map((f, i) => (
              <div key={i} className="feed-it"><span className="when">{f.when}</span><span className="ft">{f.html.map((seg, j) => seg.b ? <b key={j} style={seg.color ? { color: seg.color } : undefined}>{seg.t}</b> : <span key={j}>{seg.t}</span>)}</span></div>
            ))}
          </div>
          <div className="rail-card cyan-card">
            <div className="rc-h">处置口径</div>
            <div className="dispo">
              <div><b>冻结</b> · 暂停解锁与提现,可解冻。</div>
              <div><b>解锁 ⚡</b> · 提前进入可提余额(放大流出)。</div>
              <div><b>驳回</b> · 红冲该笔计提(联动 D4),不可逆。</div>
              <div><b>A2</b> · 所有处置均写 append-only · server-canonical。</div>
            </div>
          </div>
        </aside>
      </div>

      <p className="f-foot">network / binary 两类构成 64% 佣金体量,是主航道;leadership / cultivation 是「头部虹吸」杠杆,处置敏感度最高。<b>异常回退</b>(红冲)与 K2 套利检测同步联动,命中后须当日内驳回或冻结,过期 24h 自动进入仲裁池。</p>
    </>
  );
}
