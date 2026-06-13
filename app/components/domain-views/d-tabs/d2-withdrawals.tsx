"use client";

/**
 * D2 提现审核队列 — 后台最高频操盘动作。
 * 三路信号只消费不重算:风险分(K4 同分单源)/ 命中规则(K3_HITS 同单同刻)/ 实名态(C4);
 * 状态机 server-canonical(正常 5 态 + 异常 6 态);小额(<$1,000)低风险普通确认快速放行保 48h SLA,
 * 大额 操作确认(amplifies → B1 覆盖率预检);K5 复审 hold 的单(holdK5)复审未过禁放(PRD D2⑦);
 * 批量含大额自动分拣转单笔(LARGE_AMOUNT_REQUIRES_MAKER_CHECKER 语义)。
 */
import { useState } from "react";
import { WITHDRAWALS, type WithdrawalRow } from "@/lib/mock/admin/design-data";
import { LEDGER } from "@/lib/mock/admin/ledger";
import { WD_ST, LARGE_LINE, wdStats } from "./data";
import { D_FUND } from "@/lib/mock/admin/design-data";
import type { DCtx } from "./types";
import { DataListPager, useDataListPager } from "../design-kit";

const riskColor = (s: number) => (s >= 70 ? "var(--danger)" : s >= 40 ? "var(--warning)" : "var(--success)");

const FILTERS: { key: string; label: string }[] = [
  { key: "pending", label: "待人工" },
  { key: "large", label: "大额" },
  { key: "high", label: "高风险分" },
  { key: "frozen", label: "已冻结" },
  { key: "all", label: "全部" },
];

