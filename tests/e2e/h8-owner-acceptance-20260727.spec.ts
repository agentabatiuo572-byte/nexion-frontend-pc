import fs from "node:fs";
import path from "node:path";
import { expect, request as playwrightRequest, test } from "@playwright/test";
import { loginHMaker } from "./h-owner-mfa";
const evidenceDir = process.env.H8_EVIDENCE_DIR
  || "D:/workspace/nexion-ops-console/docs/验收报告/PC全面测试-20260726/H8-evidence";

test.beforeAll(() => fs.mkdirSync(evidenceDir, { recursive: true }));

test("H8 first-user visible entry, refresh/relogin and fail-closed boundary", async ({ page, baseURL }) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await loginHMaker(page);
  const group = page.getByRole("button", { name: /增长与运营节奏/ });
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  const entry = page.locator('aside a[href="/growth/referral-rewards"]');
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page).toHaveURL(/\/growth\/referral-rewards$/);
  await expect(page.getByText("新人礼与邀请人奖励", { exact: true }).last()).toBeVisible();
  await expect(page.getByText("待结算邀请", { exact: true })).toBeVisible();
  await expect(page.getByText("最近真实发奖", { exact: true })).toBeVisible();
  await expect(page.locator("body")).toContainText("真实钱包与资金台账");
  await expect(page.locator("body")).not.toContainText(/mock|样例账户|NaN|Infinity|undefined/i);

  const overview = await page.request.get("/api/admin/growth/referral-rewards");
  expect(overview.status()).toBe(200);
  const envelope = await overview.json();
  expect(envelope.code).toBe(0);
  expect(envelope.data.source).toBe("nx_user.sponsor_user_id");
  expect(envelope.data.settlementMode).toBe("REAL_WALLET_LEDGER");
  await page.screenshot({ path: path.join(evidenceDir, "H8-visible-entry.png"), fullPage: true });

  await page.reload();
  await expect(page.getByText("最近真实发奖", { exact: true })).toBeVisible();
  await page.evaluate(() => localStorage.clear());
  await page.context().clearCookies();
  await loginHMaker(page);
  await page.goto("/growth/referral-rewards");
  await expect(page.getByText("待结算邀请", { exact: true })).toBeVisible();
  expect((await page.request.get("/api/admin/growth/referral-rewards/not-allowed")).status()).toBe(404);

  const anonymous = await playwrightRequest.newContext({ baseURL: baseURL || "http://127.0.0.1:3002" });
  expect((await anonymous.get("/api/admin/growth/referral-rewards")).status()).toBe(401);
  expect((await anonymous.post("/api/admin/growth/referral-rewards/settlements/run", {
    data: { limit: 1, reason: "未登录不得触发真实奖励结算", operator: "anonymous" },
    headers: { "Idempotency-Key": `H8-ANON-${Date.now()}` },
  })).status()).toBe(401);
  expect((await anonymous.get("/api/admin/growth/referral-rewards/not-allowed")).status()).toBe(401);
  await anonymous.dispose();

  fs.writeFileSync(path.join(evidenceDir, "H8-browser-evidence.json"), JSON.stringify({
    url: page.url(),
    overview: envelope.data,
    pageErrors,
    consoleErrors,
  }, null, 2));
  expect(pageErrors).toEqual([]);
  expect(consoleErrors.filter((message) => !message.includes("401 (Unauthorized)"))).toEqual([]);
});
