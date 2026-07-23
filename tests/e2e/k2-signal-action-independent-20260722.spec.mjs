import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const BASE_URL = process.env.K2_BASE_URL ?? "http://127.0.0.1:3002";
const TOKEN = process.env.K2_INDEPENDENT_ADMIN_TOKEN ?? "";
const EVIDENCE_DIR = process.env.K2_INDEPENDENT_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/k-domain-parallel-acceptance-20260722-192757/K2-abuse/evidence/independent";

if (!TOKEN) throw new Error("K2_INDEPENDENT_ADMIN_TOKEN is required");
mkdirSync(EVIDENCE_DIR, { recursive: true });

test.use({ viewport: { width: 1280, height: 720 } });

test("K2-only signal stays pending in the visible F4 entry", async ({ page, context }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("textbox", { name: "账号", exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "01-login-gate.png"), fullPage: true });

  const target = new URL(BASE_URL);
  await context.addCookies([{
    name: "nexion_admin_token",
    value: TOKEN,
    domain: target.hostname,
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
  }]);
  await page.goto(`${BASE_URL}/`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("aside")).toBeVisible();

  const k2Link = page.locator('a[href="/risk/abuse"]').first();
  if (!await k2Link.isVisible().catch(() => false)) {
    await page.getByText("风控与反作弊", { exact: true }).first().click();
  }
  await expect(k2Link).toBeVisible();
  await k2Link.click();
  await expect(page).toHaveURL(/\/risk\/abuse$/);
  await expect(page.getByRole("heading", { name: "套利 & 刷量检测", exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "02-k2-visible-entry.png"), fullPage: true });

  const f4Link = page.locator('a[href="/network/leadership-pool"]').first();
  if (!await f4Link.isVisible().catch(() => false)) {
    await page.getByText("分销与团队", { exact: true }).first().click();
  }
  await expect(f4Link).toBeVisible();
  await f4Link.click();
  await expect(page).toHaveURL(/\/network\/leadership-pool$/);
  await expect(page.getByRole("heading", { name: "池 / 配额 / 大使 / 榜", exact: true })).toBeVisible();

  const main = page.locator("main");
  await expect(main.getByText("刷榜命中 · K2", { exact: true })).toBeVisible();
  await expect(main.getByText("4 账户", { exact: true })).toBeVisible();
  await expect(main).toContainText("等待运营复核");
  await expect(main).not.toContainText("含已处置");
  await expect(main).not.toContainText("已取消违规资格");
  await page.screenshot({ path: path.join(EVIDENCE_DIR, "03-f4-k2-signal-pending.png"), fullPage: true });

  expect(pageErrors).toEqual([]);
  writeFileSync(path.join(EVIDENCE_DIR, "run-summary.json"), JSON.stringify({
    status: "passed",
    entry: "login gate -> sidebar K2 -> sidebar F4",
    liveFacts: {
      k2LeaderboardHits: 4,
      f4DispositionLabelPresent: false,
      pendingReviewLabelPresent: true,
    },
  }, null, 2), "utf8");
});
