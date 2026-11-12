import { useAdminAuth } from "@/lib/store/admin-auth";
import { A2OutcomeUncertainError } from "./a2-client";
import { isExplicitRejection } from "./explicit-rejection";
import { createPendingMutationStore, hasPersistedPendingCommandOwner, type PendingMutationRecord } from "./pending-mutation-store";

export type G7DirectInput = { value: string; reason: string; operator: string; g4Ref: string };
export type G7DirectCommand = PendingMutationRecord & {
  adminId: number;
  paramKey: string;
  path: string;
  method: "PUT";
  body: string;
  input: G7DirectInput;
  currentValue?: string;
  g4Capacity?: { monthlyCapacity: number; ticketsIssuedThisMonth: number };
};

// Own the existing table once. Its old fingerprints already contain the entire
// PUT request; retain that evidence and its original retry deadline.
const commands = createPendingMutationStore<PendingMutationRecord & { adminId?: number; currentValue?: string; g4Capacity?: G7DirectCommand["g4Capacity"] }>({
  storageKey: "nexion-admin-g7-repurchase-commands-v1",
  retainExpiredRecords: true,
});
let version = 0;
let sequence = 0;
const listeners = new Set<() => void>();
export const subscribeG7DirectCommands = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const g7DirectCommandVersion = () => version;
function changed() { version += 1; listeners.forEach(listener => listener()); }

export function listG7DirectCommands(adminId: number): G7DirectCommand[] {
  return commands.list().filter(record => record.adminId === undefined
    ? hasPersistedPendingCommandOwner(String(adminId)) : record.adminId === adminId).map(record => {
    const match = /^g7-param-(apy|lockDays|nurture|lottery|penalty|presets):PUT (\/nex\/repurchase\/config\/[^\n]+)\n([\s\S]+)$/.exec(record.fingerprint);
    if (!match || match[2] !== `/nex/repurchase/config/${match[1]}`) throw new Error("原锁定计划操作内容不完整，请到操作记录核对，勿重复提交。");
    const input: unknown = JSON.parse(match[3]);
    if (!input || typeof input !== "object" || !["value", "reason", "operator", "g4Ref"].every(key => typeof (input as Record<string, unknown>)[key] === "string")
      || record.currentValue !== undefined && typeof record.currentValue !== "string"
      || record.g4Capacity !== undefined && (!record.g4Capacity || !Number.isFinite(record.g4Capacity.monthlyCapacity) || !Number.isFinite(record.g4Capacity.ticketsIssuedThisMonth))) {
      throw new Error("原锁定计划操作内容不完整，请到操作记录核对，勿重复提交。");
    }
    return { ...record, adminId, paramKey: match[1], path: match[2], method: "PUT", body: match[3], input: input as G7DirectInput };
  });
}

export function g7DirectAuthority(key: string) {
  return key === "apy" || key === "lockDays" ? "finprod_g7_apy_write"
    : key === "nurture" ? "finprod_g7_nurture_write" : "finprod_g7_write";
}

export function g7DirectCommandExpired(command: PendingMutationRecord) {
  return Date.now() < command.createdAt || Date.now() >= command.expiresAt;
}

export function canRetryG7DirectCommand(command: G7DirectCommand) {
  const auth = useAdminAuth.getState();
  return !g7DirectCommandExpired(command) && auth.isAuthenticated && !auth.logoutPending
    && auth.session?.adminId === command.adminId && auth.session.authorities.includes(g7DirectAuthority(command.paramKey));
}

/** Read permission and write permission are independent during recovery. */
export function requireG7DirectReader(adminId: number) {
  const auth = useAdminAuth.getState();
  if (!auth.isAuthenticated || auth.logoutPending || auth.session?.adminId !== adminId
    || !auth.session.authorities.includes("finprod_g7_read")) throw new Error("请使用原操作账号核对锁定计划，并确认查看权限。");
  return auth.authEpoch;
}

