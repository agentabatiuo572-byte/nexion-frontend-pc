export type L4LiveFact = {
  key:
    | "deviceCatalogItems"
    | "deviceOrders"
    | "userDevices"
    | "activeUserDevices"
    | "computeTasks"
    | "completedComputeTasks"
    | "taskCatalogItems"
    | "teamRelationships"
    | "commissionEvents"
    | "configuredPhases"
    | "e3ConfigChanges"
    | "tradeinApplications"
    | "completedTradeins";
  group: "device" | "task" | "network" | "phase" | "tradein";
  label: string;
  value: number;
  description: string;
  sourceLabel: string;
};

const FACT_META: ReadonlyArray<Omit<L4LiveFact, "value">> = [
  { key: "deviceCatalogItems", group: "device", label: "设备目录条目", description: "当前未删除的设备商品目录记录。", sourceLabel: "设备目录" },
  { key: "deviceOrders", group: "device", label: "设备订单记录", description: "后台设备订单的当前累计记录数。", sourceLabel: "设备订单" },
  { key: "userDevices", group: "device", label: "用户设备实例", description: "当前未删除的用户设备实例总数。", sourceLabel: "用户设备" },
  { key: "activeUserDevices", group: "device", label: "当前活跃设备", description: "状态为在线、忙碌、活跃或运行中的用户设备数。", sourceLabel: "用户设备" },
  { key: "computeTasks", group: "task", label: "算力任务记录", description: "当前未删除的算力任务累计记录数。", sourceLabel: "算力任务" },
  { key: "completedComputeTasks", group: "task", label: "已完成算力任务", description: "当前状态为已完成的算力任务累计记录数。", sourceLabel: "算力任务" },
  { key: "taskCatalogItems", group: "task", label: "任务目录条目", description: "当前任务目录中的有效配置条目数。", sourceLabel: "任务目录" },
  { key: "teamRelationships", group: "network", label: "团队关系记录", description: "当前未删除的团队成员关系累计记录数。", sourceLabel: "团队关系" },
  { key: "commissionEvents", group: "network", label: "佣金事件", description: "当前未删除的佣金业务事件累计记录数。", sourceLabel: "佣金事件记录" },
  { key: "configuredPhases", group: "phase", label: "启用的阶段配置", description: "当前启用的阶段配置条目数，不代表阶段效果。", sourceLabel: "阶段配置" },
  { key: "e3ConfigChanges", group: "tradein", label: "E3 配置变更", description: "已进入 A4 的 E3 配置变更事件累计数。", sourceLabel: "A4 事件中心" },
  { key: "tradeinApplications", group: "tradein", label: "置换申请", description: "当前真实置换申请累计记录数。", sourceLabel: "置换申请" },
  { key: "completedTradeins", group: "tradein", label: "已完成置换", description: "状态为已完成的真实置换申请累计数。", sourceLabel: "置换申请" },
];

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function readL4LiveFacts(value: unknown): L4LiveFact[] {
  const facts = record(record(value).liveFacts);
  return FACT_META.flatMap((meta) => {
    if (!Object.prototype.hasOwnProperty.call(facts, meta.key)) return [];
    const parsed = Number(facts[meta.key]);
    if (!Number.isFinite(parsed) || parsed < 0) return [];
    return [{ ...meta, value: parsed }];
  });
}

export type L4Period = "day" | "week" | "month" | "custom";
export type L4Phase = "ALL" | "P1" | "P2" | "P3" | "P4" | "P5" | "P6";
export type L4OperationsQuery = { period: L4Period; phase: L4Phase; from?: string; to?: string };

export type L4DistRow = { key: string; count: number };
export type L4PhaseRow = {
  phase: string;
  activeUsers: number;
  retentionRate: number | null;
  conversionRate: number | null;
  yieldUsdt: number;
  transitionCount: number;
  dialChangeCount: number;
  conversionStepPct: number | null;
};

export type L4HistoryRow = {
  bucket: string;
  devicePurchases: number;
  deviceRetirements: number;
  yieldUsdt: number;
  tasksCompleted: number;
  directRefs: number;
  commissionPaidUsdt: number;
};

