import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = (process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })());
const EVIDENCE_DIR =
  "D:/workspace/nexion-ops-console/docs/验收报告/PC全面测试-20260726/F5-evidence/initial-owner";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => mkdirSync(EVIDENCE_DIR, { recursive: true }));

test("F5 首次用户从可见侧栏进入并盘点佣金事件全生命周期", async ({ page }) => {
  const consoleErrors: string[] = [];
  await login(page);

  // 登录页会以匿名身份执行会话探测并按设计返回 401。只采集完成
  // 认证后的控制台错误，避免把预期的失败关闭误报为 F5 页面缺陷。
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const networkGroup = page.getByRole("button", { name: /分销与团队/ });
  if ((await networkGroup.getAttribute("aria-expanded")) !== "true") await networkGroup.click();
  const entry = page.locator('aside a[href="/network/commissions"]');
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page).toHaveURL(/\/network\/commissions$/);
  await expect(page.getByText("佣金流水", { exact: false }).first()).toBeVisible();

  const body = await page.locator("main").innerText();
  const observations = {
    hasKindFilter: /全部类型|网络版税|双轨平衡匹配/.test(body),
    hasCurrencyFilter: /币种筛选|全部币种/.test(body),
    hasUserSearch: /用户筛选|用户 ID/.test(body),
    hasCohortFilter: /cohort|用户群/.test(body),
    hasStatusFilter: /全部状态/.test(body),
    hasAnomalyPanel: /异常类型|关联 K 簇|异常预警列表/.test(body),
    hasCoolingPolicy: /仅 network.*binary|仅网络版税.*双轨/.test(body),
    hasReverse: /冲正|撤销/.test(body),
    hasReissue: /批量.*补发/.test(body),
    hasSuspend: /暂停.*佣金/.test(body),
    hasBatchHistory: /批次|处置历史/.test(body),
    hasCrossDomainLinks: /D4|B1|A2|A4/.test(body),
    consoleErrors,
  };

  const apiResponse = await page.request.get("/api/admin/teams/commissions");
  expect(apiResponse.status()).toBe(200);
  const api = await apiResponse.json();
  writeFileSync(
    `${EVIDENCE_DIR}/initial-observations.json`,
    JSON.stringify({ observations, api }, null, 2),
    "utf8",
  );
  await page.screenshot({ path: `${EVIDENCE_DIR}/01-f5-visible-entry.png`, fullPage: true });

  expect(observations.hasKindFilter).toBe(true);
  expect(observations.hasStatusFilter).toBe(true);
  expect(observations.hasCrossDomainLinks).toBe(true);
  expect(consoleErrors).toEqual([]);
});

test("F5 匿名失败关闭，刷新和重登后仍回读同一服务端事实", async ({ page }) => {
  const anonymous = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:3002" });
  expect((await anonymous.get("/api/admin/teams/commissions")).status()).toBe(401);
  expect(
    (
      await anonymous.post("/api/admin/teams/commissions/reissue", {
        data: { commissionIds: ["CM-1"], reason: "F5 匿名批量补发必须失败关闭" },
        headers: { "Idempotency-Key": "f5-anonymous-reissue" },
      })
    ).status(),
  ).toBe(401);
  await anonymous.dispose();

  await login(page);
  const before = await page.request.get("/api/admin/teams/commissions");
  expect(before.status()).toBe(200);
  const beforeBody = await before.json();
  await page.goto("/network/commissions", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("佣金流水", { exact: false }).first()).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("佣金流水", { exact: false }).first()).toBeVisible();
  await page.request.post("/api/admin/auth/logout");
  await login(page);
  await page.goto("/network/commissions", { waitUntil: "domcontentloaded" });
  const after = await page.request.get("/api/admin/teams/commissions");
  expect(after.status()).toBe(200);
  expect((await after.json()).data).toEqual(beforeBody.data);
  await page.screenshot({ path: `${EVIDENCE_DIR}/02-f5-refresh-relogin.png`, fullPage: true });
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
