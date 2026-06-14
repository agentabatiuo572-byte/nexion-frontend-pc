// Source C operability audit.
// Existence audit answers "does a route exist"; this answers whether mapped
// frontend features have runtime evidence and whether unclosed ledger issues block
// the frontend/admin business operation.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT = path.join(ROOT, "docs", "audit");
const SHARDS = path.join(AUDIT, "shards");
const INV = path.join(ROOT, "docs", "remediation", "inventory");
const generatedAt = new Date().toISOString();

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readNdjson(file) {
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8").trim();
  if (!text) return [];
  return text.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function normalizeRoute(route) {
  if (route == null) return "";
  const value = String(route);
  if (value.startsWith("#/")) return `/${value}`;
  return value;
}

function asRoutes(value) {
  if (Array.isArray(value)) return value.map(normalizeRoute);
  return [normalizeRoute(value)];
}

function routeMatchesLedger(ledgerRoute, targetRoute, scope) {
  const normalizedTarget = normalizeRoute(targetRoute);
  return asRoutes(ledgerRoute).some((route) => {
    if (!route) return false;
    if (route === normalizedTarget) return true;
    if (scope === "frontend" && route === "all-frontend-routes" && normalizedTarget.startsWith("/#/pages/")) return true;
    if (scope === "frontend" && route === "all-next-reference-routes" && !normalizedTarget.startsWith("/#/")) return true;
    if (route.endsWith("[productId]") && normalizedTarget.includes("/store/detail")) return true;
    if (route.includes("[") && route.replace(/\[[^\]]+\]/g, "").length > 1) {
      return normalizedTarget.startsWith(route.replace(/\[[^\]]+\]/g, ""));
    }
    return false;
  });
}

function groupByRoute(rows) {
  const map = new Map();
  for (const row of rows) {
    const route = normalizeRoute(row.route);
    if (!map.has(route)) map.set(route, []);
    map.get(route).push(row);
  }
  return map;
}

function loadShardRows(suffix) {
  if (!fs.existsSync(SHARDS)) return [];
  return fs
    .readdirSync(SHARDS)
    .filter((file) => file.endsWith(suffix))
    .flatMap((file) => readNdjson(path.join(SHARDS, file)).map((row) => ({ ...row, evidenceFile: `docs/audit/shards/${file}` })));
}

function proofMappingId(row) {
  const id = String(row.id || "");
  const fm = id.match(/^(FM-\d{3})/);
  if (fm) return fm[1];
  return {
    "FT-014A": "FM-007",
    "FT-014B": "FM-007",
    "FT-015A": "FM-008",
    "FT-015B": "FM-010",
    "FT-015C": "FM-009",
    "FT-015D": "FM-011",
  }[id] || null;
}

function proofSide(row) {
  if (row.side === "admin") return "admin";
  if (["uniapp", "frontend", "nextReference"].includes(row.side)) return "frontend";
  return row.side || "unknown";
}

const mapping = readJson(path.join(INV, "feature-mapping.json"));
const ledger = readNdjson(path.join(AUDIT, "ledger.ndjson"));
const NON_BLOCKING_LEDGER_STATUSES = new Set(["verified", "closed", "fix-in-port"]);
const blockingLedger = ledger.filter(
  (entry) => !NON_BLOCKING_LEDGER_STATUSES.has(entry.status) && ["P0", "P1"].includes(entry.severity),
);

const adminRuntimeByRoute = groupByRoute(loadShardRows("-runtime.ndjson").filter((row) => row.side === "admin" && row.status === "captured"));
const frontRuntimeByRoute = groupByRoute(
  loadShardRows("-runtime.ndjson").filter((row) => ["nextReference", "uniapp"].includes(row.side) && row.status === "captured"),
);
const adminActionByRoute = groupByRoute(loadShardRows("-action-sample.ndjson").filter((row) => row.side === "admin"));
const frontActionByRoute = groupByRoute(loadShardRows("-front-action-sample.ndjson"));
const walkthroughProofRows = loadShardRows("-proof.ndjson")
  .filter((row) => row.status === "passed")
  .map((row) => ({ ...row, mappingId: proofMappingId(row), proofSide: proofSide(row) }))
  .filter((row) => row.mappingId);

function evidenceForRoute(route, runtimeMap, actionMap, scope) {
  const normalized = normalizeRoute(route);
  return {
    route: normalized,
    routeCaptured: normalized === "all-frontend-routes" ? true : (runtimeMap.get(normalized)?.length || 0) > 0,
    runtimeFiles: [...new Set((runtimeMap.get(normalized) || []).map((row) => row.evidenceFile))],
    actionSamples: (actionMap.get(normalized) || []).length,
    actionFiles: [...new Set((actionMap.get(normalized) || []).map((row) => row.evidenceFile))],
    noObservable: (actionMap.get(normalized) || []).filter((row) => row.result?.classification === "no-observable-change").length,
    hashOnly: (actionMap.get(normalized) || []).filter((row) => row.result?.classification === "hash-only-no-content").length,
    businessIncomplete: (actionMap.get(normalized) || []).filter((row) => row.result?.classification === "business-incomplete-modal").length,
    ledgerIds: blockingLedger.filter((entry) => routeMatchesLedger(entry.route, normalized, scope)).map((entry) => entry.id),
  };
}

