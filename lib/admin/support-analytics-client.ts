import { supportRequest } from "./m-support-client.ts";
import { parseBusinessTime } from "./business-time.ts";

const VIEWS = ["OVERVIEW", "AGENTS", "CUSTOMERS", "FINANCE", "DEVICES", "ACTIVITY"] as const;
const BASES = ["CURRENT_CUSTOMER_HISTORY", "PERIOD_EVENT", "CURRENT_ASSET"] as const;
const CATEGORIES = ["ALL", "BOUND", "PENDING", "ANOMALY"] as const;
const FIRST = ["ALL", "CONFIRMED", "NONE", "UNKNOWN"] as const;
const FILTERS = ["ALL", "WINDOW_ACTIVE", "ACTIVE", "DORMANT", "UNKNOWN", "DUE", "WAITING_REPLY", "FIRST_CONTACT", "STOPPED", "TODO"] as const;
const SORTS = ["REGISTERED_AT", "ASSIGNED_AT", "LAST_ACTIVE_AT", "FIRST_SUCCEEDED_AT", "DIRECT_INVITATION_COUNT", "TEAM_CUSTOMER_COUNT", "PERSONAL_DEPOSIT", "TEAM_DEPOSIT", "BOUND_CUSTOMER_COUNT", "ACTIVE_CUSTOMER_COUNT", "FIRST_CONFIRMED_CUSTOMER_COUNT", "DEVICE_COUNT", "HASHRATE", "NEXT_DUE_AT", "WAITING_SINCE_AT", "STATE_CHANGED_AT", "POOL_ENTERED_AT", "SUCCEEDED_AT", "AMOUNT"] as const;
const STATUS = ["AVAILABLE", "PARTIAL", "UNKNOWN", "FAILED", "UNAVAILABLE"] as const;
const CURRENCIES = ["USDT", "NEX"] as const;
const READS = ["COMPLETE", "UNKNOWN", "FAILED", "NOT_REQUESTED"] as const;
const FUND_READS = ["READY", "PARTIAL", "UNKNOWN", "FAILED"] as const;
const FUND_STATUS = ["READY", "PARTIAL", "UNKNOWN", "UNAVAILABLE"] as const;
const FUND_REASONS = ["WALLET_MISSING", "WALLET_READ_FAILED", "WALLET_IDENTITY_UNVERIFIED", "USDT_BALANCE_UNVERIFIED", "NEX_BALANCE_UNVERIFIED", "SOURCE_OBSERVATION_UNVERIFIED", "WITHDRAWAL_READ_FAILED", "UNKNOWN_WITHDRAWAL_STATUS", "WITHDRAWAL_PRINCIPAL_UNVERIFIED", "WITHDRAWAL_SETTLEMENT_UNVERIFIED", "WITHDRAWAL_TIME_UNVERIFIED"] as const;
const KINDS = ["DEPOSIT", "DEVICE_PURCHASE", "DEVICE_PURCHASE_REFUND"] as const;
const PARAMETERS = ["view", "category", "firstState", "filter", "keyword", "basis", "from", "to", "businessZone", "groupId", "agentId", "currency", "sortKey", "direction", "pageNum", "pageSize", "expectedVersion"];

export type SupportAnalyticsView = typeof VIEWS[number];
export type SupportAnalyticsQuery = {
  view: SupportAnalyticsView;
  category?: typeof CATEGORIES[number]; firstState?: typeof FIRST[number]; filter?: typeof FILTERS[number];
  keyword?: string; basis?: typeof BASES[number]; from?: string; to?: string; businessZone?: "Asia/Shanghai";
  groupId?: number | string; agentId?: number | string; currency?: typeof CURRENCIES[number];
  sortKey?: typeof SORTS[number]; direction?: "ASC" | "DESC"; pageNum?: number; pageSize?: number;
  expectedVersion?: string; signal?: AbortSignal;
};

