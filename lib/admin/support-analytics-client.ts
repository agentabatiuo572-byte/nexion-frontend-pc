import { PERFORMANCE_VERSION, legacyPerformanceSelectorError, performanceDecimal, performanceEvents, performanceGeneration, performanceMeasured, performanceInteger, performanceObject, performancePeriod, performanceText, performanceWindow, privatePerformance, samePerformanceWindow, type PerformanceWindow } from "./support-performance-contract";
import { SupportClientError, supportRequest } from "./m-support-client.ts";
import { parseBusinessTime } from "./business-time.ts";
import { parseInvitationCountReason, parseInvitationInviter } from "./invitation-read-contract.ts";
import { supportContractMalformed } from "./m-support-read-contract.ts";

const VIEWS = ["OVERVIEW", "AGENTS", "CUSTOMERS", "FINANCE", "DEVICES", "ACTIVITY"] as const;
const DETAIL_VIEWS = ["NET_CONTRIBUTIONS", "FIRST_DEPOSITS", "FIRST_PURCHASES"] as const;
export type SupportAnalyticsDetailView = typeof DETAIL_VIEWS[number];
const BASES = ["CURRENT_CUSTOMER_HISTORY", "PERIOD_EVENT", "CURRENT_ASSET"] as const;
const CATEGORIES = ["ALL", "BOUND", "PENDING", "ANOMALY"] as const;
const FIRST = ["ALL", "CONFIRMED", "NONE", "UNKNOWN"] as const;
const FILTERS = ["ALL", "WINDOW_ACTIVE", "ACTIVE", "DORMANT", "UNKNOWN", "DUE", "WAITING_REPLY", "FIRST_CONTACT", "STOPPED", "TODO"] as const;
const SORTS = ["REGISTERED_AT", "ASSIGNED_AT", "LAST_ACTIVE_AT", "FIRST_SUCCEEDED_AT", "DIRECT_INVITATION_COUNT", "TEAM_CUSTOMER_COUNT", "PERSONAL_DEPOSIT", "TEAM_DEPOSIT", "NET_CONTRIBUTION", "BOUND_CUSTOMER_COUNT", "ACTIVE_CUSTOMER_COUNT", "FIRST_CONFIRMED_CUSTOMER_COUNT", "DEVICE_COUNT", "HASHRATE", "NEXT_DUE_AT", "WAITING_SINCE_AT", "STATE_CHANGED_AT", "POOL_ENTERED_AT", "SUCCEEDED_AT", "AMOUNT", "PERFORMANCE_AMOUNT"] as const;
const STATUS = ["AVAILABLE", "PARTIAL", "UNKNOWN", "FAILED", "UNAVAILABLE"] as const;
const CURRENCIES = ["USDT", "UVT"] as const;
const READS = ["COMPLETE", "UNKNOWN", "FAILED", "NOT_REQUESTED"] as const;
const FUND_READS = ["READY", "PARTIAL", "UNKNOWN", "FAILED"] as const;
const FUND_STATUS = ["READY", "PARTIAL", "UNKNOWN", "UNAVAILABLE"] as const;
const FUND_REASONS = ["WALLET_MISSING", "WALLET_READ_FAILED", "WALLET_IDENTITY_UNVERIFIED", "USDT_BALANCE_UNVERIFIED", "NEX_BALANCE_UNVERIFIED", "SOURCE_OBSERVATION_UNVERIFIED", "WITHDRAWAL_READ_FAILED", "UNKNOWN_WITHDRAWAL_STATUS", "WITHDRAWAL_PRINCIPAL_UNVERIFIED", "WITHDRAWAL_SETTLEMENT_UNVERIFIED", "WITHDRAWAL_TIME_UNVERIFIED"] as const;
const KINDS = ["DEPOSIT", "DEVICE_PURCHASE", "DEVICE_PURCHASE_REFUND", "CONSUMPTION"] as const;
const FIRST_KINDS = ["DEPOSIT", "DEVICE_PURCHASE"] as const;
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

