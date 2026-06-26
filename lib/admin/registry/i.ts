/**
 * 域 I 内容与合规 CMS — 注册表。accent=--admin-domain-i。
 * ⚠️ I ∈ PORTED_DOMAINS:本文件 content 为死代码(真渲染面 = i-view.tsx + i-tabs/),
 * 仅 summary 经 DomainHeader 渲染(design_handoff_i_domain f-desc 压缩版,2026-06-11)。
 * 5 页覆盖合并后的内容域:I1 / I2 / I3 / I4 信任中心与披露 / I6 i18n 文案与教程。客服 I8/I9 已迁出至域 M 客服中心。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";

const placeholder = { kind: "dashboard" as const };

export const DOMAIN_I: ModuleEntry[] = [
  {
    path: "/content/copy-ab",
    summary: "全站转化文案的版本管理 + A/B 测试台(I1):这里只改措辞,不动费率和奖励,也不碰备付金红线;但每次发布、回滚、开实验都会直接改变所有用户看到的内容,所以一律要确认。实验分组由服务器分配、且对同一个用户固定不变,本地篡改污染数据服务器不认;文案正文挂在双语词条(I6)里,发布前自动检查中英文一一对应、占位符也对得上。",
    content: placeholder,
  },
  {
    path: "/content/nova",
    summary: "Nova 站内 AI 助手的推送运营页(I2):10 个可调通道的节奏表 + 单个通道的开关 + 模板池 + 真实事件池(5 类按概率派发、合计 100%)。关单个通道不算应急熔断(不占 J1/J2 闸位)、也不是地区屏蔽——停某个频道的推送在本页确认即可;只有「要把整个 Nova 能力停掉」才轮到 J 域出手。两个随阶段变的通道(以旧换新提醒、月度任务锁提醒)由 H1 节奏说了算,本页只读跟随。",
    content: placeholder,
  },
  {
    path: "/content/notifications",
    summary: "系统通知的批量下发台 + 4 档优先级容量限制(I3):紧急级永不丢弃、不限量(合规硬要求、不可调低) / 高 50 条 / 普通 200 条 / 低 30 条(超时清理)。一次群发动辄几十万人,所以一律要确认;通知的唯一账本在服务器,App 端只是个显示窗口。合规特例:I4 的风险披露重新确认、J 域的监管应急公告都走紧急级,且要合规角色或超级管理员才能发。",
    content: placeholder,
  },
  {
    path: "/content/trust",
    summary: "信任中心内容管理 + 风险披露版本管理(I4):用户端 /trust 页的 6 个版块(财务数字 / 团队 / NEX 故事 / 徽章 / 审计 / 外链)+ 4 个法域 × 7 章节的披露矩阵 + 用户重新确认的覆盖监控 + 受限动作范围(提现已接通 / 质押待接线)。两套权限:财务数字 / NEX 故事 / 合规声明要合规角色或超级管理员改、其余内容由内容主管改;披露全程由风控发起、风控主管或超级管理员执行,内容岗只能起草。重新确认不是熔断开关,不占 J1/J2 闸位。",
    content: placeholder,
  },
  {
    path: "/content/i18n",
    summary: "全站文案双语底座 + 学习赚钱教程页(I6):约 770 条词条 × 30 多个分类(I1 转化、I2 模板、I4 信任与披露、教程课程都引用这里)。改任何词条都必须中英文一起改,缺一边或占位符对不上就直接拒绝发布(只发一种语言会露出「假平台」破绽,这道闸不许关)。15 节课 × 5 个分类 + 推荐位 + 学完发 NEX——调高课程奖励属于放大代币流出,提交时就要过 B1 备付金红线。",
    content: placeholder,
  },
];

export default DOMAIN_I;
