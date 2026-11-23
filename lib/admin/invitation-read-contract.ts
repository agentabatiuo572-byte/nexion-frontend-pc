const INVITER_STATES = ["PRESENT", "NONE", "DELETED", "UNKNOWN"] as const;
const INVITER_REASONS = ["DANGLING_SPONSOR", "ENVIRONMENT_CONFLICT", "UNKNOWN_ENVIRONMENT", "SOURCE_READ_FAILED"] as const;
const COUNT_REASONS = [
  "SOURCE_READ_FAILED", "GENERATION_UPGRADING", "CYCLE", "DUPLICATE_EDGE", "CONFLICTING_EDGE", "INVALID_ROW",
  "ENVIRONMENT_CONFLICT", "UNKNOWN_ENVIRONMENT", "MISSING_ROOT",
] as const;

export type InvitationCountReason = typeof COUNT_REASONS[number] | "UNKNOWN";
export type InvitationInviter = {
  state: typeof INVITER_STATES[number];
  userNo: string | null;
  nickname: string | null;
  reason: typeof INVITER_REASONS[number] | "UNKNOWN" | null;
};
export type InvitationInviterDetail = InvitationInviter & { navigable: boolean };
export type SupportInvitationInviterDetail = InvitationInviterDetail & { customerId: string | null };

function readReason<T extends string>(value: string, known: readonly T[]): T | "UNKNOWN" {
  return known.find(reason => reason === value) ?? "UNKNOWN";
}

export function parseInvitationCountReason(value: string): InvitationCountReason {
  return readReason(value, COUNT_REASONS);
}

function nullableText(value: unknown): string | null {
  if (value === null || typeof value === "string") return value;
  throw new Error("INVITATION_INVITER_INVALID");
}

export function parseInvitationInviter(row: Record<string, unknown>): InvitationInviter {
  const state = INVITER_STATES.find(value => value === row.state);
  if (state === undefined) throw new Error("INVITATION_INVITER_INVALID");
  const reason = nullableText(row.reason);
  return {
    state,
    userNo: nullableText(row.userNo),
    nickname: nullableText(row.nickname),
    reason: reason === null ? null : readReason(reason, INVITER_REASONS),
  };
}

export function parseInvitationInviterDetail(row: Record<string, unknown>): InvitationInviterDetail {
  if (typeof row.navigable !== "boolean") throw new Error("INVITATION_INVITER_INVALID");
  return { ...parseInvitationInviter(row), navigable: row.navigable };
}

export function parseSupportInvitationInviterDetail(row: Record<string, unknown>): SupportInvitationInviterDetail {
  return { ...parseInvitationInviterDetail(row), customerId: nullableText(row.customerId) };
}
