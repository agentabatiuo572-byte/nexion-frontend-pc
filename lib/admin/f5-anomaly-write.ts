import { createA2CommandKey } from "./a2-client";
import { fetchF5CommissionAuditOverview, updateF5AnomalyConfig } from "./f1-client";
import { fDirectCommands, F1OutcomeUncertainError, isF1OutcomeUncertainError, type FDirectAttempt } from "./f1-stable-write";
import { hasPersistedPendingCommandOwner, isRetryExpired } from "./pending-mutation-store";
import { isExplicitRejection } from "./explicit-rejection";
import { isDeterministicRejection } from "./outcome-classification";
import type { F5ConfirmationSnapshot } from "./f5-approval";
import { useAdminAuth } from "../store/admin-auth";

export function listF5AnomalyWrites(adminId: number) {
  return fDirectCommands.list().filter(row => row.fingerprint === `${adminId}:f5-anomaly-config`
    || row.fingerprint === "f5-anomaly-config" && (row.adminId === adminId
      || row.adminId === undefined && hasPersistedPendingCommandOwner(String(adminId)))).map(row => ({ ...row, adminId }));
}

export function canRetryF5Anomaly(original: FDirectAttempt) {
  const auth = useAdminAuth.getState();
  return auth.isAuthenticated && !auth.logoutPending && !!auth.session && auth.session.adminId === original.adminId
    && auth.session.authorities.includes("network_f5_write") && !!original.f5Request && !isRetryExpired(original);
}

export async function sendF5Anomaly(adminId: number, values?: { commissionAnomalySigma: number; layerRatioAnomalyPct: number; reason: string }, snapshot?: F5ConfirmationSnapshot) {
  const auth = useAdminAuth.getState();
  if (!auth.isAuthenticated || auth.logoutPending || auth.session?.adminId !== adminId || !auth.session.authorities.includes("network_f5_write")) throw new Error("ADMIN_PERMISSION_DENIED");
  let original = listF5AnomalyWrites(adminId)[0];
  const recovering = !values;
  if (values && original) throw new F1OutcomeUncertainError("请先查询保存的原操作。", original.commandKey);
  if (!original) {
    if (!values) throw new Error("F5_OPERATION_ORIGINAL_INCOMPLETE");
    const request = { ...values, operator: auth.session.operator || auth.session.username };
    const slot = `${adminId}:f5-anomaly-config`, key = createA2CommandKey("f5-anomaly-config");
    fDirectCommands.remember(slot, key, { adminId, f5Request: request, f5Snapshot: snapshot, inputFingerprint: JSON.stringify(request) });
    original = listF5AnomalyWrites(adminId)[0];
    if (!fDirectCommands.isDurablyStored(slot, key)) {
      fDirectCommands.forget(slot, key);
      throw new Error("F5_OPERATION_STORAGE_UNAVAILABLE");
    }
  }
  if (isRetryExpired(original)) throw new F1OutcomeUncertainError("原操作已超过 24 小时，只能读回核对。", original.commandKey);
  if (!original.f5Request || !fDirectCommands.isDurablyStored(original.fingerprint, original.commandKey)) throw new Error("F5_OPERATION_ORIGINAL_INCOMPLETE");
  const request = original.f5Request;
  try {
    const receipt = await updateF5AnomalyConfig(request.commissionAnomalySigma, request.layerRatioAnomalyPct, request.reason, request.operator, original.commandKey);
    if (typeof receipt.operationNo !== "string" || !receipt.operationNo || Number(receipt.commissionAnomalySigma) !== request.commissionAnomalySigma
      || Number(receipt.layerRatioAnomalyPct) !== request.layerRatioAnomalyPct) throw new F1OutcomeUncertainError("保存回执与原请求对不上，请继续核对。", original.commandKey);
  } catch (error) {
    const failure = error as { httpStatus?: number; apiCode?: number };
    if (recovering ? isExplicitRejection(error) : !isF1OutcomeUncertainError(error)
      && failure.httpStatus !== undefined && isDeterministicRejection(failure.httpStatus, failure.apiCode)) fDirectCommands.forget(original.fingerprint, original.commandKey);
    throw error;
  }
  fDirectCommands.forget(original.fingerprint, original.commandKey);
}

/** Current thresholds are comparison evidence, not a receipt proving that the original PUT did not execute. */
export async function queryF5Anomaly(adminId: number, original: FDirectAttempt) {
  const auth = useAdminAuth.getState();
  if (!auth.isAuthenticated || auth.logoutPending || auth.session?.adminId !== adminId || original.adminId !== adminId) throw new Error("ADMIN_PERMISSION_DENIED");
  return fetchF5CommissionAuditOverview();
}
