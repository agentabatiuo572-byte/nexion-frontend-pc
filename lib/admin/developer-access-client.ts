import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { displayAdminReadError, formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import { canReviewDeveloperAccess, developerAccessResourceGuard } from "@/lib/admin/developer-access-policy";
export { canReviewDeveloperAccess, developerAccessResourceGuard } from "@/lib/admin/developer-access-policy";

export type DeveloperAccessStatus = "PENDING" | "APPROVED" | "REJECTED" | "REVOKED" | "EXPIRED";
export type DeveloperAccessRequest = {
  requestNo: string;
  userId: number;
  company: string;
  email: string;
  useCase: string;
  status: DeveloperAccessStatus;
  sourceEnvironment: "PRODUCTION" | "SANDBOX";
  runId: string;
  reviewer: string | null;
  reviewReason: string | null;
  reviewedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  source: "server";
};

export type DeveloperAccessPage = {
  total: number;
  pageNum: number;
  pageSize: number;
  records: DeveloperAccessRequest[];
};

export type DeveloperAccessQuery = {
  pageNum?: number;
  pageSize?: number;
  status?: DeveloperAccessStatus;
  keyword?: string;
  sourceEnvironment?: "PRODUCTION" | "SANDBOX";
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("DEVELOPER_ACCESS_RESPONSE_INVALID");
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string") throw new Error("DEVELOPER_ACCESS_RESPONSE_INVALID");
  return value;
}

function count(value: unknown, min = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min) throw new Error("DEVELOPER_ACCESS_RESPONSE_INVALID");
  return value;
}

function nullableText(value: unknown) { return value === null ? null : text(value); }
function timestamp(value: unknown) {
  const result = nullableText(value);
  if (result !== null && !Number.isFinite(Date.parse(result))) throw new Error("DEVELOPER_ACCESS_RESPONSE_INVALID");
  return result;
}

export function parseDeveloperAccessRequest(value: unknown): DeveloperAccessRequest {
  const row = object(value), status = text(row.status), environment = text(row.sourceEnvironment);
  if (!["PENDING", "APPROVED", "REJECTED", "REVOKED", "EXPIRED"].includes(status)
    || !["PRODUCTION", "SANDBOX"].includes(environment) || row.source !== "server"
    || !/^DEV-[A-Z0-9]{16}$/.test(text(row.requestNo))) throw new Error("DEVELOPER_ACCESS_RESPONSE_INVALID");
  return {
    requestNo: row.requestNo as string, userId: count(row.userId, 1), company: text(row.company), email: text(row.email),
    useCase: text(row.useCase), status: status as DeveloperAccessStatus, sourceEnvironment: environment as DeveloperAccessRequest["sourceEnvironment"],
    runId: text(row.runId), reviewer: nullableText(row.reviewer), reviewReason: nullableText(row.reviewReason),
    reviewedAt: timestamp(row.reviewedAt), createdAt: timestamp(row.createdAt), updatedAt: timestamp(row.updatedAt), source: "server",
  };
}

/** OpsDeveloperAccessService.text uses Spring hasText followed by Java String.trim; length is UTF-16. */
export function normalizeDeveloperAccessReason(value: string): string {
  if (/^[\u0009-\u000d\u001c-\u0020\u1680\u2000-\u2006\u2008-\u200a\u2028\u2029\u205f\u3000]*$/.test(value)) return "";
  return value.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "");
}

export class DeveloperAccessRequestError extends Error {
  constructor(message: string, readonly status: number, readonly backendMessage?: string, readonly apiCode?: number) {
    super(message);
    this.name = "DeveloperAccessRequestError";
  }
}

export class DeveloperAccessOutcomeUnknownError extends DeveloperAccessRequestError {
  readonly unknownOutcome = true;
}

export function isDeveloperAccessOutcomeUnknownError(cause: unknown): cause is DeveloperAccessOutcomeUnknownError {
  return cause instanceof DeveloperAccessOutcomeUnknownError;
}

