// Remediation M0 bootstrap.
//
// Generates the machine-readable denominators required by
// docs/remediation/MASTER-PLAN.md:
// - route inventory for admin / Next.js reference / UniApp
// - modal trigger inventory
// - static interaction count inventory
// - seed business-flow inventory
// - seed frontend/admin feature mapping inventory
// - audit ledger schema + initial seed ledger + human LEDGER.md
//
// This script is intentionally conservative: generated inventory files are
// overwritten, but the append-only ledger is created only when absent.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_ROOT = path.resolve(ROOT, "..");
const PROJECTS = {
  admin: ROOT,
  nextReference: path.join(PLAN_ROOT, "Nexion-prototype"),
  uniapp: path.join(PLAN_ROOT, "Nexion-uniapp"),
};
const REMEDIATION_DIR = path.join(ROOT, "docs", "remediation");
const INVENTORY_DIR = path.join(REMEDIATION_DIR, "inventory");
const AUDIT_DIR = path.join(ROOT, "docs", "audit");
const SHARDS_DIR = path.join(AUDIT_DIR, "shards");
const SCREENSHOTS_DIR = path.join(AUDIT_DIR, "screenshots");

const generatedAt = new Date().toISOString();

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function readJson(file, fallback) {
  const text = readText(file);
  if (!text.trim()) return fallback;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON: ${file}\n${error.message}`);
  }
}

function writeJson(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeText(file, value) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, value.endsWith("\n") ? value : `${value}\n`, "utf8");
}

function writeIfMissing(file, value) {
  if (fs.existsSync(file)) return false;
  writeText(file, value);
  return true;
}

function walk(dir, predicate, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (/node_modules|\.next|dist|\.git|\.tmp-design/.test(fp)) continue;
      walk(fp, predicate, acc);
    } else if (predicate(fp, entry.name)) {
      acc.push(fp);
    }
  }
  return acc;
}

function rel(projectRoot, file) {
  return path.relative(projectRoot, file).replace(/\\/g, "/");
}

function toNextRoute(appRoot, file) {
  const relative = rel(appRoot, file)
    .replace(/\/page\.tsx$/, "")
    .split("/")
    .filter((part) => !/^\(.+\)$/.test(part));
  const route = `/${relative.join("/")}`.replace(/\/$/, "");
  return route === "" ? "/" : route;
}

function routeFileForNext(projectRoot, route) {
  return walk(path.join(projectRoot, "app"), (fp, name) => name === "page.tsx")
    .find((file) => toNextRoute(path.join(projectRoot, "app"), file) === route);
}

function routeFileForAdminRoute(route) {
  const exact = routeFileForNext(ROOT, route);
  if (exact) return exact;
  const parts = String(route || "").split("/").filter(Boolean);
  if (parts.length === 2) return path.join(ROOT, "app", "(console)", "[domain]", "[module]", "page.tsx");
  return null;
}

function countMatches(text, re) {
  return (text.match(re) || []).length;
}

function countInteractions(text, kind) {
  const isVue = kind === "vue";
  return {
    clickHandlers: countMatches(text, isVue ? /@click|v-on:click/g : /onClick\s*=/g),
    buttons: countMatches(text, isVue ? /<button\b|<Button\b|<view[^>]*role=["']button/g : /<button\b|<Btn\b|<Button\b/g),
    links: countMatches(text, isVue ? /<navigator\b|url=["'][^"']+/g : /<Link\b|href\s*=/g),
    inputs: countMatches(text, isVue ? /<input\b|<textarea\b|<picker\b|v-model/g : /<input\b|<textarea\b|<select\b/g),
    toggles: countMatches(text, /switch|toggle|checkbox|Switch|Toggle|Checkbox/g),
    tablesOrLists: countMatches(text, /<table\b|<ul\b|<ol\b|List|Table|list-archetype|v-for/g),
    disabledSignals: countMatches(text, /disabled\s*=|:disabled\s*=|aria-disabled/g),
    toastSignals: countMatches(text, /toast|setToast|showToast|uni\.showToast/g),
  };
}

function getAdminNavRoutes() {
  try {
    const output = execFileSync(process.execPath, [path.join(ROOT, "scripts", "nav-routes.mjs")], {
      cwd: ROOT,
      encoding: "utf8",
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [route, id, status] = line.split("|");
        return { route, id, status, source: "lib/nav/console-nav.ts" };
      });
  } catch (error) {
    return [{ route: null, id: "nav-routes-error", status: "error", error: error.message }];
  }
}

function getNextRoutes(projectRoot) {
  const appRoot = path.join(projectRoot, "app");
  return walk(appRoot, (fp, name) => name === "page.tsx")
    .map((file) => ({
      route: toNextRoute(appRoot, file),
      file: rel(projectRoot, file),
      source: "app/page.tsx",
    }))
    .sort((a, b) => a.route.localeCompare(b.route));
}

function getAdminRoutes() {
  const appRoot = path.join(ROOT, "app");
  const pages = getNextRoutes(ROOT).map((row) => ({
    ...row,
    routeKind: row.route.includes("[") ? "dynamic" : "static",
  }));
  const navRoutes = getAdminNavRoutes();
  return {
    pages,
    navRoutes,
    crossCheck: {
      pageCount: pages.length,
      navRouteCount: navRoutes.filter((r) => r.route).length,
      dynamicPages: pages.filter((r) => r.routeKind === "dynamic").map((r) => r.route),
      sourceRoot: rel(ROOT, appRoot),
    },
  };
}

function getUniappRoutes() {
  const pagesJsonFile = path.join(PROJECTS.uniapp, "src", "pages.json");
  const pagesJson = readJson(pagesJsonFile, { pages: [] });
  const pages = (pagesJson.pages || []).map((page) => {
    const vueFile = path.join(PROJECTS.uniapp, "src", `${page.path}.vue`);
    return {
      route: `/${page.path}`,
      h5Url: `/#/${page.path}`,
      file: fs.existsSync(vueFile) ? rel(PROJECTS.uniapp, vueFile) : null,
      source: "src/pages.json",
      exists: fs.existsSync(vueFile),
    };
  });
  return {
    pages,
    crossCheck: {
      pageCount: pages.length,
      missingVueFiles: pages.filter((p) => !p.exists).map((p) => p.route),
    },
  };
}

