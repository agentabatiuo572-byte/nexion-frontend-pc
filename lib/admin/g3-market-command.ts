import {
  A2OutcomeUncertainError, createA2CommandKey, createA2OperationProposal,
  fetchA2ProposalByKey,
} from "./a2-client";
import { createPendingMutationStore, type PendingMutationRecord } from "./pending-mutation-store";
import { isExplicitRejection } from "./explicit-rejection";
import {
  fetchG3MarketOverview, g3LegacyCommands, submitG3MarketCommand,
  type G3CurveField, type G3Overview, type G3OverrideKey, type serializeG3Frames,
} from "./g3-client";
import { roleLabel } from "@/lib/nav/console-nav";
import { useAdminAuth, type AdminSession } from "@/lib/store/admin-auth";

type ChangeBasis = { current: string };
export type G3ReviewedChange = ChangeBasis & { expectedRevision: string } & (
  | { action: "curve-cell"; dayIndex: number; field: "targetPrice" | "pumpProbability"; expectedFrames: ReturnType<typeof serializeG3Frames> }
  | { action: "current-price" | "schedule" }
);
export type G3DirectChange = ChangeBasis & (
  | { action: "curve-cell"; dayIndex: number; field: "volatilityPct"; expectedFrames: ReturnType<typeof serializeG3Frames> }
  | { action: "control"; key: "pin" | "loop" }
  | { action: "override"; key: Exclude<G3OverrideKey, "currentPrice"> }
);
export type G3MarketChange = G3ReviewedChange | G3DirectChange;
type Proposal = Parameters<typeof createA2OperationProposal>[0];
type CommandPayload = {
  change: G3MarketChange;
  value: string;
  reason: string;
  request: { kind: "approval"; input: Proposal }
    | { kind: "direct"; path: string; method: "PUT" | "PATCH"; body: string };
  ticketId?: string;
};
export type G3PendingCommand = PendingMutationRecord & CommandPayload & { legacy?: boolean };
/** `recovered`: the reply belongs to a saved original request, so `active` is that request's stored reply, not a current read. */
export type G3CommandResult = { active?: G3Overview; acknowledgement: string; ticketKey?: string; recovered?: boolean };
export const G3_ENVIRONMENT_FORBIDDEN = "G3_MANUAL_TUNING_FORBIDDEN_IN_PRODUCTION";

const commands = createPendingMutationStore<PendingMutationRecord & { input: string }>({
  storageKey: "nexion-admin-g3-confirmed-market-commands-v1",
  retainExpiredRecords: true,
  isValidRecord: record => typeof record.input === "string",
});

export function g3MarketObjectKey(change: G3MarketChange) {
  return change.action === "curve-cell" ? `weekly:D${change.dayIndex + 1}:${change.field}`
    : change.action === "control" || change.action === "override" ? change.key
    : change.action === "current-price" ? "currentPrice" : "schedule";
}

function slot(adminId: number, change: G3MarketChange) {
  return `${adminId}:G3:${g3MarketObjectKey(change)}`;
}

