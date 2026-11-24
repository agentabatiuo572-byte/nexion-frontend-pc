import { growthRequest, validH4AppRewardPresentation, type H4AppRewardPresentation } from "./h-client";
import { h4CommandRequest, markH4Read, type H4ApprovalReceipt } from "./h4-mutations";

// Backend 04d11022: H4EventRuleService.CODES (lines 28–30), used by
// OpsGrowthService.supportsH4EventRules. Fallback for older reads without capability flags.
export const H4_EVENT_RULE_CODES = new Set([
  "evt-pro-upgrade-7d", "evt-refer-5-get-pro", "evt-weekend-double-nex", "evt-regional-pk",
  "evt-spring-spin", "evt-reinvest-bonus", "evt-onboarding-7d", "evt-black-friday", "evt-anniversary-spin",
]);

export interface EventRuleReadiness {
  ready: boolean;
  missing: string[];
  incomplete?: string[];
}

export interface EventRuleView extends H4AppRewardPresentation {
  eventCode: string;
  kind: string;
  revision: number;
  enabled: boolean;
  rulesLocked: boolean;
  startsAt: string | null;
  endsAt: string | null;
  rules: Record<string, unknown>;
  readiness: EventRuleReadiness;
  supported?: boolean;
  rewardCopyOnly?: boolean;
}
export type EventRuleReadback = EventRuleView;
export type EventRuleChange = Pick<EventRuleView, "enabled" | "startsAt" | "endsAt" | "rules">;
export interface EventVoucherOption { id: string; name: string; percent: number; status: "active" | "paused"; }
export function parseEventRule(value: unknown): EventRuleView {
  const row = value as EventRuleView | null;
  if (!row || typeof row.eventCode !== "string" || !row.eventCode || typeof row.kind !== "string"
    || [row.supported, row.rewardCopyOnly].some(value => value !== undefined && typeof value !== "boolean")
    || !Number.isSafeInteger(row.revision) || row.revision < 0 || typeof row.enabled !== "boolean" || typeof row.rulesLocked !== "boolean"
    || !row.rules || typeof row.rules !== "object" || Array.isArray(row.rules)
    || typeof row.readiness?.ready !== "boolean" || !Array.isArray(row.readiness.missing) || row.readiness.missing.some(item => typeof item !== "string")
    || row.readiness.incomplete !== undefined && (!Array.isArray(row.readiness.incomplete) || row.readiness.incomplete.some(item => typeof item !== "string"))
    || !validH4AppRewardPresentation(row)
    || [row.startsAt, row.endsAt].some(value => value !== null && (typeof value !== "string" || !Number.isFinite(Date.parse(value))))) throw new Error("活动规则读取失败，请刷新后重试。");
  return row;
}
export async function fetchEventRules(): Promise<EventRuleView[]> {
  markH4Read("rules", false);
  const result = await growthRequest<{ rules: unknown[] }>("/event-rules");
  if (!Array.isArray(result?.rules)) throw new Error("活动规则读取失败，请刷新后重试。");
  const rows = result.rules.map(parseEventRule);
  markH4Read("rules", true);
  return rows;
}
export async function fetchEventVouchers(): Promise<EventVoucherOption[]> {
  const result = await growthRequest<{ vouchers: Record<string, unknown>[] }>("/vouchers");
  if (!Array.isArray(result?.vouchers)) throw new Error("优惠券目录读取失败，请重试。");
  return result.vouchers.flatMap(row => {
    if (!row || typeof row.id !== "string" || !row.id.trim() || typeof row.name !== "string" || !row.name.trim()
      || !["fixed", "percent", "percentage"].includes(String(row.type)) || !["active", "paused"].includes(String(row.status))) throw new Error("优惠券目录读取失败，请重试。");
    if (row.type === "fixed") return [];
    const percent = Number(row.percent);
    if (!["number", "string"].includes(typeof row.percent) || !Number.isFinite(percent) || percent <= 0 || percent > 100) throw new Error("优惠券目录读取失败，请重试。");
    return [{ id: row.id.trim(), name: row.name.trim(), percent, status: row.status as EventVoucherOption["status"] }];
  });
}
export async function updateEventRule(eventCode: string, change: EventRuleChange, expectedRevision: number, reason: string, firstEnable = false, opened?: EventRuleView): Promise<EventRuleView | H4ApprovalReceipt> {
  return h4CommandRequest(`/event-rules/${encodeURIComponent(eventCode)}`, {
    method: "PATCH", body: JSON.stringify({ ...change, expectedRevision, reason }),
  }, `保存玩法配置 · ${eventCode}`, firstEnable, opened) as Promise<EventRuleView | H4ApprovalReceipt>;
}
