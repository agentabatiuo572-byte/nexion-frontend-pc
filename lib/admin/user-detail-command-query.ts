import { useAdminAuth } from "@/lib/store/admin-auth";
import { hasPersistedPendingCommandOwner } from "./pending-mutation-store";
import { fundCommandOrigin, fundCommandSettled, type FundCommandEvidence, type FundCommandRecord } from "./fund-command-investigation";
import { queryOriginalCommand, type OriginalCommandRoute } from "./original-command-query";

type UserDetailTarget = { kind: "nickname" | "unbind" | "rebind" | "replace" | "recycle"; userId: string; methodId?: number };

export function userDetailCommandRoute(command: UserDetailTarget): OriginalCommandRoute {
  const user = encodeURIComponent(command.userId);
  return { originalMethod: "POST",
    originalPath: command.kind === "replace" || command.kind === "recycle" ? `/api/admin/devices/users/${user}/tradein/${command.kind}`
      : command.kind === "nickname" ? `/api/admin/users/profiles/${user}/nickname/reset`
        : `/api/admin/users/profiles/${user}/payment-methods/${command.methodId}/${command.kind === "unbind" ? "unbind" : "rebind-notification"}`,
    readAuthority: command.kind === "replace" || command.kind === "recycle" ? "user_c2_read" : "user_c1hub_read" };
}

export function userDetailCommandOrigin(command: UserDetailTarget) {
  const route = userDetailCommandRoute(command);
  return fundCommandOrigin(route.originalMethod, route.originalPath, route.readAuthority);
}

export async function queryUserDetailCommand(record: FundCommandRecord & UserDetailTarget & { adminKey: string; legacy?: boolean }, evidence?: FundCommandEvidence) {
  const actor = String(useAdminAuth.getState().session?.adminId);
  const owner = record.adminKey || (record.legacy && hasPersistedPendingCommandOwner(actor) ? actor : "");
  const receipt = await queryOriginalCommand(record, userDetailCommandRoute(record), owner, evidence);
  return { receipt, settled: fundCommandSettled(receipt) };
}
