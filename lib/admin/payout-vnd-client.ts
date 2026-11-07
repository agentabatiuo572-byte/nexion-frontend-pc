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

/** commandKey 由页面持有：结果未知时页面保留原命令号和原内容，只能原样重试（OP-92、OP-94）。 */
export async function updatePayoutVndConfig(
  values: PayoutVndValues,
  expectedVersion: number,
  reason: string,
  forceInverted: boolean,
  commandKey: string,
): Promise<PayoutVndConfig> {
  const payload = { ...values, expectedVersion, reason, forceInverted };
  return normalizeServerConfig(await financeAdminRequest<unknown>("/payout-vnd/config", {
    method: "PATCH",
    body: JSON.stringify(payload),
    idempotencyKey: commandKey,
  }));
}
