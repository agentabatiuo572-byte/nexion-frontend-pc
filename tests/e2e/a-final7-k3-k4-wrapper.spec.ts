import { createHash, createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";

const wrapperToken = required("A_FINAL7_K_WRAPPER_TOKEN");
const baseUrl = required("A_FINAL7_K_BASE_URL");
const runId = required("A_FINAL7_K_RUN_ID");
const restrictedDir = required("A_FINAL7_K_RESTRICTED_DIR");
const sourceAManifest = required("A_FINAL7_K_SOURCE_A_MANIFEST");
const sourcePublisherManifest = required("A_FINAL7_K_SOURCE_PUBLISHER_MANIFEST");
const expectedBuildId = required("A_FINAL7_K_EXPECTED_BUILD_ID");
const candidateJar = required("A_FINAL7_K_CANDIDATE_JAR");
const expectedJarSha256 = required("A_FINAL7_K_EXPECTED_JAR_SHA256").toUpperCase();
const expectedPcPid = positiveInteger(required("A_FINAL7_K_EXPECTED_PC_PID"), "PC_PID");
const expectedBackendPid = positiveInteger(required("A_FINAL7_K_EXPECTED_BACKEND_PID"), "BACKEND_PID");
const expectedPcPort = portNumber(required("A_FINAL7_K_EXPECTED_PC_PORT"), "PC_PORT");
const expectedBackendPort = portNumber(required("A_FINAL7_K_EXPECTED_BACKEND_PORT"), "BACKEND_PORT");
const mfaBypass = required("A_FINAL7_K_MFA_BYPASS");
const restrictedOwner = required("A_FINAL7_K_RESTRICTED_OWNER");
const k3ManifestPath = path.join(restrictedDir, "final7-k3-locked-manifest.json");
const k4ManifestPath = path.join(restrictedDir, "final7-k4-locked-manifest.json");
const safeSummaryPath = path.join(restrictedDir, "final7-k-wrapper-safe-summary.json");
const globalLockToken = `GLOBAL_J1+B1:${runId}:${expectedBuildId}:${expectedJarSha256}`;
const k3WriteToken = `K3_WRITE:${runId}:${expectedBuildId}:${expectedJarSha256}`;
const k4Lock = `K4_WRITE:${runId}:${expectedBuildId}:${expectedJarSha256}`;
const expectedWrapperToken = `A_FINAL7_K_WRAPPERS:${runId}:${expectedBuildId}:${expectedJarSha256}:${expectedPcPid}:${expectedBackendPid}`;
const writtenSensitiveOutputs = new Set<string>();
const usedTotpSteps = new Map<string, number>();

type RequiredName =
  | "A_FINAL7_K_WRAPPER_TOKEN"
  | "A_FINAL7_K_BASE_URL"
  | "A_FINAL7_K_RUN_ID"
  | "A_FINAL7_K_RESTRICTED_DIR"
  | "A_FINAL7_K_SOURCE_A_MANIFEST"
  | "A_FINAL7_K_SOURCE_PUBLISHER_MANIFEST"
  | "A_FINAL7_K_EXPECTED_BUILD_ID"
  | "A_FINAL7_K_CANDIDATE_JAR"
  | "A_FINAL7_K_EXPECTED_JAR_SHA256"
  | "A_FINAL7_K_EXPECTED_PC_PID"
  | "A_FINAL7_K_EXPECTED_BACKEND_PID"
  | "A_FINAL7_K_EXPECTED_PC_PORT"
  | "A_FINAL7_K_EXPECTED_BACKEND_PORT"
  | "A_FINAL7_K_MFA_BYPASS"
  | "A_FINAL7_K_RESTRICTED_OWNER";

type Credential = {
  accountId: string;
  username: string;
  password: string;
  totpSecret: string;
};

type AManifest = {
  runId?: string;
  actors?: Record<"maker" | "checker" | "cleanup", Partial<Credential>>;
};

type PublisherManifest = {
  runId?: string;
  publisher?: Partial<Credential>;
};

type Session = {
  username?: string;
  roleCode?: string;
  authorities?: string[];
};

type Gate = {
  passwordStatus: number;
  mfaStatus: number;
  sessionStatus: number;
  logoutStatus: number;
  roleCode: string;
};

test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe.configure({ mode: "serial", timeout: 600_000 });

test("Final7 K3/K4 wrappers bind current candidate and four isolated normal-MFA actors", async ({ browser, request }) => {
  validateStaticScope();
  expect(wrapperToken, "controller-issued wrapper token must bind candidate PIDs").toBe(expectedWrapperToken);
  expect(mfaBypass, "MFA_BYPASS_MUST_BE_FALSE").toBe("false");
  verifyCandidateAndListeners();
  expect((await request.get(baseUrl)).status()).toBe(200);
  expect((await request.get(`${baseUrl}/api/admin/auth/session`)).status()).toBe(401);
  expect((await request.get(`http://127.0.0.1:${expectedBackendPort}/actuator/health`)).status()).toBe(401);

  restrictDirectoryAcl(restrictedDir);
  assertAclRestricted(sourceAManifest, expectedAclPrincipals());
  assertAclRestricted(sourcePublisherManifest, expectedAclPrincipals());
  const sourceA = JSON.parse(readFileSync(sourceAManifest, "utf8")) as AManifest;
  const sourcePublisher = JSON.parse(readFileSync(sourcePublisherManifest, "utf8")) as PublisherManifest;
  expect(sourceA.runId).toBe(runId);
  expect(sourcePublisher.runId).toBe(runId);
  const maker = credential(sourceA.actors?.maker, "K4_MAKER");
  const checker = credential(sourceA.actors?.checker, "K4_CHECKER");
  const j1B1Operator = credential(sourceA.actors?.cleanup, "K3_J1_B1_OPERATOR");
  const publisher = credential(sourcePublisher.publisher, "K4_PUBLISHER");
  const actorNames = new Set([j1B1Operator.username, publisher.username, maker.username, checker.username]);
  if (actorNames.size !== 4) throw new Error("K3_J1_B1_OPERATOR_MUST_NOT_BE_K4_WRITER");
  const actorIds = new Set([j1B1Operator.accountId, publisher.accountId, maker.accountId, checker.accountId]);
  expect(actorIds.size, "all wrapper account IDs must be distinct").toBe(4);

  const summary: Record<string, unknown> = {
    runId,
    candidate: candidateBinding(),
    locks: { globalJ1B1: globalLockToken, k3Write: k3WriteToken, k4Write: k4Lock },
    sourceManifestHashes: {
      a: fileSha256(sourceAManifest),
      publisher: fileSha256(sourcePublisherManifest),
    },
    actors: [],
    status: "RUNNING",
  };

  try {
    const gates = {
      j1B1Operator: await verifyNormalMfaActor(browser, j1B1Operator, [
        "overview_b1_read",
        "finance_d3_injection_create",
        "emergency_j1_read",
        "emergency_j1_gate_resume",
        "emergency_j1_gate_kill",
      ]),
      publisher: await verifyNormalMfaActor(browser, publisher, ["risk_k4_write"]),
      maker: await verifyNormalMfaActor(browser, maker, ["risk_k4_write", "risk_k4_user_override", "risk_k4_user_recompute"]),
      checker: await verifyNormalMfaActor(browser, checker, ["risk_k4_user_override"]),
    };
    summary.actors = [
      safeActor("j1B1Operator", j1B1Operator, gates.j1B1Operator),
      safeActor("publisher", publisher, gates.publisher),
      safeActor("maker", maker, gates.maker),
      safeActor("checker", checker, gates.checker),
    ];

    writeRestrictedJson(k3ManifestPath, {
      sensitive: true,
      doNotUpload: true,
      runId,
      globalLockToken,
      writeToken: k3WriteToken,
      candidate: {
        pcBuildId: expectedBuildId,
        backendJarSha256: expectedJarSha256,
        pcPid: expectedPcPid,
        pcPort: expectedPcPort,
        backendPid: expectedBackendPid,
        backendPort: expectedBackendPort,
        mfaBypass: false,
      },
      accounts: { j1B1Operator: credentialSlice(j1B1Operator) },
      actorMetadata: {
        j1B1Operator: { accountId: j1B1Operator.accountId, roleCode: "SUPER_ADMIN", businessWriter: false },
      },
      cleanupPlan: exactCleanupPlan([j1B1Operator]),
    });
    writtenSensitiveOutputs.add(k3ManifestPath);

    writeRestrictedJson(k4ManifestPath, {
      sensitive: true,
      doNotUpload: true,
      runId,
      lock: k4Lock,
      candidate: {
        buildId: expectedBuildId,
        backendJarSha256: expectedJarSha256,
        pcPid: expectedPcPid,
        pcPort: expectedPcPort,
        backendPid: expectedBackendPid,
        backendPort: expectedBackendPort,
        mfaBypass: false,
      },
      publisher: credentialSlice(publisher),
      maker: credentialSlice(maker),
      checker: credentialSlice(checker),
      actorMetadata: {
        publisher: { accountId: publisher.accountId, roleCode: "SUPER_ADMIN" },
        maker: { accountId: maker.accountId, roleCode: "SUPER_ADMIN" },
        checker: { accountId: checker.accountId, roleCode: "SUPER_ADMIN" },
      },
      cleanupPlan: exactCleanupPlan([publisher, maker, checker]),
    });
    writtenSensitiveOutputs.add(k4ManifestPath);

    summary.manifests = {
      k3: { path: k3ManifestPath, sha256: fileSha256(k3ManifestPath) },
      k4: { path: k4ManifestPath, sha256: fileSha256(k4ManifestPath) },
    };
    summary.acl = { restricted: true, inherited: false, allowlistOnly: true };
    summary.status = "READY";
    writeRestrictedJson(safeSummaryPath, summary);
  } catch (error) {
    summary.status = "FAILED_CLEANED";
    summary.failure = "FINAL7_K_WRAPPER_FAILED";
    summary.discardedSensitiveOutputs = cleanupSensitiveOutputs();
    writeRestrictedJson(safeSummaryPath, summary);
    throw error;
  }
});

function required(name: RequiredName) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}

