import { createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const refreshToken = required("A_FIXTURE_REFRESH_TOKEN");
const baseURL = required("A_FINAL7_BASE_URL");
const runId = required("A_FINAL7_RUN_ID");
const restrictedDir = required("A_FINAL7_RESTRICTED_DIR");
const currentManifestPath = required("A_FINAL7_CURRENT_MANIFEST");
const dbName = required("A_FINAL7_DB_NAME");
const operator = required("A_FINAL7_FIXTURE_OPERATOR");
const operatorPassword = required("A_FINAL7_FIXTURE_OPERATOR_PASSWORD");
const dbPassword = required("A_FINAL7_FIXTURE_DB_PASSWORD");
const mfaEncryptionKey = required("A_FINAL7_MFA_ENCRYPTION_KEY");
const restrictedOwner = required("A_FINAL7_RESTRICTED_OWNER");
const expectedBuildId = required("A_FINAL7_EXPECTED_BUILD_ID");
const candidateJar = required("A_FINAL7_CANDIDATE_JAR");
const expectedJarSha256 = required("A_FINAL7_EXPECTED_JAR_SHA256").toUpperCase();
const mysqlBin = process.env.A_FINAL7_MYSQL_BIN?.trim()
  || "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const allowedRestrictedBase = "D:/workspace/bug-pic/.restricted";
const aManifestPath = path.join(restrictedDir, "final7-a-fixture-manifest.json");
const k4ManifestPath = path.join(restrictedDir, "final7-k4-publisher-manifest.json");
const safeSummaryPath = path.join(restrictedDir, "safe-summary.json");
const reason = `${runId} Final7 isolated A fixture refresh`;
const expectedRefreshToken = "A_FIXTURE_REFRESH_FINAL7_20260801T1530JST";
const createdActorIds: string[] = [];
const plannedActors: Array<{ kind: "maker" | "checker" | "cleanup" | "k4Publisher"; username: string }> = [];
const lastTotpStepBySecretHash = new Map<string, number>();

type RequiredName =
  | "A_FIXTURE_REFRESH_TOKEN"
  | "A_FINAL7_BASE_URL"
  | "A_FINAL7_RUN_ID"
  | "A_FINAL7_RESTRICTED_DIR"
  | "A_FINAL7_CURRENT_MANIFEST"
  | "A_FINAL7_DB_NAME"
  | "A_FINAL7_FIXTURE_OPERATOR"
  | "A_FINAL7_FIXTURE_OPERATOR_PASSWORD"
  | "A_FINAL7_FIXTURE_DB_PASSWORD"
  | "A_FINAL7_MFA_ENCRYPTION_KEY"
  | "A_FINAL7_RESTRICTED_OWNER"
  | "A_FINAL7_EXPECTED_BUILD_ID"
  | "A_FINAL7_CANDIDATE_JAR"
  | "A_FINAL7_EXPECTED_JAR_SHA256";

type Credential = {
  accountId: string;
  username: string;
  password: string;
  totpSecret: string;
};

type AccountRow = {
  id: string | number;
  username: string;
  role: string;
  status: string;
  version: string | number;
  sessions: string | number;
  tfa: boolean;
};

type ExistingManifest = {
  actors: Record<string, Partial<Credential>>;
};

test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe.configure({ mode: "serial", timeout: 1_200_000 });

test("Final7 refresh diagnoses Final6 enrollment mismatch, replaces A actors, and provisions isolated K4 publisher", async ({ page }) => {
  expect(refreshToken, "fixture refresh must hold the controller-issued shared lock").toBe(expectedRefreshToken);
  validateStaticScope();
  verifyFinal6Candidate();
  mkdirSync(restrictedDir, { recursive: true });
  restrictDirectoryAcl(restrictedDir);

  const existingManifest = JSON.parse(readFileSync(currentManifestPath, "utf8")) as ExistingManifest;
  const existingActors = ["maker", "checker", "cleanup"]
    .map((key) => ({ key, actor: validateCredential(existingManifest.actors?.[key], `Final6 ${key}`) }));
  const securitySummary: Record<string, unknown> = {
    runId,
    candidate: { buildId: expectedBuildId, jarSha256: expectedJarSha256, bypass: false },
    visibleModules: ["A1", "A6", "A7"],
    diagnosis: [],
    deletedFinal6: [],
    created: [],
    normalLoginGate: {},
    cleanupPlan: [],
    scope: "K4 publisher fixture only; no K-domain business endpoint is called",
    status: "RUNNING",
  };

  try {
    for (const { key, actor } of existingActors) {
      const databaseSecret = decryptMfaSecret(readEncryptedMfa(actor.accountId, actor.username));
      const normalLoginGate = await diagnoseExistingActor(page, actor);
      (securitySummary.diagnosis as unknown[]).push({
        actor: key,
        accountId: actor.accountId,
        username: actor.username,
        manifestSecretMatchesDatabase: constantTimeEqual(actor.totpSecret, databaseSecret),
        normalLoginGate,
      });
    }

    const operatorSecret = readOperatorMfaSecret();
    await loginNormal(page, operator, operatorPassword, operatorSecret);
    await verifyVisibleAdminPaths(page);
    for (const { actor } of existingActors) {
      await retireAndDeleteExact(page, actor.accountId, actor.username);
      (securitySummary.deletedFinal6 as unknown[]).push({ accountId: actor.accountId, username: actor.username, residual: 0 });
    }

    const nonce = randomBytes(5).toString("hex");
    plannedActors.push(
      { kind: "maker", username: `ffix.a.final7.m.${nonce}` },
      { kind: "checker", username: `ffix.a.final7.c.${nonce}` },
      { kind: "cleanup", username: `ffix.a.final7.x.${nonce}` },
      { kind: "k4Publisher", username: `ffix.k4.final7.p.${nonce}` },
    );

    const credentials = new Map<string, Credential>();
    for (const planned of plannedActors) {
      await loginNormal(page, operator, operatorPassword, operatorSecret);
      const created = await createSuperAccountViaVisibleA1(
        page,
        planned.username,
        planned.kind === "k4Publisher" ? "Final7 K4 isolated publisher" : `Final7 A ${planned.kind}`,
      );
      createdActorIds.push(created.accountId);
      const credential = await activateViaNormalMfaEnrollment(page, planned.username, created.temporaryPassword, created.accountId);
      const normalLoginGate = await loginNormal(page, credential.username, credential.password, credential.totpSecret);
      expect(normalLoginGate).toEqual({ passwordStatus: 200, mfaStatus: 200, sessionStatus: 200 });
      credentials.set(planned.kind, credential);
      (securitySummary.created as unknown[]).push({
        kind: planned.kind,
        accountId: credential.accountId,
        username: credential.username,
        role: "SUPER_ADMIN",
        mfaBound: true,
      });
      (securitySummary.normalLoginGate as Record<string, unknown>)[planned.kind] = normalLoginGate;
    }

    const maker = requiredCredential(credentials, "maker");
    const checker = requiredCredential(credentials, "checker");
    const cleanup = requiredCredential(credentials, "cleanup");
    const publisher = requiredCredential(credentials, "k4Publisher");
    const cleanupPlan = [maker, checker, cleanup, publisher].map((actor) => ({
      accountId: actor.accountId,
      username: actor.username,
      order: ["sessions/revoke", "reset-2fa", "role=unassigned", "status=disabled", "exact database delete"],
    }));
    securitySummary.cleanupPlan = cleanupPlan;

    writeRestrictedJson(aManifestPath, {
      sensitive: true,
      doNotUpload: true,
      runId,
      candidate: { buildId: expectedBuildId, jarSha256: expectedJarSha256, bypass: false },
      actors: { maker, checker, cleanup },
      cleanup: { exactPrefix: "ffix.a.final7.", required: cleanupPlan.slice(0, 3) },
    });
    writeRestrictedJson(k4ManifestPath, {
      sensitive: true,
      doNotUpload: true,
      runId,
      purpose: "One-time K4 publisher fixture; no K-domain business state is touched by provisioning",
      publisher: { ...publisher, role: "SUPER_ADMIN" },
      cleanup: { exactPrefix: "ffix.k4.final7.p.", required: [cleanupPlan[3]] },
    });
    securitySummary.manifests = {
      a: { path: aManifestPath, sha256: fileSha256(aManifestPath) },
      k4: { path: k4ManifestPath, sha256: fileSha256(k4ManifestPath) },
    };
    securitySummary.acl = { restricted: true, inherited: false };
    securitySummary.status = "READY";
    writeRestrictedJson(safeSummaryPath, securitySummary);
  } catch (error) {
    securitySummary.status = "FAILED_CLEANED";
    securitySummary.failure = "FIXTURE_REFRESH_FAILED";
    securitySummary.cleanup = await cleanupCreatedActors(page);
    securitySummary.discardedSensitiveOutputs = cleanupSensitiveOutputs();
    writeRestrictedJson(safeSummaryPath, securitySummary);
    throw error;
  }
});

function required(name: RequiredName) {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`${name}_REQUIRED`);
  return value;
}

