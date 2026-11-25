import { fApprovalPermissionText } from "@/lib/admin/f-approval-names";
import { operatorCopyText } from "@/lib/admin/operator-copy";

/** A1、A6 审批要的业务权限，名字照后台返回的写（AuditReplayBusinessPermissionGuard 实际检查的那几项）。 */
export const A_APPROVAL_PERMISSION_NAMES = {
  platform_a1_write: "A1 运营账号&RBAC-页面常规写",
  platform_a1_account_role_change: "A1 改角色",
  platform_a1_account_2fa_reset: "A1 重置2FA",
  platform_a1_account_disable: "A1 禁用账号",
  platform_a6_write: "A6 角色元数据CRUD",
  platform_a6_role_grants_update: "A6 改角色权限/菜单绑定",
} as const;

/** 「需有权限」一行：批准权限加业务权限，显示写法和「权限清单」一样。 */
export const aApprovalPermissionText = (...names: string[]) => fApprovalPermissionText(...names.map(operatorCopyText));