function validateStaticScope() {
  const url = new URL(baseUrl);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) {
    throw new Error("FINAL7_K_WRAPPER_LOOPBACK_REQUIRED");
  }
  expect(Number(url.port || 80)).toBe(expectedPcPort);
  const base = realpathSync(restrictedDir);
  if (!base.toLowerCase().includes(`${path.sep}.restricted${path.sep}`) || !base.includes(runId)) {
    throw new Error("FINAL7_K_RESTRICTED_DIR_INVALID");
  }
  for (const file of [sourceAManifest, sourcePublisherManifest]) {
    const resolved = realpathSync(file);
    const relative = path.relative(base, resolved);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("FINAL7_K_SOURCE_MANIFEST_OUT_OF_SCOPE");
  }
  validateWindowsPrincipal(restrictedOwner);
}

function verifyCandidateAndListeners() {
  expect(readFileSync(".next/BUILD_ID", "utf8").trim()).toBe(expectedBuildId);
  expect(fileSha256(candidateJar)).toBe(expectedJarSha256);
  expect(listenerPid(expectedPcPort)).toBe(expectedPcPid);
  expect(listenerPid(expectedBackendPort)).toBe(expectedBackendPid);
}

function listenerPid(port: number) {
  const pids = new Set<number>();
  const output = execFileSync("netstat.exe", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true });
  for (const line of output.split(/\r?\n/)) {
    const match = line.trim().match(/^TCP\s+(\S+)\s+\S+\s+LISTENING\s+(\d+)$/i);
    if (match && match[1].endsWith(`:${port}`)) pids.add(Number(match[2]));
  }
  if (pids.size !== 1) throw new Error(`FINAL7_LISTENER_PID_AMBIGUOUS:${port}`);
  return [...pids][0];
}

