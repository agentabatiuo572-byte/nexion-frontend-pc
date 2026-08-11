import { financeAdminRequest } from "./d-client";
import {
  normalizePayoutVndConfig,
  type PayoutVndConfig,
  type PayoutVndValues,
} from "./payout-vnd-contract";
import { displayAdminError, formatAdminApiError } from "./error-messages";

function normalizeServerConfig(value: unknown): PayoutVndConfig {
  try {
    return normalizePayoutVndConfig(value);
  } catch (error) {
    const message = error instanceof Error
      ? formatAdminApiError(error.message, "D7_RESPONSE_INVALID")
      : displayAdminError(error);
    throw new Error(message);
  }
}

export async function loadPayoutVndConfig(): Promise<PayoutVndConfig> {
  return normalizeServerConfig(await financeAdminRequest<unknown>("/payout-vnd/config"));
}

export async function updatePayoutVndConfig(
  values: PayoutVndValues,
  expectedVersion: number,
  reason: string,
  forceInverted = false,
): Promise<PayoutVndConfig> {
  const payload = { ...values, expectedVersion, reason, forceInverted };
  return normalizeServerConfig(await financeAdminRequest<unknown>("/payout-vnd/config", {
    method: "PATCH",
    body: JSON.stringify(payload),
    idempotencyPrefix: "d7-payout-config",
  }));
}

export async function togglePayoutVndChannel(
  enabled: boolean,
  expectedVersion: number,
  reason: string,
): Promise<PayoutVndConfig> {
  return normalizeServerConfig(await financeAdminRequest<unknown>("/payout-vnd/channel", {
    method: "PATCH",
    body: JSON.stringify({ enabled, expectedVersion, reason }),
    idempotencyPrefix: "d7-payout-channel",
  }));
}

export type PayoutVndSandboxOrder = {
  orderNo: string;
  userId: number;
  amountVnd: number;
  bankCode: string;
  accountNoMasked: string;
  accountName: string;
  status: string;
  source: "mock";
  sandbox: true;
  sandboxCallbackEventId?: string;
  sandboxCallbackSignature?: string;
};

export async function loadPayoutVndSandboxOrders(userId: number) {
  return financeAdminRequest<{ userId: number; orders: PayoutVndSandboxOrder[]; source: "mock"; sandbox: true }>(
    `/payout-vnd/sandbox/orders?userId=${encodeURIComponent(String(userId))}`,
  );
}

export async function createPayoutVndSandboxOrder(input: {
  userId: number; amountVnd: number; bankCode: string; accountNo: string; accountName: string; reason: string;
}) {
  return financeAdminRequest<PayoutVndSandboxOrder>("/payout-vnd/sandbox/orders", {
    method: "POST",
    body: JSON.stringify(input),
    idempotencyPrefix: "d7-payout-sandbox-order",
  });
}

export async function completePayoutVndSandboxOrder(order: PayoutVndSandboxOrder) {
  if (!order.sandboxCallbackEventId || !order.sandboxCallbackSignature) throw new Error("D7_SANDBOX_CALLBACK_RECEIPT_MISSING");
  return financeAdminRequest<PayoutVndSandboxOrder>("/payout-vnd/sandbox/callbacks", {
    method: "POST",
    body: JSON.stringify({
      eventId: order.sandboxCallbackEventId,
      orderNo: order.orderNo,
      status: "COMPLETED",
      signature: order.sandboxCallbackSignature,
    }),
    idempotencyPrefix: "d7-payout-sandbox-callback",
  });
}
