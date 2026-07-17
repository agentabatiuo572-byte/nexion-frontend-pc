import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const runId = process.env.J4_RUN_ID;
const password = process.env.J4_TEST_PASSWORD;
if (!runId || !/^[A-Za-z0-9._-]+$/.test(runId)) throw new Error("J4_RUN_ID_INVALID");
if (!password) throw new Error("J4_TEST_PASSWORD_REQUIRED");

const artifactRoot = resolve(`D:/workspace/j4-acceptance-artifacts/playwright-${runId}`);
const rawTraceZip = join(artifactRoot, "j4-readonly-trace.zip");
const restrictedTraceZip = join(artifactRoot, "restricted-j4-readonly-trace.zip");
const sanitizedTraceZip = join(artifactRoot, "j4-readonly-trace-sanitized.zip");
const tempRoot = await mkdtemp(join(tmpdir(), `j4-trace-${runId}-`));
const ignoredExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm"]);
const credentialTypes = ["password-exact", "jwt", "authorization-value", "token-cookie-value"];

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function filesUnder(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...await filesUnder(path));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

function extension(path) {
  const name = basename(path).toLowerCase();
  const dot = name.lastIndexOf(".");
  return dot >= 0 ? name.slice(dot) : "";
}

function collectRegexHits(text, regex, type, displayPath) {
  const hits = [];
  for (const match of text.matchAll(regex)) {
    const candidate = match[1] || match[0];
    if (candidate.startsWith("[REDACTED_")) continue;
    hits.push({ type, file: displayPath, offset: match.index ?? -1, candidateSha256: sha256(candidate) });
  }
  return hits;
}

