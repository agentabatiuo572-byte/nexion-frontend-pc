// Validate docs/audit/ledger.ndjson for the remediation workflow.
// Kept dependency-free so it can run in every local checkout and CI shell.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LEDGER = path.join(ROOT, "docs", "audit", "ledger.ndjson");

const SIDES = new Set(["frontend", "admin", "cross", "uniapp"]);
const CATEGORIES = new Set([
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
]);
const SEVERITIES = new Set(["P0", "P1", "P2", "P3"]);
const STATUSES = new Set(["open", "specd", "fixed", "verified", "closed", "fix-in-port"]);
const REQUIRED = [
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
];

function fail(message) {
  console.error(`ledger validation FAIL: ${message}`);
  process.exit(1);
}

function readLedger() {
  if (!fs.existsSync(LEDGER)) fail(`missing ${path.relative(ROOT, LEDGER)}`);
  const text = fs.readFileSync(LEDGER, "utf8");
  if (!text.trim()) fail("ledger is empty");
  return text
    .split(/\r?\n/)
    .map((line, index) => ({ line: line.trim(), index: index + 1 }))
    .filter((row) => row.line)
    .map((row) => {
      try {
        return { entry: JSON.parse(row.line), line: row.index };
      } catch (error) {
        fail(`line ${row.index} is not valid JSON: ${error.message}`);
      }
    });
}

const rows = readLedger();
const ids = new Set();
const dedup = new Set();
const problems = [];

for (const { entry, line } of rows) {
  for (const field of REQUIRED) {
    if (!(field in entry)) problems.push(`line ${line}: missing required field "${field}"`);
  }
  if (ids.has(entry.id)) problems.push(`line ${line}: duplicate id ${entry.id}`);
  ids.add(entry.id);
  if (dedup.has(entry.dedup_key)) problems.push(`line ${line}: duplicate dedup_key ${entry.dedup_key}`);
  dedup.add(entry.dedup_key);

  if (!SIDES.has(entry.side)) problems.push(`line ${line}: invalid side ${entry.side}`);
  if (!CATEGORIES.has(entry.category)) problems.push(`line ${line}: invalid category ${entry.category}`);
  if (!SEVERITIES.has(entry.severity)) problems.push(`line ${line}: invalid severity ${entry.severity}`);
  if (!STATUSES.has(entry.status)) problems.push(`line ${line}: invalid status ${entry.status}`);
  if (!Array.isArray(entry.evidence)) problems.push(`line ${line}: evidence must be an array`);

  for (const field of ["id", "title", "category", "severity", "repro", "expected", "actual", "dedup_key", "cluster", "status", "found_by"]) {
    if (typeof entry[field] !== "string" || entry[field].trim() === "") {
      problems.push(`line ${line}: ${field} must be a non-empty string`);
    }
  }

  if (["verified", "closed"].includes(entry.status) && !entry.sentinel) {
    problems.push(`line ${line}: ${entry.status} entries must bind a sentinel`);
  }
}

if (problems.length) {
  console.error(`ledger validation FAIL: ${problems.length} problem(s)`);
  for (const problem of problems.slice(0, 80)) console.error(`  - ${problem}`);
  if (problems.length > 80) console.error(`  ... ${problems.length - 80} more`);
  process.exit(1);
}

console.log(`ledger validation PASS: ${rows.length} entries`);
