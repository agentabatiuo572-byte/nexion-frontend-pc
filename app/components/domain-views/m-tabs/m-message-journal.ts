import { useSyncExternalStore } from "react";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { privateMessageRecovery, type PrivateMessageRecovery } from "@/lib/admin/m-support-enhancements";
import { fetchMConversationDetail } from "@/lib/admin/m-client";
import { isSupportScopeDenial, supportClient, isDefiniteSupportRefusal, SupportClientError, type SupportMessageInput } from "@/lib/admin/m-support-client";
import type { SessionConvo, SessionMsg } from "./data";

type Intent = "SERVICE" | "MAINTENANCE";
export type Pending = { conversationId: string; customerId?: string; key: string; body: string; originalDraft?: string; draftSlot?: string; intent: Intent; kind: "TEXT" | "IMAGE" | "SKU" | "LINK"; attachmentId?: string; message: SessionMsg; expectedAssignmentId: string; expectedStatus?: string; expectedVersion: number };
type FirstContact = { key: string; body: string; originalDraft?: string; draftSlot?: string; intent: Intent; clientMessageId: string; customerId: string; assignmentId: string; version: number; replyTargets: Array<{ conversationNo: string; throughMessageId: number }> };

let revision = 0;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const useSendJournalRevision = () => useSyncExternalStore(subscribe, () => revision, () => 0);
function changed() {
  revision++;
  listeners.forEach(listener => listener());
}
function createMessageJournal<T extends PendingMutationRecord>(options: Parameters<typeof createPendingMutationStore<T>>[0]) {
  const primary = options.storageKey, alternate = primary + ":redacted";
  let storageKey = primary;
  if (typeof window !== "undefined") {
    try { if (sessionStorage.getItem(primary) === null && sessionStorage.getItem(alternate) !== null) storageKey = alternate; }
    catch { /* The shared store supports in-memory reads when storage is disabled. */ }
  }
  let store = createPendingMutationStore<T>({ ...options, storageKey });
  return {
    list: () => store.list(),
    remember(...args: Parameters<typeof store.remember>) { store.remember(...args); changed(); },
    forget(...args: Parameters<typeof store.forget>) { store.forget(...args); changed(); },
    isDurablyStored: (slot: string, key: string) => store.isDurablyStored(slot, key),
    redact(record: T, fingerprint: string, extra: NonNullable<Parameters<typeof store.remember>[2]>) {
      store.remember(fingerprint, record.commandKey, extra);
      changed();
      try {
        const table = JSON.parse(sessionStorage.getItem(storageKey) ?? "{}");
        const original = table[record.commandKey];
        if (!original || original.commandOwnerId !== record.commandOwnerId) return false;
        const replacement = { ...extra, fingerprint, commandKey: record.commandKey, createdAt: record.createdAt,
          expiresAt: record.expiresAt, commandOwnerId: record.commandOwnerId };
        if (original.fingerprint === fingerprint && Object.entries(extra).every(([k, v]) => original[k] === v)
          && Object.keys(original).every(field => field in replacement)) return true;
        table[record.commandKey] = replacement;
        const bytes = JSON.stringify(table);
        const destination = storageKey === primary ? alternate : primary;
        // Preserve the other raw rows, including timeout commands and other submitters.
        sessionStorage.setItem(destination, bytes);
        if (sessionStorage.getItem(destination) !== bytes) return false;
        sessionStorage.removeItem(storageKey);
        storageKey = destination;
        store = createPendingMutationStore<T>({ ...options, storageKey });
        return true;
      } catch { return false; }
    },
  };
}

