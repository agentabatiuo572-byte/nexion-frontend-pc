// Names, authored copy and asset labels come from their source. Existing
// consumer entry points preserve historical values until the source is corrected.
export function nexGridBrandText(value: string): string { return value; }
export function userNicknameText(value: string, _phoneMasked: unknown): string { return value; }
export function platformSessionDeviceText(value: string): string { return value; }
export function operatorNicknameText(value: string): string { return value; }
export function datacenterNameText(value: string): string { return value; }

/** Localize the fixed ticket-subject format; preserve its authored name. */
export function supportTicketSubjectText(value: string): string {
  return value.replace(/^Conversation (CV-[A-Za-z0-9-]+)$/, "会话 $1");
}
export function platformAssetText(value: string): string { return value; }
