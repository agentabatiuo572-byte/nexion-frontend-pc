import type { OpsSku } from "@/lib/admin/platform-types";
import type { A2OperationRow } from "@/lib/admin/a2-client";
import type { ProposeSpec } from "@/lib/admin/propose-or-execute";
import type { SkuForm } from "./data";
import { skuSeriesText } from "@/lib/admin/device-monthly-target";
import { skuBadgeReviewText, skuTaglineReviewRows } from "@/lib/admin/e1-product-copy";
import { createPendingMutationStore, isPendingCommandOwnedBy, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";
import { e1Amount, e1Decimal, e1GateText, e1Number, e1NumericReviewValue, e1Precision, e1ReviewValue, e1Value } from "@/lib/admin/e1-product-review";
export { e1Amount, e1Decimal, e1GateText, e1Number, e1NumericReviewValue, e1Precision, e1ReviewValue, e1Value } from "@/lib/admin/e1-product-review";

export const E1_LEVELS = [
  { key: "L1", label: "L1", name: "初级" }, { key: "L2", label: "L2", name: "中级" },
  { key: "L3", label: "L3", name: "高级" }, { key: "L4", label: "L4", name: "旗舰" },
] as const;

/** Exact decimal multiplication for labels and catalogue totals. No currency conversion. */
export function e1Multiply(a: number | string, b: number | string): string {
  const parts = [a, b].map((value) => {
    const raw = e1Number(value).replaceAll(",", "");
    const [whole, fraction = ""] = raw.split(".");
    return { integer: BigInt(whole + fraction), scale: fraction.length };
  });
  const product = parts[0].integer * parts[1].integer;
  const scale = parts[0].scale + parts[1].scale;
  const sign = product < BigInt("0") ? "-" : "";
  const digits = String(product < BigInt("0") ? -product : product).padStart(scale + 1, "0");
  return sign + (scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, "") : digits);
}

export function e1Range(target: number | string, band: number | string) {
  // Band is contractually at most one decimal; thousandths are exact integers.
  const bandThousandths = Math.round(Number(band) * 10);
  return { low: e1Multiply(target, String((1000 - bandThousandths) / 1000)), high: e1Multiply(target, String((1000 + bandThousandths) / 1000)) };
}

export function e1TargetPrecision(sku: Pick<OpsSku, "monthlyTargetUsdt" | "monthlyTargetBandPct">): number {
  const range = sku.monthlyTargetUsdt != null && sku.monthlyTargetBandPct != null ? e1Range(sku.monthlyTargetUsdt, sku.monthlyTargetBandPct) : undefined;
  return e1Precision([sku.monthlyTargetUsdt, range?.low, range?.high]);
}

export function e1Object(spec: ProposeSpec): string {
  const target = spec.target ?? spec.targets?.[0];
  if (target?.type === "device_generation_gate") {
    const id = spec.command.op === "e1_gate_field" ? String(spec.command.params.key).replace(/^E\.gen\./, "").replace(/\.(phaseOffset|forceUnlock)$/, "") : String(spec.command.params.skuId);
    return `device_generation_gate|${id}`;
  }
  return target ? `${target.type}|${target.id}` : `${spec.command.op}|${spec.obj}`;
}

export type E1Pending = PendingMutationRecord & {
  actorId: string; spec: ProposeSpec; verifiedNotExecuted?: true;
  ticket?: Pick<A2OperationRow, "id" | "status" | "resultSkuId">;
  mediaDraftId?: string; replacesDraftKey?: string; superseded?: true;
  skuForm?: SkuForm; skuBaseline?: OpsSku; operator?: string; operatorRole?: string;
  receivedTicketId?: string; absent?: boolean; retryRejection?: string;
};

export function e1CreateRequestId(spec: ProposeSpec) {
  const id = spec.command.params.createRequestId;
  return spec.command.op === "e1_sku_create" && typeof id === "string" && id ? id : undefined;
}

