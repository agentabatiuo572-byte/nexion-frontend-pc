import type { OpsSku } from "@/lib/admin/platform-types";
import type { ProposeSpec } from "@/lib/admin/propose-or-execute";
import type { SkuForm } from "./data";
import { createPendingMutationStore, hasPersistedPendingCommandOwner, type PendingMutationRecord } from "@/lib/admin/pending-mutation-store";

export const E1_LEVELS = [
  { key: "L1", label: "L1", name: "初级" }, { key: "L2", label: "L2", name: "中级" },
  { key: "L3", label: "L3", name: "高级" }, { key: "L4", label: "L4", name: "旗舰" },
] as const;

/** Keep every received decimal digit; grouping never rounds a catalogue amount. */
export function e1Number(value: number | string | null | undefined): string {
  if (value == null || value === "") return "—";
  const [coefficient, exp] = String(value).toLowerCase().split("e");
  const negative = coefficient.startsWith("-");
  const [whole, fraction = ""] = coefficient.replace(/^-/, "").split(".");
  const digits = whole + fraction;
  const point = whole.length + Number(exp ?? 0);
  const expanded = point <= 0 ? `0.${"0".repeat(-point)}${digits}` : point >= digits.length ? digits.padEnd(point, "0") : `${digits.slice(0, point)}.${digits.slice(point)}`;
  const [integer, decimal] = expanded.split(".");
  return `${negative ? "-" : ""}${integer.replace(/\B(?=(\d{3})+$)/g, ",")}${decimal === undefined ? "" : `.${decimal}`}`;
}

/** Display precision follows the real digits in one amount/configuration group. */
export function e1Precision(values: readonly (number | string | null | undefined)[], minimum = 2): number {
  return Math.max(minimum, ...values.map(value => (e1Number(value).split(".")[1] ?? "").replace(/0+$/, "").length));
}

export function e1Decimal(value: number | string | null | undefined, precision = e1Precision([value])): string {
  const raw = e1Number(value);
  if (raw === "—") return raw;
  const [integer, fraction = ""] = raw.split(".");
  const decimal = fraction.replace(/0+$/, "").padEnd(precision, "0");
  return decimal ? `${integer}.${decimal}` : integer;
}

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

export type E1Pending = PendingMutationRecord & { actorId: string; spec: ProposeSpec };
const validProposal = (row: E1Pending) => typeof row.actorId === "string" && !!row.actorId
  && typeof row.spec?.reason === "string" && row.spec.sourceDomain === "E1"
  && typeof row.spec?.obj === "string" && typeof row.spec?.command?.op === "string"
  && row.spec.command.op.startsWith("e1_") && !!row.spec.command.params;
export const e1Commands = createPendingMutationStore<E1Pending>({
  storageKey: "nexion-admin-e1-proposal-commands-v1", retainExpiredRecords: true, isValidRecord: validProposal,
});
// Preserve the previous monthly-target table and its original sku| fingerprint.
export const e1MonthlyCommands = createPendingMutationStore<E1Pending>({
  storageKey: "nexion-admin-e1-monthly-target-commands-v1", retainExpiredRecords: true,
  isValidRecord: (row) => typeof row.actorId === "string" && !!row.actorId
    && row.fingerprint === `sku|${row.spec?.obj}` && typeof row.spec?.reason === "string"
    && ["e1_sku_create", "e1_sku_update"].includes(row.spec?.command?.op),
});
export const e1Pending = (actorId: string) => [...e1Commands.list(), ...e1MonthlyCommands.list()].filter((row) => row.actorId === actorId);
export const forgetE1 = (row: E1Pending) => (row.fingerprint.startsWith("sku|") ? e1MonthlyCommands : e1Commands).forget(row.fingerprint, row.commandKey);

export type E1MediaPending = PendingMutationRecord & {
  actorId: string; skuId: string; fileName: string; size: number; mime: string; digest: string;
  kind: "image" | "video"; params: { domain: string; usage: string; entityType: string; entityId: string; operator: string };
};
export const e1MediaCommands = createPendingMutationStore<E1MediaPending>({
  storageKey: "nexion-admin-e1-media-commands-v1", retainExpiredRecords: true,
  isValidRecord: row => typeof row.actorId === "string" && !!row.actorId && typeof row.fileName === "string"
    && typeof row.digest === "string" && /^[a-f0-9]{64}$/.test(row.digest) && Number.isFinite(row.size)
    && typeof row.mime === "string" && typeof row.skuId === "string" && ["image", "video"].includes(row.kind)
    && row.params?.domain === "E" && row.params.entityType === "SKU" && typeof row.params.operator === "string",
});

