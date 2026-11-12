import { createA2CommandKey, createA2OperationProposal, fetchA2ProposalByKey, A2OutcomeUncertainError } from "./a2-client";
import { createPendingMutationStore, isRetryExpired, RETRY_EXPIRED_TEXT, type PendingMutationRecord } from "./pending-mutation-store";
import { isExplicitRejection } from "./explicit-rejection";
import { growthRequest } from "./h-client";
import { findHighOp } from "./high-ops-registry";
import { useAdminAuth, type AdminSession } from "@/lib/store/admin-auth";
import { roleLabel } from "@/lib/nav/console-nav";

export type HIProposal = Parameters<typeof createA2OperationProposal>[0];
type Payload = { kind: "proposal"; input: HIProposal } | { kind: "retire"; tierName: string; input: { reason: string; operator: string; confirmed: true; expectedSignature: string } };
export type HIRewardCommand = PendingMutationRecord & { owner: number; scope: string; body: string; payload: Payload; form?: Record<string, string>; editValue?: string };
const commands = createPendingMutationStore<HIRewardCommand>({
  storageKey: "nexion-admin-hi-reward-commands-v1", retainExpiredRecords: true,
  isValidRecord: r => Number.isSafeInteger(r.owner) && typeof r.scope === "string" && typeof r.body === "string"
    && !!r.payload && ["proposal", "retire"].includes(r.payload.kind) && !!r.payload.input
    && typeof r.payload.input.reason === "string" && r.body === JSON.stringify(r.payload.input),
});

export const HI_WHEEL_SCOPE = "H/h4_wheel_pool/ACTIVE_POOL";
export const hiEventScope = (id: string) => `H/h4_legacy_event/${id}`;
export const hiCourseScope = (id: string) => `I/learning_course_activation/${id}`;
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

/** The complete envelope is saved before dispatch; an unresolved scope can only replay its original envelope. */
export async function submitHIRewardCommand(scope: string, payload: Payload, form?: Record<string, string>, editValue?: string) {
  const session = useAdminAuth.getState().session;
  if (!session) throw new Error("登录已失效，请重新登录后核对原操作。");
  const previous = pendingHIRewardCommand(scope);
  const original = previous?.payload ?? payload;
  const authorities = original.kind === "retire" ? ["growth_h4_wheel_pool_write"]
    : original.input.command.domain === "I" ? ["content_i7_write", "content_i7_course_reward_adjust"]
    : [original.input.command.op === "h4_legacy_event_reward_update" ? "growth_h4_write" : "growth_h4_wheel_pool_write"];
  if (!authorities.every(a => session.authorities.includes(a))) throw new Error("当前账号没有原操作所需权限，请保留原命令并核对授权。");
  const key = previous?.commandKey ?? createA2CommandKey(original.kind === "retire" ? "h4-tier-retire" : original.input.command.op);
  if (!previous) {
    commands.remember(`${session.adminId}:${scope}`, key, { owner: session.adminId, scope, payload: original,
      body: JSON.stringify(original.input), form, editValue });
    if (!commands.isDurablyStored(`${session.adminId}:${scope}`, key)) {
      commands.forget(`${session.adminId}:${scope}`, key);
      throw new Error("浏览器无法保存完整原操作，本次未发送；请允许会话存储后重试。");
    }
  }
  const record = pendingHIRewardCommand(scope)!;
  if (previous && original.kind === "proposal") {
    const ticket = await fetchA2ProposalByKey(key, true);
    if (ticket) {
      if (!ticket.mine || ticket.obj !== original.input.obj || (ticket.operationCode && ticket.operationCode !== original.input.command.op))
        throw new A2OutcomeUncertainError("查询回执与原操作不符，请保留原命令核对。", key);
      commands.forget(record.fingerprint, key);
      return { kind: "proposal" as const, ticket };
    }
  }
  if (isRetryExpired(record)) throw new Error(`${RETRY_EXPIRED_TEXT}。命令号：${key}`);
  try {
    if (original.kind === "proposal") {
      const ticket = await createA2OperationProposal(JSON.parse(record.body) as HIProposal, key, true);
      if (!ticket.mine || ticket.obj !== original.input.obj || (ticket.operationCode && ticket.operationCode !== original.input.command.op))
        throw new A2OutcomeUncertainError("审批回执与原操作不符，请保留原命令核对。", key);
      commands.forget(record.fingerprint, key);
      return { kind: "proposal" as const, ticket };
    }
    const result = await growthRequest<Record<string, any>>(`/quest-events/wheel-tiers/${encodeURIComponent(original.tierName)}/retire`, {
      method: "POST", headers: { "Idempotency-Key": key }, body: record.body,
    }, undefined, true);
    if (result?.updated?.tierName !== original.tierName || result.updated.action !== "retired"
      || !Array.isArray(result.wheelTiers) || typeof result.wheelSignature !== "string")
      throw new A2OutcomeUncertainError("退役回执不完整，请保留原命令核对。", key);
    commands.forget(record.fingerprint, key);
    return { kind: "retire" as const, overview: result };
  } catch (error) {
    // Growth business rejections can arrive in a successful HTTP envelope.
    const verdict = error as { status?: number; apiCode?: number; bodyUnreadable?: boolean };
    if (original.kind === "retire" && verdict.status && verdict.status >= 200 && verdict.status < 300
      && verdict.apiCode && verdict.apiCode >= 400 && verdict.apiCode < 500 && !verdict.bodyUnreadable)
      Object.assign(error as object, { status: verdict.apiCode });
    if (isExplicitRejection(error)) { commands.forget(record.fingerprint, key); throw error; }
    throw new A2OutcomeUncertainError(error instanceof Error ? error.message : "提交结果暂未确认，请保留原操作核对。", key);
  }
}

/** Wiring contract for the visual worker's points-tier action; never replaces prizes or redistributes probability. */
export async function retireH4PointsTier(tierName: string, expectedSignature: string, reason: string) {
  const pending = pendingHIRewardCommand(HI_WHEEL_SCOPE);
  if (pending && (pending.payload.kind !== "retire" || pending.payload.tierName !== tierName))
    throw new Error(`奖池有另一条结果待确认的原操作，请先按原命令核对。命令号：${pending.commandKey}`);
  const session = useAdminAuth.getState().session;
  if (!session) throw new Error("登录已失效，请重新登录后核对原操作。");
  return submitHIRewardCommand(HI_WHEEL_SCOPE, { kind: "retire", tierName,
    input: { reason, operator: session.operator || session.username, confirmed: true, expectedSignature } });
}
