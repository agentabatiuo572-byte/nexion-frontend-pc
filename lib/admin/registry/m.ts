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
    summary: "查看你的客户、待办和维护进度；主管还可以分配和交接客户。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/service/tickets",
    summary: "处理客户工单：回复、写内部备注、改状态和优先级。资金、账户和设备问题请到对应页面处理。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/service/sessions",
    summary: "和你负责的客户沟通；主管可查看所有会话。更换客户的专属客服需走转绑流程。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/service/leaderboard",
    summary: "查看客服业绩榜和名次。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/service/kb-sla",
    summary: "维护帮助中心的常见问题。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/service/scripts",
    summary: "设置服务规则、未分配客户的处理方式和客服常用话术。",
    content: PORTED_EMPTY_CONTENT,
  },
];

export default DOMAIN_M;
