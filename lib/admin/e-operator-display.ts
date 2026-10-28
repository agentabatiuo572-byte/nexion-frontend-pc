import { nexGridBrandText, operatorNicknameText } from "./brand-copy.ts";
const INTERNAL_FIXTURE_PATTERN = /(?:TRIALDEV|DEVTI|E3ACC|TIO|DEVICETRIALSTANDARD|INTERNAL|FIXTURE|QA(?:TEST)?|TEST(?:DEVICE|TASK)?)/i;
const SAFE_DEVICE_IDENTIFIER = /^[A-Za-z0-9._:-]{3,64}$/;
const SAFE_DATACENTER_IDENTIFIER = /^[A-Z]{2,6}-\d{1,3}$/;
const SAFE_SKU_DISPLAY = /^[\p{L}\p{N}][\p{L}\p{N} ._+()/-]{1,79}$/u;
const SAFE_DEVICE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._+()/:·~\-]{1,79}$/u;
const TRUSTED_SKU_SOURCES = new Set(["ORDER_ITEM", "PRODUCT_CATALOG"]);

function text(value: string | null | undefined, fallback = "") {
  const normalized = value?.trim() ?? "";
  return normalized || fallback;
}

export function hasInternalFixtureMarker(value: string | null | undefined) {
  return INTERNAL_FIXTURE_PATTERN.test((value ?? "").normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "").toUpperCase());
}

export function operatorDeviceIdentifier(value: string | null | undefined) {
  const normalized = text(value);
  if (hasInternalFixtureMarker(normalized)) return "本地验收夹具";
  return SAFE_DEVICE_IDENTIFIER.test(normalized) ? normalized : "设备编号待核验";
}

export function operatorDeviceName(value: string | null | undefined, identity: string | null | undefined) {
  const normalized = text(value);
  if (hasInternalFixtureMarker(normalized) || hasInternalFixtureMarker(identity)) return "本地验收设备";
  return SAFE_DEVICE_IDENTIFIER.test(text(identity)) && SAFE_DEVICE_NAME.test(normalized) ? nexGridBrandText(normalized) : "设备信息待核验";
}

export function operatorDeviceStatus(value: string | null | undefined) {
  const normalized = text(value).toUpperCase();
  const labels: Record<string, string> = {
    ACTIVE: "已激活",
    ONLINE: "已激活",
    BUSY: "已分配任务",
    RUNNING: "已分配任务",
    OFFLINE: "离线",
    RECYCLED: "已回收",
    DEACTIVATED: "已停用",
    UNBOUND: "已解绑",
    UNASSIGNED: "未分配",
    INVENTORY: "库存待激活",
    UNKNOWN: "状态未采集",
  };
  return labels[normalized] ?? "状态待核验";
}

export function operatorDatacenterLabel(value: string | null | undefined) {
  const normalized = text(value);
  if (normalized.toUpperCase() === "UNASSIGNED") return "未分配";
  return SAFE_DATACENTER_IDENTIFIER.test(normalized) && !hasInternalFixtureMarker(normalized) ? normalized : "数据中心待核验";
}

// 原子换机 tx 监控按后端三条独立事务分列(recycle / replace / deactivate)。
// 后端已下发各自的业务名与 operation,必须逐个映射成互不相同的运营标签,
// 否则三列会渲染成三组同名同数的卡片,运营会误判成「三套重复监控」。
const E3_OPERATION_LABELS: Record<string, string> = {
  RECYCLE: "设备回收",
  REPLACE: "设备置换",
  DEACTIVATE: "设备停用",
  "设备回收": "设备回收",
  "设备置换": "设备置换",
  "设备停用": "设备停用",
};

export function operatorE3OperationLabel(value: string | null | undefined) {
  const normalized = text(value).normalize("NFKC").toUpperCase();
  return E3_OPERATION_LABELS[normalized] ?? "升级置换处理";
}

