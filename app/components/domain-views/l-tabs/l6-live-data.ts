type UnknownRecord = Record<string, unknown>;

function rec(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}

function num(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return ["true", "1", "yes"].includes(value.toLowerCase());
  return fallback;
}

function strings(value: unknown): string[] {
  return rows<unknown>(value).map((item) => str(item)).filter(Boolean);
}

export type PageLevel = 1 | 2 | 3;
export type DepthFilter = "all" | "L1" | "L2" | "L3";
export type TimeWindow = "24h" | "7d" | "30d";

export type UxPageNode = {
  route: string;
  titleZh: string;
  level: PageLevel;
  parentL1: string;
  parentL2: string;
  tracked: boolean;
};

export type PageActivityStat = {
  route: string;
  pv: number;
  uv: number;
  clicks: number;
  dwellMs: number;
  bounceRate: number;
  pageCount: number;
};

export type HeatRow = {
  key: string;
  titleZh: string;
  level: PageLevel;
  pv: number;
  uv: number;
  clicks: number;
  dwellMs: number;
  bounceRate: number;
  pageCount: number;
};

export type ClickHeatPoint = {
  x: number;
  y: number;
  weight: number;
};

export type ClickHeatZone = {
  label: string;
  cx: number;
  cy: number;
  share: number;
};

export type PageClickHeat = {
  route: string;
  titleZh: string;
  zones: ClickHeatZone[];
  points: ClickHeatPoint[];
};

export type HeatSummary = {
  totalPv: number;
  totalClicks: number;
  avgDwellMs: number;
  avgBounceRate: number;
  coveredPages: number;
};

export type L6BehaviorHeatmapData = {
  available: boolean;
  status: string;
  message: string;
  requiredEvents: string[];
  totalPages: number;
  trackedCount: number;
  pageTree: UxPageNode[];
  excludedPages: UxPageNode[];
  activityByWindow: Record<TimeWindow, PageActivityStat[]>;
  clickHeatByRoute: Record<string, PageClickHeat>;
  dailyTrend: { bucket: string; pv: number; clicks: number }[];
  weeklyTrend: { bucket: string; pv: number; clicks: number }[];
};

const WINDOWS: TimeWindow[] = ["24h", "7d", "30d"];

export function normalizeL6BehaviorHeatmap(raw: unknown): L6BehaviorHeatmapData {
  const data = rec(raw);
  const pageTree = rows<unknown>(data.pageTree).map(normalizePageNode).filter((node) => node.route);
  const excludedPages = rows<unknown>(data.excludedPages).map(normalizePageNode).filter((node) => node.route);
  const activityRoot = rec(data.activityByWindow);
  const clickRoot = rec(data.clickHeatByRoute);
  const clickHeatByRoute: Record<string, PageClickHeat> = {};
  for (const [route, value] of Object.entries(clickRoot)) {
    clickHeatByRoute[route] = normalizeClickHeat(route, value);
  }
  return {
    available: bool(data.available),
    status: str(data.status),
    message: str(data.message),
    requiredEvents: strings(data.requiredEvents),
    totalPages: num(data.totalPages, pageTree.length),
    trackedCount: num(data.trackedCount, pageTree.filter((node) => node.tracked).length),
    pageTree,
    excludedPages,
    activityByWindow: {
      "24h": normalizeActivityRows(activityRoot["24h"]),
      "7d": normalizeActivityRows(activityRoot["7d"]),
      "30d": normalizeActivityRows(activityRoot["30d"]),
    },
    clickHeatByRoute,
    dailyTrend: normalizeTrend(data.dailyTrend),
    weeklyTrend: normalizeTrend(data.weeklyTrend),
  };
}

function normalizeTrend(value: unknown) {
  return rows<unknown>(value).map((row) => {
    const data = rec(row);
    return { bucket: str(data.bucket), pv: num(data.pv), clicks: num(data.clicks) };
  }).filter((row) => row.bucket);
}

export function activityForWindow(data: L6BehaviorHeatmapData, window: TimeWindow) {
  return data.activityByWindow[window] ?? [];
}