async function verifyNormalMfaActor(browser: Browser, actor: Credential, authorities: string[]): Promise<Gate> {
  const context = await browser.newContext({ baseURL: baseUrl });
  const page = await context.newPage();
  try {
    await gotoLogin(page);
    await page.locator('input[autocomplete="username"]').fill(actor.username);
    await page.locator('input[autocomplete="current-password"]').fill(actor.password);
    const loginPending = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/login");
    await page.getByRole("button", { name: /登录|继续/ }).click();
    const login = await loginPending;
    expect(login.status(), `normal password login failed for ${actor.username}`).toBe(200);
    const otp = page.getByLabel("一次性验证码");
    await expect(otp, `normal MFA gate required for ${actor.username}`).toBeVisible({ timeout: 20_000 });
    await otp.fill(await freshTotp(actor.totpSecret));
    const verifyPending = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const verified = await verifyPending;
    expect(verified.status(), `normal MFA verification failed for ${actor.username}`).toBe(200);
    await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
    const sessionResponse = await page.request.get("/api/admin/auth/session");
    expect(sessionResponse.status()).toBe(200);
    const body = await sessionResponse.json() as { code?: number; data?: { session?: Session } };
    expect(body.code).toBe(0);
    const session = body.data?.session ?? {};
    expect(session.username).toBe(actor.username);
    expect(session.roleCode).toBe("SUPER_ADMIN");
    for (const authority of authorities) expect(session.authorities ?? [], `${actor.username} missing ${authority}`).toContain(authority);
    const logout = await page.request.post("/api/admin/auth/logout");
    expect(logout.status()).toBe(200);
    expect((await page.request.get("/api/admin/auth/session")).status()).toBe(401);
    return { passwordStatus: login.status(), mfaStatus: verified.status(), sessionStatus: sessionResponse.status(), logoutStatus: logout.status(), roleCode: "SUPER_ADMIN" };
  } finally {
    await context.close();
  }
}

