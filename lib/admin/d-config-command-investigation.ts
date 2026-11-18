import { useAdminAuth } from "@/lib/store/admin-auth";
import { hasPersistedPendingCommandOwner } from "./pending-mutation-store";
import { discoverECommand, investigateECommand } from "./e-command-investigation";
import { checkFundCommand, fundCommandOrigin, fundCommandSettled, type FundCommandEvidence, type FundCommandOrigin, type FundCommandRecord } from "./fund-command-investigation";
import { fetchDirectCommandReceipt } from "./direct-command-receipt";

const directConfigOrigins = {
  D5: { originalMethod: "PUT", originalPath: "/api/admin/withdraw/limits", readAuthority: "finance_d5_read" },
  D6: { originalMethod: "PATCH", originalPath: "/api/admin/finance/fx-quote", readAuthority: "finance_d6_read" },
  D7: { originalMethod: "PATCH", originalPath: "/api/admin/finance/payout-vnd/config", readAuthority: "finance_d7_read" },
} as const;
type ConfigPage = keyof typeof directConfigOrigins;

export function dConfigCommandOrigin(page: ConfigPage) {
  const origin = directConfigOrigins[page];
  return fundCommandOrigin(origin.originalMethod, origin.originalPath, origin.readAuthority);
}

/** Optional legacy metadata is checked once by each page's persisted-record boundary. */
export function isDConfigCommandOrigin(origin: FundCommandOrigin | undefined, page: ConfigPage) {
  const expected = directConfigOrigins[page];
  return origin === undefined || !!origin && origin.originalMethod === expected.originalMethod && origin.originalPath === expected.originalPath
    && origin.readAuthority === expected.readAuthority && typeof origin.originalAdminId === "string" && /^[1-9]\d*$/.test(origin.originalAdminId);
}

/** Backend-first rollout can prove a legacy maker; never fill a missing origin with today's identity. */
export async function queryDConfigCommand(record: FundCommandRecord, page: ConfigPage, evidence?: FundCommandEvidence) {
  let receipt;
  if (record.commandOrigin) receipt = await checkFundCommand(record, evidence);
  else {
    const actor = useAdminAuth.getState().session?.adminId;
    if (!actor || !hasPersistedPendingCommandOwner(String(actor))) throw new Error("INVESTIGATION_LEGACY_ORIGIN_UNPROVEN_REMAINS_LOCKED");
    const origin = directConfigOrigins[page];
    const locator = { ...origin, originalAdminId: String(actor), commandKey: record.commandKey };
    receipt = evidence ? await investigateECommand(record, locator, evidence, origin.readAuthority) : await discoverECommand(locator);
  }
  // New receipts carry the business result; only legacy responses need the extra code lookup.
  const settled = fundCommandSettled(receipt) || !!receipt && receipt.businessState === undefined && receipt.originalStatus === "SUCCEEDED"
    && await fetchDirectCommandReceipt(receipt.scope, receipt.commandKey, receipt.originalAdminId) === "SUCCEEDED";
  return { receipt, settled };
}
