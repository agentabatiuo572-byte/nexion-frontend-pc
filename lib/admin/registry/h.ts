/** 域 H 增长与运营节奏 — 注册表(H1 Phase 调度器 / H2 试用 / H3 Quest / H4 活动 / H5 签到 / H6 里程碑)。accent=--admin-domain-h。 */
import type { ModuleEntry } from "@/lib/admin/module-content";

export const DOMAIN_H: ModuleEntry[] = [
  {
    path: "/growth/phase",
    summary:
      "12 月运营节奏的唯一操作面,Phase 模型 10 项 dial 的权威源。前端只消费 server 下发的当前 dial 值;改 dial / 手动 pin / cohort override 需 Maker-Checker 双签,放大流出方向先核 B1 兑付覆盖率。",
    content: {
      kind: "config",
      metrics: [
        { label: "当前运营月", value: "月 7", sub: "P4 扩张期", accent: "var(--admin-domain-h)", hint: "平台按 12 个运营月推进,划分为 P1–P6 六段。" },
        { label: "默认 phase 用户", value: "92.4%", sub: "cohort 覆盖 7.6%", accent: "var(--admin-domain-h)", hint: "处于全局生效月 vs 被 cohort override / 手动 pin 命中。" },
        { label: "生效 dial", value: "10", sub: "月粒度快照", accent: "var(--v5-ink-3)" },
        { label: "推进模式", value: "定时按月", sub: "无手动 pin", accent: "var(--v5-success)", hint: "自动按运营月推进;当前无全局 pin 覆盖。" },
      ],
      groups: [
        {
          title: "当前生效 dial(月 7 快照,server-canonical)",
          note: "取自 server 下发值;逐月矩阵以 12 月节奏表 §6.4 为权威。改值入沙盒预览 → Maker-Checker。",
          fields: [
            { label: "newUserBonusMultiplier 新用户加成", value: "1×", range: "1–4(倍率)", effect: "仅新用户;P1 月 1-2=2×→月 5+ 回落 1×" },
            { label: "inviteRewardMultiplier 邀请加成", value: "1×", range: "1–4(倍率)", effect: "仅新用户;影响新邀请关系计酬" },
            { label: "reinvestMultiplier 复投加成", value: "1×", range: "1–4(倍率)", effect: "实时全量;月 5-6=2× 复投窗已过" },
            { label: "questBonusMultiplier 任务加成", value: "1×", range: "1–4(倍率)", effect: "实时全量;月 1-2=4× 拉新窗已过" },
          ],
        },
        {
          title: "资金流出闸门 dial(放大方向前置 B1)",
          note: "降冷却 / 降积分比 / 升双轨封顶 = 放大流出,提交前 server 强制核 B1 覆盖率,低于红线拒收。",
          fields: [
            { label: "withdrawCooldownDays 提现冷却", value: "30 天", range: "7–90 天", effect: "实时全量;月 8=35d→月 9+=45d 收紧" },
            { label: "withdrawPointsRatio 提现积分比", value: "10 / $100", range: "0–100", effect: "实时全量;月 9+ 升至 20 抬高门槛" },
            { label: "binaryDailyCap 双轨日封顶", value: "$2,000", range: "0–50,000 USD", effect: "实时全量;月 7 起由 $5,000 降至 $2,000" },
            { label: "complianceHoldEnabled 合规留存", value: "否", range: "是 / 否", effect: "实时全量;月 8+ 起开启留存闸" },
          ],
        },
        {
          title: "高级能力开闸 dial(随月龄下发)",
          note: "由 Phase 调度按 joinedAt 月龄下发;G5 / G6 仅消费,不持写权。",
          fields: [
            { label: "premiumSubAvailable Premium 可用", value: "是", range: "是 / 否", effect: "月 7+ 开启;联动 G5 premium gate" },
            { label: "nexV2LockAvailable NEXv2 锁仓", value: "否", range: "是 / 否", effect: "月 11+ 开启;联动 G6 NEXv2 gate" },
          ],
        },
      ],
      approval:
        "改 dial / 手动 pin / cohort override / 改定时切换均为高敏写操作,统一走 A2 Maker-Checker(增长 Maker → 超级管理员 Checker);放大流出方向(降 withdrawCooldownDays / 降 withdrawPointsRatio / 升 binaryDailyCap)由风控复核 B1 覆盖率红线,低于 coverageRedLine(默认 100%)server 拒绝提交。沙盒预览为只读推演,不写库。",
      impact: [
        "降提现冷却 / 提现积分比 → 放大即时资金流出,提交前置 B1 兑付覆盖率核验",
        "升 binaryDailyCap 双轨封顶 → F3 双轨日封顶面同步放大,联动 B1",
        "premiumSubAvailable / nexV2LockAvailable 下发 → G5 / G6 切 lock 卡 / 订阅卡(只读消费)",
        "dial 改动效果按 Phase 切片归因,反哺 B4 节奏状态只读展示",
      ],
    },
  },
  {
    path: "/growth/trial",
    summary:
      "免费试用引擎 · 19 参数操作面 + 7 态会话监控。Model A:购前试用收益仅抵购机款(上限 $50)、不可提现;购后剩余部分入余额。敏感项(价格 / 扣款失败率)与强制操作走 Maker-Checker;扣款失败率仅服务端可见,前端不可知。",
    content: {
      kind: "config",
      metrics: [
        { label: "进行中会话", value: "1,284", sub: "active / grace / extended", accent: "var(--admin-domain-h)", hint: "当前处于试用进行态的会话总数。" },
        { label: "试用→购买率", value: "31.6%", sub: "近 30 日", accent: "var(--v5-success)", hint: "redeemed 终态 ÷ started;喂 B3 漏斗 L3→L4。" },
        { label: "抵扣上限", value: "$50", sub: "trialOffsetCapUSD", accent: "var(--admin-domain-h)", hint: "Model A:购前收益抵购机款封顶,超出部分入余额。" },
        { label: "试用开放", value: "开", sub: "phaseOpen=true", accent: "var(--v5-success)", hint: "由 H1 Phase 调度决定当前 Phase 是否开放试用。" },
      ],
      groups: [
        {
          title: "时窗参数(仅影响新 trial)",
          note: "存量进行中会话保持其开始时锁定的参数。",
          fields: [
            { label: "trialDays 试用天数", value: "3 天", range: "≥ 1", effect: "active 态 shadow 累积时长" },
            { label: "graceDays 宽限天数", value: "7 天", range: "≥ 1", effect: "grace 态 shadow 冻结时长" },
            { label: "extensionDays 延长天数", value: "3 天", range: "≥ 1", effect: "高质量延长触发后追加时长" },
            { label: "cooldownDays 再试冷却", value: "30 天", range: "≥ 0", effect: "实时;server 校验,前端不得绕过" },
          ],
        },
        {
          title: "收益与定价(Model A 拆分)",
          note: "购后 computeTrialOffset 将 shadow 拆为 offsetUSD(抵购机款)+ remainderUSD(入余额);两路径共用同一纯函数。",
          fields: [
            { label: "trialPriceUSD 购机价", value: "$1,299", range: "敏感项", effect: "仅影响新 trial;改动走 Maker-Checker" },
            { label: "trialOffsetCapUSD 抵扣上限", value: "$50", range: "实时", effect: "offsetUSD = min(shadowUSD, cap) 抵实付价" },
            { label: "shadowDailyUSD 每日 shadow", value: "$38.52", range: "仅新 trial", effect: "试用期每日累计 shadow USD" },
            { label: "shadowDailyNEX 每日 NEX", value: "65 NEX", range: "仅新 trial", effect: "NEX 不抵 USDT 标价,购后全额入余额" },
            { label: "discountRate 早购折扣", value: "15%", range: "0–1(实时)", effect: "封顶 discountCapUSD;auto-charge 无促销" },
            { label: "discountCapUSD 折扣上限", value: "$20", range: "实时", effect: "早购促销折扣金额上限" },
          ],
        },
        {
          title: "风控与 auto-push(server-only)",
          note: "chargeFailRate 为 server-only,后台可读可改但前端永不可知(§9.11d.3)。",
          fields: [
            { label: "chargeFailRate 扣款失败率", value: "1%", range: "0–1 · server-only", effect: "敏感项;任何下发不暴露给客户端" },
            { label: "highQualityThresholdUSD 高质量阈值", value: "$100", range: "实时", effect: "shadow 达阈值触发高质量延长" },
            { label: "autoPushEnabled auto-push 总开关", value: "开", range: "是 / 否(kill)", effect: "实时关停 auto-push,异常时止血" },
            { label: "autoPushCooldownHours 冷却", value: "24 h", range: "实时", effect: "单会话 auto-push 间隔下限" },
          ],
        },
      ],
      approval:
        "非敏感项增长(Growth)直接编辑但须填修改原因 + 落 admin.trial_config_changed 审计;敏感项(trialPriceUSD / chargeFailRate 等)Maker(增长 / 风控)→ Checker(超级管理员)双签。强制取消试用 / 强制触发扣款为高敏操作,经 PSP 扣款须带 Idempotency-Key 保证幂等。试用状态机与资格 100% server-canonical,客户端不得越过 server 开启 / 延长。",
      impact: [
        "试用→购买(redeemed)数据喂 B3 漏斗 L3→L4 购买漏斗级 + KPI 看板",
        "shadow 拆分口径驱动 B2 / D3 trial shadow 负债科目(offset 为折扣非负债,remainder 入余额成应付)",
        "phaseOpen 随 H1 Phase 调度;关闭则 claim sheet 提示且不跳转绑卡(避免白绑卡)",
        "K2 套利检测产出 risk.trial_cycle_detected,H2 消费并联动阻断循环养号资格",
      ],
    },
  },
  {
    path: "/growth/quest",
    summary:
      "三层任务体系(首日 Day-One / 每周 Weekly / 每月 Monthly)的任务清单、NEX 奖励、3-phase 时窗与 Phase 乘数消费面。升奖励 = 放大 NEX 流出,server 先核 B1 红线,低于红线返 422。questBonusMultiplier 由 H1 下发,H3 仅消费。",
    content: {
      kind: "config",
      metrics: [
        { label: "Day-One 完成率", value: "58.3%", sub: "active 窗内 claim", accent: "var(--admin-domain-h)", hint: "首日 6 任务全完成并 claim 的新用户占比。" },
        { label: "Weekly 派发", value: "Tier1 9 + Tier2 8", sub: "按 weekKey", accent: "var(--admin-domain-h)", hint: "每周确定性派发的任务条数。" },
        { label: "questBonusMultiplier", value: "1×", sub: "H1 下发 · 未实装", accent: "var(--v5-ink-3)", hint: "拉新期规划 4×;前端未实装时取 1×。" },
        { label: "本周 NEX 派发", value: "1.82M", sub: "quest.claimed", accent: "var(--v5-warning)", hint: "本周任务结算累计派发 NEX,计入 B1 流出口径。" },
      ],
      groups: [
        {
          title: "Day-One Quest(首日,§5.15)",
          note: "3-phase 时窗:active 0-24h / grace 24-72h / expired 72h+;仅新进 active 用户按锁定清单结算。",
          fields: [
            { label: "active 完成奖励", value: "500 NEX", range: "≥ 0", effect: "active 窗(0-24h)全任务完成派发" },
            { label: "grace 完成奖励", value: "200 NEX", range: "0 ≤ x ≤ active", effect: "grace 窗(24-72h)降 60% 派发" },
            { label: "active 时窗 QUEST_WINDOW_MS", value: "24 h", range: "1h–168h", effect: "倒计时 chip 起算;改窗相位语义二选一" },
            { label: "6 任务总奖励", value: "510 NEX + $1", range: "单任务 ≥ 0", effect: "connect_wallet 50 / visit_store 50 / view_product_roi 100 / setup_profile 80 / visit_earn 30 / invite_friend 200+$1" },
          ],
        },
        {
          title: "Weekly Quests(每周,§11.13)",
          note: "Tier1 派发器 9 条优先级规则 + Tier2 池 8 条;仅新 weekKey 派发,同周锁定。",
          fields: [
            { label: "Tier1 最高档 nex_v2_lock", value: "3,000 NEX", range: "≥ 0", effect: "Tier1 9 条 base reward 顶档" },
            { label: "Tier1 首购 buy_first_box", value: "1,000 NEX + $10", range: "≥ 0", effect: "首购入金型任务奖励" },
            { label: "Tier2 邀请 invite_friend", value: "200 NEX + $2", range: "≥ 0", effect: "Tier2 8 条池内邀请任务" },
            { label: "Weekly phase 乘数曲线", value: "P1 1.0 → P6 1.5", range: "各档 ≥ 0", effect: "另一套乘数(getPhaseRewardMultiplier),与 questBonusMultiplier 区分" },
            { label: "Weekly Champion bonus", value: "+500 NEX × mult", range: "≥ 0", effect: "周冠军额外奖励(P6=750)" },
          ],
        },
        {
          title: "Monthly Challenge(每月,5 主题)",
          note: "按 joinedAt 月龄分段派发,每主题 3 个 AND-gated 子目标;仅新月派发。",
          fields: [
            { label: "foundation_builder 月龄 0-2", value: "1,500 NEX", range: "≥ 0", effect: "新人首段月度挑战" },
            { label: "network_architect 月龄 2-4", value: "2,500 NEX", range: "≥ 0", effect: "网络扩张段" },
            { label: "premium_pathway 月龄 4-6", value: "4,000 NEX", range: "≥ 0", effect: "高级路径段" },
            { label: "diamond_tier 月龄 6-9", value: "6,000 NEX", range: "≥ 0", effect: "钻石层段" },
            { label: "founders_quest 月龄 9+", value: "10,000 NEX + 勋章", range: "≥ 0", effect: "创始者挑战顶档 + 月度勋章" },
          ],
        },
      ],
      approval:
        "改 Day-One / Weekly / Monthly 配置:增长(Maker)→ 增长主管(Checker);改 Weekly phase reward multiplier 曲线由财务主管复核。升奖励 = 放大 NEX 流出,PUT 提交时 server 先核 B1 覆盖率,低于红线返 422。questBonusMultiplier 不在 H3 写权范围,由 H1 Phase 调度器下发,H3 结算时套用「实发 NEX = base reward × questBonusMultiplier」。",
      impact: [
        "quest / Day-One 任务 CTA 引导用户产生 store.viewed / checkout.completed,喂 B3 首购漏斗(行为驱动)",
        "quest.completed / quest.claimed 喂留存 BI(L 域 完成→claim CVR)+ app.dau 回访(KPI #2 间接)",
        "升 quest 奖励 / 倍率提交即被 server 拦截核验 B1 红线(NEX 计价负债折算)",
        "改窗(QUEST_WINDOW_MS)对在窗用户相位:方案 A per-instance 快照 / 方案 B 全局即时重算,接口契约二选一",
      ],
    },
  },
  {
    path: "/growth/events",
    summary:
      "限时活动(campaign / 活动位)CMS:8 种 EventKind 上下架 / featured / 奖励 / trackable 追踪 / Lucky Spin 转盘治理。同时仅 1 个 featured(server 唯一性校验);升奖励 / 改转盘奖池放大流出过 B1 红线;转盘真实奖受日预算 / 库存 / B1 三护栏。",
    content: {
      kind: "list",
      metrics: [
        { label: "在线活动", value: "9", sub: "ongoing", accent: "var(--admin-domain-h)", hint: "当前 status=ongoing 的活动数。" },
        { label: "Featured 主推", value: "1", sub: "pro-upgrade-7d", accent: "var(--v5-success)", hint: "Featured Hero 大卡,同时仅 1 个。" },
        { label: "转盘日派彩", value: "$1,284", sub: "上限 $2,000", accent: "var(--v5-warning)", hint: "当日真实 USDT 派彩累计 / wheelDailyPayoutBudgetUSD。" },
        { label: "真实奖总开关", value: "开", sub: "wheelRealPrizeEnabled", accent: "var(--v5-success)", hint: "关闭则真实奖档停发,应急止血联动 J1。" },
      ],
      search: "搜索活动名 / kind",
      filterKey: "kind",
      filters: ["全部", "discount", "referral", "wheel", "regional", "boost", "seasonal", "holding", "onboarding"],
      columns: [
        { key: "id", header: "活动 ID", mono: true },
        { key: "title", header: "名称" },
        { key: "kind", header: "类型" },
        { key: "window", header: "周期", mono: true },
        { key: "reward", header: "奖励", align: "right" },
        { key: "joined", header: "参与", mono: true, align: "right" },
        { key: "status", header: "状态", status: true },
      ],
      rows: [
        { id: "evt-pro-upgrade-7d", title: "NexionBox Pro Flash Upgrade", kind: "boost", window: "7 天", reward: "2,000 NEX", joined: "3,412", status: "ongoing" },
        { id: "evt-refer-5-get-pro", title: "邀 5 得 Pro 挑战", kind: "referral", window: "限时", reward: "5,000 NEX", joined: "1,876", status: "ongoing" },
        { id: "evt-onboarding-7d", title: "7 日上手任务", kind: "onboarding", window: "7 天", reward: "200 NEX", joined: "8,540", status: "ongoing" },
        { id: "evt-nex-holders-share", title: "NEX 持有者瓜分", kind: "holding", window: "限时", reward: "500 NEX", joined: "2,209", status: "ongoing" },
        { id: "evt-spring-spin", title: "每日幸运转盘", kind: "wheel", window: "每日重置", reward: "$1–$500 USDT", joined: "12,803", status: "ongoing" },
        { id: "evt-summer-discount", title: "盛夏购机直降", kind: "discount", window: "8/01–8/15", reward: "9 折券", joined: "5,118", status: "ongoing" },
        { id: "evt-apac-pk", title: "亚太区域 PK 赛", kind: "regional", window: "限时", reward: "1,200 NEX", joined: "964", status: "upcoming" },
        { id: "evt-anniversary-spin", title: "周年庆典转盘", kind: "wheel", window: "已结束", reward: "$1–$888 USDT", joined: "24,571", status: "ended" },
      ],
      detail: true,
      rowActions: [
        { label: "上线", tone: "primary", whenStatus: "upcoming" },
        { label: "下线", tone: "danger", whenStatus: "ongoing" },
        { label: "暂停", whenStatus: "ongoing" },
      ],
      note: "活动结构(kind / reward / progress / 时窗)归 H4,通用文案 key 归 V4 I 域,H4 引用不重复持有。新建 / 上下架 / 改奖励 / 改转盘奖池 / 改 geo 均走 A2 Maker-Checker;featured 唯一性、weight 和=100、档位∈[2,12]、升奖励过 B1 由 server 校验,违反返 422。转盘中奖 100% server RNG 裁决,client 不可知概率。",
    },
  },
  {
    path: "/growth/daily",
    summary:
      "每日签到引擎:积分规则 / Lucky 概率倍率 / 30 天里程碑路线图 / Streak Saver 断签复活卡 / Streak Power-Ups 连胜增益。Lucky 1.5×/2× 为概率型奖励必须 server-canonical RNG;升概率 / 升奖励放大流出过 B1;概率和 >100% 返 422。",
    content: {
      kind: "config",
      metrics: [
        { label: "今日签到率", value: "64.2%", sub: "活跃用户", accent: "var(--admin-domain-h)", hint: "当日完成签到的活跃用户占比。" },
        { label: "Lucky 命中(实测)", value: "1.5× 14.8% / 2× 5.1%", sub: "vs 配置 15% / 5%", accent: "var(--v5-success)", hint: "server RNG 实测命中率与配置值对比。" },
        { label: "Streak Saver 消耗", value: "1,042", sub: "近 30 日", accent: "var(--v5-ink-3)", hint: "断签后消耗复活卡恢复连胜的次数。" },
        { label: "Day-100 达成", value: "318", sub: "Streak Master", accent: "var(--admin-domain-h)", hint: "累计连胜满 100 天解锁徽章的用户数。" },
      ],
      groups: [
        {
          title: "签到规则(§9.8.1)",
          note: "baseline 与 bonus 实时生效(下次签到);断签阈值 server 校验。",
          fields: [
            { label: "baseline 积分", value: "+1 / 日", range: "≥ 0", effect: "每日签到基础贡献积分" },
            { label: "7 天连续 bonus", value: "+5 积分", range: "≥ 0", effect: "连签满 7 天日历奖励" },
            { label: "断签阈值", value: ">48h 重置", range: "≥ 24h", effect: "超阈值未签 streak 归 0" },
            { label: "Streak Saver 持有 / 恢复上限", value: "1 张 / 30 天", range: "≥ 0 张 / ≤ 30 天", effect: "恢复至 min(longestStreak, 30)" },
          ],
        },
        {
          title: "Lucky 概率倍率(server-canonical RNG)",
          note: "概率在 UI 公示(有意暴露的转化文案),裁决权与权威值在 server,client 不得本地 roll。",
          fields: [
            { label: "Lucky 1.5× 概率", value: "15%", range: "0–100%", effect: "p(1.5×)+p(2×) ≤ 100%,余为 baseline 1.0×" },
            { label: "Lucky 2× 概率", value: "5%", range: "0–100%", effect: "和 >100% server 返 422;放大流出过 B1" },
          ],
        },
        {
          title: "30 天里程碑路线图(§9.8.2,7 阶梯)",
          note: "阶梯可增删改,仅新达成按当前值;Day-30 发 spin 票,转盘治理归 H4。",
          fields: [
            { label: "Day3 / Day7", value: "+5 积分 / +15 积分", range: "≥ 0", effect: "早期连签积分阶梯" },
            { label: "Day14 / Day21", value: "+1 USDT / +100 NEX", range: "≥ 0", effect: "中段 USDT + NEX 奖励(过 B1)" },
            { label: "Day30 里程碑", value: "🎰 Lucky Spin 票", range: "枚举", effect: "发放 1 张转盘票,奖池治理归 H4" },
            { label: "Day60 / Day100", value: "+10 USDT / ⭐ Badge", range: "≥ 0 / NFT", effect: "Streak Master Badge(NFT)" },
          ],
        },
        {
          title: "Streak Power-Ups(§9.8.6,4 档跨域增益)",
          note: "H5 为触发面,下游 F2/G5/G1/G4 兑现并各自受 B1 约束;V3 落地前仅产生路由跳转 + badge 解锁的留存触点价值。",
          fields: [
            { label: "7 天 Royalty Boost", value: "→ F2 unilevel", range: "阈值 + 增益可改", effect: "跳 /team/unilevel;下游费率兑现 V2/V3" },
            { label: "14 天 Premium trial", value: "→ G5 Premium 7 日", range: "阈值可改", effect: "复用 G5 premium 订阅状态机" },
            { label: "30 天 +2% APY", value: "→ G1 Staking", range: "增益值可改", effect: "next stake APY 加成(下游兑现)" },
            { label: "60 天 Genesis 白名单", value: "→ G4 Genesis", range: "阈值可改", effect: "Genesis 白名单优先权" },
          ],
        },
      ],
      approval:
        "改基础规则:增长(Maker)→ 增长主管(Checker);改 Lucky 概率 / 里程碑奖励 / Power-Ups:增长(Maker)→ 财务主管 / 超管(Checker)。升概率 / 升奖励 / 升增益 = 放大流出,server 先核 B1 红线低于返 422;Lucky 概率和 >100% 返 422。Lucky 随机裁决必须 server 执行(POST /api/points/sign-in)+ NODE_ENV guard,生产环境严禁 client 端随机函数。streak 计数 / 里程碑 claim / Power-Up 激活态全部 server 权威,client 仅 UI cache。",
      impact: [
        "daily.checkin → app.dau 回访(KPI #2 间接)+ engagement family",
        "里程碑 NEX(Day21 +100)/ USDT(Day14 +1 / Day60 +10)+ Lucky 倍率放大签到积分 → 后续提现额度消耗,升值过 B1",
        "Streak Power-Ups 触发跨域兑现 F2 费率 / G5 Premium / G1 APY / G4 白名单,下游各自受 B1 约束",
        "Day-30 转盘票发放属里程碑 claim 奖励项;转盘奖池 / 概率 / 派奖治理归 H4",
      ],
    },
  },
  {
    path: "/growth/milestones",
    summary:
      "收益累计里程碑(MilestoneWatcher)5 档阈值与 NEX 奖励的配置 + 监控。被动触发:累计入账(earnings.total + today)跨阈值自动 fire 庆祝 + 自动派 NEX,一次一档。升奖励 / 降阈值 = 放大 NEX 流出,server 先核 B1;阈值须保序,违反返 422。",
    content: {
      kind: "list",
      metrics: [
        { label: "今日 fire", value: "246", sub: "全档", accent: "var(--admin-domain-h)", hint: "今日累计入账跨阈值触发庆祝的次数。" },
        { label: "本月派发 NEX", value: "684K", sub: "milestone.fired", accent: "var(--v5-warning)", hint: "本月里程碑自动派发 NEX,计入 B1 流出口径。" },
        { label: "最高档达成", value: "57", sub: "earn-10000", accent: "var(--admin-domain-h)", hint: "累计入账跨 $10,000 档的用户数。" },
        { label: "watcher tick", value: "4 s", sub: "POLL_MS", accent: "var(--v5-ink-3)", hint: "fire 检测轮询间隔;过密增 server 负载。" },
      ],
      search: "搜索档位 ID",
      filterKey: "state",
      filters: ["全部", "生效", "停发"],
      columns: [
        { key: "id", header: "档位 ID", mono: true },
        { key: "threshold", header: "阈值(累计入账)", align: "right" },
        { key: "reward", header: "NEX 奖励", align: "right" },
        { key: "fired", header: "累计 fire", mono: true, align: "right" },
        { key: "paid", header: "累计派发 NEX", align: "right" },
        { key: "state", header: "状态", status: true },
      ],
      rows: [
        { id: "earn-100", threshold: "$100", reward: "+100 NEX", fired: "18,204", paid: "1.82M", state: "生效" },
        { id: "earn-500", threshold: "$500", reward: "+250 NEX", fired: "7,612", paid: "1.90M", state: "生效" },
        { id: "earn-1000", threshold: "$1,000", reward: "+500 NEX", fired: "3,488", paid: "1.74M", state: "生效" },
        { id: "earn-5000", threshold: "$5,000", reward: "+1,500 NEX", fired: "642", paid: "963K", state: "生效" },
        { id: "earn-10000", threshold: "$10,000", reward: "+3,000 NEX", fired: "211", paid: "633K", state: "生效" },
      ],
      detail: true,
      rowActions: [
        { label: "启用", tone: "primary", whenStatus: "停发" },
        { label: "停用", tone: "danger", whenStatus: "生效" },
      ],
      note: "阈值口径 = 累计入账(earnings.total + earnings.today,含当日增量),fire 判定与自动 creditNex + 落 D4 bill 收敛 server 单事务,幂等粒度 milestoneId × userId,crash 不出现 firedIds 置位而 NEX 未入账的部分态。改阈值 / 奖励 / tick 走 A2 Maker-Checker(增长 Maker → 财务主管 / 超管 Checker);升奖励 / 降阈值过 B1 红线、阈值保序由 server 校验,违反返 422。文案(milestones.*)归 V4 I 域。",
    },
  },
];
