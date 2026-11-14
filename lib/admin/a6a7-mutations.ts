"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchA2ProposalByKey, type A2OperationRow } from "./a2-client";
import { newA6IdempotencyKey, type A6GrantsPayload, type A6RoleCreateInput, type A6RoleDetail, type A6RoleUpdateInput } from "./a6-client";
import { newA7IdempotencyKey, type A7MenuCreateInput, type A7MenuTreeNode, type A7MenuUpdateInput } from "./a7-client";
import type { A8Permission } from "./a8-client";
import { isAdminAuthFailure, resetAdminSession } from "./auth-session";
import { guardedFetch } from "./error-messages";
import { isExplicitRejection } from "./explicit-rejection";
import { isDeterministicRejection, isIdempotencyOutcomeOpen, OutcomeUnknownError } from "./outcome-classification";
import { createPendingMutationStore, isRetryExpired, type PendingMutationRecord } from "./pending-mutation-store";
import { normalizeA6Detail, normalizeA8Permission } from "./rbac-contracts";
import { useAdminAuth } from "../store/admin-auth";

export type A6Original =
  | { kind: "a6-create"; input: A6RoleCreateInput }
  | { kind: "a6-update"; role: A6RoleDetail; input: A6RoleUpdateInput }
  | { kind: "a6-status"; role: A6RoleDetail; status: 0 | 1; bound?: number }
  | { kind: "a6-delete"; role: A6RoleDetail; bound?: number }
  | { kind: "a6-grants"; role: A6RoleDetail; input: A6GrantsPayload; bound?: number; menus: A7MenuTreeNode[]; permissions: A8Permission[] };
export type A7Original =
  | { kind: "a7-create"; input: A7MenuCreateInput; parent?: A7MenuTreeNode }
  | { kind: "a7-update"; node: A7MenuTreeNode; input: A7MenuUpdateInput; parent?: A7MenuTreeNode }
  | { kind: "a7-delete"; node: A7MenuTreeNode; parent?: A7MenuTreeNode };
type Original = A6Original | A7Original;
export type RbacTicket = Pick<A2OperationRow, "id" | "action" | "obj" | "mine" | "operationCode" | "status">;
export type RbacCommand = PendingMutationRecord & {
  actorId: number; original: Original; body: string; reason: string; operator: string; name: string; change: string;
  ticket?: RbacTicket; proposalNotFound?: boolean;
};

export const rbacProposal = (original: Original) => ["a6-status", "a6-delete", "a6-grants"].includes(original.kind);
export const rbacObject = (original: Original) => original.kind === "a6-create" ? `a6-code:${original.input.roleCode.trim().toUpperCase()}`
  : original.kind === "a7-create" ? `a7-code:${original.input.menuCode.trim().toUpperCase()}`
    : "role" in original ? `a6:${original.role.id}` : `a7:${original.node.id}`;
export const rbacAuthority = (original: Original) => original.kind === "a6-grants" ? "platform_a6_role_grants_update"
  : original.kind.startsWith("a6-") ? "platform_a6_write" : "platform_a7_write";

export function a6GrantsProblem(roleCode: string, input: A6GrantsPayload, menus: readonly A7MenuTreeNode[], permissions: readonly A8Permission[]) {
  if (roleCode === "SUPER_ADMIN") return "SUPER_ADMIN_ROLE_IMMUTABLE";
  const byId = new Map(menus.map(node => [node.id, node]));
  const byCode = new Map(permissions.map(permission => [permission.permissionCode, permission]));
  if (input.menuIds.some(id => byId.get(id)?.status !== 1) || input.permissionCodes.some(code => !byCode.has(code))) return "ROLE_GRANTS_UNKNOWN_PERMISSION_OR_MENU";
  // A6-PD02 explicitly disallows WRITE and HIGH; do not infer an export exception from its name.
  if (roleCode === "AUDITOR" && input.permissionCodes.some(code => byCode.get(code)!.permType !== "READ")) return "AUDITOR_READ_ONLY";
}

