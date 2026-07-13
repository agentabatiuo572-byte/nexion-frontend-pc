/**
 * Janus C2 控制台(K6)— 评分与汇总(PRD §10 建议分 / §11 优先级 / §5.2 看板)。
 * 纯函数,backend-replaceable(真后台可把同一公式搬到服务端)。
 * 时间基准来自当前会话启动时间;所有设备数据来自后端业务表。
 */
import type { C2Summary, Device, RecommendationLevel } from "./types";

const FRESH_WINDOW_MS = 5 * 60 * 1000;

export function isFresh(lastSeenAt: number): boolean {
  return Date.now() - lastSeenAt <= FRESH_WINDOW_MS;
}

const clamp = (n: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, n));

/** 安装天数:固定快照时钟与安装时间之差(PRD §4 安装天数)。 */
export function installDaysOf(installAt: number): number {
  return Math.max(0, Math.floor((Date.now() - installAt) / 86_400_000));
}

/**
 * 建议分(PRD §10.2)。8 维累加后 clamp 至 0–100(单设备理论上限约 95,满额需邀请码 + 最近活跃 + 多关键页)。
 * 环境风险先作门槛,不直接加分(见 recommendationLevel)。
 */
export function computeRecommendationScore(d: Device): number {
  const m = d.maturity;
  let s = 0;
  s += clamp(m.appOpenCount * 4, 0, 20); // 打开次数:1 次 4 分,封顶 20
  s += clamp(d.installDays * 3, 0, 10); // 安装天数:每天 3 分,封顶 10
  s += clamp(m.repeatStreakDays * 5, 0, 15); // 连续活跃:每天 5 分,封顶 15
  // 关键页面访问:benchmark / market / wallet 各 5
  s += (m.benchmarkViewed ? 5 : 0) + (m.marketViewed ? 5 : 0) + (m.walletViewed ? 5 : 0);
  // 关键动作:optimize 5(PRD §10.2 optimize/claim/detail 各 5；当前契约建模 optimize)
  s += m.optimizeDone ? 5 : 0;
  s += clamp(Math.floor(m.foregroundDurationSeconds / 60) * 2, 0, 10); // 前台停留:每 60 秒 2 分,封顶 10
  s += d.inviteCode || d.channel === "invite" || d.channel === "official" ? 10 : 0; // 邀请码/渠道匹配
  s += isFresh(d.lastSeenAt) ? 5 : 0; // 最近 5 分钟活跃
  return clamp(Math.round(s), 0, 100);
}

/**
 * 优先级分(PRD §11.1 / §11.2)。用于队列排序,不直接触发下发。
 */
export function computePriorityScore(d: Device): number {
  let s = 0;
  if (d.status === "RECOMMENDED") s += 80;
  else if (d.status === "HIT" && !d.activated) s += 70;
  else if (d.status === "ENV_FILTERED") s += 45;
  else if (d.status === "MANUAL_HOLD") s += 35;
  if (d.status === "STALE") s -= 30;
  if (d.status === "BLOCKED") s -= 80;
  s += d.recommendationScore; // 0–100
  if (isFresh(d.lastSeenAt)) s += 20;
  if (d.channel === "invite" || d.channel === "official" || d.inviteCode) s += 20;
  if (d.lastOperationReason) s += 15; // 人工备注待处理
  s -= clamp(Math.round(d.environmentRiskScore * 0.8), 0, 80); // 环境风险惩罚 0..-80
  return Math.round(s);
}

/**
 * 建议等级(PRD §10.3)。环境风险作门槛优先判定。
 */
export function recommendationLevel(d: Device): RecommendationLevel {
  const risk = d.environmentRiskScore;
  if (risk >= 80) return "FILTER";
  if (risk >= 60) return "REVIEW";
  const score = d.recommendationScore;
  if (score >= 80 && risk < 40) return "STRONG";
  if (score >= 60 && risk < 50) return "NORMAL";
  if (score >= 30) return "OBSERVE";
  return "REJECT";
}

/** 首页看板汇总(PRD §5.2 / §20.1)。 */
export function summarize(devices: Device[]): C2Summary {
  const count = (pred: (d: Device) => boolean): number => devices.filter(pred).length;
  const total = devices.length;
  const hit = count((d) => d.status === "HIT");
  const activated = count((d) => d.status === "ACTIVATED" || d.activated);
  return {
    totalDevices: total,
    activeDevices: count((d) => isFresh(d.lastSeenAt)),
    newDevices: count((d) => d.status === "NEW"),
    recommended: count((d) => d.status === "RECOMMENDED"),
    hit,
    activated,
    envFiltered: count((d) => d.status === "ENV_FILTERED"),
    manualHold: count((d) => d.status === "MANUAL_HOLD"),
    manualOverrides: count((d) => d.statusSource === "manual"),
    hitRate: total ? Math.round(((hit + activated) / total) * 100) : 0,
  };
}

/** 相对快照时钟的人类可读时间(PRD 队列「最近上报」列)。 */
export function timeAgo(ts: number): string {
  const n = Date.now() - ts;
  if (n < 0) return "刚刚";
  if (n < 60_000) return `${Math.max(1, Math.round(n / 1000))} 秒前`;
  if (n < 3_600_000) return `${Math.round(n / 60_000)} 分钟前`;
  if (n < 86_400_000) return `${Math.round(n / 3_600_000)} 小时前`;
  return `${Math.round(n / 86_400_000)} 天前`;
}
