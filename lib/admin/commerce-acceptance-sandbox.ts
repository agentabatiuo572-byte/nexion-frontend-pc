import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";

export type CommerceAcceptanceEvent =
  | "PAYMENT_SUCCEEDED"
  | "PAYMENT_FAILED"
  | "EXPIRED"
  | "FULFILLMENT_SUCCEEDED"
  | "FULFILLMENT_FAILED"
  | "REFUNDED";

export interface CommerceAcceptanceCallbackResult {
  orderNo: string;
  event: CommerceAcceptanceEvent;
  canonicalStatus: string;
  version: number;
  source: "mock";
  sourceEnvironment: "SANDBOX";
  walletAfter: number | null;
}

export interface CommerceAcceptanceSandboxOrder {
  orderNo: string; productNo: string; quantity: number; amountUsdt: number; state: string; version: number;
}

export interface CommerceAcceptanceSandboxPage { runId: string; orders: CommerceAcceptanceSandboxOrder[]; }

export async function fetchCommerceAcceptanceSandboxOrders(): Promise<CommerceAcceptanceSandboxPage> {
  const response = await guardedFetch("/api/admin/commerce/acceptance/sandbox-orders", { cache: "no-store" });
  const result = await response.json().catch(() => null) as { code?: number; data?: { source?: string; sourceEnvironment?: string; runId?: string; orders?: CommerceAcceptanceSandboxOrder[] } } | null;
  if (!response.ok || result?.code !== 0 || result.data?.source !== "mock" || result.data.sourceEnvironment !== "SANDBOX" || !result.data.runId || !Array.isArray(result.data.orders)) {
    throw new Error("COMMERCE_SANDBOX_LIST_UNAVAILABLE");
  }
  return { runId: result.data.runId, orders: result.data.orders };
}

/** A deliberately narrow client: it is not a production payment-provider API. */
export async function postCommerceAcceptanceCallback(
  orderNo: string,
  input: { eventId: string; status: CommerceAcceptanceEvent; expectedVersion: number; reason: string },
): Promise<CommerceAcceptanceCallbackResult> {
  const response = await guardedFetch(
    `/api/admin/commerce/acceptance/sandbox-orders/${encodeURIComponent(orderNo)}/callbacks`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      cache: "no-store",
    },
  );
  const result = await response.json().catch(() => null) as {
    code?: number; message?: string; data?: CommerceAcceptanceCallbackResult;
  } | null;
  if (!response.ok || !result || result.code !== 0 || !result.data) {
    throw new Error(formatAdminApiError(result?.message, `COMMERCE_SANDBOX_CALLBACK_FAILED_${response.status}`));
  }
  return result.data;
}
