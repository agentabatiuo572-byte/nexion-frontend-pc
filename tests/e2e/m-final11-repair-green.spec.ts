import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

const BASE_URL = process.env.ADMIN_BASE_URL ?? "http://127.0.0.1:3312";
const FIXTURE_PATH = process.env.M_REVIEW_L_FIXTURE_PATH;
const fixture = FIXTURE_PATH
  ? JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
      account?: FixtureAccount;
      checker?: FixtureAccount;
      accounts?: { checker?: FixtureAccount; m_checker?: FixtureAccount };
      finalAccounts?: { m_checker?: FixtureAccount };
    }
  : null;
const REVIEW_ACCOUNT = fixture?.account
  ?? fixture?.checker
  ?? fixture?.accounts?.checker
  ?? fixture?.accounts?.m_checker
  ?? fixture?.finalAccounts?.m_checker
  ?? null;
const EVIDENCE_DIR = process.env.M_FINAL11_REPAIR_EVIDENCE_DIR;
type FixtureAccount = { username: string; password: string; totpSecret: string };

test.describe.configure({ mode: "serial", timeout: 180_000 });

test.beforeAll(() => {
  const target = new URL(BASE_URL);
  expect(["localhost", "127.0.0.1", "::1"]).toContain(target.hostname);
  expect(target.port).toBe("3312");
  expect(process.env.M_REVIEW_L_MFA_BYPASS).toBe("false");
  expect(REVIEW_ACCOUNT, "M_REVIEW_L_FIXTURE_PATH is required").toBeTruthy();
});

