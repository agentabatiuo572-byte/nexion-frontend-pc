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
  { label: "B4 节奏", href: "/overview/rhythm" },
  { label: "H1 Phase", href: "/growth/phase" },
  { label: "I 域文案", href: "/content/copy-ab" },
  { label: "F 域渠道", href: "/network/commissions" },
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