export function clickHeatForRoute(data: L6BehaviorHeatmapData, route: string): PageClickHeat {
  const fallback = data.pageTree.find((node) => node.route === route);
  return data.clickHeatByRoute[route] ?? { route, titleZh: fallback?.titleZh ?? route, zones: [], points: [] };
}

export function aggregateByDepth(pageTree: UxPageNode[], stats: PageActivityStat[], depth: DepthFilter): HeatRow[] {
  const nodeByRoute = new Map(pageTree.map((node) => [node.route, node]));
  type Acc = { pv: number; uv: number; clicks: number; dwellNum: number; bounceNum: number; pages: number };
  const buckets = new Map<string, Acc>();
  for (const stat of stats) {
    const node = nodeByRoute.get(stat.route);
    if (!node?.tracked) continue;
    if (depth === "L3" && node.level !== 3) continue;
    const key = depth === "L1" ? node.parentL1 : depth === "L2" ? node.parentL2 : node.route;
    const acc = buckets.get(key) ?? { pv: 0, uv: 0, clicks: 0, dwellNum: 0, bounceNum: 0, pages: 0 };
    acc.pv += stat.pv;
    acc.uv += stat.uv;
    acc.clicks += stat.clicks;
    acc.dwellNum += stat.dwellMs * stat.pv;
    acc.bounceNum += stat.bounceRate * stat.pv;
    acc.pages += Math.max(1, stat.pageCount);
    buckets.set(key, acc);
  }
  return [...buckets.entries()].map(([key, acc]) => {
    const rep = nodeByRoute.get(key);
    return {
      key,
      titleZh: rep?.titleZh ?? key,
      level: rep?.level ?? 3,
      pv: acc.pv,
      uv: acc.uv,
      clicks: acc.clicks,
      dwellMs: acc.pv ? Math.round(acc.dwellNum / acc.pv) : 0,
      bounceRate: acc.pv ? Number((acc.bounceNum / acc.pv).toFixed(3)) : 0,
      pageCount: acc.pages,
    };
  });
}

export function summarize(stats: PageActivityStat[]): HeatSummary {
  let totalPv = 0;
  let totalClicks = 0;
  let dwellNum = 0;
  let bounceNum = 0;
  for (const stat of stats) {
    totalPv += stat.pv;
    totalClicks += stat.clicks;
    dwellNum += stat.dwellMs * stat.pv;
    bounceNum += stat.bounceRate * stat.pv;
  }
  return {
    totalPv,
    totalClicks,
    avgDwellMs: totalPv ? Math.round(dwellNum / totalPv) : 0,
    avgBounceRate: totalPv ? Number((bounceNum / totalPv).toFixed(3)) : 0,
    coveredPages: stats.length,
  };
}

function normalizePageNode(value: unknown): UxPageNode {
  const data = rec(value);
  const level = num(data.level, num(data.pageLevel, 3));
  return {
    route: str(data.route),
    titleZh: str(data.titleZh, str(data.route)),
    level: level === 1 || level === 2 ? level : 3,
    parentL1: str(data.parentL1, str(data.route)),
    parentL2: str(data.parentL2, str(data.route)),
    tracked: bool(data.tracked, true),
  };
}

function normalizeActivityRows(value: unknown): PageActivityStat[] {
  return rows<unknown>(value).map((row) => {
    const data = rec(row);
    return {
      route: str(data.route),
      pv: num(data.pv),
      uv: num(data.uv),
      clicks: num(data.clicks),
      dwellMs: num(data.dwellMs),
      bounceRate: num(data.bounceRate),
      pageCount: num(data.pageCount, 1),
    };
  }).filter((row) => row.route);
}

function normalizeClickHeat(route: string, value: unknown): PageClickHeat {
  const data = rec(value);
  return {
    route: str(data.route, route),
    titleZh: str(data.titleZh, route),
    zones: rows<unknown>(data.zones).map((zone) => {
      const item = rec(zone);
      return {
        label: str(item.label),
        cx: num(item.cx),
        cy: num(item.cy),
        share: num(item.share),
      };
    }),
    points: rows<unknown>(data.points).map((point) => {
      const item = rec(point);
      return {
        x: num(item.x),
        y: num(item.y),
        weight: num(item.weight),
      };
    }),
  };
}

export function availableWindows() {
  return WINDOWS;
}