test("M1/M2/M5 repair works in a clean Chromium without widening authority", async ({ page }) => {
  const failedM1Reads: string[] = [];
  page.on("requestfailed", (request) => {
    if (new URL(request.url()).pathname === "/api/admin/content/support-agents") {
      failedM1Reads.push(request.failure()?.errorText ?? "unknown");
    }
  });

  await login(page);

  const directM1 = await page.request.get("/api/admin/content/support-agents");
  expect(directM1.status()).toBe(200);
  const directM2 = await page.request.get("/api/admin/content/tickets/assignee-candidates");
  expect(directM2.status()).toBe(200);
  const candidateEnvelope = await directM2.json() as { data?: Array<{ adminId: number; name: string }> };
  const candidates = candidateEnvelope.data ?? [];
  expect(candidates.length).toBeGreaterThan(1);
  expect(candidates.every((candidate) => {
    const keys = Object.keys(candidate).sort();
    return keys.length === 2 && keys[0] === "adminId" && keys[1] === "name";
  })).toBe(true);
  const names = candidates.map((candidate) => String(candidate.name));
  expect(new Set(names).size).toBeLessThan(names.length);

  await openVisibleModule(page, "/service/overview");
  await expect(page.getByText("坐席数据暂不可用", { exact: false })).toHaveCount(0, { timeout: 30_000 });
  await expect(page.getByText("坐席负载", { exact: true })).toBeVisible();
  expect(failedM1Reads).toEqual([]);

  await openVisibleModule(page, "/service/tickets");
  await expect(page.locator('[data-proof="support-ticket-create"]')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('[data-proof="support-ticket-create"]')).toBeEnabled();
  const duplicateName = names.find((name, index) => names.indexOf(name) !== index);
  const sameNameCandidates = candidates.filter((candidate) => candidate.name === duplicateName);
  expect(sameNameCandidates.length).toBeGreaterThan(1);
  const selectedCandidate = sameNameCandidates[1];
  const title = `M006-SAME-NAME-${Date.now()}`;
  await page.locator('[data-proof="support-ticket-create"]').click();
  await page.locator('[data-proof="support-ticket-create-owner"]').selectOption(String(selectedCandidate.adminId));
  await page.locator('[data-proof="support-ticket-create-title"]').fill(title);
  await page.locator('[data-proof="support-ticket-create-body"]').fill("验证同名客服按稳定 adminId 创建并落到正确坐席");
  const createResponsePromise = page.waitForResponse((response) => {
    const request = response.request();
    return request.method() === "POST" && new URL(response.url()).pathname === "/api/admin/content/tickets";
  });
  await page.locator('[data-proof="support-ticket-create-save"]').click();
  const createResponse = await createResponsePromise;
  expect(createResponse.status()).toBe(200);
  const createRequestBody = createResponse.request().postDataJSON() as { assignedAdminId?: number };
  expect(createRequestBody.assignedAdminId).toBe(selectedCandidate.adminId);
  const createdEnvelope = await createResponse.json() as {
    data?: { ticket?: { ticketNo?: string; assignedAdminId?: number; assignedAdminName?: string } };
  };
  const createdTicket = createdEnvelope.data?.ticket;
  expect(createdTicket?.ticketNo).toBeTruthy();
  expect(createdTicket?.assignedAdminId).toBe(selectedCandidate.adminId);
  expect(createdTicket?.assignedAdminName).toBe(selectedCandidate.name);
  const persistedResponse = await page.request.get(`/api/admin/content/tickets/${encodeURIComponent(createdTicket!.ticketNo!)}`);
  expect(persistedResponse.status()).toBe(200);
  const persistedEnvelope = await persistedResponse.json() as {
    data?: { ticket?: { ticketNo?: string; assignedAdminId?: number; assignedAdminName?: string } };
  };
  expect(persistedEnvelope.data?.ticket?.assignedAdminId).toBe(selectedCandidate.adminId);
  expect(persistedEnvelope.data?.ticket?.assignedAdminName).toBe(selectedCandidate.name);
  if (EVIDENCE_DIR) {
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(path.join(EVIDENCE_DIR, "m006-stable-admin-id.json"), JSON.stringify({
      ticketNo: createdTicket?.ticketNo,
      selectedAdminId: selectedCandidate.adminId,
      selectedDisplayName: selectedCandidate.name,
      sameNameAdminIds: sameNameCandidates.map((candidate) => candidate.adminId),
      requestAssignedAdminId: createRequestBody.assignedAdminId,
      persistedAssignedAdminId: persistedEnvelope.data?.ticket?.assignedAdminId,
    }, null, 2));
  }

  await openVisibleModule(page, "/service/scripts");
  for (const proof of [
    "session-script-new",
    "session-tpl-new",
    "session-policy-enabled",
    "session-policy-delay",
    "session-policy-cooldown",
    "session-policy-max",
    "session-policy-audience",
  ]) {
    await expect(page.locator(`[data-proof="${proof}"]`)).toHaveCount(0);
  }
  await expect(page.locator('[data-proof^="session-cat-toggle-"]')).toHaveCount(0);
  await expect(page.locator('[data-proof^="session-script-publish-"]')).toHaveCount(0);
  await expect(page.locator('[data-proof^="session-tpl-publish-"]')).toHaveCount(0);

  const templatesBeforeResponse = await page.request.get("/api/admin/content/session-templates/overview");
  expect(templatesBeforeResponse.status()).toBe(200);
  const templatesBefore = await templatesBeforeResponse.json() as {
    data?: { categories?: Array<{ type?: string; enabled?: boolean }> };
  };
  const advisorBefore = templatesBefore.data?.categories?.find((category) => category.type === "advisor");
  expect(advisorBefore).toBeTruthy();
  const denied = await page.request.patch("/api/admin/content/session-templates/categories/advisor", {
    headers: { "Idempotency-Key": `M-FINAL11-001-${Date.now()}` },
    data: {
      enabled: advisorBefore!.enabled,
      expectedEnabled: advisorBefore!.enabled,
      reason: "M-FINAL11-001 非客服主管不得调整 M5 会话类别",
    },
  });
  expect(denied.status()).toBe(403);
  expect((await denied.json() as { message?: string }).message).toBe("M5_CONFIGURATION_MANAGEMENT_FORBIDDEN");
  const templatesAfter = await (await page.request.get("/api/admin/content/session-templates/overview")).json() as {
    data?: { categories?: Array<{ type?: string; enabled?: boolean }> };
  };
  expect(templatesAfter.data?.categories?.find((category) => category.type === "advisor")).toEqual(advisorBefore);
  if (EVIDENCE_DIR) {
    await page.screenshot({ path: path.join(EVIDENCE_DIR, "m1-m2-m5-green.png"), fullPage: true });
  }
});

async function login(page: Page) {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[autocomplete="username"]').fill(REVIEW_ACCOUNT!.username);
  await page.locator('input[autocomplete="current-password"]').fill(REVIEW_ACCOUNT!.password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 10_000 });
  await otp.fill(freshTotp(REVIEW_ACCOUNT!.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function openVisibleModule(page: Page, href: string) {
  const group = page.getByRole("button", { name: /客服中心.*M|M.*客服中心/ }).first();
  const link = page.locator(`a[href="${href}"]`).first();
  if (!await link.isVisible().catch(() => false)) {
    await expect(group).toBeVisible({ timeout: 10_000 });
    await group.click();
  }
  await expect(link).toBeVisible({ timeout: 10_000 });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href.replaceAll("/", "\\/")}(?:\\?.*)?$`));
  await expect(page.locator(".mdom")).toBeVisible({ timeout: 30_000 });
}

function freshTotp(secret: string) {
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
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}
