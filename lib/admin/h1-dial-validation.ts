/** Validate before either a direct write or an A2 proposal is created. */
export function validateH1DialValue(key: string, value: string | number): void {
  if (key !== "withdrawCooldownDays") return;
  const days = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  if (!Number.isInteger(days) || days < 0 || days > 90) {
    throw new Error("到账审查天数必须为 0–90 的整数；0 天表示无需等待常规审查");
  }
}
