import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const evidence = process.env.PAYMENT_PIN_EVIDENCE_DIR || "test-results/payment-password";
const at = "2026-10-31T06:00:00Z";
async function setup(page: Page, options: { unknown?: boolean; missingCapability?: boolean; unavailable?: boolean; attemptCount?: number } = {}) {
  let released = false, posts = 0, queries = 0, commandKey = "", reason = "", unavailable = !!options.unavailable;
  const errors: string[] = [], paths: string[] = [];
  const record = () => ({ id: "lock-12", userId: "12", userLabel: "验收用户", version: released ? 5 : 4, type: "PAYMENT_PASSWORD_LOCK", state: released ? "RELEASED" : "ACTIVE", reason: "支付密码连续输错", startedAt: at, lockedUntil: "2026-10-31T06:15:00Z", failedAttempts: 5, windowMinutes: 15, capabilities: options.missingCapability ? null : { releaseAllowed: !released, disabledReason: released ? "已解除，历史记录继续保留" : null, effectDescription: "结束本次支付密码锁定并清空对应错误窗口，登录状态不受影响。" } });
  const attempts = (pageNum: number) => ({ userId: "12", records: Array.from({ length: options.attemptCount ? 10 : 1 }, (_, i) => ({ id: `attempt-${pageNum}-${i}`, occurredAt: at, purpose: pageNum === 1 ? "PAYMENT" : "CHANGE", result: "INCORRECT", channel: "APP", clientIpMasked: null })), total: options.attemptCount ?? 1, pageNum, pageSize: 10 });
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/admin/**", async route => {
    const url = new URL(route.request().url()), p = url.pathname; paths.push(`${route.request().method()} ${p}`);
    const ok = (data: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data }) });
    const fail = () => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: 503, data: null }) });
    if (p === "/api/admin/auth/session" || p === "/api/admin/auth/activity") return ok({ tokenType: "Bearer", session: { adminId: 12, username: "fixture", operator: "验收管理员", role: "superadmin", authorities: ["user_c5_read", "user_c5_write"], effectiveMenus: ["C", "C5"] } });
    if (p === "/api/admin/platform/business-calendar") return ok({ currentZoneId: "Asia/Shanghai", currentZoneLabel: "北京时间", currentOffset: "+08:00", unified: true, trackZones: {}, pending: null, history: [], options: [], earliestEffectiveDate: "2026-10-31" });
    if (p.endsWith("/security/overview")) return ok({ stats: { activeSessions: 0, twoFactorRatePct: 0, lockedShort: 0, lockedLong: 0, tokenReuseToday: 0 }, credentialParams: [], selectedUser: null, sessions: { records: [], total: 0, pageNum: 1, pageSize: 10 }, selectedActiveSessionCount: 0, lockedUsers: [], sources: [], redlines: [] });
    if (p.endsWith("/payment-password-policy")) return ok({ version: 1, values: { maxAttempts: 5, windowMinutes: 15, lockMinutes: 15 }, constraints: null, effectDescription: null, editable: false, updatedAt: null, updatedBy: null });
    if (p.endsWith("/payment-password-records")) {
      if (unavailable) return fail();
      const matches = !released || url.searchParams.get("state") === "ALL";
      return ok({ records: matches ? [record()] : [], total: matches ? 1 : 0, pageNum: Number(url.searchParams.get("pageNum")), pageSize: Number(url.searchParams.get("pageSize")) });
    }
    if (p.includes("/payment-password-records/commands/")) {
      queries++; const applied = !options.unknown || queries >= 3; if (applied) released = true;
      return ok({ commandKey, status: applied ? "APPLIED" : queries === 1 ? "NOT_FOUND" : "PENDING", userId: "12", recordId: "lock-12", operation: "RELEASE_LOCK", auditId: applied ? "A2-RELEASE-12" : null, changedAt: applied ? at : null, changedBy: applied ? "验收管理员" : null, reason: applied ? reason : null, record: applied ? record() : null });
    }
    if (p.endsWith("/payment-password-records/lock-12/release")) {
      posts++; commandKey = route.request().headers()["idempotency-key"]; const body = route.request().postDataJSON(); reason = body.reason;
      expect(body).toMatchObject({ userId: "12", recordId: "lock-12", expectedVersion: 4, operation: "RELEASE_LOCK", confirmed: true });
      await new Promise(resolve => setTimeout(resolve, 250));
      return options.unknown ? fail() : ok({ commandKey });
    }
    if (p.endsWith("/payment-password-records/lock-12/attempts")) return url.searchParams.get("pageNum") === "3" ? fail() : ok(attempts(Number(url.searchParams.get("pageNum"))));
    if (p.endsWith("/payment-password-records/lock-12")) return ok({ record: record(), attempts: attempts(1), audit: released ? [{ id: "A2-RELEASE-12", occurredAt: at, operator: "验收管理员", action: "RELEASE_LOCK", reason }] : [] });
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: 404, data: null }) });
  });
  return { errors, paths, posts: () => posts, queries: () => queries, recover: () => { unavailable = false; } };
}
async function list(page: Page) { await page.goto("/users/security"); await page.getByRole("link", { name: "支付密码规则与用户状态" }).click(); await page.getByRole("button", { name: "支付密码异常列表", exact: true }).click(); return page.getByRole("region", { name: "支付密码异常列表", exact: true }); }
async function confirmation(page: Page) {
  await page.getByRole("button", { name: "查看详情", exact: true }).click(); const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "解除锁定", exact: true }).click(); await dialog.getByRole("textbox").fill("已核实异常原因并确认属于用户本人误输"); await dialog.getByRole("checkbox").check(); return dialog;
}
test.beforeAll(() => mkdir(evidence, { recursive: true }));
test("C5 existing surface releases only payment record after reason/CAS and reads audit; history remains", async ({ page }) => {
  const state = await setup(page); const region = await list(page); await expect(region).toContainText("支付密码连续输错");
  const dialog = await confirmation(page); await dialog.screenshot({ path: `${evidence}/v2-01-real-confirmation.png` });
  await dialog.getByRole("button", { name: "确认解除", exact: true }).dblclick(); await expect(dialog.getByText("解除已确认，审计记录已核对")).toBeVisible();
  expect(state.posts()).toBe(1); expect(state.queries()).toBe(1); await dialog.getByRole("button", { name: "处置审计", exact: true }).click(); await expect(dialog).toContainText("A2-RELEASE-12");
  await dialog.screenshot({ path: `${evidence}/v2-02-real-audit.png` }); await dialog.getByRole("button", { name: "关闭", exact: true }).last().click();
  await region.getByLabel("异常状态", { exact: true }).selectOption("ALL"); await region.getByRole("button", { name: "查询", exact: true }).click(); await expect(region).toContainText("已手动解除");
  expect(state.paths.filter(p => /^POST \/api\/admin\/(?:users|content)\//.test(p)).every(p => p.endsWith("/payment-password-records/lock-12/release"))).toBe(true); expect(state.errors).toEqual([]);
});
test("C5 unknown release survives reload and NOT_FOUND/PENDING only GET original command", async ({ page }) => {
  const state = await setup(page, { unknown: true }); await list(page); const dialog = await confirmation(page); await dialog.getByRole("button", { name: "确认解除", exact: true }).click(); await expect(dialog.getByRole("button", { name: "查询本次结果" })).toBeVisible();
  await page.reload(); await page.getByRole("link", { name: "支付密码规则与用户状态" }).click(); await page.getByRole("button", { name: "支付密码异常列表", exact: true }).click(); await page.getByRole("button", { name: "查看详情", exact: true }).click();
  const restored = page.getByRole("dialog"); await expect(restored.getByRole("button", { name: "解除锁定", exact: true })).toBeDisabled();
  for (let i = 0; i < 3; i++) { const query = restored.getByRole("button", { name: "查询本次结果" }); await expect(query).toBeEnabled(); await query.click(); if (i < 2) await expect(restored).toContainText("处理结果尚未确认"); }
  await expect(restored.getByText("解除已确认，审计记录已核对")).toBeVisible(); expect(state.posts()).toBe(1); expect(state.queries()).toBe(3); expect(state.errors).toEqual([]);
});
test("C5 missing capability stays readonly, and failed list can retry without a write", async ({ page }) => {
  const state = await setup(page, { missingCapability: true, unavailable: true }); const region = await list(page); await expect(region).toContainText("记录尚未确认"); state.recover(); await region.getByRole("button", { name: "重试查询", exact: true }).click(); await region.getByRole("button", { name: "查看详情", exact: true }).click(); const dialog = page.getByRole("dialog"); await expect(dialog.getByRole("button", { name: "解除锁定", exact: true })).toBeDisabled(); await expect(dialog).toContainText("处置条件尚未确认"); expect(state.posts()).toBe(0); expect(state.errors).toEqual([]);
});
test("detail reload after a failed later page uses server page number and matching first-page rows", async ({ page }) => {
  const state = await setup(page, { attemptCount: 30 }); await list(page); await page.getByRole("button", { name: "查看详情", exact: true }).click(); const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "近期验证记录", exact: true }).click();
  await dialog.getByRole("button", { name: "异常关联验证记录 下一页", exact: true }).click(); await expect(dialog.getByRole("table")).toContainText("修改支付密码");
  await expect(dialog.locator(".data-list-pager")).toContainText(/第\s*2\s*\/\s*3\s*页/);
  await dialog.getByRole("button", { name: "异常关联验证记录 下一页", exact: true }).click(); await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByRole("button", { name: "重新加载详情", exact: true }).click(); await expect(dialog.getByRole("table")).toContainText("购买或置换");
  await expect(dialog.locator(".data-list-pager")).toContainText(/第\s*1\s*\/\s*3\s*页/);
  expect(state.posts()).toBe(0); expect(state.errors).toEqual([]);
});