export async function executeG7DirectCommand<T>(paramKey: string, input: G7DirectInput,
  send: (original: G7DirectCommand) => Promise<T>, saved?: G7DirectCommand, currentValue?: string, g4Capacity?: G7DirectCommand["g4Capacity"]) {
  const auth = useAdminAuth.getState();
  const adminId = auth.session?.adminId;
  const epoch = auth.authEpoch;
  if (!auth.isAuthenticated || auth.logoutPending || !adminId) throw new Error("请重新登录后核对原操作。");
  let original = listG7DirectCommands(adminId).find(record => record.paramKey === paramKey);
  const recovering = original !== undefined;
  if (saved && original?.commandKey !== saved.commandKey) throw new Error("原操作已结束，请重新读取当前状态。");
  const body = JSON.stringify(input);
  if (original && !saved && original.body !== body) {
    throw new A2OutcomeUncertainError("这一项有待确认的原操作，请核对或按原请求重试，不能改值或理由。", original.commandKey);
  }
  if (!auth.session!.authorities.includes(g7DirectAuthority(paramKey))) throw new Error("当前账号没有此项修改权限；仍可只读核对原操作。");
  if (!original) {
    const path = `/nex/repurchase/config/${encodeURIComponent(paramKey)}`;
    const fingerprint = `g7-param-${paramKey}:PUT ${path}\n${body}`;
    sequence = (sequence + 1) % 1_000_000;
    const commandKey = `g7-param-${paramKey}-${Date.now()}-${sequence}`;
    commands.remember(fingerprint, commandKey, { adminId, currentValue, g4Capacity });
    if (!commands.isDurablyStored(fingerprint, commandKey)) {
      commands.forget(fingerprint, commandKey);
      throw new Error("浏览器存不下完整原请求，本次没有发送。请允许会话存储后再操作。");
    }
    original = listG7DirectCommands(adminId).find(record => record.commandKey === commandKey)!;
    changed();
  }
  if (g7DirectCommandExpired(original)) throw new A2OutcomeUncertainError("原操作已超过 24 小时或本机时间异常，只能核对，不能重试。", original.commandKey);
  if (!commands.isDurablyStored(original.fingerprint, original.commandKey)) throw new Error("浏览器无法保存原操作，本次没有发送；请保留原记录继续核对。");
  try {
    const result = await send(original);
    const current = useAdminAuth.getState();
    if (current.session?.adminId !== adminId || current.authEpoch !== epoch) throw new Error("登录身份已变化，请重新核对原操作。");
    commands.forget(original.fingerprint, original.commandKey);
    changed();
    return result;
  } catch (error) {
    const backendMessage = (error as { backendMessage?: string } | null)?.backendMessage;
    // The object lock is checked before idempotency replay. On recovery it says
    // nothing about whether the original command already succeeded.
    const recoveryLocked = recovering && (backendMessage === "OBJECT_LOCKED_BY_A2" || backendMessage === "OBJECT_ALREADY_PENDING");
    if (!recoveryLocked && isExplicitRejection(error)) {
      commands.forget(original.fingerprint, original.commandKey);
      changed();
      throw error;
    }
    changed();
    if (recoveryLocked) {
      // The shared A2 formatter replaces its detail with generic retry copy.
      // Keep this G7 non-verdict and its current-lock explanation together.
      throw Object.assign(new Error(`提交结果未知，可能已经执行。这一项有一张审批单还没处理完，原记录继续保留。请核对原操作。命令号：${original.commandKey}`), {
        name: "G7DirectRecoveryLockedError", unknownOutcome: true,
        commandKey: original.commandKey, reasonCode: backendMessage, cause: error,
      });
    }
    throw Object.assign(new A2OutcomeUncertainError("提交结果未知，可能已经执行。请核对原操作，或在 24 小时内按原内容、原命令号重试。", original.commandKey),
      { backendMessage });
  }
}
