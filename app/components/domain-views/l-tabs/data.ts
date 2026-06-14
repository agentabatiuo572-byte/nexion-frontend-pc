/**
 * L 域(数据与分析 BI)专属 mock — design_handoff_l_domain 逐字 port。
 * 口径单一源铁律:KPI 数值/目标 join 自 KPIS、漏斗 join 自 FUNNEL、收入 join 自 REVENUE、
 * 负债/覆盖率/到期取 LEDGER/LIABILITIES/MATURITY、佣金 kind 命名引 F5_KINDS、Phase 标签引 PHASES——
 * 本文件只补「BI 下钻扩展字段」,绝不复制权威数值(权威改值 L 域自动跟)。
 */
import { KPIS, FUNNEL, REVENUE, MAT_7D } from "@/lib/mock/admin/design-data";
export { RESERVE_COVER_DAYS } from "@/lib/mock/admin/design-data";
import { LEDGER } from "@/lib/mock/admin/ledger";

export const WEEKS = ["W16", "W17", "W18", "W19", "W20", "W21", "W22"];
export const PHASE_SWITCH_IDX = 3; // W19 → P2(激活)→P3(扩张) 切换标记
export const KPI_COLORS = ["#9EDC1D", "#FF6B35", "#B6A4FF", "#FFBE3D", "#29D27F", "#6FB7FF", "#DD6F5C", "#E0C36A"];

/* ===== L1 · KPI 下钻扩展(join KPIS by n;value/target/spark 一律读 KPIS 不复制) ===== */
export const KPI_PLAIN: Record<number, string> = {
  1: "注册后 90 秒内收到首笔收益的人 ÷ 新注册人数",
  2: "注册满 7 天还在打开 app 的人 ÷ 同批注册人数",
  3: "逛过商城的人 ÷ 新注册人数",
  4: "完成付款的人 ÷ 逛过商城的人",
  5: "发出过邀请的设备持有者 ÷ 设备持有者总数",
  6: "点开推送的次数 ÷ 推送发送次数",
  7: "直推用户中首单触发了佣金的 ÷ 直推总数",
  8: "1,000 台创世节点全部售出用了几天",
};
export type KpiJump = { label: string; href?: string }; // href 缺省 = 跨域归因占位(toast)
export const KPI_EXT: Record<number, { fx: string; fxBold: string[]; num: string; den: string; delta: string; note: string; jump: KpiJump[] }> = {
  1: { fx: "device.first_yield_received.latency_sec ≤ 90 ÷ auth.register_completed", fxBold: ["device.first_yield_received", "auth.register_completed"], num: "27,491", den: "28,518", delta: "+0.3", note: "注册后 90 秒内收到首笔算力收益的比例。低于线通常是开机引导或设备分配排队问题。", jump: [{ label: "跳 L2 漏斗", href: "/analytics/funnel-cohort" }, { label: "跳 L4 设备报表", href: "/analytics/operations" }] },
  2: { fx: "day7 有 app.dau ÷ register cohort", fxBold: ["app.dau"], num: "15,224", den: "26,158", delta: "-0.6", note: "最弱预警项(黄灯·距红线最近)。W20 起连续 3 周低于 60% 目标——归因方向:P3 扩张期拉新放量稀释质量 + Nova 推送节奏(跳 B4 / I2 核对)。", jump: [{ label: "跳 L2 留存矩阵", href: "/analytics/funnel-cohort" }, { label: "归因 B4 节奏" }] },
  3: { fx: "store.viewed 去重用户 ÷ 注册数", fxBold: ["store.viewed"], num: "9,725", den: "28,518", delta: "+0.9", note: "浏览类行为由客户端上报(算法已锁定),丢一两条不影响资金账。", jump: [{ label: "跳 L2 漏斗", href: "/analytics/funnel-cohort" }] },
  4: { fx: "checkout.completed ÷ store.viewed", fxBold: ["checkout.completed", "store.viewed"], num: "661", den: "9,725", delta: "+0.2", note: "健康带 5–10%。当前 6.8% 带内偏低段——黄灯。trial 子漏斗(H2)为本级补充维度,不并入分子分母。", jump: [{ label: "跳 L2 漏斗", href: "/analytics/funnel-cohort" }, { label: "I1 文案实验" }] },
  5: { fx: "设备持有者 referral.invite_sent ÷ 设备持有者数", fxBold: ["referral.invite_sent"], num: "17,103", den: "41,208", delta: "+0.3", note: "语义注:严格为「推广率」(发出邀请的设备持有者比例),非收入口径。", jump: [{ label: "跳 L4 网络报表", href: "/analytics/operations" }] },
  6: { fx: "nova.push_clicked ÷ nova.push_sent", fxBold: ["nova.push_clicked", "nova.push_sent"], num: "212,448", den: "778,200", delta: "+0.3", note: "推送事件早已登记、算法早已定义,数据没有缺口。节奏配置在 I2 调。", jump: [{ label: "I2 推送节奏" }] },
  7: { fx: "L1 被推荐人首单 commission.paid ÷ 直推数", fxBold: ["commission.paid"], num: "6,213", den: "8,175", delta: "+1.0", note: "黄灯。依赖 F 域分销关系树;完整下钻在 L4 网络/团队结构报表。", jump: [{ label: "跳 L4 团队下钻", href: "/analytics/operations" }, { label: "F5 佣金审计" }] },
  8: { fx: "genesis.purchased 累计达 1,000 张的天数", fxBold: ["genesis.purchased"], num: "1,000 张", den: "11 天", delta: "-1", note: "越小越好(目标 < 14 天)。财务侧下钻(收入 + 日分红负债)在 L3。", jump: [{ label: "跳 L3 财务报表", href: "/analytics/financial" }] },
};
// KPI 状态灯判定移至 design-data(与 KPIS 同源,首页 KpiWall 共用);此处 re-export 保持视图 import 路径不变。
export { kpiState } from "@/lib/mock/admin/design-data";

