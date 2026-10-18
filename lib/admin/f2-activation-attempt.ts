import { isA2OutcomeUncertainError } from "./a2-client";
import { createPendingMutationStore, type PendingMutationRecord } from "./pending-mutation-store";
import type { ProposeSpec } from "./propose-or-execute";

interface ActivationAttempt extends PendingMutationRecord { spec: ProposeSpec }
const slot = "f-seven-layer-activation";
const attempts = createPendingMutationStore<ActivationAttempt>({
  storageKey: "nexion-admin-f2-activation-v1", retainExpiredRecords: true,
  isValidRecord: row => row.spec?.command?.op === "f_seven_layer_activation" && typeof row.spec.reason === "string",
});

export function pendingF2Activation() { return attempts.list().find(row => row.fingerprint === slot) ?? null; }

/** The original reviewed payload survives edits/reloads; only an explicit recovery replays it. */
export async function submitF2Activation(
  spec: ProposeSpec | null, send: (spec: ProposeSpec) => Promise<unknown>, mint: () => string,
) {
  let original = pendingF2Activation();
  const recovering = !!original;
  if (original && spec && JSON.stringify(original.spec) !== JSON.stringify(spec)) {
    throw new Error("原申请结果尚未确认，请先检查原申请；不能改动理由或另建申请。");
  }
  if (!original) {
    if (!spec) throw new Error("没有待检查的原申请，请重新读取审批进度。");
    attempts.remember(slot, mint(), { spec });
    original = pendingF2Activation()!;
  }
  if (original.expiresAt <= Date.now()) throw new Error("原申请已超出服务端支持的安全重试期限，请到 A2 核对原工单；不能重新申请。");
  if (!attempts.isDurablyStored(slot, original.commandKey)) throw new Error("当前会话无法保留原申请，请恢复浏览器会话存储后重试。");
  try {
    await send({ ...original.spec, commandKey: original.commandKey });
    attempts.forget(slot, original.commandKey);
  } catch (error) {
    if (!recovering && !isA2OutcomeUncertainError(error)) attempts.forget(slot, original.commandKey);
    throw error;
  }
}
