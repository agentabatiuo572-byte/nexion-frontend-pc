import { supportRequest } from "./m-support-client.ts";
import { guardedFetch } from "./error-messages.ts";
import type { SupportBoardRow } from "../../app/components/domain-views/m-tabs/support-leaderboard";

const BOARDS = ["firstPayment", "deposit", "purchase", "customers"] as const;
const SCOPES = ["all", "ownGroup", "managedGroups"] as const;
const COVERAGE = ["COMPLETE", "PARTIAL", "UNKNOWN", "FAILED"] as const;
const REASONS = ["NONE", "SOURCE_INCOMPLETE", "HISTORY_UNKNOWN", "ATTRIBUTION_UNKNOWN", "REFUNDS_UNKNOWN", "SOURCE_FAILED", "CANDIDATES_INCOMPLETE", "METRIC_INCOMPLETE", "HISTORICAL_MONTH", "MONTH_START", "NO_BASELINE", "DEFINITION_CHANGED", "SCOPE_CHANGED", "MEMBERS_CHANGED", "NOT_A_CANDIDATE", "LEADER"] as const;
const PARAMETERS = "board month currency scope groupId keyword pageNum pageSize expectedVersion";
const BASE = "/api/admin/content/support-workbench/leaderboard";
export type LeaderboardQuery = { board: typeof BOARDS[number]; month?: string; currency?: "USDT" | "NEX"; scope: typeof SCOPES[number]; groupId?: string; keyword?: string; pageNum?: number; pageSize?: number; expectedVersion?: string };
export type LeaderboardScope = { scope: typeof SCOPES[number]; groups: { id: string; name: string }[] };
function invalid(field: string): never { throw new Error(`SUPPORT_CONTRACT_MALFORMED:leaderboard.${field}`); }
function object(value: unknown, fields: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("object");
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !fields.split(" ").includes(key))) invalid("unexpectedField");
  return row;
}
function text(value: unknown): string { if (typeof value !== "string") invalid("text"); return value; }
function bool(value: unknown): boolean { if (typeof value !== "boolean") invalid("boolean"); return value; }
function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number { if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) invalid("integer"); return value; }
function id(value: unknown): string { const result = text(value); if (!/^[1-9]\d*$/.test(result) || BigInt(result) > BigInt(Number.MAX_SAFE_INTEGER)) invalid("id"); return result; }
function enumeration<const T extends readonly string[]>(value: unknown, allowed: T): T[number] { if (typeof value !== "string" || !allowed.includes(value)) invalid("enum"); return value as T[number]; }
function array<T>(value: unknown, parse: (value: unknown) => T): T[] { if (!Array.isArray(value)) invalid("array"); return value.map(parse); }
function unique<T>(rows: T[], key: (row: T) => string): T[] { if (new Set(rows.map(key)).size !== rows.length) invalid("duplicate"); return rows; }
function month(value: unknown): string { const result = text(value); if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(result)) invalid("month"); return result; }
function version(value: unknown): string { const result = text(value); if (!/^slb-v1:[a-f0-9]{64}$/.test(result)) invalid("version"); return result; }
function instant(value: unknown): string { const result = text(value); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 19) !== result.slice(0, 19)) invalid("instant"); return result; }
function decimal(value: unknown): string | null { if (value === null) return null; const result = text(value); if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(result)) invalid("decimal"); return result; }
const REASON_TEXT: Record<typeof REASONS[number], string> = {
  NONE: "来源已核实", SOURCE_INCOMPLETE: "部分来源尚未核实", HISTORY_UNKNOWN: "历史记录待核实", ATTRIBUTION_UNKNOWN: "贡献归属待核实", REFUNDS_UNKNOWN: "退款记录待核实", SOURCE_FAILED: "来源读取失败", CANDIDATES_INCOMPLETE: "参榜人员尚未完整核实", METRIC_INCOMPLETE: "主指标尚未完整核实", HISTORICAL_MONTH: "历史月份不比较每日变化", MONTH_START: "月初暂无同月基准", NO_BASELINE: "暂无已发布的昨日基准", DEFINITION_CHANGED: "统计口径已变化", SCOPE_CHANGED: "统计范围已变化", MEMBERS_CHANGED: "参榜人员已变化", NOT_A_CANDIDATE: "当前账号未参榜", LEADER: "已达到榜首成绩",
};
function reason(value: unknown): string { return REASON_TEXT[enumeration(value, REASONS)]; }
function coverage(value: unknown) { return enumeration(value, COVERAGE); }
function displayCoverage(value: typeof COVERAGE[number]) { return value === "COMPLETE" ? "complete" as const : value === "PARTIAL" ? "partial" as const : "unavailable" as const; }
function count(value: unknown) {
  const r = object(value, "value coverage reason"), state = coverage(r.coverage);
  const amount = r.value === null ? null : String(integer(r.value));
  if ((state === "UNKNOWN" || state === "FAILED") && amount !== null || state === "COMPLETE" && (amount === null || r.reason !== "NONE") || state !== "COMPLETE" && r.reason === "NONE") invalid("countCoverage");
  return { value: amount, coverage: displayCoverage(state), reason: reason(r.reason) };
}
const META_FIELDS = "viewVersion queryVersion sourceVersion definitionVersion board rankMonth referenceMonth currency scope businessZone asOf publishedAt state candidateCoverage stale refreshFailed selectableMonths currencies scopeOptions";
function metadata(r: Record<string, unknown>) {
  const result = {
    viewVersion: version(r.viewVersion), queryVersion: version(r.queryVersion), sourceVersion: text(r.sourceVersion), definitionVersion: text(r.definitionVersion),
    board: enumeration(r.board, BOARDS), rankMonth: r.rankMonth === null ? null : month(r.rankMonth), referenceMonth: month(r.referenceMonth), currency: enumeration(r.currency, ["USDT", "NEX"] as const), scope: enumeration(r.scope, SCOPES),
    businessZone: enumeration(r.businessZone, ["Asia/Shanghai"] as const), asOf: instant(r.asOf), publishedAt: instant(r.publishedAt), state: enumeration(r.state, ["COMPLETE", "PROVISIONAL"] as const), candidateCoverage: coverage(r.candidateCoverage), stale: bool(r.stale), refreshFailed: bool(r.refreshFailed),
    selectableMonths: unique(array(r.selectableMonths, month), x => x), currencies: unique(array(r.currencies, v => enumeration(v, ["USDT", "NEX"] as const)), x => x),
    scopeOptions: unique(array(r.scopeOptions, value => { const s = object(value, "scope groups"); return { scope: enumeration(s.scope, SCOPES), groups: unique(array(s.groups, value => { const g = object(value, "id name"); return { id: id(g.id), name: text(g.name) }; }), g => g.id) }; }), s => s.scope),
  };
  if (result.queryVersion !== result.viewVersion || !result.sourceVersion || !result.definitionVersion || Date.parse(result.publishedAt) < Date.parse(result.asOf)
    || (result.board === "customers" ? result.rankMonth !== null : result.rankMonth === null || result.rankMonth !== result.referenceMonth)
    || !result.currencies.includes(result.currency) || !result.scopeOptions.some(s => s.scope === result.scope)
    || result.scopeOptions.some(s => s.scope === "all" ? s.groups.length !== 0 : s.scope === "ownGroup" ? s.groups.length !== 1 : s.groups.length === 0)
    || result.state === "COMPLETE" && result.candidateCoverage !== "COMPLETE") invalid("metadata");
  return result;
}
export type LeaderboardMetadata = ReturnType<typeof metadata>;
function row(value: unknown, meta: LeaderboardMetadata): SupportBoardRow {
  const r = object(value, "agentId name avatarUrl groupName qualification rank isTied rankMetricCoverage firstPayment customers amount movement canViewCustomers");
  enumeration(r.qualification, ["ACTIVE", "DISABLED", "REMOVED", "HANDOVER_REQUIRED", "UNKNOWN"] as const);
  const a = object(r.amount, "value currency month kind coverage reason"), state = coverage(a.coverage);
  const amount = { value: decimal(a.value), currency: enumeration(a.currency, ["USDT", "NEX"] as const), periodLabel: month(a.month), sourceVersion: meta.sourceVersion, coverage: displayCoverage(state), reason: reason(a.reason) };
  const amountKind = enumeration(a.kind, ["DEPOSIT", "PURCHASE"] as const);
  if (amount.currency !== meta.currency || amount.periodLabel !== meta.referenceMonth || amountKind !== (meta.board === "purchase" ? "PURCHASE" : "DEPOSIT") || (state === "UNKNOWN" || state === "FAILED") && amount.value !== null || state === "COMPLETE" && (amount.value === null || a.reason !== "NONE") || state !== "COMPLETE" && a.reason === "NONE") invalid("amount");
  const firstPayment = count(r.firstPayment), customers = count(r.customers), main = meta.board === "firstPayment" ? firstPayment : meta.board === "customers" ? customers : amount;
  const metricState = coverage(r.rankMetricCoverage), rank = r.rank === null ? null : integer(r.rank, 1), tied = bool(r.isTied);
  const confirmed = meta.state === "COMPLETE" && meta.candidateCoverage === "COMPLETE" && metricState === "COMPLETE" && main.coverage === "complete" && main.value !== null && rank !== null;
  const mainCoverage = meta.board === "firstPayment" ? coverage(object(r.firstPayment, "value coverage reason").coverage) : meta.board === "customers" ? coverage(object(r.customers, "value coverage reason").coverage) : state;
  if (meta.state === "COMPLETE" && !confirmed || !confirmed && (rank !== null || tied) || metricState !== mainCoverage) invalid("rank");
  const m = object(r.movement, "kind places previousRank baselineAt baselineVersion reason"), kind = enumeration(m.kind, ["UP", "DOWN", "SAME", "NEW", "UNAVAILABLE"] as const);
  const previousRank = m.previousRank === null ? null : integer(m.previousRank, 1), baselineAt = m.baselineAt === null ? null : instant(m.baselineAt), baselineVersion = m.baselineVersion === null ? null : version(m.baselineVersion);
  const places = m.places === null ? null : integer(m.places);
  if (kind === "UNAVAILABLE" ? places !== null || previousRank !== null || baselineAt !== null || baselineVersion !== null || m.reason === "NONE"
    : !confirmed || m.reason !== "NONE" || baselineAt === null || baselineVersion === null || Date.parse(baselineAt) >= Date.parse(meta.asOf)
      || (kind === "NEW" ? places !== null || previousRank !== null : previousRank === null || places === null
        || (kind === "SAME" ? places !== 0 || previousRank !== rank : places < 1 || (kind === "UP" ? previousRank - rank! !== places : rank! - previousRank !== places)))) invalid("movement");
  const explanation = reason(m.reason) + (baselineAt ? `；基准截至 ${baselineAt}` : "") + (previousRank ? `；原名次 ${previousRank}` : "");
  const movement: SupportBoardRow["movement"] = kind === "UP" || kind === "DOWN" ? { kind: kind === "UP" ? "up" : "down", places: places!, explanation } : { kind: kind === "SAME" ? "same" : kind === "NEW" ? "new" : "unavailable", explanation };
  const agentId = id(r.agentId), name = text(r.name);
  if (!name.trim()) invalid("name");
  const avatarUrl = r.avatarUrl === null ? undefined : text(r.avatarUrl);
  return { id: agentId, name, groupName: text(r.groupName), avatarUrl, rank, isTied: tied, rankStatus: confirmed ? "confirmed" : main.coverage === "unavailable" ? "unavailable" : "provisional", amount, firstPayment, customers, movement, unavailableReason: confirmed ? undefined : "当前主指标或参榜范围尚未完整核实", canViewCustomers: bool(r.canViewCustomers) };
}
export function leaderboardQueryString(input: LeaderboardQuery): string {
  const q = object(input, PARAMETERS), params = new URLSearchParams();
  params.set("board", enumeration(q.board, BOARDS)); params.set("scope", enumeration(q.scope, SCOPES));
  if (q.month !== undefined) { if (q.board === "customers") invalid("customersMonth"); params.set("month", month(q.month)); }
  if (q.currency !== undefined) params.set("currency", enumeration(q.currency, ["USDT", "NEX"] as const));
  if (q.groupId !== undefined) { if (q.scope === "all") invalid("allGroup"); params.set("groupId", id(q.groupId)); }
  if (q.keyword !== undefined) { const keyword = text(q.keyword); if (keyword.length > 200 || /[\x00-\x1f\x7f-\x9f]/.test(keyword)) invalid("keyword"); if (keyword.trim()) params.set("keyword", keyword.trim()); }
  if (q.pageNum !== undefined) params.set("pageNum", String(integer(q.pageNum, 1)));
  if (q.pageSize !== undefined) params.set("pageSize", String(integer(q.pageSize, 1, 100)));
  if (q.expectedVersion !== undefined) params.set("expectedVersion", version(q.expectedVersion));
  if (integer(q.pageNum ?? 1, 1) > 1 && q.expectedVersion === undefined) invalid("versionRequired");
  return `?${params}`;
}
function matches(meta: LeaderboardMetadata, q: LeaderboardQuery) {
  if (meta.board !== q.board || meta.scope !== q.scope || q.currency !== undefined && meta.currency !== q.currency || q.month !== undefined && meta.rankMonth !== q.month || q.expectedVersion !== undefined && meta.viewVersion !== q.expectedVersion) invalid("queryMismatch");
  if (q.groupId && !meta.scopeOptions.find(s => s.scope === q.scope)?.groups.some(g => g.id === q.groupId)) invalid("groupMismatch");
}
export function parseLeaderboardPage(value: unknown, q: LeaderboardQuery) {
  const r = object(value, META_FIELDS + " total ranked unranked matched pageNum pageSize rows self"), meta = metadata(r); matches(meta, q);
  const total = integer(r.total), ranked = integer(r.ranked), unranked = integer(r.unranked), matched = integer(r.matched), pageNum = integer(r.pageNum, 1), pageSize = integer(r.pageSize, 1, 100);
  const rows = unique(array(r.rows, value => row(value, meta)), r => r.id), s = object(r.self, "row gap reason pageNum");
  const self = { row: s.row === null ? null : row(s.row, meta), gap: decimal(s.gap), reason: reason(s.reason), pageNum: s.pageNum === null ? null : integer(s.pageNum, 1) };
  if (ranked + unranked !== total || matched > total || rows.length > pageSize || rows.length > matched || pageNum !== (q.pageNum ?? 1) || pageSize !== (q.pageSize ?? 20) || (self.row === null ? self.pageNum !== null || self.gap !== null : self.pageNum === null) || meta.state !== "COMPLETE" && (ranked !== 0 || self.gap !== null)) invalid("page");
  const acceptedQuery = { ...q, currency: meta.currency, month: meta.rankMonth ?? undefined };
  const selfOnPage = self.row && rows.find(row => row.id === self.row?.id);
  if (selfOnPage && JSON.stringify(selfOnPage) !== JSON.stringify(self.row)) invalid("selfMismatch");
  for (const r of rows) if (r.rank !== null && r.rank > total) invalid("rankRange");
  for (const r of rows) if (r.avatarUrl) publicLeaderboardAvatar(r.avatarUrl, r.id, acceptedQuery, meta.viewVersion);
  if (self.row?.avatarUrl) publicLeaderboardAvatar(self.row.avatarUrl, self.row.id, acceptedQuery, meta.viewVersion);
  return { ...meta, total, ranked, unranked, matched, pageNum, pageSize, rows, self };
}
export type LeaderboardPage = ReturnType<typeof parseLeaderboardPage>;
export function parseLeaderboardDetail(value: unknown, q: LeaderboardQuery, agentId: string) {
  const r = object(value, META_FIELDS + " row"), meta = metadata(r); matches(meta, q); const detailRow = row(r.row, meta);
  if (detailRow.id !== id(agentId)) invalid("detailIdentity");
  if (detailRow.avatarUrl) publicLeaderboardAvatar(detailRow.avatarUrl, agentId, { ...q, currency: meta.currency, month: meta.rankMonth ?? undefined }, meta.viewVersion);
  return { ...meta, row: detailRow };
}
export type LeaderboardDetail = ReturnType<typeof parseLeaderboardDetail>;
export function publicLeaderboardAvatar(url: string, agentId: string, q: LeaderboardQuery, expectedVersion: string): string {
  const target = new URL(url, "https://leaderboard.invalid");
  if (!url.startsWith(`${BASE}/`) || target.origin !== "https://leaderboard.invalid" || target.pathname !== `${BASE}/${id(agentId)}/avatar` || target.hash) invalid("avatarPath");
  const found = new Set<string>(); const raw: Record<string, string> = {};
  for (const [key, value] of target.searchParams) { if (!PARAMETERS.split(" ").includes(key) || found.has(key)) invalid("avatarQuery"); found.add(key); raw[key] = value; }
  const expected = new URLSearchParams(leaderboardQueryString({ board: q.board, scope: q.scope, currency: q.currency, month: q.month, groupId: q.groupId, expectedVersion: version(expectedVersion) }).slice(1));
  if (found.size !== [...expected.keys()].length || [...expected].some(([key, value]) => raw[key] !== value)) invalid("avatarBinding");
  return url;
}
export async function fetchLeaderboardAvatar(url: string, agentId: string, q: LeaderboardQuery, expectedVersion: string, signal: AbortSignal): Promise<Blob> {
  const response = await guardedFetch(publicLeaderboardAvatar(url, agentId, q, expectedVersion), { signal, credentials: "same-origin", cache: "no-store" });
  if (!response.ok) { const error = new Error("公开头像暂不可用") as Error & { status: number }; error.status = response.status; throw error; }
  if (!["image/jpeg", "image/png"].includes((response.headers.get("Content-Type") ?? "").split(";")[0].toLowerCase())) invalid("avatarType");
  const blob = await response.blob(); if (!blob.size) invalid("avatarEmpty"); return blob;
}
export function locateLeaderboardSelf(page: LeaderboardPage, q: LeaderboardQuery): LeaderboardQuery | null { return page.self.pageNum === null ? null : { ...q, keyword: undefined, pageNum: page.self.pageNum, expectedVersion: page.viewVersion }; }
export const supportLeaderboardClient = {
  page(q: LeaderboardQuery, signal?: AbortSignal): Promise<LeaderboardPage> { const query = leaderboardQueryString(q); return supportRequest(`/support-workbench/leaderboard${query}`, value => parseLeaderboardPage(value, q), { signal }); },
  detail(agentId: string, q: LeaderboardQuery, signal?: AbortSignal): Promise<LeaderboardDetail> { id(agentId); if (!q.expectedVersion) invalid("detailVersion"); const query = leaderboardQueryString(q); return supportRequest(`/support-workbench/leaderboard/${agentId}${query}`, value => parseLeaderboardDetail(value, q, agentId), { signal }); },
};
