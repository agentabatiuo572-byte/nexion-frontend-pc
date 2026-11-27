export const E1_CREATE_NUMBER_UNREAD = "商品编号暂不可核对";

export function isE1CreateRequestId(value?: string) {
  return !!value && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
}

export function frozenE1CreateSkuId(after?: string) {
  try {
    const parsed: unknown = JSON.parse(after ?? "");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
    const skuId = (parsed as Record<string, unknown>).skuId;
    if (typeof skuId === "string" && skuId.trim()) return skuId.trim();
  } catch { /* A summary or a missing snapshot cannot prove the old SKU. */ }
}

export type E1CreateNumberEvidence = { after?: string; createRequestId?: string; resultSkuId?: string };

export function legacyE1CreateSkuId(row: E1CreateNumberEvidence) {
  if (!row.createRequestId && !row.resultSkuId) return frozenE1CreateSkuId(row.after);
}

export function isB138SkuId(value?: string): value is string {
  return !!value && /^[epfs]-[a-z0-9]+-\d{3}$/.test(value);
}

/** The old number comes from the frozen snapshot. B138 requires both identifiers. */
export function approvedE1CreateSkuId(row: E1CreateNumberEvidence, expectedRequestId?: string) {
  if (!expectedRequestId) {
    const old = legacyE1CreateSkuId(row);
    if (old) return old;
  }
  if (isE1CreateRequestId(row.createRequestId) && (!expectedRequestId || row.createRequestId === expectedRequestId)
      && isB138SkuId(row.resultSkuId)) return row.resultSkuId;
}

export function e1CreateNumberLabel(row: E1CreateNumberEvidence & { status?: string }, archivedNumber?: string) {
  if (legacyE1CreateSkuId(row)) return;
  switch (row.status) {
    case "pending": return isE1CreateRequestId(row.createRequestId) ? "待生成" : E1_CREATE_NUMBER_UNREAD;
    case "rejected":
    case "withdrawn":
    case "expired": return "未生成";
    case "approved": return archivedNumber ?? approvedE1CreateSkuId(row) ?? E1_CREATE_NUMBER_UNREAD;
    default: return E1_CREATE_NUMBER_UNREAD;
  }
}
