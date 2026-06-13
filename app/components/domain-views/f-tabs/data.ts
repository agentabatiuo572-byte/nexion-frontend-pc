/**
 * F 域子视图静态数据 —— 全部 backend-replaceable(可序列化常量,真后台接入零重写):
 * GET /api/admin/f/{vrank|unilevel|tiers|binary|pool|quota|commissions} 各返回同结构。
 * 口径镜像前端真源:VRANK←v-rank.ts、V_VOTES←leadership-pool.ts、UNILEVEL←影响力网络版税表。
 */

/* ===== F1 V-Rank 13 阶(门槛/实物奖/培育奖 NEX/在册人数)===== */
export const VRANK: { v: string; th: string; prize: string; nex: string; pop: number }[] = [
  { v: "V0", th: "—", prize: "—", nex: "—", pop: 84231 },
  { v: "V1", th: "自买 $299 · 直推 3", prize: "Pilot 徽章", nex: "500", pop: 12483 },
  { v: "V2", th: "团队 GV $5k", prize: "操作员勋章", nex: "2,000", pop: 3247 },
  { v: "V3", th: "团队 GV $20k · 2×V1", prize: "Apple Watch SE", nex: "10,000", pop: 487 },
  { v: "V4", th: "团队 GV $50k · 3×V2", prize: "iPhone 16 Pro", nex: "50,000", pop: 102 },
  { v: "V5", th: "团队 GV $150k · 4×V3", prize: "Apple Vision Pro", nex: "200,000", pop: 21 },
  { v: "V6", th: "团队 GV $500k · 5×V4", prize: "Rolex Submariner", nex: "800,000", pop: 3 },
  { v: "V7", th: "团队 GV $1M · 6×V5", prize: "Tesla Model Y", nex: "3,200,000", pop: 1 },
  { v: "V8", th: "团队 GV $3M · 7×V6", prize: "Porsche 911", nex: "10,000,000", pop: 0 },
  { v: "V9", th: "团队 GV $10M", prize: "Lamborghini Urus", nex: "—", pop: 0 },
  { v: "V10", th: "团队 GV $30M", prize: "私人飞机包月", nex: "—", pop: 0 },
  { v: "V11", th: "团队 GV $100M", prize: "加勒比游艇度假", nex: "—", pop: 0 },
  { v: "V12", th: "团队 GV $500M", prize: "上市公司股权", nex: "—", pop: 0 },
];
export const F1_FULFILL: { v: string; name: string; ct: number }[] = [
  { v: "V3", name: "Apple Watch SE", ct: 24 },
  { v: "V4", name: "iPhone 16 Pro", ct: 10 },
  { v: "V5", name: "Apple Vision Pro", ct: 3 },
  { v: "V6", name: "Rolex Submariner", ct: 1 },
];

/* ===== F2 网络版税(L1-L7 Unilevel + Rate Tier + 8 参数卡)===== */
export const UNILEVEL: { l: string; usdt: number; nex: number; ui: string; direct: boolean }[] = [
  { l: "L1", usdt: 10, nex: 50, ui: "直推 DIRECT", direct: true },
  { l: "L2", usdt: 5, nex: 20, ui: "扩展 EXTENDED", direct: false },
  { l: "L3", usdt: 3, nex: 10, ui: "扩展", direct: false },
  { l: "L4", usdt: 2, nex: 5, ui: "扩展", direct: false },
  { l: "L5", usdt: 1, nex: 2.5, ui: "扩展", direct: false },
  { l: "L6", usdt: 0.5, nex: 1, ui: "扩展", direct: false },
  { l: "L7", usdt: 0.5, nex: 1, ui: "扩展", direct: false },
];
export const RATETIER: { nm: string; req: string; rate: string; dist: string; cls: string }[] = [
  { nm: "Standard", req: "$0+ 网络 GMV", rate: "8%", dist: "62%", cls: "t-0" },
  { nm: "Verified", req: "$5,000+ 网络 GMV", rate: "10%", dist: "24%", cls: "t-1" },
  { nm: "Premium", req: "$50,000+ 网络 GMV", rate: "12%", dist: "11%", cls: "t-2" },
  { nm: "Diamond", req: "$500,000+ 网络 GMV", rate: "15%", dist: "3%", cls: "t-3" },
];
// 8 参数卡:amp = 逻辑放大(操作确认 amplifies);vamp = 卡面 ⚡ 视觉(仅 promo/peer 显示,对齐设计稿)。
export const F2_PARAMS: {
  id: string; name: string; key: string; def: string; vcls: string; sub: string; amp: boolean; vamp: boolean; unit?: string;
}[] = [
  { id: "clamp", name: "影响分上下限", key: "F.influence.clamp", def: "1.0 – 5.0", vcls: "", sub: "InfluenceScore 上下限;clamp 后参与版税权重计算。", amp: false, vamp: false },
  { id: "cool", name: "佣金冷却", key: "F.cooldown", def: "30d", vcls: "", sub: "计提后冷却期;期满才进入可提余额。改后对新计提佣金生效。", amp: false, vamp: false, unit: "天" },
  { id: "promo", name: "promo 周倍率", key: "F.promo.weekMultiplier", def: "1.0×", vcls: "warn", sub: "活动周对网络版税的倍率放大。放大佣金流出,受 B1 覆盖率约束。", amp: true, vamp: true, unit: "×" },
  { id: "min", name: "版税支付阈值", key: "F.royalty.minPayout", def: "$10", vcls: "", sub: "最小可提金额。调高 = 凑不够提不出(提现摩擦)。", amp: false, vamp: false },
  { id: "peer", name: "peer 平级比例", key: "F.peer.rate", def: "5%", vcls: "brand", sub: "同 V 级平级奖励比例(V3+)。放大佣金流出。", amp: true, vamp: true, unit: "%" },
  { id: "depth", name: "深度门槛", key: "F.unilevel.depthGate", def: "V2+", vcls: "cyan", sub: "L4 以下层级需 V2 以上才解锁(防止低层级套利簇)。", amp: false, vamp: false },
  { id: "nexcap", name: "NEX/USDT 折算上限", key: "F.unilevel.nexCap", def: "$50/d", vcls: "", sub: "单用户单日 NEX 派发折算 USDT 的上限,封顶虹吸。", amp: false, vamp: false },
  { id: "backfill", name: "回溯窗口", key: "F.unilevel.backfill", def: "0d", vcls: "", sub: "改后是否回溯已计提(原则上不回溯,保留为运营紧急选项)。", amp: true, vamp: false, unit: "天" },
];

