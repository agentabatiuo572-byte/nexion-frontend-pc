import { h4CommandStores } from "./h4-command-store";
import { createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, A2OutcomeUncertainError } from "./a2-client";
import { createPendingRecovery, isRetryExpired, RETRY_EXPIRED_TEXT, type PendingMutationRecord, type PendingMutationStore } from "./pending-mutation-store";
import { explicitRejectionCode, isExplicitRejection } from "./explicit-rejection";
import { growthRequest } from "./h-client";
import { findHighOp } from "./high-ops-registry";
import { useAdminAuth, type AdminSession } from "@/lib/store/admin-auth";
import { roleLabel } from "@/lib/nav/console-nav";
import { formatAdminApiError, guardedFetch } from "./error-messages";
import { isDeterministicRejection, isIdempotencyOutcomeOpen, OutcomeUnknownError } from "./outcome-classification";
import type { A2OperationRow } from "./a2-client";
import { fundCommandOrigin, type FundCommandOrigin } from "./fund-command-investigation";

import type { I6CommandSnapshot } from "./i-client";

export type HIProposal = Parameters<typeof createA2OperationProposal>[0];
type Payload = { kind: "proposal"; input: HIProposal } | { kind: "retire"; tierName: string; input: { reason: string; operator: string; confirmed: true; expectedSignature: string } };
export type HIRewardCommand = PendingMutationRecord & { owner: number; scope: string; body: string; payload: Payload; form?: Record<string, string>; editValue?: string; snapshot?: I6CommandSnapshot; receiptKnown?: boolean; ticketStatus?: A2OperationRow["status"]; commandOrigin?: FundCommandOrigin };
const commands = h4CommandStores.hi as PendingMutationStore<HIRewardCommand>;

export const HI_WHEEL_SCOPE = "H/h4_wheel_pool/ACTIVE_POOL";
export const hiEventScope = (id: string) => `H/h4_legacy_event/${id}`;
export const hiCourseScope = (id: string) => `I/learning_course_activation/${id}`;
export const hiCourseRewardScope = (id: string) => `I/learning_course/${id}`;
/** Includes expired records and objects no longer present in the current list, for the recovery entry. */
export function pendingHIRewardCommands() {
  const owner = useAdminAuth.getState().session?.adminId;
  return commands.list().filter(r => r.owner === owner);
}
export function pendingHIRewardCommand(scope: string) {
  return pendingHIRewardCommands().find(r => r.scope === scope);
}

export function hiRewardProposal(session: AdminSession, op: string, values: Record<string, unknown>, before: string, after: string, reason: string): HIProposal {
  const def = findHighOp(op)!;
  const target = def.buildTarget(values);
  return { action: def.action, obj: target.id, beforeValue: before, afterValue: after,
    operator: session.operator || session.username, operatorRole: roleLabel(session.role),
    type: def.type, amplifies: true, sos: false, roleGate: def.gateLabel, reason,
    sourceDomain: def.domain === "H" ? "H4" : "I", command: def.buildCommand(values), target };
}

const I6_COURSE_OPERATIONS = new Set(["i7_course_first_publish", "i7_course_version_publish", "i7_course_version_rollback", "i7_course_reward_adjust"]);

/** Query permission is deliberately separate from mutation permission. The backend permits the original maker lookup. */
export function i6CourseProposalPermission(record: HIRewardCommand): string | undefined {
  const auth = useAdminAuth.getState(), session = auth.session;
  if (!auth.isAuthenticated || auth.logoutPending || !session || record.owner !== session.adminId) return "登录已失效，请重新登录后核对原操作。";
  const op = record.payload.kind === "proposal" ? record.payload.input.command.op : "";
  const grants = session.authorities;
  if (!grants.includes("content_i7_course_reward_adjust") || (op === "i7_course_reward_adjust"
    ? !grants.some(grant => ["platform_a2_write", "platform_a2_proposal_create"].includes(grant))
    : !grants.includes("content_i7_write"))) return "当前账号没有原操作所需权限，请查询原结果。";
  return undefined;
}

