"use client";

/**
 * B3 转化漏斗 L1→L5(设计稿 Funnel 模式)— 横向条:阶段 bar(宽=占比)+ 人数 + 较昨日 + 较上级转化。
 * flex 填充卡片高度:bar 区垂直居中,底部"最大流失环节"洞察 + 下钻锚定(消除留白)。
 */
import Link from "next/link";
import type { FunnelStage } from "@/lib/mock/admin/command-center";
import { fmtNum, fmtPct } from "@/lib/format";
import { AutoGloss } from "@/app/components/kit/gloss";

const SWATCH = ["#A8DC2E", "#9EDC1D", "#8E93C9", "#9588DA", "#9B89E0"];
const TARGET: Record<string, number> = { first_buy: 30 }; // 软目标(对齐 KPI L2→L3 与 P3 焦点)

export function FunnelBars({ stages }: { stages: FunnelStage[] }) {
  const max = stages[0]?.count || 1;
  const first = stages[0]?.count || 1;
  const last = stages[stages.length - 1]?.count || 0;
  const e2e = (last / first) * 100;

  // 最大流失环节(最低"较上级转化")
  let worst = { from: "", to: "", cvr: 101 };
  for (let i = 1; i < stages.length; i++) {
    const cvr = Math.round((stages[i].count / stages[i - 1].count) * 100);
    if (cvr < worst.cvr) worst = { from: stages[i - 1].label, to: stages[i].label, cvr };
  }

  return (
    <div className="flex h-full flex-col rounded-[16px] p-5" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}>
      <div className="flex items-baseline gap-2.5">
        <span className="font-display text-[14.5px]" style={{ color: "var(--v5-ink)" }}><AutoGloss>转化漏斗 L1→L5</AutoGloss></span>
        <span className="hidden text-[12px] sm:inline" style={{ color: "var(--v5-ink-4)" }}>注册 → 绑卡 → 首购 → 复购 → 提现</span>
        <span className="ml-auto font-mono-tabular rounded-[7px] px-2 py-0.5 text-[11px]" style={{ background: "var(--v5-surface-3)", color: "var(--v5-ink-3)", border: "1px solid var(--v5-border)" }}>B3 · A4 派生</span>
      </div>
      <p className="font-mono-tabular mt-1 text-[12px]" style={{ color: "var(--v5-ink-4)" }}>
        端到端转化 <span style={{ color: "var(--v5-brand)", fontWeight: 500 }}>{fmtPct(e2e)}</span> · {fmtNum(first)} 注册 → {fmtNum(last)} 提现
      </p>

      {/* bar 区:垂直居中吸收余高 */}
      <div className="flex flex-1 flex-col justify-center gap-3 py-3">
        {stages.map((s, i) => {
          const cvr = i > 0 ? Math.round((s.count / stages[i - 1].count) * 100) : null;
          const d = s.count - s.prevCount;
          const up = d >= 0;
          const target = TARGET[s.key];
          const below = cvr != null && target != null && cvr < target;
          const w = Math.max((s.count / max) * 100, 16);
          return (
            <div key={s.key} className="flex items-center gap-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center rounded-[9px] px-3.5" style={{ height: 42, width: `${w}%`, minWidth: 104, background: SWATCH[i] ?? "var(--v5-brand)", color: "#0A0A0A" }}>
                  <span className="truncate text-[13.5px]" style={{ fontWeight: 600 }}>{s.label}</span>
                </div>
              </div>
              <div style={{ width: 116, flexShrink: 0 }}>
                <div className="font-mono-tabular text-[16px]" style={{ color: "var(--v5-ink)", fontWeight: 600 }}>{fmtNum(s.count)}</div>
                <div className="font-mono-tabular text-[11px]">
                  <span style={{ color: up ? "var(--v5-success)" : "var(--v5-danger)" }}>{up ? "+" : "−"}{Math.abs(d)}</span>
                  <span style={{ color: "var(--v5-ink-4)" }}> 较昨日</span>
                </div>
              </div>
              <div style={{ width: 96, flexShrink: 0, textAlign: "right" }}>
                {cvr != null ? (
                  <>
                    <div className="font-mono-tabular text-[14px]" style={{ color: below ? "var(--v5-warning)" : "var(--v5-ink)", fontWeight: 600 }}>{cvr}%</div>
                    <div className="text-[11px]" style={{ color: "var(--v5-ink-4)" }}>较上级{target != null ? ` · 目标 ${target}` : ""}</div>
                  </>
                ) : (
                  <div className="text-[11px]" style={{ color: "var(--v5-ink-4)" }}><AutoGloss>漏斗入口</AutoGloss></div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* 洞察 + 下钻(底部对齐,消除留白)*/}
      <div className="mt-auto flex items-center gap-2.5 rounded-[10px] px-3.5 py-2.5" style={{ background: "var(--v5-surface-2)", border: "1px solid var(--v5-border)" }}>
        <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: "var(--v5-warning)" }} />
        <span className="text-[12px]" style={{ color: "var(--v5-ink-3)" }}>
          <AutoGloss>最大流失 · </AutoGloss>{worst.from}→{worst.to} 仅 <span className="font-mono-tabular" style={{ color: "var(--v5-warning)", fontWeight: 600 }}>{worst.cvr}%</span> 转化
        </span>
        <Link href="/overview/funnel" prefetch={false} className="ml-auto shrink-0 text-[12.5px]" style={{ color: "var(--v5-brand)" }}><AutoGloss>下钻 cohort →</AutoGloss></Link>
      </div>
    </div>
  );
}
