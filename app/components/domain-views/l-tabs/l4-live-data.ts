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
  quality: {
    serverCanonical: boolean;
    sameActorRates: boolean;
    actorCoveragePct: number;
    incompleteRatesAreNull: boolean;
    eventCount: number;
    duplicateEventsIgnored: number;
    businessTimeZone: string;
  };
  liveFacts: Record<string, number>;
  degraded?: { code: string; message: string };
};

function list(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter((row) => row && typeof row === "object") as Record<string, unknown>[] : [];
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function number(value: unknown, options: { integer?: boolean; percent?: boolean } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  if (options.integer && !Number.isSafeInteger(value)) return null;
  if (options.percent && value > 100) return null;
  return value;
}

function nullableNumber(value: unknown, options: { percent?: boolean } = {}) {
  if (value === null) return null;
  return number(value, options);
}

function isoDate(value: unknown) {
  const parsed = text(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(parsed) && !Number.isNaN(Date.parse(`${parsed}T00:00:00Z`)) ? parsed : "";
}

function exactNumberSummary(
  value: unknown,
  required: ReadonlyArray<[string, { integer?: boolean; percent?: boolean; nullable?: boolean }]>,
) {
  const input = record(value);
  const result: Record<string, number | null> = {};
  for (const [key, options] of required) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) return null;
    const parsed = options.nullable
      ? nullableNumber(input[key], { percent: options.percent })
      : number(input[key], options);
    if (parsed === null && !options.nullable) return null;
    if (parsed === null && input[key] !== null) return null;
    result[key] = parsed;
  }
  return result;
}

function dist(value: unknown): L4DistRow[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const result: L4DistRow[] = [];
  for (const row of list(value)) {
    const key = text(row.key);
    const count = number(row.count, { integer: true });
    if (!key || count === null || seen.has(key)) return null;
    seen.add(key);
    result.push({ key, count });
  }
  return result;
}

