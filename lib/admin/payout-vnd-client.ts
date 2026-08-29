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
