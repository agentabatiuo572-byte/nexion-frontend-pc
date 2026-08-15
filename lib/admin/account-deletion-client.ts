import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { createSlotAttemptStore } from "@/lib/admin/pending-mutation-store";
import { outcomeStaysUnknown } from "@/lib/admin/outcome-classification";

export const ACCOUNT_DELETION_STATUSES = ["REQUESTED", "IN_REVIEW", "BLOCKED", "COMPLETED", "CANCELLED"] as const;
export type AccountDeletionStatus = typeof ACCOUNT_DELETION_STATUSES[number];

export interface AccountDeletionRequest {
  requestNo: string;
  userId: number;
  status: AccountDeletionStatus | string;
  version: number;
  requestedAt?: string | null;
  reviewedAt?: string | null;
  completedAt?: string | null;
  reason?: string | null;
  sessionsRevoked?: boolean;
  accountDisabled?: boolean;
}

export interface AccountDeletionPage {
  records: AccountDeletionRequest[];
  total: number;
  page: number;
  limit: number;
}

interface ApiResult<T> { code: number; message?: string; data?: T; }

export class AccountDeletionRequestError extends Error {
  constructor(public readonly status: number, public readonly apiCode: number | undefined, message: string) {
    super(message);
    this.name = "AccountDeletionRequestError";
  }
}

const commandAttempts = createSlotAttemptStore({ storageKey: "nexion-admin-account-deletion-commands-v1" });

function commandKey(requestNo: string, action: string) {
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `account-deletion-${action}-${requestNo}-${random}`;
}

function normalizeRow(raw: unknown): AccountDeletionRequest {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("ACCOUNT_DELETION_RESPONSE_INVALID");
  const row = raw as Record<string, unknown>;
  const requestNo = typeof row.requestNo === "string" ? row.requestNo.trim() : "";
  const userId = Number(row.userId);
  const version = Number(row.version);
  if (!requestNo || !Number.isSafeInteger(userId) || !Number.isSafeInteger(version) || version < 0) {
    throw new Error("ACCOUNT_DELETION_RESPONSE_INVALID");
  }
  return { ...row, requestNo, userId, version, status: typeof row.status === "string" ? row.status : "UNKNOWN" } as AccountDeletionRequest;
}

function normalizePage(raw: unknown, page: number, limit: number): AccountDeletionPage {
  const root = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const recordsRaw = Array.isArray(root.records) ? root.records : Array.isArray(root.items) ? root.items : Array.isArray(raw) ? raw : [];
  return {
    records: recordsRaw.map(normalizeRow),
    total: Number(root.total ?? recordsRaw.length) || 0,
    page: Number(root.page ?? root.pageNum ?? page) || page,
    limit: Number(root.limit ?? root.pageSize ?? limit) || limit,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await guardedFetch(path, { ...init, cache: "no-store" });
  const result = await response.json().catch(() => null) as ApiResult<T> | null;
  if (!response.ok || !result || result.code !== 0) {
    const error = new AccountDeletionRequestError(
      response.status,
      result?.code,
      formatAdminApiError(result?.message, `ACCOUNT_DELETION_REQUEST_FAILED_${response.status}`),
    );
    throw error;
  }
  return result.data as T;
}

export async function fetchAccountDeletions(status: AccountDeletionStatus | "", page = 1, limit = 20) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (status) params.set("status", status);
  const data = await request<unknown>(`/api/admin/users/account-deletions?${params}`);
  return normalizePage(data, page, limit);
}

export async function fetchAccountDeletion(requestNo: string) {
  return normalizeRow(await request<unknown>(`/api/admin/users/account-deletions/${encodeURIComponent(requestNo)}`));
}

export async function updateAccountDeletion(
  requestNo: string,
  action: "review" | "block" | "complete" | "cancel",
  expectedVersion: number,
  reason: string,
) {
  const normalizedReason = reason.trim();
  if (!requestNo.trim() || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || normalizedReason.length < 1) {
    throw new Error("ACCOUNT_DELETION_COMMAND_INVALID");
  }
  const slot = `account-deletion:${requestNo}:${action}`;
  const fingerprint = JSON.stringify({ expectedVersion, reason: normalizedReason });
  const idempotencyKey = commandAttempts.resolve(slot, fingerprint, () => commandKey(requestNo, action));
  try {
    const data = await request<unknown>(`/api/admin/users/account-deletions/${encodeURIComponent(requestNo)}/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ expectedVersion, reason: normalizedReason }),
    });
    commandAttempts.forget(slot);
    return normalizeRow(data);
  } catch (cause) {
    if (cause instanceof AccountDeletionRequestError && !outcomeStaysUnknown(cause.status, cause.apiCode)) {
      commandAttempts.forget(slot);
    }
    // Keep the same key for an unknown network/result; a changed version/reason creates a new intent.
    throw cause;
  }
}
