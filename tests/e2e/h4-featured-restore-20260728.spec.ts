import { expect, test, type Page, type Response } from "@playwright/test";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const RUN_ID = process.env.H_PERMISSION_RUN_ID ?? "pc-full-acceptance-20260728-151023";

test.describe.configure({ mode: "serial", timeout: 300_000 });

test("H4 主推活动经可见入口真实取消、刷新确认并恢复，陈旧写被拒绝", async ({ page }) => {
  await login(page);
  const before = await getH4(page);
  const event = (before.events as Array<Record<string, unknown>>)
    .find((item) => item.state === "ongoing");
  expect(event, "H4 must have one ongoing event for reversible acceptance").toBeTruthy();
  const eventId = String(event!.id);
  const eventName = String(event!.name);
  const initialFeatured = event!.featured === true;
  const firstButton = initialFeatured ? "取消主推" : "设主推";
  const restoreButton = initialFeatured ? "设主推" : "取消主推";
  let restored = false;

  await openH4(page);
  const row = page.getByRole("row").filter({ hasText: eventName });
  await expect(row).toBeVisible();

  try {
    const changed = await toggleFeaturedFromUi(
      page,
      row,
      firstButton,
      `${RUN_ID} H4 可逆主推状态验收：临时切换并刷新核对`,
      eventId,
    );
    expect(changed.status()).toBe(200);
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(await featuredValue(page, eventId)).toBe(!initialFeatured);

    const restoredResponse = await toggleFeaturedFromUi(
      page,
      page.getByRole("row").filter({ hasText: eventName }),
      restoreButton,
      `${RUN_ID} H4 验收结束恢复原主推状态`,
      eventId,
    );
    expect(restoredResponse.status()).toBe(200);
    restored = true;
    await page.reload({ waitUntil: "domcontentloaded" });
    expect(await featuredValue(page, eventId)).toBe(initialFeatured);

    const stale = await page.request.patch(`/api/admin/growth/quest-events/events/${encodeURIComponent(eventId)}/featured`, {
      headers: { "Idempotency-Key": `${RUN_ID}-H4-STALE-${Date.now()}` },
      data: {
        key: "featured",
        value: String(!initialFeatured),
        expectedValue: String(!initialFeatured),
        reason: `${RUN_ID} H4 陈旧值探针必须拒绝`,
        operator: USERNAME,
      },
    });
    expect(stale.status()).toBe(422);
    expect((await stale.json()).message).toContain("EVENT_CONFIG_STALE");

    const audit = await getEnvelope<Record<string, unknown>>(
      page,
      `/api/admin/platform/audit/overview?domain=H&object=${encodeURIComponent(eventId)}`,
    );
    expect(JSON.stringify(audit)).toContain(RUN_ID);
    const events = await getEnvelope<Record<string, unknown>>(page, "/api/admin/platform/events/overview");
    expect(JSON.stringify(events)).toContain("admin.growth_config_changed");
  } finally {
    if (!restored && (await featuredValue(page, eventId)) !== initialFeatured) {
      const response = await page.request.patch(`/api/admin/growth/quest-events/events/${encodeURIComponent(eventId)}/featured`, {
        headers: { "Idempotency-Key": `${RUN_ID}-H4-SAFETY-RESTORE-${Date.now()}` },
        data: {
          key: "featured",
          value: String(initialFeatured),
          expectedValue: String(!initialFeatured),
          reason: `${RUN_ID} H4 finally 安全恢复原主推状态`,
          operator: USERNAME,
        },
      });
      expect(response.status(), await response.text()).toBe(200);
    }
    await expect.poll(() => featuredValue(page, eventId)).toBe(initialFeatured);
  }
});

async function login(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function openH4(page: Page) {
  const group = page.getByRole("button", { name: /增长与运营节奏/ }).first();
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
  await page.locator('aside a[href="/growth/events"]').first().click();
  await expect(page).toHaveURL(/\/growth\/events$/);
  await expect(page.getByText("抽奖转盘治理", { exact: true })).toBeVisible();
}

async function toggleFeaturedFromUi(
  page: Page,
  row: ReturnType<Page["getByRole"]>,
  buttonName: "取消主推" | "设主推",
  reason: string,
  eventId: string,
) {
  await row.getByRole("button", { name: buttonName, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/操作理由/).fill(reason);
  const response = page.waitForResponse((candidate: Response) =>
    candidate.request().method() === "PATCH"
    && new URL(candidate.url()).pathname === `/api/admin/growth/quest-events/events/${eventId}/featured`);
  const confirmName = buttonName === "设主推" ? "设为主推" : "取消主推";
  await dialog.getByRole("button", { name: confirmName, exact: true }).click();
  return response;
}

async function featuredValue(page: Page, eventId: string) {
  const data = await getH4(page);
  const event = (data.events as Array<Record<string, unknown>>).find((item) => String(item.id) === eventId);
  return event?.featured === true;
}

async function getH4(page: Page) {
  return getEnvelope<Record<string, any>>(page, "/api/admin/growth/quest-events/events-overview");
}

async function getEnvelope<T>(page: Page, apiPath: string) {
  const response = await page.request.get(apiPath);
  const raw = await response.text();
  expect(response.status(), raw).toBe(200);
  const payload = JSON.parse(raw) as { code?: number; data?: T };
  expect(payload.code, raw).toBe(0);
  return payload.data as T;
}