export function operatorE3OperationState(value: string | null | undefined) {
  const normalized = text(value).toUpperCase();
  if (["ACTIVE", "BUSY", "OFFLINE", "RECYCLED", "DEACTIVATED", "UNBOUND", "UNASSIGNED", "INVENTORY", "UNKNOWN"].includes(normalized)) {
    return operatorDeviceStatus(normalized);
  }
  return hasInternalFixtureMarker(normalized) ? "验收处理" : "最新处理状态";
}

export function operatorE3Reason(value: string | null | undefined) {
  return text(value) ? "处理备注已记录，可在操作记录里查看。" : "暂无数据";
}

export function operatorProductLabel(value: string | null | undefined) {
  const normalized = text(value);
  if (hasInternalFixtureMarker(normalized)) return "验收设备规格";
  return SAFE_SKU_DISPLAY.test(normalized) && /[\p{Script=Han}\s]|[A-Z][a-z]/u.test(normalized) ? nexGridBrandText(normalized) : "商品信息待补";
}

export function operatorTaskLabel(value: string | null | undefined) {
  return text(value) ? "已关联任务" : "—";
}

export function operatorUserIdentifier(value: string | null | undefined) {
  const normalized = text(value);
  return /^U\d{4,20}$/.test(normalized) && !hasInternalFixtureMarker(normalized) ? normalized : "用户待核验";
}

export function operatorUserName(value: string | null | undefined) {
  const normalized = text(value);
  return !hasInternalFixtureMarker(normalized) && SAFE_SKU_DISPLAY.test(normalized) ? operatorNicknameText(normalized) : "用户资料待核验";
}

export function operatorTimestamp(value: string | null | undefined) {
  const normalized = text(value);
  return /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.test(normalized) ? normalized : "未采集";
}

export function operatorRate(dailyUsdt: number | null | undefined, dailyNex: number | null | undefined) {
  const format = (value: number, unit: string) => `${value.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${unit}/日`;
  const usdt = typeof dailyUsdt === "number" && Number.isFinite(dailyUsdt) && dailyUsdt >= 0 ? dailyUsdt : null;
  const nex = typeof dailyNex === "number" && Number.isFinite(dailyNex) && dailyNex >= 0 ? dailyNex : null;
  if (usdt == null && nex == null) return "收益待核验";
  return [usdt == null ? null : format(usdt, "USDT"), nex == null ? null : format(nex, "UVT")]
    .filter((value): value is string => value != null).join(" · ");
}

export function operatorThermalLabel(value: string | null | undefined) {
  const normalized = text(value).toUpperCase();
  return ({ NORMAL: "温控正常", WARM: "温控偏高", HOT: "温控告警", UNKNOWN: "温控未采集" } as Record<string, string>)[normalized] ?? "温控待核验";
}

export function operatorOperationalNote(value: string | null | undefined) {
  return text(value) ? "已设置运营备注" : "";
}

function compactIdentifier(value: string) {
  return value.normalize("NFKC").replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}

