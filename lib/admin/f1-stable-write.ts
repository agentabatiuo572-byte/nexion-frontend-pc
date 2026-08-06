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

const commandAttempts = createSlotAttemptStore({ storageKey: "nexion-admin-f-direct-commands-v1" });

function mintCommandKey(slot: string) {
  // 前缀只为审计排查可读,截断防批量槽位(F5 重发含整批事件 id)撑爆 HTTP 头长度;
  // 唯一性靠随机段 —— 只用 时间戳+模块级序号 时,两个标签页同毫秒首次提交会撞出同一个号
  // (sessionStorage 各自独立、序号各自从 0 起),后端按同号去重会静默吞掉第二个人的操作。
  // randomUUID 是 secure-context-only:局域网 http://<IP>:3002 演示时不存在,必须兜底(仓内统一写法)。
  const prefix = slot.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 48);
  const random = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID().slice(0, 8)
    : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now()}-${random}`;
}

/**
 * F 直写族稳定命令号咽喉:同槽位同输入复用命令号(结果未知后的原样重试被后端幂等去重),
 * 成功即收敛弃号;换输入 = 新意图,铸新号并丢弃旧号(SlotAttempt 语义)。
 *
 * 确定性失败只在「本次是全新尝试」时弃号:复用来的号说明上一次尝试结果未知,这一次的
 * 400/409 证明不了那一次没落地,弃号会让下一次重试铸新号 → 重复执行
 * (范式同 d-client / user360-client 的 `!pendingKeyBeforeRequest` 守卫)。
 */
export async function f1StableWrite<T>(
  slot: string,
  inputFingerprint: string,
  request: (commandKey: string) => Promise<T>,
): Promise<T> {
  let mintedFresh = false;
  const commandKey = commandAttempts.resolve(slot, inputFingerprint, () => {
    mintedFresh = true;
    return mintCommandKey(slot);
  });
  try {
    const result = await request(commandKey);
    commandAttempts.forget(slot);
    return result;
  } catch (error) {
    if (mintedFresh && !isF1OutcomeUncertainError(error)) commandAttempts.forget(slot);
    throw error;
  }
}
