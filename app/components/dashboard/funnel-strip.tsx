"use client";

/**
 * 转化漏斗(today)— 按 Claude Design 稿「Conversion Funnel (dark)」复刻:
 * 左 SVG 梯形漏斗(柠檬→紫渐变 + 颈部留存率标记)+ 右阶段列表(色块/大数/转化率/较昨日),
 * 行↔段 hover 联动高亮,顶边渐变 accent。卡片 chrome 用 V5 token,漏斗图形用设计稿精确 hex。
 */
import Link from "next/link";
import { useState } from "react";
import type { FunnelStage } from "@/lib/mock/admin/command-center";
import { fmtNum, fmtPct } from "@/lib/format";
import { AutoGloss } from "@/app/components/kit/gloss";

// 设计稿几何:cx=210,5 段 6 节点半宽,段高 62,间隙 14,viewBox 360×382
const CX = 210;
const SEG_H = 62;
const GAP = 14;
const TOP_Y = 8;
const VIEW_W = 360;
const VIEW_H = 382;
const NODE_HALF = [120, 79, 31.4, 18.8, 15.6, 10];
const SWATCH = ["#A8DC2E", "#9EDC1D", "#8E93C9", "#9588DA", "#9B89E0"];
// 颈部留存率标记位置(设计稿手工放置)
const NECK = [
  { x: 96, y: 80, ax: 104, ay: 76 },
  { x: 120, y: 156, ax: 128, ay: 152 },
  { x: 150, y: 232, ax: 158, ay: 228 },
  { x: 158, y: 308, ax: 166, ay: 304 },
];
const UP = "#29D27F";
const DOWN = "#DD6F5C";
const r2 = (n: number) => Math.round(n * 100) / 100;

