"use client";

import { useEffect, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { PromotionApiError, promotionRead } from "@/lib/admin/promotion-client";
import type { RewardAdmin, RewardAdminPage } from "@/lib/admin/promotion-types";
import { nexGridBrandText } from "@/lib/admin/brand-copy";
import { Button, Explain, Notice } from "@/app/components/rd";

/** 资金去向常显；compact 只收起台账编号，不收起对象、金额和追回后果（DP-06）。 */
export function PromotionRefundImpact({ orderNo, compact = false }: { orderNo: string; compact?: boolean }) {
  const canRead = useAdminAuth(s => s.session?.authorities.includes("growth_promotion_reward_read") ?? false);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{ items: RewardAdmin[]; total: number; status: "loading" | "ready" | "forbidden" | "failed" }>({ items: [], total: 0, status: "loading" });

  useEffect(() => {
    if (!canRead) return;
    let current = true;
    setResult({ items: [], total: 0, status: "loading" });
    const load = async () => {
      const items: RewardAdmin[] = [];
      let cursor: string | null = null;
      do {
        const page: RewardAdminPage = await promotionRead<RewardAdminPage>("/promotion-rewards", { orderNo, limit: 100, cursor });
        if (!current) return;
        items.push(...page.items);
        setResult({ items: [...items], total: page.total, status: page.hasMore ? "loading" : "ready" });
        cursor = page.hasMore ? page.nextCursor : null;
      } while (cursor);
    };
    void load().catch(error => {
      if (current) setResult(previous => ({ ...previous, status: error instanceof PromotionApiError && error.status === 403 ? "forbidden" : "failed" }));
    });
    return () => { current = false; };
  }, [orderNo, canRead, retry]);

  const forbidden = !canRead || result.status === "forbidden";
  const rewards = <ul className="rd-impact-list">
        {result.items.map(r => <li key={r.obligationId}>
          <b>{r.beneficiaryRole === "BUYER" ? "购买者" : "直接邀请人"} · {r.beneficiaryId} · {r.reward.type === "DEVICE" ? `${r.disclosure.deviceName || "赠品设备"} × ${r.reward.quantity} 台` : `${r.reward.amount} ${nexGridBrandText(r.reward.type === "DISCOUNT_USDT" ? "USDT" : r.reward.type)}`}</b>
          {compact ? <Explain label="奖励台账编号" content={`奖励项 ${r.obligationId}`} /> : <div className="rd-note">奖励项 {r.obligationId}</div>}
          <div>{["CANCELLED", "REVERSED"].includes(r.state) ? "原奖励已取消或已冲正，本次不重复发放或追回。"
            : ["PENDING", "READY", "RETRYABLE_FAILED"].includes(r.state) && !r.assetReceipt ? "退款申请先暂停发奖；退款确认执行后，取消未发放的奖励。"
            : <>{["PROCESSING", "OUTCOME_UNKNOWN", "MANUAL_REVIEW"].includes(r.state) && "先核对原发放结果，未发放的取消；已发放的按以下规则处理。"}{r.reward.type === "DEVICE"
              ? "退款确认执行后，一律收回赠品设备并停止任务；已到账的设备收益保留，按实际币种记为平台未追回损失后结案。"
              : r.reward.type === "DISCOUNT_USDT" ? "订单立减已计入原订单金额，按整单退款金额处理。"
              : `退款确认执行后，${r.reward.type} 奖励按执行时余额在同币种内追回，最多追回原奖励；不足部分由平台承担，记为未追回损失后结案，不扣其他币种或设备。`}</>}</div>
        </li>)}
      </ul>;
  if (compact) {
    if (forbidden) return <>无权查看，仍可提交退款</>;
    if (result.status === "failed") return <>读取失败，还不能确认影响，仍可提交退款 <Button size="sm" onClick={() => setRetry(v => v + 1)}>重试</Button></>;
    if (result.status === "loading") return <>正在加载…</>;
    if (!result.items.length) return <>这单没有促销奖励</>;
    return rewards;
  }
  return <section className="rd-confirm-facts rd-impact" aria-label="促销奖励影响">
    <h4 className="rd-impact-title">促销奖励影响<Explain label="退款后奖励怎么处理" content="退款须由另一位超级管理员批准，系统按售后规则执行；实际追回与损失以执行后「活动中心 → 奖励台账」及活动效果为准。" /></h4>
    <p className="rd-note">原订单 {orderNo}</p>
    {forbidden ? <p role="status">无权查看奖励影响。</p> : <>
      {result.status === "loading" && <p role="status">{result.items.length ? `已加载 ${result.items.length} / ${result.total} 项，还有奖励，正在继续加载…` : "正在加载奖励影响…"}</p>}
      {result.status === "failed" && <Notice tone="warn" action={<Button size="sm" onClick={() => setRetry(v => v + 1)}>重试加载奖励影响</Button>}>奖励影响加载失败，尚不能确认完整影响。</Notice>}
      {result.status === "ready" && <p role="status">{result.items.length ? `共 ${result.total} 项奖励，已全部加载。` : "此订单没有促销奖励。"}</p>}
      {rewards}
    </>}
    {(forbidden || result.status === "failed") && <p>仍可提交或批准退款。</p>}
  </section>;
}
