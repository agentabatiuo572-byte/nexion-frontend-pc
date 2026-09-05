import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = (process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })());
const EVIDENCE_DIR =
  "D:/workspace/nexion-ops-console/docs/验收报告/PC全面测试-20260726/F4-evidence/initial-owner";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("F4 首次用户从侧栏进入，盘点奖池、资格、封顶与结算出口", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await login(page);
  const group = page.getByRole("button", { name: /分销|团队|网络/ }).first();
  if (await group.isVisible().catch(() => false)) {
    if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
    const entry = page.locator('aside a[href="/network/leadership-pool"]');
    await expect(entry).toBeVisible();
    await entry.click();
  } else {
    await page.goto("/network/leadership-pool", { waitUntil: "domcontentloaded" });
  }

  await expect(page).toHaveURL(/\/network\/leadership-pool$/);
  await expect(page.getByText("领导奖池", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("V 级票数权重 · 领导池分配依据")).toBeVisible();

  const response = await page.request.get("/api/admin/teams/leadership-pool");
  expect(response.status()).toBe(200);
  const api = await response.json();
  const visibleText = await page.locator("main").innerText();
  const observations = {
    hasPool: visibleText.includes("领导奖池"),
    hasQuota: visibleText.includes("硬件配额"),
    hasAmbassador: visibleText.includes("区域大使确认"),
    hasLeaderboard: visibleText.includes("排行榜 · 反欺诈"),
    hasVotes: visibleText.includes("V 级票数权重"),
    hasManualInjection: /手动.*注入/.test(visibleText),
    hasEarlySettlement: /提前结算/.test(visibleText),
    hasSettlementHistory: /历史周池|结算历史/.test(visibleText),
    hasReissueOrReversal: /补发|冲正|撤销/.test(visibleText),
    hasCrossDomainLinks: /D4|A2|A4|B1/.test(visibleText),
    consoleErrors,
  };

  writeFileSync(
    `${EVIDENCE_DIR}/initial-observations.json`,
    JSON.stringify({ observations, api }, null, 2),
    "utf8",
  );
  await page.screenshot({ path: `${EVIDENCE_DIR}/01-f4-visible-entry.png`, fullPage: true });

  expect(observations).toMatchObject({
    hasPool: true,
    hasQuota: true,
    hasAmbassador: true,
    hasLeaderboard: true,
    hasVotes: true,
  });
});

test("F4 未登录失败关闭，刷新和重登后恢复服务端数据", async ({ page }) => {
  const anonymous = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:3002" });
  expect((await anonymous.get("/api/admin/teams/leadership-pool")).status()).toBe(401);
  expect((await anonymous.post("/api/admin/teams/leadership-pool/settle")).status()).toBe(401);
  await anonymous.dispose();

  await login(page);
  await page.goto("/network/leadership-pool", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("V 级票数权重 · 领导池分配依据")).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("V 级票数权重 · 领导池分配依据")).toBeVisible();

  await page.request.post("/api/admin/auth/logout");
  await page.goto("/network/leadership-pool", { waitUntil: "domcontentloaded" });
  await login(page);
  await page.goto("/network/leadership-pool", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("V 级票数权重 · 领导池分配依据")).toBeVisible();
  await page.screenshot({ path: `${EVIDENCE_DIR}/02-f4-refresh-relogin.png`, fullPage: true });
});

async function login(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const username = page.locator('input[autocomplete="username"]');
  if (await username.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await username.fill(USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/auth/login") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: /登录|继续/ }).click();
    expect((await responsePromise).status()).toBe(200);
  }
  await expect(page.locator("aside")).toBeVisible();
}
