import { isAdminAuthFailure, resetAdminSession } from "@/lib/admin/auth-session";
import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import { createPendingMutationStore, type PendingMutationRecord } from "./pending-mutation-store";

export type PlacementStatus = "ALL" | "ASSIGNED" | "UNASSIGNED";
export type Placement = {
  ownerUserId: number; memberUserId: number; leg: "A" | "B" | null;
  assignedBy: string | null; assignedAt: string | null; assignedAtIso?: string | null; assignmentSource: "AUTO" | "MANUAL" | null;
};
export type PlacementPage = {
  ownerUserId: number; status: PlacementStatus; page: number; pageSize: number; total: number; records: Placement[];
};
export type PlacementIntent = { ownerUserId: number; memberUserId: number; leg: "A" | "B" };
export class PlacementError extends Error {
  constructor(message: string, public outcome: "rejected" | "unknown", public status = 0) { super(message); }
}
const id = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
type PlacementAttempt = PendingMutationRecord & { adminId: number; intent: PlacementIntent };
const attempts = createPendingMutationStore<PlacementAttempt>({
  storageKey: "nexion-admin-f3-placements-v1", retainExpiredRecords: true,
  isValidRecord: row => id(row.adminId) && !!row.intent && id(row.intent.ownerUserId) && id(row.intent.memberUserId)
    && ["A", "B"].includes(row.intent.leg),
});
export const pendingPlacement = (adminId: number) => attempts.list().find(row => row.adminId === adminId);
export function rememberPlacement(adminId: number, intent: PlacementIntent) {
  if (pendingPlacement(adminId)) throw new Error("F3_PLACEMENT_UNRESOLVED");
  const slot = `${adminId}:assignment`, key = crypto.randomUUID(); // Local evidence ID only; never sent as an idempotency key.
  attempts.remember(slot, key, { adminId, intent });
  if (!attempts.isDurablyStored(slot, key)) {
    attempts.forget(slot, key);
    throw new Error("F3_PROPOSAL_STORAGE_UNAVAILABLE");
  }
}
export function forgetPlacement(adminId: number) {
  const original = pendingPlacement(adminId);
  if (original) attempts.forget(original.fingerprint, original.commandKey);
}
const invalid = () => new Error("分组信息加载不完整，请重新查询。");
const uncertain = () => new PlacementError("分组结果暂未确认，请稍后查看分组结果。", "unknown");

async function request(query: string, intent?: PlacementIntent): Promise<unknown> {
  let response: Response;
  try {
    // Assignment identity is owner/member, enforced by the existing backend unique row.
    response = await guardedFetch(`/api/admin/teams/binary/assignments${query}`, {
      method: intent ? "POST" : "GET", cache: "no-store",
      ...(intent ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(intent) } : {}),
    });
  } catch (error) {
    if (intent) throw uncertain();
    throw error;
  }
  let result: {code?: number; message?: string; data?: unknown} | null = null;
  try { result = await response.json(); } catch { /* classify below */ }
  if (isAdminAuthFailure(response.status, result?.message)) {
    resetAdminSession();
    throw new PlacementError("登录状态已失效，请重新登录。", "rejected", response.status);
  }
  if (intent && (!result || ((!response.ok || result.code !== 0) && outcomeStaysUnknown(response.status, result.code))
    || result.message?.includes("OUTCOME_UNKNOWN") || response.headers.get("X-Nexion-Upstream-Outcome") === "unknown")) {
    throw uncertain();
  }
  if (!response.ok || result?.code !== 0) {
    const message = formatAdminApiError(result?.message, "F3_ASSIGNMENT_READ_FAILED");
    throw new PlacementError(message, "rejected", response.status === 200 ? result?.code : response.status);
  }
  return result.data;
}

export async function readPlacements(ownerUserId: number, status: PlacementStatus = "ALL", page = 1, memberUserId?: number): Promise<PlacementPage> {
  if (!id(ownerUserId) || !id(page) || !["ALL", "ASSIGNED", "UNASSIGNED"].includes(status) || (memberUserId !== undefined && !id(memberUserId))) throw invalid();
  const query = new URLSearchParams({ ownerUserId: String(ownerUserId), status, page: String(page), pageSize: "20" });
  if (memberUserId !== undefined) query.set("memberUserId", String(memberUserId));
  const value = await request(`?${query}`) as PlacementPage;
  if (!value || value.ownerUserId !== ownerUserId || value.status !== status || value.page !== page || value.pageSize !== 20
    || !Number.isSafeInteger(value.total) || value.total < 0 || !Array.isArray(value.records) || value.records.length > 20
    || value.records.length > value.total || new Set(value.records.map(row => row.memberUserId)).size !== value.records.length) throw invalid();
  for (const row of value.records) {
    if (!row || row.ownerUserId !== ownerUserId || !id(row.memberUserId) || (memberUserId !== undefined && row.memberUserId !== memberUserId)
      || ![null, "A", "B"].includes(row.leg) || (status === "ASSIGNED" && row.leg === null) || (status === "UNASSIGNED" && row.leg !== null)
      || (row.assignedBy !== null && typeof row.assignedBy !== "string") || (row.assignedAt !== null && typeof row.assignedAt !== "string")
      || (row.assignedAtIso != null && (typeof row.assignedAtIso !== "string" || !/(?:Z|[+-]\d{2}:\d{2})$/.test(row.assignedAtIso) || !Number.isFinite(Date.parse(row.assignedAtIso))))
      || ![null, "AUTO", "MANUAL"].includes(row.assignmentSource)) throw invalid();
  }
  return value;
}

export async function assignPlacement(intent: PlacementIntent): Promise<PlacementIntent & {replayed: boolean}> {
  if (!id(intent.ownerUserId) || !id(intent.memberUserId) || !["A", "B"].includes(intent.leg)) throw invalid();
  const result = await request("", intent) as PlacementIntent & {replayed: boolean};
  if (!result || result.ownerUserId !== intent.ownerUserId || result.memberUserId !== intent.memberUserId || result.leg !== intent.leg || typeof result.replayed !== "boolean") {
    throw uncertain();
  }
  return result;
}