/* ===== F3 双轨结算(用户 A/B 轨)===== */
export const BINARY: { user: string; a: number; b: number; match: number; today: number; state: string; tone: "ok" | "warn" | "err" }[] = [
  { user: "usr_31E8", a: 84000, b: 62000, match: 6200, today: 1500, state: "结算中", tone: "ok" },
  { user: "usr_19C7", a: 38000, b: 41000, match: 3800, today: 1500, state: "达封顶", tone: "warn" },
  { user: "usr_02A9", a: 12000, b: 800, match: 0, today: 0, state: "阻塞 · B轨 < $1k", tone: "err" },
  { user: "usr_84F2", a: 5400, b: 4900, match: 490, today: 490, state: "结算中", tone: "ok" },
];
export const BINARY_MAX_AB = 84000;

/* ===== F4 池/配额/大使/榜 + V_VOTES ===== */
export const F4_QUOTA: { nm: string; cur: number; cap: number; tight: boolean }[] = [
  { nm: "Pro", cur: 48, cap: 70, tight: false },
  { nm: "Rack", cur: 22, cap: 26, tight: true },
];
export const F4_AMB_BANDS: { nm: string; ct: number }[] = [
  { nm: "KOL", ct: 3 }, { nm: "EVENT", ct: 2 }, { nm: "AD", ct: 1 }, { nm: "LOCAL", ct: 1 },
];
// DOM 顺序 = 视觉左中右 = 2 / 1 / 3
export const F4_PODIUM: { rank: number; uid: string; gv: string; tip: string; cls: string }[] = [
  { rank: 2, uid: "usr_19C7", gv: "$182k", tip: "本期 GV", cls: "r-2" },
  { rank: 1, uid: "usr_31E8", gv: "$214k", tip: "本期 GV", cls: "r-1" },
  { rank: 3, uid: "usr_55B1", gv: "$156k", tip: "取消资格", cls: "r-3 dq" },
];
// 领导池 V 级票数权重(指数翻倍 V3=1 → V12=512)。镜像 leadership-pool.ts V_VOTES。
export const V_VOTES: { v: string; votes: number }[] = [
  { v: "V3", votes: 1 }, { v: "V4", votes: 2 }, { v: "V5", votes: 4 }, { v: "V6", votes: 8 }, { v: "V7", votes: 16 },
  { v: "V8", votes: 32 }, { v: "V9", votes: 64 }, { v: "V10", votes: 128 }, { v: "V11", votes: 256 }, { v: "V12", votes: 512 },
];

