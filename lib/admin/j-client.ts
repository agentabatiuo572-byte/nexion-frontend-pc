import { isDeterministicRejection, isIdempotencyOutcomeOpen, outcomeStaysUnknown } from "@/lib/admin/outcome-classification";
import { formatAdminApiError, guardedFetch } from "@/lib/admin/error-messages";
import { currentAdminOperator } from "@/lib/admin/current-operator";
import { createPendingMutationStore, createSlotAttemptStore, isRetryExpired, RETRY_EXPIRED_TEXT, type SlotAttemptRecord } from "@/lib/admin/pending-mutation-store";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { createA2OperationProposal, fetchA2ProposalByKey, isA2OutcomeUncertainError, type A2OperationRow } from "@/lib/admin/a2-client";
import { checkFundCommand, fundCommandOrigin, fundCommandSettled, type FundCommandOrigin, type FundCommandEvidence } from "./fund-command-investigation";
import { discoverECommand, investigateECommand } from "./e-command-investigation";

type ApiResult<T> = {
  code?: number;
  message?: string;
  data?: T;
};

function idempotencyKey() {
  return `j-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createJEmergencyCommandKey() {
  return idempotencyKey();
}

export type J2CommandContext = { overview: GeoBlockOverview; label: string };
export type J2CommandBody = {
  reason: string; operator: string; triggerBasis?: string;
  status?: "blocked" | "limited"; countries?: string[]; expectedCountries?: string[];
  mode?: "derived" | "explicit"; expectedMode?: "derived" | "explicit";
  source?: string; expectedSource?: string;
};
export type J2PendingCommand = SlotAttemptRecord & {
  geo: { path: string; method: string; body: string; context: J2CommandContext; commandOrigin?: FundCommandOrigin };
};
export type J3ConfigBody = {
  threshold: number; feedK4: boolean; expectedThreshold: number; expectedFeedK4: boolean;
  operator: string; reason: string;
};
export type J3PendingCommand = SlotAttemptRecord & {
  tamper: { path: "/tamper/alert-config"; method: "PUT"; body: string; input: J3ConfigBody; context: TamperOverview["alertConfig"]; commandOrigin?: FundCommandOrigin };
};
export type J4CommandContext =
  | { kind: "create"; fields: Record<string, string> }
  | { kind: "update"; playbook: Playbook; fields: Record<string, string> }
  | { kind: "drill"; playbook: Playbook }
  | { kind: "execute"; playbook: Playbook; emergency: boolean; fields: Record<string, string> }
  | { kind: "cancel" | "resume" | "rollback"; execution: SopExecution };
type J4ProposalInput = Parameters<typeof createA2OperationProposal>[0];
export type J4PendingCommand = SlotAttemptRecord & {
  sop: { path: string; method: string; body: string; context: J4CommandContext; commandOrigin?: FundCommandOrigin };
};
export type J4PendingProposal = SlotAttemptRecord & {
  sopProposal: { body: string; context: Extract<J4CommandContext, { kind: "execute" }>; accepted: boolean };
};
type EmergencyPendingCommand = SlotAttemptRecord & {
  geo?: J2PendingCommand["geo"]; tamper?: J3PendingCommand["tamper"];
  sop?: J4PendingCommand["sop"]; sopProposal?: J4PendingProposal["sopProposal"];
};
const J3_CONFIG_SLOT = "PUT /tamper/alert-config";
const isJ2WriteSlot = (slot: string) => /^(?:PUT \/geo-block\/(?:country-lists\/(?:blocked|limited)|endpoints\/[^/]+|edge-judge)|POST \/geo-block\/emergency-blocks)$/.test(slot);
const isJ2CountrySlot = (slot: string) => /^PUT \/geo-block\/countries\/[^/]+$/.test(slot);
const isJ4WriteSlot = (slot: string) => /^(?:POST \/sop\/playbooks|PUT \/sop\/playbooks\/[^/]+|POST \/sop\/playbooks\/[^/]+\/(?:drills|executions\/[^/]+\/(?:cancel|resume|rollback)))$/.test(slot);
export const j4ProposalSlot = (code: string) => `J4 PROPOSE ${code}`;
const isJ4Slot = (slot: string) => isJ4WriteSlot(slot) || slot.startsWith("J4 PROPOSE ");
// One instance owns every J emergency slot, including J4 proposals.
const emergencyCommands = createPendingMutationStore<EmergencyPendingCommand>({
  storageKey: "nexion-admin-j-emergency-commands-v1",
  retainExpiredRecords: (record) => isJ2WriteSlot(record.fingerprint) || isJ2CountrySlot(record.fingerprint) || record.fingerprint === J3_CONFIG_SLOT || isJ4Slot(record.fingerprint),
  isValidRecord: (record) => {
    if (typeof record.inputFingerprint !== "string" || !record.inputFingerprint) return false;
    if (record.sop || record.sopProposal) {
      try {
        const saved = record.sop ?? record.sopProposal!;
        if (saved.body !== record.inputFingerprint) return false;
        const input = JSON.parse(saved.body);
        if (!input || typeof input !== "object" || Array.isArray(input)
          || typeof input.reason !== "string" || !input.reason.trim() || typeof input.operator !== "string") return false;
        const context = saved.context;
        if ("fields" in context && (!context.fields || Object.values(context.fields).some((value) => typeof value !== "string"))) return false;
        if (context.kind === "create" || context.kind === "update") {
          if (!["name", "scene", "owner", "sla", "emergencyTrack", "actionSeq", "notifyCampaignNo", "notifyTemplate", "rollback", "drillRequired"].every((key) => typeof context.fields[key] === "string")) return false;
          if (input.name !== context.fields.name.trim() || input.actionSeq !== context.fields.actionSeq
            || input.scene !== context.fields.scene || input.owner !== context.fields.owner || input.sla !== context.fields.sla
            || input.emergencyTrack !== (context.fields.emergencyTrack === "true")
            || input.notifyCampaignNo !== context.fields.notifyCampaignNo || input.notifyTemplate !== context.fields.notifyTemplate
            || input.rollback !== context.fields.rollback || input.drillRequired !== true) return false;
        }
        if ("playbook" in context) context.playbook = normalizeSopPlaybook(context.playbook);
        if ("execution" in context) context.execution = normalizeSopExecution(context.execution);
        if (record.sopProposal) {
          if (context.kind !== "execute" || typeof context.fields.triggerBasis !== "string" || typeof context.fields.triggerContext !== "string"
            || context.playbook.seq.some((_, index) => context.fields[`stepConfirm.${index}`] !== "true")
            || !Array.isArray(input.command?.params?.stepConfirmations)
            || input.command.params.stepConfirmations.length !== context.playbook.seq.length
            || input.command.params.stepConfirmations.some((confirmation: J4StepConfirmationInput, index: number) =>
              confirmation.step !== index + 1 || confirmation.domain !== context.playbook.seq[index].dom
              || confirmation.ref !== (context.playbook.seq[index].ref || "") || confirmation.confirmed !== true)
            || input.command.params.triggerBasis !== context.fields.triggerBasis || input.command.params.triggerContext !== context.fields.triggerContext) return false;
          return context.kind === "execute" && typeof record.sopProposal.accepted === "boolean"
            && record.fingerprint === j4ProposalSlot(context.playbook.code)
            && input.obj === context.playbook.code && input.sourceDomain === "J4"
            && input.command?.domain === "J" && input.command.op === "j4_playbook_execute"
            && input.command.params?.code === context.playbook.code
            && input.command.params.emergency === context.emergency
            && input.target?.domain === "J" && input.target.type === "playbook" && input.target.id === context.playbook.code;
        }
        const command = record.sop!;
        const origin = command.commandOrigin;
        if (origin !== undefined && (origin.originalMethod !== command.method || origin.originalPath !== `/api/admin/emergency${command.path}`
          || origin.readAuthority !== "emergency_j4_read" || typeof origin.originalAdminId !== "string" || !/^[1-9]\d*$/.test(origin.originalAdminId))) return false;
        if (context.kind === "update" && input.version !== context.playbook.version) return false;
        if ("execution" in context && !context.execution.executionId) return false;
        const code = "playbook" in context ? context.playbook.code : "execution" in context ? context.execution.code : "";
        const expected = context.kind === "create" ? "POST /sop/playbooks"
          : context.kind === "update" ? `PUT /sop/playbooks/${encodeURIComponent(code)}`
            : context.kind === "drill" ? `POST /sop/playbooks/${encodeURIComponent(code)}/drills`
              : "execution" in context ? `POST /sop/playbooks/${encodeURIComponent(code)}/executions/${encodeURIComponent(context.execution.executionId!)}/${context.kind}` : "";
        return record.fingerprint === expected && `${command.method} ${command.path}` === expected && isJ4WriteSlot(expected);
      } catch { return false; }
    }
    if (record.tamper) {
      try {
        const { path, method, body, input, context } = record.tamper;
        if (record.fingerprint !== J3_CONFIG_SLOT || path !== "/tamper/alert-config" || method !== "PUT"
          || body !== record.inputFingerprint || JSON.stringify(input) !== body
          || !Number.isInteger(input.threshold) || input.threshold < 1 || input.threshold > 100
          || !Number.isInteger(input.expectedThreshold) || input.expectedThreshold < 1 || input.expectedThreshold > 100
          || typeof input.feedK4 !== "boolean" || typeof input.expectedFeedK4 !== "boolean"
          || typeof input.reason !== "string" || input.reason.trim().length < 8 || input.reason.length > 200
          || typeof input.operator !== "string") return false;
        const alertConfig = normalizeTamperAlertConfig(context);
        if (alertConfig.threshold !== input.expectedThreshold || alertConfig.feedK4 !== input.expectedFeedK4) return false;
        const origin = record.tamper.commandOrigin;
        if (origin !== undefined && (origin.originalMethod !== "PUT" || origin.originalPath !== "/api/admin/emergency/tamper/alert-config"
          || origin.readAuthority !== "emergency_j3_read" || typeof origin.originalAdminId !== "string" || !/^[1-9]\d*$/.test(origin.originalAdminId))) return false;
        record.tamper.context = alertConfig;
        return true;
      } catch { return false; }
    }
    if (!record.geo) return true;
    try {
      const { path, method, body, context } = record.geo;
      if (`${method} ${path}` !== record.fingerprint || !isJ2WriteSlot(record.fingerprint)
        || typeof body !== "string" || body !== record.inputFingerprint
        || typeof context.label !== "string") return false;
      const origin = record.geo.commandOrigin;
      if (origin !== undefined && (origin.originalMethod !== method || origin.originalPath !== `/api/admin/emergency${path}`
        || origin.readAuthority !== "emergency_j2_read" || typeof origin.originalAdminId !== "string" || !/^[1-9]\d*$/.test(origin.originalAdminId))) return false;
      const input = JSON.parse(body);
      if (!input || typeof input !== "object" || Array.isArray(input)
        || typeof input.reason !== "string" || typeof input.operator !== "string"
        || input.triggerBasis !== undefined && typeof input.triggerBasis !== "string") return false;
      const overview = normalizeGeo(context.overview);
      if (path.endsWith("edge-judge")) {
        if (typeof input.source !== "string" || typeof input.expectedSource !== "string"
          || !overview.edge.sources.some((source) => source.value === input.source)) return false;
      } else {
        const codes = (value: unknown): value is string[] => Array.isArray(value)
          && value.every((cc) => typeof cc === "string" && /^[A-Z]{2}$/.test(cc));
        if (!codes(input.countries)) return false;
        if (path.includes("country-lists/")) {
          if (input.status !== path.split("/").at(-1) || !codes(input.expectedCountries)) return false;
        } else if (path.includes("endpoints/")) {
          if (!["derived", "explicit"].includes(input.mode) || !["derived", "explicit"].includes(input.expectedMode)
            || !codes(input.expectedCountries)
            || !overview.endpoints.some((entry) => entry.key === decodeURIComponent(path.split("/").at(-1)!))) return false;
        } else if (!input.countries.length || typeof input.triggerBasis !== "string") return false;
      }
      context.overview = overview;
      return true;
    } catch { return false; }
  },
});
const emergencyAttempts = createSlotAttemptStore({
  storageKey: "nexion-admin-j-emergency-commands-v1",
}, emergencyCommands);

export const listJ2PendingCommands = () => emergencyCommands.list().filter((record): record is J2PendingCommand => !!record.geo);
// Old J2 records lack the reason/body: preserve them for read-only investigation.
export const listJ2LegacyCommands = () => emergencyCommands.list().filter((record) => isJ2WriteSlot(record.fingerprint) && !record.geo);
// The single-country API has no current page action; expose its retained read-only records to the data layer.
export const listJ2CountryCommands = () => emergencyCommands.list().filter((record) => isJ2CountrySlot(record.fingerprint));
export const getJ2PendingCommand = (slot: string) => listJ2PendingCommands().find((record) => record.fingerprint === slot);
export const getJ3PendingCommand = () => emergencyCommands.list().find((record): record is J3PendingCommand => !!record.tamper);
export const getJ3LegacyCommand = () => emergencyCommands.list().find((record) => record.fingerprint === J3_CONFIG_SLOT && !record.tamper);
export const listJ4PendingCommands = () => emergencyCommands.list().filter((record): record is J4PendingCommand => !!record.sop
  && (!record.sop.commandOrigin || record.sop.commandOrigin.originalAdminId === String(useAdminAuth.getState().session?.adminId)));
export const listJ4PendingProposals = () => emergencyCommands.list().filter((record): record is J4PendingProposal => !!record.sopProposal);
export const listJ4LegacyCommands = () => emergencyCommands.list().filter((record) => isJ4WriteSlot(record.fingerprint) && !record.sop);
/** Local release after confirmation: expired legacy records cannot be replayed. */
export function releaseExpiredJLegacyCommand(record: SlotAttemptRecord) {
  const saved = emergencyCommands.list().find((row) => row.fingerprint === record.fingerprint && row.commandKey === record.commandKey);
  if (!saved || !isRetryExpired(saved) || saved.geo || saved.tamper || saved.sop || saved.sopProposal
    || !(isJ2WriteSlot(saved.fingerprint) || saved.fingerprint === J3_CONFIG_SLOT || isJ4WriteSlot(saved.fingerprint))) return false;
  emergencyCommands.forget(saved.fingerprint, saved.commandKey);
  return true;
}
export const getJ4PendingCommand = (slot: string) => listJ4PendingCommands().find((record) => record.fingerprint === slot);
export const getJ4PendingProposal = (code: string) => listJ4PendingProposals().find((record) => record.fingerprint === j4ProposalSlot(code));

export async function retryJ4Command(record: J4PendingCommand) {
  const saved = getJ4PendingCommand(record.fingerprint);
  if (!saved || saved.commandKey !== record.commandKey) throw new Error("EMERGENCY_ORIGINAL_REQUEST_UNAVAILABLE");
  if (isRetryExpired(saved)) throw new Error(RETRY_EXPIRED_TEXT);
  await apiRequest(saved.sop.path, { method: saved.sop.method, headers: { "Idempotency-Key": saved.commandKey }, body: saved.sop.body }, undefined, undefined, saved.sop.context);
}

function validateJ4ProposalTicket(row: A2OperationRow, record: J4PendingProposal) {
  // 111e00cd ticketMetadata returns the persisted command op for all command tickets.
  // Mine is set by the authenticated maker lookup, not inferred from display names.
  if (!row.id || !row.mine || row.obj !== record.sopProposal.context.playbook.code
    || row.operationCode !== "j4_playbook_execute" || row.type !== "sos"
    || !["pending", "approved", "rejected", "withdrawn", "expired"].includes(row.rawStatus ?? "")) {
    throw new EmergencyOutcomeUncertainError(formatAdminApiError("J4_PROPOSAL_RECEIPT_INVALID", "J4_PROPOSAL_RECEIPT_INVALID"));
  }
  return row;
}

export async function queryJ4Proposal(record: J4PendingProposal) {
  const row = await fetchA2ProposalByKey(record.commandKey, true);
  if (!row) {
    if (record.sopProposal.accepted) throw new Error("J4_PROPOSAL_STATUS_UNAVAILABLE");
    return null;
  }
  validateJ4ProposalTicket(row, record);
  if (row.status !== "pending") emergencyCommands.forget(record.fingerprint, record.commandKey);
  else emergencyCommands.remember(record.fingerprint, record.commandKey, { inputFingerprint: record.sopProposal.body, sopProposal: { ...record.sopProposal, accepted: true } });
  return row;
}

/** Called only after the operator confirms clearing an expired, authoritatively absent proposal. */
export async function releaseExpiredJ4Proposal(record: J4PendingProposal) {
  const saved = getJ4PendingProposal(record.sopProposal.context.playbook.code);
  if (!saved || saved.commandKey !== record.commandKey) throw new Error("EMERGENCY_ORIGINAL_REQUEST_UNAVAILABLE");
  if (saved.sopProposal.accepted) throw new Error("J4_PROPOSAL_STATUS_UNAVAILABLE");
  if (!isRetryExpired(saved)) throw new Error("J4_PROPOSAL_NOT_EXPIRED");
  if (await queryJ4Proposal(saved)) return false;
  emergencyCommands.forget(saved.fingerprint, saved.commandKey);
  return true;
}

export async function submitJ4Proposal(input: J4ProposalInput, commandKey: string, context: Extract<J4CommandContext, { kind: "execute" }>) {
  const slot = j4ProposalSlot(context.playbook.code);
  const saved = getJ4PendingProposal(context.playbook.code);
  const body = JSON.stringify(input);
  if (saved && (saved.commandKey !== commandKey || saved.sopProposal.body !== body)) {
    throw new EmergencyOutcomeUncertainError("原操作结果未知，请按原请求重试或查询原结果");
  }
  if (saved && (isRetryExpired(saved) || saved.sopProposal.accepted)) {
    throw new Error(saved.sopProposal.accepted ? "J4_PROPOSAL_STATUS_UNAVAILABLE" : RETRY_EXPIRED_TEXT);
  }
  if (!saved) emergencyCommands.remember(slot, commandKey, { inputFingerprint: body, sopProposal: { body, context, accepted: false } });
  if (!emergencyCommands.isDurablyStored(slot, commandKey)) {
    if (!saved) emergencyCommands.forget(slot, commandKey);
    throw new Error(saved ? "EMERGENCY_ORIGINAL_RETRY_STORAGE_UNAVAILABLE" : "EMERGENCY_IDEMPOTENCY_STORE_UNAVAILABLE");
  }
  const original = getJ4PendingProposal(context.playbook.code)!;
  try {
    const row = await createA2OperationProposal(JSON.parse(original.sopProposal.body), commandKey, true);
    validateJ4ProposalTicket(row, original);
  } catch (error) {
    const failure = error as { status?: number; backendMessage?: string } | null;
    const rejected = saved ? isExplicitRejection(error)
      : !isA2OutcomeUncertainError(error) && !isEmergencyOutcomeUncertain(error)
        && !isIdempotencyOutcomeOpen(failure?.backendMessage)
        && isDeterministicRejection(failure?.status ?? 0);
    if (rejected) emergencyCommands.forget(slot, commandKey);
    throw error;
  }
  // A replayed create receipt is historical. Persist acceptance, then query current status.
  emergencyCommands.remember(slot, commandKey, { inputFingerprint: body, sopProposal: { ...original.sopProposal, accepted: true } });
  return queryJ4Proposal(getJ4PendingProposal(context.playbook.code)!);
}

export async function retryJ4Proposal(record: J4PendingProposal) {
  const saved = getJ4PendingProposal(record.sopProposal.context.playbook.code);
  if (!saved || saved.commandKey !== record.commandKey) throw new Error("EMERGENCY_ORIGINAL_REQUEST_UNAVAILABLE");
  return submitJ4Proposal(JSON.parse(saved.sopProposal.body), saved.commandKey, saved.sopProposal.context);
}

export async function retryJ3Command(record: J3PendingCommand) {
  const saved = getJ3PendingCommand();
  if (!saved || saved.commandKey !== record.commandKey) throw new Error("EMERGENCY_ORIGINAL_REQUEST_UNAVAILABLE");
  if (isRetryExpired(saved)) throw new Error(RETRY_EXPIRED_TEXT);
  await apiRequest(saved.tamper.path, { method: saved.tamper.method, headers: { "Idempotency-Key": saved.commandKey }, body: saved.tamper.body }, undefined, saved.tamper.context);
}

/** Receipt lookup and controlled closure share the E4/D3 evidence contract, including after expiry. */
export async function queryJ3Command(record: J3PendingCommand, evidence?: FundCommandEvidence) {
  const saved = getJ3PendingCommand();
  if (!saved || saved.commandKey !== record.commandKey) throw new Error("EMERGENCY_ORIGINAL_REQUEST_UNAVAILABLE");
  let receipt;
  if (saved.tamper.commandOrigin) {
    receipt = await checkFundCommand({ ...saved, commandOrigin: saved.tamper.commandOrigin }, evidence);
  } else {
    // During backend-first rollout an older client may already have a retained server receipt.
    // Its server-owned origin must prove this operator; do not invent or persist a legacy maker.
    const actorId = useAdminAuth.getState().session?.adminId;
    if (!actorId) throw new Error("ADMIN_AUTH_REQUIRED");
    const locator = { commandKey: saved.commandKey, originalMethod: "PUT" as const,
      originalPath: "/api/admin/emergency/tamper/alert-config", originalAdminId: String(actorId) };
    receipt = evidence ? await investigateECommand(saved, locator, evidence, "emergency_j3_read") : await discoverECommand(locator);
  }
  if (fundCommandSettled(receipt)) emergencyCommands.forget(saved.fingerprint, saved.commandKey);
  return receipt;
}

// Report generation is a read-only export (B4-PD02), so an unavailable file never locks future exports.
export const finishJ3ReportAttempt = (commandKey: string) => emergencyCommands.forget("POST /tamper/reports", commandKey);

export async function retryJ2Command(record: J2PendingCommand) {
  const saved = getJ2PendingCommand(record.fingerprint);
  if (!saved || saved.commandKey !== record.commandKey) throw new Error("EMERGENCY_ORIGINAL_REQUEST_UNAVAILABLE");
  if (isRetryExpired(saved)) throw new Error(RETRY_EXPIRED_TEXT);
  await apiRequest(saved.geo.path, { method: saved.geo.method, headers: { "Idempotency-Key": saved.commandKey }, body: saved.geo.body }, saved.geo.context);
}

/** Read the original geo command, including rollout-era records whose origin only exists on the server. */
export async function queryJ2Command(record: SlotAttemptRecord, evidence?: FundCommandEvidence) {
  const saved = emergencyCommands.list().find(row => row.fingerprint === record.fingerprint && row.commandKey === record.commandKey);
  if (!saved || !(isJ2WriteSlot(saved.fingerprint) || isJ2CountrySlot(saved.fingerprint))) throw new Error("EMERGENCY_ORIGINAL_REQUEST_UNAVAILABLE");
  let receipt;
  if (saved.geo?.commandOrigin) {
    receipt = await checkFundCommand({ ...saved, commandOrigin: saved.geo.commandOrigin }, evidence);
  } else {
    const actorId = useAdminAuth.getState().session?.adminId;
    if (!actorId) throw new Error("ADMIN_AUTH_REQUIRED");
    // The accepted slot fixes method/path; the receipt must prove the original operator and server hash.
    const [method, path] = saved.fingerprint.split(" ");
    const locator = { commandKey: saved.commandKey, originalMethod: method as "PUT" | "POST",
      originalPath: `/api/admin/emergency${path}`, originalAdminId: String(actorId) };
    receipt = evidence ? await investigateECommand(saved, locator, evidence, "emergency_j2_read") : await discoverECommand(locator);
  }
  if (fundCommandSettled(receipt)) emergencyCommands.forget(saved.fingerprint, saved.commandKey);
  return receipt;
}

/** Lists and current settings cannot settle a playbook command, even after its retry window. */
export async function queryJ4Command(record: SlotAttemptRecord, evidence?: FundCommandEvidence) {
  const saved = [...listJ4PendingCommands(), ...listJ4LegacyCommands()].find(row => row.fingerprint === record.fingerprint && row.commandKey === record.commandKey);
  if (!saved) throw new Error("EMERGENCY_ORIGINAL_REQUEST_UNAVAILABLE");
  let receipt;
  if (saved.sop?.commandOrigin) {
    receipt = await checkFundCommand({ ...saved, commandOrigin: saved.sop.commandOrigin }, evidence);
  } else {
    const actorId = useAdminAuth.getState().session?.adminId;
    if (!actorId) throw new Error("ADMIN_AUTH_REQUIRED");
    const [method, path] = saved.fingerprint.split(" ");
    const locator = { commandKey: saved.commandKey, originalMethod: method as "PUT" | "POST",
      originalPath: `/api/admin/emergency${path}`, originalAdminId: String(actorId) };
    receipt = evidence ? await investigateECommand(saved, locator, evidence, "emergency_j4_read") : await discoverECommand(locator);
  }
  if (fundCommandSettled(receipt)) emergencyCommands.forget(saved.fingerprint, saved.commandKey);
  return receipt;
}

function emergencyInputFingerprint(body: BodyInit | null | undefined) {
  if (typeof body !== "string") return body == null ? "" : String(body);
  try {
    const parsed = JSON.parse(body) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return body;
    const canonical = { ...(parsed as Record<string, unknown>) };
    // Legacy non-J2 callers retain their existing fingerprint behavior.
    // J2 uses the complete saved body, including reason and operator.
    delete canonical.reason;
    delete canonical.operator;
    return JSON.stringify(canonical);
  } catch {
    return body;
  }
}

class EmergencyOutcomeUncertainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmergencyOutcomeUncertainError";
  }
}

export function isEmergencyOutcomeUncertain(error: unknown) {
  return error instanceof EmergencyOutcomeUncertainError
    || (error instanceof Error && error.name === "EmergencyOutcomeUncertainError");
}

async function apiRequest<T>(path: string, init?: RequestInit, geoContext?: J2CommandContext, tamperContext?: TamperOverview["alertConfig"], sopContext?: J4CommandContext): Promise<T> {
  const headers = new Headers(init?.headers);
  const method = (init?.method ?? "GET").toUpperCase();
  const isWrite = method !== "GET" && method !== "HEAD";
  const writeSlot = `${method} ${path}`;
  const isJ2Write = isWrite && isJ2WriteSlot(writeSlot);
  const isJ3Config = isWrite && writeSlot === J3_CONFIG_SLOT;
  const isJ4Write = isWrite && isJ4WriteSlot(writeSlot);
  let isOriginalRetry = false;
  const inputFingerprint = emergencyInputFingerprint(init?.body);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (isWrite) {
    const providedCommandKey = headers.get("Idempotency-Key");
    if (isJ2Write) {
      if (listJ2LegacyCommands().some((record) => record.fingerprint === writeSlot)) {
        throw new EmergencyOutcomeUncertainError(formatAdminApiError("EMERGENCY_ORIGINAL_REQUEST_UNAVAILABLE", "EMERGENCY_ORIGINAL_REQUEST_UNAVAILABLE"));
      }
      const saved = getJ2PendingCommand(writeSlot);
      isOriginalRetry = !!saved;
      if (saved && isRetryExpired(saved)) throw new Error(RETRY_EXPIRED_TEXT);
      if (saved && (saved.commandKey !== providedCommandKey || saved.geo.body !== init?.body)) {
        throw new EmergencyOutcomeUncertainError("原操作结果未知，请按原请求重试或查询原结果");
      }
      if (!saved) {
        if (!geoContext || typeof init?.body !== "string") throw new Error("EMERGENCY_ORIGINAL_REQUEST_UNAVAILABLE");
        const commandKey = providedCommandKey || idempotencyKey();
        emergencyCommands.remember(writeSlot, commandKey, { inputFingerprint: init.body, geo: { path, method, body: init.body, context: geoContext,
          commandOrigin: fundCommandOrigin(method as "PUT" | "POST", `/api/admin/emergency${path}`, "emergency_j2_read") } });
        headers.set("Idempotency-Key", commandKey);
      }
      const original = getJ2PendingCommand(writeSlot)!;
      if (!emergencyCommands.isDurablyStored(writeSlot, original.commandKey)) {
        if (!saved) emergencyCommands.forget(writeSlot, original.commandKey);
        throw new Error(saved ? "EMERGENCY_ORIGINAL_RETRY_STORAGE_UNAVAILABLE" : "EMERGENCY_IDEMPOTENCY_STORE_UNAVAILABLE");
      }
    } else if (isJ3Config) {
      if (getJ3LegacyCommand()) throw new EmergencyOutcomeUncertainError(formatAdminApiError("EMERGENCY_ORIGINAL_REQUEST_UNAVAILABLE", "EMERGENCY_ORIGINAL_REQUEST_UNAVAILABLE"));
      const saved = getJ3PendingCommand();
      isOriginalRetry = !!saved;
      if (saved && isRetryExpired(saved)) throw new Error(RETRY_EXPIRED_TEXT);
      if (saved && (saved.commandKey !== providedCommandKey || saved.tamper.body !== init?.body)) {
        throw new EmergencyOutcomeUncertainError("原操作结果未知，请按原请求重试或查询原结果");
      }
      if (!saved) {
        if (!tamperContext || typeof init?.body !== "string") throw new Error("EMERGENCY_ORIGINAL_REQUEST_UNAVAILABLE");
        const commandKey = providedCommandKey || idempotencyKey();
        emergencyCommands.remember(writeSlot, commandKey, {
          inputFingerprint: init.body,
          tamper: { path: "/tamper/alert-config", method: "PUT", body: init.body, input: JSON.parse(init.body), context: tamperContext,
            commandOrigin: fundCommandOrigin("PUT", "/api/admin/emergency/tamper/alert-config", "emergency_j3_read") },
        });
        headers.set("Idempotency-Key", commandKey);
      }
      const original = getJ3PendingCommand();
      if (!original || !emergencyCommands.isDurablyStored(writeSlot, original.commandKey)) {
        if (!saved) emergencyCommands.forget(writeSlot, headers.get("Idempotency-Key")!);
        throw new Error(saved ? "EMERGENCY_ORIGINAL_RETRY_STORAGE_UNAVAILABLE" : "EMERGENCY_IDEMPOTENCY_STORE_UNAVAILABLE");
      }
    } else if (isJ4Write) {
      if (listJ4LegacyCommands().some((record) => record.fingerprint === writeSlot)) throw new EmergencyOutcomeUncertainError(formatAdminApiError("EMERGENCY_ORIGINAL_REQUEST_UNAVAILABLE", "EMERGENCY_ORIGINAL_REQUEST_UNAVAILABLE"));
      const saved = getJ4PendingCommand(writeSlot);
      isOriginalRetry = !!saved;
      if (saved && isRetryExpired(saved)) throw new Error(RETRY_EXPIRED_TEXT);
      if (saved && (saved.commandKey !== providedCommandKey || saved.sop.body !== init?.body)) throw new EmergencyOutcomeUncertainError("原操作结果未知，请按原请求重试或查询原结果");
      const commandKey = providedCommandKey || idempotencyKey();
      if (!saved) {
        if (!sopContext || typeof init?.body !== "string") throw new Error("EMERGENCY_ORIGINAL_REQUEST_UNAVAILABLE");
        emergencyCommands.remember(writeSlot, commandKey, { inputFingerprint: init.body, sop: { path, method, body: init.body, context: sopContext,
          commandOrigin: fundCommandOrigin(method as "PUT" | "POST", `/api/admin/emergency${path}`, "emergency_j4_read") } });
      }
      if (!emergencyCommands.isDurablyStored(writeSlot, commandKey)) {
        if (!saved) emergencyCommands.forget(writeSlot, commandKey);
        throw new Error(saved ? "EMERGENCY_ORIGINAL_RETRY_STORAGE_UNAVAILABLE" : "EMERGENCY_IDEMPOTENCY_STORE_UNAVAILABLE");
      }
      headers.set("Idempotency-Key", commandKey);
    } else if (path === "/tamper/reports") {
      const commandKey = providedCommandKey || idempotencyKey();
      emergencyCommands.remember(writeSlot, commandKey, { inputFingerprint: String(init?.body ?? "") });
      if (!emergencyCommands.isDurablyStored(writeSlot, commandKey)) {
        emergencyCommands.forget(writeSlot, commandKey);
        throw new Error("EMERGENCY_IDEMPOTENCY_STORE_UNAVAILABLE");
      }
      headers.set("Idempotency-Key", commandKey);
    } else {
      const fingerprint = inputFingerprint;
      const saved = emergencyAttempts.list().find(record => record.fingerprint === writeSlot && record.inputFingerprint === fingerprint);
      const commandKey = emergencyAttempts.resolve(
        writeSlot,
        fingerprint,
        () => providedCommandKey || idempotencyKey(),
      );
      if (!emergencyAttempts.isDurablyStored(writeSlot, fingerprint, commandKey)) {
        if (!saved) emergencyAttempts.forget(writeSlot);
        throw new Error(saved ? "EMERGENCY_ORIGINAL_RETRY_STORAGE_UNAVAILABLE" : "EMERGENCY_IDEMPOTENCY_STORE_UNAVAILABLE");
      }
      headers.set("Idempotency-Key", commandKey);
    }
  }
  let res: Response;
  try {
    res = await guardedFetch(`/api/admin/emergency${path}`, {
      ...init,
      headers,
      cache: "no-store",
    });
  } catch {
    const message = "无法连接应急控制服务，未收到执行结果";
    throw isWrite
      ? new EmergencyOutcomeUncertainError(message)
      : new Error("无法连接应急控制服务，请检查网络后重试");
  }
  let text: string;
  try {
    text = await res.text();
  } catch {
    const message = "应急控制服务连接中断，没收到完整的执行结果";
    throw isWrite ? new EmergencyOutcomeUncertainError(message) : new Error(`${message}，请稍后重试`);
  }
  let payload: ApiResult<T> = {};
  try {
    payload = text ? (JSON.parse(text) as ApiResult<T>) : {};
  } catch {
    const message = `应急控制服务返回了无法确认的内容（HTTP ${res.status}）`;
    throw isWrite ? new EmergencyOutcomeUncertainError(message) : new Error(`${message}，请稍后重试。`);
  }
  if ((isJ4Write || path === "/sop/playbooks" || path.startsWith("/tamper/")) && (!payload || typeof payload !== "object" || Array.isArray(payload)
    || typeof payload.code !== "number" || payload.message !== undefined && typeof payload.message !== "string")) {
    throw isWrite ? new EmergencyOutcomeUncertainError("应急控制服务返回了无法确认的内容") : new Error(path.startsWith("/sop/") ? "J4_RESPONSE_INVALID" : "J3_RESPONSE_INVALID");
  }
  const requestFailed = !res.ok || (isWrite
    ? payload.code !== 0
    : payload.code !== undefined && payload.code >= 400);
  if ((isJ2Write || isJ3Config || isJ4Write) && (requestFailed || res.headers.get("X-Nexion-Upstream-Outcome") === "unknown")) {
    const error = Object.assign(new Error(formatAdminApiError(payload.message, `EMERGENCY_API_${res.status}`)), {
      status: res.ok && typeof payload.code === "number" ? payload.code : res.status,
      reasonCode: payload.message,
      unknownOutcome: res.headers.get("X-Nexion-Upstream-Outcome") === "unknown",
    });
    const partialExecution = isJ4Write && payload.message?.startsWith("J4_EXECUTION_PARTIAL:");
    const rejected = !partialExecution && (isOriginalRetry ? isExplicitRejection(error)
      : !error.unknownOutcome && !isIdempotencyOutcomeOpen(payload.message)
        && isDeterministicRejection(res.status, payload.code));
    if (res.status === 401 || payload.code === 401 || payload.message === "ADMIN_AUTH_REQUIRED") {
      useAdminAuth.getState().signOut();
    }
    if (rejected) {
      emergencyCommands.forget(writeSlot, headers.get("Idempotency-Key")!);
      throw error;
    }
    // 5xx 的通用中文是给读取失败写的（请稍后重新加载）；写入没收到确定结果时换成结果未知的说法。
    throw Object.assign(new EmergencyOutcomeUncertainError(res.status >= 500 ? "结果未知：没收到确定结果，原操作可能已经生效。请查询原结果，或按原请求重试。" : error.message), { reasonCode: payload.message });
  }
  if (isWrite && (res.headers.get("X-Nexion-Upstream-Outcome") === "unknown"
    || (requestFailed && (outcomeStaysUnknown(res.status, payload.code) || isIdempotencyOutcomeOpen(payload.message))))) {
    // unknown 头只是增强信号,不再是唯一保险丝:5xx 同样归结果未知,让调用方看到「结果未确认」
    // 而不是「失败」——冠失败会诱导运营换渠道重做,而应急止血动作(kill-switch / 地域封锁)
    // 重复执行的代价极高。
    throw new EmergencyOutcomeUncertainError(
      "应急控制服务连接在提交后中断，结果未知",
    );
  }
  if (requestFailed) {
    if (isWrite) emergencyAttempts.forget(writeSlot);
    if (res.status === 401 || payload.code === 401 || payload.message === "ADMIN_AUTH_REQUIRED") {
      useAdminAuth.getState().signOut();
    }
    throw Object.assign(new Error(formatAdminApiError(payload.message, `EMERGENCY_API_${res.status}`)), { status: res.status, reasonCode: payload.message });
  }
  if (isJ4Write) {
    // A successful J4 response is a complete sopOverview, not an empty acknowledgement.
    try { normalizeSop(payload.data); }
    catch { throw new EmergencyOutcomeUncertainError(formatAdminApiError("J4_RESPONSE_INVALID", "J4_RESPONSE_INVALID")); }
  }
  if (isJ2Write || isJ3Config || isJ4Write) emergencyCommands.forget(writeSlot, headers.get("Idempotency-Key")!);
  else if (isWrite) emergencyAttempts.forget(writeSlot);
  return payload.data as T;
}

async function contentApiRequest<T>(path: string): Promise<T> {
  const res = await guardedFetch(`/api/admin/content${path}`, {
    cache: "no-store",
  });
  const text = await res.text();
  let payload: ApiResult<T> = {};
  try {
    payload = text ? (JSON.parse(text) as ApiResult<T>) : {};
  } catch {
    throw new Error(`内容接口返回了无法识别的内容（HTTP ${res.status}），请稍后重试。`);
  }
  if (!res.ok || (payload.code !== undefined && payload.code >= 400)) {
    throw new Error(formatAdminApiError(payload.message, `CONTENT_API_${res.status}`));
  }
  return payload.data as T;
}

function withReason<T extends Record<string, unknown>>(body: T, reason: string, operator = currentAdminOperator()) {
  return { ...body, operator: operator || currentAdminOperator(), reason };
}

function rows<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function requiredRows<T>(value: unknown, field: string): T[] {
  if (!Array.isArray(value)) {
    throw new Error(`J_DOMAIN_FIELD_REQUIRED:${field}`);
  }
  return value as T[];
}

function requiredRecordRows(value: unknown, field: string) {
  return requiredRows<unknown>(value, field).map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`J_DOMAIN_FIELD_REQUIRED:${field}.${index}`);
    }
    return item as Record<string, unknown>;
  });
}

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function str(value: unknown, fallback = "") {
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}

function num(value: unknown, fallback = 0) {
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requiredNum(value: unknown, field: string) {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string" && /^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new Error(`J_DOMAIN_FIELD_REQUIRED:${field}`);
  }
  return parsed;
}

function bool(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "enabled" || value === "on";
  return fallback;
}

function requiredBool(value: unknown, field: string) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "on", "enabled", "enable"].includes(normalized)) return true;
    if (["false", "0", "off", "disabled", "disable"].includes(normalized)) return false;
  }
  throw new Error(`J_DOMAIN_FIELD_REQUIRED:${field}`);
}

function requiredText(value: unknown, field: string) {
  const normalized = str(value).trim();
  if (!normalized) throw new Error(`J_DOMAIN_FIELD_REQUIRED:${field}`);
  return normalized;
}

/** 暂不可用的业务开关。代码都留着，以后恢复这项，删掉对应这一行就行。 */
export const UNAVAILABLE_GATES: Record<string, { note: string; detail: string }> = {
  staking: { note: "App 已下线质押功能", detail: "App 已下线质押功能，这一项暂不可用。" },
};

/** 业务开关的显示顺序（产品 2026-11-07）：提现、试用、兑换、创世节点、质押；暂不可用的永远排最后。紧急停用开关和今日概览都按它排。 */
const GATE_DISPLAY_ORDER: readonly string[] = ["withdraw", "trial", "exchange", "genesis", "staking"];
export const byGateDisplayOrder = (a: string, b: string) =>
  Number(!!UNAVAILABLE_GATES[a]) - Number(!!UNAVAILABLE_GATES[b]) || GATE_DISPLAY_ORDER.indexOf(a) - GATE_DISPLAY_ORDER.indexOf(b);

const J1_GATE_KEYS = ["withdraw", "staking", "genesis", "exchange", "trial"] as const;
const J1_GATE_KEY_SET = new Set<string>(J1_GATE_KEYS);
const J1_EMERGENCY_SLA_IDS = ["autoConfirmMins", "recoverGate"] as const;
const J1_AUTO_RULE_IDS = ["withdrawSurge", "maturityGap", "tamperCluster", "regulatoryDirective"] as const;
const J1_GATE_SEMANTICS: Record<string, { coveragePrecheckRequired: boolean; coverageImpactCategory: "immediate" | "delayed" | "none" }> = {
  withdraw: { coveragePrecheckRequired: true, coverageImpactCategory: "immediate" },
  staking: { coveragePrecheckRequired: true, coverageImpactCategory: "delayed" },
  genesis: { coveragePrecheckRequired: true, coverageImpactCategory: "immediate" },
  exchange: { coveragePrecheckRequired: true, coverageImpactCategory: "immediate" },
  trial: { coveragePrecheckRequired: false, coverageImpactCategory: "none" },
};

function contractError(field: string): never {
  throw new Error(`收到的数据不完整（字段：${field}），请刷新重试；一直出现请联系技术人员。`);
}

function strArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => str(item)).filter(Boolean) : [];
}

function requiredStringArray(value: unknown, field: string) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string")) {
    contractError(field);
  }
  const values = value as string[];
  if (!values.some((item) => item.trim())) {
    contractError(field);
  }
  return values;
}

function requiredStringArrayAllowEmpty(value: unknown, field: string) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    contractError(field);
  }
  return value as string[];
}

function exactRowIds(rows: Record<string, unknown>[], expectedIds: readonly string[], field: string) {
  const ids = rows.map((row, index) => requiredText(row.id, `${field}.${index}.id`));
  if (ids.length !== expectedIds.length
    || new Set(ids).size !== expectedIds.length
    || expectedIds.some((id) => !ids.includes(id))) {
    contractError(`${field}.ids`);
  }
  return ids;
}

export type JGate = {
  key: string;
  name: string;
  cap: string;
  desc: string;
  enabled: boolean;
  on: boolean;
  status: string;
  coveragePrecheckRequired: boolean;
  coverageImpactCategory: string;
  amplifies: boolean;
  lastChange: string;
  emergency: boolean;
};

export type EmergencySlaRow = {
  id: string;
  k: string;
  d: string;
  v: string;
  unit: string;
  kind: "number" | "text";
  editable?: boolean;
};

export type AutoRuleRow = {
  id: string;
  nm: string;
  tag: string;
  icon: string;
  cond: string[];
  thrK: string;
  thr: string;
  kind: "number" | "text";
  unit: string;
  mode: "automatic" | "advisory" | "manual";
  adjustable: boolean;
  refNote?: string;
  refTitle?: string;
};

export type KillSwitchStats = {
  liveGateCount: number;
  killedGateCount: number;
  emergencyGateCount: number;
  coverageBlockedCount: number;
};

export type AutoConfirmationRow = {
  key: string;
  name: string;
  incidentId: string;
  ruleId: string;
  signalValue: number;
  threshold: number;
  triggeredAt: string;
  dueAt: string;
  overdue: boolean;
};

export type KillSwitchOverview = {
  activeGateCount: number;
  activeGates: JGate[];
  retiredGates: Record<string, unknown>[];
  coverage: { coverageRatio: number; redlinePct: number; yellowLinePct: number; valuationReliable: boolean; recoveryAllowedByServer: boolean };
  stats: KillSwitchStats;
  emergencySla: EmergencySlaRow[];
  autoRules: AutoRuleRow[];
  autoConfirmations: AutoConfirmationRow[];
  sources: string[];
};

export type GeoCountry = { cc: string; name: string; reason: string; status: string; operator: string; updatedAt: string; activeUsers: number; walletUsdt: string };
export type GeoCountryOption = { value: string; label: string; source: string; activeUsers: number; walletUsdt: string };
export type GeoEdgeSourceOption = { value: string; label: string; description: string; healthy: boolean; healthStatus: string; sampleCount: number };
export type GeoRecentChange = { action: string; resourceType: string; resourceId: string; operator: string; reason: string; beforeValue: string; afterValue: string; createdAt: string };
export type GeoEndpoint = {
  key: string;
  ep: string;
  endpoint: string;
  label: string;
  biz: string;
  domain: string;
  countries: string[];
  geo: string[];
  source: string;
  src: string;
  sourceLabel: string;
  sourceDescription: string;
  srcDesc: string;
  hits: number;
  configurable: boolean;
};
export type GeoHit = { cc: string; name: string; nm: string; count: number; ct: number };
export type GeoHitSummary = {
  domain: "J2"; window: "ROLLING_24H"; available: true;
  windowStart: string; capturedAt: string; totalBlockedEvents: number; countryCount: number;
  source: string[]; sourceFields: string[]; definition: string;
  coverage: "recorded_geo_block_events_only"; uniqueUsers: false; allAccessProof: false;
};

/** Separate from the overview's top-20 sum; local database times stay unconverted. */
export async function fetchJ2GeoHitSummary(signal?: AbortSignal): Promise<GeoHitSummary> {
  const row = rec(await apiRequest<unknown>("/geo-block/hit-summary", { signal }));
  if (row.domain !== "J2" || row.window !== "ROLLING_24H" || row.available !== true
    || row.coverage !== "recorded_geo_block_events_only" || row.uniqueUsers !== false || row.allAccessProof !== false) {
    throw new Error("J_DOMAIN_FIELD_REQUIRED:geo.hitSummary");
  }
  const count = (key: string) => {
    const value = requiredNum(row[key], `geo.hitSummary.${key}`);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`J_DOMAIN_FIELD_REQUIRED:geo.hitSummary.${key}`);
    return value;
  };
  return { domain: "J2", window: "ROLLING_24H", available: true,
    windowStart: requiredText(row.windowStart, "geo.hitSummary.windowStart"), capturedAt: requiredText(row.capturedAt, "geo.hitSummary.capturedAt"),
    totalBlockedEvents: count("totalBlockedEvents"), countryCount: count("countryCount"),
    source: requiredStringArray(row.source, "geo.hitSummary.source"), sourceFields: requiredStringArray(row.sourceFields, "geo.hitSummary.sourceFields"),
    definition: requiredText(row.definition, "geo.hitSummary.definition"), coverage: "recorded_geo_block_events_only", uniqueUsers: false, allAccessProof: false };
}
/** Individual refused requests, distinct from country settings and command receipts. */
export type GeoHitDetail = {
  id: number; recordedAt: string; countryCode: string; countryName: string;
  endpointKey: string | null; source: string | null; eventCount: number;
};
export type GeoHitDetailPage = { total: number; pageNum: number; pageSize: number; records: GeoHitDetail[] };
export type GeoHitDetailQuery = { countryCode?: string; endpointKey?: string; pageNum?: number; pageSize?: number };

export async function fetchJ2GeoHitDetails(query: GeoHitDetailQuery = {}, signal?: AbortSignal): Promise<GeoHitDetailPage> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) search.set(key, String(value));
  const data = rec(await apiRequest<unknown>(`/geo-block/hits${search.size ? `?${search}` : ""}`, { signal }));
  const count = (value: unknown, field: string, min = 0) => {
    const result = requiredNum(value, `geo.hitDetails.${field}`);
    if (!Number.isSafeInteger(result) || result < min) throw new Error(`J_DOMAIN_FIELD_REQUIRED:geo.hitDetails.${field}`);
    return result;
  };
  const total = count(data.total, "total"), pageNum = count(data.pageNum, "pageNum", 1), pageSize = count(data.pageSize, "pageSize", 1);
  if (pageSize > 100) throw new Error("J_DOMAIN_FIELD_REQUIRED:geo.hitDetails.pageSize");
  const records = requiredRecordRows(data.records, "geo.hitDetails.records").map((row, index): GeoHitDetail => {
    const optionalText = (key: "endpointKey" | "source") => {
      const value = row[key];
      if (value == null) return null;
      if (typeof value !== "string") throw new Error(`J_DOMAIN_FIELD_REQUIRED:geo.hitDetails.records.${index}.${key}`);
      return value;
    };
    return { id: count(row.id, `records.${index}.id`, 1),
      recordedAt: requiredText(row.recordedAt, `geo.hitDetails.records.${index}.recordedAt`),
      countryCode: requiredText(row.countryCode, `geo.hitDetails.records.${index}.countryCode`),
      countryName: requiredText(row.countryName, `geo.hitDetails.records.${index}.countryName`),
      endpointKey: optionalText("endpointKey"), source: optionalText("source"),
      eventCount: count(row.eventCount, `records.${index}.eventCount`) };
  });
  if (records.length > pageSize || records.length > total) throw new Error("J_DOMAIN_FIELD_REQUIRED:geo.hitDetails.records");
  return { total, pageNum, pageSize, records };
}

export type GeoEdgeMetric = { key: string; k: string; value: string; v: string; tone: string };
export type GeoBlockOverview = {
  blocked: GeoCountry[];
  limited: GeoCountry[];
  countries: GeoCountry[];
  countryOptions: GeoCountryOption[];
  endpoints: GeoEndpoint[];
  hits: GeoHit[];
  edge: { source: string; sourceKnown: boolean; sources: GeoEdgeSourceOption[]; healthy: boolean; healthStatus: string; metrics: GeoEdgeMetric[] };
  recentChanges: GeoRecentChange[];
  stats: Record<string, unknown> & { totalHits: number };
  sources: string[];
};

export type TamperTrendWindow = { points: number[]; pts: number[]; max: number; labels: string[] };
export type TamperTrend = Record<"24h" | "7d" | "30d", TamperTrendWindow>;
export type TamperPath = {
  id: string;
  name: string;
  nm: string;
  description: string;
  desc: string;
  count: number;
  ct: number;
  accounts: number;
  acct: number;
  color: string;
};
export type TamperAccount = {
  userCode: string;
  userNo: string;
  count: number;
  cnt: number;
  k4: string;
  last: string;
  lastOccurredAt: string;
  paths: string[];
  cluster: string;
  fedToK4: boolean;
  b5Triggered: boolean;
  alertState: "flagged" | "escalated";
};
export type TamperAccountPage = {
  page: number;
  pageSize: number;
  total: number;
  pages: number;
  hasPrev: boolean;
  hasNext: boolean;
};
export type TamperOverview = {
  window: "24h" | "7d" | "30d";
  hasData: boolean;
  stats: Record<string, unknown>;
  trend: TamperTrend;
  paths: TamperPath[];
  accounts: TamperAccount[];
  accountPage: TamperAccountPage;
  coverage: {
    status: "partial" | "complete";
    registeredCount: number;
    activeCount: number;
    registeredPaths: string[];
    activePaths: string[];
    missingPaths: string[];
  };
  alertConfig: {
    threshold: number;
    label: string;
    feedK4: boolean;
    effectiveThreshold: number;
    effectiveLabel: string;
    sevenDayAlertAccounts: number;
    sevenDayPreviewByThreshold: Record<string, number>;
  };
  sources: string[];
};
export type TamperReport = {
  reportId: string;
  window: "24h" | "7d" | "30d";
  masked: boolean;
  status: string;
  filename: string;
  contentType: string;
  contentBase64: string;
  eventCount: number;
  accountCount: number;
};

export type J4StepImpact = {
  available: false;
  reason: "NO_AUTHORITATIVE_IMPACT_COUNT" | "TARGET_SCOPE_ONLY" | "NOTIFICATION_COUNT_ONLY";
  scope: {
    type: "killswitch" | "country" | "user" | "cluster" | "campaign" | "disclosure" | "unknown";
    value: string;
    targetUserCount?: number;
  };
  estimatedUsers: null;
  actualAffectedUsers: null;
  actualNotifications: number | null;
};
export type PlaybookStep = { domain: string; dom: string; action: string; ax: string; approve: boolean; ref?: string | null; impact?: J4StepImpact };
export type Playbook = {
  code: string;
  name: string;
  scene: string;
  emergency: boolean;
  emer: boolean;
  sla: string;
  state: "active" | "todo" | string;
  owner: string;
  lastDrill: string;
  sequence: PlaybookStep[];
  seq: PlaybookStep[];
  notifyCampaignNo?: string;
  notifyTemplate?: string;
  rollback?: string;
  drillRequired?: boolean;
  draft?: boolean;
  version?: string;
  executionReady?: boolean;
  drillFresh?: boolean;
  drillEvidence?: boolean;
  campaignReady?: boolean;
  readinessReason?: string;
};
export type SopExecution = {
  timestamp: string;
  ts: string;
  code: string;
  name: string;
  trigger: string;
  trig: string;
  mode: string;
  steps: string[];
  operator: string;
  roleGate: string;
  executionId?: string;
  executionGeneration?: number;
  rollbackStatus?: string;
  rollbackAt?: string;
  rollbackReason?: string;
  notificationDispatch: Record<string, unknown>;
  domainActions: Array<Record<string, unknown> & { impact?: J4StepImpact }>;
  rollbackActions: Array<Record<string, unknown>>;
  reversible: boolean;
};

export type J4StepConfirmationInput = {
  step: number;
  domain: string;
  ref: string;
  confirmed: true;
};
export type J4ActionOption = {
  value: string;
  domain: string;
  action: string;
  ref: string | null;
  approve: boolean;
  description: string;
  parameterLabel?: string;
  parameterPlaceholder?: string;
  label: string;
  searchText: string;
};
export type J4RollbackOption = {
  value: string;
  label: string;
  scene: string;
  riskLevel: string;
  plan: string;
  searchText: string;
};
export type SopOverview = {
  contractVersion: string;
  stats: Record<string, unknown>;
  scenes: string[];
  actionOptions: J4ActionOption[];
  rollbackOptions: J4RollbackOption[];
  playbooks: Playbook[];
  executions: SopExecution[];
  sources: string[];
};

export type JNotifyTemplateOption = {
  value: string;
  label: string;
  campaignNo: string;
  name: string;
  tier: string;
  audience: string;
  status: string;
  meta: string;
  searchText: string;
};

export type J4PlaybookCreateInput = {
  name: string;
  scene?: string;
  owner?: string;
  sla?: string;
  emergencyTrack?: boolean;
  actionSeq?: string;
  notifyCampaignNo?: string;
  notifyTemplate?: string;
  rollback?: string;
  drillRequired?: boolean;
};

export type J4PlaybookUpdateInput = Partial<J4PlaybookCreateInput> & {
  summary?: string;
  version: string;
};

export type JEmergencyData = {
  killSwitch?: KillSwitchOverview;
  geoBlock?: GeoBlockOverview;
  tamper?: TamperOverview;
  sop?: SopOverview;
  notifyTemplates?: JNotifyTemplateOption[];
  notifyTemplatesError?: string;
};

export type JEmergencyActions = {
  reloadJEmergency: () => Promise<JEmergencyData>;
  toggleJ1KillSwitch: (key: string, enabled: boolean, reason: string, context?: { triggerBasis?: string; dispositionPlan?: string }, commandKey?: string) => Promise<void>;
  emergencyDisableJ1: (keys: string[], reason: string, operator?: string, context?: { triggerBasis: string; regulatoryContext: string; dispositionPlan?: string }, commandKey?: string) => Promise<void>;
  updateJ1Sla: (paramKey: string, value: string, expectedValue: string, reason: string, commandKey?: string) => Promise<void>;
  updateJ1AutoRule: (ruleId: string, value: string, expectedValue: string, reason: string, commandKey?: string) => Promise<void>;
  confirmJ1AutoTrigger: (key: string, incidentId: string, decision: "keep_disabled" | "recommend_restore", reason: string, commandKey?: string) => Promise<void>;
  updateJ2Country: (countryCode: string, status: "blocked" | "limited" | "allowed", expectedStatus: "blocked" | "limited" | "allowed", triggerBasis: string | undefined, reason: string, commandKey?: string) => Promise<void>;
  replaceJ2CountryList: (status: "blocked" | "limited", countries: string[], expectedCountries: string[], triggerBasis: string | undefined, reason: string, commandKey?: string, context?: J2CommandContext) => Promise<void>;
  updateJ2Endpoint: (endpointKey: string, mode: "explicit" | "derived", countries: string[], expectedMode: "explicit" | "derived", expectedCountries: string[], reason: string, commandKey?: string, context?: J2CommandContext) => Promise<void>;
  updateJ2EdgeJudge: (source: string, expectedSource: string, reason: string, commandKey?: string, context?: J2CommandContext) => Promise<void>;
  emergencyBlockJ2: (countries: string[], triggerBasis: string, reason: string, commandKey?: string, context?: J2CommandContext) => Promise<void>;
  loadJ3TamperPage: (window: "24h" | "7d" | "30d", page: number, pageSize: number) => Promise<TamperOverview>;
  updateJ3AlertConfig: (threshold: number, feedK4: boolean, expectedThreshold: number, expectedFeedK4: boolean, reason: string, commandKey?: string, context?: TamperOverview["alertConfig"]) => Promise<void>;
  createJ3Report: (window: "24h" | "7d" | "30d", reason: string, commandKey?: string) => Promise<TamperReport>;
  createJ4Playbook: (body: J4PlaybookCreateInput, reason: string, commandKey?: string, context?: J4CommandContext) => Promise<void>;
  updateJ4Playbook: (code: string, body: J4PlaybookUpdateInput, reason: string, commandKey?: string, context?: J4CommandContext) => Promise<void>;
  drillJ4Playbook: (code: string, reason: string, commandKey?: string, context?: J4CommandContext) => Promise<void>;
  executeJ4Playbook: (
    code: string,
    emergency: boolean,
    reason: string,
    confirmation: { triggerBasis: string; triggerContext: string; stepConfirmations: J4StepConfirmationInput[] },
    commandKey?: string,
  ) => Promise<void>;
  cancelJ4Playbook: (code: string, executionId: string, reason: string, commandKey?: string, context?: J4CommandContext) => Promise<void>;
  resumeJ4Playbook: (code: string, executionId: string, reason: string, commandKey?: string, context?: J4CommandContext) => Promise<void>;
  rollbackJ4Playbook: (code: string, executionId: string, reason: string, commandKey?: string, context?: J4CommandContext) => Promise<void>;
};

function normalizeKillSwitch(raw: unknown): KillSwitchOverview {
  const data = rec(raw);
  const coverage = rec(data.coverage);
  const activeGateCount = requiredNum(data.activeGateCount, "killSwitch.activeGateCount");
  const rawGates = requiredRows<Record<string, unknown>>(data.activeGates, "killSwitch.activeGates");
  if (activeGateCount !== J1_GATE_KEYS.length || rawGates.length !== J1_GATE_KEYS.length) {
    contractError("killSwitch.activeGates.count");
  }
  const activeGates = rawGates.map((gate, index) => {
    const key = requiredText(gate.key, `killSwitch.activeGates.${index}.key`);
    const enabled = requiredBool(gate.enabled, `killSwitch.activeGates.${index}.enabled`);
    const on = requiredBool(gate.on, `killSwitch.activeGates.${index}.on`);
    const status = requiredText(gate.status, `killSwitch.activeGates.${index}.status`);
    const coveragePrecheckRequired = requiredBool(gate.coveragePrecheckRequired, `killSwitch.activeGates.${index}.coveragePrecheckRequired`);
    const coverageImpactCategory = requiredText(gate.coverageImpactCategory, `killSwitch.activeGates.${index}.coverageImpactCategory`);
    const amplifies = requiredBool(gate.amplifies, `killSwitch.activeGates.${index}.amplifies`);
    const emergency = requiredBool(gate.emergency, `killSwitch.activeGates.${index}.emergency`);
    const expected = J1_GATE_SEMANTICS[key];
    if (!J1_GATE_KEY_SET.has(key)
      || !expected
      || on !== enabled
      || status !== (enabled ? "enabled" : "disabled")
      || !["immediate", "delayed", "none"].includes(coverageImpactCategory)
      || coveragePrecheckRequired !== amplifies
      || coveragePrecheckRequired !== expected.coveragePrecheckRequired
      || coverageImpactCategory !== expected.coverageImpactCategory
      || (emergency && enabled)) {
      contractError(`killSwitch.activeGates.${index}`);
    }
    return {
      key,
      name: requiredText(gate.name, `killSwitch.activeGates.${index}.name`),
      cap: requiredText(gate.cap, `killSwitch.activeGates.${index}.cap`),
      desc: requiredText(gate.desc, `killSwitch.activeGates.${index}.desc`),
      enabled,
      on,
      status,
      coveragePrecheckRequired,
      coverageImpactCategory,
      amplifies,
      lastChange: str(gate.lastChange),
      emergency,
    };
  });
  if (new Set(activeGates.map((gate) => gate.key)).size !== J1_GATE_KEYS.length
    || J1_GATE_KEYS.some((key) => !activeGates.some((gate) => gate.key === key))) {
    contractError("killSwitch.activeGates.keys");
  }
  const coverageRatio = requiredNum(coverage.coverageRatio, "coverage.coverageRatio");
  const redlinePct = requiredNum(coverage.redlinePct, "coverage.redlinePct");
  const yellowLinePct = requiredNum(coverage.yellowLinePct, "coverage.yellowLinePct");
  const valuationReliable = requiredBool(coverage.valuationReliable, "coverage.valuationReliable");
  const recoveryAllowedByServer = requiredBool(coverage.recoveryAllowedByServer, "coverage.recoveryAllowedByServer");
  if (coverageRatio < 0 || redlinePct < 0 || yellowLinePct < 0 || yellowLinePct <= redlinePct) {
    contractError("coverage.thresholds");
  }
  const stats = rec(data.stats);
  const liveGateCount = requiredNum(stats.liveGateCount, "killSwitch.stats.liveGateCount");
  const killedGateCount = requiredNum(stats.killedGateCount, "killSwitch.stats.killedGateCount");
  const emergencyGateCount = requiredNum(stats.emergencyGateCount, "killSwitch.stats.emergencyGateCount");
  const coverageBlockedCount = requiredNum(stats.coverageBlockedCount, "killSwitch.stats.coverageBlockedCount");
  if (liveGateCount !== activeGates.filter((gate) => gate.enabled).length
    || killedGateCount !== activeGates.filter((gate) => !gate.enabled).length
    || emergencyGateCount !== activeGates.filter((gate) => gate.emergency).length
    || ![liveGateCount, killedGateCount, emergencyGateCount, coverageBlockedCount].every(Number.isInteger)
    || coverageBlockedCount < 0) {
    contractError("killSwitch.stats");
  }
  const autoConfirmations = requiredRows<Record<string, unknown>>(
    data.autoConfirmations,
    "killSwitch.autoConfirmations",
  ).map((row, index) => {
    const key = requiredText(row.key, `killSwitch.autoConfirmations.${index}.key`);
    const gate = activeGates.find((candidate) => candidate.key === key);
    if (!gate || gate.enabled || !gate.emergency) {
      contractError(`killSwitch.autoConfirmations.${index}.gateState`);
    }
    return {
      key,
      name: requiredText(row.name, `killSwitch.autoConfirmations.${index}.name`),
      incidentId: requiredText(row.incidentId, `killSwitch.autoConfirmations.${index}.incidentId`),
      ruleId: requiredText(row.ruleId, `killSwitch.autoConfirmations.${index}.ruleId`),
      signalValue: requiredNum(row.signalValue, `killSwitch.autoConfirmations.${index}.signalValue`),
      threshold: requiredNum(row.threshold, `killSwitch.autoConfirmations.${index}.threshold`),
      triggeredAt: requiredText(row.triggeredAt, `killSwitch.autoConfirmations.${index}.triggeredAt`),
      dueAt: requiredText(row.dueAt, `killSwitch.autoConfirmations.${index}.dueAt`),
      overdue: requiredBool(row.overdue, `killSwitch.autoConfirmations.${index}.overdue`),
    };
  });
  if (new Set(autoConfirmations.map((row) => row.key)).size !== autoConfirmations.length) {
    contractError("killSwitch.autoConfirmations.keys");
  }
  const emergencySlaRows = requiredRecordRows(
    data.emergencySla,
    "killSwitch.emergencySla",
  );
  const emergencySlaIds = exactRowIds(
    emergencySlaRows,
    J1_EMERGENCY_SLA_IDS,
    "killSwitch.emergencySla",
  );
  const emergencySla = emergencySlaRows.map((row, index) => {
    const id = emergencySlaIds[index];
    const value = requiredText(row.v, `killSwitch.emergencySla.${index}.v`);
    const kind = requiredText(row.kind, `killSwitch.emergencySla.${index}.kind`);
    const editable = requiredBool(row.editable, `killSwitch.emergencySla.${index}.editable`);
    const unit = requiredText(row.unit, `killSwitch.emergencySla.${index}.unit`);
    const numericValue = requiredNum(value, `killSwitch.emergencySla.${index}.v`);
    if (kind !== "number"
      || (id === "autoConfirmMins"
        && (!editable || unit !== "分钟" || !Number.isInteger(numericValue) || numericValue < 10 || numericValue > 120))
      || (id === "recoverGate"
        && (editable || unit !== "%" || numericValue < 0 || numericValue !== redlinePct))) {
      contractError(`killSwitch.emergencySla.${index}.semantics`);
    }
    requiredText(row.source, `killSwitch.emergencySla.${index}.source`);
    return {
      id,
      k: requiredText(row.k, `killSwitch.emergencySla.${index}.k`),
      d: requiredText(row.d, `killSwitch.emergencySla.${index}.d`),
      v: value,
      unit,
      kind: "number" as const,
      editable,
    };
  });
  const autoRuleRows = requiredRecordRows(data.autoRules, "killSwitch.autoRules");
  const autoRuleIds = exactRowIds(autoRuleRows, J1_AUTO_RULE_IDS, "killSwitch.autoRules");
  const expectedRuleSemantics: Record<string, {
    kind: "number" | "text";
    mode: "automatic" | "advisory" | "manual";
    adjustable: boolean;
  }> = {
    withdrawSurge: { kind: "number", mode: "automatic", adjustable: false },
    maturityGap: { kind: "number", mode: "automatic", adjustable: true },
    tamperCluster: { kind: "number", mode: "advisory", adjustable: false },
    regulatoryDirective: { kind: "text", mode: "manual", adjustable: false },
  };
  const autoRules = autoRuleRows.map((row, index) => {
    const id = autoRuleIds[index];
    const expected = expectedRuleSemantics[id];
    const kind = requiredText(row.kind, `killSwitch.autoRules.${index}.kind`);
    const mode = requiredText(row.mode, `killSwitch.autoRules.${index}.mode`);
    const adjustable = requiredBool(row.adjustable, `killSwitch.autoRules.${index}.adjustable`);
    const threshold = requiredText(row.thr, `killSwitch.autoRules.${index}.thr`);
    if (!expected || kind !== expected.kind || mode !== expected.mode || adjustable !== expected.adjustable) {
      contractError(`killSwitch.autoRules.${index}.semantics`);
    }
    requiredText(row.configKey, `killSwitch.autoRules.${index}.configKey`);
    if (kind === "number") {
      requiredNum(threshold.replaceAll(",", ""), `killSwitch.autoRules.${index}.thr`);
    }
    return {
      id,
      nm: requiredText(row.nm, `killSwitch.autoRules.${index}.nm`),
      tag: requiredText(row.tag, `killSwitch.autoRules.${index}.tag`),
      icon: requiredText(row.icon, `killSwitch.autoRules.${index}.icon`),
      cond: requiredStringArray(row.cond, `killSwitch.autoRules.${index}.cond`),
      thrK: requiredText(row.thrK, `killSwitch.autoRules.${index}.thrK`),
      thr: threshold,
      kind: expected.kind,
      unit: str(row.unit),
      mode: expected.mode,
      adjustable,
      refNote: str(row.refNote),
      refTitle: str(row.refTitle),
    };
  });
  return {
    activeGateCount,
    activeGates: [...activeGates].sort((a, b) => byGateDisplayOrder(a.key, b.key)),
    retiredGates: rows<Record<string, unknown>>(data.retiredGates),
    coverage: {
      coverageRatio,
      redlinePct,
      yellowLinePct,
      valuationReliable,
      recoveryAllowedByServer,
    },
    stats: (() => {
      return {
        liveGateCount,
        killedGateCount,
        emergencyGateCount,
        coverageBlockedCount,
      };
    })(),
    emergencySla,
    autoRules,
    autoConfirmations,
    sources: strArray(data.sources),
  };
}

/** The backend serializes BigDecimal amounts as decimal strings; keep every digit. */
function requiredDecimalText(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`J_DOMAIN_FIELD_REQUIRED:${field}`);
  }
  return value;
}

function normalizeGeo(raw: unknown): GeoBlockOverview {
  const data = rec(raw);
  const edge = rec(data.edge);
  const normalizeCountries = (value: unknown, field: string) => requiredRecordRows(value, field).map((row, index) => ({
    cc: requiredText(row.cc, `${field}.${index}.cc`),
    name: requiredText(row.name, `${field}.${index}.name`),
    reason: str(row.reason),
    status: requiredText(row.status, `${field}.${index}.status`),
    operator: str(row.operator),
    updatedAt: str(row.updatedAt),
    activeUsers: requiredNum(row.activeUsers, `${field}.${index}.activeUsers`),
    walletUsdt: requiredDecimalText(row.walletUsdt, `${field}.${index}.walletUsdt`),
  }));
  const countryOptionsRaw = requiredRecordRows(data.countryOptions, "geo.countryOptions");
  if (countryOptionsRaw.length === 0) contractError("geo.countryOptions.empty");
  const edgeSourcesRaw = requiredRecordRows(edge.sources, "geo.edge.sources");
  if (edgeSourcesRaw.length === 0) contractError("geo.edge.sources.empty");
  return {
    blocked: normalizeCountries(data.blocked, "geo.blocked"),
    limited: normalizeCountries(data.limited, "geo.limited"),
    countries: normalizeCountries(data.countries, "geo.countries"),
    countryOptions: countryOptionsRaw.map((row, index) => ({
      value: requiredText(row.value, `geo.countryOptions.${index}.value`),
      label: requiredText(row.label, `geo.countryOptions.${index}.label`),
      source: requiredText(row.source, `geo.countryOptions.${index}.source`),
      activeUsers: requiredNum(row.activeUsers, `geo.countryOptions.${index}.activeUsers`),
      walletUsdt: requiredDecimalText(row.walletUsdt, `geo.countryOptions.${index}.walletUsdt`),
    })),
    endpoints: requiredRows<Record<string, unknown>>(data.endpoints, "geo.endpoints").map((row, index) => {
      const endpoint = str(row.endpoint);
      const countries = strArray(row.countries);
      const source = str(row.source);
      return {
        key: str(row.key),
        ep: endpoint,
        endpoint,
        label: str(row.label),
        biz: str(row.biz),
        domain: str(row.domain),
        countries,
        geo: countries,
        source,
        src: source,
        sourceLabel: str(row.sourceLabel),
        sourceDescription: str(row.sourceDescription),
        srcDesc: str(row.sourceDescription),
        hits: requiredNum(row.hits, `geo.endpoints.${index}.hits`),
        configurable: requiredBool(row.configurable, `geo.endpoints.${index}.configurable`),
      };
    }),
    hits: requiredRows<Record<string, unknown>>(data.hits, "geo.hits").map((row, index) => ({
      cc: str(row.cc),
      name: str(row.name),
      nm: str(row.name),
      count: requiredNum(row.count, `geo.hits.${index}.count`),
      ct: requiredNum(row.count, `geo.hits.${index}.count`),
    })),
    edge: {
      source: str(edge.source),
      sourceKnown: requiredBool(edge.sourceKnown, "geo.edge.sourceKnown"),
      sources: edgeSourcesRaw.map((row, index) => ({
        value: requiredText(row.value, `geo.edge.sources.${index}.value`),
        label: requiredText(row.label, `geo.edge.sources.${index}.label`),
        description: requiredText(row.description, `geo.edge.sources.${index}.description`),
        healthy: requiredBool(row.healthy, `geo.edge.sources.${index}.healthy`),
        healthStatus: requiredText(row.healthStatus, `geo.edge.sources.${index}.healthStatus`),
        sampleCount: requiredNum(row.sampleCount, `geo.edge.sources.${index}.sampleCount`),
      })),
      healthy: requiredBool(edge.healthy, "geo.edge.healthy"),
      healthStatus: requiredText(edge.healthStatus, "geo.edge.healthStatus"),
      metrics: requiredRows<Record<string, unknown>>(edge.metrics, "geo.edge.metrics").map((row) => ({
        key: str(row.key),
        k: str(row.key),
        value: str(row.value),
        v: str(row.value),
        tone: str(row.tone),
      })),
    },
    recentChanges: requiredRows<Record<string, unknown>>(data.recentChanges, "geo.recentChanges").map((row) => ({
      action: str(row.action),
      resourceType: str(row.resourceType),
      resourceId: str(row.resourceId),
      operator: str(row.operator),
      reason: str(row.reason),
      beforeValue: str(row.beforeValue),
      afterValue: str(row.afterValue),
      createdAt: str(row.createdAt),
    })),
    stats: { ...rec(data.stats), totalHits: requiredNum(rec(data.stats).totalHits, "geo.stats.totalHits") },
    sources: strArray(data.sources),
  };
}

function normalizeTrendWindow(value: unknown, field: string): TamperTrendWindow {
  const row = rec(value);
  const points = requiredRows<unknown>(row.points, `${field}.points`)
    .map((item, index) => requiredNum(item, `${field}.points.${index}`));
  return { points, pts: points, max: requiredNum(row.max, `${field}.max`), labels: strArray(row.labels) };
}

function normalizeTamper(raw: unknown): TamperOverview {
  const data = rec(raw);
  const trend = rec(data.trend);
  const alertConfig = rec(data.alertConfig);
  const accountPage = rec(data.accountPage);
  const coverage = rec(data.coverage);
  const window = requiredText(data.window, "tamper.window");
  if (window !== "24h" && window !== "7d" && window !== "30d") contractError("tamper.window");
  return {
    window,
    hasData: requiredBool(data.hasData, "tamper.hasData"),
    stats: rec(data.stats),
    trend: {
      "24h": normalizeTrendWindow(trend["24h"], "trend.24h"),
      "7d": normalizeTrendWindow(trend["7d"], "trend.7d"),
      "30d": normalizeTrendWindow(trend["30d"], "trend.30d"),
    },
    paths: requiredRows<Record<string, unknown>>(data.paths, "tamper.paths").map((row, index) => ({
      id: str(row.id),
      name: str(row.name),
      nm: str(row.name),
      description: str(row.description),
      desc: str(row.description),
      count: requiredNum(row.count, `tamper.paths.${index}.count`),
      ct: requiredNum(row.count, `tamper.paths.${index}.count`),
      accounts: requiredNum(row.accounts, `tamper.paths.${index}.accounts`),
      acct: requiredNum(row.accounts, `tamper.paths.${index}.accounts`),
      color: str(row.color),
    })),
    accounts: requiredRows<Record<string, unknown>>(data.accounts, "tamper.accounts").map((row, index) => {
      const userCode = str(row.userCode, str(row.userNo));
      if (row.fedToK4 == null) throw new Error("J3_RISK_SCORE_RECEIPT_UNAVAILABLE");
      if (row.b5Triggered == null) throw new Error("J3_RISK_ALERT_RECEIPT_UNAVAILABLE");
      return {
        userCode,
        userNo: userCode,
        count: requiredNum(row.count, `tamper.accounts.${index}.count`),
        cnt: requiredNum(row.count, `tamper.accounts.${index}.count`),
        k4: str(row.k4),
        last: str(row.last),
        lastOccurredAt: (() => {
          const value = requiredText(row.lastOccurredAt, `tamper.accounts.${index}.lastOccurredAt`);
          if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) contractError(`tamper.accounts.${index}.lastOccurredAt`);
          return value;
        })(),
        paths: strArray(row.paths),
        cluster: str(row.cluster),
        fedToK4: requiredBool(row.fedToK4, `tamper.accounts.${index}.fedToK4`),
        b5Triggered: requiredBool(row.b5Triggered, `tamper.accounts.${index}.b5Triggered`),
        alertState: (() => {
          const value = requiredText(row.alertState, `tamper.accounts.${index}.alertState`);
          if (value !== "flagged" && value !== "escalated") contractError(`tamper.accounts.${index}.alertState`);
          return value;
        })(),
      };
    }),
    accountPage: {
      page: requiredNum(accountPage.page, "accountPage.page"),
      pageSize: requiredNum(accountPage.pageSize, "accountPage.pageSize"),
      total: requiredNum(accountPage.total, "accountPage.total"),
      pages: requiredNum(accountPage.pages, "accountPage.pages"),
      hasPrev: requiredBool(accountPage.hasPrev, "accountPage.hasPrev"),
      hasNext: requiredBool(accountPage.hasNext, "accountPage.hasNext"),
    },
    coverage: (() => {
      const status = requiredText(coverage.status, "coverage.status");
      if (status !== "partial" && status !== "complete") contractError("coverage.status");
      const registeredCount = requiredNum(coverage.registeredCount, "coverage.registeredCount");
      const activeCount = requiredNum(coverage.activeCount, "coverage.activeCount");
      const registeredPaths = requiredStringArray(coverage.registeredPaths, "coverage.registeredPaths");
      const activePaths = requiredStringArrayAllowEmpty(coverage.activePaths, "coverage.activePaths");
      const missingPaths = requiredStringArrayAllowEmpty(coverage.missingPaths, "coverage.missingPaths");
      if (!Number.isInteger(registeredCount) || !Number.isInteger(activeCount)
        || registeredCount !== registeredPaths.length || activeCount !== activePaths.length
        || missingPaths.length !== registeredCount - activeCount
        || (status === "complete") !== (activeCount === registeredCount)) {
        contractError("coverage.consistency");
      }
      return { status, registeredCount, activeCount, registeredPaths, activePaths, missingPaths };
    })(),
    alertConfig: normalizeTamperAlertConfig(alertConfig),
    sources: strArray(data.sources),
  };
}

function normalizeTamperAlertConfig(raw: unknown): TamperOverview["alertConfig"] {
  const alertConfig = rec(raw);
  const threshold = requiredNum(alertConfig.threshold, "alertConfig.threshold");
  const effectiveThreshold = requiredNum(alertConfig.effectiveThreshold, "alertConfig.effectiveThreshold");
  const sevenDayAlertAccounts = requiredNum(alertConfig.sevenDayAlertAccounts, "alertConfig.sevenDayAlertAccounts");
  const rawPreview = rec(alertConfig.sevenDayPreviewByThreshold);
  const previewEntries = Object.entries(rawPreview);
  const expectedKeys = Array.from({ length: 100 }, (_, index) => String(index + 1));
  if (previewEntries.length !== expectedKeys.length
    || expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(rawPreview, key))) {
    contractError("alertConfig.sevenDayPreviewByThreshold.keys");
  }
  const sevenDayPreviewByThreshold = Object.fromEntries(previewEntries.map(([key, value]) => {
    const count = requiredNum(value, `alertConfig.sevenDayPreviewByThreshold.${key}`);
    if (!Number.isInteger(count) || count < 0) contractError(`alertConfig.sevenDayPreviewByThreshold.${key}`);
    return [key, count];
  }));
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100
    || !Number.isInteger(effectiveThreshold) || effectiveThreshold < threshold
    || !Number.isInteger(sevenDayAlertAccounts) || sevenDayAlertAccounts < 0
    || sevenDayPreviewByThreshold[String(threshold)] !== sevenDayAlertAccounts) {
    contractError("alertConfig.consistency");
  }
  return {
    threshold,
    label: requiredText(alertConfig.label, "alertConfig.label"),
    feedK4: requiredBool(alertConfig.feedK4, "alertConfig.feedK4"),
    effectiveThreshold,
    effectiveLabel: requiredText(alertConfig.effectiveLabel, "alertConfig.effectiveLabel"),
    sevenDayAlertAccounts,
    sevenDayPreviewByThreshold,
  };
}

function normalizeTamperReport(raw: unknown, expectedWindow: "24h" | "7d" | "30d"): TamperReport {
  const data = rec(raw);
  const window = requiredText(data.window, "tamperReport.window");
  if (window !== "24h" && window !== "7d" && window !== "30d") contractError("tamperReport.window");
  const masked = requiredBool(data.masked, "tamperReport.masked");
  const status = requiredText(data.status, "tamperReport.status");
  const filename = requiredText(data.filename, "tamperReport.filename");
  const contentType = requiredText(data.contentType, "tamperReport.contentType");
  const contentBase64 = requiredText(data.contentBase64, "tamperReport.contentBase64");
  if (window !== expectedWindow || !masked || status !== "READY" || !filename.toLowerCase().endsWith(".csv")
    || !contentType.toLowerCase().startsWith("text/csv")
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(contentBase64) || contentBase64.length % 4 !== 0) {
    contractError("tamperReport.invariants");
  }
  return {
    reportId: requiredText(data.reportId, "tamperReport.reportId"),
    window,
    masked,
    status,
    filename,
    contentType,
    contentBase64,
    eventCount: requiredNum(data.eventCount, "tamperReport.eventCount"),
    accountCount: requiredNum(data.accountCount, "tamperReport.accountCount"),
  };
}

/** 6c8eb9ae/91adf9aa: counts describe target members or notifications, never affected users.
 * An absent contract is the legacy backend, distinct from an explicit unavailable impact. */
function normalizeJ4StepImpact(value: unknown): J4StepImpact | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) contractError("sop.step.impact");
  const row = value as Record<string, unknown>;
  if (!row.scope || typeof row.scope !== "object" || Array.isArray(row.scope)) contractError("sop.step.impact.scope");
  const scope = row.scope as Record<string, unknown>;
  if (row.available !== false || row.estimatedUsers !== null || row.actualAffectedUsers !== null
    || typeof row.reason !== "string" || !["NO_AUTHORITATIVE_IMPACT_COUNT", "TARGET_SCOPE_ONLY", "NOTIFICATION_COUNT_ONLY"].includes(row.reason)
    || typeof scope.type !== "string" || !["killswitch", "country", "user", "cluster", "campaign", "disclosure", "unknown"].includes(scope.type)
    || typeof scope.value !== "string"
    || scope.targetUserCount !== undefined && (typeof scope.targetUserCount !== "number" || !Number.isSafeInteger(scope.targetUserCount) || scope.targetUserCount < 0)
    || row.actualNotifications !== null && (typeof row.actualNotifications !== "number" || !Number.isSafeInteger(row.actualNotifications) || row.actualNotifications < 0)) {
    contractError("sop.step.impact");
  }
  return {
    available: false,
    reason: row.reason as J4StepImpact["reason"],
    scope: { type: scope.type as J4StepImpact["scope"]["type"], value: scope.value,
      ...(scope.targetUserCount !== undefined ? { targetUserCount: scope.targetUserCount as number } : {}) },
    estimatedUsers: null,
    actualAffectedUsers: null,
    actualNotifications: row.actualNotifications as number | null,
  };
}

function normalizeSopPlaybook(raw: unknown): Playbook {
  const row = rec(raw);
  const sequence = requiredRecordRows(row.sequence, "sop.playbook.sequence").map((step) => ({
    domain: requiredText(step.domain, "sop.step.domain"),
    dom: requiredText(step.domain, "sop.step.domain"),
    action: str(step.action),
    ax: str(step.action),
    approve: requiredBool(step.approve, "sop.step.approve"),
    ref: step.ref == null ? null : str(step.ref),
    impact: normalizeJ4StepImpact(step.impact),
  }));
  const emergency = requiredBool(row.emergency, "sop.playbook.emergency");
  return {
    code: requiredText(row.code, "sop.playbook.code"),
    name: requiredText(row.name, "sop.playbook.name"),
    scene: requiredText(row.scene, "sop.playbook.scene"),
    emergency,
    emer: emergency,
    sla: requiredText(row.sla, "sop.playbook.sla"),
    state: str(row.state, "todo"),
    owner: str(row.owner),
    lastDrill: str(row.lastDrill),
    sequence,
    seq: sequence,
    notifyCampaignNo: str(row.notifyCampaignNo),
    notifyTemplate: str(row.notifyTemplate),
    rollback: str(row.rollback),
    drillRequired: requiredBool(row.drillRequired, "sop.playbook.drillRequired"),
    draft: requiredBool(row.draft, "sop.playbook.draft"),
    version: str(row.version) || undefined,
    executionReady: row.executionReady == null ? undefined : requiredBool(row.executionReady, "sop.playbook.executionReady"),
    drillFresh: row.drillFresh == null ? undefined : requiredBool(row.drillFresh, "sop.playbook.drillFresh"),
    drillEvidence: row.drillEvidence == null ? undefined : requiredBool(row.drillEvidence, "sop.playbook.drillEvidence"),
    campaignReady: row.campaignReady == null ? undefined : requiredBool(row.campaignReady, "sop.playbook.campaignReady"),
    readinessReason: str(row.readinessReason),
  };

}

function normalizeSopExecution(raw: unknown): SopExecution {
  const row = rec(raw);
  const executionGeneration = row.executionGeneration;
  if (executionGeneration !== undefined && (typeof executionGeneration !== "number"
    || !Number.isSafeInteger(executionGeneration) || executionGeneration < 0)) contractError("sop.execution.executionGeneration");
  return {
    timestamp: requiredText(row.timestamp, "sop.execution.timestamp"),
    ts: requiredText(row.timestamp, "sop.execution.timestamp"),
    code: requiredText(row.code, "sop.execution.code"),
    name: str(row.name),
    trigger: str(row.trigger),
    trig: str(row.trigger),
    mode: requiredText(row.mode, "sop.execution.mode"),
    steps: requiredStringArrayAllowEmpty(row.steps, "sop.execution.steps"),
    operator: str(row.operator),
    roleGate: str(row.roleGate),
    executionId: str(row.executionId),
    executionGeneration,
    rollbackStatus: str(row.rollbackStatus),
    rollbackAt: str(row.rollbackAt),
    rollbackReason: str(row.rollbackReason),
    notificationDispatch: rec(row.notificationDispatch),
    domainActions: requiredRecordRows(row.domainActions, "sop.execution.domainActions").map((action) => ({
      ...action, impact: normalizeJ4StepImpact(action.impact),
    })),
    rollbackActions: row.rollbackActions == null ? [] : requiredRecordRows(row.rollbackActions, "sop.execution.rollbackActions"),
    reversible: requiredBool(row.reversible, "sop.execution.reversible"),
  };
}

function normalizeSop(raw: unknown): SopOverview {
  const data = rec(raw);
  const actionOptions = requiredRecordRows(data.actionOptions, "sop.actionOptions").map((row) => {
    const domain = str(row.domain).toUpperCase();
    const ref = row.ref == null ? null : str(row.ref);
    const canonical = ref === "withdraw"
      ? { action: "熔断提现通道", description: "暂停用户提现，用于挤兑或对账缺口止血" }
      : ref === "genesis"
        ? { action: "熔断 Genesis 交易", description: "暂停创世节点交易或转让市场入口" }
        : ref === "campaign-notify"
          ? { action: "发送通知模板", description: "使用已排期的通知活动通知用户、法务、财务或超管" }
          : { action: str(row.action), description: str(row.description) };
    const { action, description } = canonical;
    const actionLabel = ref === "withdraw" ? "暂停提现通道" : ref === "genesis" ? "暂停创世节点交易" : action;
    const label = `${domain} · ${actionLabel}`;
    return {
      value: str(row.value, ref ? `${domain}:${ref}` : `${domain}:${action}`),
      domain,
      action,
      ref,
      approve: bool(row.approve, domain !== "I3"),
      description,
      parameterLabel: str(row.parameterLabel) || undefined,
      parameterPlaceholder: str(row.parameterPlaceholder) || undefined,
      label,
      searchText: [domain, action, ref, description, label, row.parameterLabel].filter(Boolean).join(" ").toLowerCase(),
    };
  }).filter((item) => (item.domain === "J1" && ["withdraw", "genesis"].includes(item.ref ?? ""))
    || (item.domain === "J2" && item.ref === "geo-block:{target}")
    || (item.domain === "C2" && item.ref === "user-freeze:{target}")
    || (item.domain === "K1" && item.ref === "cluster-freeze:{target}")
    || (item.domain === "I3" && item.ref === "campaign-notify")
    || (item.domain === "I5" && item.ref === "disclosure-publish:{target}"));
  const rollbackOptions = requiredRecordRows(data.rollbackOptions, "sop.rollbackOptions").map((row) => {
    const label = str(row.label, str(row.value));
    const scene = str(row.scene, "通用");
    const riskLevel = str(row.riskLevel, "MEDIUM");
    const plan = str(row.plan);
    return {
      value: str(row.value, label),
      label,
      scene,
      riskLevel,
      plan,
      searchText: [label, scene, riskLevel, plan].filter(Boolean).join(" ").toLowerCase(),
    };
  }).filter((item) => item.value === "root-cause-standard");
  return {
    contractVersion: requiredText(data.contractVersion, "sop.contractVersion"),
    stats: rec(data.stats),
    scenes: requiredStringArrayAllowEmpty(data.scenes, "sop.scenes"),
    actionOptions,
    rollbackOptions,
    playbooks: requiredRecordRows(data.playbooks, "sop.playbooks").map(normalizeSopPlaybook),
    executions: requiredRecordRows(data.executions, "sop.executions").map(normalizeSopExecution),
    sources: strArray(data.sources),
  };
}

function normalizeNotifyTemplates(raw: unknown): JNotifyTemplateOption[] {
  const data = rec(raw);
  const priority: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };
  return rows<Record<string, unknown>>(data.campaigns)
    .map((row) => {
      const campaignNo = str(row.id, str(row.campaignNo));
      const name = str(row.name, campaignNo);
      const tier = str(row.tier, "normal");
      const audience = str(row.audience);
      const status = str(row.status, "draft");
      const schedule = str(row.schedule);
      const label = [name, tier, audience].filter(Boolean).join(" · ");
      const meta = [campaignNo, status, schedule].filter(Boolean).join(" · ");
      const searchText = [campaignNo, name, tier, audience, status, schedule, label, meta]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return {
        value: campaignNo,
        label,
        campaignNo,
        name,
        tier,
        audience,
        status,
        meta,
        searchText,
      };
    })
    .filter((item) => item.campaignNo && item.status === "scheduled")
    .sort((a, b) => (priority[a.tier] ?? 9) - (priority[b.tier] ?? 9) || a.name.localeCompare(b.name));
}

export async function fetchJTamperOverview(window: "24h" | "7d" | "30d" = "24h", accountPage = 1, accountPageSize = 5): Promise<TamperOverview> {
  const params = new URLSearchParams({
    window: window,
    accountPage: String(accountPage),
    accountPageSize: String(accountPageSize),
  });
  return apiRequest(`/tamper/overview?${params.toString()}`).then(normalizeTamper);
}

export async function fetchJ4NotifyTemplateOptions(): Promise<JNotifyTemplateOption[]> {
  return contentApiRequest("/campaigns/overview").then(normalizeNotifyTemplates);
}

export async function fetchJEmergencyOverviews(tab: "J1" | "J2" | "J3" | "J4",
  j3Window: "24h" | "7d" | "30d" = "24h",
  j3AccountPage = 1,
  j3AccountPageSize = 5,
): Promise<JEmergencyData> {
  switch (tab) {
    case "J1":
      return { killSwitch: await apiRequest("/kill-switches").then(normalizeKillSwitch) };
    case "J2":
      return { geoBlock: await apiRequest("/geo-block").then(normalizeGeo) };
    case "J3":
      return { tamper: await fetchJTamperOverview(j3Window, j3AccountPage, j3AccountPageSize) };
    case "J4": {
      const [sop, notifyTemplatesResult] = await Promise.all([
        apiRequest("/sop/playbooks").then(normalizeSop),
        fetchJ4NotifyTemplateOptions().then(
          (value) => ({ value, error: "" }),
          (error: unknown) => ({ value: [] as JNotifyTemplateOption[], error: error instanceof Error ? error.message : "I3_NOTIFY_TEMPLATE_LOAD_FAILED" }),
        ),
      ]);
      return { sop, notifyTemplates: notifyTemplatesResult.value, notifyTemplatesError: notifyTemplatesResult.error || undefined };
    }
  }
}

export const jEmergencyActions: Omit<JEmergencyActions, "reloadJEmergency"> = {
  toggleJ1KillSwitch: (key, enabled, reason, context, commandKey) => apiRequest(`/kill-switches/${encodeURIComponent(key)}`, { method: "PUT", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ enabled: enabled ? "enabled" : "disabled", ...context }, reason)) }).then(() => undefined),
  emergencyDisableJ1: (keys, reason, operator, context, commandKey) => apiRequest("/kill-switches/emergency-disable", { method: "POST", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ keys, ...context }, reason, operator)) }).then(() => undefined),
  updateJ1Sla: (paramKey, value, expectedValue, reason, commandKey) => apiRequest(`/kill-switches/emergency-sla/${encodeURIComponent(paramKey)}`, { method: "PATCH", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ value, expectedValue }, reason)) }).then(() => undefined),
  updateJ1AutoRule: (ruleId, value, expectedValue, reason, commandKey) => apiRequest(`/kill-switches/auto-rules/${encodeURIComponent(ruleId)}`, { method: "PATCH", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ value, expectedValue }, reason)) }).then(() => undefined),
  confirmJ1AutoTrigger: (key, incidentId, decision, reason, commandKey) => apiRequest(`/kill-switches/auto-confirmations/${encodeURIComponent(key)}`, { method: "POST", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ incidentId, decision }, reason)) }).then(() => undefined),
  updateJ2Country: (countryCode, status, expectedStatus, triggerBasis, reason, commandKey) => apiRequest(`/geo-block/countries/${encodeURIComponent(countryCode)}`, { method: "PUT", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ status, expectedStatus, triggerBasis }, reason)) }).then(() => undefined),
  replaceJ2CountryList: (status, countries, expectedCountries, triggerBasis, reason, commandKey, context) => apiRequest(`/geo-block/country-lists/${encodeURIComponent(status)}`, { method: "PUT", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ status, countries, expectedCountries, triggerBasis }, reason)) }, context).then(() => undefined),
  updateJ2Endpoint: (endpointKey, mode, countries, expectedMode, expectedCountries, reason, commandKey, context) => apiRequest(`/geo-block/endpoints/${encodeURIComponent(endpointKey)}`, { method: "PUT", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ mode, countries, expectedMode, expectedCountries }, reason)) }, context).then(() => undefined),
  updateJ2EdgeJudge: (source, expectedSource, reason, commandKey, context) => apiRequest("/geo-block/edge-judge", { method: "PUT", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ source, expectedSource }, reason)) }, context).then(() => undefined),
  emergencyBlockJ2: (countries, triggerBasis, reason, commandKey, context) => apiRequest("/geo-block/emergency-blocks", { method: "POST", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ countries, triggerBasis }, reason)) }, context).then(() => undefined),
  loadJ3TamperPage: fetchJTamperOverview,
  updateJ3AlertConfig: (threshold, feedK4, expectedThreshold, expectedFeedK4, reason, commandKey, context) => apiRequest("/tamper/alert-config", { method: "PUT", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ threshold, feedK4, expectedThreshold, expectedFeedK4 }, reason)) }, undefined, context).then(() => undefined),
  createJ3Report: (window, reason, commandKey) => apiRequest("/tamper/reports", { method: "POST", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ window }, reason)) }).then((raw) => normalizeTamperReport(raw, window)),
  createJ4Playbook: (body, reason, commandKey, context) => apiRequest("/sop/playbooks", { method: "POST", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason(body, reason)) }, undefined, undefined, context).then(() => undefined),
  updateJ4Playbook: (code, body, reason, commandKey, context) => apiRequest(`/sop/playbooks/${encodeURIComponent(code)}`, { method: "PUT", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason(body, reason)) }, undefined, undefined, context).then(() => undefined),
  drillJ4Playbook: (code, reason, commandKey, context) => apiRequest(`/sop/playbooks/${encodeURIComponent(code)}/drills`, { method: "POST", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({}, reason)) }, undefined, undefined, context).then(() => undefined),
  executeJ4Playbook: (code, emergency, reason, confirmation, commandKey) => apiRequest(`/sop/playbooks/${encodeURIComponent(code)}/executions`, { method: "POST", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ emergency, ...confirmation }, reason)) }).then(() => undefined),
  cancelJ4Playbook: (code, executionId, reason, commandKey, context) => apiRequest(`/sop/playbooks/${encodeURIComponent(code)}/executions/${encodeURIComponent(executionId)}/cancel`, { method: "POST", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ emergency: false }, reason)) }, undefined, undefined, context).then(() => undefined),
  resumeJ4Playbook: (code, executionId, reason, commandKey, context) => apiRequest(`/sop/playbooks/${encodeURIComponent(code)}/executions/${encodeURIComponent(executionId)}/resume`, { method: "POST", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ emergency: false }, reason)) }, undefined, undefined, context).then(() => undefined),
  rollbackJ4Playbook: (code, executionId, reason, commandKey, context) => apiRequest(`/sop/playbooks/${encodeURIComponent(code)}/executions/${encodeURIComponent(executionId)}/rollback`, { method: "POST", headers: commandKey ? { "Idempotency-Key": commandKey } : undefined, body: JSON.stringify(withReason({ emergency: false }, reason)) }, undefined, undefined, context).then(() => undefined),
};
