type JsonRecord = Record<string, unknown>;

const BOOLEAN_STRINGS = new Set(["true", "false", "1", "0", "on", "off", "enabled", "disabled", "enable", "disable"]);
const G1_STATES = new Set(["pending_lock", "active", "mature_unclaimed", "claimed", "early_withdrawn", "slashed", "refunded"]);
const G1_POOL_STATES = new Set(["active", "stopped", "killed"]);
const G2_CAP_KEYS = new Set(["userDailyCap", "platformDailyCap", "fee", "feeMin", "kycThreshold", "queueMode"]);
const G2_GATE_KEYS = ["kyc", "user", "platform", "geo"] as const;
const G4_PARAM_KEYS = new Set(["supply", "price", "dividend", "royalty", "divBase", "airdropPct", "emissionCurve", "airdropLockDays"]);
const G4_STATES = new Set(["minted", "held", "listed", "sold"]);
const G7_PARAM_KEYS = new Set(["apy", "lockDays", "nurture", "lottery", "penalty", "presets"]);
const G7_STATES = new Set(["pending_lock", "active", "mature_unclaimed", "claimed", "early_withdrawn"]);

function fail(module: string, path: string): never {
  throw new Error(`${module}_RESPONSE_INVALID:${path}`);
}

function record(module: string, value: unknown, path: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(module, path);
  return value as JsonRecord;
}

function array(module: string, value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(module, path);
  return value;
}

function text(module: string, value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) fail(module, path);
  return value;
}

function enumText(module: string, value: unknown, path: string, values: ReadonlySet<string>): string {
  const normalized = text(module, value, path).trim();
  if (!values.has(normalized)) fail(module, path);
  return normalized;
}

function bool(module: string, value: unknown, path: string): void {
  if (typeof value === "boolean") return;
  if (typeof value === "string" && BOOLEAN_STRINGS.has(value.trim().toLowerCase())) return;
  fail(module, path);
}

function numeric(module: string, value: unknown, path: string, min = 0, max = Number.POSITIVE_INFINITY): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value.replace(/[$,%±,\s]/g, ""))
      : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) fail(module, path);
  return parsed;
}

function requiredKeys(module: string, value: JsonRecord, path: string, keys: readonly string[]): void {
  for (const key of keys) {
    if (!(key in value) || value[key] === undefined || value[key] === null) fail(module, `${path}.${key}`);
  }
}

function canonicalRoot(module: string, value: unknown, expectedDomain: string): JsonRecord {
  const root = record(module, value, "data");
  if (root.domain !== expectedDomain) fail(module, "data.domain");
  if (root.serverCanonical !== true) fail(module, "data.serverCanonical");
  const sources = array(module, root.sources, "data.sources");
  if (sources.length === 0) fail(module, "data.sources");
  sources.forEach((source, index) => text(module, source, `data.sources[${index}]`));
  return root;
}

function coverage(module: string, value: unknown): void {
  const row = record(module, value, "data.coverage");
  requiredKeys(module, row, "data.coverage", ["coverageRatio", "redlinePct", "redlineBreached", "precheck"]);
  numeric(module, row.coverageRatio, "data.coverage.coverageRatio");
  numeric(module, row.redlinePct, "data.coverage.redlinePct", 0, 100);
  bool(module, row.redlineBreached, "data.coverage.redlineBreached");
  text(module, row.precheck, "data.coverage.precheck");
}

function stateMachine(module: string, value: unknown, expected: ReadonlySet<string>): void {
  const states = array(module, value, "data.stateMachine");
  if (states.length !== expected.size) fail(module, "data.stateMachine");
  const actual = new Set(states.map((state, index) => text(module, state, `data.stateMachine[${index}]`)));
  if (actual.size !== expected.size || [...expected].some((state) => !actual.has(state))) fail(module, "data.stateMachine");
}

