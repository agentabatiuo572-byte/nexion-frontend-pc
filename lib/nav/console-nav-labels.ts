import type { AdminRole, BuiltinAdminRole } from "./console-nav";

export const D5_MENU_NAME = "USDT 提现参数";

export const ROLE_LABEL: Record<BuiltinAdminRole, string> = {
  superadmin: "超级管理员",
  config: "配置运营",
  finance: "财务",
  risk: "风控",
  content: "内容运营",
  growth: "增长运营",
  support: "客服",
  auditor: "审计",
};

/** 后端按岗位给的角色码，不是内置角色，顶栏也要写人话（D2 大额放行按 FINANCE_LEAD 判断）。 */
const LEAD_ROLE_LABEL: Record<string, string> = { FINANCE_LEAD: "财务主管", RISK_LEAD: "风控主管" };

export function roleLabel(role: AdminRole): string {
  return ROLE_LABEL[role as BuiltinAdminRole] ?? LEAD_ROLE_LABEL[role] ?? role;
}