function summarizeEvidence(items) {
  return {
    routeCaptured: items.filter((item) => item.routeCaptured).length,
    routes: items.length,
    actionSamples: items.reduce((sum, item) => sum + item.actionSamples, 0),
    blockingLedgerIds: [...new Set(items.flatMap((item) => item.ledgerIds))],
    weakActionSignals: items.reduce((sum, item) => sum + item.noObservable + item.hashOnly + item.businessIncomplete, 0),
  };
}

const rows = mapping.rows.map((row) => {
  const frontendRoutes = row.frontendRoutes.map(normalizeRoute);
  const adminSurfaces = row.adminSurfaces.map(normalizeRoute);
  const frontendEvidence = frontendRoutes.map((route) => evidenceForRoute(route, frontRuntimeByRoute, frontActionByRoute, "frontend"));
  const adminEvidence = adminSurfaces.map((route) => evidenceForRoute(route, adminRuntimeByRoute, adminActionByRoute, "admin"));
  const proofRows = walkthroughProofRows.filter((proof) => proof.mappingId === row.id);
  const frontendProofRows = proofRows.filter((proof) => proof.proofSide === "frontend");
  const adminProofRows = proofRows.filter((proof) => proof.proofSide === "admin");
  const frontendSummary = {
    ...summarizeEvidence(frontendEvidence),
    actionSamples: summarizeEvidence(frontendEvidence).actionSamples + frontendProofRows.length,
    walkthroughProofFiles: [...new Set(frontendProofRows.map((proof) => proof.evidenceFile))],
    walkthroughProofIds: frontendProofRows.map((proof) => proof.id),
  };
  const adminSummary = {
    ...summarizeEvidence(adminEvidence),
    actionSamples: summarizeEvidence(adminEvidence).actionSamples + adminProofRows.length,
    walkthroughProofFiles: [...new Set(adminProofRows.map((proof) => proof.evidenceFile))],
    walkthroughProofIds: adminProofRows.map((proof) => proof.id),
  };
  const missingAdmin = adminEvidence.filter((item) => !item.routeCaptured).map((item) => item.route);
  const missingFrontend = frontendEvidence.filter((item) => !item.routeCaptured).map((item) => item.route);
  const blockingLedgerIds = [...new Set([...frontendSummary.blockingLedgerIds, ...adminSummary.blockingLedgerIds])].sort();

  let operabilityStatus = "provisionally-operable";
  const reasons = [];
  if (missingFrontend.length || missingAdmin.length) {
    operabilityStatus = "gap";
    if (missingFrontend.length) reasons.push(`missing frontend route(s): ${missingFrontend.join(", ")}`);
    if (missingAdmin.length) reasons.push(`missing admin surface(s): ${missingAdmin.join(", ")}`);
  } else if (blockingLedgerIds.length) {
    operabilityStatus = "blocked-by-ledger";
    reasons.push(`blocked by unclosed ledger: ${blockingLedgerIds.join(", ")}`);
  } else if (adminSummary.actionSamples === 0 || frontendSummary.actionSamples === 0) {
    operabilityStatus = "needs-task-walkthrough";
    if (adminSummary.actionSamples === 0) reasons.push("admin mapped surface has no sampled business action yet");
    if (frontendSummary.actionSamples === 0) reasons.push("frontend mapped route has no sampled user action yet");
  }

  return {
    id: row.id,
    frontendFeature: row.frontendFeature,
    category: row.category,
    frontendRoutes,
    adminSurfaces,
    operabilityStatus,
    reasons,
    frontendSummary,
    adminSummary,
    frontendEvidence,
    adminEvidence,
  };
});

const counts = {
  mappings: rows.length,
  gap: rows.filter((row) => row.operabilityStatus === "gap").length,
  blockedByLedger: rows.filter((row) => row.operabilityStatus === "blocked-by-ledger").length,
  needsTaskWalkthrough: rows.filter((row) => row.operabilityStatus === "needs-task-walkthrough").length,
  provisionallyOperable: rows.filter((row) => row.operabilityStatus === "provisionally-operable").length,
};

const report = { generatedAt, counts, rows };

fs.writeFileSync(path.join(AUDIT, "feature-mapping-operability-audit.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
fs.writeFileSync(
  path.join(AUDIT, "feature-mapping-operability-audit.md"),
  `# Feature Mapping Operability Audit

Generated at: ${generatedAt}

## Summary

- Mapping rows: ${counts.mappings}
- Gaps: ${counts.gap}
- Blocked by unclosed ledger: ${counts.blockedByLedger}
- Needs task walkthrough: ${counts.needsTaskWalkthrough}
- Provisionally operable: ${counts.provisionallyOperable}

## Rows

| ID | Operability Status | Blocking Ledger | Reason |
|---|---|---|---|
${rows
  .map((row) => {
    const blocking = [...new Set([...row.frontendSummary.blockingLedgerIds, ...row.adminSummary.blockingLedgerIds])].join(", ") || "-";
    return `| ${row.id} | ${row.operabilityStatus} | ${blocking} | ${row.reasons.join("<br>") || "-"} |`;
  })
  .join("\n")}
`,
  "utf8",
);

console.log("Feature mapping operability audit complete");
console.log(JSON.stringify(counts, null, 2));
