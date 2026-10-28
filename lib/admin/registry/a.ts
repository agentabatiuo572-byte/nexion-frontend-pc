/**
 * 域 A 已 port 视图注册表。
 * 真渲染面在 a-view.tsx / a-tabs/*;本文件只保留路由 summary。
 * content 固定为空,避免 ModulePage 复活旧静态/样本业务数据。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";
import { PORTED_EMPTY_CONTENT } from "./ported-content";
export const DOMAIN_A: ModuleEntry[] = [
  {
    path: "/platform/rbac",
    summary: "管理后台账号：开户、停用、改角色、重置两步验证和强制下线。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/platform/audit",
    summary: "查看后台所有敏感操作的记录，处理等待确认的操作。记录只能新增，不能修改或删除。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/platform/config",
    summary: "全平台通用设置：功能开关、业务时区和平台参数，并可查看紧急开关状态和系统运行状况。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/platform/events",
    summary: "登记和维护用户行为事件。运营总览、对账、风控和报表都按这些事件统计；事件里不得包含用户隐私信息。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/platform/params-registry",
    summary: "汇总全平台可调参数的当前值，修改请点进所在页面。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/platform/roles",
    summary: "管理后台角色，设置每个角色能做的操作和能看的菜单。修改立即对该角色下的所有账号生效。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/platform/menus",
    summary: "调整后台左侧菜单的名称、顺序和显示。只有已上线的页面才能加入菜单。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/platform/permissions",
    summary: "查看全平台的操作权限，以及每项权限属于哪个菜单、分给了几个角色。权限项由系统维护，这里只能查看。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/platform/developer-access",
    summary: "审批开发者的访问申请：批准、驳回或撤销。",
    content: PORTED_EMPTY_CONTENT,
  },
];

export default DOMAIN_A;
