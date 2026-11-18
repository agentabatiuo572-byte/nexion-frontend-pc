import { useSyncExternalStore } from "react";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { privateMessageRecovery, type PrivateMessageRecovery } from "@/lib/admin/m-support-enhancements";
import { parseMConversationTimeoutPolicy } from "@/lib/admin/m-client";
import { isDefiniteSupportRefusal, SupportClientError, type SupportMessageInput } from "@/lib/admin/m-support-client";
import type { SessionConvo, SessionMsg } from "./data";

type Intent = "SERVICE" | "MAINTENANCE";
export type Pending = { conversationId: string; customerId?: string; key: string; body: string; originalDraft?: string; intent: Intent; kind: "TEXT" | "IMAGE" | "SKU" | "LINK"; attachmentId?: string; message: SessionMsg; expectedAssignmentId: string; expectedStatus?: string; expectedVersion: number };
type FirstContact = { key: string; body: string; originalDraft?: string; intent: Intent; clientMessageId: string; customerId: string; assignmentId: string; version: number; replyTargets: Array<{ conversationNo: string; throughMessageId: number }> };

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
  const store = createPendingMutationStore<T>(options);
  return {
    ...store,
    remember(...args: Parameters<typeof store.remember>) { store.remember(...args); changed(); },
    forget(...args: Parameters<typeof store.forget>) { store.forget(...args); changed(); },
  };
}

export const pendingKey = (adminId: number) => `nexion-m3-dedicated-pending:${adminId}`;
export const replySlot = (adminId: number, customerId: string) => `${pendingKey(adminId)}:${customerId}`;
export const recoveryKey = (adminId: number, key: string) => `${pendingKey(adminId)}:recovery:${key}`;
export const firstPendingKey = (adminId: number, customerId: string) => `nexion-m3-first-pending:${adminId}:${customerId}`;
export type StoredMessage = PendingMutationRecord & { payload: string };
// Legacy timeout rows must survive private-message housekeeping even when their payload cannot be recovered.
export const pendingMessages = createMessageJournal<StoredMessage>({ storageKey: "nexion-admin-m3-private-pending-v1", retainExpiredRecords: true, isValidRecord: (row) => typeof row.payload === "string" || /^nexion-m3-timeout:[1-9]\d*$/.test(row.fingerprint) });
export interface DockCommandRecord extends PendingMutationRecord { payload: string; conversationNo: string; customerId?: string; readOnlyRecovery?: boolean }
export const dockCommands = createMessageJournal<DockCommandRecord>({
  storageKey: "nexion-admin-m-dock-pending-v1",
  retainExpiredRecords: true,
  isValidRecord: (record) => typeof record.payload === "string" && typeof record.conversationNo === "string"
    && (record.customerId === undefined || typeof record.customerId === "string")
    && (record.readOnlyRecovery === undefined || typeof record.readOnlyRecovery === "boolean"),
});
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
      expectedAssignmentId: input.expectedAssignmentId, expectedStatus: input.expectedStatus, expectedVersion: input.expectedVersion,
      message: { ts: row.createdAt, sender: "agent", kind: "TEXT", text: input.content, intent: "SERVICE", clientMessageId: locator.clientMessageId, replyTargets: input.replyTargets },
    };
    return { row, locator, reply, dock: row, dockInput: input };
  });
  return [...main, ...dock];
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

function redactDockRecovery(record: DockCommandRecord, locator: MessageLocator) {
  const payload = JSON.stringify(locator);
  const extra = { payload, conversationNo: record.conversationNo, readOnlyRecovery: true as const, ...(locator.customerId ? { customerId: locator.customerId } : {}) };
  dockCommands.remember(record.fingerprint, record.commandKey, extra);
  try {
    if (JSON.parse(sessionStorage.getItem("nexion-admin-m-dock-pending-v1") ?? "{}")[record.commandKey]?.payload !== payload) {
      sessionStorage.removeItem("nexion-admin-m-dock-pending-v1");
      dockCommands.remember(record.fingerprint, record.commandKey, extra);
    }
  } catch { /* The in-memory record is already redacted. */ }
  return dockCommands.isDurablyStored(record.fingerprint, record.commandKey);
}

