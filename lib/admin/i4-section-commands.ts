import { useAdminAuth } from "@/lib/store/admin-auth";
import { roleLabel } from "@/lib/nav/console-nav";
import { createA2CommandKey, fetchA2ProposalByKey, type createA2OperationProposal, type A2OperationRow } from "./a2-client";
import { formatAdminApiError, guardedFetch } from "./error-messages";
import { explicitRejectionCode, isExplicitRejection } from "./explicit-rejection";
import { isDeterministicRejection, isIdempotencyOutcomeOpen, OutcomeUnknownError } from "./outcome-classification";
import { createPendingMutationStore, createPendingRecovery, hasPersistedPendingCommandOwner, isRetryExpired, RETRY_EXPIRED_TEXT, type SlotAttemptRecord } from "./pending-mutation-store";
import type { ProposeSpec } from "./propose-or-execute";
import type { TrustDisclosureOverview, TrustSectionVersionView, TrustSectionView } from "./i-client";
import { parseI4SectionVersion } from "./i4-trust-contract";

type Proposal = Parameters<typeof createA2OperationProposal>[0];
export type I4ProposalSnapshot = { section: TrustSectionView; current?: TrustSectionVersionView; target?: TrustSectionVersionView; otherIssues?: string[] };
type Stored = SlotAttemptRecord & { owner?: number; request?: Proposal; snapshot?: I4ProposalSnapshot; receiptKnown?: boolean; ticketStatus?: A2OperationRow["status"] };
export type I4SectionCommand = Stored & { sectionKey: string; action: "publish" | "rollback" | "archive"; before: string; after: string; reason: string };

// Replaces the old I4 slot instance, preserving its legacy evidence and hard first-attempt expiry.
const pending = createPendingMutationStore<Stored>({ storageKey: "nexion-admin-i4-trust-commands-v1", retainExpiredRecords: true });

export function i4SectionPermission(sectionKey: string, highSensitivity = false): string | undefined {
  const auth = useAdminAuth.getState();
  const session = auth.session;
  if (!auth.isAuthenticated || auth.logoutPending || !session) return "请先登录后再提交。";
  const sensitive = highSensitivity || ["financials", "nexnarrative", "nexstory", "compliancebadges", "auditsreserves"].includes(sectionKey.replace(/[^a-z0-9]/gi, "").toLowerCase());
  if (!session.authorities.includes(sensitive ? "content_i4_trust_section_manage" : "content_i4_publish_standard")) return "当前账号没有这个版块的发布权限，请查询原结果。";
  if (!session.authorities.some(permission => ["platform_a2_write", "platform_a2_proposal_create"].includes(permission))) return "缺少提交审批权限";
  return undefined;
}

export function pendingI4SectionCommands(): I4SectionCommand[] {
  const owner = useAdminAuth.getState().session?.adminId;
  if (owner === undefined) return [];
  return pending.list().flatMap(row => {
    if (row.owner !== undefined ? row.owner !== owner : !hasPersistedPendingCommandOwner(String(owner))) return [];
    const slot = /^trust\|([^:]+):(publish|rollback|archive)$/.exec(row.fingerprint);
    if (!slot) return [];
    const fallback: I4SectionCommand = { ...row, request: undefined, snapshot: undefined, sectionKey: slot[1], action: slot[2] as I4SectionCommand["action"], before: "", after: "", reason: "" };
    try {
      const input: unknown = JSON.parse(row.inputFingerprint);
      if (!Array.isArray(input) || input[0] !== slot[2] || input[1] !== slot[1] || ![input[2], input[3], input.at(-1)].every(value => typeof value === "string")) return [fallback];
      const [action, sectionKey, before] = input as string[];
      const after = action === "archive" ? "archived" : String(input[4]);
      const reason = String(input.at(-1));
      const value = row.request;
      const params = value?.command?.params;
      const expectedAction = { publish: "发布", rollback: "回滚", archive: "下架" }[action];
      let snapshot: I4ProposalSnapshot | undefined;
      if (row.snapshot) {
        const section = row.snapshot.section;
        if (!section || section.key !== sectionKey || !["desc", "struct", "version", "status", "lastChange", "roleGate"].every(key => typeof section[key as keyof TrustSectionView] === "string")
          || typeof section.highSensitivity !== "boolean" || section.version !== before || section.status !== input[3]) return [fallback];
        snapshot = { section, current: row.snapshot.current ? parseI4SectionVersion(row.snapshot.current) : undefined,
          target: row.snapshot.target ? parseI4SectionVersion(row.snapshot.target) : undefined, otherIssues: row.snapshot.otherIssues?.filter((item): item is string => typeof item === "string") };
      }
      const valid = value && value.action === `${expectedAction}信任版块 · ${sectionKey}` && value.obj === sectionKey
        && value.beforeValue === before && value.afterValue === after && value.reason === reason
        && value.sourceDomain === "I4" && value.command.domain === "I" && value.command.op === "i4_trust_section_manage"
        && params?.sectionKey === sectionKey && params.action === action && params.expectedVersion === before && params.expectedStatus === input[3]
        && (action === "publish" ? params.version === after && params.expectedRevision === input[5] && params.dataSourceStatement === input[6] && params.bilingualConfirmed === input[7]
          : params.version === null && params.expectedRevision === null && params.dataSourceStatement === "" && params.bilingualConfirmed === false)
        && params.targetVersion === (action === "rollback" ? after : null)
        && value.target?.domain === "I" && value.target.type === "trust_section" && value.target.id === sectionKey
        && value.type === "param" && value.amplifies === false && value.sos === false
        && [value.operator, value.operatorRole, value.roleGate].every(text => typeof text === "string");
      return [{ ...fallback, sectionKey, before, after, reason, request: valid ? value : undefined, snapshot: valid ? snapshot : undefined }];
    } catch { return [fallback]; }
  });
}