function validateStaticScope() {
  const parsed = new URL(baseURL);
  if (!(["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) || parsed.protocol !== "http:") {
    throw new Error("fixture refresh only permits a loopback admin endpoint");
  }
  const allowed = realpathSync(allowedRestrictedBase);
  const parent = realpathSync(path.dirname(restrictedDir));
  const relative = path.relative(allowed, parent);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("RESTRICTED_DIR_OUT_OF_SCOPE");
  const manifestRelative = path.relative(allowed, realpathSync(currentManifestPath));
  if (manifestRelative.startsWith("..") || path.isAbsolute(manifestRelative)) {
    throw new Error("CURRENT_MANIFEST_OUT_OF_RESTRICTED_SCOPE");
  }
  validateIdentifier(dbName, "database");
  validateUsername(operator);
  validateWindowsPrincipal(restrictedOwner);
}

function verifyFinal6Candidate() {
  expect(readFileSync(path.resolve(".next/BUILD_ID"), "utf8").trim(), "Final6 PC build must remain locked before fixture writes")
    .toBe(expectedBuildId);
  expect(fileSha256(candidateJar), "Final6 backend JAR must remain locked before fixture writes")
    .toBe(expectedJarSha256);
}

async function verifyVisibleAdminPaths(page: Page) {
  for (const [name, route] of [
    ["运营账号 & RBAC A1", /\/platform\/rbac$/],
    ["角色管理 A6", /\/platform\/roles$/],
    ["菜单管理 A7", /\/platform\/menus$/],
  ] as const) await nav(page, name, route);
  expect((await page.request.get("/api/admin/auth/session")).status()).toBe(200);
}

async function diagnoseExistingActor(page: Page, actor: Credential) {
  await clearAuthForActorSwitch(page);
  await fillPasswordLogin(page, actor.username, actor.password);
  const passwordResponse = await submitPasswordLogin(page);
  if (passwordResponse !== 200) return { passwordStatus: passwordResponse, mfaStatus: 0, sessionStatus: 401 };
  const otp = page.getByLabel("一次性验证码");
  if (!await otp.isVisible({ timeout: 10_000 }).catch(() => false)) {
    return { passwordStatus: 200, mfaStatus: 0, sessionStatus: 401 };
  }
  await fillFreshTotp(otp, actor.totpSecret);
  const verification = page.waitForResponse((response) => pathOf(response.url()) === "/api/admin/auth/mfa/verify");
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  const mfaStatus = (await verification).status();
  const sessionStatus = (await page.request.get("/api/admin/auth/session")).status();
  await clearAuthForActorSwitch(page);
  return { passwordStatus: 200, mfaStatus, sessionStatus };
}

async function loginNormal(page: Page, username: string, password: string, secret: string) {
  await clearAuthForActorSwitch(page);
  await fillPasswordLogin(page, username, password);
  const passwordStatus = await submitPasswordLogin(page);
  expect(passwordStatus, `normal password login failed for ${username}`).toBe(200);
  const otp = page.getByLabel("一次性验证码");
  await expect(otp, `normal MFA gate required for ${username}`).toBeVisible({ timeout: 15_000 });
  await fillFreshTotp(otp, secret);
  const verification = page.waitForResponse((response) => pathOf(response.url()) === "/api/admin/auth/mfa/verify");
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  const mfaStatus = (await verification).status();
  expect(mfaStatus, `normal MFA verification failed for ${username}`).toBe(200);
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
  const sessionStatus = (await page.request.get("/api/admin/auth/session")).status();
  expect(sessionStatus).toBe(200);
  return { passwordStatus, mfaStatus, sessionStatus };
}

async function clearAuthForActorSwitch(page: Page) {
  await page.request.post("/api/admin/auth/logout").catch(() => undefined);
  await page.context().clearCookies();
  await page.goto(baseURL, { waitUntil: "domcontentloaded" }).catch((error: unknown) => {
    if (!(error instanceof Error) || !error.message.includes("is interrupted by another navigation")) throw error;
  });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  expect((await page.request.get("/api/admin/auth/session")).status()).toBe(401);
}

async function fillPasswordLogin(page: Page, username: string, password: string) {
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(password);
}

async function submitPasswordLogin(page: Page) {
  const response = page.waitForResponse((candidate) =>
    pathOf(candidate.url()) === "/api/admin/auth/login" && candidate.request().method() === "POST");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  return (await response).status();
}

async function fillFreshTotp(locator: ReturnType<Page["getByLabel"]>, secret: string) {
  const secretKey = createHash("sha256").update(secret).digest("hex");
  const currentStep = Math.floor(Date.now() / 30_000);
  const remaining = 30_000 - Date.now() % 30_000;
  if (currentStep <= (lastTotpStepBySecretHash.get(secretKey) ?? -1) || remaining < 3_000) {
    await new Promise((resolve) => setTimeout(resolve, remaining + 500));
  }
  lastTotpStepBySecretHash.set(secretKey, Math.floor(Date.now() / 30_000));
  await locator.fill(currentTotp(secret));
}

async function createSuperAccountViaVisibleA1(page: Page, username: string, label: string) {
  validateUsername(username);
  await nav(page, "运营账号 & RBAC A1", /\/platform\/rbac$/);
  await page.getByRole("button", { name: "+ 新建账号", exact: true }).click();
  const modal = page.getByRole("dialog").last();
  await modal.getByRole("textbox", { name: "登录名 *", exact: true }).fill(username);
  await modal.getByPlaceholder("姓名,如:张三").fill(label);
  await modal.getByText("超级管理员", { exact: true }).click();
  await modal.getByLabel(/操作理由/).fill(reason);
  const creation = page.waitForResponse((response) =>
    pathOf(response.url()) === "/api/admin/platform/accounts" && response.request().method() === "POST");
  await modal.getByRole("button", { name: "确认创建账号", exact: true }).click();
  const confirmation = page.getByRole("dialog").last();
  await confirmation.getByLabel(/操作理由/).fill(reason);
  await confirmation.getByRole("button", { name: "确认提交", exact: true }).click();
  const response = await creation;
  const raw = await response.text();
  expect(response.status(), "A1 fixture account creation failed").toBe(200);
  const payload = JSON.parse(raw) as { code?: number; data?: { id?: string | number } };
  expect(payload.code, "A1 fixture account creation envelope failed").toBe(0);
  const accountId = exactId(payload.data?.id);
  const drawer = page.getByRole("dialog").last();
  await expect(drawer.getByText("临时密码", { exact: true })).toBeVisible();
  const temporaryPassword = (await drawer.locator(".mono").last().textContent())?.trim() ?? "";
  expect(temporaryPassword, "server-generated temporary credential required").not.toBe("");
  await drawer.getByText("关闭", { exact: true }).click();
  return { accountId, temporaryPassword };
}

async function activateViaNormalMfaEnrollment(page: Page, username: string, temporaryPassword: string, accountId: string): Promise<Credential> {
  const finalPassword = `Nx!Final7${randomBytes(20).toString("base64url")}Aa`;
  await clearAuthForActorSwitch(page);
  await fillPasswordLogin(page, username, temporaryPassword);
  expect(await submitPasswordLogin(page)).toBe(200);
  const otp = page.getByLabel("一次性验证码");
  await expect(otp, "new actor must enter the normal MFA enrollment product path").toBeVisible();
  const totpSecret = (await page.locator("code").first().textContent())?.trim() ?? "";
  expect(totpSecret, "server MFA enrollment secret required").not.toBe("");
  await fillFreshTotp(otp, totpSecret);
  const verification = page.waitForResponse((response) => pathOf(response.url()) === "/api/admin/auth/mfa/verify");
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  expect((await verification).status(), "new actor MFA enrollment failed").toBe(200);
  await expect(page.getByRole("heading", { name: "首次登录修改密码" })).toBeVisible();
  await page.getByLabel("新密码", { exact: true }).fill(finalPassword);
  await page.getByLabel("确认新密码", { exact: true }).fill(finalPassword);
  const passwordChange = page.waitForResponse((response) =>
    pathOf(response.url()) === "/api/admin/auth/password/change" && response.request().method() === "POST");
  await page.getByRole("button", { name: "确认修改并进入", exact: true }).click();
  expect((await passwordChange).status(), "new actor first password change failed").toBe(200);
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
  return { accountId, username, password: finalPassword, totpSecret };
}

async function retireAndDeleteExact(page: Page, accountIdValue: string, username: string) {
  const accountId = exactId(accountIdValue);
  validateUsername(username);
  let row = await accountById(page, accountId);
  if (!row) {
    expect(databaseResidual(accountId, username)).toBe(0);
    return;
  }
  expect(row.username).toBe(username);
  if (Number(row.sessions) > 0) row = await mutateAccount(page, row, "POST", "sessions/revoke", {});
  if (row.tfa) row = await mutateAccount(page, row, "POST", "reset-2fa", {});
  if (row.role !== "unassigned") row = await mutateAccount(page, row, "PATCH", "role", { role: "unassigned" });
  if (row.status !== "disabled") row = await mutateAccount(page, row, "PATCH", "status", { status: "disabled" });
  deleteExactDatabaseActor(accountId, username);
  expect(databaseResidual(accountId, username)).toBe(0);
}

async function mutateAccount(
  page: Page,
  current: AccountRow,
  method: "PATCH" | "POST",
  suffix: "sessions/revoke" | "reset-2fa" | "role" | "status",
  data: Record<string, unknown>,
) {
  const response = await page.request.fetch(`/api/admin/platform/accounts/${exactId(current.id)}/${suffix}`, {
    method,
    headers: { "Idempotency-Key": `${runId}:final7-refresh:${current.id}:${suffix}:v${current.version}` },
    data: { ...data, operator, reason, expectedVersion: String(current.version) },
  });
  const raw = await response.text();
  if (suffix === "reset-2fa" && response.status() === 409) {
    const payload = safeJson(raw);
    if (payload?.message !== "ADMIN_MFA_NOT_BOUND") throw new Error("unexpected reset-2fa conflict");
  } else {
    expect(response.status(), `fixture cleanup ${suffix} failed`).toBe(200);
    expect(safeJson(raw)?.code, `fixture cleanup ${suffix} envelope failed`).toBe(0);
  }
  const next = await accountById(page, exactId(current.id));
  if (!next) throw new Error("FIXTURE_ACCOUNT_DISAPPEARED_DURING_RETIREMENT");
  return next;
}

async function cleanupCreatedActors(page: Page) {
  const results: Array<{ accountId?: string; username: string; residual: number }> = [];
  let productCleanupReady = false;
  try {
    const operatorSecret = readOperatorMfaSecret();
    await loginNormal(page, operator, operatorPassword, operatorSecret);
    productCleanupReady = true;
  } catch {
    productCleanupReady = false;
  }
  for (const planned of plannedActors) {
    const row = productCleanupReady ? await accountByUsername(page, planned.username) : undefined;
    const accountId = row
      ? exactId(row.id)
      : databaseAccountIdByUsername(planned.username) ?? createdActorIds[plannedActors.indexOf(planned)];
    if (!accountId) continue;
    try {
      if (productCleanupReady) await retireAndDeleteExact(page, accountId, planned.username);
      else deleteExactDatabaseActor(accountId, planned.username);
    } catch {
      deleteExactDatabaseActor(accountId, planned.username);
    }
    results.push({ accountId, username: planned.username, residual: databaseResidual(accountId, planned.username) });
  }
  return results;
}

async function nav(page: Page, name: string, url: RegExp) {
  const link = page.locator("aside").getByRole("link", { name, exact: true });
  if (!await link.isVisible().catch(() => false)) {
    await page.locator("aside").getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).click();
  }
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(url);
}

async function accountById(page: Page, accountId: string) {
  return (await accountsOverview(page)).find((row) => String(row.id) === accountId);
}

async function accountByUsername(page: Page, username: string) {
  return (await accountsOverview(page)).find((row) => row.username === username);
}

async function accountsOverview(page: Page): Promise<AccountRow[]> {
  const response = await page.request.get("/api/admin/platform/accounts/overview");
  expect(response.status()).toBe(200);
  const payload = JSON.parse(await response.text()) as { code?: number; data?: { operators?: AccountRow[] } };
  expect(payload.code).toBe(0);
  return payload.data?.operators ?? [];
}

function readOperatorMfaSecret() {
  validateUsername(operator);
  const row = mysql(`SELECT COALESCE(s.tfa_secret_encrypted,'') FROM nx_admin_account_state s JOIN nx_admin a ON a.id=s.admin_id WHERE a.username='${operator}' AND s.is_deleted=0 AND a.is_deleted=0 LIMIT 1;`);
  if (!row) throw new Error("FIXTURE_OPERATOR_MFA_NOT_FOUND");
  return decryptMfaSecret(row);
}

function readEncryptedMfa(accountIdValue: string, username: string) {
  const accountId = exactId(accountIdValue);
  validateUsername(username);
  const row = mysql(`SELECT a.username,COALESCE(s.tfa_secret_encrypted,'') FROM nx_admin a JOIN nx_admin_account_state s ON s.admin_id=a.id AND s.is_deleted=0 WHERE a.id=${accountId} AND a.is_deleted=0 LIMIT 1;`);
  const [databaseUsername, encrypted] = row.split("\t");
  if (databaseUsername !== username || !encrypted) throw new Error("FINAL6_ENROLLMENT_ROW_MISSING");
  return encrypted;
}

function decryptMfaSecret(encoded: string) {
  const raw = Buffer.from(encoded, "base64url");
  if (raw.length < 29) throw new Error("MFA_ENROLLMENT_CIPHERTEXT_INVALID");
  const key = createHash("sha256").update(mfaEncryptionKey, "utf8").digest();
  const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(raw.length - 16));
  return Buffer.concat([decipher.update(raw.subarray(12, -16)), decipher.final()]).toString("utf8");
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

function constantTimeEqual(left: string, right: string) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return leftHash.equals(rightHash);
}

