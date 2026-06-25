/**
 * 域 H 增长与运营节奏 — 注册表(H1 Phase / H2 试用 / H3 Quest / H4 活动 / H5 签到 / H6 里程碑)。accent=--admin-domain-h。
 * ⚠️ H ∈ PORTED_DOMAINS:本文件 content 为死代码(真渲染面 = h-view.tsx + h-tabs/),仅 summary 经 DomainHeader 渲染。
 * 改 H 域数据/动作请改 h-tabs/data.ts,勿在此处改 content。
 * FOLD: H4→H3(任务与活动同页) / H6→H5(签到与里程碑同页)。
 */
import type { ModuleEntry } from "@/lib/admin/module-content";

const placeholder = (note: string): ModuleEntry["content"] => ({ kind: "dashboard", metrics: [], note });

export const DOMAIN_H: ModuleEntry[] = [
  {
    path: "/growth/phase",
    summary:
      "运营节奏的唯一操作台(节奏总时长 / 当前运营月在「节奏骨架」段可配,默认 12 月),8 个节奏旋钮都以这里为准(Premium/NEX v2 的旋钮随模块下线已移除,「提现积分」改为「提现罚金费率」;NEX 抵扣率在 D5)。前端只用服务器下发的当前旋钮值;调旋钮、手动锁定某个阶段、对特定用户群单独覆盖,都要确认;往松了调(降冷却、降罚金、升封顶)要先过 B1 兑付覆盖率,低于红线直接拒绝。下游 D5/F3/E2/H3 只能读、不能改。",
    content: placeholder("死代码:H1 真渲染面在 h-tabs/h1-phase.tsx(DIAL_MATRIX 默认 12×8、运营可调总时长 + LOOSEN_DIR + NEW_USER_ONLY + PHASE_CONTROLS 3 类)。"),
  },
  {
    path: "/growth/trial",
    summary:
      "免费试用引擎 · 19 个参数的操作面 + 7 种会话状态监控 + 4 道前置闸(资格统一裁决、30 天冷却、K2 防刷循环、扣款防重复)。规则 A:购机前的试用收益只能抵购机款(上限 $50)、不能提现,购机后剩余部分才进余额。敏感项(机价、扣款失败概率〔只在服务器、永不下发前端〕、自动扣款)要走确认;其余项增长角色可直接改、但必须填原因;自动推送可实时急停。这页不挂「放大流出」标记(试用收益是折扣、不是负债)。",
    content: placeholder("死代码:H2 真渲染面在 h-tabs/h2-trial.tsx(TRIAL_CONFIG 19 + 7 态 SS + 4 行 sessions + 4 道闸)。"),
  },
  {
    path: "/growth/quest",
    summary:
      "三层任务体系(首日 6 个 / 每周:一档 9 个 + 二档 8 个 + 周冠军 / 月度 5 个按账龄派发的主题任务)+ 6 阶段奖励倍数曲线(P1 的 1.0 → P6 的 1.5)。任务奖励倍数由 H1 派发、本页只读,H3 只能改任务清单本身。调高任务奖励 = 放大 NEX 往外流出,提交时就要过 B1 红线。进行中的任务按入窗 / 入周 / 跨档时的快照锁定结算(改窗口时 A/B 两套方案二选一)。",
    content: placeholder("死代码:H3 真渲染面在 h-tabs/h3-quest-events.tsx(任务部分;FOLD 同页含 H4 活动)。"),
  },
  {
    path: "/growth/events",
    summary:
      "限时活动管理 · 8 种活动类型(折扣 / 推荐 / 转盘 / 区域 / 新手引导 / 加成 / 季节 / 持有)+ 同时只能有一个「精选」活动 + 4 行可追踪指标(只读取 E/F/G 状态)+ 幸运转盘治理。转盘三道护栏(各档中奖权重之和 = 100、档位数在 2–12 之间、真钱奖项要过 B1)+ 覆盖率低于 100% 时自动暂停真钱档 + 同一用户同一活动每天只能转一次。「精选」全站唯一;已结束的活动优先级最高。改投放地区等高敏操作走超级管理员。",
    content: placeholder("死代码:H4 已合并到 H3 真渲染面 h-tabs/h3-quest-events.tsx(EVENTS_CMS 8 玩法 + WHEEL 8 档 + GUARDS 3 行 + TRACKABLES 4 行)。"),
  },
  {
    path: "/growth/daily",
    summary:
      "每日签到引擎 · 6 条规则 + 幸运中奖概率倍率(随机抽奖在服务器跑)+ 30 天连续签到的 7 级里程碑 + 断签复活卡 + 4 档连签增益(联动 F2/G1/G4)。幸运两档的中奖概率之和不能超过 100% + 调高概率 / 奖励 / 增益阈值这类放大流出的改动要过 B1;实际中奖率和配置值相差超过 ±1 个百分点就报警;签到满 30 天发的转盘券归 H4 管。",
    content: placeholder("死代码:H5 真渲染面在 h-tabs/h5-daily-milestones.tsx(签到部分;FOLD 同页含 H6 里程碑)。"),
  },
  {
    path: "/growth/milestones",
    summary:
      "收益累计里程碑 · 5 档阈值和对应 NEX 奖励的配置 + 监控。自动触发:用户累计收益跨过某档阈值,自动弹庆祝 + 自动发 NEX,一次只过一档。调高奖励 / 调低阈值 = 放大 NEX 流出,要过 B1 红线;各档阈值必须从低到高严格排序。弹庆祝、发 NEX、记账单三件事在一笔事务里完成,同一用户同一里程碑不会重复发,中途崩溃也不会出现「标记已发但 NEX 没到账」的半截状态;一次跨过多档时按当时配置依次结算(用快照锁定)。",
    content: placeholder("死代码:H6 已合并到 H5 真渲染面 h-tabs/h5-daily-milestones.tsx(EARN_MS 5 档 + 三规矩 + TICK_INTERVAL)。"),
  },
  {
    path: "/growth/vouchers",
    summary:
      "代金券(领券促销)配置 · 满减 / 折扣两类。运营可配名称、面值、满减门槛 / 折扣封顶、适用 SKU(留空 = 全设备)、受众(新人 / 全部)、有效期、领取入口页面(首页 / 商城 / 我的 / 收益)、是否参与首页弹窗。前端进站自动弹窗领取 → 关闭后对应页面保留领券 banner;领取后「马上去使用」按适用范围跳 SKU 详情页或商城,结算自动套用满减 / 折扣。代金券是促销折扣、非 NEX 负债,不走 B1 兑付红线;上下架 / 改参即时对前端生效。",
    content: placeholder("死代码:H7 真渲染面在 h-tabs/h7-voucher-config.tsx(OpsVoucher CRUD + voucher-config businessForm)。"),
  },
];