/** Both historical stores have one owner. Legacy fingerprints contain the complete original JSON. */
export function listG3MarketCommands(adminId: number): G3PendingCommand[] {
  const rows: G3PendingCommand[] = commands.list().filter(row => row.fingerprint.startsWith(`${adminId}:G3:`)).map(record => {
    const payload = JSON.parse(record.input) as CommandPayload;
    const change = payload.change;
    if (!change || !["curve-cell", "current-price", "schedule", "control", "override"].includes(change.action)
        || typeof change.current !== "string" || typeof payload.value !== "string" || typeof payload.reason !== "string"
        || !payload.request || !["approval", "direct"].includes(payload.request.kind)
        || (payload.request.kind === "direct" && (typeof payload.request.path !== "string" || typeof payload.request.body !== "string" || !["PUT", "PATCH"].includes(payload.request.method)))
        || (change.action === "curve-cell" && (!Number.isInteger(change.dayIndex) || change.dayIndex < 0 || change.dayIndex > 6
          || !["targetPrice", "pumpProbability", "volatilityPct"].includes(change.field) || !Array.isArray(change.expectedFrames)))
        || slot(adminId, change) !== record.fingerprint) {
      throw new Error("原操作内容不完整，请到操作记录核对，勿重复提交。");
    }
    return { ...record, ...payload };
  });
  for (const record of g3LegacyCommands.list()) {
    const match = record.fingerprint.match(/^g3-(curve-d([1-7])-(targetPrice|pumpProbability|volatilityPct)|control-(pin|loop|schedule)|override-(currentPrice|volatilityPct|oracle|deviationPct|costBasis|paused)):(PUT|PATCH) ([^\n]+)\n([\s\S]+)$/);
    if (!match) continue;
    const body = JSON.parse(match[8]) as { value: string; expectedValue: string; frames: ReturnType<typeof serializeG3Frames>; expectedFrames: ReturnType<typeof serializeG3Frames>; reason: string; operator: string };
    if (typeof body.reason !== "string" || typeof body.operator !== "string") throw new Error("原操作内容不完整，请到操作记录核对，勿重复提交。");
    let change: G3MarketChange;
    let value: string;
    if (match[2]) {
      const dayIndex = Number(match[2]) - 1;
      const field = match[3] as G3CurveField;
      const current = body.expectedFrames?.find(frame => frame.dayIndex === dayIndex)?.[field];
      value = body.frames?.find(frame => frame.dayIndex === dayIndex)?.[field] ?? "";
      if (typeof current !== "string" || !value) throw new Error("原操作内容不完整，请到操作记录核对，勿重复提交。");
      change = { action: "curve-cell", dayIndex, field, current, expectedFrames: body.expectedFrames, expectedRevision: "" };
    } else {
      if (typeof body.value !== "string" || typeof body.expectedValue !== "string") throw new Error("原操作内容不完整，请到操作记录核对，勿重复提交。");
      value = body.value;
      change = match[4] === "schedule" ? { action: "schedule", current: body.expectedValue, expectedRevision: "" }
        : match[4] ? { action: "control", key: match[4] as "pin" | "loop", current: body.expectedValue }
        : match[5] === "currentPrice" ? { action: "current-price", current: body.expectedValue, expectedRevision: "" }
        : { action: "override", key: match[5] as Exclude<G3OverrideKey, "currentPrice">, current: body.expectedValue };
    }
    rows.push({ ...record, change, value, reason: body.reason, legacy: true,
      request: { kind: "direct", method: match[6] as "PUT" | "PATCH", path: match[7], body: match[8] } });
  }
  return rows;
}

export function pendingG3MarketCommand(adminId: number, change: G3MarketChange) {
  return listG3MarketCommands(adminId).find(row => !row.ticketId && g3MarketObjectKey(row.change) === g3MarketObjectKey(change));
}

export function g3MarketCommandExpired(command: PendingMutationRecord) {
  return Date.now() < command.createdAt || Date.now() >= command.expiresAt;
}

export function g3MarketRequiresApproval(change: G3MarketChange, value: string) {
  return change.action === "schedule" ? change.current === ""
    : change.action === "current-price" || change.action === "curve-cell" && change.field !== "volatilityPct"
      ? Number(value) > Number(change.current) : false;
}

export function g3MarketChangeAuthority(change: G3MarketChange) {
  return change.action === "curve-cell"
    ? change.field === "targetPrice" ? "finprod_g3_curve_target_price_write" : change.field === "pumpProbability" ? "finprod_g3_curve_pump_prob_write" : "finprod_g3_write"
    : change.action === "current-price" ? "finprod_g3_override_price_write"
    : change.action === "override" && change.key === "paused" ? "finprod_g3_engine_pause_toggle" : "finprod_g3_write";
}

export function canWriteG3MarketChange(session: AdminSession, change: G3MarketChange, value = "") {
  const superAdmin = session.role === "super" || session.role === "superadmin";
  return (superAdmin || session.authorities.includes(g3MarketChangeAuthority(change)))
    && (superAdmin || change.action !== "override" || change.key !== "oracle" && (change.key !== "paused" || value !== "false"));
}

export function g3MarketFailureCode(error: unknown): string {
  return error && typeof error === "object" && "backendMessage" in error ? String(error.backendMessage ?? "") : "";
}

