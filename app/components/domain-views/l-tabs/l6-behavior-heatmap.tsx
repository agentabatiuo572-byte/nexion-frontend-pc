"use client";

/**
 * L6 · 用户行为热力图 — 前端操作按页面/层级聚合的热力矩阵 + 单页点击坐标热力。
 * 形态:① 页面活跃热力矩阵(行=页面[按所选层级上卷],列=PV/UV·点击·停留·跳出,格色=强度);
 *      ② 点行下钻到单页 SVG 手机框坐标热力(看该页内用户点哪)。
 * 粒度可设:全部 / 一级 / 二级 / 三级(按 UX 层级上卷,即「统计到哪个层级的页面」)。
 * 只读报表域:无任何写业务规则动作;唯一写动作=聚合导出(confirm + logAudit)。
 */
import { useId, useMemo, useState } from "react";
import { AutoGloss } from "@/app/components/kit/gloss";
import { confirm } from "@/lib/store/ui";
import {
  aggregateByDepth,
  activityForWindow,
  clickHeatForRoute,
  normalizeL6BehaviorHeatmap,
  summarize,
  type DepthFilter,
  type HeatRow,
  type TimeWindow,
} from "./l6-live-data";
import { LDataState } from "./live-data";
import type { LCtx } from "./types";

const DEPTHS: { v: DepthFilter; lb: string }[] = [
  { v: "all", lb: "全部" },
  { v: "L1", lb: "一级" },
  { v: "L2", lb: "二级" },
  { v: "L3", lb: "三级" },
];
const DEPTH_HINT: Record<DepthFilter, string> = {
  all: "全部被追踪页逐页",
  L1: "上卷到一级入口页",
  L2: "上卷到二级板块页",
  L3: "仅三级叶子页(详情 / 指南)",
};
const WINDOWS: { v: TimeWindow; lb: string }[] = [
  { v: "24h", lb: "近 24 小时" },
  { v: "7d", lb: "近 7 天" },
  { v: "30d", lb: "近 30 天" },
];
type SortKey = "pv" | "clicks" | "dwellMs" | "bounceRate";
const SORTS: { v: SortKey; lb: string }[] = [
  { v: "pv", lb: "按 PV" },
  { v: "clicks", lb: "按点击" },
  { v: "dwellMs", lb: "按停留" },
  { v: "bounceRate", lb: "按跳出" },
];