export function D2Withdrawals({ ctx }: { ctx: DCtx }) {
  const { pget, setParam, toast, openActionConfirm, openConfirm } = ctx;
  const [filter, setFilter] = useState("pending");
  const [curId, setCurId] = useState(WITHDRAWALS[0].id);
  const [sel, setSel] = useState<Record<string, boolean>>({});

  const effSt = (id: string) => pget(`D.withdraw.${id}.st`) ?? WITHDRAWALS.find((w) => w.id === id)!.st;
  const stats = wdStats(effSt);
  const cov = LEDGER.coverageRatio.toFixed(1);
  // KYC 列同源 C4 权威(C.kyc.<uid>.st):C4 人工标记/撤销、K5 裁决回写后本列实时跟;
  // 无实时裁决时回落种子串(种子带工单上下文如「已通过(复审中 K5)」,信息更全)。
  const KYC_LIVE: Record<string, string> = { verified: "已通过(C4 实时)", none: "未验证(C4 撤销)", review: "复审中(C4 实时)" };
  const kycCell = (w: { user: string; kyc: string }) => {
    const live = pget(`C.kyc.${w.user}.st`);
    return live ? (KYC_LIVE[live] ?? w.kyc) : w.kyc;
  };

  const rows = WITHDRAWALS.filter((w) => {
    const st = effSt(w.id);
    if (filter === "pending") return st === "review-pending";
    if (filter === "large") return w.amount >= LARGE_LINE;
    if (filter === "high") return w.risk >= 70;
    if (filter === "frozen") return st === "frozen";
    return true;
  });
  const pager = useDataListPager(rows, { resetKey: filter });
  const cur = WITHDRAWALS.find((w) => w.id === curId)!;
  const setSt = (id: string, next: string, action: string, reason: string) =>
    setParam(`D.withdraw.${id}.st`, next, { action, reason });

  /* ── 动作(放行/拒绝/延迟/冻结/解冻/退款覆盖)── */
  const approve = (w: WithdrawalRow) => {
    const large = w.amount >= LARGE_LINE;
    if (w.holdK5 && effSt(w.id) === "review-pending") {
      // PRD D2⑦:大额触发 K5 复审,复审未过维持待确认/延迟 —— 不弹放行,提示去 K5
      toast(`${w.id} 在 K5 复审 hold(${w.holdK5})· 复审未过不可放行,先去 K5 裁决`);
      return;
    }
    if (large) {
      openActionConfirm({
        action: `大额放行 · ${w.id} · $${w.amount.toLocaleString("en-US")}`,
        detail: <><b>{w.user}</b> · 风险分 {w.risk} · {w.rules !== "—" ? `命中 ${w.rules} · ` : ""}放行后储备实时核减 {`$${w.amount.toLocaleString("en-US")}`},当前覆盖率 {cov}%(红线 {LEDGER.redlinePct})核验通过。{w.kyc.includes("复审") && <b>注意:该用户另有 K5 复审在途,放行前确认与本单无关联冻结。</b>}带防重号,重试不会重复放行。</>,
        amplifies: true,
        run: (reason) => { setSt(w.id, "review-passed", `大额放行 ${w.id}`, reason); toast(`${w.id} 已放行 → 出金中 · 储备同步核减`); },
      });
    } else {
      openConfirm({
        action: `快速放行 · ${w.id} · $${w.amount}`,
        detail: "小额(< $1,000)且风险分低于路由线(40)、未命中任何风控规则——符合快速通道,单人即时放行保 48h 到账。放行事件落审计。",
        chips: [["小额低风险 · 单人即时", "ready"], ["落审计 · 储备同步核减", "done"]], okLabel: "确认放行",
        run: (reason) => { setSt(w.id, "review-passed", `快速放行 ${w.id}`, reason || "快速通道"); toast(`${w.id} 已快速放行 → 出金中`); },
      });
    }
  };
  const reject = (w: WithdrawalRow) => openConfirm({
    action: `拒绝提现 · ${w.id}`,
    detail: <>拒绝后这笔钱<b>自动退回用户可提余额</b>(服务器记退款账单),不放大资金流出所以单人可办,但必须写原因。</>,
    chips: [["自动退回余额 · 不留悬空", "done"], ["必须写原因", "ready"]], reason: true, okLabel: "确认拒绝",
    run: (reason) => { setSt(w.id, "rejected", `拒绝提现 ${w.id}`, reason); toast(`${w.id} 已拒绝 · 已退回余额`); },
  });
  const delay = (w: WithdrawalRow) => openConfirm({
    action: `延迟处理 · ${w.id}`,
    detail: "延长持有(默认对齐当期合规审查窗口,1–45d),到期自动回到待确认队列。延迟是收紧动作,单人即时,必须写原因。覆盖率紧张时优先用延迟而不是硬放行。",
    chips: [["收紧动作 · 即时生效", "ready"], ["到期自动回队列", "done"]], reason: true, okLabel: "确认延迟",
    run: (reason) => { setSt(w.id, "delayed", `延迟提现 ${w.id}`, reason); toast(`${w.id} 已延迟 · 到期回队列`); },
  });
  const freeze = (w: WithdrawalRow) => openActionConfirm({
    action: `冻结提现 · ${w.id}`,
    detail: <><b>{w.user} · ${w.amount.toLocaleString("en-US")}</b> · 冻结用户这笔资金(任何在途状态都可以冻),必须操作确认。冻结事件喂风险雷达(B5)。</>,
    run: (reason) => { setSt(w.id, "frozen", `冻结提现 ${w.id}`, reason); toast(`${w.id} 已冻结 · 理由留痕`); },
  });
  const unfreeze = (w: WithdrawalRow) => openActionConfirm({
    action: `解冻提现 · ${w.id}`,
    detail: <>解冻 = 恢复资金流出,操作确认 + B1 覆盖率核验(当前 {cov}%)。解冻后回到待人工状态重新分诊,不直接放行。</>,
    amplifies: true,
    run: (reason) => { setSt(w.id, "review-pending", `解冻提现 ${w.id}`, reason); toast(`${w.id} 已解冻 → 回待确认队列`); },
  });
  const refundOv = (w: WithdrawalRow) => openActionConfirm({
    action: `手动退款覆盖 · ${w.id}`,
    detail: <>把这笔冻结提现直接退回用户余额并关单(服务器记退款账单)。资金动作,操作确认 + 防重号。</>,
    run: (reason) => { setSt(w.id, "refunded", `手动退款覆盖 ${w.id}`, reason); toast(`${w.id} 已退回余额 · 理由留痕`); },
  });

  const batch = (action: "approve" | "delay" | "reject" | "freeze") => {
    const ids = Object.keys(sel).filter((k) => sel[k]);
    if (!ids.length) { toast("先勾选要批量处理的单"); return; }
    const row = (id: string) => WITHDRAWALS.find((w) => w.id === id)!;
    const lbl = { approve: "放行", delay: "延迟", reject: "拒绝", freeze: "冻结" }[action];
    if (action === "freeze") {
      openActionConfirm({
        action: `批量冻结 · ${ids.length} 笔`,
        detail: <>批量冻结一律操作确认。每条单独记审计 + 整体记批次号。</>,
        run: (reason) => { ids.forEach((id) => setSt(id, "frozen", `批量冻结 ${id}`, reason)); setSel({}); toast(`批量冻结 ${ids.length} 笔 · 批次留痕`); },
      });
      return;
    }
    const large = ids.filter((id) => row(id).amount >= LARGE_LINE);
    // 批量放行的拦截分拣与单笔同一不变量:大额转单笔操作确认;K5 复审 hold 的单(含小额)复审未过禁放,同样拦截(PRD D2⑦,防批量路径旁路)
    const held = action === "approve" ? ids.filter((id) => row(id).amount < LARGE_LINE && row(id).holdK5) : [];
    const small = ids.filter((id) => row(id).amount < LARGE_LINE && !(action === "approve" && row(id).holdK5));
    openConfirm({
      action: `批量${lbl} · ${ids.length} 笔`,
      detail: <>
        {large.length ? <><b>其中 {large.length} 笔是大额(≥ $1,000),服务器会把它们挑出来转单笔人工 + 操作确认</b>;</> : null}
        {held.length ? <><b>{held.length} 笔在 K5 复审 hold(复审未过禁放),已剔除</b>;</> : null}
        {small.length ? <>剩余 {small.length} 笔照常批量{lbl}。</> : <>无可批量处理的单。</>}
        每条单独记审计 + 整体记批次号。
      </>,
      chips: [["大额 / K5 hold 自动拦截", "ready"], ["逐条审计 + 批次号", "done"]], reason: true, okLabel: `确认批量${lbl}`,
      run: (reason) => {
        const next = action === "approve" ? "review-passed" : action === "delay" ? "delayed" : "rejected";
        small.forEach((id) => setSt(id, next, `批量${lbl} ${id}`, reason));
        setSel({});
        toast(`批量${lbl} ${small.length} 笔完成${large.length ? ` · ${large.length} 笔大额转单笔` : ""}${held.length ? ` · ${held.length} 笔 K5 hold 已剔除` : ""}`);
      },
    });
  };

  const selCount = Object.keys(sel).filter((k) => sel[k]).length;
  const curSt = effSt(cur.id);
  const dimMax = Math.max(...cur.riskDims.map((d) => d[1]), 1);

  return (
    <>
      <div className="f-stats">
        <div className="f-stat warn"><div className="k">待确认核</div><div className="v">{stats.pendingTotal}</div><div className="sub">大额 {stats.largeTotal} · K5 复审 hold {stats.k5HoldCnt}(含小额累计过线)</div></div>
        <div className="f-stat"><div className="k">今日已放行</div><div className="v">${(D_FUND.payoutTodayUsd / 1000).toFixed(1)}K</div><div className="sub">{D_FUND.payoutTodayCnt} 笔 · 平均 {D_FUND.payoutAvgHours}h 到账</div></div>
        <div className="f-stat ok"><div className="k">兑付覆盖率(B1 裁决)</div><div className="v">{cov}%</div><div className="sub">红线 {LEDGER.redlinePct} · 放大流出前自动核验</div></div>
        <div className="f-stat danger"><div className="k">冻结中</div><div className="v">{stats.frozenTotal}</div><div className="sub">${(stats.frozenUsd / 1000).toFixed(1)}K · 解冻要操作确认</div></div>
      </div>

      {/* 状态机 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">提现单状态机</span>
          <span className="sub">· 全部由服务器推进,非法跳转返回 409 · 任何失败态的钱都经「已退回」回余额,不留悬空</span>
          <div className="r"><span className="dcode electric">正常 5 态 + 异常 6 态</span></div>
        </div>
        <div className="l-b">
          <div className="sm-flow">
            <span className="st">submitted 已提交</span><span className="ar">风控自动评分 →</span>
            <span className="st warn">review-pending 待人工</span><span className="ar">放行 →</span>
            <span className="st ok">review-passed 已批</span><span className="ar">→</span>
            <span className="st">processing 出金中</span><span className="ar">→</span>
            <span className="st">sent 已发链上</span><span className="ar">3–12 块确认 →</span>
            <span className="st ok">confirmed 到账</span>
          </div>
          <div className="sm-flow" style={{ marginTop: 6 }}>
            <span style={{ fontSize: 11.5, color: "var(--ink-4)", marginRight: 4 }}>从「待人工」可走:</span>
            <span className="st bad">rejected 拒绝(退回余额)</span>
            <span className="st warn">delayed 延迟(到期回队列)</span>
            <span className="st bad">frozen 冻结(任何在途态可冻)</span>
            <span style={{ fontSize: 11.5, color: "var(--ink-4)", margin: "0 4px 0 12px" }}>链上异常:</span>
            <span className="st bad">tx-failed / 孤块 / 地址非法</span><span className="ar">→</span>
            <span className="st ok">refunded 已退回余额</span>
          </div>
        </div>
      </section>

      {/* 队列 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">审核队列</span>
          <span className="sub">· 点行看详情 · 勾选做批量</span>
          <div className="r"><div className="chips">
            {FILTERS.map((f) => (
              <button key={f.key} className={`chip${filter === f.key ? " sel" : ""}`} onClick={() => setFilter(f.key)}>{f.label}</button>
            ))}
          </div></div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1100 }}>
            <thead><tr><th /><th>提现单</th><th>账户</th><th className="num">金额</th><th>目标地址 · 链</th><th>风险分(K4)</th><th>实名(C4)</th><th>积分</th><th>24h 提交</th><th>命中规则(K3)</th><th>状态</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
            <tbody>
              {pager.pageRows.length === 0 ? (
                <tr>
                  <td colSpan={12} style={{ textAlign: "center", color: "var(--ink-4)", padding: "28px 12px" }}>
                    无匹配提现单 · 切换筛选查看全部队列
                  </td>
                </tr>
              ) : pager.pageRows.map((w) => {
                const st = effSt(w.id);
                const [stLabel, stTone] = WD_ST[st] ?? [st, "dim"];
                const large = w.amount >= LARGE_LINE;
                return (
                  <tr key={w.id} className="click" onClick={() => setCurId(w.id)} style={st === "frozen" ? { background: "var(--danger-soft)" } : undefined}>
                    <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={!!sel[w.id]} onChange={(e) => setSel((s) => ({ ...s, [w.id]: e.target.checked }))} /></td>
                    <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{w.id}</td>
                    <td className="mono">{w.user}</td>
                    <td className="num mono" style={{ fontWeight: 700, color: large ? "var(--warning)" : undefined }}>${w.amount.toLocaleString("en-US")}{large && <span className="bdg warn" style={{ fontSize: 10, marginLeft: 5 }}>大额</span>}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{w.addr} · {w.chain}</td>
                    <td><span className="mono" style={{ fontWeight: 700, color: riskColor(w.risk) }}>{w.risk}</span></td>
                    <td style={{ fontSize: 12 }}>{kycCell(w)}{w.holdK5 && <span className="bdg dim" style={{ marginLeft: 5, fontSize: 10 }}>{w.holdK5}</span>}</td>
                    <td>{w.pts ? <span className="bdg ok">够</span> : <span className="bdg bad">不足</span>}</td>
                    <td className="mono">{w.n24}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{w.rules}</td>
                    <td><span className={`bdg ${stTone}`}>{stLabel}</span></td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }} onClick={(e) => e.stopPropagation()}>
                      {st === "review-pending" && (
                        <>
                          {w.holdK5 ? <span className="bdg dim" title="K5 复审未过不可放行(PRD D2⑦)">K5 hold</span>
                            : w.amount >= LARGE_LINE ? <button className="l-btn sm mc" onClick={() => approve(w)}>放行(操作确认)</button>
                            : w.risk < 40 && w.rules === "—" && w.pts ? <button className="l-btn sm" onClick={() => approve(w)}>快速放行</button>
                            : <button className="l-btn sm" onClick={() => delay(w)}>延迟</button>}
                          {" "}<button className="l-btn sm" onClick={() => reject(w)}>拒绝</button>
                          {" "}<button className="l-btn sm mc" onClick={() => freeze(w)}>冻结</button>
                        </>
                      )}
                      {st === "frozen" && (
                        <>
                          <button className="l-btn sm mc" onClick={() => unfreeze(w)}>解冻(操作确认)</button>
                          {" "}<button className="l-btn sm mc" onClick={() => refundOv(w)}>退款覆盖</button>
                        </>
                      )}
                      {st === "review-passed" && (
                        <button className="l-btn sm mc" onClick={() => freeze(w)} title="任何在途状态(已批/出金中)都可以冻结">冻结(在途)</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <DataListPager
          label="提现审核队列"
          page={pager.page}
          pageSize={pager.pageSize}
          total={pager.total}
          rawTotal={WITHDRAWALS.length}
          onPageChange={pager.setPage}
          onPageSizeChange={pager.setPageSize}
          pageSizeOptions={[5, 10, 20, 50]}
        />
        <div className="l-b" style={{ paddingTop: 0 }}>
          <div className="batch-bar">
            <span style={{ fontSize: 12.5, color: "var(--ink-3)" }}>已勾选 <b style={{ color: "var(--ink)" }}>{selCount}</b> 笔 · 批量:</span>
            <button className="l-btn" onClick={() => batch("approve")}>放行</button>
            <button className="l-btn" onClick={() => batch("delay")}>延迟</button>
            <button className="l-btn" onClick={() => batch("reject")}>拒绝</button>
            <button className="l-btn mc" onClick={() => batch("freeze")}>冻结(操作确认)</button>
            <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--ink-4)" }}>批量里混进大额单(≥ $1,000)时,服务器会把它们挑出来转单笔人工,小额照常批量过</span>
          </div>
        </div>
      </section>

      {/* 单笔详情(头部动作区与队列行同一套动作函数,核完画像就地处置) */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">单笔详情 · {cur.id}</span>
          <span className="sub">· 画像快照来自用户域(C1)· 风险分明细来自 K4(只读引用)</span>
          <div className="r">
            {curSt === "review-pending" && (
              <>
                {cur.holdK5 ? <span className="bdg dim" title="K5 复审未过不可放行">K5 hold · 禁放</span>
                  : cur.amount >= LARGE_LINE ? <button className="l-btn mc" onClick={() => approve(cur)}>放行(操作确认)</button>
                  : <button className="l-btn primary" onClick={() => approve(cur)}>放行</button>}
                <button className="l-btn" onClick={() => delay(cur)}>延迟</button>
                <button className="l-btn" onClick={() => reject(cur)}>拒绝</button>
                <button className="l-btn mc" onClick={() => freeze(cur)}>冻结</button>
              </>
            )}
            {curSt === "frozen" && <button className="l-btn mc" onClick={() => unfreeze(cur)}>解冻(操作确认)</button>}
            {curSt === "review-passed" && <button className="l-btn mc" onClick={() => freeze(cur)}>冻结(在途)</button>}
          </div>
        </div>
        <div className="dt-split">
          <div>
            {cur.info.map(([k, v]) => (
              <div className="kv" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
            ))}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>风险分明细(K4 · 只读引用)</div>
            <div style={{ fontSize: 13, marginBottom: 8 }}>总分 <b className="mono" style={{ color: riskColor(cur.risk), fontSize: 16 }}>{cur.risk}</b><span style={{ fontSize: 11.5, color: "var(--ink-4)", marginLeft: 8 }}>维度贡献求和 = 总分(K4 可解释口径)</span></div>
            {cur.riskDims.map(([nm, pt]) => (
              <div key={nm} style={{ display: "grid", gridTemplateColumns: "90px 1fr 40px", gap: 10, alignItems: "center", padding: "4px 0" }}>
                <span style={{ fontSize: 12, color: "var(--ink-3)" }}>{nm}</span>
                <span style={{ height: 7, borderRadius: 999, background: "var(--surface-3)", overflow: "hidden", display: "block" }}><i style={{ display: "block", height: "100%", width: `${(pt / dimMax) * 100}%`, background: "var(--warning)", borderRadius: 999 }} /></span>
                <span className="mono" style={{ fontSize: 12, textAlign: "right" }}>{pt > 0 ? `+${pt}` : "0"}</span>
              </div>
            ))}
            <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 8px" }}>该用户提现历史</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-3)", lineHeight: 1.8 }}>{cur.hist}</div>
            {cur.holdK5 && curSt !== "rejected" && curSt !== "refunded" && (
              <div className="dtint warn" style={{ marginTop: 12 }}><b>K5 复审 hold</b> · 本单/本人在大额 KYC 复审({cur.holdK5})未裁决,复审未过维持待确认/延迟,不可放行(风控与反作弊 → 大额 KYC 复审里裁决)。</div>
            )}
          </div>
        </div>
      </section>

      <p className="f-foot"><b>三类参数三个家</b>:大额操作确认线($1,000)是本队列自己的静态参数;风控路由线(金额/速度/新账户/地址信誉)归 K3 规则引擎,这里照单消费——<b>K3 给出延迟/冻结/转人工时,小额快速通道不能盖过它</b>;冷却天数和积分门槛是运营节奏参数,归 H1 派发、在 D5 生效,这里只拿来判「冷却到没到、积分够不够」。「24h 提交」按提交次数计(含被拒/退回的提交)——日限(D5,当前 {pget("D.dailyLimitCount") ?? "1 次 / 日"})限的是在途成功单,反复被拒又反复提交正是 WR-02 的速度信号。月 8 以后(P5+)叠加增强合规审查(H1 派发,这里只读)。放行实时核减资金池储备(D3)→ 影响兑付覆盖率(B1)→ 喂挤兑雷达(B5);大额单触发 KYC 复审(K5),复审没过的维持待确认/延迟。所有写操作带防重号,网络重试不会重复放行或重复退款。</p>
    </>
  );
}