function validateG1Pool(value: unknown, index: number): void {
  const module = "G1";
  const path = `data.pools[${index}]`;
  const row = record(module, value, path);
  requiredKeys(module, row, path, [
    "product", "tierKey", "term", "termDays", "apy", "apyDisplay", "penalty", "penaltyDisplay",
    "minStake", "minDisplayValue", "lockedUsd", "lockedDisplay", "enabled", "killed", "status",
    "statusLabel", "statusTone", "highYield",
  ]);
  text(module, row.product, `${path}.product`);
  text(module, row.tierKey, `${path}.tierKey`);
  text(module, row.term, `${path}.term`);
  numeric(module, row.termDays, `${path}.termDays`, 1);
  numeric(module, row.apy, `${path}.apy`, 0, 300);
  text(module, row.apyDisplay, `${path}.apyDisplay`);
  numeric(module, row.penalty, `${path}.penalty`, 0, 100);
  text(module, row.penaltyDisplay, `${path}.penaltyDisplay`);
  numeric(module, row.minStake, `${path}.minStake`);
  text(module, row.minDisplayValue, `${path}.minDisplayValue`);
  numeric(module, row.lockedUsd, `${path}.lockedUsd`);
  text(module, row.lockedDisplay, `${path}.lockedDisplay`);
  bool(module, row.enabled, `${path}.enabled`);
  bool(module, row.killed, `${path}.killed`);
  enumText(module, row.status, `${path}.status`, G1_POOL_STATES);
  text(module, row.statusLabel, `${path}.statusLabel`);
  enumText(module, row.statusTone, `${path}.statusTone`, new Set(["ok", "bad", "warn", "dim"]));
  bool(module, row.highYield, `${path}.highYield`);
}

function validateG1PositionGroup(value: unknown, index: number): void {
  const module = "G1";
  const path = `data.positions[${index}]`;
  const row = record(module, value, path);
  requiredKeys(module, row, path, ["status", "label", "note", "count", "rows"]);
  enumText(module, row.status, `${path}.status`, G1_STATES);
  text(module, row.label, `${path}.label`);
  text(module, row.note, `${path}.note`, true);
  numeric(module, row.count, `${path}.count`);
  array(module, row.rows, `${path}.rows`).forEach((item, rowIndex) => {
    const rowPath = `${path}.rows[${rowIndex}]`;
    const position = record(module, item, rowPath);
    requiredKeys(module, position, rowPath, [
      "positionNo", "userNo", "nickname", "tier", "amount", "lockedApy", "earlyPenalty",
      "lockedAt", "unlockAt", "estimatedInterest", "status", "statusLabel", "statusTone", "note",
    ]);
    ["positionNo", "userNo", "tier", "amount", "lockedApy", "earlyPenalty", "lockedAt", "unlockAt",
      "estimatedInterest", "status", "statusLabel", "statusTone"].forEach((key) => text(module, position[key], `${rowPath}.${key}`));
    text(module, position.nickname, `${rowPath}.nickname`, true);
    text(module, position.note, `${rowPath}.note`, true);
  });
}

export function assertG1OverviewContract<T>(value: T): T {
  const module = "G1";
  const root = canonicalRoot(module, value, module);
  if (root.product !== "staking") fail(module, "data.product");
  numeric(module, root.currentNexPrice, "data.currentNexPrice");
  const stats = record(module, root.stats, "data.stats");
  const statKeys = [
    "lockedTotalUsd", "usdtPoolUsd", "nexPoolUsd", "interestUsd", "positionCount", "activeCount",
    "matureCount", "pendingCount", "earlyWithdrawnMonth", "killedCount",
  ] as const;
  requiredKeys(module, stats, "data.stats", [...statKeys, "stakingGateOn"]);
  statKeys.forEach((key) => numeric(module, stats[key], `data.stats.${key}`));
  bool(module, stats.stakingGateOn, "data.stats.stakingGateOn");
  const gate = record(module, root.gate, "data.gate");
  requiredKeys(module, gate, "data.gate", ["enabled", "configKey", "linkedDomain"]);
  bool(module, gate.enabled, "data.gate.enabled");
  text(module, gate.configKey, "data.gate.configKey");
  if (gate.linkedDomain !== "J1") fail(module, "data.gate.linkedDomain");
  coverage(module, root.coverage);
  array(module, root.pools, "data.pools").forEach(validateG1Pool);
  array(module, root.positions, "data.positions").forEach(validateG1PositionGroup);
  stateMachine(module, root.stateMachine, G1_STATES);
  return value;
}

function validateG2Order(module: string, value: unknown, path: string): void {
  const row = record(module, value, path);
  requiredKeys(module, row, path, [
    "id", "userId", "userNo", "nickname", "countryCode", "exchangeNo", "fromAsset", "toAsset",
    "fromAmount", "toAmount", "rate", "status", "statusLabel", "statusTone", "directionLabel",
    "amountUsdt", "gateReason", "etaLabel", "createdAt", "updatedAt",
  ]);
  text(module, String(row.id), `${path}.id`);
  numeric(module, row.userId, `${path}.userId`, 1);
  ["userNo", "exchangeNo", "fromAsset", "toAsset", "status", "statusLabel", "statusTone", "directionLabel",
    "createdAt"].forEach((key) => text(module, row[key], `${path}.${key}`));
  ["nickname", "countryCode", "gateReason", "etaLabel", "updatedAt"].forEach((key) => text(module, row[key], `${path}.${key}`, true));
  ["fromAmount", "toAmount", "rate", "amountUsdt"].forEach((key) => numeric(module, row[key], `${path}.${key}`));
}

