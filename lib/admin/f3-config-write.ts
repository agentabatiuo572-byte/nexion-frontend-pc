import { useAdminAuth } from "../store/admin-auth";
import { createA2CommandKey } from "./a2-client";
import { formatAdminApiError } from "./error-messages";
import { explicitRejectionCode } from "./explicit-rejection";
import { patchF3PayoutControl } from "./f1-client";
import { f3DirectRoute, f3DirectSlot, fDirectCommands, F1OutcomeUncertainError } from "./f1-stable-write";
import { f3PayoutControlAuthority, type F3PayoutControlKey } from "./f3-policy";
import { fundCommandOrigin, fundCommandResult } from "./fund-command-investigation";
import { queryOriginalCommand } from "./original-command-query";
import { isRetryExpired, RETRY_EXPIRED_TEXT } from "./pending-mutation-store";
import { beginProposalRetry, lookupOriginalReceipt, releaseRejectedProposal } from "./proposal-recovery";

export function listF3ConfigWrites(adminId: number) {
  return fDirectCommands.list().filter(row => row.adminId === adminId && row.f3Request);
}

export function pendingF3ConfigWrite(adminId: number, key: F3PayoutControlKey) {
  return listF3ConfigWrites(adminId).find(row => row.f3Request?.key === key);
}

function activeActor(adminId: number) {
  const auth = useAdminAuth.getState();
  if (!auth.isAuthenticated || auth.logoutPending || auth.logoutUnknown || auth.session?.passwordChangeRequired
    || auth.session?.adminId !== adminId) throw new Error("ADMIN_PERMISSION_DENIED");
  return auth.session;
}

export async function sendF3ConfigWrite(adminId: number, key: F3PayoutControlKey, input?: { value: string; reason: string }) {
  const actor = activeActor(adminId);
  if (!actor.authorities.includes(f3PayoutControlAuthority(key))) throw new Error("ADMIN_PERMISSION_DENIED");
  const slot = f3DirectSlot(adminId, key);
  let original = pendingF3ConfigWrite(adminId, key);
  if (input && original) throw new F1OutcomeUncertainError(formatAdminApiError(undefined, "F1_REQUEST_OUTCOME_UNKNOWN"), original.commandKey);
  if (input && !original) {
    const request = { key, ...input, operator: actor.operator || actor.username };
    const commandKey = createA2CommandKey("f3-config");
    const route = f3DirectRoute(key);
    fDirectCommands.remember(slot, commandKey, { adminId, f3Request: request, inputFingerprint: JSON.stringify(request),
      commandOrigin: fundCommandOrigin(route.originalMethod, route.originalPath, route.readAuthority) });
    if (!fDirectCommands.isDurablyStored(slot, commandKey)) {
      fDirectCommands.forget(slot, commandKey);
      throw new Error("F3_PROPOSAL_STORAGE_UNAVAILABLE");
    }
    original = pendingF3ConfigWrite(adminId, key);
  }
  if (!original?.f3Request || !fDirectCommands.isDurablyStored(slot, original.commandKey)) {
    throw new Error("F3_PROPOSAL_ORIGINAL_INCOMPLETE");
  }
  if (isRetryExpired(original)) throw new F1OutcomeUncertainError(RETRY_EXPIRED_TEXT, original.commandKey);
  if (!input) beginProposalRetry(original);
  const { value, reason, operator } = original.f3Request;
  try {
    const updated = await patchF3PayoutControl(key, { value, reason, operator }, original.commandKey);
    fDirectCommands.forget(slot, original.commandKey);
    return updated;
  } catch (error) {
    const rejection = explicitRejectionCode(error);
    if (rejection && input) fDirectCommands.forget(slot, original.commandKey);
    else if (rejection) fDirectCommands.remember(slot, original.commandKey, { ...original, retryRejection: rejection });
    throw error;
  }
}

export async function queryF3ConfigWrite(adminId: number, key: F3PayoutControlKey) {
  activeActor(adminId);
  const original = pendingF3ConfigWrite(adminId, key);
  const receipt = original ? await lookupOriginalReceipt(original, () => queryOriginalCommand(original, f3DirectRoute(key), String(adminId))) : null;
  const result = fundCommandResult(receipt);
  if (original && (result === "SUCCEEDED" || result === "REJECTED" || result === "NOT_EXECUTED")) {
    fDirectCommands.forget(original.fingerprint, original.commandKey);
  }
  return { receipt, result };
}

export function releaseRejectedF3ConfigWrite(adminId: number, key: F3PayoutControlKey) {
  activeActor(adminId);
  releaseRejectedProposal(pendingF3ConfigWrite(adminId, key),
    row => fDirectCommands.forget(row.fingerprint, row.commandKey));
}
