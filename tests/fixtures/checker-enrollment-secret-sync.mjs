import { createDecipheriv, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const DOMAINS = "ABCDEFGHIJKLM".split("");

if (process.env.CHECKER_SECRET_SYNC !== "1") {
  console.error("CHECKER_SECRET_SYNC=1 is required");
  process.exit(2);
}

const required = (name) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} must be explicitly provided`);
  return value;
};

const runId = required("CHECKER_SECRET_SYNC_RUN_ID");
const database = required("CHECKER_SECRET_SYNC_DATABASE");
if (!/^nexion_acceptance_\d{8}_\d{6}$/.test(database)) {
  throw new Error("checker secret sync only permits an isolated acceptance database");
}
const mysqlExecutable = path.resolve(required("CHECKER_SECRET_SYNC_MYSQL"));
const mysqlPassword = required("CHECKER_SECRET_SYNC_MYSQL_PASSWORD");
const mfaKey = required("CHECKER_SECRET_SYNC_MFA_KEY");
const requestedRoot = path.resolve(required("CHECKER_SECRET_SYNC_RESTRICTED_ROOT"));
const allowedBase = await realpath(path.resolve("D:/workspace/bug-pic/.restricted"));
const canonicalRoot = await realpath(requestedRoot);
const relative = path.relative(allowedBase, canonicalRoot);
if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
  throw new Error("checker secret sync requires a child Run directory under canonical bug-pic/.restricted");
}

const permissionDir = path.join(canonicalRoot, "A", "permission-fixtures");
const domainDir = path.join(canonicalRoot, "A", "domain-permission-fixtures");
const globalFile = path.join(permissionDir, "permission-fixtures.json");
const resetSummary = JSON.parse(await readFile(
  path.join(permissionDir, "checker-reset-2fa-summary.json"),
  "utf8",
));
const global = JSON.parse(await readFile(globalFile, "utf8"));

if (global.runId !== runId || !global.checker?.id || !global.checker?.username) {
  throw new Error("global checker does not belong to the requested Run");
}
if (
  resetSummary.accountId !== String(global.checker.id)
  || resetSummary.username !== global.checker.username
) {
  throw new Error("enrollment evidence does not belong to the global checker");
}
const ciphertext = execFileSync(mysqlExecutable, [
  "-h", "127.0.0.1",
  "-P", "3306",
  "-u", "root",
  "--batch",
  "--skip-column-names",
  database,
  "-e",
  `SELECT tfa_secret_encrypted FROM nx_admin_account_state WHERE admin_id=${Number(global.checker.id)} AND is_deleted=0 LIMIT 1`,
], {
  encoding: "utf8",
  env: { ...process.env, MYSQL_PWD: mysqlPassword },
  stdio: ["ignore", "pipe", "pipe"],
}).trim();
if (!ciphertext) {
  throw new Error("authoritative checker MFA binding is missing");
}
const payload = Buffer.from(ciphertext.replace(/-/g, "+").replace(/_/g, "/"), "base64");
if (payload.length < 29) throw new Error("authoritative checker MFA binding is malformed");
const iv = payload.subarray(0, 12);
const authTag = payload.subarray(payload.length - 16);
const encrypted = payload.subarray(12, payload.length - 16);
const decipher = createDecipheriv("aes-256-gcm", createHash("sha256").update(mfaKey.trim()).digest(), iv);
decipher.setAuthTag(authTag);
const enrolledSecret = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
if (!/^[A-Z2-7]{16,}$/.test(enrolledSecret)) {
  throw new Error("authoritative checker MFA binding decrypted to an invalid key");
}

const manifests = [];
for (const domain of DOMAINS) {
  const file = path.join(domainDir, `${domain}.json`);
  const manifest = JSON.parse(await readFile(file, "utf8"));
  if (
    manifest.runId !== runId
    || manifest.checker?.username !== global.checker.username
  ) {
    throw new Error(`${domain}.json checker does not belong to the requested Run`);
  }
  manifests.push({ file, value: manifest });
}

const backupDir = path.join(permissionDir, "checker-secret-sync-backup");
await mkdir(backupDir, { recursive: true });
await atomicJson(path.join(backupDir, "permission-fixtures.json"), global);
for (let index = 0; index < DOMAINS.length; index += 1) {
  await atomicJson(path.join(backupDir, `${DOMAINS[index]}.json`), manifests[index].value);
}

global.checker.totpSecret = enrolledSecret;
await atomicJson(globalFile, global);
for (const manifest of manifests) {
  manifest.value.checker.totpSecret = enrolledSecret;
  await atomicJson(manifest.file, manifest.value);
}
await atomicJson(path.join(permissionDir, "checker-secret-sync-summary.json"), {
  runId,
  syncedAt: new Date().toISOString(),
  checkerAccountId: String(global.checker.id),
  updatedManifestCount: 14,
  syncCompleted: true,
});
console.log(JSON.stringify({ runId, updatedManifestCount: 14, syncCompleted: true }));

async function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}
