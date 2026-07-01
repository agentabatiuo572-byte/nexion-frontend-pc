"use client";

/**
 * D1 充值对账中心 — 渠道费率/启停(操作确认)+ 主备 PSP(Checkout.com/Stripe,操作确认)+ 卡风控三参数(操作确认)
 * + 支付商对账(差异核销 操作确认)+ 充值流水三态 + BIN 攻击监控(锁/解锁仍需操作确认 带原因)+ 拒付处置(操作确认 · 三连原子)。
 * 入账唯一真相 = server 处理 PSP 回调/链上确认;本页只观测与处置,不另立储备账(入账事件喂 D3)。
 */
import { useState } from "react";
import { fmtUsd } from "@/lib/mock/admin/design-data";
import { CHANNELS, CARD_PARAMS, RECON, RECON_LEDGER_TOTAL, RECON_LEDGER_CNT, BINS, CBS, TOPUP_TABS, topupsByTab } from "./data";
import { D_FUND } from "@/lib/mock/admin/design-data";
import { PaginationExemption } from "../design-kit";
import type { DCtx } from "./types";

export function D1Recon({ ctx }: { ctx: DCtx }) {
  const { pget, setParam, toast, openActionConfirm, openConfirm } = ctx;
  const [flowTab, setFlowTab] = useState<"pending" | "confirmed" | "abnormal">("confirmed");

  const chOn = (id: string, seed: boolean) => { const v = pget(`D.channel.${id}`); return v === undefined ? seed : v === "enable"; };
  const chFee = (id: string, seed: string) => pget(`D.fee.${id}`) ?? seed;
  const pspPrimary = pget("D.psp.primary") ?? "Checkout.com";
  const binLocked = (i: number, seed: boolean) => { const v = pget(`D.bin.${i}`); return v === undefined ? seed : v === "locked"; };
  const reconciled = (ch: string) => pget(`D.reconcile.${ch}`) === "reconciled";
  const cbDone = (id: string, seed: boolean) => seed || pget(`D.chargeback.${id}`) === "refunded";

  const diffRows = RECON.filter((r) => r.diff && !reconciled(r.ch));
  const diffUsd = diffRows.reduce((s, r) => s + (r.pspAmt - r.ledAmt), 0);
  // 手动锁段(D.bin.manual.<段>)真写后即时进热力列表与计数(写读同链,防半截闭环)
  const manualBins = Object.keys(ctx.params).filter((k) => k.startsWith("D.bin.manual.") && ctx.params[k] === "locked").map((k) => k.slice("D.bin.manual.".length));
  const binLockedCnt = D_FUND.binLockedBase + BINS.filter((b, i) => binLocked(i, b.locked)).length + manualBins.length;

  return (
    <>
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">今日已确认入账</div><div className="v">${(RECON_LEDGER_TOTAL / 1000).toFixed(1)}K</div><div className="sub">{RECON_LEDGER_CNT} 笔 · 五渠道合计(平台入账侧)</div></div>
        <div className="f-stat warn"><div className="k">对账差异(未核销)</div><div className="v">{diffRows.length} 笔 · ${diffUsd.toLocaleString("en-US")}</div><div className="sub">单边挂账 {diffRows.filter((r) => r.diff?.includes("单边")).length} · 金额差 {diffRows.filter((r) => r.diff?.includes("金额差")).length}</div></div>
        <div className="f-stat cyan"><div className="k">风控备付金 fee_buffer</div><div className="v">${D_FUND.feeBufferUsd.toLocaleString("en-US")}</div><div className="sub">卡渠道 3.5% 手续费累计 · 非利润</div></div>
        <div className="f-stat danger"><div className="k">BIN 锁卡中</div><div className="v">{binLockedCnt}</div><div className="sub">同卡 24h ≥ 5 次失败自动锁</div></div>
      </div>

      {/* 渠道参数 + 启停 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">充值渠道与费率</span>
          <span className="sub">· 改费率只影响之后的新充值单,在途单按锁定费率走 · 启停和费率调整都要操作确认</span>
          <div className="r">
            <span className="dcode">主 PSP:{pspPrimary} · 备:{pspPrimary === "Checkout.com" ? "Stripe" : "Checkout.com"}</span>
            <button className="l-btn mc" onClick={() => openActionConfirm({
              action: "主备支付商切换",
              detail: <>当前主 <b>{pspPrimary}</b> / 备 {pspPrimary === "Checkout.com" ? "Stripe" : "Checkout.com"},按地区卡段自动路由。切换后<b>全部新刷卡交易</b>走新主路;在途授权单(已授权即费率/路由锁定)不受影响。影响全部刷卡入账路由,操作确认。</>,
              run: (reason) => { const next = pspPrimary === "Checkout.com" ? "Stripe" : "Checkout.com"; setParam("D.psp.primary", next, { action: `主备 PSP 切换 → ${next} 主`, reason }); toast(`主备已切换:${next} 为主 · 新交易生效 · 理由留痕`); },
            })}>主备切换(操作确认)</button>
          </div>
        </div>
        <div className="l-b" style={{ paddingTop: 6 }}>
          {CHANNELS.map((c) => { const on = chOn(c.id, c.on); const fee = chFee(c.id, c.fee); const min = pget(`D.min.${c.id}`) ?? c.min; return (
            <div className="ch-row" key={c.id}>
              <span className="nm">{c.id}{on ? <span className="bdg ok">营业中</span> : <span className="bdg bad">已停用</span>}</span>
              <span className="meta">最小充值 {min}(per-channel)<button className="l-btn sm mc" style={{ marginLeft: 8 }} onClick={() => openActionConfirm({
                action: `最小充值额调整 · ${c.id}`,
                detail: <><b>{c.id}</b> · 当前 {min} · 最小充值额按渠道分别配置,不可设单一全局值;仅对之后的新充值单生效。</>,
                edit: { kind: "text", current: min },
                run: (reason, v) => { if (v) setParam(`D.min.${c.id}`, v, { action: `最小充值额调整 ${c.id}`, reason }); toast(`${c.id} 最小充值额已更新为 ${v} · 仅新单生效`); },
              })}>调下限</button></span>
              <span className="v">{fee}</span>
              <button className="l-btn sm mc" onClick={() => openActionConfirm({
                action: `充值费率调整 · ${c.id}`,
                detail: <><b>{c.id}</b> · 当前 {fee} · 只影响之后的新充值单——链上单以「交易已广播」、刷卡单以「银行已授权」为界,之前的按老费率走。</>,
                edit: { kind: "text", current: fee },
                run: (reason, v) => { if (v) setParam(`D.fee.${c.id}`, v, { action: `充值费率调整 ${c.id}`, reason }); toast(`${c.id} 费率已更新为 ${v} · 仅新单生效`); },
              })}>调费率</button>
              <button className={`l-btn sm${on ? " mc" : ""}`} onClick={() => openActionConfirm({
                action: `${on ? "停用" : "启用"}充值渠道 · ${c.id}`,
                detail: <>{on ? "停用后用户端该渠道立即下架,新充值进不来;在途单照常确认。" : "重新开放该渠道入口。"}渠道启停直接影响资金流入通道,操作确认。</>,
                run: (reason) => { setParam(`D.channel.${c.id}`, on ? "disable" : "enable", { action: `充值渠道${on ? "停用" : "启用"} ${c.id}`, reason }); toast(`${c.id} 已${on ? "停用" : "启用"} · 理由留痕`); },
              })}>{on ? "停用" : "启用"}</button>
            </div>
          ); })}
          <div className="card-params">
            {CARD_PARAMS.map((p) => { const cur = pget(`D.${p.key}`) ?? p.cur; return (
              <div className="dtint row-tint" key={p.key}>
                <span style={{ flex: 1 }}><b>{p.name}</b> · {p.note.split(" · ")[0]}</span>
                <button className="l-btn sm mc" onClick={() => openActionConfirm({
                  action: `刷卡风控参数 · ${p.name}`,
                  detail: <><b>{p.name}</b> · 当前 {cur} · {p.note}。</>,
                  edit: { kind: "text", current: cur },
                  run: (reason, v) => { if (v) setParam(`D.${p.key}`, v, { action: `刷卡风控参数 ${p.name}`, reason }); toast(`${p.name} 已更新为 ${v} · 实时生效`); },
                })}>调整</button>
              </div>
            ); })}
          </div>
        </div>
      </section>

      {/* 对账面 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">支付商报表 vs 平台入账</span>
          <span className="sub">· 左边是支付商/链上看到的,右边是平台记的账,对不上的标红等人工核销</span>
          <div className="r"><span className="dcode electric">差异核销操作确认</span></div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 920 }}>
            <thead><tr><th>渠道</th><th className="num">支付商侧 笔数</th><th className="num">支付商侧 金额</th><th className="num">平台入账 笔数</th><th className="num">平台入账 金额</th><th className="num">差异</th><th style={{ textAlign: "right" }}>动作</th></tr></thead>
            <tbody>
              {RECON.map((r) => { const done = reconciled(r.ch); const bad = !!r.diff && !done; return (
                <tr key={r.ch} style={bad ? { background: "var(--danger-soft)" } : undefined}>
                  <td className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{r.ch}</td>
                  <td className="num mono">{r.pspCnt}</td><td className="num mono">{fmtUsd(r.pspAmt)}</td>
                  <td className="num mono">{r.ledCnt}</td><td className="num mono">{fmtUsd(r.ledAmt)}</td>
                  <td className="num mono" style={{ fontWeight: 700, color: bad ? "var(--danger)" : "var(--success)", fontSize: 12 }}>{bad ? r.diff!.split(" · ")[0] : done && r.diff ? "已核销" : "对平"}</td>
                  <td style={{ textAlign: "right" }}>{bad ? (
                    <button className="l-btn sm mc" onClick={() => openActionConfirm({
                      action: `对账差异核销 · ${r.ch}`,
                      detail: <><b>{r.diff}</b>。核销 = 账本调整级动作:确认差异原因并冲销单边挂账,操作确认 + 防重号(24h 去重),核销记录喂财务报表(L3)和监管报告(L5)。</>,
                      run: (reason) => { setParam(`D.reconcile.${r.ch}`, "reconciled", { action: `对账差异核销 ${r.ch}`, reason }); toast(`${r.ch} 差异已核销 · 理由留痕`); },
                    })}>核销</button>
                  ) : <span className="bdg ok">✓</span>}</td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
        <PaginationExemption
          label="支付商对账差异表"
          maxRows={5}
          reason="固定五渠道对账样本,逐渠道全量展示比翻页更利于核销"
        />
      </section>

      {/* 充值流水 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">充值流水</span>
          <span className="sub">· 已确认 = 已写账单(D4)+ 已累计终身入金(E 域换新资格源)</span>
          <div className="r"><div className="chips">
            {TOPUP_TABS.map((t) => (
              <button key={t.key} className={`chip${flowTab === t.key ? " sel" : ""}`} onClick={() => setFlowTab(t.key)}>{t.label}</button>
            ))}
          </div></div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="l-tbl" style={{ minWidth: 980 }}>
            <thead><tr><th>充值单</th><th>账户</th><th>渠道</th><th className="num">到账额</th><th className="num">渠道实收</th><th>凭证</th><th>状态</th><th>时间</th></tr></thead>
            <tbody>
              {topupsByTab(flowTab).map((f) => { const tone = f.stLabel.startsWith("已入账") ? "ok" : f.stLabel.includes("拒") || f.stLabel.includes("超时") ? "bad" : "warn"; return (
                <tr key={f.id}>
                  <td className="mono" style={{ color: "var(--ink)" }}>{f.id}</td>
                  <td className="mono">{f.user}</td>
                  <td><span className="bdg dim">{f.channel}</span></td>
                  <td className="num mono" style={{ fontWeight: 700 }}>{fmtUsd(f.amount)}</td>
                  <td className="num mono" style={{ color: "var(--ink-3)" }}>{f.recvLabel}</td>
                  <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{f.proof}</td>
                  <td><span className={`bdg ${tone}`}>{f.stLabel}</span></td>
                  <td className="mono" style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{f.t}</td>
                </tr>
              ); })}
            </tbody>
          </table>
        </div>
        <PaginationExemption
          label="充值流水分状态样本"
          maxRows={5}
          reason="按状态 tab 后单屏最多五条,用于核对样本而非无限流水查询"
        />
      </section>

      <div className="two-col r12">
        {/* BIN attack */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">刷卡攻击监控</span>
            <span className="sub">· 按卡段 / IP / 设备聚合的 24h 失败热力 · 超线自动锁卡,人工也能锁</span>
            <div className="r"><button className="l-btn" onClick={() => openConfirm({
              action: "手动锁卡段",
              detail: "立即拦下指定卡段/指纹的后续刷卡尝试(默认 24h)。锁卡是即时止血,单人可操作,落审计;失败热力同步给反多账户引擎(K1)支付工具维度。",
              chips: [["即时止血 · 单人可锁", "ready"], ["落审计 · 喂 K1", "done"]],
              reason: true, input: { label: "卡段 / 指纹", placeholder: "如 BIN 4716 02·· 或 fp_22ab…" }, okLabel: "确认锁卡",
              run: (reason, v) => { if (v) setParam(`D.bin.manual.${v}`, "locked", { action: `手动锁卡段 ${v}`, reason }); toast(`${v ?? ""} 已锁 24h · 落审计`); },
            })}>手动锁卡段</button></div>
          </div>
          <div className="l-b">
            <div className="heat">
              {manualBins.map((seg) => (
                <div className="h-row hot" key={`manual-${seg}`}>
                  <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>{seg}<small style={{ display: "block", fontWeight: 400, color: "var(--ink-4)" }}>手动锁段</small></span>
                  <span className="bar"><i style={{ width: "100%", background: "var(--danger)" }} /></span>
                  <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: "var(--danger)" }}>手动锁 24h</span>
                  <button className="l-btn sm" onClick={() => openConfirm({
                    action: `解锁卡段 · ${seg}`,
                    detail: "解锁后该卡段恢复刷卡。解锁必须写原因。",
                    chips: [["必须写原因", "ready"], ["落审计", "done"]], reason: true, okLabel: "确认解锁",
                    run: (reason) => { setParam(`D.bin.manual.${seg}`, "unlocked", { action: `解锁卡段 ${seg}`, reason }); toast(`${seg} 已解锁 · 原因留痕`); },
                  })}>解锁</button>
                </div>
              ))}
              {BINS.map((b, i) => { const locked = binLocked(i, b.locked); return (
                <div className={`h-row${locked ? " hot" : ""}`} key={b.name}>
                  <span className="mono" style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}>{b.name}<small style={{ display: "block", fontWeight: 400, color: "var(--ink-4)" }}>{b.meta}</small></span>
                  <span className="bar"><i style={{ width: `${(b.fails / 10) * 100}%`, background: b.fails >= 5 ? "var(--danger)" : "var(--warning)" }} /></span>
                  <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: b.fails >= 5 ? "var(--danger)" : "var(--warning)" }}>{b.fails} 次/24h</span>
                  {locked ? (
                    <button className="l-btn sm" onClick={() => openConfirm({
                      action: `解锁卡段 · ${b.name}`,
                      detail: "解锁后该卡段恢复刷卡。解锁必须写原因(比如确认为正常商户批量代付)。",
                      chips: [["必须写原因", "ready"], ["落审计", "done"]], reason: true, okLabel: "确认解锁",
                      run: (reason) => { setParam(`D.bin.${i}`, "unlocked", { action: `解锁卡段 ${b.name}`, reason }); toast(`${b.name} 已解锁 · 原因留痕`); },
                    })}>解锁</button>
                  ) : (
                    <button className="l-btn sm" onClick={() => openConfirm({
                      action: `手动锁卡 · ${b.name}`,
                      detail: "立即拦下该卡段/指纹的后续刷卡尝试(默认 24h)。锁卡是即时止血,单人可操作,落审计;失败热力同步给 K1 支付工具维度。",
                      chips: [["即时止血 · 单人可锁", "ready"], ["落审计 · 喂 K1", "done"]], reason: true, okLabel: "确认锁卡",
                      run: (reason) => { setParam(`D.bin.${i}`, "locked", { action: `手动锁卡 ${b.name}`, reason }); toast(`${b.name} 已锁 24h · 落审计`); },
                    })}>锁卡</button>
                  )}
                </div>
              ); })}
            </div>
            <div className="dtint" style={{ marginTop: 12 }}><b>说明</b> · 锁卡由服务器执行,页面只是观测和手动补锁;锁卡热力同步给反多账户引擎(K1)的支付工具维度。后台对账只看得到卡段和末四位,完整卡号从不经过平台(直送收单行)。</div>
          </div>
        </section>

        {/* chargeback */}
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">拒付处置</span>
            <span className="sub">· 已发生拒付的刷卡充值单 · 退款 = 追回已入账 + 从备付金扣回</span>
          </div>
          <div className="l-b">
            <div className="dtint" style={{ marginBottom: 12, display: "flex", gap: 18, flexWrap: "wrap" }}>
              <span><b>fee_buffer 今日流水</b></span>
              <span className="mono" style={{ color: "var(--success)" }}>+$3,225(今日 Card 入账 $92,140 × 3.5%)</span>
              <span className="mono" style={{ color: "var(--negative)" }}>−$29(TP-76870 拒付:费冲回 $4.2 + 拒付手续费 $25)</span>
              <span className="mono" style={{ color: "var(--ink-3)" }}>余额 ${D_FUND.feeBufferUsd.toLocaleString("en-US")}</span>
            </div>
            {CBS.map((c) => { const done = cbDone(c.id, c.st === "已退款追回"); return (
              <div className="cb-row" key={c.id}>
                <span className="mono" style={{ fontWeight: 600, color: "var(--ink)" }}>{c.id}</span>
                <span className="mono" style={{ fontSize: 12, color: "var(--ink-3)" }}>{c.user}</span>
                <span className="mono" style={{ fontWeight: 700 }}>{c.amt}</span>
                <span style={{ fontSize: 12, color: "var(--ink-4)", flex: 1 }}>{c.code}</span>
                {done ? <span className="bdg ok">已退款追回</span> : (
                  <>
                    <span className="bdg warn">待处置</span>
                    <button className="l-btn sm mc" onClick={() => openActionConfirm({
                      action: `拒付退款追回 · ${c.id}`,
                      detail: <><b>{c.user} · {c.amt}</b>(原因码 {c.code.split(" · ")[0]})。同一笔服务器事务原子完成三件事:追回已入账余额、从风控备付金扣回、核减该用户终身入金(防止拒付后还留着换新资格)。带防重号,操作确认。</>,
                      run: (reason) => { setParam(`D.chargeback.${c.id}`, "refunded", { action: `拒付退款追回 ${c.id}`, reason }); toast(`${c.id} 退款追回完成 · 终身入金已核减`); },
                    })}>退款追回</button>
                  </>
                )}
              </div>
            ); })}
            <div className="dtint warn" style={{ marginTop: 12 }}><b>退款的连带动作</b> · 追回入账、备付金扣回、该用户终身入金核减,三件事在同一笔服务器事务里原子完成(带防重号),不会出现「钱退了但换新资格还在」的半截账。</div>
          </div>
        </section>
      </div>

      <p className="f-foot"><b>入账的唯一真相源是服务器处理支付商回调 / 链上确认</b>——客户端的余额显示只是渲染,客户端推的账单一律视为伪造。每笔确认入账写一条账单(D4)并累计该用户终身入金(以旧换新门槛的依据);确认入账同时是资金池储备(D3)的流入来源,本页不另立储备账,只产生入账事件供 D3 聚合。<b>四类动作要操作确认</b>:渠道启停、主备支付商切换、拒付退款、对账差异核销;BIN 锁卡是即时止血,单人可锁但解锁要写原因。</p>
    </>
  );
}
