/** BinarySettlementPolicyProvider at 111e00cd: trim + Locale.ROOT case folding. */
export function f3PauseState(raw: string | undefined): boolean | null {
  const value = raw?.trim().toLowerCase();
  if (["true", "1", "on"].includes(value ?? "")) return true;
  if (["false", "0", "off"].includes(value ?? "")) return false;
  return null;
}

export function f3SpilloverState(raw: string | undefined): boolean | null {
  const value = raw?.trim();
  return value === "已启用" ? true : value === "已关闭" ? false : f3PauseState(value);
}

/** BigDecimal.scale() counts trailing zeroes and subtracts the exponent. */
export function validF3Threshold(raw: string): boolean {
  const match = /^[+-]?(?:\d+(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(raw.trim());
  const value = Number(raw);
  return !!match && Number.isFinite(value) && value > 0 && value <= 5000
    && (match[1] ?? match[2] ?? "").length - Number(match[3] ?? 0) <= 6;
}
