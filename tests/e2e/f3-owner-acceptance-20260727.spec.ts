import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = (process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })());
const EVIDENCE_DIR = "D:/workspace/nexion-ops-console/docs/验收报告/PC全面测试-20260726/F3-evidence/initial";

test.describe.configure({ mode: "serial" });

test.beforeAll(() => mkdirSync(EVIDENCE_DIR, { recursive: true }));

test("F3 首次用户从可见侧栏进入，理解结算、封顶、安置、归零和应急动作", async ({ page }) => {
  const consoleErrors: string[] = [];
  await login(page);

  // Login intentionally starts from an anonymous document. Only collect errors
  // after authentication so its expected fail-closed 401 is not mistaken for
  // an F3 page defect.
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const networkGroup = page.getByRole("button", { name: /分销与团队/ });
  if ((await networkGroup.getAttribute("aria-expanded")) !== "true") await networkGroup.click();
  const entry = page.locator('aside a[href="/network/binary"]');
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page).toHaveURL(/\/network\/binary$/);
  await expect(page.getByText("平衡匹配公式")).toBeVisible();
  await expect(page.getByText("双轨日封顶")).toBeVisible();
  await expect(page.getByText("用户结算视图 · 当日")).toBeVisible();
  await expect(page.getByText("结算周期 & 沉淀处置", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("双轨引擎暂停")).toBeVisible();

  const observations = {
    rows: await page.locator(".bin-row:not(.head)").count(),
    emptyState: await page.getByText(/无匹配用户|暂无结算/).isVisible().catch(() => false),
    hasBalanceFormula: await page.getByText(/balanceMatch = min\(A, B\)/).isVisible().catch(() => false),
    hasH1OnlySource: await page.getByText(/H1 派发 · 只读/).isVisible().catch(() => false),
    hasSettlementAction: await page.getByRole("button", { name: /执行结算|立即结算|重试结算/ }).isVisible().catch(() => false),
    hasAdjustmentAction: await page.getByRole("link", { name: /补发.*冲正/ }).isVisible().catch(() => false),
    hasInternalTerms: /\bspillover\b|左轨|右轨/.test(await page.locator("body").innerText()),
    hasCohortFilter: await page.getByRole("combobox", { name: /cohort|用户群/ }).isVisible().catch(() => false),
    hasBlockedFilter: await page.getByRole("combobox", { name: /阻塞|状态/ }).isVisible().catch(() => false),
    consoleErrors,
  };

  writeFileSync(`${EVIDENCE_DIR}/initial-observations.json`, JSON.stringify(observations, null, 2), "utf8");
  await page.screenshot({ path: `${EVIDENCE_DIR}/01-visible-entry.png`, fullPage: true });

  expect.soft(observations.rows > 0 || observations.emptyState).toBe(true);
  expect.soft(observations.hasBalanceFormula).toBe(true);
  expect.soft(observations.hasH1OnlySource).toBe(true);
  expect.soft(observations.hasSettlementAction).toBe(true);
  expect.soft(observations.hasAdjustmentAction).toBe(true);
  expect.soft(observations.hasInternalTerms).toBe(false);
  expect.soft(observations.hasCohortFilter).toBe(true);
  expect.soft(observations.hasBlockedFilter).toBe(true);
  expect.soft(consoleErrors).toEqual([]);
});

test("F3 配置动作具备业务确认、无变更阻断、B1 解释和取消出口", async ({ page }) => {
  await login(page);
  await page.goto("/network/binary", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("平衡匹配公式")).toBeVisible();

  await page.getByRole("button", { name: "调整比例" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText(/B1.*覆盖率/);
  await dialog.getByRole("button", { name: /执行摘要.*查看详情/ }).click();
  await expect(dialog).toContainText(/下一周期结算.*不回溯/);
  const reason = dialog.locator("textarea");
  await reason.fill("F3验收验证无变更必须被安全阻断");
  const confirm = dialog.getByRole("button", { name: /确认/ }).last();
  await expect(confirm).toBeDisabled();
  await dialog.getByRole("button", { name: "取消" }).click();

  await page.getByRole("button", { name: "调整周期 & 策略" }).click();
  await expect(page.getByRole("dialog")).toContainText("每日");
  await expect(page.getByRole("dialog")).toContainText("每周");
  await expect(page.getByRole("dialog")).toContainText("每月");
  await expect(page.getByRole("dialog")).toContainText("每次对碰清零");
  await expect(page.getByRole("dialog")).toContainText("转结");
  await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();

  await page.getByRole("button", { name: /暂停引擎|恢复引擎/ }).click();
  await expect(page.getByRole("dialog")).toContainText(/全平台|全站/);
  await expect(page.getByRole("dialog")).toContainText(/A2|审计/);
  await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();
  await page.screenshot({ path: `${EVIDENCE_DIR}/02-safe-confirmations.png`, fullPage: true });
});

test("F3 真实接口未登录失败关闭，刷新与重登后恢复服务端数据", async ({ page }) => {
  const anonymous = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:3002" });
  const anonymousReads = await Promise.all([
    anonymous.get("/api/admin/teams/binary"),
    anonymous.post("/api/admin/teams/binary/settlements", {
      data: { ownerUserId: 1, settlementDate: "2026-07-27", reason: "F3 anonymous fail-closed check" },
    }),
  ]);
  expect(anonymousReads.map((response) => response.status())).toEqual([401, 401]);
  await anonymous.dispose();

  await login(page);
  const response = await page.request.get("/api/admin/teams/binary");
  expect(response.status()).toBe(200);
  const initial = await response.json();
  await page.goto("/network/binary", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("平衡匹配公式")).toBeVisible();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("平衡匹配公式")).toBeVisible();
  await page.request.post("/api/admin/auth/logout");
  await login(page);
  await page.goto("/network/binary", { waitUntil: "domcontentloaded" });
  await expect(page.getByText("平衡匹配公式")).toBeVisible();
  const after = await page.request.get("/api/admin/teams/binary");
  expect(after.status()).toBe(200);
  expect((await after.json()).data).toEqual(initial.data);
  await page.screenshot({ path: `${EVIDENCE_DIR}/03-refresh-relogin.png`, fullPage: true });
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
