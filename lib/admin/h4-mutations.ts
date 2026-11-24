import { HApprovalRequired } from "./h-approval-required";
import { isHGrowthReadConflict } from "./h-write-conflict";
import { guardedFetch, formatAdminApiError } from "./error-messages";
import { saveH4UploadFile, readH4UploadFile, deleteH4UploadFile } from "./h4-upload-file";
import type { UploadedAsset } from "./media-client";
import { createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, isA2OutcomeUncertainError, type A2OperationRow } from "./a2-client";
import { growthRequest, validateH4OverviewEvents } from "./h-client";
import { parseEventRule } from "./event-rules-client";
import { trimStoredContent } from "./content-language-rules";
import { parseAdminRaffle, RAFFLE_LANGUAGES, type AdminRaffle } from "./genesis-raffle-client";
import { h4CommandStores, type H4StoredCommand } from "./h4-command-store";
import { findHighOp } from "./high-ops-registry";
import { isExplicitRejection } from "./explicit-rejection";
import { isDeterministicRejection, isOutcomeUnknownError, OutcomeUnknownError } from "./outcome-classification";
import { hasPersistedPendingCommandOwner, isRetryExpired, RETRY_EXPIRED_TEXT } from "./pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { roleLabel } from "@/lib/nav/console-nav";
import { promotionRead } from "./promotion-client";
import type { Promotion, RewardAdmin } from "./promotion-types";
import type { FundCommandOrigin } from "./fund-command-investigation";
import { fetchDirectCommandReceipt, type DirectCommandReceiptState } from "./direct-command-receipt";

type Proposal = Parameters<typeof createA2OperationProposal>[0];
type Resource = "overview" | "rules" | "raffles";
type Direct = { path: string; method: "POST" | "PATCH" | "DELETE"; body: string };
export type H4UploadTarget =
  | { kind: "banner"; objectId: string; version: number; revision: number; position: "bannerAssetId" }
  | { kind: "evidence"; objectId: string; revision: number; position: "evidenceAssetId"; operation: string };
export type H4UploadRestoration = { canAutoRestore: boolean; restored: boolean; reason: string };
export type H4Command = H4StoredCommand & {
  store: keyof typeof h4CommandStores; owner: number; scope: string; action: string; reason: string;
  request: Direct | { proposal: Proposal }; acknowledged?: boolean;
  raffleReceipt?: { id: string; revision: number | null };
  raffleReadback?: { id: string; minimumRevision: number; hasMatchingReceipt: boolean };
  asset?: UploadedAsset;
  uploadTarget?: H4UploadTarget;
  restoration?: H4UploadRestoration;
  commandOrigin?: FundCommandOrigin;
};
export type H4ApprovalReceipt = { h4Approval: true; ticket: A2OperationRow };
export const isH4ApprovalReceipt = (value: unknown): value is H4ApprovalReceipt => !!(value as H4ApprovalReceipt | null)?.h4Approval;
export const H4_APPROVAL_OPS = new Set([
  "h4_event_rule_enable", "h4_genesis_raffle_open", "h4_legacy_event_open", "h4_legacy_event_reward_update",
  "h4_wheel_guard_create", "h4_wheel_guard_update", "h4_wheel_tier_create", "h4_wheel_tier_update",
  "h4_wheel_tier_delete", "h4_wheel_probabilities_update",
]);
const fresh = new Map<string, number>();
const observations = new Map<string, A2OperationRow>();
const directReceipts = new Map<string, DirectCommandReceiptState>();
let observationOwner: number | undefined;
const resourceOf = (scope: string): Resource => scope.includes("/h4_event_rule/") ? "rules" : scope.includes("/h4_genesis_raffle/") ? "raffles" : "overview";
const notify = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event("admin-h4-pending-changed")); };
export function h4ReadVersion(resource: Resource) { const v = fresh.get(`${useAdminAuth.getState().session?.adminId}:${resource}`); return v && v > 0 ? v : undefined; }
export function markH4Read(resource: Resource, success: boolean) {
  const key = `${useAdminAuth.getState().session?.adminId}:${resource}`;
  fresh.set(key, (Math.abs(fresh.get(key) ?? 0) + 1) * (success ? 1 : -1));
  if (success && resource !== "raffles") pendingH4Commands().filter(r => !r.scope.includes("/h4_media/") && r.acknowledged && !("proposal" in r.request) && resourceOf(r.scope) === resource).forEach(forget);
  notify();
}
export function assertH4Fresh(resource: Resource, version: number | undefined) {
  if (version === undefined || version !== h4ReadVersion(resource)) throw new Error("H4_REFRESH_REQUIRED");
}
function requireActor(owner: number, write: boolean, scope: string) {
  const auth = useAdminAuth.getState(), actor = auth.session;
  if (!auth.isAuthenticated || auth.logoutPending || !actor || actor.adminId !== owner) throw new Error("ADMIN_AUTH_REQUIRED");
  const allowed = scope.includes("/h4_media/") ? actor.authorities.includes("device_e1_write") || scope.endsWith("/promotion-banner") && actor.authorities.includes("growth_promotion_edit")
    || scope === "H/h4_media/promotion-evidence" && actor.authorities.some(code => ["growth_promotion_reward_cancel", "growth_promotion_reward_reverse", "growth_promotion_reward_resolve"].includes(code))
    : actor.authorities.includes(scope.includes("/h4_wheel_") ? "growth_h4_wheel_pool_write" : "growth_h4_write");
  if (write && !allowed) throw new Error("H4_MAKER_FORBIDDEN");
  return actor;
}
function forget(r: H4Command) { h4CommandStores[r.store].forget(r.fingerprint, r.commandKey); observations.delete(r.commandKey); directReceipts.delete(r.commandKey); notify(); }
function retain(r: H4Command) {
  const storage = h4CommandStores[r.store];
  storage.remember(r.fingerprint, r.commandKey, r);
  notify();
  if (!storage.isDurablyStored(r.fingerprint, r.commandKey)) throw new Error("H4_REQUEST_STORAGE_UNAVAILABLE");
}