export const pendingKey = (adminId: number) => `nexion-m3-dedicated-pending:${adminId}`;
export const replySlot = (adminId: number, customerId: string) => `${pendingKey(adminId)}:${customerId}`;
export const recoveryKey = (adminId: number, key: string) => `${pendingKey(adminId)}:recovery:${key}`;
export const firstPendingKey = (adminId: number, customerId: string) => `nexion-m3-first-pending:${adminId}:${customerId}`;
export type StoredMessage = PendingMutationRecord & { payload: string };
// Legacy timeout rows must survive private-message housekeeping even when their payload cannot be recovered.
export const pendingMessages = createMessageJournal<StoredMessage>({ storageKey: "nexion-admin-m3-private-pending-v1", retainExpiredRecords: true, isValidRecord: (row) => typeof row.payload === "string" || /^nexion-m3-timeout:[1-9]\d*$/.test(row.fingerprint) });
export interface DockCommandRecord extends PendingMutationRecord { payload: string; conversationNo: string; customerId?: string; readOnlyRecovery?: boolean; originalDraft?: string; draftAssignmentId?: string }
export const dockCommands = createMessageJournal<DockCommandRecord>({
  storageKey: "nexion-admin-m-dock-pending-v1",
  retainExpiredRecords: true,
  isValidRecord: (record) => typeof record.payload === "string" && typeof record.conversationNo === "string"
    && (record.customerId === undefined || typeof record.customerId === "string")
    && (record.originalDraft === undefined || typeof record.originalDraft === "string")
    && (record.draftAssignmentId === undefined || typeof record.draftAssignmentId === "string")
    && (record.readOnlyRecovery === undefined || typeof record.readOnlyRecovery === "boolean"),
});
// Closed commands with text displaced by a newer draft. These copies never lock or replay a send.
interface FailedDraftCopy extends PendingMutationRecord { customerId: string; conversationId?: string; assignmentId: string; body: string; source?: "dock" | "main"; legacySlot?: boolean; displaced?: boolean }
const legacyDraftCopies = createMessageJournal<FailedDraftCopy>({
  storageKey: "nexion-m3-failed-draft-copies-v1", retainExpiredRecords: true,
  isValidRecord: row => typeof row.customerId === "string" && typeof row.assignmentId === "string"
    && (row.conversationId === undefined || typeof row.conversationId === "string") && typeof row.body === "string",
});
// Closed text stays in its original table until an editable copy can be saved.
export const failedDraftCopies = {
  list(): FailedDraftCopy[] {
    const copies = legacyDraftCopies.list();
    for (const source of ["dock", "main"] as const) {
      for (const row of (source === "dock" ? dockCommands : pendingMessages).list()) {
        const [kind, customerId, assignmentId, conversationId, legacy] = row.fingerprint.split("@");
        if (kind !== `failed-${source}` && kind !== `saved-${source}` || !assignmentId) continue;
        copies.push({ ...row, source, customerId, assignmentId, legacySlot: legacy === "legacy", displaced: kind === `saved-${source}`, conversationId: conversationId || undefined, body: row.payload });
      }
    }
    return copies;
  },
  forget(slot: string, key: string) {
    const store = /^(failed|saved)-dock@/.test(slot) ? dockCommands : /^(failed|saved)-main@/.test(slot) ? pendingMessages : legacyDraftCopies;
    store.forget(slot, key);
  },
};
export const SUPPORT_MESSAGE_MAX_LENGTH = 2000;
/** 输入框下的字数提示（小窗和专属会话共用）：接近上限才出现，超了马上说，不等点发送。按发送时的算法数（去掉首尾空白）。 */
export function supportLengthHint(draft: string) {
  const length = draft.trim().length;
  if (length < SUPPORT_MESSAGE_MAX_LENGTH * 0.9) return null;
  const over = length - SUPPORT_MESSAGE_MAX_LENGTH;
  return over > 0
    ? { over: true, text: `比上限 2,000 字多 ${over.toLocaleString("en-US")} 字，删减后才能发送` }
    : { over: false, text: `${length.toLocaleString("en-US")} / 2,000 字` };
}
export type MessageLocator = Omit<PrivateMessageRecovery, "clientMessageId"> & { clientMessageId?: string };
export type SavedSend = { row: StoredMessage; locator: MessageLocator; reply?: Pending; first?: FirstContact; dock?: DockCommandRecord; dockInput?: SupportMessageInput };

function isMessageSlot(slot: string, adminId: number) {
  return slot === pendingKey(adminId) || slot.startsWith(`${pendingKey(adminId)}:`) || slot.startsWith(`nexion-m3-first-pending:${adminId}:`);
}

