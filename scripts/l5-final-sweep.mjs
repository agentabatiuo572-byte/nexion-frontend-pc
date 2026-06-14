#!/usr/bin/env node
/**
 * L5 final sweep.
 *
 * This is the cross-repo objective closure report for MASTER-PLAN L5. It can
 * run the three app verifiers, then aggregates runtime shards, ledger state,
 * feature mapping, canon gates, i18n, modal, list, and task-walkthrough proof.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_ROOT = path.resolve(ROOT, "..");
const NEXT_ROOT = path.join(PLAN_ROOT, "Nexion-prototype");
const UNI_ROOT = path.join(PLAN_ROOT, "Nexion-uniapp");
const AUDIT = path.join(ROOT, "docs", "audit");
const SHARDS = path.join(AUDIT, "shards");
const RUN_VERIFIERS = process.argv.includes("--run-verifiers");
const WRITE = !process.argv.includes("--no-write");
const NOW = new Date().toISOString();

function rel(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function readJson(relPath) {
  return JSON.parse(read(path.join(ROOT, relPath)));
}

function readNdjson(file) {
  if (!fs.existsSync(file)) return [];
  return read(file).split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      return { status: "parse-error", file: rel(file), line: index + 1, error: String(error) };
    }
  });
}

function shardFiles(pattern) {
  return fs.readdirSync(SHARDS).filter((name) => pattern.test(name)).sort().map((name) => path.join(SHARDS, name));
}

function runCommand(id, cwd, command, args, env = {}) {
  const needsCmdShim = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  const spawnCommand = needsCmdShim ? (process.env.ComSpec ?? "cmd.exe") : command;
  const spawnArgs = needsCmdShim ? ["/d", "/s", "/c", command, ...args] : args;
  const result = spawnSync(spawnCommand, spawnArgs, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...env },
    shell: false,
    maxBuffer: 1024 * 1024 * 32,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const spawnError = result.error ? `\n[spawn-error]\n${result.error.stack ?? result.error.message ?? String(result.error)}` : "";
  const outFile = path.join(AUDIT, `l5-${id}.log`);
  fs.writeFileSync(outFile, `$ ${command} ${args.join(" ")}\n\n${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}${spawnError}`, "utf8");
  return {
    id,
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status,
    evidence: [rel(outFile)],
    summary: summarizeCommandOutput(stdout + stderr),
  };
}

function summarizeCommandOutput(output) {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
  const lines = clean.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const resultLine = [...lines].reverse().find((line) => /PASS|FAIL|Result|result|passed|failed|fail/i.test(line));
  return resultLine ?? lines.at(-1) ?? "";
}

function runNodeGate(id, script, args = []) {
  return runCommand(id, ROOT, process.execPath, [script, ...args]);
}

function statusFromRows(rows, okPredicate) {
  const bad = rows.filter((row) => !okPredicate(row));
  return { ok: bad.length === 0, bad };
}

function addCheck(checks, id, title, passed, details, evidence = []) {
  checks.push({
    id,
    title,
    status: passed ? "passed" : "failed",
    details,
    evidence,
  });
}

function taskCounts() {
  const md = read(path.join(AUDIT, "task-walkthrough-matrix.md"));
  const rows = [...md.matchAll(/\|\s*(FT|AT)-(\d+)\s*\|[^|]*\|[^|]*\|\s*([^|]+?)\s*\|/g)].map((m) => ({
    type: m[1],
    id: `${m[1]}-${m[2]}`,
    status: m[3].trim(),
  }));
  return {
    ft: rows.filter((row) => row.type === "FT"),
    at: rows.filter((row) => row.type === "AT"),
  };
}

function runtimeEvidenceSummary() {
  const runtimeFiles = shardFiles(/^(ad-\d+|next-fr-\d+|uni-fr-\d+)-runtime\.ndjson$/i);
  const actionFiles = shardFiles(/^(ad-\d+|next-fr-\d+|uni-fr-\d+).*action-sample\.ndjson$/i);
  const runtimeRows = runtimeFiles.flatMap((file) => readNdjson(file).map((row) => ({ ...row, shardFile: rel(file) })));
  const actionRows = actionFiles.flatMap((file) => readNdjson(file).map((row) => ({ ...row, shardFile: rel(file) })));

  const runtimeBad = runtimeRows.filter((row) =>
    row.status !== "captured"
    || row.error
    || (Array.isArray(row.evidence?.runtime?.consoleErrors) && row.evidence.runtime.consoleErrors.length > 0)
  );
  const badClassifications = new Set([
    "no-observable-change",
    "click-target-missing",
    "business-incomplete-modal",
    "modal-blocked",
    "fake-write",
  ]);
  const allowedActionStatuses = new Set(["sampled", "captured", "passed"]);
  const actionBad = actionRows.filter((row) =>
    !allowedActionStatuses.has(row.status)
    || badClassifications.has(row.result?.classification)
    || row.result?.businessAssessment?.level === "blocked"
    || row.result?.businessAssessment?.level === "incomplete"
    || Number(row.result?.noObservableChange ?? 0) > 0
    || Number(row.result?.businessIncompleteModal ?? 0) > 0
  );
  const routeCount = (prefix) => new Set(runtimeRows.filter((row) => row.shardId?.startsWith(prefix)).map((row) => row.route)).size;

  return {
    runtimeRows,
    actionRows,
    runtimeBad,
    actionBad,
    routeCounts: {
      admin: routeCount("AD-"),
      next: routeCount("NEXT-FR-"),
      uniapp: routeCount("UNI-FR-"),
    },
    files: {
      runtime: runtimeFiles.map(rel),
      action: actionFiles.map(rel),
    },
  };
}

function proofRows(fileName) {
  return readNdjson(path.join(SHARDS, fileName));
}

const checks = [];
const verifierRuns = [];
const gateRuns = [];

if (RUN_VERIFIERS) {
  verifierRuns.push(runCommand("admin-verify", ROOT, process.platform === "win32" ? "npm.cmd" : "npm", ["run", "verify"], {
    ADMIN_BASE: process.env.ADMIN_BASE ?? "http://localhost:3002",
    ADMIN_BASE_URL: process.env.ADMIN_BASE_URL ?? "http://localhost:3002",
    UNI_BASE_URL: process.env.UNI_BASE_URL ?? "http://localhost:5173",
  }));
  verifierRuns.push(runCommand("next-reference-verify", NEXT_ROOT, "bash", ["scripts/verify.sh", "all"], {
    BASE_URL: process.env.NEXT_BASE_URL ?? "http://localhost:3001",
  }));
  verifierRuns.push(runCommand("uniapp-verify", UNI_ROOT, "bash", ["scripts/verify.sh"], {
    BASE_URL: process.env.UNI_BASE_URL ?? "http://localhost:5173",
  }));
}

gateRuns.push(runNodeGate("ledger-validate", "scripts/ledger-validate.mjs"));
gateRuns.push(runNodeGate("feature-map-audit", "scripts/remediation-feature-map-audit.mjs"));
gateRuns.push(runNodeGate("feature-map-operability", "scripts/remediation-feature-map-operability.mjs"));
gateRuns.push(runNodeGate("feature-map-closure-proof", "scripts/feature-mapping-closure-proof.mjs"));
gateRuns.push(runNodeGate("admin-modal-contract", "scripts/admin-modal-contract-audit.mjs"));
gateRuns.push(runNodeGate("admin-list-global", "scripts/admin-list-capability-global-audit.mjs"));
gateRuns.push(runNodeGate("uniapp-port-coverage", "scripts/uniapp-port-coverage-audit.mjs"));
gateRuns.push(runNodeGate("sku-field-mirror", "scripts/sku-field-mirror.mjs"));
gateRuns.push(runNodeGate("canon-sentinel", "scripts/canon-sentinel.mjs"));

const verifiersPassed = RUN_VERIFIERS && verifierRuns.every((run) => run.status === "passed");
addCheck(
  checks,
  "L5-01",
  "Three app verifiers pass",
  verifiersPassed,
  RUN_VERIFIERS
    ? verifierRuns.map((run) => `${run.id}:${run.status} ${run.summary}`).join("; ")
    : "not run; invoke with --run-verifiers for L5 closure proof",
  verifierRuns.flatMap((run) => run.evidence),
);

const gatePassed = (id) => gateRuns.find((run) => run.id === id)?.status === "passed";
const route = runtimeEvidenceSummary();
const personaRows = proofRows("uniapp-persona-walkthrough-proof.ndjson");
const personaPassed = personaRows.length >= 5 && personaRows.every((row) => row.status === "passed");
addCheck(
  checks,
  "L5-02",
  "UniApp route migration and core persona flows",
  gatePassed("uniapp-port-coverage") && personaPassed && route.routeCounts.uniapp >= 81,
  `uniappRoutes=${route.routeCounts.uniapp}; personaProofRows=${personaRows.length}; uniapp-port-coverage=${gatePassed("uniapp-port-coverage") ? "passed" : "failed"}`,
  ["docs/audit/uniapp-full-route-batch-audit-evidence.md", "docs/audit/uniapp-persona-walkthrough-runtime-evidence.md", "docs/audit/shards/uniapp-persona-walkthrough-proof.ndjson"],
);

const tasks = taskCounts();
const ftAllVerified = tasks.ft.length >= 15 && tasks.ft.every((row) => row.status === "verified");
const atAllVerified = tasks.at.length >= 11 && tasks.at.every((row) => row.status === "verified");
addCheck(
  checks,
  "L5-03",
  "Admin and frontend task walkthrough matrix verified",
  ftAllVerified && atAllVerified,
  `FT verified ${tasks.ft.filter((row) => row.status === "verified").length}/${tasks.ft.length}; AT verified ${tasks.at.filter((row) => row.status === "verified").length}/${tasks.at.length}`,
  ["docs/audit/task-walkthrough-matrix.md"],
);

addCheck(
  checks,
  "L5-04",
  "Runtime route/action traversal has zero blockers",
  route.runtimeBad.length === 0 && route.actionBad.length === 0 && gatePassed("admin-list-global"),
  `routes admin=${route.routeCounts.admin}, next=${route.routeCounts.next}, uniapp=${route.routeCounts.uniapp}; runtimeBad=${route.runtimeBad.length}; actionBad=${route.actionBad.length}; listGlobal=${gatePassed("admin-list-global") ? "passed" : "failed"}`,
  ["docs/audit/shards/", "docs/audit/admin-global-list-capability-runtime-evidence.md"],
);

const featureProofRows = proofRows("feature-mapping-walkthrough-proof.ndjson");
const featureProofPassed = featureProofRows.length >= 7 && featureProofRows.every((row) => row.status === "passed");
addCheck(
  checks,
  "L5-05",
  "Modal five-tuple and business-specific controls",
  gatePassed("admin-modal-contract") && featureProofPassed && route.actionBad.length === 0,
  `modalContract=${gatePassed("admin-modal-contract") ? "passed" : "failed"}; featureProofRows=${featureProofRows.length}; actionBad=${route.actionBad.length}`,
  ["docs/audit/admin-modal-contract-runtime-evidence.md", "docs/audit/shards/feature-mapping-walkthrough-proof.ndjson"],
);

const ledgerRows = read(path.join(AUDIT, "ledger.ndjson")).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
const p0p2Open = ledgerRows.filter((row) => ["P0", "P1", "P2"].includes(row.severity) && !["verified", "closed"].includes(row.status));
const p3Open = ledgerRows.filter((row) => row.severity === "P3" && !["verified", "closed", "deferred", "adjudicated"].includes(row.status));
addCheck(
  checks,
  "L5-06",
  "Ledger P0/P1/P2 zero open and P3 adjudicated",
  gatePassed("ledger-validate") && p0p2Open.length === 0 && p3Open.length === 0,
  `ledger=${ledgerRows.length}; p0p2Open=${p0p2Open.length}; p3Open=${p3Open.length}`,
  ["docs/audit/ledger.ndjson", "docs/audit/LEDGER.md"],
);

const fmap = readJson("docs/audit/feature-mapping-operability-audit.json");
addCheck(
  checks,
  "L5-07",
  "Feature mapping matrix has zero gap/blocker/walkthrough debt",
  gatePassed("feature-map-audit")
    && gatePassed("feature-map-operability")
    && gatePassed("feature-map-closure-proof")
    && fmap.counts.mappings === 18
    && fmap.counts.gap === 0
    && fmap.counts.blockedByLedger === 0
    && fmap.counts.needsTaskWalkthrough === 0
    && fmap.counts.provisionallyOperable === 18,
  JSON.stringify(fmap.counts),
  ["docs/remediation/inventory/feature-mapping.json", "docs/audit/feature-mapping-operability-audit.json"],
);

addCheck(
  checks,
  "L5-08",
  "Canon numbers and field mirrors have zero drift",
  gatePassed("canon-sentinel") && gatePassed("sku-field-mirror"),
  `canon=${gatePassed("canon-sentinel") ? "passed" : "failed"}; skuFieldMirror=${gatePassed("sku-field-mirror") ? "passed" : "failed"}`,
  ["docs/remediation/canon-numbers.json", "scripts/canon-sentinel.mjs", "scripts/sku-field-mirror.mjs"],
);

const fm013 = featureProofRows.find((row) => row.id === "FM-013" && row.status === "passed");
const nextVerifyPassed = verifierRuns.find((run) => run.id === "next-reference-verify")?.status === "passed";
const uniVerifyPassed = verifierRuns.find((run) => run.id === "uniapp-verify")?.status === "passed";
addCheck(
  checks,
  "L5-09",
  "i18n mirror, language switching, and meta leak gates",
  Boolean(fm013) && (!RUN_VERIFIERS || (nextVerifyPassed && uniVerifyPassed)),
  `FM-013=${fm013 ? "passed" : "missing"}; nextVerify=${nextVerifyPassed ?? "not-run"}; uniVerify=${uniVerifyPassed ?? "not-run"}`,
  ["../Nexion-prototype/scripts/verify.sh", "../Nexion-uniapp/scripts/verify.sh", "docs/audit/shards/feature-mapping-walkthrough-proof.ndjson"],
);

addCheck(
  checks,
  "L5-10",
  "Meta-leak guard has zero product-visible hits",
  (!RUN_VERIFIERS || (nextVerifyPassed && uniVerifyPassed)),
  RUN_VERIFIERS ? "covered by Next interaction-audit and UniApp grep sentinel" : "not run; covered when --run-verifiers is used",
  ["../Nexion-prototype/scripts/interaction-audit.mjs", "../Nexion-uniapp/scripts/verify.sh"],
);

addCheck(
  checks,
  "L5-11",
  "Runtime console/route errors are zero",
  route.runtimeBad.length === 0 && route.routeCounts.admin >= 66 && route.routeCounts.next >= 80 && route.routeCounts.uniapp >= 81,
  `runtimeBad=${route.runtimeBad.length}; routeCounts=${JSON.stringify(route.routeCounts)}`,
  route.files.runtime.slice(0, 6).concat(route.files.runtime.length > 6 ? ["docs/audit/shards/*-runtime.ndjson"] : []),
);

const verifiedWithSentinel = ledgerRows.filter((row) => ["verified", "closed"].includes(row.status));
const noSentinel = verifiedWithSentinel.filter((row) => !row.sentinel || String(row.sentinel).trim().length < 8);
addCheck(
  checks,
  "L5-12",
  "Closed/verified ledger rows have sentinels",
  noSentinel.length === 0,
  `verifiedOrClosed=${verifiedWithSentinel.length}; missingSentinel=${noSentinel.length}`,
  ["docs/audit/ledger.ndjson"],
);

const failed = checks.filter((check) => check.status !== "passed");
const postL5Gates = [
  {
    id: "owner-review-readiness",
    statusImpact: "non-blocking-for-L5",
    command: "npm run verify:owner-review",
    report: "docs/audit/owner-review-readiness-report.md",
    purpose: "Validates final acceptance docs, latest L5 timestamp, PRD dry-run/apply-check, and owner decision gates after L5 is generated.",
  },
];
const result = {
  generatedAt: NOW,
  status: failed.length === 0 ? "passed" : "failed",
  runVerifiers: RUN_VERIFIERS,
  checksPassed: checks.length - failed.length,
  checksFailed: failed.length,
  verifierRuns,
  gateRuns,
  postL5Gates,
  routeCounts: route.routeCounts,
  checks,
};

function renderMarkdown(report) {
  const lines = [];
  lines.push("# L5 Final Sweep Report");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push("");
  lines.push(`Status: **${report.status}** (${report.checksPassed}/${report.checks.length} checks passed)`);
  lines.push("");
  lines.push("| ID | Status | Check | Details |");
  lines.push("|---|---|---|---|");
  for (const check of report.checks) {
    lines.push(`| ${check.id} | ${check.status} | ${check.title} | ${String(check.details).replace(/\|/g, "/")} |`);
  }
  lines.push("");
  lines.push("## Verifiers");
  lines.push("");
  if (report.verifierRuns.length === 0) {
    lines.push("- Not run. Use `node scripts/l5-final-sweep.mjs --run-verifiers` for closure evidence.");
  } else {
    for (const run of report.verifierRuns) lines.push(`- ${run.id}: ${run.status} (${run.summary}) -> ${run.evidence.join(", ")}`);
  }
  lines.push("");
  lines.push("## Internal Gates");
  lines.push("");
  for (const run of report.gateRuns) lines.push(`- ${run.id}: ${run.status} (${run.summary}) -> ${run.evidence.join(", ")}`);
  lines.push("");
  lines.push("## Post-L5 Owner Review Gate");
  lines.push("");
  lines.push("These gates are not part of the 12 L5 pass/fail checks. Run them after this L5 report is generated, so they can validate the latest L5 timestamp and owner-facing acceptance package without creating a circular dependency.");
  lines.push("");
  for (const gate of report.postL5Gates) {
    lines.push(`- ${gate.id}: ${gate.statusImpact}; command \`${gate.command}\`; report ${gate.report}; ${gate.purpose}`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

if (WRITE) {
  fs.writeFileSync(path.join(AUDIT, "l5-final-sweep-report.json"), JSON.stringify(result, null, 2), "utf8");
  fs.writeFileSync(path.join(AUDIT, "l5-final-sweep-report.md"), renderMarkdown(result), "utf8");
}

console.log(JSON.stringify({
  status: result.status,
  checksPassed: result.checksPassed,
  checksFailed: result.checksFailed,
  routeCounts: result.routeCounts,
  report: WRITE ? "docs/audit/l5-final-sweep-report.md" : null,
}, null, 2));

if (failed.length > 0) process.exit(1);