export const i4SectionRecovery = createPendingRecovery({ ...pending, list: pendingI4SectionCommands }, {
  capability: () => "receipt",
  hasApproval: record => !!record.receiptKnown || record.ticketStatus === "pending" || record.ticketStatus === "approved",
  canReplay: (record: I4SectionCommand) => {
    try { return !!record.request && !!record.snapshot && !record.receiptKnown && !i4SectionPermission(record.sectionKey, record.snapshot.section.highSensitivity); } catch { return false; }
  },
  explicitRejectionCode,
});

export async function queryI4SectionCommand(saved: I4SectionCommand): Promise<A2OperationRow | null> {
  const original = pendingI4SectionCommands().find(row => row.commandKey === saved.commandKey);
  if (!original) throw new Error("原操作已处理，请重新读取后再操作。");
  if (original.ticketStatus === "approved") throw new Error("审批单已批准，请重新读取当前版块。");
  const result = await i4SectionRecovery.query(original, async () => {
    const ticket = await fetchA2ProposalByKey(original.commandKey, true);
    if (!ticket) {
      if (original.receiptKnown || original.ticketStatus === "pending") throw new Error("申请已提交，当前审批结果还没查到，请保留原记录并查询原结果。");
      return { conclusion: "not-found", ticket } as const;
    }
    // 24972948 OpsAuditCenterService.createProposalOnce preserves I4's action/values;
    // ticketMetadata:1516 returns the persisted command op, and lookup sets mine=true.
    if (!ticket.mine || ticket.obj !== original.sectionKey || ticket.operationCode !== "i4_trust_section_manage"
      || ticket.action !== `${{ publish: "发布", rollback: "回滚", archive: "下架" }[original.action]}信任版块 · ${original.sectionKey}`
      || original.before && ticket.before !== original.before || original.after && ticket.after !== original.after
      || !["pending", "approved", "rejected", "withdrawn", "expired"].includes(ticket.rawStatus ?? "")) {
      throw new Error("返回的审批单与原操作不符，请保留原记录并查询原结果。");
    }
    return { conclusion: ticket.status === "pending" ? "unknown" : ticket.status === "approved" ? "succeeded" : "not-executed", ticket } as const;
  });
  if (!result) return null;
  if (result.ticket?.status === "pending" || result.ticket?.status === "approved") {
    pending.remember(original.fingerprint, original.commandKey, { ...original, receiptKnown: true, ticketStatus: result.ticket.status });
  }
  else if (result.ticket) i4SectionRecovery.settleFromQuery(original, result.conclusion);
  return result.ticket;
}

/** Only a current read of the original object can settle an already approved command. */
export function settleI4ApprovedSections(overview: TrustDisclosureOverview, commandKeys: readonly string[]) {
  const settled = pendingI4SectionCommands().filter(record => record.ticketStatus === "approved"
    && commandKeys.includes(record.commandKey) && overview.trustSections.some(section => section.key === record.sectionKey));
  for (const record of settled) i4SectionRecovery.settleAcknowledged(record);
  return settled.length > 0;
}

