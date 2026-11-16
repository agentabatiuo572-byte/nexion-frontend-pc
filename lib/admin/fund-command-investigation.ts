import { useAdminAuth } from "@/lib/store/admin-auth";
import { discoverECommand, investigateECommand, type ECommandEvidence, type ECommandInvestigation, type ECommandLocator } from "./e-command-investigation";
import { formatAdminApiError } from "./error-messages";
import type { PendingMutationRecord } from "./pending-mutation-store";

export type FundCommandOrigin = Omit<ECommandLocator, "commandKey"> & {
  readAuthority: "finance_d2_read" | "finance_d3_read" | "device_e4_read" | "emergency_j1_read" | "emergency_j2_read" | "emergency_j3_read" | "emergency_j4_read" | "risk_k1_read" | "bi_l1_read" | "finance_d5_read" | "finance_d6_read" | "finance_d7_read" | "content_i1_read" | "content_i2_read" | "content_i3_read" | "content_i6_read"
    | "network_f1_read" | "network_f2_read" | "network_f3_read" | "network_f4_read" | "network_f5_read"
    | "bi_l2_read" | "bi_l3_read" | "bi_l4_read" | "bi_l5_read" | "platform_a3_read";
};
export type FundCommandRecord = PendingMutationRecord & { commandOrigin?: FundCommandOrigin };
export type FundInvestigationOutcome = { receipt: ECommandInvestigation | null } | { error: string };
export type FundInvestigationAccess = {
  canRead: boolean; canSubmit: boolean; requiredRole: "superadmin";
  requiredAuthorities: string[]; proposalReadAnyOf?: string[]; unavailableReason?: "MISSING_ORIGIN" | "UNSUPPORTED_SCOPE";
};

/** Persisted with the first request, never reconstructed using a later operator. */
export function fundCommandOrigin(originalMethod: FundCommandOrigin["originalMethod"], originalPath: string, readAuthority: FundCommandOrigin["readAuthority"]): FundCommandOrigin {
  return { originalMethod, originalPath, readAuthority, originalAdminId: String(useAdminAuth.getState().session?.adminId ?? "") };
}

export function fundInvestigationAccess(record: FundCommandRecord): FundInvestigationAccess {
  const session = useAdminAuth.getState().session;
  const origin = record.commandOrigin;
  const requiredAuthorities: string[] = ["platform_a2_unknown_investigate", ...(origin ? [origin.readAuthority] : [])];
  const proposal = origin?.originalPath === "/api/admin/platform/audit/operations";
  const proposalRead = !proposal || !!session?.authorities.some(code => ["platform_a2_read", "platform_a2_proposal_create"].includes(code));
  const unavailableReason = !origin ? "MISSING_ORIGIN" as const
    : /\/(?:cregis\/recover|bank\/requery)$/.test(origin.originalPath) ? "UNSUPPORTED_SCOPE" as const : undefined;
  const investigator = session?.role === "superadmin" && session.authorities.includes("platform_a2_unknown_investigate");
  const businessRead = !!origin && !!session?.authorities.includes(origin.readAuthority);
  return { requiredRole: "superadmin", requiredAuthorities, ...(proposal ? { proposalReadAnyOf: ["platform_a2_read", "platform_a2_proposal_create"] } : {}), unavailableReason,
    canRead: !unavailableReason && businessRead && proposalRead && (String(session?.adminId) === origin?.originalAdminId || !!investigator),
    canSubmit: !unavailableReason && businessRead && proposalRead && !!investigator };
}

/** Server-owned scope/hash/targets are discovered from the saved original locator. */
export async function checkFundCommand(record: FundCommandRecord, evidence?: ECommandEvidence): Promise<ECommandInvestigation | null> {
  const access = fundInvestigationAccess(record);
  if (access.unavailableReason) throw new Error(formatAdminApiError(access.unavailableReason === "MISSING_ORIGIN"
    ? "INVESTIGATION_LEGACY_ORIGIN_UNPROVEN_REMAINS_LOCKED" : "INVESTIGATION_SCOPE_UNSUPPORTED", "INVESTIGATION_RECEIPT_UNREADABLE"));
  const origin = record.commandOrigin!;
  // Persistence is an untrusted boundary; malformed legacy metadata cannot bind another command.
  if (typeof origin.originalAdminId !== "string" || !/^[1-9]\d*$/.test(origin.originalAdminId) || !["POST", "PUT", "PATCH", "DELETE"].includes(origin.originalMethod)
    || typeof origin.originalPath !== "string" || !origin.originalPath.startsWith("/api/admin/")) throw new Error(formatAdminApiError("INVESTIGATION_ORIGINAL_LOCATOR_INVALID", "INVESTIGATION_RECEIPT_UNREADABLE"));
  if (evidence ? !access.canSubmit : !access.canRead) throw new Error(formatAdminApiError("COMMAND_INVESTIGATION_FORBIDDEN", "COMMAND_INVESTIGATION_FORBIDDEN"));
  const locator = { ...origin, commandKey: record.commandKey };
  if (evidence) return investigateECommand(record, locator, evidence, origin.readAuthority);
  return discoverECommand(locator);
}

export { eCommandSettled as fundCommandSettled, eCommandResult as fundCommandResult } from "./e-command-investigation";
export type { ECommandEvidence as FundCommandEvidence, ECommandInvestigation as FundCommandInvestigation };
