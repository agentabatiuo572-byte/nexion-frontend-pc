import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const fixturePath = required("A_MFA_RECOVERY_FIXTURE_PATH");
const evidencePath = required("A_MFA_RECOVERY_EVIDENCE_PATH");
const runId = required("A_MFA_RECOVERY_RUN_ID");
const recoveryOperator = {
  username: required("A_MFA_RECOVERY_OPERATOR_USERNAME"),
  password: required("A_MFA_RECOVERY_OPERATOR_PASSWORD"),
  totpSecret: process.env.A_MFA_RECOVERY_OPERATOR_TOTP_SECRET?.trim() ?? "",
};
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;

type Account = {
  accountId: string;
  username: string;
  password: string;
  totpSecret: string;
  role: string;
  authorities: string[];
  effectiveMenus: string[];
};
type Fixture = { runId: string; checker: Pick<Account, "username" | "password" | "totpSecret">; accounts: { maker: Account } } & Record<string, unknown>;
type Operator = { id: string; username: string; role: string; status: string; tfa: boolean; sessions: number; version: string };

test.describe.configure({ mode: "serial", timeout: 300_000 });

test("A maker MFA drift recovery preserves account role, grants and menus", async ({ page }) => {
  const maker = fixture.accounts.maker;
  const expectedAuthorities = [...maker.authorities].sort();
  const expectedMenus = [...maker.effectiveMenus].sort();
  const reason = `${runId} A maker MFA drift recovery`;
  const evidence: Record<string, unknown> = { runId, accountId: maker.accountId, username: maker.username, writes: [] };

  try {
    await login(page, recoveryOperator);
    await openA1(page);
    await assertRecoveryAuthority(page);

    const initial = await accountById(page, maker.accountId);
    evidence.initial = publicOperator(initial);
    expect(initial.username).toBe(maker.username);
    expect(initial.status.toLowerCase()).toBe("enabled");
    expect(initial.role.toLowerCase()).toBe(maker.role.toLowerCase());

    let current = initial;
    if (current.tfa) {
      const reset = await mutation(page, maker.accountId, "reset-2fa", {
        reason,
        operator: recoveryOperator.username,
        expectedVersion: current.version,
      }, `${runId}:a-maker:reset-2fa:v${current.version}`);
      expect(reset.status).toBe(200);
      (evidence.writes as unknown[]).push({ action: "reset-2fa", status: reset.status });
      current = await accountById(page, maker.accountId);
      expect(current.role.toLowerCase()).toBe(maker.role.toLowerCase());
      expect(current.status.toLowerCase()).toBe("enabled");
    }

    const passwordReset = await mutation(page, maker.accountId, "password/reset", {
      reason,
      operator: recoveryOperator.username,
      expectedVersion: current.version,
    }, `${runId}:a-maker:password-reset:v${current.version}`);
    expect(passwordReset.status).toBe(200);
    const passwordPayload = passwordReset.body as { data?: { temporaryPassword?: string } };
    const temporaryPassword = passwordPayload.data?.temporaryPassword;
    expect(temporaryPassword, "password reset must return one-time credential").toBeTruthy();
    (evidence.writes as unknown[]).push({ action: "password-reset", status: passwordReset.status });

    const afterMutation = await accountById(page, maker.accountId);
    evidence.afterMutation = publicOperator(afterMutation);
    expect(afterMutation.role.toLowerCase()).toBe(maker.role.toLowerCase());
    expect(afterMutation.status.toLowerCase()).toBe("enabled");

    const finalPassword = `Nx!9AMaker${randomBytes(16).toString("base64url")}Aa`;
    await logout(page);
    const enrolledSecret = await activateFirstLogin(page, maker.username, temporaryPassword!, finalPassword);
    const enrolledSession = await session(page);
    assertSession(enrolledSession, maker.username, expectedAuthorities, expectedMenus);
    await logout(page);

    await login(page, { username: maker.username, password: finalPassword, totpSecret: enrolledSecret });
    const finalSession = await session(page);
    assertSession(finalSession, maker.username, expectedAuthorities, expectedMenus);
    const finalAccount = await accountById(page, maker.accountId);
    expect(finalAccount.role.toLowerCase()).toBe(maker.role.toLowerCase());
    expect(finalAccount.status.toLowerCase()).toBe("enabled");

    fixture.accounts.maker.password = finalPassword;
    fixture.accounts.maker.totpSecret = enrolledSecret;
    (fixture as Record<string, unknown>).mfaRecoveredAt = new Date().toISOString();
    atomicWriteFixture(fixturePath, fixture);

    evidence.final = {
      account: publicOperator(finalAccount),
      authorityCount: expectedAuthorities.length,
      menuCount: expectedMenus.length,
      passwordSha256: createHash("sha256").update(finalPassword).digest("hex"),
      totpSecretSha256: createHash("sha256").update(enrolledSecret).digest("hex"),
      finalMfaLogin: true,
      fixtureAtomicallyUpdated: true,
    };
    writeEvidence(evidence);
    await logout(page);
  } catch (error) {
    evidence.error = error instanceof Error ? error.message : String(error);
    try {
      if (await page.locator("aside").isVisible({ timeout: 1_000 }).catch(() => false)) {
        const current = await accountById(page, maker.accountId);
        evidence.finallyAccount = publicOperator(current);
      }
    } catch (captureError) {
      evidence.finallyCaptureError = captureError instanceof Error ? captureError.message : String(captureError);
    }
    writeEvidence(evidence);
    throw error;
  }
});

async function openA1(page: Page) {
  const group = page.getByRole("button", { name: /平台基础/ });
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  const entry = page.locator('aside a[href="/platform/rbac"]');
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page.getByRole("heading", { name: /运营账号|账号/ }).first()).toBeVisible();
}

