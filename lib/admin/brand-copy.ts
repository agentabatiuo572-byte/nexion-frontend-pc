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
  return value.replace(new RegExp(LEGACY_BRAND, "gi"), BRAND).replace(/NexGrid/gi, BRAND).replace(/Stellar(?=Box|Rack)/gi, BRAND);
}