export function assertG2OverviewContract<T>(value: T): T {
  const module = "G2";
  const root = canonicalRoot(module, value, module);
  if (root.asset !== "NEX" || root.currency !== "USDT") fail(module, "data.asset");
  numeric(module, root.currentPrice, "data.currentPrice");
  const stats = record(module, root.stats, "data.stats");
  const statKeys = ["todayUsd", "poolPct", "queueDepth", "gateKyc", "gateUser", "gatePlatform", "gateGeo"] as const;
  requiredKeys(module, stats, "data.stats", statKeys);
  statKeys.forEach((key) => numeric(module, stats[key], `data.stats.${key}`));
  const caps = array(module, root.caps, "data.caps");
  if (caps.length !== G2_CAP_KEYS.size) fail(module, "data.caps");
  const capKeys = new Set<string>();
  caps.forEach((item, index) => {
    const path = `data.caps[${index}]`;
    const row = record(module, item, path);
    requiredKeys(module, row, path, ["key", "name", "sub", "value", "displayValue", "note", "loosen"]);
    const key = enumText(module, row.key, `${path}.key`, G2_CAP_KEYS);
    capKeys.add(key);
    ["name", "sub", "displayValue", "note"].forEach((field) => text(module, row[field], `${path}.${field}`));
    if (key === "queueMode") enumText(module, String(row.value), `${path}.value`, new Set(["QUEUE", "REJECT"]));
    else numeric(module, row.value, `${path}.value`);
    bool(module, row.loosen, `${path}.loosen`);
    if (row.meterPct !== undefined && row.meterPct !== null) numeric(module, row.meterPct, `${path}.meterPct`);
  });
  if (capKeys.size !== G2_CAP_KEYS.size) fail(module, "data.caps");
  array(module, root.queue, "data.queue").forEach((row, index) => validateG2Order(module, row, `data.queue[${index}]`));
  const gates = record(module, root.gateDetails, "data.gateDetails");
  G2_GATE_KEYS.forEach((key) => {
    const path = `data.gateDetails.${key}`;
    const gate = record(module, gates[key], path);
    requiredKeys(module, gate, path, ["key", "title", "note", "count", "rows"]);
    if (gate.key !== key) fail(module, `${path}.key`);
    text(module, gate.title, `${path}.title`);
    text(module, gate.note, `${path}.note`, true);
    numeric(module, gate.count, `${path}.count`);
    array(module, gate.rows, `${path}.rows`).forEach((row, index) => validateG2Order(module, row, `${path}.rows[${index}]`));
  });
  const swap = record(module, root.swap, "data.swap");
  requiredKeys(module, swap, "data.swap", ["enabled", "status", "configKey", "linkedDomain"]);
  bool(module, swap.enabled, "data.swap.enabled");
  enumText(module, swap.status, "data.swap.status", new Set(["enabled", "disabled"]));
  text(module, swap.configKey, "data.swap.configKey");
  if (swap.linkedDomain !== "J1") fail(module, "data.swap.linkedDomain");
  array(module, root.geoBlocked, "data.geoBlocked").forEach((item, index) => {
    const path = `data.geoBlocked[${index}]`;
    const geo = record(module, item, path);
    requiredKeys(module, geo, path, ["cc", "name", "status", "reason"]);
    ["cc", "name", "status", "reason"].forEach((key) => text(module, geo[key], `${path}.${key}`));
  });
  coverage(module, root.coverage);
  return value;
}

function validateParam(module: string, value: unknown, path: string, allowed: ReadonlySet<string>, flags: readonly string[]): void {
  const row = record(module, value, path);
  requiredKeys(module, row, path, ["key", "configKey", "name", "sub", "value", "displayValue", "note", "valueType", ...flags]);
  enumText(module, row.key, `${path}.key`, allowed);
  ["configKey", "name", "sub", "displayValue", "note", "valueType"].forEach((key) => text(module, row[key], `${path}.${key}`));
  if (typeof row.value !== "string" && typeof row.value !== "number") fail(module, `${path}.value`);
  flags.forEach((key) => bool(module, row[key], `${path}.${key}`));
}