function raffleReadback(raw: H4StoredCommand, request: Direct, scope: string, body: { id?: unknown; expectedRevision?: number }): H4Command["raffleReadback"] {
  if (!raw.acknowledged) return;
  const id = /^H\/h4_genesis_raffle\/([A-Za-z0-9_-]{1,64})$/.exec(scope)?.[1];
  if (!id) return;
  const minimumRevision = request.method === "PATCH" && request.path === `/genesis-raffle/${id}`
    && typeof body.expectedRevision === "number" && Number.isSafeInteger(body.expectedRevision) && body.expectedRevision > 0
    ? body.expectedRevision + 1
    : request.method === "POST" && request.path === "/genesis-raffle" && body.id === id ? 1 : undefined;
  if (minimumRevision === undefined || !Number.isSafeInteger(minimumRevision)) return;
  const receipt = raw.raffleReceipt;
  return { id, minimumRevision, hasMatchingReceipt: receipt?.id === id && receipt.revision === minimumRevision };
}

/** Old input fingerprints already contain the exact wire body. Parse them only
 * here, at the persisted-data boundary; never replace them with today's form. */
export function pendingH4Commands(): H4Command[] {
  const actor = useAdminAuth.getState().session;
  if (!actor) return [];
  const operator = actor.operator || actor.username;
  return Object.entries(h4CommandStores).flatMap(([store, storage]) => storage.list().flatMap(raw => {
    try {
      if (store === "hi") {
        if (raw.owner !== actor.adminId || !raw.scope.startsWith("H/")) return [];
        const p = raw.payload;
        const origin = raw.commandOrigin as FundCommandOrigin | undefined;
        if (origin && (p.kind !== "retire" || origin.originalMethod !== "POST"
          || origin.originalPath !== `/api/admin/growth/quest-events/wheel-tiers/${encodeURIComponent(p.tierName)}/retire`
          || origin.originalAdminId !== String(raw.owner) || origin.readAuthority !== "growth_h4_read")) return [];
        const request = p.kind === "proposal" ? { proposal: p.input as Proposal }
          : { path: `/quest-events/wheel-tiers/${encodeURIComponent(p.tierName)}/retire`, method: "POST" as const, body: raw.body };
        return [{ ...raw, store, raffleReceipt: undefined, action: p.kind === "proposal" ? p.input.action : `退役积分奖项 · ${p.tierName}`, reason: p.input.reason, request } as H4Command];
      }
      if (store === "direct") {
        if (raw.owner !== actor.adminId) return [];
        const b = JSON.parse(raw.request.body);
        if (b.reason !== raw.reason || !(raw.request.path.startsWith("/media/uploads?") || /^\/(?:quest-events\/(?:events|wheel-tiers|wheel-guards)(?:\/[^/]+)*(?:\/content\/[^/]+\/[^/]+)?|event-rules\/[^/]+|genesis-raffle(?:\/[^/]+)?)$/.test(raw.request.path))) return [];
        const target = raw.uploadTarget;
        const validTarget = target && typeof target.objectId === "string" && !!target.objectId && Number.isSafeInteger(target.revision)
          && (target.kind === "banner" && target.position === "bannerAssetId" && Number.isSafeInteger(target.version)
            || target.kind === "evidence" && target.position === "evidenceAssetId" && typeof target.operation === "string");
        return [{ ...raw, store, uploadTarget: validTarget ? target : undefined, raffleReadback: raffleReadback(raw, raw.request, raw.scope, b) } as H4Command];
      }
      if (!hasPersistedPendingCommandOwner(String(actor.adminId))) return [];
      if (store === "delete") return [{ ...raw, store, raffleReceipt: undefined, owner: actor.adminId, scope: `H/h4_legacy_event/${raw.eventId}`, action: `删除既有活动 · ${raw.eventId}`, reason: raw.reason,
        request: { path: `/quest-events/events/${encodeURIComponent(raw.eventId)}`, method: "DELETE", body: JSON.stringify({ expectedVersion: raw.expectedVersion, reason: raw.reason }) } } as H4Command];
      if (!raw.fingerprint.startsWith(`${operator}:`)) return [];
      const body = JSON.parse(raw.inputFingerprint), id = raw.fingerprint.slice(operator.length + 1);
      if (!body || typeof body.reason !== "string" || typeof id !== "string" || !id) return [];
      const scope = `H/${store === "rule" ? "h4_event_rule" : "h4_genesis_raffle"}/${id}`;
      const request: Direct = { path: store === "rule" ? `/event-rules/${encodeURIComponent(id)}` : `/genesis-raffle${body.expectedRevision === undefined ? "" : `/${encodeURIComponent(id)}`}`,
        method: store === "raffle" && body.expectedRevision === undefined ? "POST" : "PATCH", body: raw.inputFingerprint };
      return [{ ...raw, store, owner: actor.adminId, scope, request, raffleReadback: raffleReadback(raw, request, scope, body),
        action: `${store === "rule" ? "保存玩法配置" : "保存抽奖配置"} · ${id}`, reason: body.reason } as H4Command];
    } catch { return []; }
  }));
}
export const h4PendingFor = (scope: string) => pendingH4Commands().find(r => r.scope === scope && !r.asset && (!r.acknowledged || "proposal" in r.request));
/** Validated direct successes awaiting a current read, never unknown outcomes. */
export const confirmedH4Saves = () => pendingH4Commands().filter(r => r.acknowledged && !r.asset && !("proposal" in r.request));
export const confirmedH4RaffleSaves = () => confirmedH4Saves().filter(record => resourceOf(record.scope) === "raffles");
export const h4RaffleSaveNeedsVerification = (record: H4Command) =>
  resourceOf(record.scope) === "raffles" && !record.raffleReadback?.hasMatchingReceipt;