/* ===== L2 · 漏斗下钻扩展(join FUNNEL by index;users/cvr 读 FUNNEL 不复制) ===== */
export const FUNNEL_EXT = [
  // lost 分解与级间差额闭合:注册→绑卡流失 128,400−97,300=31,100;绑卡→首购 97,300−33,180=64,120(子项为其内含拆分)。
  { plain: "完成注册", inflow: "—(漏斗顶)", lost: "未完成绑卡 31,100 人(24.2%)· 特征:注册后 48h 未进 store 占 79% · 无 ref 渠道占 61%", dwell: [18, 26, 34, 22, 12, 6, 4, 2], note: "注册到下一级的主要流失是「注册后 48h 内未打开 store」——文案位归 I1,推送召回归 I2。" },
  { plain: "花 $1 完成快速实名", inflow: "上级流入 128,400", lost: "卡验证失败 8,210 · 中途放弃 21,870 · 高风险 BIN 拦截 1,020(K1)", dwell: [8, 22, 30, 24, 14, 8, 5, 3], note: "$1 预授权失败重试成功率 64%——失败转化挽回话术归 I1,BIN 风控归 K1。" },
  { plain: "完成第一笔设备订单", inflow: "上级流入 97,300", lost: "进 store 未下单 64,120(其中加购未支付 7,840 · 支付失败 1,160→D1)", dwell: [4, 9, 16, 22, 24, 14, 8, 3], note: "本级下方叠加 trial 子漏斗——试用转化单独计算,不算进首购转化率。", trial: true, tg: ">30%" },
  { plain: "再次下单(暂用二次下单口径)", inflow: "上级流入 33,180", lost: "单设备持有未复投 24,260 · 特征:首购 30 天内复投占复投者 72%", dwell: [2, 5, 9, 14, 20, 24, 16, 10], note: "V1 先拿「第二次下单」当复投;等钱包复投事件上线(V3)后两个口径一起看。和驾驶舱的处理方式一致。", v1: true },
  { plain: "发起提现申请", inflow: "设备持有者中发起提现", lost: "未提现持有者 11,540 · 其中余额 < 提现下限占 58%", dwell: [6, 12, 18, 22, 18, 12, 8, 4], note: "提现兑付健康(已提交→已兑付)在 L3 兑付报表;此处只看转化级。" },
];
export const TRIAL_STEPS = [
  { e: "trial.claim_sheet_shown", n: 18420 },
  { e: "trial.started", n: 11273, arr: "61.2%", arrLb: "领取率" },
  { e: "trial.redeemed", n: 2525, arr: "22.4%", arrLb: "trial→购买" },
];
export const COHORTS = [
  { w: "2026-W17", size: 21080, d1: 74, d7: 62, d30: 41 },
  { w: "2026-W18", size: 22104, d1: 75, d7: 61, d30: 40 },
  { w: "2026-W19", size: 24880, d1: 74, d7: 59, d30: 38 },
  { w: "2026-W20", size: 26420, d1: 75, d7: 58, d30: 36 },
  { w: "2026-W21", size: 26158, d1: 74, d7: 58, d30: null },
  { w: "2026-W22", size: 28940, d1: 73, d7: null, d30: null },
] as { w: string; size: number; d1: number | null; d7: number | null; d30: number | null }[];
export const CURVES: Record<string, [number, number][]> = {
  W21: [[0, 100], [1, 74], [2, 69], [3, 65], [5, 61], [7, 58], [10, 52], [14, 47], [21, 42], [30, 38]],
  W18: [[0, 100], [1, 75], [2, 71], [3, 68], [5, 65], [7, 61], [10, 56], [14, 51], [21, 45], [30, 40]],
  W20: [[0, 100], [1, 75], [2, 70], [3, 66], [5, 61], [7, 58], [10, 53], [14, 48], [21, 42], [30, 36]],
};
export const XD: Record<string, { rows: [string, number, number, number, number, number][]; alert: [number, number]; unit: string; msg: { pre: string; bold: string; post: string } }> = {
  cvr: {
    rows: [["ref 自然量", 7.4, 7.1, 6.8, 6.2, 6.9], ["ref NX-大使", 8.2, 7.9, 7.5, 7.0, 7.7], ["ref TikTok", 6.1, 5.8, 3.1, 5.5, 5.1], ["ref Meta", 6.8, 6.4, 6.0, 5.9, 6.3]],
    alert: [2, 3], unit: "%",
    msg: { pre: "异常信号 · P3 期 · 渠道 ", bold: "ref TikTok × locale es", post: " 首购 CVR 3.1%,显著低于行均值 6.5%(−52%)。归因入口 →" },
  },
  ret: {
    rows: [["ref 自然量", 61, 60, 58, 56, 59], ["ref NX-大使", 64, 63, 61, 60, 62], ["ref TikTok", 54, 53, 49, 51, 52], ["ref Meta", 58, 57, 55, 54, 56]],
    alert: [2, 3], unit: "%",
    msg: { pre: "异常信号 · ", bold: "ref TikTok", post: " 整行 Day7 留存低于其他渠道 5–8pt——低质量买量特征,渠道质量归因跳 F 域。" },
  },
  trial: {
    rows: [["ref 自然量", 23.8, 22.9, 21.4, 20.8, 22.2], ["ref NX-大使", 26.1, 25.4, 24.0, 23.2, 24.7], ["ref TikTok", 19.0, 18.2, 14.6, 17.5, 17.3], ["ref Meta", 21.6, 20.8, 19.9, 19.2, 20.4]],
    alert: [2, 3], unit: "%",
    msg: { pre: "异常信号 · trial 子漏斗同样在 ", bold: "TikTok × es", post: " 显著走低——与主漏斗首购转化同向,试用规则归 H2,文案归 I 域。" },
  },
};

