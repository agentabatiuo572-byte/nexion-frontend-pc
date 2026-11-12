import { useAdminAuth } from "@/lib/store/admin-auth";
import { displayAdminError } from "./error-messages";
import { isExplicitRejection } from "./explicit-rejection";
import { normalizeG2BatchResult } from "./g2-batch-result";
import {
  fetchG2ExchangeOverview, g2Request, normalizeG2ExchangeOverview, type BackendOverview, type G2Cap, type G2ExchangeOrder,
} from "./g2-client";
import {
  createPendingMutationStore, hasPersistedPendingCommandOwner, type PendingMutationRecord,
} from "./pending-mutation-store";
import { validateG2Order } from "./g-overview-contract";
import { stableMutationFingerprint } from "./stable-mutation";

type CommandBody = { reason: string; operator: string; value?: string; enabled?: false; geoBlock?: string[]; triggerBasis?: string; limit?: number };
type G2CommandContext = { cap?: G2Cap; order?: G2ExchangeOrder; queueDepth?: number };
export type G2PendingCommand = PendingMutationRecord & {
  adminId: number; path: string; method: "PATCH" | "POST"; body: string; input: CommandBody; context?: G2CommandContext;
};
export type G2PendingBatch = G2PendingCommand & { limit: number; reason: string };
const BATCH_PATH = "/exchange/queue/process";
const commands = createPendingMutationStore<PendingMutationRecord & { adminId?: number; context?: G2CommandContext }>({
  storageKey: "nexion-admin-g2-exchange-commands-v1",
  retainExpiredRecords: true,
});
let requestSeq = 0;

export class G2OutcomeUnknownError extends Error {
  constructor(readonly commandKey: string, message = "提交结果暂未确认，可能已经生效。请保留原请求和命令号，在有效期内按原操作重试；过期后只能核对。") {
    super(`${message} 命令号：${commandKey}`);
    this.name = "G2OutcomeUnknownError";
  }
}

/** One owner for the original G2 storage key, including its historical fingerprints. */
export function listG2ExchangeCommands(adminId: number): G2PendingCommand[] {
  return commands.list().filter(record => record.adminId === undefined
    ? hasPersistedPendingCommandOwner(String(adminId)) : record.adminId === adminId).map(record => {
    const match = /^(g2-param-(?:userDailyCap|platformDailyCap|fee|feeMin|queueMode)|g2-swap|g2-cancel-queue|g2-queue-batch):(PATCH|POST) (\/exchange\/[^\n]+)\n([\s\S]+)$/.exec(record.fingerprint);
    if (!match) throw new Error("原操作内容不完整，请到操作记录核对，勿重复提交。");
    const [, prefix, method, path, body] = match;
    const input = JSON.parse(body) as CommandBody;
    const param = /^\/exchange\/params\/(userDailyCap|platformDailyCap|fee|feeMin|queueMode)$/.exec(path);
    const validTarget = param ? method === "PATCH" && prefix === `g2-param-${param[1]}` && typeof input?.value === "string"
      : path === "/exchange/swap" ? method === "PATCH" && prefix === "g2-swap" && input?.enabled === false
        && Array.isArray(input.geoBlock) && input.geoBlock.every(country => typeof country === "string") && typeof input.triggerBasis === "string"
      : path === BATCH_PATH ? method === "POST" && prefix === "g2-queue-batch" && Number.isSafeInteger(input?.limit) && input.limit! >= 1 && input.limit! <= 100
      : /^\/exchange\/queue\/[^/]+\/cancel$/.test(path) && method === "POST" && prefix === "g2-cancel-queue";
    if (!validTarget || typeof input?.reason !== "string" || !input.reason.trim() || typeof input.operator !== "string") {
      throw new Error("原操作内容不完整，请到操作记录核对，勿重复提交。");
    }
    const context = record.context;
    if (context !== undefined) {
      if (!context || typeof context !== "object" || Array.isArray(context)) throw new Error("原操作内容不完整，请到操作记录核对，勿重复提交。");
      if (context.cap !== undefined && (!param || !context.cap || context.cap.key !== param[1]
        || !["name", "sub", "value", "displayValue", "note"].every(key => typeof context.cap![key as keyof G2Cap] === "string")
        || typeof context.cap.loosen !== "boolean")) throw new Error("原操作内容不完整，请到操作记录核对，勿重复提交。");
      if (context.order !== undefined) {
        validateG2Order("G2", context.order, "pending.order");
        if (path !== `/exchange/queue/${encodeURIComponent(context.order.exchangeNo)}/cancel`) throw new Error("原操作内容不完整，请到操作记录核对，勿重复提交。");
      }
      if (context.queueDepth !== undefined && (!Number.isSafeInteger(context.queueDepth) || context.queueDepth < 0)) throw new Error("原操作内容不完整，请到操作记录核对，勿重复提交。");
    }
    return { ...record, adminId, method: method as "PATCH" | "POST", path, body, input };
  });
}

