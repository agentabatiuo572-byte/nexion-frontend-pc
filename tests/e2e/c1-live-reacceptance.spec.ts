import { mkdir } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const EVIDENCE_DIR = process.env.C1_EVIDENCE_DIR || "D:/workspace/bug-pic/c1-reacceptance-20260718/main";

type Envelope<T> = { code: number; message?: string; data: T };
type UserListRow = Record<string, unknown> & { userNo?: string; nickname?: string; phoneMasked?: string };
type UserPage = { total: number; pageNum: number; pageSize: number; records: UserListRow[] };

test("C1 real flow keeps search read-only, masked, auditable and return-context safe", async ({ page }) => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });

  const anonymous = await page.request.get("/api/admin/users/profiles?pageNum=1&pageSize=50");
  expect(anonymous.status()).toBe(401);

  await loginThroughUi(page);

  const listResponse = await page.request.get("/api/admin/users/profiles?pageNum=1&pageSize=50");
  expect(listResponse.ok()).toBeTruthy();
  const list = await envelope<UserPage>(listResponse);
  expect(list.pageSize).toBe(50);
  expect(list.records.length).toBeGreaterThan(0);
  for (const row of list.records) {
    expect(row).not.toHaveProperty("id");
    if (row.phoneMasked) {
      expect(row.phoneMasked).toMatch(/^.{3}\*{4}.{4}$/);
      expect(row.phoneMasked).not.toMatch(/^[0-9]{6,15}$/);
    }
  }

  for (const pageSize of [20, 50, 100, 200]) {
    const response = await page.request.get(`/api/admin/users/profiles?pageNum=1&pageSize=${pageSize}`);
    expect(response.ok()).toBeTruthy();
    expect((await envelope<UserPage>(response)).pageSize).toBe(pageSize);
  }
  const multiDimension = await page.request.get(
    "/api/admin/users/profiles?phoneHash=" + "a".repeat(64)
      + "&tier=L0&vRank=V0&referralCode=C1_NOT_FOUND"
      + "&depositMin=0&depositMax=999999999"
      + "&walletUsdtMin=0&walletUsdtMax=999999999"
      + "&walletNexMin=0&walletNexMax=999999999"
      + "&riskBand=LOW&joinedFrom=2000-01-01&joinedTo=2099-12-31&pageNum=1&pageSize=20",
  );
  expect(multiDimension.ok()).toBeTruthy();
  expect((await envelope<UserPage>(multiDimension)).records).toEqual([]);

  const firstUser = list.records.find((row) => typeof row.userNo === "string" && row.userNo.length > 0);
  expect(firstUser?.userNo).toBeTruthy();
  const userNo = firstUser!.userNo!;

  const rawPhone = "13800138000";
  const rawPhoneResponse = await page.request.get(`/api/admin/users/profiles?keyword=${rawPhone}`);
  expect(rawPhoneResponse.status()).toBe(422);
  expect((await rawPhoneResponse.json()).message).toBe("C1_RAW_PHONE_SEARCH_FORBIDDEN");

  const detailResponse = await page.request.get(`/api/admin/users/profiles/${encodeURIComponent(userNo)}/360`);
  expect(detailResponse.ok()).toBeTruthy();
  const detail = await envelope<Record<string, unknown>>(detailResponse);
  expect(JSON.stringify(detail)).not.toContain("refreshTokenId");
  expect(JSON.stringify(detail)).not.toMatch(/\"userId\"\s*:\s*\d+[^}]*\"deviceName\"/);

  const removedLegacyProfile = await page.request.get(`/api/admin/users/profiles/${encodeURIComponent(userNo)}`);
  expect(removedLegacyProfile.status()).toBe(404);
  const removedLegacySecurity = await page.request.get(`/api/admin/users/profiles/${encodeURIComponent(userNo)}/security`);
  expect(removedLegacySecurity.status()).toBe(404);

  const missing = await page.request.get("/api/admin/users/profiles/C1-NOT-EXIST-999999/360");
  expect(missing.status()).toBe(404);

  const exportKey = `c1-live-${Date.now()}`;
  const exportRequest = {
    method: "POST" as const,
    headers: { "Idempotency-Key": exportKey },
    data: { operator: USERNAME },
  };
  const exportOne = await page.request.fetch("/api/admin/users/profiles/export", exportRequest);
  const exportTwo = await page.request.fetch("/api/admin/users/profiles/export", exportRequest);
  expect(exportOne.ok()).toBeTruthy();
  expect(exportTwo.ok()).toBeTruthy();
  expect(exportOne.headers()["content-type"]).toContain("text/csv");
  const exportOneBody = await exportOne.body();
  const exportTwoBody = await exportTwo.body();
  expect(exportOneBody.equals(exportTwoBody)).toBeTruthy();
  const csv = exportOneBody.toString("utf8");
  expect(csv).toContain("手机号(脱敏)");
  expect(csv).not.toContain(rawPhone);

  const pageErrors: string[] = [];
  const leakedRequests: string[] = [];
  let watchRawPhone = false;
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (watchRawPhone && request.url().includes(rawPhone)) leakedRequests.push(request.url());
  });

  await page.goto(`/users/search?q=${encodeURIComponent(userNo)}&pageSize=20`);
  await expect(page.getByText("检索 & 画像", { exact: true }).first()).toBeVisible();
  await expect(page.locator("tbody tr").filter({ hasText: userNo }).first()).toBeVisible();
  let uiExportRequests = 0;
  let uiDownloads = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/admin/users/profiles/export")) uiExportRequests += 1;
  });
  page.on("download", () => { uiDownloads += 1; });
  const uiDownload = page.waitForEvent("download");
  const exportButton = page.getByRole("button", { name: "导出脱敏 CSV", exact: true });
  await exportButton.evaluate((button) => {
    (button as HTMLButtonElement).click();
    window.setTimeout(() => (button as HTMLButtonElement).click(), 50);
  });
  await uiDownload;
  await page.waitForTimeout(1_100);
  expect(uiExportRequests).toBe(1);
  expect(uiDownloads).toBe(1);
  await page.screenshot({ path: `${EVIDENCE_DIR}/01-search-result.png`, fullPage: true });

  const keyword = page.getByPlaceholder("用户编码 / 昵称 / 推荐码 / 脱敏手机号 / 手机哈希");
  watchRawPhone = true;
  await keyword.fill(rawPhone);
  await expect(page.getByText("为保护用户隐私，不支持按原始手机号检索；请使用脱敏手机号或手机号哈希", { exact: true })).toBeVisible();
  expect(page.url()).not.toContain(rawPhone);
  expect(leakedRequests).toEqual([]);
  await page.screenshot({ path: `${EVIDENCE_DIR}/02-raw-phone-rejected.png`, fullPage: true });

  watchRawPhone = false;
  await keyword.fill(userNo);
  const row = page.locator("tbody tr").filter({ hasText: userNo }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(/\/users\/search\/[^?]+\?returnTo=/);
  await expect(page.getByText(`用户编码 ${userNo}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "去 C2 账户操作" })).toBeVisible();
  await expect(page.getByRole("link", { name: "去 C5 安全会话" })).toBeVisible();
  await expect(page.getByRole("button", { name: /冻结|解冻|重置密码|重置 2FA/ })).toHaveCount(0);
  await page.screenshot({ path: `${EVIDENCE_DIR}/03-profile-readonly-links.png`, fullPage: true });

  await page.getByRole("link", { name: "返回检索" }).click();
  await expect(page).toHaveURL(new RegExp(`/users/search\\?q=${escapeRegex(userNo)}&pageSize=20$`));
  await expect(keyword).toHaveValue(userNo);
  await expect(page.locator("tbody tr").filter({ hasText: userNo }).first()).toBeVisible();
  expect(pageErrors).toEqual([]);
});

async function loginThroughUi(page: Page) {
  await page.goto("/users/search");
  const username = page.locator('input[autocomplete="username"]');
  if (await username.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await username.fill(USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    await page.getByRole("button", { name: /登录|继续/ }).click();
  }
  await expect(page.getByText("检索 & 画像", { exact: true }).first()).toBeVisible();
}

async function envelope<T>(response: { json(): Promise<unknown> }) {
  const body = await response.json() as Envelope<T>;
  expect(body.code).toBe(0);
  return body.data;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
