import { fetchDirectCommandReceipt } from "./direct-command-receipt";
import { fundCommandOrigin, fundCommandResult, type FundCommandEvidence, type FundCommandRecord } from "./fund-command-investigation";
import { queryOriginalCommand } from "./original-command-query";

export function f4MaterialCommandOrigin(applicationId: number) {
  return fundCommandOrigin("POST", `/api/admin/teams/ambassador-applications/${applicationId}/materials/review`, "network_f4_read");
}

export async function queryF4MaterialCommand(record: FundCommandRecord & { actorId: number; applicationId: number }, evidence?: FundCommandEvidence) {
  const route = { originalMethod: "POST", originalPath: `/api/admin/teams/ambassador-applications/${record.applicationId}/materials/review`, readAuthority: "network_f4_read" } as const;
  const query = () => queryOriginalCommand(record, route, String(record.actorId), evidence);
  const receipt = evidence ? await query() : await query().catch(() => null);
  const result = fundCommandResult(receipt);
  if (result === "SUCCEEDED" || result === "NOT_EXECUTED") return { receipt, outcome: result };
  if (receipt?.originalStatus === "CONFIRMED_REJECTED") return { receipt, outcome: "REJECTED" as const };
  if (receipt?.businessState !== undefined) return { receipt, outcome: null };
  // F4's status endpoint accepts exactly actor:application and checks the retained business code.
  const state = await fetchDirectCommandReceipt(`F4_MATERIAL_REVIEW:${record.actorId}:${record.applicationId}`, record.commandKey, record.actorId).catch(() => null);
  return { receipt, outcome: state === "SUCCEEDED" ? "SUCCEEDED" as const : state === "REJECTED" ? "REJECTED" as const : null };
}