function validateCredential(value: Partial<Credential> | undefined, label: string): Credential {
  if (!value?.accountId || !value.username || !value.password || !value.totpSecret) {
    throw new Error(`${label.replace(/\W/g, "_")}_CREDENTIAL_INCOMPLETE`);
  }
  validateUsername(value.username);
  return { accountId: exactId(value.accountId), username: value.username, password: value.password, totpSecret: value.totpSecret };
}

function requiredCredential(credentials: Map<string, Credential>, key: string) {
  const credential = credentials.get(key);
  if (!credential) throw new Error(`FINAL7_${key.toUpperCase()}_CREDENTIAL_MISSING`);
  return credential;
}

function exactId(value: unknown) {
  const normalized = String(value ?? "");
  if (!/^\d+$/.test(normalized)) throw new Error("FIXTURE_ACCOUNT_ID_INVALID");
  return normalized;
}

function validateUsername(value: string) {
  if (!/^[A-Za-z0-9_.-]{3,64}$/.test(value)) throw new Error("FIXTURE_USERNAME_INVALID");
}

function validateIdentifier(value: string, label: string) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error(`FIXTURE_${label.toUpperCase()}_INVALID`);
}

function validateWindowsPrincipal(value: string) {
  if (!/^[A-Za-z0-9_.\\-]{1,128}$/.test(value)) throw new Error("RESTRICTED_OWNER_INVALID");
  if (!value.includes("\\") || /^(?:everyone|authenticated users|users|codexsandboxusers|s-1-1-0)$/i.test(value.split("\\").at(-1) ?? value)) {
    throw new Error("RESTRICTED_OWNER_UNSAFE");
  }
}

