#!/usr/bin/env node
/**
 * Owner review readiness gate.
 *
 * This is a non-mutating closure check for the final acceptance package. It
 * verifies that the acceptance docs, L5 report, and PRD sync dry-run are
 * self-consistent before the owner decides whether to approve canonical PRD
 * sync and final product acceptance.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUDIT = path.join(ROOT, "docs", "audit");
const REMEDIATION = path.join(ROOT, "docs", "remediation");
const WRITE = !process.argv.includes("--no-write");
const JSON_ONLY = process.argv.includes("--json");
const CHECK_LIVE = process.argv.includes("--check-live");
const REPORT_BASENAME = CHECK_LIVE ? "owner-review-readiness-live-report" : "owner-review-readiness-report";

const files = {
  finalPacket: path.join(REMEDIATION, "FINAL-ACCEPTANCE-PACKET-2026-06-13.md"),
  ownerRunbook: path.join(REMEDIATION, "OWNER-REVIEW-RUNBOOK-2026-06-13.md"),
  masterPlan: path.join(REMEDIATION, "MASTER-PLAN.md"),
  prdDryRun: path.join(REMEDIATION, "PRD-SYNC-DRY-RUN-2026-06-13.md"),
  prdDraft: path.join(REMEDIATION, "PRD-SYNC-DRAFT-2026-06-13.md"),
  prdAnchorAudit: path.join(REMEDIATION, "PRD-SYNC-ANCHOR-AUDIT-2026-06-13.md"),
  prdCandidates: path.join(REMEDIATION, "PRD-SYNC-CANDIDATES-2026-06-13.md"),
  prdPreviewPatch: path.join(REMEDIATION, "PRD-SYNC-PREVIEW-2026-06-13.patch"),
  l5Json: path.join(AUDIT, "l5-final-sweep-report.json"),
  l5Md: path.join(AUDIT, "l5-final-sweep-report.md"),
  taskMatrix: path.join(AUDIT, "task-walkthrough-matrix.md"),
  featureMappingProof: path.join(AUDIT, "feature-mapping-walkthrough-runtime-evidence.md"),
  adminModalProof: path.join(AUDIT, "admin-modal-contract-runtime-evidence.md"),
  adminRbacProof: path.join(AUDIT, "admin-rbac-device-modal-runtime-evidence.md"),
  adminContentProof: path.join(AUDIT, "admin-content-business-modal-runtime-evidence.md"),
  adminListProof: path.join(AUDIT, "admin-global-list-capability-runtime-evidence.md"),
  uniRouteProof: path.join(AUDIT, "uniapp-full-route-batch-audit-evidence.md"),
  uniPersonaProof: path.join(AUDIT, "uniapp-persona-walkthrough-runtime-evidence.md"),
  prdSyncScript: path.join(ROOT, "scripts", "prd-sync-l5-draft.mjs"),
  finalizerScript: path.join(ROOT, "scripts", "remediation-finalize-after-owner-confirmed.mjs"),
  completionStatusScript: path.join(ROOT, "scripts", "remediation-completion-status.mjs"),
  packageJson: path.join(ROOT, "package.json"),
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

function addCheck(checks, id, title, passed, details, evidence = []) {
  checks.push({
    id,
    title,
    status: passed ? "passed" : "failed",
    details,
    evidence,
  });
}

function extractGeneratedAt(finalPacketText) {
  return finalPacketText.match(/Generated at: `([^`]+)`/)?.[1] ?? null;
}

function runPrdSyncDryRun() {
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
  let parsed = null;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    parsed = { parseError: String(error), stdout, stderr };
  }
  return {
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status,
    stdout,
    stderr,
    parsed,
  };
}

async function checkLiveUrl(id, url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const text = await response.text();
    return {
      id,
      url,
      status: response.status,
      ok: response.status >= 200 && response.status < 400,
      bytes: text.length,
    };
  } catch (error) {
    return {
      id,
      url,
      status: "ERR",
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkLiveTargets() {
  const adminBase = process.env.ADMIN_BASE_URL ?? "http://localhost:3002";
  const nextBase = process.env.NEXT_BASE_URL ?? "http://localhost:3001";
  const uniBase = process.env.UNI_BASE_URL ?? "http://localhost:5173";
  const targets = [
    ["admin-root", adminBase],
    ["admin-rbac", `${adminBase}/platform/rbac`],
    ["next-reference-root", nextBase],
    ["uniapp-root", uniBase],
    ["uniapp-checkout-shell", `${uniBase}/#/pages/store/checkout?product=stellarbox-s1`],
  ];
  return Promise.all(targets.map(([id, url]) => checkLiveUrl(id, url)));
}

function renderMarkdown(report) {
  const lines = [];
  lines.push(CHECK_LIVE ? "# Owner Review Live Readiness Report" : "# Owner Review Readiness Report");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push("");
  lines.push(`Status: **${report.status}** (${report.checksPassed}/${report.checks.length} checks passed)`);
  lines.push("");
  lines.push("| ID | Status | Check | Details |");
  lines.push("|---|---|---|---|");
  for (const check of report.checks) {
    lines.push(`| ${check.id} | ${check.status} | ${check.title} | ${String(check.details).replaceAll("|", "\\|")} |`);
  }
  if (report.liveTargets?.length) {
    lines.push("");
    lines.push("## Live Targets");
    lines.push("");
    lines.push("| ID | Status | URL | Bytes |");
    lines.push("|---|---:|---|---:|");
    for (const target of report.liveTargets) {
      lines.push(`| ${target.id} | ${target.status} | ${target.url} | ${target.bytes ?? 0} |`);
    }
  }
  lines.push("");
  lines.push("## Remaining Gates");
  lines.push("");
  lines.push("- Canonical PRD sync: waiting-owner-confirmation.");
  lines.push("- Owner product acceptance: waiting-owner-review.");
  lines.push("");
  lines.push("This gate is intentionally non-mutating for canonical PRDs.");
  return `${lines.join("\n")}\n`;
}

const checks = [];
const generatedAt = new Date().toISOString();

const missingFiles = Object.entries(files).filter(([, file]) => !fs.existsSync(file));
addCheck(
  checks,
  "OR-01",
  "Acceptance evidence files exist",
  missingFiles.length === 0,
  missingFiles.length === 0 ? `${Object.keys(files).length} files present` : `missing: ${missingFiles.map(([key]) => key).join(", ")}`,
  Object.values(files).map(rel),
);

const l5 = fs.existsSync(files.l5Json) ? readJson(files.l5Json) : null;
addCheck(
  checks,
  "OR-02",
  "L5 report is passed and complete",
  Boolean(l5 && l5.status === "passed" && l5.checksPassed === 12 && l5.checksFailed === 0),
  l5 ? `status=${l5.status}; checks=${l5.checksPassed}/${l5.checksPassed + l5.checksFailed}; generatedAt=${l5.generatedAt}` : "l5 report missing",
  [rel(files.l5Json), rel(files.l5Md)],
);

const routeCounts = l5?.routeCounts ?? {};
addCheck(
  checks,
  "OR-03",
  "L5 route and blocker counters match closure target",
  routeCounts.admin === 67 && routeCounts.next === 80 && routeCounts.uniapp === 83,
  `admin=${routeCounts.admin}; next=${routeCounts.next}; uniapp=${routeCounts.uniapp}`,
  [rel(files.l5Json)],
);

const finalPacketText = fs.existsSync(files.finalPacket) ? read(files.finalPacket) : "";
const finalPacketGeneratedAt = extractGeneratedAt(finalPacketText);
addCheck(
  checks,
  "OR-04",
  "Final acceptance packet references latest L5 timestamp",
  Boolean(l5?.generatedAt && finalPacketGeneratedAt === l5.generatedAt),
  `packet=${finalPacketGeneratedAt}; l5=${l5?.generatedAt ?? "missing"}`,
  [rel(files.finalPacket), rel(files.l5Json)],
);

const prdSync = runPrdSyncDryRun();
const prd = prdSync.parsed ?? {};
const prdOperations = Number(prd.operations ?? 0);
const prdPlanned = Number(prd.planned ?? 0);
const prdAlreadyPresent = Number(prd.alreadyPresent ?? 0);
const prdMissingAnchors = Number(prd.missingAnchors ?? 0);
const prdPatchBytes = Number(prd.patchBytes ?? 0);
const prdApplyCheckOk = prd.applyCheck === "passed" || prd.applyCheck === "not-needed";
const prdCoverageOk = prdOperations === 23
  && prdPlanned + prdAlreadyPresent === 23
  && prdMissingAnchors === 0;
const prdPatchStateOk = prdPlanned > 0 ? prdPatchBytes > 0 : prdPatchBytes === 0;
addCheck(
  checks,
  "OR-05",
  "PRD sync dry-run and apply-check pass",
  prdSync.status === "passed"
    && prdCoverageOk
    && prdApplyCheckOk
    && prdPatchStateOk,
  prd.parseError
    ? `parseError=${prd.parseError}`
    : `status=${prdSync.status}; operations=${prd.operations}; planned=${prd.planned}; alreadyPresent=${prd.alreadyPresent}; missingAnchors=${prd.missingAnchors}; applyCheck=${prd.applyCheck}; patchBytes=${prd.patchBytes}`,
  [rel(files.prdSyncScript), rel(files.prdPreviewPatch), rel(files.prdDryRun)],
);

const docsToInspect = [files.finalPacket, files.ownerRunbook, files.masterPlan, files.prdDryRun]
  .filter((file) => fs.existsSync(file))
  .map((file) => [file, read(file)]);
const staleDocs = docsToInspect.filter(([, text]) => !text.includes("applyCheck") && !text.includes("--apply-check"));
const missingPrdSyncState = docsToInspect.filter(([, text]) =>
  !text.includes("waiting-owner-confirmation")
  && !text.includes("ready-after-owner-confirmation")
  && !text.includes("applied-with-owner-confirmation")
  && !text.includes("主人确认")
);
const missingOwnerReviewGate = docsToInspect.filter(([, text]) =>
  !text.includes("waiting-owner-review")
  && !text.includes("Owner product acceptance")
  && !text.includes("主人最终产品验收")
);
addCheck(
  checks,
  "OR-06",
  "Acceptance docs expose current PRD safety gate and owner decision gate",
  staleDocs.length === 0 && missingPrdSyncState.length === 0 && missingOwnerReviewGate.length === 0,
  `missingApplyCheckRefs=${staleDocs.map(([file]) => rel(file)).join(",") || 0}; missingPrdSyncStateRefs=${missingPrdSyncState.map(([file]) => rel(file)).join(",") || 0}; missingOwnerReviewGateRefs=${missingOwnerReviewGate.map(([file]) => rel(file)).join(",") || 0}`,
  docsToInspect.map(([file]) => rel(file)),
);

let packageScripts = {};
try {
  packageScripts = fs.existsSync(files.packageJson) ? readJson(files.packageJson).scripts ?? {} : {};
} catch {
  packageScripts = {};
}
const finalizerText = fs.existsSync(files.finalizerScript) ? read(files.finalizerScript) : "";
const completionStatusText = fs.existsSync(files.completionStatusScript) ? read(files.completionStatusScript) : "";
const finalizerGateOk = packageScripts["remediation:preflight"] === "node scripts/remediation-finalize-after-owner-confirmed.mjs"
  && packageScripts["remediation:preflight:live"] === "node scripts/remediation-finalize-after-owner-confirmed.mjs --with-live"
  && packageScripts["remediation:status"] === "node scripts/remediation-completion-status.mjs"
  && packageScripts["remediation:status:strict"] === "node scripts/remediation-completion-status.mjs --strict"
  && finalizerText.includes("Refusing canonical PRD sync without --owner-confirmed")
  && finalizerText.includes("--apply-prd")
  && finalizerText.includes("prdFilesChanged")
  && completionStatusText.includes("Refusing to record owner product acceptance without --owner-confirmed")
  && completionStatusText.includes("--record-owner-acceptance")
  && completionStatusText.includes("waiting-owner-review");
addCheck(
  checks,
  "OR-08",
  "Guarded finalizer/status commands are wired and preserve owner confirmation gates",
  finalizerGateOk,
  `preflight=${packageScripts["remediation:preflight"] ?? "missing"}; live=${packageScripts["remediation:preflight:live"] ?? "missing"}; status=${packageScripts["remediation:status"] ?? "missing"}; strict=${packageScripts["remediation:status:strict"] ?? "missing"}; hasPrdOwnerGuard=${finalizerText.includes("Refusing canonical PRD sync without --owner-confirmed")}; hasAcceptanceOwnerGuard=${completionStatusText.includes("Refusing to record owner product acceptance without --owner-confirmed")}`,
  [rel(files.packageJson), rel(files.finalizerScript), rel(files.completionStatusScript)],
);

const conflictHits = docsToInspect.flatMap(([file, text]) =>
  text.split(/\r?\n/).map((line, index) => ({ file, line, index: index + 1 }))
    .filter((entry) => /^(<<<<<<<|=======|>>>>>>>)$/.test(entry.line.trim()))
);
const trailingHits = docsToInspect.flatMap(([file, text]) =>
  text.split(/\r?\n/).map((line, index) => ({ file, line, index: index + 1 }))
    .filter((entry) => /[ \t]+$/.test(entry.line))
);
addCheck(
  checks,
  "OR-09",
  "Acceptance docs have no conflict markers or trailing whitespace",
  conflictHits.length === 0 && trailingHits.length === 0,
  `conflictMarkers=${conflictHits.length}; trailingWhitespace=${trailingHits.length}`,
  docsToInspect.map(([file]) => rel(file)),
);

const liveTargets = CHECK_LIVE ? await checkLiveTargets() : [];
if (CHECK_LIVE) {
  const failedLiveTargets = liveTargets.filter((target) => !target.ok);
  addCheck(
    checks,
    "OR-10",
    "Live owner review URLs respond",
    failedLiveTargets.length === 0,
    failedLiveTargets.length === 0
      ? liveTargets.map((target) => `${target.id}:${target.status}`).join("; ")
      : failedLiveTargets.map((target) => `${target.id}:${target.status}:${target.error ?? ""}`).join("; "),
    liveTargets.map((target) => target.url),
  );
}

const status = checks.every((check) => check.status === "passed") ? "passed" : "failed";
const report = {
  generatedAt,
  status,
  checksPassed: checks.filter((check) => check.status === "passed").length,
  checksFailed: checks.filter((check) => check.status === "failed").length,
  checks,
  prdSync: {
    status: prdSync.status,
    exitCode: prdSync.exitCode,
    summary: prd.parseError ? prd.parseError : {
      operations: prd.operations,
      planned: prd.planned,
      alreadyPresent: prd.alreadyPresent,
      missingAnchors: prd.missingAnchors,
      applyCheck: prd.applyCheck,
      patchBytes: prd.patchBytes,
    },
  },
  liveTargets,
};

if (WRITE) {
  fs.writeFileSync(path.join(AUDIT, `${REPORT_BASENAME}.json`), JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(AUDIT, `${REPORT_BASENAME}.md`), renderMarkdown(report), "utf8");
}

if (JSON_ONLY) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(JSON.stringify({
    status: report.status,
    checksPassed: report.checksPassed,
    checksFailed: report.checksFailed,
    report: WRITE ? `docs/audit/${REPORT_BASENAME}.md` : null,
  }, null, 2));
}

process.exit(status === "passed" ? 0 : 1);
