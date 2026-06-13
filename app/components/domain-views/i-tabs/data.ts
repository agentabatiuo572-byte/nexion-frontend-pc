/**
 * I 域(内容与合规 CMS)页面级数据 —— design_handoff_i_domain port。
 * 单源纪律:
 *  - Nova 通道沿用 design-data.NOVA 单源(usePlatformConfig.novas 共享 store,旧 i-view 已建);
 *  - I3 CAP 4 档 = SPEC.md §6 权威(critical=∞ 锁死 / high 50 / normal 200 / low 30);
 *  - I4 信任 6 版块 / I5 4 法域 / I5 7 章节 / I7 课程目录:设计稿 HTML 内 var 原样移植,文案逐句保留;
 *  - I6 i18n 命名空间:30+ 中显式列 12(home/marketing/binaryHowItWorks 等),其余以「… 共 30+」省略;
 *  - I7 amplifies 唯一流出方向:课程完成 NEX 派发(B1 红线核验),其余 I 域动作不碰 B1;
 *  - I8 support tickets 字段镜像 UniApp ticket mock(owner/lastReplyAt 补齐为后台可控字段)。
 * 真写键(I.*):I.copy.<key>.status(I1 文案池发布/下架/回滚)/ I.exp.<id>.status(I1 实验启停/采纳)/
 *   I.exp.framework.<param>(I1 框架默认值)/ I.tpl.<key>.status(I2 模板)/ I.social.dist(I2 概率分布)/
 *   I.cap.<tier>(I3 CAP)/ I.campaign.<id>.status(I3 campaign 下发/取消)/
 *   I.trust.<key>.status(I4 信任版块)/ I.disclosure.<jur>.version(I5 披露)/ I.gated(I5 受限动作范围)/
 *   I.i18n.<ns>.status(I6 命名空间发布)/ I.tutorial.<id>.status(I7 课程)/ I.tutorial.<id>.reward(I7 奖励)/
 *   I.tutorial.featured(I7 推荐位) / I.support.faqs / I.support.sla / I.support.tickets。
 * Nova 通道写共享 store(addNova/updateNova/removeNova)。
 */

/* ============ I1 转化文案 A/B ============ */
export const I1_STATS = {
  managedCopies: 12,
  runningExps: 3,
  weeklyExposures: "1.24M",
  topLift: "+18.4%",
};

export type CopyRow = {
  key: string; desc: string; surface: "Home" | "Me" | "商城";
  version: string; status: "published" | "archived";
  i18nKey: string; expId: string; lastChange: string;
};
export const COPY_POOL: CopyRow[] = [
  { key: "home.conversionBanner", desc: "主转化横幅 · 激活设备每日收益话术", surface: "Home", version: "v7", status: "published", i18nKey: "marketing.home.convBanner", expId: "EXP-2611", lastChange: "05-28" },
  { key: "home.missedIncome", desc: "错过收益条 · 与基准机型的日产差额", surface: "Home", version: "v4", status: "published", i18nKey: "marketing.home.missed", expId: "EXP-2612", lastChange: "05-30" },
  { key: "home.heroCta", desc: "首屏主按钮文案", surface: "Home", version: "v9", status: "published", i18nKey: "marketing.home.heroCta", expId: "—", lastChange: "05-21" },
  { key: "home.trialNudge", desc: "试用引导条(试用资格用户可见)", surface: "Home", version: "v3", status: "published", i18nKey: "marketing.home.trial", expId: "—", lastChange: "04-30" },
  { key: "home.paybackChip", desc: "回本周期角标", surface: "Home", version: "v2", status: "published", i18nKey: "marketing.home.payback", expId: "—", lastChange: "04-02" },
  { key: "me.upgradeCard", desc: "「该升级了」卡片 · 按机队推荐", surface: "Me", version: "v5", status: "published", i18nKey: "marketing.me.upgrade", expId: "EXP-2613", lastChange: "06-02" },
  { key: "me.referralNudge", desc: "邀请返佣提示条", surface: "Me", version: "v6", status: "published", i18nKey: "marketing.me.referral", expId: "—", lastChange: "05-11" },
  { key: "me.vrankProgress", desc: "V 等级进度话术", surface: "Me", version: "v2", status: "published", i18nKey: "marketing.me.vrank", expId: "—", lastChange: "03-19" },
  { key: "me.walletEmpty", desc: "钱包空态引导", surface: "Me", version: "v3", status: "published", i18nKey: "marketing.me.walletEmpty", expId: "—", lastChange: "02-27" },
  { key: "store.paybackHint", desc: "商品卡回本提示", surface: "商城", version: "v4", status: "published", i18nKey: "marketing.store.payback", expId: "—", lastChange: "05-06" },
  { key: "store.bundleBanner", desc: "捆绑购横幅", surface: "商城", version: "v3", status: "published", i18nKey: "marketing.store.bundle", expId: "—", lastChange: "04-22" },
  { key: "store.tradeinHook", desc: "以旧换新钩子文案", surface: "商城", version: "v2", status: "published", i18nKey: "marketing.store.tradein", expId: "—", lastChange: "03-30" },
];

