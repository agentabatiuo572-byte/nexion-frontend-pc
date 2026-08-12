import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import { createPendingMutationStore, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";

export interface MSupportAcceptanceProof {
  source: "mock";
  sourceEnvironment: "SANDBOX";
  strictProfile: true;
  runId: string;
  permanentLabel: "ACCEPTANCE SANDBOX • NON-PRODUCTION";
  productionDelta: {
    status: "VERIFIED_ZERO" | "VIOLATION" | "INSUFFICIENT";
    sandboxFacts: number;
    sandboxAccounts: number;
    ticket: number;
    ticketMessage: number;
    conversation: number;
    conversationMessage: number;
    receipt: number;
    audit: number;
    idempotency: number;
    outbox: number;
  };
}
export interface MSupportAcceptanceConversation { conversationNo: string; status: string; version: number; ownerAgentName: string; lastMessage: string; accountId: number; }
export interface MSupportAcceptanceTicket { ticketNo: string; status: string; version: number; title: string; accountId: number; }

type ApiResult<T> = { code?: number; message?: string; data?: T };
interface MSupportAcceptancePendingCommand extends PendingMutationRecord { operation: string; target: string; settled?: true; }
const pendingCommands = createPendingMutationStore<MSupportAcceptancePendingCommand>({
  storageKey: "nexion-admin-m-support-acceptance-commands-v1",
  isValidRecord: (record) => typeof record.operation === "string" && typeof record.target === "string",
});

function nextCommandKey() {
  return `m-support-acceptance-${Date.now()}-${crypto.randomUUID()}`;
}
async function opaqueCommandSlot(method: string, path: string, body: string): Promise<string> {
  const parsed = body ? JSON.parse(body) as Record<string, unknown> : {};
  delete parsed.expectedVersion;
  delete parsed.expectedStatus;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${method}:${path}:${JSON.stringify(parsed)}`));
  return `m-support:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function pendingCommandResult(commandKey: string): Promise<unknown | null> {
  const response = await guardedFetch(`/api/admin/content/support/acceptance/commands/${encodeURIComponent(commandKey)}`, { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`M_SUPPORT_ACCEPTANCE_READBACK_FAILED:${response.status}`);
  const envelope = await response.json() as ApiResult<unknown>;
  if (envelope.code !== 0) throw new Error("M_SUPPORT_ACCEPTANCE_READBACK_INVALID");
  return envelope.data ?? null;
}

export async function reconcileMSupportAcceptancePending(): Promise<void> {
  for (const row of pendingCommands.list()) {
    try {
      const result = await pendingCommandResult(row.commandKey);
      if (result !== null) {
        // Keep only opaque command metadata durably. A later identical intent
        // reads this same server result and consumes the record atomically.
        pendingCommands.remember(row.fingerprint, row.commandKey, { operation: row.operation, target: row.target, settled: true });
      }
    } catch { /* keep unknown entries until an authoritative readback succeeds */ }
  }
}

async function sandboxJson(path: string, init?: RequestInit): Promise<unknown> {
  const method = (init?.method ?? "GET").toUpperCase();
  const isWrite = method !== "GET";
  const body = typeof init?.body === "string" ? init.body : "";
  const fingerprint = isWrite ? await opaqueCommandSlot(method, path, body) : "";
  if (isWrite) {
    await reconcileMSupportAcceptancePending();
    const committed = pendingCommands.list().find(row => row.fingerprint === fingerprint && row.settled);
    if (committed) {
      const adopted = await pendingCommandResult(committed.commandKey);
      if (adopted !== null) {
        pendingCommands.forget(fingerprint);
        return adopted;
      }
    }
  }
  const headers = new Headers(init?.headers);
  if (isWrite && !headers.has("Idempotency-Key")) {
    const commandKey = pendingCommands.get(fingerprint) ?? nextCommandKey();
    pendingCommands.remember(fingerprint, commandKey, { operation: method, target: path });
    headers.set("Idempotency-Key", commandKey);
  }
  let response: Response;
  try {
    response = await guardedFetch(`/api/admin/content/support/acceptance${path}`, {
      cache: "no-store", ...init, headers,
    });
  } catch (error) {
    // The server may have committed. Preserve the exact command key for replay.
    throw error;
  }
  const envelope = await response.json().catch(() => null) as ApiResult<unknown> | null;
  if (!response.ok || !envelope || envelope.code !== 0) {
    if (isWrite && !outcomeStaysUnknown(response.status, envelope?.code)) {
      pendingCommands.forget(fingerprint);
    }
    throw new Error(formatAdminApiError(envelope?.message, `M_SUPPORT_ACCEPTANCE_COMMAND_FAILED_${response.status}`));
  }
  if (isWrite) pendingCommands.forget(fingerprint);
  return envelope.data;
}

/** A 404 is the normal production absence; any other failure remains fail-closed. */
export async function fetchMSupportAcceptanceProof(): Promise<MSupportAcceptanceProof | null> {
  const response = await guardedFetch("/api/admin/content/support/acceptance/projection", { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`M_SUPPORT_ACCEPTANCE_PROOF_FAILED:${response.status}`);
  const envelope = await response.json() as { data?: unknown };
  const proof = envelope.data as Partial<MSupportAcceptanceProof> | undefined;
  const configuredRunId = process.env.NEXT_PUBLIC_NEXION_ACCEPTANCE_RUN_ID?.trim();
  const productionDeltaValues = proof?.productionDelta
    ? [proof.productionDelta.ticket, proof.productionDelta.ticketMessage, proof.productionDelta.conversation,
      proof.productionDelta.conversationMessage, proof.productionDelta.receipt, proof.productionDelta.audit,
      proof.productionDelta.idempotency, proof.productionDelta.outbox]
    : [];
  if (!configuredRunId || proof?.source !== "mock" || proof.sourceEnvironment !== "SANDBOX" || proof.strictProfile !== true || !proof.runId?.trim() || proof.runId !== configuredRunId
    || proof.permanentLabel !== "ACCEPTANCE SANDBOX • NON-PRODUCTION" || proof.productionDelta?.status !== "VERIFIED_ZERO"
    || !Number.isSafeInteger(proof.productionDelta.sandboxFacts) || proof.productionDelta.sandboxFacts <= 0
    || !Number.isSafeInteger(proof.productionDelta.sandboxAccounts) || proof.productionDelta.sandboxAccounts <= 0
    || productionDeltaValues.length !== 8
    || productionDeltaValues.some(value => !Number.isSafeInteger(value) || value !== 0)) {
    throw new Error("M_SUPPORT_ACCEPTANCE_PROOF_INVALID");
  }
  return proof as MSupportAcceptanceProof;
}
export async function fetchMSupportAcceptanceConversations(): Promise<MSupportAcceptanceConversation[]> {
  await reconcileMSupportAcceptancePending();
  const value = await sandboxJson("/conversations");
  return Array.isArray(value) ? value as MSupportAcceptanceConversation[] : [];
}
export async function replyMSupportAcceptanceConversation(row: MSupportAcceptanceConversation, body: string, reason: string): Promise<void> {
  await sandboxJson(`/conversations/${encodeURIComponent(row.conversationNo)}/reply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body, reason, agentName: "Acceptance operator", expectedStatus: row.status.toUpperCase(), expectedVersion: row.version }) });
}
export async function transferMSupportAcceptanceConversation(row: MSupportAcceptanceConversation, reason: string): Promise<void> {
  await sandboxJson(`/conversations/${encodeURIComponent(row.conversationNo)}/transfer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, targetAgentId: "acceptance-queue", targetAgentName: "Acceptance queue", expectedStatus: row.status.toUpperCase(), expectedVersion: row.version }) });
}
export async function fetchMSupportAcceptanceTickets(): Promise<MSupportAcceptanceTicket[]> {
  await reconcileMSupportAcceptancePending();
  const value = await sandboxJson("/tickets");
  return Array.isArray(value) ? value as MSupportAcceptanceTicket[] : [];
}
export async function fetchMSupportAcceptanceTicket(ticketNo: string): Promise<MSupportAcceptanceTicket> {
  return await sandboxJson(`/tickets/${encodeURIComponent(ticketNo)}`) as MSupportAcceptanceTicket;
}
export async function replyMSupportAcceptanceTicket(row: MSupportAcceptanceTicket, body: string, reason: string): Promise<void> {
  await sandboxJson(`/tickets/${encodeURIComponent(row.ticketNo)}/reply`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body, reason, agentName: "Acceptance operator", expectedStatus: row.status.toUpperCase(), expectedVersion: row.version }) });
}
export async function closeMSupportAcceptanceTicket(row: MSupportAcceptanceTicket, reason: string): Promise<void> {
  await sandboxJson(`/tickets/${encodeURIComponent(row.ticketNo)}/close`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason, expectedStatus: row.status.toUpperCase(), expectedVersion: row.version }) });
}
