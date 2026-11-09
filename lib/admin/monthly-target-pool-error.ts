import { guardedFetch } from "./error-messages";
import { parseE1SkuPage } from "./e1-overview-contract";

/** Resolve the backend's affected IDs from the catalog, including delisted models. */
export async function monthlyTargetPoolErrorText(message: string | null | undefined, data: unknown): Promise<string | null> {
  if (message !== "MONTHLY_TARGET_POOL_INELIGIBLE") return null;
  const instruction = "设了月收益目标的型号只能使用正额 USDT、时长不超过 120 分钟的任务。请核对任务等级及任务配置后重新提交。";
  if (!data || typeof data !== "object" || Array.isArray(data)) return `任务配置不符合月收益目标要求。${instruction}受影响型号信息缺失，请核对商品配置。`;
  const ids = (data as Record<string, unknown>).affectedSkuIds;
  if (!Array.isArray(ids) || !ids.length || !ids.every((id): id is string => typeof id === "string" && id.trim() !== "")) {
    return `任务配置不符合月收益目标要求。${instruction}受影响型号信息缺失，请核对商品配置。`;
  }
  const names = new Map<string, string>();
  try {
    let pageNum = 1;
    while (ids.some((id) => !names.has(id))) {
      const response = await guardedFetch(`/api/admin/e1/skus?pageNum=${pageNum}&pageSize=100`, { cache: "no-store" });
      const result = await response.json() as { code?: number; data?: unknown };
      if (!response.ok || result.code !== 0) throw new Error("E1_SKU_NAMES_UNAVAILABLE");
      const page = parseE1SkuPage<unknown>(result.data);
      for (const row of page.records) {
        if (!row || typeof row !== "object" || Array.isArray(row)) continue;
        const sku = row as Record<string, unknown>;
        if (typeof sku.skuId === "string" && typeof sku.name === "string" && sku.name.trim()) names.set(sku.skuId, sku.name);
      }
      if (page.pageNum * page.pageSize >= page.total) break;
      pageNum += 1;
    }
  } catch {
    // Name lookup must not hide the original deterministic rejection; unresolved IDs stay explicit below.
  }
  const affected = ids.map((id) => names.has(id) ? `「${names.get(id)}」` : `「${id}」（名称暂未加载）`).join("、");
  return `受影响型号：${affected}。${instruction}`;
}
