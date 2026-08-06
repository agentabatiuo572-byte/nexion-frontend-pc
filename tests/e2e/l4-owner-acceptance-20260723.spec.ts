import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const username = process.env.ADMIN_E2E_USERNAME;
const password = process.env.ADMIN_E2E_PASSWORD;
const evidenceDir = process.env.L4_ACCEPTANCE_DIR ?? "";

test.beforeEach(async ({ page }) => {
  if (!username || !password) throw new Error("L4 acceptance credentials must be supplied through environment variables");
  if (!evidenceDir) throw new Error("L4_ACCEPTANCE_DIR must be supplied through environment variables");
  await mkdir(evidenceDir, { recursive: true });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const usernameInput = page.locator('input[autocomplete="username"]');
  if (await usernameInput.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await usernameInput.fill(username);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.getByRole("button", { name: /登录|继续/ }).click();
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => window.localStorage.removeItem("nexion:l4:view"));
});

test("L4 first-time user can reach the complete four-report workspace", async ({ page }) => {
  await openFromSidebar(page);
  await expect(page.getByRole("heading", { name: "设备/任务/网络报表" })).toBeVisible();
  await expect(page.getByText("历史运营报表", { exact: true })).toBeVisible();
  for (const report of ["设备运营报表", "任务承接报表", "网络与团队报表", "Phase 节奏效果报表"]) {
    await expect(page.getByRole("tab", { name: report, exact: true })).toBeVisible();
  }
  await expect(page.getByText(/当前仅支持实时快照/)).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/null%|NaN|Infinity/);
});

test("L4 report controls refresh server facts and restore an explicitly saved view", async ({ page }) => {
  await openFromSidebar(page);
  const monthResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/api/admin/bi/operations/overview") && url.searchParams.get("period") === "month";
  });
  await page.getByRole("button", { name: "月", exact: true }).click();
  expect((await monthResponse).status()).toBeLessThan(400);

  const phaseResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/api/admin/bi/operations/overview") && url.searchParams.get("phase") === "P3";
  });
  await page.getByLabel("Phase 筛选").selectOption("P3");
  expect((await phaseResponse).status()).toBeLessThan(400);
  await page.getByRole("tab", { name: "网络与团队报表", exact: true }).click();
  await page.getByRole("button", { name: "保存当前视图", exact: true }).click();
  await expect(page.getByText(/当前视图已保存/)).toBeVisible();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByRole("tab", { name: "网络与团队报表", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "月", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("Phase 筛选")).toHaveValue("P3");
});

