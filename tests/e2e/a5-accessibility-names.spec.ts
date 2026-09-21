import { expect, test, type Page } from "@playwright/test";

const overview = {
  rows: [
    {
      canonicalKey: "audit.reason.minLength",
      displayName: "操作理由最短长度",
      description: "高敏操作必须填写的理由长度",
      domain: "A",
      domainLabel: "平台基础",
      ownerCode: "A2",
      ownerLabel: "A2 审计与追溯",
      ownerRoute: "/platform/audit",
      currentValue: "12",
      valueType: "INTEGER",
      unit: "字符",
      source: "nx_config_item",
      sourceStatus: "READY",
      updatedAt: "2026-09-19T10:00:00Z",
      operationConfirm: true,
      serverCanonical: true,
    },
    {
      canonicalKey: "emergency.reason.minLength",
      displayName: "操作理由最短长度",
      description: "应急控制操作必须填写的理由长度",
      domain: "J",
      domainLabel: "紧急合规",
      ownerCode: "J1",
      ownerLabel: "J1 功能闸",
      ownerRoute: "/emergency/kill-switch",
      currentValue: "12",
      valueType: "INTEGER",
      unit: "字符",
      source: "J1",
      sourceStatus: "READY",
      updatedAt: "2026-09-19T10:00:00Z",
      operationConfirm: true,
      serverCanonical: true,
    },
  ],
  stats: { registeredCount: 2, domainCount: 2, highSensitivityCount: 2, sourceCount: 2 },
  sources: [
    { key: "config", label: "配置中心", status: "READY", rowCount: 1, detail: "服务端有效配置" },
    { key: "emergency", label: "应急控制", status: "READY", rowCount: 1, detail: "J1 实时状态" },
  ],
  observedAt: "2026-09-19T10:00:00Z",
};

test("A5 search, domain value and owner destinations remain distinguishable by keyboard and AX name", async ({ page }) => {
  await installSession(page);
  await page.goto("/platform/params-registry");

  const search = page.getByRole("textbox", { name: "搜索平台参数", exact: true });
  const domain = page.getByRole("combobox", { name: "业务域筛选", exact: true });
  await expect(search).toBeVisible();
  await expect(domain).toHaveValue("ALL");
  await expect(domain.locator("option:checked")).toHaveText("全部业务域");

  await search.focus();
  expect(await search.evaluate((element) => getComputedStyle(element.closest("label")!).boxShadow)).not.toBe("none");
  await page.keyboard.press("Tab");
  await expect(domain).toBeFocused();
  expect(await domain.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");
  await domain.selectOption("A");
  await expect(domain).toHaveValue("A");
  await expect(domain.locator("option:checked")).toHaveText("A · 平台基础");

  await search.fill("操作理由");
  const auditLink = page.getByRole("link", {
    name: "前往 A2 审计与追溯：操作理由最短长度（参数 audit.reason.minLength）",
    exact: true,
  });
  await expect(auditLink).toHaveAttribute("href", "/platform/audit");
  await expect(page.getByRole("link", { name: /前往 .*操作理由最短长度/ })).toHaveCount(1);
  await domain.focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "重新加载", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(auditLink).toBeFocused();
  expect(await auditLink.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");

  await domain.selectOption("ALL");
  await expect(page.getByRole("link", { name: /前往 .*操作理由最短长度/ })).toHaveCount(2);
  await expect(page.getByRole("link", {
    name: "前往 J1 功能闸：操作理由最短长度（参数 emergency.reason.minLength）",
    exact: true,
  })).toHaveAttribute("href", "/emergency/kill-switch");

  await auditLink.click();
  await expect(page).toHaveURL(/\/platform\/audit$/, { timeout: 60_000 });
});

async function installSession(page: Page) {
  await page.route("**/api/admin/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/api/admin/auth/session")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          code: 0,
          data: {
            tokenType: "Bearer",
            session: {
              adminId: 9084,
              username: "a5_accessibility_test",
              operator: "A5 Accessibility Test",
              role: "superadmin",
              authorities: ["platform_a5_read", "platform_a2_read", "emergency_j1_read"],
            },
          },
        }),
      });
      return;
    }
    if (path.endsWith("/api/admin/platform/params-registry")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: overview }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: {} }) });
  });
}
