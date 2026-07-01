"use client";

/**
 * 360 HUB · 邀请卡(单用户分销网络)— C1·deepening。补「邀请人数后台无处可查」缺口。
 * 读:v3/sponsorship + v3/network(directRefs/团队/V下线分布/spillover/上级)。处置(网络/佣金)跳 F 域。
 * CGM: CGM-F directRefs/vDownlineCounts/spillover/sponsor。
 */
import Link from "next/link";
import { Users, ArrowUpRight } from "lucide-react";
import type { AdminUser } from "@/lib/mock/admin/users";
import { getUserReferral } from "@/lib/mock/admin/user-360";
import { fmtUsd } from "@/lib/format";
import { AutoGloss } from "@/app/components/kit/gloss";
import { HubCard, HubMetric } from "./hub-kit";

export function ReferralSection({ user }: { user: AdminUser }) {
  const r = getUserReferral(user.id, user.teamSize);
  return (
    <HubCard icon={<Users size={15} style={{ color: "var(--admin-domain-f)" }} />} title="邀请卡 · 单用户分销网络" tag="C1·deepening · F 网络 · 补「邀请人数」缺口">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <HubMetric label="直推人数" sub="L1 directRefs" value={`${r.directRefs}`} accent="var(--admin-domain-f)" />
        <HubMetric label="团队规模" sub="全网下线" value={`${r.teamSize}`} />
        <HubMetric label="spillover" sub="系统溢出安置" value={`${r.spilloverCount}`} />
        <HubMetric label="上级 sponsor" value={r.sponsor ? r.sponsor.name : "—"} />
      </div>

      <p className="mt-3 mb-1.5 text-[11px]" style={{ color: "var(--v5-ink-3)" }}><AutoGloss>下线 V 级分布</AutoGloss></p>
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(r.vDist).map(([v, n]) => (
          <span key={v} className="font-mono-tabular rounded-full px-2 py-0.5 text-[10.5px]" style={{ background: "var(--v5-surface-2)", color: "var(--v5-ink-3)" }}>{v} · {n}</span>
        ))}
      </div>

      <p className="mt-3 mb-1.5 text-[11px]" style={{ color: "var(--v5-ink-3)" }}><AutoGloss>直推列表(L1)</AutoGloss></p>
      {r.directList.length === 0 ? (
        <p className="text-[11.5px]" style={{ color: "var(--v5-ink-4)" }}>无直推。</p>
      ) : (
        <div className="overflow-hidden rounded-[8px]" style={{ border: "1px solid var(--v5-border)" }}>
          <div className="max-h-[200px] overflow-y-auto">
            <table className="w-full border-collapse text-[11.5px]">
              <thead>
                <tr style={{ background: "var(--v5-surface-2)" }}>
                  {["用户", "V级", "加入", "月业绩", "来源"].map((h, i) => (
                    <th key={h} className="px-2.5 py-1.5 font-normal" style={{ color: "var(--v5-ink-4)", textAlign: i === 3 ? "right" : "left" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.directList.map((d) => (
                  <tr key={d.id} style={{ borderTop: "1px solid var(--v5-border)" }}>
                    <td className="px-2.5 py-1.5"><span style={{ color: "var(--v5-ink)" }}>{d.name}</span> <span className="font-mono-tabular text-[10px]" style={{ color: "var(--v5-ink-4)" }}>{d.id}</span></td>
                    <td className="font-mono-tabular px-2.5 py-1.5" style={{ color: "var(--v5-ink-3)" }}>{d.vRank}</td>
                    <td className="font-mono-tabular px-2.5 py-1.5" style={{ color: "var(--v5-ink-4)" }}>{d.joinedAt}</td>
                    <td className="font-mono-tabular px-2.5 py-1.5 text-right" style={{ color: "var(--v5-ink)" }}>{fmtUsd(d.monthVolUsd)}</td>
                    <td className="px-2.5 py-1.5" style={{ color: "var(--v5-ink-4)" }}>{d.spillover ? "溢出" : "直邀"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-2 text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}>
        <AutoGloss>推荐关系/佣金归属/spillover 调整在</AutoGloss>
        <Link href="/network/v-rank" prefetch={false} className="inline-flex items-center gap-0.5 hover:opacity-80" style={{ color: "var(--admin-domain-f)" }}> <AutoGloss>F 分销与团队</AutoGloss><ArrowUpRight size={11} /></Link>
        <AutoGloss>· 反多账户联动 K1 · sponsor 首次绑定不可改。</AutoGloss>
      </p>
    </HubCard>
  );
}
