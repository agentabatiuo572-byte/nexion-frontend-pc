/**
 * 域 H 已 port 视图注册表。
 * 真渲染面在 h-view.tsx / h-tabs/*;本文件只保留路由 summary。
 * content 固定为空,避免 ModulePage 复活旧静态/样本业务数据。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";
import { PORTED_EMPTY_CONTENT } from "./ported-content";
export const DOMAIN_H: ModuleEntry[] = [
  {
    path: "/growth/phase",
    summary: "运营节奏的唯一操作台。节奏总时长、当前运营月、阶段旋钮和用户群覆盖都以 H1 服务端返回为准;调旋钮、锁定阶段或单独覆盖都要确认,往松了调要先过 B1 兑付覆盖率。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/growth/trial",
    summary: "免费试用引擎。试用参数、会话状态、资格裁决、冷却、防刷和扣款防重复都由服务端返回。敏感项要走确认,增长角色可改的项也必须填原因;自动推送可实时急停。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/growth/quest",
    summary: "任务体系和奖励倍数曲线由服务端返回。任务奖励倍数由 H1 派发,H3 只能改任务清单本身;调高任务奖励会放大 NEX 往外流出,提交时要过 B1 红线。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/growth/events",
    summary: "限时活动管理。活动类型、精选状态、可追踪指标和幸运转盘治理都从服务端读取。真钱奖项、投放地区等高敏操作要走确认和 B1 覆盖率校验。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/growth/daily",
    summary: "每日签到引擎。签到规则、幸运抽奖、里程碑、复活卡和连签增益都从服务端读取。调高概率、奖励或调低收益门槛这类放大流出的改动要过 B1。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/growth/vouchers",
    summary: "代金券(领券促销)配置 · 满减 / 折扣两类。运营可配名称、面值、满减门槛 / 折扣封顶、适用 SKU(留空 = 全设备)、受众(新人 / 全部)、有效期、领取入口页面(首页 / 商城 / 我的 / 收益)、是否参与首页弹窗。前端进站自动弹窗领取 → 关闭后对应页面保留领券 banner;领取后「马上去使用」按适用范围跳 SKU 详情页或商城,结算自动套用满减 / 折扣。代金券是促销折扣、非 NEX 负债,不走 B1 兑付红线;上下架 / 改参即时对前端生效。",
    content: PORTED_EMPTY_CONTENT,
  },
  {
    path: "/growth/referral-rewards",
    summary: "新人礼与邀请人奖励(H8)—— 金额配置、待结算邀请和真实发奖统一入口。结算直接写新人 / 邀请人钱包和资金台账，同一新人由唯一约束防重复发奖。",
    content: PORTED_EMPTY_CONTENT,
  },
];