function generateRoutesInventory() {
  const admin = getAdminRoutes();
  const nextReference = { pages: getNextRoutes(PROJECTS.nextReference) };
  const uniapp = getUniappRoutes();
  return {
    generatedAt,
    description: "M0 route denominator. Re-run scripts/remediation-m0.mjs after route changes.",
    counts: {
      adminPages: admin.pages.length,
      adminNavRoutes: admin.navRoutes.filter((r) => r.route).length,
      nextReferencePages: nextReference.pages.length,
      uniappPages: uniapp.pages.length,
    },
    admin,
    nextReference,
    uniapp,
  };
}

const MODAL_PATTERNS = [
  "OperationConfirmModal",
  "KConfirmModal",
  "ViewParamModal",
  "ConfirmDialog",
  "Modal",
  "Drawer",
  "Sheet",
  "Dialog",
  "setActionConfirm",
  "setCf",
  "setModal",
  "setConfirm",
  "confirmReq",
];

function scanModalInventory() {
  const files = [
    ...walk(path.join(ROOT, "app"), (fp, name) => /\.(tsx|ts)$/.test(name)),
    ...walk(path.join(ROOT, "lib"), (fp, name) => /\.(tsx|ts)$/.test(name)),
  ];
  const rows = [];
  for (const file of files) {
    const text = readText(file);
    const counts = {};
    for (const pattern of MODAL_PATTERNS) {
      const count = countMatches(text, new RegExp(`\\b${pattern}\\b`, "g"));
      if (count) counts[pattern] = count;
    }
    if (!Object.keys(counts).length) continue;
    rows.push({
      id: `modal-${String(rows.length + 1).padStart(4, "0")}`,
      file: rel(ROOT, file),
      counts,
      clickHandlers: countMatches(text, /onClick\s*=/g),
      operationSemantics: "unknown-until-L1-runtime-five-tuple",
      needsModalSpec: true,
    });
  }
  return {
    generatedAt,
    description: "Static modal denominator. L1 runtime audit must open every trigger and record the five-tuple.",
    patterns: MODAL_PATTERNS,
    count: rows.length,
    rows,
  };
}