test("L4 network tree export enforces reason, masks identifiers, downloads, and replays duplicate intent", async ({ page }) => {
  await openFromSidebar(page);
  await page.getByRole("tab", { name: "网络与团队报表", exact: true }).click();
  const exportButton = page.getByRole("button", { name: "导出团队明细", exact: true });
  await expect(exportButton).toBeVisible();
  await expect(exportButton).toBeEnabled();

  const noReason = await page.request.get("/api/admin/bi/export/network?period=week&detail=tree&depth=3", {
    headers: { "Idempotency-Key": `99104-l4-no-reason-${Date.now()}` },
  });
  expect(noReason.status()).toBe(400);
  const shortReason = await page.request.get("/api/admin/bi/export/network?period=week&detail=tree&depth=3", {
    headers: {
      "Idempotency-Key": `99104-l4-short-reason-${Date.now()}`,
      "X-Operation-Reason": encodeURIComponent("1234567"),
    },
  });
  expect(shortReason.status()).toBe(400);

  await exportButton.click();
  const dialog = page.getByRole("dialog", { name: "导出团队明细" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /执行摘要.*查看详情/ }).click();
  await expect(dialog.getByText(/部分隐藏的用户编码/)).toBeVisible();
  await expect(dialog.getByText(/文件下载令牌 24 小时有效/)).toBeVisible();
  await dialog.getByLabel("团队树层级").selectOption("3");
  const confirm = dialog.getByRole("button", { name: "确认提交" });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/操作理由/).fill("1234567");
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/操作理由/).fill("99104 L4 验收团队树明细合规导出");
  await expect(confirm).toBeEnabled();

  const createdResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/api/admin/bi/export/network") && url.searchParams.get("detail") === "tree";
  });
  const download = page.waitForEvent("download");
  await confirm.click();
  const outcome = await Promise.race([
    createdResponse.then((response) => ({ response, error: "" })),
    page.getByText(/团队明细导出失败/).waitFor({ state: "visible", timeout: 8_000 })
      .then(async () => ({ response: null, error: await page.getByText(/团队明细导出失败/).innerText() })),
  ]);
  expect(outcome.error, outcome.error).toBe("");
  expect(outcome.response?.status()).toBeLessThan(400);
  const downloaded = await download;
  expect(downloaded.suggestedFilename()).toMatch(/\.csv$/i);
  await downloaded.saveAs(path.join(evidenceDir, "l4-network-tree.csv"));
  await expect(page.getByText(/团队明细已安全下载/)).toBeVisible();

  const stableKey = `99104-l4-duplicate-${Date.now()}`;
  const headers = {
    "Idempotency-Key": stableKey,
    "X-Operation-Reason": encodeURIComponent("99104 L4 验收重复点击防重验证"),
  };
  const url = "/api/admin/bi/export/network?period=week&detail=tree&depth=2";
  const first = await page.request.get(url, { headers });
  const second = await page.request.get(url, { headers });
  expect(first.status()).toBeLessThan(400);
  expect(second.status()).toBeLessThan(400);
  const firstBody = await first.json();
  const secondBody = await second.json();
  expect(firstBody.data.reportId).toBe(secondBody.data.reportId);
  expect(firstBody.data.maskingPolicy).toBe("PARTIAL");
  expect(firstBody.data.containsPii).toBe(true);
  expect(Number(firstBody.data.downloadTtlHours)).toBe(24);
});

test("L4 custom empty state, recoverable transport error, and aggregate export remain coherent", async ({ page }) => {
  await openFromSidebar(page);
  await page.getByRole("button", { name: "自定义", exact: true }).click();
  await page.getByLabel("自定义开始日期").fill("2000-01-01");
  await page.getByLabel("自定义结束日期").fill("2000-01-02");
  const emptyResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname.endsWith("/api/admin/bi/operations/overview")
      && url.searchParams.get("period") === "custom"
      && url.searchParams.get("from") === "2000-01-01";
  });
  await page.getByRole("button", { name: "应用自定义周期", exact: true }).click();
  expect((await emptyResponse).status()).toBe(200);
  await expect(page.getByText(/所选周期暂无历史运营事件/)).toBeVisible();

  let failNext = true;
  await page.route("**/api/admin/bi/operations/overview?**", async (route) => {
    if (failNext) {
      failNext = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: 503, message: "L4_ACCEPTANCE_TRANSIENT_FAILURE" }) });
    } else {
      await route.continue();
    }
  });
  await page.getByRole("button", { name: "周", exact: true }).click();
  await expect(page.getByText(/L4 数据加载失败/)).toBeVisible();
  await page.getByRole("button", { name: "重新读取", exact: true }).click();
  await expect(page.getByText("历史运营报表", { exact: true })).toBeVisible();
  await page.unroute("**/api/admin/bi/operations/overview?**");

  const aggregateResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith("/api/admin/bi/reports") && response.request().method() === "POST");
  await page.getByRole("button", { name: "导出运营报表 CSV", exact: true }).click();
  expect((await aggregateResponse).status()).toBeLessThan(400);
  await expect(page.getByText(/运营报表 CSV 已生成/)).toBeVisible();
});

async function openFromSidebar(page: Page) {
  const domain = page.getByRole("button", { name: "数据与分析 BI L", exact: true });
  if ((await domain.getAttribute("aria-expanded")) !== "true") await domain.click();
  const link = page.locator('aside a[href="/analytics/operations"]');
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/analytics\/operations$/);
}