/** I1 版本历史(home.conversionBanner 演示位)。 */
export const COPY_VERSIONS = [
  { v: "v8", st: "draft", chain: "li.wen / —", ts: "06-10 18:22" },
  { v: "v7", st: "published", chain: "li.wen / chen.r(lead)", ts: "05-28 11:04" },
  { v: "v6", st: "archived", chain: "zhao.m / chen.r(lead)", ts: "04-12 09:40" },
  { v: "v5", st: "archived", chain: "zhao.m / 超管", ts: "03-02 15:17" },
] as const;

/** I1 实验框架默认参数(运营设定 = 普通确认带原因)。 */
export const EXP_FRAMEWORK = [
  { key: "split", name: "分流比例默认", cur: "变体等分", sub: "新实验默认变体等分;可改成任意组合,但合计必须 = 100%,超了服务器拒" },
  { key: "aud", name: "受众定向默认", cur: "全量", sub: "默认全量;可按注册周 / 运营阶段 / 语言圈定,只对圈定后新进入的用户生效" },
  { key: "sample", name: "最小样本量", cur: "5,000 / 变体", sub: "每个变体曝光不够这个数就出结论,统计上不可信——结算页会标「样本不足」" },
  { key: "maxrun", name: "最长运行期", cur: "90 天", sub: "到期未手动结算自动转已结(discarded),防止僵尸实验长期分裂用户体验" },
];

export type ExpRow = {
  id: string; copyKey: string; variants: [name: string, split: number, cvr: number][];
  audience: string; impressions: string; conversions: string;
  state: "running" | "adopted" | "discarded"; note: string;
};
export const EXPS: ExpRow[] = [
  { id: "EXP-2611", copyKey: "home.conversionBanner", variants: [["A(v7 现版)", 50, 4.1], ["B(v8 候选)", 50, 4.8]], audience: "P3 · 全语言", impressions: "412K", conversions: "18.3K", state: "running", note: "05-29 起 · 已 13 天" },
  { id: "EXP-2612", copyKey: "home.missedIncome", variants: [["A(差额话术)", 34, 3.2], ["B(倍数话术)", 33, 3.9], ["C(回本话术)", 33, 3.4]], audience: "全量", impressions: "388K", conversions: "13.6K", state: "running", note: "05-30 起 · 已 12 天" },
  { id: "EXP-2613", copyKey: "me.upgradeCard", variants: [["A(现版)", 50, 2.1], ["B(机队对比)", 50, 2.6]], audience: "zh · 注册>30天", impressions: "96K", conversions: "2.2K", state: "running", note: "06-02 起 · 样本不足" },
  { id: "EXP-2607", copyKey: "home.conversionBanner", variants: [["A(v6)", 50, 3.4], ["B(v7)", 50, 4.0]], audience: "P2-P3", impressions: "1.02M", conversions: "37.8K", state: "adopted", note: "已结 · B 胜出已采纳为 v7" },
  { id: "EXP-2598", copyKey: "store.paybackHint", variants: [["A", 50, 2.8], ["B", 50, 2.7]], audience: "全量", impressions: "640K", conversions: "17.6K", state: "discarded", note: "已结 · 无显著差异,弃用" },
];

/* ============ I2 Nova 推送(沿用 NOVA 单源 + 共享 store) ============ */
export const I2_STATS = {
  todayDelivered: "84.2K",
  ctr: "27.4%",
  ctrTarget: 25,
  channelsOnline: "10 / 10",
  weeklySocial: "12.8K",
};

/** 不在 10 通道里的事件触发类频道(口径闭合,设计稿表格)。 */
export const NOVA_EVENT_DRIVEN = [
  { name: "risk-alert", why: "设备掉线 / 任务失败时事件触发,没有「多久推一次」的概念", owner: "异常事件状态机驱动", tone: "dim" as const, st: "事件触发 · 仅模板可管" },
  { name: "weekly-quest-refresh", why: "每周任务刷新时触发,节奏跟任务系统走", owner: "任务系统(H3)", tone: "dim" as const, st: "事件触发 · 仅模板可管" },
  { name: "team_event / staking_event / market_event", why: "这三个 v3 业务频道的节奏目前写死在 App 代码里,没有开关字段、不读服务器配置——把它们接进这张节奏表是一张已登记的整合工单,落地前这页不持有它们的调频项", owner: "App 硬编码(90s/70s · 4min/5min · 6min/7min)", tone: "warn" as const, st: "待整合工单" },
];