function mysql(statement: string) {
  return execFileSync(mysqlBin, [
    "-h", "127.0.0.1", "-N", "-B", "-uroot", dbName, "-e", statement,
  ], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, MYSQL_PWD: dbPassword },
  }).trim();
}

function deleteExactDatabaseActor(accountIdValue: string, username: string) {
  const accountId = exactId(accountIdValue);
  validateUsername(username);
  mysql(`DELETE FROM nx_admin_role_relation WHERE admin_id=${accountId}; DELETE FROM nx_admin_account_state WHERE admin_id=${accountId}; DELETE FROM nx_admin WHERE id=${accountId} AND username='${username}';`);
}

function databaseResidual(accountIdValue: string, username: string) {
  const accountId = exactId(accountIdValue);
  validateUsername(username);
  return Number(mysql(`SELECT (SELECT COUNT(*) FROM nx_admin WHERE id=${accountId} OR username='${username}') + (SELECT COUNT(*) FROM nx_admin_account_state WHERE admin_id=${accountId}) + (SELECT COUNT(*) FROM nx_admin_role_relation WHERE admin_id=${accountId});`));
}

function databaseAccountIdByUsername(username: string) {
  validateUsername(username);
  const value = mysql(`SELECT id FROM nx_admin WHERE username='${username}' AND is_deleted=0 LIMIT 1;`);
  return value ? exactId(value) : undefined;
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
  for (const file of [aManifestPath, k4ManifestPath]) {
    if (!existsSync(file)) continue;
    unlinkSync(file);
    discarded.push(path.basename(file));
  }
  return discarded;
}

