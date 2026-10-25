import type { EventRuleView } from "./event-rules-client";

export interface EventRuleField { key: string; label: string; type?: "text" | "regions" | "weekdays" | "voucher"; integer?: boolean; }
export const EVENT_KIND_LABELS: Record<string, string> = { discount: "限时优惠", seasonal: "节日促销", referral: "邀请挑战", onboarding: "新手任务", holding: "持币分享", regional: "区域竞赛", boost: "奖励加成", wheel: "幸运转盘" };
export const EVENT_RULE_FIELDS: Record<string, EventRuleField[]> = {
  referral: [{ key: "targetInvites", label: "有效直推人数", integer: true }, { key: "windowDays", label: "参与期限（天）", integer: true }, { key: "giftProductNo", label: "赠送设备商品编号", type: "text" }, { key: "giftQuantity", label: "每人赠送设备数量", integer: true }, { key: "deviceBudget", label: "设备发放总量上限", integer: true }],
  onboarding: [{ key: "windowDays", label: "新用户参与期限（天）", integer: true }, { key: "minRank", label: "最低 V 等级", integer: true }, { key: "rewardNex", label: "每人 UVT 奖励" }, { key: "streakSavers", label: "每人补签卡数量", integer: true }, { key: "budgetNex", label: "UVT 发放预算" }],
  holding: [{ key: "minNex", label: "最低持有 UVT" }, { key: "holdDays", label: "连续持有天数", integer: true }, { key: "poolUsdt", label: "USDT 总奖池" }],
  regional: [{ key: "regions", label: "参赛地区与国家", type: "regions" }, { key: "poolUsdt", label: "USDT 总奖池" }],
  CHECKIN_MULTIPLIER: [{ key: "multiplier", label: "签到 UVT 奖励倍数（整数 2–100）", integer: true }, { key: "weekdays", label: "生效星期", type: "weekdays" }, { key: "timeZone", label: "活动时区", type: "text" }, { key: "budgetNex", label: "加成 UVT 发放预算" }],
  REINVEST_TICKETS: [{ key: "thresholdUsdt", label: "每档复投金额（USDT）" }, { key: "ticketsPerThreshold", label: "每档创世抽奖券", integer: true }, { key: "ticketBudget", label: "抽奖券发放总量上限", integer: true }],
  discount: [{ key: "promotionActivityId", label: "关联促销活动编号", type: "text" }, { key: "extraGenesisTickets", label: "额外创世抽奖券", integer: true }, { key: "ticketBudget", label: "抽奖券发放总量上限", integer: true }],
  seasonal: [{ key: "voucherId", label: "关联全场八折券", type: "voucher" }, { key: "promotionActivityId", label: "叠加促销活动编号（可选）", type: "text" }, { key: "extraGenesisTickets", label: "额外创世抽奖券（需关联促销）", integer: true }, { key: "ticketBudget", label: "抽奖券发放总量上限", integer: true }],
  wheel: [],
};
export function eventRuleFields(row: Pick<EventRuleView, "kind" | "rules">): EventRuleField[] {
  const key = row.kind === "boost" ? String(row.rules.action ?? "") : row.kind;
  return EVENT_RULE_FIELDS[key] ?? [];
}
export function eventRegionText(value: unknown): string {
  return Array.isArray(value) ? value.map(region => `${region.name}: ${(region.countries ?? []).join(", ")}`).join("\n") : "";
}
export function parseEventRegions(text: string) {
  return text.split(/\r?\n/).filter(line => line.trim()).map(line => {
    const split = line.indexOf(":");
    const name = split < 0 ? "" : line.slice(0, split).trim();
    const countries = line.slice(split + 1).split(/[,\s]+/).filter(Boolean).map(value => value.toUpperCase());
    if (!name || !countries.length || countries.some(value => !/^[A-Z]{2}$/.test(value))) throw new Error("每行填写地区名称、冒号和两位国家代码，例如：东南亚: VN, TH。");
    return { name, countries };
  });
}
export function eventRuleMissingLabel(key: string): string {
  if (key.startsWith("localized.")) return `活动${key.includes(".zh.") ? "中文" : key.includes(".vi.") ? "越南语" : "三语"}文案（在活动内容区维护）`;
  const voucherIssue = ({ voucherId: "有效且已启用的百分比券（请在H7核对）", voucherDiscount: "优惠券须减免20%（八折），无最低消费及优惠封顶", voucherScope: "优惠券须面向全部用户、全硬件", voucherClaimSurface: "优惠券须允许商城领取", voucherPeriod: "优惠券有效期须覆盖活动全期", voucherStacking: "关联优惠券及促销政策均需允许叠加" } as Record<string, string>)[key];
  if (voucherIssue) return voucherIssue;
  const field = Object.values(EVENT_RULE_FIELDS).flat().find(field => field.key === key);
  return field?.label ?? ({ startsAt: "开始时间", endsAt: "结束时间", locales: "三语活动文案", promotion: "关联促销活动", allocation: "奖池分配规则", metric: "区域排名统计项目", "regions.countries": "参赛国家范围", regions: "参赛地区", wheel: "转盘奖池", rules: "玩法配置", stakingAppVisible: "请先在G1展示App质押功能" } as Record<string, string>)[key] ?? "参与条件或奖励配置";
}

export function eventRuleDraftRules(row: Pick<EventRuleView, "kind" | "rules"> & { eventCode?: string }): Record<string, unknown> {
  const action = row.eventCode === "evt-weekend-double-nex" ? "CHECKIN_MULTIPLIER" : row.eventCode === "evt-reinvest-bonus" ? "REINVEST_TICKETS" : null;
  return { ...row.rules, ...(action ? { action } : {}), ...(row.kind === "holding" ? { allocation: "EQUAL" } : row.kind === "regional" ? { allocation: "PROPORTIONAL_VOLUME", metric: "PAID_ORDER_USDT" } : {}) };
}
