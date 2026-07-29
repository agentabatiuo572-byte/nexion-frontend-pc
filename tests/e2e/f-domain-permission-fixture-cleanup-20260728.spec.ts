import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const RUN_ID = "pc-full-acceptance-20260728-151023";
const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const ROOT_USERNAME = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const ROOT_PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "";
const FIXTURE_PATH = process.env.F_PERMISSION_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/F/permission-fixtures.json`;
const EVIDENCE_DIR =
  `D:/workspace/bug-pic/.restricted/${RUN_ID}/F/non-owner-E/permission-cleanup`;

type ApiEnvelope<T> = { code?: number; message?: string; data?: T };
type Account = { id: string; username: string; password: string };
type Fixture = { accounts: Record<string, Account> };

test.describe.configure({ mode: "serial", timeout: 180_000 });

test("F 域四个权限夹具按最新 CAS 清除 MFA、角色、会话并停用", async ({ page }) => {
  expect(ROOT_PASSWORD, "ADMIN_E2E_PASSWORD is required").not.toBe("");
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
  const accounts = Object.values(fixture.accounts);

  await loginRoot(page);
  for (const account of accounts) {
    await sanitizeAccount(page, account);
  }

  const currentAccounts = await accountsOverview(page);
  const finalAccounts = accounts.map((account) => {
    const current = currentAccounts.find((candidate) => String(candidate.id) === account.id);
    expect(current).toMatchObject({
      role: "unassigned",
      status: "disabled",
      tfa: false,
      sessions: 0,
    });
    return {
      accountId: account.id,
      username: account.username,
      role: current?.role,
      status: current?.status,
      tfa: current?.tfa,
      sessions: current?.sessions,
    };
  });

  for (const account of accounts) {
    const disabledLogin = await page.request.post("/api/admin/auth/login", {
      data: { username: account.username, password: account.password },
    });
    expect([401, 403]).toContain(disabledLogin.status());
  }

  writeFileSync(path.join(EVIDENCE_DIR, "result.json"), JSON.stringify({
    runId: RUN_ID,
    finalAccounts,
    activeAccounts: 0,
    boundRoles: 0,
    mfaBindings: 0,
    sessions: 0,
  }, null, 2));
});

async function loginRoot(page: Page) {
  await page.context().clearCookies();
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(ROOT_USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(ROOT_PASSWORD);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function sanitizeAccount(page: Page, account: Account) {
  let current = await accountById(page, account.id);
  if (current.tfa === true) {
    await mutateAccount(page, account.id, "POST", "reset-2fa", {
      reason: `${RUN_ID} 清除 F 域隔离账号 MFA`,
    });
  }
  current = await accountById(page, account.id);
  if (current.role !== "unassigned") {
    await mutateAccount(page, account.id, "PATCH", "role", {
      role: "unassigned",
      reason: `${RUN_ID} 解除 F 域隔离账号角色`,
    });
  }
  current = await accountById(page, account.id);
  if (current.status !== "disabled") {
    await mutateAccount(page, account.id, "PATCH", "status", {
      status: "disabled",
      reason: `${RUN_ID} 停用 F 域隔离账号`,
    });
  }
  current = await accountById(page, account.id);
  if (Number(current.sessions) > 0) {
    await mutateAccount(page, account.id, "POST", "sessions/revoke", {
      reason: `${RUN_ID} 撤销 F 域隔离账号会话`,
    });
  }
}

async function mutateAccount(
  page: Page,
  accountId: string,
  method: "PATCH" | "POST",
  suffix: string,
  data: Record<string, unknown>,
) {
  const current = await accountById(page, accountId);
  await okEnvelope(await page.request.fetch(`/api/admin/platform/accounts/${accountId}/${suffix}`, {
    method,
    headers: { "Idempotency-Key": `${RUN_ID}-cleanup-f-${accountId}-${suffix}` },
    data: {
      ...data,
      operator: ROOT_USERNAME,
      expectedVersion: String(current.version),
    },
  }));
}

async function accountById(page: Page, accountId: string) {
  const account = (await accountsOverview(page)).find((candidate) => String(candidate.id) === accountId);
  expect(account, `F fixture account ${accountId} must exist`).toBeTruthy();
  return account!;
}

async function accountsOverview(page: Page) {
  const overview = await okEnvelope<{ operators: Array<Record<string, unknown>> }>(
    await page.request.get("/api/admin/platform/accounts/overview"),
  );
  return overview.operators;
}

async function okEnvelope<T>(response: { status(): number; text(): Promise<string> }) {
  const raw = await response.text();
  expect(response.status(), raw).toBeLessThan(400);
  const payload = JSON.parse(raw) as ApiEnvelope<T>;
  expect(payload.code ?? 0, raw).toBe(0);
  return payload.data as T;
}
