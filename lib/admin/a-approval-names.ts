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