async function request<T>(path: string, parse: (value: unknown) => T, init?: RequestInit): Promise<T> {
  const writing = init?.method === "POST";
  const response = await guardedFetch(`/api/admin/developer/access-requests${path}`, {
    ...init,
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(12_000),
  }).catch((cause: Error) => {
    if (writing) throw new DeveloperAccessOutcomeUnknownError(cause.message, 0);
    throw new Error(displayAdminReadError(cause));
  });
  const raw: unknown = await response.json().catch(() => null);
  const envelope = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as { code?: unknown; message?: unknown; data?: unknown } : null;
  const code = typeof envelope?.code === "number" ? envelope.code : undefined;
  const backendMessage = typeof envelope?.message === "string" ? envelope.message : undefined;
  if (!response.ok || code !== 0 || envelope?.data == null) {
    if (isAdminAuthFailure(response.status, backendMessage)) resetAdminSession();
    const message = formatAdminApiError(backendMessage, `DEVELOPER_ACCESS_REQUEST_FAILED_${response.status}`);
    if (!writing) throw new Error(displayAdminReadError(message));
    if (outcomeStaysUnknown(response.status, code)
      || backendMessage?.startsWith("DEVELOPER_ACCESS_IDEMPOTENCY_") || backendMessage === "DEVELOPER_ACCESS_RESULT_UNKNOWN") {
      throw new DeveloperAccessOutcomeUnknownError(message, response.status, backendMessage, code);
    }
    throw new DeveloperAccessRequestError(message, response.status, backendMessage, code);
  }
  try {
    return parse(envelope.data);
  } catch {
    const message = formatAdminApiError(writing ? "DEVELOPER_ACCESS_RESPONSE_INVALID" : "DEVELOPER_ACCESS_READ_RESPONSE_INVALID", "");
    if (writing) throw new DeveloperAccessOutcomeUnknownError(message, response.status);
    throw new Error(displayAdminReadError(message));
  }
}

export function fetchDeveloperAccessRequests(query: DeveloperAccessQuery = {}) {
  const params = new URLSearchParams({
    pageNum: String(query.pageNum ?? 1),
    pageSize: String(query.pageSize ?? 20),
  });
  if (query.status) params.set("status", query.status);
  if (query.keyword?.trim()) params.set("keyword", query.keyword.trim());
  if (query.sourceEnvironment) params.set("sourceEnvironment", query.sourceEnvironment);
  return request<DeveloperAccessPage>(`?${params.toString()}`, value => {
    const result = object(value), pageSize = count(result.pageSize, 1);
    if (pageSize > 200 || !Array.isArray(result.records)) throw new Error("DEVELOPER_ACCESS_RESPONSE_INVALID");
    return { total: count(result.total), pageNum: count(result.pageNum, 1), pageSize, records: result.records.map(parseDeveloperAccessRequest) };
  });
}

function mutation(action: "approve" | "reject" | "revoke", row: DeveloperAccessRequest,
                  reason: string, idempotencyKey: string, body = JSON.stringify({ expectedStatus: row.status, reason })) {
  if (!canReviewDeveloperAccess(row.status, action)) {
    throw new Error("DEVELOPER_ACCESS_REQUEST_STATE_CONFLICT");
  }
  return request<DeveloperAccessRequest>(`/${encodeURIComponent(row.requestNo)}/${action}`, value => {
    const result = parseDeveloperAccessRequest(value);
    const expected = { approve: "APPROVED", reject: "REJECTED", revoke: "REVOKED" }[action];
    if (result.requestNo !== row.requestNo || result.status !== expected || result.reviewReason !== normalizeDeveloperAccessReason(reason)) {
      throw new Error("DEVELOPER_ACCESS_RESPONSE_INVALID");
    }
    return result;
  }, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body,
  });
}

export function approveDeveloperAccess(row: DeveloperAccessRequest, reason: string, key: string, body?: string) {
  return mutation("approve", row, reason, key, body);
}

export function rejectDeveloperAccess(row: DeveloperAccessRequest, reason: string, key: string, body?: string) {
  return mutation("reject", row, reason, key, body);
}

export function revokeDeveloperAccess(row: DeveloperAccessRequest, reason: string, key: string, body?: string) {
  return mutation("revoke", row, reason, key, body);
}