async function assertRecoveryAuthority(page: Page) {
  const current = await session(page);
  const authorities = Array.isArray(current.authorities) ? current.authorities.map(String) : [];
  for (const authority of ["platform_a1_read", "platform_a1_account_2fa_reset", "platform_a1_account_password_reset"]) {
    expect(authorities, `recovery operator requires ${authority}`).toContain(authority);
  }
}

async function accountById(page: Page, accountId: string): Promise<Operator> {
  const response = await page.request.get("/api/admin/platform/accounts/overview");
  expect(response.status()).toBe(200);
  const body = await response.json() as { code?: number; data?: { operators?: Operator[] } };
  expect(body.code).toBe(0);
  const found = body.data?.operators?.find((operator) => String(operator.id) === accountId);
  expect(found, `account ${accountId} must be present`).toBeTruthy();
  return found!;
}

async function mutation(page: Page, accountId: string, suffix: "reset-2fa" | "password/reset", data: Record<string, unknown>, key: string) {
  const response = await page.request.post(`/api/admin/platform/accounts/${encodeURIComponent(accountId)}/${suffix}`, {
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    data,
  });
  return { status: response.status(), body: await response.json().catch(() => null) };
}

async function activateFirstLogin(page: Page, username: string, temporaryPassword: string, finalPassword: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[autocomplete="current-password"]').fill(temporaryPassword);
  const loginResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/auth/login" && response.request().method() === "POST");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const payload = await (await loginResponse).json() as { data?: { mfa?: { manualKey?: string } } };
  const secret = payload.data?.mfa?.manualKey?.trim();
  expect(secret, "fresh MFA enrollment must issue a manual key").toBeTruthy();

  let passwordChanged = false;
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (await page.locator("aside").isVisible({ timeout: 250 }).catch(() => false)) break;
    if (!passwordChanged && await page.getByRole("heading", { name: "首次登录修改密码" }).isVisible({ timeout: 250 }).catch(() => false)) {
      await page.getByLabel("新密码", { exact: true }).fill(finalPassword);
      await page.getByLabel("确认新密码", { exact: true }).fill(finalPassword);
      await page.getByRole("button", { name: "确认修改并进入", exact: true }).click();
      passwordChanged = true;
    }
    const otp = page.getByLabel("一次性验证码");
    if (await otp.isVisible({ timeout: 250 }).catch(() => false)) {
      await otp.fill(await freshTotp(secret!));
      const verified = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/auth/mfa/verify" && response.request().method() === "POST");
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
      await verified;
    }
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
  expect(passwordChanged, "must complete first-login password change").toBe(true);
  return secret!;
}

async function login(page: Page, account: Pick<Account, "username" | "password"> & { totpSecret?: string }) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  const response = page.waitForResponse((candidate) => new URL(candidate.url()).pathname === "/api/admin/auth/login" && candidate.request().method() === "POST");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  expect((await response).status()).toBe(200);
  const shell = page.locator("aside");
  const otp = page.getByLabel("一次性验证码");
  await Promise.race([
    shell.waitFor({ state: "visible", timeout: 15_000 }),
    otp.waitFor({ state: "visible", timeout: 15_000 }),
  ]);
  if (!(await shell.isVisible())) {
    if (!account.totpSecret) throw new Error(`${account.username} requires MFA but no recovery operator TOTP secret was supplied`);
    await otp.fill(await freshTotp(account.totpSecret));
    const verified = page.waitForResponse((candidate) => new URL(candidate.url()).pathname === "/api/admin/auth/mfa/verify" && candidate.request().method() === "POST");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    expect((await verified).status()).toBe(200);
  }
  await expect(shell).toBeVisible({ timeout: 30_000 });
}

async function logout(page: Page) {
  if (!(await page.locator("aside").isVisible({ timeout: 1_000 }).catch(() => false))) return;
  await page.locator('header button[aria-haspopup="menu"]').last().click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

async function session(page: Page): Promise<Record<string, unknown>> {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const payload = await response.json() as { code?: number; data?: { session?: Record<string, unknown> } };
  expect(payload.code).toBe(0);
  return payload.data?.session ?? {};
}

function assertSession(value: Record<string, unknown>, username: string, expectedAuthorities: string[], expectedMenus: string[]) {
  expect(value.username).toBe(username);
  const authorities = Array.isArray(value.authorities) ? value.authorities.map(String).sort() : [];
  const rawMenus = Array.isArray(value.menuCodes) ? value.menuCodes : Array.isArray(value.effectiveMenus) ? value.effectiveMenus : [];
  const menus = rawMenus.map((menu) => typeof menu === "string" ? menu : String((menu as { menuCode?: unknown }).menuCode ?? "")).filter(Boolean).sort();
  expect(authorities).toEqual(expectedAuthorities);
  expect(menus).toEqual(expectedMenus);
}

const usedTotpStep = new Map<string, number>();
async function freshTotp(secret: string) {
  const current = Math.floor(Date.now() / 30_000);
  const prior = usedTotpStep.get(secret) ?? -1;
  const remaining = 30_000 - (Date.now() % 30_000);
  if (current <= prior || remaining <= 5_000) await new Promise((resolve) => setTimeout(resolve, Math.max(600, remaining + 600)));
  const step = Math.floor(Date.now() / 30_000);
  usedTotpStep.set(secret, step);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(value % 1_000_000).padStart(6, "0");
}

function publicOperator(operator: Operator) {
  return { id: operator.id, username: operator.username, role: operator.role, status: operator.status, tfa: operator.tfa, sessions: operator.sessions, version: operator.version };
}

function atomicWriteFixture(path: string, value: unknown) {
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, path);
}
function writeEvidence(value: Record<string, unknown>) { writeFileSync(evidencePath, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
function required(name: string) { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is required`); return value; }