/** The current service binds the ticket to a server-normalized SKU from the name or old skuId. */
export function e1LegacyCreateSkuId(spec: ProposeSpec) {
  const { name, skuId } = spec.command.params;
  const value = typeof skuId === "string" && skuId.trim() ? skuId : typeof name === "string" ? name : spec.obj;
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
const validProposal = (row: E1Pending) => typeof row.actorId === "string" && !!row.actorId
  && typeof row.spec?.reason === "string" && row.spec.sourceDomain === "E1"
  && typeof row.spec?.obj === "string" && typeof row.spec?.command?.op === "string"
  && row.spec.command.op.startsWith("e1_") && !!row.spec.command.params
  && (row.absent === undefined || typeof row.absent === "boolean")
  && (row.receivedTicketId === undefined || typeof row.receivedTicketId === "string")
  && (row.retryRejection === undefined || typeof row.retryRejection === "string");
export const e1Commands = createPendingMutationStore<E1Pending>({
  storageKey: "nexion-admin-e1-proposal-commands-v1", retainExpiredRecords: true, isValidRecord: validProposal,
});
// Preserve the previous monthly-target table and its original sku| fingerprint.
export const e1MonthlyCommands = createPendingMutationStore<E1Pending>({
  storageKey: "nexion-admin-e1-monthly-target-commands-v1", retainExpiredRecords: true,
  isValidRecord: (row) => typeof row.actorId === "string" && !!row.actorId
    && row.fingerprint === `sku|${row.spec?.obj}` && typeof row.spec?.reason === "string"
    && ["e1_sku_create", "e1_sku_update"].includes(row.spec?.command?.op)
    && (row.absent === undefined || typeof row.absent === "boolean")
  && (row.receivedTicketId === undefined || typeof row.receivedTicketId === "string")
  && (row.retryRejection === undefined || typeof row.retryRejection === "string"),
});
export const e1Pending = (actorId: string) => [...e1Commands.list(), ...e1MonthlyCommands.list()].filter((row) => row.actorId === actorId);
export const forgetE1 = (row: E1Pending) => (row.fingerprint.startsWith("sku|") ? e1MonthlyCommands : e1Commands).forget(row.fingerprint, row.commandKey);

export type E1MediaPending = PendingMutationRecord & {
  actorId: string; skuId: string; draftId?: string; draftForm?: SkuForm; fileName: string; size: number; mime: string; digest: string;
  kind: "image" | "video"; params: { domain: string; usage: string; entityType: string; entityId: string; operator: string };
};
export function e1MediaHasOwner(record: E1MediaPending) {
  return record.skuId ? record.params.entityId === record.skuId : !!record.draftId && !!record.draftForm;
}
export const e1MediaCommands = createPendingMutationStore<E1MediaPending>({
  storageKey: "nexion-admin-e1-media-commands-v1", retainExpiredRecords: true,
  isValidRecord: row => typeof row.actorId === "string" && !!row.actorId && typeof row.fileName === "string"
    && typeof row.digest === "string" && /^[a-f0-9]{64}$/.test(row.digest) && Number.isFinite(row.size)
    && typeof row.mime === "string" && typeof row.skuId === "string" && ["image", "video"].includes(row.kind)
    && row.params?.domain === "E" && row.params.entityType === "SKU" && typeof row.params.operator === "string",
});

export function e1PendingMediaFor(actorId: string, skuId?: string, draftId?: string) {
  return e1MediaCommands.list().find(row => row.actorId === actorId && (skuId ? row.skuId === skuId
    : !!draftId && !row.skuId && row.draftId === draftId));
}
export const E1_PENDING_MEDIA = "请从原上传记录打开核对。";

export type E1Legacy = PendingMutationRecord & { inputFingerprint: string };
/** Old slots have no reason/actor/envelope. Read only, never resolve or expire them. */
export function e1LegacyCommands(actorId: string): E1Legacy[] {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem("nexion-admin-e-domain-commands-v1") ?? "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return [];
    return Object.entries(saved).flatMap(([key, value]) => {
      if (!value || typeof value !== "object") return [];
      const row = value as E1Legacy;
      return isPendingCommandOwnedBy(row, actorId) && row.commandKey === key && typeof row.fingerprint === "string" && row.fingerprint.startsWith("e1_")
        && typeof row.inputFingerprint === "string" && Number.isFinite(row.createdAt) && Number.isFinite(row.expiresAt) ? [row] : [];
    });
  } catch { return []; }
}

export function e1LegacyObject(record: E1Legacy): string {
  try {
    const value: unknown = JSON.parse(record.inputFingerprint);
    if (Array.isArray(value) && value.length >= 6) {
      const command = value[2] as ProposeSpec["command"] | null;
      const target = value[5] as ProposeSpec["target"];
      if (command && typeof command.op === "string" && command.op.startsWith("e1_") && command.params && target && typeof target.type === "string" && typeof target.id === "string") {
        return e1Object({ command, target, obj: record.fingerprint.split("|").slice(1).join("|") } as ProposeSpec);
      }
    }
  } catch { /* The old slot is still retained and shown for manual investigation. */ }
  const [op, ...object] = record.fingerprint.split("|");
  const id = object.join("|");
  return op.startsWith("e1_sku_") ? `device_sku|${id}` : op === "e1_bundle_discount" ? "store_bundle_discount|canonical"
    : op === "e1_early_access_update" ? "device_release_early_access|trade-in" : op.startsWith("e1_phase_") ? `device_phase|${id}`
      : `device_generation_gate|${id.replace(/^E\.gen\./, "").replace(/\.(phaseOffset|forceUnlock)$/, "")}`;
}