/* ===== L3 · 财务报表 ===== */
// 收入结构:金额单一源 REVENUE(B 域同源);此处只补事件来源/环比/序列色。
export const REV_EXT = [
  { nm: "设备销售 GMV", src: "checkout.completed", amt: REVENUE.gmv, mom: "+6.8%", up: true, color: "#9EDC1D" },
  { nm: "团队分润佣金", src: "commission.paid(按计提额)", amt: REVENUE.commission, mom: "+11.4%", up: true, color: "#B6A4FF" },
  { nm: "代币经济", src: "exchange.swapped(新事件登记前先归并到这里)", amt: REVENUE.token, mom: "+9.2%", up: true, color: "#6FB7FF" },
  { nm: "算力撮合服务费", src: "服务费事件(新增 · 正式登记前先归并)", amt: REVENUE.marketFee, mom: "-2.1%", up: false, color: "#FFBE3D" },
];
export const REDEMPTION = { submitted: 12840, confirmed: 12416, avgLatency: "7.4h", rejected: 182, delayed: 198, frozen: 44, prevRate: 96.3, prevLabel: "2026-04" };
// 12 周覆盖率走势:后 8 点 = LEDGER.coverageSeries(单源锚定,末值即当前覆盖率);
// 前 4 点为回溯演示窗(含两次历史破黄线,供 breach 事件标注叙事;红黄线由 LEDGER 持有)。
export const COVERAGE_12W = [121, 119, 109.4, 113, ...LEDGER.coverageSeries];
export const COVERAGE_WKS = ["3/02", "3/09", "3/16", "3/23", "3/30", "4/06", "4/13", "4/20", "4/27", "5/04", "5/11", "5/18"];
export const BREACHES = [
  { i: 2, type: "cov", label: "3/16 覆盖率破黄线 · coverage_threshold_breached(2.1h 后回升)" },
  { i: 5, type: "run", label: "4/08 挤兑比率破线 · bankrun_threshold_breached(B5 雷达已联动)" },
];
// 负债到期:7d 三值从 MATURITY(7 日序列)聚合;30d 为 4 周排程 mock(首周 = 7d 聚合,自洽)。
// 聚合与可覆盖天数已上收 design-data(MAT_7D / RESERVE_COVER_DAYS,D3/B2/L3 三处同源),此处引用不另算。
const mat7 = MAT_7D;
export const MAT_SCHEDULE = {
  weeks: ["本周", "+1 周", "+2 周", "+3 周"],
  // 每周 [提现, 利息, Genesis 分红](USD);首周 = MATURITY 7 日聚合
  data: [
    [mat7.withdraw, mat7.interest, mat7.genesis],
    [mat7.withdraw * 0.9, mat7.interest * 0.95, mat7.genesis * 1.05],
    [mat7.withdraw * 0.96, mat7.interest * 1.02, mat7.genesis * 1.1],
    [mat7.withdraw * 0.84, mat7.interest * 0.98, mat7.genesis * 1.15],
  ],
};
// 30d 窗口 = 4 周排程列合计(与排程图自洽);7d = MATURITY 聚合。
export const MATURITY_WIN = {
  "7d": { withdraw: mat7.withdraw, interest: mat7.interest, genesis: mat7.genesis },
  "30d": {
    withdraw: MAT_SCHEDULE.data.reduce((s, w) => s + w[0], 0),
    interest: MAT_SCHEDULE.data.reduce((s, w) => s + w[1], 0),
    genesis: MAT_SCHEDULE.data.reduce((s, w) => s + w[2], 0),
  },
};
// 储备可覆盖到期天数:单源 = design-data.RESERVE_COVER_DAYS(顶部 re-export,D3/B2/L3 同数)。

