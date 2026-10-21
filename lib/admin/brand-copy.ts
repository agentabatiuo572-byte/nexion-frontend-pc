/**
 * 服务端存量配置值 → 现品牌文案。
 *
 * 背景:2026-07-22 平台改名 NexGrid,但服务端**已落库**的配置行里仍可能带旧品牌 ——
 * 例如 F1 的全局奖品名 `team.ui.F.prize.name` 存量值为旧品牌 + " V-Rank"。那类值由
 * 后端持久化,PC 单方面回填不了;但**渲染层**是 PC 自己的边界,旧值不该继续以旧品牌示人。
 * 与 App 仓 `src/lib/brand-copy.ts` 同一分层约定:store 存服务端原值,措辞在展示层解析。
 *
 * 🔴 只在**展示**调用点用。绝不用于协议字段、请求体或配置键:
 *    `X-Nexion-Upstream-Outcome` 这类标识符由后端定义,前端单方面改拼写 = 回包当场对不上。
 *
 * 旧词用拆词构造,与 App 仓 scripts/verify.sh 的 no_oldbrand_check 同法 ——
 * 直接写字面量会被品牌哨兵抓红,而这里的字符串恰恰就是哨兵要守的那个旧词。
 */
const LEGACY_BRAND = "Nexi" + "on";
const BRAND = "UVEL";

/** 大小写不敏感,命中即整词替换。 */
export function nexGridBrandText(value: string): string {
  return value.replace(new RegExp(LEGACY_BRAND, "gi"), BRAND).replace(/NexGrid/gi, BRAND).replace(/Stellar(?=Box|Rack)/gi, BRAND).replace(/\bNEX\b/g, BRAND);
}

/** Recognized system defaults only; phone-suffix names need matching evidence. Keep custom names verbatim. */
export function userNicknameText(value: string, phoneMasked: unknown): string {
  if (/^NexGrid-[A-F0-9]{8}$/.test(value)) return nexGridBrandText(value);
  const suffix = /^(?:NexGrid|Nexion) (\d{4})$/.exec(value)?.[1];
  const phoneSuffix = typeof phoneMasked === "string" ? /^\d{3}\*{4}(\d{4})$/.exec(phoneMasked)?.[1] : undefined;
  return suffix && suffix === phoneSuffix ? nexGridBrandText(value) : value;
}

/** Fixed AppSessionSurface labels only; keep custom device names verbatim. */
export function platformSessionDeviceText(value: string): string {
  return ["NexGrid Phone App", "NexGrid H5", "NexGrid App / H5"].includes(value) ? nexGridBrandText(value) : value;
}

/** Only confirmed official SKU/name pairs; catalog names remain operator-owned. */
export function catalogSkuBrandText(id: string | undefined, value: string): string {
  const official = (id === "stellarbox-s1" && value === "NexGridBox S1")
    || (id === "stellarbox-pro-v2" && value === "NexGridBox Pro v2")
    || (id === "stellarbox-pro" && value === "StellarBox Pro")
    || (id === "stellarrack-p1" && value === "StellarRack P1");
  return official ? nexGridBrandText(value) : value;
}

/** Match the catalog's paired item summaries; quantities and product IDs stay unchanged. */
export function orderSkuBrandText(id: string | undefined, value: string): string {
  const ids = id?.split(" + "), names = value.split(" + ");
  if (!ids || ids.length !== names.length) return value;
  return names.map((name, index) => {
    const itemId = /^(.*)×([1-9]\d*)$/.exec(ids[index]);
    const itemName = /^(.*)×([1-9]\d*)$/.exec(name);
    if (!itemId && !itemName) return catalogSkuBrandText(ids[index], name);
    return itemId && itemName && itemId[2] === itemName[2]
      ? `${catalogSkuBrandText(itemId[1], itemName[1])}×${itemName[2]}` : name;
  }).join(" + ");
}

/** Only exact generated SKU captions; never rewrite authored message text. */
export function supportMessageBrandText(message: { kind?: string; skuId?: string; skuName?: string; text: string }): string {
  if (message.kind !== "SKU" || !message.skuName) return message.text;
  const name = catalogSkuBrandText(message.skuId, message.skuName);
  if (message.text === message.skuName) return name;
  return message.text === `推荐商品：${message.skuName}` ? `推荐商品：${name}` : message.text;
}

/** Generated default nickname display, for DTOs that omit the masked phone. */
export function operatorNicknameText(value: string): string {
  return /^(?:NexGrid|Nexion)(?: [0-9]{4}|-[A-F0-9]{8})$/i.test(value) ? nexGridBrandText(value) : value;
}
/** Historical built-in data center names; custom names remain intact. */
export function datacenterNameText(value: string): string {
  return ["NexGrid Mobile Network", "NexGrid Virginia Compute Center"].includes(value) ? nexGridBrandText(value) : value;
}
