import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveNexionAppRoot, resolveNexionBackendRoot } from "./lib/nexion-workspace-paths.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND = resolveNexionBackendRoot({ adminRoot: ROOT });
const APP = resolveNexionAppRoot({ adminRoot: ROOT });
const JANUS = resolve(ROOT, "..", "NX1.0-Janus");
const EVIDENCE_ROOT = join(ROOT, "adversarial-evidence", "pc-remaining-20260810");
const LEDGER = join(EVIDENCE_ROOT, "script-files.sha256");
const MVN = process.env.NEXION_MVN_CMD?.trim() || "D:\\software\\apache-maven-3.9.9\\bin\\mvn.cmd";

const lanes = [
  {
    id: "independent-gate",
    cwd: ROOT,
    command: process.execPath,
    args: ["--test", "tests/adversarial/pc-remaining-murphy-gate.test.mjs", "tests/pc-remaining-development-status-contract.test.mjs"],
    covers: ["51/51 matrix", "final status and SHA receipt", "F26 Nth failure", "Mock-off boundaries", "compound writes", "CAS", "403/SSE", "outcome unknown"],
  },
  {
    id: "frontend-unknown-and-m-domain",
    cwd: ROOT,
    command: process.execPath,
    args: [
      "--experimental-strip-types", "--test",
      "tests/outcome-classification-contract.test.mjs",
      "tests/pending-mutation-store-contract.test.mjs",
      "tests/f1-direct-pending-store-contract.test.mjs",
      "tests/m1-acceptance-contract.test.mjs",
      "tests/m2-acceptance-contract.test.mjs",
      "tests/m3-acceptance-contract.test.mjs",
      "tests/m3-sse-resilience-contract.test.mjs",
      "tests/m4-acceptance-contract.test.mjs",
      "tests/m5-acceptance-contract.test.mjs",
    ],
    covers: ["same-key replay", "deterministic rejection", "unknown-result UI", "M compound actions"],
  },
  {
    id: "backend-f26-atomicity",
    cwd: BACKEND,
    command: MVN,
    args: [
      "-q",
      "-Dtest=F5CommissionReissueAtomicityTest,F5CommissionReissueAtomicityMigrationContractTest,F5CommissionReissueAtomicityMySqlIntegrationTest,AdminIdempotencyServiceTest",
      "test",
    ],
    covers: ["F26 Nth-item validation", "failed evidence write", "source uniqueness", "real MySQL transaction rollback", "idempotency terminal state"],
  },
  {
    id: "backend-boundary-cas-rbac",
    cwd: BACKEND,
    command: MVN,
    args: [
      "-q",
      "-Dtest=AppPaymentMethodServiceTest,OpsUserPaymentMethodServiceTest,PaymentMethodRevocationSchedulerTest,PaymentMethodSandboxProfileGuardTest,PayoutVndConfigServiceTest,PayoutVndCommandBoundaryTest,PayoutVndSandboxProfileGuardTest,WithdrawalPayoutExecutorTest,WithdrawalPayoutCallbackServiceTest,CregisCallbackVerifierTest,CregisSandboxIsolationContractTest,JanusAppliedProofReleaseTest,OpsSupportAgentServiceTest,OpsSupportKnowledgeServiceTest,OpsSupportTicketServiceTest,OpsConversationStreamControllerTest",
      "test",
    ],
    covers: ["C23 revoke lease and environment isolation", "C34 production token rejection", "D19 provider state machine", "D22 provider-off boundary", "K17 proof", "M17 atomicity", "M19 CAS", "M23 compound update", "M24 SSE"],
  },
  {
    id: "app-sandbox-boundary",
    cwd: APP,
    command: process.execPath,
    args: ["--experimental-strip-types", "--test", "scripts/kl-sandbox-executor-contract.test.mjs"],
    covers: ["K17 production remote never falls back to sandbox"],
  },
  {
    id: "janus-verify",
    cwd: JANUS,
    command: "npm.cmd",
    args: ["run", "verify"],
    covers: ["Janus type contract", "KYC removal", "executor-side integration boundary"],
  },
];

