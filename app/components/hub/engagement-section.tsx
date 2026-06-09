"use client";

/**
 * 360 HUB · 互动卡(单用户任务/签到/抽奖/里程碑)— C1·deepening。
 * 读:quest/weekly-quest/lucky-spin/milestones/stella(per-user)。处置(补发奖励/重置/概率配置)跳 H 域 MC。
 * CGM: CGM-H quest/checkin/lucky-spin/milestone per-user 行。
 */
import Link from "next/link";
import { Gift, ArrowUpRight, CheckCircle2, Circle } from "lucide-react";
import type { AdminUser } from "@/lib/mock/admin/users";
import { getUserEngagement } from "@/lib/mock/admin/user-360";
import { AutoGloss } from "@/app/components/kit/gloss";
import { HubCard, HubMetric } from "./hub-kit";

export function EngagementSection({ user }: { user: AdminUser }) {
  const g = getUserEngagement(user.id, user.teamSize, user.depositedUsd);
  return (
    <HubCard icon={<Gift size={15} style={{ color: "var(--admin-domain-h)" }} />} title="互动卡 · 任务 / 签到 / 抽奖 / 里程碑" tag="C1·deepening · H 增长 · 处置在 H MC">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <HubMetric label="连续签到" sub="天" value={`${g.checkinStreak}`} accent="var(--admin-domain-h)" />
        <HubMetric label="进行任务" value={`${g.quests.filter((q) => !q.done).length}`} />
        <HubMetric label="抽奖剩余" value={`${g.luckySpinsLeft}`} />
        <HubMetric label="里程碑" sub="已达成" value={`${g.milestones.filter((m) => m.hit).length}/${g.milestones.length}`} />
      </div>

      <p className="mt-3 mb-1.5 text-[11px]" style={{ color: "var(--v5-ink-3)" }}>任务进度</p>
      <ul className="flex flex-col gap-1.5">
        {g.quests.map((q) => (
          <li key={q.id} className="rounded-[8px] px-2.5 py-1.5" style={{ background: "var(--v5-surface-2)" }}>
            <div className="flex items-center justify-between text-[11.5px]">
              <span style={{ color: "var(--v5-ink)" }}>{q.name}</span>
              <span className="font-mono-tabular" style={{ color: q.done ? "var(--v5-success)" : "var(--v5-ink-4)" }}>{q.done ? "已完成" : q.progressPct + "%"} · +{q.rewardNex} NEX</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--v5-surface-3, var(--v5-border))" }}>
              <div style={{ width: `${q.progressPct}%`, height: "100%", background: q.done ? "var(--v5-success)" : "var(--admin-domain-h)" }} />
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-3 mb-1.5 text-[11px]" style={{ color: "var(--v5-ink-3)" }}>里程碑</p>
      <div className="flex flex-wrap gap-1.5">
        {g.milestones.map((m) => (
          <span key={m.label} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px]"
            style={{ background: "var(--v5-surface-2)", color: m.hit ? "var(--v5-success)" : "var(--v5-ink-4)" }}>
            {m.hit ? <CheckCircle2 size={11} /> : <Circle size={11} />} {m.label}
          </span>
        ))}
      </div>

      <p className="mt-2.5 flex flex-wrap items-center gap-2 text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}>
        <Link href="/growth/quest" prefetch={false} className="inline-flex items-center gap-0.5 hover:opacity-80" style={{ color: "var(--admin-domain-h)" }}>H3 Quest<ArrowUpRight size={11} /></Link>
        <Link href="/growth/daily" prefetch={false} className="inline-flex items-center gap-0.5 hover:opacity-80" style={{ color: "var(--admin-domain-h)" }}>H5 签到<ArrowUpRight size={11} /></Link>
        <AutoGloss>补发奖励/重置进度/概率配置在 H 域 · MC 双签 · 概率 server-canonical。</AutoGloss>
      </p>
    </HubCard>
  );
}
