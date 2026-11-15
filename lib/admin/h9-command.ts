import { growthRequest } from "./h-client";
import { isExplicitRejection } from "./explicit-rejection";
import { isDeterministicRejection, OutcomeUnknownError } from "./outcome-classification";
import { createPendingMutationStore, hasPersistedPendingCommandOwner, isRetryExpired, PENDING_MUTATION_TTL_MS, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "./pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";

export type H9CommandKind = "main" | "rank";
export type H9CommandDisplay = {
  module: "home" | "network" | "jobs" | "globe" | "rank" | "history";
  title: string; action: string; impact: string; change: string;
  rows: { key: string; label: string; before: string; after: string }[];
  objectLabel?: string;
  extraFacts?: { label: string; value?: string; before?: string; after?: string }[];
};
type Original = { path: "/public-stats" | "/device-rank-config"; method: "PATCH"; body: string; reason: string; expectedVersion: number; display: H9CommandDisplay };
export type H9Command = PendingMutationRecord & { adminId?: number; original?: Original; inputFingerprint?: string };

// Each existing key has exactly one store. Old key-only evidence is retained, but never replayed.
const stores = {
  main: createPendingMutationStore<H9Command>({ storageKey: "nexion-admin-h9-public-stats-attempt", retainExpiredRecords: true }),
  rank: createPendingMutationStore<H9Command>({ storageKey: "nexion-admin-device-rank-attempt", retainExpiredRecords: true }),
};
const pathFor = (kind: H9CommandKind) => kind === "main" ? "/public-stats" : "/device-rank-config";
const slotFor = (kind: H9CommandKind) => kind === "main" ? "h9-public-stats" : "device-rank-config";

/** sessionStorage is the recovery input boundary. Incomplete legacy records remain query-only. */
function originalFrom(value: unknown, kind: H9CommandKind): Original | undefined {
  if (!value || typeof value !== "object") return undefined;
  const o = value as Original;
  if (o.path !== pathFor(kind) || o.method !== "PATCH" || typeof o.body !== "string" || typeof o.reason !== "string"
    || !Number.isSafeInteger(o.expectedVersion) || o.expectedVersion < 0 || !o.display) return undefined;
  const d = o.display;
  if (!["home", "network", "jobs", "globe", "rank", "history"].includes(d.module)
    || (kind === "rank") !== (d.module === "rank") || ![d.title, d.action, d.impact, d.change].every(v => typeof v === "string")
    || !Array.isArray(d.rows) || !d.rows.every(r => r && [r.key, r.label, r.before, r.after].every(v => typeof v === "string"))) return undefined;
  if (d.objectLabel !== undefined && typeof d.objectLabel !== "string"
    || d.extraFacts !== undefined && (!Array.isArray(d.extraFacts) || !d.extraFacts.every(f => f && typeof f.label === "string"
      && (typeof f.value === "string" || typeof f.before === "string" && typeof f.after === "string")))) return undefined;
  try {
    const body = JSON.parse(o.body);
    if (!body || typeof body !== "object" || body.expectedVersion !== o.expectedVersion || body.reason !== o.reason || typeof body.operator !== "string") return undefined;
  } catch { return undefined; }
  return o;
}

export function pendingH9Command(kind: H9CommandKind): H9Command | undefined {
  const adminId = useAdminAuth.getState().session?.adminId;
  if (!adminId) return undefined;
  const saved = stores[kind].list().find(r => r.adminId === adminId
    || r.adminId === undefined && hasPersistedPendingCommandOwner(String(adminId)));
  return saved ? { ...saved, original: originalFrom(saved.original, kind) } : undefined;
}

function requireActor(adminId?: number, write = false) {
  const auth = useAdminAuth.getState();
  if (!auth.isAuthenticated || auth.logoutPending || !auth.session || auth.session.adminId !== adminId) throw new Error("ADMIN_AUTH_REQUIRED");
  if (write && !auth.session.authorities.includes("growth_h9_write")) throw new Error("ACCESS_DENIED");
}

export function createH9Command(kind: H9CommandKind, body: string, display: H9CommandDisplay): H9Command {
  const adminId = useAdminAuth.getState().session?.adminId;
  requireActor(adminId, true);
  const input = JSON.parse(body) as { expectedVersion: number; reason: string };
  const now = Date.now();
  return { adminId, fingerprint: slotFor(kind), commandKey: `${kind === "main" ? "h9-public-stats" : "device-rank"}-${crypto.randomUUID()}`,
    createdAt: now, expiresAt: now + PENDING_MUTATION_TTL_MS,
    original: { path: pathFor(kind), method: "PATCH", body, reason: input.reason, expectedVersion: input.expectedVersion, display } };
}

export const canRetryH9Command = (record: H9Command) => !!record.original && !isRetryExpired(record) && Date.now() >= record.createdAt;

export function h9CommandRejected(error: unknown, recovering: boolean): boolean {
  const e = error as { status?: number; apiCode?: number; reasonCode?: string; unknownOutcome?: boolean; bodyUnreadable?: boolean } | null;
  return !!e && !(error instanceof OutcomeUnknownError) && !e.unknownOutcome && !e.bodyUnreadable
    && !e.reasonCode?.startsWith("IDEMPOTENCY_")
    && (recovering ? isExplicitRejection(error) : isDeterministicRejection(e.status ?? 0, e.apiCode));
}

/** The retained bytes and key are the only replay source; a current read never settles a command. */
export async function sendH9Command<T>(kind: H9CommandKind, record: H9Command, parse: (raw: unknown) => T, recovering = false): Promise<T> {
  requireActor(record.adminId, true);
  const pending = pendingH9Command(kind);
  if (recovering ? pending?.commandKey !== record.commandKey : !!pending) throw new Error(recovering ? "H9_ORIGINAL_RESOLVED" : "H9_ORIGINAL_UNRESOLVED");
  if (!record.original) throw new Error("H9_ORIGINAL_REQUEST_UNAVAILABLE");
  if (!canRetryH9Command(record)) throw new Error(RETRY_EXPIRED_TEXT);
  const store = stores[kind];
  store.remember(record.fingerprint, record.commandKey, record);
  if (!store.isDurablyStored(record.fingerprint, record.commandKey)) {
    if (!recovering) store.forget(record.fingerprint, record.commandKey);
    throw new Error(recovering ? "H9_REQUEST_RETRY_STORAGE_UNAVAILABLE" : "H9_REQUEST_STORAGE_UNAVAILABLE");
  }
  try {
    const raw = await growthRequest<unknown>(record.original.path, {
      method: record.original.method, body: record.original.body, headers: { "Idempotency-Key": record.commandKey },
    }, undefined, true);
    const result = parse(raw);
    store.forget(record.fingerprint, record.commandKey);
    return result;
  } catch (error) {
    if (h9CommandRejected(error, recovering)) {
      store.forget(record.fingerprint, record.commandKey);
      throw error;
    }
    const unknown = new OutcomeUnknownError(error instanceof Error ? error.message : "H9_SAVE_FAILED", { cause: error });
    throw unknown;
  }
}