/** Read-only field list also drives full, untruncated before/after review. */
export const E1_SKU_FIELDS: readonly { key: keyof OpsSku; label: string; unit?: string }[] = [
  { key: "name", label: "型号名称" }, { key: "id", label: "商品编号" }, { key: "tier", label: "档位" }, { key: "seriesCode", label: "所属系列" },
  { key: "status", label: "商城状态" }, { key: "lifecycle", label: "生命周期" }, { key: "storeSortOrder", label: "商城排序" },
  { key: "price", label: "售价", unit: "USD" }, { key: "computePoints", label: "每件算力点" },
  { key: "allowedPoolCodes", label: "任务等级" }, { key: "monthlyTargetUsdt", label: "月收益目标", unit: "USDT/月" },
  { key: "monthlyTargetBandPct", label: "允许波动", unit: "%" }, { key: "datacenter", label: "托管机房" },
  { key: "dailyEarn", label: "兼容日收益", unit: "USDT/天" }, { key: "dailyEarnNEX", label: "每日收益", unit: "UVT/天" },
  { key: "phoneDailyEarn", label: "手机每日收益 USDT", unit: "USDT/天" }, { key: "phoneDailyEarnNEX", label: "手机每日收益 UVT", unit: "UVT/天" },
  { key: "shareYieldMin", label: "Share参考年奖励率下限", unit: "%" }, { key: "shareYieldMax", label: "Share参考年奖励率上限", unit: "%" },
  { key: "inventoryMode", label: "库存模式" }, { key: "stock", label: "剩余库存" },
  { key: "displaySoldBase", label: "展示基础销量" }, { key: "liveActivityVisible", label: "显示购买动态" }, { key: "trialEligible", label: "允许试用" },
  { key: "unlock", label: "开放阶段" }, { key: "purchaseGate", label: "购买条件与配额" },
  { key: "gpu", label: "GPU" }, { key: "vram", label: "显存" }, { key: "hashRate", label: "算力" },
  { key: "power", label: "功耗 / 功率说明" }, { key: "uptime", label: "在线率" }, { key: "warranty", label: "质保期限" },
  { key: "aiImageGenPerMin", label: "图像生成 张/分钟" }, { key: "aiLlmTokensPerSec", label: "大模型推理（词元/秒）" },
  { key: "aiVideoMinPerHour", label: "每小时可渲染视频时长（分钟）" }, { key: "aiFineTuneMins", label: "LoRA 微调（分钟）" },
  { key: "tagline", label: "英文标语" }, { key: "badge", label: "营销角标" }, { key: "features", label: "特性清单" },
  { key: "specDocumentTitle", label: "资料名称" }, { key: "specDocumentUrl", label: "资料链接" },
  { key: "imageAssetId", label: "媒体标识" }, { key: "imageObjectKey", label: "媒体对象键" },
  { key: "aiUnlocks", label: "历史算力标记" }, { key: "rating", label: "评分" }, { key: "reviews", label: "评价数量" },
  { key: "generation", label: "代际" }, { key: "supersededBy", label: "替代商品" }, { key: "tradeinDiscount", label: "置换折扣" }, { key: "tag", label: "历史标签" },
];

/** 显示用：购买条件这一行换成人话。没有购买条件的一侧保留原来的「未创建」「未设置」，新增商品的「只列填了的项」照旧生效。 */
export function e1ShownDiff<Row extends { key: string; before?: string; after?: string }>(rows: Row[], before: OpsSku | undefined, after: OpsSku | undefined): Row[] {
  return rows.map(row => row.key !== "purchaseGate" ? row : {
    ...row,
    before: before?.purchaseGate ? e1GateText(before.purchaseGate) : before && after?.purchaseGate ? e1GateText(null) : row.before,
    after: after?.purchaseGate ? e1GateText(after.purchaseGate) : before?.purchaseGate ? e1GateText(null) : row.after,
  });
}

