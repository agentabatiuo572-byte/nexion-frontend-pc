import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

const RUN_ID = process.env.K_PERMISSION_RUN_ID ?? "pc-full-acceptance-20260728-151023";
const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3002";
const ROOT_USERNAME = process.env.ADMIN_E2E_USERNAME ?? "superadmin";
const ROOT_PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "";
const FIXTURE_PATH = process.env.K_PERMISSION_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/K/permission-fixtures.json`;
const CHECKER_FIXTURE_PATH = process.env.K_PERMISSION_CHECKER_FIXTURE
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/permission-fixtures.json`;

type ApiEnvelope<T> = { code?: number; message?: string; data?: T };
type Account = {
  accountId: string;
  username: string;
  password: string;
};
type Fixture = {
  accounts: Record<string, Account>;
  roles: Array<{ id: number; roleCode: string }>;
};
type CheckerFixture = {
  accounts: { d_checker: { username: string; password: string; totpSecret: string } };
};

test.describe.configure({ mode: "serial", timeout: 300_000 });

test("K 域权限夹具精确清理并由独立 checker 批准角色删除", async ({ page, browser }) => {
  expect(ROOT_PASSWORD, "ADMIN_E2E_PASSWORD is required").not.toBe("");
  const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
  const checker = (JSON.parse(readFileSync(CHECKER_FIXTURE_PATH, "utf8")) as CheckerFixture).accounts.d_checker;

  await loginRoot(page);
  for (const account of Object.values(fixture.accounts)) {
    await sanitizeAccount(page, account);
  }

  const checkerContext = await browser.newContext({ baseURL: BASE_URL });
  const checkerPage = await checkerContext.newPage();
  try {
    await loginChecker(checkerPage, checker);
    for (const role of fixture.roles) {
      const overview = await okEnvelope<{ roles: Array<{ id: number; roleCode: string }> }>(
        await page.request.get("/api/admin/platform/roles/overview"),
      );
      const current = overview.roles.find((candidate) => candidate.id === role.id
        || candidate.roleCode === role.roleCode);
      if (!current) continue;
      const proposal = await okEnvelope<Record<string, unknown>>(
        await page.request.delete(`/api/admin/platform/roles/${current.id}`, {
          headers: { "Idempotency-Key": `${RUN_ID}-cleanup-role-${current.id}` },
          data: {
            reason: `${RUN_ID} K 域验收完成后删除隔离角色`,
            operator: ROOT_USERNAME,
          },
        }),
      );
      const ticketId = String(proposal.operationId ?? proposal.id ?? "");
      expect(ticketId).toMatch(/^(?:WO|OP)-/);
      await okEnvelope(await checkerPage.request.post(
        `/api/admin/platform/audit/operations/${ticketId}/approve`,
        {
          headers: { "Idempotency-Key": `${RUN_ID}-cleanup-role-${current.id}-approve` },
          data: { reason: `${RUN_ID} 独立复核删除 K 域隔离角色` },
        },
      ));
    }
  } finally {
    await checkerContext.close();
  }

  const accounts = await accountsOverview(page);
  for (const account of Object.values(fixture.accounts)) {
    const current = accounts.find((candidate) => String(candidate.id) === account.accountId);
    expect(current).toMatchObject({
      role: "unassigned",
      status: "disabled",
      tfa: false,
      sessions: 0,
    });
    const disabledLogin = await page.request.post("/api/admin/auth/login", {
      data: { username: account.username, password: account.password },
    });
    expect([401, 403]).toContain(disabledLogin.status());
  }
  const finalRoles = await okEnvelope<{ roles: Array<{ roleCode: string }> }>(
    await page.request.get("/api/admin/platform/roles/overview"),
  );
  for (const role of fixture.roles) {
    expect(finalRoles.roles.some((candidate) => candidate.roleCode === role.roleCode)).toBe(false);
  }
  const audit = await okEnvelope<{ operationQueue: Array<{ status: string; obj: string }> }>(
    await page.request.get("/api/admin/platform/audit/overview?limit=200"),
  );
  expect(audit.operationQueue.some((ticket) =>
    ticket.status === "pending"
    && fixture.roles.some((role) => ticket.obj.includes(role.roleCode)))).toBe(false);
});

async function loginRoot(page: Page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(ROOT_USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(ROOT_PASSWORD);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function loginChecker(
  page: Page,
  checker: { username: string; password: string; totpSecret: string },
) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(checker.username);
  await page.locator('input[autocomplete="current-password"]').fill(checker.password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 15_000 });
  await otp.fill(await freshTotp(checker.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function sanitizeAccount(page: Page, account: Account) {
  let current = await accountById(page, account.accountId);
  if (current.tfa === true) {
    await mutateAccount(page, account.accountId, "POST", "reset-2fa", {
      reason: `${RUN_ID} 清除 K 域隔离账号 MFA`,
    });
  }
  current = await accountById(page, account.accountId);
  if (current.role !== "unassigned") {
    await mutateAccount(page, account.accountId, "PATCH", "role", {
      role: "unassigned",
      reason: `${RUN_ID} 解除 K 域隔离账号角色`,
    });
  }
  current = await accountById(page, account.accountId);
  if (current.status !== "disabled") {
    await mutateAccount(page, account.accountId, "PATCH", "status", {
      status: "disabled",
      reason: `${RUN_ID} 停用 K 域隔离账号`,
    });
  }
  current = await accountById(page, account.accountId);
  if (Number(current.sessions) > 0) {
    await mutateAccount(page, account.accountId, "POST", "sessions/revoke", {
      reason: `${RUN_ID} 撤销 K 域隔离账号会话`,
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
    headers: { "Idempotency-Key": `${RUN_ID}-cleanup-${accountId}-${suffix}` },
    data: {
      ...data,
      operator: ROOT_USERNAME,
      expectedVersion: String(current.version),
    },
  }));
}

async function accountById(page: Page, accountId: string) {
  const account = (await accountsOverview(page)).find((candidate) => String(candidate.id) === accountId);
  expect(account, `K fixture account ${accountId} must exist`).toBeTruthy();
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

let lastTotpStep = -1;

async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  if (step <= lastTotpStep) {
    await new Promise((resolve) =>
      setTimeout(resolve, ((lastTotpStep + 1) * 30_000) - Date.now() + 500));
  }
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep = step;
  return currentTotp(secret, step);
}

function currentTotp(secret: string, step: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", Buffer.from(bytes)).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}