function wire(original: Original, reason: string, operator: string) {
  switch (original.kind) {
    case "a6-create": return { path: "/roles", method: "POST", body: JSON.stringify({ ...original.input, reason, operator }) };
    case "a6-update": return { path: `/roles/${original.role.id}`, method: "PATCH", body: JSON.stringify({ ...original.input, reason, operator }) };
    case "a6-status": return { path: `/roles/${original.role.id}`, method: "PATCH", body: JSON.stringify({ status: original.status, reason, operator }) };
    case "a6-delete": return { path: `/roles/${original.role.id}`, method: "DELETE", body: JSON.stringify({ reason, operator }) };
    case "a6-grants": return { path: `/roles/${original.role.id}/grants`, method: "PUT", body: JSON.stringify({ ...original.input, reason, operator }) };
    case "a7-create": return { path: "/menus", method: "POST", body: JSON.stringify({ ...original.input, reason, operator }) };
    case "a7-update": return { path: `/menus/${original.node.id}`, method: "PATCH", body: JSON.stringify({ ...original.input, reason, operator }) };
    case "a7-delete": return { path: `/menus/${original.node.id}`, method: "DELETE", body: JSON.stringify({ reason, operator, expectedVersion: original.node.version }) };
  }
}

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const id = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const status = (value: unknown) => value === 0 || value === 1;
const optionalText = (value: unknown) => value === undefined || text(value);
function menu(value: unknown): value is A7MenuTreeNode {
  return object(value) && id(value.id) && text(value.menuCode) && !!value.menuCode && text(value.menuName) && !!value.menuName
    && text(value.menuNameZh) && (value.parentId === null || id(value.parentId)) && text(value.routePath) && text(value.icon)
    && Number.isSafeInteger(value.sortOrder) && Number(value.sortOrder) >= 0 && status(value.status) && text(value.version) && !!value.version
    && Array.isArray(value.children) && value.children.every(menu);
}
function validOriginal(value: unknown): value is Original {
  if (!object(value) || !text(value.kind)) return false;
  if (value.kind.startsWith("a6-")) {
    if (value.kind !== "a6-create") normalizeA6Detail(value.role);
    if (value.bound !== undefined && (!Number.isSafeInteger(value.bound) || Number(value.bound) < 0)) return false;
    switch (value.kind) {
      case "a6-create": return object(value.input) && text(value.input.roleCode) && !!value.input.roleCode && text(value.input.roleName)
        && optionalText(value.input.remark) && (value.input.status === undefined || status(value.input.status));
      case "a6-update": return object(value.input) && optionalText(value.input.roleName) && optionalText(value.input.remark);
      case "a6-status": return status(value.status);
      case "a6-delete": return true;
      case "a6-grants": {
        if (!object(value.input) || !Array.isArray(value.input.permissionCodes) || !value.input.permissionCodes.every(text)
          || !Array.isArray(value.input.menuIds) || !value.input.menuIds.every(id) || !Array.isArray(value.menus) || !value.menus.every(menu)
          || !Array.isArray(value.permissions)) return false;
        value.permissions.forEach(normalizeA8Permission);
        return true;
      }
      default: return false;
    }
  }
  if (value.parent !== undefined && !menu(value.parent)) return false;
  if (value.kind !== "a7-create" && !menu(value.node)) return false;
  if (value.kind === "a7-delete") return true;
  if (!object(value.input)) return false;
  const input = value.input;
  return ["menuName", "menuNameZh", "routePath", "icon"].every(key => optionalText(input[key]))
    && (input.sortOrder === undefined || Number.isSafeInteger(input.sortOrder) && Number(input.sortOrder) >= 0)
    && (value.kind === "a7-create" ? text(input.menuCode) && !!input.menuCode && text(input.menuName) && optionalText(input.parentCode)
      : value.kind === "a7-update" && status(input.status) && text(input.expectedVersion) && !!input.expectedVersion);
}
function validRecord(record: RbacCommand) {
  try {
    return id(record.actorId) && validOriginal(record.original) && text(record.reason) && text(record.operator) && text(record.name) && text(record.change)
      && record.fingerprint === `${record.actorId}:${rbacObject(record.original)}` && record.body === wire(record.original, record.reason, record.operator).body
      && (record.ticket === undefined || (checkTicket(record.original, record.ticket), true))
      && (record.proposalNotFound === undefined || typeof record.proposalNotFound === "boolean");
  } catch { return false; }
}

// One instance per page, shared by capture, query, retry and the submitted-approval readback.
const a6Commands = createPendingMutationStore<RbacCommand>({ storageKey: "nexion-admin-a6-pending-commands-v1", retainExpiredRecords: true, isValidRecord: validRecord });
const a7Commands = createPendingMutationStore<RbacCommand>({ storageKey: "nexion-admin-a7-pending-commands-v1", retainExpiredRecords: true, isValidRecord: validRecord });

