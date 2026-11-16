import { useAdminAuth } from "@/lib/store/admin-auth";
import { hasPersistedPendingCommandOwner } from "./pending-mutation-store";
import { discoverECommand, investigateECommand } from "./e-command-investigation";
import { checkFundCommand, type FundCommandEvidence, type FundCommandOrigin, type FundCommandRecord } from "./fund-command-investigation";

export type OriginalCommandRoute = Omit<FundCommandOrigin, "originalAdminId">;

/** Validate optional origin metadata at each persisted-record boundary. */
export function isOriginalCommandOrigin(value: unknown, route: OriginalCommandRoute) {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const origin = value as Record<string, unknown>;
  return origin.originalMethod === route.originalMethod && origin.originalPath === route.originalPath
    && origin.readAuthority === route.readAuthority && typeof origin.originalAdminId === "string" && /^[1-9]\d*$/.test(origin.originalAdminId);
}

/** Legacy ownership only permits discovery; the server must prove the original actor and locator. */
export async function queryOriginalCommand(record: FundCommandRecord, route: OriginalCommandRoute, owner: string, evidence?: FundCommandEvidence) {
  const auth = useAdminAuth.getState();
  if (!auth.isAuthenticated || auth.logoutPending || auth.logoutUnknown || auth.session?.passwordChangeRequired
    || String(auth.session?.adminId) !== owner || !auth.session?.authorities.includes(route.readAuthority)
    || record.commandOrigin && record.commandOrigin.originalAdminId !== owner) throw new Error("COMMAND_INVESTIGATION_FORBIDDEN");
  if (record.commandOrigin) return checkFundCommand(record, evidence);
  if (!hasPersistedPendingCommandOwner(owner)) throw new Error("INVESTIGATION_LEGACY_ORIGIN_UNPROVEN_REMAINS_LOCKED");
  const locator = { ...route, originalAdminId: owner, commandKey: record.commandKey };
  return evidence ? investigateECommand(record, locator, evidence, route.readAuthority) : discoverECommand(locator);
}
