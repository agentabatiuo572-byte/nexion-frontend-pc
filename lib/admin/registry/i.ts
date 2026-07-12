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
    summary: "全站转化文案的版本管理 + A/B 测试台(I1):这里只改措辞,不动费率和奖励,也不碰备付金红线;但每次发布、回滚、开实验都会直接改变所有用户看到的内容,所以一律要确认。实验分组由服务器分配、且对同一个用户固定不变,本地篡改污染数据服务器不认;文案正文挂在双语词条(I6)里,发布前自动检查中英文一一对应、占位符也对得上。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/content/nova",
    summary: "Nova 站内 AI 助手的推送运营页(I2):10 个可调通道的节奏表 + 单个通道的开关 + 模板池 + 真实事件池(5 类按概率派发、合计 100%)。关单个通道不算应急熔断(不占 J1/J2 闸位)、也不是地区屏蔽——停某个频道的推送在本页确认即可;只有「要把整个 Nova 能力停掉」才轮到 J 域出手。两个随阶段变的通道(以旧换新提醒、月度任务锁提醒)由 H1 节奏说了算,本页只读跟随。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/content/notifications",
    summary: "系统通知的批量下发台 + 4 档优先级容量限制(I3):紧急级永不丢弃、不限量(合规硬要求、不可调低) / 高 50 条 / 普通 200 条 / 低 30 条(超时清理)。一次群发动辄几十万人,所以一律要确认;通知的唯一账本在服务器,App 端只是个显示窗口。合规特例:I5 的风险披露重新确认、J 域的监管应急公告都走紧急级,且要合规角色或超级管理员才能发。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/content/trust",
    summary: "信任中心内容管理(I4):用户端 /trust 页的 6 个版块(财务数字 / 团队 / NEX 故事 / 徽章 / 审计 / 外链)。草稿由内容角色直接保存；发布、回滚和下架按普通版块与敏感版块分权，财务数字 / NEX 叙事发布时必须填写数据来源并完成中越双语核对。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/content/disclosures",
    summary: "风险披露版本管理(I5):4 个法域 × 7 章节的披露矩阵、版本快照、用户重新确认覆盖监控和受限动作范围。披露由风控起草，风控主管或超级管理员发布；重新确认不是熔断开关，不占 J1/J2 闸位。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/content/i18n",
    summary: "全站文案双语底座(I6):约 770 条词条 × 30 多个分类，I1 转化、I2 模板、I4 信任、I5 披露和 I7 课程文案都引用这里。改任何词条都必须中英文一起改，缺一边或占位符对不上就拒绝发布。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/content/learn",
    summary: "学习赚钱教程中心(I7):课程目录、推荐位、发布状态、完成奖励与效果指标独立管理。课程奖励上调会放大 NEX 流出，必须进入高敏审批并通过 B1 备付金红线。",
    content: PORTED_EMPTY_CONTENT,
  },
];

export default DOMAIN_I;