export function readSavedSends(adminId: number): SavedSend[] {
  const main = pendingMessages.list().filter(row => isMessageSlot(row.fingerprint, adminId)).map(row => {
    const keyOnly: MessageLocator = { readOnlyRecovery: true, key: row.commandKey };
    let value;
    try { value = JSON.parse(row.payload); }
    catch { return { row, locator: keyOnly }; }
    const locator = privateMessageRecovery(value);
    if (!locator || locator.key !== row.commandKey) {
      if (value && (!value.key || value.key === row.commandKey)) {
        if (typeof value.customerId === "string") keyOnly.customerId = value.customerId;
        if (typeof value.conversationId === "string") keyOnly.conversationId = value.conversationId;
      }
      return { row, locator: keyOnly };
    }
    if (value.readOnlyRecovery) return { row, locator };
    if (value.customerId && row.fingerprint === firstPendingKey(adminId, value.customerId)
      && value.clientMessageId && value.assignmentId && value.body) return { row, locator, first: value as FirstContact };
    if ((row.fingerprint === pendingKey(adminId) || row.fingerprint === replySlot(adminId, value.customerId))
      && value.conversationId && value.message?.clientMessageId && value.expectedAssignmentId && Number.isSafeInteger(value.expectedVersion)
      && value.message.sender === "agent" && value.message.kind === value.kind && value.message.intent === value.intent
      && value.message.text === value.body && ["TEXT", "IMAGE", "SKU", "LINK"].includes(value.kind)) return { row, locator, reply: value as Pending };
    return { row, locator };
  });
  const dock = dockCommands.list().filter(row => row.fingerprint.startsWith(`dock|${adminId}|`)).map((row): SavedSend => {
    const locator: MessageLocator = { readOnlyRecovery: true, key: row.commandKey, customerId: row.customerId, conversationId: row.conversationNo };
    let input;
    try { input = JSON.parse(row.payload); } catch { return { row, locator, dock: row }; }
    if (typeof input?.clientMessageId === "string") locator.clientMessageId = input.clientMessageId;
    if (row.readOnlyRecovery || !locator.clientMessageId || input.kind !== "TEXT" || input.intent !== "SERVICE"
      || typeof input.content !== "string" || !input.content || typeof input.expectedAssignmentId !== "string" || !input.expectedAssignmentId
      || !Number.isSafeInteger(input.expectedVersion) || row.fingerprint !== `dock|${adminId}|${row.conversationNo}`
      || input.replyTargets !== undefined && (!Array.isArray(input.replyTargets) || !input.replyTargets.every((t: { conversationNo?: string; throughMessageId?: number } | null) => t?.conversationNo === row.conversationNo && Number.isSafeInteger(t.throughMessageId)))) return { row, locator, dock: row };
    const reply: Pending = {
      key: row.commandKey, conversationId: row.conversationNo, customerId: row.customerId, kind: "TEXT", body: input.content, intent: "SERVICE",
      originalDraft: row.originalDraft, expectedAssignmentId: input.expectedAssignmentId, expectedStatus: input.expectedStatus, expectedVersion: input.expectedVersion,
      message: { ts: row.createdAt, sender: "agent", kind: "TEXT", text: input.content, intent: "SERVICE", clientMessageId: locator.clientMessageId, replyTargets: input.replyTargets },
    };
    return { row, locator, reply, dock: row, dockInput: input };
  });
  return [...main, ...dock];
}
export function identifySavedCustomer(adminId: number, key: string, conversationId: string, customerId: string) {
  const entry = readSavedSends(adminId).find(item => item.row.commandKey === key && item.locator.conversationId === conversationId);
  if (!entry || validCustomerId(entry.locator.customerId ?? null)) return;
  if (entry.dock) dockCommands.remember(entry.row.fingerprint, key, { ...entry.dock, customerId });
  else rememberPending(entry.row.fingerprint, key, { ...(entry.reply ?? entry.locator), customerId });
}
export const rememberPending = (slot: string, commandKey: string, value: object) => {
  pendingMessages.remember(slot, commandKey, { payload: JSON.stringify(value) });
  return pendingMessages.isDurablyStored(slot, commandKey);
};
export const validCustomerId = (value: string | null): value is string => Boolean(value && /^\d+$/.test(value) && /[1-9]/.test(value));
export function parseConversations(raw: string | undefined): SessionConvo[] {
  if (!raw) return [];
  try {
    const rows: unknown = JSON.parse(raw);
    return Array.isArray(rows) ? rows as SessionConvo[] : [];
  } catch { return []; }
}

type ConversationTarget = Pick<SessionConvo, "id" | "customerId">;

export function originalCustomerId(locator: { customerId?: string; conversationId?: string }, conversations: ConversationTarget[]) {
  return validCustomerId(locator.customerId ?? null) ? locator.customerId : conversations.find(row => row.id === locator.conversationId)?.customerId;
}