function malformed(field: string): never { return supportContractMalformed(`analytics.${field}`); }
// The response allowlists include B80 compatibility keys by name. The legacy projections omit their values.
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
function invitationCount(value: unknown) {
  const result = count(value);
  if (result.status !== "AVAILABLE" && result.confirmed !== null) malformed("invitationCountCoverage");
  return result;
}
function money(value: unknown) {
  const r = object(value, "observed confirmed observedEvents confirmedEvents observedCustomers status");
  const result = { observed: decimal(r.observed), confirmed: decimal(r.confirmed), observedEvents: nullableInteger(r.observedEvents), confirmedEvents: nullableInteger(r.confirmedEvents), observedCustomers: nullableInteger(r.observedCustomers), status: enumeration(r.status, STATUS) };
  if (["UNKNOWN", "FAILED", "UNAVAILABLE"].includes(result.status) && (result.confirmed !== null || result.confirmedEvents !== null)) malformed("moneyCoverage");
  return result;
}
function customerMoney(value: unknown) {
  const r = object(value, "currency deposits purchases net");
  return { currency: enumeration(r.currency, CURRENCIES), deposits: money(r.deposits), purchases: money(r.purchases), net: r.net === undefined ? netMoney({ observed: null, confirmed: null, observedEvents: null, confirmedEvents: null, observedCustomers: null, status: "UNKNOWN" }) : netMoney(r.net) };
}
function netMoney(value: unknown) {
  const result = money(value);
  if (result.status === "AVAILABLE" ? result.confirmed === null || result.observed !== result.confirmed : result.confirmed !== null || result.observed !== null) malformed("netCoverage");
  return result;
}
function firstSourceMoney(value: unknown) {
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
  const r = object(value, "lifetimeBasis status ownLifetime firstConfirmed firstNone firstUnknown devices activity performance");
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
  const r = object(value, "status firstCandidates currencies firstSources performance");
  return { status: enumeration(r.status, STATUS), firstCandidates: count(r.firstCandidates), currencies: unique(array(r.currencies, value => {
    const p = object(value, "currency deposits purchases purchaseRefunds net");
    return { currency: enumeration(p.currency, CURRENCIES), deposits: money(p.deposits), purchases: money(p.purchases), purchaseRefunds: money(p.purchaseRefunds), net: netMoney(p.net) };
  }), x => x.currency), firstSources: unique(array(r.firstSources, firstSourceMoney), x => x.currency) };
}
function scopeSummary(value: unknown) {
  const r = object(value, "mode total bound pending anomaly status current financial restrictedSummary personnel groups performanceAttribution");
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
function invitationCounts(row: Record<string, unknown>, isolateCountFailure: boolean) {
  try {
    return {
      direct: invitationCount(row.direct),
      descendants: invitationCount(row.descendants),
      ...(row.withinRewardRange === undefined ? {} : { withinRewardRange: invitationCount(row.withinRewardRange) }),
      ...(row.beyondRewardRange === undefined ? {} : { beyondRewardRange: invitationCount(row.beyondRewardRange) }),
    };
  } catch (error) {
    if (!isolateCountFailure) throw error;
    const failed = { observed: null, confirmed: null, status: "FAILED" as const };
    return { direct: failed, descendants: failed, withinRewardRange: failed, beyondRewardRange: failed };
  }
}

function invitations(value: unknown, isolateCountFailure: boolean) {
  const r = object(value, "direct descendants status deposits withinRewardRange beyondRewardRange reasons");
  return {
    ...invitationCounts(r, isolateCountFailure),
    status: enumeration(r.status, STATUS),
    deposits: unique(array(r.deposits, value => {
      const p = object(value, "currency deposits");
      return { currency: enumeration(p.currency, CURRENCIES), deposits: money(p.deposits) };
    }), x => x.currency),
    ...(r.reasons === undefined ? {} : { reasons: array(r.reasons, reason => parseInvitationCountReason(text(reason))) }),
  };
}
export function parseSupportCustomerStatistics(value: unknown, source: "analytics" | "profile" = "analytics") {
  const fromProfile = source === "profile";
  const r = object(value, "first lifetime lifetimeStatus invitations activity" + (fromProfile ? " performance firstPaymentCoverage" : ""));
  const f = object(r.first, "state status kind currency amount succeededAt channel");
  const a = object(r.activity, "state status lastEffectiveAt");
  return { first: { state: enumeration(f.state, ["CONFIRMED", "NONE", "UNKNOWN"]), status: enumeration(f.status, STATUS), kind: f.kind === null ? null : enumeration(f.kind, FIRST_KINDS), currency: f.currency === null ? null : enumeration(f.currency, CURRENCIES), amount: decimal(f.amount), succeededAt: nullableInstant(f.succeededAt) }, lifetime: unique(array(r.lifetime, customerMoney), x => x.currency), lifetimeStatus: enumeration(r.lifetimeStatus, STATUS), invitations: invitations(r.invitations, fromProfile), activity: { state: enumeration(a.state, ["ACTIVE", "INACTIVE", "UNKNOWN"]), status: enumeration(a.status, STATUS), lastEffectiveAt: nullableInstant(a.lastEffectiveAt) } };
}
export type SupportCustomerStatistics = ReturnType<typeof parseSupportCustomerStatistics>;
function customer(value: unknown) {
  const r = object(value, "customerId customerNo nickname avatar level customTags systemTags systemTagsStatus profileRef registeredAt assignedAt category placement handoverRequired owner first lifetime lifetimeStatus invitations devices activity task funds inviter performance");
  const customerId = id(r.customerId), profileRef = text(r.profileRef), avatarRef = nullableText(r.avatar);
  if (profileRef !== `/api/admin/content/support-workbench/customers/${customerId}` || avatarRef !== null && avatarRef !== `${profileRef}/avatar`) malformed("profileRef");
  const o = object(r.owner, "agentId groupId agentName advisorAvatar advisorAvatarRef");
  const agentId = nullableId(o.agentId), advisorAvatarRef = nullableText(o.advisorAvatarRef);
  if (advisorAvatarRef !== null && advisorAvatarRef !== `/api/admin/content/support-agents/${agentId}/avatar?customerId=${customerId}`) malformed("advisorAvatarRef");
  const t = object(r.task, "status enabled due waitingReply firstContact nextDueAt waitingSinceAt");
  const task = t.status === "UNAVAILABLE" ? (Object.keys(t).length === 1 ? { status: "UNAVAILABLE" as const } : malformed("taskUnavailable")) : { status: enumeration(t.status, READS), enabled: t.enabled === null ? null : boolean(t.enabled), due: t.due === null ? null : boolean(t.due), waitingReply: t.waitingReply === null ? null : boolean(t.waitingReply), firstContact: t.firstContact === null ? null : boolean(t.firstContact), nextDueAt: nullableInstant(t.nextDueAt), waitingSinceAt: nullableInstant(t.waitingSinceAt) };
  let inviter;
  if (r.inviter !== undefined) {
    const rawInviter = object(r.inviter, "state userNo nickname reason");
    try {
      inviter = parseInvitationInviter(rawInviter);
    } catch (error) {
      if (error instanceof Error && error.message === "INVITATION_INVITER_INVALID") malformed("customer.inviter");
      throw error;
    }
  }
  return {
    ...(inviter === undefined ? {} : { inviter }),
    customerId, customerNo: nullableText(r.customerNo), nickname: nullableText(r.nickname), avatar: avatarRef, level: nullableText(r.level), customTags: array(r.customTags, text), systemTags: array(r.systemTags, text), systemTagsStatus: enumeration(r.systemTagsStatus, ["PARTIAL"]), profileRef, registeredAt: nullableInstant(r.registeredAt), assignedAt: nullableInstant(r.assignedAt), category: enumeration(r.category, ["BOUND", "PENDING", "ANOMALY"]), placement: enumeration(r.placement, ["GROUPED", "UNGROUPED", "GROUP_QUEUE", "GLOBAL_QUEUE", "UNKNOWN"]), handoverRequired: boolean(r.handoverRequired), owner: { agentId, groupId: nullableId(o.groupId), agentName: nullableText(o.agentName), advisorAvatar: avatar(o.advisorAvatar), advisorAvatarRef }, ...parseSupportCustomerStatistics({ first: r.first, lifetime: r.lifetime, lifetimeStatus: r.lifetimeStatus, invitations: r.invitations, activity: r.activity }), devices: devices(r.devices), task, funds: funds(r.funds),
  };
}
function agent(value: unknown) {
  const r = object(value, "accountId displayName avatar avatarRef account current funds period");
  const a = object(r.account, "serviceAccount supervisorAccount serviceCategoryStatus supervisorCategoryStatus accountState serviceQualification supervisorQualification receptionEligibility memberState groupId handoverRequired status");
  const accountId = id(r.accountId), avatarRef = nullableText(r.avatarRef);
  if (avatarRef !== null && avatarRef !== `/api/admin/content/support-agents/${accountId}/avatar`) malformed("agentAvatarRef");
  return { accountId, displayName: nullableText(r.displayName), avatar: avatar(r.avatar), avatarRef, account: { serviceAccount: boolean(a.serviceAccount), supervisorAccount: boolean(a.supervisorAccount), serviceCategoryStatus: enumeration(a.serviceCategoryStatus, STATUS), supervisorCategoryStatus: enumeration(a.supervisorCategoryStatus, STATUS), accountState: enumeration(a.accountState, ["ENABLED", "DISABLED", "UNKNOWN"]), serviceQualification: enumeration(a.serviceQualification, ["ENABLED", "DISABLED", "REMOVED", "UNKNOWN"]), supervisorQualification: enumeration(a.supervisorQualification, ["ENABLED", "DISABLED", "REMOVED", "UNKNOWN"]), receptionEligibility: enumeration(a.receptionEligibility, ["ENABLED", "DISABLED", "UNKNOWN"]), memberState: enumeration(a.memberState, ["GROUPED", "UNGROUPED", "UNKNOWN"]), groupId: nullableId(a.groupId), handoverRequired: boolean(a.handoverRequired), status: enumeration(a.status, STATUS) }, current: current(r.current), funds: funds(r.funds) };
}
function financeRow(value: unknown) {
  const r = object(value, "customerId customerNo nickname kind currency amount succeededAt orderNo historyStatus");
  return { customerId: id(r.customerId), customerNo: nullableText(r.customerNo), nickname: nullableText(r.nickname), kind: enumeration(r.kind, KINDS), currency: enumeration(r.currency, CURRENCIES), amount: decimal(r.amount), succeededAt: nullableInstant(r.succeededAt), orderNo: nullableText(r.orderNo), historyStatus: enumeration(r.historyStatus, ["READY", "UNKNOWN"]) };
}
function detailRow(value: unknown, view: SupportAnalyticsDetailView) {
  const r = object(value, "id customerId customerNo nickname kind currency amount succeededAt agentId groupId agentDisplayName" + (view === "NET_CONTRIBUTIONS" ? "" : " channel"));
  const amount = decimal(r.amount);
  if (amount === null) malformed("detail.amount");
  return { id: text(r.id), customerId: id(r.customerId), customerNo: nullableText(r.customerNo), nickname: nullableText(r.nickname),
    kind: enumeration(r.kind, ["NET_CONTRIBUTION", "DEPOSIT", "DEVICE_PURCHASE"]), currency: enumeration(r.currency, CURRENCIES),
    amount, succeededAt: instant(r.succeededAt), agentId: nullableId(r.agentId), groupId: nullableId(r.groupId),
    agentDisplayName: r.agentDisplayName === undefined ? null : nullableText(r.agentDisplayName) };
}
function detailSummary(value: unknown) {
  const r = object(value, "currency status observedAmount totalAmount visibleAmount restrictedAmount totalCount visibleCount restrictedCount customerCount visibleCustomerCount restrictedCustomerCount");
  const result = { currency: enumeration(r.currency, CURRENCIES), status: enumeration(r.status, ["AVAILABLE", "PARTIAL"]), observedAmount: decimal(r.observedAmount),
    totalAmount: decimal(r.totalAmount), visibleAmount: decimal(r.visibleAmount), restrictedAmount: decimal(r.restrictedAmount),
    totalCount: integer(r.totalCount), visibleCount: integer(r.visibleCount), restrictedCount: integer(r.restrictedCount), customerCount: integer(r.customerCount), visibleCustomerCount: integer(r.visibleCustomerCount), restrictedCustomerCount: integer(r.restrictedCustomerCount) };
  if (result.totalAmount === null || result.visibleAmount === null || result.restrictedAmount === null || result.visibleCount + result.restrictedCount !== result.totalCount || result.visibleCustomerCount + result.restrictedCustomerCount !== result.customerCount) malformed("detail.coverage");
  const amounts = [result.totalAmount!, result.visibleAmount!, result.restrictedAmount!];
  const places = Math.max(...amounts.map(v => (v.split(".")[1] ?? "").length));
  const units = (v: string) => { const [whole, fraction = ""] = v.split("."); return BigInt(whole + fraction.padEnd(places, "0")); };
  if (units(amounts[1]) + units(amounts[2]) !== units(amounts[0])) malformed("detail.amountCoverage");
  return result;
}
export type SupportAnalyticsDetailResponse = Metadata & { view: SupportAnalyticsDetailView; records: ReturnType<typeof detailRow>[]; detailSummary: ReturnType<typeof detailSummary> };
function measuredFirstSummary(value: unknown) {
  const r = object(value, "currency totalAmount visibleAmount restrictedAmount totalCount visibleCount restrictedCount customerCount visibleCustomerCount restrictedCustomerCount");
  const part = (amount: string, events: string, customers: string) => ({
    amount: performanceMeasured(r[amount], performanceDecimal),
    count: performanceMeasured(r[events], performanceInteger),
    customers: performanceMeasured(r[customers], performanceInteger),
  });
  return { currency: enumeration(r.currency, CURRENCIES),
    total: part("totalAmount", "totalCount", "customerCount"),
    visible: part("visibleAmount", "visibleCount", "visibleCustomerCount"),
    restricted: part("restrictedAmount", "restrictedCount", "restrictedCustomerCount") };
}
type IncompleteFirstDetail = Metadata & {
  view: "FIRST_DEPOSITS" | "FIRST_PURCHASES";
  records: [];
  measuredSummary: ReturnType<typeof measuredFirstSummary>;
};
function parseDetailResponse(value: unknown, expected: ReturnType<typeof query>, currency: string): SupportAnalyticsDetailResponse {
  const r = object(value, "view basis businessZone asOf pageNum pageSize total observedTotal versionState queryVersion canContinue recordsStatus selectedCustomerCount selectedCurrent scopeSummary funds records detailSummary performanceWindow metricVersion generation");
  const view = enumeration(r.view, DETAIL_VIEWS), meta = metadata(r), summary = detailSummary(r.detailSummary);
  if (view !== expected.view || meta.basis !== "PERIOD_EVENT" || meta.pageNum !== expected.pageNum || meta.pageSize !== expected.pageSize || meta.recordsStatus !== meta.versionState || expected.expectedVersion !== undefined && meta.queryVersion !== expected.expectedVersion) malformed("detail.queryMismatch");
  const records = unique(array(r.records, value => detailRow(value, view)), row => row.id);
  if (meta.observedTotal === null) malformed("detail.observedTotal");
  const remaining = Math.max(0, meta.observedTotal - (meta.pageNum - 1) * meta.pageSize);
  const kind = view === "NET_CONTRIBUTIONS" ? "NET_CONTRIBUTION" : view === "FIRST_DEPOSITS" ? "DEPOSIT" : "DEVICE_PURCHASE";
  if (summary.currency !== currency || summary.visibleCount !== meta.observedTotal || meta.total !== null && meta.total !== summary.visibleCount || records.length !== Math.min(remaining, meta.pageSize) || meta.canContinue !== (meta.versionState === "READY" && remaining > records.length) || records.some(row => row.currency !== currency || row.kind !== kind)) malformed("detail.records");
  return { ...meta, view, records, detailSummary: summary };
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
  { view: "OVERVIEW" | "CUSTOMERS" | "ACTIVITY"; records: (SupportAnalyticsCustomer & { performance?: ReturnType<typeof privatePerformance> })[] } |
  { view: "AGENTS"; records: (SupportAnalyticsAgent & { performance?: ReturnType<typeof privatePerformance>; periodPerformance?: ReturnType<typeof privatePerformance> })[] } |
  { view: "FINANCE"; records: SupportAnalyticsFinanceRow[] } |
  { view: "DEVICES"; records: SupportAnalyticsDeviceRow[] }
);
function metadata(r: Record<string, unknown>, versioned = false) {
  const generation = versioned ? performanceGeneration(r) : "LEGACY";
  const source = generation === "READY" && r.performanceWindow != null ? performanceText(r.sourceVersion) : undefined;
  const window = source === undefined ? undefined : performanceWindow(r.performanceWindow);
  if (window && (window.sourceVersion !== source || window.basis !== r.basis || window.asOf !== r.asOf)) malformed("performanceWindow");
  const projection = (value: unknown) => window && value != null ? privatePerformance(value, source) : undefined;
  const scopeRaw = object(r.scopeSummary, "mode total bound pending anomaly status current financial restrictedSummary personnel groups performanceAttribution");
  const firstCoverage = generation !== "LEGACY" && r.firstPaymentCoverage !== undefined ? (() => {
    const coverage = object(r.firstPaymentCoverage, "status reasonCodes");
    return { status: enumeration(coverage.status, ["COMPLETE", "PARTIAL", "UNKNOWN", "FAILED"]), reasons: array(coverage.reasonCodes, text) };
  })() : undefined;
  const performance = source === undefined || !window ? undefined : (() => {
    const financial = object(scopeRaw.financial, "status firstCandidates currencies firstSources performance");
    const currentRaw = object(scopeRaw.current, "lifetimeBasis status ownLifetime firstConfirmed firstNone firstUnknown devices activity performance");
    const groupPerformance = array(scopeRaw.groups, value => {
      const group = object(value, "groupId name total current period personnel");
      const currentRaw = object(group.current, "lifetimeBasis status ownLifetime firstConfirmed firstNone firstUnknown devices activity performance");
      const period = object(group.period, "status firstCandidates currencies firstSources performance");
      return [id(group.groupId), { current: projection(currentRaw.performance), period: projection(period.performance) }] as const;
    });
    const attribution = scopeRaw.performanceAttribution == null ? undefined : object(scopeRaw.performanceAttribution, "unassigned unknown");
    return {
      window, period: financial.performance == null ? undefined : performancePeriod(financial.performance, source),
      current: projection(currentRaw.performance), groups: Object.fromEntries(groupPerformance),
      attribution: attribution && { unassigned: projection(attribution.unassigned), unknown: projection(attribution.unknown) },
    };
  })();
  const versionState = enumeration(r.versionState, ["READY", "UNKNOWN"]), queryVersion = nullableText(r.queryVersion), total = nullableInteger(r.total), observedTotal = versioned && r.observedTotal === null ? null : integer(r.observedTotal), canContinue = boolean(r.canContinue);
  const pageNum = integer(r.pageNum, 1), pageSize = integer(r.pageSize, 1), recordsStatus = enumeration(r.recordsStatus, [...STATUS, "READY"]);
  if (pageSize > 100 || (versionState === "READY" ? queryVersion === null || !/^saq-v1:[0-9a-f]{64}$/.test(queryVersion) : queryVersion !== null || total !== null || canContinue || pageNum > 1)) malformed("version");
  if (total !== null && total !== observedTotal) malformed("total");
  const missingSelection = firstCoverage && firstCoverage.status !== "COMPLETE" && recordsStatus === "UNKNOWN"
    && r.selectedCurrent === null && r.selectedCustomerCount === null && r.funds === null;
  return { generation, performance, firstCoverage, basis: enumeration(r.basis, BASES), businessZone: enumeration(r.businessZone, ["Asia/Shanghai"]), asOf: instant(r.asOf), pageNum, pageSize, total, observedTotal, versionState, queryVersion, canContinue, recordsStatus,
    selectedCustomerCount: missingSelection ? null : integer(r.selectedCustomerCount),
    selectedCurrent: missingSelection ? null : current(r.selectedCurrent),
    scopeSummary: scopeSummary(r.scopeSummary), funds: missingSelection ? null : selectedFunds(r.funds) };
}
export function parseSupportAnalyticsResponse(value: unknown, expected: { view: SupportAnalyticsView | SupportAnalyticsDetailView; basis: typeof BASES[number]; pageNum: number; pageSize: number; expectedVersion?: string; firstDependent?: boolean; firstFiltered?: boolean }, versioned = false): SupportAnalyticsResponse {
  const r = object(value, "view basis businessZone asOf pageNum pageSize total observedTotal versionState queryVersion canContinue recordsStatus selectedCustomerCount selectedCurrent scopeSummary funds records performanceWindow metricVersion generation sourceVersion firstPaymentCoverage detailSummary exportReadiness");
  const view = enumeration(r.view, VIEWS), meta = metadata(r, versioned);
  if (view !== expected.view || meta.basis !== expected.basis || meta.pageNum !== expected.pageNum || meta.pageSize !== expected.pageSize) malformed("queryMismatch");
  if (expected.expectedVersion !== undefined && meta.queryVersion !== expected.expectedVersion) malformed("versionMismatch");
  const incompleteFirst = expected.firstDependent && meta.firstCoverage && meta.firstCoverage.status !== "COMPLETE";
  if (incompleteFirst && (meta.versionState !== "UNKNOWN" || meta.recordsStatus !== "UNKNOWN" || meta.observedTotal !== null
    || expected.firstFiltered && meta.selectedCurrent !== null) || !incompleteFirst && meta.selectedCurrent === null) malformed("firstCoverage");
  if (meta.generation === "LEGACY" && (meta.recordsStatus !== (view === "AGENTS" ? meta.scopeSummary.personnel.status : meta.versionState) || (meta.total === null) !== (meta.versionState === "UNKNOWN" || view === "AGENTS" && meta.scopeSummary.personnel.status !== "AVAILABLE"))) malformed("recordsCoverage");
  const rows = array(r.records, x => x);
  const remaining = BigInt(meta.observedTotal ?? 0) - BigInt(meta.pageNum - 1) * BigInt(meta.pageSize);
  const expectedLength = remaining <= BigInt(0) ? 0 : Number(remaining < BigInt(meta.pageSize) ? remaining : BigInt(meta.pageSize));
  if (rows.length !== expectedLength || meta.canContinue !== (meta.versionState === "READY" && remaining > BigInt(rows.length))) malformed("pagination");
  switch (view) {
    case "AGENTS": return { ...meta, view, records: unique(rows.map(value => {
      const row = agent(value);
      const raw = value as { current: { performance?: unknown }; period?: unknown };
      const window = meta.performance?.window;
      const period = window?.basis === "PERIOD_EVENT" && raw.period != null ? performanceObject(raw.period).performance : undefined;
      const periodPerformance = period == null ? undefined : privatePerformance(period, window?.sourceVersion);
      if (periodPerformance && window && !samePerformanceWindow(periodPerformance.window, window, false)) malformed("agentPeriod");
      return { ...row, periodPerformance, performance: window && raw.current.performance != null ? privatePerformance(raw.current.performance, window.sourceVersion) : undefined };
    }), x => x.accountId) };
    case "FINANCE": return { ...meta, view, records: rows.map(financeRow) };
    case "DEVICES": return { ...meta, view, records: unique(rows.map(deviceRow), x => x.deviceId) };
    default: return { ...meta, view, records: unique(rows.map(value => {
      const row = customer(value);
      const raw = value as { performance?: unknown };
      return { ...row, performance: meta.performance && raw.performance != null ? privatePerformance(raw.performance, meta.performance.window.sourceVersion) : undefined };
    }), x => x.customerId) };
  }
}
function micros(value: string): bigint { return BigInt(parseBusinessTime(value)) * BigInt(1000) + BigInt((value.split(".")[1]?.slice(0, -1) ?? "").padEnd(6, "0").slice(3)); }
function query(options: Omit<SupportAnalyticsQuery, "view"> & { view: SupportAnalyticsView | SupportAnalyticsDetailView }) {
  object(options, `${PARAMETERS.join(" ")} signal`);
  if (Object.values(options).some(value => value === null)) malformed("queryNull");
  const view = enumeration(options.view, [...VIEWS, ...DETAIL_VIEWS]), detail = DETAIL_VIEWS.includes(view as SupportAnalyticsDetailView), basis = enumeration(options.basis ?? "CURRENT_CUSTOMER_HISTORY", BASES), category = enumeration(options.category ?? "ALL", CATEGORIES), firstState = enumeration(options.firstState ?? "ALL", FIRST), filter = enumeration(options.filter ?? "ALL", FILTERS);
  const defaultSort = category === "PENDING" ? "POOL_ENTERED_AT" : firstState === "CONFIRMED" ? "FIRST_SUCCEEDED_AT" : firstState === "NONE" ? "REGISTERED_AT" : filter === "WAITING_REPLY" ? "WAITING_SINCE_AT" : filter === "FIRST_CONTACT" ? "ASSIGNED_AT" : filter === "DUE" ? "NEXT_DUE_AT" : filter === "STOPPED" ? "STATE_CHANGED_AT" : "LAST_ACTIVE_AT";
  const sortKey = enumeration(options.sortKey ?? (view === "AGENTS" ? "BOUND_CUSTOMER_COUNT" : (view === "FINANCE" || detail) ? "SUCCEEDED_AT" : defaultSort), SORTS);
  const direction = enumeration(options.direction ?? (category === "PENDING" || firstState === "NONE" || ["WAITING_REPLY", "FIRST_CONTACT", "DUE", "DORMANT"].includes(filter) ? "ASC" : "DESC"), ["ASC", "DESC"]);
  const allowed = view === "AGENTS" ? ["BOUND_CUSTOMER_COUNT", "ACTIVE_CUSTOMER_COUNT", "FIRST_CONFIRMED_CUSTOMER_COUNT", "DEVICE_COUNT", "PERSONAL_DEPOSIT"] : (view === "FINANCE" || detail) ? ["SUCCEEDED_AT", "AMOUNT"] : view === "DEVICES" ? ["HASHRATE", "LAST_ACTIVE_AT", "REGISTERED_AT", "DEVICE_COUNT"] : SORTS.filter(x => !["BOUND_CUSTOMER_COUNT", "ACTIVE_CUSTOMER_COUNT", "FIRST_CONFIRMED_CUSTOMER_COUNT", "HASHRATE", "SUCCEEDED_AT", "AMOUNT"].includes(x));
  if (sortKey === "PERFORMANCE_AMOUNT" && (view !== "CUSTOMERS" || basis !== "CURRENT_CUSTOMER_HISTORY" || options.currency !== "USDT") || sortKey === "NET_CONTRIBUTION" && basis !== "CURRENT_CUSTOMER_HISTORY") malformed("querySort");
  if (!allowed.includes(sortKey) || sortKey === "NEXT_DUE_AT" && filter !== "DUE" || sortKey === "WAITING_SINCE_AT" && filter !== "WAITING_REPLY" || sortKey === "STATE_CHANGED_AT" && filter !== "STOPPED" || sortKey === "POOL_ENTERED_AT" && category !== "PENDING" || basis === "CURRENT_ASSET" && (view === "FINANCE" || firstState !== "ALL" || ["PERSONAL_DEPOSIT", "TEAM_DEPOSIT", "FIRST_SUCCEEDED_AT", "FIRST_CONFIRMED_CUSTOMER_COUNT"].includes(sortKey))) malformed("querySort");
  const currency = options.currency === undefined ? undefined : enumeration(options.currency, CURRENCIES);
  if (["PERSONAL_DEPOSIT", "TEAM_DEPOSIT", "NET_CONTRIBUTION", "AMOUNT"].includes(sortKey) && currency === undefined) malformed("queryCurrency");
  if (detail && (basis !== "PERIOD_EVENT" || currency === undefined || category !== "ALL" || firstState !== "ALL" || filter !== "ALL" || options.keyword?.trim())) malformed("detail.query");
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
  return { params, view, basis, pageNum, pageSize, expectedVersion: options.expectedVersion, firstFiltered: firstState !== "ALL",
    firstDependent: firstState !== "ALL" || sortKey === "FIRST_SUCCEEDED_AT" || sortKey === "FIRST_CONFIRMED_CUSTOMER_COUNT" };
}
/** One business month and its exact UTC window from the server's business calendar (BUG-005). */
export type SupportAnalyticsMonth = { month: string; from: string; to: string; generation?: "READY" };
export function parseSupportAnalyticsMonths(value: unknown): SupportAnalyticsMonth[] {
  const generation = performanceGeneration(value);
  const months = array(object(value, "months metricVersion generation").months, entry => {
    const row = object(entry, "month from to businessZone availability reasonCodes channels");
    const month = text(row.month);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) malformed("month");
    const from = instant(row.from), to = instant(row.to);
    if (parseBusinessTime(from) >= parseBusinessTime(to)) malformed("monthWindow");
    return { month, from, to, generation: generation === "READY" ? generation : undefined };
  });
  if ((generation === "LEGACY" && months.length === 0) || new Set(months.map(row => row.month)).size !== months.length) malformed("months");
  return months;
}
export const supportAnalyticsClient = {
  details: (options: Omit<SupportAnalyticsQuery, "view"> & { view: SupportAnalyticsDetailView }): Promise<SupportAnalyticsDetailResponse> => {
    const expected = query(options);
    return supportRequest(`/support-workbench/analytics?${expected.params}`, value => parseDetailResponse(value, expected, options.currency!), { signal: options.signal });
  },
  query: (options: SupportAnalyticsQuery): Promise<SupportAnalyticsResponse> => {
    const expected = query(options);
    return supportRequest(`/support-workbench/analytics?${expected.params}`, value => parseSupportAnalyticsResponse(value, expected), { signal: options.signal });
  },
  months: (signal?: AbortSignal): Promise<SupportAnalyticsMonth[]> =>
    supportRequest("/support-workbench/analytics/months", parseSupportAnalyticsMonths, { signal }),
};

