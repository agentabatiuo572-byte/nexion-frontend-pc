import { approvalPermissionText } from "@/lib/admin/f-approval-names";
import { operatorCopyText } from "@/lib/admin/operator-copy";

/** A1、A6 审批要的权限，名字照后台返回的写（GET /platform/permissions，「权限清单」也显示这些）；哪几项由 AuditReplayBusinessPermissionGuard 检查。 */
const A2_APPROVE = "操作记录与审批 · 执行/放行(高敏工单)";
export const A_APPROVAL_PERMISSION_NAMES = {
  platform_a1_write: "运营账号与权限 · 运营账号&RBAC-页面常规写",
  platform_a1_account_role_change: "运营账号与权限 · 改角色",
  platform_a1_account_2fa_reset: "运营账号与权限 · 重置2FA",
  platform_a1_account_disable: "运营账号与权限 · 禁用账号",
  platform_a6_write: "角色管理 · 角色元数据CRUD",
  platform_a6_role_grants_update: "角色管理 · 改角色权限/菜单绑定",
} as const;

/** 「需有权限」一行：批准权限加业务权限，写法和「权限清单」一样（operatorCopyText）。 */
export const aApprovalPermissionText = (...names: string[]) => approvalPermissionText([A2_APPROVE, ...names].map(operatorCopyText));

/** A1、A6 审批单各自要的业务权限；批准人在「操作记录与审批」看到的和发起时一样。 */
const A_TICKET_PERMISSIONS: Readonly<Record<string, readonly (keyof typeof A_APPROVAL_PERMISSION_NAMES)[]>> = {
  a1_account_change_role: ["platform_a1_account_role_change"],
  a1_account_reset_2fa: ["platform_a1_account_2fa_reset"],
  a1_account_update_profile: ["platform_a1_write"],
  a1_account_status_update: ["platform_a1_account_disable"],
  a1_account_force_logout: [],
  a1_account_create: [],
  a6_role_status_update: ["platform_a6_write"],
  a6_role_disable: ["platform_a6_write"],
  a6_role_delete: ["platform_a6_write"],
  a6_role_grants_update: ["platform_a6_role_grants_update"],
};

/** 这张 A1、A6 单的「需有权限」；别的单返回 undefined。新建账号设了头像的多一项，单子里看不出有没有头像，写成条件。 */
export function aTicketPermissionText(op: string | undefined) {
  const codes = op === undefined ? undefined : A_TICKET_PERMISSIONS[op];
  if (!codes) return undefined;
  const text = aApprovalPermissionText(...codes.map(code => A_APPROVAL_PERMISSION_NAMES[code]));
  return op === "a1_account_create" ? `${text}；设了头像的还要${approvalPermissionText([operatorCopyText(A_APPROVAL_PERMISSION_NAMES.platform_a1_write)])}` : text;
}
