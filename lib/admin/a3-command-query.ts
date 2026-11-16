import { fundCommandOrigin, fundCommandSettled, type FundCommandEvidence, type FundCommandRecord } from "./fund-command-investigation";
import { queryOriginalCommand } from "./original-command-query";

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
