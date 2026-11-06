import {
  A2OutcomeUncertainError, createA2CommandKey, createA2OperationProposal,
  fetchA2ProposalByKey, isA2OutcomeUncertainError,
} from "./a2-client";
import { createPendingMutationStore, type PendingMutationRecord } from "./pending-mutation-store";
import { classifyStableMutationFailure } from "./stable-mutation";
import { submitG3MarketCommand, type G3Overview, type serializeG3Frames } from "./g3-client";
import { roleLabel } from "@/lib/nav/console-nav";
import type { AdminSession } from "@/lib/store/admin-auth";

type ChangeBasis = { current: string; expectedRevision: string };
export type G3MarketChange = ChangeBasis & (
  | { action: "curve-cell"; dayIndex: number; field: "targetPrice" | "pumpProbability"; expectedFrames: ReturnType<typeof serializeG3Frames> }
  | { action: "current-price" | "schedule" }
);
type Proposal = Parameters<typeof createA2OperationProposal>[0];
type CommandPayload = {
  change: G3MarketChange;
  value: string;
  reason: string;
  request: { kind: "approval"; input: Proposal }
    | { kind: "direct"; path: string; method: "PUT" | "PATCH"; body: string };
};
export type G3PendingCommand = PendingMutationRecord & CommandPayload;
export type G3CommandResult = { active?: G3Overview; acknowledgement: string };

const commands = createPendingMutationStore<PendingMutationRecord & { input: string }>({
  storageKey: "nexion-admin-g3-confirmed-market-commands-v1",
  retainExpiredRecords: true,
  isValidRecord: record => typeof record.input === "string",
});

function slot(adminId: number, change: G3MarketChange) {
  return `${adminId}:G3:${change.action === "curve-cell" ? `weekly:D${change.dayIndex + 1}:${change.field}` : change.action === "current-price" ? "currentPrice" : "schedule"}`;
}

export function pendingG3MarketCommand(adminId: number, change: G3MarketChange): G3PendingCommand | undefined {
  const record = commands.list().find(row => row.fingerprint === slot(adminId, change));
  if (!record) return undefined;
  const payload = JSON.parse(record.input) as CommandPayload;
  if (!payload.change || !["curve-cell", "current-price", "schedule"].includes(payload.change.action)
      || typeof payload.change.current !== "string" || typeof payload.change.expectedRevision !== "string"
      || typeof payload.value !== "string" || typeof payload.reason !== "string"
      || !payload.request || !["approval", "direct"].includes(payload.request.kind)
      || slot(adminId, payload.change) !== record.fingerprint) {
    throw new Error("原操作内容不完整，请到操作记录核对，勿重复提交。");
  }
  return { ...record, ...payload };
}

export function g3MarketCommandExpired(command: PendingMutationRecord) {
  return Date.now() < command.createdAt || Date.now() >= command.expiresAt;
}

export function g3MarketRequiresApproval(change: G3MarketChange, value: string) {
  return change.action === "schedule" ? change.current === "" : Number(value) > Number(change.current);
}

export function g3MarketChangeAuthority(change: G3MarketChange) {
  return change.action === "curve-cell"
    ? change.field === "targetPrice" ? "finprod_g3_curve_target_price_write" : "finprod_g3_curve_pump_prob_write"
    : change.action === "current-price" ? "finprod_g3_override_price_write" : "finprod_g3_write";
}

