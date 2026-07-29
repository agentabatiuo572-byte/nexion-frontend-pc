import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type APIResponse, type Page } from "@playwright/test";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const VIEW_NAME = process.env.B3_LIVE_VIEW_NAME || "B3 ACC R151023 LIVE";
const IDEMPOTENCY_KEY = process.env.B3_LIVE_KEY || "b3-live-pc-full-acceptance-20260728-151023";
const EVIDENCE_DIR = process.env.B_EVIDENCE_DIR;

test("B3 真实服务端幂等：同键同载荷回放，同键异载荷拒绝", async ({ page }) => {
  await login(page);
  const body = {
    name: VIEW_NAME,
    cohort: "ALL",
    phase: "ALL",
    ref: "ALL",
    granularity: "WEEK",
    comparison: "PREVIOUS",
  };
  const headers = {
    "Content-Type": "application/json",
    "Idempotency-Key": IDEMPOTENCY_KEY,
  };

  const first = await page.request.post("/api/admin/funnel/view", { headers, data: body });
  const replay = await page.request.post("/api/admin/funnel/view", { headers, data: body });
  const mismatch = await page.request.post("/api/admin/funnel/view", {
    headers,
    data: { ...body, comparison: "YEAR_OVER_YEAR" },
  });

  const evidence = {
    viewName: VIEW_NAME,
    idempotencyKey: IDEMPOTENCY_KEY,
    first: await responseEvidence(first),
    replay: await responseEvidence(replay),
    mismatch: await responseEvidence(mismatch),
  };

  expect(evidence.first.status).toBe(200);
  expect(evidence.first.body?.code).toBe(0);
  expect(evidence.first.body?.data?.replayed).toBe(false);
  expect(evidence.replay.status).toBe(200);
  expect(evidence.replay.body?.code).toBe(0);
  expect(evidence.replay.body).toEqual(evidence.first.body);
  expect(evidence.mismatch.status).toBe(409);
  expect(evidence.mismatch.body?.message).toBe("IDEMPOTENCY_KEY_PAYLOAD_MISMATCH");

  if (EVIDENCE_DIR) {
    await mkdir(EVIDENCE_DIR, { recursive: true });
    await writeFile(
      path.join(EVIDENCE_DIR, "b3-live-idempotency.json"),
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8",
    );
  }
});

async function responseEvidence(response: APIResponse) {
  const text = await response.text();
  let body: any = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: response.status(), body };
}

async function login(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const shell = page.locator("aside");
  const username = page.locator('input[autocomplete="username"]');
  await Promise.race([
    shell.waitFor({ state: "visible", timeout: 8_000 }),
    username.waitFor({ state: "visible", timeout: 8_000 }),
  ]).catch(() => undefined);
  if (await shell.isVisible()) return;
  await username.fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  const response = page.waitForResponse(
    (candidate) => candidate.url().endsWith("/api/admin/auth/login")
      && candidate.request().method() === "POST",
  );
  await page.getByRole("button", { name: /登录|继续/ }).click();
  expect((await response).status()).toBe(200);
  await expect(shell).toBeVisible({ timeout: 20_000 });
}
