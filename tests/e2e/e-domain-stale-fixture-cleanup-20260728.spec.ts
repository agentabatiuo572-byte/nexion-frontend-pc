import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

type ApiEnvelope<T = unknown> = { code?: number; message?: string; data?: T };
type Account = { username: string; password: string; totpSecret: string };

const RUN_ID = "pc-full-acceptance-20260728-151023";
const BASE_URL = process.env.BASE_URL || "http://127.0.0.1:3002";
const OLD_ACCOUNT_IDS = ["99383", "99384", "99385"];
const OLD_ROLE_ID = "4050";
const OLD_ROLE_CODE = "ACC_E_RO_R151023_E4F9C";
const KNOWN_DELETE_OPERATION_ID = "WO-260728172754278-0";
const A_FIXTURE =
  process.env.A_PERMISSION_FIXTURE
  || `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/permission-fixtures.json`;
const EVIDENCE_DIR =
  process.env.E_STALE_CLEANUP_EVIDENCE_DIR
  || `D:/workspace/bug-pic/.restricted/${RUN_ID}/E/stale-fixture-cleanup`;
const checker = (JSON.parse(readFileSync(A_FIXTURE, "utf8")) as {
  accounts: { d_checker: Account };
}).accounts.d_checker;

test("精确清理 E 域中断账号与旧角色，不触碰当前交付夹具", async ({ page, browser }) => {
  test.setTimeout(120_000);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  await loginSuperadmin(page);

  const accountResults: Array<Record<string, unknown>> = [];
  for (const accountId of OLD_ACCOUNT_IDS) {
    let current = await getAccount(page, accountId);
    if (current.tfa === true) {
      await mutateAccount(page, accountId, "POST", "reset-2fa", {
        reason: `${RUN_ID} 清理 E 域中断夹具 MFA`,
        operator: "superadmin",
      }, `${RUN_ID}-e-stale-${accountId}-mfa`);
    }
    current = await getAccount(page, accountId);
    if (current.role !== "unassigned") {
      await mutateAccount(page, accountId, "PATCH", "role", {
        role: "unassigned",
        reason: `${RUN_ID} 解除 E 域中断夹具角色`,
        operator: "superadmin",
      }, `${RUN_ID}-e-stale-${accountId}-role`);
    }
    current = await getAccount(page, accountId);
    if (current.status !== "disabled") {
      await mutateAccount(page, accountId, "PATCH", "status", {
        status: "disabled",
        reason: `${RUN_ID} 停用 E 域中断夹具`,
        operator: "superadmin",
      }, `${RUN_ID}-e-stale-${accountId}-status`);
    }
    current = await getAccount(page, accountId);
    if (Number(current.sessions) > 0) {
      await mutateAccount(page, accountId, "POST", "sessions/revoke", {
        reason: `${RUN_ID} 撤销 E 域中断夹具会话`,
        operator: "superadmin",
      }, `${RUN_ID}-e-stale-${accountId}-sessions`);
    }
    const after = await getAccount(page, accountId);
    expect(after).toMatchObject({ role: "unassigned", tfa: false, status: "disabled", sessions: 0 });
    accountResults.push({
      accountId,
      username: after.username,
      role: after.role,
      tfa: after.tfa,
      status: after.status,
      sessions: after.sessions,
    });
  }

  const roles = await ok<{ roles: Array<Record<string, unknown>> }>(
    await page.request.get("/api/admin/platform/roles/overview"),
  );
  const staleRole = roles.roles.find((role) =>
    String(role.id) === OLD_ROLE_ID && String(role.roleCode) === OLD_ROLE_CODE);
  let operationId = "";
  if (staleRole) {
    const proposal = await ok<Record<string, unknown>>(
      await page.request.delete(`/api/admin/platform/roles/${OLD_ROLE_ID}`, {
        headers: { "Idempotency-Key": `${RUN_ID}-e-stale-role-delete` },
        data: {
          reason: `${RUN_ID} 删除已解绑的 E 域中断角色`,
          operator: "superadmin",
        },
      }),
    );
    operationId = String(proposal.operationId ?? proposal.id ?? "");
    expect(operationId).toMatch(/^(?:WO|OP)-/);

    const checkerContext = await browser.newContext({ baseURL: BASE_URL });
    const checkerPage = await checkerContext.newPage();
    try {
      await loginWithMfa(checkerPage, checker);
      await ok(await checkerPage.request.post(`/api/admin/platform/audit/operations/${operationId}/approve`, {
        headers: { "Idempotency-Key": `${RUN_ID}-e-stale-role-approve` },
        data: { reason: `${RUN_ID} checker 独立复核 E 域中断角色删除` },
      }));
    } finally {
      await checkerContext.close();
    }
  }

  const rolesAfter = await ok<{ roles: Array<Record<string, unknown>> }>(
    await page.request.get("/api/admin/platform/roles/overview"),
  );
  expect(rolesAfter.roles.some((role) => String(role.roleCode) === OLD_ROLE_CODE)).toBe(false);
  const audit = await ok<{ operationQueue?: Array<Record<string, unknown>>; operationHistory?: Array<Record<string, unknown>> }>(
    await page.request.get("/api/admin/platform/audit/overview"),
  );
  expect((audit.operationQueue ?? []).some((row) =>
    row.status === "pending" && String(row.obj).includes(OLD_ROLE_CODE))).toBe(false);
  operationId = operationId || KNOWN_DELETE_OPERATION_ID;
  const approvedHistory = (audit.operationHistory ?? []).find((row) =>
    String(row.id) === operationId && String(row.status ?? row.st) === "approved");
  expect(approvedHistory).toBeTruthy();
  expect(operationId).toMatch(/^(?:WO|OP)-/);

  writeFileSync(path.join(EVIDENCE_DIR, "result.json"), JSON.stringify({
    runId: RUN_ID,
    accountResults,
    deletedRole: { id: OLD_ROLE_ID, roleCode: OLD_ROLE_CODE, operationId, status: "approved" },
    currentDeliveryFixtureUntouched: ["99393", "99394", "99395", "4051"],
  }, null, 2));
});

