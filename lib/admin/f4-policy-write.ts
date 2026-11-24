import { createA2CommandKey } from "./a2-client";
import { fetchF4AmbassadorPolicy, updateF4AmbassadorPolicy, type F4AmbassadorPolicyUpdate } from "./f1-client";
import { fDirectCommands, F1OutcomeUncertainError, isF1OutcomeUncertainError, type FDirectAttempt } from "./f1-stable-write";
import { hasPersistedPendingCommandOwner, isRetryExpired, RETRY_EXPIRED_TEXT } from "./pending-mutation-store";
import { explicitRejectionCode } from "./explicit-rejection";
import { beginProposalRetry, lookupOriginalReceipt, releaseRejectedProposal } from "./proposal-recovery";
import { isDeterministicRejection } from "./outcome-classification";
import type { F4ConfirmationSnapshot } from "./f4-approval";
import { useAdminAuth } from "../store/admin-auth";
import { fundCommandOrigin, fundCommandSettled, type FundCommandEvidence } from "./fund-command-investigation";
import { queryOriginalCommand } from "./original-command-query";

const policyRoute = { originalMethod: "PUT", originalPath: "/api/admin/teams/ambassador-policy", readAuthority: "network_f4_read" } as const;

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
    fDirectCommands.remember(slot, key, { adminId, inputFingerprint: JSON.stringify(request), f4Request: request, f4Snapshot: snapshot,
      commandOrigin: fundCommandOrigin(policyRoute.originalMethod, policyRoute.originalPath, policyRoute.readAuthority) });
    original = listF4PolicyWrites(adminId)[0];
    if (!fDirectCommands.isDurablyStored(slot, key)) {
      fDirectCommands.forget(slot, key); throw new Error("F4_OPERATION_STORAGE_UNAVAILABLE");
    }
  }
  if (isRetryExpired(original)) throw new F1OutcomeUncertainError(RETRY_EXPIRED_TEXT, original.commandKey);
  if (!original.f4Request || !fDirectCommands.isDurablyStored(original.fingerprint, original.commandKey)) throw new Error("F4_PROPOSAL_ORIGINAL_INCOMPLETE");
  if (recovering) beginProposalRetry(original);
  const { reason: savedReason, operator, ...values } = original.f4Request;
  try {
    // A replayed policy is historical evidence only. The caller always rereads.
    const receipt = await updateF4AmbassadorPolicy(values, savedReason, operator, original.commandKey);
    if (receipt.revision !== values.expectedRevision + 1 || receipt.policyVersion !== values.policyVersion) {
      throw new F1OutcomeUncertainError("规则保存后返回的内容和原请求对不上，请继续核对。", original.commandKey);
    }
  } catch (error) {
    const failure = error as { httpStatus?: number; apiCode?: number };
    const rejection = recovering ? explicitRejectionCode(error) : undefined;
    if (rejection) fDirectCommands.remember(original.fingerprint, original.commandKey, { ...original, retryRejection: rejection });
    if (!recovering && !isF1OutcomeUncertainError(error)
      && failure.httpStatus !== undefined && isDeterministicRejection(failure.httpStatus, failure.apiCode)) {
      fDirectCommands.forget(original.fingerprint, original.commandKey);
    }
    throw error;
  }
  fDirectCommands.forget(original.fingerprint, original.commandKey);
}

/** Current policy remains a separate read when the original receipt cannot settle the command. */
export async function queryF4Policy(adminId: number, original: FDirectAttempt, evidence?: FundCommandEvidence) {
  const auth = useAdminAuth.getState();
  if (!auth.isAuthenticated || auth.logoutPending || auth.session?.adminId !== adminId || original.adminId !== adminId) throw new Error("ADMIN_PERMISSION_DENIED");
  const query = () => queryOriginalCommand(original, policyRoute, String(adminId), evidence);
  const receipt = evidence ? await query() : await lookupOriginalReceipt(original, query);
  const settled = fundCommandSettled(receipt);
  if (settled) fDirectCommands.forget(original.fingerprint, original.commandKey);
  return { receipt, settled, current: await fetchF4AmbassadorPolicy() };
}

export function releaseRejectedF4Policy(adminId: number, commandKey: string) {
  if (useAdminAuth.getState().session?.adminId !== adminId) throw new Error("ADMIN_PERMISSION_DENIED");
  releaseRejectedProposal(listF4PolicyWrites(adminId).find(row => row.commandKey === commandKey),
    row => fDirectCommands.forget(row.fingerprint, row.commandKey));
}
