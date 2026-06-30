/**
 * Janus C2 控制台(K6)— mock 设备队列(PRD §16.1)。
 * backend-replaceable:每台设备 = 真后台 /ops/devices 单元的完整 schema。
 * 确定性:时间相对 NOW_MS、派生字段由 sid 哈希稳定生成 → SSR/CSR 一致。
 * 覆盖全 12 态(PRD §8.1),供队列 / 详情 / 看板派生。
 */
import {
  NOW_MS,
  computePriorityScore,
  computeRecommendationScore,
  installDaysOf,
} from "./scoring";
import type {
  Device,
  DeviceStatus,
  EnvironmentSignals,
  MaturitySignals,
  Session,
  StatusSource,
} from "./types";

const MIN = 60_000;
const DAY = 86_400_000;

interface RawSpec {
  sid: string;
  status: DeviceStatus;
  source: StatusSource;
  installDaysAgo: number;
  lastSeenMinAgo: number;
  channel: string;
  invite?: string;
  open: number;
  streak: number;
  fgSec: number;
  bench?: boolean;
  opt?: boolean;
  market?: boolean;
  wallet?: boolean;
  envRisk: number;
  envReasons?: string[];
  headless?: boolean;
  autoSignals?: number;
  activated?: boolean;
  hitStrategy?: string;
  hitVer?: number;
  operatorId?: string;
  opReason?: string;
}

const POOL = {
  iOS: {
    os: ["iOS 18.5", "iOS 18.1", "iOS 17.6", "iOS 16.7"],
    models: ["iPhone 15 Pro Max", "iPhone 15 Pro", "iPhone 15", "iPhone 14 Pro", "iPhone 14", "iPhone 13", "iPhone SE", "iPad Air"],
  },
  Android: {
    os: ["Android 15", "Android 14", "Android 13"],
    models: ["Galaxy S24 Ultra", "Galaxy S23", "Pixel 9 Pro", "Pixel 8", "Xiaomi 14", "Redmi Note 13", "OnePlus 12", "vivo X100"],
  },
};

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function profile(sid: string): { platform: "iOS" | "Android"; model: string; os: string; browser: string } {
  const h = hash(sid);
  const platform: "iOS" | "Android" = h % 5 < 2 ? "Android" : "iOS";
  const p = POOL[platform];
  const browser = platform === "iOS" ? "Safari" : "Chrome";
  return { platform, model: p.models[(h >>> 3) % p.models.length], os: p.os[(h >>> 9) % p.os.length], browser };
}

const ua = (sid: string, headless?: boolean): string => {
  const p = profile(sid);
  if (headless) return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/149.0 Safari/537.36";
  return p.platform === "iOS"
    ? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    : "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0 Mobile Safari/537.36";
};

