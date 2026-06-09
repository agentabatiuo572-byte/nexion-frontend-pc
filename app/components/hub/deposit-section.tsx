"use client";

/**
 * 360 HUB · 投入卡(deposit 只读下钻)— C1·deepening。
 * 全部只读引用既有权威:累计/余额来自 C1 聚合(AdminUser)、逐笔来自 D4 账本、曲线来自 wallet.topup_confirmed 事件。
 * 本卡无写动作;一切处置跳转 D1(/finance/recon)/ C3(/users/assets)既有面(MC 双签)。
 * PRD: Nexion_运营控制后台PRD_v1.md §C1·deepening。CGM: CGM-D-011/017/003/020 + CGM-C usdtBalance。
 */
import Link from "next/link";
import { Wallet, ArrowUpRight } from "lucide-react";
import type { AdminUser } from "@/lib/mock/admin/users";
import { getUserDeposits, type TopupStatus } from "@/lib/mock/admin/user-deposits";
import { fmtUsd } from "@/lib/format";
import { StatusPill, type PillTone } from "@/app/components/kit/status-pill";
import { AutoGloss } from "@/app/components/kit/gloss";

const STATUS_TONE: Record<TopupStatus, PillTone> = { posted: "success", pending: "warning", failed: "danger" };
const STATUS_LABEL: Record<TopupStatus, string> = { posted: "已入账", pending: "处理中", failed: "失败" };

function Metric({ label, sub, value, accent }: { label: string; sub: string; value: string; accent?: string }) {
  return (
    <div className="rounded-[9px] p-2.5" style={{ background: "var(--v5-surface-2)" }}>
      <p className="text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}><AutoGloss>{label}</AutoGloss></p>
      <p className="font-mono-tabular mt-0.5 text-[16px] leading-none" style={{ color: accent ?? "var(--v5-ink)" }}>{value}</p>
      <p className="mt-1 text-[9.5px]" style={{ color: "var(--v5-ink-4)" }}><AutoGloss>{sub}</AutoGloss></p>
    </div>
  );
}

