import type { OpsSku } from "./platform-types";

export interface SkuProposalSummary {
  before: string;
  after: string;
  changedFields: string[];
  /** 兼容既有消费者；完整字段提案不再省略变更。 */
  omittedFields: string[];
}

interface FieldDescriptor {
  label: string;
  read: (sku: OpsSku) => unknown;
  format: (value: unknown, sku: OpsSku) => string;
  equal?: (before: unknown, after: unknown) => boolean;
}

const normalizedText = (value: unknown): string => String(value ?? "").trim();

const text = (value: unknown): string => normalizedText(value) || "未设置";

const number = (value: unknown): string => {
  if (value == null || value === "") return "未设置";
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString("en-US") : text(value);
};

const money = (value: unknown): string => {
  const formatted = number(value);
  return formatted === "未设置" ? formatted : `$${formatted}`;
};

const yesNo = (value: unknown): string => value ? "是" : "否";
const stringEqual = (before: unknown, after: unknown): boolean => normalizedText(before) === normalizedText(after);
const numberEqual = (before: unknown, after: unknown): boolean => {
  if ((before == null || before === "") && (after == null || after === "")) return true;
  return Number(before) === Number(after);
};

const inventoryMode = (value: unknown): string => value === "UNLIMITED" ? "无限库存" : "有限库存";
const stock = (value: unknown, sku: OpsSku): string => sku.inventoryMode === "UNLIMITED" ? "∞（不适用）" : number(value);
const productType = (value: unknown): string => ({ SERVER: "服务器", DEVICE: "实体设备", SHARE: "云份额" }[String(value)] ?? text(value));
const features = (value: unknown): string => Array.isArray(value) ? text(value.join(" / ")) : text(value);
const structured = (value: unknown): string => text(value == null ? "未设置" : JSON.stringify(value));
const mediaIdentity = (sku: OpsSku): [string, string] => [normalizedText(sku.imageAssetId), normalizedText(sku.imageObjectKey)];
const mediaIdentityText = (value: unknown): string => {
  const [assetId, objectKey] = value as [string, string];
  if (!assetId && !objectKey) return "未设置";
  try {
    // E1 assetId is the base64url encoding of objectKey; the full key identifies both values.
    if (assetId === btoa(objectKey).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")) return objectKey;
  } catch { /* An unrepresentable key must keep both raw values in the summary. */ }
  return `标识 ${text(assetId)} / 对象 ${text(objectKey)}`;
};

// 高风险审核首先回答“改了哪个字段、从什么改成什么”。库存放在首位，避免长配置挤掉核心变更。
const SKU_FIELDS: FieldDescriptor[] = [
  { label: "库存", read: (sku) => sku.stock, format: stock, equal: numberEqual },
  { label: "价格", read: (sku) => sku.price, format: money, equal: numberEqual },
  { label: "允许试用", read: (sku) => sku.trialEligible, format: yesNo, equal: (a, b) => Boolean(a) === Boolean(b) },
  { label: "商品 ID", read: (sku) => sku.id, format: text, equal: stringEqual },
  { label: "商品名称", read: (sku) => sku.name, format: text, equal: stringEqual },
  { label: "库存模式", read: (sku) => sku.inventoryMode, format: inventoryMode, equal: (a, b) => (a ?? "FINITE") === (b ?? "FINITE") },
  { label: "商城状态", read: (sku) => sku.status, format: text, equal: stringEqual },
  { label: "商品类型", read: (sku) => sku.productType, format: productType },
  { label: "商品档位", read: (sku) => sku.tier, format: text, equal: stringEqual },
  { label: "日产收益", read: (sku) => sku.dailyEarn, format: money, equal: numberEqual },
  { label: "日产 NEX", read: (sku) => sku.dailyEarnNEX, format: number, equal: numberEqual },
  { label: "手机日产收益", read: (sku) => sku.phoneDailyEarn, format: money, equal: numberEqual },
  { label: "手机日产 NEX", read: (sku) => sku.phoneDailyEarnNEX, format: number, equal: numberEqual },
  { label: "生命周期", read: (sku) => sku.lifecycle, format: text, equal: stringEqual },
  { label: "解锁条件", read: (sku) => sku.unlock, format: text, equal: stringEqual },
  { label: "商品标签", read: (sku) => sku.tag, format: text, equal: stringEqual },
  { label: "数据中心", read: (sku) => sku.datacenter, format: text, equal: stringEqual },
  { label: "GPU", read: (sku) => sku.gpu, format: text, equal: stringEqual },
  { label: "显存", read: (sku) => sku.vram, format: text, equal: stringEqual },
  { label: "算力", read: (sku) => sku.hashRate, format: text, equal: stringEqual },
  { label: "功耗", read: (sku) => sku.power, format: text, equal: stringEqual },
  { label: "在线率", read: (sku) => sku.uptime, format: text, equal: stringEqual },
  { label: "保修", read: (sku) => sku.warranty, format: text, equal: stringEqual },
  { label: "角标", read: (sku) => sku.badge, format: text, equal: stringEqual },
  { label: "卖点", read: (sku) => sku.tagline, format: text, equal: stringEqual },
  { label: "份额收益下限", read: (sku) => sku.shareYieldMin, format: number, equal: numberEqual },
  { label: "份额收益上限", read: (sku) => sku.shareYieldMax, format: number, equal: numberEqual },
  { label: "收益展示串", read: (sku) => sku.baseRate, format: text, equal: stringEqual },
  { label: "图像生成性能", read: (sku) => sku.aiImageGenPerMin, format: number, equal: numberEqual },
  { label: "LLM 推理性能", read: (sku) => sku.aiLlmTokensPerSec, format: number, equal: numberEqual },
  { label: "视频渲染性能", read: (sku) => sku.aiVideoMinPerHour, format: number, equal: numberEqual },
  { label: "LoRA 微调性能", read: (sku) => sku.aiFineTuneMins, format: number, equal: numberEqual },
  { label: "资料名称", read: (sku) => sku.specDocumentTitle, format: text, equal: stringEqual },
  { label: "资料链接", read: (sku) => sku.specDocumentUrl, format: text, equal: stringEqual },
  { label: "解锁算力池", read: (sku) => sku.aiUnlocks, format: text, equal: stringEqual },
  { label: "产品特性", read: (sku) => sku.features, format: features, equal: (a, b) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []) },
  { label: "购买限制", read: (sku) => sku.purchaseGate, format: structured, equal: (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null) },
  { label: "产品图对象键", read: mediaIdentity, format: mediaIdentityText,
    equal: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
];

/** 生成可直接写入 A2 before_value/after_value 的字段级摘要。 */
export function summarizeSkuProposal(beforeSku: OpsSku, afterSku: OpsSku): SkuProposalSummary | null {
  const changes = SKU_FIELDS.flatMap((field) => {
    const before = field.read(beforeSku);
    const after = field.read(afterSku);
    const equal = field.equal ? field.equal(before, after) : Object.is(before, after);
    return equal ? [] : [{
      label: field.label,
      before: `${field.label}：${field.format(before, beforeSku)}`,
      after: `${field.label}：${field.format(after, afterSku)}`,
    }];
  });

  if (changes.length === 0) return null;

  return {
    before: changes.map((item) => item.before).join("；"),
    after: changes.map((item) => item.after).join("；"),
    changedFields: changes.map((item) => item.label),
    omittedFields: [],
  };
}

/** 新建与编辑均保留全部业务变更；A2 服务端持久化并回读完整审阅值。 */
export function summarizeSkuCreation(afterSku: OpsSku): SkuProposalSummary | null {
  const emptySku: OpsSku = {
    id: "",
    name: "",
    price: 0,
    dailyEarn: 0,
    dailyEarnNEX: 0,
    inventoryMode: "FINITE",
    trialEligible: false,
    unlock: "",
    tag: "",
    status: "pending",
  };
  return summarizeSkuProposal(emptySku, afterSku);
}