function routeInteractionRows(side, projectRoot, routes, kind) {
  return routes.map((route) => {
    let file = route.file ? path.join(projectRoot, route.file) : null;
    if (!file || !fs.existsSync(file)) {
      if (side === "admin") file = routeFileForAdminRoute(route.route);
      else if (side === "nextReference") file = routeFileForNext(projectRoot, route.route);
    }
    const text = file ? readText(file) : "";
    return {
      side,
      route: route.route,
      file: file ? rel(projectRoot, file) : null,
      routeSource: route.source || null,
      counts: countInteractions(text, kind),
      auditStatus: "static-count-only-runtime-pending",
    };
  });
}

function generateInteractionsInventory(routesInventory) {
  const adminNavRoutes = routesInventory.admin.navRoutes
    .filter((route) => route.route)
    .map((route) => ({ ...route, file: null }));
  const adminExtraPages = routesInventory.admin.pages
    .filter((page) => !routesInventory.admin.navRoutes.some((route) => route.route === page.route));
  return {
    generatedAt,
    description: "Static route-level interaction counts. Runtime crawl must reconcile actual interactive elements against this baseline.",
    rows: [
      ...routeInteractionRows("admin", ROOT, adminNavRoutes, "tsx"),
      ...routeInteractionRows("admin", ROOT, adminExtraPages, "tsx"),
      ...routeInteractionRows("nextReference", PROJECTS.nextReference, routesInventory.nextReference.pages, "tsx"),
      ...routeInteractionRows("uniapp", PROJECTS.uniapp, routesInventory.uniapp.pages, "vue"),
    ],
  };
}

function generateBusinessFlows() {
  const flows = [
    ["FRONT-001", "uniapp", "新用户注册到首台设备激活", ["#/pages/onboarding/intro", "#/pages/register/register", "#/pages/onboarding/connect", "#/pages/index/index"]],
    ["FRONT-002", "uniapp", "商城选品到 checkout 支付完成再到订单详情", ["#/pages/store/store", "#/pages/store/detail", "#/pages/store/checkout", "#/pages/store/order-detail"]],
    ["FRONT-003", "uniapp", "钱包充值常规链路", ["#/pages/me/wallet", "#/pages/me/wallet-topup"]],
    ["FRONT-004", "uniapp", "KYC Express 到提现申请与 tracking", ["#/pages/me/kyc", "#/pages/me/wallet-withdraw", "#/pages/me/wallet-withdraw-tracking"]],
    ["FRONT-005", "uniapp", "staking 档位选择、确认、收益展示", ["#/pages/staking/staking", "#/pages/staking/how-it-works"]],
    ["FRONT-006", "uniapp", "Genesis 购买、holder 权益、marketplace", ["#/pages/genesis/genesis", "#/pages/genesis/holder", "#/pages/genesis/marketplace"]],
    ["FRONT-007", "uniapp", "团队佣金、双轨、等级说明闭环", ["#/pages/team/team", "#/pages/team/commissions", "#/pages/team/binary", "#/pages/team/rank"]],
    ["FRONT-008", "uniapp", "客服工单创建、查看、状态反馈", ["#/pages/me/support", "#/pages/me/support-tickets"]],
    ["ADMIN-001", "admin", "补全一条 i18n 文案并保存", ["/content/i18n"]],
    ["ADMIN-002", "admin", "调整 SKU 价格、库存或上下架状态", ["/devices/pricing"]],
    ["ADMIN-003", "admin", "审核提现单：通过、驳回并留原因", ["/finance/withdrawals"]],
    ["ADMIN-004", "admin", "调整提现参数并写入审计", ["/finance/params"]],
    ["ADMIN-005", "admin", "处置风险用户：冻结、解冻、升级 KYC", ["/risk/scoring", "/users/search/[id]"]],
    ["ADMIN-006", "admin", "调整 staking/Genesis/NEX 经济参数", ["/finance-products/staking"]],
    ["ADMIN-007", "admin", "配置活动/任务并验证前端存在对应位", ["/growth/rhythm"]],
    ["ADMIN-008", "admin", "发起紧急开关/地理封锁/篡改处置", ["/emergency/killswitch", "/emergency/geoblock", "/emergency/tamper"]],
    ["CROSS-001", "cross", "前端可配置功能点随机抽样反查后台入口", ["inventory/feature-mapping.json"]],
    ["CROSS-002", "cross", "后台管理项随机抽样反查前端业务位", ["inventory/feature-mapping.json"]],
  ];
  return {
    generatedAt,
    description: "Seed business flows. L1 source B expands each row into task scripts and runtime evidence.",
    rows: flows.map(([id, side, title, routes]) => ({
      id,
      side,
      title,
      routes,
      persona: side === "admin" ? "operator+superadmin" : side === "uniapp" ? "end-user" : "auditor",
      expectedOutcome: "task-completes-with-persisted-state-or-explicit-readonly-reason",
      status: "seed-needs-runtime-walkthrough",
    })),
  };
}

