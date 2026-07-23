import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const evidenceDir = "D:/workspace/bug-pic/h-domain-acceptance-20260722/first-user-h5-h8/inventory";
const username = process.env.NEXION_E2E_USERNAME ?? "superadmin";

function password(): string {
  const value = process.env.NEXION_E2E_PASSWORD;
  if (!value) throw new Error("NEXION_E2E_PASSWORD is required");
  return value;
}

async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel(/用户名|账号/).fill(username);
  await page.getByLabel(/密码/).fill(password());
  await page.getByRole("button", { name: /继续/ }).click();
  await expect(page.getByRole("heading", { name: "运营总览" })).toBeVisible();
}

test.beforeAll(() => fs.mkdirSync(evidenceDir, { recursive: true }));

test("H5/H7/H8 visible-entry inventory", async ({ page }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.stack ?? error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await login(page);
  const growth = page.getByRole("button", { name: /增长与运营节奏/ });
  await growth.click();
  const links = await page.locator("a").filter({ has: page.locator("[href^='/growth/']") }).allTextContents().catch(() => []);
  const visibleGrowthLinks = await page.locator("a[href^='/growth/']").allTextContents();

  const modules = [
    { id: "H5", name: "签到 & NEX", href: "/growth/daily" },
    { id: "H7", name: "代金券", href: "/growth/vouchers" },
    { id: "H8", name: "邀请奖励", href: "/growth/referral-rewards" },
  ];
  const pages: Record<string, unknown> = {};

  for (const module of modules) {
    const link = page.locator(`a[href='${module.href}']`);
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(new RegExp(module.href.replaceAll("/", "\\/")));
    await page.waitForLoadState("networkidle");
    await expect(page.getByText(/H[578].*数据加载中/)).toHaveCount(0);
    const body = await page.locator("body").innerText();
    pages[module.id] = {
      url: page.url(),
      body,
      buttons: await page.getByRole("button").allTextContents(),
      links: await page.getByRole("link").allTextContents(),
    };
    await page.screenshot({ path: path.join(evidenceDir, `${module.id}-visible-page.png`), fullPage: true });
    await page.getByRole("button", { name: /增长与运营节奏/ }).click();
  }

  pages.H8VisibleEntry = {
    expectedHref: "/growth/referral-rewards",
    visibleCount: await page.locator("a[href='/growth/referral-rewards']").count(),
    sidebarText: await page.locator("aside").innerText(),
  };
  await page.screenshot({ path: path.join(evidenceDir, "H8-entry-missing.png"), fullPage: true });

  await page.locator("a[href='/growth/vouchers']").click();
  await page.reload();
  await page.waitForLoadState("networkidle");
  pages.H7Refresh = {
    url: page.url(),
    body: await page.locator("body").innerText(),
  };
  await page.screenshot({ path: path.join(evidenceDir, "H7-refresh.png"), fullPage: true });

  fs.writeFileSync(path.join(evidenceDir, "inventory.json"), JSON.stringify({
    visibleGrowthLinks,
    exploratoryLinks: links,
    pages,
    pageErrors,
    consoleErrors,
  }, null, 2));

  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((message) => !message.includes("401 (Unauthorized)"))).toEqual([]);
});
