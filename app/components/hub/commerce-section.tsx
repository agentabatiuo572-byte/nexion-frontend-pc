"use client";

/**
 * 360 HUB · 订单·商城·收据·试用卡 — C1·deepening。
 * 覆盖:useOrders 订单 CRUD / useReceipts Proof-of-Compute / useFreeTrial 状态机 / useCart 购物车 / cumulativeDeposit。
 * 处置(取消订单/退款/补发收据/重置试用)= confirm→MC。CGM: E-005..011。
 */
import Link from "next/link";
import { ShoppingBag, ArrowUpRight } from "lucide-react";
import type { AdminUser } from "@/lib/mock/admin/users";
import { getUserCommerce, type OrderStatus, type TrialState } from "@/lib/mock/admin/user-360";
import { useUserOps, useOpsHydrated } from "@/lib/store/admin/user-ops-store";
import { fmtUsd } from "@/lib/format";
import { confirm, toast } from "@/lib/store/ui";
import { StatusPill, type PillTone } from "@/app/components/kit/status-pill";
import { AutoGloss } from "@/app/components/kit/gloss";
import { HubCard, HubMetric } from "./hub-kit";

const OS_TONE: Record<OrderStatus, PillTone> = { pending: "warning", paid: "neutral", shipped: "neutral", activated: "success", cancelled: "danger" };
const OS_LABEL: Record<OrderStatus, string> = { pending: "待支付", paid: "已支付", shipped: "已发货", activated: "已激活", cancelled: "已取消" };
const TS_LABEL: Record<TrialState, string> = { none: "无试用", active: "试用中", grace: "宽限期", converted: "已转化", expired: "已过期" };
const TS_TONE: Record<TrialState, PillTone> = { none: "neutral", active: "success", grace: "warning", converted: "success", expired: "danger" };

