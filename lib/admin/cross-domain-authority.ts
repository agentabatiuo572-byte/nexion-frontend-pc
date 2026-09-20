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

/**
 * 目标路径 → 所需 read 权限码。
 *
 * 只认 pathname:调用方拿到的 href 常带查询串/锚点(B4 的 B3 归因入口是后端下发的
 * `/overview/funnel?phase=ALL`,B5 的告警目标同理)。按整串精确查表会让带查询串的
 * 目标落空 → 判定为"未知目标" → 连 superadmin 都被判无权,而同一个页面直接打开却
 * 正常。查询串不改变目标域,故先剥离再查。
 */
export function requiredReadAuthority(path: string): string | null {
  const pathname = path.split(/[?#]/, 1)[0];
  return READ_AUTHORITY_BY_PATH[pathname as keyof typeof READ_AUTHORITY_BY_PATH] ?? null;
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
