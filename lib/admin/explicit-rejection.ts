/**
 * 「解除待确认」的判断（OP-96、OP-153）：按原操作重试失败后，只有后端对这条命令下了结论，才给人核实后放开本页的锁。
 *
 * 明确拒绝 = 带原因码的 4xx，或下方精确 K3 写前业务拒绝 503。下面这些都不算，原命令照旧保留，页面不放出「解除待确认」：
 * - 401、403、408、425、429：登录、权限、超时、太早、限流，不是对命令的结论；403 仅下方精确业务码名单例外；
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
const BUSINESS_REJECTION_BEFORE_WRITE = new Set([
  // Backend 441c412b (f972feb4), market/application/OpsNexMarketService.java:
  // prepareMarketPolicy:1248–1250 rejects before review and A2 ticket/lock inserts;
  // updateWeeklyCurve:1413 rejects before applyWeeklyCurve's first config write (:1428);
  // updateOverride:1588–1589 rejects before applyCurrentPriceOverride writes/publishes (:1737–1748).
  // All three paths have made no market mutation; command/A2 requireSuccess also rolls back failure.
  // validateLegacyMarketProposal:1210 rejects older proposal commands before A2 ticket/lock inserts too.
  // These four business guards now return 422 and use the ordinary 4xx verdict path.
  // Keep the exact-code 403 exception for older responses; no other 403 is a verdict.
  "G3_MANUAL_TUNING_FORBIDDEN_IN_PRODUCTION",
  // Backend 0e301ad5 rejects an unapproved I3 cap PATCH inside the idempotency
  // callback before reading/updating the rule or applying notification retention.
  // Stored successful commands replay before this guard.
  "NOTIFICATION_CAP_APPROVAL_REQUIRED",
  // Backend db65d2e7: the exact test profile rejects formal I6/I7 catalog
  // mutations before command idempotency, audit, outbox or business writes.
  "LEARNING_ACCEPTANCE_PRODUCTION_MUTATION_FORBIDDEN",
]);

export function isExplicitRejection(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (isDOutcomeUnknownError(error) || isA2OutcomeUncertainError(error) || isOutcomeUnknownError(error)) return false;
  const value = error as { status?: unknown; reasonCode?: unknown; backendMessage?: unknown; unknownOutcome?: unknown; f4PayoutCoverageRefusal?: unknown };
  if (value.unknownOutcome === true) return false;
  const code = typeof value.reasonCode === "string" ? value.reasonCode : typeof value.backendMessage === "string" ? value.backendMessage : "";
  // These receipts exist, but their original actor cannot be verified. The
  // refusal to replay them does not establish whether the original write ran.
  if (code === "ACCOUNT_LEGACY_COMMAND_REVIEW_REQUIRED" || code === "A6_RECEIPT_OWNER_UNVERIFIED") return false;
  // ef4b1a5a refuses to expose an existing K4 batch receipt when its owner or content cannot be proved.
  if (code === "K4_SCORE_BATCH_RECEIPT_OWNER_UNPROVEN" || code === "K4_SCORE_BATCH_RECEIPT_UNREADABLE") return false;
  // 441c412b OpsRiskService.requireK3CoveragePrecheck rejects before either rule UPDATE,
  // inside the idempotency callback. Only this exact 503 is a business verdict.
  if (value.status === 503 && code === "K3_COVERAGE_UNAVAILABLE") return true;
  // 41a552fa: only the A2 client's identified F4 approved-payout pre-write refusal.
  if (value.status === 503 && code === "COVERAGE_SNAPSHOT_UNAVAILABLE" && value.f4PayoutCoverageRefusal === true) return true;
  return typeof value.status === "number" && value.status >= 400 && value.status < 500
    && (!NOT_A_VERDICT.has(value.status) || value.status === 403 && BUSINESS_REJECTION_BEFORE_WRITE.has(code))
    && code !== "" && !code.startsWith("IDEMPOTENCY_");
}
