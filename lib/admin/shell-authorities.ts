import type { AdminSession } from "@/lib/store/admin-auth";

export const B_DASHBOARD_READ_AUTHORITIES = [
  "overview_b1_read",
  "overview_b2_read",
  "overview_b3_read",
  "overview_b4_read",
  "overview_b5_read",
] as const;

export const L_BI_READ_AUTHORITIES = [
  "bi_l1_read",
  "bi_l2_read",
  "bi_l3_read",
  "bi_l4_read",
  "bi_l5_read",
  "bi_l6_read",
] as const;

export const M_CONTENT_READ_AUTHORITIES = [
  "service_m1_read",
  "service_m2_read",
  "service_m3_read",
  "service_m4_read",
  "service_m5_read",
] as const;

export function canReadC2HighRiskAlerts(session: AdminSession | null): boolean {
  if (!session || !session.authorities.includes("user_c2_read")) return false;
  const roleCode = session.role.trim().toUpperCase();
  return roleCode === "SUPER_ADMIN" || roleCode === "RISK";
}

export function adminShellSessionKey(session: AdminSession | null, authEpoch = 0): string {
  if (!session) return `anonymous|${authEpoch}`;
  const authorities = [...session.authorities].sort().join(",");
  const menuCodes = [...(session.menuCodes ?? [])].sort().join(",");
  return `${authEpoch}|${session.adminId}|${authorities}|${menuCodes}`;
}
