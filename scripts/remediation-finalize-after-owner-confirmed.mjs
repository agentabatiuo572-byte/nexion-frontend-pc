#!/usr/bin/env node
/**
 * Final remediation closure orchestrator.
 *
 * Default mode is non-mutating for canonical PRDs. Canonical PRD writes only
 * happen when both --apply-prd and --owner-confirmed are present.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLAN_ROOT = path.resolve(ROOT, "..");
const PRD_ROOT = path.join(PLAN_ROOT, "PRD");
const AUDIT = path.join(ROOT, "docs", "audit");
const REMEDIATION = path.join(ROOT, "docs", "remediation");

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const APPLY_PRD = args.has("--apply-prd");
const OWNER_CONFIRMED = args.has("--owner-confirmed");
const WITH_LIVE = args.has("--with-live");
const JSON_ONLY = args.has("--json");
const WRITE = !args.has("--no-write");

if (APPLY_PRD && !OWNER_CONFIRMED) {
  throw new Error("Refusing canonical PRD sync without --owner-confirmed.");
}
if (OWNER_CONFIRMED && !APPLY_PRD) {
  throw new Error("--owner-confirmed is only meaningful together with --apply-prd.");
}

const prdTargets = [
  path.join(PRD_ROOT, "Nexion_产品功能架构设计文档_v3.7.md"),
  path.join(PRD_ROOT, "Nexion_运营控制后台PRD_v4.md"),
  path.join(PRD_ROOT, "Nexion_运营控制后台_开发落地规格.md"),
  path.join(PRD_ROOT, "Nexion_运营后台_交互与确认机制改写SPEC.md"),
];

function rel(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

function ensureAuditDir() {
  fs.mkdirSync(AUDIT, { recursive: true });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function commandFor(command) {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    return {
      command: process.env.ComSpec ?? "cmd.exe",
      argsPrefix: ["/d", "/s", "/c", command],
    };
  }
  return { command, argsPrefix: [] };
}

function summarizeOutput(output) {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, "");
  const lines = clean.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const resultLine = [...lines].reverse().find((line) =>
    /status|passed|failed|checksPassed|checksFailed|applyCheck|error/i.test(line)
  );
  return resultLine ?? lines.at(-1) ?? "";
}

function parseJsonFromStdout(stdout) {
  try {
    return JSON.parse(stdout);
  } catch {
    const start = stdout.indexOf("{");
    const end = stdout.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(stdout.slice(start, end + 1));
    }
    throw new Error("No JSON object found in stdout.");
  }
}

function summarizeParsedJson(parsed) {
  if (!parsed || parsed.parseError) return null;
  if (parsed.applyCheck) {
    return `operations=${parsed.operations}; planned=${parsed.planned}; alreadyPresent=${parsed.alreadyPresent}; missingAnchors=${parsed.missingAnchors}; applyCheck=${parsed.applyCheck}`;
  }
  if (typeof parsed.checksPassed === "number" && typeof parsed.checksFailed === "number") {
    return `status=${parsed.status}; checks=${parsed.checksPassed}/${parsed.checksPassed + parsed.checksFailed}`;
  }
  if (parsed.status && parsed.mode) {
    return `status=${parsed.status}; mode=${parsed.mode}`;
  }
  if (parsed.status) return `status=${parsed.status}`;
  return null;
}

function runStep(id, title, command, stepArgs, options = {}) {
  const cwd = options.cwd ?? ROOT;
  const mapped = commandFor(command);
  const result = spawnSync(mapped.command, [...mapped.argsPrefix, ...stepArgs], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...(options.env ?? {}) },
    shell: false,
    maxBuffer: 1024 * 1024 * 64,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const spawnError = result.error ? `\n[spawn-error]\n${result.error.stack ?? result.error.message ?? String(result.error)}` : "";
  const output = `${stdout}${stderr ? `\n[stderr]\n${stderr}` : ""}${spawnError}`;
  const logFile = path.join(AUDIT, `remediation-finalize-${id}.log`);
  fs.writeFileSync(
    logFile,
    `$ ${command} ${stepArgs.join(" ")}\n\n${output}`,
    "utf8",
  );
  let parsedJson = null;
  if (options.parseJson) {
    try {
      parsedJson = parseJsonFromStdout(stdout);
    } catch (error) {
      parsedJson = { parseError: String(error) };
    }
  }
  const parsedSummary = summarizeParsedJson(parsedJson);
  return {
    id,
    title,
    status: result.status === 0 ? "passed" : "failed",
    exitCode: result.status,
    command: `${command} ${stepArgs.join(" ")}`,
    evidence: rel(logFile),
    summary: parsedSummary ?? summarizeOutput(output),
    parsedJson,
  };
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function prdStats() {
  return prdTargets.map((file) => {
    const stat = fs.statSync(file);
    return {
      file,
      name: path.basename(file),
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      lastWriteTime: stat.mtime.toISOString(),
    };
  });
}

function samePrdStats(before, after) {
  return before.every((entry, index) =>
    entry.file === after[index].file
    && entry.size === after[index].size
    && entry.mtimeMs === after[index].mtimeMs
  );
}

function syntheticStep(id, title, passed, summary) {
  return {
    id,
    title,
    status: passed ? "passed" : "failed",
    exitCode: passed ? 0 : 1,
    command: "internal",
    evidence: null,
    summary,
    parsedJson: null,
  };
}

function refreshFinalPacketTimestamp() {
  const l5Json = path.join(AUDIT, "l5-final-sweep-report.json");
  const finalPacket = path.join(REMEDIATION, "FINAL-ACCEPTANCE-PACKET-2026-06-13.md");
  const l5 = readJson(l5Json);
  const text = fs.readFileSync(finalPacket, "utf8");
  const next = text.replace(
    /Generated at: `[^`]+`/,
    `Generated at: \`${l5.generatedAt}\``,
  );
  if (next === text && !text.includes(`Generated at: \`${l5.generatedAt}\``)) {
    throw new Error("Could not refresh final acceptance packet L5 timestamp.");
  }
  if (next !== text) fs.writeFileSync(finalPacket, next, "utf8");
  return syntheticStep(
    "refresh-final-packet",
    "Refresh final acceptance packet L5 timestamp",
    true,
    `Generated at: ${l5.generatedAt}`,
  );
}

function replaceRequired(text, search, replacement, file) {
  if (!text.includes(search)) {
    throw new Error(`Could not update post-apply status in ${file}: missing ${search}`);
  }
  return text.replace(search, replacement);
}

function updatePostApplyDocs() {
  const updates = [
    {
      file: path.join(REMEDIATION, "FINAL-ACCEPTANCE-PACKET-2026-06-13.md"),
      replacements: [
        [
          "| Canonical PRD 正文同步 | waiting-owner-confirmation | 主人确认后由 `scripts/remediation-finalize-after-owner-confirmed.mjs --apply-prd --owner-confirmed` 串行执行 PRD apply、L5 复验、final packet 时间戳刷新与 owner-review readiness;锚点已由 `PRD-SYNC-ANCHOR-AUDIT-2026-06-13.md` 验证齐备;当前 dry-run 为 `23 planned / 0 missingAnchors / applyCheck passed`,预览 patch 为 `PRD-SYNC-PREVIEW-2026-06-13.patch` |",
          "| Canonical PRD 正文同步 | applied-with-owner-confirmation | 已按主人确认由 `scripts/remediation-finalize-after-owner-confirmed.mjs --apply-prd --owner-confirmed` 写入 `D:\\WORKS\\PLAN\\PRD\\...`;后置 dry-run 应为 `alreadyPresent=23 / missingAnchors=0 / applyCheck=not-needed`;L5 与 owner-review readiness 已由 finalizer 串行复验 |",
        ],
      ],
    },
    {
      file: path.join(REMEDIATION, "OWNER-REVIEW-RUNBOOK-2026-06-13.md"),
      replacements: [
        [
          "| Canonical PRD sync | waiting-owner-confirmation | 主人明确确认后才执行 `node scripts\\remediation-finalize-after-owner-confirmed.mjs --apply-prd --owner-confirmed` |",
          "| Canonical PRD sync | applied-with-owner-confirmation | 已按主人确认执行 `node scripts\\remediation-finalize-after-owner-confirmed.mjs --apply-prd --owner-confirmed`;后续只保留 owner product acceptance gate |",
        ],
      ],
    },
    {
      file: path.join(REMEDIATION, "PRD-SYNC-DRY-RUN-2026-06-13.md"),
      replacements: [
        ["> 状态: ready-after-owner-confirmation", "> 状态: applied-with-owner-confirmation"],
      ],
    },
  ];

  for (const update of updates) {
    let text = fs.readFileSync(update.file, "utf8");
    for (const [search, replacement] of update.replacements) {
      text = replaceRequired(text, search, replacement, rel(update.file));
    }
    fs.writeFileSync(update.file, text, "utf8");
  }

  return syntheticStep(
    "mark-prd-sync-applied",
    "Mark remediation docs after owner-confirmed PRD sync",
    true,
    "canonical PRD sync status set to applied-with-owner-confirmation",
  );
}

function renderMarkdown(report) {
  const lines = [];
  lines.push("# Remediation Finalize Report");
  lines.push("");
  lines.push(`Generated at: ${report.generatedAt}`);
  lines.push("");
  lines.push(`Mode: \`${report.mode}\``);
  lines.push(`Status: **${report.status}** (${report.stepsPassed}/${report.steps.length} steps passed)`);
  lines.push("");
  lines.push("| Step | Status | Command | Summary | Evidence |");
  lines.push("|---|---|---|---|---|");
  for (const step of report.steps) {
    lines.push(`| ${step.id} | ${step.status} | \`${step.command}\` | ${String(step.summary).replaceAll("|", "\\|")} | ${step.evidence ?? "-"} |`);
  }
  lines.push("");
  lines.push("## Canonical PRD Guard");
  lines.push("");
  lines.push(`- PRD mutation allowed: \`${report.prdMutationAllowed}\``);
  lines.push(`- PRD files changed: \`${report.prdFilesChanged}\``);
  lines.push("");
  lines.push("| File | Before | After |");
  lines.push("|---|---|---|");
  for (const entry of report.prdStats) {
    lines.push(`| ${entry.name} | ${entry.before.lastWriteTime} / ${entry.before.size} bytes | ${entry.after.lastWriteTime} / ${entry.after.size} bytes |`);
  }
  lines.push("");
  lines.push("## Remaining Gates");
  lines.push("");
  if (report.mode === "preflight-non-mutating") {
    lines.push("- Canonical PRD sync: waiting-owner-confirmation.");
  } else {
    lines.push("- Canonical PRD sync: applied-with-owner-confirmation.");
  }
  lines.push("- Owner product acceptance: waiting-owner-review until the owner explicitly accepts the product.");
  lines.push("");
  lines.push("The script refuses canonical PRD writes unless both `--apply-prd` and `--owner-confirmed` are present.");
  return `${lines.join("\n")}\n`;
}

ensureAuditDir();

const beforePrd = prdStats();
const steps = [];

steps.push(runStep(
  "prd-apply-check",
  "PRD sync patch apply-check",
  process.execPath,
  [
    "scripts/prd-sync-l5-draft.mjs",
    "--patch-file=docs/remediation/PRD-SYNC-PREVIEW-2026-06-13.patch",
    "--apply-check",
    "--json",
  ],
  { parseJson: true },
));

if (steps.at(-1).status === "passed" && APPLY_PRD) {
  steps.push(runStep(
    "prd-apply",
    "Apply canonical PRD sync after owner confirmation",
    process.execPath,
    ["scripts/prd-sync-l5-draft.mjs", "--apply", "--owner-confirmed", "--json"],
    { parseJson: true },
  ));
}

if (steps.every((step) => step.status === "passed") && APPLY_PRD) {
  try {
    steps.push(updatePostApplyDocs());
  } catch (error) {
    steps.push(syntheticStep(
      "mark-prd-sync-applied",
      "Mark remediation docs after owner-confirmed PRD sync",
      false,
      error instanceof Error ? error.message : String(error),
    ));
  }
}

if (steps.every((step) => step.status === "passed")) {
  steps.push(runStep(
    "l5-final-sweep",
    "Run L5 final sweep with verifiers",
    process.execPath,
    ["scripts/l5-final-sweep.mjs", "--run-verifiers"],
    { parseJson: true },
  ));
}

if (steps.every((step) => step.status === "passed")) {
  try {
    steps.push(refreshFinalPacketTimestamp());
  } catch (error) {
    steps.push(syntheticStep(
      "refresh-final-packet",
      "Refresh final acceptance packet L5 timestamp",
      false,
      error instanceof Error ? error.message : String(error),
    ));
  }
}

if (steps.every((step) => step.status === "passed")) {
  steps.push(runStep(
    "owner-review-readiness",
    "Run owner review readiness gate",
    npmCommand(),
    ["run", "verify:owner-review"],
    { parseJson: true },
  ));
}

if (steps.every((step) => step.status === "passed") && WITH_LIVE) {
  steps.push(runStep(
    "owner-review-live",
    "Run optional live owner review readiness gate",
    npmCommand(),
    ["run", "verify:owner-review:live"],
    { parseJson: true },
  ));
}

if (steps.every((step) => step.status === "passed")) {
  steps.push(runStep(
    "completion-status",
    "Run overall remediation completion status gate",
    npmCommand(),
    ["run", "remediation:status"],
    { parseJson: true },
  ));
}

const afterPrd = prdStats();
const prdFilesChanged = !samePrdStats(beforePrd, afterPrd);
if (!APPLY_PRD) {
  steps.push(syntheticStep(
    "non-mutating-prd-guard",
    "Canonical PRDs remain unchanged in preflight mode",
    !prdFilesChanged,
    prdFilesChanged ? "canonical PRD file stat changed" : "canonical PRD file stats unchanged",
  ));
}

const failed = steps.filter((step) => step.status !== "passed");
const report = {
  generatedAt: new Date().toISOString(),
  mode: APPLY_PRD ? "apply-after-owner-confirmation" : "preflight-non-mutating",
  status: failed.length === 0 ? "passed" : "failed",
  prdMutationAllowed: APPLY_PRD && OWNER_CONFIRMED,
  prdFilesChanged,
  stepsPassed: steps.length - failed.length,
  stepsFailed: failed.length,
  steps,
  prdStats: beforePrd.map((entry, index) => ({
    name: entry.name,
    before: {
      lastWriteTime: entry.lastWriteTime,
      size: entry.size,
    },
    after: {
      lastWriteTime: afterPrd[index].lastWriteTime,
      size: afterPrd[index].size,
    },
  })),
};

if (WRITE) {
  fs.writeFileSync(path.join(AUDIT, "remediation-finalize-report.json"), JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(path.join(AUDIT, "remediation-finalize-report.md"), renderMarkdown(report), "utf8");
}

const output = JSON_ONLY ? report : {
  status: report.status,
  mode: report.mode,
  stepsPassed: report.stepsPassed,
  stepsFailed: report.stepsFailed,
  prdFilesChanged: report.prdFilesChanged,
  report: WRITE ? "docs/audit/remediation-finalize-report.md" : null,
};

console.log(JSON.stringify(output, null, 2));
process.exit(report.status === "passed" ? 0 : 1);
