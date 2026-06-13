import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SHARDS = path.join(ROOT, "docs", "audit", "shards");

function parseNdjson(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function routeScore(row) {
  const runtime = row.evidence?.runtime ?? {};
  const baseline = runtime.listBaseline ?? {};
  const tableIssues = baseline.tableIssues ?? [];
  const blockers = tableIssues.filter((issue) => issue.severity === "P1").length;
  const warnings = tableIssues.filter((issue) => issue.severity !== "P1").length;
  return {
    captured: row.status === "captured" ? 1 : 0,
    blockers,
    warnings,
    controls: Number(baseline.paginationControlCount ?? baseline.paginationPagerCount ?? 0),
    standardControls: Number(baseline.paginationPagerCount ?? 0),
    exemptions: (baseline.paginationExemptions ?? []).filter((item) => item.valid).length,
  };
}

function betterRouteRow(a, b) {
  if (!a) return b;
  const as = routeScore(a);
  const bs = routeScore(b);
  if (as.captured !== bs.captured) return bs.captured > as.captured ? b : a;
  if (as.blockers !== bs.blockers) return bs.blockers < as.blockers ? b : a;
  if (as.warnings !== bs.warnings) return bs.warnings < as.warnings ? b : a;
  if (as.controls !== bs.controls) return bs.controls > as.controls ? b : a;
  if (as.exemptions !== bs.exemptions) return bs.exemptions > as.exemptions ? b : a;
  return b;
}

const rowsByRoute = new Map();
for (const file of fs.readdirSync(SHARDS).filter((name) => /^ad-\d+-runtime\.ndjson$/i.test(name)).sort()) {
  for (const row of parseNdjson(path.join(SHARDS, file))) {
    rowsByRoute.set(row.route, betterRouteRow(rowsByRoute.get(row.route), { ...row, shardFile: file }));
  }
}

const findings = [];
const warnings = [];
const invalidExemptions = [];
const tableRoutes = [];

for (const row of Array.from(rowsByRoute.values()).sort((a, b) => String(a.route).localeCompare(String(b.route)))) {
  if (row.status !== "captured") {
    findings.push({ route: row.route, shard: row.shardId, issue: "route-not-captured", status: row.status, error: row.error ?? null });
    continue;
  }
  const baseline = row.evidence?.runtime?.listBaseline ?? {};
  const tables = row.evidence?.runtime?.tables ?? [];
  if (tables.length === 0) continue;
  tableRoutes.push(row.route);

  if (!Array.isArray(baseline.tableIssues) || !tables.every((table) => Object.prototype.hasOwnProperty.call(table, "dataRows"))) {
    findings.push({ route: row.route, shard: row.shardId, shardFile: row.shardFile, issue: "stale-runtime-list-schema" });
    continue;
  }

  for (const item of baseline.paginationExemptions ?? []) {
    if (!item.valid) invalidExemptions.push({ route: row.route, shard: row.shardId, exemption: item });
  }

  for (const issue of baseline.tableIssues ?? []) {
    const target = issue.severity === "P1" ? findings : warnings;
    target.push({ route: row.route, shard: row.shardId, shardFile: row.shardFile, ...issue });
  }
}

const result = {
  status: findings.length === 0 && invalidExemptions.length === 0 ? "passed" : "failed",
  adminRoutesSeen: rowsByRoute.size,
  tableRoutes: tableRoutes.length,
  blockerCount: findings.length,
  warningCount: warnings.length,
  invalidExemptionCount: invalidExemptions.length,
  findings,
  warnings,
  invalidExemptions,
};

console.log(JSON.stringify(result, null, 2));
if (result.status !== "passed") process.exit(1);
