/**
 * 域 M 客服中心 — 注册表。accent=--admin-domain-m。
 * ⚠️ M ∈ PORTED_DOMAINS:本文件 content 为死代码(真渲染面 = m-view.tsx + m-tabs/),
 * 仅 summary 经 DomainHeader 渲染。M 抽 I8(工单)+ I9(即时会话)重组,真写键沿用 I.support.* 与 I.session.* 命名空间。
 * 5 页:M1 客服总览 / M2 工单台 / M3 即时会话台 / M4 知识库与 SLA / M5 话术与模板配置。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";

const placeholder = { kind: "dashboard" as const };

export const DOMAIN_M: ModuleEntry[] = [
  {
    path: "/service/overview",
    summary: "客服工作的实时概况:多少工单在处理、多少会话在接待、哪类工单快超时、坐席忙不忙。只看不改;要动手去工单台 / 会话台。",
    content: placeholder,
  },
  {
    path: "/service/tickets",
    summary: "用户提的问题在这排队处理。点一行打开工单详情:回复 / 改状态 / 转交坐席 / 关单;要实时沟通就升级为即时会话。真正放钱回 D2、账户处置回 C5、设备换货回 E5,本页只做客服答复和工单流转。",
    content: placeholder,
  },
  {
    path: "/service/sessions",
    summary: "和用户实时聊天接待。能主动发起会话找用户、把会话跨坐席转交给别的客服 / 技能队列 / 备勤池、处理别人转入待处理的会话、把会话转成工单;切到别的页面也不断线,切回来接着聊。涉及提现 / 实名的咨询去开工单。",
    content: placeholder,
  },
  {
    path: "/service/kb-sla",
    summary: "维护帮助中心的常见问答,设定每类工单多久要首次响应、多久要解决。改动要确认并填理由。",
    content: placeholder,
  },
  {
    path: "/service/scripts",
    summary: "管顾问主动推送的开关、频率和人群,以及顾问话术和客服快捷回复模板。改动要确认并填理由。",
    content: placeholder,
  },
];

export default DOMAIN_M;