export function assertG4OverviewContract<T>(value: T): T {
  const module = "G4";
  const root = canonicalRoot(module, value, module);
  if (root.product !== "genesis" || root.asset !== "GENESIS_NODE") fail(module, "data.product");
  numeric(module, root.currentNexPrice, "data.currentNexPrice");
  const stats = record(module, root.stats, "data.stats");
  const statKeys = ["totalSlots", "sold", "unitPrice", "unsold", "soldPct", "genesisAccrualUsd"] as const;
  requiredKeys(module, stats, "data.stats", [...statKeys, "marketOn", "todayBatch", "secondary"]);
  statKeys.forEach((key) => numeric(module, stats[key], `data.stats.${key}`, 0, key === "soldPct" ? 100 : Number.POSITIVE_INFINITY));
  bool(module, stats.marketOn, "data.stats.marketOn");
  text(module, stats.todayBatch, "data.stats.todayBatch", true);
  const secondary = record(module, stats.secondary, "data.stats.secondary");
  const secondaryKeys = ["floor", "vol24h", "listed", "owners", "royaltyPct"] as const;
  requiredKeys(module, secondary, "data.stats.secondary", secondaryKeys);
  secondaryKeys.forEach((key) => numeric(module, secondary[key], `data.stats.secondary.${key}`, 0, key === "royaltyPct" ? 100 : Number.POSITIVE_INFINITY));
  const params = array(module, root.params, "data.params");
  if (params.length !== 0 && params.length !== G4_PARAM_KEYS.size) fail(module, "data.params");
  params.forEach((param, index) => validateParam(module, param, `data.params[${index}]`, G4_PARAM_KEYS, ["b1RedlineTriggered"]));
  const dividend = record(module, root.dividend, "data.dividend");
  const dividendKeys = ["dailyVolumeBase", "dividendPct", "poolToday", "perSlotPerDay", "floorPerNodePerDay", "payoutToday"] as const;
  requiredKeys(module, dividend, "data.dividend", [...dividendKeys, "batchNo", "batchStatus"]);
  dividendKeys.forEach((key) => numeric(module, dividend[key], `data.dividend.${key}`, 0, key === "dividendPct" ? 100 : Number.POSITIVE_INFINITY));
  text(module, dividend.batchNo, "data.dividend.batchNo", true);
  text(module, dividend.batchStatus, "data.dividend.batchStatus", true);
  const emission = record(module, root.emissionGate, "data.emissionGate");
  requiredKeys(module, emission, "data.emissionGate", ["configKey", "open", "owner"]);
  text(module, emission.configKey, "data.emissionGate.configKey");
  bool(module, emission.open, "data.emissionGate.open");
  if (emission.owner !== "H1") fail(module, "data.emissionGate.owner");
  const market = record(module, root.market, "data.market");
  requiredKeys(module, market, "data.market", ["enabled", "configKey", "linkedDomain"]);
  bool(module, market.enabled, "data.market.enabled");
  text(module, market.configKey, "data.market.configKey");
  if (market.linkedDomain !== "J1") fail(module, "data.market.linkedDomain");
  array(module, root.geoBlocked, "data.geoBlocked");
  array(module, root.nodes, "data.nodes").forEach((item, index) => {
    const path = `data.nodes[${index}]`;
    const node = record(module, item, path);
    requiredKeys(module, node, path, ["id", "owner", "userNo", "source", "lifetimeDividend", "status", "statusLabel", "statusTone", "buy", "dividends", "transfers"]);
    ["id", "owner", "userNo", "source", "status", "statusLabel", "statusTone", "buy"].forEach((key) => text(module, node[key], `${path}.${key}`));
    text(module, node.lifetimeDividend, `${path}.lifetimeDividend`, true);
    array(module, node.dividends, `${path}.dividends`);
    array(module, node.transfers, `${path}.transfers`);
  });
  const page = record(module, root.nodePage, "data.nodePage");
  requiredKeys(module, page, "data.nodePage", ["page", "pageSize", "total", "totalPages", "hasPrev", "hasNext"]);
  numeric(module, page.page, "data.nodePage.page", 1);
  numeric(module, page.pageSize, "data.nodePage.pageSize", 1);
  numeric(module, page.total, "data.nodePage.total");
  numeric(module, page.totalPages, "data.nodePage.totalPages", 1);
  bool(module, page.hasPrev, "data.nodePage.hasPrev");
  bool(module, page.hasNext, "data.nodePage.hasNext");
  stateMachine(module, root.stateMachine, G4_STATES);
  coverage(module, root.coverage);
  return value;
}