function originalI6Proposal(saved: HIRewardCommand): HIRewardCommand & { payload: { kind: "proposal"; input: HIProposal } } {
  const row = pendingHIRewardCommands().find(record => record.commandKey === saved.commandKey);
  if (!row || row.payload.kind !== "proposal") throw new Error("原操作已处理，请重新读取后再操作。");
  const input = row.payload.input, params = input.command?.params, op = input.command?.op;
  const reward = op === "i7_course_reward_adjust";
  const fields = reward ? ["courseId", "rewardNex"] : ["courseId", "version", "expectedRevision", "expectedCurrentVersion", "expectedCurrentRevision", "expectedCurrentStatus"];
  if (input.command?.domain !== "I" || !I6_COURSE_OPERATIONS.has(op) || !params || input.obj !== params.courseId
    || row.scope !== (reward ? hiCourseRewardScope(input.obj) : hiCourseScope(input.obj)) || row.body !== JSON.stringify(input)
    || !["I", ...(reward ? ["I7"] : [])].includes(input.sourceDomain)
    || input.target?.domain !== "I" || input.target.id !== input.obj || input.target.type !== (reward ? "learning_course" : "learning_course_activation")
    || Object.keys(params).length !== fields.length || !fields.every(field => Object.hasOwn(params, field))
    || typeof params.courseId !== "string" || !params.courseId
    || reward && !((typeof params.rewardNex === "string" || typeof params.rewardNex === "number") && String(params.rewardNex).trim() && Number.isFinite(Number(params.rewardNex)))
    || !reward && (typeof params.version !== "string" || typeof params.expectedCurrentVersion !== "string" || typeof params.expectedCurrentStatus !== "string"
      || !Number.isSafeInteger(params.expectedCurrentRevision) || Number(params.expectedCurrentRevision) < 0
      || params.expectedRevision !== null && (!Number.isSafeInteger(params.expectedRevision) || Number(params.expectedRevision) < 0))) {
    throw new Error("原操作记录不完整，只能查询核对，不能重试。");
  }
  return row as HIRewardCommand & { payload: { kind: "proposal"; input: HIProposal } };
}

/** A POST receipt may be a historical pending response; only this authoritative lookup sets a pending marker. */
export const i6CourseRecovery = createPendingRecovery({ ...commands, list: pendingHIRewardCommands }, {
  capability: () => "receipt",
  canReplay: (record: HIRewardCommand) => {
    try { return !record.receiptKnown && !i6CourseProposalPermission(record) && !!originalI6Proposal(record); } catch { return false; }
  },
  explicitRejectionCode,
});

export async function queryI6CourseProposal(saved: HIRewardCommand): Promise<A2OperationRow | null> {
  const record = originalI6Proposal(saved), input = record.payload.input;
  const result = await i6CourseRecovery.query(record, async () => {
    const ticket = await fetchA2ProposalByKey(record.commandKey, true);
    if (!ticket) {
      if (record.receiptKnown || record.ticketStatus === "pending") throw new Error("申请已提交，当前审批结果还没查到，请保留原记录并查询原结果。");
      return { conclusion: "not-found", ticket } as const;
    }
    // 24972948 ticketMetadata returns the persisted operationCode for all command-backed I6 tickets.
    if (!ticket.mine || ticket.obj !== input.obj || ticket.operationCode !== input.command.op
      || !["pending", "approved", "rejected", "withdrawn", "expired"].includes(ticket.rawStatus ?? "")) {
      throw new Error("查到的审批单和原操作对不上，请保留原记录并查询原结果。");
    }
    return { conclusion: ticket.status === "pending" ? "unknown" : ticket.status === "approved" ? "succeeded" : "not-executed", ticket } as const;
  });
  if (!result) return null;
  if (result.ticket?.status === "pending") commands.remember(record.fingerprint, record.commandKey, { ...record, receiptKnown: true, ticketStatus: "pending" });
  else if (result.ticket) i6CourseRecovery.settleFromQuery(record, result.conclusion);
  return result.ticket;
}

