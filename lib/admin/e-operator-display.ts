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
  return SAFE_DEVICE_IDENTIFIER.test(text(identity)) && SAFE_DEVICE_NAME.test(normalized) ? normalized : "设备信息待核验";
}

export function operatorDeviceStatus(value: string | null | undefined) {
  const normalized = text(value).toUpperCase();
  const labels: Record<string, string> = {
    ACTIVE: "运行中",
    BUSY: "任务中",
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

export function operatorE3OperationLabel(value: string | null | undefined) {
  return "升级置换处理";
}

export function operatorE3OperationState(value: string | null | undefined) {
  const normalized = text(value).toUpperCase();
  if (["ACTIVE", "BUSY", "OFFLINE", "RECYCLED", "DEACTIVATED", "UNBOUND", "UNASSIGNED", "INVENTORY", "UNKNOWN"].includes(normalized)) {
    return operatorDeviceStatus(normalized);
  }
  return hasInternalFixtureMarker(normalized) ? "验收处理" : "最新处理状态";
}

export function operatorE3Reason(value: string | null | undefined) {
  return text(value) ? "处理备注已记录；请在审计轨迹核验。" : "暂无最新样本";
}

export function operatorProductLabel(value: string | null | undefined) {
  const normalized = text(value);
  if (hasInternalFixtureMarker(normalized)) return "验收设备规格";
  return SAFE_SKU_DISPLAY.test(normalized) && /[\p{Script=Han}\s]|[A-Z][a-z]/u.test(normalized) ? normalized : "商品信息待补";
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
  return !hasInternalFixtureMarker(normalized) && SAFE_SKU_DISPLAY.test(normalized) ? normalized : "用户资料待核验";
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
  return [usdt == null ? null : format(usdt, "USDT"), nex == null ? null : format(nex, "NEX")]
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

export function operatorSkuLabel(input: { orderNo: string; skuName?: string | null; skuId?: string | null; skuSource?: string | null }) {
  const skuName = text(input.skuName);
  const skuId = text(input.skuId);
  const compactSkuName = compactIdentifier(skuName);
  const compactOrderNo = compactIdentifier(text(input.orderNo));
  const compactSkuId = compactIdentifier(skuId);
  const looksLikeOrderReference = /^(?:ord|order)(?:id)?[\p{L}\p{N}]*$/iu.test(compactSkuName);
  const looksLikeSkuIdentifier = /^(?:sku|product)(?:id)?[\p{L}\p{N}]*$/iu.test(compactSkuName) || compactSkuName === compactSkuId;
  const humanReadable = /[\p{Script=Han}\s]|[A-Z][a-z]/u.test(skuName);
  if (!TRUSTED_SKU_SOURCES.has(text(input.skuSource).toUpperCase())
      || !SAFE_SKU_DISPLAY.test(skuName)
      || !humanReadable
      || !skuName
      || compactSkuName === compactOrderNo
      || looksLikeOrderReference
      || looksLikeSkuIdentifier) {
    return "商品信息待补";
  }
  if (hasInternalFixtureMarker(skuName)) {
    return "商品信息待补";
  }
  return skuName;
}
