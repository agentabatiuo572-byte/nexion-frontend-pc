/**
 * 域 I 已 port 视图注册表。
 * 真渲染面在 i-view.tsx / i-tabs/*;本文件只保留路由 summary。
 * content 固定为空,避免 ModulePage 复活旧静态/样本业务数据。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";
import { PORTED_EMPTY_CONTENT } from "./ported-content";
export const DOMAIN_I: ModuleEntry[] = [
  {
    path: "/content/copy-ab",
    summary: "管理全站转化文案的版本，做文案对比测试。发布、回滚和开测试会立即改变用户看到的内容；同一用户始终看到同一版本。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/content/nova",
    summary: "管理 Nova 消息频道、推送间隔、模板和触发事件。单个频道在这里启停，全部停用请到「紧急停用开关」。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/content/notifications",
    summary: "批量给用户发系统通知，设置各优先级通知的保留条数。紧急通知始终保留，只有合规角色或超级管理员能发。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/content/trust",
    summary: "编辑 App 信任中心的 6 个版块：财务数据、团队、UVT 介绍、徽章、审计和外部链接。财务数据和 UVT 介绍发布时须注明数据来源，并核对中英越三语。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/content/disclosures",
    summary: "按地区管理风险披露的 7 个章节和历史版本，查看用户重新确认的进度。风控起草，风控主管或超级管理员发布。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/content/i18n",
    summary: "管理多语言文案和课程：词条、课程、推荐位、发布状态和完成奖励。调高课程奖励需审批，并先通过兑付覆盖率检查。",
    content: PORTED_EMPTY_CONTENT,
  },
];

export default DOMAIN_I;
