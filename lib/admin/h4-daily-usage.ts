import { growthRequest } from "./h-client";

export type H4WheelDailyUsage = {
  serverDate: string;
  timeZone: "UTC";
  realPayoutUsdt: string | number | null;
  realPayoutAsset: "USDT";
  spinCount: number;
  tiers: Array<{ tierId: number; tierName: string; dailyStock: number | null; usedToday: number }>;
};

/** Independent read: a failed projection must not invalidate the H4 overview. */
export async function fetchH4WheelDailyUsage(): Promise<H4WheelDailyUsage> {
  const raw = await growthRequest<unknown>("/quest-events/wheel-daily-usage");
  if (!raw || typeof raw !== "object") throw new Error("H4_RESPONSE_INVALID");
  const row = raw as H4WheelDailyUsage;
  const count = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
  const amount = row.realPayoutUsdt;
  if (typeof row.serverDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.serverDate)
    || row.timeZone !== "UTC" || row.realPayoutAsset !== "USDT" || !count(row.spinCount)
    || !(amount === null || typeof amount === "number" && Number.isFinite(amount) && amount >= 0
      || typeof amount === "string" && /^\d+(?:\.\d+)?$/.test(amount))
    || !Array.isArray(row.tiers) || row.tiers.some(tier => !tier || !count(tier.tierId) || tier.tierId <= 0
      || typeof tier.tierName !== "string" || !(tier.dailyStock === null || count(tier.dailyStock)) || !count(tier.usedToday))) {
    throw new Error("H4_RESPONSE_INVALID");
  }
  return row;
}
