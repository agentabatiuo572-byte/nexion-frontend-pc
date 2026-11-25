import { createA2CommandKey } from "./a2-client";
import { explicitRejectionCode } from "./explicit-rejection";
import { downloadF5RedactedCsv, type F5CommissionQuery } from "./f1-client";
import { fDirectCommands } from "./f1-stable-write";
import { activeRecoveryActor } from "./f-proposal-recovery";
import { createPendingRecovery } from "./pending-mutation-store";

const slot = "f5-export";
const canExport = (adminId: number | undefined) => activeRecoveryActor(adminId, "network_f5_read")?.authorities.includes("network_f5_export");
export const pendingF5Export = () => fDirectCommands.list().find(row => row.fingerprint === slot);
export const f5ExportRecovery = createPendingRecovery(fDirectCommands, {
  capability: record => record.f5ExportRequest ? "replay" : "readback",
  canReplay: record => !!record.f5ExportRequest && !!canExport(record.commandOwnerId),
  explicitRejectionCode,
});

export async function submitF5Export(adminId: number | undefined, query: F5CommissionQuery, reason: string) {
  if (!canExport(adminId)) throw new Error("ADMIN_PERMISSION_DENIED");
  const original = pendingF5Export();
  if (original) {
    const result = await f5ExportRecovery.replay(original, record =>
      downloadF5RedactedCsv(record.f5ExportRequest!.filters, record.f5ExportRequest!.reason, record.commandKey));
    f5ExportRecovery.settleAcknowledged(original);
    return result;
  }
  const filters = {
    kind: query.kind?.trim() || undefined,
    currency: query.currency?.trim() || undefined,
    userId: query.userId?.trim() || undefined,
    cohort: query.cohort?.trim() || undefined,
    status: query.status?.trim() || undefined,
  };
  const key = createA2CommandKey(slot);
  fDirectCommands.remember(slot, key, { inputFingerprint: JSON.stringify([filters]), f5ExportRequest: { filters, reason } });
  const saved = pendingF5Export();
  if (!saved || saved.commandKey !== key || !fDirectCommands.isDurablyStored(slot, key)) {
    fDirectCommands.forget(slot, key);
    throw new Error("F5_OPERATION_STORAGE_UNAVAILABLE");
  }
  try {
    const result = await downloadF5RedactedCsv(filters, reason, key);
    f5ExportRecovery.settleAcknowledged(saved);
    return result;
  } catch (error) {
    if (explicitRejectionCode(error)) fDirectCommands.forget(slot, key);
    throw error;
  }
}
