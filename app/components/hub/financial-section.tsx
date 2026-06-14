"use client";

/**
 * 360 HUB · 财务持仓卡(单用户 staking/Genesis/兑换)— C1·deepening。
 * 读:v3/staking + genesis + exchange(per-user)。处置(强制赎回/冻结/分红调整)跳 G 域 操作确认。
 * CGM: CGM-G staking/genesis/exchange per-user 持仓行。
 */
import Link from "next/link";
import { Landmark, ArrowUpRight } from "lucide-react";
import type { AdminUser } from "@/lib/mock/admin/users";
import { getUserFinancial, type StakeStatus } from "@/lib/mock/admin/user-360";
import { fmtUsd } from "@/lib/format";
import { StatusPill, type PillTone } from "@/app/components/kit/status-pill";
import { AutoGloss } from "@/app/components/kit/gloss";
import { HubCard, HubMetric } from "./hub-kit";

const ST_TONE: Record<StakeStatus, PillTone> = { locked: "warning", matured: "success", "early-exit": "danger" };
const ST_LABEL: Record<StakeStatus, string> = { locked: "锁定中", matured: "已到期", "early-exit": "提前赎回" };

export function FinancialSection({ user }: { user: AdminUser }) {
  const vNum = parseInt(user.vRank.replace(/\D/g, ""), 10) || 0;
  const f = getUserFinancial(user.id, vNum, user.balanceUsd);
  const empty = f.staking.length === 0 && f.genesis.length === 0 && f.exchange.length === 0;
  return (
    <HubCard icon={<Landmark size={15} style={{ color: "var(--admin-domain-g)" }} />} title="财务持仓卡 · staking / Genesis / 兑换" tag="C1·deepening · v3 financial · 处置在 G 操作确认">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <HubMetric label="质押本金" sub="NEX" value={f.stakedNexTotal.toLocaleString()} accent="var(--admin-domain-g)" />
        <HubMetric label="质押仓位" value={`${f.staking.length}`} />
        <HubMetric label="Genesis 节点" value={`${f.genesis.length}`} />
        <HubMetric label="节点日分红" value={fmtUsd(f.genesisDailyTotal)} accent="var(--v5-success)" />
      </div>

      {empty ? (
        <p className="mt-3 rounded-[8px] p-3 text-center text-[12px]" style={{ background: "var(--v5-surface-2)", color: "var(--v5-ink-4)" }}>该用户无金融持仓。</p>
      ) : (
        <div className="mt-3 flex flex-col gap-2.5">
          {f.staking.length > 0 && (
            <div className="overflow-hidden rounded-[8px]" style={{ border: "1px solid var(--v5-border)" }}>
              <table className="w-full border-collapse text-[11.5px]">
                <thead><tr style={{ background: "var(--v5-surface-2)" }}>{["质押池", "本金 NEX", "APY", "解锁", "状态"].map((h, i) => <th key={h} className="px-2.5 py-1.5 font-normal" style={{ color: "var(--v5-ink-4)", textAlign: i === 1 ? "right" : "left" }}><AutoGloss>{h}</AutoGloss></th>)}</tr></thead>
                <tbody>{f.staking.map((s) => (
                  <tr key={s.id} style={{ borderTop: "1px solid var(--v5-border)" }}>
                    <td className="px-2.5 py-1.5" style={{ color: "var(--v5-ink)" }}>{s.pool}</td>
                    <td className="font-mono-tabular px-2.5 py-1.5 text-right" style={{ color: "var(--v5-ink)" }}>{s.principalNex.toLocaleString()}</td>
                    <td className="font-mono-tabular px-2.5 py-1.5" style={{ color: "var(--v5-ink-3)" }}>{s.apy}%</td>
                    <td className="font-mono-tabular px-2.5 py-1.5" style={{ color: "var(--v5-ink-4)" }}>{s.unlockAt}</td>
                    <td className="px-2.5 py-1.5"><StatusPill label={ST_LABEL[s.status]} tone={ST_TONE[s.status]} size="sm" dot={false} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {f.genesis.length > 0 && (
            <ul className="flex flex-col gap-1">
              {f.genesis.map((g) => (
                <li key={g.id} className="flex items-center justify-between rounded-[8px] px-2.5 py-1.5 text-[11.5px]" style={{ background: "var(--v5-surface-2)" }}>
                  <span style={{ color: "var(--v5-ink-3)" }}>Genesis {g.nodeNo} · 购于 {g.boughtAt} · {g.status}</span>
                  <span className="font-mono-tabular" style={{ color: "var(--v5-success)" }}>{fmtUsd(g.dailyDivUsd)}/日</span>
                </li>
              ))}
            </ul>
          )}
          {f.exchange.length > 0 && (
            <ul className="flex flex-col gap-1">
              {f.exchange.map((x) => (
                <li key={x.id} className="flex items-center justify-between rounded-[8px] px-2.5 py-1.5 text-[11px]" style={{ background: "var(--v5-surface-2)" }}>
                  <span style={{ color: "var(--v5-ink-4)" }}>{x.tsLabel} · {x.pair}</span>
                  <span className="font-mono-tabular" style={{ color: "var(--v5-ink-3)" }}>{x.amountNex.toLocaleString()} NEX @ {x.rate}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="mt-2 flex flex-wrap items-center gap-2 text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}>
        <Link href="/finance-products/staking" prefetch={false} className="inline-flex items-center gap-0.5 hover:opacity-80" style={{ color: "var(--admin-domain-g)" }}>G1 Staking<ArrowUpRight size={11} /></Link>
        <Link href="/finance-products/genesis" prefetch={false} className="inline-flex items-center gap-0.5 hover:opacity-80" style={{ color: "var(--admin-domain-g)" }}>G4 Genesis<ArrowUpRight size={11} /></Link>
        <AutoGloss>强制赎回/冻结/分红调整在 G 域 · 操作确认。</AutoGloss>
      </p>
    </HubCard>
  );
}