/** I2 推送模板池(CTA 接 E/F/G 下游)。 */
export const NOVA_TPLS = [
  { ch: "welcome", name: "首推 · 玩法解释", cta: "→ /onboarding", v: "v3" },
  { ch: "market", name: "行情波动播报", cta: "→ /market", v: "v2" },
  { ch: "upgrade", name: "升级推荐 · 按机队", cta: "→ /shop(E)", v: "v4" },
  { ch: "tradein", name: "以旧换新钩子", cta: "→ /tradein(E)", v: "v2" },
  { ch: "social", name: "全网真实事件 · social", cta: "—(无 CTA)", v: "v5" },
  { ch: "eventClaim", name: "催领提醒 · 活动奖励", cta: "→ /events(H4)", v: "v3" },
  { ch: "wrapped", name: "半年/年度 Wrapped 回顾", cta: "→ /me/wrapped", v: "v1" },
];

/** I2 social 池 5 类事件按概率分布(合计 100%)。 */
export const SOCIAL_DIST = [
  { name: "提现到账", pct: 30, color: "var(--admin-cat-3)" },
  { name: "V 等级晋升", pct: 25, color: "var(--admin-cat-5)" },
  { name: "Genesis 成交", pct: 20, color: "var(--admin-cat-7)" },
  { name: "AI 客户消费", pct: 15, color: "var(--admin-cat-2)" },
  { name: "每小时新增用户", pct: 10, color: "var(--admin-cat-4)" },
];
export const SOCIAL_POOLS = [
  { key: "SOCIAL_NAMES", name: "人名池", sub: "事件里出现的化名,按市场轮换", cnt: 48 },
  { key: "CITIES", name: "城市池", sub: "事件发生地,按市场轮换", cnt: 32 },
  { key: "AI_CLIENTS", name: "AI 客户池", sub: "「AI 客户消费」事件的客户名单", cnt: 12 },
];

/* ============ I3 通知 Campaign + 4 档 CAP ============ */
export const I3_STATS = {
  monthCampaigns: 12,
  monthSent: 9,
  monthScheduled: 2,
  monthDraft: 1,
  criticalInflight: 2,
  avgReadRate: "64.2%",
  weeklySwipe: "8.2K",
};

/** 4 档 CAP(SPEC §6 权威):critical=Infinity(合规硬约束锁死)。 */
export const CAP_TIERS = [
  { tier: "critical", cap: "∞ 永不淘汰", policy: "合规重确认 / 风控异动 / 资金账户异动——合规硬约束:不可调降,一条都不能丢", locked: true },
  { tier: "high", cap: "50 条", policy: "tier 内 LIFO · 高优运营事件优先保留", locked: false },
  { tier: "normal", cap: "200 条", policy: "通知中心总上限 · 常规运营公告", locked: false },
  { tier: "low", cap: "30 条 · TTL 24–48h", policy: "教程提示等低优 · 数量+时间双闸,过期自动清", locked: false },
];

