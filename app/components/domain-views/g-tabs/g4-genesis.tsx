"use client";

/**
 * G4 Genesis 经济 — 节点总量/单价/分红率(0.1%/日裁定)/二级版税 + 一二级监控 + 分红派发 + 持有台账。
 * 分红双口径权威调和:基数口径派发($24.2M × 0.1% ÷ 1,000 = $24/slot/日,产品权威档·14 月回本)
 * + 保底口径预提(节点价 × 0.1% = $10/节点/日 → 科目#4 $268K),超出保底部分从当期交易抽成直接派发不占预提;
 * 派发流量与 MATURITY.genesis(20.3K/日 = 847 × $24)同源。
 * 市场熔断 = J.killswitch.genesis(J1 同键);geo = GEOBLOCK(J2 权威只读)。
 */
import { useState } from "react";
import Link from "next/link";
import { Drawer, PaginationExemption } from "../design-kit";
import { LEDGER } from "@/lib/mock/admin/ledger";
import { GEOBLOCK, fmtM } from "@/lib/mock/admin/design-data";
import { GENESIS, GENESIS_POOL_TODAY, GENESIS_PAYOUT_TODAY, GENESIS_NODES, GENESIS_NODE_DETAIL, G_FIN } from "./data";
import type { GCtx } from "./types";