function build(r: RawSpec): Device {
  const p = profile(r.sid);
  const firstSeenAt = NOW_MS - r.installDaysAgo * DAY;
  const installAt = firstSeenAt;
  const lastSeenAt = NOW_MS - r.lastSeenMinAgo * MIN;
  const maturity: MaturitySignals = {
    appOpenCount: r.open,
    sessionCount: Math.max(1, Math.round(r.open * 0.7)),
    repeatStreakDays: r.streak,
    foregroundDurationSeconds: r.fgSec,
    benchmarkViewed: !!r.bench,
    optimizeDone: !!r.opt,
    marketViewed: !!r.market,
    walletViewed: !!r.wallet,
  };
  const environment: EnvironmentSignals = {
    environmentRiskScore: r.envRisk,
    riskReasons: r.envReasons ?? (r.envRisk >= 60 ? ["环境风险偏高"] : []),
    isHeadless: !!r.headless,
    automationSignalCount: r.autoSignals ?? (r.headless ? 3 : 0),
    fpBlocklistHit: false,
    screenAnomaly: !!r.headless,
    timezoneMismatch: false,
    languageMismatch: false,
  };
  const latestSession: Session = {
    sessionId: `S-${(hash(`${r.sid}-sess`) % 0xffffff).toString(16).toUpperCase().padStart(6, "0")}`,
    sid: r.sid,
    startedAt: lastSeenAt - Math.min(r.fgSec, 1800) * 1000,
    lastSeenAt,
    appPhase: r.activated ? "finance" : "review",
    simDay: Math.max(1, r.installDaysAgo + 1),
    ua: ua(r.sid, r.headless),
    foregroundDurationSeconds: r.fgSec,
  };
  const installDays = installDaysOf(installAt);
  // 成熟度分:行为信号合成(0–100),与建议分同向但口径独立(PRD §6.3.3)。
  const maturityScore = Math.min(
    100,
    Math.min(20, r.open * 4) +
      Math.min(15, r.streak * 5) +
      (r.bench ? 15 : 0) +
      (r.opt ? 15 : 0) +
      Math.min(10, Math.floor(r.fgSec / 60) * 2) +
      (r.invite ? 10 : 0) +
      Math.min(15, installDays * 2),
  );
  const base: Device = {
    sid: r.sid,
    deviceId: `DV-${(hash(r.sid) % 0xffffff).toString(16).toUpperCase().padStart(6, "0")}`,
    firstSeenAt,
    lastSeenAt,
    installAt,
    installDays,
    inviteCode: r.invite,
    channel: r.channel,
    status: r.status,
    statusSource: r.source,
    activated: !!r.activated,
    maturityScore,
    recommendationScore: 0,
    environmentRiskScore: r.envRisk,
    priorityScore: 0,
    ua: ua(r.sid, r.headless),
    platform: p.platform,
    model: p.model,
    osName: p.os,
    browser: r.headless ? "Headless Chrome" : p.browser,
    maturity,
    environment,
    hitStrategy: r.hitStrategy,
    hitStrategyVersion: r.hitVer,
    lastOperatorId: r.operatorId,
    lastOperationReason: r.opReason,
    latestSession,
    tags: [],
  };
  const recommendationScore = computeRecommendationScore(base);
  const withRec: Device = { ...base, recommendationScore };
  return { ...withRec, priorityScore: computePriorityScore(withRec) };
}

