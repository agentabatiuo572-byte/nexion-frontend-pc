import { expect, test } from "@playwright/test";

test("D7 no longer exposes Sandbox order or callback actions", async ({ page }) => {
  await page.goto("/domains/D/7");

  await expect(page.getByText("Sandbox", { exact: false })).toHaveCount(0);
  await expect(page.getByText("Mock", { exact: false })).toHaveCount(0);

  const retiredOrder = await page.request.post("/api/admin/finance/payout-vnd/sandbox/orders", {
    data: { userId: 1 },
  });
  const retiredCallback = await page.request.post("/api/admin/finance/payout-vnd/sandbox/callbacks", {
    data: { orderNo: "retired" },
  });

  expect([404, 410]).toContain(retiredOrder.status());
  expect([404, 410]).toContain(retiredCallback.status());
});
