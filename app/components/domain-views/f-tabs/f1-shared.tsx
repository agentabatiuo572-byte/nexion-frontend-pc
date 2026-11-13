"use client";

/**
 * F1 团队等级晋升几个文件共用的文字和确认框外壳。
 * 只管怎么写给运营看：奖励怎么写、发放状态叫什么、审批人怎么称呼；不发请求、不判断权限。
 */
import type { ReactNode } from "react";
import { BadgeDollarSign, CircleCheck, Clock3, Coins, Gift, Package, RotateCcw, Ticket, TriangleAlert, Undo2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { OperationConfirmModal, type BusinessFormSpec, type BusinessFormValue, type EditSpec, type OperatorBriefKind } from "../design-kit";
import { isA2OutcomeUncertainError } from "@/lib/admin/a2-client";
import { displayAdminError } from "@/lib/admin/error-messages";
import { operationConfirmErrorMessage } from "@/lib/admin/operation-confirm-error";
import { formatF1ExactAmount } from "@/lib/admin/f1-policy-change";
import type { OpsVRankRewardItem } from "@/lib/admin/platform-types";
import type { F1RewardPayout } from "@/lib/admin/f1-client";
import type { StateTone } from "@/app/components/rd";
import type { FViewCtx } from "./types";

/**
 * 自定义奖励是运营手填的文字，可能存着测试工具名（f1engine、reverify）。它们是内部标识，不上屏，
 * 判据和 App 的 rank-entitlement-label 保持一致。
 */
const INTERNAL_LABEL_PATTERN = /f1engine|reverify/i;
export function safeCustomLabel(raw: string | undefined, fallback = "自定义奖品"): string {
  const label = (raw ?? "").trim();
  return label && !INTERNAL_LABEL_PATTERN.test(label) ? label : fallback;
}

export type RewardKind = "fund" | "voucher" | "sku" | "custom";
export const REWARD_KIND: Record<RewardKind, { name: string; icon: LucideIcon }> = {
  fund: { name: "资金", icon: BadgeDollarSign },
  voucher: { name: "券", icon: Ticket },
  sku: { name: "商品", icon: Package },
  custom: { name: "自定义奖品", icon: Gift },
};
export function rewardKind(type: string): RewardKind {
  const lower = type.toLowerCase();
  if (lower === "usdt" || lower === "uvt") return "fund";
  if (lower === "voucher") return "voucher";
  if (lower === "sku") return "sku";
  return "custom";
}
export const FUND_ICON = Coins;

/** 模板里的一项奖励写成一句：资金写金额和币种（后端给的精确文本，不用 $、不舍入），券和商品写名字，自定义写奖品名。 */
export function rewardText(item: OpsVRankRewardItem, ctx: Pick<FViewCtx, "voucherLabels" | "skuLabels">): { main: string; unit?: string; missing?: boolean } {
  if (item.type === "usdt" || item.type === "uvt") {
    return item.amountText ? { main: formatF1ExactAmount(item.amountText), unit: item.type.toUpperCase() } : { main: "金额暂不可用", missing: true };
  }
  if (item.type === "voucher") {
    const label = ctx.voucherLabels[item.voucherId ?? ""];
    return label ? { main: label } : item.voucherId ? { main: `券 ${item.voucherId}` } : { main: "券未设置", missing: true };
  }
  if (item.type === "sku") {
    const label = ctx.skuLabels[item.skuId ?? ""];
    return label ? { main: label } : item.skuId ? { main: `商品 ${item.skuId}` } : { main: "商品未设置", missing: true };
  }
  return { main: safeCustomLabel(item.custom) };
}
export function rewardLine(item: OpsVRankRewardItem, ctx: Pick<FViewCtx, "voucherLabels" | "skuLabels">) {
  const text = rewardText(item, ctx);
  return text.unit ? `${text.main} ${text.unit}` : text.main;
}

/**
 * 发放记录的金额：后端原文去掉多补的末尾 0，最少两位小数；有真实小数位的一位不丢、不舍入（F1-B04）。
 * 原文在 title 里看得到。
 */
export function payoutAmount(raw: string) {
  const text = raw.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return text || "—";
  const fraction = (match[3] ?? "").replace(/0+$/, "").padEnd(2, "0");
  return `${match[1]}${formatF1ExactAmount(match[2])}.${fraction}`;
}

/** 发放记录这一笔是什么奖励：资金写金额和币种，券、商品写编号（发放记录只给编号），自定义写奖品名。 */
export function payoutReward(record: F1RewardPayout): { main: string; unit?: string; raw?: string } {
  const type = record.rewardType.toUpperCase();
  if (type === "USDT" || type === "UVT") return { main: payoutAmount(record.amountText), unit: type, raw: record.amountText };
  if (type === "VOUCHER") return { main: record.voucherId ? `券 ${record.voucherId}` : "券（没有编号）" };
  if (type === "SKU") return { main: record.skuId ? `商品 ${record.skuId}` : "商品（没有编号）" };
  if (type === "CUSTOM") return { main: safeCustomLabel(record.customLabel) };
  return { main: record.rewardType || "—" };
}

export const PAYOUT_STATUS: Record<string, { label: string; tone: StateTone; icon: LucideIcon }> = {
  PENDING_GRANT: { label: "待发放", tone: "progress", icon: Clock3 },
  GRANTED: { label: "已发放", tone: "done", icon: CircleCheck },
  REISSUED: { label: "已重发", tone: "done", icon: RotateCcw },
  REVERSED: { label: "已冲正", tone: "neutral", icon: Undo2 },
  FAILED: { label: "发放失败", tone: "warn", icon: TriangleAlert },
};
export const PAYOUT_TYPES = [
  { value: "USDT", label: "USDT" }, { value: "UVT", label: "UVT" }, { value: "VOUCHER", label: "券" },
  { value: "SKU", label: "商品" }, { value: "CUSTOM", label: "自定义奖品" },
] as const;

/** 审批人叫法照「全站-审批人叫法」：门槛放宽、增加资金奖励由超级管理员批；其余 F1 审批由另一位管理员批。 */
export const SUPER_APPROVER = "另一位超级管理员";
export const ADMIN_APPROVER = "另一位管理员";

/**
 * F1 自己开的确认框。请求和旧页面一样走 ctx 上现成的提交函数，确认框只多了标题、标签和事实这些样子。
 * 提交成功、失败、结果未知的提示与原来共用确认框的写法一致。
 */
export type F1Confirm = {
  /** 记进操作记录的名字，和旧页面一样。 */
  action: string;
  title: ReactNode;
  briefKind: OperatorBriefKind | ((value: BusinessFormValue) => OperatorBriefKind);
  detail: ReactNode;
  effect?: ReactNode;
  facts?: ReactNode | ((value?: string) => ReactNode);
  content?: ReactNode;
  statedBrief?: { impact: string; check: string } | ((value: BusinessFormValue) => { impact: string; check: string });
  amplify?: boolean;
  confirmTone?: "primary" | "danger";
  confirmLabel?: string;
  coverageLead?: ReactNode;
  coverageCheck?: string;
  edit?: EditSpec;
  businessForm?: BusinessFormSpec;
  reasonPlaceholder?: string;
  /** 提交：调用 ctx 上现成的函数，成功后由外壳关框。 */
  submit: (reason: string, businessValue?: BusinessFormValue, newValue?: string) => Promise<void>;
  /** 成功后的提示；不传就不提示（提交函数自己提示了）。 */
  done?: string;
};

export function F1ConfirmHost({ confirm, ctx, onClose }: { confirm: F1Confirm; ctx: FViewCtx; onClose: () => void }) {
  return (
    <OperationConfirmModal
      briefKind={confirm.briefKind}
      action={confirm.action}
      title={confirm.title}
      detail={confirm.detail}
      effect={confirm.effect}
      facts={confirm.facts}
      content={confirm.content}
      statedBrief={confirm.statedBrief}
      amplifies={!!confirm.amplify}
      coverage={ctx.f1Coverage}
      coverageLead={confirm.coverageLead}
      coverageCheck={confirm.coverageCheck}
      confirmTone={confirm.confirmTone}
      confirmLabel={confirm.confirmLabel}
      reasonPlaceholder={confirm.reasonPlaceholder}
      edit={confirm.edit}
      businessForm={confirm.businessForm}
      onClose={onClose}
      onConfirm={async (reason, newValue, businessValue) => {
        try {
          await confirm.submit(reason, businessValue, newValue);
          if (confirm.done) ctx.toast(confirm.done);
          onClose();
        } catch (error) {
          // 和 F 域外壳的写法一致：结果未知不算失败，原申请可能已经建了，冠以失败会让人换个办法重做。
          const message = error instanceof Error && error.name.endsWith("OutcomeUncertainError") ? operationConfirmErrorMessage(error) : displayAdminError(error);
          ctx.toast(isA2OutcomeUncertainError(error) ? message : "提交失败 · " + message);
          // 确认框自己管重试和错误样子，要把错误交回去。
          throw error;
        }
      }}
    />
  );
}
