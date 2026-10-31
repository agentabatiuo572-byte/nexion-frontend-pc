export type DepositPolicy = { minDepositUsdt: string; feeUsdt: string; confirmations: number; version: number };

export function depositPolicyUnits(value: string): bigint | null {
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(1000000) + BigInt(fraction.padEnd(6, "0"));
}

export function validDepositPolicy(min: string, fee: string, confirmations: number): boolean {
  const minimum = depositPolicyUnits(min), cost = depositPolicyUnits(fee);
  return minimum !== null && minimum > BigInt(0) && minimum % BigInt(1000000) === BigInt(0) && cost !== null && cost < minimum
    && Number.isSafeInteger(confirmations) && confirmations >= 15 && confirmations <= 10000;
}

export function parseDepositPolicy(value: unknown): DepositPolicy {
  const p = value as DepositPolicy;
  if (!p || typeof p !== "object" || typeof p.minDepositUsdt !== "string" || typeof p.feeUsdt !== "string"
    || !validDepositPolicy(p.minDepositUsdt, p.feeUsdt, p.confirmations) || !Number.isSafeInteger(p.version) || p.version < 0)
    throw new Error("充值规则读取不完整，请刷新核对。");
  return p;
}