/** proposal 保留送审用的原文，display 用只读金额格式。页面对照和判断改动按字段语义比较。 */
export function e1SkuDiff(before: OpsSku | undefined, after: OpsSku, raw?: SkuForm, mode: "review" | "display" | "proposal" = "review") {
  const shown = mode === "display";
  const target = (sku: OpsSku) => shown ? e1Amount(sku.monthlyTargetUsdt) : e1Decimal(sku.monthlyTargetUsdt, e1TargetPrecision(sku));
  const numericInputs = ["price", "computePoints", "displaySoldBase", "dailyEarnNEX", "phoneDailyEarn", "phoneDailyEarnNEX", "aiImageGenPerMin", "aiLlmTokensPerSec", "aiVideoMinPerHour", "aiFineTuneMins", ...(after.monthlyTargetUsdt == null ? ["dailyEarn", "shareYieldMin", "shareYieldMax"] : [])];
  // Editor drafts contain only the translation update. Catalogue reads contain the stored map.
  const nextTranslations = after.taglineTranslations ?? (raw ? before?.taglineTranslations : undefined);
  const translationRows = skuTaglineReviewRows(before?.taglineTranslations, nextTranslations, !before);
  const fields = E1_SKU_FIELDS.filter(({ key }) => after[key] !== undefined || !["displaySoldBase", "liveActivityVisible", "storeSortOrder"].includes(key));
  return [...fields, ...translationRows].map(field => {
    if ("before" in field) return field;
    const { key, label, unit } = field;
    if (!before && key === "id") return { key, label, before: "未创建", after: "待生成", note: undefined };
    const value = (sku: OpsSku) => e1Value(key === "badge" ? skuBadgeReviewText(sku.badge) : sku[key], unit, shown);
    const input = raw && numericInputs.includes(key)
      ? key === "displaySoldBase" ? after.displaySoldBase?.toString() : raw[key as keyof SkuForm]
      : undefined;
    const typed = typeof input === "string" && input.trim() ? input : undefined;
    const next = key === "monthlyTargetUsdt" && after.monthlyTargetUsdt != null ? `${target(after)} ${unit}` : typed !== undefined ? `${unit && unit !== "%" ? shown ? e1Amount(typed) : e1Decimal(typed) : e1Number(typed)}${unit ? ` ${unit}` : ""}` : value(after);
    if (key === "seriesCode") return { key, label, before: before ? skuSeriesText(before.seriesCode) : "未创建", after: skuSeriesText(after.seriesCode), note: undefined };
    const previous = before ? key === "monthlyTargetUsdt" && before.monthlyTargetUsdt != null ? `${target(before)} ${unit}` : value(before) : "未创建";
    const previousNumeric = mode !== "proposal" && before ? e1NumericReviewValue(key, before[key]) : undefined;
    const sameNumber = previousNumeric !== undefined && previousNumeric === e1NumericReviewValue(key, typed ?? after[key]);
    return { key, label, before: previous, after: sameNumber ? previous : !before && raw && numericInputs.includes(key) && input === "" ? "未填写" : next,
      note: key === "monthlyTargetUsdt" && after.clearMonthlyTarget ? "关闭月目标，改用兼容展示值" : undefined };
  });
}

/**
 * 展示基础销量、购买动态改了以后在 App / H5 Lite 上的实际效果；送审确认框和审批批准框共用这一个函数（显示规则 1–4）。
 * base：改后的展示基础销量（改了才传）；sold：累计销量，读不到时写「累计销量 + 基础值」；live：改后的开关（改了才传）；
 * liveAfter：批准后购买动态开不开；listed：商品在售（status 为 on）。onlyDisplay：只改了这两项，末尾补「不变」那句。
 */
export function e1DisplayEffect(change: { base?: number; sold?: number; live?: boolean; liveAfter: boolean; listed: boolean }, onlyDisplay: boolean): string {
  if (change.base === undefined && change.live === undefined) return "";
  const total = change.base === undefined ? "" : change.sold === undefined ? `累计销量 + ${e1Number(change.base)}` : e1Number(change.sold + change.base);
  return [
    change.listed ? "批准后，" : "批准后保存，商品上架后，",
    change.base !== undefined && `App / H5 Lite 商品详情的「累计已售」按 ${total} 件计${change.liveAfter ? "，商品图左下角的购买动态按同一个数推算" : ""}。`,
    change.live !== undefined && `这件商品${change.live ? "显示" : "不显示"}商品图左下角的购买动态。`,
    onlyDisplay && "售价、任务、已有订单和设备不变。",
  ].filter(Boolean).join("");
}