export function confirmH4RaffleReadback(records: H4Command[], details: ReadonlyMap<string, AdminRaffle | null>) {
  const unconfirmed = records.some(({ raffleReadback }) => {
    // A record that cannot be read back (an older one without a valid revision) or whose draw is gone has
    // nothing left to protect: keeping it would fail every list read and lock the page with no way out.
    if (!raffleReadback) return false;
    const current = details.get(raffleReadback.id);
    if (current === null) return false;
    return !current || current.revision < raffleReadback.minimumRevision;
  });
  if (unconfirmed) {
    throw new OutcomeUnknownError("创世抽奖配置读取失败，请刷新后重试。");
  }
  records.forEach(forget);
}
export const recoveredH4Uploads = () => pendingH4Commands().filter(r => r.scope.includes("/h4_media/") && !!r.asset).map(r => ({ ...r,
  restoration: r.restoration ?? { canAutoRestore: !!r.uploadTarget, restored: false, reason: r.uploadTarget ? "等待在原对象中恢复" : "旧记录未保存目标对象，请重新选择" },
}));
/** Restore only the original field. This changes the draft, never saves it. */
export async function restoreH4Uploads(target: H4UploadTarget, writable: boolean, apply: (assetId: string) => void, restored: Set<string>) {
  const results: Array<{ commandKey: string } & H4UploadRestoration> = [];
  for (const record of recoveredH4Uploads()) {
    const saved = record.uploadTarget;
    if (!saved || saved.kind !== target.kind || saved.objectId !== target.objectId || saved.position !== target.position) continue;
    if (restored.has(record.commandKey)) { results.push({ commandKey: record.commandKey, ...record.restoration }); continue; }
    let reason = "";
    if (!writable) reason = "原对象当前不允许修改";
    else if (saved.revision !== target.revision || saved.kind === "banner" && target.kind === "banner" && saved.version !== target.version
      || saved.kind === "evidence" && target.kind === "evidence" && saved.operation !== target.operation) reason = "原对象的版本或操作已变化";
    else {
      try {
        if (saved.kind === "banner") {
          const current = await promotionRead<Promotion>(`/promotions/${encodeURIComponent(saved.objectId)}`);
          if (current.deleted || ["ENDED", "ARCHIVED"].includes(current.state) || current.current?.state !== "DRAFT"
            || current.current.version !== saved.version || current.current.revision !== saved.revision) reason = "原活动草稿已不存在或状态已变化";
        } else {
          const current = await promotionRead<RewardAdmin>(`/promotion-rewards/${encodeURIComponent(saved.objectId)}`);
          if (current.revision !== saved.revision) reason = "原奖励义务已变化";
        }
      } catch { reason = "无法确认原对象是否仍存在且允许修改"; }
    }
    const restoration = { canAutoRestore: !reason, restored: !reason, reason };
    if (!reason) { apply(record.asset!.assetId); restored.add(record.commandKey); }
    if (record.restoration.canAutoRestore !== restoration.canAutoRestore || record.restoration.restored !== restoration.restored || record.restoration.reason !== restoration.reason) {
      h4CommandStores[record.store].remember(record.fingerprint, record.commandKey, { ...record, restoration });
      notify();
    }
    results.push({ commandKey: record.commandKey, ...restoration });
  }
  return results;
}
export async function acknowledgeH4Upload(record: H4Command) { if (!record.asset) throw new Error("H4_RESULT_UNKNOWN"); await deleteH4UploadFile(record.commandKey); forget(record); }
export const h4TicketObservations = () => {
  const owner = useAdminAuth.getState().session?.adminId;
  if (owner !== observationOwner) { observations.clear(); directReceipts.clear(); observationOwner = owner; }
  return [...observations.values()];
};
export const h4CommandHasPendingTicket = (key: string) => { h4TicketObservations(); return observations.get(key)?.status === "pending"; };
export function clearH4AuditProjection() { for (const [key, ticket] of observations) if (key === ticket.id) observations.delete(key); notify(); }
export function replaceH4TicketObservations(rows: A2OperationRow[]) {
  h4TicketObservations();
  const originals = [...observations].filter(([key, ticket]) => key !== ticket.id);
  observations.clear(); rows.forEach(r => observations.set(r.id, r));
  for (const [key, old] of originals) { const current = rows.find(r => r.id === old.id); if (current) observations.set(key, current); }
  notify();
}
export function h4Scope(path: string, body: Record<string, any>) {
  const parts = path.split("/").map(decodeURIComponent), id = parts[3];
  if (parts[1] === "event-rules") return `H/h4_event_rule/${parts[2]}`;
  if (parts[1] === "genesis-raffle") return `H/h4_genesis_raffle/${parts[2] ?? body.id}`;
  if (parts[2] === "wheel-guards") return `H/h4_wheel_guard/${id ?? body.guardKey}`;
  if (parts[2] === "wheel-tiers") return "H/h4_wheel_pool/ACTIVE_POOL";
  return `H/h4_legacy_event/${id ?? body.id}`;
}
export function h4ApprovalPending(scope: string) {
  const [, type, id] = scope.split("/");
  const event = type === "h4_event_rule" || type === "h4_legacy_event";
  return h4TicketObservations().some(t => {
    const targetType = findHighOp(t.operationCode ?? "")?.targetType;
    return t.status === "pending" && t.obj === id && (targetType === type
      || event && (targetType === "h4_event_rule" || targetType === "h4_legacy_event"));
  });
}
export function h4ApprovalLockedReason(scope: string) {
  return h4ApprovalPending(scope) ? formatAdminApiError("OBJECT_LOCKED_BY_A2", "OBJECT_LOCKED_BY_A2") : undefined;
}
export function h4Blocked(scope: string) { return !!h4PendingFor(scope) || h4ApprovalPending(scope); }
function rejected(error: unknown, recovery: boolean) {
  if (isA2OutcomeUncertainError(error) || isOutcomeUnknownError(error)) return false;
  const e = error as { status?: number; apiCode?: number; reasonCode?: string; backendMessage?: string; unknownOutcome?: boolean; bodyUnreadable?: boolean };
  if (!e || e.unknownOutcome || e.bodyUnreadable || (e.apiCode ?? 0) >= 500 || (e.reasonCode ?? e.backendMessage ?? "").startsWith("IDEMPOTENCY_")) return false;
  if (e.status && e.status >= 200 && e.status < 300 && e.apiCode && e.apiCode >= 400 && e.apiCode < 500) e.status = e.apiCode;
  return recovery ? isExplicitRejection(error) : isDeterministicRejection(e.status ?? 0, e.apiCode);
}
function checkTicket(r: H4Command, ticket: A2OperationRow) {
  if (!("proposal" in r.request) || !ticket.mine || ticket.obj !== r.request.proposal.obj || ticket.operationCode !== r.request.proposal.command.op
    || !["pending", "approved", "rejected", "expired", "withdrawn"].includes(ticket.status)) throw new OutcomeUnknownError("H4_PROPOSAL_RESPONSE_INVALID");
}

