import { acknowledgeFReconfirmation, settleFReconfirmation } from "./f-reconfirmation";
import { createA2CommandKey } from "./a2-client";
import { updateF4AmbassadorPolicy, type F4AmbassadorPolicyUpdate } from "./f1-client";
import { fDirectCommands, F1OutcomeUncertainError, isF1OutcomeUncertainError, type FDirectAttempt } from "./f1-stable-write";
import { hasPersistedPendingCommandOwner } from "./pending-mutation-store";
import { createFDirectRecovery, fDirectReceiptConclusion } from "./f-direct-recovery";
import { activeRecoveryActor } from "./f-proposal-recovery";
import { isDeterministicRejection } from "./outcome-classification";
import type { F4ConfirmationSnapshot } from "./f4-approval";
import { useAdminAuth } from "../store/admin-auth";
import { fundCommandOrigin, fundCommandResult, type FundCommandEvidence } from "./fund-command-investigation";
import { queryOriginalCommand } from "./original-command-query";

const policyRoute = { originalMethod: "PUT", originalPath: "/api/admin/teams/ambassador-policy", readAuthority: "network_f4_read" } as const;

export function listF4PolicyWrites(adminId: number) {
  return fDirectCommands.list().filter(row => row.fingerprint === `${adminId}:f4-ambassador-policy`
    || row.fingerprint === "f4-ambassador-policy" && (row.adminId === adminId
      || row.adminId === undefined && hasPersistedPendingCommandOwner(String(adminId)))).map(row => ({ ...row, adminId }));
}

const SCOPE = "F4_AMBASSADOR_POLICY_UPDATE";
export const f4PolicyRecovery = createFDirectRecovery(fDirectCommands, () => SCOPE, original =>
  !!original.f4Request && !!activeRecoveryActor(original.adminId, "network_f4_read")?.authorities.includes("network_f4_pool_fund"));
export const canRetryF4Policy = (original: FDirectAttempt) => !f4PolicyRecovery.state(original).replayBlock;

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
    fDirectCommands.remember(slot, key, { adminId, inputFingerprint: JSON.stringify(request), f4Request: request, f4Snapshot: snapshot, continuedFrom: snapshot?.continuedFrom,
      commandOrigin: fundCommandOrigin(policyRoute.originalMethod, policyRoute.originalPath, policyRoute.readAuthority) });
    original = listF4PolicyWrites(adminId)[0];
    if (!fDirectCommands.isDurablyStored(slot, key)) {
      fDirectCommands.forget(slot, key); throw new Error("F4_OPERATION_STORAGE_UNAVAILABLE");
    }
  }
  if (!original.f4Request || !fDirectCommands.isDurablyStored(original.fingerprint, original.commandKey)) throw new Error("F4_PROPOSAL_ORIGINAL_INCOMPLETE");
  const send = async (record: FDirectAttempt) => {
    const { reason: savedReason, operator, ...values } = record.f4Request!;
    // A replayed policy is historical evidence only. The caller always rereads.
    const receipt = await updateF4AmbassadorPolicy(values, savedReason, operator, record.commandKey);
    if (receipt.revision !== values.expectedRevision + 1 || receipt.policyVersion !== values.policyVersion) {
      throw new F1OutcomeUncertainError("规则保存后返回的内容和原请求对不上，请继续核对。", record.commandKey);
    }
  };
  try {
    if (recovering) await f4PolicyRecovery.replay(original, send);
    else await send(original);
  } catch (error) {
    const failure = error as { httpStatus?: number; apiCode?: number };
    if (!recovering && !isF1OutcomeUncertainError(error)
      && failure.httpStatus !== undefined && isDeterministicRejection(failure.httpStatus, failure.apiCode)) {
      fDirectCommands.forget(original.fingerprint, original.commandKey);
    }
    throw error;
  }
  f4PolicyRecovery.settleAcknowledged(original);
  acknowledgeFReconfirmation(original);
}

/** Current policy remains a separate read when the original receipt cannot settle the command. */
export async function queryF4Policy(adminId: number, original: FDirectAttempt, evidence?: FundCommandEvidence) {
  const auth = useAdminAuth.getState();
  if (!auth.isAuthenticated || auth.logoutPending || auth.session?.adminId !== adminId || original.adminId !== adminId) throw new Error("ADMIN_PERMISSION_DENIED");
  const query = (original: FDirectAttempt) => queryOriginalCommand(original, policyRoute, String(adminId), evidence);
  const result = await f4PolicyRecovery.query(original, async record => {
    const receipt = await query(record);
    const state = fundCommandResult(receipt);
    const conclusion = state === "SUCCEEDED" ? "succeeded" : state === "REJECTED" ? "rejected"
      : state === "NOT_EXECUTED" ? "not-executed" : evidence || receipt
        ? "unknown" : await fDirectReceiptConclusion(SCOPE, record.commandKey, adminId);
    return { conclusion, receipt };
  });
  if (!result) throw new Error("PENDING_QUERY_UNAVAILABLE");
  const settled = settleFReconfirmation(f4PolicyRecovery, original, result.conclusion, "f4-policy");
  return { ...result, settled };
}