export function readL4Operations(value: unknown): L4OperationsData | null {
  const root = record(value);
  if (typeof root.available !== "boolean") return null;
  const period = record(root.period);
  const device = record(root.device);
  const tasks = record(root.tasks);
  const network = record(root.network);
  const quality = record(root.quality);
  const live = record(root.liveFacts);
  const degraded = record(root.degraded);
  const periodKey = text(period.key);
  const periodLabel = text(period.label);
  const periodFrom = isoDate(period.from);
  const periodTo = isoDate(period.to);
  const phaseFilter = text(root.phaseFilter);
  if (!["day", "week", "month", "custom"].includes(periodKey)
      || !periodLabel || !periodFrom || !periodTo || periodFrom > periodTo
      || !/^(ALL|P[1-6])$/.test(phaseFilter)) return null;

  const deviceSummary = exactNumberSummary(device.summary, [
    ["periodPurchasedDevices", { integer: true }],
    ["periodRetiredDevices", { integer: true }],
    ["periodLockedDevices", { integer: true }],
    ["periodFirstYieldDevices", { integer: true }],
    ["dailyYieldUsdt", {}],
    ["dailyYieldNex", {}],
    ["degradationLossUsdt", {}],
    ["activeDevices", { integer: true }],
  ]);
  const taskSummary = exactNumberSummary(tasks.summary, [
    ["dispatched", { integer: true }],
    ["completed", { integer: true }],
    ["acceptanceRate", { percent: true, nullable: true }],
    ["queueSaturation", { percent: true, nullable: true }],
    ["checkinActive", { integer: true }],
  ]);
  const networkSummary = exactNumberSummary(network.summary, [
    ["directRefs", { integer: true }],
    ["commissionEvents", { integer: true }],
    ["commissionPaidUsdt", {}],
    ["teamGmvUsdt", {}],
    ["promotionRate", { percent: true, nullable: true }],
    ["commissionTriggerRate", { percent: true, nullable: true }],
  ]);
  if (!deviceSummary || !taskSummary || !networkSummary
      || typeof record(tasks.summary).orderedTaskJoin !== "boolean"
      || (taskSummary.completed ?? 0) > (taskSummary.dispatched ?? 0)) return null;

  const byGeneration = dist(device.byGeneration);
  const byModel = dist(device.byModel);
  const byTier = dist(tasks.byTier);
  const teamSizeDist = dist(network.teamSizeDist);
  const vRankDist = dist(network.vRankDist);
  const commissionStructure = dist(network.commissionStructure);
  if (!byGeneration || !byModel || !byTier || !teamSizeDist || !vRankDist || !commissionStructure
      || !Array.isArray(device.degradation) || !Array.isArray(root.phaseEffect) || !Array.isArray(root.history)) return null;

  const degradation = list(device.degradation).map((row) => ({
    band: text(row.band),
    events: number(row.events, { integer: true }),
    actualUsdt: number(row.actualUsdt),
    lossUsdt: number(row.lossUsdt),
  }));
  if (degradation.some((row) => !row.band || row.events === null || row.actualUsdt === null || row.lossUsdt === null)) return null;

  const expectedPhases = phaseFilter === "ALL" ? ["P1", "P2", "P3", "P4", "P5", "P6"] : [phaseFilter];
  const phaseEffect = list(root.phaseEffect).map((row) => ({
    phase: text(row.phase),
    activeUsers: number(row.activeUsers, { integer: true }),
    retentionRate: nullableNumber(row.retentionRate, { percent: true }),
    conversionRate: nullableNumber(row.conversionRate, { percent: true }),
    yieldUsdt: number(row.yieldUsdt),
    transitionCount: number(row.transitionCount, { integer: true }),
    dialChangeCount: number(row.dialChangeCount, { integer: true }),
    conversionStepPct: row.conversionStepPct === null
      ? null
      : typeof row.conversionStepPct === "number" && Number.isFinite(row.conversionStepPct)
        && row.conversionStepPct >= -100 && row.conversionStepPct <= 100 ? row.conversionStepPct : undefined,
  }));
  if (phaseEffect.length !== expectedPhases.length
      || phaseEffect.some((row, index) => row.phase !== expectedPhases[index]
        || row.activeUsers === null || row.retentionRate === undefined || row.conversionRate === undefined
        || row.yieldUsdt === null || row.transitionCount === null || row.dialChangeCount === null
        || row.conversionStepPct === undefined)) return null;

  const seenBuckets = new Set<string>();
  const history = list(root.history).map((row) => ({
    bucket: isoDate(row.bucket),
    devicePurchases: number(row.devicePurchases, { integer: true }),
    deviceRetirements: number(row.deviceRetirements, { integer: true }),
    yieldUsdt: number(row.yieldUsdt),
    tasksCompleted: number(row.tasksCompleted, { integer: true }),
    directRefs: number(row.directRefs, { integer: true }),
    commissionPaidUsdt: number(row.commissionPaidUsdt),
  }));
  if (history.some((row) => !row.bucket || seenBuckets.has(row.bucket)
      || (seenBuckets.add(row.bucket), false)
      || row.devicePurchases === null || row.deviceRetirements === null || row.yieldUsdt === null
      || row.tasksCompleted === null || row.directRefs === null || row.commissionPaidUsdt === null)) return null;

  const actorCoveragePct = number(quality.actorCoveragePct, { percent: true });
  const eventCount = number(quality.eventCount, { integer: true });
  const duplicateEventsIgnored = number(quality.duplicateEventsIgnored, { integer: true });
  const businessTimeZone = text(quality.businessTimeZone);
  if (quality.serverCanonical !== true || typeof quality.sameActorRates !== "boolean"
      || quality.incompleteRatesAreNull !== true || actorCoveragePct === null || eventCount === null
      || duplicateEventsIgnored === null || businessTimeZone !== "UTC+08:00"
      || root.available !== (eventCount > 0)) return null;
  const rateValues = [
    taskSummary.acceptanceRate,
    networkSummary.promotionRate,
    networkSummary.commissionTriggerRate,
    ...phaseEffect.flatMap((row) => [row.retentionRate, row.conversionRate]),
  ];
  if (!quality.sameActorRates && rateValues.some((item) => item !== null)) return null;

  const liveFacts: Record<string, number> = {};
  for (const [key, item] of Object.entries(live)) {
    const parsed = number(item, { integer: true });
    if (parsed === null) return null;
    liveFacts[key] = parsed;
  }
  if (!Object.prototype.hasOwnProperty.call(liveFacts, "activeUserDevices")
      || !Object.prototype.hasOwnProperty.call(liveFacts, "teamRelationships")) return null;

  const degradedValue = Object.keys(degraded).length
    ? { code: text(degraded.code), message: text(degraded.message) } : undefined;
  if ((!root.available && (!degradedValue?.code || !degradedValue.message))
      || (root.available && degradedValue)) return null;

  return {
    available: root.available,
    period: { key: periodKey as L4Period, label: periodLabel, from: periodFrom, to: periodTo },
    phaseFilter: phaseFilter as L4Phase,
    device: {
      summary: deviceSummary,
      byGeneration,
      byModel,
      degradation: degradation as Array<{ band: string; events: number; actualUsdt: number; lossUsdt: number }>,
    },
    tasks: { summary: taskSummary, byTier },
    network: { summary: networkSummary, teamSizeDist, vRankDist, commissionStructure },
    phaseEffect: phaseEffect as L4PhaseRow[],
    history: history as L4HistoryRow[],
    quality: {
      serverCanonical: true,
      sameActorRates: quality.sameActorRates,
      actorCoveragePct,
      incompleteRatesAreNull: true,
      eventCount,
      duplicateEventsIgnored,
      businessTimeZone,
    },
    liveFacts,
    degraded: degradedValue,
  };
}