// Each scope uses the target passed to OpsGrowthCommandBoundary by the original route.
const H4_DIRECT_RECEIPTS: ReadonlyArray<readonly [Direct["method"], RegExp, string, ("id" | "guardKey" | "tierName")?]> = [
  ["POST", /^\/quest-events\/events$/, "EVENT_CREATE", "id"],
  ["DELETE", /^\/quest-events\/events\/([^/]+)$/, "EVENT_DELETE"],
  ["PATCH", /^\/quest-events\/events\/([^/]+)\/content\/[^/]+\/[^/]+$/, "EVENT_LOCALIZED_CONTENT_UPDATE"],
  ["PATCH", /^\/quest-events\/events\/([^/]+)\/reward$/, "EVENT_REWARD_UPDATE"],
  ["PATCH", /^\/quest-events\/events\/([^/]+)\/status$/, "EVENT_STATUS_UPDATE"],
  ["PATCH", /^\/quest-events\/events\/([^/]+)\/featured$/, "EVENT_FEATURED_UPDATE"],
  ["PATCH", /^\/event-rules\/([^/]+)$/, "EVENT_RULE_UPDATE"],
  ["POST", /^\/genesis-raffle$/, "GENESIS_RAFFLE_CREATE", "id"],
  ["PATCH", /^\/genesis-raffle\/([^/]+)$/, "GENESIS_RAFFLE_UPDATE"],
  ["POST", /^\/quest-events\/wheel-guards$/, "WHEEL_GUARD_CREATE", "guardKey"],
  ["PATCH", /^\/quest-events\/wheel-guards\/([^/]+)$/, "WHEEL_GUARD_UPDATE"],
  ["POST", /^\/quest-events\/wheel-tiers$/, "WHEEL_TIER_CREATE", "tierName"],
  ["PATCH", /^\/quest-events\/wheel-tiers\/probabilities$/, "WHEEL_PROBABILITIES_UPDATE"],
  ["PATCH", /^\/quest-events\/wheel-tiers\/([^/]+)$/, "WHEEL_TIER_UPDATE"],
  ["DELETE", /^\/quest-events\/wheel-tiers\/([^/]+)$/, "WHEEL_TIER_DELETE"],
  ["POST", /^\/quest-events\/wheel-tiers\/([^/]+)\/retire$/, "WHEEL_TIER_RETIRE"],
];