async function gotoLogin(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" }).catch((error: unknown) => {
    if (!(error instanceof Error) || !error.message.includes("is interrupted by another navigation")) throw error;
  });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

async function freshTotp(secret: string) {
  const key = createHash("sha256").update(secret).digest("hex");
  let step = Math.floor(Date.now() / 30_000);
  const remaining = 30_000 - Date.now() % 30_000;
  if (step <= (usedTotpSteps.get(key) ?? -1) || remaining < 4_000) {
    await expect.poll(() => Math.floor(Date.now() / 30_000), { timeout: 35_000 }).toBeGreaterThan(step);
    step = Math.floor(Date.now() / 30_000);
  }
  usedTotpSteps.set(key, step);
  return currentTotp(secret);
}

function currentTotp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("TOTP_SECRET_ENCODING_INVALID");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.from(Array.from({ length: Math.floor(bits.length / 8) }, (_, index) =>
    Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

function credential(value: Partial<Credential> | undefined, label: string): Credential {
  if (!value?.accountId || !value.username || !value.password || !value.totpSecret) {
    throw new Error(`${label}_CREDENTIAL_INCOMPLETE`);
  }
  if (!/^\d+$/.test(value.accountId)) throw new Error(`${label}_ACCOUNT_ID_INVALID`);
  if (!/^[A-Za-z0-9_.-]{3,64}$/.test(value.username)) throw new Error(`${label}_USERNAME_INVALID`);
  return { accountId: value.accountId, username: value.username, password: value.password, totpSecret: value.totpSecret };
}

function credentialSlice(actor: Credential) {
  return { username: actor.username, password: actor.password, totpSecret: actor.totpSecret };
}

function safeActor(kind: string, actor: Credential, gate: Gate) {
  return { kind, accountId: actor.accountId, username: actor.username, roleCode: gate.roleCode, normalLoginGate: gate };
}

function exactCleanupPlan(actors: Credential[]) {
  return actors.map((actor) => ({
    accountId: actor.accountId,
    username: actor.username,
    order: ["sessions/revoke", "reset-2fa", "role=unassigned", "status=disabled", "exact database delete"],
  }));
}

function candidateBinding() {
  return {
    buildId: expectedBuildId,
    backendJarSha256: expectedJarSha256,
    pc: { pid: expectedPcPid, port: expectedPcPort },
    backend: { pid: expectedBackendPid, port: expectedBackendPort },
    mfaBypass: false,
  };
}

function positiveInteger(value: string, label: string) {
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new Error(`FINAL7_${label}_INVALID`);
  return Number(value);
}

function portNumber(value: string, label: string) {
  const parsed = positiveInteger(value, label);
  if (parsed > 65_535) throw new Error(`FINAL7_${label}_INVALID`);
  return parsed;
}

function fileSha256(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex").toUpperCase();
}

function writeRestrictedJson(file: string, value: unknown) {
  const temporary = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
    restrictFileAcl(temporary);
    renameSync(temporary, file);
    restrictFileAcl(file);
  } catch (error) {
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

function cleanupSensitiveOutputs() {
  const discarded: string[] = [];
  for (const file of writtenSensitiveOutputs) {
    if (!existsSync(file)) continue;
    unlinkSync(file);
    discarded.push(path.basename(file));
  }
  return discarded;
}

function validateWindowsPrincipal(value: string) {
  if (!/^[A-Za-z0-9_.\\-]{1,128}$/.test(value) || !value.includes("\\")) throw new Error("RESTRICTED_OWNER_INVALID");
  if (/^(?:everyone|authenticated users|users|codexsandboxusers|s-1-1-0)$/i.test(value.split("\\").at(-1) ?? value)) {
    throw new Error("RESTRICTED_OWNER_UNSAFE");
  }
}

function expectedAclPrincipals() {
  const current = execFileSync("whoami.exe", [], { encoding: "utf8", windowsHide: true }).trim();
  validateWindowsPrincipal(current);
  return [...new Set([restrictedOwner, current])];
}

function restrictDirectoryAcl(directory: string) {
  const principals = expectedAclPrincipals();
  execFileSync("icacls.exe", [directory, "/inheritance:r", "/grant:r",
    ...principals.map((principal) => `${principal}:(OI)(CI)(F)`),
    "*S-1-5-18:(OI)(CI)(F)", "*S-1-5-32-544:(OI)(CI)(F)"], { encoding: "utf8", windowsHide: true });
  assertAclRestricted(directory, principals);
}

function restrictFileAcl(file: string) {
  const principals = expectedAclPrincipals();
  execFileSync("icacls.exe", [file, "/inheritance:r", "/grant:r",
    ...principals.map((principal) => `${principal}:(F)`),
    "*S-1-5-18:(F)", "*S-1-5-32-544:(F)"], { encoding: "utf8", windowsHide: true });
  assertAclRestricted(file, principals);
}

function assertAclRestricted(target: string, principals: string[]) {
  const acl = execFileSync("icacls.exe", [target], { encoding: "utf8", windowsHide: true });
  const expected = new Set([...principals, "BUILTIN\\Administrators", "NT AUTHORITY\\SYSTEM"]
    .map((principal) => principal.toLowerCase()));
  const actual = acl.split(/\r?\n/).flatMap((line) => {
    if (!line.includes(":(")) return [];
    const normalized = line.startsWith(target) ? line.slice(target.length).trim() : line.trim();
    const separator = normalized.indexOf(":(");
    return separator < 1 ? [] : [normalized.slice(0, separator).trim().toLowerCase()];
  });
  if (actual.length !== expected.size || actual.some((principal) => !expected.has(principal))) {
    throw new Error("ACL_PRINCIPAL_OUTSIDE_ALLOWLIST");
  }
  if ([...expected].some((principal) => !actual.includes(principal))) throw new Error("ACL_REQUIRED_PRINCIPAL_MISSING");
}
