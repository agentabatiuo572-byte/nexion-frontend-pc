import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const baseUrl = process.env.ADMIN_BASE_URL || "http://127.0.0.1:3002";
const backendUrl = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const runId = sanitizeRunId(process.env.ADMIN_E2E_SHIFT_RUN_ID || new Date().toISOString().replace(/[-:.TZ]/g, ""));
const runDir = path.join(root, ".codex-run", "ops-shift", runId);
const backupDir = path.join(runDir, "backups");
const reportDir = path.join(runDir, "reports");
const skipBackup = process.env.ADMIN_E2E_SKIP_BACKUP === "1";

assertAllowedTarget(baseUrl, "ADMIN_BASE_URL");
assertAllowedTarget(backendUrl, "NEXION_BACKEND_URL");

await mkdir(backupDir, { recursive: true });
await mkdir(reportDir, { recursive: true });

const notes = [];
if (skipBackup) {
  notes.push("snapshot=skipped by ADMIN_E2E_SKIP_BACKUP=1");
} else {
  await backupMysql();
  await backupRedis();
}

const env = {
  ...process.env,
  ADMIN_BASE_URL: baseUrl,
  NEXION_BACKEND_URL: backendUrl,
  ADMIN_E2E_SHIFT_RUN_ID: runId,
  ADMIN_E2E_SHIFT_REPORT_DIR: reportDir,
};

const testCode = await runCommand(
  commandName("npx"),
  [
    "playwright",
    "test",
    "tests/e2e/admin-ops-shift-cross-flow.spec.ts",
    "--project=chromium",
    "--workers=1",
    "--reporter=line",
  ],
  { env },
);

const summary = await summarizeReports(testCode);
await writeFile(path.join(runDir, "summary.md"), summary.markdown, "utf8");

if (testCode !== 0 || !summary.passed) {
  process.exit(testCode || 1);
}

async function backupMysql() {
  const password = process.env.NEXION_E2E_MYSQL_PASSWORD || process.env.NEXION_DB_PASSWORD;
  if (!password) {
    throw new Error("缺少 NEXION_E2E_MYSQL_PASSWORD 或 NEXION_DB_PASSWORD。若确认只做代码级验证，可设置 ADMIN_E2E_SKIP_BACKUP=1。");
  }
  const executable = process.env.MYSQLDUMP_EXE || "D:\\software\\MySQL\\MySQL Server 8.0\\bin\\mysqldump.exe";
  await assertExecutable(executable, "mysqldump");
  const dbName = process.env.NEXION_E2E_DB_NAME || process.env.NEXION_DB_NAME || "nexion";
  const host = process.env.NEXION_E2E_MYSQL_HOST || process.env.NEXION_DB_HOST || "127.0.0.1";
  const port = process.env.NEXION_E2E_MYSQL_PORT || process.env.NEXION_DB_PORT || "3306";
  const user = process.env.NEXION_E2E_MYSQL_USER || process.env.NEXION_DB_USERNAME || "root";
  const outFile = path.join(backupDir, `${dbName}-${runId}.sql`);
  const out = createWriteStream(outFile);
  const args = [
    "--single-transaction",
    "--routines",
    "--triggers",
    "--default-character-set=utf8mb4",
    "-h",
    host,
    "-P",
    port,
    "-u",
    user,
    `-p${password}`,
    dbName,
  ];
  const code = await runCommand(executable, args, {
    stdout: out,
    label: `mysqldump ${dbName} -> ${outFile}`,
    redact: password,
  });
  out.close();
  if (code !== 0) throw new Error(`MySQL 快照失败: ${outFile}`);
  notes.push(`mysql_snapshot=${outFile}`);
}

async function backupRedis() {
  const executable = process.env.REDIS_CLI_EXE || "D:\\software\\Redis-8.6.1\\redis-cli.exe";
  if (!(await exists(executable))) {
    notes.push(`redis_snapshot=skipped redis-cli not found at ${executable}`);
    return;
  }
  const password = process.env.NEXION_E2E_REDIS_PASSWORD || process.env.REDIS_PASSWORD;
  const host = process.env.NEXION_E2E_REDIS_HOST || process.env.REDIS_HOST || "127.0.0.1";
  const port = process.env.NEXION_E2E_REDIS_PORT || process.env.REDIS_PORT || "6379";
  const outFile = path.join(backupDir, `redis-${runId}.rdb`);
  const args = ["-h", host, "-p", port];
  if (password) args.push("-a", password, "--no-auth-warning");
  args.push("--rdb", outFile);
  const code = await runCommand(executable, args, {
    label: `redis-cli --rdb ${outFile}`,
    redact: password,
  });
  if (code !== 0) throw new Error(`Redis 快照失败: ${outFile}`);
  notes.push(`redis_snapshot=${outFile}`);
}

