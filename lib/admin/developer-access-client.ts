import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
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
  reviewer?: string | null;
  reviewReason?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  updatedAt: string;
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

type Envelope<T> = { code: number; message?: string; data?: T };

export class DeveloperAccessOutcomeUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DeveloperAccessOutcomeUnknownError";
  }
}

export function isDeveloperAccessOutcomeUnknownError(cause: unknown): cause is DeveloperAccessOutcomeUnknownError {
  return cause instanceof DeveloperAccessOutcomeUnknownError;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await guardedFetch(`/api/admin/developer/access-requests${path}`, {
    ...init,
    cache: "no-store",
    signal: init?.signal ?? AbortSignal.timeout(12_000),
  });
  const envelope = await response.json().catch(() => null) as Envelope<T> | null;
  if (!response.ok || !envelope || envelope.code !== 0 || envelope.data === undefined) {
    if (isAdminAuthFailure(response.status, envelope?.message)) resetAdminSession();
    const message = formatAdminApiError(envelope?.message, `DEVELOPER_ACCESS_REQUEST_FAILED_${response.status}`);
    if (outcomeStaysUnknown(response.status, envelope?.code)) {
      throw new DeveloperAccessOutcomeUnknownError(message);
    }
    throw new Error(message);
  }
  return envelope.data;
}

export function fetchDeveloperAccessRequests(query: DeveloperAccessQuery = {}) {
  const params = new URLSearchParams({
    pageNum: String(query.pageNum ?? 1),
    pageSize: String(query.pageSize ?? 20),
  });
  if (query.status) params.set("status", query.status);
  if (query.keyword?.trim()) params.set("keyword", query.keyword.trim());
  if (query.sourceEnvironment) params.set("sourceEnvironment", query.sourceEnvironment);
  return request<DeveloperAccessPage>(`?${params.toString()}`);
}

function mutation(action: "approve" | "reject" | "revoke", row: DeveloperAccessRequest,
                  reason: string, idempotencyKey: string) {
  if (!canReviewDeveloperAccess(row.status, action)) {
    throw new Error("DEVELOPER_ACCESS_REQUEST_STATE_CONFLICT");
  }
  return request<DeveloperAccessRequest>(`/${encodeURIComponent(row.requestNo)}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ expectedStatus: row.status, reason }),
  });
}

export function approveDeveloperAccess(row: DeveloperAccessRequest, reason: string, key: string) {
  return mutation("approve", row, reason, key);
}

export function rejectDeveloperAccess(row: DeveloperAccessRequest, reason: string, key: string) {
  return mutation("reject", row, reason, key);
}

export function revokeDeveloperAccess(row: DeveloperAccessRequest, reason: string, key: string) {
  return mutation("revoke", row, reason, key);
}
