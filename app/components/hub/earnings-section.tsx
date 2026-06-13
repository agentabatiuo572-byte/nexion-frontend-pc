"use client";

/**
 * 360 HUB · 收益台账(单用户详细收益 CRUD)— C1·deepening。
 * 真交互层:补发/调整/红冲 经 confirm(操作确认 + 操作理由必填)后**真实 append 到 useUserOps.ledgerExtra** → 逐笔表新增一行 + 累计收益随之变化 + 写审计流。
 * append-only(红冲不真删,负向分录)。真后台:POST /api/admin/users/{id}/ledger(Idempotency-Key,大额加签)。
 * CGM: CGM-D earnings.* / commission events。
 */
import { useMemo, useRef, useState, type MutableRefObject } from "react";
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
type AdjKind = "补发" | "调整" | "红冲";
const ADJ_DEFAULTS: Record<AdjKind, { amount: string; memo: string }> = {
  补发: { amount: "50", memo: "运营补发漏结收益" },
  调整: { amount: "12", memo: "对账差异修正" },
  红冲: { amount: "50", memo: "红冲误结分录" },
};

interface AdjDraft { amount: string; memo: string; }

/** 弹窗内可编辑金额 + 理由表单。内部 state,通过 draftRef 把最新值同步给父级。 */
function AdjForm({ kind, initial, draftRef }: { kind: AdjKind; initial: AdjDraft; draftRef: MutableRefObject<AdjDraft> }) {
  const [amount, setAmount] = useState(initial.amount);
  const [memo, setMemo] = useState(initial.memo);
  // 渲染期回写 ref(运营 onConfirm 后取最新值),mutable ref 直写无副作用警告。
  draftRef.current = { amount, memo };
  const isHongchong = kind === "红冲";
  return (
    <div className="flex flex-col gap-3">
      <label className="block">
        <span className="text-[11.5px]" style={{ color: "var(--v5-ink-4)" }}>金额 USDT · 可改</span>
        <div className="mt-1 flex items-center gap-2 rounded-[8px] px-3 py-2" style={{ background: "var(--v5-surface-2)", border: "1px solid var(--v5-border)" }}>
          <span className="font-mono-tabular text-[14px]" style={{ color: isHongchong ? "var(--v5-danger)" : "var(--v5-success)", minWidth: 12 }}>{isHongchong ? "−" : "+"}</span>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            autoFocus
            className="font-mono-tabular w-full bg-transparent text-[13.5px] outline-none"
            style={{ color: "var(--v5-ink)" }}
          />
          <span className="text-[11.5px]" style={{ color: "var(--v5-ink-4)" }}>USDT</span>
        </div>
      </label>
      <label className="block">
        <span className="text-[11.5px]" style={{ color: "var(--v5-ink-4)" }}>理由 · 写入审计</span>
        <textarea
          rows={2}
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
          placeholder="必填,审计可读"
          className="mt-1 w-full resize-none rounded-[8px] px-3 py-2 text-[12.5px] outline-none"
          style={{ background: "var(--v5-surface-2)", border: "1px solid var(--v5-border)", color: "var(--v5-ink)" }}
        />
      </label>
    </div>
  );
}

export function EarningsSection({ user }: { user: AdminUser }) {
  const e = useMemo(() => getUserEarnings(user.id, user.depositedUsd * 0.6 + user.withdrawnUsd + user.balanceUsd * 0.2), [user.id, user.depositedUsd, user.withdrawnUsd, user.balanceUsd]);
  const hydrated = useOpsHydrated();
  const storeLedger = useUserOps((s) => s.users[user.id]?.ledgerExtra);
  const storeBal = useUserOps((s) => s.users[user.id]?.balanceAdjustUsd);
  const earningAppend = useUserOps((s) => s.earningAppend);
  const ledgerExtra = hydrated ? (storeLedger ?? []) : [];
  const balanceAdjust = hydrated ? (storeBal ?? 0) : 0;

  const draftRef = useRef<AdjDraft>({ amount: "", memo: "" });

  async function adj(kind: AdjKind, danger?: boolean) {
    const label = kind === "补发" ? "补发收益" : kind === "调整" ? "调整分录" : "红冲";
    const initial = ADJ_DEFAULTS[kind];
    draftRef.current = { ...initial };
    const ledgerNote = kind === "红冲"
      ? "原条目保留,新增一条冲正分录将其冲销"
      : "新增一条分录入账,原账目保持不动";
    const ok = await confirm({
      title: label + "?",
      message: `${ledgerNote}。需对应角色执行确认,操作理由必填并全程留审计,全程留审计。`,
      content: <AdjForm kind={kind} initial={initial} draftRef={draftRef} />,
      confirmLabel: "确认" + label,
      danger,
    });
    if (!ok) return;
    const { amount: amountStr, memo: memoRaw } = draftRef.current;
    const num = parseFloat(amountStr);
    if (!Number.isFinite(num) || num <= 0) {
      toast.error("金额无效", "请输入大于 0 的数字");
      return;
    }
    const memo = memoRaw.trim();
    if (!memo) {
      toast.error("理由必填", "审计需要可读的处置理由");
      return;
    }
    const delta = kind === "红冲" ? -num : num;
    earningAppend(user.id, kind, delta, memo);
    toast.success(label + " 已入账", `${user.id} · ${delta >= 0 ? "+" : ""}${fmtUsd(delta)} · ${memo}`);
  }

  const sources: [string, number][] = [["设备", e.bySource.device], ["佣金", e.bySource.commission], ["质押", e.bySource.staking], ["Genesis", e.bySource.genesis]];
  const ledger: LedgerRow[] = [...ledgerExtra, ...e.ledger];
  const totalUsd = e.totalUsd + balanceAdjust;

  return (
    <HubCard icon={<TrendingUp size={15} style={{ color: "var(--admin-domain-d)" }} />} title="收益台账 · 单用户详细收益 CRUD" tag="C1·deepening · 真写 append-only · 操作确认">
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
        <span className="flex items-center gap-1 text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}><ShieldAlert size={11} /> <AutoGloss>append-only · 操作确认 · 操作理由必填</AutoGloss></span>
      </div>
    </HubCard>
  );
}
