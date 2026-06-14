"use client";

/**
 * G1 Staking 池配置 — 双产品 4 档(APY/罚款/最小额/停售)+ position 状态机监控 + 单档熔断。
 * 三道硬门:升 APY/降罚款过 B1 红线 422 + 跨档保序 422 + 熔断附处置方案;
 * 在锁单按开锁锁定值结算(乐观锁不追溯);整池闸 = J1 staking 闸只读引用(J.killswitch.staking)。
 * 真写键沿用旧契约:G.staking.apy|penalty|min.<tier> / G.staking.<tier>.killed / 新增 G.staking.enabled.<tier>。
 */
import { useState } from "react";
import { Drawer, PaginationExemption } from "../design-kit";
import { LEDGER } from "@/lib/mock/admin/ledger";
import { fmtM } from "@/lib/mock/admin/design-data";
import { G_FIN, USDT_TIERS, NEX_TIERS, G1_POS, G1_POS_DETAIL, type PoolTier } from "./data";
import type { GCtx } from "./types";

export function G1Staking({ ctx }: { ctx: GCtx }) {
  const { pget, setParam, toast, openActionConfirm } = ctx;
  const [drawer, setDrawer] = useState<string | null>(null);
  const cov = LEDGER.coverageRatio.toFixed(1);

  const stakingGateOn = (pget("J.killswitch.staking") ?? "on") === "on";
  const killedCnt = [...USDT_TIERS, ...NEX_TIERS].filter((t) => pget(`G.staking.${t.tier}.killed`) === "true").length;

  // 三字段独立写(audit 修:旧 adjPool 合并写 G.staking.apy.<tier> 导致 penalty/min 读永远 fallback;
  // 字段级完整性门:可编辑 ⊇ 展示,每个 PRD 参数独立 key)。
  const adjApy = (prod: string, t: PoolTier) => {
    const apy = pget(`G.staking.apy.${t.tier}`) ?? `${t.apy}%`;
    openActionConfirm({
      action: `Staking APY 调整 · ${prod} · ${t.term}`,
      detail: <>当前 APY {apy}。<b>升 APY 是放大流出</b>,提交时服务器先验备付金覆盖率红线(当前 {cov}% &gt; {LEDGER.redlinePct},可过);同时验跨档保序(长期档不能低于短期档,违反 422 提示冲突档)。只对新单生效,在锁单按开锁锁定值结算。</>,
      amplifies: true,
      edit: { kind: "text", current: apy },
      run: (reason, v) => { if (v) setParam(`G.staking.apy.${t.tier}`, v, { action: `Staking APY 调整 ${prod} ${t.term}`, reason }); toast(`${prod} ${t.term} APY 已更新为 ${v} · 仅新单生效`); },
    });
  };
  const adjPenalty = (prod: string, t: PoolTier) => {
    const pen = pget(`G.staking.penalty.${t.tier}`) ?? `${t.pen}%`;
    openActionConfirm({
      action: `Staking 提前赎回罚款调整 · ${prod} · ${t.term}`,
      detail: <>当前罚款 {pen} 本金。<b>降罚款是放大流出</b>,提交时服务器先验备付金覆盖率红线(当前 {cov}%)。只对新单生效。</>,
      amplifies: true,
      edit: { kind: "text", current: pen },
      run: (reason, v) => { if (v) setParam(`G.staking.penalty.${t.tier}`, v, { action: `Staking 罚款调整 ${prod} ${t.term}`, reason }); toast(`${prod} ${t.term} 罚款已更新为 ${v} · 仅新单生效`); },
    });
  };
  const adjMin = (prod: string, t: PoolTier) => {
    const min = pget(`G.staking.min.${t.tier}`) ?? t.min;
    openActionConfirm({
      action: `Staking 最小额调整 · ${prod} · ${t.term}`,
      detail: <>当前最小额 {min}。最小额收紧不影响在锁单,只对新单生效。</>,
      edit: { kind: "text", current: min },
      run: (reason, v) => { if (v) setParam(`G.staking.min.${t.tier}`, v, { action: `Staking 最小额调整 ${prod} ${t.term}`, reason }); toast(`${prod} ${t.term} 最小额已更新为 ${v} · 仅新单生效`); },
    });
  };
  const togglePool = (prod: string, t: PoolTier) => {
    const enabled = (pget(`G.staking.enabled.${t.tier}`) ?? "true") === "true";
    openActionConfirm({
      action: `${enabled ? "停售" : "恢复开售"}档位 · ${prod} · ${t.term}`,
      detail: <>{enabled ? "停售只停新锁,在锁单照常计息到期(除非走熔断)。" : "恢复该档新锁仓开放。"}操作确认。</>,
      amplifies: !enabled, // 恢复开售 = 放大流出方向
      run: (reason) => { setParam(`G.staking.enabled.${t.tier}`, enabled ? "false" : "true", { action: `Staking 档位${enabled ? "停售" : "恢复"} ${prod} ${t.term}`, reason }); toast(`${prod} ${t.term} 已${enabled ? "停售" : "恢复开售"} · 在锁不受影响`); },
    });
  };
  // 单档熔断 = 行级动作(audit 修:旧 killPool 写 G.staking.kill 无读取方 → 改写 G.staking.<tier>.killed=true 与状态灯/计数同键)。
  // 恢复(已熔断 → 营业)是放大流出方向。
  const killTier = (prod: string, t: PoolTier) => {
    const killed = pget(`G.staking.${t.tier}.killed`) === "true";
    openActionConfirm({
      action: `${killed ? "解除" : ""}单档熔断 · ${prod} · ${t.term}`,
      detail: killed
        ? <>解除熔断:该档恢复新锁开放,在锁单回正常计息;<b>恢复 = 放大流出方向</b>,确认放行时验备付金覆盖率红线(当前 {cov}%)。同步 J1 staking 闸编排。</>
        : <>熔断该档:立即停新锁 + 在锁单按处置方案走(slashed)。<b>处置方案随提案提交</b>(写进目标新值,如「在锁本金按原 APY 结算到提交日,本金按 90% 退回」);熔断同步紧急开关矩阵(J1)和风险雷达(B5)。风控/合规执行门槛:超管。</>,
      amplifies: killed, // 解除熔断 = 放大流出
      edit: killed ? undefined : { kind: "text", current: "(写处置方案,如:按原 APY 结算至提交日 · 本金 90% 退回)" },
      run: (reason) => { setParam(`G.staking.${t.tier}.killed`, killed ? "false" : "true", { action: `Staking 单档${killed ? "解除熔断" : "熔断"} ${prod} ${t.term}`, reason }); toast(`${prod} ${t.term} 已${killed ? "解除熔断" : "熔断"} · 同步 J1/B5`); },
    });
  };

  const poolTable = (prod: string, tiers: PoolTier[], minLabel: string) => (
    <div style={{ overflowX: "auto" }}>
      <table className="l-tbl" style={{ minWidth: 880 }}>
        <thead><tr><th>期限</th><th className="num">年化 APY</th><th className="num">提前赎回罚款</th><th className="num">{minLabel}</th><th className="num">在锁本金</th><th>状态</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
        <tbody>
          {tiers.map((t) => {
            const apy = pget(`G.staking.apy.${t.tier}`) ?? `${t.apy}%`;
            const hot = t.apy >= 80;
            const enabled = (pget(`G.staking.enabled.${t.tier}`) ?? "true") === "true";
            const killed = pget(`G.staking.${t.tier}.killed`) === "true";
            return (
              <tr key={t.tier} style={killed ? { opacity: 0.55 } : undefined}>
                <td style={{ fontWeight: 600, color: "var(--ink)" }}>{t.term}</td>
                <td className="num mono" style={{ fontWeight: 700, color: hot ? "var(--warning)" : undefined }}>
                  <span className="row" style={{ gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                    <span>{apy}{hot && <span className="bdg warn" style={{ fontSize: 9, marginLeft: 5 }}>高息</span>}</span>
                    <button className="l-btn sm mc" onClick={() => adjApy(prod, t)}>调</button>
                  </span>
                </td>
                <td className="num mono">
                  <span className="row" style={{ gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                    <span>{pget(`G.staking.penalty.${t.tier}`) ?? `${t.pen}%`}</span>
                    <button className="l-btn sm mc" onClick={() => adjPenalty(prod, t)}>调</button>
                  </span>
                </td>
                <td className="num mono" style={{ color: "var(--ink-3)" }}>
                  <span className="row" style={{ gap: 6, justifyContent: "flex-end", alignItems: "center" }}>
                    <span>{pget(`G.staking.min.${t.tier}`) ?? t.min}</span>
                    <button className="l-btn sm" onClick={() => adjMin(prod, t)}>调</button>
                  </span>
                </td>
                <td className="num mono">{t.locked}</td>
                <td>{killed ? <span className="bdg bad">已熔断</span> : enabled ? <span className="bdg ok">营业中</span> : <span className="bdg dim">已停售</span>}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <button className={`l-btn sm${enabled && !killed ? " mc" : ""}`} onClick={() => togglePool(prod, t)} disabled={killed} style={killed ? { opacity: 0.4, cursor: "not-allowed" } : undefined}>{enabled ? "停售" : "恢复开售"}</button>
                  {" "}<button className="l-btn sm mc" onClick={() => killTier(prod, t)}>{killed ? "解除熔断" : "熔断"}</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <PaginationExemption
        label={`${prod} 锁仓池 4 档配置表`}
        maxRows={4}
        reason="静态四档配置需一屏横向比较 APY、罚款、最小额与开关; 分页会破坏跨档保序审核。"
      />
    </div>
  );

  const dd = drawer ? G1_POS_DETAIL[drawer] : null;

  return (
    <>
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">在锁本金合计</div><div className="v">{fmtM(G_FIN.g1Locked)}</div><div className="sub">USDT 池 {fmtM(G_FIN.usdtPool)} + NEX 池折算 {fmtM(G_FIN.nexPool)}(科目 #2/#8)</div></div>
        <div className="f-stat"><div className="k">在锁 position 数</div><div className="v">{(G1_POS.active + G1_POS.mature).toLocaleString("en-US")}</div><div className="sub">active {G1_POS.active.toLocaleString("en-US")} · 到期未领 {G1_POS.mature}</div></div>
        <div className="f-stat warn"><div className="k">累计应付利息</div><div className="v">{fmtM(G_FIN.interest)}</div><div className="sub">按已锁天数线性派生 · 科目 #3 喂 D3/B2</div></div>
        <div className="f-stat danger"><div className="k">单档熔断</div><div className="v">{killedCnt}</div><div className="sub">高息 180%/365d 档重点盯 · 整池闸 {stakingGateOn ? "在线(J1)" : "已熔断(J1)"}</div></div>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">USDT 锁仓池 · 4 档</span>
          <span className="sub">· 改利率/罚款/开关都操作确认 · 只对新单生效</span>
          <div className="r"><span className="gcode electric">升息/降罚过 B1 红线 + 保序校验</span></div>
        </div>
        {poolTable("USDT", USDT_TIERS, "最小额")}
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">NEX 池 · 4 档</span>
          <span className="sub">· 币种区分文案 · 最小额按 NEX 计</span>
        </div>
        {poolTable("NEX", NEX_TIERS, "最小额(NEX)")}
      </section>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">Position 状态机与监控</span>
          <span className="sub">· 只读 · 状态只能服务器推进,客户端伪造无效 · 单档熔断在双产品 4 档表格行内操作</span>
        </div>
        <div className="l-b">
          <div className="pos-grid" style={{ marginBottom: 14 }}>
            <div className="p click" onClick={() => setDrawer("pending_lock")}><div className="k">pending_lock 待确认 <span className="more">看清单›</span></div><div className="v">{G1_POS.pending}</div></div>
            <div className="p click" onClick={() => setDrawer("active")}><div className="k">active 计息中 <span className="more">看清单›</span></div><div className="v" style={{ color: "var(--success)" }}>{G1_POS.active.toLocaleString("en-US")}</div></div>
            <div className="p click" onClick={() => setDrawer("mature_unclaimed")}><div className="k">mature_unclaimed 到期未领 <span className="more">看清单›</span></div><div className="v" style={{ color: "var(--warning)" }}>{G1_POS.mature}</div></div>
            <div className="p click" onClick={() => setDrawer("early_withdrawn")}><div className="k">本月 early_withdrawn 提前赎回 <span className="more">看清单›</span></div><div className="v">{G1_POS.earlyMonth}</div></div>
          </div>
          <div className="sm-strip">
            <span className="st">pending_lock</span><span className="ar">确认 →</span>
            <span className="st ok">active 计息中</span><span className="ar">到期 →</span>
            <span className="st warn">mature_unclaimed</span><span className="ar">领取 →</span>
            <span className="st ok">claimed 已领本息</span>
            <span className="ar" style={{ marginLeft: 12 }}>旁路:</span>
            <span className="st bad">early_withdrawn 罚款 forfeit 利息</span>
            <span className="st bad">slashed 熔断处置</span>
            <span className="st">refunded 锁失败退本</span>
          </div>
          <div className="gtint" style={{ marginTop: 12 }}><b>到期与负债联动</b> · 开锁即增应付负债(本金 + 按已锁天数线性派生的应付利息,科目 #2/#3),到期派发记一条账单(D4);到期日历喂资金池(D3)和驾驶舱负债到期预测(B2)。本息派发带防重号,熔断锁定优先——单子进了 slashed 再来领会被拒(409)。</div>
        </div>
      </section>

      <p className="f-foot"><b>三道硬门</b>:① 升 APY / 降罚款 = 放大资金流出,提交即被服务器拦下验备付金覆盖率红线,低于红线拒绝(422);② 同产品长期档 APY 必须 ≥ 相邻短期档(保序),违反拒绝并提示冲突档;③ 单档熔断的提案必须随附在锁单的处置方案。在锁单按开锁时锁定的利率结算,改参数用乐观锁不追溯历史。利息累积、到期 claim 全部服务器算,客户端实时跳动的利息数只是预览不写账。配置变更产 <b>admin.staking_pool_config_changed</b> 等审计,熔断同步紧急开关矩阵(J1)+ 风险雷达(B5)。</p>

      {dd && (
        <Drawer title={`锁仓单清单 · ${dd.label}`} sub={dd.note} onClose={() => setDrawer(null)}
          footer={<button className="l-btn" style={{ flex: 1, justifyContent: "center" }} onClick={() => setDrawer(null)}>关闭</button>}>
          <table className="l-tbl">
            <thead><tr><th>position</th><th>用户</th><th>产品档</th><th>金额</th><th>备注</th></tr></thead>
            <tbody>{dd.rows.map((r) => (
              <tr key={r[0]}><td className="mono" style={{ color: "var(--ink)" }}>{r[0]}</td><td className="mono">{r[1]}</td><td>{r[2]}</td><td className="mono" style={{ fontWeight: 700 }}>{r[3]}</td><td style={{ fontSize: 12, color: "var(--ink-3)" }}>{r[4]}</td></tr>
            ))}</tbody>
          </table>
          <div className="gtint" style={{ marginTop: 12 }}><b>只读监控</b> · position 状态只能服务器推进,这里不手动改单。要点名某个档止损走「单档熔断」;单用户资产去用户域(C3)。</div>
        </Drawer>
      )}
    </>
  );
}