async function sendI6CourseProposal(saved: HIRewardCommand, retry: boolean) {
  const uncertain = (message: string) => Object.assign(new OutcomeUnknownError(message), { commandKey: saved.commandKey });
  const record = originalI6Proposal(saved);
  if (isRetryExpired(record)) throw new Error(RETRY_EXPIRED_TEXT);
  const permission = i6CourseProposalPermission(record);
  if (permission) throw new Error(permission);
  if (!commands.isDurablyStored(record.fingerprint, record.commandKey)) throw new Error("浏览器无法保存原操作，尚未提交。请允许会话存储后再试。");
  let response: Response, envelope: { code: number; message?: string; data?: { id?: unknown } };
  try {
    response = await guardedFetch("/api/admin/platform/audit/operations", { method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", "Idempotency-Key": record.commandKey }, body: record.body });
    envelope = await response.json();
  } catch { throw uncertain("结果未知，请查询原结果或按原请求重试。"); }
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || !Number.isInteger(envelope.code)
    || envelope.message !== undefined && typeof envelope.message !== "string") throw uncertain("原申请的返回内容无法核实，请保留原记录并查询原结果。");
  const unknown = response.headers.get("X-Nexion-Upstream-Outcome") === "unknown" || isIdempotencyOutcomeOpen(envelope.message);
  if (!response.ok || envelope.code !== 0 || unknown) {
    const status = response.ok && envelope.code >= 400 && envelope.code < 500 ? envelope.code : response.status;
    const failure = Object.assign(new Error(formatAdminApiError(envelope.message, "A2_REQUEST_FAILED")), { status, backendMessage: envelope.message });
    const rejected = retry ? isExplicitRejection(failure) : isDeterministicRejection(response.status, envelope.code) && envelope.code < 500;
    if (rejected && !unknown) { if (!retry) commands.forget(record.fingerprint, record.commandKey); throw Object.assign(failure, { rejectedCommand: retry ? undefined : record }); }
    throw uncertain(failure.message);
  }
  if (!envelope.data || typeof envelope.data.id !== "string" || !envelope.data.id) throw uncertain("原申请的返回内容无法核实，请保留原记录并查询原结果。");
  commands.remember(record.fingerprint, record.commandKey, { ...record, receiptKnown: true });
}

async function readSubmittedI6Course(record: HIRewardCommand, observe?: (record: HIRewardCommand, ticket: A2OperationRow) => void): Promise<A2OperationRow> {
  const uncertain = (message: string) => Object.assign(new OutcomeUnknownError(message), { commandKey: record.commandKey });
  try {
    const ticket = await queryI6CourseProposal(record);
    if (ticket) { observe?.(record, ticket); return ticket; }
  } catch (error) { throw uncertain(`申请已提交，当前审批结果还没查到：${error instanceof Error ? error.message : "请查询原结果"}`); }
  throw uncertain("申请已提交，当前审批结果还没查到，请保留原记录并查询原结果。");
}

export async function retryI6CourseProposal(record: HIRewardCommand) {
  await i6CourseRecovery.replay(record, record => sendI6CourseProposal(record, true));
  return readSubmittedI6Course(record);
}

export function releaseRejectedI6Course(record: HIRewardCommand) {
  if (!i6CourseRecovery.releaseRejectedReplay(record)) throw new Error("原操作记录继续保留，请查询原结果。");
}

/** The complete envelope is saved before dispatch; an unresolved scope can only replay its original envelope. */
export async function submitHIRewardCommand(scope: string, payload: Payload, form?: Record<string, string>, editValue?: string, snapshot?: I6CommandSnapshot, observe?: (record: HIRewardCommand, ticket: A2OperationRow) => void) {
  const session = useAdminAuth.getState().session;
  if (!session) throw new Error("登录已失效，请重新登录后核对原操作。");
  const previous = pendingHIRewardCommand(scope);
  if (payload.kind === "proposal" && payload.input.command.domain === "I") {
    if (previous) throw new Error("此对象有原操作尚未核清，请先查询原结果。");
    const key = createA2CommandKey(payload.input.command.op), fingerprint = `${session.adminId}:${scope}`;
    const draft: HIRewardCommand = { owner: session.adminId, scope, payload, body: JSON.stringify(payload.input), form, editValue, snapshot,
      fingerprint, commandKey: key, createdAt: Date.now(), expiresAt: Date.now() + 86_400_000 };
    const permission = i6CourseProposalPermission(draft);
    if (permission) throw new Error(permission);
    commands.remember(fingerprint, key, draft);
    if (!commands.isDurablyStored(fingerprint, key)) {
      commands.forget(fingerprint, key);
      throw new Error("浏览器无法保存完整原操作，本次未发送；请允许会话存储后重试。");
    }
    await sendI6CourseProposal(draft, false);
    return { kind: "proposal" as const, ticket: await readSubmittedI6Course(draft, observe) };
  }
  const original = previous?.payload ?? payload;
  const authorities = original.kind === "retire" ? ["growth_h4_wheel_pool_write"]
    : original.input.command.domain === "I" ? ["content_i7_write", "content_i7_course_reward_adjust"]
    : [original.input.command.op === "h4_legacy_event_reward_update" ? "growth_h4_write" : "growth_h4_wheel_pool_write"];
  if (!authorities.every(a => session.authorities.includes(a))) throw new Error("当前账号没有原操作需要的权限，请保留原记录并核对授权。");
  const key = previous?.commandKey ?? createA2CommandKey(original.kind === "retire" ? "h4-tier-retire" : original.input.command.op);
  if (!previous) {
    commands.remember(`${session.adminId}:${scope}`, key, { owner: session.adminId, scope, payload: original,
      body: JSON.stringify(original.input), form, editValue,
      ...(original.kind === "retire" ? { commandOrigin: fundCommandOrigin("POST", `/api/admin/growth/quest-events/wheel-tiers/${encodeURIComponent(original.tierName)}/retire`, "growth_h4_read") } : {}) });
    if (!commands.isDurablyStored(`${session.adminId}:${scope}`, key)) {
      commands.forget(`${session.adminId}:${scope}`, key);
      throw new Error("浏览器没能记下这次操作，这次没有发出；请关闭无痕模式或允许本站保存数据后再试。");
    }
  }
  const record = pendingHIRewardCommand(scope)!;
  if (previous && original.kind === "proposal") {
    const ticket = await fetchA2ProposalByKey(key, true);
    if (ticket) {
      if (!ticket.mine || ticket.obj !== original.input.obj || (ticket.operationCode && ticket.operationCode !== original.input.command.op))
        throw new A2OutcomeUncertainError("查到的审批单和原操作对不上，请保留原记录核对。", key);
      commands.forget(record.fingerprint, key);
      return { kind: "proposal" as const, ticket };
    }
  }
  if (isRetryExpired(record)) throw new Error(`${RETRY_EXPIRED_TEXT}`);
  try {
    if (original.kind === "proposal") {
      const ticket = await createA2OperationProposal(JSON.parse(record.body) as HIProposal, key, true);
      if (!ticket.mine || ticket.obj !== original.input.obj || (ticket.operationCode && ticket.operationCode !== original.input.command.op))
        throw new A2OutcomeUncertainError("返回的审批单和原操作对不上，请保留原记录核对。", key);
      commands.forget(record.fingerprint, key);
      return { kind: "proposal" as const, ticket };
    }
    const result = await growthRequest<Record<string, any>>(`/quest-events/wheel-tiers/${encodeURIComponent(original.tierName)}/retire`, {
      method: "POST", headers: { "Idempotency-Key": key }, body: record.body,
    }, undefined, true);
    if (result?.updated?.tierName !== original.tierName || result.updated.action !== "retired"
      || !Array.isArray(result.wheelTiers) || typeof result.wheelSignature !== "string")
      throw new A2OutcomeUncertainError("退役后返回的内容不完整，请保留原记录核对。", key);
    commands.forget(record.fingerprint, key);
    return { kind: "retire" as const, overview: result };
  } catch (error) {
    // Growth business rejections can arrive in a successful HTTP envelope.
    const verdict = error as { status?: number; apiCode?: number; bodyUnreadable?: boolean };
    if (original.kind === "retire" && verdict.status && verdict.status >= 200 && verdict.status < 300
      && verdict.apiCode && verdict.apiCode >= 400 && verdict.apiCode < 500 && !verdict.bodyUnreadable)
      Object.assign(error as object, { status: verdict.apiCode });
    if (isExplicitRejection(error)) { commands.forget(record.fingerprint, key); throw error; }
    throw new A2OutcomeUncertainError(error instanceof Error ? error.message : "提交结果未知，请保留原操作核对。", key);
  }
}

/** Wiring contract for the visual worker's points-tier action; never replaces prizes or redistributes probability. */
export async function retireH4PointsTier(tierName: string, expectedSignature: string, reason: string) {
  const pending = pendingHIRewardCommand(HI_WHEEL_SCOPE);
  if (pending && (pending.payload.kind !== "retire" || pending.payload.tierName !== tierName))
    throw new Error("奖池还有一条结果未知的原操作，请先查询它的原结果。");
  const session = useAdminAuth.getState().session;
  if (!session) throw new Error("登录已失效，请重新登录后核对原操作。");
  return submitHIRewardCommand(HI_WHEEL_SCOPE, { kind: "retire", tierName,
    input: { reason, operator: session.operator || session.username, confirmed: true, expectedSignature } });
}