function h4DirectReceiptScope(request: Direct) {
  for (const [method, path, operation, bodyTarget] of H4_DIRECT_RECEIPTS) {
    if (method !== request.method) continue;
    const match = path.exec(request.path);
    if (!match) continue;
    const target: unknown = bodyTarget ? JSON.parse(request.body)[bodyTarget] : match[1] ? decodeURIComponent(match[1]) : "ACTIVE_POOL";
    if (typeof target !== "string" || !target) return undefined;
    const trimmedTarget = target.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, "");
    return `GROWTH:H4:${operation}:${trimmedTarget}`.toUpperCase().replace(/[^A-Z0-9_.:-]/gu, "_");
  }
}

export async function queryH4Command(r: H4Command): Promise<A2OperationRow | null | undefined> {
  requireActor(r.owner, false, r.scope);
  h4TicketObservations();
  if (!("proposal" in r.request)) {
    const directScope = h4DirectReceiptScope(r.request);
    if (!directScope) return undefined;
    directReceipts.delete(r.commandKey);
    notify();
    try {
      const state = await fetchDirectCommandReceipt(directScope, r.commandKey, r.owner);
      const original = pendingH4Commands().find(row => row.commandKey === r.commandKey);
      if (!original) return undefined;
      directReceipts.set(r.commandKey, state);
      if (state === "SUCCEEDED") {
        markH4Read(resourceOf(original.scope), false);
        retain({ ...original, acknowledged: true });
      } else if (state === "REJECTED" || state === "NOT_EXECUTED") {
        markH4Read(resourceOf(original.scope), false);
        forget(original);
      }
    }
    finally { notify(); }
    return undefined;
  }
  const ticket = await fetchA2ProposalByKey(r.commandKey, true);
  requireActor(r.owner, false, r.scope);
  if (ticket) {
    checkTicket(r, ticket);
    observations.delete(r.commandKey);
    for (const [key, old] of observations) if (old.obj === ticket.obj && old.operationCode === ticket.operationCode) observations.delete(key);
    if (ticket.status !== "pending") markH4Read(resourceOf(r.scope), false);
    if (ticket.status === "pending") { retain({ ...r, acknowledged: true }); observations.set(r.commandKey, ticket); }
    else forget(r);
    notify();
  }
  return ticket;
}

export function h4RetryBlockedReason(r: H4Command): string | undefined {
  if (isRetryExpired(r)) return RETRY_EXPIRED_TEXT;
  if (r.acknowledged) return "请查询原结果";
  try { requireActor(r.owner, true, r.scope); } catch { return "没有这项修改的权限"; }
  if ("proposal" in r.request) return;
  const state = directReceipts.get(r.commandKey);
  if (state === "NOT_FOUND") return;
  return state === "PROCESSING" ? "原操作还在处理，请稍后再查" : "先查询原结果，明确查不到后才能重试";
}

