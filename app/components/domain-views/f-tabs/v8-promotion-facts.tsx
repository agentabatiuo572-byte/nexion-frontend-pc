import type { ReactNode } from "react";
import { Change, Fact } from "@/app/components/rd";
import type { V8PromotionBenefits, V8PromotionReward } from "@/lib/admin/a2-client";
import { ratePct } from "@/lib/admin/f1-rank-benefit";
import { amountDisplay } from "@/lib/format";
import { rewardLine, rewardText } from "./f1-shared";
import type { FViewCtx } from "./types";

const SNAPSHOT_NOTE = "送审时的模板，执行时按批准时的配置；以前到过 V8 的不再发";

export function V8PromotionFacts({ rewards, v7, v8, labels = { voucherLabels: {}, skuLabels: {} }, snapshot, children }: {
  rewards?: readonly V8PromotionReward[];
  v7?: V8PromotionBenefits;
  v8?: V8PromotionBenefits;
  labels?: Pick<FViewCtx, "voucherLabels" | "skuLabels">;
  snapshot?: boolean;
  children?: ReactNode;
}) {
  const lead = rewards?.length === 1 && (rewards[0].type === "usdt" || rewards[0].type === "uvt")
    ? rewardText(rewards[0], labels) : undefined;
  const fromL1 = ratePct(v7?.purchaseL1Rate), toL1 = ratePct(v8?.purchaseL1Rate);
  const fromL2 = ratePct(v7?.purchaseL2Rate), toL2 = ratePct(v8?.purchaseL2Rate);
  const fromSalary = v7?.monthlySalaryUsdt?.trim(), toSalary = v8?.monthlySalaryUsdt?.trim();

  return <>
    {rewards && (lead
      ? <Fact k="V8 晋级奖励 · 发给本人" lead>{lead.main}{lead.unit && <span className="rd-fact-unit">{lead.unit}</span>}<small className="f1-lead-note">{snapshot ? SNAPSHOT_NOTE : "以前领过 V8 晋级奖励的不再发"}</small></Fact>
      : <Fact k="V8 晋级奖励 · 发给本人">
          {rewards.length ? rewards.map(item => {
            const name = snapshot && (item.type === "voucher" ? item.voucherName : item.type === "sku" ? item.skuName : undefined);
            return name || rewardLine(item, labels);
          }).join("、") : "没有晋级奖励"}
          {snapshot ? `（${SNAPSHOT_NOTE}）` : rewards.length > 0 && "；以前领过的不再发"}
        </Fact>)}
    {children}
    {fromL1 && toL1 && fromL2 && toL2 && <Fact k="好友购买奖励">一级 <Change from={`${fromL1}%`} to={`${toL1}%`} /> · 二级 <Change from={`${fromL2}%`} to={`${toL2}%`} /></Fact>}
    {fromSalary && toSalary && <Fact k="月薪"><Change from={amountDisplay(fromSalary)} to={`${amountDisplay(toSalary)} USDT`} />，批准后次日起；本月已领的不补差</Fact>}
  </>;
}
