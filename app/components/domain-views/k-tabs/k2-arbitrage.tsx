"use client";

/**
 * K2 套利与刷量检测 — 闭环分级判定(≥2 层预警 / 3 层闭环)+ 四视图(试用循环 / 换新套利 / 新人礼刷取 / 排行榜刷榜)。
 * 分工:K2 只「标记 + 产信号」(仍需操作确认 + 强制原因);批量冻结复用 K1 操作链(K.cluster.<id>.st 同键真联动);
 * minHoldingMonths 权威归 E3(只读 pget 同源);排行榜取消资格 / 奖池剔除归 F8 执行。
 */
import { useState } from "react";
import Link from "next/link";
import { PaginationExemptionList } from "../design-kit";
import { K_RISK } from "@/lib/mock/admin/design-data";
import { K2_PARAMS, K2_VIEWS, K2_JUDGE, type K2View, type K2Row } from "./data";
import type { KCtx } from "./types";

const fmt = (n: number) => n.toLocaleString("en-US");

export function K2HeaderActions() {
  return <span className="f-ro"><span className="d" />看的是行为闭环,不是单点</span>;
}

export function K2Arbitrage({ ctx }: { ctx: KCtx }) {
  const [view, setView] = useState<K2View>("trial");
  const v = K2_VIEWS[view];

  // E3 权威只读:与 /devices/trade-in 同一 pget 键(同口径必同源)。
  const minHolding = ctx.pget("E.tradein.minHoldingMonths") ?? "6";

  const lvlBadge = (n: number) => <span className={`bdg ${n >= 3 ? "bad" : n === 2 ? "warn" : "dim"}`}>{n} / 3 层</span>;

  const markArb = (r: K2Row) =>
    ctx.openConfirm({
      action: `标记套利账户 · ${r.cells[0]}`,
      detail: "打上套利标记并附证据链 —— 不冻结、不动钱。标记会进风险评分(K4)套利维度和风险雷达(B5)。",
      chips: [["仅标记 · 附证据链", "done"], ["落审计 · 喂 K4 / B5", "ready"]],
      reason: true,
      okLabel: "确认标记",
      run: (reason) => {
        ctx.setParam(`K.arb.mark.${r.rid}`, "marked", { action: `标记套利账户 ${r.cells[0]}`, reason });
        ctx.toast(`${r.cells[0]} 已标记套利 · 喂 K4 / B5`);
      },
    });

  const blockGift = (r: K2Row) =>
    ctx.openConfirm({
      action: `拦截新人礼 · ${r.cells[0]}`,
      detail: "停发这个簇后续的新人礼($5 + 200 NEX)。拦的是还没发出去的钱,不动任何已入账资产,所以不用操作确认;要追回已发放的,走用户域余额调整(C3,那边才是操作确认)。",
      chips: [["预防性阻断 · 不动已入账资产", "done"], ["台账留痕", "ready"]],
      reason: true,
      okLabel: "确认拦截",
      run: (reason) => {
        ctx.setParam(`K.gift.block.${r.cluster ?? r.rid}`, "blocked", { action: `拦截新人礼 ${r.cells[0]}`, reason });
        ctx.toast(`${r.cells[0]} 后续新人礼已停发 · 台账留痕`);
      },
    });

  const boardFlag = (r: K2Row) =>
    ctx.openConfirm({
      action: `标记刷榜账户 · ${r.cells[0]}`,
      detail: "产出刷榜信号给 F8(排行榜反欺诈)和风险雷达。取消参榜资格、从奖池剔除由 F8 执行,这里不做写操作;如需立即止血可走「联动 K1 冻结」。",
      chips: [["仅标记 + 产信号", "done"], ["处置执行归 F8", "ready"]],
      reason: true,
      okLabel: "确认标记",
      run: (reason) => {
        ctx.setParam(`K.board.flag.${r.rid}`, "flagged", { action: `标记刷榜账户 ${r.cells[0]}`, reason });
        ctx.toast(`${r.cells[0]} 刷榜信号已发 F8 / B5`);
      },
    });

  const linkFreeze = (r: K2Row) => {
    const cl = r.cluster ?? r.rid;
    ctx.openActionConfirm({
      action: `联动 K1 批量冻结 · ${r.cells[0]}`,
      detail: `复用 K1 的冻结操作链:把 ${cl} 关联账户全部冻结(请求自带防重号 Idempotency-Key,确认通过后服务器原子执行,冻结台账落 C2)。本页附上套利证据链一起进审计 · 写入 admin.cluster_frozen`,
      run: (reason) => {
        ctx.setParam(`K.cluster.${cl}.st`, "frozen", { action: `联动 K1 批量冻结 ${cl}(套利证据)`, reason });
        ctx.toast(`${r.cells[0]} 已联动 K1 冻结 · 证据链入审计`);
      },
    });
  };

  const adjParam = (p: (typeof K2_PARAMS)[number]) => {
    const cur = ctx.pget(`K.k2.${p.key}`) ?? p.val;
    ctx.openActionConfirm({
      action: `检测阈值调整 · ${p.name}`,
      detail: `${p.name} · 当前 ${cur} · ${p.note}。放宽方向(调高异常线/倍数)= 多发新人礼 / 放大奖池暴露,先核 B1 覆盖率 · 写入 admin.risk_threshold_adjusted`,
      amplifies: true,
      edit: { kind: "text", current: cur },
      run: (reason, newVal) => {
        if (!newVal) return;
        ctx.setParam(`K.k2.${p.key}`, newVal, { action: `调整检测阈值 ${p.name}`, reason });
        ctx.toast(`${p.name} 调整已确认生效`);
      },
    });
  };

  const rowDisposed = (r: K2Row) => {
    const cl = r.cluster ?? r.rid;
    if (ctx.pget(`K.cluster.${cl}.st`) === "frozen") return "已联动 K1 冻结";
    if (ctx.pget(`K.arb.mark.${r.rid}`) === "marked") return "已标记套利";
    if (ctx.pget(`K.board.flag.${r.rid}`) === "flagged") return "已标记刷榜";
    if (ctx.pget(`K.gift.block.${r.cluster ?? r.rid}`) === "blocked") return "新人礼已拦截";
    return null;
  };

  return (
    <div>
      <div className="f-stats">
        <div className="f-stat warn"><div className="k">闭环判定(3 层全中)</div><div className="v">{K_RISK.loopConfirmed}</div><div className="sub">本月 · 已联动 K1 冻结 3 簇</div></div>
        <div className="f-stat"><div className="k">预警转人工(2 层可疑)</div><div className="v">{K_RISK.loopWarn}</div><div className="sub">30 天滑动窗口内</div></div>
        <div className="f-stat ok"><div className="k">新人礼拦截</div><div className="v">{K_RISK.giftBlockedCnt} 笔</div><div className="sub">${fmt(K_RISK.giftBlockedUsd)} + {fmt(K_RISK.giftBlockedCnt * 200)} NEX 守住</div></div>
        <div className="f-stat danger"><div className="k">刷榜信号(本期)</div><div className="v">{K_RISK.boardSignals}</div><div className="sub">增速 &gt; 5× 基线 · 处置归 F8</div></div>
      </div>

      {/* 闭环判定逻辑 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">闭环怎么判</span>
          <span className="sub">· 分级预警,不是「全中才管」 · 判定窗口 = 30 天滑动(和试用冷却同窗)</span>
          <div className="r"><span className="kcode electric" title="组合攻击防御 §9.11e.1">多层叠加判定</span></div>
        </div>
        <div className="l-b">
          <div className="loop-strip" style={{ marginBottom: 14 }}>
            <span className="st">注册小号</span><span className="ar">→</span>
            <span className="st">绑上级</span><span className="ar">→</span>
            <span className="st hit">领新人礼</span><span className="ar">→</span>
            <span className="st hit">开免费试用</span><span className="ar">→</span>
            <span className="st">取消</span><span className="ar">→</span>
            <span className="st hit">清缓存 · 再来一轮</span>
            <span className="tail">单步都「正常」,连起来才是闭环</span>
          </div>
          <div className="lvl-grid">
            <div className="lv"><div className="t"><span className="bdg dim">层 1</span>多账户信号</div><div className="d">来自 K1:同设备 / 同卡 / 同 IP 聚成的账户簇。绑上级这件事在注册时就写进了服务器,清缓存抹不掉。</div></div>
            <div className="lv"><div className="t"><span className="bdg dim">层 2</span>绑上级事实</div><div className="d">服务器记录的推荐关系链 —— 小号都挂在同一个主号下面,是闭环的资金归集方向。</div></div>
            <div className="lv"><div className="t"><span className="bdg dim">层 3</span>试用循环信号</div><div className="d">同一实体反复「开试用 → 取消 → 再开」的服务器计数(K2 产出,试用引擎 H2 消费)。</div></div>
          </div>
          <div className="grade-row">
            <div className="ktint warn"><b>≥ 2 层可疑</b> → 预警 + 转人工核查</div>
            <div className="ktint bad"><b>3 层全中</b> → 判定闭环套利,联动 K1 批量冻结(操作确认)</div>
          </div>
        </div>
      </section>

      {/* 检测阈值 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">检测阈值</span>
          <span className="sub">· 换新最短持有月数归 E3 管,这里只读引用</span>
          <div className="r">
            <Link className="kcode lock" href="/devices/trade-in" title="minHoldingMonths 权威:E3 生命周期 & Trade-in(点击跳转配置入口)">🔒 换新门槛归 E3 · 只读 {minHolding} 个月</Link>
          </div>
        </div>
        <div className="l-b">
          <div className="param-grid">
            {K2_PARAMS.map((p) => {
              const curV = ctx.pget(`K.k2.${p.key}`);
              return (
                <div className="p" key={p.key}>
                  <div className="k">{p.name}</div>
                  <div className="v">
                    {curV ?? p.val}
                    {curV ? <span className="vu">· 原 {p.val}</span> : null}
                    <button className="l-btn sm mc" onClick={() => adjParam(p)} title={`PRD K2③ ${p.key}`}>调整</button>
                  </div>
                  <div className="s">{p.sub}</div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* 四类检测视图 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">检测命中</span>
          <span className="sub">{v.sub}</span>
          <div className="r">
            <div className="chips">
              {(Object.keys(K2_VIEWS) as K2View[]).map((k) => (
                <button key={k} className={`chip${view === k ? " sel" : ""}`} onClick={() => setView(k)}>{K2_VIEWS[k].label}</button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 1020 }}>
            <thead><tr>{v.head.map((h, i) => <th key={h} style={i === v.head.length - 1 ? { textAlign: "right" } : undefined}>{h}</th>)}</tr></thead>
            <tbody>
              {v.rows.map((r) => {
                const disposed = rowDisposed(r);
                return (
                  <tr key={r.rid} style={disposed ? { opacity: 0.62 } : undefined}>
                    {r.cells.map((c, ci) =>
                      ci === 0 ? (
                        <td key={ci} className="mono" style={{ color: "var(--ink)", fontWeight: 600 }}>{c}</td>
                      ) : (
                        <td key={ci} style={{ fontSize: 12.5 }}>{c}</td>
                      ),
                    )}
                    {/* 设计稿列法:trial = 层数 + 判定 双列;board = 仅判定;tradein/gift = 仅层数。判定从层数单源派生。 */}
                    {view !== "board" && <td>{lvlBadge(r.lvl)}</td>}
                    {(view === "trial" || view === "board") && (() => { const [jl, jt] = K2_JUDGE(r.lvl); return <td><span className={`bdg ${jt}`}>{jl}</span></td>; })()}
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {disposed ? (
                        <span className="bdg dim">{disposed}</span>
                      ) : (
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          {r.acts.map((a) =>
                            a === "flag" ? <button key={a} className="l-btn sm" onClick={() => markArb(r)}>标记套利</button>
                            : a === "freeze" ? <button key={a} className="l-btn sm mc" onClick={() => linkFreeze(r)}>联动 K1 冻结</button>
                            : a === "blockgift" ? <button key={a} className="l-btn sm" onClick={() => blockGift(r)}>拦截新人礼</button>
                            : <button key={a} className="l-btn sm" onClick={() => boardFlag(r)}>标记刷榜</button>,
                          )}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 12 }}>
          <div className="ktint" style={{ fontSize: 12 }}><b>读法</b> · {v.note}</div>
        </div>
      </section>

      <p className="f-foot">
        <b>处置的分工要分清</b>:K2 只「标记 + 发信号」,动钱动账户的执行各有归属 —— 批量冻结复用 K1 的操作操作链;<b>拦截新人礼不用操作确认</b>,因为拦的是还没发出去的钱,不动任何已入账资产(要追回已发的,走用户域余额调整 C3 的操作确认流程);排行榜<b>取消资格和奖池剔除归 F8 执行</b>,这里只产信号,着急时可借 K1 冻结链路先止血。换新套利那条,服务器守卫早把残值算成 $0 拦下了,这里只是把人标出来观察。所有命中信号喂风险评分(K4)和风险雷达(B5)。
      </p>
      <PaginationExemptionList
        items={[
          {
            label: "检测命中",
            maxRows: 3,
            reason: "套利检测仅展示三条代表性命中样本,完整流水归审计事件",
          },
        ]}
      />
    </div>
  );
}