export type E1Legacy = PendingMutationRecord & { inputFingerprint: string };
/** Old slots have no reason/actor/envelope. Read only, never resolve or expire them. */
export function e1LegacyCommands(actorId: string): E1Legacy[] {
  if (!hasPersistedPendingCommandOwner(actorId)) return [];
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem("nexion-admin-e-domain-commands-v1") ?? "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return [];
    return Object.entries(saved).flatMap(([key, value]) => {
      if (!value || typeof value !== "object") return [];
      const row = value as E1Legacy;
      return row.commandKey === key && typeof row.fingerprint === "string" && row.fingerprint.startsWith("e1_")
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
  { key: "name", label: "型号名称" }, { key: "id", label: "商品编号" }, { key: "tier", label: "档位" },
  { key: "status", label: "商城状态" }, { key: "lifecycle", label: "生命周期" },
  { key: "price", label: "售价", unit: "USD" }, { key: "computePoints", label: "每件算力点" },
  { key: "allowedPoolCodes", label: "任务等级" }, { key: "monthlyTargetUsdt", label: "月收益目标", unit: "USDT/月" },
  { key: "monthlyTargetBandPct", label: "允许波动", unit: "%" }, { key: "datacenter", label: "托管机房" },
  { key: "dailyEarn", label: "兼容日收益", unit: "USDT/天" }, { key: "dailyEarnNEX", label: "每日收益", unit: "UVT/天" },
  { key: "phoneDailyEarn", label: "手机每日收益 USDT", unit: "USDT/天" }, { key: "phoneDailyEarnNEX", label: "手机每日收益 UVT", unit: "UVT/天" },
  { key: "shareYieldMin", label: "Share参考年奖励率下限", unit: "%" }, { key: "shareYieldMax", label: "Share参考年奖励率上限", unit: "%" },
  { key: "inventoryMode", label: "库存模式" }, { key: "stock", label: "剩余库存" }, { key: "trialEligible", label: "允许试用" },
  { key: "unlock", label: "开放阶段" }, { key: "purchaseGate", label: "购买条件与配额" },
  { key: "gpu", label: "GPU" }, { key: "vram", label: "显存" }, { key: "hashRate", label: "算力" },
  { key: "power", label: "功耗 / 功率说明" }, { key: "uptime", label: "在线率" }, { key: "warranty", label: "质保期限" },
  { key: "aiImageGenPerMin", label: "图像生成 张/分钟" }, { key: "aiLlmTokensPerSec", label: "大模型推理（词元/秒）" },
  { key: "aiVideoMinPerHour", label: "每小时可渲染视频时长（分钟）" }, { key: "aiFineTuneMins", label: "LoRA 微调（分钟）" },
  { key: "tagline", label: "商品标语" }, { key: "badge", label: "营销角标" }, { key: "features", label: "特性清单" },
  { key: "specDocumentTitle", label: "资料名称" }, { key: "specDocumentUrl", label: "资料链接" },
  { key: "imageAssetId", label: "媒体标识" }, { key: "imageObjectKey", label: "媒体对象键" },
  { key: "aiUnlocks", label: "历史算力标记" }, { key: "rating", label: "评分" }, { key: "reviews", label: "评价数量" },
  { key: "generation", label: "代际" }, { key: "supersededBy", label: "替代商品" }, { key: "tradeinDiscount", label: "置换折扣" }, { key: "tag", label: "历史标签" },
];
const E1_VALUE_NAMES: Record<string, string> = { on: "在售", off: "已下架", pending: "草稿", active: "现行", legacy: "已停产", FINITE: "有限库存", UNLIMITED: "不限（非实物）", Entry: "入门档", Pro: "专业档", Flagship: "旗舰档", Share: "共享份额" };
export function e1Value(value: unknown, unit?: string): string {
  const text = value == null || value === "" ? "未设置" : typeof value === "boolean" ? value ? "开" : "关"
    : typeof value === "number" ? unit && unit !== "%" ? e1Decimal(value) : e1Number(value) : Array.isArray(value) ? value.join("、") || "未配置"
    : typeof value === "object" ? JSON.stringify(value, null, 2) : E1_VALUE_NAMES[String(value)] ?? String(value);
  return `${text}${unit && value != null && value !== "" ? ` ${unit}` : ""}`;
}
export function e1SkuDiff(before: OpsSku | undefined, after: OpsSku, raw?: SkuForm) {
  const numericInputs = ["price", "computePoints", "dailyEarnNEX", "phoneDailyEarn", "phoneDailyEarnNEX", "aiImageGenPerMin", "aiLlmTokensPerSec", "aiVideoMinPerHour", "aiFineTuneMins", ...(after.monthlyTargetUsdt == null ? ["dailyEarn", "shareYieldMin", "shareYieldMax"] : [])];
  return E1_SKU_FIELDS.map(({ key, label, unit }) => {
    const input = raw && numericInputs.includes(key) ? raw[key as keyof SkuForm] : undefined;
    const next = key === "monthlyTargetUsdt" && after.monthlyTargetUsdt != null ? `${e1Decimal(after.monthlyTargetUsdt, e1TargetPrecision(after))} ${unit}` : typeof input === "string" && input.trim() ? `${unit && unit !== "%" ? e1Decimal(input) : e1Number(input)}${unit ? ` ${unit}` : ""}` : e1Value(after[key], unit);
    return { key, label, before: before ? key === "monthlyTargetUsdt" && before.monthlyTargetUsdt != null ? `${e1Decimal(before.monthlyTargetUsdt, e1TargetPrecision(before))} ${unit}` : e1Value(before[key], unit) : "未创建", after: !before && raw && numericInputs.includes(key) && input === "" ? "未填写" : next,
      note: key === "monthlyTargetUsdt" && after.clearMonthlyTarget ? "关闭月目标，改用兼容展示值" : undefined };
  });
}