export function h4PendingConfirmRecovery(record: H4Command | undefined, onSettled: () => Promise<void>) {
  if (!record) return;
  return {
    expiresAt: record.expiresAt,
    blockedReason: h4RetryBlockedReason(record),
    query: async () => {
      await queryH4Command(record);
      const current = pendingH4Commands().find(row => row.commandKey === record.commandKey);
      if (!current || current.acknowledged) await onSettled();
    },
  };
}
async function send(r: H4Command, recovery: boolean): Promise<Record<string, any> | H4ApprovalReceipt> {
  requireActor(r.owner, true, r.scope);
  if (isRetryExpired(r)) throw new Error(RETRY_EXPIRED_TEXT);
  if (r.acknowledged) throw new Error("H4_REFRESH_REQUIRED");
  try { retain(r); } catch (error) { if (!recovery) forget(r); throw error; }
  let result: Record<string, any>;
  let raffleReceipt: H4Command["raffleReceipt"];
  const media = !("proposal" in r.request) && r.request.path.startsWith("/media/uploads?");
  try {
    if ("proposal" in r.request) {
      const ticket = await createA2OperationProposal(r.request.proposal, r.commandKey, true);
      checkTicket(r, ticket); result = {};
    } else {
      const request = r.request, b = JSON.parse(request.body), parts = request.path.split("/").map(decodeURIComponent);
      if (request.path.startsWith("/media/uploads?")) {
        const file = await readH4UploadFile(r.commandKey);
        const response = await guardedFetch(`/api/admin${request.path}`, { method: "POST", headers: { "Idempotency-Key": r.commandKey, "Content-Type": b.multipartContentType }, body: file, cache: "no-store" });
        const envelope = await response.json().catch(() => null);
        if (!response.ok || envelope?.code !== 0 || response.headers.get("X-Nexion-Upstream-Outcome") === "unknown") {
          throw Object.assign(new Error(formatAdminApiError(envelope?.message, `MEDIA_REQUEST_FAILED_${response.status}`)), { status: response.status, apiCode: envelope?.code, reasonCode: envelope?.message, bodyUnreadable: !envelope, unknownOutcome: response.headers.get("X-Nexion-Upstream-Outcome") === "unknown" });
        }
        const asset = envelope.data;
        if (!asset || typeof asset.assetId !== "string" || !asset.assetId || typeof asset.objectKey !== "string" || typeof asset.previewUrl !== "string") throw new OutcomeUnknownError("H4_RESPONSE_INVALID");
        result = asset;
      } else {
      result = await growthRequest<Record<string, any>>(request.path, { method: request.method, body: request.body, headers: { "Idempotency-Key": r.commandKey } }, undefined, true);
      const updated = result?.updated, target = parts[3] ?? b.id ?? b.tierName ?? b.guardKey;
      const valid = parts[1] === "event-rules" ? result?.eventCode === parts[2] && result.revision === b.expectedRevision + 1
        : parts[1] === "genesis-raffle" ? result?.id === (parts[2] ?? b.id) && result.revision === (b.expectedRevision === undefined ? 1 : b.expectedRevision + 1)
        : parts[2] === "events" && request.method === "DELETE" ? result?.eventId === target && result.deleted === true
        : result?.domain === "H4" && updated && (parts[2] === "wheel-guards" ? updated.guardKey === target
          : parts[2] === "wheel-tiers" ? parts[3] === "probabilities" ? !!updated.probabilities : updated.tierName === target
          : request.path.includes("/content/") ? updated.key === `content.event.${target}.${parts[5]}.${parts[6]}` && updated.field === parts[5] && updated.locale === parts[6]
          : updated.eventId === target && (request.method === "POST" ? updated.action === "created" : updated.field === parts[4]));
      if (!valid) throw new OutcomeUnknownError("H4_RESPONSE_INVALID");
      if (parts[1] === "event-rules") {
        parseEventRule(result);
      } else if (parts[1] === "genesis-raffle") {
        const saved = parseAdminRaffle(result);
        if (saved.prizes.length !== b.prizes.length || Object.values(RAFFLE_LANGUAGES).some(({ suffix }) =>
          saved[`title${suffix}`] !== b[`title${suffix}`]
          || b.prizes.some((prize: { id: string } & Record<string, unknown>) =>
            saved.prizes.find(item => item.id === prize.id)?.[`name${suffix}`] !== prize[`name${suffix}`]))) {
          throw new OutcomeUnknownError("H4_RESPONSE_INVALID");
        }
        raffleReceipt = { id: saved.id, revision: saved.revision };
      } else if (parts[1] === "quest-events" && !(parts[2] === "events" && request.method === "DELETE")
        && !request.path.endsWith("/retire")) {
        validateH4OverviewEvents(result.events);
        if (request.path.includes("/content/")) {
          const actual = result.contentLocales?.event?.[target]?.[parts[6]]?.[parts[5]];
          if ((actual ?? "") !== trimStoredContent(b.value)) throw new OutcomeUnknownError("H4_RESPONSE_INVALID");
        }
      }
      }
    }
  } catch (error) {
    if (rejected(error, recovery)) {
      forget(r);
      if (r.scope.includes("/h4_media/")) await deleteH4UploadFile(r.commandKey);
      if (recovery || isHGrowthReadConflict(error)) markH4Read(resourceOf(r.scope), false);
      throw error;
    }
    throw new OutcomeUnknownError("H4_RESULT_UNKNOWN");
  }
  retain({ ...r, acknowledged: true, ...(raffleReceipt ? { raffleReceipt } : {}), ...(media ? { asset: result as UploadedAsset } : {}) });
  if (media) {
    // Local file cleanup is outside the write-outcome catch: it cannot turn a
    // validated successful upload into an unknown backend result.
    await deleteH4UploadFile(r.commandKey);
    if (!recovery) forget(r);
    return result;
  }
  markH4Read(resourceOf(r.scope), false);
  if ("proposal" in r.request) {
    const ticket = await queryH4Command({ ...r, acknowledged: true });
    if (!ticket) throw new OutcomeUnknownError("H4_APPROVAL_STATUS_UNKNOWN");
    return { h4Approval: true, ticket };
  }
  return result;
}
export async function retryH4Command(original: H4Command) {
  const r = pendingH4Commands().find(item => item.commandKey === original.commandKey);
  if (!r) throw new Error("H4_ORIGINAL_RESOLVED");
  if ("proposal" in r.request) { const ticket = await queryH4Command(r); if (ticket) return { h4Approval: true, ticket } as H4ApprovalReceipt; }
  else {
    const blocked = h4RetryBlockedReason(r);
    if (blocked) throw new Error(blocked);
    directReceipts.delete(r.commandKey);
    notify();
  }
  return send(r, true);
}
export async function submitH4Proposal(scope: string, proposal: Proposal, form?: Record<string, string>, editValue?: string) {
  const actor = useAdminAuth.getState().session;
  if (!actor) throw new Error("ADMIN_AUTH_REQUIRED");
  requireActor(actor.adminId, true, scope); assertH4Fresh(resourceOf(scope), h4ReadVersion(resourceOf(scope)));
  if (h4ApprovalPending(scope)) throw new Error("OBJECT_LOCKED_BY_A2");
  if (h4Blocked(scope)) throw new Error("H4_ORIGINAL_UNRESOLVED");
  return send({ store: "hi", owner: actor.adminId, scope, fingerprint: `${actor.adminId}:${scope}`, commandKey: createA2CommandKey(proposal.command.op),
    createdAt: Date.now(), expiresAt: Date.now() + 86400000, action: proposal.action, reason: proposal.reason,
    payload: { kind: "proposal", input: proposal }, body: JSON.stringify(proposal), request: { proposal }, form, editValue }, false);
}