export type CampaignRow = {
  id: string; name: string; kind: "system";
  tier: "critical" | "high" | "normal" | "low";
  audience: string; reach: string;
  st: "draft" | "scheduled" | "sending" | "sent" | "cancelled";
  schedule: string; sent: string; read: string;
  bodyEn: string; bodyZh: string; swipeTo: string;
};
export const CAMPAIGNS: CampaignRow[] = [
  { id: "CMP-2618", name: "6/15 钱包维护窗口公告", kind: "system", tier: "high", audience: "全量", reach: "182K", st: "scheduled", schedule: "06-15 02:00 排期", sent: "—", read: "—", bodyEn: "Scheduled wallet maintenance Jun 15 02:00–04:00 UTC. Withdrawals paused during the window.", bodyZh: "6 月 15 日 02:00–04:00(UTC)钱包例行维护,期间暂停提现。", swipeTo: "/me/notifications/maintenance-0615" },
  { id: "CMP-2617", name: "风险披露 v12 重确认提醒(SFC 辖区)", kind: "system", tier: "critical", audience: "SFC 辖区 · 未重确认用户", reach: "9.4K", st: "scheduled", schedule: "06-12 10:00 排期", sent: "—", read: "—", bodyEn: "Updated risk disclosure requires re-acknowledgement before your next withdrawal.", bodyZh: "风险披露条款已更新,下次提现前需要重新确认。", swipeTo: "/me/risk-disclosure" },
  { id: "CMP-2615", name: "KYC 二级认证引导(大额用户)", kind: "system", tier: "high", audience: "近 30 天提现 >$1k", reach: "12.6K", st: "sent", schedule: "06-08 已发", sent: "12.4K", read: "9.1K", bodyEn: "Complete advanced verification to keep higher withdrawal limits.", bodyZh: "完成进阶认证,保住更高的提现额度。", swipeTo: "/me/kyc" },
  { id: "CMP-2612", name: "P3 阶段运营公告 · 周任务上新", kind: "system", tier: "normal", audience: "全量", reach: "182K", st: "sent", schedule: "06-02 已发", sent: "178K", read: "104K", bodyEn: "New weekly quests are live — check this week's board.", bodyZh: "本周新任务已上线,去看看任务板。", swipeTo: "/earn/quests" },
  { id: "CMP-2609", name: "监管通告 · 服务条款更新", kind: "system", tier: "critical", audience: "全量", reach: "181K", st: "sent", schedule: "05-28 已发", sent: "181K", read: "152K", bodyEn: "Our Terms of Service have been updated effective Jun 1.", bodyZh: "服务条款已更新,6 月 1 日生效。", swipeTo: "/trust" },
  { id: "CMP-2606", name: "低优 · 教程中心上新提示", kind: "system", tier: "low", audience: "注册 ≤14 天", reach: "21K", st: "sent", schedule: "05-21 已发", sent: "20.6K", read: "7.8K", bodyEn: "New beginner lessons in Learn — earn NEX for finishing.", bodyZh: "教程中心上新了,学完还能领 NEX。", swipeTo: "/learn" },
  { id: "CMP-2619", name: "7 月费率说明公告(草稿)", kind: "system", tier: "normal", audience: "全量", reach: "—", st: "draft", schedule: "—", sent: "—", read: "—", bodyEn: "(草稿撰写中)", bodyZh: "(草稿撰写中)", swipeTo: "—" },
];

export const I3_TIER_STATE: Record<CampaignRow["tier"], [label: string, tone: string]> = {
  critical: ["critical", "bad"],
  high: ["high", "warn"],
  normal: ["normal", "dim"],
  low: ["low", "dim"],
};

/* ============ I4 信任中心 + I5 披露(合并页) ============ */
export const I4_STATS = {
  managedSections: 6,
  jurisdictions: 4,
  staleAckUsers: 2_630,
  weeklyGateBlocked: 312,
  sfcReackPct: 72,
};

export type TrustSection = {
  key: string; desc: string; struct: string; v: string;
  status: "published" | "archived"; lastChange: string;
  roleGate: "内容主管" | "合规 / 超管";
  highSensitivity: boolean;
};
export const TRUST_SECTIONS: TrustSection[] = [
  { key: "financials", desc: "财务透明数字组", struct: "数字组 + 脚注", v: "v5", status: "published", lastChange: "05-12", roleGate: "合规 / 超管", highSensitivity: true },
  { key: "leadership", desc: "管理团队", struct: "人员卡 ×5(姓名/职务/前公司/占位链接)", v: "v3", status: "published", lastChange: "03-08", roleGate: "内容主管", highSensitivity: false },
  { key: "nexNarrative", desc: "NEX 代币叙事", struct: "叙事文案 + 行情 stats + top3 客户榜", v: "v6", status: "published", lastChange: "05-26", roleGate: "合规 / 超管", highSensitivity: true },
  { key: "complianceBadges", desc: "合规徽章", struct: "徽章组(SOC2 / ISO27001 / CertiK)", v: "v2", status: "published", lastChange: "02-14", roleGate: "合规 / 超管", highSensitivity: true },
  { key: "auditsReserves", desc: "审计与储备证明", struct: "外链占位(链上储备 / 审计报告)", v: "v4", status: "published", lastChange: "04-20", roleGate: "合规 / 超管", highSensitivity: true },
  { key: "listings", desc: "交易所与行情外链", struct: "外链占位(PancakeSwap 等)", v: "v2", status: "published", lastChange: "01-30", roleGate: "内容主管", highSensitivity: false },
];

/** I4 财务数字组(financials 版块详情)。 */
export const FINANCIALS_FIELDS = [
  { k: "MRR", v: "$4.87M", delta: "+22%" },
  { k: "Active", v: "184,206", delta: "+38%" },
  { k: "Devices", v: "28,432", delta: "+12%" },
  { k: "Payouts", v: "$31.2M", delta: "+27%" },
];

