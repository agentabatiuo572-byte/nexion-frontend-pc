import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";

const evidence = process.env.PAYMENT_PIN_EVIDENCE_DIR || path.resolve("test-results/payment-password");
test.beforeAll(() => mkdir(evidence, { recursive: true }));
const defaults = { maxAttempts: 5, windowMinutes: 15, lockMinutes: 15 };
const effect = "后续验证使用新规则，已经锁定的账号保持原锁定结束时间。";
async function fixture(page: Page, options: { readOnly?: boolean; missingContract?: boolean; empty?: boolean; policyUnavailable?: boolean; unknownSave?: boolean; delay?: boolean } = {}) {
  let version = 1, values = { ...defaults }, lastBody: { values: typeof defaults; reason: string } | null = null;
  let commandKey = "", posts = 0, reads = 0, policyUnavailable = !!options.policyUnavailable, delay = !!options.delay;
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/admin/**", async route => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const ok = (data: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data }) });
    const unavailable = () => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ code: 503, data: null }) });
    if (pathname === "/api/admin/auth/session" || pathname === "/api/admin/auth/activity") return ok({ tokenType: "Bearer", session: { adminId: 12, username: "fixture-admin", operator: "验收管理员", role: "superadmin", authorities: options.readOnly ? ["user_c5_read"] : ["user_c5_read", "user_c5_write"], effectiveMenus: ["C", "C5"] } });
    if (pathname === "/api/admin/platform/business-calendar") return ok({ currentZoneId: "Asia/Shanghai", currentZoneLabel: "北京时间", currentOffset: "+08:00", unified: true, trackZones: {}, pending: null, history: [], options: [], earliestEffectiveDate: "2026-10-31" });
    if (pathname === "/api/admin/users/profiles") return ok({ records: [{ id: 12, userNo: "U12", nickname: "验收用户", phoneMasked: "138****0012" }], total: 1, pageNum: 1, pageSize: 20 });
    if (pathname === "/api/admin/users/security/overview") return ok({ stats: { activeSessions: 0, twoFactorRatePct: 0, lockedShort: 0, lockedLong: 0, tokenReuseToday: 0 }, credentialParams: [], selectedUser: url.searchParams.get("userKey") ? { userId: 12, userNo: "U12", nickname: "验收用户", twoFactorEnabled: false, loginFailCount: 0, locked: false, passwordResetRequired: false } : null, sessions: { records: [], total: 0, pageNum: 1, pageSize: 10 }, selectedActiveSessionCount: 0, lockedUsers: [], sources: [], redlines: [] });
    if (pathname.endsWith("/security/payment-password-policy")) {
      if (route.request().method() === "POST") {
        posts++; lastBody = route.request().postDataJSON(); commandKey = route.request().headers()["idempotency-key"];
        values = { ...lastBody!.values }; version++;
        if (options.unknownSave) return unavailable();
        return ok({ commandKey });
      }
      if (delay) await new Promise(resolve => setTimeout(resolve, 700));
      if (policyUnavailable) return unavailable();
      return ok({ version, values, constraints: options.missingContract ? null : { maxAttempts: { min: 1, max: 10 }, windowMinutes: { min: 1, max: 60 }, lockMinutes: { min: 1, max: 60 } }, effectDescription: options.missingContract ? null : effect, editable: true, updatedAt: version > 1 ? "2026-10-30T06:30:00Z" : null, updatedBy: version > 1 ? "验收管理员" : null });
    }
    if (pathname.includes("/payment-password-policy/commands/")) { reads++; return ok({ commandKey, status: "APPLIED", auditId: "A2-PIN-12", changedAt: "2026-10-30T06:30:00Z", changedBy: "验收管理员", reason: lastBody?.reason, oldValues: defaults, newValues: values, effectDescription: effect }); }
    if (pathname.endsWith("/security/payment-password/attempts")) return ok({ userId: "12", records: options.empty ? [] : [{ id: "attempt-1", occurredAt: "2026-10-30T06:00:00Z", purpose: "PAYMENT", result: "INCORRECT", channel: "H5", clientIpMasked: "203.0.***.12", paymentPassword: "SECRET_NOT_RENDERED" }], total: options.empty ? 0 : 1, pageNum: Number(url.searchParams.get("pageNum")), pageSize: Number(url.searchParams.get("pageSize")) });
    if (pathname.endsWith("/security/payment-password")) return ok({ userId: "12", state: options.empty ? "UNSET" : "LOCKED", updatedAt: options.empty ? null : "2026-10-30T05:00:00Z", lockedUntil: options.empty ? null : "2026-10-30T06:15:00Z", observedAt: "2026-10-30T06:00:00Z" });
    // All ancillary API calls are intercepted too: this suite never reaches a real backend.
    return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ code: 404, message: "FIXTURE_NOT_PROVIDED", data: null }) });
  });
  return { errors, posts: () => posts, reads: () => reads, recover: () => { policyUnavailable = false; delay = false; } };
}
const policySection = (page: Page) => page.getByRole("region", { name: "支付密码规则", exact: true });
async function edit(page: Page) {
  const section = policySection(page);
  await section.getByRole("button", { name: "调整支付密码规则", exact: true }).click();
  await expect(section.getByRole("button", { name: "下一步：核对调整" })).toBeDisabled();
  await section.getByLabel("窗口内输错上限（次）").fill("0");
  await expect(section.getByRole("button", { name: "下一步：核对调整" })).toBeDisabled();
  await section.getByLabel("窗口内输错上限（次）").fill("6");
  await section.getByRole("button", { name: "下一步：核对调整" }).click();
  await expect(section.getByRole("table", { name: "支付密码规则调整对照" })).toContainText("5 次");
  await expect(section.getByRole("button", { name: "确认并保存规则" })).toBeDisabled();
  await section.getByLabel("支付密码规则调整理由").fill("依据已批准的安全方案调整规则");
  await section.getByRole("checkbox").check();
  return section;
}
test("C5 read-only locked user, bounded edit, confirmation, one save and audit readback", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/users/security?userCode=U12");
  await expect(policySection(page).getByRole("button", { name: "调整支付密码规则", exact: true })).toBeEnabled();
  await expect(page.getByRole("region", { name: "用户支付密码", exact: true }).getByText("暂时锁定", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "支付密码规则与用户状态" }).click();
  await expect(policySection(page)).toBeInViewport();
  expect((await page.locator("#payment-password-panels").boundingBox())!.y).toBeLessThan(160);
  await writeFile(path.join(evidence, "payment-panel-computed-style.json"), JSON.stringify(await page.evaluate(() => {
    const selectors = ["body", "#payment-password-panels", ".payment-pin h2", ".payment-pin__rules dt", ".payment-pin__number", ".payment-pin__unit", ".payment-pin__secondary", ".payment-pin__table td", ".payment-pin__button"];
    return { fontsStatus: document.fonts.status, faces: [...document.fonts].map(face => ({ family: face.family, status: face.status })), nodes: selectors.map(selector => { const node = document.querySelector(selector); if (!node) return { selector, missing: true }; const style = getComputedStyle(node); return { selector, fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, lineHeight: style.lineHeight, color: style.color, width: node.getBoundingClientRect().width, sansToken: style.getPropertyValue("--sans"), monoToken: style.getPropertyValue("--mono") }; }) };
  }), null, 2));
  const fontSession = await page.context().newCDPSession(page);
  await fontSession.send("DOM.enable"); await fontSession.send("CSS.enable");
  const fontDocument = await fontSession.send("DOM.getDocument");
  const platformFonts = [];
  for (const selector of [".payment-pin h2", ".payment-pin__number", ".payment-pin__unit", ".payment-pin__secondary", ".payment-pin__table th", ".payment-pin__table td"]) {
    const { nodeId } = await fontSession.send("DOM.querySelector", { nodeId: fontDocument.root.nodeId, selector });
    platformFonts.push({ selector, ...(await fontSession.send("CSS.getPlatformFontsForNode", { nodeId })) });
  }
  await writeFile(path.join(evidence, "payment-panel-platform-fonts.json"), JSON.stringify(platformFonts, null, 2));
  expect(platformFonts.flatMap(entry => entry.fonts).some(font => /NSimSun|Consolas|Times New Roman/.test(font.familyName))).toBe(false);
  await fontSession.detach();
  const user = page.getByRole("region", { name: "用户支付密码", exact: true });
  await expect(user.getByText("暂时锁定", { exact: true })).toBeVisible();
  await expect(user.getByRole("table", { name: "支付密码验证记录" })).toContainText("密码不正确");
  await expect(user.getByRole("button", { name: /解锁|重置|设置支付密码/ })).toHaveCount(0);
  const section = await edit(page);
  await section.screenshot({ path: `${evidence}/01-confirmation.png` });
  await section.getByRole("button", { name: "确认并保存规则" }).dblclick();
  await expect(section.getByText("规则已保存，审计记录已核对", { exact: true })).toBeVisible();
  expect(state.posts()).toBe(1); expect(state.reads()).toBe(1);
  await expect(section).toContainText("A2-PIN-12");
  await page.reload(); await expect(policySection(page).locator(".payment-pin__number").first()).toHaveText("6");
  await page.getByRole("link", { name: "支付密码规则与用户状态" }).click();
  await expect(page.getByText("SECRET_NOT_RENDERED")).toHaveCount(0);
  expect(state.errors).toEqual([]);
  await page.locator("#payment-password-panels").screenshot({ path: `${evidence}/02-saved-user-locked.png` });
  await page.screenshot({ path: `${evidence}/1440-full-page.png`, fullPage: true });
  await page.setViewportSize({ width: 1024, height: 1000 });
  await page.getByRole("link", { name: "支付密码规则与用户状态" }).click();
  await expect(policySection(page)).toBeInViewport();
  expect(await page.locator("#payment-password-panels").evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.locator("#payment-password-panels").screenshot({ path: `${evidence}/04-compact.png` });
});
test("read-only authority and incomplete server policy each disable editing with a reason", async ({ page }) => {
  await fixture(page, { readOnly: true, empty: true }); await page.goto("/users/security?userCode=U12");
  await expect(policySection(page).getByRole("button", { name: "调整支付密码规则", exact: true })).toBeDisabled();
  await expect(policySection(page)).toContainText("当前只有查看权限");
  await expect(page.getByRole("region", { name: "用户支付密码", exact: true })).toContainText("该用户暂无支付密码验证记录");
  await page.unrouteAll(); await fixture(page, { missingContract: true }); await page.reload();
  await expect(policySection(page).getByRole("button", { name: "调整支付密码规则", exact: true })).toBeDisabled();
  await expect(policySection(page)).toContainText("可调整范围或生效说明尚未确认");
  await page.screenshot({ path: `${evidence}/03-contract-unconfirmed.png`, fullPage: true });
});
test("loading, unavailable and retry keep defaults distinct from current policy", async ({ page }) => {
  const state = await fixture(page, { policyUnavailable: true, delay: true }); await page.goto("/users/security");
  await expect(policySection(page).getByText("正在读取支付密码规则…")).toBeVisible();
  await expect(policySection(page).getByRole("alert")).toBeVisible();
  await expect(policySection(page)).toContainText("此处不是当前生效值");
  await expect(page.getByRole("region", { name: "用户支付密码", exact: true })).toContainText("请先在上方用户列表");
  state.recover(); await policySection(page).getByRole("button", { name: "重新加载规则" }).click();
  await expect(policySection(page).getByRole("button", { name: "调整支付密码规则", exact: true })).toBeEnabled();
  expect(state.errors).toEqual([]);
});
test("unknown save survives reload and recovers by the original command without another POST", async ({ page }) => {
  const state = await fixture(page, { unknownSave: true }); await page.goto("/users/security");
  const section = await edit(page); await section.getByRole("button", { name: "确认并保存规则" }).click();
  await expect(section.getByRole("button", { name: "查询原调整结果" })).toBeVisible();
  await page.reload();
  await expect(policySection(page).getByRole("button", { name: "查询原调整结果" })).toBeVisible();
  await expect(policySection(page).getByRole("button", { name: "调整支付密码规则", exact: true })).toBeDisabled();
  await policySection(page).getByRole("button", { name: "查询原调整结果" }).click();
  await expect(policySection(page).getByText("规则已保存，审计记录已核对", { exact: true })).toBeVisible();
  expect(state.posts()).toBe(1); expect(state.reads()).toBe(1); expect(state.errors).toEqual([]);
});
test("cancel and back preserve intentional edits and send no mutation", async ({ page }) => {
  const state = await fixture(page); await page.goto("/users/security"); const section = await edit(page);
  await section.getByRole("button", { name: "返回修改" }).click();
  await expect(section.getByLabel("窗口内输错上限（次）")).toHaveValue("6");
  await section.getByRole("button", { name: "取消调整" }).click();
  await expect(section.getByRole("button", { name: "调整支付密码规则", exact: true })).toBeVisible(); expect(state.posts()).toBe(0);
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.screenshot({ path: `${evidence}/05-cancelled-compact.png`, fullPage: true });
});
