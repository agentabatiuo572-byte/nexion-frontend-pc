import type { AccountDeletionRequest } from "@/lib/admin/account-deletion-client";

/**
 * List refreshes may carry a newer version of the row currently in the drawer.
 * Only that same request is eligible to replace the drawer selection.
 */
export function syncSelectedAccountDeletion(
  selected: AccountDeletionRequest | null,
  records: readonly AccountDeletionRequest[],
): AccountDeletionRequest | null {
  if (!selected) return null;
  return records.find((item) => item.requestNo === selected.requestNo) ?? selected;
}

/** A late read/write result must not replace a newer selection or reopen a closed drawer. */
export function isCurrentAccountDeletionSelection(
  selectedRequestNo: string | null,
  requestNo: string,
  activeGeneration: number,
  requestGeneration: number,
): boolean {
  return selectedRequestNo === requestNo && activeGeneration === requestGeneration;
}

/** Only the most recent list request can publish rows, errors, or loading completion. */
export function isCurrentAccountDeletionListRead(activeGeneration: number, requestGeneration: number): boolean {
  return activeGeneration === requestGeneration;
}