export function pendingG2ExchangeCommand(adminId: number, path: string) {
  return listG2ExchangeCommands(adminId).find(record => record.path === path);
}

export function pendingG2QueueBatch(adminId: number): G2PendingBatch | undefined {
  const original = pendingG2ExchangeCommand(adminId, BATCH_PATH);
  return original ? { ...original, limit: original.input.limit!, reason: original.input.reason } : undefined;
}

export function g2ExchangeCommandExpired(command: PendingMutationRecord) {
  return Date.now() < command.createdAt || Date.now() >= command.expiresAt;
}

function requireActor(adminId: number, path: string, write: boolean) {
  const auth = useAdminAuth.getState();
  const param = path.startsWith("/exchange/params/") ? path.slice("/exchange/params/".length) : undefined;
  const authority = param === "userDailyCap" ? "finprod_g2_cap_user_write"
    : param === "platformDailyCap" ? "finprod_g2_cap_platform_write"
    : param === "fee" || param === "feeMin" ? "finprod_g2_fee_rate_write"
    : path === "/exchange/swap" ? "finprod_g2_swap_toggle"
    : path.endsWith("/cancel") ? "finprod_g2_queue_cancel" : "finprod_g2_write";
  if (!auth.isAuthenticated || auth.logoutPending || auth.session?.adminId !== adminId
    || write && !auth.session.authorities.includes(authority)) {
    throw new Error("登录身份或兑换处理权限已变化，请关闭后重新打开。");
  }
  return auth.authEpoch;
}

async function confirmBatch(response: BackendOverview, original: G2PendingCommand) {
  const batch = normalizeG2BatchResult(response?.batch);
  const overview = await fetchG2ExchangeOverview();
  requireActor(original.adminId, original.path, false);
  commands.forget(original.fingerprint, original.commandKey);
  return { overview, batch };
}

export async function recoverG2ExchangeQueue(adminId: number, commandKey: string) {
  requireActor(adminId, BATCH_PATH, true);
  const original = listG2ExchangeCommands(adminId).find(record => record.commandKey === commandKey && record.path === BATCH_PATH);
  if (!original) throw new Error("原处理记录已变化，请重新打开核对入口。");
  // Only this endpoint returns a receipt by command number. A 404 never releases evidence.
  const response = await g2Request<BackendOverview>(BATCH_PATH, { method: "GET", headers: { "Idempotency-Key": commandKey } });
  return confirmBatch(response, original);
}

export async function queryG2ExchangeCommand(adminId: number, commandKey: string) {
  requireActor(adminId, "/exchange", false);
  const original = listG2ExchangeCommands(adminId).find(record => record.commandKey === commandKey);
  if (!original) throw new Error("原操作记录已结束，请关闭弹窗后重新读取页面。");
  if (original.path === BATCH_PATH && useAdminAuth.getState().session!.authorities.includes("finprod_g2_write")) return recoverG2ExchangeQueue(adminId, commandKey);
  await fetchG2ExchangeOverview();
  throw new G2OutcomeUnknownError(commandKey, "已读取当前配置，但不能据此确认原命令结果。请保留原记录，到操作记录与审批按原命令号核对。");
}