export function FunnelStrip({ stages }: { stages: FunnelStage[] }) {
  const [focus, setFocus] = useState<number | null>(null);
  const first = stages[0]?.count || 1;
  const last = stages[stages.length - 1]?.count || 0;
  const e2e = (last / first) * 100;

  return (
    <div className="relative overflow-hidden rounded-[18px] p-6" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}>
      {/* 顶边渐变 accent */}
      <span
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: "linear-gradient(90deg,transparent,rgba(158,220,29,0.5),rgba(155,137,224,0.4),transparent)", opacity: 0.7 }}
        aria-hidden
      />

      {/* 头部 */}
      <div className="flex items-baseline justify-between gap-4">
        <div className="font-display flex items-baseline gap-2.5" style={{ color: "var(--v5-ink)", fontSize: 19, fontWeight: 550 }}>
          <AutoGloss>转化漏斗</AutoGloss> <span style={{ color: "var(--v5-ink-4)", fontWeight: 400 }}>·</span>
          <span style={{ color: "var(--v5-ink-3)", fontSize: 16, fontWeight: 450 }}>今日</span>
        </div>
        <Link href="/overview/funnel" prefetch={false} className="group inline-flex items-center gap-1.5 text-[13px] transition-colors hover:text-[var(--v5-ink)]" style={{ color: "var(--v5-ink-3)" }}>
          <AutoGloss>下钻 cohort</AutoGloss> <span className="transition-transform group-hover:translate-x-0.5" style={{ color: "var(--v5-brand)" }}>→</span>
        </Link>
      </div>

      {/* 摘要 */}
      <p className="font-mono-tabular mb-5 mt-1 text-[12.5px]" style={{ color: "var(--v5-ink-4)" }}>
        端到端转化 <span style={{ color: "var(--v5-brand)", fontWeight: 500 }}>{fmtPct(e2e)}</span> · {fmtNum(first)} 注册 → {fmtNum(last)} 提现
      </p>

      {/* 主体:漏斗 + 阶段列表 */}
      <div className="grid gap-7 [grid-template-columns:1fr] lg:[grid-template-columns:330px_1fr]" style={{ alignItems: "start" }}>
        {/* 漏斗 SVG */}
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="block h-auto w-full" style={{ overflow: "visible" }} role="img" aria-label="转化漏斗">
          <defs>
            <linearGradient id="adminFunnelGrad" x1="0" y1="0" x2="0" y2={VIEW_H} gradientUnits="userSpaceOnUse">
              <stop offset="0" stopColor="#A8DC2E" />
              <stop offset="0.42" stopColor="#9EDC1D" />
              <stop offset="0.72" stopColor="#7E8FC9" />
              <stop offset="1" stopColor="#9B89E0" />
            </linearGradient>
          </defs>
          {stages.map((s, i) => {
            const topY = TOP_Y + i * (SEG_H + GAP);
            const botY = topY + SEG_H;
            const th = NODE_HALF[i] ?? 12;
            const bh = NODE_HALF[i + 1] ?? 10;
            const d = `M${r2(CX - th)},${topY} L${r2(CX + th)},${topY} L${r2(CX + bh)},${botY} L${r2(CX - bh)},${botY} Z`;
            const dim = focus !== null && focus !== i;
            const active = focus === i;
            return (
              <path
                key={s.key}
                d={d}
                fill="url(#adminFunnelGrad)"
                style={{
                  opacity: dim ? 0.32 : 1,
                  filter: active ? "drop-shadow(0 0 14px rgba(158,220,29,0.4))" : "none",
                  transition: "opacity .2s ease, filter .2s ease",
                  cursor: "pointer",
                }}
                onMouseEnter={() => setFocus(i)}
                onMouseLeave={() => setFocus(null)}
              />
            );
          })}
          {/* 颈部留存率标记 */}
          {NECK.map((n, i) => {
            if (i + 1 >= stages.length) return null;
            const cvr = Math.round((stages[i + 1].count / stages[i].count) * 100);
            return (
              <g key={i}>
                <text x={n.x} y={n.y} textAnchor="end" className="font-mono-tabular" style={{ fill: "var(--v5-ink-4)", fontSize: 11 }}>{cvr}%</text>
                <path d={`M${n.ax},${n.ay} l5,0 m-2.5,-2.5 l2.5,2.5 l-2.5,2.5`} style={{ stroke: "var(--v5-ink-4)", strokeWidth: 1, fill: "none" }} />
              </g>
            );
          })}
        </svg>

        {/* 阶段列表 */}
        <div className="flex flex-col">
          {stages.map((s, i) => {
            const cvr = i > 0 ? Math.round((s.count / stages[i - 1].count) * 100) : null;
            const d = s.count - s.prevCount;
            const up = d >= 0;
            return (
              <div
                key={s.key}
                onMouseEnter={() => setFocus(i)}
                onMouseLeave={() => setFocus(null)}
                className="flex flex-col justify-center gap-1.5 rounded-[8px] px-1"
                style={{
                  height: 76,
                  borderBottom: i < stages.length - 1 ? "1px solid var(--v5-border)" : "none",
                  background: focus === i ? "rgba(255,255,255,0.025)" : "transparent",
                  transition: "background .18s ease",
                }}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex items-center gap-2.5" style={{ color: "var(--v5-ink)", fontSize: 16, fontWeight: 550 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: SWATCH[i] ?? "var(--v5-ink-4)", flexShrink: 0, display: "inline-block" }} />
                    {s.label}
                  </span>
                  <span className="font-mono-tabular" style={{ color: "var(--v5-ink)", fontSize: 27, fontWeight: 550, letterSpacing: "-0.02em", lineHeight: 1 }}>{fmtNum(s.count)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-[13px]" style={{ color: "var(--v5-ink-3)" }}>
                    {cvr != null ? (
                      <>较上级转化 <span style={{ color: "var(--v5-ink)", fontWeight: 500 }}>{cvr}%</span></>
                    ) : (
                      <AutoGloss>漏斗入口</AutoGloss>
                    )}
                  </span>
                  <span className="font-mono-tabular inline-flex items-baseline gap-1.5 text-[12.5px]">
                    <span style={{ color: up ? UP : DOWN, fontWeight: 500 }}>{up ? "+" : "−"}{Math.abs(d)}</span>
                    <span style={{ color: "var(--v5-ink-4)" }}>较昨日</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
