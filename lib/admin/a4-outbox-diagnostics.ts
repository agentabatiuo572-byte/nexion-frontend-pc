export type OutboxFilters = { eventType: string; status: string; unresolvedOnly: boolean };
export type OutboxDiagnostics = {
  total: number; unresolved: number; oldestSeconds: number; groupsTruncated: boolean;
  groups: { eventType: string; status: string; count: number; oldestAt: string; unresolved: number }[];
  rows: { eventId: string; eventType: string; status: string; retryCount: number; createdAt: string;
    userNo: string | null;
    nextRetryAt: string | null; errorCode: string | null; auditLinkUnresolved: boolean;
    receipts: { status: string; count: number }[] }[];
  nextCursor: string | null; hasMore: boolean;
};
export type OutboxDeadLetters = {
  types: {
    questCode: string;
    eventType: string;
    outboxDeadCount: number;
    /** Current DEAD in both layers, not a complete redrive eligibility decision. */
    bothLayersDeadCount: number;
    oldestOutboxLastStateAt: string | null;
    oldestBothLayersDeadObservedAt: string | null;
    bothLayersDeadTimeComplete: boolean;
  }[];
};
const errorCodes = new Set(["OTHER_ERROR", "C1_AUDIT_EVIDENCE_NOT_UNIQUE", "C1_AUDIT_ENVELOPE_INVALID",
  "C1_AUDIT_PAYLOAD_INVALID", "C1_AUDIT_DELIVERY_NOT_COMPLETE", "C1_AUDIT_RECEIPT_NOT_PERSISTED",
  "C1_AUDIT_SOURCE_INVALID", "H3_EVENT_BINDING_PENDING", "L6_EVIDENCE_FACT_MISSING",
  "L6_EVIDENCE_ENVELOPE_INVALID", "L6_EVIDENCE_PAYLOAD_INVALID", "L6_EVIDENCE_FACT_CONFLICT",
  "L6_EVIDENCE_RECEIPT_FAILED", "L6_EVIDENCE_RECEIPT_CONFLICT", "L6_EVIDENCE_PUBLICATION_FAILED",
  "L6_EVIDENCE_VERIFICATION_UNAVAILABLE", "F4_ALERT_AUDIT_MISSING", "F4_ALERT_ENVELOPE_INVALID",
  "F4_ALERT_PAYLOAD_INVALID", "F4_ALERT_AUDIT_NOT_UNIQUE", "F4_ALERT_AUDIT_CONFLICT",
  "F4_ALERT_AUDIT_ALREADY_CLAIMED", "F4_ALERT_RECEIPT_FAILED", "F4_ALERT_RECEIPT_CONFLICT",
  "F4_ALERT_PUBLICATION_FAILED", "F4_ALERT_VERIFICATION_UNAVAILABLE"]);
