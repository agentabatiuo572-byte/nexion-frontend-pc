/** Validate before either a direct write or an A2 proposal is created. */
export function validateH1DialValue(key: string, value: string | number): void {
  const issue = h1DialIssue(key, String(value));
  if (issue) throw new Error(issue);
}

export function h1DialIssue(key: string, value: string): string | undefined {
  if (key === "complianceHoldEnabled") return ["否", "是"].includes(value) ? undefined : "请选择否或是";
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) return "请填有效数字，最多六位小数，不使用科学计数法";
  const next = Number(value);
  if (key === "withdrawCooldownDays") return Number.isInteger(next) && next >= 0 && next <= 90 ? undefined : "到账审查窗口须为 0–90 的整数天；0 天仍需人工审查";
  if (key === "binaryDailyCap") return next >= 0 && next <= 50000 ? undefined : "每日上限须为 0–50,000 USD；0 是合法上限";
  return next >= 1 && next <= 4 ? undefined : "加成须为 1–4 倍";
}
