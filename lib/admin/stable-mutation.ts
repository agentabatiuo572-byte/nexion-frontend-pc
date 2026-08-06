// 相对路径 + 显式 .ts 后缀,而非 `@/` 别名:本模块被 tests/g-overview-runtime-contract.test.mjs 用
// node --test 直接 import,node 既不认 tsconfig 的路径别名,也不做无后缀补全
// (tsconfig 已开 allowImportingTsExtensions,tsc 与 next build 都吃这种写法)。
import { isDeterministicRejection } from "./outcome-classification.ts";
import { createPendingMutationStore } from "./pending-mutation-store.ts";

export type StableMutationCommand<T> = (commandKey: string) => Promise<T>;

/** 命令指纹:动作类型(method + path)+ 目标对象 id(在 path 里)+ 请求体。 */
export function stableMutationFingerprint(method: string, path: string, body: string) {
  return `${method.toUpperCase()} ${path}\n${body}`;
}
export type StableMutationAccept<T, R> = (value: T) => R;
export type StableMutationFailureKind = "deterministic" | "outcome-unknown";

export class StableMutationFailure extends Error {
  readonly kind: StableMutationFailureKind;

  constructor(kind: StableMutationFailureKind, message: string) {
    super(message);
    this.name = "StableMutationFailure";
    this.kind = kind;
  }
}

export function classifyStableMutationFailure(error: unknown): StableMutationFailureKind {
  return error instanceof StableMutationFailure ? error.kind : "outcome-unknown";
}

export function stableMutationHttpFailure(
  message: string,
  status: number,
  apiCode?: number,
) {
  // 🔴 判据只此一处(2026-08-06 独立验收 P1-3):这里原本有一份与共享谓词**逐字等价的副本**,
  //   局部常量还叫 isDeterministicRejection,读起来像引用了共享的那个。g1/g2/g3/g4/g7 五个域
  //   走的正是这份副本 —— 两源并存,改一处另一处不动,口径迟早分叉。
  return new StableMutationFailure(
    isDeterministicRejection(status, apiCode) ? "deterministic" : "outcome-unknown",
    message,
  );
}

/**
 * 通用「结果未知就复用同一命令号」执行器。
 *
 * storageKey 是必填的:命令号必须跨刷新存活,否则运营刷新后重试会铸新号,后端无法去重 →
 * 重复入账 / 重复处置。每个域各用各的键,共用一把会让不同域的在途命令号互相覆盖。
 *
 * ⚠ fingerprint 必须由调用方把「动作类型 + 目标对象 id」都编码进去(推荐 `${method} ${path}\n${body}`)。
 * 只传 body 会让「同一动作打到不同目标、恰好参数相同」的两条命令共用一个命令号 —— 后端按幂等
 * 去重,第二个目标的改动被静默吞掉。2026-08-04 g1(不同质押档)与 g2(不同兑换单)就是这么撞的。
 */
export function createStableMutationExecutor(
  nextCommandKey: (prefix: string) => string,
  storageKey: string,
) {
  const pendingKeys = createPendingMutationStore({ storageKey });

  return async function executeStableMutation<T, R>(
    prefix: string,
    fingerprint: string,
    command: StableMutationCommand<T>,
    accept: StableMutationAccept<T, R>,
  ): Promise<R> {
    const intent = `${prefix}:${fingerprint}`;
    const commandKey = pendingKeys.get(intent) ?? nextCommandKey(prefix);
    pendingKeys.remember(intent, commandKey);
    try {
      const raw = await command(commandKey);
      const accepted = accept(raw);
      pendingKeys.forget(intent);
      return accepted;
    } catch (error) {
      if (classifyStableMutationFailure(error) === "deterministic") {
        pendingKeys.forget(intent);
      }
      throw error;
    }
  };
}
