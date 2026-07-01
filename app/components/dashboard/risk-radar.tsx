"use client";

/**
 * B5 风险雷达(设计稿 RiskRadar 模式)— 挤兑比率 + 异常账户 + Kill 状态灯 + 实时告警。
 * 取代旧 AlertCenter:在告警列表之上补足 B5 的态势指标。只读,跳转到对应域处置。
 */
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { AlertItem, AlertLevel } from "@/lib/mock/admin/command-center";
import { AutoGloss } from "@/app/components/kit/gloss";

const LEVEL_COLOR: Record<AlertLevel, string> = {
  high: "var(--v5-danger)",
  mid: "var(--v5-warning)",
  low: "var(--v5-ink-4)",
};

export interface KillGate {
  key: string;
  on: boolean; // true = 正常(闸关闭),false = 已触发熔断(闸打开)
}

export function RiskRadar({
  alerts,
  bankRunRatio,
  flaggedAccounts,
  killGates,
}: {
  alerts: AlertItem[];
  bankRunRatio: number;
  flaggedAccounts: number;
  killGates: KillGate[];
}) {
  const highCount = alerts.filter((a) => a.level === "high").length;
  const killOpen = killGates.filter((k) => !k.on).length;

  return (
    <div className="flex h-full flex-col rounded-[16px] p-5" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}>
      <div className="flex items-center gap-2.5">
        <span className="font-display text-[14.5px]" style={{ color: "var(--v5-ink)" }}><AutoGloss>风险雷达</AutoGloss></span>
        <span className="ml-auto font-mono-tabular rounded-[7px] px-2 py-0.5 text-[11px]" style={{ background: "var(--v5-surface-3)", color: "var(--v5-ink-3)", border: "1px solid var(--v5-border)" }}>B5 · 只读</span>
      </div>
      <p className="mt-1 text-[12px]" style={{ color: "var(--v5-ink-4)" }}><AutoGloss>挤兑预警 · 异常账户 · Kill 状态灯</AutoGloss></p>

      {/* 两项态势指标 */}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <div className="rounded-[10px] p-3" style={{ background: "var(--v5-surface-2)", border: "1px solid var(--v5-border)" }}>
          <p className="text-[11px]" style={{ color: "var(--v5-ink-3)" }}><AutoGloss>挤兑比率(待提现/储备)</AutoGloss></p>
          <p className="font-mono-tabular mt-0.5" style={{ fontSize: 21, fontWeight: 600, color: bankRunRatio >= 10 ? "var(--v5-warning)" : "var(--v5-ink)" }}>{bankRunRatio.toFixed(1)}%</p>
        </div>
        <div className="rounded-[10px] p-3" style={{ background: "var(--v5-warning-soft)", border: "1px solid color-mix(in srgb, var(--v5-warning) 40%, transparent)" }}>
          <p className="text-[11px]" style={{ color: "var(--v5-ink-3)" }}>异常账户(K 域标记)</p>
          <p className="font-mono-tabular mt-0.5" style={{ fontSize: 21, fontWeight: 600, color: "var(--v5-warning)" }}>{flaggedAccounts}</p>
        </div>
      </div>

      {/* Kill 状态灯 */}
      <p className="mt-3.5 text-[12px]" style={{ color: "var(--v5-ink-2)", fontWeight: 600 }}><AutoGloss>Kill-Switch 状态灯 · </AutoGloss>{killOpen}/{killGates.length} 开</p>
      <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4">
        {killGates.map((k) => (
          <div key={k.key} className="flex items-center gap-1.5 rounded-[8px] px-2 py-1.5" style={{ border: "1px solid var(--v5-border)", background: k.on ? "var(--v5-surface-2)" : "var(--v5-danger-soft)" }}>
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: k.on ? "var(--v5-success)" : "var(--v5-danger)" }} />
            <span className="font-mono-tabular truncate text-[10.5px]" style={{ color: "var(--v5-ink-3)" }}>{k.key}</span>
          </div>
        ))}
      </div>

      {/* 实时告警(原 AlertCenter 列表) */}
      <div className="mt-3.5 flex items-center justify-between">
        <span className="text-[12px]" style={{ color: "var(--v5-ink-2)", fontWeight: 600 }}>实时告警</span>
        {highCount > 0 && (
          <span className="font-mono-tabular rounded-full px-2 py-0.5 text-[11px]" style={{ background: "color-mix(in srgb, var(--v5-danger) 16%, transparent)", color: "var(--v5-danger)" }}>{highCount} 高危</span>
        )}
      </div>
      <ul className="mt-1.5 flex flex-col gap-0.5">
        {alerts.map((a) => (
          <li key={a.id}>
            <Link href={a.href} prefetch={false} className="flex items-start gap-2.5 rounded-[9px] p-2 transition-colors hover:bg-[var(--v5-surface-2)]">
              <span className="mt-1 inline-block shrink-0 rounded-full" style={{ width: 7, height: 7, background: LEVEL_COLOR[a.level] }} />
              <span className="flex-1 text-[12px]" style={{ color: "var(--v5-ink-2)" }}><AutoGloss>{a.text}</AutoGloss></span>
              <ChevronRight size={14} style={{ color: "var(--v5-ink-4)", marginTop: 1 }} aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <Link href="/emergency/kill-switch" prefetch={false} className="mt-auto inline-flex pt-3 text-[12.5px]" style={{ color: "var(--v5-brand)" }}>前往 J 紧急合规 →</Link>
    </div>
  );
}