const n = (x: number): string => x.toLocaleString("en-US");
const fmtDwell = (ms: number): string => {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s` : `${s}s`;
};
const fmtPct = (r: number): string => `${(r * 100).toFixed(1)}%`;

/** 活跃强度色阶(cyan 系,按本列最大值归一化):深=高频。暗字仅给最深档,保证 dark 下对比度。 */
function activityCell(v: number, max: number): React.CSSProperties {
  const t = max > 0 ? v / max : 0;
  const a = t >= 0.8 ? 72 : t >= 0.55 ? 48 : t >= 0.3 ? 26 : t >= 0.08 ? 12 : 4;
  return { background: `color-mix(in srgb, var(--cyan) ${a}%, transparent)`, color: a >= 60 ? "#0A0A0A" : "var(--ink-2)" };
}
/** 跳出率警示色阶(绝对阈值:>50% 红 · 35–50% 橙 · 低=淡橙):高=问题,不是「热」。 */
function bounceCell(rate: number): React.CSSProperties {
  const hot = rate >= 0.5 ? "var(--danger)" : "var(--warning)";
  const a = rate >= 0.5 ? 58 : rate >= 0.35 ? 40 : rate >= 0.22 ? 22 : 10;
  return { background: `color-mix(in srgb, ${hot} ${a}%, transparent)`, color: a >= 55 ? "#0A0A0A" : "var(--ink-2)" };
}

export function L6HeaderActions({ ctx }: { ctx: LCtx }) {
  const exportHeat = async () => {
    const ok = await confirm({
      title: "导出行为热力序列 CSV",
      message:
        "内容:当前粒度与时间窗下每页(或上卷节点)的 PV/UV/点击/平均停留/跳出率,以及单页点击区分布。全部为聚合计数,不含手机号、设备号等明文。仍需操作确认。",
      confirmLabel: "导出",
    });
    if (!ok) return;
    ctx.logAudit({
      actor: "总管理员",
      action: "导出用户行为热力序列 CSV(聚合 · 无 PII)",
      target: "admin.report_exported",
      after: "export_type=behavior_heatmap",
    });
    ctx.toast("已导出行为热力序列 CSV");
  };
  return (
    <>
      <span className="f-ro">
        <span className="d" />
        只读报表域 · 不改任何业务规则
      </span>
      <button className="f-cta" onClick={exportHeat}>
        导出行为热力序列
      </button>
    </>
  );
}

export function L6BehaviorHeatmap({ ctx }: { ctx: LCtx }) {
  const [depth, setDepth] = useState<DepthFilter>("all");
  const [win, setWin] = useState<TimeWindow>("7d");
  const [sort, setSort] = useState<SortKey>("pv");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");
  const [sel, setSel] = useState<string | null>(null);
  const gradId = "l6heat-" + useId().replace(/:/g, "");
  const heatmapData = useMemo(() => normalizeL6BehaviorHeatmap(ctx.biData?.l6), [ctx.biData?.l6]);

  const stats = useMemo(() => activityForWindow(heatmapData, win), [heatmapData, win]);
  const summary = useMemo(() => summarize(stats), [stats]);
  const rows = useMemo<HeatRow[]>(() => {
    const r = aggregateByDepth(heatmapData.pageTree, stats, depth);
    const dir = sortDir === "desc" ? 1 : -1;
    return [...r].sort((a, b) => (b[sort] - a[sort]) * dir);
  }, [heatmapData.pageTree, stats, depth, sort, sortDir]);

  // 每列最大值(按当前行集归一化)
  const maxPv = Math.max(1, ...rows.map((r) => r.pv));
  const maxClicks = Math.max(1, ...rows.map((r) => r.clicks));
  const maxDwell = Math.max(1, ...rows.map((r) => r.dwellMs));

  // 下钻:默认选最热行,可点切换
  const activeKey = sel ?? rows[0]?.key ?? null;
  const activeRow = rows.find((r) => r.key === activeKey) ?? null;
  const heat = useMemo(() => (activeKey ? clickHeatForRoute(heatmapData, activeKey) : null), [activeKey, heatmapData]);

  const depthLb = DEPTHS.find((d) => d.v === depth)?.lb ?? "全部";

  if (!heatmapData.pageTree.length) {
    return <LDataState ctx={ctx} label="L6" />;
  }

  const selectRow = (key: string) => {
    setSel(key);
    // 让下钻卡进入视野(已在视野则不滚动)
    requestAnimationFrame(() => document.getElementById("l6-drill")?.scrollIntoView({ behavior: "smooth", block: "nearest" }));
  };

  return (
    <div>
      {/* stat strip */}
      <div className="f-stats">
        <div className="f-stat cyan">
          <div className="k">总页面浏览 PV</div>
          <div className="v">{n(summary.totalPv)}</div>
          <div className="sub">{WINDOWS.find((w) => w.v === win)?.lb} · 全部被追踪页</div>
        </div>
        <div className="f-stat">
          <div className="k">总点击 / 点按</div>
          <div className="v">{n(summary.totalClicks)}</div>
          <div className="sub">界面内 tap / click 事件合计</div>
        </div>
        <div className="f-stat">
          <div className="k">平均停留</div>
          <div className="v">{fmtDwell(summary.avgDwellMs)}</div>
          <div className="sub">按 PV 加权 · 单页会话内停留</div>
        </div>
        <div className="f-stat warn">
          <div className="k">平均跳出率</div>
          <div className="v">{fmtPct(summary.avgBounceRate)}</div>
          <div className="sub">进入即离开占比 · 越高越需关注</div>
        </div>
      </div>

      {/* view-bar:粒度 + 时间窗 + 排序 */}
      <div className="view-bar">
        <div className="chips">
          <span className="lb">页面粒度</span>
          {DEPTHS.map((d) => (
            <button
              key={d.v}
              className={"chip" + (depth === d.v ? " sel" : "")}
              onClick={() => {
                setDepth(d.v);
                setSel(null);
                ctx.toast(`统计粒度:${d.lb} · ${DEPTH_HINT[d.v]} · 仅视图`);
              }}
            >
              {d.lb}
            </button>
          ))}
        </div>
        <div className="sep" />
        <div className="chips">
          <span className="lb">时间窗</span>
          {WINDOWS.map((w) => (
            <button
              key={w.v}
              className={"chip" + (win === w.v ? " sel" : "")}
              onClick={() => {
                setWin(w.v);
                setSel(null);
                ctx.toast(`时间窗:${w.lb} · 仅视图,实时生效`);
              }}
            >
              {w.lb}
            </button>
          ))}
        </div>
        <div className="sep" />
        <div className="chips">
          <span className="lb">排序</span>
          {SORTS.map((s) => (
            <button
              key={s.v}
              className={"chip" + (sort === s.v ? " sel" : "")}
              title={sort === s.v ? "再次点击切换升/降序" : undefined}
              onClick={() => {
                if (sort === s.v) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
                else { setSort(s.v); setSortDir("desc"); }
              }}
            >
              {s.lb}
              {sort === s.v ? (sortDir === "desc" ? " ↓" : " ↑") : ""}
            </button>
          ))}
        </div>
      </div>

      {/* (a) 页面活跃热力矩阵 */}
      <section className="l-card">
        <div className="l-h">
          <span className="ttl">页面活跃热力矩阵</span>
          <span className="sub">
            · <AutoGloss>{`行=页面(${depthLb}粒度)· 列=操作维度 · 格色越深=该维度越活跃 · 点行看单页点击分布`}</AutoGloss>
          </span>
          <div className="r">
            <div className="ret-legend" title="活跃维度(PV/点击/停留)按本列最大值归一化">
              <span>活跃低</span>
              {[4, 12, 26, 48, 72].map((a) => (
                <i key={a} style={{ background: `color-mix(in srgb, var(--cyan) ${a}%, transparent)` }} />
              ))}
              <span>高</span>
            </div>
            <div className="bounce-legend" title="跳出率按绝对阈值(>50% 红线)">
              <span>跳出</span>
              <i style={{ background: "color-mix(in srgb, var(--warning) 22%, transparent)" }} />
              <i style={{ background: "color-mix(in srgb, var(--warning) 40%, transparent)" }} />
              <i style={{ background: "color-mix(in srgb, var(--danger) 58%, transparent)" }} />
              <span>&gt;50%</span>
            </div>
          </div>
        </div>
        <div className="l-b">
          <div style={{ overflowX: "auto" }}>
            <table className="l-tbl heat-tbl" style={{ minWidth: 720 }}>
              <thead>
                <tr>
                  <th>页面</th>
                  <th style={{ textAlign: "center" }}>PV / UV</th>
                  <th style={{ textAlign: "center" }}>点击</th>
                  <th style={{ textAlign: "center" }}>平均停留</th>
                  <th style={{ textAlign: "center" }}>跳出率</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.key}
                    className={"heat-row" + (r.key === activeKey ? " sel" : "")}
                    onClick={() => selectRow(r.key)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectRow(r.key); } }}
                  >
                    <td>
                      <div className="pg-nm">
                        {r.titleZh}
                        <span className="lc">L{r.level}</span>
                        {r.pageCount > 1 && <span className="bdg dim">聚合 {r.pageCount} 页</span>}
                        <span className="pg-go" aria-hidden>›</span>
                      </div>
                      <div className="pg-route">{r.key.replace(/^pages\//, "")}</div>
                    </td>
                    <td className="cellv" style={activityCell(r.pv, maxPv)} title={`UV ${n(r.uv)}`}>
                      {n(r.pv)}
                      <span className="cu">UV {n(r.uv)}</span>
                    </td>
                    <td className="cellv" style={activityCell(r.clicks, maxClicks)}>
                      {n(r.clicks)}
                    </td>
                    <td className="cellv" style={activityCell(r.dwellMs, maxDwell)}>
                      {fmtDwell(r.dwellMs)}
                    </td>
                    <td className="cellv" style={bounceCell(r.bounceRate)}>
                      {fmtPct(r.bounceRate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ltint" style={{ marginTop: 12, fontSize: 12 }}>
            <b>读法</b> ·{" "}
            <AutoGloss>
              {`横看一页四维强弱(高 PV + 低停留 + 高跳出 = 流量大但留不住);纵看同维度跨页对比找最热/最冷入口。跳出率用橙→红绝对阈值(>50% 红线),其余维度按当前行集相对归一化。`}
            </AutoGloss>
          </div>
        </div>
      </section>

      {/* (b) 单页点击坐标热力(下钻) */}
      {heat && activeRow && (
        <section className="l-card" id="l6-drill">
          <div className="l-h">
            <span className="ttl">单页点击热力 · {activeRow.titleZh}</span>
            <span className="sub">
              ·{" "}
              <AutoGloss>
                {activeRow.pageCount > 1
                  ? `聚合行(含 ${activeRow.pageCount} 页)· 坐标热力按单页统计`
                  : `在手机界面线框上叠加点击密度热区 · 看用户在该页具体点哪`}
              </AutoGloss>
            </span>
          </div>
          {activeRow.pageCount > 1 ? (
            <div className="l-b">
              <div className="ltint warn" style={{ fontSize: 12.5 }}>
                <b>聚合行不提供单页坐标热力</b> ·{" "}
                <AutoGloss>{`「${activeRow.titleZh}」聚合了 ${activeRow.pageCount} 个页面,点击坐标按单页统计、跨异构页面叠加无意义。切到「全部」粒度并点击具体页,查看该页的点击热区。`}</AutoGloss>
              </div>
            </div>
          ) : (
          <div className="heat-drill">
            <div className="phone-pane">
              <PhoneHeatFrame gradId={gradId} points={heat.points} zones={heat.zones} />
            </div>
            <div className="zone-pane">
              <div className="zone-h">点击区域占比</div>
              {[...heat.zones]
                .sort((a, b) => b.share - a.share)
                .map((z, i) => (
                  <div key={z.label} className="zone-row">
                    <span className="zsw" style={{ opacity: 0.25 + z.share }} />
                    <span className="znm">{z.label}</span>
                    <span className="ztrack">
                      <i style={{ width: `${Math.round(z.share * 100)}%` }} />
                    </span>
                    <span className="zpct">{Math.round(z.share * 100)}%</span>
                    {i === 0 && <span className="bdg cyan">最热</span>}
                  </div>
                ))}
              <div className="ltint cyan" style={{ marginTop: 12, fontSize: 12 }}>
                <b>提示</b> · <AutoGloss>点击坐标按页面线框分区聚合,接真后台后替换为真实坐标采样;深色热区=用户实际点按密度高。</AutoGloss>
              </div>
            </div>
          </div>
          )}
        </section>
      )}

      {/* 覆盖面 + 排除声明(不静默截断) */}
      <p className="f-foot">
        <b>统计覆盖</b> ·{" "}
        <AutoGloss>{`共追踪 ${heatmapData.trackedCount} / ${heatmapData.totalPages} 个前端页面;`}</AutoGloss>
        <b>不纳入统计的系统页({heatmapData.excludedPages.length})</b>:
        <AutoGloss>{heatmapData.excludedPages.map((p) => p.titleZh).join(" · ")}（纯会话/工具页,无行为分析价值）。</AutoGloss>{" "}
        <b>L6 没有任何「写数据」动作</b>:
        <AutoGloss>粒度 / 时间窗 / 排序均为会话级视图参数,不改任何业务规则。</AutoGloss>
      </p>
    </div>
  );
}

/* ── 手机界面线框 + 点击热区(纯 SVG,颜色全 token) ── */
function PhoneHeatFrame({
  gradId,
  points,
  zones,
}: {
  gradId: string;
  points: { x: number; y: number; weight: number }[];
  zones: { label: string; cx: number; cy: number; share: number }[];
}) {
  const W = 200;
  const H = 400;
  const PAD = 12; // 屏幕内边距
  const sx = (x: number) => PAD + x * (W - PAD * 2);
  const sy = (y: number) => PAD + y * (H - PAD * 2);
  return (
    <svg className="phone-frame" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="单页点击坐标热力">
      <defs>
        <radialGradient id={gradId}>
          <stop offset="0%" stopColor="var(--cyan)" stopOpacity="0.9" />
          <stop offset="60%" stopColor="var(--cyan)" stopOpacity="0.35" />
          <stop offset="100%" stopColor="var(--cyan)" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* 设备屏幕底 */}
      <rect x={6} y={6} width={W - 12} height={H - 12} rx={20} fill="var(--surface-2)" stroke="var(--border)" />
      {/* 顶部状态条 + 底部导航条(界面线框示意) */}
      <rect x={PAD} y={PAD} width={W - PAD * 2} height={26} rx={7} fill="var(--surface-3)" />
      <rect x={PAD} y={H - PAD - 30} width={W - PAD * 2} height={30} rx={7} fill="var(--surface-3)" />
      {/* 内容卡线框 */}
      <rect x={PAD} y={56} width={W - PAD * 2} height={70} rx={9} fill="var(--surface)" />
      <rect x={PAD} y={136} width={W - PAD * 2} height={110} rx={9} fill="var(--surface)" />
      {/* 热区 blob(底层,柔和) */}
      {zones.map((z) => (
        <circle key={z.label} cx={sx(z.cx)} cy={sy(z.cy)} r={18 + z.share * 60} fill={`url(#${gradId})`} opacity={0.18 + z.share * 0.5} />
      ))}
      {/* 点击点(上层,按 weight) */}
      {points.map((p, i) => (
        <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={8 + p.weight * 16} fill={`url(#${gradId})`} opacity={0.25 + p.weight * 0.55} />
      ))}
    </svg>
  );
}
