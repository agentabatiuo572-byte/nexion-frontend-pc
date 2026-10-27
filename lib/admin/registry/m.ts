/**
 * 域 M 已 port 视图注册表。
 * 真渲染面在 m-view.tsx / m-tabs/*;本文件只保留路由 summary。
 * content 固定为空,避免 ModulePage 复活旧静态/样本业务数据。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";
import { PORTED_EMPTY_CONTENT } from "./ported-content";
export const DOMAIN_M: ModuleEntry[] = [
  {
    path: "/service/overview",
    summary: "查看本人客户、待办与维护进展；主管可审阅客户并办理分配和交接。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/service/tickets",
    summary: "处理客户提交的工单：回复客户、记内部备注、调整状态与优先级；负责人跟随客户的专属客服。资金、账户和设备的处置请到对应模块办理。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/service/sessions",
    summary: "与本人专属客户沟通；主管可审阅，客户归属变更须走正式转绑。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/service/leaderboard",
    summary: "查看公开客服业绩与完整榜单名次；客户明细仍按原有权限开放。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/service/kb-sla",
    summary: "维护帮助中心的常见问答。修改内容须确认并填写理由。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/service/scripts",
    summary: "配置服务规则、待分配处理方式和客服话术。",
    content: PORTED_EMPTY_CONTENT,
  },
];

export default DOMAIN_M;
