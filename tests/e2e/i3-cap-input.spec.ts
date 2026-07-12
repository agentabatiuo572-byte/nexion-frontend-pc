import { expect, test } from "@playwright/test";

test("I3 通知容量使用受约束的整数输入，而不是自由文本", async ({ page }) => {
  const login = await page.request.post("/api/admin/auth/login", {
    data: { username: "superadmin", password: "Admin@123456" },
  });
  expect(login.ok()).toBeTruthy();

  await page.route("**/api/admin/content/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const data = pathname.endsWith("/campaigns/overview")
      ? {
          stats: { monthCampaigns: 0, monthSent: 0, monthScheduled: 0, monthDraft: 0, criticalInflight: 0, avgReadRate: "—", weeklySwipe: "—" },
          campaigns: [],
          capRules: [
            { tier: "critical", cap: "无限", policy: "永不淘汰", locked: true },
            { tier: "high", cap: "50", policy: "超出后清理最早记录", locked: false },
            { tier: "normal", cap: "200", policy: "超出后清理最早记录", locked: false },
            { tier: "low", cap: "30", policy: "超出后清理最早记录", locked: false },
          ],
          tiers: ["critical", "high", "normal", "low"],
          audiences: [],
          statuses: ["draft", "scheduled", "sending", "sent", "failed", "cancelled"],
          swipeRoutes: [],
          audienceCatalog: {
            phases: ["P1", "P2", "P3", "P4", "P5", "P6"].map((value) => ({ value, label: value })),
            languages: [{ value: "all", label: "全语言" }],
            conditionLogic: "AND",
          },
          deliveryCatalog: { kinds: [{ value: "system", label: "系统通知" }], ctaRoutes: [{ value: "", label: "无跳转" }] },
          sources: ["nx_notification_cap_rule"],
        }
      : {};
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ code: 0, data }) });
  });

  await page.goto("/content/notifications");
  await page.getByRole("button", { name: "调整" }).first().click();

  const dialog = page.getByRole("dialog");
  const capInput = dialog.getByRole("spinbutton", { name: /目标新值/ });
  await expect(capInput).toBeVisible();
  await expect(capInput).toHaveAttribute("min", "1");
  await expect(capInput).toHaveAttribute("max", "10000");
  await expect(capInput).toHaveAttribute("step", "1");
  await expect(dialog.getByText("条", { exact: true })).toBeVisible();
  await expect(dialog).toContainText("调整后立即按新上限清理已有通知");

  const reason = dialog.locator("textarea");
  const confirm = dialog.getByRole("button", { name: "确认执行" });
  await reason.fill("验证通知容量整数边界条件");
  await capInput.fill("0");
  await expect(confirm).toBeDisabled();
  await capInput.fill("10001");
  await expect(confirm).toBeDisabled();
  await capInput.fill("20.5");
  await expect(confirm).toBeDisabled();
  await capInput.fill("1e2");
  await expect(confirm).toBeDisabled();
  await capInput.fill("80");
  await expect(confirm).toBeEnabled();
});
