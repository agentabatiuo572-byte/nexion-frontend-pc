// L1 source-C feature mapping existence audit.
// Checks whether seed frontend routes and admin management surfaces exist in
// the M0 route inventory. Runtime operability is intentionally not judged here.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const INV = path.join(ROOT, "docs", "remediation", "inventory");
const AUDIT = path.join(ROOT, "docs", "audit");
const LEDGER = path.join(AUDIT, "ledger.ndjson");
const generatedAt = new Date().toISOString();

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readLedger() {
  const text = fs.readFileSync(LEDGER, "utf8").trim();
  return text ? text.split(/\r?\n/).map((line) => JSON.parse(line)) : [];
}

function writeLedger(rows) {
  fs.writeFileSync(LEDGER, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function nextStaticId(rows) {
  let max = 0;
  for (const row of rows) {
    const match = String(row.id || "").match(/^SD-(\d+)$/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return () => `SD-${String(++max).padStart(3, "0")}`;
}

function rebuildLedgerMd(rows) {
  const bySeverity = {};
  const byStatus = {};
  for (const row of rows) {
    bySeverity[row.severity] = (bySeverity[row.severity] || 0) + 1;
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
  }
  const md = `# Nexion Remediation Ledger

> Generated summary. Source of truth is \`docs/audit/ledger.ndjson\`.

Generated at: ${generatedAt}

## Summary

- Total: ${rows.length}
- By severity: ${JSON.stringify(bySeverity)}
- By status: ${JSON.stringify(byStatus)}

## Entries

| ID | Side | Severity | Category | Status | Route | Title |
|---|---|---|---|---|---|---|
${rows.map((row) => `| ${row.id} | ${row.side} | ${row.severity} | ${row.category} | ${row.status} | ${String(row.route).replace(/\|/g, "\\|")} | ${row.title.replace(/\|/g, "\\|")} |`).join("\n")}
`;
  fs.writeFileSync(path.join(AUDIT, "LEDGER.md"), md, "utf8");
}

const routes = readJson(path.join(INV, "routes.json"));
const mapping = readJson(path.join(INV, "feature-mapping.json"));
const ledger = readLedger();
const makeId = nextStaticId(ledger);
const existingDedup = new Set(ledger.map((row) => row.dedup_key));

const adminRoutes = new Set([
  ...routes.admin.navRoutes.map((route) => route.route),
  ...routes.admin.pages.map((route) => route.route),
]);
const uniRoutes = new Set(routes.uniapp.pages.map((route) => route.h5Url));
const nextRoutes = new Set(routes.nextReference.pages.map((route) => route.route));

function frontendExists(route) {
  if (route === "all-frontend-routes") return true;
  if (route.startsWith("#/")) return uniRoutes.has(`/${route}`);
  if (route.startsWith("/")) return nextRoutes.has(route);
  return true;
}

function adminExists(surface) {
  if (!surface.startsWith("/")) return true;
  return adminRoutes.has(surface);
}

function appendGap(row, missingAdmin) {
  const dedup = `cross:spec-gap:feature-mapping:${row.id}:missing-admin:${missingAdmin.join(",")}`.toLowerCase();
  if (existingDedup.has(dedup)) return null;
  existingDedup.add(dedup);
  const entry = {
    id: makeId(),
    side: "cross",
    route: "feature-mapping",
    title: `${row.id} missing admin surface(s): ${missingAdmin.join(", ")}`,
    category: "spec-gap",
    severity: "P1",
    repro: "Run node scripts/remediation-feature-map-audit.mjs and inspect docs/audit/feature-mapping-audit.md.",
    expected: "Every frontend configurable surface has a matching admin management route or an explicit readonly/exempt reason.",
    actual: `${row.frontendFeature} references missing admin surface(s): ${missingAdmin.join(", ")}`,
    evidence: ["docs/remediation/inventory/feature-mapping.json", "docs/audit/feature-mapping-audit.md"],
    dedup_key: dedup,
    cluster: "feature-mapping",
    status: "open",
    fix_pr: null,
    sentinel: null,
    found_by: "source-c-feature-map",
  };
  ledger.push(entry);
  return entry;
}

const rows = mapping.rows.map((row) => {
  const missingFrontend = row.frontendRoutes.filter((route) => !frontendExists(route));
  const missingAdmin = row.adminSurfaces.filter((surface) => !adminExists(surface));
  const appended = missingAdmin.length ? appendGap(row, missingAdmin) : null;
  return {
    id: row.id,
    frontendFeature: row.frontendFeature,
    frontendRoutes: row.frontendRoutes,
    adminSurfaces: row.adminSurfaces,
    missingFrontend,
    missingAdmin,
    preliminaryStatus: missingFrontend.length || missingAdmin.length ? "gap" : "exists-needs-runtime-operability",
    ledgerId: appended?.id || null,
  };
});

writeLedger(ledger);
rebuildLedgerMd(ledger);

const report = {
  generatedAt,
  counts: {
    mappings: rows.length,
    gaps: rows.filter((row) => row.preliminaryStatus === "gap").length,
    missingFrontendRefs: rows.reduce((sum, row) => sum + row.missingFrontend.length, 0),
    missingAdminRefs: rows.reduce((sum, row) => sum + row.missingAdmin.length, 0),
    ledgerEntries: ledger.length,
  },
  rows,
};

fs.writeFileSync(path.join(AUDIT, "feature-mapping-audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
fs.writeFileSync(
  path.join(AUDIT, "feature-mapping-audit.md"),
  `# Feature Mapping Existence Audit

Generated at: ${generatedAt}

## Summary

- Mapping rows: ${report.counts.mappings}
- Rows with existence gaps: ${report.counts.gaps}
- Missing frontend refs: ${report.counts.missingFrontendRefs}
- Missing admin refs: ${report.counts.missingAdminRefs}
- Ledger entries after audit: ${report.counts.ledgerEntries}

## Rows

| ID | Preliminary Status | Missing Frontend | Missing Admin |
|---|---|---|---|
${rows.map((row) => `| ${row.id} | ${row.preliminaryStatus} | ${row.missingFrontend.join("<br>") || "-"} | ${row.missingAdmin.join("<br>") || "-"} |`).join("\n")}
`,
  "utf8",
);

console.log("Feature mapping audit complete");
console.log(JSON.stringify(report.counts, null, 2));
