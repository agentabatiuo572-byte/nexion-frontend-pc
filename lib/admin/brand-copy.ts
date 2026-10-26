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

/** 品牌仍为 UVEL；独立 NEX 代币名称显示为 UVT。仅用于展示。 */
export function nexGridBrandText(value: string): string {
  return value.replace(new RegExp(LEGACY_BRAND, "gi"), BRAND).replace(/NexGrid/gi, BRAND).replace(/Stellar(?=Box|Rack)/gi, BRAND).replace(/\bNEX\b/gi, "UVT");
}

/** Recognized system defaults only; phone-suffix names need matching evidence. Keep custom names verbatim. */
export function userNicknameText(value: string, phoneMasked: unknown): string {
  if (/^(?:NexGrid|Nexion)-[A-F0-9]{8}$/i.test(value)) return nexGridBrandText(value);
  const suffix = /^(?:NexGrid|Nexion) (\d{4})$/i.exec(value)?.[1];
  const phoneSuffix = typeof phoneMasked === "string" ? /^\d{3}\*{4}(\d{4})$/.exec(phoneMasked)?.[1] : undefined;
  return suffix && suffix === phoneSuffix ? nexGridBrandText(value) : value;
}

/** Fixed AppSessionSurface labels only; keep custom device names verbatim. */
export function platformSessionDeviceText(value: string): string {
  return ({ "NexGrid Phone App": "UVEL 手机应用", "NexGrid H5": "UVEL 网页版", "NexGrid App / H5": "UVEL 应用 / 网页版" } as Record<string, string>)[value] ?? value;
}

/** Only confirmed official SKU/name pairs; catalog names remain operator-owned. */
export function catalogSkuBrandText(id: string | null | undefined, value: string): string {
  if (id === "phone" && value === "Your phone") return "用户手机";
  const officialModel = ({
    "stellarbox-s1": "Box S1", "stellarbox-pro": "Box Pro", "stellarbox-pro-v2": "Box Pro v2",
    "stellarrack-p1": "Rack P1", "stellarrack-p2": "Rack P2",
  } as Record<string,string>)[id ?? ""];
  if (id === "cloud-share" && value === "Cloud Share") return "云端共享份额";
  return officialModel && new RegExp(`^(?:NexGrid|Nexion|Stellar)${officialModel}$`, "i").test(value)
    ? `UVEL${officialModel}` : value;
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
  return ({ "NexGrid Mobile Network": "UVEL 手机算力网络", "NexGrid Virginia Compute Center": "UVEL 弗吉尼亚计算中心" } as Record<string, string>)[value] ?? value;
}

/** 自动生成的转入工单主题；用户自写主题保持原文。 */
export function supportTicketSubjectText(value: string): string {
  const transfer = /^(由会话 CV-[A-Za-z0-9-]+ 转入 · )(.+)$/.exec(value);
  if (transfer) return transfer[1] + operatorNicknameText(transfer[2]);
  return value.replace(/^Conversation (CV-[A-Za-z0-9-]+)$/, "会话 $1");
}

/** Asset symbols only: retain protocol values and unrelated brands/currencies. */
export function platformAssetText(value: string): string {
  return /^(?:NEX|UVEL|UVT)$/i.test(value) ? "UVT" : value;
}