function restrictDirectoryAcl(directory: string) {
  if (process.platform !== "win32") throw new Error("WINDOWS_ACL_REQUIRED");
  const currentPrincipal = execFileSync("whoami.exe", [], { encoding: "utf8", windowsHide: true }).trim();
  validateWindowsPrincipal(currentPrincipal);
  const principals = [...new Set([restrictedOwner, currentPrincipal])];
  execFileSync("icacls.exe", [
    directory,
    "/inheritance:r",
    "/grant:r",
    ...principals.map((principal) => `${principal}:(OI)(CI)(F)`),
    "*S-1-5-18:(OI)(CI)(F)",
    "*S-1-5-32-544:(OI)(CI)(F)",
  ], { encoding: "utf8", windowsHide: true });
  assertAclRestricted(directory, principals);
}

function restrictFileAcl(file: string) {
  const currentPrincipal = execFileSync("whoami.exe", [], { encoding: "utf8", windowsHide: true }).trim();
  validateWindowsPrincipal(currentPrincipal);
  const principals = [...new Set([restrictedOwner, currentPrincipal])];
  execFileSync("icacls.exe", [
    file,
    "/inheritance:r",
    "/grant:r",
    ...principals.map((principal) => `${principal}:(F)`),
    "*S-1-5-18:(F)",
    "*S-1-5-32-544:(F)",
  ], { encoding: "utf8", windowsHide: true });
  assertAclRestricted(file, principals);
}