/** Direct request bodies stay byte-for-byte unchanged. Only a known growth
 * direction or the backend's explicit approval rejection switches to A2. */
export async function h4CommandRequest(path: string, init: Omit<Direct, "path">, action: string, approval = false): Promise<Record<string, any>> {
  const actor = useAdminAuth.getState().session;
  if (!actor) throw new Error("ADMIN_AUTH_REQUIRED");
  const body = JSON.parse(init.body), scope = h4Scope(path, body), parts = path.split("/").map(decodeURIComponent);
  requireActor(actor.adminId, true, scope); assertH4Fresh(resourceOf(scope), h4ReadVersion(resourceOf(scope)));
  if (h4ApprovalPending(scope)) throw new Error("OBJECT_LOCKED_BY_A2");
  if (h4Blocked(scope)) throw new Error("H4_ORIGINAL_UNRESOLVED");
  let op: string | undefined, values: Record<string, unknown> = {};
  if (parts[1] === "event-rules" && body.enabled) { op = "h4_event_rule_enable"; const { reason, ...change } = body; values = { eventCode: parts[2], ...change }; }
  else if (parts[1] === "genesis-raffle" && body.enabled) { op = "h4_genesis_raffle_open"; const { reason, ...change } = body; values = change; }
  else if (parts[2] === "wheel-guards") {
    const key = parts[3] ?? body.guardKey;
    op = parts[3] ? "h4_wheel_guard_update" : "h4_wheel_guard_create";
    values = parts[3] ? { guardKey: key, value: body.value, expectedValue: body.expectedValue }
      : { guardKey: key, guardLabel: body.guardLabel, guardValue: body.guardValue, note: body.note ?? "" };
    const on = (v: string) => ["1", "true", "on", "enabled", "open", "开"].includes(v.trim().toLowerCase());
    const number = (v: string) => Number(v.replace(/[$,\s]/g, ""));
    approval = approval || (key === "kill" ? on(body.value ?? body.guardValue) && (!parts[3] || !on(body.expectedValue))
      : key === "budget" && number(body.value ?? body.guardValue) > (parts[3] ? number(body.expectedValue) : 0));
  } else if (parts[2] === "events" && ["reward", "status"].includes(parts[4])) {
    op = parts[4] === "reward" ? "h4_legacy_event_reward_update" : body.value === "ongoing" ? "h4_legacy_event_open" : undefined;
    values = { eventCode: parts[3], value: body.value, expectedValue: body.expectedValue };
    if (op === "h4_legacy_event_open" && !approval) {
      const preview = await growthRequest<{ approvalRequired: boolean }>(`${path}/preview`, { method: "POST", body: init.body });
      if (!preview || typeof preview.approvalRequired !== "boolean") throw new Error("H4_RESPONSE_INVALID");
      approval = preview.approvalRequired;
    }
  } else if (parts[2] === "wheel-tiers" && parts[4] !== "retire") {
    op = parts[3] === "probabilities" ? "h4_wheel_probabilities_update" : init.method === "DELETE" ? "h4_wheel_tier_delete" : init.method === "POST" ? "h4_wheel_tier_create" : "h4_wheel_tier_update";
    if (parts[3] === "probabilities") values = { probabilities: Object.fromEntries(Object.entries(body.probabilities).map(([k, v]) => [k, String(v)])), expectedSignature: body.expectedSignature };
    else if (init.method === "DELETE") values = { tierName: parts[3], expectedSignature: body.expectedValue };
    else { const { reason, operator, ...tier } = body; values = { ...tier, probabilityPct: String(tier.probabilityPct), rewardAmount: String(tier.rewardAmount) }; }
  }
  const propose = () => {
    const def = findHighOp(op!)!, target = def.buildTarget(values);
    return submitH4Proposal(scope, { action: def.action, obj: target.id, beforeValue: String(body.expectedValue ?? body.expectedRevision ?? body.expectedSignature ?? "—"), afterValue: JSON.stringify(values),
      operator: actor.operator || actor.username, operatorRole: roleLabel(actor.role), type: def.type, amplifies: true, sos: false, roleGate: def.gateLabel,
      reason: body.reason, sourceDomain: "H4", command: def.buildCommand(values), target });
  };
  if (approval) {
    if (!op) throw new Error("H4_APPROVAL_REQUIRED");
    return propose();
  }
  const now = Date.now();
  try {
    return await send({ store: "direct", owner: actor.adminId, scope, fingerprint: `${actor.adminId}:${scope}`, commandKey: createA2CommandKey("h4-direct"),
      createdAt: now, expiresAt: now + 86400000, action, reason: body.reason, request: { ...init, path } }, false);
  } catch (error) {
    if (op && rejected(error, false) && (error as { reasonCode?: string }).reasonCode === "H4_APPROVAL_REQUIRED") {
      throw new HApprovalRequired((error as Error).message, { path, ...init, action }, () => h4CommandRequest(path, init, action, true));
    }
    throw error;
  }
}