export type Jurisdiction = {
  code: string; name: string; v: string; status: "published" | "superseded";
  publishedAt: string; affected: number;
  ackProgress: number; blocked: number;
};
export const JURISDICTIONS: Jurisdiction[] = [
  { code: "MAS", name: "新加坡", v: "v11", status: "published", publishedAt: "05-02", affected: 41_200, ackProgress: 100, blocked: 0 },
  { code: "BaFin", name: "德国", v: "v11", status: "published", publishedAt: "05-02", affected: 18_600, ackProgress: 99.7, blocked: 4 },
  { code: "FinCEN", name: "美国", v: "v10", status: "published", publishedAt: "03-18", affected: 52_800, ackProgress: 100, blocked: 0 },
  { code: "SFC", name: "香港", v: "v12", status: "published", publishedAt: "06-08", affected: 9_400, ackProgress: 72, blocked: 312 },
];

/** I5 披露 7 章节(SFC v12 演示位)。 */
export const DISCLOSURE_CHAPTERS = [
  { no: "01", zh: "收益预估不构成承诺", en: "Earnings estimates are not guarantees" },
  { no: "02", zh: "硬件衰减与产量波动", en: "Hardware decay & output variance" },
  { no: "03", zh: "NEX 市场风险", en: "NEX market risk" },
  { no: "04", zh: "提现窗口与合规审查", en: "Withdrawal windows & compliance review" },
  { no: "05", zh: "质押不可撤销", en: "Staking is irrevocable" },
  { no: "06", zh: "网络经济与推荐激励", en: "Network economy & referral incentives" },
  { no: "07", zh: "托管、KYC 与监管管辖", en: "Custody, KYC & regulatory jurisdiction" },
];

/** I5 受限动作范围(withdraw 已实装 / staking·nexv2 待接线,SPEC §0 现状注)。 */
export const GATED_ACTIONS = [
  { key: "withdraw", name: "提现", sub: "提交提现前服务器先验披露确认", st: "已实装", tone: "ok" as const },
  { key: "staking", name: "质押锁仓", sub: "App 侧排期「后续 Sprint」,真后台应当三个都拦", st: "规划集成 · 待接线", tone: "warn" as const },
  { key: "nexv2", name: "NEX v2 锁仓", sub: "同上,与质押同一套确认存储", st: "规划集成 · 待接线", tone: "warn" as const },
];

/* ============ I6 i18n + I7 教程(合并页) ============ */
export const I6_STATS = {
  managedKeys: 768,
  totalKeys: 770,
  integrityIssues: 10,
  coursesOnline: 15,
  weeklyNexPayout: "86.4K",
};

export type Namespace = {
  ns: string; keys: number; coverage: number;
  variants: string; lastChange: string;
};
export const NAMESPACES: Namespace[] = [
  { ns: "home", keys: 128, coverage: 100, variants: "—", lastChange: "06-09" },
  { ns: "binaryHowItWorks", keys: 30, coverage: 100, variants: "—", lastChange: "05-30" },
  { ns: "exchangeHowItWorks", keys: 35, coverage: 100, variants: "—", lastChange: "06-02" },
  { ns: "premium", keys: 18, coverage: 100, variants: "—", lastChange: "05-14" },
  { ns: "marketing", keys: 64, coverage: 95, variants: "多版 ×3", lastChange: "06-05" },
  { ns: "milestones", keys: 22, coverage: 100, variants: "多版 ×1", lastChange: "06-09" },
  { ns: "team", keys: 41, coverage: 100, variants: "—", lastChange: "05-30" },
  { ns: "wallet", keys: 52, coverage: 98, variants: "—", lastChange: "06-05" },
  { ns: "trust", keys: 38, coverage: 95, variants: "—", lastChange: "05-12" },
  { ns: "genesis", keys: 29, coverage: 99, variants: "—", lastChange: "05-26" },
  { ns: "riskDisclosure", keys: 44, coverage: 100, variants: "—", lastChange: "06-08" },
  { ns: "learn", keys: 36, coverage: 100, variants: "—", lastChange: "06-01" },
];

/** I6 完整性问题清单(10 处)。 */
export const INTEGRITY_ISSUES = [
  { kind: "缺镜像 (zh)", cnt: 3, samples: ["marketing.referral.tagline", "wallet.lowBalance", "trust.heroSub"] },
  { kind: "缺镜像 (en)", cnt: 1, samples: ["genesis.dividendNote"] },
  { kind: "占位符不匹配", cnt: 2, samples: ["milestones.earnCross({n} 词序异常)", "marketing.bundle.cta({amount} 缺失)"] },
  { kind: "疑似硬编码", cnt: 4, samples: ['store/bundle 页脚 "Limited time only"', 'wallet 空态 "No transactions yet"', 'team 邀请卡 "Invite & earn"', 'earn 任务卡角标 "NEW"'] },
];

