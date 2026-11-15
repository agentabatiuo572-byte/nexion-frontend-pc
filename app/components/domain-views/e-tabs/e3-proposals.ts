"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminAuth } from "@/lib/store/admin-auth";
import { roleLabel } from "@/lib/nav/console-nav";
import { createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey } from "@/lib/admin/a2-client";
import { createPendingMutationStore, isRetryExpired, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { eDomainLegacyCommands } from "@/lib/admin/e-domain-commands";
import { isExplicitRejection } from "@/lib/admin/explicit-rejection";
import { findHighOp } from "@/lib/admin/high-ops-registry";
import { displayAdminReadError } from "@/lib/admin/error-messages";
import type { ProposeSpec } from "@/lib/admin/propose-or-execute";

type Input = Parameters<typeof createA2OperationProposal>[0];
export type E3Proposal = PendingMutationRecord & {
  owner: string;
  label: string;
  keys: string[];
  before: Record<string, string>;
  after: Record<string, string>;
  input: Input;
  state: "unknown" | "submitted" | "pending" | "rejected";
  ticketId?: string;
};

/** One durable envelope for an entire proposal, including unchanged members of a batch. */
const commands = createPendingMutationStore<E3Proposal>({
  storageKey: "nexion-admin-e3-proposals-v1",
  retainExpiredRecords: true,
  isValidRecord: r => {
    const i = r.input;
    if (typeof r.owner !== "string" || !r.owner || typeof r.label !== "string" || !Array.isArray(r.keys) || !r.keys.length
      || !r.keys.every(k => typeof k === "string") || !r.before || !r.after
      || !r.keys.every(k => typeof r.before[k] === "string" && typeof r.after[k] === "string")
      || !["unknown", "submitted", "pending", "rejected"].includes(r.state) || !i || i.sourceDomain !== "E3"
      || i.type !== "param" || i.sos !== false || typeof i.amplifies !== "boolean"
      || typeof i.operator !== "string" || typeof i.operatorRole !== "string" || typeof i.roleGate !== "string"
      || typeof i.action !== "string" || typeof i.beforeValue !== "string" || typeof i.afterValue !== "string"
      || typeof i.reason !== "string" || !i.reason.trim() || i.command?.domain !== "E") return false;
    const p = i.command.params;
    if (!p || typeof p !== "object" || Array.isArray(p)) return false;
    const values = i.command.op === "e3_config" ? { [String(p.key)]: p.value } : i.command.op === "e3_config_batch" ? p.values : null;
    const def = findHighOp(i.command.op);
    if (!def) return false;
    const targets = i.command.op === "e3_config" ? def.buildTarget(i.command.params) : def.buildTargets?.(i.command.params);
    return JSON.stringify(i.target ?? i.targets) === JSON.stringify(targets) && !!values && typeof values === "object" && !Array.isArray(values)
      && JSON.stringify(Object.keys(values).sort()) === JSON.stringify([...r.keys].sort())
      && Object.values(values).every(v => typeof v === "string")
      && i.obj === [...r.keys].sort().join(",") && r.fingerprint === `${i.command.op}|${i.obj}`
      && (i.command.op === "e3_config" ? !!i.target && !i.targets : !!i.targets && i.targets.length === r.keys.length && !i.target);
  },
});

export function useE3Proposals() {
  const session = useAdminAuth(s => s.session);
  const owner = String(session?.adminId ?? "");
  const rights = session?.authorities ?? [];
  const [records, setRecords] = useState<E3Proposal[]>([]);
  const [legacy, setLegacy] = useState<ReturnType<typeof eDomainLegacyCommands.list>>([]);
  const [busy, setBusy] = useState("");
  const [queryErrors, setQueryErrors] = useState<string[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const sending = useRef(false);
  const canQuery = rights.some(r => ["platform_a2_read", "platform_a2_proposal_create"].includes(r));
  const allowed = (batch: boolean) => rights.includes("device_e3_write")
    && rights.some(r => ["platform_a2_write", "platform_a2_proposal_create"].includes(r))
    && (!batch || rights.includes("platform_a2_write"));
  const sync = useCallback(() => {
    setRecords(commands.list().filter(r => r.owner === owner));
    setLegacy(eDomainLegacyCommands.list().filter(r => /^e3_config(?:_batch)?\|/.test(r.fingerprint)));
  }, [owner]);
  useEffect(sync, [sync]);
  const locked = (keys: readonly string[]) => commands.list().some(r => r.owner === owner && r.state !== "rejected" && r.keys.some(k => keys.includes(k)))
    || eDomainLegacyCommands.list().some(r => /^e3_config(?:_batch)?\|/.test(r.fingerprint) && r.fingerprint.split("|")[1].split(",").some(k => keys.includes(k)));

  async function lookup(record: E3Proposal) {
    if (!canQuery) throw new Error("A2_PROPOSAL_READ_FORBIDDEN");
    const ticket = await fetchA2ProposalByKey(record.commandKey, true);
    if (!ticket) {
      if (isRetryExpired(record)) setMissing(keys => [...new Set([...keys, record.commandKey])]);
      return false;
    }
    setMissing(keys => keys.filter(key => key !== record.commandKey));
    // E3 has no operationCode/version metadata. A09's object is normalized to 255 characters by A2.
    if (!ticket.mine || ticket.obj !== record.input.obj.slice(0, 255)) throw new Error("A2_BUSINESS_CONTEXT_MISMATCH");
    if (ticket.status === "pending" || ticket.status === "rejected") {
      commands.remember(record.fingerprint, record.commandKey, { ...record, state: ticket.status, ticketId: ticket.id });
    } else if (["approved", "withdrawn", "expired"].includes(ticket.status)) {
      commands.forget(record.fingerprint, record.commandKey);
    } else throw new Error("OPERATION_RESULT_UNKNOWN");
    sync();
    return true;
  }
  async function reconcile() {
    sync();
    if (!canQuery) return [];
    // A failed query cannot revoke an earlier authoritative observation or release an unknown request.
    const results = await Promise.allSettled(commands.list().filter(r => r.owner === owner && r.state !== "rejected").map(lookup));
    const errors = results.flatMap(result => result.status === "rejected" ? [displayAdminReadError(result.reason)] : []);
    setQueryErrors(errors); sync();
    return errors;
  }
  async function send(record: E3Proposal, retry = true) {
    if (sending.current || !allowed(record.input.command.op === "e3_config_batch")) throw new Error("FORBIDDEN");
    if (record.owner !== owner || isRetryExpired(record)) throw new Error(RETRY_EXPIRED_TEXT);
    if (!commands.isDurablyStored(record.fingerprint, record.commandKey)) throw new Error("E3_PROPOSAL_STORAGE_UNAVAILABLE");
    sending.current = true; setBusy(record.commandKey);
    try {
      const ticket = await createA2OperationProposal(record.input, record.commandKey, true);
      // E3 replays the creation receipt. Only a current-ticket GET can establish pending after retry.
      commands.remember(record.fingerprint, record.commandKey, { ...record, state: retry ? "submitted" : "pending", ticketId: ticket.id });
    } catch (error) {
      // A2 performs object-lock checks inside command deduplication. A lock refusal is a verdict on this command.
      if (isExplicitRejection(error)) commands.forget(record.fingerprint, record.commandKey);
      throw error;
    } finally { sending.current = false; setBusy(""); sync(); }
  }
  async function submit(spec: ProposeSpec, before: Record<string, string>) {
    const keys = spec.command.op === "e3_config" ? [String(spec.command.params.key)] : Object.keys(spec.command.params.values as Record<string, string>);
    if (locked(keys)) throw new Error("E3_ORIGINAL_PROPOSAL_UNRESOLVED");
    const values = spec.command.op === "e3_config" ? { [keys[0]]: String(spec.command.params.value) } : spec.command.params.values as Record<string, string>;
    const after = Object.fromEntries(keys.map(k => [k, k.startsWith("E.device.capacity.applyTo.") ? values[k] === "true" ? "参与递减" : "免递减"
      : ["E.tradein.enabled", "E.tradein.requireHigherPrice"].includes(k) ? values[k] === "true" ? "开" : "关" : values[k]]));
    const input: Input = { action: spec.action, obj: spec.obj, beforeValue: spec.before, afterValue: spec.after,
      operator: session!.operator || session!.username, operatorRole: roleLabel(session!.role), type: spec.type,
      amplifies: !!spec.amplifies, sos: !!spec.sos, roleGate: spec.gateLabel, reason: spec.reason, sourceDomain: spec.sourceDomain,
      command: spec.command, target: spec.target, targets: spec.targets };
    const key = createA2CommandKey("e-domain-action"), fingerprint = `${spec.command.op}|${spec.obj}`;
    commands.list().filter(r => r.owner === owner && r.state === "rejected" && r.keys.some(k => keys.includes(k))).forEach(r => commands.forget(r.fingerprint, r.commandKey));
    commands.remember(fingerprint, key, { owner, label: spec.action, keys, before, after, input: JSON.parse(JSON.stringify(input)), state: "unknown" });
    if (!commands.isDurablyStored(fingerprint, key)) {
      commands.forget(fingerprint, key); sync(); throw new Error("E3_PROPOSAL_STORAGE_UNAVAILABLE");
    }
    const record = commands.list().find(r => r.commandKey === key)!;
    sync(); await send(record, false);
  }
  /** Visual handoff: only an explicit operator action may release expired, authoritatively absent proposals. */
  async function releaseMissing(record: E3Proposal) {
    const current = commands.list().find(r => r.commandKey === record.commandKey && r.owner === owner);
    if (!current || !isRetryExpired(current) || !canQuery) return false;
    if (await lookup(current)) return false;
    commands.forget(current.fingerprint, current.commandKey);
    setMissing(keys => keys.filter(key => key !== current.commandKey));
    sync(); return true;
  }
  async function lookupLegacy(record: typeof legacy[number]) {
    const ticket = await fetchA2ProposalByKey(record.commandKey, true);
    if (!ticket || !ticket.mine || ticket.obj !== record.fingerprint.split("|")[1].slice(0, 255)) return false;
    // The old record cannot supply the original values. Keep it until a terminal result is authoritative.
    if (["approved", "rejected", "withdrawn", "expired"].includes(ticket.status)) eDomainLegacyCommands.forget(record.fingerprint, record.commandKey);
    sync(); return true;
  }
  return { records, legacy, busy, canQuery, queryErrors, missing, releaseMissing, allowed, locked, sync, reconcile, lookup, lookupLegacy, submit, send,
    pendingReason: (keys: string[]) => commands.list().find(r => r.owner === owner && r.state === "unknown" && r.keys.some(k => keys.includes(k)))?.input.reason };
}