export function CommerceSection({ user }: { user: AdminUser }) {
  const c = getUserCommerce(user.id, user.deviceCount, user.depositedUsd);
  const hydrated = useOpsHydrated();
  const storeCancelled = useUserOps((s) => s.users[user.id]?.cancelledOrderIds);
  const cancelOrderStore = useUserOps((s) => s.cancelOrder);
  const cancelled = hydrated ? (storeCancelled ?? []) : [];
  async function doCancelOrder(o: { id: string; product: string }) {
    const yes = await confirm({ title: "取消该订单?", message: `取消 ${o.id}(${o.product})· 若已支付转退款流程 · 需第二角色复核 + 审计留痕。`, confirmLabel: "取消订单", danger: true });
    if (yes) {
      cancelOrderStore(user.id, o.id, `${o.id} · ${o.product}`);
      toast.success("订单已取消", `${user.id} · ${o.id}`);
    }
  }
  return (
    <HubCard icon={<ShoppingBag size={15} style={{ color: "var(--admin-domain-e)" }} />} title="订单·商城·收据·试用卡" tag="C1·deepening · E 商城 · 处置 MC">
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <HubMetric label="历史订单" value={`${c.orders.length}`} accent="var(--admin-domain-e)" />
        <HubMetric label="收据" sub="Proof-of-Compute" value={`${c.receipts.length}`} />
        <HubMetric label="购物车" value={c.cartItems > 0 ? `${c.cartItems} 件 · ${fmtUsd(c.cartValueUsd)}` : "空"} />
        <HubMetric label="累计入金" sub="驱动 trade-in" value={fmtUsd(c.cumulativeDepositUsd)} />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-[11px]" style={{ color: "var(--v5-ink-3)" }}>试用状态</span>
        <StatusPill label={TS_LABEL[c.trialState]} tone={TS_TONE[c.trialState]} size="sm" dot={false} />
        {(c.trialState === "active" || c.trialState === "grace") && <span className="font-mono-tabular text-[11px]" style={{ color: "var(--v5-ink-4)" }}>已抵 {fmtUsd(c.trialOffsetUsd)} / 上限 $50</span>}
      </div>

      {/* 订单表 */}
      <p className="mt-3 mb-1.5 text-[11px]" style={{ color: "var(--v5-ink-3)" }}>订单</p>
      <div className="overflow-hidden rounded-[8px]" style={{ border: "1px solid var(--v5-border)" }}>
        <table className="w-full border-collapse text-[11px]">
          <thead><tr style={{ background: "var(--v5-surface-2)" }}>{["订单号", "商品", "金额", "支付", "状态", ""].map((h, i) => <th key={h + i} className="px-2.5 py-1.5 font-normal" style={{ color: "var(--v5-ink-4)", textAlign: i === 2 ? "right" : "left" }}>{h}</th>)}</tr></thead>
          <tbody>{c.orders.map((o) => (
            <tr key={o.id} style={{ borderTop: "1px solid var(--v5-border)" }}>
              <td className="font-mono-tabular px-2.5 py-1.5" style={{ color: "var(--v5-ink-3)" }}>{o.id}</td>
              <td className="px-2.5 py-1.5" style={{ color: "var(--v5-ink)" }}>{o.product}{o.qty > 1 ? ` ×${o.qty}` : ""}</td>
              <td className="font-mono-tabular px-2.5 py-1.5 text-right" style={{ color: "var(--v5-ink)" }}>{fmtUsd(o.totalUsd)}</td>
              <td className="px-2.5 py-1.5" style={{ color: "var(--v5-ink-4)" }}>{o.method}</td>
              <td className="px-2.5 py-1.5">{cancelled.includes(o.id) ? <StatusPill label="已取消" tone="danger" size="sm" dot={false} /> : <StatusPill label={OS_LABEL[o.status]} tone={OS_TONE[o.status]} size="sm" dot={false} />}</td>
              <td className="px-2.5 py-1.5 text-right">
                {(o.status === "pending" || o.status === "paid") && !cancelled.includes(o.id) && (
                  <button type="button" onClick={() => doCancelOrder(o)}
                    className="rounded-[6px] px-2 py-0.5 text-[10px] transition-colors hover:bg-[var(--v5-surface-2)]" style={{ border: "1px solid var(--v5-border)", color: "var(--v5-ink-3)" }}>取消</button>
                )}
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      {/* 收据 */}
      <p className="mt-3 mb-1.5 text-[11px]" style={{ color: "var(--v5-ink-3)" }}><AutoGloss>收据 · Proof-of-Compute</AutoGloss></p>
      <ul className="flex flex-col gap-1">
        {c.receipts.slice(0, 5).map((r) => (
          <li key={r.id} className="flex items-center justify-between rounded-[8px] px-2.5 py-1.5 text-[11px]" style={{ background: "var(--v5-surface-2)" }}>
            <span style={{ color: "var(--v5-ink-3)" }}>{r.tsLabel} · {r.category} · {r.title}</span>
            <span className="font-mono-tabular" style={{ color: "var(--v5-ink-4)" }}>手续费 {fmtUsd(r.feeUsd)}</span>
          </li>
        ))}
      </ul>

      <p className="mt-2.5 flex flex-wrap items-center gap-2 text-[10.5px]" style={{ color: "var(--v5-ink-4)" }}>
        <Link href="/devices/orders" prefetch={false} className="inline-flex items-center gap-0.5 hover:opacity-80" style={{ color: "var(--admin-domain-e)" }}>E6 订单管理<ArrowUpRight size={11} /></Link>
        <Link href="/devices/trade-in" prefetch={false} className="inline-flex items-center gap-0.5 hover:opacity-80" style={{ color: "var(--admin-domain-e)" }}><AutoGloss>E5 trade-in</AutoGloss><ArrowUpRight size={11} /></Link>
        <AutoGloss>取消/退款/补发收据/重置试用在 E 域 · MC 双签。</AutoGloss>
      </p>
    </HubCard>
  );
}