/* ===== L4 · 设备 / 任务 / 网络 / Phase ===== */
// 代际 × 机型分布:机型对齐 E1 商品目录真实 SKU(lifecycle:S1/Pro/P1=legacy,Pro v2/P2=Gen-2 current);
// 设备台数为 BI 演示分布,合计 = 41,208(活跃设备口径,各处派生同值)。
export const DEV_DIST = [
  { nm: "NexionBox S1", gen: "legacy", n: 18204, color: "#B6A4FF" },
  { nm: "NexionBox Pro", gen: "legacy", n: 9412, color: "#8A95A8" },
  { nm: "NexionBox Pro v2", gen: "current", n: 8108, color: "#9EDC1D" },
  { nm: "NexionRack P1", gen: "legacy", n: 3254, color: "#B6E84A" },
  { nm: "NexionRack P2", gen: "current", n: 2230, color: "#29D27F" },
];
export const DEV_TOTAL = DEV_DIST.reduce((s, d) => s + d.n, 0); // 41,208
export const DEV_TILES = { locked: 28406, retired: 2114, dailyUsd: "$141.0K", dailyNex: "38,420 NEX" };
export const DECAY_SEGS = [
  { m: "月 1–6 段", r: "-4%/月", tone: "var(--success)", imp: "影响产出 −$3.2K/日" },
  { m: "月 7–12 段", r: "-6%/月", tone: "var(--warning)", imp: "影响产出 −$5.8K/日" },
  { m: "月 13+ 段", r: "-10%/月", tone: "var(--danger)", imp: "影响产出 −$2.1K/日" },
  { m: "MIN_EFFICIENCY", r: "地板生效 412 台", tone: "var(--ink-2)", imp: "已触底设备占 1.0%" },
];
export const TASK_TILES = { done: "1.84M", dispatched: "3.18M", doneN: 1838000, dispatchedN: 3180000, saturation: "63%", checkin: "61,420", tierAvg: "$0.042" };
export const TIERS = [
  { nm: "tier-1 · 轻量验证", n: 710000, acc: 94, color: "#9EDC1D" },
  { nm: "tier-2 · 数据标注", n: 486000, acc: 88, color: "#B6E84A" },
  { nm: "tier-3 · 渲染切片", n: 318000, acc: 71, color: "#29D27F" },
  { nm: "tier-4 · 模型微调", n: 188000, acc: 62, color: "#FFBE3D" },
  { nm: "tier-5 · 批量推理", n: 96000, acc: 41, color: "#FF6B35" },
  { nm: "tier-6 · 专项算力", n: 40000, acc: 33, color: "#DD6F5C" },
];
export const VR_HIST = [9120, 6820, 4410, 2980, 2010, 1340, 860, 520, 300, 170, 90, 40, 12];
export const REF_DIST = [
  { nm: "直推 0(纯持有)", n: 24105, color: "#8A95A8" },
  { nm: "直推 1–3", n: 10240, color: "#B6A4FF" },
  { nm: "直推 4–10", n: 4820, color: "#9EDC1D" },
  { nm: "直推 11–50", n: 1742, color: "#FFBE3D" },
  { nm: "直推 50+", n: 301, color: "#FF6B35" },
];
// 佣金触发结构:kind 命名/排序对齐 F5(佣金事件审计)6 kind;network+binary 合计 64%(F5 主航道口径)。
export const COMM_DIST = [
  { nm: "network 网络版税", pct: 42, color: "#9EDC1D" },
  { nm: "binary 平衡匹配", pct: 22, color: "#B6A4FF" },
  { nm: "peer 平级奖", pct: 14, color: "#6FB7FF" },
  { nm: "cultivation 育成", pct: 10, color: "#FFBE3D" },
  { nm: "leadership 领导池", pct: 8, color: "#29D27F" },
  { nm: "genesis 版税", pct: 4, color: "#DD6F5C" },
];
export const TEAM_GMV = "$2.84M / 周 · 占总 GMV 43%";
// Phase 效果对比:列标签对齐 H1/B4 的 PHASES 权威命名(P1 拉新/P2 激活/P3 扩张〔当前〕/P4 深化/P5 收紧/P6 软退场)。
// P2→P3 阶跃叙事与 PHASE.dials 同向:扩张期拉新放量稀释留存 + 提现冷却拉长(30d)压提现量。
export const PH_ROWS: { nm: string; vals: string[]; steps: string[] }[] = [
  { nm: "Day7 留存", vals: ["64.1%", "61.0%", "58.2%", "—", "—", "—"], steps: ["", "-3.1pt", "-2.8pt", "", "", ""] },
  { nm: "首购 CVR(L3→L4)", vals: ["5.4%", "6.2%", "6.8%", "—", "—", "—"], steps: ["", "+0.8pt", "+0.6pt", "", "", ""] },
  { nm: "设备日产 / 台", vals: ["$3.61", "$3.52", "$3.42", "—", "—", "—"], steps: ["", "-2.5%", "-2.8%", "", "", ""] },
  { nm: "任务承接率", vals: ["71%", "64%", "57.8%", "—", "—", "—"], steps: ["", "-7pt", "-6.2pt", "", "", ""] },
  { nm: "提现量(周)", vals: ["$1.9M", "$2.6M", "$2.1M", "—", "—", "—"], steps: ["", "+37%", "-19%", "", "", ""] },
  { nm: "佣金触发率(#7)", vals: ["68%", "73%", "76%", "—", "—", "—"], steps: ["", "+5pt", "+3pt", "", "", ""] },
];

