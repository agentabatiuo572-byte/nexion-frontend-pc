import { createA2CommandKey } from "./a2-client";
import { createPendingMutationStore, type PendingMutationRecord } from "./pending-mutation-store";
import { fetchRankHowPolicyAdmin, updateRankHowPolicyAdmin, type PublishedContentDocument } from "./published-content-client";
import { isDeterministicRejection, OutcomeUnknownError } from "./outcome-classification";
import { useAdminAuth } from "../store/admin-auth";

type Original = PendingMutationRecord & { adminId: number; document: PublishedContentDocument; reason: string };
const saves = createPendingMutationStore<Original>({
  storageKey: "nexion-admin-f1-rank-how-save-v1", retainExpiredRecords: true,
  isValidRecord: row => Number.isSafeInteger(row.adminId) && typeof row.reason === "string"
    && !!row.document && typeof row.document.version === "string" && Number.isSafeInteger(row.document.revision)
    && row.document.revision >= 0 && ["DRAFT", "PUBLISHED"].includes(row.document.status)
    && !!row.document.locales && typeof row.document.locales === "object" && !Array.isArray(row.document.locales),
});

export const pendingF1RankHow = (adminId: number) => saves.list().find(row => row.adminId === adminId);
const inFlight = new Set<number>();
export const isF1RankHowInFlight = (adminId: number) => inFlight.has(adminId);

export interface F1RankHowComparison {
  revision: { submitted: number; expected: number; current: number; matches: boolean };
  version: { submitted: string; current: string; matches: boolean };
  status: { submitted: PublishedContentDocument["status"]; current: PublishedContentDocument["status"]; matches: boolean };
  contentMatches: boolean;
}

// Object order in a JSON object is irrelevant; array order and every submitted field are preserved.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}

export async function queryF1RankHow(adminId: number) {
  if (useAdminAuth.getState().session?.adminId !== adminId) throw new Error("ADMIN_PERMISSION_DENIED");
  const original = pendingF1RankHow(adminId);
  if (!original) return { current: await fetchRankHowPolicyAdmin(), matched: true, comparison: null };
  const current = await fetchRankHowPolicyAdmin();
  const comparison: F1RankHowComparison = {
    revision: { submitted: original.document.revision, expected: original.document.revision + 1, current: current.revision, matches: current.revision === original.document.revision + 1 },
    version: { submitted: original.document.version.trim(), current: current.version, matches: current.version === original.document.version.trim() },
    status: { submitted: original.document.status, current: current.status, matches: current.status === original.document.status },
    contentMatches: canonical(current.locales) === canonical(original.document.locales),
  };
  const matched = comparison.revision.matches && comparison.version.matches && comparison.status.matches && comparison.contentMatches;
  if (matched) saves.forget(original.fingerprint, original.commandKey);
  return { current, matched, comparison };
}

/** Call only after operator confirmation. Re-read before releasing; never resend this non-deduplicated write. */
export async function releaseF1RankHow(adminId: number) {
  const original = pendingF1RankHow(adminId);
  const result = await queryF1RankHow(adminId);
  if (!result.matched && original) saves.forget(original.fingerprint, original.commandKey);
  return { ...result, released: !result.matched };
}

/** This endpoint has CAS but no command deduplication. There is deliberately no retry API. */
export async function saveF1RankHow(adminId: number, document: PublishedContentDocument, reason: string) {
  const current = useAdminAuth.getState().session;
  if (current?.adminId !== adminId || !current.authorities.includes("network_f1_write")) throw new Error("ADMIN_PERMISSION_DENIED");
  if (pendingF1RankHow(adminId)) throw new OutcomeUnknownError("保存结果未知，请先重新读取核对。");
  const fingerprint = `${adminId}:F1:rank-how`, key = createA2CommandKey("f1-rank-how-evidence");
  saves.remember(fingerprint, key, { adminId, document, reason });
  if (!saves.isDurablyStored(fingerprint, key)) {
    saves.forget(fingerprint, key);
    throw new Error("浏览器没能记下这次操作，这次没有发出；请关闭无痕模式或允许本站保存数据后再试。");
  }
  inFlight.add(adminId);
  try {
    const value = await updateRankHowPolicyAdmin(document, reason);
    if (value.revision !== document.revision + 1 || value.version !== document.version.trim()
        || value.status !== document.status || canonical(value.locales) !== canonical(document.locales)) {
      throw new OutcomeUnknownError("保存回执与提交内容对不上，请重新读取核对。");
    }
    saves.forget(fingerprint, key);
    return value;
  } catch (error) {
    if (!(error instanceof OutcomeUnknownError)) {
      const failure = error as { status?: number; apiCode?: number };
      if (failure.status !== undefined && isDeterministicRejection(failure.status, failure.apiCode)) saves.forget(fingerprint, key);
      else throw new OutcomeUnknownError(error instanceof Error ? error.message : "保存结果未知，请重新读取核对。");
    }
    throw error;
  } finally {
    inFlight.delete(adminId);
  }
}
