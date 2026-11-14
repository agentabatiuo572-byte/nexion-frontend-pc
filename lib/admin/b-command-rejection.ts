import { isExplicitRejection } from "./explicit-rejection";
import { isDeterministicRejection, isIdempotencyOutcomeOpen } from "./outcome-classification";

/** A first refusal says this attempt did not run; a retry must resolve the original command. */
export function isBCommandRejection(error: unknown, retry: boolean): boolean {
  if (retry) return isExplicitRejection(error);
  if (!error || typeof error !== "object" || !("status" in error) || typeof error.status !== "number") return false;
  const value = error as { status: number; code?: number; reasonCode?: string; backendMessage?: string; unknownOutcome?: boolean };
  return value.unknownOutcome !== true && !isIdempotencyOutcomeOpen(value.reasonCode ?? value.backendMessage)
    && isDeterministicRejection(value.status, value.code);
}
