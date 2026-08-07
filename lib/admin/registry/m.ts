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
    summary: "客服工作的实时概况:多少工单在处理、多少会话在接待、哪类工单快超时、坐席忙不忙。指标本身只读;授权主管可维护客服坐席与负载策略。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/service/tickets",
    summary: "用户提的问题在这排队处理。点一行打开工单详情:回复 / 改状态 / 转交坐席 / 关单;要实时沟通就升级为即时会话。真正放钱回 D2、账户处置回 C5、设备换货回 E5,本页只做客服答复和工单流转。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/service/sessions",
    summary: "和用户实时聊天接待。能主动发起会话找用户、把会话跨坐席转交给别的客服 / 技能队列 / 备勤池、处理别人转入待处理的会话、把会话转成工单;切到别的页面也不断线,切回来接着聊。涉及提现或账户安全处置的咨询去开工单。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/service/kb-sla",
    summary: "维护帮助中心的常见问答,设定每类工单多久要首次响应、多久要解决。改动要确认并填理由。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/service/scripts",
    summary: "管顾问主动推送的开关、频率和人群,以及顾问话术和客服快捷回复模板。改动要确认并填理由。",
    content: PORTED_EMPTY_CONTENT,
  },
];

export default DOMAIN_M;