/** Refresh only the original maker's known tickets; never infer locks from an overview. */
export async function refreshG3MarketApprovals(adminId: number) {
  const rows = listG3MarketCommands(adminId).filter(row => row.ticketId);
  const results = await Promise.allSettled(rows.map(async row => {
    const ticket = await fetchA2ProposalByKey(row.commandKey, true);
    if (ticket && ticket.status !== "pending") commands.forget(row.fingerprint, row.commandKey);
    return ticket?.status === "pending" ? row.commandKey : undefined;
  }));
  return results.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : []);
}

/** Every new request is saved before sending; recovery uses only that saved request. */
export async function executeG3MarketChange(
  session: AdminSession, requested: G3MarketChange, value: string, reason: string,
  mode: "submit" | "lookup" | "retry" = "submit", forceApproval = false,
): Promise<G3CommandResult | null> {
  const epoch = useAdminAuth.getState().authEpoch;
  const previous = pendingG3MarketCommand(session.adminId, requested);
  const change = previous?.change ?? requested;
  function ensureOwner(write: boolean) {
    const auth = useAdminAuth.getState();
    if (!auth.isAuthenticated || auth.session?.adminId !== session.adminId || auth.authEpoch !== epoch) {
      throw new Error("登录身份或权限已变化，请关闭弹窗后重新操作。");
    }
    if (write) {
      if (!canWriteG3MarketChange(auth.session, change, previous?.value ?? value)) {
        throw new Error("你没有修改这一项的权限。");
      }
    }
  }
  ensureOwner(mode !== "lookup");
  if (mode !== "submit" && !previous) throw new Error("原操作记录已结束，请关闭弹窗后重新读取页面。");
  if (previous && mode === "submit" && (previous.value !== value.trim() || previous.reason !== reason.trim())) {
    throw new A2OutcomeUncertainError("请查询原操作，或使用原配置和原理由重试。", previous.commandKey);
  }
  const fingerprint = slot(session.adminId, change);
  let command = previous;
  if (!command) {
    value = value.trim();
    reason = reason.trim();
    if (change.action === "schedule") {
      if (!value || value === change.current) throw new Error("请填写与当前值不同的运行时间与时区。");
    } else if (change.action === "current-price" || change.action === "curve-cell" && change.field !== "volatilityPct") {
      const probability = change.action === "curve-cell" && change.field === "pumpProbability";
      const scale = probability ? 6 : 8;
      if (!new RegExp(`^(?:\\d+(?:\\.\\d{1,${scale}})?|\\.\\d{1,${scale}})$`).test(value)
          || Number(value) < (probability ? 0 : 0.00000001) || Number(value) > (probability ? 1 : 1000000)
          || Number(value) === Number(change.current)) {
        throw new Error(probability ? "上涨概率须为 0–1、最多六位小数，且与当前值不同。" : "价格须大于 0、不超过 1,000,000 USDT，最多八位小数，且与当前值不同。");
      }
    }
    const approval = forceApproval || g3MarketRequiresApproval(change, value);
    let request: CommandPayload["request"];
    if (approval) {
      if (!("expectedRevision" in change) || !/^[0-9a-f]{64}$/.test(change.expectedRevision)) throw new Error("当前配置版本未就绪，请关闭弹窗后重新读取页面。");
      const initial = change.action === "schedule";
      const target = { domain: "G", type: change.action === "curve-cell" ? "nex_market_curve" : initial ? "nex_market_control" : "nex_market_override",
        id: change.action === "curve-cell" ? "weekly" : initial ? "schedule" : "currentPrice" };
      const values = change.action === "curve-cell"
        ? { action: "curve-cell", dayIndex: change.dayIndex, field: change.field, value, expectedRevision: change.expectedRevision }
        : { action: initial ? "initial-schedule" : "current-price", value, expectedRevision: change.expectedRevision };
      request = { kind: "approval", input: {
        action: change.action === "curve-cell" ? `提高周价格计划 · D${change.dayIndex + 1} · ${change.field === "targetPrice" ? "目标价" : "上涨概率"}` : initial ? "首次配置自动推进时间" : "提高当前 UVT 价格",
        obj: target.id, beforeValue: change.current || "未配置", afterValue: value,
        operator: session.operator || session.username, operatorRole: roleLabel(session.role),
        type: initial ? "param" : "fund", amplifies: !initial, sos: false,
        roleGate: "另一位有审批权的超管", reason, sourceDomain: "G3",
        command: { domain: "G", op: "g3_market_policy_change", params: { values } }, target,
      } };
    } else {
      const operator = session.operator || session.username;
      if (change.action === "curve-cell") {
        const frames = change.expectedFrames.map(frame => ({ ...frame }));
        const target = frames.find(frame => frame.dayIndex === change.dayIndex);
        if (!target) throw new Error("这一天的价格计划不存在，请刷新页面后重试。");
        target[change.field] = value;
        request = { kind: "direct", path: "/nex/curve", method: "PUT", body: JSON.stringify({ frames, expectedFrames: change.expectedFrames, reason, operator }) };
      } else {
        request = { kind: "direct", path: change.action === "schedule" ? "/nex/curve/controls/schedule" : change.action === "control" ? `/nex/curve/controls/${change.key}` : change.action === "override" ? `/nex/overrides/${change.key}` : "/nex/overrides/currentPrice",
          method: "PATCH", body: JSON.stringify({ value, expectedValue: change.current, reason, operator }) };
      }
    }
    const payload: CommandPayload = { change, value, reason, request };
    const key = createA2CommandKey("g3-market");
    commands.remember(fingerprint, key, { input: JSON.stringify(payload) });
    if (!commands.isDurablyStored(fingerprint, key)) {
      commands.forget(fingerprint, key);
      throw new Error("浏览器无法保存原操作，请允许会话存储后重试。");
    }
    command = pendingG3MarketCommand(session.adminId, change)!;
  }

  const key = command.commandKey;
  const store = command.legacy ? g3LegacyCommands : commands;
  const forget = () => store.forget(command.fingerprint, key);
  const acknowledgeTicket = (ticket: { id: string; status: string }) => {
    if (ticket.status === "pending") {
      const { change, value, reason, request } = command;
      commands.remember(fingerprint, key, { input: JSON.stringify({ change, value, reason, request, ticketId: ticket.id }) });
    } else forget();
    return { acknowledgement: `已找到原审批单 ${ticket.id} · ${ticket.status === "pending" ? "等待另一位有权超管批准，尚未生效" : "请核对审批记录及当前配置"}`,
      ticketKey: ticket.status === "pending" ? key : undefined };
  };
  if (command.request.kind === "approval" && previous) {
    // Only A2_PROPOSAL_NOT_FOUND permits replay. OPERATION_RESULT_UNKNOWN is not absence.
    const ticket = await fetchA2ProposalByKey(key, true);
    ensureOwner(false);
    if (ticket) return acknowledgeTicket(ticket);
  }
  if (mode === "lookup") {
    if (command.request.kind === "approval") return null;
    await fetchG3MarketOverview();
    ensureOwner(false);
    throw new Error("已读取当前配置，但不能据此确认原命令结果。请保留原记录，到操作记录与审批按原命令号核对。");
  }
  if (g3MarketCommandExpired(command)) throw new A2OutcomeUncertainError("原命令已过期或本机时间异常，只能继续核对，不能重试或另建编号。", key);
  if (!store.isDurablyStored(command.fingerprint, key)) throw new Error("浏览器无法保存原操作，请允许会话存储后重试。");
  try {
    ensureOwner(true);
    if (command.request.kind === "approval") {
      const ticket = await createA2OperationProposal(command.request.input, key, true);
      ensureOwner(false);
      acknowledgeTicket(ticket);
      return { acknowledgement: `已提交审批 · ${ticket.id} · 等待另一位有权超管批准，尚未生效`, ticketKey: key };
    }
    const active = await submitG3MarketCommand(command.request.path, command.request.method, command.request.body, key);
    ensureOwner(false);
    forget();
    return { active, acknowledgement: command.change.action === "curve-cell" ? "价格计划已保存，当前价格不变；后续推进到该日生效" : command.change.action === "current-price" ? "当前价格已立即发布，下次自动切换仍按计划执行" : "运行时间已保存，后续按排程推进，本次不当场修改价格" };
  } catch (failure) {
    if (isExplicitRejection(failure)) {
      forget();
      throw failure;
    }
    const uncertain = new A2OutcomeUncertainError("请保留原请求和命令号，在有效期内按原操作重试；过期后只能核对。", key);
    // The shared approval modal appends the number; do not append it twice here.
    uncertain.message = "提交结果暂未确认，可能已经生效。请查询原操作，或在有效期内按原操作重试；过期后只能核对。";
    throw uncertain;
  }
}