function invalid(): never { throw new Error("A4_OUTBOX_DIAGNOSTICS_INVALID"); }
export function nullableA4UserNo(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || !/^U\d{8,19}$/.test(value)
    || BigInt(value.slice(1)) <= BigInt(0) || BigInt(value.slice(1)) > BigInt("9223372036854775807")) {
    throw new Error("A4_USER_NUMBER_INVALID");
  }
  return value;
}
function obj(v: unknown): Record<string, unknown> { return v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : invalid(); }
function count(v: unknown): number { return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : invalid(); }
function bool(v: unknown): boolean { return typeof v === "boolean" ? v : invalid(); }
function text(v: unknown): string { return typeof v === "string" && v.length > 0 ? v : invalid(); }
function stamp(v: unknown): string { const s = text(v); return /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d+)?$/.test(s) ? s : invalid(); }
function code(v: unknown): string { const s = text(v); return /^[A-Za-z][A-Za-z0-9_.-]{0,95}$/.test(s) ? s : invalid(); }
function rows(v: unknown, max: number): unknown[] { return Array.isArray(v) && v.length <= max ? v : invalid(); }
function state(v: unknown, receipt = false): string {
  const s = text(v); return (receipt ? ["PENDING", "FAILED", "SUCCESS", "DEAD", "PROCESSING", "SKIPPED", "PENDING_BINDING", "OTHER"] : ["PENDING", "FAILED", "OTHER"]).includes(s) ? s : invalid();
}
export function normalizeOutboxDiagnostics(value: unknown): OutboxDiagnostics {
  const d = obj(value), hasMore = bool(d.hasMore);
  const nextCursor = d.nextCursor === null ? null : text(d.nextCursor);
  if (hasMore !== (nextCursor !== null) || (nextCursor !== null && (!/^[1-9][0-9]{0,18}$/.test(nextCursor) || BigInt(nextCursor) > BigInt("9223372036854775807")))) invalid();
  const result: OutboxDiagnostics = {
    total: count(d.total), unresolved: count(d.unresolved), oldestSeconds: count(d.oldestSeconds), groupsTruncated: bool(d.groupsTruncated),
    groups: rows(d.groups, 200).map(value => { const g = obj(value); return { eventType: code(g.eventType), status: state(g.status), count: count(g.count), oldestAt: stamp(g.oldestAt), unresolved: count(g.unresolved) }; }),
    rows: rows(d.rows, 50).map(value => {
      const r = obj(value), id = text(r.eventId), errorCode = r.errorCode === null ? null : text(r.errorCode);
      if (!/^(?:[a-f0-9]{32}|INVALID_EVENT_ID)$/.test(id) || (errorCode !== null && !errorCodes.has(errorCode))) invalid();
      return { eventId: id, eventType: code(r.eventType), status: state(r.status), retryCount: count(r.retryCount), userNo: nullableA4UserNo(r.userNo),
        createdAt: stamp(r.createdAt), nextRetryAt: r.nextRetryAt === null ? null : stamp(r.nextRetryAt), errorCode,
        auditLinkUnresolved: bool(r.auditLinkUnresolved), receipts: rows(r.receipts, 8).map(value => { const receipt = obj(value); return { status: state(receipt.status, true), count: count(receipt.count) }; }) };
    }), nextCursor, hasMore,
  };
  if (result.unresolved > result.total || result.rows.length > result.total || (hasMore && result.rows.length === 0)) invalid();
  if (result.groups.some(g => g.count === 0 || g.unresolved > g.count)) invalid();
  const groupTotal = result.groups.reduce((n, g) => n + g.count, 0);
  const unresolvedTotal = result.groups.reduce((n, g) => n + g.unresolved, 0);
  if (result.groupsTruncated ? (result.groups.length !== 200 || groupTotal > result.total || unresolvedTotal > result.unresolved)
    : (groupTotal !== result.total || unresolvedTotal !== result.unresolved)) invalid();
  if (new Set(result.groups.map(g => `${g.eventType}/${g.status}`)).size !== result.groups.length) invalid();
  for (const row of result.rows) {
    if (row.receipts.some(r => r.count === 0) || new Set(row.receipts.map(r => r.status)).size !== row.receipts.length) invalid();
  }
  return result;
}
export function outboxDiagnosticsQuery(filters: OutboxFilters, cursor = "0"): URLSearchParams {
  const query = new URLSearchParams({ pageSize: "25", afterId: cursor });
  if (filters.eventType) query.set("eventType", filters.eventType);
  if (filters.status) query.set("status", filters.status);
  if (filters.unresolvedOnly) query.set("unresolvedOnly", "true");
  return query;
}

export function normalizeOutboxDeadLetters(value: unknown): OutboxDeadLetters {
  const definitions: Record<string, string> = {
    weekly_t2_browse_store: "H3_STOREFRONT_THREE_PRODUCTS_VIEWED",
    weekly_t2_genesis_browse: "H3_GENESIS_SECONDARY_MARKET_VIEWED",
    weekly_t2_ai_jobs_50: "H3_COMPUTE_COMPLETED_50",
    weekly_t2_invite_friend: "H3_REFERRAL_REGISTERED",
    weekly_t2_nex_swap: "H3_EXCHANGE_COMPLETED",
  };
  const nullableTime = (value: unknown): string | null => {
    if (value === null) return null;
    const result = text(value);
    return /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,9})?)?$/.test(result) ? result : invalid();
  };
  const types = rows(obj(value).types, 5).map(value => {
    const row = obj(value);
    const questCode = text(row.questCode), eventType = text(row.eventType);
    const outboxDeadCount = count(row.outboxDeadCount), bothLayersDeadCount = count(row.bothLayersDeadCount);
    const oldestOutboxLastStateAt = nullableTime(row.oldestOutboxLastStateAt);
    const oldestBothLayersDeadObservedAt = nullableTime(row.oldestBothLayersDeadObservedAt);
    const bothLayersDeadTimeComplete = bool(row.bothLayersDeadTimeComplete);
    if (definitions[questCode] !== eventType || bothLayersDeadCount > outboxDeadCount
      || outboxDeadCount === 0 && oldestOutboxLastStateAt !== null
      || bothLayersDeadCount === 0 && oldestBothLayersDeadObservedAt !== null
      || !bothLayersDeadTimeComplete && oldestBothLayersDeadObservedAt !== null) invalid();
    return { questCode, eventType, outboxDeadCount, bothLayersDeadCount, oldestOutboxLastStateAt,
      oldestBothLayersDeadObservedAt, bothLayersDeadTimeComplete };
  });
  if (types.length !== 5 || new Set(types.map(row => row.questCode)).size !== 5) invalid();
  return { types };
}
