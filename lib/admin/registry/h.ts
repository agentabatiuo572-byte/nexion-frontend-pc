/**
 * 域 H 已 port 视图注册表。
 * 模块:H1 运营阶段设置 · H2 免费试用设置 · H3 用户任务管理 · H4 活动中心 · H5 签到 & NEX ·
 *       H7 代金券 · H8 新人礼与邀请奖励 · H9 历史数据展示设置。
 * 真渲染面在 h-view.tsx / h-tabs/*;本文件只保留路由 summary。
 * content 固定为空,避免 ModulePage 复活旧静态/样本业务数据。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";
import { PORTED_EMPTY_CONTENT } from "./ported-content";
export const DOMAIN_H: ModuleEntry[] = [
  {
    path: "/growth/phase",
    summary: "设置运营节奏：总时长、当前运营月、各阶段参数，以及对部分用户的单独设置。放宽设置前需先通过兑付覆盖率检查。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/growth/trial",
    summary: "设置免费试用的时长、资格、冷却期和防刷规则，查看试用进行情况，可随时急停自动推送。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/growth/quest",
    summary: "管理用户任务清单。任务奖励倍数随运营阶段变化，在「运营阶段设置」调整；调高任务奖励需先通过兑付覆盖率检查。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/growth/events",
    summary: "管理限时活动、促销和幸运转盘，查看活动效果。设置真钱奖品前需先通过兑付覆盖率检查。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/growth/daily",
    summary: "设置每日签到、幸运抽奖、收益里程碑、复活卡和连签加成。调高中奖概率或奖励需先通过兑付覆盖率检查。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/growth/milestones",
    summary: "用户累计收益达到档位时自动发放 UVT 奖励，共 5 档。在签到页一起设置。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/growth/vouchers",
    summary: "配置满减券和折扣券：面值、门槛、适用商品、发放对象、有效期和领取入口。代金券只抵购机款，不计入平台应付款；修改立即对用户生效。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/growth/referral-rewards",
    summary: "设置新人礼和邀请奖励金额，处理待结算的邀请并发奖。同一新人只会发一次。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    // H9 历史参数仍由后端 /api/admin/growth/public-stats 保存并审计。
    path: "/growth/public-stats",
    summary: "设置 App 首页展示的在线设备数、累计发放额和增长速度，以及设备排名参考板块。这些展示数字不影响资金账单。",
    content: PORTED_EMPTY_CONTENT,
  },
];