async function send(original: G2PendingCommand, recovering = false) {
  if (g2ExchangeCommandExpired(original)) {
    return queryG2ExchangeCommand(original.adminId, original.commandKey);
  }
  const epoch = requireActor(original.adminId, original.path, true);
  if (!commands.isDurablyStored(original.fingerprint, original.commandKey)) {
    throw new Error("浏览器无法保存原操作，请允许会话存储后重试。");
  }
  try {
    const response = await g2Request<BackendOverview>(original.path, {
      method: original.method, headers: { "Idempotency-Key": original.commandKey }, body: original.body,
    });
    if (requireActor(original.adminId, original.path, false) !== epoch) throw new Error("登录身份或权限已变化，请关闭弹窗后重新操作。");
    if (original.path === BATCH_PATH) return await confirmBatch(response, original);
    const accepted = normalizeG2ExchangeOverview(response);
    const overview = recovering ? await fetchG2ExchangeOverview() : accepted;
    requireActor(original.adminId, original.path, false);
    commands.forget(original.fingerprint, original.commandKey);
    return overview;
  } catch (error) {
    if (isExplicitRejection(error)) {
      commands.forget(original.fingerprint, original.commandKey);
      throw error;
    }
    throw new G2OutcomeUnknownError(original.commandKey, `${displayAdminError(error)} 请保留原请求和命令号，按原操作核对或重试。`);
  }
}

export async function retryG2ExchangeCommand(adminId: number, commandKey: string) {
  const original = listG2ExchangeCommands(adminId).find(record => record.commandKey === commandKey);
  if (!original) throw new Error("原操作记录已结束，请关闭弹窗后重新读取页面。");
  return send(original, true);
}

async function execute(path: string, method: "PATCH" | "POST", input: CommandBody, prefix: string, context?: G2CommandContext) {
  const adminId = useAdminAuth.getState().session?.adminId;
  if (!adminId) throw new Error("登录身份或兑换处理权限已变化，请关闭后重新打开。");
  requireActor(adminId, path, true);
  const previous = pendingG2ExchangeCommand(adminId, path);
  const body = JSON.stringify(input);
  if (previous) {
    if (previous.body !== body) throw new G2OutcomeUnknownError(previous.commandKey, "请查询原操作，或使用原配置和原理由重试。");
    return send(previous, true);
  }
  requestSeq = (requestSeq + 1) % 1_000_000;
  const key = `${prefix}-${Date.now()}-${requestSeq}`;
  const fingerprint = `${prefix}:${stableMutationFingerprint(method, path, body)}`;
  commands.remember(fingerprint, key, { adminId, context });
  if (!commands.isDurablyStored(fingerprint, key)) {
    commands.forget(fingerprint, key);
    throw new Error("无法保存原命令，请允许浏览器会话存储后再提交。");
  }
  return send(pendingG2ExchangeCommand(adminId, path)!);
}

export async function updateG2ExchangeParam(paramKey: string, value: string, reason: string, operator: string, cap?: G2Cap) {
  return execute(`/exchange/params/${encodeURIComponent(paramKey)}`, "PATCH", { value, reason, operator }, `g2-param-${paramKey}`, cap ? { cap } : undefined) as Promise<import("./g2-client").G2Overview>;
}

export async function updateG2ExchangeSwapStatus(enabled: boolean, reason: string, operator: string, context: { geoBlock?: string[]; triggerBasis?: string; queueDepth?: number } = {}) {
  if (enabled) throw new Error("这页只能暂停兑换，本次没有执行。恢复兑换请到「紧急停用开关」页面操作。");
  return execute("/exchange/swap", "PATCH", { enabled: false, reason, operator, geoBlock: context.geoBlock ?? [], triggerBasis: context.triggerBasis ?? "OTHER" }, "g2-swap", { queueDepth: context.queueDepth }) as Promise<import("./g2-client").G2Overview>;
}

export async function cancelG2ExchangeQueueOrder(exchangeNo: string, reason: string, operator: string, order?: G2ExchangeOrder) {
  return execute(`/exchange/queue/${encodeURIComponent(exchangeNo)}/cancel`, "POST", { reason, operator }, "g2-cancel-queue", order ? { order } : undefined) as Promise<import("./g2-client").G2Overview>;
}

export async function processG2ExchangeQueue(adminId: number, limit: number, reason: string, operator: string) {
  requireActor(adminId, BATCH_PATH, true);
  return execute(BATCH_PATH, "POST", { limit, reason, operator }, "g2-queue-batch") as Promise<{ overview: import("./g2-client").G2Overview; batch: ReturnType<typeof normalizeG2BatchResult> }>;
}