export type Course = {
  id: string; title: string; cat: string; icon: string;
  format: "Article" | "Video" | "Hands-on";
  level: "Beginner" | "Intermediate" | "Advanced";
  reward: number; featured: boolean; duration: string; v: string;
};
export const COURSES: Course[] = [
  { id: "what-is-nexion", title: "What is Nexion · 5 分钟速成", cat: "Basics", icon: "🚀", format: "Article", level: "Beginner", reward: 20, featured: true, duration: "5 min", v: "v4" },
  { id: "how-devices-earn", title: "设备怎么赚钱", cat: "Basics", icon: "🚀", format: "Video", level: "Beginner", reward: 10, featured: false, duration: "8 min", v: "v2" },
  { id: "wallet-basics", title: "钱包与账单入门", cat: "Basics", icon: "🚀", format: "Article", level: "Beginner", reward: 10, featured: false, duration: "6 min", v: "v3" },
  { id: "quests-101", title: "任务玩法 101", cat: "Earn", icon: "⚡", format: "Hands-on", level: "Beginner", reward: 15, featured: false, duration: "10 min", v: "v2" },
  { id: "staking-explained", title: "质押讲明白", cat: "Earn", icon: "⚡", format: "Video", level: "Intermediate", reward: 25, featured: false, duration: "12 min", v: "v3" },
  { id: "royalty-network", title: "网络版税是怎么分的", cat: "Earn", icon: "⚡", format: "Article", level: "Intermediate", reward: 20, featured: false, duration: "9 min", v: "v2" },
  { id: "build-your-team", title: "从 0 建团队", cat: "Team", icon: "🧬", format: "Hands-on", level: "Intermediate", reward: 20, featured: false, duration: "15 min", v: "v2" },
  { id: "v-rank-path", title: "V 等级晋升路线", cat: "Team", icon: "🧬", format: "Article", level: "Intermediate", reward: 25, featured: false, duration: "10 min", v: "v3" },
  { id: "ambassador-track", title: "大使之路", cat: "Team", icon: "🧬", format: "Video", level: "Advanced", reward: 30, featured: false, duration: "14 min", v: "v1" },
  { id: "genesis-nodes", title: "Genesis 节点经济", cat: "Wealth", icon: "💎", format: "Article", level: "Advanced", reward: 40, featured: false, duration: "16 min", v: "v2" },
  { id: "nex-tokenomics", title: "NEX 代币经济学", cat: "Wealth", icon: "💎", format: "Video", level: "Advanced", reward: 35, featured: false, duration: "13 min", v: "v2" },
  { id: "reinvest-strategy", title: "复投策略", cat: "Wealth", icon: "💎", format: "Hands-on", level: "Intermediate", reward: 30, featured: false, duration: "11 min", v: "v1" },
  { id: "kyc-express", title: "KYC-Express 触发条件", cat: "Security", icon: "🛡", format: "Article", level: "Beginner", reward: 15, featured: false, duration: "7 min", v: "v3" },
  { id: "2fa-setup", title: "开启两步验证", cat: "Security", icon: "🛡", format: "Hands-on", level: "Beginner", reward: 20, featured: false, duration: "5 min", v: "v2" },
  { id: "proof-of-compute", title: "Proof-of-Compute 怎么验", cat: "Security", icon: "🛡", format: "Article", level: "Advanced", reward: 35, featured: false, duration: "12 min", v: "v2" },
];

export const TUTORIAL_REWARD_RANGE = { min: 10, max: 50 };
export const TUTORIAL_FEATURED_DEFAULT = "what-is-nexion";

/** I7 课程效果监控(只读,设计稿表内 3 指标)。 */
export const TUTORIAL_METRICS = [
  { k: "本周开课", v: "47.2K" },
  { k: "完课率", v: "42%" },
  { k: "周完课触达回访(D7)", v: "+3.1pp" },
];

/* ============ I8 Help/Support CMS + Ticket Desk ============ */
export type SupportTicketStatus = "open" | "in_progress" | "pending_user" | "resolved" | "closed";
export type SupportTicketCategory =
  | "account"
  | "withdrawal"
  | "deposit"
  | "kyc"
  | "hardware"
  | "earnings"
  | "genesis"
  | "technical"
  | "other";
export type SupportTicketPriority = "low" | "normal" | "high" | "urgent";

export type SupportTicketMessage = {
  ts: number;
  author: "user" | "agent";
  agentName?: string;
  body: string;
};

