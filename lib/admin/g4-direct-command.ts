import { createA2CommandKey, A2OutcomeUncertainError } from "./a2-client";
import { isExplicitRejection } from "./explicit-rejection";
import { createPendingMutationStore, hasPersistedPendingCommandOwner, type PendingMutationRecord } from "./pending-mutation-store";
import { useAdminAuth } from "@/lib/store/admin-auth";

export type G4DirectRequest = {
  path: string;
  method: "PATCH" | "POST" | "DELETE";
  body: string;
};
export type G4DirectCommand = PendingMutationRecord & G4DirectRequest & { adminId: number };

// This is the existing G4 direct-command table, with a single owner. Historical
// fingerprints also contain the complete request; keep their evidence and TTL.
const commands = createPendingMutationStore<PendingMutationRecord & Partial<G4DirectRequest> & { adminId?: number }>({
  storageKey: "nexion-admin-g4-genesis-commands-v1",
  retainExpiredRecords: true,
});
let version = 0;
const listeners = new Set<() => void>();
export const subscribeG4DirectCommands = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const g4DirectCommandVersion = () => version;
function changed() { version += 1; listeners.forEach(listener => listener()); }

export function g4DirectObject(request: G4DirectRequest) {
  if (request.path.startsWith("/nex/genesis/tiers")) return "tiers";
  return request.path.replace("/nex/genesis/", "");
}

export function listG4DirectCommands(adminId: number): G4DirectCommand[] {
  return commands.list().flatMap(record => {
    if (record.adminId !== undefined && record.adminId !== adminId) return [];
    if (record.adminId === undefined && !hasPersistedPendingCommandOwner(String(adminId))) return [];
    const legacy = record.fingerprint.match(/^g4-[^:]+:(PATCH|POST|DELETE) (\/nex\/genesis\/[^\n]+)\n([\s\S]+)$/);
    const request = record.adminId === undefined && legacy
      ? { method: legacy[1], path: legacy[2], body: legacy[3] } : record;
    if (!["PATCH", "POST", "DELETE"].includes(request.method ?? "")
        || typeof request.path !== "string" || !/^\/nex\/genesis\/[A-Za-z0-9/%_.-]+$/.test(request.path)
        || typeof request.body !== "string") {
      throw new Error("原创世节点操作内容不完整，请到操作记录核对，勿重复提交。");
    }
    const body = JSON.parse(request.body) as Record<string, unknown>;
    if (typeof body.reason !== "string" || typeof body.operator !== "string") {
      throw new Error("原创世节点操作缺少理由或操作人，请到操作记录核对。");
    }
    return [{ ...record, ...request, adminId } as G4DirectCommand];
  });
}

export function g4DirectCommandExpired(command: PendingMutationRecord) {
  return Date.now() < command.createdAt || Date.now() >= command.expiresAt;
}

export function g4DirectAuthority(request: G4DirectRequest) {
  const object = g4DirectObject(request);
  if (object === "tiers") return "finprod_g4_price_write";
  if (object === "market-status" || object === "market-open-state") return "finprod_g4_market_toggle";
  const param = object.startsWith("params/") ? decodeURIComponent(object.slice(7)) : "";
  return param === "price" ? "finprod_g4_price_write" : param === "dividend" ? "finprod_g4_dividend_rate_write"
    : param === "royalty" ? "finprod_g4_royalty_write" : param === "airdropPct" ? "finprod_g4_airdrop_pct_write"
      : param === "emissionCurve" ? "finprod_g4_emission_curve_write" : param === "airdropLockDays" ? "finprod_g4_airdrop_lock_days_write" : "finprod_g4_write";
}

export function canRetryG4DirectCommand(command: G4DirectCommand) {
  const auth = useAdminAuth.getState();
  return !g4DirectCommandExpired(command) && auth.isAuthenticated && !auth.logoutPending
    && auth.session?.adminId === command.adminId && auth.session.authorities.includes(g4DirectAuthority(command));
}

/** Submission and recovery both send the saved bytes. A current GET is never a verdict. */
export async function executeG4DirectCommand<T>(request: G4DirectRequest, send: (original: G4DirectCommand) => Promise<T>, saved?: G4DirectCommand) {
  const auth = useAdminAuth.getState();
  const adminId = auth.session?.adminId;
  const epoch = auth.authEpoch;
  if (!auth.isAuthenticated || auth.logoutPending || !adminId) throw new Error("请重新登录后核对原操作。");
  const object = g4DirectObject(request);
  let original = listG4DirectCommands(adminId).find(record => g4DirectObject(record) === object);
  if (saved && original?.commandKey !== saved.commandKey) throw new Error("原操作已结束，请重新读取当前状态。");
  if (original && !saved && (original.body !== request.body || original.method !== request.method || original.path !== request.path)) {
    throw new A2OutcomeUncertainError("这一项有待确认的原操作，请查询或按原请求重试，不能改值或理由。", original.commandKey);
  }
  if (!auth.session!.authorities.includes(g4DirectAuthority(original ?? request))) throw new Error("当前账号没有此项修改权限；仍可只读核对原操作。");
  if (!original) {
    const fingerprint = `${adminId}:G4:${object}`;
    const commandKey = createA2CommandKey("g4-direct");
    commands.remember(fingerprint, commandKey, { ...request, adminId });
    if (!commands.isDurablyStored(fingerprint, commandKey)) {
      commands.forget(fingerprint, commandKey);
      throw new Error("浏览器存不下完整原请求，本次没有发送。请允许会话存储后再操作。");
    }
    original = listG4DirectCommands(adminId).find(record => record.commandKey === commandKey)!;
    changed();
  }
  if (g4DirectCommandExpired(original)) throw new A2OutcomeUncertainError("原操作已超过 24 小时或本机时间异常，只能查询核对，不能重试。", original.commandKey);
  if (!commands.isDurablyStored(original.fingerprint, original.commandKey)) throw new Error("浏览器无法保存原操作，本次没有发送；请保留原记录继续核对。");
  const command = original;
  try {
    const result = await send(command);
    const current = useAdminAuth.getState();
    if (current.session?.adminId !== adminId || current.authEpoch !== epoch) throw new Error("登录身份已变化，请重新核对原操作。");
    commands.forget(command.fingerprint, command.commandKey);
    changed();
    return result;
  } catch (error) {
    if (isExplicitRejection(error)) {
      commands.forget(command.fingerprint, command.commandKey);
      changed();
      throw error;
    }
    changed();
    const uncertain = new A2OutcomeUncertainError("", command.commandKey);
    throw Object.assign(uncertain, { backendMessage: (error as { backendMessage?: string })?.backendMessage });
  }
}