// The two ownership denials occur before idempotency. On a retry they cannot prove what the first POST did.
export function refusedMessage(cause: unknown, firstSubmission: boolean) {
  if (!(cause instanceof SupportClientError)) return false;
  return cause.status !== 404 && isDefiniteSupportRefusal(cause) || firstSubmission && (
    cause.status === 404 && cause.backendMessage === "SUPPORT_CUSTOMER_NOT_FOUND"
    || cause.status === 403 && cause.backendMessage === "SUPPORT_WRITE_FORBIDDEN"
  );
}

export const dockDraftKey = (adminId: number, customerId: string, conversationNo: string, assignmentId?: string | null) =>
  `nexion-m-dock-draft:${adminId}:${customerId}:${conversationNo}:${assignmentId ?? ""}`;
export const sendJournal = (slot: string) => slot.startsWith("dock|") ? dockCommands : pendingMessages;

// Replace the replayable row atomically. Its compact payload contains only editable text.
export function closeFailedDraft(adminId: number, commandKey: string, customerId?: string) {
  const entry = readSavedSends(adminId).find(item => item.row.commandKey === commandKey);
  const original = entry?.reply ?? entry?.first;
  if (!entry || !original || entry.reply?.kind === "IMAGE") return;
  let body = original.originalDraft ?? original.body;
  const legacySlot = !entry.dock && !original.draftSlot;
  if (legacySlot && original.originalDraft === undefined) {
    try {
      const drafts = JSON.parse(sessionStorage.getItem(`nexion-m3-drafts:${adminId}`) ?? "{}");
      const text = drafts[entry.reply?.conversationId ?? `first:${customerId}`];
      if (typeof text === "string" && text.trim() === original.body) body = text;
    } catch { /* The submitted text is still in the original journal. */ }
  }
  const slot = [entry.dock ? "failed-dock" : "failed-main", customerId, entry.first?.assignmentId ?? entry.reply!.expectedAssignmentId, entry.reply?.conversationId, legacySlot ? "legacy" : ""].join("@");
  const stored = entry.dock ? dockCommands.redact(entry.dock, slot, { payload: body, conversationNo: entry.dock.conversationNo })
    : pendingMessages.redact(entry.row, slot, { payload: body });
  if (!stored) throw new Error("浏览器没能保存这条消息的记录，只留在本页；请先别刷新或关闭页面，稍后再查询。");
  return failedDraftCopies.list().find(copy => copy.commandKey === commandKey);
}

export function restoreFailedDraft(adminId: number, commandKey: string, detail: { customerId: string; assignmentId: string | null; agentAdminId: number | null }) {
  const copy = failedDraftCopies.list().find(row => row.commandOwnerId === adminId && row.commandKey === commandKey);
  if (!copy?.source || copy.displaced || copy.customerId && copy.customerId !== detail.customerId || detail.assignmentId !== copy.assignmentId || !detail.agentAdminId) return;
  const { customerId, assignmentId, agentAdminId } = detail;
  const { conversationId, body } = copy;
  try {
    if (copy.source === "dock" && conversationId) {
      const key = dockDraftKey(adminId, customerId, conversationId, assignmentId);
      const newer = sessionStorage.getItem(key);
      if (newer && newer !== body) {
        dockCommands.remember(copy.fingerprint.replace("failed-", "saved-"), commandKey, { payload: body, conversationNo: conversationId });
        return;
      }
      sessionStorage.setItem(key, body);
      window.dispatchEvent(new CustomEvent("dock-draft-restored", { detail: { key, body } }));
    } else {
      const key = `nexion-m3-drafts:${adminId}`;
      const slot = scopedDraftSlot(conversationId ?? `first:${customerId}`, customerId, assignmentId, agentAdminId);
      const drafts = JSON.parse(sessionStorage.getItem(key) ?? "{}");
      const legacy = conversationId ?? `first:${customerId}`;
      if (copy.legacySlot && !drafts[slot] && drafts[legacy]) {
        drafts[slot] = drafts[legacy];
        delete drafts[legacy];
        sessionStorage.setItem(key, JSON.stringify(drafts));
        window.dispatchEvent(new CustomEvent("m3-draft-restored", { detail: { adminId, slot, body: drafts[slot], legacy } }));
      }
      if (drafts[slot] && drafts[slot] !== body) {
        pendingMessages.remember(copy.fingerprint.replace("failed-", "saved-"), commandKey, { payload: body });
        return;
      }
      sessionStorage.setItem(key, JSON.stringify({ ...drafts, [slot]: body }));
      window.dispatchEvent(new CustomEvent("m3-draft-restored", { detail: { adminId, slot, body } }));
    }
  } catch { return; } // The closed row remains available after a storage failure.
  failedDraftCopies.forget(copy.fingerprint, commandKey);
  return true;
}

