/**
 * 域 I 内容与合规 CMS — 注册表。accent=--admin-domain-i。
 * ⚠️ I ∈ PORTED_DOMAINS:本文件 content 为死代码(真渲染面 = i-view.tsx + i-tabs/),
 * 仅 summary 经 DomainHeader 渲染(design_handoff_i_domain f-desc 压缩版,2026-06-11)。
 * 6 页覆盖 8 子模块:I1 / I2 / I3 / I4+I5(合并) / I6+I7(合并) / I8 support。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";

const placeholder = { kind: "dashboard" as const };

export const DOMAIN_I: ModuleEntry[] = [
  {
    path: "/content/copy-ab",
    summary: "全站转化文案位的版本管理 + A/B 实验台(I1):改的是措辞、不动费率和奖励,不碰备付金红线;每次发布 / 回滚 / 开实验都直接改变全体用户所见,一律操作确认。实验分组由服务器分配且对单个用户固定,本地篡改污染数据服务器不认;文案本体挂双语词条(I6),发布前自动校验中英镜像 + 占位符一致。",
    content: placeholder,
  },
  {
    path: "/content/nova",
    summary: "Nova 站内 AI 助手的推送运营面(I2):10 可调通道节奏表 + 单通道 kill 启停 + 模板池 + social 真实事件池(5 类按概率派发,合计 100%)。通道 kill 不入 J1/J2 应急熔断闸位,也不是地区屏蔽 —— 频道停推走这页操作确认;只有「Nova 整体作为能力要停掉」才轮到 J 域出手。两个随阶段变的通道(tradein/taskLockMonthly)由 H1 节奏说了算,这页只读跟随。",
    content: placeholder,
  },
  {
    path: "/content/notifications",
    summary: "系统通知的批量下发台 + 4 档优先级容量闸(I3):critical 永不淘汰 ∞(合规硬约束、不可调降) / high 50 / normal 200 / low 30(TTL)。批量触达动辄几十万人,一律操作确认;通知唯一账本在服务器,App 端只是显示窗口。合规通道特例:I4-I5 风险披露重确认 + J 域监管应急公告走 critical,执行门槛 升合规/超管。",
    content: placeholder,
  },
  {
    path: "/content/trust",
    summary: "信任中心 CMS + 风险披露版本管理(I4+I5):/trust 6 版块(财务数字 / 团队 / NEX 叙事 / 徽章 / 审计 / 外链)+ 4 法域 × 7 章节披露矩阵 + re-ack 覆盖监控 + 受限动作范围(withdraw 已实装 / staking·nexv2 待接线)。执行门槛两套:I4 财务数字 / NEX 叙事 / 合规声明须合规或超管,其余内容主管;I5 全链 操作员=风控 / 执行门槛=风控 lead 或超管,内容仅草拟。re-ack 不是熔断闸,不占 J1/J2 闸位。",
    content: placeholder,
  },
  {
    path: "/content/disclosure",
    summary: "风险披露版本管理入口已合并到 I4 信任中心与披露页(/content/trust);本路由保留作 PRD 锚点占位,真渲染面与 I4 同页。",
    content: placeholder,
  },
  {
    path: "/content/i18n",
    summary: "全站文案双语底座 + Learn-to-Earn 教程面(I6+I7):约 770 词条 × 30+ 命名空间(I1 转化 / I2 模板 / I4 信任 / I5 披露 / I7 课程全引用这里);任何词条改动必须中英一起改,缺一边或占位符对不上发布直接拒(单语言发布暴露「假平台」破绽,这道闸不许关)。15 课 × 5 分类 + 推荐位 + 完成发 NEX —— 涨课程奖励是放大代币流出,提交即过 B1 备付金红线。",
    content: placeholder,
  },
  {
    // audit P0 修:console-nav I7 path = /content/learn,registry 必须有对应条目(否则 DomainHeader summary 空),
    // I7 渲染面已与 I6 合并到 i6-i18n.tsx(IDomainView FOLD["I7"]="I6"),本路由仅作 PRD 锚点占位。
    path: "/content/learn",
    summary: "教程中心(I7)已与 i18n 文案管理(I6)合并到一页(/content/i18n);15 课 × 5 分类 + 推荐位 + 完成发 NEX,涨课程奖励是放大代币流出,提交即过 B1 备付金红线。本路由保留作 PRD 锚点,真渲染面同 /content/i18n。",
    content: placeholder,
  },
  {
    path: "/content/support",
    summary: "客服支持 CMS(I8):Help/FAQ 内容池 + ticket 分类与 SLA + 工单列表与运营回复。字段镜像 UniApp support ticket mock(id/category/subject/status/priority/lastReplyAt/messages/owner);回复、分配、改状态、关闭/重开都是真写 platform-config 并留 A2 审计。真正资金放行、账户安全、设备换货分别升级回 D2/C5/E5,本页只做客服解释与工单流转。",
    content: placeholder,
  },
];

export default DOMAIN_I;
