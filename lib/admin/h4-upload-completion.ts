import { h4CommandStores } from "./h4-command-store";
import { useAdminAuth } from "@/lib/store/admin-auth";
import type { CommandReceipt } from "./promotion-types";
import type { H4Command } from "./h4-mutations";

/** A successful save consumes only the asset included in that exact original command. */
export function completeH4Uploads(intent: { operation: string; targetId: string; body: unknown }, receipt: CommandReceipt) {
  if (receipt.status !== "SUCCEEDED" || !intent.body || typeof intent.body !== "object") return;
  const body = intent.body as { expectedRevision?: number; draft?: { bannerAssetId?: string | null }; evidenceRefs?: string[] };
  const owner = useAdminAuth.getState().session?.adminId;
  for (const storage of Object.values(h4CommandStores)) for (const raw of storage.list()) {
    const record = raw as H4Command;
    if (owner === undefined || record.owner !== owner || !record.asset) continue;
    const target = record.uploadTarget;
    if (!target || target.objectId !== intent.targetId || target.revision !== body.expectedRevision) continue;
    const saved = target.kind === "banner"
      ? intent.operation === "saveDraft" && body.draft?.bannerAssetId === record.asset?.assetId
        && receipt.resource?.type === "VERSION" && receipt.resource.id === `${target.objectId}:${target.version}`
      : intent.operation === target.operation && body.evidenceRefs?.includes(record.asset!.assetId)
        && receipt.resource?.type === "REWARD" && receipt.resource.id === target.objectId;
    if (saved) {
      storage.forget(record.fingerprint, record.commandKey);
      if (typeof window !== "undefined") window.dispatchEvent(new Event("admin-h4-pending-changed"));
    }
  }
}