function generateFeatureMapping() {
  const rows = [
    ["FM-001", "SKU catalog fields: price, daily earn, inventory, lifecycle, status", ["#/pages/store/store", "#/pages/store/detail"], ["/devices/pricing", "/devices/trade-in"]],
    ["FM-002", "Checkout payment rails, fees, device cap, order states", ["#/pages/store/checkout", "#/pages/store/orders"], ["/devices/orders", "/finance/params"]],
    ["FM-003", "Withdrawal rules: min, cap, fee, daily count, KYC gate", ["#/pages/me/wallet-withdraw"], ["/finance/params", "/risk/withdrawal-rules"]],
    ["FM-004", "Top-up channels and KYC Express copy/status", ["#/pages/me/wallet-topup"], ["/finance/recon", "/content/i18n"]],
    ["FM-005", "Staking plans and APY display", ["#/pages/staking/staking"], ["/finance-products/staking"]],
    ["FM-006", "Genesis dividend, slot supply, marketplace rules", ["#/pages/genesis/genesis", "#/pages/genesis/marketplace"], ["/finance-products/genesis"]],
    ["FM-007", "NEX exchange and repurchase rates", ["#/pages/me/wallet-exchange", "#/pages/me/wallet-repurchase"], ["/finance-products/exchange"]],
    ["FM-008", "Team unilevel rates and commission cooldown", ["#/pages/team/commissions", "#/pages/team/unilevel"], ["/network/royalty"]],
    ["FM-009", "Binary settlement, cap, weak/strong leg rules", ["#/pages/team/binary"], ["/network/binary"]],
    ["FM-010", "V-rank thresholds and benefits", ["#/pages/team/rank"], ["/network/v-rank"]],
    ["FM-011", "Leadership pool rules and reward periods", ["#/pages/team/leadership-pool"], ["/network/leadership-pool"]],
    ["FM-012", "Daily missions, events, growth tasks", ["#/pages/daily/daily", "#/pages/events/events", "#/pages/missions/missions"], ["/growth/phase", "/growth/quest", "/growth/events", "/growth/daily", "/growth/milestones"]],
    ["FM-013", "i18n user-visible copy", ["all-frontend-routes"], ["/content/i18n"]],
    ["FM-014", "Notification templates and priority", ["#/pages/me/notifications"], ["/content/notifications"]],
    ["FM-015", "KYC levels, user freezes, risk score display", ["#/pages/me/kyc", "#/pages/me/security"], ["/risk/scoring", "/users/search"]],
    ["FM-016", "Feature/module switches and page module visibility", ["all-frontend-routes"], ["/platform/params-registry"]],
    ["FM-017", "Trust center/NEX proof disclosure copy", ["#/pages/trust/trust", "#/pages/trust/nex", "#/pages/me/risk-disclosure"], ["/content/i18n", "/platform/params-registry"]],
    ["FM-018", "Support tickets and help center content", ["#/pages/me/support", "#/pages/me/support-tickets", "#/pages/me/help"], ["/content/support"]],
  ];
  return {
    generatedAt,
    description: "Seed feature mapping denominator. L3a turns status to ok/gap/extra after runtime and spec audit.",
    statusLegend: {
      "needs-audit": "M0 seed only; L1/L3a must verify both directions",
      ok: "Frontend function has a real admin management surface and the admin surface is operational",
      gap: "Frontend needs admin management but no complete admin surface exists",
      extra: "Admin management exists but no frontend business surface exists",
    },
    rows: rows.map(([id, frontendFeature, frontendRoutes, adminSurfaces]) => ({
      id,
      frontendFeature,
      frontendRoutes,
      adminSurfaces,
      category: "configurable-business-surface",
      status: "needs-audit",
      evidence: [],
      notes: "",
    })),
  };
}

const ledgerSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Nexion remediation ledger entry",
  type: "object",
  required: [
    "id",
    "side",
    "route",
    "title",
    "category",
    "severity",
    "repro",
    "expected",
    "actual",
    "evidence",
    "dedup_key",
    "cluster",
    "status",
    "sentinel",
    "found_by",
  ],
  properties: {
    id: { type: "string" },
    side: { enum: ["frontend", "admin", "cross", "uniapp"] },
    route: { type: ["string", "array", "null"] },
    title: { type: "string" },
    category: {
      enum: [
        "dead-control",
        "fake-write",
        "modal-blocked",
        "flow-break",
        "task-fail",
        "spec-gap",
        "port-drift",
        "list-capability",
        "layout",
        "copy",
        "i18n",
        "console-error",
        "data-canon",
        "meta-leak",
      ],
    },
    severity: { enum: ["P0", "P1", "P2", "P3"] },
    repro: { type: "string" },
    expected: { type: "string" },
    actual: { type: "string" },
    evidence: { type: "array" },
    dedup_key: { type: "string" },
    cluster: { type: "string" },
    status: { enum: ["open", "specd", "fixed", "verified", "closed", "fix-in-port"] },
    fix_pr: { type: ["string", "null"] },
    sentinel: { type: ["string", "null"] },
    found_by: { type: "string" },
  },
};

function seedLedgerEntries() {
  const mk = (id, side, route, title, category, severity, actual) => ({
    id,
    side,
    route,
    title,
    category,
    severity,
    repro: "Seeded from MASTER-PLAN facts; L1 must reproduce with runtime evidence.",
    expected: "Runtime behavior matches the declared business operation and project invariants.",
    actual,
    evidence: ["docs/remediation/MASTER-PLAN.md"],
    dedup_key: `${side}:${category}:${route}:${title}`.toLowerCase(),
    cluster: category,
    status: "open",
    fix_pr: null,
    sentinel: null,
    found_by: "master-plan-seed",
  });
  return [
    mk("INIT-001", "frontend", "/", "Home leaks internal P1-P6 phase labels", "meta-leak", "P0", "Reference-source Home reportedly exposes internal phase labels."),
    mk("INIT-002", "admin", "/content/i18n", "i18n fill modal has no editable copy field", "modal-blocked", "P1", "The Fill action opens a modal with no text editing path."),
    mk("INIT-003", "admin", "all-admin-list-routes", "Admin information lists lack pagination and some lack filters", "list-capability", "P1", "List/table surfaces are missing pagination/filter/search/sort/empty-state baseline."),
    mk("INIT-004", "admin", "C-domain", "C domain 2FA action is toast-only fake write", "fake-write", "P0", "2FA operation presents success feedback without persisted state change."),
    mk("INIT-005", "frontend", "all-next-reference-routes", "Reference source has 6 dead href anchors", "dead-control", "P1", "Known href=\"#\" remnants need L1 reproduction and routing/fix-in-port decision."),
    mk("INIT-006", "frontend", "i18n", "Reference source en/zh i18n key mismatch", "i18n", "P1", "Known en/zh diff of 99 keys needs refreshed count and UniApp migration handling."),
    mk("INIT-007", "cross", "feature-mapping", "No full frontend-admin feature mapping exists", "spec-gap", "P0", "Configurable frontend business points are not yet reconciled to admin management surfaces."),
    mk("INIT-008", "uniapp", "all-uniapp-routes", "UniApp full-route migration needs batch audit against reference behavior", "port-drift", "P1", "UniApp is delivery target and must carry fix-in-port behavior rather than copying reference bugs."),
  ];
}

function writeLedgerIfMissing() {
  const ledgerFile = path.join(AUDIT_DIR, "ledger.ndjson");
  if (fs.existsSync(ledgerFile)) return false;
  const lines = seedLedgerEntries().map((entry) => JSON.stringify(entry));
  writeText(ledgerFile, lines.join("\n"));
  return true;
}