export function operatorSkuLabel(input: { orderNo: string; skuName?: string | null; skuId?: string | null; skuSource?: string | null }): string {
  const skuName = text(input.skuName);
  const skuId = text(input.skuId);
  const compactSkuName = compactIdentifier(skuName);
  const compactNameWithoutQuantity = compactIdentifier(skuName.normalize("NFKC").replace(/×\d+$/u, ""));
  const compactOrderNo = compactIdentifier(text(input.orderNo));
  const compactSkuId = compactIdentifier(skuId);
  const looksLikeOrderReference = /^(?:ord|order)(?:id)?[\p{L}\p{N}]*$/iu.test(compactSkuName);
  const hasReadableWords = /\p{Script=Han}/u.test(skuName)
    || (/\s/u.test(skuName) && /(?:^|\s)\p{L}{2,}(?=\s|×|$)/u.test(skuName));
  const looksLikeSkuIdentifier = /^(?:sku|product)(?:id)?[\p{L}\p{N}]*$/iu.test(compactSkuName)
    || (compactSkuName === compactSkuId
      && (skuName.normalize("NFKC").toLowerCase() === skuId.normalize("NFKC").toLowerCase()
        || !hasReadableWords));
  const humanReadable = /[\p{Script=Han}\s]|[A-Z][a-z]/u.test(skuName);
  if (!TRUSTED_SKU_SOURCES.has(text(input.skuSource).toUpperCase())
      || !/^[\p{L}\p{N}][\p{L}\p{N} ._+()/×-]{1,79}$/u.test(skuName)
      || !humanReadable
      || /^\p{N}+$/u.test(compactNameWithoutQuantity)
      || /^[a-f0-9]{32,}$/u.test(compactNameWithoutQuantity)
      || !skuName
      || compactSkuName === compactOrderNo
      || looksLikeOrderReference
      || looksLikeSkuIdentifier) {
    return "商品信息待补";
  }
  if (hasInternalFixtureMarker(skuName)) {
    return "商品信息待补";
  }
  // ORDER_COLUMNS joins quantity-suffixed members with " + "; a name may itself contain +.
  const skuNames = skuName.normalize("NFKC").split(/(?<=×\d+) \+ /u);
  const skuIds = skuId.normalize("NFKC").split(/(?<=×\d+) \+ /u);
  if (skuNames.length !== skuIds.length
      || (skuNames.length > 1 && skuNames.some((name, index) =>
        operatorSkuLabel({ ...input, skuName: name, skuId: skuIds[index] }) === "商品信息待补"))) {
    return "商品信息待补";
  }
  return (skuName);
}

export function operatorSkuTier(value: string | undefined): string { return ({ Entry: "入门档", Pro: "专业档", Flagship: "旗舰档", Share: "共享份额" } as Record<string,string>)[value ?? ""] ?? "其他档位"; }

export function operatorOrderHistoryActor(value: string): string {
  return value.trim() === "system:wallet-checkout" ? "系统自动结算" : value;
}

export function operatorOrderHistoryReason(value: string, paymentMethod: string): string {
  if (nexGridBrandText(value.trim()).toLowerCase() === "uvel wallet checkout") {
    return paymentMethod.toUpperCase() === "VOUCHER" ? "优惠券抵扣并激活设备" : "UVEL 钱包付款并激活设备";
  }
  return value;
}

export function operatorOrderFact(kind: "type" | "payment" | "paymentStatus" | "source" | "direction" | "fundingStatus", value: string): string {
  const labels: Record<string, Record<string, string>> = {
    type: { SINGLE: "单品购买", BUNDLE: "组合购买", TRADE_IN: "以旧换新", CAPACITY_KEEP: "保留算力", TRIAL_CONVERT: "试用转购买" },
    payment: { USDT_WALLET: "USDT 钱包", WALLET: "钱包", NEXGRID_WALLET: "UVEL 钱包", VOUCHER: "优惠券抵扣", BANK: "银行付款", BANK_TRANSFER: "银行转账", VIETQR: "VietQR 扫码付款", HDPAY: "支付商付款", CREGIS: "链上付款" },
    paymentStatus: { PENDING: "待付款", UNPAID: "未付款", PROCESSING: "支付处理中", PAID: "已支付", CONFIRMED: "已确认付款", SUCCESS: "支付成功", REFUNDED: "已退款", CHARGEBACK: "拒付", DISPUTED: "存在争议", PAYMENT_FAILED: "支付失败", FAILED: "支付失败", EXPIRED: "已过期", CANCELLED: "已取消" },
    source: { D1_PAYMENT: "付款记录", D4_LEDGER: "资金流水", D4_BILL: "账单记录" },
    direction: { IN: "收入", OUT: "支出" },
    fundingStatus: { PAID: "已支付", POSTED: "已入账", COMPLETED: "已完成", SUCCESS: "已完成", PENDING: "处理中", FAILED: "失败", CANCELLED: "已取消", REVERSED: "已撤回", REFUNDED: "已退款", CHARGEBACK: "拒付" },
  };
  return labels[kind][value.toUpperCase()] ?? ({ type: "订单类型未知", payment: "支付方式未知", paymentStatus: "支付状态未知", source: "其他资金记录", direction: "方向未知", fundingStatus: "资金状态未知" })[kind];
}
