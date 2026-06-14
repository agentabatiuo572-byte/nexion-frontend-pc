// Closure proof for SPEC-L3a02 / INIT-007.
// It proves the feature mapping seed has a complete matrix with no existence
// gaps or open P0/P1 mapping blockers, while preserving explicit follow-up
// ownership for rows that still need persona walkthrough.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT = path.join(ROOT, "docs", "audit");
const INV = path.join(ROOT, "docs", "remediation", "inventory");

const MAPPING = path.join(INV, "feature-mapping.json");
const EXISTENCE = path.join(AUDIT, "feature-mapping-audit.json");
const OPERABILITY = path.join(AUDIT, "feature-mapping-operability-audit.json");
const TASK_MATRIX = path.join(AUDIT, "task-walkthrough-matrix.md");
const LEDGER = path.join(AUDIT, "ledger.ndjson");

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readNdjson(file) {
  const text = fs.readFileSync(file, "utf8").trim();
  return text ? text.split(/\r?\n/).map((line) => JSON.parse(line)) : [];
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const mapping = readJson(MAPPING);
const existence = readJson(EXISTENCE);
const operability = readJson(OPERABILITY);
const matrix = fs.readFileSync(TASK_MATRIX, "utf8");
const ledger = readNdjson(LEDGER);

const mappingRows = mapping.rows || [];
const mappingIds = mappingRows.map((row) => row.id);
const uniqueMappingIds = new Set(mappingIds);
const operabilityRows = operability.rows || [];
const operabilityIds = new Set(operabilityRows.map((row) => row.id));
const existenceRows = existence.rows || [];
const existenceIds = new Set(existenceRows.map((row) => row.id));

expect(mappingRows.length === 18, `expected 18 mapping rows, got ${mappingRows.length}`);
expect(uniqueMappingIds.size === mappingRows.length, "feature mapping IDs must be unique");
expect(mappingRows.every((row) => /^FM-\d{3}$/.test(row.id)), "all feature mapping IDs must use FM-### format");
expect(mappingRows.every((row) => Array.isArray(row.frontendRoutes) && row.frontendRoutes.length > 0), "every mapping row needs frontendRoutes");
expect(mappingRows.every((row) => Array.isArray(row.adminSurfaces) && row.adminSurfaces.length > 0), "every mapping row needs adminSurfaces");
expect(mappingRows.every((row) => row.status !== "needs-audit"), "mapping rows still contain needs-audit status");
expect(mappingRows.every((row) => existenceIds.has(row.id)), "existence audit is missing mapping row(s)");
expect(mappingRows.every((row) => operabilityIds.has(row.id)), "operability audit is missing mapping row(s)");

expect(existence.counts.mappings === 18, `existence audit mapping count mismatch: ${existence.counts.mappings}`);
expect(existence.counts.gaps === 0, `existence audit gaps must be 0, got ${existence.counts.gaps}`);
expect(existence.counts.missingFrontendRefs === 0, `missing frontend refs must be 0, got ${existence.counts.missingFrontendRefs}`);
expect(existence.counts.missingAdminRefs === 0, `missing admin refs must be 0, got ${existence.counts.missingAdminRefs}`);

expect(operability.counts.mappings === 18, `operability audit mapping count mismatch: ${operability.counts.mappings}`);
expect(operability.counts.gap === 0, `operability gaps must be 0, got ${operability.counts.gap}`);
expect(operability.counts.blockedByLedger === 0, `blocked-by-ledger must be 0, got ${operability.counts.blockedByLedger}`);

const allowedStatuses = new Set(["provisionally-operable", "needs-task-walkthrough"]);
for (const row of mappingRows) {
  expect(allowedStatuses.has(row.status), `${row.id} has unsupported closure status: ${row.status}`);
  const op = operabilityRows.find((item) => item.id === row.id);
  expect(op && op.operabilityStatus === row.status, `${row.id} inventory status does not match operability audit`);
  expect(Array.isArray(row.evidence) && row.evidence.includes("docs/audit/feature-mapping-audit.md"), `${row.id} missing existence evidence`);
  expect(Array.isArray(row.evidence) && row.evidence.includes("docs/audit/feature-mapping-operability-audit.md"), `${row.id} missing operability evidence`);
}

const needsWalkthrough = operabilityRows.filter((row) => row.operabilityStatus === "needs-task-walkthrough").map((row) => row.id).sort();
for (const id of needsWalkthrough) {
  expect(matrix.includes(id), `${id} needs walkthrough but is not listed in task-walkthrough-matrix.md`);
}

const openP0P1MappingBlockers = ledger.filter((row) =>
  !["verified", "closed", "fix-in-port"].includes(row.status) &&
  ["P0", "P1"].includes(row.severity) &&
  (row.id !== "INIT-007") &&
  /feature-mapping/i.test(String(row.route)) &&
  row.cluster === "feature-mapping",
);
expect(openP0P1MappingBlockers.length === 0, `open feature-mapping blockers remain: ${openP0P1MappingBlockers.map((row) => row.id).join(", ")}`);

console.log(JSON.stringify({
  status: "passed",
  mappingRows: mappingRows.length,
  existence: existence.counts,
  operability: operability.counts,
  needsWalkthrough,
}, null, 2));
