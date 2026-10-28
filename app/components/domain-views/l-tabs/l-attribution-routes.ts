export type AttributionLink = Readonly<{ label: string; href: string }>;

const REGISTERED_ATTRIBUTION_ROUTES = new Set([
  "/analytics/funnel-cohort",
  "/analytics/operations",
  "/analytics/financial",
  "/overview/rhythm",
  "/growth/phase",
  "/content/copy-ab",
  "/network/commissions",
]);

export const L2_ATTRIBUTION_LINKS: readonly AttributionLink[] = [
  { label: "运营阶段状态", href: "/overview/rhythm" },
  { label: "运营阶段设置", href: "/growth/phase" },
  { label: "页面文案对比测试", href: "/content/copy-ab" },
  { label: "佣金记录核对", href: "/network/commissions" },
];

export function assertL1AttributionLinks(
  links: readonly { label: string; href?: string }[],
): readonly AttributionLink[] {
  for (const link of links) {
    if (!link.href || !REGISTERED_ATTRIBUTION_ROUTES.has(link.href)) {
      throw new Error(`L1_ATTRIBUTION_ROUTE_INVALID:${link.label}`);
    }
  }
  return links as readonly AttributionLink[];
}
