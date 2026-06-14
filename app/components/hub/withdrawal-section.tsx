"use client";

/**
 * 360 HUB · 提现卡(单用户提现明细)— C1·deepening。
 * 读:Withdrawal(per-user)。处置(放行/冻结/驳回/退款)跳 D2 提现审核队列(操作确认 + server 原子事务)。
 * CGM: CGM-D submitWithdrawal/advanceWithdrawal/latestWithdrawal。
 */
import Link from "next/link";
import { Banknote, ArrowUpRight } from "lucide-react";
import type { AdminUser } from "@/lib/mock/admin/users";
import { getUserWithdrawals, type WithdrawStatus } from "@/lib/mock/admin/user-360";
import { fmtUsd } from "@/lib/format";
import { StatusPill, type PillTone } from "@/app/components/kit/status-pill";
import { AutoGloss } from "@/app/components/kit/gloss";
import { HubCard, HubMetric } from "./hub-kit";

const WD_TONE: Record<WithdrawStatus, PillTone> = { submitted: "neutral", review: "warning", processing: "warning", sent: "success", confirmed: "success", rejected: "danger" };
const WD_LABEL: Record<WithdrawStatus, string> = { submitted: "已提交", review: "确认中", processing: "处理中", sent: "已发送", confirmed: "已确认", rejected: "已驳回" };

export function WithdrawalSection({ user }: { user: AdminUser }) {
  const w = getUserWithdrawals(user.id, user.withdrawnUsd);
  return (
    <HubCard icon={<Banknote size={15} style={{ color: "var(--v5-warning)" }} />} title="提现卡 · 单用户提现明细" tag="C1·deepening · D2 队列 · 处置在 D2 操作确认">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <HubMetric label="累计提现" value={fmtUsd(user.withdrawnUsd)} accent="var(--v5-warning)" />
        <HubMetric label="提现笔数" value={`${w.items.length}`} />
        <HubMetric label="在途" sub="未终态" value={`${w.inFlight}`} accent={w.inFlight > 0 ? "var(--v5-warning)" : "var(--v5-ink-4)"} />
        <HubMetric label="24h 频次" sub="反套现监控" value={`${w.freq24h}`} accent={w.freq24h >= 3 ? "var(--v5-danger)" : "var(--v5-ink-4)"} />
      </div>

      {w.items.length === 0 ? (
        <p className="mt-3 rounded-[8px] p-3 text-center text-[12px]" style={{ background: "var(--v5-surface-2)", color: "var(--v5-ink-4)" }}>该用户无提现记录。</p>
      ) : (
        <div className="mt-3 overflow-hidden rounded-[8px]" style={{ border: "1px solid var(--v5-border)" }}>
          <div className="max-h-[240px] overflow-y-auto">
            <table className="w-full border-collapse text-[11.5px]">
              <thead>
                <tr style={{ background: "var(--v5-surface-2)" }}>
                  {["时间", "金额", "网络", "地址", "状态", "手续费"].map((h, i) => (
                    <th key={h} className="px-2.5 py-1.5 font-normal" style={{ color: "var(--v5-ink-4)", textAlign: i === 1 || i === 5 ? "right" : "left" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {w.items.map((x) => (
                  <tr key={x.id} style={{ borderTop: "1px solid var(--v5-border)" }}>
                    <td className="font-mono-tabular px-2.5 py-1.5" style={{ color: "var(--v5-ink-3)" }}>{x.tsLabel}</td>
                    <td className="font-mono-tabular px-2.5 py-1.5 text-right" style={{ color: "var(--v5-ink)" }}>{fmtUsd(x.amountUsd)}</td>
                    <td className="px-2.5 py-1.5" style={{ color: "var(--v5-ink-3)" }}>{x.network}</td>
                    <td className="font-mono-tabular px-2.5 py-1.5" style={{ color: "var(--v5-ink-4)" }}>{x.addrMasked}</td>
                    <td className="px-2.5 py-1.5"><StatusPill label={WD_LABEL[x.status]} tone={WD_TONE[x.status]} size="sm" dot={false} /></td>
                    <td className="font-mono-tabular px-2.5 py-1.5 text-right" style={{ color: "var(--v5-ink-4)" }}>{fmtUsd(x.feeUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-2 text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}>
        <AutoGloss>放行/冻结/延迟/驳回/退款在</AutoGloss>
        <Link href="/finance/withdrawals" prefetch={false} className="inline-flex items-center gap-0.5 hover:opacity-80" style={{ color: "var(--v5-warning)" }}> <AutoGloss>D2 提现审核队列</AutoGloss><ArrowUpRight size={11} /></Link>
        <AutoGloss>执行 · 操作确认 + server 原子事务(扣余额+置态同事务)+ 红线核验。</AutoGloss>
      </p>
    </HubCard>
  );
}