function hashFile(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function gitOutput(root, args, encoding = "utf8") {
  const result = spawnSync("git", args, { cwd: root, encoding, windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`GIT_FINGERPRINT_FAILED:${root}:${args.join(" ")}:${String(result.stderr || "").trim()}`);
  }
  return result.stdout;
}

function worktreeFingerprint(root) {
  const head = String(gitOutput(root, ["rev-parse", "HEAD"])).trim();
  const trackedRaw = gitOutput(root, ["diff", "--name-only", "--diff-filter=ACDMRTUXB", "-z", "HEAD"], null);
  const untrackedRaw = gitOutput(root, ["ls-files", "-o", "--exclude-standard", "-z"], null);
  const paths = [...new Set([...trackedRaw.toString("utf8").split("\0"), ...untrackedRaw.toString("utf8").split("\0")])].filter(Boolean)
    .filter((relative) => !relative.replaceAll("\\", "/").startsWith("adversarial-evidence/pc-remaining-20260810/runs/"))
    .sort();
  const digest = createHash("sha256").update(`HEAD\0${head}\0`);
  const stagedPatch = gitOutput(root, ["diff", "--cached", "--binary", "HEAD"], null);
  if (stagedPatch.length > 0) {
    digest.update("\0STAGED_INDEX_PATCH\0");
    digest.update(stagedPatch);
  }
  for (const relative of paths) {
    const absolute = join(root, relative);
    digest.update(`\0PATH\0${relative}\0`);
    digest.update(existsSync(absolute) ? readFileSync(absolute) : Buffer.from("MISSING"));
  }
  return {
    head,
    dirtyEntries: paths.length,
    excludedGeneratedEvidence: "adversarial-evidence/pc-remaining-20260810/runs/",
    sha256: digest.digest("hex"),
  };
}

function f26MySqlSuiteResult() {
  const report = join(
    BACKEND,
    "target",
    "surefire-reports",
    "TEST-ffdd.opsconsole.team.application.F5CommissionReissueAtomicityMySqlIntegrationTest.xml",
  );
  if (!existsSync(report)) {
    return { passed: false, error: `F26_MYSQL_REPORT_MISSING:${report}` };
  }
  const suite = readFileSync(report, "utf8").match(/<testsuite\b[^>]*>/)?.[0];
  const numeric = (name) => Number(suite?.match(new RegExp(`${name}="(\\d+)"`))?.[1] ?? Number.NaN);
  const summary = {
    tests: numeric("tests"),
    failures: numeric("failures"),
    errors: numeric("errors"),
    skipped: numeric("skipped"),
  };
  const passed = Object.values(summary).every(Number.isFinite)
    && summary.tests >= 4
    && summary.failures === 0
    && summary.errors === 0
    && summary.skipped === 0;
  return {
    passed,
    summary,
    error: passed ? null : `F26_MYSQL_SUITE_NOT_FULLY_EXECUTED:${JSON.stringify(summary)}`,
  };
}

function criticalEvidenceDigests() {
  const files = [
    join(ROOT, "docs", "ops-actions.manifest.json"),
    join(ROOT, "tests", "pc-remaining-development-status-contract.test.mjs"),
    join(ROOT, "tests", "adversarial", "pc-remaining-murphy-gate.test.mjs"),
    join(ROOT, "scripts", "run-pc-remaining-murphy-adversarial.mjs"),
    join(BACKEND, "src", "main", "java", "ffdd", "opsconsole", "finance", "application", "WithdrawalPayoutCallbackService.java"),
    join(BACKEND, "src", "main", "java", "ffdd", "opsconsole", "user", "application", "PaymentMethodRevocationScheduler.java"),
    join(BACKEND, "src", "main", "java", "ffdd", "opsconsole", "janus", "application", "JanusAppliedProofVerifier.java"),
    join(BACKEND, "src", "main", "java", "ffdd", "opsconsole", "team", "application", "F5CommissionService.java"),
    join(APP, "src", "store", "app.ts"),
    join(JANUS, "package.json"),
  ];
  return Object.fromEntries(files.map((absolute) => {
    if (!existsSync(absolute)) throw new Error(`CRITICAL_EVIDENCE_MISSING:${absolute}`);
    return [absolute, hashFile(absolute)];
  }));
}

function verifyLedger() {
  const entries = readFileSync(LEDGER, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.startsWith("#"));
  if (entries.length !== 3) throw new Error(`ADVERSARIAL_SHA_ENTRY_COUNT:${entries.length}`);
  for (const line of entries) {
    const match = line.match(/^([0-9a-f]{64}) \*(.+)$/);
    if (!match) throw new Error(`ADVERSARIAL_SHA_LINE_INVALID:${line}`);
    const absolute = resolve(ROOT, match[2]);
    if (!existsSync(absolute)) throw new Error(`ADVERSARIAL_SHA_FILE_MISSING:${absolute}`);
    const actual = hashFile(absolute);
    if (actual !== match[1]) throw new Error(`ADVERSARIAL_SHA_MISMATCH:${absolute}`);
  }
}

function assertFixtureOnlyEnvironment() {
  if (process.env.NEXION_ADVERSARIAL_MODE !== "fixture-only") {
    throw new Error("REFUSE_EXECUTION:set NEXION_ADVERSARIAL_MODE=fixture-only after confirming isolated test fixtures");
  }
  if ((process.env.NODE_ENV || "").toLowerCase() === "production") {
    throw new Error("REFUSE_EXECUTION:NODE_ENV=production");
  }
  for (const key of ["BASE_URL", "BACKEND_URL", "API_BASE_URL", "NEXION_API_BASE_URL"]) {
    const value = process.env[key]?.trim();
    if (!value) continue;
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (!["localhost", "127.0.0.1", "::1"].includes(host) && !host.endsWith(".invalid")) {
      throw new Error(`REFUSE_EXECUTION:${key} is not loopback or .invalid (${host})`);
    }
  }
  if (!existsSync(MVN)) throw new Error(`MAVEN_NOT_FOUND:${MVN}`);
}

function runLane(lane, evidenceDir) {
  return new Promise((resolvePromise) => {
    const startedAt = new Date().toISOString();
    const started = Date.now();
    const isWindowsCommandScript = process.platform === "win32" && /\.cmd$/i.test(lane.command);
    const command = isWindowsCommandScript ? (process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe") : lane.command;
    const commandLine = `${lane.command} ${lane.args.join(" ")}`;
    const args = isWindowsCommandScript ? ["/d", "/s", "/c", commandLine] : lane.args;
    const child = spawn(command, args, {
      cwd: lane.cwd,
      env: process.env,
      shell: false,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; process.stdout.write(chunk); });
    child.stderr.on("data", (chunk) => { stderr += chunk; process.stderr.write(chunk); });
    child.on("error", (error) => {
      stderr += `\n${error.stack || error.message}\n`;
    });
    child.on("close", (code, signal) => {
      const postcondition = lane.id === "backend-f26-atomicity"
        ? f26MySqlSuiteResult()
        : { passed: true };
      writeFileSync(join(evidenceDir, `${lane.id}.stdout.txt`), stdout, "utf8");
      writeFileSync(join(evidenceDir, `${lane.id}.stderr.txt`), stderr, "utf8");
      resolvePromise({
        id: lane.id,
        covers: lane.covers,
        startedAt,
        durationMs: Date.now() - started,
        exitCode: code,
        signal,
        postcondition,
        passed: code === 0 && postcondition.passed,
      });
    });
  });
}

function printPlan(selected) {
  console.log("PC remaining-development Murphy adversarial lanes");
  for (const lane of selected) {
    console.log(`- ${lane.id}`);
    console.log(`  cwd: ${lane.cwd}`);
    console.log(`  command: ${lane.command} ${lane.args.join(" ")}`);
    console.log(`  covers: ${lane.covers.join("; ")}`);
  }
}

const args = new Set(process.argv.slice(2));
const onlyArg = process.argv.slice(2).find((arg) => arg.startsWith("--only="));
const selected = onlyArg ? lanes.filter((lane) => lane.id === onlyArg.slice(7)) : lanes;
if (selected.length === 0) throw new Error(`UNKNOWN_LANE:${onlyArg}`);

verifyLedger();
if (args.has("--list") || !args.has("--execute")) {
  printPlan(selected);
  console.log("SHA: PASS (3/3 locked adversarial assets)");
  console.log("No test lane executed. Add --execute and the fixture-only acknowledgement to run.");
  process.exit(0);
}

assertFixtureOnlyEnvironment();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const evidenceDir = join(EVIDENCE_ROOT, "runs", stamp);
mkdirSync(evidenceDir, { recursive: true });
const results = [];
for (const lane of selected) results.push(await runLane(lane, evidenceDir));
const receipt = {
  schemaVersion: 2,
  scope: "PC remaining-development Murphy adversarial execution",
  generatedAt: new Date().toISOString(),
  fixtureOnly: true,
  roots: { admin: ROOT, backend: BACKEND, app: APP, janus: JANUS },
  candidateFingerprints: {
    admin: worktreeFingerprint(ROOT),
    backend: worktreeFingerprint(BACKEND),
    app: worktreeFingerprint(APP),
    janus: worktreeFingerprint(JANUS),
  },
  criticalEvidence: criticalEvidenceDigests(),
  lockedAssets: readFileSync(LEDGER, "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")),
  results,
  passed: results.every((item) => item.passed),
};
writeFileSync(join(evidenceDir, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n", "utf8");
console.log(`Evidence: ${evidenceDir}`);
if (!receipt.passed) process.exitCode = 1;