function scanBuffer(buffer, displayPath, passwordBytes) {
  const hits = [];
  let offset = buffer.indexOf(passwordBytes);
  while (offset >= 0) {
    hits.push({ type: "password-exact", file: displayPath, offset, candidateSha256: sha256(passwordBytes) });
    offset = buffer.indexOf(passwordBytes, offset + passwordBytes.length);
  }
  const text = buffer.toString("utf8");
  hits.push(...collectRegexHits(text, /\b(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g, "jwt", displayPath));
  hits.push(...collectRegexHits(text, /authorization(?:\\?["']|\s)*[:=](?:\\?["']|\s)*(?:bearer\s+)?([A-Za-z0-9._~-]{16,})/gi, "authorization-value", displayPath));
  hits.push(...collectRegexHits(text, /nexion_admin_token(?:%3d|=|\\u003d)([^;,\s"'\\]{12,})/gi, "token-cookie-value", displayPath));
  return hits;
}

function countHits(hits) {
  return Object.fromEntries(credentialTypes.map((type) => [type, hits.filter((hit) => hit.type === type).length]));
}

function redactCredentials(text, passwordValue) {
  return text
    .replaceAll(passwordValue, "[REDACTED_PASSWORD]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]")
    .replace(/(authorization(?:\\?["']|\s)*[:=](?:\\?["']|\s)*(?:bearer\s+)?)([A-Za-z0-9._~-]{16,})/gi, "$1[REDACTED_AUTH]")
    .replace(/(nexion_admin_token(?:%3d|=|\\u003d))([^;,\s"'\\]{12,})/gi, "$1[REDACTED_COOKIE]");
}

try {
  const logoutEvidence = JSON.parse(await readFile(join(artifactRoot, "logout.json"), "utf8"));
  if (logoutEvidence?.success !== true) throw new Error("LOGOUT_NOT_CONFIRMED");

  const sourceTraceZip = await exists(rawTraceZip) ? rawTraceZip : restrictedTraceZip;
  const extract = spawnSync("tar.exe", ["-xf", sourceTraceZip, "-C", tempRoot], { encoding: "utf8" });
  if (extract.status !== 0) throw new Error(`TRACE_EXTRACT_FAILED:${extract.status}:${extract.stderr.trim()}`);

  const passwordBytes = Buffer.from(password, "utf8");
  const excludedArtifacts = new Set([rawTraceZip, restrictedTraceZip, sanitizedTraceZip]);
  const artifactFiles = (await filesUnder(artifactRoot)).filter((path) => !excludedArtifacts.has(path) && !ignoredExtensions.has(extension(path)));
  const traceFiles = (await filesUnder(tempRoot)).filter((path) => !ignoredExtensions.has(extension(path)));
  const shareableHits = [];
  const rawTraceHits = [];

  for (const path of artifactFiles) {
    shareableHits.push(...scanBuffer(await readFile(path), relative(artifactRoot, path).replaceAll("\\", "/"), passwordBytes));
  }
  for (const path of traceFiles) {
    const displayPath = `trace://${relative(tempRoot, path).replaceAll("\\", "/")}`;
    const buffer = await readFile(path);
    rawTraceHits.push(...scanBuffer(buffer, displayPath, passwordBytes));
    const text = buffer.toString("utf8");
    const redacted = redactCredentials(text, password);
    if (redacted !== text) await writeFile(path, redacted, "utf8");
  }

  await rm(sanitizedTraceZip, { force: true });
  const zip = spawnSync("tar.exe", ["-a", "-cf", sanitizedTraceZip, "-C", tempRoot, "."], { encoding: "utf8" });
  if (zip.status !== 0) throw new Error(`TRACE_REZIP_FAILED:${zip.status}:${zip.stderr.trim()}`);

  const sanitizedTraceHits = [];
  for (const path of traceFiles) {
    sanitizedTraceHits.push(...scanBuffer(await readFile(path), `sanitized-trace://${relative(tempRoot, path).replaceAll("\\", "/")}`, passwordBytes));
  }
  const shareableCounts = countHits([...shareableHits, ...sanitizedTraceHits]);
  const rawTraceCounts = countHits(rawTraceHits);
  const rawPasswordSafe = rawTraceCounts["password-exact"] === 0;
  const shareableSafe = Object.values(shareableCounts).every((count) => count === 0);

  if (await exists(rawTraceZip)) await rename(rawTraceZip, restrictedTraceZip);
  await writeFile(join(artifactRoot, "RESTRICTED-TRACE-NOTICE.md"), [
    "# Restricted raw Playwright trace",
    "",
    "The raw trace contains revoked authentication-cookie values and is local-only.",
    "Logout succeeded before the evidence run completed.",
    "Use `j4-readonly-trace-sanitized.zip` for any shareable review.",
    "",
  ].join("\n"), "utf8");

  const scannerSource = await readFile(fileURLToPath(import.meta.url));
  const report = {
    runId,
    scannedAt: new Date().toISOString(),
    scannerSha256: sha256(scannerSource),
    passwordSha256: sha256(passwordBytes),
    logoutConfirmed: true,
    scannedArtifactFiles: artifactFiles.length,
    scannedTraceFiles: traceFiles.length,
    rawTrace: { restricted: true, counts: rawTraceCounts, hits: rawTraceHits },
    shareable: { counts: shareableCounts, hits: [...shareableHits, ...sanitizedTraceHits] },
    passed: rawPasswordSafe && shareableSafe,
    note: "Only hashes, hit counts, file paths, and byte offsets are recorded; secret values are never written.",
  };
  await writeFile(join(artifactRoot, "sensitive-scan.json"), JSON.stringify(report, null, 2), "utf8");
  if (!report.passed) throw new Error(`J4_SENSITIVE_SCAN_FAILED:${JSON.stringify({ rawTraceCounts, shareableCounts })}`);

  const manifestPath = join(artifactRoot, "artifact-manifest.sha256");
  const manifestFiles = (await filesUnder(artifactRoot)).filter((path) => path !== manifestPath).sort();
  const manifest = [];
  for (const path of manifestFiles) {
    const content = await readFile(path);
    manifest.push(`${sha256(content)}  ${relative(artifactRoot, path).replaceAll("\\", "/")}`);
  }
  await writeFile(manifestPath, `${manifest.join("\n")}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ artifactRoot, rawTraceCounts, shareableCounts, manifestEntries: manifest.length })}\n`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
