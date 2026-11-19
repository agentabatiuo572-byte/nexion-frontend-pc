import { useAdminAuth } from "@/lib/store/admin-auth";
import { formatAdminApiError, guardedFetch } from "./error-messages";

export type DirectCommandReceiptState = "NOT_FOUND" | "UNKNOWN" | "PROCESSING" | "SUCCEEDED" | "REJECTED" | "NOT_EXECUTED" | "FAILED";

export type DirectCommandReceipt =
  | { state: Exclude<DirectCommandReceiptState, "REJECTED"> }
  | { state: "REJECTED"; businessCode?: number; businessMessage?: string };

export async function fetchDirectCommandReceipt(scope: string, commandKey: string, actorId: number): Promise<DirectCommandReceiptState> {
  return (await fetchDirectCommandReceiptDetails(scope, commandKey, actorId)).state;
}

/** Read the owner's original command, including expired receipts; never replay a write or return its payload. */
export async function fetchDirectCommandReceiptDetails(scope: string, commandKey: string, actorId: number): Promise<DirectCommandReceipt> {
  const requireActor = () => {
    const auth = useAdminAuth.getState(), session = auth.session;
    if (!auth.isAuthenticated || auth.logoutPending || auth.logoutUnknown || !session || session.passwordChangeRequired
      || session.adminId !== actorId) throw new Error("COMMAND_INVESTIGATION_FORBIDDEN");
  };
  requireActor();
  const params = new URLSearchParams({ scope, commandKey });
  const response = await guardedFetch(`/api/admin/commands/investigations/receipt-status?${params}`, {
    cache: "no-store", signal: AbortSignal.timeout(12_000),
  });
  if (response.headers.get("X-Nexion-Upstream-Outcome")?.trim().toLowerCase() === "unknown") throw new Error("IDEMPOTENCY_RESULT_UNKNOWN");
  const raw: unknown = await response.json();
  requireActor();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
  const result = raw as { code?: unknown; message?: unknown; data?: unknown };
  if (!response.ok || result.code !== 0) {
    const code = typeof result.message === "string" ? result.message : "";
    throw Object.assign(new Error(formatAdminApiError(code, "INVESTIGATION_RECEIPT_UNREADABLE")), {
      status: response.ok && typeof result.code === "number" ? result.code : response.status, backendMessage: code,
    });
  }
  if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
  const { state, businessCode, businessMessage } = result.data as Record<string, unknown>;
  if (typeof state !== "string" || !["NOT_FOUND", "UNKNOWN", "PROCESSING", "SUCCEEDED", "REJECTED", "NOT_EXECUTED", "FAILED"].includes(state)) throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
  if (state !== "REJECTED") return { state: state as Exclude<DirectCommandReceiptState, "REJECTED"> };
  return {
    state,
    businessCode: typeof businessCode === "number" && Number.isSafeInteger(businessCode) && businessCode !== 0 ? businessCode : undefined,
    businessMessage: typeof businessMessage === "string" && businessMessage.trim() ? businessMessage : undefined,
  };
}
