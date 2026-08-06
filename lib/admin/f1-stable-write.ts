// 相对路径 + 显式 .ts 后缀,而非 `@/` 别名:本模块被 tests/f1-direct-pending-store-contract.test.mjs
// 用 node --test 直接 import(同 stable-mutation.ts 惯例),node 不认 tsconfig 路径别名。
import { createSlotAttemptStore } from "./pending-mutation-store.ts";

/** F 直写通道「提交结果未知」:命令号已随请求出手,必须保留原号供原样重试,后端按号去重。
 *  不用构造器参数属性:node 的 strip-only 类型剥离不支持该语法,本文件要被 node --test 直接 import。 */
export class F1OutcomeUncertainError extends Error {
  readonly commandKey: string;

  constructor(message: string, commandKey: string) {
    super(message);
    this.name = "F1OutcomeUncertainError";
    this.commandKey = commandKey;
  }
}

export function isF1OutcomeUncertainError(error: unknown): error is F1OutcomeUncertainError {
  if (error instanceof F1OutcomeUncertainError) return true;
  // 鸭型兜底:打包边界下 instanceof 可能失真,与 operation-confirm-error 同款按 name + commandKey 判。
  return error instanceof Error
    && error.name === "F1OutcomeUncertainError"
    && typeof (error as Error & { commandKey?: unknown }).commandKey === "string";
}

const commandAttempts = createSlotAttemptStore({ storageKey: "nexion-admin-f1-direct-commands-v1" });

let mintSeq = 0;
function mintCommandKey(slot: string) {
  mintSeq = (mintSeq + 1) % 1_000_000;
  // 槽位含 `|` 与业务 id,清洗成 header-safe 前缀;唯一性靠时间戳 + 序号,前缀只为审计排查可读。
  return `${slot.replace(/[^A-Za-z0-9]+/g, "-")}-${Date.now()}-${mintSeq}`;
}

/**
 * F 直写族稳定命令号咽喉:同槽位同输入复用命令号(结果未知后的原样重试被后端幂等去重),
 * 成功 / 确定性失败即收敛弃号;换输入 = 新意图,铸新号并丢弃旧号(SlotAttempt 语义)。
 */
export async function f1StableWrite<T>(
  slot: string,
  inputFingerprint: string,
  request: (commandKey: string) => Promise<T>,
): Promise<T> {
  const commandKey = commandAttempts.resolve(slot, inputFingerprint, () => mintCommandKey(slot));
  try {
    const result = await request(commandKey);
    commandAttempts.forget(slot);
    return result;
  } catch (error) {
    if (!isF1OutcomeUncertainError(error)) commandAttempts.forget(slot);
    throw error;
  }
}
