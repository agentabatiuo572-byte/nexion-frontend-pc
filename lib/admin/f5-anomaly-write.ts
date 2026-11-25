import { createA2CommandKey } from "./a2-client";
import { fetchF5CommissionAuditOverview, updateF5AnomalyConfig } from "./f1-client";
import { fDirectCommands, F1OutcomeUncertainError, isF1OutcomeUncertainError, type FDirectAttempt } from "./f1-stable-write";
import { hasPersistedPendingCommandOwner } from "./pending-mutation-store";
import { createFDirectRecovery, fDirectReceiptConclusion } from "./f-direct-recovery";
import { activeRecoveryActor } from "./f-proposal-recovery";
import { isDeterministicRejection } from "./outcome-classification";
import type { F5ConfirmationSnapshot } from "./f5-approval";
import { useAdminAuth } from "../store/admin-auth";
import { fundCommandOrigin, fundCommandResult, type FundCommandEvidence } from "./fund-command-investigation";
import { queryOriginalCommand } from "./original-command-query";

const anomalyRoute = { originalMethod: "PUT", originalPath: "/api/admin/commissions/anomaly-config", readAuthority: "network_f5_read" } as const;

export function listF5AnomalyWrites(adminId: number) {
  return fDirectCommands.list().filter(row => row.fingerprint === `${adminId}:f5-anomaly-config`
    || row.fingerprint === "f5-anomaly-config" && (row.adminId === adminId
      || row.adminId === undefined && hasPersistedPendingCommandOwner(String(adminId)))).map(row => ({ ...row, adminId }));
}

const SCOPE = "F5_COMMISSION_ANOMALY_CONFIG";
export const f5AnomalyRecovery = createFDirectRecovery(fDirectCommands, () => SCOPE, original =>
  !!original.f5Request && !!activeRecoveryActor(original.adminId, "network_f5_read")?.authorities.includes("network_f5_write"));
export const canRetryF5Anomaly = (original: FDirectAttempt) => !f5AnomalyRecovery.state(original).replayBlock;

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
    fDirectCommands.remember(slot, key, { adminId, f5Request: request, f5Snapshot: snapshot, inputFingerprint: JSON.stringify(request),
      commandOrigin: fundCommandOrigin(anomalyRoute.originalMethod, anomalyRoute.originalPath, anomalyRoute.readAuthority) });
    original = listF5AnomalyWrites(adminId)[0];
    if (!fDirectCommands.isDurablyStored(slot, key)) {
      fDirectCommands.forget(slot, key);
      throw new Error("F5_OPERATION_STORAGE_UNAVAILABLE");
    }
  }
  if (!original.f5Request || !fDirectCommands.isDurablyStored(original.fingerprint, original.commandKey)) throw new Error("F5_OPERATION_ORIGINAL_INCOMPLETE");
  const send = async (record: FDirectAttempt) => {
    const request = record.f5Request!;
    const receipt = await updateF5AnomalyConfig(request.commissionAnomalySigma, request.layerRatioAnomalyPct, request.reason, request.operator, record.commandKey);
    if (typeof receipt.operationNo !== "string" || !receipt.operationNo || Number(receipt.commissionAnomalySigma) !== request.commissionAnomalySigma
      || Number(receipt.layerRatioAnomalyPct) !== request.layerRatioAnomalyPct) throw new F1OutcomeUncertainError("保存后返回的内容和原请求对不上，请继续核对。", record.commandKey);
  };
  try {
    if (recovering) await f5AnomalyRecovery.replay(original, send);
    else await send(original);
  } catch (error) {
    const failure = error as { httpStatus?: number; apiCode?: number };
    if (!recovering && !isF1OutcomeUncertainError(error)
      && failure.httpStatus !== undefined && isDeterministicRejection(failure.httpStatus, failure.apiCode)) fDirectCommands.forget(original.fingerprint, original.commandKey);
    throw error;
  }
  f5AnomalyRecovery.settleAcknowledged(original);
}

/** Current thresholds are comparison evidence, not a receipt proving that the original PUT did not execute. */
export async function queryF5Anomaly(adminId: number, original: FDirectAttempt, evidence?: FundCommandEvidence) {
  const auth = useAdminAuth.getState();
  if (!auth.isAuthenticated || auth.logoutPending || auth.session?.adminId !== adminId || original.adminId !== adminId) throw new Error("ADMIN_PERMISSION_DENIED");
  const query = (original: FDirectAttempt) => queryOriginalCommand(original.commandOrigin ? { ...original, commandOrigin: { ...original.commandOrigin, originalPath: anomalyRoute.originalPath } } : original, anomalyRoute, String(adminId), evidence);
  const result = await f5AnomalyRecovery.query(original, async record => {
    const receipt = await query(record);
    const state = fundCommandResult(receipt);
    const conclusion = state === "SUCCEEDED" ? "succeeded" : state === "REJECTED" ? "rejected"
      : state === "NOT_EXECUTED" ? "not-executed" : evidence || receipt
        ? "unknown" : await fDirectReceiptConclusion(SCOPE, record.commandKey, adminId);
    return { conclusion, receipt, current: await fetchF5CommissionAuditOverview() };
  });
  if (!result) throw new Error("PENDING_QUERY_UNAVAILABLE");
  const settled = f5AnomalyRecovery.settleFromQuery(original, result.conclusion);
  return { ...result, settled };
}
