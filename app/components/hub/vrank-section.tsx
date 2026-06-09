"use client";

/**
 * 360 HUB · 等级卡(V 级 & 晋升进度)— C1·deepening。
 * 读:v3/v-rank(selfBuyUSD/directRefs/teamVolumeUSD/晋升进度)。升降级 = server 规则权威(client preview),手动调整在 F 域 MC。
 * CGM: CGM-C/F v-rank.* 。
 */
import Link from "next/link";
import { Trophy, ArrowUpRight } from "lucide-react";
import type { AdminUser } from "@/lib/mock/admin/users";
import { getUserVRank } from "@/lib/mock/admin/user-360";
import { fmtUsd } from "@/lib/format";
import { AutoGloss } from "@/app/components/kit/gloss";
import { HubCard, HubMetric } from "./hub-kit";

export function VRankSection({ user }: { user: AdminUser }) {
  const v = getUserVRank(user.id, user.vRank, user.depositedUsd, user.teamSize);
  return (
    <HubCard icon={<Trophy size={15} style={{ color: "var(--admin-domain-f)" }} />} title="等级卡 · V 级 & 晋升进度" tag="C1·deepening · v3/v-rank · 升级 server 权威">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <HubMetric label="当前 V 级" sub={`生命周期 ${user.lifecycle}`} value={v.vRank} accent="var(--admin-domain-f)" />
        <HubMetric label="自购累计" sub="selfBuyUSD" value={fmtUsd(v.selfBuyUsd)} />
        <HubMetric label="直推" sub="directRefs" value={`${v.directRefs}`} />
        <HubMetric label="团队业绩" sub="teamVolumeUSD" value={fmtUsd(v.teamVolumeUsd)} />
      </div>

      <p className="mt-3 mb-1 text-[11px]" style={{ color: "var(--v5-ink-3)" }}>晋升 {v.nextRank} 进度 · {v.progressPct}%</p>
      <div className="h-2 overflow-hidden rounded-full" style={{ background: "var(--v5-surface-2)" }}>
        <div style={{ width: `${v.progressPct}%`, height: "100%", background: "var(--admin-domain-f)" }} />
      </div>
      <p className="mt-1.5 text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}>差距:{v.missing.join(" · ")}</p>

      <p className="mt-2 text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}>
        <AutoGloss>V 级晋升由 server 规则判定(client 仅 preview,可能 100% 仍 reject)· 手动升降级 + 领导池权重调整在</AutoGloss>
        <Link href="/network/v-rank" prefetch={false} className="inline-flex items-center gap-0.5 hover:opacity-80" style={{ color: "var(--admin-domain-f)" }}> F V级<ArrowUpRight size={11} /></Link>
        <AutoGloss>· MC 双签。</AutoGloss>
      </p>
    </HubCard>
  );
}