/* ===== L5 · 导出 & 监管 ===== */
export type ExportTask = {
  id: string; type: string; scope: string; fields: string; pii: boolean;
  mask: "masked" | "partial" | "—"; rows: string; st: string; chain: string; acts: ("approve" | "download" | "retry")[];
};
export const EXPORT_TASKS: ExportTask[] = [
  { id: "EXP-2214", type: "账单 CSV(8 类含 bonus/adjustment)", scope: "2026-05 · 全量用户", fields: "金额/type/ref + 手机号(hash)", pii: true, mask: "masked", rows: "482,031", st: "pending_confirm", chain: "财务 jchen → 超管待批", acts: ["approve"] },
  { id: "EXP-2213", type: "团队树明细", scope: "全网 · userId 维度(含直推/团队边)", fields: "userId/直推边/团队规模", pii: true, mask: "partial", rows: "1,283,400", st: "pending_split_confirm", chain: "增长 mliu → 超管待批(超限拆分)", acts: ["approve"] },
  { id: "EXP-2212", type: "漏斗序列(聚合)", scope: "W17–W22 · 5 级 CVR", fields: "去重计数/CVR/留存率", pii: false, mask: "—", rows: "1,240", st: "generating", chain: "仍需操作确认(聚合)", acts: [] },
  { id: "EXP-2211", type: "财务报表(聚合汇总)", scope: "2026-05 · 四报表", fields: "聚合金额/比率", pii: false, mask: "—", rows: "318", st: "ready", chain: "仍需操作确认(聚合)", acts: ["download"] },
  { id: "EXP-2209", type: "KPI 序列", scope: "8 KPI × 12 周", fields: "值/目标/环比", pii: false, mask: "—", rows: "96", st: "expired", chain: "仍需操作确认(聚合)", acts: ["retry"] },
  { id: "EXP-2208", type: "监管报告 · BR 专项", scope: "BR 辖区 · 披露 v3.2-BR", fields: "合规台账(脱敏)", pii: true, mask: "masked", rows: "12,407", st: "failed", chain: "风控 rkim → 风控 lead 已批", acts: ["retry"] },
];
export const ST_LABEL: Record<string, [string, string]> = {
  pending: ["待处理", "dim"], pending_confirm: ["待确认", "warn"], pending_split_confirm: ["超限待超管批", "warn"],
  generating: ["生成中", "cyan"], ready: ["可下载 · TTL 24h", "ok"], expired: ["链接已过期", "dim"], failed: ["失败 · 可重试", "bad"],
  rejected: ["已驳回", "bad"], // 执行门槛 驳回态(裁决在 A2 确认队列承载,本表呈现终态)
};
export const REG_TEMPLATES = [
  { key: "kyc", nm: "KYC 合规报告", cy: "季度 · 辖区按需", meta: "KYC 通过率 / 复审队列 / 大额复审台账 · KYC 状态以用户域为准 · 附确认单号关联", last: "上次:2026-Q1 · 已报送", icon: "kyc" },
  { key: "redemption", nm: "资金兑付报告", cy: "月度", meta: "兑付率 / 覆盖率走势 / 净敞口 / 负债到期 · 数字取自 L3 财务报表(与双账本一致)· 附破线预警记录", last: "上次:2026-05 · 生成中", icon: "fund" },
  { key: "aml", nm: "反洗钱 AML 报告", cy: "季度 / 专项", meta: "大额异动 / 去重簇(K1)/ 套利信号(K2)/ 冻结处置台账 · 风险评分分布(K4)", last: "上次:2026-Q1 · 已报送", icon: "shield" },
  { key: "jurisdiction", nm: "司法辖区专项", cy: "专项 · 点名响应", meta: "按辖区定制 · 引用当前披露版本 × 辖区(I5)· geo-block 状态(J2)/ 应急执行(J4)附录", last: "上次:BR 专项 · 5/12", icon: "geo" },
];
export const J4_TRACE = [
  { tone: "var(--danger)", txt: ["BR 监管点名剧本执行", " · geo-block BR + 兑换/Genesis 熔断 + 披露 v3.2-BR 发布 · 8 步全部完成"], ts: "5/12 14:02" },
  // 与 L3 敞口图 bankrun breach(4/08)同一事件同日自洽;文案按 R1 现行判据(挤兑比率破 B5 红线→withdraw 闸)改写,非设计稿旧判据(5.2× 均值→兑换+Genesis)。
  { tone: "var(--warning)", txt: ["挤兑比率破线自动熔断", " · 24h 提现申请 ÷ 储备破 B5 红线命中 R1 · 提现闸自动关停,值班 22 分钟补填理由"], ts: "4/08 03:41" },
  { tone: "var(--success)", txt: ["恢复演练(季度)", " · 全剧本 dry-run · 平均步时延 4.2 分钟 · 无超时升级"], ts: "4/29 10:00" },
];
export const MASK_RULES = [
  { f: "手机号", cat: "PII", catTone: "bad", rule: "masked", ruleNote: "hash", dec: "是", appr: "操作确认 + 强制事由" },
  { f: "卡 token", cat: "PII", catTone: "bad", rule: "partial", ruleNote: "保留后 4 位", dec: "是", appr: "操作确认 + 强制事由" },
  { f: "地址", cat: "PII", catTone: "bad", rule: "partial", ruleNote: "截断至行政区", dec: "是", appr: "操作确认 + 强制事由" },
  { f: "userId", cat: "监管", catTone: "dim", rule: "partial", ruleNote: "保留(关联键)", dec: "—", appr: "非明文 PII" },
  { f: "账单金额 / type(含 bonus)", cat: "资金", catTone: "warn", rule: "", ruleNote: "保留 · 批量导出走操作确认", dec: "—", appr: "含 PII 同表时随表脱敏" },
  { f: "账单 ref(订单/提现 ID)", cat: "资金", catTone: "warn", rule: "partial", ruleNote: "业务关联键", dec: "—", appr: "—" },
];
export const EXPORT_PARAMS = [
  { k: "含敏感数据导出操作确认", v: "强制开启", fixed: true, s: "含 PII / 资金明细 / 监管报表的批量导出,一律 操作员 · 执行门槛:" },
  { k: "默认脱敏策略", v: "默认脱敏", cur: "默认脱敏(解密须强操作确认)", s: "手机号 hash / 卡 token 掩码后 4 位 / 地址截断 · 见下方字段级规则表" },
  { k: "下载链接 TTL", v: "24 小时", cur: "24h(范围 1–72h)", s: "server 签发限时链接,过期重新发起 · 防长期暴露" },
  { k: "账单导出范围", v: "8 类 BillType", cur: "8 类全选(可按 type 勾选)", s: "swap / topup / withdraw / earning / commission / refund / bonus / adjustment(D4 权威,不得静默丢失 bonus 与 adjustment)" },
  { k: "单任务行数上限", v: "100 万行", cur: "100 万行(范围 10 万–500 万)", s: "超限走拆分确认(超管批)· 防单次超大导出" },
  { k: "监管报告周期", v: "按辖区要求", cur: "月 / 季 / 年 / 专项,按需", s: "与 I5 披露版本 × 司法辖区联动" },
];
export const AUDIT_ROWS = [
  { ts: "5/29 16:40", who: "finance jchen", what: "财务明细 · 2026-05", rows: "48,210", pii: true, mask: "masked", chain: "jchen / super_w ✓", dl: "已下载 1 次" },
  { ts: "5/28 11:02", who: "growth mliu", what: "运营聚合 · W21", rows: "812", pii: false, mask: "—", chain: "仍需操作确认(聚合)", dl: "已下载" },
  { ts: "5/26 09:15", who: "auditor zfan", what: "用户名单导出(来自用户域)· KYC pending", rows: "1,043", pii: true, mask: "partial", chain: "zfan / super_w ✓", dl: "已下载" },
  { ts: "5/22 14:30", who: "risk rkim", what: "监管报告 · BR 专项 · 披露 v3.2-BR", rows: "12,407", pii: true, mask: "masked", chain: "rkim / risklead_h ✓", dl: "已报送" },
  { ts: "5/20 10:08", who: "growth mliu", what: "KPI 序列 · 8×12 周", rows: "96", pii: false, mask: "—", chain: "仍需操作确认(聚合)", dl: "链接过期" },
  { ts: "5/12 15:11", who: "auditor zfan", what: "解密导出 · 司法调证(事由:法院令 BR-0512)", rows: "38", pii: true, mask: "decrypted", chain: "zfan / super_w ✓", dl: "已下载 · 高亮" },
];
export const L5_STATS = { monthTotal: 47, aggCount: 38, sensitiveCount: 9, decryptedQ: 1, regulatoryQ: 3 };
/* L5 报送排程 & 报表模板(既有真功能保留,L.report.* 真写契约) */
export const SCHEDULE_OPTS = ["每月 5 日", "每月 1 日", "每月 10 日", "每月 15 日", "每月最后一日", "每周一", "每季度首月 5 日"] as const;
export const SCHEDULE_DEFAULT = "每月 5 日";
