"use client";

/**
 * J3 · 篡改防御监控 — 纯只读可观测面(server 是防御本体)。
 * 趋势(24h/7d/30d)+ 10 类路径堆积 + 高频篡改账户告警;处置不在本页 —— 表内动作仅跨域真 Link
 * 到 C2(/users/actions 冻结)与 K1(/risk/multi-account 簇建档)。
 * 本页唯一写动作 = 告警阈值配置(操作确认 · J.tamper.alertConfig);导出报表为脱敏只读(无 操作确认,toast 占位)。
 */
import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { CodeTag } from "../design-kit";
import { AutoGloss } from "@/app/components/kit/gloss";
import { TAMPER_TREND, TAMPER_PATHS, TAMPER_ACCTS, TAMPER_ALERT_CONFIG } from "./data";
import type { JCtx } from "./types";

const W = 720;
const H = 200;

/** J3 页头 CTA(挂 DomainHeader 右槽):导出报表(无 操作确认)+ 告警阈值配置(操作确认)。 */
export function J3HeaderActions({ ctx }: { ctx: JCtx }) {
  const { pget, setParam, toast, openActionConfirm } = ctx;
  const cur = pget("J.tamper.alertConfig") ?? `${TAMPER_ALERT_CONFIG.threshold} · K4=${TAMPER_ALERT_CONFIG.feedK4 ? "on" : "off"}`;
  const alertConfig = () => openActionConfirm({
    action: "配置篡改告警阈值 / 喂 K4 开关",
    detail: <><b>账户级篡改告警频次阈值</b> · 当前 <b className="mono">{cur}</b>(范围 1–100 次/24h)· 超此频次单账户判为异常篡改告警。<b>篡改告警喂 K4 风险评分</b>:作弊信号作为风险评分输入。监控敏感度变更影响风控信号 · 风控 操作员 · 执行门槛:风控 lead / 超管  · 携 Idempotency-Key · A2 留痕。</>,
    edit: { kind: "text", current: cur },
    run: (reason, newValue) => {
      setParam("J.tamper.alertConfig", newValue ?? cur, { action: `配置篡改告警阈值 ${cur}→${newValue}`, reason });
      toast("告警阈值配置已确认生效");
    },
  });
  return (
    <>
      <button className="f-cta neutral" onClick={() => toast("导出篡改监控报表(CSV · 脱敏)· 写 admin 审计(导出范围 / operator)")}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></svg>
        导出报表
      </button>
      <button className="f-cta" onClick={alertConfig}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /><circle cx="12" cy="12" r="4" /></svg>
        告警阈值配置
      </button>
    </>
  );
}

