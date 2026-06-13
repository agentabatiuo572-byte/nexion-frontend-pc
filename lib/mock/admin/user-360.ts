/**
 * 360 HUB · per-user 多实体明细 mock(确定性,SSR/CSR 一致:纯由 userId 派生,无 Date.now/Math.random)。
 * backend-replaceable — 每生成器对应一个真后端读端点(见各注),admin 单用户聚合 GET /api/admin/users/:userId/*。
 * 写动作(设备 CRUD / 收益台账调整)= server-canonical action 端点 + 操作确认 + append-only;前端只乐观 UI。
 */

// FNV-1a seeded PRNG
function seeded(s: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => { h += 0x6d2b79f5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pad2 = (n: number) => String(n).padStart(2, "0");
const dateLabel = (rnd: () => number) => "2026-" + pad2(1 + Math.floor(rnd() * 5)) + "-" + pad2(1 + Math.floor(rnd() * 27));
const tsLabel = (rnd: () => number) => dateLabel(rnd) + " " + pad2(Math.floor(rnd() * 24)) + ":" + pad2(Math.floor(rnd() * 60));

// ───── 提现(读 GET /api/admin/withdrawals?userId · 处置在 D2)─────
export type WithdrawStatus = "submitted" | "review" | "processing" | "sent" | "confirmed" | "rejected";
export interface WithdrawRow { id: string; tsLabel: string; amountUsd: number; network: string; addrMasked: string; status: WithdrawStatus; feeUsd: number; }
export interface UserWithdrawals { items: WithdrawRow[]; freq24h: number; inFlight: number; }
const NETS = ["USDT-TRC20", "USDT-ERC20", "BTC", "ETH"];
export function getUserWithdrawals(userId: string, withdrawnUsd: number): UserWithdrawals {
  const rnd = seeded(userId + ":wd");
  if (withdrawnUsd <= 0) return { items: [], freq24h: 0, inFlight: 0 };
  const n = 2 + Math.floor(rnd() * 6);
  const items: WithdrawRow[] = [];
  let remain = withdrawnUsd;
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    const amt = last ? Math.max(0, Math.round(remain)) : Math.round((remain / (n - i)) * (0.6 + rnd() * 0.8));
    remain -= amt;
    const r = rnd();
    const status: WithdrawStatus = r < 0.6 ? "confirmed" : r < 0.72 ? "sent" : r < 0.84 ? "processing" : r < 0.92 ? "review" : r < 0.97 ? "submitted" : "rejected";
    items.push({ id: "WD-" + userId.slice(2) + "-" + pad2(i + 1), tsLabel: tsLabel(rnd), amountUsd: amt, network: NETS[Math.floor(rnd() * NETS.length)], addrMasked: "T" + Math.floor(rnd() * 0xffffff).toString(16) + "…" + Math.floor(rnd() * 0xffff).toString(16), status, feeUsd: Math.max(1, Math.min(20, Math.round(amt * 0.02))) });
  }
  items.sort((a, b) => (a.tsLabel < b.tsLabel ? 1 : -1));
  const inFlight = items.filter((w) => ["submitted", "review", "processing", "sent"].includes(w.status)).length;
  return { items, freq24h: Math.floor(rnd() * 4), inFlight };
}

// ───── 邀请/分销(读 GET /api/admin/users/:userId/network · 处置在 F)─────
export interface DownlineRow { id: string; name: string; vRank: string; layer: number; joinedAt: string; monthVolUsd: number; spillover: boolean; }
export interface UserReferral { directRefs: number; teamSize: number; sponsor: { id: string; name: string } | null; vDist: Record<string, number>; spilloverCount: number; directList: DownlineRow[]; }
const NAMES = ["Leo", "Mia", "Kai", "Zoe", "Ravi", "Ana", "Sky", "Jin", "Noa", "Ivy", "Tom", "Lux"];
export function getUserReferral(userId: string, teamSize: number): UserReferral {
  const rnd = seeded(userId + ":ref");
  const directRefs = Math.min(teamSize, 1 + Math.floor(rnd() * Math.min(8, teamSize + 1)));
  const directList: DownlineRow[] = [];
  for (let i = 0; i < directRefs; i++) {
    directList.push({ id: "U-" + Math.floor(10000 + rnd() * 89999), name: NAMES[Math.floor(rnd() * NAMES.length)] + "_" + Math.floor(rnd() * 99), vRank: "V" + Math.floor(rnd() * 5), layer: 1, joinedAt: dateLabel(rnd), monthVolUsd: Math.round(rnd() * 3000), spillover: rnd() < 0.25 });
  }
  const vDist: Record<string, number> = {};
  for (let v = 0; v <= 6; v++) vDist["V" + v] = v === 0 ? Math.floor(teamSize * 0.5) : Math.floor(rnd() * Math.max(1, teamSize / (v + 2)));
  return { directRefs, teamSize, sponsor: rnd() < 0.85 ? { id: "U-" + Math.floor(10000 + rnd() * 89999), name: NAMES[Math.floor(rnd() * NAMES.length)] } : null, vDist, spilloverCount: Math.floor(rnd() * Math.max(1, teamSize / 3)), directList };
}

// ───── 设备(读 GET /api/admin/users/:userId/devices · 写=设备 action 端点 操作确认)─────
export type DeviceKind = "phone" | "stellarbox-s1" | "stellarbox-pro" | "stellarrack-p1" | "cloud-share";
export interface UserDeviceRow { id: string; kind: DeviceKind; name: string; online: boolean; activatedAt: string; todayEarningsUsd: number; generation: number; gpuUsage: number; ageMonths: number; }
const DEVS: { kind: DeviceKind; name: string; rate: number }[] = [
  { kind: "phone", name: "手机 NPU", rate: 0.06 },
  { kind: "stellarbox-s1", name: "NexionBox S1", rate: 38.5 },
  { kind: "stellarbox-pro", name: "NexionBox Pro", rate: 76 },
  { kind: "stellarrack-p1", name: "NexionRack P1", rate: 142.6 },
  { kind: "cloud-share", name: "Cloud Share", rate: 0.073 },
];
export function getUserDevices(userId: string, deviceCount: number): UserDeviceRow[] {
  const rnd = seeded(userId + ":dev");
  const rows: UserDeviceRow[] = [];
  // 手机恒在(onboarding 设备),其余按 deviceCount
  rows.push({ id: "DV-" + userId.slice(2) + "-ph", kind: "phone", name: "手机 NPU", online: rnd() < 0.7, activatedAt: dateLabel(rnd), todayEarningsUsd: +(0.04 + rnd() * 0.04).toFixed(2), generation: 1, gpuUsage: Math.floor(60 + rnd() * 35), ageMonths: 1 + Math.floor(rnd() * 5) });
  for (let i = 1; i < Math.max(1, deviceCount); i++) {
    const d = DEVS[1 + Math.floor(rnd() * 3)];
    rows.push({ id: "DV-" + userId.slice(2) + "-" + pad2(i), kind: d.kind, name: d.name, online: rnd() < 0.78, activatedAt: dateLabel(rnd), todayEarningsUsd: +(d.rate * (0.85 + rnd() * 0.3)).toFixed(2), generation: 1 + Math.floor(rnd() * 2), gpuUsage: Math.floor(70 + rnd() * 28), ageMonths: 1 + Math.floor(rnd() * 8) });
  }
  return rows;
}

// ───── 收益(读 SSE /api/me/earnings + GET /api/admin/users/:userId/commission · 写=台账 action 操作确认 append-only)─────
export type CommissionKind = "unilevel" | "binary" | "peer" | "cultivation" | "leadership" | "genesis";
export type CommissionStatus = "cooling" | "unlocked" | "withdrawn";
export interface CommissionRow { id: string; kind: CommissionKind; amountUsd: number; amountNex: number; status: CommissionStatus; tsLabel: string; layer?: number; }
export interface LedgerRow { id: string; tsLabel: string; kind: string; deltaUsd: number; status: string; ref: string; }
export interface UserEarnings {
  todayUsd: number; weekUsd: number; monthUsd: number; totalUsd: number; todayNex: number;
  bySource: { device: number; commission: number; staking: number; genesis: number };
  commission: CommissionRow[];
  ledger: LedgerRow[];
}
const CKINDS: CommissionKind[] = ["unilevel", "binary", "peer", "cultivation", "leadership", "genesis"];
const LKINDS = ["earn", "refer", "bonus", "stake", "achievement", "adjustment"];
export function getUserEarnings(userId: string, totalHint: number): UserEarnings {
  const rnd = seeded(userId + ":earn");
  const total = Math.max(0, totalHint);
  const today = +(total * (0.002 + rnd() * 0.006)).toFixed(2);
  const week = +(today * (5 + rnd() * 2)).toFixed(2);
  const month = +(week * (3.5 + rnd())).toFixed(2);
  const device = +(total * (0.4 + rnd() * 0.2)).toFixed(2);
  const commissionUsd = +(total * (0.2 + rnd() * 0.2)).toFixed(2);
  const staking = +(total * rnd() * 0.15).toFixed(2);
  const genesis = +(total - device - commissionUsd - staking).toFixed(2);
  const cN = total > 0 ? 3 + Math.floor(rnd() * 6) : 0;
  const commission: CommissionRow[] = [];
  for (let i = 0; i < cN; i++) {
    const kind = CKINDS[Math.floor(rnd() * CKINDS.length)];
    const r = rnd();
    commission.push({ id: "CM-" + userId.slice(2) + "-" + pad2(i + 1), kind, amountUsd: +(rnd() * 200).toFixed(2), amountNex: Math.round(rnd() * 400), status: r < 0.45 ? "unlocked" : r < 0.8 ? "cooling" : "withdrawn", tsLabel: tsLabel(rnd), layer: kind === "unilevel" ? 1 + Math.floor(rnd() * 7) : undefined });
  }
  const lN = total > 0 ? 4 + Math.floor(rnd() * 6) : 0;
  const ledger: LedgerRow[] = [];
  for (let i = 0; i < lN; i++) {
    const kind = LKINDS[Math.floor(rnd() * LKINDS.length)];
    const sign = kind === "adjustment" && rnd() < 0.4 ? -1 : 1;
    ledger.push({ id: "BL-" + userId.slice(2) + "-" + pad2(i + 1), tsLabel: tsLabel(rnd), kind, deltaUsd: +(sign * rnd() * 150).toFixed(2), status: rnd() < 0.85 ? "posted" : "pending", ref: "TX-" + Math.floor(rnd() * 0xffffff).toString(16).toUpperCase() });
  }
  ledger.sort((a, b) => (a.tsLabel < b.tsLabel ? 1 : -1));
  return { todayUsd: today, weekUsd: week, monthUsd: month, totalUsd: total, todayNex: Math.round(today * 12), bySource: { device, commission: commissionUsd, staking, genesis: Math.max(0, genesis) }, commission, ledger };
}

// ───── 用户 + V 级(读 GET /api/admin/users/:userId/profile · 升级 server 权威)─────
// ───── 财务持仓(读 GET /api/admin/users/:userId/{staking,genesis,exchange} · 处置在 G)─────
export type StakeStatus = "locked" | "matured" | "early-exit";
export interface StakeRow { id: string; pool: string; principalNex: number; apy: number; lockDays: number; unlockAt: string; status: StakeStatus; }
export interface GenesisRow { id: string; nodeNo: string; boughtAt: string; dailyDivUsd: number; status: "active" | "listed" | "sold"; }
export interface ExchangeRow { id: string; tsLabel: string; pair: string; amountNex: number; rate: number; }
export interface UserFinancial { staking: StakeRow[]; genesis: GenesisRow[]; exchange: ExchangeRow[]; stakedNexTotal: number; genesisDailyTotal: number; }
const POOLS = ["NEX-30d", "NEX-90d", "NEX-180d", "NEX-365d"];
const LOCKS: Record<string, number> = { "NEX-30d": 30, "NEX-90d": 90, "NEX-180d": 180, "NEX-365d": 365 };
const APYS: Record<string, number> = { "NEX-30d": 8, "NEX-90d": 14, "NEX-180d": 22, "NEX-365d": 36 };
export function getUserFinancial(userId: string, vRankNum: number, balanceUsd: number): UserFinancial {
  const rnd = seeded(userId + ":fin");
  const sN = balanceUsd > 2000 ? Math.floor(rnd() * 4) : balanceUsd > 0 ? Math.floor(rnd() * 2) : 0;
  const staking: StakeRow[] = [];
  for (let i = 0; i < sN; i++) {
    const pool = POOLS[Math.floor(rnd() * POOLS.length)];
    const r = rnd();
    staking.push({ id: "STK-" + userId.slice(2) + "-" + pad2(i + 1), pool, principalNex: Math.round(500 + rnd() * 9500), apy: APYS[pool], lockDays: LOCKS[pool], unlockAt: dateLabel(rnd), status: r < 0.7 ? "locked" : r < 0.92 ? "matured" : "early-exit" });
  }
  const gN = vRankNum >= 3 ? Math.floor(rnd() * 3) : 0;
  const genesis: GenesisRow[] = [];
  for (let i = 0; i < gN; i++) genesis.push({ id: "GEN-" + userId.slice(2) + "-" + pad2(i + 1), nodeNo: "#" + Math.floor(100 + rnd() * 900), boughtAt: dateLabel(rnd), dailyDivUsd: +(20 + rnd() * 8).toFixed(2), status: rnd() < 0.8 ? "active" : rnd() < 0.95 ? "listed" : "sold" });
  const eN = balanceUsd > 0 ? Math.floor(rnd() * 4) : 0;
  const exchange: ExchangeRow[] = [];
  for (let i = 0; i < eN; i++) exchange.push({ id: "EX-" + userId.slice(2) + "-" + pad2(i + 1), tsLabel: tsLabel(rnd), pair: rnd() < 0.5 ? "NEX→USDT" : "USDT→NEX", amountNex: Math.round(rnd() * 2000), rate: +(0.4 + rnd() * 0.3).toFixed(3) });
  return { staking, genesis, exchange, stakedNexTotal: staking.reduce((s, x) => s + x.principalNex, 0), genesisDailyTotal: +genesis.filter((g) => g.status === "active").reduce((s, x) => s + x.dailyDivUsd, 0).toFixed(2) };
}

// ───── 互动/激励(读 GET /api/admin/users/:userId/engagement · 处置在 H)─────
export interface QuestRow { id: string; name: string; progressPct: number; rewardNex: number; done: boolean; }
export interface MilestoneRow { label: string; hit: boolean; }
export interface UserEngagement { checkinStreak: number; luckySpinsLeft: number; quests: QuestRow[]; milestones: MilestoneRow[]; }
const QUESTS = ["首充任务", "邀请 3 人", "连签 7 天", "复投一次", "升级设备"];
const MILES = ["首笔 $100", "累计 $1K", "累计 $10K", "团队 10 人", "V3 达成"];
export function getUserEngagement(userId: string, teamSize: number, depositedUsd: number): UserEngagement {
  const rnd = seeded(userId + ":eng");
  const quests: QuestRow[] = QUESTS.slice(0, 2 + Math.floor(rnd() * 4)).map((name, i) => {
    const pct = Math.floor(rnd() * 101);
    return { id: "Q-" + userId.slice(2) + "-" + pad2(i + 1), name, progressPct: pct, rewardNex: Math.round(5 + rnd() * 45), done: pct >= 100 };
  });
  const milestones: MilestoneRow[] = MILES.map((label, i) => ({ label, hit: i === 0 ? depositedUsd >= 100 : i === 1 ? depositedUsd >= 1000 : i === 2 ? depositedUsd >= 10000 : i === 3 ? teamSize >= 10 : rnd() < 0.4 }));
  return { checkinStreak: Math.floor(rnd() * 31), luckySpinsLeft: Math.floor(rnd() * 3), quests, milestones };
}

export interface UserVRank { vRank: string; selfBuyUsd: number; directRefs: number; teamVolumeUsd: number; nextRank: string; progressPct: number; missing: string[]; }
export function getUserVRank(userId: string, vRankStr: string, depositedUsd: number, teamSize: number): UserVRank {
  const rnd = seeded(userId + ":vr");
  const cur = parseInt(vRankStr.replace(/\D/g, ""), 10) || 0;
  const next = "V" + (cur + 1);
  const selfBuy = Math.round(depositedUsd * (0.5 + rnd() * 0.4));
  const teamVol = Math.round(teamSize * (800 + rnd() * 1500));
  const progressPct = Math.min(96, 20 + Math.floor(rnd() * 70));
  const missing: string[] = [];
  if (rnd() < 0.6) missing.push("直推差 " + (1 + Math.floor(rnd() * 3)) + " 人");
  if (rnd() < 0.5) missing.push("团队业绩差 $" + Math.round(rnd() * 9000));
  return { vRank: vRankStr, selfBuyUsd: selfBuy, directRefs: Math.min(teamSize, 1 + Math.floor(rnd() * 6)), teamVolumeUsd: teamVol, nextRank: next, progressPct, missing: missing.length ? missing : ["已满足,待 server 确认"] };
}

// ───────────────────────── 账户·安全·合规·档案(A-002/K-001..005/I-001..002/C-009) ─────────────────────────
export interface AccountSessionRow { id: string; device: string; ip: string; loc: string; lastActive: string; current: boolean; }
export interface LeadershipPayoutRow { weekId: string; poolUsd: number; myVotes: number; sharePct: number; payoutUsd: number; }
export interface UserAccount {
  onboardingDone: boolean; signupAt: string; lastSignIn: string;
  twoFactor: boolean; passwordChangedAt: string; kycStatus: string; riskDisclosureAccepted: boolean;
  displayName: string; bio: string; region: string; timezone: string; locale: string; localeUserSet: boolean;
  sessions: AccountSessionRow[]; leadershipPayouts: LeadershipPayoutRow[];
}
export function getUserAccount(userId: string, kyc: string, nickname: string): UserAccount {
  const rnd = seeded(userId + ":acct");
  const regions = ["新加坡", "迪拜", "香港", "伦敦", "多伦多"];
  const tzs = ["UTC+8", "UTC+4", "UTC+0", "UTC-5"];
  const devices = ["iPhone 15 Pro", "Pixel 8", "iPad Air", "Chrome / Windows"];
  const locs = ["Singapore SG", "Dubai AE", "London UK", "Toronto CA"];
  const sessions: AccountSessionRow[] = Array.from({ length: 1 + Math.floor(rnd() * 3) }).map((_, i) => ({
    id: "S-" + userId.slice(2) + "-" + pad2(i + 1), device: devices[Math.floor(rnd() * devices.length)],
    ip: `${10 + Math.floor(rnd() * 240)}.${Math.floor(rnd() * 256)}.x.x`, loc: locs[Math.floor(rnd() * locs.length)],
    lastActive: i === 0 ? "刚刚" : `${Math.floor(rnd() * 72)}h 前`, current: i === 0,
  }));
  const payouts: LeadershipPayoutRow[] = Array.from({ length: Math.floor(rnd() * 4) }).map((_, i) => {
    const pool = Math.round(380000 + rnd() * 120000);
    const votes = Math.floor(rnd() * 8);
    const share = votes > 0 ? +((votes / (2000 + rnd() * 500)) * 100).toFixed(3) : 0;
    return { weekId: `W-26${pad2(20 - i)}`, poolUsd: pool, myVotes: votes, sharePct: share, payoutUsd: Math.round((pool * share) / 100) };
  });
  return {
    onboardingDone: rnd() > 0.1, signupAt: `2026-0${1 + Math.floor(rnd() * 5)}-${pad2(1 + Math.floor(rnd() * 27))}`,
    lastSignIn: `${Math.floor(rnd() * 48)}h 前`, twoFactor: rnd() > 0.45, passwordChangedAt: `${Math.floor(rnd() * 180)}d 前`,
    kycStatus: kyc, riskDisclosureAccepted: rnd() > 0.2,
    displayName: nickname, bio: rnd() > 0.6 ? "算力投资 · 长期主义" : "—",
    region: regions[Math.floor(rnd() * regions.length)], timezone: tzs[Math.floor(rnd() * tzs.length)],
    locale: rnd() > 0.5 ? "zh-CN" : "en-US", localeUserSet: rnd() > 0.4, sessions, leadershipPayouts: payouts,
  };
}

// ───────────────────────── 订单·商城·收据·试用·购物车(E-005..011) ─────────────────────────
export type OrderStatus = "pending" | "paid" | "shipped" | "activated" | "cancelled";
export interface OrderRow { id: string; product: string; qty: number; totalUsd: number; method: string; status: OrderStatus; tsLabel: string; }
export interface ReceiptRow { id: string; category: string; title: string; feeUsd: number; tsLabel: string; }
export type TrialState = "none" | "active" | "grace" | "converted" | "expired";
export interface UserCommerce {
  orders: OrderRow[]; receipts: ReceiptRow[]; cartItems: number; cartValueUsd: number;
  trialState: TrialState; trialOffsetUsd: number; cumulativeDepositUsd: number;
}
export function getUserCommerce(userId: string, deviceCount: number, depositedUsd: number): UserCommerce {
  const rnd = seeded(userId + ":comm");
  const prods = ["NexionBox S1", "NexionBox Pro", "NexionRack P1", "Cloud Share", "Phone Node"];
  const prices = [1299, 2399, 8999, 199, 0];
  const methods = ["USDT", "余额", "信用卡"];
  const sts: OrderStatus[] = ["activated", "paid", "shipped", "cancelled", "pending"];
  const orders: OrderRow[] = Array.from({ length: Math.max(1, deviceCount) }).map((_, i) => {
    const pi = Math.floor(rnd() * prods.length);
    return { id: "ORD-2606" + pad2(28 - i) + "-" + (1000 + Math.floor(rnd() * 8999)), product: prods[pi], qty: 1 + Math.floor(rnd() * 2), totalUsd: prices[pi], method: methods[Math.floor(rnd() * methods.length)], status: i === 0 ? "activated" : sts[Math.floor(rnd() * sts.length)], tsLabel: `06-${pad2(1 + Math.floor(rnd() * 28))} 2026` };
  });
  const cats = ["AI 推理任务", "KYC 认证", "Staking 申购", "兑换"];
  const receipts: ReceiptRow[] = Array.from({ length: 2 + Math.floor(rnd() * 4) }).map((_, i) => ({
    id: "RC-" + userId.slice(2) + "-" + pad2(i + 1), category: cats[Math.floor(rnd() * cats.length)], title: "Proof-of-Compute #" + (100 + Math.floor(rnd() * 900)), feeUsd: +(rnd() * 3.3).toFixed(2), tsLabel: `06-${pad2(1 + Math.floor(rnd() * 28))}`,
  }));
  const tstates: TrialState[] = ["none", "active", "grace", "converted", "expired"];
  return {
    orders, receipts, cartItems: Math.floor(rnd() * 3), cartValueUsd: Math.round(rnd() * 4000),
    trialState: tstates[Math.floor(rnd() * tstates.length)], trialOffsetUsd: +(rnd() * 50).toFixed(2), cumulativeDepositUsd: depositedUsd,
  };
}

// ───────────────────────── 通知·推送偏好(A-001/003/004/005) ─────────────────────────
export type NotifKind = "earn" | "system" | "promo" | "risk" | "social";
export interface NotifRow { id: string; kind: NotifKind; title: string; body: string; tsLabel: string; read: boolean; }
export interface UserNotifications { items: NotifRow[]; unread: number; prefs: Record<NotifKind, boolean>; soundEnabled: boolean; hapticsEnabled: boolean; }
export function getUserNotifications(userId: string): UserNotifications {
  const rnd = seeded(userId + ":notif");
  const pool: [NotifKind, string, string][] = [
    ["earn", "今日收益已入账", "AI 算力收益 $12.40 已结算"],
    ["system", "设备重连成功", "NexionBox S1 已恢复在线"],
    ["promo", "限时早购优惠", "提前购买 Pro 立省 $360"],
    ["risk", "异地登录提醒", "检测到新设备登录,请确认"],
    ["social", "新成员加入团队", "你的邀请新增 1 名直推"],
  ];
  const items: NotifRow[] = Array.from({ length: 3 + Math.floor(rnd() * 5) }).map((_, i) => {
    const p = pool[Math.floor(rnd() * pool.length)];
    return { id: "N-" + userId.slice(2) + "-" + pad2(i + 1), kind: p[0], title: p[1], body: p[2], tsLabel: `${Math.floor(rnd() * 72)}h 前`, read: rnd() > 0.4 };
  });
  return {
    items, unread: items.filter((n) => !n.read).length,
    prefs: { earn: true, system: true, promo: rnd() > 0.3, risk: true, social: rnd() > 0.4 },
    soundEnabled: rnd() > 0.4, hapticsEnabled: rnd() > 0.3,
  };
}
