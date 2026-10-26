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
    summary: "全站转化文案的版本管理 + 文案对比测试(I1):这里只改措辞,不动费率和奖励,也不碰备付金红线;但每次发布、回滚、开实验都会直接改变所有用户看到的内容,所以一律要确认。实验分组由服务器分配、且对同一个用户固定不变,本地篡改污染数据服务器不认;文案正文挂在双语词条(I6)里,发布前自动检查中英文一一对应、占位符也对得上。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/content/nova",
    summary: "管理消息频道、推送间隔、模板和业务事件；单个频道在本页启停，整体停用前往紧急控制。随运营阶段变化的频道仅可查看。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/content/notifications",
    summary: "系统通知的批量下发台 + 4 档优先级容量限制(I3):紧急级永不丢弃、不限量(合规硬要求、不可调低) / 高 50 条 / 普通 200 条 / 低 30 条(超时清理)。一次群发动辄几十万人,所以一律要确认;通知的唯一账本在服务器,App 端只是个显示窗口。合规特例:I5 的风险披露重新确认、J 域的监管应急公告都走紧急级,且要合规角色或超级管理员才能发。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/content/trust",
    summary: "信任中心内容管理(I4):用户端 信任中心页面的 6 个版块(财务数字 / 团队 / UVT介绍 / 徽章 / 审计 / 外链)。草稿由内容角色直接保存；发布、回滚和下架按普通版块与敏感版块分权，财务数字 / UVT介绍发布时必须填写数据来源并完成中越英三语核对。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/content/disclosures",
    summary: "风险披露版本管理(I5):按适用地区 × 7 章节管理披露矩阵、版本快照、用户重新确认覆盖监控和受限动作范围；适用地区数量以服务器配置目录为准。披露由风控起草，风控主管或超级管理员发布；重新确认不是紧急停止开关，不占 J1/J2 闸位。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/content/i18n",
    summary: "多语言文案(I6)与课程管理统一入口:词条、课程目录、推荐位、发布状态、完成奖励与效果指标都在同一服务端概览中管理。课程奖励上调会放大 UVT 流出，必须进入敏感审批并通过 B1 备付金红线。",
    content: PORTED_EMPTY_CONTENT,
  },
];

export default DOMAIN_I;