export const dockDraftKey = (adminId: number, customerId: string, conversationNo: string, assignmentId?: string | null) =>
  `nexion-m-dock-draft:${adminId}:${customerId}:${conversationNo}:${assignmentId ?? ""}`;
export const sendJournal = (slot: string) => slot.startsWith("dock|") ? dockCommands : pendingMessages;

// Undefined denotes an owned original whose customer cannot yet be proved.
export function pendingSendCustomers(actorId: number, conversations: ConversationTarget[]) {
  return new Set(readSavedSends(actorId).map(entry => originalCustomerId(entry.locator, conversations)));
}
export function blocksNewSend(customers: Set<string | undefined>, customerId: string) {
  return customers.has(undefined) || customers.has(customerId);
}

export function redactCustomerSends(adminId: number, conversations: ConversationTarget[], customerId?: string, originalConversationId?: string, commandKey?: string) {
  const entries = readSavedSends(adminId);
  customerId ??= originalConversationId ? conversations.find(row => row.id === originalConversationId)?.customerId
    ?? entries.find(entry => entry.locator.conversationId === originalConversationId)?.locator.customerId : undefined;
  const revokeAll = !customerId && !originalConversationId;
  const clearFirst = !commandKey || !originalConversationId;
  const affected = commandKey ? [] : conversations.filter(convo => revokeAll || convo.customerId === customerId).map(convo => convo.id);
  if (originalConversationId) affected.push(originalConversationId);
  let error = "";
  for (const { row: record, locator, dock } of entries) {
    if (commandKey && record.commandKey !== commandKey) continue;
    const originalCustomer = originalCustomerId(locator, conversations);
    const matchesThread = locator.conversationId && affected.includes(locator.conversationId);
    if (!revokeAll && !(customerId && originalCustomer === customerId) && !matchesThread && !(dock && !originalCustomer && customerId)) continue;
    if (locator.conversationId && !affected.includes(locator.conversationId)) affected.push(locator.conversationId);
    locator.customerId = originalCustomer ?? (locator.conversationId === originalConversationId ? customerId : undefined);
    if (dock) {
      if (!dock.readOnlyRecovery || dock.customerId !== locator.customerId) {
        if (!redactDockRecovery(dock, locator)) error = "浏览器没能保存这条消息的记录，只留在本页；请先别刷新或关闭页面，稍后再查询。";
      }
      continue;
    }
    try {
      const slot = recoveryKey(adminId, record.commandKey);
      if (record.fingerprint === slot && record.payload === JSON.stringify(locator)) continue;
      rememberPending(slot, record.commandKey, locator);
      // Retry the smaller persisted row without deleting unrelated messages or legacy timeout commands.
      if (JSON.parse(sessionStorage.getItem("nexion-admin-m3-private-pending-v1") || "{}")[record.commandKey]?.payload !== JSON.stringify(locator)) {
        const persisted = JSON.parse(sessionStorage.getItem("nexion-admin-m3-private-pending-v1") || "{}");
        const original = persisted[record.commandKey];
        if (!original || original.commandKey !== record.commandKey) throw new Error("Private recovery row unavailable");
        persisted[record.commandKey] = { ...original, fingerprint: slot, payload: JSON.stringify(locator) };
        try { sessionStorage.setItem("nexion-admin-m3-private-pending-v1", JSON.stringify(persisted)); }
        catch {
          // If even a smaller replacement is refused, erase private bodies and retain timeout lineage only.
          let durable = false;
          try {
            const timeouts: Record<string, StoredMessage> = {};
            for (const [key, value] of Object.entries(persisted)) {
              const row = value as StoredMessage;
              if (!/^nexion-m3-timeout:[1-9]\d*$/.test(row.fingerprint)) continue;
              const saved = JSON.parse(row.payload) as { key: string; policy: unknown; operator: string; input?: { warnMinutes: number; closeMinutes: number; reason: string } };
              parseMConversationTimeoutPolicy(saved.policy);
              if (saved.key !== key || row.commandKey !== key || !Number.isFinite(row.createdAt) || !Number.isFinite(row.expiresAt) || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(key) || typeof saved.operator !== "string" || !saved.input || !Number.isInteger(saved.input.warnMinutes) || saved.input.warnMinutes < 1 || saved.input.warnMinutes > 30 || !Number.isInteger(saved.input.closeMinutes) || saved.input.closeMinutes <= saved.input.warnMinutes || saved.input.closeMinutes > 120 || typeof saved.input.reason !== "string" || saved.input.reason.trim().length < 6 || saved.input.reason.trim().length > 200) throw new Error("Timeout recovery row invalid");
              timeouts[key] = row;
            }
            const preserveTimeouts = () => {
              const target = JSON.parse(sessionStorage.getItem("nexion-admin-m3-timeout-pending-v1") || "{}");
              for (const [key, row] of Object.entries(timeouts)) {
                if (target[key] && JSON.stringify(target[key]) !== JSON.stringify(row)) throw new Error("Timeout recovery row conflict");
                target[key] = row;
              }
              if (Object.keys(timeouts).length) sessionStorage.setItem("nexion-admin-m3-timeout-pending-v1", JSON.stringify(target));
              const stored = JSON.parse(sessionStorage.getItem("nexion-admin-m3-timeout-pending-v1") || "{}");
              return Object.keys(timeouts).length > 0 && Object.entries(timeouts).every(([key, row]) => JSON.stringify(stored[key]) === JSON.stringify(row));
            };
            try { preserveTimeouts(); } catch { /* Retry after privacy erasure frees quota. */ }
            sessionStorage.removeItem("nexion-admin-m3-private-pending-v1");
            durable = preserveTimeouts();
          } catch {
            // Invalid metadata or blocked migration must never retain revoked private bodies.
            sessionStorage.removeItem("nexion-admin-m3-private-pending-v1");
          }
          error = durable ? "原消息内容已清除。结果确认前请不要刷新或关闭页面。" : "原消息内容已清除，但浏览器没能保存恢复记录；请不要刷新或关闭页面。";
          continue;
        }
        if (JSON.parse(sessionStorage.getItem("nexion-admin-m3-private-pending-v1") || "{}")[record.commandKey]?.payload !== JSON.stringify(locator)) throw new Error("Private recovery row not stored");
      }
      if (!pendingMessages.isDurablyStored(slot, record.commandKey)) error = "浏览器没能保存这条消息的记录，只留在本页；请先别刷新或关闭页面，稍后再查询。";
    } catch {
      try {
        sessionStorage.removeItem("nexion-admin-m3-private-pending-v1");
        error = "原消息内容已清除，但浏览器没能保存恢复记录；请不要刷新或关闭页面。";
      } catch {
        error = "这台电脑上的旧消息没清理掉，相关会话先关着；请检查浏览器的存储设置后重试。";
      }
    }
  }
  try {
    const saved = JSON.parse(sessionStorage.getItem(`nexion-m3-drafts:${adminId}`) ?? "{}") as Record<string, unknown>;
    for (const key of Object.keys(saved)) if (affected.includes(key) || clearFirst && key === `first:${customerId}` || revokeAll) delete saved[key];
    sessionStorage.setItem(`nexion-m3-drafts:${adminId}`, JSON.stringify(saved));
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith(`nexion-m-dock-draft:${adminId}:`) && (revokeAll || customerId && key.startsWith(`nexion-m-dock-draft:${adminId}:${customerId}:`) || affected.some(id => key.includes(`:${id}:`)))) sessionStorage.removeItem(key);
    }
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(`nexion-m3-reply-targets:${adminId}:`) && (revokeAll || affected.some(id => key.endsWith(`:${id}`)) || clearFirst && key.endsWith(`:first:${customerId}`))) sessionStorage.removeItem(key);
  } catch { error = "私聊记录清理失败，请退出当前账号后重新登录。"; }
  return { affected, customerId, clearFirst, revokeAll, error };
}