async function send(original: I4SectionCommand, retry: boolean) {
  if (!original.request) throw new Error("原操作记录不完整，只能查询核对，不能重试。");
  if (original.owner !== useAdminAuth.getState().session?.adminId) throw new Error("登录身份已变更，请重新打开页面。");
  if (isRetryExpired(original)) throw new Error(RETRY_EXPIRED_TEXT);
  const permission = i4SectionPermission(original.sectionKey, original.snapshot?.section.highSensitivity);
  if (permission) throw new Error(permission);
  if (!pending.isDurablyStored(original.fingerprint, original.commandKey)) throw new Error("浏览器无法保存原操作，尚未提交。请允许会话存储后再试。");
  let response: Response, envelope: { code: number; message?: string; data?: { id?: unknown } };
  try {
    response = await guardedFetch("/api/admin/platform/audit/operations", { method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", "Idempotency-Key": original.commandKey }, body: JSON.stringify(original.request) });
    envelope = await response.json();
  } catch { throw new OutcomeUnknownError("结果未知，请查询原结果或按原操作重试。"); }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || !Number.isInteger(envelope.code)
    || envelope.message !== undefined && typeof envelope.message !== "string") throw new OutcomeUnknownError("原申请的返回内容无法核实，请保留原记录并查询原结果。");
  const unknown = response.headers.get("X-Nexion-Upstream-Outcome") === "unknown" || isIdempotencyOutcomeOpen(envelope.message);
  if (!response.ok || envelope.code !== 0 || unknown) {
    const status = response.ok && envelope.code >= 400 && envelope.code < 500 ? envelope.code : response.status;
    const failure = Object.assign(new Error(formatAdminApiError(envelope.message, "A2_REQUEST_FAILED")), { status, backendMessage: envelope.message });
    const rejected = retry ? isExplicitRejection(failure)
      : isDeterministicRejection(response.status, envelope.code) && envelope.code < 500;
    if (rejected && !unknown) { if (!retry) pending.forget(original.fingerprint, original.commandKey); throw Object.assign(failure, { rejectedCommand: retry ? undefined : original }); }
    throw new OutcomeUnknownError(failure.message);
  }
  if (!envelope.data || typeof envelope.data.id !== "string" || !envelope.data.id) throw new OutcomeUnknownError("原申请的返回内容无法核实，请保留原记录并查询原结果。");
  pending.remember(original.fingerprint, original.commandKey, { ...original, receiptKnown: true });
}

async function readSubmittedI4Section(original: I4SectionCommand, observe?: (record: I4SectionCommand, ticket: A2OperationRow) => void): Promise<A2OperationRow> {

  try {
    const ticket = await queryI4SectionCommand(original);
    if (ticket) { observe?.(original, ticket); return ticket; }
  } catch (error) {
    throw Object.assign(new OutcomeUnknownError(`申请已提交，当前审批结果还没查到：${error instanceof Error ? error.message : "请查询原结果"}`), { commandKey: original.commandKey });
  }
  throw Object.assign(new OutcomeUnknownError("申请已提交，当前审批结果还没查到，请保留原记录并查询原结果。"), { commandKey: original.commandKey });
}

export async function retryI4SectionCommand(original: I4SectionCommand, observe?: (record: I4SectionCommand, ticket: A2OperationRow) => void) {
  await i4SectionRecovery.replay(original, record => send(record, true));
  return readSubmittedI4Section(original, observe);
}

export function releaseRejectedI4Section(original: I4SectionCommand) {
  if (pendingI4SectionCommands().some(row => row.commandKey === original.commandKey && row.ticketStatus === "approved"))
    throw new Error("审批单已批准，请重新读取当前版块。");
  if (!i4SectionRecovery.releaseRejectedReplay(original)) throw new Error("原操作记录继续保留，请查询原结果。");
}

export async function proposeI4Section(spec: ProposeSpec, inputFingerprint: string, snapshot: I4ProposalSnapshot, observe?: (record: I4SectionCommand, ticket: A2OperationRow) => void): Promise<A2OperationRow> {
  const permission = i4SectionPermission(spec.obj, snapshot.section.highSensitivity);
  if (permission) throw new Error(permission);
  if (pendingI4SectionCommands().some(row => row.sectionKey === spec.obj)) throw new Error("此对象有原操作尚未核清，请先查询原结果。");
  const session = useAdminAuth.getState().session!;
  const request: Proposal = { action: spec.action, obj: spec.obj, beforeValue: spec.before, afterValue: spec.after,
    operator: session.operator || session.username, operatorRole: roleLabel(session.role), type: spec.type, amplifies: !!spec.amplifies,
    sos: !!spec.sos, roleGate: spec.gateLabel, reason: spec.reason, sourceDomain: spec.sourceDomain, command: spec.command, target: spec.target };
  const fingerprint = `trust|${spec.obj}:${spec.command.params.action}`;
  const commandKey = createA2CommandKey("i4-trust-section");
  pending.remember(fingerprint, commandKey, { owner: session.adminId, request, snapshot, inputFingerprint });
  if (!pending.isDurablyStored(fingerprint, commandKey)) {
    pending.forget(fingerprint, commandKey);
    throw new Error("浏览器无法保存原操作，尚未提交。请允许会话存储后再试。");
  }
  const original = pendingI4SectionCommands().find(row => row.commandKey === commandKey)!;
  await send(original, false);
  return readSubmittedI4Section(original, observe);
}