function assertAclRestricted(target: string, principals: string[]) {
  const acl = execFileSync("icacls.exe", [target], { encoding: "utf8", windowsHide: true });
  const expected = new Set([
    ...principals,
    "BUILTIN\\Administrators",
    "NT AUTHORITY\\SYSTEM",
  ].map((principal) => principal.toLowerCase()));
  const actual = acl.split(/\r?\n/).flatMap((line) => {
    if (!line.includes(":(")) return [];
    const normalized = line.startsWith(target) ? line.slice(target.length).trim() : line.trim();
    const separator = normalized.indexOf(":(");
    return separator < 1 ? [] : [normalized.slice(0, separator).trim().toLowerCase()];
  });
  if (actual.length !== expected.size || actual.some((principal) => !expected.has(principal))) {
    throw new Error("ACL_PRINCIPAL_OUTSIDE_ALLOWLIST");
  }
  if ([...expected].some((principal) => !actual.includes(principal))) {
    throw new Error("ACL_REQUIRED_PRINCIPAL_MISSING");
  }
}

function fileSha256(file: string) {
  return createHash("sha256").update(readFileSync(file)).digest("hex").toUpperCase();
}

function safeJson(raw: string) {
  try {
    return JSON.parse(raw) as { code?: number; message?: string };
  } catch {
    return undefined;
  }
}

function pathOf(value: string) {
  return new URL(value).pathname;
}