// Undefined denotes an owned original whose customer cannot yet be proved.
export function pendingSendCustomers(actorId: number, conversations: ConversationTarget[]) {
  return new Set(readSavedSends(actorId).map(entry => originalCustomerId(entry.locator, conversations)));
}
export function blocksNewSend(customers: Set<string | undefined>, customerId: string) {
  return customers.has(undefined) || customers.has(customerId);
}

type PrivateTarget = { conversationId?: string; customerId?: string; assignmentId?: string; ownerAdminId?: number | null };

export function scopedDraftSlot(slot: string, customerId: string, assignmentId: string, ownerAdminId: number) {
  return [slot, customerId, assignmentId, ownerAdminId].join("@");
}
function draftTarget(key: string): PrivateTarget {
  const [slot, customerId, assignmentId, owner] = key.split("@");
  return { customerId: customerId || (slot.startsWith("first:") ? slot.slice(6) : undefined),
    conversationId: slot.startsWith("first:") ? undefined : slot, assignmentId, ownerAdminId: owner ? Number(owner) : undefined };
}

// A supervisor can still see a transferred thread. Check the original assignment even on a snapshot hit.
export async function revokedPrivateTargets(adminId: number, previous: SessionConvo[], snapshot: SessionConvo[], signal: AbortSignal) {
  const targets: PrivateTarget[] = failedDraftCopies.list().filter(row => row.commandOwnerId === adminId);
  for (const { reply, first } of readSavedSends(adminId)) {
    if (reply) targets.push({ conversationId: reply.conversationId, customerId: reply.customerId, assignmentId: reply.expectedAssignmentId });
    if (first) targets.push({ customerId: first.customerId, assignmentId: first.assignmentId });
  }
  try {
    const drafts = JSON.parse(sessionStorage.getItem(`nexion-m3-drafts:${adminId}`) ?? "{}");
    for (const [slot, value] of Object.entries(drafts)) if (value) targets.push(draftTarget(slot));
    const dockPrefix = `nexion-m-dock-draft:${adminId}:`;
    const replyPrefix = `nexion-m3-reply-targets:${adminId}:`;
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(replyPrefix)) targets.push(draftTarget(key.slice(replyPrefix.length)));
      if (!key.startsWith(dockPrefix)) continue;
      const [customerId, conversationId, assignmentId] = key.slice(dockPrefix.length).split(":");
      targets.push({ customerId, conversationId, assignmentId, ownerAdminId: adminId });
    }
  } catch { /* Journal originals can still be checked when draft storage is unavailable. */ }

  const denied: PrivateTarget[] = [];
  const customers = new Map<string, ReturnType<typeof supportClient.customerDetail>>();
  const threads = new Map<string, ReturnType<typeof fetchMConversationDetail>>();
  await Promise.all(targets.map(async target => {
    const { conversationId, assignmentId } = target;
    const prior = previous.find(row => row.id === conversationId);
    const visible = snapshot.find(row => row.id === conversationId);
    let customerId = target.customerId ?? prior?.customerId ?? visible?.customerId;
    const owner = target.ownerAdminId ?? (assignmentId ? undefined : prior?.ownerAdminId);
    if (visible && owner != null && visible.ownerAdminId != null && visible.ownerAdminId !== owner
      && prior?.ownerAdminId === owner && prior.customerId === customerId) {
      denied.push({ customerId, conversationId, assignmentId: assignmentId ?? "" });
      return;
    }
    if (conversationId && !visible) {
      try {
        let request = threads.get(conversationId);
        if (!request) threads.set(conversationId, request = fetchMConversationDetail(conversationId, signal, false));
        const detail = await request;
        if (customerId && detail.customerId !== customerId) return;
        customerId = detail.customerId;
      } catch (cause) {
        if (isSupportScopeDenial(cause)) {
          denied.push({ customerId, conversationId, assignmentId: assignmentId ?? "" });
          if (!customerId) return;
        }
      }
    }
    if (!customerId) return;
    if (visible && !assignmentId && owner === visible.ownerAdminId) return;
    try {
      let request = customers.get(customerId);
      if (!request) customers.set(customerId, request = supportClient.customerDetail(customerId, signal));
      const detail = await request;
      if (detail.customerId !== customerId) return;
      if ((assignmentId && detail.assignmentId !== assignmentId) || (owner != null && detail.agentAdminId !== owner)) {
        denied.push({ customerId, conversationId, assignmentId: assignmentId ?? "" });
      }
    } catch (error) {
      if (isSupportScopeDenial(error)) denied.push({ customerId, conversationId });
    }
  }));
  return denied;
}

