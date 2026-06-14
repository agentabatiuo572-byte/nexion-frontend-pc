// Build the L1 round-1 shard plan from M0 inventories.
// This file does not run the audit. It creates the dispatch denominator for
// runtime crawl agents and source-B task walkthroughs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INV = path.join(ROOT, "docs", "remediation", "inventory");
const AUDIT = path.join(ROOT, "docs", "audit");
const generatedAt = new Date().toISOString();

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function groupRoutes(routes, side, groups) {
  return groups.map((group) => ({
    id: group.id,
    side,
    title: group.title,
    kind: "runtime-crawl",
    routes: routes
      .filter((route) => group.match(route.route))
      .map((route) => route.route)
      .sort(),
    requiredEvidence: [
      "accessibility snapshot",
      "screenshot",
      "console errors",
      "interactive element result table",
      "modal five-tuple when applicable",
      "list baseline when applicable",
    ],
    status: "pending",
  }));
}

const routes = readJson(path.join(INV, "routes.json"));
const flows = readJson(path.join(INV, "business-flows.json"));

const nextPages = routes.nextReference.pages;
const uniPages = routes.uniapp.pages.map((page) => ({ route: page.h5Url }));
const adminRoutes = routes.admin.navRoutes.filter((route) => route.route);

const frontGroups = [
  { id: "FR-01", title: "home + market + phase/trust signals", match: (r) => /^\/$|#\/pages\/index\/index|\/market|\/trust|\/globe|\/search/.test(r) },
  { id: "FR-02", title: "onboarding + auth", match: (r) => /\/onboarding|\/login|\/register|\/ref/.test(r) },
  { id: "FR-03", title: "store + checkout + orders", match: (r) => /\/store/.test(r) },
  { id: "FR-04", title: "earn + devices + missions", match: (r) => /\/earn|\/daily|\/missions/.test(r) },
  { id: "FR-05", title: "wallet + finance actions", match: (r) => /\/me\/wallet|\/tx/.test(r) },
  { id: "FR-06", title: "profile + KYC + security + support", match: (r) => /(^\/me$|#\/pages\/me\/me|\/me\/(profile|security|support|help|kyc|risk|notifications|preferences|language))/.test(r) },
  { id: "FR-07", title: "team + commissions + rank", match: (r) => /\/team/.test(r) },
  { id: "FR-08", title: "genesis + staking + token economy", match: (r) => /\/genesis|\/staking/.test(r) },
  { id: "FR-09", title: "content/learn/events/developer", match: (r) => /\/learn|\/events|\/developer/.test(r) },
  { id: "FR-10", title: "me long-tail pages", match: (r) => /\/me\/(achievements|devices|goals|proof|receipts|replay-tour|trial|wrapped)/.test(r) },
];

const adminGroups = [
  { id: "AD-01", title: "overview / B cockpit routes", match: (r) => /\/overview/.test(r) },
  { id: "AD-02", title: "A platform governance", match: (r) => /\/platform|\/users/.test(r) },
  { id: "AD-03", title: "C account/user operations", match: (r) => /\/account|\/users/.test(r) },
  { id: "AD-04", title: "D finance", match: (r) => /\/finance/.test(r) },
  { id: "AD-05", title: "E devices", match: (r) => /\/devices/.test(r) },
  { id: "AD-06", title: "F network/team", match: (r) => /\/network/.test(r) },
  { id: "AD-07", title: "G finance products", match: (r) => /\/finance-products/.test(r) },
  { id: "AD-08", title: "H growth/content rhythm", match: (r) => /\/growth/.test(r) },
  { id: "AD-09", title: "I content/i18n", match: (r) => /\/content/.test(r) },
  { id: "AD-10", title: "J emergency", match: (r) => /\/emergency/.test(r) },
  { id: "AD-11", title: "K risk", match: (r) => /\/risk/.test(r) },
  { id: "AD-12", title: "L analytics", match: (r) => /\/analytics/.test(r) },
  { id: "AD-13", title: "console extra routes", match: (r) => /^\/$|\/platform\/params-registry/.test(r) },
];

const shards = [
  ...groupRoutes(nextPages, "nextReference", frontGroups).map((s) => ({ ...s, id: `NEXT-${s.id}` })),
  ...groupRoutes(uniPages, "uniapp", frontGroups).map((s) => ({ ...s, id: `UNI-${s.id}` })),
  ...groupRoutes(adminRoutes, "admin", adminGroups),
  {
    id: "CROSS-01",
    side: "cross",
    title: "feature mapping bidirectional audit",
    kind: "source-C-correspondence",
    routes: ["docs/remediation/inventory/feature-mapping.json"],
    requiredEvidence: ["frontend feature evidence", "admin surface evidence", "status ok/gap/extra"],
    status: "pending",
  },
  {
    id: "TASK-01",
    side: "cross",
    title: "source-B task walkthroughs",
    kind: "task-walkthrough",
    flows: flows.rows.map((flow) => flow.id),
    requiredEvidence: ["persona", "steps", "result", "persist/refresh check"],
    status: "pending",
  },
].filter((shard) => (shard.routes ? shard.routes.length > 0 : true));

const uncovered = {
  nextReference: nextPages.map((r) => r.route).filter((route) => !shards.some((s) => s.side === "nextReference" && s.routes?.includes(route))),
  uniapp: uniPages.map((r) => r.route).filter((route) => !shards.some((s) => s.side === "uniapp" && s.routes?.includes(route))),
  admin: adminRoutes.map((r) => r.route).filter((route) => !shards.some((s) => s.side === "admin" && s.routes?.includes(route))),
};

const plan = {
  generatedAt,
  description: "L1 round-1 shard dispatch plan generated from M0 route and business-flow inventories.",
  counts: {
    shards: shards.length,
    nextReferenceRoutes: nextPages.length,
    uniappRoutes: uniPages.length,
    adminRoutes: adminRoutes.length,
    uncoveredNextReference: uncovered.nextReference.length,
    uncoveredUniapp: uncovered.uniapp.length,
    uncoveredAdmin: uncovered.admin.length,
  },
  shards,
  uncovered,
};

writeJson(path.join(AUDIT, "l1-shards.json"), plan);
console.log("L1 shard plan generated");
console.log(JSON.stringify(plan.counts, null, 2));
