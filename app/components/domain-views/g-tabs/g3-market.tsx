"use client";

import { currentAdminOperator } from "@/lib/admin/current-operator";
/**
 * G3 NEX 行情引擎 — 数据来自后端 /api/admin/market/nex/curve 与 /curve/history。
 * 页面只展示后端返回的 NEX 行情与控制状态。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  advanceG3CurrentFrame,
  fetchG3MarketHistory,
  fetchG3MarketOverview,
  updateG3Control,
  updateG3CurveFrame,
  updateG3Override,
  type G3CurveField,
  type G3HistoryPoint,
  type G3Overview,
  type G3OverrideKey,
} from "@/lib/admin/g3-client";
import type { GCtx } from "./types";

const OPERATOR = currentAdminOperator;
const CURVE_FIELDS: G3CurveField[] = ["targetPrice", "pumpProbability", "volatilityPct"];
const CURVE_LABELS: Record<G3CurveField, { name: string; unit: string }> = {
  targetPrice: { name: "目标价", unit: "$" },
  pumpProbability: { name: "上行概率", unit: "0-1" },
  volatilityPct: { name: "波动", unit: "+/-%" },
};
const CURVE_LOOSEN_DIR: Partial<Record<G3CurveField, "up">> = {
  targetPrice: "up",
  pumpProbability: "up",
};

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function fmtCompact(value: number, max = 6) {
  return value.toLocaleString("en-US", { maximumFractionDigits: max });
}

function fmtPrice(value: number) {
  return `$${fmtCompact(value, 8)}`;
}

function fmtPct(value: number) {
  return `${fmtCompact(value, 4)}%`;
}

function rawValue(value: number) {
  return Number.isFinite(value) ? String(value) : "";
}

function frameValue(frame: G3Overview["frames"][number], field: G3CurveField) {
  if (field === "targetPrice") return frame.targetPrice;
  if (field === "pumpProbability") return frame.pumpProbability;
  return frame.volatilityPct;
}

function fmtCurveVal(field: G3CurveField, value: number) {
  if (field === "targetPrice") return fmtPrice(value);
  if (field === "volatilityPct") return `+/-${fmtCompact(value, 4)}%`;
  return fmtCompact(value, 6);
}

function controlValue(overview: G3Overview, key: string) {
  return overview.controls.find((control) => control.key === key)?.value || "—";
}

function changePct(points: number[]) {
  const first = points[0] || 0;
  const last = points[points.length - 1] || 0;
  if (first <= 0) return 0;
  return ((last - first) / first) * 100;
}

export function G3Market({ ctx }: { ctx: GCtx }) {
  const { toast, openActionConfirm } = ctx;
  const [overview, setOverview] = useState<G3Overview | null>(null);
  const [history, setHistory] = useState<G3HistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const reload = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const [nextOverview, nextHistory] = await Promise.all([
        fetchG3MarketOverview(),
        fetchG3MarketHistory(),
      ]);
      setOverview(nextOverview);
      setHistory(nextHistory.points);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [nextOverview, nextHistory] = await Promise.all([
          fetchG3MarketOverview(),
          fetchG3MarketHistory(),
        ]);
        if (!cancelled) {
          setOverview(nextOverview);
          setHistory(nextHistory.points);
        }
      } catch (err) {
        if (!cancelled) setError(messageOf(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const mutate = useCallback(async (key: string, action: () => Promise<G3Overview>, success: string) => {
    setBusyKey(key);
    setError("");
    try {
      const next = await action();
      const nextHistory = await fetchG3MarketHistory();
      setOverview(next);
      setHistory(nextHistory.points);
      toast(success);
    } catch (err) {
      const message = messageOf(err);
      setError(message);
      toast(`G3 操作失败 · ${message}`);
    } finally {
      setBusyKey(null);
    }
  }, [toast]);

  const chartPrices = useMemo(() => {
    const values = history.map((point) => point.price).filter((value) => value > 0);
    return values.length >= 2 ? values : [];
  }, [history]);

  if (loading && !overview) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">G3 NEX 行情引擎</span><span className="sub">· 正在读取真实接口数据</span></div>
        <div className="l-b"><div className="gtint">G3 数据加载中...</div></div>
      </section>
    );
  }

  if (!overview) {
    return (
      <section className="l-card">
        <div className="l-h"><span className="ttl">G3 NEX 行情引擎</span><span className="sub">· 真实接口数据</span></div>
        <div className="l-b">
          <div className="gtint">G3 数据加载失败 · {error || "UNKNOWN_ERROR"}</div>
          <button className="l-btn mc" style={{ marginTop: 12 }} onClick={() => void reload()}>重新加载</button>
        </div>
      </section>
    );
  }

  const busy = !!busyKey;
  const paused = overview.overrides.paused;
  const curDay = overview.activeDayIndex + 1;
  const peak = overview.weekPeakPrice;
  const cov = overview.coverage.coverageRatio.toFixed(1);
  const redline = overview.coverage.redlinePct.toFixed(1);
  const price = fmtPrice(overview.currentPrice);
  const volatility = `+/-${fmtCompact(overview.overrides.volatilityPct, 4)}%`;
  const oracle = overview.overrides.oracle;
  const deviation = fmtPct(overview.overrides.deviationPct);
  const costBasis = fmtPrice(overview.overrides.costBasis);
  const scheduleControl = overview.controls.find((control) => control.key === "schedule");
  const schedV = controlValue(overview, "schedule");
  const scheduleMeta = scheduleControl?.cronExpression
    ? `${scheduleControl.cronExpression} · ${scheduleControl.zone || "—"}`
    : "—";
  const pinV = controlValue(overview, "pin");
  const loopV = controlValue(overview, "loop");
  const ctlVals: Record<string, string> = { schedule: schedV, pin: pinV, loop: loopV };
  const ctlOptions: Record<string, string[]> = {
    pin: ["未钉住", ...overview.frames.map((_, index) => `D${index + 1}`)],
    loop: ["循环", "停在末值"],
  };

  const openCurveCellMc = (dayIndex: number, field: G3CurveField) => {
    const frame = overview.frames[dayIndex];
    if (!frame) return;
    const label = CURVE_LABELS[field];
    const current = frameValue(frame, field);
    const amp = !!CURVE_LOOSEN_DIR[field];
    const isCurrentDay = dayIndex === overview.activeDayIndex;
    openActionConfirm({
      action: `周曲线关键帧 · D${dayIndex + 1} · ${label.name}`,
      detail: <>
        <b>D{dayIndex + 1} {label.name}</b> · 当前 {fmtCurveVal(field, current)}({label.unit})。
        {amp
          ? <><b>属放大流出</b>:确认放行时以<b>周峰值价 {fmtPrice(peak)}</b> 重估全部 NEX 计价负债后验备付金红线(当前 {cov}%,红线 {redline}%),低于红线拒(422)。server 收到新值后按实际方向二次精算。</>
          : "做市波动不直接放大流出。"}
        {isCurrentDay && field === "targetPrice" && <> 改当日帧会同步写入全站现价单源,约 60 秒内全网生效。</>}
        运营执行门槛:财务主管 / 超管。
      </>,
      amplifies: amp,
      edit: { kind: "text", current: rawValue(current) },
      run: (reason, value) => {
        if (!value) return;
        void mutate(
          `curve-${dayIndex}-${field}`,
          () => updateG3CurveFrame(overview, dayIndex, field, value, reason, OPERATOR()),
          `D${dayIndex + 1} ${label.name} 已更新为 ${value}${isCurrentDay ? " · 当日生效" : " · 待推进到该日生效"}`,
        );
      },
    });
  };

  const openCurveCtlMc = (key: string, name: string, current: string) => {
    const isSchedule = key === "schedule";
    const editCurrent = isSchedule ? (scheduleControl?.rawValue || current) : current;
    openActionConfirm({
      action: `行情排程控制 · ${name}`,
      detail: <><b>{name}</b> · 当前:{current}。{isSchedule ? <>请输入 <span className="mono">每日 HH:mm [ZoneId] 自动推进</span>,例如 <span className="mono">每日 08:30 Asia/Shanghai 自动推进</span>;后端会解析为动态 cron,当前有效值 {scheduleMeta}。</> : <>排程按 server 时间表推进当日生效帧;钉住 / 暂停推进不影响已配置的曲线本身。</>} 改排程产 <span className="mono">market.curve_advanced</span> / <span className="mono">market.schedule_changed</span> 审计。运营执行门槛:财务主管 / 超管。</>,
      amplifies: false,
      edit: ctlOptions[key] ? { kind: "select", current, options: ctlOptions[key] } : { kind: "text", current: editCurrent },
      run: (reason, value) => {
        if (value == null) return;
        void mutate(
          `control-${key}`,
          () => updateG3Control(key, value, reason, OPERATOR()),
          `${name} 已更新为 ${value}`,
        );
      },
    });
  };

  const adj = (overrideKey: G3OverrideKey, label: string, current: string, note: string, amp?: boolean) => {
    openActionConfirm({
      action: `手动 override · ${label}`,
      detail: <><b>{label}</b> · 当前 {current} · {note}。{amp && <><b>属放大流出</b>:确认放行时以周峰值价 {fmtPrice(peak)} 重估全部 NEX 计价负债后验备付金红线(当前 {cov}%,红线 {redline}%,422)。</>}手动直写 = 临时压过自动排程,下次排程推进会以曲线值覆盖。</>,
      amplifies: !!amp,
      edit: { kind: "text", current },
      run: (reason, value) => {
        if (!value) return;
        void mutate(
          `override-${overrideKey}`,
          () => updateG3Override(overrideKey, value, reason, OPERATOR()),
          `${label} 已更新为 ${value}`,
        );
      },
    });
  };

  const pauseEngine = () => openActionConfirm({
    action: paused ? "恢复行情引擎" : "暂停行情引擎",
    detail: paused
      ? <>恢复后现价继续按曲线排程推进。恢复 = 价格继续上行预期,确认放行时核验 B1 覆盖率(当前 {cov}%,红线 {redline}%)。行情不在 J1 五闸内,作独立 pause 通知 J1 编排面联动。</>
      : <>暂停后现价冻结在最后值、曲线自动推进暂停,全站 NEX 价格停止更新。风控/合规执行门槛:超管。行情不在 J1 五闸内,作独立 pause 通知 J1 编排面联动。</>,
    amplifies: paused,
    run: (reason) => {
      void mutate(
        "override-paused",
        () => updateG3Override("paused", String(!paused), reason, OPERATOR()),
        `行情引擎已${paused ? "恢复" : "暂停"} · 通知 J1 编排`,
      );
    },
  });

  const advanceFrame = () => openActionConfirm({
    action: "手动推进行情生效日",
    detail: <>将当前生效日从 D{curDay} 推进到 {curDay >= 7 ? "D1" : `D${curDay + 1}`}，由后端写入当前帧与全站现价单源，并产生日推进审计。自动排程仍按当前配置继续执行。</>,
    amplifies: false,
    run: (reason) => {
      void mutate(
        "advance-frame",
        () => advanceG3CurrentFrame(reason, OPERATOR()),
        "行情生效日已手动推进 · 已同步现价单源",
      );
    },
  });

  const W = 760;
  const H = 180;
  const P = 30;
  const chart = chartPrices;
  const hasChart = chart.length >= 2;
  const minPrice = (hasChart ? Math.min(...chart, overview.currentPrice) : overview.currentPrice) * 0.98;
  const maxPrice = (hasChart ? Math.max(...chart, peak, overview.currentPrice) : Math.max(peak, overview.currentPrice)) * 1.02;
  const spread = Math.max(0.000001, maxPrice - minPrice);
  const X = (index: number) => P + (index / Math.max(1, chart.length - 1)) * (W - 2 * P);
  const Y = (value: number) => H - 22 - ((value - minPrice) / spread) * (H - 40);
  const path = hasChart ? chart.map((value, index) => `${index ? "L" : "M"}${X(index).toFixed(1)} ${Y(value).toFixed(1)}`).join(" ") : "";
  const peakY = Y(peak);
  const change = hasChart ? changePct(chart) : null;

  return (
    <>
      {error && <div className="gtint" style={{ marginBottom: 12 }}>G3 操作提示 · {error}</div>}
      <div className="f-stats">
        <div className="f-stat ok"><div className="k">NEX 现价</div><div className="v">{price}</div><div className="sub">{change == null ? "24h 历史未返回" : `24h ${change >= 0 ? "+" : ""}${change.toFixed(2)}%`} · 当日帧 D{curDay} 派发</div></div>
        <div className="f-stat cyan"><div className="k">排程进度</div><div className="v">D{curDay} / 7</div><div className="sub">{schedV} · 周峰值 {fmtPrice(peak)}</div></div>
        <div className="f-stat"><div className="k">喂价源</div><div className="v">{oracle}</div><div className="sub">健康 · 偏离告警阈值 {deviation}</div></div>
        <div className="f-stat warn"><div className="k">引擎状态</div><div className="v" style={{ color: paused ? "var(--danger)" : "var(--success)" }}>{paused ? "已暂停" : "运行中"}</div><div className="sub">暂停即冻结现价 + 停推进</div></div>
      </div>

      <section className="l-card">
        <div className="l-h">
          <span className="ttl">周曲线关键帧(7 天 × 3 项 · 逐值权威)</span>
          <span className="sub">· 点任意单元格改值(操作确认)· 当前生效日高亮 · 黄色 = 与昨日不同 · ★ 周峰值</span>
          <div className="r">
            <span className="bdg ok">自动按日推进 · 可调时间</span>
            <button className="l-btn sm mc" disabled={busy} onClick={advanceFrame}>手动推进一日</button>
          </div>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="dial-tbl" style={{ minWidth: 680 }}>
            <thead>
              <tr>
                <th>生效日</th>
                {CURVE_FIELDS.map((field) => (
                  <th key={field}>{CURVE_LABELS[field].name}<br /><span style={{ fontWeight: 400, fontSize: 10 }}>({CURVE_LABELS[field].unit})</span></th>
                ))}
              </tr>
            </thead>
            <tbody>
              {overview.frames.map((frame, dayIndex) => {
                const isCur = dayIndex === overview.activeDayIndex;
                return (
                  <tr key={frame.dayIndex} className={isCur ? "cur" : undefined}>
                    <td>D{dayIndex + 1}{isCur && " · 当前"}</td>
                    {CURVE_FIELDS.map((field) => {
                      const current = frameValue(frame, field);
                      const previous = dayIndex > 0 ? frameValue(overview.frames[dayIndex - 1], field) : current;
                      const changed = dayIndex > 0 && previous !== current;
                      const isPeak = field === "targetPrice" && Math.abs(current - peak) < 0.0000001;
                      return (
                        <td key={field} className={isPeak ? "peak" : changed ? "chg" : undefined} onClick={() => openCurveCellMc(dayIndex, field)} title="点击改值(操作确认)">
                          {fmtCurveVal(field, current)}{isPeak && " ★"}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="l-b" style={{ paddingTop: 10 }}>
          <div className="ttl" style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>排程控制</div>
          {overview.controls.map((control) => (
            <div className="p-row" key={control.key}>
              <div className="txt"><div className="k">{control.name}</div><div className="s">{control.description}</div></div>
              <span className="v">{ctlVals[control.key] || control.value}</span>
              <button className="l-btn sm mc" disabled={busy} onClick={() => openCurveCtlMc(control.key, control.name, ctlVals[control.key] || control.value)}>调整</button>
            </div>
          ))}
          <div className="gtint" style={{ marginTop: 10 }}><b>自动生效怎么工作</b> · 排程开后,server 动态定时任务按 <span className="mono">{schedV}</span> 把当日 <b>目标价</b> 写进全站现价单源 <span className="mono">wallet.exchange.nex_usdt_price</span>(G2 兑换 / G7 复投即时跟随),并产 <span className="mono">market.curve_advanced</span> 审计;当前有效 cron: <span className="mono">{scheduleMeta}</span>。钉住(pin)= 演示 / 应急时把生效日冻在某天,自动推进暂停。改 <b>目标价 / 上行概率</b> 是放大流出,提交即以周峰值价过 B1 红线。</div>
        </div>
      </section>

      <div className="two-col r13" style={{ marginBottom: 16 }}>
        <section className="l-card">
          <div className="l-h">
            <span className="ttl">行情走势</span>
            <span className="sub">· 近 24h · 周峰值 {fmtPrice(peak)}</span>
            <div className="r"><button className="l-btn mc" disabled={busy} onClick={pauseEngine}>{paused ? "恢复引擎(操作确认)" : "暂停引擎(操作确认)"}</button></div>
          </div>
          <div className="l-b">
            <div className="price-hero"><span className="big">{price}</span><span className="chg">{change == null ? "历史未返回" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}</span>{paused && <span className="bdg bad">已冻结</span>}</div>
            {hasChart ? (
              <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: 180, display: "block" }}>
                <line x1={P} y1={peakY} x2={W - P} y2={peakY} stroke="var(--ink-4)" strokeWidth={1} strokeDasharray="4 4" />
                <text x={W - P} y={peakY - 5} fontSize={10.5} fill="var(--ink-4)" textAnchor="end" fontFamily="var(--mono)">{`PEAK ${fmtPrice(peak)}`}</text>
                <path d={`${path} L${X(chart.length - 1)} ${H - 22} L${X(0)} ${H - 22} Z`} fill="var(--admin-domain-g)" opacity={0.08} />
                <path d={path} fill="none" stroke="var(--admin-domain-g)" strokeWidth={2} />
                <circle cx={X(chart.length - 1)} cy={Y(chart[chart.length - 1])} r={3.5} fill="var(--bg)" stroke="var(--admin-domain-g)" strokeWidth={2} />
              </svg>
            ) : (
              <div className="gtint" style={{ marginTop: 16 }}>近 24h 历史价格点未返回,不生成前端走势线。</div>
            )}
          </div>
        </section>

        <section className="l-card">
          <div className="l-h">
            <span className="ttl">手动 override 层</span>
            <span className="sub">· 应急直写 · 下次排程推进以曲线值覆盖</span>
          </div>
          <div className="l-b" style={{ paddingTop: 4 }}>
            <div className="p-row"><div className="txt"><div className="k">现价直写(应急)</div><div className="s">绕过曲线临时压价,过红线</div></div><span className="v">{price}</span><button className="l-btn sm mc" disabled={busy} onClick={() => adj("currentPrice", "现价直写", rawValue(overview.currentPrice), "临时压过自动排程 · 过红线", true)}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">做市波动幅度</div><div className="s">单 tick 的最大波动(曲线未覆盖时兜底)</div></div><span className="v">{volatility}</span><button className="l-btn sm mc" disabled={busy} onClick={() => adj("volatilityPct", "做市波动幅度", rawValue(overview.overrides.volatilityPct), "范围 0-20%")}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">喂价源</div><div className="s">内部做市源 / 外部喂价源 · 外部源 1 tick/4s 同频</div></div><span className="v">{oracle}</span><button className="l-btn sm mc" disabled={busy} onClick={() => openActionConfirm({
              action: "切换喂价源",
              detail: <>内部做市源 / 外部喂价源切换。基础设施操作,RBAC 细分前由超管代理执行门槛:超管。</>,
              edit: { kind: "select", current: oracle, options: ["内部做市", "外部喂价"] },
              run: (reason, value) => {
                if (!value) return;
                void mutate(
                  "override-oracle",
                  () => updateG3Override("oracle", value, reason, OPERATOR()),
                  `喂价源已切换为 ${value}`,
                );
              },
            })}>切换源</button></div>
            <div className="p-row"><div className="txt"><div className="k">偏离告警阈值</div><div className="s">现价与喂价源偏离超此即告警</div></div><span className="v">{deviation}</span><button className="l-btn sm mc" disabled={busy} onClick={() => adj("deviationPct", "偏离告警阈值", rawValue(overview.overrides.deviationPct), "范围 0-50%")}>调整</button></div>
            <div className="p-row"><div className="txt"><div className="k">成本基准锚(costBasis day-0)</div><div className="s">用户端 PnL 卡的基准价(<span className="mono">pnl = nexBalance × nexPrice - nexBalance × costBasis</span>)· 只展示锚,不参与曲线</div></div><span className="v">{costBasis}</span><button className="l-btn sm mc" disabled={busy} onClick={() => adj("costBasis", "成本基准锚调整", rawValue(overview.overrides.costBasis), "仅作 PnL 基准展示,不影响曲线或兑换报价")}>调整</button></div>
          </div>
        </section>
      </div>

      <p className="f-foot"><b>价格 100% 服务端驱动</b>:运营配的是一周关键帧曲线,server 动态定时任务按配置时间推进当日生效帧、把目标价写进现价单源;客户端价格线来自真实接口历史点。NEX 现价是<b>兑换(G2)报价和复投(G7)定价的单一源</b>,下游取服务端现价、不接客户端价;现价变动即时影响备付金里 NEX 计价负债的折算。改<b>目标价 / 上行概率</b>是放大流出,红线核验以<b>周峰值价</b>重估全部 NEX 计价应付负债后再判。引擎暂停 = 冻结现价 + 停自动推进,是紧急开关矩阵(J1)的生效面。</p>
    </>
  );
}
