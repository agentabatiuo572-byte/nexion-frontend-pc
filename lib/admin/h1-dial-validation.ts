/** OpsGrowthService.normalizePhaseDialValue; fee bounds are in the existing percent display unit. */
export const H1_DIAL_LIMITS = {
  newUserBonusMultiplier: { min: 1, max: 4 },
  inviteRewardMultiplier: { min: 1, max: 4 },
  reinvestMultiplier: { min: 1, max: 4 },
  questBonusMultiplier: { min: 1, max: 4 },
  withdrawPenaltyFeeRate: { min: 0, max: 100 },
  withdrawCooldownDays: { min: 0, max: 90 },
  binaryDailyCap: { min: 0, max: 50000 },
  complianceHoldEnabled: { min: 0, max: 1 },
} as const;


/** Validate before either a direct write or an A2 proposal is created. */
export function validateH1DialValue(key: string, value: string | number): void {
  const issue = h1DialIssue(key, String(value));
  if (issue) throw new Error(issue);
}

export function h1DialIssue(key: string, value: string): string | undefined {
  if (key === "complianceHoldEnabled") return ["否", "是"].includes(value) ? undefined : "请选择否或是";
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) return "请填数字，最多六位小数";
  const next = Number(value);
  const limits = H1_DIAL_LIMITS[key as keyof typeof H1_DIAL_LIMITS] ?? H1_DIAL_LIMITS.newUserBonusMultiplier;
  if (key === "withdrawCooldownDays") return Number.isInteger(next) && next >= limits.min && next <= limits.max ? undefined : "到账审查窗口须为 0–90 的整数天；0 天也要人工审查";
  if (key === "binaryDailyCap") return next >= limits.min && next <= limits.max ? undefined : "每日上限须为 0–50,000 USD，可以是 0";
  return next >= limits.min && next <= limits.max ? undefined : "加成须为 1–4 倍";
}