export type SupportTicket = {
  id: string;
  subject: string;
  category: SupportTicketCategory;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  createdAt: number;
  updatedAt: number;
  lastReplyAt: number;
  unread: number;
  owner: string;
  messages: SupportTicketMessage[];
};

export type SupportFaq = {
  id: string;
  category: SupportTicketCategory | "general";
  question: string;
  answer: string;
  status: "published" | "draft";
  surface: "Help Center" | "Ticket Create" | "Nova";
  updatedAt: string;
};

export type SupportSla = {
  category: SupportTicketCategory;
  firstResponseMins: number;
  resolutionHours: number;
  queue: string;
  escalation: string;
};

export const SUPPORT_STATUS_LABEL: Record<SupportTicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  pending_user: "Awaiting user",
  resolved: "Resolved",
  closed: "Closed",
};

export const SUPPORT_CATEGORY_LABEL: Record<SupportTicketCategory | "general", string> = {
  general: "General",
  account: "Account",
  withdrawal: "Withdrawal",
  deposit: "Deposit",
  kyc: "KYC",
  hardware: "Hardware",
  earnings: "Earnings",
  genesis: "Genesis",
  technical: "Technical",
  other: "Other",
};

export const SUPPORT_PRIORITY_LABEL: Record<SupportTicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

export const SUPPORT_AGENTS = ["Marina K.", "Tomas R.", "Hiro T.", "Aisha O.", "Yuki H.", "Unassigned"] as const;

export const SUPPORT_FAQS: SupportFaq[] = [
  {
    id: "FAQ-001",
    category: "withdrawal",
    question: "Why is my withdrawal still pending?",
    answer: "Most pending withdrawals are waiting for payment desk review, network settlement, or KYC re-check. The ticket desk can attach a queue reference and ETA.",
    status: "published",
    surface: "Help Center",
    updatedAt: "2026-06-08",
  },
  {
    id: "FAQ-002",
    category: "kyc",
    question: "What should I do after a KYC rejection?",
    answer: "Re-upload a clear document image, keep the MRZ visible, and avoid cropped corners. Support can reset the Sumsub link when the retry window is exhausted.",
    status: "published",
    surface: "Ticket Create",
    updatedAt: "2026-06-05",
  },
  {
    id: "FAQ-003",
    category: "hardware",
    question: "How do I recover a disconnected NexionBox?",
    answer: "Hold power for 10 seconds, re-pair the device in the app, then attach the LED pattern to a hardware support ticket if it stays offline.",
    status: "published",
    surface: "Nova",
    updatedAt: "2026-06-01",
  },
];

export const SUPPORT_SLA: SupportSla[] = [
  { category: "withdrawal", firstResponseMins: 15, resolutionHours: 12, queue: "Payment desk", escalation: "D2 withdrawal review" },
  { category: "kyc", firstResponseMins: 30, resolutionHours: 24, queue: "Compliance desk", escalation: "C4 KYC ledger" },
  { category: "hardware", firstResponseMins: 45, resolutionHours: 48, queue: "Device ops", escalation: "E5 device ops" },
  { category: "genesis", firstResponseMins: 20, resolutionHours: 18, queue: "Genesis desk", escalation: "G4 Genesis economy" },
  { category: "account", firstResponseMins: 30, resolutionHours: 24, queue: "Account desk", escalation: "C5 security" },
  { category: "technical", firstResponseMins: 60, resolutionHours: 72, queue: "Technical desk", escalation: "A3 system config" },
];

export const SUPPORT_REPLY_TEMPLATES = [
  "已确认工单信息,我会先核对后台状态并在本线程同步处理进度。",
  "支付台账已核对,当前卡在链上确认队列;我会保留人工复核并继续跟进。",
  "请补充截图、设备 LED pattern 或交易 hash,这样我们能把工单转给对应队列。",
  "问题已处理并关闭;如果状态未更新,回复本工单会自动重新打开。",
];

const SUPPORT_T0 = Date.UTC(2026, 5, 12, 8, 0, 0);
const HOUR = 3_600_000;
const DAY = 86_400_000;