/* ===== F5 佣金事件审计 ===== */
// 6-kind 拆分(commission 支出按类;ALL=$8.42M 为该域 mock,与 LEDGER/REVENUE 不同量纲,无单源冲突)。
export const F5_KINDS: { key: string; code: string; lbl: string; amt: string; ct: string; cls: string; amtColor?: string }[] = [
  { key: "all", code: "ALL", lbl: "全部佣金类型", amt: "$8.42M", ct: "12,847 笔", cls: "k-network" },
  { key: "network", code: "NETWORK", lbl: "L1–L7 网络版税", amt: "$3.21M", ct: "8,124 笔", cls: "k-network", amtColor: "var(--brand)" },
  { key: "binary", code: "BINARY", lbl: "双轨平衡匹配", amt: "$2.18M", ct: "1,842 笔", cls: "k-binary", amtColor: "var(--cyan)" },
  { key: "leadership", code: "LEADERSHIP", lbl: "领导奖池", amt: "$1.46M", ct: "214 笔", cls: "k-leadership", amtColor: "var(--warning)" },
  { key: "cultivation", code: "CULTIVATION", lbl: "培育奖 NEX", amt: "$0.92M", ct: "418 笔", cls: "k-cultivation", amtColor: "#B6A4FF" },
  { key: "genesis", code: "GENESIS", lbl: "创世节点二级版税", amt: "$0.65M", ct: "2,249 笔", cls: "k-genesis", amtColor: "var(--brand-2)" },
];
export const F5_FILTERS: { key: string; lbl: string }[] = [
  { key: "all", lbl: "全部状态" }, { key: "计提", lbl: "计提中" }, { key: "可提", lbl: "已解锁可提" },
  { key: "frozen", lbl: "已冻结" }, { key: "rejected", lbl: "已驳回" }, { key: "异常回退", lbl: "异常回退" },
];
export const COMMISSIONS: {
  id: string; kind: string; user: string; amt: number; cur: "USDT" | "NEX"; coolPct: number; coolLb: string; state: string;
}[] = [
  { id: "CM-7781", kind: "network", user: "usr_19C7", amt: 420, cur: "USDT", coolPct: 60, coolLb: "冷却 18d", state: "计提" },
  { id: "CM-7780", kind: "binary", user: "usr_31E8", amt: 1500, cur: "USDT", coolPct: 100, coolLb: "已解锁", state: "可提" },
  { id: "CM-7779", kind: "cultivation", user: "usr_02A9", amt: 200, cur: "NEX", coolPct: 0, coolLb: "冷却 30d", state: "计提" },
  { id: "CM-7778", kind: "leadership", user: "usr_77D4", amt: 1240, cur: "USDT", coolPct: 100, coolLb: "已解锁", state: "可提" },
  { id: "CM-7777", kind: "leadership", user: "usr_31E8", amt: 880, cur: "USDT", coolPct: 100, coolLb: "已解锁", state: "可提" },
  { id: "CM-7776", kind: "network", user: "usr_84F2", amt: 65, cur: "USDT", coolPct: 42, coolLb: "冷却 17d", state: "计提" },
  { id: "CM-7775", kind: "binary", user: "usr_84F2", amt: 490, cur: "USDT", coolPct: 100, coolLb: "已解锁", state: "可提" },
  { id: "CM-7774", kind: "genesis", user: "usr_19C7", amt: 90, cur: "USDT", coolPct: 100, coolLb: "已解锁", state: "可提" },
  { id: "CM-7773", kind: "cultivation", user: "usr_55B1", amt: 3500, cur: "NEX", coolPct: 25, coolLb: "冷却 22d", state: "计提" },
  { id: "CM-7772", kind: "leadership", user: "usr_19C7", amt: 520, cur: "USDT", coolPct: 0, coolLb: "冻结", state: "frozen" },
  { id: "CM-7771", kind: "network", user: "usr_02A9", amt: 140, cur: "USDT", coolPct: 0, coolLb: "已驳回", state: "rejected" },
  { id: "CM-7770", kind: "network", user: "usr_55B1", amt: 140, cur: "USDT", coolPct: 0, coolLb: "撤销", state: "异常回退" },
];
export const F5_STATUS_DIST: { dot: string; nm: string; ct: string }[] = [
  { dot: "var(--success)", nm: "已解锁可提", ct: "9,684" },
  { dot: "var(--warning)", nm: "冷却计提中", ct: "3,142" },
  { dot: "var(--danger)", nm: "异常回退 · 红冲", ct: "14" },
  { dot: "var(--ink-4)", nm: "已驳回 / 已冻结", ct: "7" },
];
export const F5_FEED: { when: string; html: { t: string; b?: string; color?: string }[] }[] = [
  { when: "2m", html: [{ t: "CM-7770 · 网络版税异常回退 → " }, { t: "已驳回", b: "1", color: "var(--danger)" }, { t: " · 红冲 D4 · risk-ops" }] },
  { when: "14m", html: [{ t: "CM-7762 · 培育奖 NEX → " }, { t: "已冻结", b: "1", color: "var(--warning)" }, { t: " · K2 套利簇 · risk-ops" }] },
  { when: "38m", html: [{ t: "CM-7747 · 领导奖 → " }, { t: "提前解锁", b: "1", color: "var(--success)" }, { t: " ⚡ · 周结算优先 · super-admin" }] },
  { when: "1h", html: [{ t: "批量解锁 ", b: "" }, { t: "89 笔", b: "1" }, { t: " · 双轨佣金冷却到期 · server cron" }] },
  { when: "3h", html: [{ t: "CM-7710 · 培育奖 → 已驳回 · 红冲 · risk-ops" }] },
];