export function DepositSection({ user }: { user: AdminUser }) {
  const dep = getUserDeposits(user.id, user.depositedUsd);
  const net = user.depositedUsd - user.withdrawnUsd;
  const postedN = dep.topups.filter((t) => t.status === "posted").length;
  const maxCurve = Math.max(1, ...dep.curve30d);

  return (
    <div className="rounded-[12px] p-4" style={{ background: "var(--v5-surface)", border: "1px solid var(--v5-border)" }}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Wallet size={15} style={{ color: "var(--admin-domain-c)" }} />
        <span className="font-display text-[14px]" style={{ color: "var(--v5-ink)" }}><AutoGloss>投入卡 · deposit 只读下钻</AutoGloss></span>
        <span className="font-mono-tabular text-[10px]" style={{ color: "var(--v5-ink-4)" }}><AutoGloss>C1·deepening · 复用 C1/D4/D1/C3 · server-canonical</AutoGloss></span>
      </div>

      {/* 区1:累计投入指标 */}
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Metric label="累计投入" sub="累计入金 · 只读" value={fmtUsd(user.depositedUsd)} accent="var(--admin-domain-c)" />
        <Metric label="可提余额" sub="派生自账本" value={fmtUsd(user.balanceUsd)} />
        <Metric label="净沉淀" sub="累计充值 − 累计提现" value={fmtUsd(net)} accent={net >= 0 ? "var(--v5-success)" : "var(--v5-danger)"} />
        <Metric label="充值笔数" sub={`${postedN} 笔已入账`} value={`${dep.topups.length}`} />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--v5-ink-4)" }}>
        <AutoGloss>累计投入仅由真实充值累加(never earnings/salvage/KYC/quest);trade-in 资格按累计投入 + E 域门槛配置评估(</AutoGloss>
        <Link href="/devices/trade-in" prefetch={false} className="inline-flex items-center gap-0.5 hover:opacity-80" style={{ color: "var(--admin-domain-e)" }}>E5 配置<ArrowUpRight size={11} /></Link>
        <AutoGloss>)。本卡只读,不写累计入金、不触发资格重算。</AutoGloss>
      </p>

      {/* 区2:30 日充值曲线 */}
      <div className="mt-3">
        <p className="mb-1.5 text-[11px]" style={{ color: "var(--v5-ink-3)" }}>近 30 日充值额(日聚合 · 派生自 wallet.topup_confirmed)</p>
        <div className="flex items-end gap-[2px]" style={{ height: 40 }}>
          {dep.curve30d.map((v, i) => (
            <span key={i} className="flex-1 rounded-t-[2px]" title={fmtUsd(v)}
              style={{ height: `${Math.max(2, (v / maxCurve) * 100)}%`, background: v > 0 ? "color-mix(in srgb, var(--admin-domain-c) 70%, transparent)" : "var(--v5-surface-2)" }} />
          ))}
        </div>
      </div>

      {/* 区3:逐笔 topup 流水 */}
      <div className="mt-3">
        <p className="mb-1.5 text-[11px]" style={{ color: "var(--v5-ink-3)" }}>逐笔充值流水(只读 · 数据源 D4 账本 type=topup · <Link href="/finance/ledger" prefetch={false} className="hover:opacity-80" style={{ color: "var(--admin-domain-d)" }}>D4 账本 ↗</Link>)</p>
        {dep.topups.length === 0 ? (
          <p className="rounded-[8px] p-3 text-center text-[12px]" style={{ background: "var(--v5-surface-2)", color: "var(--v5-ink-4)" }}>该用户无充值记录。</p>
        ) : (
          <div className="overflow-hidden rounded-[8px]" style={{ border: "1px solid var(--v5-border)" }}>
            <div className="max-h-[220px] overflow-y-auto">
              <table className="w-full border-collapse text-[11.5px]">
                <thead>
                  <tr style={{ background: "var(--v5-surface-2)" }}>
                    {["时间(服务端)", "金额", "状态", "渠道", "参考号"].map((h, i) => (
                      <th key={h} className="px-2.5 py-1.5 font-normal" style={{ color: "var(--v5-ink-4)", textAlign: i === 1 ? "right" : "left" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dep.topups.map((t) => (
                    <tr key={t.id} style={{ borderTop: "1px solid var(--v5-border)" }}>
                      <td className="font-mono-tabular px-2.5 py-1.5" style={{ color: "var(--v5-ink-3)" }}>{t.tsLabel}</td>
                      <td className="font-mono-tabular px-2.5 py-1.5 text-right" style={{ color: t.status === "failed" ? "var(--v5-ink-4)" : "var(--v5-ink)" }}>{fmtUsd(t.amountUsd)}</td>
                      <td className="px-2.5 py-1.5"><StatusPill label={STATUS_LABEL[t.status]} tone={STATUS_TONE[t.status]} size="sm" dot={false} /></td>
                      <td className="px-2.5 py-1.5" style={{ color: "var(--v5-ink-3)" }}>{t.channel}</td>
                      <td className="font-mono-tabular px-2.5 py-1.5" style={{ color: "var(--v5-ink-4)" }}>{t.ref}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* 区4:运营调整记录(只读)+ 跳转既有处置面 */}
      <div className="mt-3">
        <p className="mb-1.5 text-[11px]" style={{ color: "var(--v5-ink-3)" }}><AutoGloss>运营调整记录(只读汇总 · append-only)</AutoGloss></p>
        {dep.adjustments.length === 0 ? (
          <p className="text-[11.5px]" style={{ color: "var(--v5-ink-4)" }}>无投入相关调整分录。</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {dep.adjustments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] px-2.5 py-1.5 text-[11.5px]" style={{ background: "var(--v5-surface-2)" }}>
                <span style={{ color: "var(--v5-ink-3)" }}>{a.tsLabel} · {a.kind} · 工单 {a.ticket}</span>
                <span className="flex items-center gap-2">
                  <span className="font-mono-tabular" style={{ color: a.deltaUsd >= 0 ? "var(--v5-success)" : "var(--v5-danger)" }}>{a.deltaUsd >= 0 ? "+" : ""}{fmtUsd(a.deltaUsd)}</span>
                  <span style={{ color: "var(--v5-ink-4)" }}>{a.maker}→{a.checker}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <Link href="/finance/recon" prefetch={false} className="inline-flex items-center gap-1 rounded-[9px] px-3 py-1.5 text-[12px] transition-colors hover:bg-[var(--v5-surface-2)]" style={{ border: "1px solid var(--v5-border)", color: "var(--v5-ink-2)" }}>
            对账核销 / 拒付冲正 <ArrowUpRight size={13} style={{ color: "var(--admin-domain-d)" }} />
          </Link>
          <Link href="/users/assets" prefetch={false} className="inline-flex items-center gap-1 rounded-[9px] px-3 py-1.5 text-[12px] transition-colors hover:bg-[var(--v5-surface-2)]" style={{ border: "1px solid var(--v5-border)", color: "var(--v5-ink-2)" }}>
            纯余额补记 <ArrowUpRight size={13} style={{ color: "var(--admin-domain-c)" }} />
          </Link>
          <span className="text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}><AutoGloss>处置在 D1/C3 既有面执行 · MC 双签 + 发起人不可自审 + append-only</AutoGloss></span>
        </div>
      </div>
    </div>
  );
}
