import type { A2OperationRow } from "./a2-client";
import { isRetryExpired, RETRY_EXPIRED_TEXT } from "./pending-mutation-store";

type RecoverableProposal = { commandKey: string; expiresAt: number; retryRejection?: string };
type Lookup = "checking" | "absent" | "processing" | "found" | "failed";
const lookups = new Map<string, Lookup>();

export const RELEASE_REJECTED_PROPOSAL_TEXT = "此处只解除本标签页的锁，不发送请求，也不进入操作记录。请先到「操作记录与审批」核对原操作。";

async function trackLookup<T>(original: RecoverableProposal, read: () => Promise<T>, classify: (result: T) => Lookup): Promise<T> {
  const key = original.commandKey;
  if (lookups.get(key) === "checking") throw new Error("正在查询原结果");
  lookups.set(key, "checking");
  try {
    const result = await read();
    lookups.set(key, classify(result));
    return result;
  } catch (error) {
    const code = (error as { backendMessage?: string })?.backendMessage;
    lookups.set(key, code === "IDEMPOTENCY_REQUEST_IN_PROGRESS" ? "processing" : "failed");
    throw error;
  }
}

export function lookupOriginalProposal<T extends A2OperationRow | null>(original: RecoverableProposal, read: () => Promise<T>) {
  return trackLookup(original, read, ticket => ticket?.status === "pending" ? "processing" : ticket ? "found" : "absent");
}

export function lookupOriginalReceipt<T extends { originalStatus: string; businessState?: string } | null>(original: RecoverableProposal, read: () => Promise<T>) {
  return trackLookup(original, read, receipt => receipt?.businessState === "PROCESSING" ? "processing" : receipt ? "found" : "absent");
}

export function proposalRetryBlockedReason(original: RecoverableProposal, received = false): string | undefined {
  if (isRetryExpired(original)) return RETRY_EXPIRED_TEXT;
  if (original.retryRejection) return "重试被明确拒绝，请先核对原操作";
  const lookup = lookups.get(original.commandKey);
  if (lookup === "checking") return "正在查询原结果";
  if (lookup === "failed") return "查询失败，请稍后再查";
  if (lookup === "processing") return "原操作还在处理，请稍后再查";
  if (lookup === "found" || received) return "已查到原申请，请查询原结果";
  if (lookup !== "absent") return "先查询原结果，明确查不到后才能重试";
}

export function beginProposalRetry(original: RecoverableProposal) {
  const blocked = proposalRetryBlockedReason(original);
  if (blocked) throw new Error(blocked);
  // 每次重发前都要重新取得查无原单的结论。
  lookups.delete(original.commandKey);
}

export function releaseRejectedProposal<T extends RecoverableProposal>(original: T | undefined, forget: (row: T) => void) {
  if (!original?.retryRejection) throw new Error("原操作没有被明确拒绝的重试记录，请查询原结果。");
  forget(original);
  lookups.delete(original.commandKey);
}