async function summarizeReports(testCode) {
  const files = (await readdir(reportDir).catch(() => []))
    .filter((name) => name.endsWith(".json"))
    .sort();
  const reports = [];
  for (const file of files) {
    const fullPath = path.join(reportDir, file);
    reports.push(JSON.parse(await readFile(fullPath, "utf8")));
  }

  const rows = reports.map((report) => {
    const failed = report.steps.filter((step) => step.status === "failed").length;
    const notApplicable = report.steps.filter((step) => step.status === "not_applicable").length;
    const cleanupOk = report.cleanup ? report.cleanup.disabled && report.cleanup.sessionsRevoked : false;
    const passed = failed === 0
      && report.initialReview?.score > 96
      && report.adversarialReview?.score > 98
      && report.assertions?.frontendState
      && report.assertions?.backendRecord
      && report.assertions?.auditA2
      && report.assertions?.downstreamVisible
      && cleanupOk;
    return {
      label: report.label,
      username: report.username,
      steps: report.steps.length,
      failed,
      notApplicable,
      initial: report.initialReview?.score ?? 0,
      review: report.adversarialReview?.score ?? 0,
      cleanupOk,
      passed,
    };
  });

  const allPassed = testCode === 0 && reports.length === 6 && rows.every((row) => row.passed);
  const markdown = [
    `# Ops Shift Cross-Flow E2E Summary`,
    ``,
    `- runId: \`${runId}\``,
    `- baseUrl: \`${baseUrl}\``,
    `- backendUrl: \`${backendUrl}\``,
    `- reports: \`${reportDir}\``,
    `- status: \`${allPassed ? "passed" : "failed"}\``,
    ...notes.map((note) => `- ${note}`),
    ``,
    `| 班次 | 临时账号 | 步骤 | 失败 | 不适用 | 初审 | 复审 | 清理 | 结果 |`,
    `|---|---|---:|---:|---:|---:|---:|---|---|`,
    ...rows.map((row) =>
      `| ${row.label} | \`${row.username}\` | ${row.steps} | ${row.failed} | ${row.notApplicable} | ${row.initial} | ${row.review} | ${row.cleanupOk ? "通过" : "失败"} | ${row.passed ? "通过" : "失败"} |`,
    ),
    ``,
    allPassed
      ? `验收结论: 6 个临时管理员班次的跨域运维测试、初审、复审与清理均通过。`
      : `验收结论: 未达标。请查看 Playwright 输出和 \`${reportDir}\` 下的班次 JSON 报告。`,
    ``,
  ].join("\n");
  return { passed: allPassed, markdown };
}

async function runCommand(command, args, options = {}) {
  const label = options.label || `${command} ${args.join(" ")}`;
  console.log(sanitizeLog(`[ops-shift] ${label}`, options.redact));
  return new Promise((resolve, reject) => {
    const needsCmdShim = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
    const spawnCommand = needsCmdShim ? process.env.ComSpec || "cmd.exe" : command;
    const spawnArgs = needsCmdShim ? ["/d", "/s", "/c", [command, ...args].map(quoteCmdPart).join(" ")] : args;
    const child = spawn(spawnCommand, spawnArgs, {
      cwd: root,
      env: options.env || process.env,
      shell: false,
      stdio: ["ignore", options.stdout ? "pipe" : "inherit", "inherit"],
      windowsHide: true,
    });
    if (options.stdout && child.stdout) {
      child.stdout.pipe(options.stdout);
    }
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function assertExecutable(file, label) {
  if (!(await exists(file))) {
    throw new Error(`找不到 ${label}: ${file}`);
  }
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function commandName(base) {
  return process.platform === "win32" ? `${base}.cmd` : base;
}

function quoteCmdPart(value) {
  if (/^[A-Za-z0-9_./:\\=-]+$/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function assertAllowedTarget(urlText, label) {
  const parsed = new URL(urlText);
  if (!isAllowedHost(parsed.hostname)) {
    throw new Error(`${label}=${urlText} 不是 localhost/127.0.0.1/本机内网地址，拒绝执行真实写入 E2E。`);
  }
}

function isAllowedHost(hostname) {
  if (["localhost", "127.0.0.1", "::1"].includes(hostname)) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true;
  const match = hostname.match(/^172\.(\d{1,2})\.\d{1,3}\.\d{1,3}$/);
  return !!match && Number(match[1]) >= 16 && Number(match[1]) <= 31;
}

function sanitizeRunId(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24) || "local";
}

function sanitizeLog(value, redact) {
  return redact ? value.replaceAll(redact, "******") : value;
}