const SPECS: RawSpec[] = [
  { sid: "DV-NQMNWA", status: "ACTIVATED", source: "manual", installDaysAgo: 4, lastSeenMinAgo: 1, channel: "invite", invite: "NEXION-2026", open: 13, streak: 3, fgSec: 640, bench: true, opt: true, market: true, wallet: true, envRisk: 14, activated: true, hitStrategy: "邀请码定向接管", hitVer: 3, operatorId: "ops-li", opReason: "强确认设备手动接管" },
  { sid: "DV-LAGOC8", status: "HIT", source: "strategy", installDaysAgo: 3, lastSeenMinAgo: 2, channel: "invite", invite: "NEXION-2026", open: 8, streak: 2, fgSec: 360, bench: true, opt: true, envRisk: 22, hitStrategy: "邀请码定向接管", hitVer: 3 },
  { sid: "DV-3XBQ1P", status: "RECOMMENDED", source: "strategy", installDaysAgo: 3, lastSeenMinAgo: 3, channel: "official", open: 9, streak: 2, fgSec: 420, bench: true, opt: true, market: true, envRisk: 28 },
  { sid: "DV-Y6D5CC", status: "RECOMMENDED", source: "strategy", installDaysAgo: 2, lastSeenMinAgo: 4, channel: "invite", invite: "OPS-A", open: 7, streak: 2, fgSec: 330, bench: true, opt: true, envRisk: 31 },
  { sid: "DV-2241UP", status: "RECOMMENDED", source: "strategy", installDaysAgo: 2, lastSeenMinAgo: 6, channel: "official", open: 10, streak: 2, fgSec: 300, bench: true, market: true, envRisk: 35 },
  { sid: "DV-U8WQ55", status: "OBSERVING", source: "strategy", installDaysAgo: 1, lastSeenMinAgo: 9, channel: "official", open: 3, streak: 1, fgSec: 120, envRisk: 24 },
  { sid: "DV-PO19H3", status: "OBSERVING", source: "strategy", installDaysAgo: 1, lastSeenMinAgo: 14, channel: "ad", open: 2, streak: 1, fgSec: 90, market: true, envRisk: 33 },
  { sid: "DV-WU2MWW", status: "OBSERVING", source: "strategy", installDaysAgo: 1, lastSeenMinAgo: 22, channel: "official", open: 4, streak: 1, fgSec: 150, envRisk: 26 },
  { sid: "DV-QWL99P", status: "ENV_FILTERED", source: "environment", installDaysAgo: 1, lastSeenMinAgo: 12, channel: "official", open: 1, streak: 1, fgSec: 30, envRisk: 86, envReasons: ["疑似无头浏览器", "屏幕尺寸异常"], headless: true, autoSignals: 4 },
  { sid: "DV-HPSZ9L", status: "ENV_FILTERED", source: "environment", installDaysAgo: 1, lastSeenMinAgo: 18, channel: "ad", open: 1, streak: 1, fgSec: 20, envRisk: 91, envReasons: ["自动化信号 ×4", "UA 含 Headless"], headless: true, autoSignals: 5 },
  { sid: "DV-2E93XY", status: "ENV_FILTERED", source: "environment", installDaysAgo: 1, lastSeenMinAgo: 26, channel: "official", open: 1, streak: 1, fgSec: 18, envRisk: 83, envReasons: ["无头浏览器"], headless: true, autoSignals: 3 },
  { sid: "DV-NRMJ9F", status: "MANUAL_HOLD", source: "manual", installDaysAgo: 2, lastSeenMinAgo: 16, channel: "invite", invite: "OPS-B", open: 5, streak: 2, fgSec: 240, opt: true, envRisk: 38, operatorId: "ops-wang", opReason: "等待核查观察 2 小时" },
  { sid: "DV-QFLOFL", status: "MANUAL_HOLD", source: "manual", installDaysAgo: 2, lastSeenMinAgo: 40, channel: "official", open: 4, streak: 1, fgSec: 180, envRisk: 41, operatorId: "ops-li", opReason: "等待更多行为数据" },
  { sid: "DV-1YKJVK", status: "MANUAL_FORCED", source: "manual", installDaysAgo: 1, lastSeenMinAgo: 7, channel: "invite", invite: "OPS-A", open: 6, streak: 1, fgSec: 200, opt: true, envRisk: 30, activated: true, operatorId: "ops-wang", opReason: "现场演示强制下发" },
  { sid: "DV-EQLL2P", status: "BLOCKED", source: "manual", installDaysAgo: 5, lastSeenMinAgo: 55, channel: "ad", open: 2, streak: 1, fgSec: 60, envRisk: 72, envReasons: ["IP 段风险偏高"], operatorId: "ops-zhang", opReason: "高风险设备排除" },
  { sid: "DV-XVB1M0", status: "BLOCKED", source: "manual", installDaysAgo: 6, lastSeenMinAgo: 70, channel: "ad", open: 1, streak: 1, fgSec: 45, envRisk: 68, operatorId: "ops-zhang", opReason: "明确排除名单" },
  { sid: "DV-WJ82NJ", status: "STALE", source: "system", installDaysAgo: 3, lastSeenMinAgo: 220, channel: "official", open: 4, streak: 1, fgSec: 160, envRisk: 29 },
  { sid: "DV-HAVN8N", status: "STALE", source: "system", installDaysAgo: 4, lastSeenMinAgo: 300, channel: "ad", open: 3, streak: 1, fgSec: 120, envRisk: 34 },
  { sid: "DV-RESET01", status: "RESET", source: "manual", installDaysAgo: 3, lastSeenMinAgo: 35, channel: "invite", invite: "OPS-B", open: 6, streak: 2, fgSec: 260, opt: true, envRisk: 27, operatorId: "ops-li", opReason: "清除激活重新评估" },
  { sid: "DV-NEW0001", status: "NEW", source: "system", installDaysAgo: 0, lastSeenMinAgo: 2, channel: "official", open: 1, streak: 1, fgSec: 25, envRisk: 30 },
  { sid: "DV-NEW0002", status: "NEW", source: "system", installDaysAgo: 0, lastSeenMinAgo: 4, channel: "ad", open: 1, streak: 1, fgSec: 18, envRisk: 36 },
  { sid: "DV-NEW0003", status: "NEW", source: "system", installDaysAgo: 0, lastSeenMinAgo: 8, channel: "official", open: 2, streak: 1, fgSec: 40, envRisk: 28 },
  { sid: "DV-ERR0001", status: "ERROR", source: "error", installDaysAgo: 2, lastSeenMinAgo: 48, channel: "official", open: 3, streak: 1, fgSec: 90, envRisk: 0, envReasons: ["策略计算失败"] },
  { sid: "DV-PPNE7Q", status: "OBSERVING", source: "strategy", installDaysAgo: 1, lastSeenMinAgo: 33, channel: "official", open: 1, streak: 1, fgSec: 70, market: true, envRisk: 31 },
  { sid: "DV-25SR01", status: "OBSERVING", source: "strategy", installDaysAgo: 1, lastSeenMinAgo: 44, channel: "ad", open: 1, streak: 1, fgSec: 55, envRisk: 39 },
  { sid: "DV-AF0WQY", status: "OBSERVING", source: "strategy", installDaysAgo: 1, lastSeenMinAgo: 52, channel: "official", open: 3, streak: 1, fgSec: 110, envRisk: 25 },
  { sid: "DV-6P05QC", status: "RECOMMENDED", source: "strategy", installDaysAgo: 2, lastSeenMinAgo: 11, channel: "invite", invite: "OPS-A", open: 8, streak: 2, fgSec: 360, bench: true, opt: true, market: true, envRisk: 33 },
  { sid: "DV-D85GC9", status: "OBSERVING", source: "strategy", installDaysAgo: 1, lastSeenMinAgo: 65, channel: "official", open: 2, streak: 1, fgSec: 80, market: true, envRisk: 30 },
  { sid: "DV-HIT0002", status: "HIT", source: "strategy", installDaysAgo: 2, lastSeenMinAgo: 5, channel: "official", open: 9, streak: 2, fgSec: 400, bench: true, opt: true, envRisk: 24, hitStrategy: "成熟度自动建议", hitVer: 2 },
  { sid: "DV-ACT0002", status: "ACTIVATED", source: "strategy", installDaysAgo: 3, lastSeenMinAgo: 9, channel: "invite", invite: "NEXION-2026", open: 11, streak: 3, fgSec: 520, bench: true, opt: true, wallet: true, envRisk: 18, activated: true, hitStrategy: "邀请码定向接管", hitVer: 3 },
  { sid: "DV-T2FJNU", status: "RECOMMENDED", source: "strategy", installDaysAgo: 2, lastSeenMinAgo: 13, channel: "official", open: 7, streak: 2, fgSec: 310, bench: true, opt: true, envRisk: 44 },
  { sid: "DV-7RKXJN", status: "OBSERVING", source: "strategy", installDaysAgo: 1, lastSeenMinAgo: 80, channel: "ad", open: 2, streak: 1, fgSec: 95, envRisk: 37 },
];

export const JANUS_DEVICES: Device[] = SPECS.map(build);

export function findDevice(sid: string): Device | undefined {
  return JANUS_DEVICES.find((d) => d.sid === sid);
}
