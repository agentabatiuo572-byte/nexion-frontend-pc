import { expect, test, type Page } from "@playwright/test";

const overview = {
  stats: {
    pendingTickets: 1,
    fundTickets: 0,
    sosTickets: 0,
    todayAuditEvents: 1,
    weeklyApproved: 0,
    weeklyRejected: 0,
    weeklyExpired: 0,
    weeklyWithdrawn: 0,
  },
  operationQueue: [{
    id: "A2-E2E-1",
    action: "K3_RULE_UPDATED",
    obj: "rule-18",
    beforeValue: "旧规则",
    afterValue: "新规则",
    operator: "risk-admin",
    operatorRole: "RISK",
    type: "param",
    amplifies: false,
    sos: false,
    ts: "07-17 10:00",
    mine: false,
    roleGate: "风控 / 超管",
    reason: "测试审计筛选闭环",
    status: "pending",
  }],
  operationHistory: [],
  mechanismParams: [
    { key: "reason_required", name: "操作理由", sub: "所有高敏操作必填", value: "强制", locked: true },
    { key: "ttl", name: "理由最短长度", sub: "服务端统一校验", value: "12 字", locked: false },
    { key: "retention", name: "日志保留期", sub: "审计保存周期", value: "13 个月", locked: false },
    { key: "confirm_list", name: "确认动作清单", sub: "服务端动作目录", value: "9 大类", locked: true },
    { key: "schema", name: "字段结构版本", sub: "审计统一字段", value: "v3", locked: false },
  ],
  confirmCategories: [],
  recentLogs: [{
    id: 1,
    action: "K3_RULE_UPDATED",
    resourceType: "WITHDRAW_RULE",
    resourceId: "rule-18",
    actorType: "ADMIN",
    actorUsername: "risk-admin",
    clientIp: "127.0.0.1",
    result: "SUCCESS",
    riskLevel: "HIGH",
    detailJson: JSON.stringify({ domain: "K", obj: "rule-18", before: "旧规则", after: "新规则", reason: "测试审计筛选闭环" }),
    createdAt: "2026-07-17T10:00:00.000Z",
  }],
};

test("A2 visible filters share the server query and dynamic confirmation constraints", async ({ page }) => {
  await installA2Session(page, ["platform_a2_read", "platform_a2_export", "platform_a2_write", "platform_a2_operation_approve"]);
  await page.goto("/platform/audit");

  for (const label of ["审计业务域", "审计操作者", "审计动作", "审计对象", "审计开始时间", "审计结束时间"]) {
    await expect(page.getByLabel(label, { exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "导出（脱敏）", exact: true })).toBeEnabled();

  await page.getByLabel("审计业务域", { exact: true }).selectOption("K");
  await page.getByLabel("审计操作者", { exact: true }).fill("risk-admin");
  await page.getByLabel("审计动作", { exact: true }).fill("RULE");
  await page.getByLabel("审计对象", { exact: true }).fill("rule-18");
  await page.getByLabel("审计开始时间", { exact: true }).fill("2026-07-17T09:00");
  await page.getByLabel("审计结束时间", { exact: true }).fill("2026-07-17T11:00");
  const filteredRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname.endsWith("/api/admin/platform/audit/overview") && url.searchParams.get("domain") === "K";
  });
  await page.getByRole("button", { name: "查询", exact: true }).click();
  const requestUrl = new URL((await filteredRequest).url());
  expect(Object.fromEntries(requestUrl.searchParams)).toEqual({
    domain: "K",
    operator: "risk-admin",
    action: "RULE",
    object: "rule-18",
    startTime: "2026-07-17T09:00",
    endTime: "2026-07-17T11:00:59.999",
  });

  const mechanismRow = page.locator(".a-vrow").filter({ hasText: "理由最短长度" });
  await mechanismRow.getByRole("button", { name: "调整", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "操作理由最短长度" });
  const confirm = dialog.getByRole("button", { name: "确认提交", exact: true });
  await dialog.getByLabel("目标新值", { exact: true }).fill("7");
  await dialog.getByLabel(/操作理由/).fill("123456789012");
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("目标新值", { exact: true }).fill("9");
  await dialog.getByLabel(/操作理由/).fill("12345678901");
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel(/操作理由/).fill("123456789012");
  await expect(confirm).toBeEnabled();
});

test("A2 read-only authority never renders forbidden mutation controls", async ({ page }) => {
  await installA2Session(page, ["platform_a2_read"]);
  await page.goto("/platform/audit");

  await expect(page.getByRole("button", { name: "导出（脱敏）", exact: true })).toHaveCount(0);
  await expect(page.locator(".a-vrow").getByRole("button", { name: "调整", exact: true })).toHaveCount(0);
  const ticketRow = page.locator("tr").filter({ hasText: "A2-E2E-1" });
  await expect(ticketRow.getByRole("button", { name: "执行", exact: true })).toHaveCount(0);
  await expect(ticketRow.getByRole("button", { name: "取消", exact: true })).toHaveCount(0);
  await expect(ticketRow.getByText("待门槛者执行", { exact: true })).toBeVisible();
});

async function installA2Session(page: Page, authorities: string[]) {
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
              adminId: 9002,
              username: "a2_e2e_admin",
              operator: "A2 E2E Admin",
              role: "superadmin",
              authorities,
            },
          },
        }),
      });
      return;
    }
    if (path.endsWith("/api/admin/platform/audit/overview")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: overview }) });
      return;
    }
    // Keep unrelated shell polling (for example the notification bell) from
    // hitting a real cookie-protected endpoint and forcing an auth reset.
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: {} }) });
  });
}
