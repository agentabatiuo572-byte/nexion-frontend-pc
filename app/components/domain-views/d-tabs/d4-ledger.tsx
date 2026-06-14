"use client";

/**
 * D4 账本 / 账单审计 — server 唯一账本的审计面。
 * 8 类账单(独立 bonus 类,试用兑换终态产;adjustment = C3 人工调整专类,不复用 refund)
 * + 单用户滚动余额(断点 = 账实不符告警)
 * + 手动调账 = 唯一合法写账路径(操作确认 + 幂等 + 凭证)+ 脱敏导出;保留期 13 月(≥ 事件留存)。
 * 单用户账本末态收敛 USERS.balance;BL ↔ WD/TP 单据与 D1/D2/K 同一时间线。
 */
import { useState } from "react";
import { D_FUND } from "@/lib/mock/admin/design-data";
import { BILL_TYPES, BILLS, LEDGERS, BREAKS } from "./data";
import type { DCtx } from "./types";
import { DataListPager, useDataListPager } from "../design-kit";

export function D4Ledger({ ctx }: { ctx: DCtx }) {
  const { pget, setParam, logAudit, toast, openActionConfirm, openConfirm } = ctx;
  const [type, setType] = useState("all");
  const [lookupInput, setLookupInput] = useState("usr_55B1");
  const [lookupId, setLookupId] = useState("usr_55B1");

  const ledger = LEDGERS[lookupId];
  const adjusted = (ref: string) => pget(`D.adjust.${ref}`) !== undefined;
  const billRows = BILLS.filter((b) => type === "all" || b.type === type);
  const billPager = useDataListPager(billRows, { resetKey: type });

  const adjustBill = (ref: string) => openActionConfirm({
    action: `手动调账 · ${ref}`,
    detail: <><b>写账本的唯一合法路径</b>:退款 / 冲正 / 断点修复都从这里走。必须写原因并在原因里附关联凭证号;操作确认 + 防重号,产 admin.bill_adjusted 审计事件,喂财务报表(L3)和监管报告(L5)。</>,
    edit: { kind: "text", current: "—", unit: "USDT" },
    run: (reason, v) => { if (v) setParam(`D.adjust.${ref}`, v, { action: `手动调账 ${ref} ${v} USDT`, reason }); toast(`${ref} 调账 ${v ?? ""} 已确认生效 · 凭证留痕`); },
  });
  const exportBills = () => openConfirm({
    action: "导出账单流水 CSV",
    detail: "按当前筛选导出(全平台按类型 / 单用户)。强制脱敏:不含手机号、地址等明文;监管用途的批量明细导出请走 L5 导出管控(那边按敏感等级走操作确认)。",
    okLabel: "导出",
    run: () => { logAudit({ actor: "总管理员", action: `账单流水导出(脱敏 CSV · 筛选 ${type})`, target: "D4-bills" }); toast("账单流水已导出(脱敏)· 落审计"); },
  });

  return (
    <>
      <div className="f-stats">
        <div className="f-stat"><div className="k">今日落账</div><div className="v">{D_FUND.billsTodayCnt.toLocaleString("en-US")} 笔</div><div className="sub">8 类合计 · 每笔对应一个资金事件</div></div>
        <div className="f-stat ok"><div className="k">账实相符</div><div className="v">{D_FUND.ledgerMatchPct}%</div><div className="sub">账单加总 vs 余额逐户核对</div></div>
        <div className="f-stat danger"><div className="k">账实不符告警</div><div className="v">{D_FUND.billBreakCnt} 户</div><div className="sub">滚动余额有断点 · 待核查</div></div>
        <div className="f-stat cyan"><div className="k">账单保留期</div><div className="v">{D_FUND.billRetentionMonths} 个月</div><div className="sub">完整运营周期 + 1 月缓冲(≥ 事件留存)</div></div>
      </div>

      {/* 全平台流水 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">全平台账单流水</span>
          <span className="sub">· 8 类账单(类型清单锁定,新增类型走事件中台 schema 治理)· bonus = 试用兑换终态 · adjustment = C3 人工调整专类</span>
          <div className="r">
            <div className="chips">
              <button className={`chip${type === "all" ? " sel" : ""}`} onClick={() => setType("all")}>全部</button>
              {BILL_TYPES.map((t) => (
                <button key={t.key} className={`chip${type === t.key ? " sel" : ""}`} onClick={() => setType(t.key)}>{t.label}</button>
              ))}
            </div>
            <button className="l-btn sm" onClick={exportBills}>导出</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1020 }}>
            <thead><tr><th>账单</th><th>账户</th><th>类型</th><th className="num">金额</th><th>币种</th><th>状态</th><th>备注 / 关联单</th><th>时间</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
            <tbody>
              {billPager.pageRows.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: "center", color: "var(--ink-4)", padding: "28px 12px" }}>
                    无匹配账单流水 · 切换类型查看全部账单
                  </td>
                </tr>
              ) : billPager.pageRows.map((b) => {
                const t = BILL_TYPES.find((x) => x.key === b.type)!;
                const adj = adjusted(b.id);
                return (
                  <tr key={b.id}>
                    <td className="mono" style={{ color: "var(--ink)" }}>{b.id}</td>
                    <td className="mono">{b.user}</td>
                    <td><span className={`bdg ${t.tone}`}>{t.label}</span>{adj && <span className="bdg dim" style={{ marginLeft: 5, fontSize: 10 }}>调账确认中</span>}</td>
                    <td className="num mono" style={{ fontWeight: 700, color: b.amt.startsWith("+") ? "var(--success)" : "var(--negative)" }}>{b.amt}</td>
                    <td className="mono" style={{ fontSize: 11.5 }}>{b.cur}</td>
                    <td><span className={`bdg ${b.st === "已入账" || b.st === "已退回" ? "ok" : "warn"}`}>{b.st}</span></td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{b.memo}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{b.t}</td>
                    <td style={{ textAlign: "right" }}><button className="l-btn sm mc" onClick={() => adjustBill(b.id)}>调账</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <DataListPager
          label="全平台账单流水"
          page={billPager.page}
          pageSize={billPager.pageSize}
          total={billPager.total}
          rawTotal={BILLS.length}
          onPageChange={billPager.setPage}
          onPageSizeChange={billPager.setPageSize}
          pageSizeOptions={[5, 10, 20, 50]}
        />
      </section>

      <div className="two-col r135">
        {/* 单用户账本 + Running Balance */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">单用户账本 · 滚动余额</span>
            <span className="sub">· 每笔之后的余额快照 · 断点 = 账实不符</span>
            <div className="r">
              <div className="lookup">
                <input value={lookupInput} onChange={(e) => setLookupInput(e.target.value)} placeholder="输入 userId" />
                <button className="l-btn primary" onClick={() => {
                  const id = lookupInput.trim() || "usr_55B1";
                  if (!LEDGERS[id]) { toast("原型内置样例:usr_55B1 / usr_19C7"); return; }
                  setLookupId(id);
                }}>查账</button>
              </div>
            </div>
          </div>
          <div className="l-b">
            <div className="sum-grid">
              {ledger.sums.map(([k, v]) => (
                <div className="s" key={k}>
                  <div className="k">{k}累计</div>
                  <div className="v" style={{ color: v.startsWith("+") ? "var(--success)" : "var(--negative)" }}>{v}</div>
                </div>
              ))}
            </div>
            {ledger.rows.map(([d, ev, amt, bal, brk], i) => (
              <div className={`rb-row${brk ? " break" : ""}`} key={i}>
                <span className="mono" style={{ color: "var(--ink-4)" }}>{d}</span>
                <span style={{ color: "var(--ink-3)" }}>{ev}{brk && <span className="bdg bad" style={{ marginLeft: 6 }}>断点</span>}</span>
                <span className="mono" style={{ fontWeight: 700, color: amt.startsWith("+") ? "var(--success)" : "var(--negative)" }}>{amt}</span>
                <span className="mono" style={{ color: "var(--ink-2)" }}>余 {bal}</span>
              </div>
            ))}
            <div className="dtint" style={{ marginTop: 10 }}>分类累计求和 = 当前余额(与用户域 C1 画像同源);任一断点即账实不符,进右侧告警等核查后调账。</div>
          </div>
        </section>

        {/* 账实核对 */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">账实不符告警</span>
            <span className="sub">· 滚动余额断点 · 核查后要调账走操作确认</span>
          </div>
          <div className="l-b">
            {BREAKS.map(([user, desc, st]) => (
              <div className="cb-row" key={user}>
                <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{user}</span>
                <span style={{ flex: 1, fontSize: 12.5, color: "var(--ink-3)" }}>{desc}</span>
                <span className="bdg warn">{adjusted(user) ? "调账确认中" : st}</span>
                {!adjusted(user) && <button className="l-btn sm mc" onClick={() => adjustBill(user)}>调账修复</button>}
              </div>
            ))}
            <div className="dtint" style={{ marginTop: 12 }}><b>账实相符怎么核</b> · 三方对齐:① 每个资金事件对应一条账单;② 单用户账单加总 = 当前余额;③ 全平台账单聚合 = 资金池(D3)的储备/负债明细。任何一环对不上就在这里告警,并联动 D3 和水位卡(B2)的对账告警。</div>
            <div className="dtint warn" style={{ marginTop: 10 }}><b>bonus 账单口径</b> · 试用走完「兑换入账」终态才产生 bonus 账单(独立类型);中途取消、失败的影子收益不落账。这一类型已定为独立类(不并进收益类),按类型筛选时单独可查。</div>
          </div>
        </section>
      </div>

      <p className="f-foot"><b>三条铁律</b>:① 服务器是唯一账本——客户端推上来的账单一律视为伪造,余额展示只是缓存;② 每个资金事件对应一条账单,一一对应、不丢不重——这是「资金动作全链路可观测」的落地;③ 账单号、订单号、提现单号全部由服务器生成,客户端造的号一律不认。手动调账(退款/冲正)操作确认 + 防重号,产 <b>admin.bill_adjusted</b> 审计事件喂财务报表(L3)和监管报告(L5);账单导出强制脱敏(无个人信息明文),监管批量导出走 L5 的管控层。</p>
    </>
  );
}
