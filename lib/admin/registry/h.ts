/**
 * 域 H 已 port 视图注册表。
 * 模块:H1 Phase 调度器 · H2 免费试用引擎 · H3 任务引擎 · H4 活动中心 · H5 签到 & NEX ·
 *       H7 代金券 · H8 新人礼与邀请奖励 · H9 对外公布数据。
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
  {
    // ⚠️ H9 数据面走 growth 代理直连 nexion-backend 的 GET/PATCH /public-stats;该端点在后端
    //    是否已实现**未核实**(开发机无该仓),A/B(后端补端点 vs 前端 mock 兜底)待定 ——
    //    详见 lib/admin/h9-client.ts 头注释。端点缺席时页面走占位卡,不出假数字。
    path: "/growth/public-stats",
    summary: "对外公布数据(H9)—— 前端首页公布的平台规模与名次口径的唯一配置入口。可配设备总数、在线占比与展示浮动、注册用户基数与月增长率、名次分母里的虚拟人口,以及把用户算力换算成百分位的分位表。设备总数同时是介绍页 / 信任页 / 全球网格 / 分享海报的共同来源,改它会连带改掉对外公布的日支付额口径,页面在保存前给出影响预览。7 个参数与分位表整组原子保存:确认弹窗给前后值对照、理由必填、服务端落审计并带幂等键,任一项不合法整组不落库。",
    content: PORTED_EMPTY_CONTENT,
  },
];
