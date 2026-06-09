"use client";

/**
 * 360 HUB · 收益台账(单用户详细收益 CRUD)— C1·deepening。
 * 真交互层:补发/调整/红冲 经 confirm(MC 双签 + 发起人不可自审)后**真实 append 到 useUserOps.ledgerExtra** → 逐笔表新增一行 + 累计收益随之变化 + 写审计流。
 * append-only(红冲不真删,负向分录)。真后台:POST /api/admin/users/{id}/ledger(Idempotency-Key,大额加签)。
 * CGM: CGM-D earnings.* / commission events。
 */
import { useMemo } from "react";
import Link from "next/link";
import { TrendingUp, ArrowUpRight, ShieldAlert } from "lucide-react";
import type { AdminUser } from "@/lib/mock/admin/users";
import { getUserEarnings, type CommissionStatus, type LedgerRow } from "@/lib/mock/admin/user-360";
import { useUserOps, useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { fmtUsd } from "@/lib/format";
import { confirm, toast } from "@/lib/store/ui";
import { StatusPill, type PillTone } from "@/app/components/kit/status-pill";
import { AutoGloss } from "@/app/components/kit/gloss";
import { HubCard, HubMetric, HubActBtn } from "./hub-kit";

const CS_TONE: Record<CommissionStatus, PillTone> = { cooling: "warning", unlocked: "success", withdrawn: "neutral" };
const CS_LABEL: Record<CommissionStatus, string> = { cooling: "冷却中", unlocked: "已解锁", withdrawn: "已提现" };
const ADJ: Record<"补发" | "调整" | "红冲", { delta: number; memo: string }> = {
  补发: { delta: 50, memo: "运营补发漏结收益" },
  调整: { delta: 12, memo: "对账差异修正" },
  红冲: { delta: -50, memo: "红冲误结分录" },
};

export function EarningsSection({ user }: { user: AdminUser }) {
  const e = useMemo(() => getUserEarnings(user.id, user.depositedUsd * 0.6 + user.withdrawnUsd + user.balanceUsd * 0.2), [user.id, user.depositedUsd, user.withdrawnUsd, user.balanceUsd]);
  const hydrated = useOpsHydrated();
  const storeLedger = useUserOps((s) => s.users[user.id]?.ledgerExtra);
  const storeBal = useUserOps((s) => s.users[user.id]?.balanceAdjustUsd);
  const earningAppend = useUserOps((s) => s.earningAppend);
  const ledgerExtra = hydrated ? (storeLedger ?? []) : [];
  const balanceAdjust = hydrated ? (storeBal ?? 0) : 0;

  async function adj(kind: "补发" | "调整" | "红冲", danger?: boolean) {
    const label = kind === "补发" ? "补发收益" : kind === "调整" ? "调整分录" : "红冲";
    const { delta, memo } = ADJ[kind];
    const ok = await confirm({
      title: label + "?",
      message: `${label} ${delta >= 0 ? "+" : ""}${fmtUsd(delta)} · ${memo} · 台账 append-only(红冲不真删)· MC 双签 + 发起人不可自审 + 大额加签 · server 原子记账。`,
      confirmLabel: "确认" + label,
      danger,
    });
    if (ok) {
      earningAppend(user.id, kind, delta, memo);
      toast.success(label + " 已入账", `${user.id} · ${delta >= 0 ? "+" : ""}${fmtUsd(delta)}`);
    }
  }

  const sources: [string, number][] = [["设备", e.bySource.device], ["佣金", e.bySource.commission], ["质押", e.bySource.staking], ["Genesis", e.bySource.genesis]];
  const ledger: LedgerRow[] = [...ledgerExtra, ...e.ledger];
  const totalUsd = e.totalUsd + balanceAdjust;

  return (
    <HubCard icon={<TrendingUp size={15} style={{ color: "var(--admin-domain-d)" }} />} title="收益台账 · 单用户详细收益 CRUD" tag="C1·deepening · 真写 append-only · MC 双签">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <HubMetric label="今日收益" sub={`+${e.todayNex} NEX`} value={fmtUsd(e.todayUsd)} accent="var(--admin-domain-d)" />
        <HubMetric label="本周" value={fmtUsd(e.weekUsd)} />
        <HubMetric label="本月" value={fmtUsd(e.monthUsd)} />
        <HubMetric label="累计收益" sub={balanceAdjust !== 0 ? `含运营调整 ${balanceAdjust >= 0 ? "+" : ""}${fmtUsd(balanceAdjust)}` : undefined} value={fmtUsd(totalUsd)} accent="var(--v5-success)" />
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px]">
        {sources.map(([k, v]) => (
          <span key={k} className="rounded-full px-2 py-0.5" style={{ background: "var(--v5-surface-2)", color: "var(--v5-ink-3)" }}>{k} {fmtUsd(v)}</span>
        ))}
      </div>

      <p className="mt-3 mb-1.5 text-[11px]" style={{ color: "var(--v5-ink-3)" }}>佣金事件(cooling/unlocked · 复用 commission 权威)</p>
      {e.commission.length === 0 ? (
        <p className="text-[11.5px]" style={{ color: "var(--v5-ink-4)" }}>无佣金事件。</p>
      ) : (
        <div className="overflow-hidden rounded-[8px]" style={{ border: "1px solid var(--v5-border)" }}>
          <div className="max-h-[150px] overflow-y-auto">
            <table className="w-full border-collapse text-[11.5px]">
              <tbody>
                {e.commission.map((c) => (
                  <tr key={c.id} style={{ borderTop: "1px solid var(--v5-border)" }}>
                    <td className="px-2.5 py-1.5" style={{ color: "var(--v5-ink-3)" }}>{c.kind}{c.layer ? ` L${c.layer}` : ""}</td>
                    <td className="font-mono-tabular px-2.5 py-1.5 text-right" style={{ color: "var(--v5-ink)" }}>{fmtUsd(c.amountUsd)} · {c.amountNex} NEX</td>
                    <td className="px-2.5 py-1.5"><StatusPill label={CS_LABEL[c.status]} tone={CS_TONE[c.status]} size="sm" dot={false} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-3 mb-1.5 text-[11px]" style={{ color: "var(--v5-ink-3)" }}><AutoGloss>逐笔收益台账(D4 账本 · append-only · 运营分录置顶)</AutoGloss></p>
      <div className="overflow-hidden rounded-[8px]" style={{ border: "1px solid var(--v5-border)" }}>
        <div className="max-h-[220px] overflow-y-auto">
          <table className="w-full border-collapse text-[11.5px]">
            <thead>
              <tr style={{ background: "var(--v5-surface-2)" }}>
                {["时间", "类型", "金额", "状态"].map((h, i) => (
                  <th key={h} className="px-2.5 py-1.5 font-normal" style={{ color: "var(--v5-ink-4)", textAlign: i === 2 ? "right" : "left" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ledger.map((l, i) => (
                <tr key={l.id} style={{ borderTop: "1px solid var(--v5-border)", background: i < ledgerExtra.length ? "color-mix(in srgb, var(--admin-domain-d) 7%, transparent)" : undefined }}>
                  <td className="font-mono-tabular px-2.5 py-1.5" style={{ color: "var(--v5-ink-3)" }}>{l.tsLabel}</td>
                  <td className="px-2.5 py-1.5" style={{ color: "var(--v5-ink-3)" }}>{l.kind}</td>
                  <td className="font-mono-tabular px-2.5 py-1.5 text-right" style={{ color: l.deltaUsd >= 0 ? "var(--v5-ink)" : "var(--v5-danger)" }}>{l.deltaUsd >= 0 ? "+" : ""}{fmtUsd(l.deltaUsd)}</td>
                  <td className="px-2.5 py-1.5" style={{ color: "var(--v5-ink-4)" }}>{l.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        <HubActBtn label="补发收益" onClick={() => adj("补发")} />
        <HubActBtn label="调整分录" onClick={() => adj("调整")} />
        <HubActBtn label="红冲" onClick={() => adj("红冲", true)} danger />
        <Link href="/finance/ledger" prefetch={false} className="inline-flex items-center gap-0.5 text-[10.5px] hover:opacity-80" style={{ color: "var(--admin-domain-d)" }}>D4 账本审计<ArrowUpRight size={11} /></Link>
        <span className="flex items-center gap-1 text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}><ShieldAlert size={11} /> <AutoGloss>append-only · MC 双签 · 发起人不可自审</AutoGloss></span>
      </div>
    </HubCard>
  );
}
