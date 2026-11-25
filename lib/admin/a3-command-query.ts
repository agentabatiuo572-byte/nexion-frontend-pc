import { fundCommandOrigin, fundCommandSettled, type FundCommandEvidence, type FundCommandRecord } from "./fund-command-investigation";
import { A3_CONTENT_COMMANDS } from "./e-command-investigation";
import { fetchDirectCommandReceiptDetails } from "./direct-command-receipt";
import { queryOriginalCommand } from "./original-command-query";
import type { A3Original } from "./a3-mutations";

export const a3ParamCommandRoutes = {
  A3: { originalMethod: "PUT", originalPath: "/api/admin/platform/config", readAuthority: "platform_a3_read" },
  K1: { originalMethod: "PATCH", originalPath: "/api/admin/risk/multi-account/registration-params", readAuthority: "risk_k1_read" },
} as const;

export function a3ParamCommandOrigin(page: keyof typeof a3ParamCommandRoutes) {
  const route = a3ParamCommandRoutes[page];
  return fundCommandOrigin(route.originalMethod, route.originalPath, route.readAuthority);
}

export async function queryA3ParamCommand(record: FundCommandRecord, page: keyof typeof a3ParamCommandRoutes, owner: string, paramKey: string, evidence?: FundCommandEvidence) {
  const receipt = await queryOriginalCommand(record, a3ParamCommandRoutes[page], owner, evidence);
  if (receipt && receipt.originalTarget !== paramKey) throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
  return { receipt, settled: fundCommandSettled(receipt) };
}

/** Current reads are only a fallback; the stored command must prove the original result. */
export async function queryA3ConfigCommand(record: FundCommandRecord, original: Extract<A3Original, { kind: "flag" | "experience" }>, owner: string, evidence?: FundCommandEvidence) {
  const route = { originalMethod: "PUT", originalPath: original.kind === "flag"
    ? "/api/admin/platform/config" : "/api/admin/platform/config/experience", readAuthority: "platform_a3_read" } as const;
  const receipt = await queryOriginalCommand(record, route, owner, evidence);
  const scope = original.kind === "flag" ? `A3_FEATURE_FLAG:${original.row.key}`.toUpperCase() : "A3_PLATFORM_EXPERIENCE";
  // The stored scope is uppercase; the server-bound target preserves the physical key's case.
  const target = original.kind === "flag" ? `feature.${original.row.key}` : "A3_PLATFORM_EXPERIENCE";
  if (receipt && (receipt.scope !== scope || receipt.originalTarget !== target)) throw new Error("INVESTIGATION_RECEIPT_UNREADABLE");
  return { receipt, settled: fundCommandSettled(receipt) };
}

export async function queryA3ContentCommand(record: FundCommandRecord, kind: keyof typeof A3_CONTENT_COMMANDS, owner: string, evidence?: FundCommandEvidence) {
  const receipt = await queryOriginalCommand(record, {
    originalMethod: "PUT", originalPath: A3_CONTENT_COMMANDS[kind].path, readAuthority: "platform_a3_read",
  }, owner, evidence);
  // The identity lookup includes the business code. Only the status endpoint projects the stored rejection message.
  const rejected = receipt?.originalStatus === "SUCCEEDED" && receipt.businessState === "REJECTED";
  const detail = rejected ? await fetchDirectCommandReceiptDetails(receipt.scope, record.commandKey, Number(owner)).catch(() => null) : null;
  return {
    receipt, settled: fundCommandSettled(receipt), rejected,
    rejectionReason: detail?.state === "REJECTED" && detail.businessCode === receipt?.businessCode ? detail.businessMessage : undefined,
  };
}
