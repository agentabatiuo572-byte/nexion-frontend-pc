import { expect, test, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// These fixtures exercise the real Next routes and production customer components.
// Every admin API call is intercepted; no Java service or database is used.
const evidence = process.env.PAYMENT_CUSTOMER_EVIDENCE_DIR || "D:/WORKS/PLAN/output/payment-pin-20261030/real-customer-security";
const at = "2026-10-31T06:00:00Z";
const names: Record<string, string> = { "12": "林海", "13": "陈月" };
const group = (data: Record<string, unknown>) => ({ status: "READY", data, evaluatedAt: at });
const unknown = () => ({ observed: null, confirmed: null, status: "UNKNOWN" });
const count = (n = 1) => ({ observed: n, confirmed: n, status: "AVAILABLE" });
const money = () => ({ observed: "12.000000", confirmed: null, observedEvents: 1, confirmedEvents: null, observedCustomers: 1, status: "PARTIAL" });
const currencies = () => [{ currency: "USDT", deposits: money(), purchases: money() }, { currency: "UVT", deposits: money(), purchases: money() }];
const devices = () => ({ held: unknown(), unknownHolding: count(), status: "UNKNOWN", partitions: [{ dimension: "CONNECTION", value: "UNKNOWN", devices: count() }] });
const current = () => ({ lifetimeBasis: "CURRENT_CUSTOMER_HISTORY", status: "PARTIAL", ownLifetime: currencies(), firstConfirmed: unknown(), firstNone: unknown(), firstUnknown: count(), devices: devices(), activity: { active: unknown(), inactive: unknown(), unknown: count(), status: "UNKNOWN", window: { days: null, from: null, through: null, status: "UNAVAILABLE" } } });
const personnel = () => ({ status: "PARTIAL", serviceAccounts: count(), groupMembers: count(), supervisors: unknown(), people: { observed: 1, confirmed: null, status: "PARTIAL" }, groups: count(), partitions: [{ dimension: "MEMBERSHIP", value: "UNKNOWN", accounts: count() }] });
const financial = () => ({ status: "PARTIAL", firstCandidates: unknown(), currencies: [{ currency: "USDT", deposits: money(), purchases: money(), purchaseRefunds: money(), net: { observed: null, confirmed: null, observedEvents: null, confirmedEvents: null, observedCustomers: null, status: "UNKNOWN" } }], firstSources: currencies() });
const funds = () => ({ scope: "SELECTED_CURRENT_CUSTOMERS", customerCount: 2, balanceStatus: "PARTIAL", withdrawalStatus: "UNKNOWN", balances: [{ currency: "USDT", observedAmount: "12", confirmedAmount: null }, { currency: "UVT", observedAmount: null, confirmedAmount: null }], sourceObservationStatus: "UNKNOWN", walletReadStatus: "PARTIAL", walletReadReasons: ["WALLET_MISSING"], withdrawalReadStatus: "READY", withdrawalReadReasons: [], withdrawalReadScope: "CURRENT_CUSTOMER_RAW_ROWS", historicalEnvironmentStatus: "UNKNOWN", eventOwnershipStatus: "UNKNOWN", withdrawals: [] });
function analytics(url: URL) {
  return { view: url.searchParams.get("view"), basis: url.searchParams.get("basis"), businessZone: "Asia/Shanghai", asOf: at, pageNum: Number(url.searchParams.get("pageNum")), pageSize: Number(url.searchParams.get("pageSize")), total: 0, observedTotal: 0, records: [], versionState: "READY", queryVersion: `saq-v1:${"a".repeat(64)}`, canContinue: false, recordsStatus: "READY", selectedCustomerCount: 2, selectedCurrent: current(), scopeSummary: { mode: "PERSONAL", total: 2, bound: 2, pending: 0, anomaly: 0, status: "AVAILABLE", current: current(), financial: financial(), restrictedSummary: { customers: unknown(), firstCandidates: unknown() }, personnel: personnel(), groups: [] }, funds: { ...funds(), groups: [] } };
}
function customer(id: string) {
  return { customerId: Number(id), assignmentId: Number(id) + 100, assignmentVersion: 1, agentAdminId: 12, preferenceVersion: 1, customerNo: `U${id}`, nickname: names[id], enabled: true, due: false, openCycleId: null, activityStatus: "ACTIVE", windowStatus: "ACTIVE", lastEffectiveAt: at, nextDueAt: null, waitingReply: false, firstContact: true, pendingReplyCount: 0, pendingConversationNo: null, pendingThroughMessageId: null, agentName: "专属客服" };
}
function workbench(url: URL) {
  return { snapshotId: "fixture-customers", evaluatedAt: at, rulesVersion: 1, scope: { actorId: 12, agentAdminId: 12, groupId: null, mode: "PERSONAL", availableModes: ["PERSONAL"] }, rules: { activityWindowDays: 30 }, overview: { boundTotal: 2, activeTotal: 2, dormantTotal: 0, dueTotal: 0, waitingReplyTotal: 0, firstContactTotal: 2, stoppedTotal: 0, knownActiveCount: 2, unknownWindowCount: 0 }, performance: { executionCount: 0, successfulCycleCount: 0, successfulCustomerCount: 0, from: at, to: at, timeZone: "Asia/Shanghai", days: [] }, completeness: { unknownCount: 0, unknownWindowCount: 0, coverageStartAt: at, observedThroughAt: at, observationLagMillis: 0, activitySource: "INTERACTIVE_LOGIN" }, customers: { records: [customer("12"), customer("13")], total: 2, pageNum: Number(url.searchParams.get("pageNum")), pageSize: Number(url.searchParams.get("pageSize")), available: true, filter: url.searchParams.get("filter") || "ALL" } };
}
function fullProfile(id: string, support: boolean) {
  return { profile: { id: Number(id), userNo: `U${id}`, nickname: names[id], phoneMasked: "138****0012", status: "ACTIVE", registeredAt: at, lastLoginAt: at }, summary: { userId: Number(id), userNo: `U${id}`, locked: false, activeSessionCount: 1, twoFactorEnabled: true }, risk: { sourceStatus: "READY", bandLabel: "低风险", effectiveScore: 10 }, ...(support ? {} : { sessions: [{ id: 1, deviceName: "登录设备", status: "ACTIVE", issuedAt: at, expiresAt: at, clientIpMasked: "203.0.***.12" }] }) };
}
function paymentRecord(id: string) {
  return { id: `pay-${id}`, userId: id, userLabel: names[id], version: 1, type: id === "12" ? "PAYMENT_PASSWORD_LOCK" : "PAYMENT_PASSWORD_EXCEPTION", state: "ACTIVE", reason: id === "12" ? "林海的支付密码连续输错" : "陈月的支付密码需要核对", startedAt: at, lockedUntil: id === "12" ? "2026-10-31T06:15:00Z" : null, failedAttempts: id === "12" ? 5 : 2, windowMinutes: 15, capabilities: { releaseAllowed: false, disabledReason: "当前账号只有查看权限", effectDescription: "仅解除本条支付密码异常，保留验证和处置记录。" } };
}
async function fixture(page: Page, options: { unavailable?: boolean; noRecord?: boolean; delayFirst?: boolean; canRelease?: boolean; holdRelease?: boolean } = {}) {
  const requests: string[] = [], errors: string[] = [];
  let releasePosts = 0, releaseMutation = () => {};
  const mutationGate = options.holdRelease ? new Promise<void>(resolve => { releaseMutation = resolve; }) : Promise.resolve();
  const record = (id: string) => { const row = paymentRecord(id); return options.canRelease ? { ...row, capabilities: { ...row.capabilities, releaseAllowed: true, disabledReason: null } } : row; };
  let unavailable = !!options.unavailable, releaseDelayed: (() => void) | undefined;
  const delayed = options.delayFirst ? new Promise<void>(resolve => { releaseDelayed = resolve; }) : Promise.resolve();
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/admin/**", async route => {
    const url = new URL(route.request().url()), p = url.pathname;
    requests.push(`${route.request().method()} ${p}`);
    const ok = (data: unknown) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data }) });
    const fail = (status: number) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ code: status, data: null }) });
    if (p === "/api/admin/auth/session" || p === "/api/admin/auth/activity") return ok({ tokenType: "Bearer", session: { adminId: 12, username: "fixture-admin", operator: "验收管理员", role: "superadmin", authorities: ["user_c1_read", "user_c1hub_read", "service_m1_read", "service_m3_read"], effectiveMenus: ["C", "C1", "M", "M1", "M3"], supportReadModes: ["PERSONAL"] } });
    if (p === "/api/admin/platform/business-calendar") return ok({ currentZoneId: "Asia/Shanghai", currentZoneLabel: "北京时间", currentOffset: "+08:00", unified: true, trackZones: {}, pending: null, history: [], options: [], earliestEffectiveDate: "2026-10-31" });
    if (p.endsWith("/analytics/months")) return ok({ months: [{ month: "2026-10", from: "2026-09-30T16:00:00Z", to: "2026-10-31T16:00:00Z" }] });
    if (p.endsWith("/support-workbench/analytics")) return ok(analytics(url));
    if (p.endsWith("/support-workbench/customers")) return ok(workbench(url));
    if (p.endsWith("/conversations")) return ok({ records: [], total: 0, pageNum: Number(url.searchParams.get("pageNum") || 1), pageSize: Number(url.searchParams.get("pageSize") || 100) });
    if (p.endsWith("/conversations/transfer-targets")) return ok([]);
    if (p.endsWith("/session-templates/runtime")) return ok({ workbenchPolicy: {}, scripts: [], replyTemplates: [] });
    if (p === "/api/admin/users/profiles") return ok({ records: [fullProfile("12", false).profile, fullProfile("13", false).profile], total: 2, pageNum: Number(url.searchParams.get("pageNum") || 1), pageSize: Number(url.searchParams.get("pageSize") || 50) });
    if (p === "/api/admin/users/overview") return ok({ totalUsers: 2, frozenUsers: 0, riskAuthorityAvailable: false, highRiskUsers: null, highRiskThreshold: null });
    if (/\/profiles\/\d+\/payment-methods$/.test(p)) return ok({ items: [], total: 0, page: 1, pageSize: 20 });
    const c1 = /^\/api\/admin\/users\/profiles\/([^/]+)\/360$/.exec(p);
    if (c1) return ok(fullProfile(c1[1] === "U13" ? "13" : "12", false));
    const support = /^\/api\/admin\/content\/support-workbench\/customers\/(\d+)(.*)$/.exec(p);
    if (support) {
      const [, id, tail] = support;
      if (!tail) return ok({ customer: customer(id) });
      if (tail === "/full-profile") return ok(fullProfile(id, true));
      if (tail === "/360") return ok({ profile: { identity: group({ userNo: `U${id}`, nickname: names[id], phoneMasked: "138****0012", registeredAt: at }), finance: group({ byCurrency: [] }), devices: group({ records: [] }), risk: group({ level: "LOW", serviceExplanation: "近期账户行为平稳。" }), annotations: group({ systemTags: [], customTags: [], notes: [] }), service: group({ agentName: "专属客服", agentAdminId: 12 }), actions: {} } });
      if (tail === "/devices") return ok(group({ records: [], total: 0, heldCount: 0, fieldStatuses: { heldCount: "READY" }, onlineCount: 0, hashrateTotal: "0" }));
      if (tail === "/flows") return ok(group({ records: [], total: 0 }));
      if (tail === "/maintenance/history") return ok({ customerId: id, cycles: [], executions: [], totalCycles: 0, totalExecutions: 0, pageNum: 1, pageSize: 10 });
    }
    const summary = /(?:\/customers\/(\d+)\/payment-password|\/profiles\/(\d+)\/security\/payment-password)\/summary$/.exec(p);
    if (summary) {
      const id = summary[1] || summary[2];
      if (id === "12") await delayed;
      if (unavailable) return fail(503);
      return ok({ userId: id, observedAt: at, record: options.noRecord ? null : record(id) });
    }
    if (route.request().method() === "POST" && p.endsWith("/payment-password/records/pay-12/release")) { releasePosts++; await mutationGate; return fail(503); }
    const detail = /\/payment-password\/records\/pay-(\d+)$/.exec(p) || /\/payment-password-records\/pay-(\d+)$/.exec(p);
    if (detail) return ok({ record: record(detail[1]), attempts: { userId: detail[1], records: [], total: 0, pageNum: 1, pageSize: 10 }, audit: [] });
    return fail(404);
  });
  return { requests, errors, recover: () => { unavailable = false; }, releaseDelayed: () => releaseDelayed?.(), releasePosts: () => releasePosts, releaseMutation: () => releaseMutation() };
}
const security = (page: Page) => page.getByRole("region", { name: "支付安全", exact: true });
async function captureFonts(page: Page, name: string, containerHeading: string) {
  await page.evaluate(() => document.fonts.ready);
  const selectors = [containerHeading, ".ps-card h3", ".ps-card .ps-reason", ".ps-card .ps-description"];
  const computed = await page.evaluate(selectors => selectors.map(selector => {
    const node = document.querySelector(selector);
    if (!node) return { selector, missing: true };
    const style = getComputedStyle(node);
    return { selector, text: node.textContent, fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight, color: style.color };
  }), selectors);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
  const fontDocument = await cdp.send("DOM.getDocument");
  const platform = [];
  for (const selector of selectors) {
    const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: fontDocument.root.nodeId, selector });
    if (nodeId) platform.push({ selector, ...(await cdp.send("CSS.getPlatformFontsForNode", { nodeId })) });
  }
  await cdp.detach();
  await writeFile(path.join(evidence, `${name}-fonts.json`), JSON.stringify({ computed, platform }, null, 2));
}
test.beforeAll(() => mkdir(evidence, { recursive: true }));

test("real C1 list opens the existing customer detail; login and payment safety remain separate", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/users/search");
  await page.getByText("林海", { exact: true }).first().click();
  await expect(page).toHaveURL(/\/users\/search\/(12|U12)/);
  await expect(security(page)).toContainText("连续输错");
  await expect(security(page).getByRole("button", { name: "解除锁定", exact: true })).toBeDisabled();
  await expect(page.getByRole("heading", { name: "安全与登录设备", exact: true })).toBeVisible();
  expect(state.requests.some(request => request.includes("/profiles/12/security/payment-password/summary"))).toBe(true);
  expect(state.requests.some(request => request.includes("/profiles/U12/security/payment-password/summary"))).toBe(false);
  await security(page).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(evidence, "01-c1-existing-detail.png"), fullPage: true });
  await page.goto("/users/search/U12");
  await expect(security(page)).toContainText("林海的支付密码连续输错");
  expect(state.requests.some(request => request.includes("/profiles/U12/360"))).toBe(true);
  expect(state.requests.some(request => request.includes("/profiles/U12/security/payment-password/summary"))).toBe(false);
  expect(state.errors).toEqual([]);
});

test("existing support full profile shows payment security without requiring login sessions or global authority", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/service/customers/12");
  await expect(security(page)).toContainText("连续输错");
  await expect(page.getByRole("heading", { name: "安全与登录设备", exact: true })).toHaveCount(0);
  expect(state.requests.some(request => request.includes("/customers/12/payment-password/summary"))).toBe(true);
  expect(state.requests.some(request => request.includes("/users/profiles/12/security/payment-password"))).toBe(false);
  await page.screenshot({ path: path.join(evidence, "02-support-existing-full-profile.png"), fullPage: true });
  await captureFonts(page, "support-full-profile", "h1");
  await page.setViewportSize({ width: 1024, height: 1000 });
  expect(await security(page).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: path.join(evidence, "02b-support-compact.png"), fullPage: true });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("support-scope-invalidated", { detail: { customerId: "12" } })));
  await expect(security(page)).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test("actual personal customer list opens its detail drawer, retries payment failure, and switches without stale customer data", async ({ page }) => {
  const state = await fixture(page, { unavailable: true });
  await page.goto("/service/overview?view=my-customers");
  await page.getByRole("button", { name: "林海", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "客户详情", exact: true });
  await expect(drawer).toBeVisible();
  await expect(security(page).getByRole("alert")).toBeVisible();
  await page.screenshot({ path: path.join(evidence, "03-m1-existing-drawer-failure.png"), fullPage: true });
  state.recover();
  await security(page).getByRole("button", { name: /重新加载|重试查询/ }).click();
  await expect(security(page)).toContainText("林海的支付密码连续输错");
  await captureFonts(page, "m1-drawer", ".s5a-drawer h2");
  await page.screenshot({ path: path.join(evidence, "04-m1-existing-drawer-loaded.png"), fullPage: true });
  await page.getByRole("button", { name: "关闭客户详情", exact: true }).click();
  await page.getByRole("button", { name: "陈月", exact: true }).click();
  await expect(security(page)).toContainText("陈月的支付密码需要核对");
  await expect(security(page)).not.toContainText("林海");
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("support-scope-invalidated", { detail: { customerId: "13" } })));
  await expect(drawer).toHaveCount(0);
  expect(state.requests.some(request => request.includes("/users/profiles/"))).toBe(false);
  expect(state.errors).toEqual([]);
});

test("M1 late payment response cannot appear after opening another customer", async ({ page }) => {
  const state = await fixture(page, { delayFirst: true });
  await page.goto("/service/overview?view=my-customers");
  await page.getByRole("button", { name: "林海", exact: true }).click();
  await expect.poll(() => state.requests.some(request => request.includes("/customers/12/payment-password/summary"))).toBe(true);
  await page.getByRole("button", { name: "关闭客户详情", exact: true }).click();
  await page.getByRole("button", { name: "陈月", exact: true }).click();
  await expect(security(page)).toContainText("陈月的支付密码需要核对");
  const lateResponse = page.waitForResponse(response => response.url().includes("/customers/12/payment-password/summary"));
  state.releaseDelayed();
  await lateResponse;
  await expect(security(page)).not.toContainText("林海");
  await page.screenshot({ path: path.join(evidence, "05-m1-switched-customer.png"), fullPage: true });
  expect(state.errors).toEqual([]);
});

test("existing M3 conversation sidebar and its existing profile dialog use scoped payment security", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/service/sessions?customerId=12");
  await expect(security(page)).toContainText("林海的支付密码连续输错");
  await page.screenshot({ path: path.join(evidence, "06-m3-existing-sidebar.png"), fullPage: true });
  await page.getByRole("button", { name: "说明", exact: true }).click();
  await expect(page.getByText("客户服务 360", { exact: true })).toBeVisible();
  await expect(security(page)).toContainText("林海的支付密码连续输错");
  await expect(security(page)).toHaveCount(1);
  await security(page).scrollIntoViewIfNeeded();
  await expect(security(page)).toBeInViewport();
  await page.screenshot({ path: path.join(evidence, "07-m3-existing-profile-dialog.png"), fullPage: true });
  await page.getByRole("button", { name: "返回会话", exact: true }).last().click();
  await expect(security(page)).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("support-scope-invalidated", { detail: { customerId: "12" } })));
  await expect(security(page)).toHaveCount(0);
  expect(state.requests.some(request => request.includes("/users/profiles/"))).toBe(false);
  expect(state.errors).toEqual([]);
  await writeFile(path.join(evidence, "scoped-runtime-requests.json"), JSON.stringify({ requests: state.requests, pageErrors: state.errors }, null, 2));
});

test("no payment exception is shown only after a successful scoped response", async ({ page }) => {
  const state = await fixture(page, { noRecord: true });
  await page.goto("/service/customers/12");
  await expect(security(page)).toContainText(/暂无|没有/);
  await expect(security(page).getByRole("alert")).toHaveCount(0);
  await page.screenshot({ path: path.join(evidence, "08-no-active-payment-exception.png"), fullPage: true });
  expect(state.errors).toEqual([]);
});

test("M1 Escape closes only the top payment dialog and then the existing customer drawer", async ({ page }) => {
  const state = await fixture(page);
  await page.goto("/service/overview?view=my-customers"); await page.getByRole("button", { name: "林海", exact: true }).click();
  const drawer = page.getByRole("dialog", { name: "客户详情", exact: true });
  await security(page).getByRole("button", { name: "查看详情", exact: true }).click();
  const payment = page.getByRole("dialog", { name: "支付密码异常详情", exact: true }); await expect(payment).toBeVisible();
  await page.keyboard.press("Escape"); await expect(payment).toHaveCount(0); await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape"); await expect(drawer).toHaveCount(0);
  expect(state.releasePosts()).toBe(0); expect(state.errors).toEqual([]);
});

test("M1 Escape during payment release cannot close either layer or interrupt original-command recovery", async ({ page }) => {
  const state = await fixture(page, { canRelease: true, holdRelease: true });
  try {
    await page.goto("/service/overview?view=my-customers"); await page.getByRole("button", { name: "林海", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "客户详情", exact: true });
    await security(page).getByRole("button", { name: "解除锁定", exact: true }).click();
    const payment = page.getByRole("dialog", { name: "解除支付密码锁定", exact: true });
    await payment.getByRole("textbox").fill("已经核实用户身份并查明本次异常原因"); await payment.getByRole("checkbox").check(); await payment.getByRole("button", { name: "确认解除", exact: true }).click();
    await expect(payment).toHaveAttribute("aria-busy", "true"); await expect.poll(state.releasePosts).toBe(1);
    await page.keyboard.press("Escape"); await expect(payment).toBeVisible(); await expect(drawer).toBeVisible(); expect(state.releasePosts()).toBe(1);
    state.releaseMutation();
    const pending = page.getByRole("dialog", { name: "支付密码异常详情", exact: true }); await expect(pending.getByRole("button", { name: "查询本次结果" })).toBeVisible();
    await page.keyboard.press("Escape"); await expect(pending).toHaveCount(0); await expect(drawer).toBeVisible();
    expect(state.releasePosts()).toBe(1); expect(state.errors).toEqual([]);
  } finally { state.releaseMutation(); }
});