export function G4Genesis({ ctx }: { ctx: GCtx }) {
  const { pget, setParam, toast, openActionConfirm, openConfirm } = ctx;
  const [nodeDrawer, setNodeDrawer] = useState<string | null>(null);
  const cov = LEDGER.coverageRatio.toFixed(1);

  const marketOn = (pget("J.killswitch.genesis") ?? "on") === "on";
  const geoBlocked = GEOBLOCK.filter((g) => g.status === "blocked").map((g) => g.cc);
  const soldPct = (GENESIS.sold / GENESIS.totalSlots) * 100;
  const batchRerun = pget(`G.genesis.rerun.${GENESIS.todayBatch}`) === "done";

  const adjEco = (key: string, label: string, cur: string, note: string) => openActionConfirm({
    action: `Genesis 经济参数 · ${label}`,
    detail: <><b>{label}</b> · 当前 {cur} · {note}。运营执行门槛:财务主管/超管。</>,
    edit: { kind: "text", current: cur },
    run: (reason, v) => { if (v) setParam(`G.genesis.${key}`, v, { action: `Genesis 经济参数 ${label}`, reason }); toast(`${label} 已更新为 ${v}`); },
  });

  return (
    <>
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">一级售出</div><div className="v">{GENESIS.sold} / {GENESIS.totalSlots.toLocaleString("en-US")}</div><div className="sub">${GENESIS.unitPrice.toLocaleString("en-US")} / 张 · 距售罄 {GENESIS.totalSlots - GENESIS.sold} 张</div></div>
        <div className="f-stat"><div className="k">分红承诺预提</div><div className="v">{fmtM(G_FIN.genesisAccrual)}</div><div className="sub">科目 #4 · 保底口径(节点价 × 0.1%)预提</div></div>
        <div className="f-stat cyan"><div className="k">二级地板价</div><div className="v">${(GENESIS.secondary.floor / 1000).toFixed(1)}K</div><div className="sub">24h 量 ${(GENESIS.secondary.vol24h / 1000).toFixed(0)}K · 在挂 {GENESIS.secondary.listed}</div></div>
        <div className="f-stat warn"><div className="k">市场熔断</div><div className="v">{marketOn ? "未启用" : "已熔断"}</div><div className="sub">证券类风险时一键停 · 联动 J1</div></div>
      </div>

      <div className="two-col r11" style={{ marginBottom: 16 }}>
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">节点经济参数</span>
            <span className="sub">· 分红率改动最敏感</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: "var(--ink-4)", marginBottom: 2 }}>一级售出进度 {GENESIS.sold} / {GENESIS.totalSlots.toLocaleString("en-US")}</div>
              <div className="sold"><i style={{ width: `${soldPct}%` }} /></div>
            </div>
            <div className="p-row"><div className="txt"><div className="k">节点总量</div><div className="s">不能低于已铸造量</div></div><span className="v">{pget("G.genesis.supply") ?? "1,000"}</span><button className="l-btn sm mc" onClick={() => adjEco("supply", "节点总量", pget("G.genesis.supply") ?? "1,000", `≥ 已售 ${GENESIS.sold} · 只影响未来供应`)}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">一级单价</div><div className="s">在途购买锁价</div></div><span className="v">{pget("G.genesis.price") ?? "$9,999"}</span><button className="l-btn sm mc" onClick={() => adjEco("price", "一级单价", pget("G.genesis.price") ?? "$9,999", "只对新购生效")}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">每日分红率 <span className="bdg ok" style={{ fontSize: 9 }}>基准 0.1%/日</span></div><div className="s">保底预提 = 节点价 × 持有量 × 0.1%/日(科目 #4)</div></div><span className="v">{pget("G.genesis.dividend") ?? "0.1% / 日"}</span><button className="l-btn sm mc" onClick={() => openActionConfirm({
              action: "改每日分红率",
              detail: <>当前基准 <b>0.1%/日</b>。升分红率 = 放大 USDT 流出,确认放行时验备付金红线(当前 {cov}%,422);<b>偏离 0.1% 基准的任何调整必须在原因里附 PM 决议引用</b>。财务主管执行门槛:超管。</>,
              amplifies: true,
              edit: { kind: "text", current: pget("G.genesis.dividend") ?? "0.1% / 日" },
              run: (reason, v) => { if (v) setParam("G.genesis.dividend", v, { action: "Genesis 分红率调整", reason }); toast(`分红率已更新为 ${v} · 附 PM 决议引用`); },
            })}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">二级版税</div><div className="s">卖家成交扣</div></div><span className="v">{pget("G.genesis.royalty") ?? "2.5%"}</span><button className="l-btn sm mc" onClick={() => adjEco("royalty", "二级版税", pget("G.genesis.royalty") ?? "2.5%", "范围 0–20% · 只对新成交")}>调整</button></div>
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">一二级市场</span>
            <span className="sub">· 实时 stats · 分红跟随 NFT</span>
            <div className="r">
              <button className="l-btn mc" onClick={() => openActionConfirm({
                action: marketOn ? "一二级市场熔断" : "恢复一二级市场",
                detail: marketOn
                  ? <>立即停一二级市场交易(证券类风险时用)。在锁分红按处置方案走(保留 / 暂停)。风控/合规执行门槛:超管,同步紧急开关矩阵(J1 genesis 闸)。</>
                  : <>恢复一二级市场 = 恢复高客单产品流转与分红派发,确认放行时核验 B1 覆盖率(当前 {cov}%),同步 J1。</>,
                amplifies: !marketOn,
                run: (reason) => { setParam("J.killswitch.genesis", marketOn ? "off" : "on", { action: marketOn ? "Genesis 市场熔断" : "Genesis 市场恢复", reason }); toast(`Genesis 市场已${marketOn ? "熔断" : "恢复"} · 同步 J1`); },
              })}>{marketOn ? "市场熔断" : "恢复市场"}</button>
              <Link href="/emergency/geo-block" className="l-btn">地域封锁(J2)→</Link>
            </div>
          </div>
          <div className="l-b">
            <div className="mk-tiles">
              <div className="t"><div className="k">地板价</div><div className="v">${(GENESIS.secondary.floor / 1000).toFixed(1)}K</div></div>
              <div className="t"><div className="k">24h 成交量</div><div className="v">${(GENESIS.secondary.vol24h / 1000).toFixed(0)}K</div></div>
              <div className="t"><div className="k">在挂</div><div className="v">{GENESIS.secondary.listed}</div></div>
              <div className="t"><div className="k">持有人</div><div className="v">{GENESIS.secondary.owners}</div></div>
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 8px" }}>节点状态机</div>
            <div className="sm-strip">
              <span className="st ok">minted 售出/铸造</span><span className="ar">→</span>
              <span className="st ok">held 持有计分红</span><span className="ar">挂单 →</span>
              <span className="st">listed 二级挂单</span><span className="ar">成交扣 2.5% →</span>
              <span className="st">sold 分红跟随新持有者</span>
            </div>
            <div className="gtint" style={{ marginTop: 12 }}><b>分红与负债</b> · 买入即按保底口径增应付负债(科目 4「Genesis 日分红承诺」),每天 00:00 UTC 批量派发记账(D4),带防重号(按日期去重,重跑不重复发)。二级转让时分红权跟着 NFT 走,不跟旧持有者。二级版税收入进网络金库。当前地域封锁:{geoBlocked.join(" / ")}(J2 制裁名单,只读)。</div>
          </div>
        </section>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">分红派发监控</span>
          <span className="sub">· 派发 = 平台日交易量基数 × 0.1% ÷ 1,000 slot · 预提 = 节点价 × 0.1% 保底(科目 #4)</span>
          <div className="r">
            <button className="l-btn mc" onClick={() => openActionConfirm({
              action: "调整分红基数口径",
              detail: <>当前:派发池 = <b>平台日交易量 × 0.1% ÷ 1,000 slot 均分</b>(${GENESIS.perSlotPerDay}/slot/日);负债预提按节点价 × 0.1% 保底。改基数口径(换基数、换均分方式)= 改分红算法,直接影响每日应付——确认放行时验备付金红线(422),必须附 PM 决议引用。财务主管执行门槛:超管。</>,
              amplifies: true,
              edit: { kind: "text", current: "平台日交易量 × 0.1% ÷ 1,000" },
              run: (reason, v) => { if (v) setParam("G.genesis.divBase", v, { action: "Genesis 分红基数口径调整", reason }); toast("基数口径调整已确认生效 · 附 PM 决议"); },
            })}>调整基数口径(操作确认)</button>
            <button className="l-btn" onClick={() => openConfirm({
              action: `重跑今日分红批次 ${GENESIS.todayBatch}`,
              detail: "批次按日期带防重号:已发过的户不会重复发,只补发失败户。重跑结果落审计。",
              chips: [["按日期防重 · 只补失败户", "done"], ["落审计", "ready"]], reason: true, okLabel: "确认重跑",
              run: (reason) => { setParam(`G.genesis.rerun.${GENESIS.todayBatch}`, "done", { action: `重跑分红批次 ${GENESIS.todayBatch}`, reason }); toast(`${GENESIS.todayBatch} 重跑完成 · 补发 0 户(无失败)`); },
            })}>重跑今日批次{batchRerun ? "(已重跑)" : ""}</button>
          </div>
        </div>
        <div className="l-b">
          <div className="mk-tiles">
            <div className="t"><div className="k">平台日交易量基数(今日)</div><div className="v">${(GENESIS.dailyVolumeBase / 1e6).toFixed(1)}M</div></div>
            <div className="t"><div className="k">今日分红池(基数 × 0.1%)</div><div className="v" style={{ color: "var(--success)" }}>${(GENESIS_POOL_TODAY / 1000).toFixed(1)}K</div></div>
            <div className="t"><div className="k">每 slot 均分(÷ 1,000)</div><div className="v">${GENESIS.perSlotPerDay} / 天</div></div>
            <div className="t"><div className="k">今日批次 {GENESIS.todayBatch}</div><div className="v" style={{ color: "var(--success)" }}>已派 {GENESIS.sold} 户 · ${(GENESIS_PAYOUT_TODAY / 1000).toFixed(1)}K</div></div>
          </div>
          <div className="gtint" style={{ marginTop: 12 }}><b>两套口径怎么对上</b> · 用户看到的叙事是「全网每日交易量的 0.1% 按 slot 均分」(随营收浮动,当前 ${GENESIS.perSlotPerDay}/slot/日;未售出 slot 的份额留存金库);财务预提负债按「节点价 × 持有量 × 0.1%/日 = ${GENESIS.floorPerNodePerDay}/节点/日」保底挂科目 #4——基数口径高出保底的部分从当期交易抽成直接派发,不占预提。实际派发流量(已售 {GENESIS.sold} 户 × ${GENESIS.perSlotPerDay} ≈ ${(GENESIS_PAYOUT_TODAY / 1000).toFixed(1)}K/日)进资金池到期预测(D3)。改基数口径 = 改分红算法,操作确认 + 附 PM 决议引用。</div>
        </div>
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">节点持有台账</span>
          <span className="sub">· 只读 · 服务器单源,序号伪造不了 · 二级转让后 lifetime 分红跟随新持有者</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 760 }}>
            <thead><tr><th>节点</th><th>持有者(脱敏)</th><th>来源</th><th className="num">lifetime 分红</th><th>状态</th></tr></thead>
            <tbody>{GENESIS_NODES.map((n) => (
              <tr key={n[0]} className="click" onClick={() => setNodeDrawer(n[0])}>
                <td className="mono" style={{ color: "var(--ink)" }}>{n[0]} <span className="more">详情›</span></td>
                <td className="mono">{n[1]}</td><td>{n[2]}</td>
                <td className="num mono">{n[3]}</td>
                <td><span className={`bdg ${n[5]}`}>{n[4]}</span></td>
              </tr>
            ))}</tbody>
          </table>
          <PaginationExemption
            label="Genesis 节点持有台账"
            maxRows={5}
            reason="当前为只读监控样例和节点详情入口,全量一屏展示比分页更利于核对分红跟随关系。"
          />
        </div>
      </section>

      <p className="f-foot"><b>持有、分红、二级成交全部服务器为准</b>:节点序号和分红服务端单源,客户端伪造持有/分红无效;空持有就显示真实空状态。<b>每日分红率基准 0.1%/日</b>——保底预提按节点价 × 持有量 × 0.1%/日挂科目 #4,基数口径(日交易量 × 0.1% ÷ 1,000 slot)派发、超出保底部分当期化。升分红率/改基数口径先过备付金红线(422),偏离 0.1% 基准要附 PM 决议引用。市场熔断 + 地域封锁是紧急开关矩阵(J1)的生效面(证券类风险 / 国家级屏蔽)。</p>

      {nodeDrawer && (() => { const n = GENESIS_NODES.find((x) => x[0] === nodeDrawer)!; const d = GENESIS_NODE_DETAIL[nodeDrawer]; return (
        <Drawer title={`Genesis 节点 · ${nodeDrawer}`} sub={`持有者 ${n[1]} · ${n[4]} · 购入:${d.buy}`} onClose={() => setNodeDrawer(null)}
          footer={<button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setNodeDrawer(null)}>关闭</button>}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>分红</div>
          {d.div.map(([k, v]) => (
            <div className="kv2" key={k}><span className="k">{k}</span><span className="v">{v}</span></div>
          ))}
          <div style={{ fontSize: 13, fontWeight: 600, margin: "14px 0 8px" }}>二级流转记录</div>
          <table className="l-tbl">
            <thead><tr><th>时间</th><th>事件</th><th>版税</th></tr></thead>
            <tbody>{d.xfer.map((x, i) => (
              <tr key={i}><td className="mono">{x[0]}</td><td style={{ fontSize: 12 }}>{x[1]}</td><td style={{ fontSize: 12, color: "var(--ink-3)" }}>{x[2]}</td></tr>
            ))}</tbody>
          </table>
          <div className="gtint" style={{ marginTop: 12 }}><b>只读监控</b> · 分红双口径(基数派发 / 保底预提)见派发监控卡;调分红率/版税去经济参数(操作确认 + 过红线)。市场熔断/地域封锁是 J1 矩阵生效面。</div>
        </Drawer>
      ); })()}
    </>
  );
}