function malformed(field: string): never { throw new Error(`SUPPORT_CONTRACT_MALFORMED:analytics.${field}`); }
function object(value: unknown, keys: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) malformed("object");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !keys.split(" ").includes(key))) malformed("unexpectedField");
  return row;
}
function enumeration<const T extends readonly string[]>(value: unknown, allowed: T): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) malformed("enum");
  return value as T[number];
}
function text(value: unknown): string { if (typeof value !== "string") malformed("string"); return value; }
function nullableText(value: unknown): string | null { return value === null ? null : text(value); }
function boolean(value: unknown): boolean { if (typeof value !== "boolean") malformed("boolean"); return value; }
function integer(value: unknown, min = 0): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) malformed("integer"); return value; }
function nullableInteger(value: unknown): number | null { return value === null ? null : integer(value); }
function id(value: unknown): string {
  if (typeof value === "number") return String(integer(value, 1));
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value) || BigInt(value) > BigInt("9223372036854775807")) malformed("id");
  return value;
}
function nullableId(value: unknown): string | null { return value === null ? null : id(value); }
function decimal(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) malformed("decimal");
  return value;
}
function instant(value: unknown): string {
  const result = text(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(result)) malformed("instant");
  const millis = parseBusinessTime(result);
  if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 19) !== result.slice(0, 19)) malformed("instant");
  return result;
}
function nullableInstant(value: unknown): string | null { return value === null ? null : instant(value); }
function array<T>(value: unknown, parse: (entry: unknown) => T): T[] { if (!Array.isArray(value)) malformed("array"); return value.map(parse); }
function unique<T>(rows: T[], key: (row: T) => string): T[] { if (new Set(rows.map(key)).size !== rows.length) malformed("duplicate"); return rows; }
function count(value: unknown) {
  const r = object(value, "observed confirmed status");
  const result = { observed: nullableInteger(r.observed), confirmed: nullableInteger(r.confirmed), status: enumeration(r.status, STATUS) };
  if (["UNKNOWN", "FAILED", "UNAVAILABLE"].includes(result.status) && result.confirmed !== null) malformed("countCoverage");
  return result;
}
function money(value: unknown) {
  const r = object(value, "observed confirmed observedEvents confirmedEvents observedCustomers status");
  const result = { observed: decimal(r.observed), confirmed: decimal(r.confirmed), observedEvents: nullableInteger(r.observedEvents), confirmedEvents: nullableInteger(r.confirmedEvents), observedCustomers: nullableInteger(r.observedCustomers), status: enumeration(r.status, STATUS) };
  if (["UNKNOWN", "FAILED", "UNAVAILABLE"].includes(result.status) && (result.confirmed !== null || result.confirmedEvents !== null)) malformed("moneyCoverage");
  return result;
}
function customerMoney(value: unknown) {
  const r = object(value, "currency deposits purchases");
  return { currency: enumeration(r.currency, CURRENCIES), deposits: money(r.deposits), purchases: money(r.purchases) };
}
function devices(value: unknown) {
  const r = object(value, "held unknownHolding status partitions");
  return { held: count(r.held), unknownHolding: count(r.unknownHolding), status: enumeration(r.status, STATUS), partitions: array(r.partitions, value => {
    const p = object(value, "dimension value devices");
    const dimension = enumeration(p.dimension, ["CONNECTION", "ACQUISITION", "ENVIRONMENT"]);
    const v = dimension === "CONNECTION" ? enumeration(p.value, ["ONLINE", "OFFLINE", "UNKNOWN", "NOT_APPLICABLE"]) : dimension === "ACQUISITION" ? enumeration(p.value, ["PAID_PURCHASE", "UNKNOWN"]) : enumeration(p.value, ["UNKNOWN"]);
    return { dimension, value: v, devices: count(p.devices) };
  }) };
}
function current(value: unknown) {
  const r = object(value, "lifetimeBasis status ownLifetime firstConfirmed firstNone firstUnknown devices activity");
  const a = object(r.activity, "active inactive unknown status window");
  const w = object(a.window, "days from through status");
  return { lifetimeBasis: enumeration(r.lifetimeBasis, ["CURRENT_CUSTOMER_HISTORY"]), status: enumeration(r.status, STATUS), ownLifetime: unique(array(r.ownLifetime, customerMoney), x => x.currency), firstConfirmed: count(r.firstConfirmed), firstNone: count(r.firstNone), firstUnknown: count(r.firstUnknown), devices: devices(r.devices), activity: {
    active: count(a.active), inactive: count(a.inactive), unknown: count(a.unknown), status: enumeration(a.status, STATUS), window: { days: w.days === null ? null : integer(w.days, 1), from: nullableInstant(w.from), through: nullableInstant(w.through), status: enumeration(w.status, STATUS) },
  } };
}
function personnel(value: unknown) {
  const r = object(value, "status serviceAccounts groupMembers supervisors people groups partitions");
  return { status: enumeration(r.status, STATUS), serviceAccounts: count(r.serviceAccounts), groupMembers: count(r.groupMembers), supervisors: count(r.supervisors), people: count(r.people), groups: count(r.groups), partitions: array(r.partitions, value => {
    const p = object(value, "dimension value accounts");
    const dimension = enumeration(p.dimension, ["SERVICE_ACCOUNT", "SUPERVISOR_ACCOUNT", "RECEPTION", "GROUP_MEMBER_ACCOUNT", "SERVICE_QUALIFICATION", "SUPERVISOR_QUALIFICATION", "MEMBERSHIP", "GROUP", "HANDOVER"]);
    const state = dimension === "HANDOVER" ? enumeration(p.value, ["REQUIRED"]) : dimension === "GROUP" ? enumeration(p.value, ["ENABLED", "DISABLED", "ARCHIVED"]) : dimension === "MEMBERSHIP" ? enumeration(p.value, ["GROUPED", "UNGROUPED", "UNKNOWN"]) : dimension.endsWith("QUALIFICATION") ? enumeration(p.value, ["ENABLED", "DISABLED", "REMOVED", "UNKNOWN"]) : enumeration(p.value, ["ENABLED", "DISABLED", "UNKNOWN"]);
    return { dimension, value: state, accounts: count(p.accounts) };
  }) };
}
function financial(value: unknown) {
  const r = object(value, "status firstCandidates currencies firstSources");
  return { status: enumeration(r.status, STATUS), firstCandidates: count(r.firstCandidates), currencies: unique(array(r.currencies, value => {
    const p = object(value, "currency deposits purchases purchaseRefunds net");
    return { currency: enumeration(p.currency, CURRENCIES), deposits: money(p.deposits), purchases: money(p.purchases), purchaseRefunds: money(p.purchaseRefunds), net: money(p.net) };
  }), x => x.currency), firstSources: unique(array(r.firstSources, customerMoney), x => x.currency) };
}
function scopeSummary(value: unknown) {
  const r = object(value, "mode total bound pending anomaly status current financial restrictedSummary personnel groups");
  const restricted = object(r.restrictedSummary, "customers firstCandidates");
  return { mode: enumeration(r.mode, ["PERSONAL", "MANAGED", "ALL"]), total: nullableInteger(r.total), bound: nullableInteger(r.bound), pending: nullableInteger(r.pending), anomaly: nullableInteger(r.anomaly), status: enumeration(r.status, STATUS), current: current(r.current), financial: financial(r.financial), restrictedSummary: { customers: count(restricted.customers), firstCandidates: count(restricted.firstCandidates) }, personnel: personnel(r.personnel), groups: unique(array(r.groups, value => {
    const p = object(value, "groupId name total current period personnel");
    return { groupId: id(p.groupId), name: nullableText(p.name), total: nullableInteger(p.total), current: current(p.current), period: financial(p.period), personnel: personnel(p.personnel) };
  }), x => x.groupId) };
}
function observedAmount(value: unknown) {
  const r = object(value, "observedAmount confirmedAmount");
  if (r.confirmedAmount !== null) malformed("withdrawalCoverage");
  return { observedAmount: decimal(r.observedAmount), confirmedAmount: null };
}
function funds(value: unknown) {
  const r = object(value, "scope customerCount balanceStatus withdrawalStatus balances sourceObservationStatus walletReadStatus walletReadReasons withdrawalReadStatus withdrawalReadReasons withdrawalReadScope historicalEnvironmentStatus eventOwnershipStatus withdrawals");
  const balanceStatus = enumeration(r.balanceStatus, FUND_STATUS), withdrawalStatus = enumeration(r.withdrawalStatus, FUND_STATUS);
  if (balanceStatus === "UNAVAILABLE" || withdrawalStatus === "UNAVAILABLE") {
    if (balanceStatus !== "UNAVAILABLE" || withdrawalStatus !== "UNAVAILABLE" || Object.keys(r).length !== 2) malformed("fundsUnavailable");
    return { balanceStatus, withdrawalStatus };
  }
  const balances = unique(array(r.balances, value => {
    const p = object(value, "currency observedAmount confirmedAmount");
    const observed = decimal(p.observedAmount), confirmed = decimal(p.confirmedAmount);
    if (balanceStatus !== "READY" && confirmed !== null) malformed("balanceCoverage");
    return { currency: enumeration(p.currency, CURRENCIES), observedAmount: observed, confirmedAmount: confirmed };
  }), x => x.currency);
  if (balances.length !== 2) malformed("balanceCurrencies");
  return { balanceStatus, withdrawalStatus,
    scope: enumeration(r.scope, ["SELECTED_CURRENT_CUSTOMERS"]), customerCount: integer(r.customerCount), balances,
    sourceObservationStatus: enumeration(r.sourceObservationStatus, READS), walletReadStatus: enumeration(r.walletReadStatus, FUND_READS), walletReadReasons: array(r.walletReadReasons, x => enumeration(x, FUND_REASONS)), withdrawalReadStatus: enumeration(r.withdrawalReadStatus, FUND_READS), withdrawalReadReasons: array(r.withdrawalReadReasons, x => enumeration(x, FUND_REASONS)), withdrawalReadScope: enumeration(r.withdrawalReadScope, ["CURRENT_CUSTOMER_RAW_ROWS"]), historicalEnvironmentStatus: enumeration(r.historicalEnvironmentStatus, ["UNKNOWN"]), eventOwnershipStatus: enumeration(r.eventOwnershipStatus, ["UNKNOWN"]), withdrawals: unique(array(r.withdrawals, value => {
      const p = object(value, "currency successPrincipal successActualFee successNet processingPrincipal");
      return { currency: enumeration(p.currency, CURRENCIES), successPrincipal: observedAmount(p.successPrincipal), successActualFee: observedAmount(p.successActualFee), successNet: observedAmount(p.successNet), processingPrincipal: observedAmount(p.processingPrincipal) };
    }), x => x.currency),
  };
}
function selectedFunds(value: unknown) {
  const r = object(value, "scope customerCount balanceStatus withdrawalStatus balances sourceObservationStatus walletReadStatus walletReadReasons withdrawalReadStatus withdrawalReadReasons withdrawalReadScope historicalEnvironmentStatus eventOwnershipStatus withdrawals groups");
  const { groups, ...summary } = r;
  return { ...funds(summary), groups: unique(array(groups, value => { const g = object(value, "groupId funds"); return { groupId: id(g.groupId), funds: funds(g.funds) }; }), x => x.groupId) };
}
function avatar(value: unknown) {
  if (value === null) return null;
  const r = object(value, "assetId version");
  const assetId = text(r.assetId);
  if (!/^[a-f0-9-]{36}$/.test(assetId)) malformed("avatar");
  return { assetId, version: integer(r.version) };
}
function customer(value: unknown) {
  const r = object(value, "customerId customerNo nickname avatar level customTags systemTags systemTagsStatus profileRef registeredAt assignedAt category placement handoverRequired owner first lifetime lifetimeStatus invitations devices activity task funds");
  const customerId = id(r.customerId), profileRef = text(r.profileRef), avatarRef = nullableText(r.avatar);
  if (profileRef !== `/api/admin/content/support-workbench/customers/${customerId}` || avatarRef !== null && avatarRef !== `${profileRef}/avatar`) malformed("profileRef");
  const o = object(r.owner, "agentId groupId agentName advisorAvatar advisorAvatarRef");
  const agentId = nullableId(o.agentId), advisorAvatarRef = nullableText(o.advisorAvatarRef);
  if (advisorAvatarRef !== null && advisorAvatarRef !== `/api/admin/content/support-agents/${agentId}/avatar?customerId=${customerId}`) malformed("advisorAvatarRef");
  const f = object(r.first, "state status kind currency amount succeededAt");
  const i = object(r.invitations, "direct descendants status deposits");
  const a = object(r.activity, "state status lastEffectiveAt");
  const t = object(r.task, "status enabled due waitingReply firstContact nextDueAt waitingSinceAt");
  const task = t.status === "UNAVAILABLE" ? (Object.keys(t).length === 1 ? { status: "UNAVAILABLE" as const } : malformed("taskUnavailable")) : { status: enumeration(t.status, READS), enabled: t.enabled === null ? null : boolean(t.enabled), due: t.due === null ? null : boolean(t.due), waitingReply: t.waitingReply === null ? null : boolean(t.waitingReply), firstContact: t.firstContact === null ? null : boolean(t.firstContact), nextDueAt: nullableInstant(t.nextDueAt), waitingSinceAt: nullableInstant(t.waitingSinceAt) };
  return { customerId, customerNo: nullableText(r.customerNo), nickname: nullableText(r.nickname), avatar: avatarRef, level: nullableText(r.level), customTags: array(r.customTags, text), systemTags: array(r.systemTags, text), systemTagsStatus: enumeration(r.systemTagsStatus, ["PARTIAL"]), profileRef, registeredAt: nullableInstant(r.registeredAt), assignedAt: nullableInstant(r.assignedAt), category: enumeration(r.category, ["BOUND", "PENDING", "ANOMALY"]), placement: enumeration(r.placement, ["GROUPED", "UNGROUPED", "GROUP_QUEUE", "GLOBAL_QUEUE", "UNKNOWN"]), handoverRequired: boolean(r.handoverRequired), owner: { agentId, groupId: nullableId(o.groupId), agentName: nullableText(o.agentName), advisorAvatar: avatar(o.advisorAvatar), advisorAvatarRef }, first: { state: enumeration(f.state, ["CONFIRMED", "NONE", "UNKNOWN"]), status: enumeration(f.status, STATUS), kind: f.kind === null ? null : enumeration(f.kind, KINDS), currency: f.currency === null ? null : enumeration(f.currency, CURRENCIES), amount: decimal(f.amount), succeededAt: nullableInstant(f.succeededAt) }, lifetime: unique(array(r.lifetime, customerMoney), x => x.currency), lifetimeStatus: enumeration(r.lifetimeStatus, STATUS), invitations: { direct: count(i.direct), descendants: count(i.descendants), status: enumeration(i.status, STATUS), deposits: unique(array(i.deposits, value => { const p = object(value, "currency deposits"); return { currency: enumeration(p.currency, CURRENCIES), deposits: money(p.deposits) }; }), x => x.currency) }, devices: devices(r.devices), activity: { state: enumeration(a.state, ["ACTIVE", "INACTIVE", "UNKNOWN"]), status: enumeration(a.status, STATUS), lastEffectiveAt: nullableInstant(a.lastEffectiveAt) }, task, funds: funds(r.funds) };
}
function agent(value: unknown) {
  const r = object(value, "accountId displayName avatar avatarRef account current funds");
  const a = object(r.account, "serviceAccount supervisorAccount serviceCategoryStatus supervisorCategoryStatus accountState serviceQualification supervisorQualification receptionEligibility memberState groupId handoverRequired status");
  const accountId = id(r.accountId), avatarRef = nullableText(r.avatarRef);
  if (avatarRef !== null && avatarRef !== `/api/admin/content/support-agents/${accountId}/avatar`) malformed("agentAvatarRef");
  return { accountId, displayName: nullableText(r.displayName), avatar: avatar(r.avatar), avatarRef, account: { serviceAccount: boolean(a.serviceAccount), supervisorAccount: boolean(a.supervisorAccount), serviceCategoryStatus: enumeration(a.serviceCategoryStatus, STATUS), supervisorCategoryStatus: enumeration(a.supervisorCategoryStatus, STATUS), accountState: enumeration(a.accountState, ["ENABLED", "DISABLED", "UNKNOWN"]), serviceQualification: enumeration(a.serviceQualification, ["ENABLED", "DISABLED", "REMOVED", "UNKNOWN"]), supervisorQualification: enumeration(a.supervisorQualification, ["ENABLED", "DISABLED", "REMOVED", "UNKNOWN"]), receptionEligibility: enumeration(a.receptionEligibility, ["ENABLED", "DISABLED", "UNKNOWN"]), memberState: enumeration(a.memberState, ["GROUPED", "UNGROUPED", "UNKNOWN"]), groupId: nullableId(a.groupId), handoverRequired: boolean(a.handoverRequired), status: enumeration(a.status, STATUS) }, current: current(r.current), funds: funds(r.funds) };
}
function financeRow(value: unknown) {
  const r = object(value, "customerId customerNo nickname kind currency amount succeededAt orderNo historyStatus");
  return { customerId: id(r.customerId), customerNo: nullableText(r.customerNo), nickname: nullableText(r.nickname), kind: enumeration(r.kind, KINDS), currency: enumeration(r.currency, CURRENCIES), amount: decimal(r.amount), succeededAt: nullableInstant(r.succeededAt), orderNo: nullableText(r.orderNo), historyStatus: enumeration(r.historyStatus, ["READY", "UNKNOWN"]) };
}
function deviceRow(value: unknown) {
  const r = object(value, "deviceId customerId deviceType hashrate holdingStatus connectionStatus acquisition activatedAt deactivatedAt");
  return { deviceId: id(r.deviceId), customerId: id(r.customerId), deviceType: nullableText(r.deviceType), hashrate: decimal(r.hashrate), holdingStatus: enumeration(r.holdingStatus, ["AVAILABLE", "UNKNOWN"]), connectionStatus: enumeration(r.connectionStatus, ["ONLINE", "OFFLINE", "UNKNOWN", "NOT_APPLICABLE"]), acquisition: enumeration(r.acquisition, ["PAID_PURCHASE", "UNKNOWN"]), activatedAt: nullableInstant(r.activatedAt), deactivatedAt: nullableInstant(r.deactivatedAt) };
}
export type SupportAnalyticsCustomer = ReturnType<typeof customer>;
export type SupportAnalyticsAgent = ReturnType<typeof agent>;
export type SupportAnalyticsFinanceRow = ReturnType<typeof financeRow>;
export type SupportAnalyticsDeviceRow = ReturnType<typeof deviceRow>;
type Metadata = ReturnType<typeof metadata>;
export type SupportAnalyticsResponse = Metadata & (
  { view: "OVERVIEW" | "CUSTOMERS" | "ACTIVITY"; records: SupportAnalyticsCustomer[] } |
  { view: "AGENTS"; records: SupportAnalyticsAgent[] } |
  { view: "FINANCE"; records: SupportAnalyticsFinanceRow[] } |
  { view: "DEVICES"; records: SupportAnalyticsDeviceRow[] }
);
function metadata(r: Record<string, unknown>) {
  const versionState = enumeration(r.versionState, ["READY", "UNKNOWN"]), queryVersion = nullableText(r.queryVersion), total = nullableInteger(r.total), observedTotal = integer(r.observedTotal), canContinue = boolean(r.canContinue);
  const pageNum = integer(r.pageNum, 1), pageSize = integer(r.pageSize, 1), recordsStatus = enumeration(r.recordsStatus, [...STATUS, "READY"]);
  if (pageSize > 100 || (versionState === "READY" ? queryVersion === null || !/^saq-v1:[0-9a-f]{64}$/.test(queryVersion) : queryVersion !== null || total !== null || canContinue || pageNum > 1)) malformed("version");
  if (total !== null && total !== observedTotal) malformed("total");
  return { basis: enumeration(r.basis, BASES), businessZone: enumeration(r.businessZone, ["Asia/Shanghai"]), asOf: instant(r.asOf), pageNum, pageSize, total, observedTotal, versionState, queryVersion, canContinue, recordsStatus, selectedCustomerCount: integer(r.selectedCustomerCount), selectedCurrent: current(r.selectedCurrent), scopeSummary: scopeSummary(r.scopeSummary), funds: selectedFunds(r.funds) };
}
export function parseSupportAnalyticsResponse(value: unknown, expected: { view: SupportAnalyticsView; basis: typeof BASES[number]; pageNum: number; pageSize: number; expectedVersion?: string }): SupportAnalyticsResponse {
  const r = object(value, "view basis businessZone asOf pageNum pageSize total observedTotal versionState queryVersion canContinue recordsStatus selectedCustomerCount selectedCurrent scopeSummary funds records");
  const view = enumeration(r.view, VIEWS), meta = metadata(r);
  if (view !== expected.view || meta.basis !== expected.basis || meta.pageNum !== expected.pageNum || meta.pageSize !== expected.pageSize) malformed("queryMismatch");
  if (expected.expectedVersion !== undefined && meta.queryVersion !== expected.expectedVersion) malformed("versionMismatch");
  if (meta.recordsStatus !== (view === "AGENTS" ? meta.scopeSummary.personnel.status : meta.versionState) || (meta.total === null) !== (meta.versionState === "UNKNOWN" || view === "AGENTS" && meta.scopeSummary.personnel.status !== "AVAILABLE")) malformed("recordsCoverage");
  const rows = array(r.records, x => x);
  const remaining = BigInt(meta.observedTotal) - BigInt(meta.pageNum - 1) * BigInt(meta.pageSize);
  const expectedLength = remaining <= BigInt(0) ? 0 : Number(remaining < BigInt(meta.pageSize) ? remaining : BigInt(meta.pageSize));
  if (rows.length !== expectedLength || meta.canContinue !== (meta.versionState === "READY" && remaining > BigInt(rows.length))) malformed("pagination");
  switch (view) {
    case "AGENTS": return { ...meta, view, records: unique(rows.map(agent), x => x.accountId) };
    case "FINANCE": return { ...meta, view, records: rows.map(financeRow) };
    case "DEVICES": return { ...meta, view, records: unique(rows.map(deviceRow), x => x.deviceId) };
    default: return { ...meta, view, records: unique(rows.map(customer), x => x.customerId) };
  }
}
function micros(value: string): bigint { return BigInt(parseBusinessTime(value)) * BigInt(1000) + BigInt((value.split(".")[1]?.slice(0, -1) ?? "").padEnd(6, "0").slice(3)); }
function query(options: SupportAnalyticsQuery) {
  object(options, `${PARAMETERS.join(" ")} signal`);
  if (Object.values(options).some(value => value === null)) malformed("queryNull");
  const view = enumeration(options.view, VIEWS), basis = enumeration(options.basis ?? "CURRENT_CUSTOMER_HISTORY", BASES), category = enumeration(options.category ?? "ALL", CATEGORIES), firstState = enumeration(options.firstState ?? "ALL", FIRST), filter = enumeration(options.filter ?? "ALL", FILTERS);
  const defaultSort = category === "PENDING" ? "POOL_ENTERED_AT" : firstState === "CONFIRMED" ? "FIRST_SUCCEEDED_AT" : firstState === "NONE" ? "REGISTERED_AT" : filter === "WAITING_REPLY" ? "WAITING_SINCE_AT" : filter === "FIRST_CONTACT" ? "ASSIGNED_AT" : filter === "DUE" ? "NEXT_DUE_AT" : filter === "STOPPED" ? "STATE_CHANGED_AT" : "LAST_ACTIVE_AT";
  const sortKey = enumeration(options.sortKey ?? (view === "AGENTS" ? "BOUND_CUSTOMER_COUNT" : view === "FINANCE" ? "SUCCEEDED_AT" : defaultSort), SORTS);
  const direction = enumeration(options.direction ?? (category === "PENDING" || firstState === "NONE" || ["WAITING_REPLY", "FIRST_CONTACT", "DUE", "DORMANT"].includes(filter) ? "ASC" : "DESC"), ["ASC", "DESC"]);
  const allowed = view === "AGENTS" ? ["BOUND_CUSTOMER_COUNT", "ACTIVE_CUSTOMER_COUNT", "FIRST_CONFIRMED_CUSTOMER_COUNT", "DEVICE_COUNT", "PERSONAL_DEPOSIT"] : view === "FINANCE" ? ["SUCCEEDED_AT", "AMOUNT"] : view === "DEVICES" ? ["HASHRATE", "LAST_ACTIVE_AT", "REGISTERED_AT", "DEVICE_COUNT"] : SORTS.filter(x => !["BOUND_CUSTOMER_COUNT", "ACTIVE_CUSTOMER_COUNT", "FIRST_CONFIRMED_CUSTOMER_COUNT", "HASHRATE", "SUCCEEDED_AT", "AMOUNT"].includes(x));
  if (!allowed.includes(sortKey) || sortKey === "NEXT_DUE_AT" && filter !== "DUE" || sortKey === "WAITING_SINCE_AT" && filter !== "WAITING_REPLY" || sortKey === "STATE_CHANGED_AT" && filter !== "STOPPED" || sortKey === "POOL_ENTERED_AT" && category !== "PENDING" || basis === "CURRENT_ASSET" && (view === "FINANCE" || firstState !== "ALL" || ["PERSONAL_DEPOSIT", "TEAM_DEPOSIT", "FIRST_SUCCEEDED_AT"].includes(sortKey))) malformed("querySort");
  const currency = options.currency === undefined ? undefined : enumeration(options.currency, CURRENCIES);
  if (["PERSONAL_DEPOSIT", "TEAM_DEPOSIT", "AMOUNT"].includes(sortKey) && currency === undefined) malformed("queryCurrency");
  const pageNum = integer(options.pageNum ?? 1, 1), pageSize = integer(options.pageSize ?? 20, 1);
  if (pageSize > 100 || BigInt(pageNum) * BigInt(pageSize) > BigInt("9223372036854775807")) malformed("queryPage");
  if (options.expectedVersion !== undefined && !/^saq-v1:[0-9a-f]{64}$/.test(text(options.expectedVersion)) || pageNum > 1 && options.expectedVersion === undefined) malformed("queryVersion");
  if (options.businessZone !== undefined && options.businessZone !== "Asia/Shanghai") malformed("queryZone");
  let from: string | undefined, to: string | undefined;
  if (basis === "PERIOD_EVENT") {
    from = instant(options.from); to = instant(options.to);
    const start = micros(from), end = micros(to);
    if ([from, to].some(x => (x.split(".")[1]?.slice(0, -1).length ?? 0) > 6) || start < micros("1000-01-01T00:00:00Z") || end > micros("9999-12-31T00:00:00Z") || start >= end || (end - start) / BigInt("86400000000") > BigInt(3660)) malformed("queryPeriod");
  } else if (options.from !== undefined || options.to !== undefined) malformed("queryPeriod");
  const requestId = (value: unknown) => { const v = id(value); if (BigInt(v) > BigInt(Number.MAX_SAFE_INTEGER)) malformed("queryId"); return v; };
  const keyword = options.keyword === undefined ? undefined : text(options.keyword);
  if (keyword !== undefined && keyword.length > 200) malformed("queryKeyword");
  const parameters: Record<string, string | number | undefined> = { view, category, firstState, filter, keyword: keyword?.trim() || undefined, basis, from, to, businessZone: "Asia/Shanghai", groupId: options.groupId === undefined ? undefined : requestId(options.groupId), agentId: options.agentId === undefined ? undefined : requestId(options.agentId), currency, sortKey, direction, pageNum, pageSize, expectedVersion: options.expectedVersion };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(parameters)) if (value !== undefined) params.set(key, String(value));
  return { params, view, basis, pageNum, pageSize, expectedVersion: options.expectedVersion };
}
export const supportAnalyticsClient = {
  query: (options: SupportAnalyticsQuery): Promise<SupportAnalyticsResponse> => {
    const expected = query(options);
    return supportRequest(`/support-workbench/analytics?${expected.params}`, value => parseSupportAnalyticsResponse(value, expected), { signal: options.signal });
  },
};
