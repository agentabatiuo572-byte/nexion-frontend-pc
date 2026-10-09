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
    summary: "用户提的问题在这排队处理。点一行打开工单详情:回复 / 改状态 / 转交坐席 / 关单;要实时沟通就升级为即时会话。真正放钱回 D2、账户处置回 C5、设备换货回 E5,本页只做客服答复和工单流转。",
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
    summary: "维护帮助中心的常见问答,设定每类工单多久要首次响应、多久要解决。改动要确认并填理由。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/service/scripts",
    summary: "配置服务规则、坐席资格以及客服话术；规则修改须确认并填写理由。",
    content: PORTED_EMPTY_CONTENT,
  },
];

export default DOMAIN_M;
