export type AttributionLink = Readonly<{ label: string; href: string }>;

/** 归因入口只能去这些页，值是目标内容要的读权限。 */
export const ATTRIBUTION_ROUTE_READ: Readonly<Record<string, string>> = {
  "/analytics/funnel-cohort": "bi_l2_read",
  "/analytics/operations": "bi_l4_read",
  "/analytics/financial": "bi_l3_read",
  "/overview/rhythm": "overview_b4_read",
  "/growth/phase": "growth_h1_read",
  "/content/copy-ab": "content_i1_read",
  "/network/commissions": "network_f5_read",
};

export const L2_ATTRIBUTION_LINKS: readonly AttributionLink[] = [
  { label: "运营阶段状态", href: "/overview/rhythm" },
  { label: "运营阶段设置", href: "/growth/phase" },
  { label: "页面文案对比测试", href: "/content/copy-ab" },
  { label: "奖励记录核对", href: "/network/commissions" },
];

export function assertL1AttributionLinks(
  links: readonly { label: string; href?: string }[],
): readonly AttributionLink[] {
  for (const link of links) {
    if (!link.href || !(link.href in ATTRIBUTION_ROUTE_READ)) {
      throw new Error(`L1_ATTRIBUTION_ROUTE_INVALID:${link.label}`);
    }
  }
  return links as readonly AttributionLink[];
}