/** A pending slot always reuses its complete original body, reason and expected baseline. */
export async function executeG3MarketChange(
  session: AdminSession, change: G3MarketChange, value: string, reason: string,
  mode: "submit" | "lookup" | "retry" = "submit",
): Promise<G3CommandResult | null> {
  const previous = pendingG3MarketCommand(session.adminId, change);
  if (mode !== "submit" && !previous) throw new Error("原操作记录已结束，请关闭弹窗后重新读取页面。");
  if (previous && mode === "submit" && (previous.value !== value.trim() || previous.reason !== reason.trim())) {
    throw new A2OutcomeUncertainError("请查询原操作，或使用原配置和原理由重试。", previous.commandKey);
  }
  const fingerprint = slot(session.adminId, change);
  let command = previous;
  if (!command) {
    value = value.trim();
    reason = reason.trim();
    if (change.action !== "schedule") {
      const probability = change.action === "curve-cell" && change.field === "pumpProbability";
      const scale = probability ? 6 : 8;
      if (!new RegExp(`^(?:\\d+(?:\\.\\d{1,${scale}})?|\\.\\d{1,${scale}})$`).test(value)
          || Number(value) < (probability ? 0 : 0.00000001) || Number(value) > (probability ? 1 : 1000000)
          || Number(value) === Number(change.current)) {
        throw new Error(probability ? "上涨概率须为 0–1、最多六位小数，且与当前值不同。" : "价格须大于 0、不超过 1,000,000 USDT，最多八位小数，且与当前值不同。");
      }
    } else if (!value || value === change.current) throw new Error("请填写与当前值不同的运行时间与时区。");
    const approval = g3MarketRequiresApproval(change, value);
    let request: CommandPayload["request"];
    if (approval) {
      if (!/^[0-9a-f]{64}$/.test(change.expectedRevision)) throw new Error("当前配置版本未就绪，请关闭弹窗后重新读取页面。");
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
        request = { kind: "direct", path: change.action === "schedule" ? "/nex/curve/controls/schedule" : "/nex/overrides/currentPrice",
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
  if (command.request.kind === "approval" && previous) {
    let ticket;
    try { ticket = await fetchA2ProposalByKey(key); }
    catch { throw new A2OutcomeUncertainError("暂时无法查询原审批单，请稍后再查。", key); }
    if (ticket) {
      commands.forget(fingerprint, key);
      return { acknowledgement: `已找到原审批单 ${ticket.id} · ${ticket.status === "pending" ? "等待另一位有权超管批准，尚未生效" : "请核对审批记录及当前配置"}` };
    }
  }
  if (g3MarketCommandExpired(command)) throw new A2OutcomeUncertainError("原命令已过期或本机时间异常，只能继续核对，不能重试或另建编号。", key);
  if (mode === "lookup") {
    if (command.request.kind === "approval") return null;
    throw new Error("直接保存没有按命令号查询接口，只能在有效期内按原操作重试。");
  }
  try {
    if (command.request.kind === "approval") {
      const ticket = await createA2OperationProposal(command.request.input, key, true);
      commands.forget(fingerprint, key);
      return { acknowledgement: `已提交审批 · ${ticket.id} · 等待另一位有权超管批准，尚未生效` };
    }
    const active = await submitG3MarketCommand(command.request.path, command.request.method, command.request.body, key);
    commands.forget(fingerprint, key);
    return { active, acknowledgement: command.change.action === "curve-cell" ? "价格计划已保存，当前价格不变；后续推进到该日生效" : command.change.action === "current-price" ? "当前价格已立即发布，下次自动切换仍按计划执行" : "运行时间已保存，后续按排程推进，本次不当场修改价格" };
  } catch (failure) {
    const backendMessage = failure && typeof failure === "object" && "backendMessage" in failure ? String(failure.backendMessage) : "";
    const uncertain = isA2OutcomeUncertainError(failure)
      || command.request.kind === "direct" && classifyStableMutationFailure(failure) === "outcome-unknown"
      || ["IDEMPOTENCY_REQUEST_IN_PROGRESS", "IDEMPOTENCY_RESULT_UNKNOWN", "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH"].includes(backendMessage);
    if (uncertain) throw new A2OutcomeUncertainError(command.request.kind === "approval"
      ? "请查询原审批，或在有效期内按原操作重试。"
      : "直接保存没有按命令号查询接口，请在有效期内按原完整操作重试；过期后只能核对记录。", key);
    if (!previous) commands.forget(fingerprint, key);
    throw failure;
  }
}
