import { createA2CommandKey } from "./a2-client";
import { fetchF4AmbassadorPolicy, updateF4AmbassadorPolicy, type F4AmbassadorPolicyUpdate } from "./f1-client";
import { fDirectCommands, F1OutcomeUncertainError, isF1OutcomeUncertainError, type FDirectAttempt } from "./f1-stable-write";
import { hasPersistedPendingCommandOwner, isRetryExpired } from "./pending-mutation-store";
import { isExplicitRejection } from "./explicit-rejection";
import { isDeterministicRejection } from "./outcome-classification";
import type { F4ConfirmationSnapshot } from "./f4-approval";
import { useAdminAuth } from "../store/admin-auth";

export function listF4PolicyWrites(adminId: number) {
  return fDirectCommands.list().filter(row => row.fingerprint === `${adminId}:f4-ambassador-policy`
    || row.fingerprint === "f4-ambassador-policy" && (row.adminId === adminId
      || row.adminId === undefined && hasPersistedPendingCommandOwner(String(adminId)))).map(row => ({ ...row, adminId }));
}

export function canRetryF4Policy(original: FDirectAttempt) {
  const auth = useAdminAuth.getState();
  return auth.isAuthenticated && !auth.logoutPending && !!auth.session && auth.session.adminId === original.adminId
    && auth.session.authorities.includes("network_f4_pool_fund") && !!original.f4Request && !isRetryExpired(original);
}

export async function sendF4Policy(adminId: number, policy?: F4AmbassadorPolicyUpdate, reason?: string, snapshot?: F4ConfirmationSnapshot) {
  const auth = useAdminAuth.getState();
  if (!auth.isAuthenticated || auth.logoutPending || auth.session?.adminId !== adminId
    || !auth.session.authorities.includes("network_f4_pool_fund")) throw new Error("ADMIN_PERMISSION_DENIED");
  let original = listF4PolicyWrites(adminId)[0];
  const recovering = !policy;
  if (policy && original) throw new F1OutcomeUncertainError("请先查询保存的原操作。", original.commandKey);
  if (!original) {
    if (!policy || reason === undefined) throw new Error("F4_PROPOSAL_ORIGINAL_INCOMPLETE");
    const request = { ...policy, reason, operator: auth.session.operator || auth.session.username };
    const slot = `${adminId}:f4-ambassador-policy`, key = createA2CommandKey("f4-ambassador-policy");
    fDirectCommands.remember(slot, key, { adminId, inputFingerprint: JSON.stringify(request), f4Request: request, f4Snapshot: snapshot });
    original = listF4PolicyWrites(adminId)[0];
    if (!fDirectCommands.isDurablyStored(slot, key)) {
      fDirectCommands.forget(slot, key); throw new Error("F4_OPERATION_STORAGE_UNAVAILABLE");
    }
  }
  if (isRetryExpired(original)) throw new F1OutcomeUncertainError("原操作已超过 24 小时，只能查询原结果。", original.commandKey);
  if (!original.f4Request || !fDirectCommands.isDurablyStored(original.fingerprint, original.commandKey)) throw new Error("F4_PROPOSAL_ORIGINAL_INCOMPLETE");
  const { reason: savedReason, operator, ...values } = original.f4Request;
  try {
    // A replayed policy is historical evidence only. The caller always rereads.
    const receipt = await updateF4AmbassadorPolicy(values, savedReason, operator, original.commandKey);
    if (receipt.revision !== values.expectedRevision + 1 || receipt.policyVersion !== values.policyVersion) {
      throw new F1OutcomeUncertainError("规则保存回执与原请求对不上，请继续核对。", original.commandKey);
    }
  } catch (error) {
    const failure = error as { httpStatus?: number; apiCode?: number };
    if (recovering ? isExplicitRejection(error) : !isF1OutcomeUncertainError(error)
      && failure.httpStatus !== undefined && isDeterministicRejection(failure.httpStatus, failure.apiCode)) {
      fDirectCommands.forget(original.fingerprint, original.commandKey);
    }
    throw error;
  }
  fDirectCommands.forget(original.fingerprint, original.commandKey);
}

/** No command receipt endpoint exists: current policy never proves the old PUT absent. */
export async function queryF4Policy(adminId: number, original: FDirectAttempt) {
  const auth = useAdminAuth.getState();
  if (!auth.isAuthenticated || auth.logoutPending || auth.session?.adminId !== adminId || original.adminId !== adminId) throw new Error("ADMIN_PERMISSION_DENIED");
  return fetchF4AmbassadorPolicy();
}
