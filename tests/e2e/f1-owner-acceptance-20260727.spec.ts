import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const EVIDENCE_DIR = "D:/workspace/nexion-ops-console/docs/验收报告/PC全面测试-20260726/F1-evidence/initial";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("F1 首次用户从侧栏进入并核对四个业务区块与真实接口", async ({ page }) => {
  await login(page);

  const networkGroup = page.getByRole("button", { name: /分销|团队|网络/ }).first();
  if (await networkGroup.isVisible().catch(() => false)) {
    if ((await networkGroup.getAttribute("aria-expanded")) !== "true") await networkGroup.click();
    const entry = page.locator('aside a[href="/network/v-rank"]');
    await expect(entry).toBeVisible();
    await entry.click();
  } else {
    await page.goto("/network/v-rank", { waitUntil: "domcontentloaded" });
  }

  await expect(page).toHaveURL(/\/network\/v-rank$/);
  await expect(page.getByText("V-Rank 13 阶阶梯")).toBeVisible();
  await expect(page.locator(".lrow")).toHaveCount(13);

  const observations = {
    ladder: await page.getByText("V-Rank 13 阶阶梯").isVisible(),
    promotionFlow: await page.locator('section[aria-label="晋升流水"]').isVisible().catch(() => false),
    rewardConfig: await page.getByRole("button", { name: /加奖励/ }).first().isVisible().catch(() => false),
    payoutFlow: await page.locator('section[aria-label="奖励派发流水"]').isVisible().catch(() => false),
    manualOverride: await page.getByRole("button", { name: /人工晋升|人工回滚|手动晋升|手动降级|等级覆盖/ }).isVisible().catch(() => false),
    promotionPendingPlaceholder: await page.getByText("数据待晋升引擎接入").isVisible().catch(() => false),
  };

  const [ranks, promotions, payouts] = await Promise.all([
    page.request.get("/api/admin/teams/ranks"),
    page.request.get("/api/admin/teams/promotion-log"),
    page.request.get("/api/admin/teams/reward-payouts"),
  ]);
  expect([ranks.status(), promotions.status(), payouts.status()]).toEqual([200, 200, 200]);
  const api = {
    ranks: await ranks.json(),
    promotions: await promotions.json(),
    payouts: await payouts.json(),
  };

  writeFileSync(
    `${EVIDENCE_DIR}/observations.json`,
    JSON.stringify({ observations, api }, null, 2),
    "utf8",
  );
  await page.screenshot({ path: `${EVIDENCE_DIR}/01-f1-visible-entry.png`, fullPage: true });

  expect(observations).toMatchObject({
    ladder: true,
    promotionFlow: true,
    rewardConfig: true,
    payoutFlow: true,
    manualOverride: true,
    promotionPendingPlaceholder: false,
  });
});

test("F1 接口未登录失败关闭，刷新和重登后仍从真实后端恢复", async ({ page }) => {
  const anonymous = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:3002" });
  const statuses = await Promise.all([
    anonymous.get("/api/admin/teams/ranks"),
    anonymous.get("/api/admin/teams/promotion-log"),
    anonymous.get("/api/admin/teams/reward-payouts"),
  ]);
  expect(statuses.map((response) => response.status())).toEqual([401, 401, 401]);
  await anonymous.dispose();

  await login(page);
  await page.goto("/network/v-rank", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".lrow")).toHaveCount(13);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".lrow")).toHaveCount(13);

  await page.request.post("/api/admin/auth/logout");
  await page.goto("/network/v-rank", { waitUntil: "domcontentloaded" });
  await login(page);
  await page.goto("/network/v-rank", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".lrow")).toHaveCount(13);
  await page.screenshot({ path: `${EVIDENCE_DIR}/02-f1-refresh-relogin.png`, fullPage: true });
});

async function login(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const username = page.locator('input[autocomplete="username"]');
  if (await username.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await username.fill(USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    const responsePromise = page.waitForResponse(
      (response) => response.url().includes("/api/admin/auth/login") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: /登录|继续/ }).click();
    expect((await responsePromise).status()).toBe(200);
  }
  await expect(page.locator("aside")).toBeVisible();
}