function readLedger() {
  const ledgerFile = path.join(AUDIT_DIR, "ledger.ndjson");
  const text = readText(ledgerFile);
  if (!text.trim()) return [];
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid ledger JSON at line ${index + 1}: ${error.message}`);
      }
    });
}

function generateLedgerMarkdown(entries) {
  const byStatus = {};
  const bySeverity = {};
  for (const entry of entries) {
    byStatus[entry.status] = (byStatus[entry.status] || 0) + 1;
    bySeverity[entry.severity] = (bySeverity[entry.severity] || 0) + 1;
  }
  const rows = entries
    .map((entry) => `| ${entry.id} | ${entry.side} | ${entry.severity} | ${entry.category} | ${entry.status} | ${String(entry.route).replace(/\|/g, "\\|")} | ${entry.title.replace(/\|/g, "\\|")} |`)
    .join("\n");
  return `# Nexion Remediation Ledger

> Generated by \`node scripts/remediation-m0.mjs\`.
> Source of truth is \`docs/audit/ledger.ndjson\`; do not hand-edit this summary.

Generated at: ${generatedAt}

## Summary

- Total: ${entries.length}
- By severity: ${JSON.stringify(bySeverity)}
- By status: ${JSON.stringify(byStatus)}

## Entries

| ID | Side | Severity | Category | Status | Route | Title |
|---|---|---|---|---|---|---|
${rows}
`;
}

function runtimeCrawlProtocol() {
  return `# Runtime Crawl Protocol

This SOP belongs to MASTER-PLAN L1 source A.

## Per Route

1. Start the relevant dev server and warm the route with HTTP first.
2. Navigate with a browser.
3. Capture accessibility snapshot, screenshot, console errors, and failed network requests.
4. Enumerate clickable/input/select/toggle elements from the runtime DOM.
5. Trigger each element once in an isolated state.
6. Classify the effect: route change / DOM state change / modal appears / toast appears / no observable effect.
7. Record dead-control when no effect is observable.
8. Record fake-write when feedback appears but refresh/persisted state does not retain the change.

## Every Modal

Record the five-tuple:

1. Has required input controls?
2. Is confirm initially disabled?
3. If disabled, is the visible reason clear?
4. Can a valid value be submitted?
5. After submit, does the target state change and persist?

## Every List/Table

Record the list baseline:

1. Pagination or explicit exemption.
2. Page size and total count when paginated.
3. Filters.
4. Search.
5. Sorting.
6. Empty state.

Missing baseline items become category \`list-capability\`.
`;
}

function main() {
  ensureDir(INVENTORY_DIR);
  ensureDir(AUDIT_DIR);
  ensureDir(SHARDS_DIR);
  ensureDir(SCREENSHOTS_DIR);

  const routes = generateRoutesInventory();
  writeJson(path.join(INVENTORY_DIR, "routes.json"), routes);
  writeJson(path.join(INVENTORY_DIR, "modals.json"), scanModalInventory());
  writeJson(path.join(INVENTORY_DIR, "interactions.json"), generateInteractionsInventory(routes));
  writeJson(path.join(INVENTORY_DIR, "business-flows.json"), generateBusinessFlows());
  writeJson(path.join(INVENTORY_DIR, "feature-mapping.json"), generateFeatureMapping());
  writeJson(path.join(AUDIT_DIR, "ledger.schema.json"), ledgerSchema);
  const ledgerCreated = writeLedgerIfMissing();
  writeText(path.join(AUDIT_DIR, "LEDGER.md"), generateLedgerMarkdown(readLedger()));
  writeIfMissing(path.join(AUDIT_DIR, "runtime-crawl-protocol.md"), runtimeCrawlProtocol());

  const summary = {
    generatedAt,
    routes: routes.counts,
    modalFiles: readJson(path.join(INVENTORY_DIR, "modals.json"), { count: 0 }).count,
    interactionRows: readJson(path.join(INVENTORY_DIR, "interactions.json"), { rows: [] }).rows.length,
    businessFlows: readJson(path.join(INVENTORY_DIR, "business-flows.json"), { rows: [] }).rows.length,
    featureMappings: readJson(path.join(INVENTORY_DIR, "feature-mapping.json"), { rows: [] }).rows.length,
    ledgerCreated,
    ledgerEntries: readLedger().length,
  };
  writeJson(path.join(REMEDIATION_DIR, "m0-summary.json"), summary);

  console.log("M0 remediation bootstrap complete");
  console.log(JSON.stringify(summary, null, 2));
}

main();