export function assertG7OverviewContract<T>(value: T): T {
  const module = "G7";
  const root = canonicalRoot(module, value, module);
  if (root.product !== "repurchase" || root.asset !== "USDT") fail(module, "data.product");
  numeric(module, root.currentNexPrice, "data.currentNexPrice");
  const stats = record(module, root.stats, "data.stats");
  const statKeys = ["ordersMonth", "principalUsd", "matureUsd", "ticketsMonth", "reinvestRate", "lockDays"] as const;
  requiredKeys(module, stats, "data.stats", [...statKeys, "reinvestRateAvailable"]);
  statKeys.forEach((key) => numeric(module, stats[key], `data.stats.${key}`, 0, key === "reinvestRate" ? 100 : Number.POSITIVE_INFINITY));
  bool(module, stats.reinvestRateAvailable, "data.stats.reinvestRateAvailable");
  const capacity = record(module, root.g4Capacity, "data.g4Capacity");
  requiredKeys(module, capacity, "data.g4Capacity", ["monthlyCapacity", "ticketsIssuedThisMonth", "source"]);
  numeric(module, capacity.monthlyCapacity, "data.g4Capacity.monthlyCapacity");
  numeric(module, capacity.ticketsIssuedThisMonth, "data.g4Capacity.ticketsIssuedThisMonth");
  text(module, capacity.source, "data.g4Capacity.source");
  const params = array(module, root.params, "data.params");
  if (params.length !== 0 && params.length !== G7_PARAM_KEYS.size) fail(module, "data.params");
  params.forEach((param, index) => validateParam(module, param, `data.params[${index}]`, G7_PARAM_KEYS, ["newOnly", "b1RedlineTriggered"]));
  const phaseGate = record(module, root.phaseGate, "data.phaseGate");
  requiredKeys(module, phaseGate, "data.phaseGate", ["key", "label", "value", "linkedDomain", "readonly"]);
  ["key", "label", "value"].forEach((key) => text(module, phaseGate[key], `data.phaseGate.${key}`));
  if (phaseGate.linkedDomain !== "H1") fail(module, "data.phaseGate.linkedDomain");
  bool(module, phaseGate.readonly, "data.phaseGate.readonly");
  stateMachine(module, root.stateMachine, G7_STATES);
  array(module, root.statusBreakdown, "data.statusBreakdown").forEach((item, index) => {
    const path = `data.statusBreakdown[${index}]`;
    const status = record(module, item, path);
    requiredKeys(module, status, path, ["status", "label", "count", "principalUsd", "principalDisplay", "tone"]);
    enumText(module, String(status.status).toLowerCase(), `${path}.status`, G7_STATES);
    text(module, status.label, `${path}.label`);
    numeric(module, status.count, `${path}.count`);
    numeric(module, status.principalUsd, `${path}.principalUsd`);
    text(module, status.principalDisplay, `${path}.principalDisplay`);
    text(module, status.tone, `${path}.tone`);
  });
  text(module, root.amountDistribution, "data.amountDistribution");
  coverage(module, root.coverage);
  return value;
}

export function assertG7OrderPageContract<T>(value: T): T {
  const module = "G7_ORDERS";
  const root = record(module, value, "data");
  if (root.serverCanonical !== true) fail(module, "data.serverCanonical");
  bool(module, root.hasMore, "data.hasMore");
  if (root.nextCursor !== null) numeric(module, root.nextCursor, "data.nextCursor");
  array(module, root.orders, "data.orders").forEach((item, index) => {
    const path = `data.orders[${index}]`;
    const order = record(module, item, path);
    requiredKeys(module, order, path, [
      "orderNo", "userId", "userNo", "nickname", "amountUsdt", "apyPct", "lockDays",
      "lockedAt", "unlockAt", "estimatedInterestUsdt", "status", "billCorrelationPrefix",
    ]);
    ["orderNo", "userNo", "status", "billCorrelationPrefix"].forEach((key) => text(module, order[key], `${path}.${key}`));
    text(module, order.nickname, `${path}.nickname`, true);
    text(module, order.lockedAt, `${path}.lockedAt`, true);
    text(module, order.unlockAt, `${path}.unlockAt`, true);
    ["userId", "amountUsdt", "apyPct", "lockDays", "estimatedInterestUsdt"].forEach((key) => numeric(module, order[key], `${path}.${key}`));
  });
  return value;
}