export const pendingH4EventDeletes = () => pendingH4Commands().filter(r => r.store === "delete");

export async function uploadH4Media(file: File, params: URLSearchParams, uploadTarget?: H4UploadTarget): Promise<UploadedAsset> {
  const actor = useAdminAuth.getState().session;
  if (!actor) throw new Error("ADMIN_AUTH_REQUIRED");
  const scope = `H/h4_media/${params.get("usage")}`;
  requireActor(actor.adminId, true, scope);
  if (h4PendingFor(scope)) throw new Error("H4_ORIGINAL_UNRESOLVED");
  const key = createA2CommandKey("h4-upload"), now = Date.now();
  const multipart = new FormData(); multipart.append("file", file);
  const wire = new Request(new URL(`/api/admin/media/uploads?${params}`, window.location.origin), { method: "POST", body: multipart });
  const multipartContentType = wire.headers.get("Content-Type")!;
  const savedFile = new File([await wire.arrayBuffer()], file.name, { type: file.type });
  const record: H4Command = { store: "direct", owner: actor.adminId, scope, fingerprint: `${actor.adminId}:${scope}`, commandKey: key,
    createdAt: now, expiresAt: now + 86400000, action: params.get("usage") === "promotion-banner" ? "上传宣传图" : "上传处置证据", reason: "", uploadTarget,
    restoration: { canAutoRestore: !!uploadTarget, restored: false, reason: uploadTarget ? "等待在原对象中恢复" : "旧记录未保存目标对象，请重新选择" },
    request: { path: `/media/uploads?${params}`, method: "POST", body: JSON.stringify({ reason: "", fileName: file.name, contentType: file.type, size: file.size, multipartContentType, params: params.toString() }) } };
  try { await saveH4UploadFile(key, savedFile); return await send(record, false) as UploadedAsset; }
  finally { if (!pendingH4Commands().some(r => r.commandKey === key)) await deleteH4UploadFile(key); }
}