export const SUPPORT_TICKETS: SupportTicket[] = [
  {
    id: "TK-1024",
    subject: "Withdrawal pending more than 24 hours",
    category: "withdrawal",
    status: "open",
    priority: "high",
    createdAt: SUPPORT_T0 - 1.5 * DAY,
    updatedAt: SUPPORT_T0 - 4 * HOUR,
    lastReplyAt: SUPPORT_T0 - 4 * HOUR,
    unread: 2,
    owner: "Marina K.",
    messages: [
      { ts: SUPPORT_T0 - 1.5 * DAY, author: "user", body: "Hi, I requested a $250 USDT withdrawal yesterday at 14:20 UTC and it is still showing pending. Tx hash should be 0xab12..." },
      { ts: SUPPORT_T0 - 1.4 * DAY, author: "agent", agentName: "Marina K.", body: "I have escalated this to our payment desk. Reference #PD-7723." },
      { ts: SUPPORT_T0 - 6 * HOUR, author: "agent", agentName: "Marina K.", body: "Payment desk found a TRC20 network congestion delay. ETA 8-12h." },
      { ts: SUPPORT_T0 - 4 * HOUR, author: "agent", agentName: "Marina K.", body: "Quick check: has the USDT arrived yet? If not we can issue a manual replay." },
    ],
  },
  {
    id: "TK-1023",
    subject: "KYC documents rejected - what is wrong?",
    category: "kyc",
    status: "pending_user",
    priority: "normal",
    createdAt: SUPPORT_T0 - 2 * DAY,
    updatedAt: SUPPORT_T0 - 9 * HOUR,
    lastReplyAt: SUPPORT_T0 - 9 * HOUR,
    unread: 1,
    owner: "Tomas R.",
    messages: [
      { ts: SUPPORT_T0 - 2 * DAY, author: "user", body: "Just got KYC rejected but no reason was shown. My passport is valid through 2031." },
      { ts: SUPPORT_T0 - 9 * HOUR, author: "agent", agentName: "Tomas R.", body: "The rejection reason was blurry photo, MRZ unreadable. Please re-upload with better lighting." },
    ],
  },
  {
    id: "TK-1019",
    subject: "NexionBox Pro disconnected after firmware v3.4",
    category: "hardware",
    status: "in_progress",
    priority: "high",
    createdAt: SUPPORT_T0 - 3 * DAY,
    updatedAt: SUPPORT_T0 - 1 * DAY,
    lastReplyAt: SUPPORT_T0 - 1 * DAY,
    unread: 0,
    owner: "Hiro T.",
    messages: [
      { ts: SUPPORT_T0 - 3 * DAY, author: "user", body: "After the v3.4 firmware push my NexionBox Pro went offline and will not reconnect." },
      { ts: SUPPORT_T0 - 2.9 * DAY, author: "agent", agentName: "Hiro T.", body: "Amber-amber-red means WiFi auth failure after update. Hold power for 10s, then re-pair via app." },
      { ts: SUPPORT_T0 - 2 * DAY, author: "user", body: "Reset worked but it is only earning 60% of normal rate now." },
      { ts: SUPPORT_T0 - 1 * DAY, author: "agent", agentName: "Hiro T.", body: "Detected thermal throttle. We are shipping a free cleaning kit; ETA 4d." },
    ],
  },
  {
    id: "TK-1011",
    subject: "Cannot login from my new phone",
    category: "account",
    status: "resolved",
    priority: "normal",
    createdAt: SUPPORT_T0 - 7 * DAY,
    updatedAt: SUPPORT_T0 - 5 * DAY,
    lastReplyAt: SUPPORT_T0 - 5 * DAY,
    unread: 0,
    owner: "Aisha O.",
    messages: [
      { ts: SUPPORT_T0 - 7 * DAY, author: "user", body: "Got a new phone, cannot login because 2FA codes do not match." },
      { ts: SUPPORT_T0 - 6.9 * DAY, author: "agent", agentName: "Aisha O.", body: "Phone changes invalidate the old TOTP secret. I started recovery; check your email for video verification." },
      { ts: SUPPORT_T0 - 5 * DAY, author: "user", body: "All good, recovered. Thanks!" },
    ],
  },
  {
    id: "TK-1007",
    subject: "Genesis Node #4192 not received",
    category: "genesis",
    status: "closed",
    priority: "urgent",
    createdAt: SUPPORT_T0 - 12 * DAY,
    updatedAt: SUPPORT_T0 - 10 * DAY,
    lastReplyAt: SUPPORT_T0 - 10 * DAY,
    unread: 0,
    owner: "Marina K.",
    messages: [
      { ts: SUPPORT_T0 - 12 * DAY, author: "user", body: "Purchased Genesis Node #4192 two days ago, tx confirmed but NFT not in wallet." },
      { ts: SUPPORT_T0 - 11.9 * DAY, author: "agent", agentName: "Marina K.", body: "Confirmed your purchase. Mint queue had a backlog; yours is bumped to priority." },
      { ts: SUPPORT_T0 - 10 * DAY, author: "user", body: "Received, all good." },
    ],
  },
];