const analyticsPath = "/support-workbench/analytics";
const readAnalytics = (path: string, signal?: AbortSignal) => supportRequest(path, value => value, { signal });

export const supportPerformanceAnalyticsClient = {
  ...supportAnalyticsClient,
  async query(options: SupportAnalyticsQuery, generation?: "READY" | "UPGRADING" | "LEGACY"): Promise<SupportAnalyticsResponse> {
    if (generation === "LEGACY") return supportAnalyticsClient.query(options);
    const expected = query(options);
    expected.params.set("metricVersion", PERFORMANCE_VERSION);
    expected.params.delete("businessZone");
    let result;
    try {
      result = await readAnalytics(`${analyticsPath}?${expected.params}`, options.signal);
    } catch (error) {
      if (options.expectedVersion || !legacyPerformanceSelectorError(error, "SUPPORT_ANALYTICS_QUERY_INVALID", "SUPPORT_METRIC_VERSION_UNSUPPORTED", "SUPPORT_READ_SCOPE_INVALID", "SUPPORT_ANALYTICS_INVALID_QUERY")) throw error;
      return supportAnalyticsClient.query(options);
    }
    if (performanceGeneration(result) === "LEGACY" && !options.expectedVersion) {
      parseSupportAnalyticsResponse(result, expected);
      return supportAnalyticsClient.query(options);
    }
    return parseSupportAnalyticsResponse(result, expected, true);
  },
  async months(signal?: AbortSignal) {
    const legacy = async () => ({ generation: "LEGACY" as const, months: await supportAnalyticsClient.months(signal) });
    let result;
    try {
      result = await readAnalytics(`${analyticsPath}/months?metricVersion=${PERFORMANCE_VERSION}`, signal);
    } catch (error) {
      if (!legacyPerformanceSelectorError(error, "SUPPORT_ANALYTICS_QUERY_INVALID", "SUPPORT_METRIC_VERSION_UNSUPPORTED")) throw error;
      return legacy();
    }
    const generation = performanceGeneration(result);
    const months = parseSupportAnalyticsMonths(result);
    if (generation === "LEGACY") return legacy();
    return { generation, months };
  },
  async firstDetails(options: Omit<SupportAnalyticsQuery, "view"> & { view: "FIRST_DEPOSITS" | "FIRST_PURCHASES" }, origin: PerformanceWindow): Promise<SupportAnalyticsDetailResponse | IncompleteFirstDetail> {
    const expected = query(options);
    expected.params.set("metricVersion", PERFORMANCE_VERSION);
    expected.params.delete("businessZone");
    return supportRequest(`${analyticsPath}?${expected.params}`, value => {
      const r = object(value, "view basis businessZone asOf pageNum pageSize total observedTotal versionState queryVersion canContinue recordsStatus selectedCustomerCount selectedCurrent scopeSummary funds records detailSummary performanceWindow metricVersion generation sourceVersion firstPaymentCoverage exportReadiness");
      const generation = performanceGeneration(r);
      if (generation === "UPGRADING") throw new SupportClientError(503, undefined, "SUPPORT_ANALYTICS_HISTORY_INCOMPLETE");
      const window = performanceWindow(r.performanceWindow);
      if (generation !== "READY" || !samePerformanceWindow(window, origin)) {
        throw new SupportClientError(409, undefined, "SUPPORT_ANALYTICS_QUERY_CHANGED");
      }
      const meta = metadata(r, true);
      const view = enumeration(r.view, ["FIRST_DEPOSITS", "FIRST_PURCHASES"]);
      if (view !== options.view || meta.pageNum !== expected.pageNum || meta.pageSize !== expected.pageSize
        || expected.expectedVersion && meta.queryVersion !== expected.expectedVersion) malformed("firstDetails");
      const kind = view === "FIRST_DEPOSITS" ? "DEPOSIT" : "DEVICE_PURCHASE";
      const records = array(r.records, value => detailRow(value, view));
      if (meta.recordsStatus === "UNKNOWN") {
        const measuredSummary = measuredFirstSummary(r.detailSummary);
        if (meta.versionState !== "UNKNOWN" || meta.firstCoverage?.status === "COMPLETE" || meta.observedTotal !== measuredSummary.visible.count.observed
          || measuredSummary.currency !== options.currency || records.length) malformed("firstDetailCoverage");
        return { ...meta, view, records: [], measuredSummary };
      }
      const detail = detailSummary(r.detailSummary);
      if (detail.currency !== options.currency || records.some(row => row.currency !== detail.currency || row.kind !== kind)
        || detail.visibleCount !== meta.total || records.length !== Math.min(meta.pageSize, Math.max(0, detail.visibleCount - (meta.pageNum - 1) * meta.pageSize))
        || meta.canContinue !== (meta.pageNum * meta.pageSize < detail.visibleCount)) malformed("firstDetails");
      return { ...meta, view, records, detailSummary: detail };
    }, { signal: options.signal });
  },
  async events(options: { from: string; to: string; pageNum: number; pageSize: number; expectedVersion?: string; signal?: AbortSignal }) {
    const { signal, ...window } = options;
    const expected = query({ ...window, view: "FINANCE", basis: "PERIOD_EVENT", currency: "USDT" });
    expected.params.delete("businessZone");
    expected.params.set("view", "PERFORMANCE_EVENTS");
    expected.params.set("metricVersion", PERFORMANCE_VERSION);
    return supportRequest(`${analyticsPath}?${expected.params}`, value => performanceEvents(value, expected), { signal });
  },
};
