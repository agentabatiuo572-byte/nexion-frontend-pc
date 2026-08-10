const READ_AUTHORITY_BY_PATH = {
  "/finance/pool": "finance_d3_read",
  "/overview/dual-ledger": "overview_b1_read",
  "/overview/risk-radar": "overview_b5_read",
  "/analytics/funnel-cohort": "bi_l2_read",
  "/growth/phase": "growth_h1_read",
  "/platform/events": "platform_a4_read",
  "/overview/funnel": "overview_b3_read",
  "/overview/liquidity": "overview_b2_read",
  "/finance/withdrawals": "finance_d2_read",
  "/risk/multi-account": "risk_k1_read",
  "/risk/abuse": "risk_k2_read",
  "/emergency/tamper": "emergency_j3_read",
  "/risk/scoring": "risk_k4_read",
  "/emergency/kill-switch": "emergency_j1_read",
} as const;

export function requiredReadAuthority(path: string): string | null {
  return READ_AUTHORITY_BY_PATH[path as keyof typeof READ_AUTHORITY_BY_PATH] ?? null;
}

export function canAccessCrossDomainPath(
  path: string,
  role: string | null | undefined,
  authorities: readonly string[],
): boolean {
  const required = requiredReadAuthority(path);
  if (!required) return false;
  return role === "superadmin" || role === "super" || authorities.includes(required);
}