function checkTicket(original: Original, value: unknown): asserts value is RbacTicket {
  if (!rbacProposal(original) || !("role" in original) || !object(value)) throw new Error("A6_PROPOSAL_RECEIPT_MISMATCH");
  const op = original.kind === "a6-status" ? "a6_role_status_update" : original.kind === "a6-delete" ? "a6_role_delete" : "a6_role_grants_update";
  const action = original.kind === "a6-status" ? original.status === 1 ? "A6_ROLE_ENABLED" : "A6_ROLE_DISABLED"
    : original.kind === "a6-delete" ? "A6_ROLE_DELETED" : "A6_ROLE_GRANTS_CHANGED";
  // 111e00cd ticketMetadata now returns the persisted op for A6 command tickets too.
  if (!text(value.id) || !value.id || value.mine !== true || value.obj !== original.role.roleCode || value.action !== action || value.operationCode !== op
    || !["pending", "approved", "rejected", "withdrawn", "expired"].includes(String(value.status))) throw new Error("A6_PROPOSAL_RECEIPT_MISMATCH");
}

export function useRbacCommands(domain: "a6" | "a7", actorId: number | undefined) {
  const commands = domain === "a6" ? a6Commands : a7Commands;
  const [records, setRecords] = useState<RbacCommand[]>([]);
  const list = useCallback(() => commands.list().filter(record => record.actorId === actorId && record.original.kind.startsWith(`${domain}-`)), [commands, actorId, domain]);
  const sync = useCallback(() => setRecords(list()), [list]);
  useEffect(sync, [sync]);
  useEffect(() => {
    const next = records.filter(record => !isRetryExpired(record)).reduce((at, record) => Math.min(at, record.expiresAt), Infinity);
    if (!Number.isFinite(next)) return;
    const timer = window.setTimeout(sync, Math.max(1, next - Date.now()));
    return () => window.clearTimeout(timer);
  }, [records, sync]);
  const saved = (key: string) => list().find(record => record.commandKey === key);
  const blocked = (original: Original) => list().find(record => rbacObject(record.original) === rbacObject(original)
    && (!record.ticket || record.ticket.status === "pending" && rbacProposal(original)));
  const capture = (original: Original, reason: string, operator: string, name: string, change: string) => {
    if (!actorId || !original.kind.startsWith(`${domain}-`)) throw new Error("RBAC_SESSION_CHANGED");
    if (blocked(original)) throw new Error("RBAC_ORIGINAL_UNRESOLVED");
    const prefix = original.kind.replace("a6-", "a6-role-").replace("a7-", "a7-menu-");
    const key = domain === "a6" ? newA6IdempotencyKey(prefix) : newA7IdempotencyKey(prefix);
    const fingerprint = `${actorId}:${rbacObject(original)}`;
    // Detach the complete submitted input from mutable form state before sending anything.
    commands.remember(fingerprint, key, JSON.parse(JSON.stringify({ actorId, original, reason, operator, name, change, body: wire(original, reason, operator).body })));
    if (!commands.isDurablyStored(fingerprint, key)) {
      commands.forget(fingerprint, key); sync();
      throw new Error("RBAC_ORIGINAL_STORAGE_FAILED");
    }
    sync();
    return saved(key)!;
  };
  const forget = (record: RbacCommand) => { commands.forget(record.fingerprint, record.commandKey); sync(); };
  const requireOriginalActor = (record: RbacCommand, writing = false) => {
    const auth = useAdminAuth.getState(), session = auth.session;
    if (!auth.isAuthenticated || auth.logoutPending || auth.logoutUnknown || !session || session.passwordChangeRequired || session.adminId !== record.actorId) throw new Error("RBAC_SESSION_CHANGED");
    if (writing && !session.authorities.includes(rbacAuthority(record.original))) throw new Error("RBAC_OPERATION_FORBIDDEN");
  };
  const queryProposal = async (record: RbacCommand) => {
    requireOriginalActor(record);
    const ticket = await fetchA2ProposalByKey(record.commandKey, true, true);
    requireOriginalActor(record);
    if (ticket) checkTicket(record.original, ticket);
    // The caller checks the current authenticated actor again after this await.
    return ticket;
  };
  const observe = (record: RbacCommand, ticket: RbacTicket | null) => {
    if (!saved(record.commandKey)) throw new Error("RBAC_ORIGINAL_REOPEN_REQUIRED");
    commands.remember(record.fingerprint, record.commandKey, { ...record, ticket: ticket ?? undefined, proposalNotFound: !ticket });
    sync();
  };
  const clearPendingObservation = (record: RbacCommand) => {
    if (record.ticket?.status !== "pending") return;
    commands.remember(record.fingerprint, record.commandKey, { ...record, ticket: undefined, proposalNotFound: false });
    sync();
  };
  const releaseExpiredProposal = async (record: RbacCommand, confirmed: boolean) => {
    const current = saved(record.commandKey);
    // A status PATCH can also succeed directly when the target status already matches.
    // A missing A2 ticket cannot settle that union response; only always-proposal endpoints qualify.
    if (!confirmed || !current || !["a6-delete", "a6-grants"].includes(current.original.kind) || !isRetryExpired(current) || !current.proposalNotFound) throw new Error("RBAC_ORIGINAL_QUERY_ONLY");
    if (await queryProposal(current)) throw new Error("RBAC_ORIGINAL_QUERY_ONLY");
    forget(current);
  };
  const send = async (record: RbacCommand, retry: boolean) => {
    requireOriginalActor(record, true);
    if (isRetryExpired(record) || record.ticket) throw new Error("RBAC_ORIGINAL_QUERY_ONLY");
    if (!saved(record.commandKey) || !commands.isDurablyStored(record.fingerprint, record.commandKey)) throw new Error("RBAC_ORIGINAL_STORAGE_FAILED");
    const request = wire(record.original, record.reason, record.operator);
    try {
      const response = await guardedFetch(`/api/admin/platform${request.path}`, { method: request.method, body: record.body, cache: "no-store",
        signal: AbortSignal.timeout(12_000), headers: { "Content-Type": "application/json", "Idempotency-Key": record.commandKey } });
      const data: unknown = await response.json().catch(() => null);
      const result = object(data) ? data : null;
      if (response.headers.get("X-Nexion-Upstream-Outcome")?.trim().toLowerCase() === "unknown") throw new OutcomeUnknownError("RBAC_MUTATION_OUTCOME_UNKNOWN");
      if (!response.ok || result?.code !== 0) {
        const reasonCode = typeof result?.message === "string" ? result.message : undefined;
        if (isAdminAuthFailure(response.status, reasonCode)) resetAdminSession();
        // Keep the structured reason until the page display boundary; a first refusal stays in its confirmation.
        throw Object.assign(new Error(reasonCode ?? `RBAC_REQUEST_FAILED_${response.status}`), {
          status: response.status, reasonCode, apiCode: typeof result?.code === "number" ? result.code : undefined,
        });
      }
      const original = record.original;
      if (rbacProposal(original) && object(result.data) && typeof result.data.id === "string") {
        checkTicket(original, result.data);
        return { kind: "proposal" as const, ticket: result.data };
      }
      let roleId: number | undefined;
      if (original.kind.startsWith("a6-")) {
        // A status PATCH already at the target status legitimately returns detail, not a proposal.
        if (original.kind === "a6-delete" || original.kind === "a6-grants") throw new Error("A6_PROPOSAL_RECEIPT_MISMATCH");
        const role = normalizeA6Detail(result.data);
        if (original.kind === "a6-create" ? role.roleCode !== original.input.roleCode.trim().toUpperCase()
          : !("role" in original) || role.id !== original.role.id || original.kind === "a6-status" && role.status !== original.status) throw new Error("A6_DETAIL_CONTRACT_INVALID");
        roleId = role.id;
      } else if (original.kind === "a7-delete") {
        if (result.data !== null) throw new Error("A7_MUTATION_RESPONSE_INVALID");
      } else if (original.kind === "a7-create" || original.kind === "a7-update") {
        // Menu writes return one flat node, never an overview. Null optional text is legal.
        const node = object(result.data) ? { ...result.data, menuNameZh: result.data.menuNameZh ?? "", routePath: result.data.routePath ?? "", icon: result.data.icon ?? "", children: [] } : null;
        if (!menu(node) || (original.kind === "a7-create" ? node.menuCode !== original.input.menuCode : node.id !== original.node.id)) throw new Error("A7_MUTATION_RESPONSE_INVALID");
      } else throw new Error("RBAC_ORIGINAL_REOPEN_REQUIRED");
      forget(record);
      return { kind: "direct" as const, roleId };
    } catch (error) {
      const failure = error as { status?: number; apiCode?: number; reasonCode?: string };
      // Reason policy is checked before idempotency replay. A changed minimum cannot settle the original result.
      const reasonRecheck = retry && /^REASON_TOO_SHORT_MIN_[1-9][0-9]*$/.test(failure.reasonCode ?? "");
      const rejected = retry ? !reasonRecheck && isExplicitRejection(error)
        : !isIdempotencyOutcomeOpen(failure.reasonCode) && isDeterministicRejection(failure.status ?? 0, failure.apiCode);
      if (rejected) { forget(record); throw error; }
      sync();
      throw error instanceof OutcomeUnknownError ? error : new OutcomeUnknownError("RBAC_MUTATION_OUTCOME_UNKNOWN", { cause: error });
    }
  };
  return { records, sync, saved, blocked, capture, send, queryProposal, observe, clearPendingObservation, releaseExpiredProposal };
}
