/**
 * 「解除待确认」的判断（OP-96、OP-153）：按原操作重试失败后，只有后端对这条命令下了结论，才给人核实后放开本页的锁。
 *
 * 明确拒绝 = 带原因码的 4xx。下面这些都不算，原命令照旧保留，页面不放出「解除待确认」：
 * - 401、403、408、425、429：登录、权限、超时、太早、限流，说的是这次请求没被处理，不是对命令的结论；
 * - IDEMPOTENCY_*：幂等层的状态（处理中、结果查不清、内容和原号对不上）；
 * - 结果未知、处理中、响应读不懂、本地没发出去（没有状态码）。
 *
 * 原因码在 D 域和付款接口的 reasonCode，审批接口的 backendMessage。D1、D2、D5、D6、D7 的重试被拒都按这一条判断。
 * 新命令被拒后丢不丢号是另一件事，按 outcome-classification 的口径，不用这条。
 */
import { isA2OutcomeUncertainError } from "./a2-client";
import { isDOutcomeUnknownError } from "./d-client";
import { isOutcomeUnknownError } from "./outcome-classification";

const NOT_A_VERDICT = new Set([401, 403, 408, 425, 429]);

export function isExplicitRejection(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (isDOutcomeUnknownError(error) || isA2OutcomeUncertainError(error) || isOutcomeUnknownError(error)) return false;
  const value = error as { status?: unknown; reasonCode?: unknown; backendMessage?: unknown; unknownOutcome?: unknown };
  if (value.unknownOutcome === true) return false;
  const code = typeof value.reasonCode === "string" ? value.reasonCode : typeof value.backendMessage === "string" ? value.backendMessage : "";
  return typeof value.status === "number" && value.status >= 400 && value.status < 500 && !NOT_A_VERDICT.has(value.status)
    && code !== "" && !code.startsWith("IDEMPOTENCY_");
}