export function J3Tamper() {
  const [win, setWin] = useState<"24h" | "7d" | "30d">("24h");
  const d = TAMPER_TREND[win];
  const gradId = useId(); // SVG gradient id 实例唯一(防多实例/StrictMode 下 DOM id 冲突,同 risk-radar 先例)

  const { linePath, areaPath, peak, peakX, peakY } = useMemo(() => {
    const pts = d.pts;
    const stepX = W / (pts.length - 1);
    let line = "";
    let area = "";
    const pk = Math.max(...pts);
    let px = 0;
    let py = 0;
    pts.forEach((p, i) => {
      const x = i * stepX;
      const y = H - (p / d.max) * H;
      line += (i === 0 ? "M" : "L") + x + "," + y;
      area += i === 0 ? `M${x},${H} L${x},${y}` : `L${x},${y}`;
      if (p === pk) { px = x; py = y; }
    });
    area += ` L${(pts.length - 1) * stepX},${H} Z`;
    return { linePath: line, areaPath: area, peak: pk, peakX: px, peakY: py };
  }, [d]);

  const totalPath = TAMPER_PATHS.reduce((s, p) => s + p.ct, 0);
  const total7d = TAMPER_TREND["7d"].pts.reduce((s, p) => s + p, 0);

  return (
    <div>
      {/* stat strip */}
      <div className="f-stats">
        <div className="f-stat danger"><div className="k">今日拦截</div><div className="v">{totalPath}</div><div className="sub">比昨天 +12%</div></div>
        <div className="f-stat warn"><div className="k">高频作弊账户</div><div className="v">{TAMPER_ACCTS.length}</div><div className="sub">≥5 起 · 已计入风险评分</div></div>
        <div className="f-stat cyan"><div className="k">近 7 天拦截</div><div className="v">{total7d.toLocaleString("en-US")}</div><div className="sub">日均 {Math.round(total7d / 7)} 起</div></div>
        <div className="f-stat ok"><div className="k">资金损失</div><div className="v">$0</div><div className="sub">服务器拦截 · 实际损失 0</div></div>
      </div>

      {/* 只读 banner */}
      <div className="ro-banner">
        <span className="ic"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg></span>
        <div><b>这是只看不改的监控页</b> · <AutoGloss>本页不做处置 · 发现某账户高频作弊,</AutoGloss><b>实际的冻结 / 建档</b><AutoGloss>要到</AutoGloss> <b>账户处置页(C2)</b> <AutoGloss>或</AutoGloss> <b>风控批量页(K1)</b> <AutoGloss>去做 · 表里的按钮只是</AutoGloss><b>跳转</b><AutoGloss>过去,本页不会改变账户状态。</AutoGloss></div>
      </div>

      {/* K4 / B5 喂送 strip */}
      <div className="feed-strip">
        <div className="it"><span className="led" /><AutoGloss>作弊信号送给</AutoGloss> <b>风险评分</b> · <span style={{ color: "var(--ink-3)" }}>{TAMPER_ACCTS.length} 账户 · 高频加分</span></div>
        <span className="sep">·</span>
        <div className="it"><span className="led" /><AutoGloss>状态灯喂</AutoGloss> <b>B5 风险雷达</b> · <span style={{ color: "var(--ink-3)" }}>异常账户维度</span></div>
        <span className="sep">·</span>
        <div className="it"><span className="led warn" /><b>数据报表</b> · <span style={{ color: "var(--ink-3)" }}>作弊趋势报表(后续开放)</span></div>
        <span className="sep" style={{ marginLeft: "auto" }}>·</span>
        <div className="it"><span style={{ color: "var(--ink-4)", fontSize: 11.5 }}>数据来源 · </span><b>服务器拦截事件流</b></div>
      </div>

      {/* 趋势 */}
      <section className="trend-card">
        <div className="trend-h">
          <span className="ttl">篡改拦截趋势</span>
          <span className="sub">· <AutoGloss>都是被服务器成功拦下的尝试 · 越多说明防御越活跃</AutoGloss></span>
          <div className="r"><div className="seg">
            {(["24h", "7d", "30d"] as const).map((w) => (
              <button key={w} className={win === w ? "on" : ""} onClick={() => setWin(w)}>{w}</button>
            ))}
          </div></div>
        </div>
        <div className="trend-chart">
          <div className="trend-y">
            <span>{d.max}</span><span>{Math.round(d.max * 0.75)}</span><span>{Math.round(d.max * 0.5)}</span><span>{Math.round(d.max * 0.25)}</span><span>0</span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--danger)" stopOpacity="0.6" />
                <stop offset="100%" stopColor="var(--danger)" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0, 50, 100, 150, 200].map((y) => <line key={y} x1="0" y1={y} x2={W} y2={y} className="trend-grid-line" />)}
            <path className="trend-area" fill={`url(#${gradId})`} d={areaPath} />
            <path className="trend-line" d={linePath} />
          </svg>
          {/* 峰值标记 HTML overlay(防 preserveAspectRatio=none 变形) */}
          <div className="trend-overlay">
            <div className="trend-marker" style={{ left: `${(peakX / W) * 100}%`, top: `${(peakY / H) * 100}%` }}>
              <div className="mdot" />
              <div className="mlabel">↑ {peak}</div>
            </div>
          </div>
          <div className="trend-x">{d.labels.map((l) => <span key={l}>{l}</span>)}</div>
        </div>
      </section>

      {/* 路径分布 */}
      <section className="path-card">
        <div className="path-h">
          <span className="ttl">篡改路径分布 · 按攻击面合并</span>
          <span className="sub">· 按作弊手法分类统计</span>
          <div className="r">24h 总计 <b style={{ color: "var(--danger)" }}>{totalPath}</b> 起</div>
        </div>
        <div className="path-stack">
          {TAMPER_PATHS.map((p) => {
            const segPct = (p.ct / totalPath) * 100;
            return (
              <div key={p.id} className="pseg" style={{ width: `${segPct}%`, background: p.color }} title={`${p.nm} · ${p.ct} 起`}>
                {segPct >= 6 ? p.nm : ""}
              </div>
            );
          })}
        </div>
        <div className="path-list">
          {TAMPER_PATHS.map((p) => (
            <div className="path-it" key={p.id}>
              <span className="psw" style={{ background: p.color }} />
              <div className="nm"><AutoGloss>{p.nm}</AutoGloss><div className="desc"><AutoGloss>{p.desc}</AutoGloss></div></div>
              <div className="cnt">{p.ct}</div>
              <div className="acct">{p.acct} 账户</div>
            </div>
          ))}
        </div>
      </section>

      {/* 高频篡改账户告警 */}
      <section className="accts-card">
        <div className="accts-h">
          <span className="ttl">高频篡改账户告警 · ≥ 5 起 / 24h</span>
          <span className="sub">· <AutoGloss>信号已计入风险评分 · 处置到账户页/风控页</AutoGloss></span>
          <div className="r"><CodeTag tone="electric">A2 审计</CodeTag><CodeTag>服务器拦截事件流</CodeTag></div>
        </div>
        <div className="accts-tblwrap"><div className="accts-tbl">
          <div className="hd">
            <div className="c">用户 uid</div><div className="c">24h 起数</div><div className="c">K4 提分</div><div className="c">命中路径</div>
            <div className="c">最近拦截</div><div className="c">簇 ID</div>
            <div className="c" style={{ justifyContent: "flex-end" }}>动作(跨域)</div>
          </div>
          {TAMPER_ACCTS.map((a) => {
            const k4Cls = a.cnt >= 15 ? "high" : a.cnt >= 8 ? "mid" : "low";
            return (
              <div className="rw" key={a.uid}>
                <div className="c uid">{a.uid}</div>
                <div className="c cnt">{a.cnt}</div>
                <div className="c"><span className={"badge-k4 " + k4Cls}>{a.k4}</span></div>
                <div className="c"><div className="paths">{a.paths.map((p) => <span key={p} className="p">{p}</span>)}</div></div>
                <div className="c last">{a.last}</div>
                <div className="c">{a.cluster ? <span className="badge-cluster" title="K1 批量簇">{a.cluster}</span> : <span style={{ color: "var(--ink-4)", fontFamily: "var(--mono)", fontSize: 11 }}>—</span>}</div>
                <div className="c acts">
                  {a.cluster ? (
                    <Link className="k1" href="/risk/multi-account" title={`${a.cluster} · 簇处置在 K1 完成 操作确认`}>→ K1 簇查看</Link>
                  ) : (
                    <a className="off" aria-disabled>→ K1 簇查看</a>
                  )}
                  <Link className="c2" href="/users/actions" title={`${a.uid} · 冻结/解冻在 C2 完成 操作确认`}>→ C2 冻结</Link>
                </div>
              </div>
            );
          })}
        </div></div>
      </section>

      <p className="f-foot"><b>所有数值以服务器为准,客户端改了也没用</b>:<AutoGloss>本页看到的都是用户想改数据、但被服务器</AutoGloss><b>当场驳回</b><AutoGloss>的尝试(资金实际损失为 0)。高频作弊账户会</AutoGloss><b>计入风险评分</b><AutoGloss>并同步给风险雷达。本页</AutoGloss><b>只看不改</b>,<AutoGloss>实际冻结 / 建档要到账户处置页或风控批量页去做。</AutoGloss></p>
    </div>
  );
}
