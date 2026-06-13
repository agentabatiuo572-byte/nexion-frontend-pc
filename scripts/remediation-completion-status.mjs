#!/usr/bin/env node
/**
 * Overall remediation completion status.
 *
 * Default mode is non-mutating. Recording owner product acceptance requires
 * both --record-owner-acceptance and --owner-confirmed, and only after the
 * canonical PRD sync is already applied.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT = path.join(ROOT, "docs", "audit");
const REMEDIATION = path.join(ROOT, "docs", "remediation");

const args = new Set(process.argv.slice(2));
const JSON_ONLY = args.has("--json");
const STRICT = args.has("--strict");
const RECORD_OWNER_ACCEPTANCE = args.has("--record-owner-acceptance");
const OWNER_CONFIRMED = args.has("--owner-confirmed");
const WRITE = !args.has("--no-write");

if (RECORD_OWNER_ACCEPTANCE && !OWNER_CONFIRMED) {
  throw new Error("Refusing to record owner product acceptance without --owner-confirmed.");
}
if (OWNER_CONFIRMED && !RECORD_OWNER_ACCEPTANCE) {
  throw new Error("--owner-confirmed is only meaningful together with --record-owner-acceptance.");
}

const files = {
  l5: path.join(AUDIT, "l5-final-sweep-report.json"),
  ownerReadiness: path.join(AUDIT, "owner-review-readiness-report.json"),
  liveReadiness: path.join(AUDIT, "owner-review-readiness-live-report.json"),
  finalPacket: path.join(REMEDIATION, "FINAL-ACCEPTANCE-PACKET-2026-06-13.md"),
  ownerRunbook: path.join(REMEDIATION, "OWNER-REVIEW-RUNBOOK-2026-06-13.md"),
  prdDryRun: path.join(REMEDIATION, "PRD-SYNC-DRY-RUN-2026-06-13.md"),
  ownerAcceptance: path.join(AUDIT, "owner-product-acceptance.json"),
};

function rel(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function readJson(file) {
  return JSON.parse(read(file));
}

function runPrdSyncStatus() {
  const result = spawnSync(process.execPath, [
    "scripts/prd-sync-l5-draft.mjs",
    "--patch-file=docs/remediation/PRD-SYNC-PREVIEW-2026-06-13.patch",
    "--apply-check",
    "--json",
  ], {
    cwd: ROOT,
    encoding: "utf8",
    shell: false,
    maxBuffer: 1024 * 1024 * 16,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  try {
    return {
      ok: result.status === 0,
      exitCode: result.status,
      parsed: JSON.parse(stdout),
    };
  } catch (error) {
    return {
      ok: false,
      exitCode: result.status,
      parsed: null,
      error: String(error),
      stdout,
      stderr,
    };
  }
}

function replaceIfPresent(text, search, replacement) {
  return text.includes(search) ? text.replace(search, replacement) : text;
}

function markOwnerAcceptedDocs() {
  const finalPacketSearch = "| 主人最终产品验收 | waiting-owner-review | 主人按 `OWNER-REVIEW-RUNBOOK-2026-06-13.md` 打开三端原型或审阅 L5 报告后确认 |";
  const finalPacketReplacement = "| 主人最终产品验收 | accepted-by-owner | 主人已明确接受最终产品验收;整体整改可进入完成审计 |";
  const runbookSearch = "| Owner product acceptance | waiting-owner-review | 主人按本 runbook 或最终验收包抽检后确认 |";
  const runbookReplacement = "| Owner product acceptance | accepted-by-owner | 主人已明确接受最终产品验收 |";
  const dryRunSearch = "| Owner product acceptance | waiting-owner-review | 主人完成最终产品抽检并明确接受后才可关闭整体整改目标 |";
  const dryRunReplacement = "| Owner product acceptance | accepted-by-owner | 主人已明确接受最终产品验收 |";

  const updates = [
    [files.finalPacket, finalPacketSearch, finalPacketReplacement],
    [files.ownerRunbook, runbookSearch, runbookReplacement],
    [files.prdDryRun, dryRunSearch, dryRunReplacement],
  ];

  const missing = updates.filter(([file, search]) => !read(file).includes(search)).map(([file]) => rel(file));
  if (missing.length > 0) {
    throw new Error(`Cannot mark owner acceptance; missing anchors in ${missing.join(", ")}`);
  }

  for (const [file, search, replacement] of updates) {
    fs.writeFileSync(file, replaceIfPresent(read(file), search, replacement), "utf8");
  }
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Remediation Completion Status");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push("");
  lines.push(`Status: **${report.status}**`);
  lines.push("");
  lines.push("| Gate | Status | Details |");
  lines.push("|---|---|---|");
  for (const gate of report.gates) {
    lines.push(`| ${gate.id} | ${gate.status} | ${String(gate.details).replaceAll("|", "\\|")} |`);
  }
  lines.push("");
  lines.push("## Remaining Gates");
  lines.push("");
  if (report.remainingGates.length === 0) {
    lines.push("- None.");
  } else {
    for (const gate of report.remainingGates) lines.push(`- ${gate}`);
  }
  lines.push("");
  lines.push("This report is non-mutating unless `--record-owner-acceptance --owner-confirmed` is provided.");
  return `${lines.join("\n")}\n`;
}

fs.mkdirSync(AUDIT, { recursive: true });

const l5 = fs.existsSync(files.l5) ? readJson(files.l5) : null;
const ownerReadiness = fs.existsSync(files.ownerReadiness) ? readJson(files.ownerReadiness) : null;
const liveReadiness = fs.existsSync(files.liveReadiness) ? readJson(files.liveReadiness) : null;
const ownerAcceptance = fs.existsSync(files.ownerAcceptance) ? readJson(files.ownerAcceptance) : null;
const prdSync = runPrdSyncStatus();
const prd = prdSync.parsed ?? {};

const l5Passed = l5?.status === "passed" && l5?.checksPassed === 12 && l5?.checksFailed === 0;
const ownerReadinessPassed = ownerReadiness?.status === "passed" && ownerReadiness?.checksFailed === 0;
const liveReadinessPassed = liveReadiness?.status === "passed" && liveReadiness?.checksFailed === 0;
const prdSyncReady = prdSync.ok
  && Number(prd.operations) === 23
  && Number(prd.planned ?? 0) + Number(prd.alreadyPresent ?? 0) === 23
  && Number(prd.missingAnchors ?? 0) === 0
  && (prd.applyCheck === "passed" || prd.applyCheck === "not-needed");
const prdSyncApplied = prdSyncReady
  && Number(prd.planned ?? 0) === 0
  && Number(prd.alreadyPresent ?? 0) === 23
  && prd.applyCheck === "not-needed";
let ownerAccepted = ownerAcceptance?.status === "accepted-by-owner";

if (RECORD_OWNER_ACCEPTANCE) {
  if (!prdSyncApplied) {
    throw new Error("Refusing to record owner acceptance before canonical PRD sync is applied.");
  }
  if (!l5Passed || !ownerReadinessPassed) {
    throw new Error("Refusing to record owner acceptance before L5 and owner-readiness gates pass.");
  }
  const acceptance = {
    generatedAt: new Date().toISOString(),
    status: "accepted-by-owner",
    recordedBy: "owner-confirmed-command",
    preconditions: {
      prdSyncApplied,
      l5Passed,
      ownerReadinessPassed,
      liveReadinessPassed,
    },
    evidence: [
      rel(files.l5),
      rel(files.ownerReadiness),
      rel(files.liveReadiness),
      "scripts/prd-sync-l5-draft.mjs --apply-check --json",
    ],
  };
  fs.writeFileSync(files.ownerAcceptance, JSON.stringify(acceptance, null, 2), "utf8");
  markOwnerAcceptedDocs();
  ownerAccepted = true;
}

const gates = [
  {
    id: "l5-final-sweep",
    status: l5Passed ? "passed" : "pending",
    details: l5 ? `checks=${l5.checksPassed}/${l5.checksPassed + l5.checksFailed}` : "missing l5 report",
  },
  {
    id: "owner-review-readiness",
    status: ownerReadinessPassed ? "passed" : "pending",
    details: ownerReadiness ? `checks=${ownerReadiness.checksPassed}/${ownerReadiness.checksPassed + ownerReadiness.checksFailed}` : "missing owner readiness report",
  },
  {
    id: "owner-review-live-readiness",
    status: liveReadinessPassed ? "passed" : "optional-pending",
    details: liveReadiness ? `checks=${liveReadiness.checksPassed}/${liveReadiness.checksPassed + liveReadiness.checksFailed}` : "missing live readiness report",
  },
  {
    id: "canonical-prd-sync",
    status: prdSyncApplied ? "applied-with-owner-confirmation" : (prdSyncReady ? "waiting-owner-confirmation" : "not-ready"),
    details: prdSync.ok
      ? `planned=${prd.planned}; alreadyPresent=${prd.alreadyPresent}; missingAnchors=${prd.missingAnchors}; applyCheck=${prd.applyCheck}`
      : `prd sync check failed: ${prdSync.error ?? prdSync.exitCode}`,
  },
  {
    id: "owner-product-acceptance",
    status: ownerAccepted ? "accepted-by-owner" : "waiting-owner-review",
    details: ownerAccepted ? rel(files.ownerAcceptance) : "owner acceptance marker is not recorded",
  },
];

const remainingGates = [];
if (!prdSyncApplied) remainingGates.push("Canonical PRD sync requires explicit owner confirmation.");
if (!ownerAccepted) remainingGates.push("Owner product acceptance requires explicit owner confirmation after review.");

const status = l5Passed && ownerReadinessPassed && prdSyncApplied && ownerAccepted
  ? "complete-ready"
  : "pending-owner-gates";

const report = {
  generatedAt: new Date().toISOString(),
  status,
  gates,
  remainingGates,
};

if (WRITE) {
  fs.writeFileSync(path.join(AUDIT, "remediation-completion-status-report.json"), JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(AUDIT, "remediation-completion-status-report.md"), renderMarkdown(report), "utf8");
}

if (JSON_ONLY) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(JSON.stringify({
    status: report.status,
    remainingGates: report.remainingGates,
    report: WRITE ? "docs/audit/remediation-completion-status-report.md" : null,
  }, null, 2));
}

if (STRICT && status !== "complete-ready") process.exit(1);