async function getAccount(page: Page, accountId: string) {
  const overview = await ok<{ operators: Array<Record<string, unknown>> }>(
    await page.request.get("/api/admin/platform/accounts/overview"),
  );
  const account = overview.operators.find((operator) => String(operator.id) === accountId);
  expect(account, `account ${accountId} must exist`).toBeTruthy();
  return account!;
}

async function mutateAccount<T>(
  page: Page,
  accountId: string,
  method: "PATCH" | "POST",
  suffix: string,
  data: Record<string, unknown>,
  idempotencyKey: string,
) {
  const current = await getAccount(page, accountId);
  const expectedVersion = String(current.version ?? "");
  expect(expectedVersion).not.toBe("");
  return ok<T>(await page.request.fetch(`/api/admin/platform/accounts/${accountId}/${suffix}`, {
    method,
    headers: { "Idempotency-Key": idempotencyKey },
    data: { ...data, expectedVersion },
  }));
}

async function loginSuperadmin(page: Page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill("superadmin");
  await page.locator('input[autocomplete="current-password"]').fill((process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })()));
  await page.getByRole("button", { name: /登录|继续/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function loginWithMfa(page: Page, account: Account) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible();
  await otp.fill(await freshTotp(account.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function ok<T>(response: { status(): number; text(): Promise<string> }) {
  const raw = await response.text();
  expect(response.status(), raw).toBeLessThan(400);
  const payload = JSON.parse(raw) as ApiEnvelope<T>;
  expect(payload.code ?? 0, raw).toBe(0);
  return payload.data as T;
}

let lastTotpStep = -1;

async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  if (step <= lastTotpStep) {
    await new Promise((resolve) => setTimeout(resolve, ((lastTotpStep + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep = step;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}
