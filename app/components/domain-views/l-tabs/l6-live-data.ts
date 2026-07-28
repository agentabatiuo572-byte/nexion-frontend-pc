type UnknownRecord = Record<string, unknown>;

function rec(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function invalid(): never { throw new Error("L6_RESPONSE_INVALID"); }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : invalid(); }
function text(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : invalid();
}
function optionalText(value: unknown): string { return value == null ? "" : typeof value === "string" ? value : invalid(); }
function flag(value: unknown): boolean { return typeof value === "boolean" ? value : invalid(); }
function amount(value: unknown, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) invalid();
  return value;
}
function ratio(value: unknown): number {
  const result = amount(value);
  return result <= 1 ? result : invalid();
}
function route(value: unknown): string {
  const result = text(value);
  return /^\/pages\/[a-z0-9-]+\/[a-z0-9-]+$/.test(result) ? result : invalid();
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
  businessTimeZone: "UTC+08:00";
  lateArrivalPolicy: "included_on_next_query";
  deduplication: "clientEventId";
};

const WINDOWS: TimeWindow[] = ["24h", "7d", "30d"];

export function normalizeL6BehaviorHeatmap(raw: unknown): L6BehaviorHeatmapData {
  if (raw == null) return emptyL6("LOADING", "");
  const data = rec(raw);
  if (!Object.keys(data).length) invalid();
  const available = flag(data.available);
  const status = text(data.status);
  if (!available) return emptyL6(status, optionalText(data.message));
  if (status !== "AVAILABLE" || data.businessTimeZone !== "UTC+08:00"
      || data.lateArrivalPolicy !== "included_on_next_query") invalid();
  const quality = rec(data.quality);
  if (quality.clientEventIdDeduplicated !== true || quality.outOfOrderRejected !== true
      || quality.ctrDenominator !== "page_viewed_pv") invalid();
  const pageTree = array(data.pageTree).map((node) => normalizePageNode(node, true));
  const excludedPages = array(data.excludedPages).map((node) => normalizePageNode(node, false));
  const allRoutes = [...pageTree, ...excludedPages].map((node) => node.route);
  if (new Set(allRoutes).size !== allRoutes.length) invalid();
  const activityRoot = rec(data.activityByWindow);
  if (!Object.keys(activityRoot).length) invalid();
  const clickRoot = rec(data.clickHeatByRoute);
  const clickHeatByRoute: Record<string, PageClickHeat> = {};
  for (const [route, value] of Object.entries(clickRoot)) {
    const normalizedRoute = /^\/pages\/[a-z0-9-]+\/[a-z0-9-]+$/.test(route) ? route : invalid();
    clickHeatByRoute[normalizedRoute] = normalizeClickHeat(normalizedRoute, value);
  }
  const totalPages = amount(data.totalPages, true);
  const trackedCount = amount(data.trackedCount, true);
  if (trackedCount !== pageTree.length || totalPages !== pageTree.length + excludedPages.length) invalid();
  return {
    available,
    status,
    message: optionalText(data.message),
    requiredEvents: data.requiredEvents === undefined ? [] : array(data.requiredEvents).map(text),
    totalPages,
    trackedCount,
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
    businessTimeZone: "UTC+08:00",
    lateArrivalPolicy: "included_on_next_query",
    deduplication: "clientEventId",
  };
}

function normalizeTrend(value: unknown) {
  return array(value).map((row) => {
    const data = rec(row);
    return { bucket: text(data.bucket), pv: amount(data.pv, true), clicks: amount(data.clicks, true) };
  });
}

function emptyL6(status: string, message: string): L6BehaviorHeatmapData {
  return {
    available: false, status, message, requiredEvents: [], totalPages: 0, trackedCount: 0,
    pageTree: [], excludedPages: [],
    activityByWindow: { "24h": [], "7d": [], "30d": [] },
    clickHeatByRoute: {}, dailyTrend: [], weeklyTrend: [],
    businessTimeZone: "UTC+08:00", lateArrivalPolicy: "included_on_next_query",
    deduplication: "clientEventId",
  };
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

function normalizePageNode(value: unknown, expectedTracked: boolean): UxPageNode {
  const data = rec(value);
  const level = amount(data.level ?? data.pageLevel, true);
  if (![1, 2, 3].includes(level) || flag(data.tracked) !== expectedTracked) invalid();
  return {
    route: route(data.route),
    titleZh: text(data.titleZh),
    level: level as PageLevel,
    parentL1: route(data.parentL1),
    parentL2: route(data.parentL2),
    tracked: expectedTracked,
  };
}

function normalizeActivityRows(value: unknown): PageActivityStat[] {
  const result = array(value).map((row) => {
    const data = rec(row);
    const pv = amount(data.pv, true);
    const uv = amount(data.uv, true);
    if (uv > pv) invalid();
    return {
      route: route(data.route), pv, uv,
      clicks: amount(data.clicks, true),
      dwellMs: amount(data.dwellMs, true),
      bounceRate: ratio(data.bounceRate),
      pageCount: amount(data.pageCount, true),
    };
  });
  if (result.some((row) => row.pageCount < 1) || new Set(result.map((row) => row.route)).size !== result.length) invalid();
  return result;
}

function normalizeClickHeat(route: string, value: unknown): PageClickHeat {
  const data = rec(value);
  return {
    route: data.route === undefined ? route : routeOnly(data.route, route),
    titleZh: text(data.titleZh),
    zones: array(data.zones).map((zone) => {
      const item = rec(zone);
      return {
        label: text(item.label),
        cx: ratio(item.cx),
        cy: ratio(item.cy),
        share: ratio(item.share),
      };
    }),
    points: array(data.points).map((point) => {
      const item = rec(point);
      return {
        x: ratio(item.x),
        y: ratio(item.y),
        weight: ratio(item.weight),
      };
    }),
  };
}

function routeOnly(value: unknown, expected: string): string {
  const result = route(value);
  return result === expected ? result : invalid();
}

export function availableWindows() {
  return WINDOWS;
}