export function redactCustomerSends(adminId: number, conversations: ConversationTarget[], customerId?: string, originalConversationId?: string, commandKey?: string, assignmentId?: string) {
  const entries = readSavedSends(adminId);
  customerId ??= originalConversationId ? conversations.find(row => row.id === originalConversationId)?.customerId
    ?? entries.find(entry => entry.locator.conversationId === originalConversationId)?.locator.customerId : undefined;
  const revokeAll = !customerId && !originalConversationId;
  const affected = commandKey ? [] : conversations.filter(convo => revokeAll || convo.customerId === customerId).map(convo => convo.id);
  if (originalConversationId) affected.push(originalConversationId);
  for (const copy of failedDraftCopies.list()) {
    if (copy.commandOwnerId !== adminId || assignmentId !== undefined && copy.assignmentId !== assignmentId || commandKey && copy.commandKey !== commandKey) continue;
    if (revokeAll || customerId && copy.customerId === customerId || copy.conversationId && affected.includes(copy.conversationId)) {
      if (copy.conversationId && !affected.includes(copy.conversationId)) affected.push(copy.conversationId);
      failedDraftCopies.forget(copy.fingerprint, copy.commandKey);
    }
  }
  let error = "";
  for (const { row: record, locator, dock, reply, first } of entries) {
    if (assignmentId !== undefined && assignmentId !== (reply?.expectedAssignmentId ?? first?.assignmentId ?? "")) continue;
    if (commandKey && record.commandKey !== commandKey) continue;
    const originalCustomer = originalCustomerId(locator, conversations);
    const matchesThread = locator.conversationId && affected.includes(locator.conversationId);
    if (!revokeAll && !(customerId && originalCustomer === customerId) && !matchesThread) continue;
    if (locator.conversationId && !affected.includes(locator.conversationId)) affected.push(locator.conversationId);
    locator.customerId = originalCustomer ?? (locator.conversationId === originalConversationId ? customerId : undefined);
    const ok = dock
      ? dockCommands.redact(dock, dock.fingerprint, { payload: JSON.stringify(locator), conversationNo: dock.conversationNo, customerId: locator.customerId, readOnlyRecovery: true })
      : pendingMessages.redact(record, recoveryKey(adminId, record.commandKey), { payload: JSON.stringify(locator) });
    if (!ok) error = "这台电脑上的旧消息没清理掉，相关会话先关着；请检查浏览器的存储设置后重试。";
  }
  const matchesDraft = (slot: string) => {
    const target = draftTarget(slot);
    return (revokeAll || Boolean(customerId && customerId === target.customerId) || Boolean(target.conversationId && affected.includes(target.conversationId)))
      && (assignmentId === undefined || !target.assignmentId || target.assignmentId === assignmentId);
  };
  try {
    const saved = JSON.parse(sessionStorage.getItem(`nexion-m3-drafts:${adminId}`) ?? "{}") as Record<string, unknown>;
    for (const key of Object.keys(saved)) if (matchesDraft(key)) delete saved[key];
    sessionStorage.setItem(`nexion-m3-drafts:${adminId}`, JSON.stringify(saved));
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(`nexion-m-dock-draft:${adminId}:`) && (assignmentId === undefined || key.endsWith(`:${assignmentId}`) || key.endsWith(":")) && (revokeAll || customerId && key.startsWith(`nexion-m-dock-draft:${adminId}:${customerId}:`) || affected.some(id => key.includes(`:${id}:`)))) sessionStorage.removeItem(key);
    }
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(`nexion-m3-reply-targets:${adminId}:`) && matchesDraft(key.slice(`nexion-m3-reply-targets:${adminId}:`.length))) sessionStorage.removeItem(key);
  } catch { error = "私聊记录清理失败，请退出当前账号后重新登录。"; }
  return { affected, customerId, revokeAll, error, matchesDraft, assignmentId };
}