export type L4OperationsData = {
  available: boolean;
  period: { key: L4Period; label: string; from: string; to: string };
  phaseFilter: L4Phase;
  device: {
    summary: Record<string, number | null>;
    byGeneration: L4DistRow[];
    byModel: L4DistRow[];
    degradation: Array<{ band: string; events: number; actualUsdt: number; lossUsdt: number }>;
  };
  tasks: { summary: Record<string, number | null>; byTier: L4DistRow[] };
  network: {
    summary: Record<string, number | null>;
    teamSizeDist: L4DistRow[];
    vRankDist: L4DistRow[];
    commissionStructure: L4DistRow[];
  };
  phaseEffect: L4PhaseRow[];
  history: L4HistoryRow[];
  quality: { serverCanonical: boolean; sameActorRates: boolean; actorCoveragePct: number; incompleteRatesAreNull: boolean; eventCount: number };
  liveFacts: Record<string, number>;
  degraded?: { code: string; message: string };
};

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row) => row && typeof row === "object") as Record<string, unknown>[] : [];
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}

function finite(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullable(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function summary(value: unknown) {
  return Object.fromEntries(Object.entries(record(value)).map(([key, item]) => [key, nullable(item)]));
}

function dist(value: unknown): L4DistRow[] {
  return list(value).map((row) => ({ key: text(row.key, "未标注"), count: finite(row.count) }));
}

export function readL4Operations(value: unknown): L4OperationsData | null {
  const root = record(value);
  if (!Object.prototype.hasOwnProperty.call(root, "available")) return null;
  const period = record(root.period);
  const device = record(root.device);
  const tasks = record(root.tasks);
  const network = record(root.network);
  const quality = record(root.quality);
  const live = record(root.liveFacts);
  const degraded = record(root.degraded);
  return {
    available: root.available === true,
    period: {
      key: (["day", "week", "month", "custom"].includes(text(period.key)) ? text(period.key) : "week") as L4Period,
      label: text(period.label, "近 7 天"),
      from: text(period.from),
      to: text(period.to),
    },
    phaseFilter: (/^(ALL|P[1-6])$/.test(text(root.phaseFilter)) ? text(root.phaseFilter) : "ALL") as L4Phase,
    device: {
      summary: summary(device.summary),
      byGeneration: dist(device.byGeneration),
      byModel: dist(device.byModel),
      degradation: list(device.degradation).map((row) => ({
        band: text(row.band, "未标注"), events: finite(row.events), actualUsdt: finite(row.actualUsdt), lossUsdt: finite(row.lossUsdt),
      })),
    },
    tasks: { summary: summary(tasks.summary), byTier: dist(tasks.byTier) },
    network: {
      summary: summary(network.summary),
      teamSizeDist: dist(network.teamSizeDist),
      vRankDist: dist(network.vRankDist),
      commissionStructure: dist(network.commissionStructure),
    },
    phaseEffect: list(root.phaseEffect).map((row) => ({
      phase: text(row.phase), activeUsers: finite(row.activeUsers), retentionRate: nullable(row.retentionRate),
      conversionRate: nullable(row.conversionRate), yieldUsdt: finite(row.yieldUsdt),
      transitionCount: finite(row.transitionCount), dialChangeCount: finite(row.dialChangeCount),
      conversionStepPct: nullable(row.conversionStepPct),
    })),
    history: list(root.history).map((row) => ({
      bucket: text(row.bucket), devicePurchases: finite(row.devicePurchases), deviceRetirements: finite(row.deviceRetirements),
      yieldUsdt: finite(row.yieldUsdt), tasksCompleted: finite(row.tasksCompleted), directRefs: finite(row.directRefs),
      commissionPaidUsdt: finite(row.commissionPaidUsdt),
    })),
    quality: {
      serverCanonical: quality.serverCanonical === true,
      sameActorRates: quality.sameActorRates === true,
      actorCoveragePct: finite(quality.actorCoveragePct),
      incompleteRatesAreNull: quality.incompleteRatesAreNull === true,
      eventCount: finite(quality.eventCount),
    },
    liveFacts: Object.fromEntries(Object.entries(live).flatMap(([key, item]) => {
      const parsed = Number(item);
      return Number.isFinite(parsed) && parsed >= 0 ? [[key, parsed]] : [];
    })),
    degraded: Object.keys(degraded).length ? { code: text(degraded.code), message: text(degraded.message) } : undefined,
  };
}
