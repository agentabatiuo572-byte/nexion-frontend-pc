import { useSyncExternalStore } from "react";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { privateMessageRecovery, type PrivateMessageRecovery } from "@/lib/admin/m-support-enhancements";
import type { SessionConvo, SessionMsg } from "./data";

type Intent = "SERVICE" | "MAINTENANCE";
export type Pending = { conversationId: string; customerId?: string; key: string; body: string; intent: Intent; kind: "TEXT" | "IMAGE" | "SKU" | "LINK"; attachmentId?: string; message: SessionMsg; expectedAssignmentId: string; expectedStatus?: string; expectedVersion: number };
type FirstContact = { key: string; body: string; intent: Intent; clientMessageId: string; customerId: string; assignmentId: string; version: number; replyTargets: Array<{ conversationNo: string; throughMessageId: number }> };

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
type SavedSend = { row: StoredMessage; locator: MessageLocator; reply?: Pending; first?: FirstContact };

function isMessageSlot(slot: string, adminId: number) {
  return slot === pendingKey(adminId) || slot.startsWith(`${pendingKey(adminId)}:`) || slot.startsWith(`nexion-m3-first-pending:${adminId}:`);
}

export function readSavedSends(adminId: number): SavedSend[] {
  return pendingMessages.list().filter(row => isMessageSlot(row.fingerprint, adminId)).map(row => {
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

export function pendingDockCustomers(actorId: number, conversations: ConversationTarget[]) {
  return dockCommands.list().filter(row => row.fingerprint.startsWith(`dock|${actorId}|`))
    .map(row => originalCustomerId({ customerId: row.customerId, conversationId: row.conversationNo }, conversations));
}

// Undefined denotes an owned original whose customer cannot yet be proved.
export function pendingSendCustomers(actorId: number, conversations: ConversationTarget[]) {
  return new Set([...pendingDockCustomers(actorId, conversations), ...readSavedSends(actorId).map(entry => originalCustomerId(entry.locator, conversations))]);
}
export function blocksNewSend(customers: Set<string | undefined>, customerId: string) {
  return customers.has(undefined) || customers.has(customerId);
}
