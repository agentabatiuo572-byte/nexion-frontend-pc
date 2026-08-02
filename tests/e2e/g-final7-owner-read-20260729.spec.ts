import { expect, request as playwrightRequest, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const TOTP_SECRET = process.env.ADMIN_E2E_TOTP_SECRET?.trim();
const AUDIT_USERNAME = process.env.G_AUDIT_E2E_USERNAME?.trim() || USERNAME;
const AUDIT_PASSWORD = process.env.G_AUDIT_E2E_PASSWORD || PASSWORD;
const AUDIT_TOTP_SECRET = process.env.G_AUDIT_E2E_TOTP_SECRET?.trim() || TOTP_SECRET;
const lastTotpStep = new Map<string, number>();
const EVIDENCE = process.env.G_FINAL7_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260729-114336/G/final7-owner";

const modules = [
  { id: "G1", href: "/finance-products/staking", title: "G1 Staking", api: "/api/admin/market/staking" },
  { id: "G2", href: "/finance-products/exchange", title: "G2 兑换风控", api: "/api/admin/market/exchange" },
  { id: "G3", href: "/finance-products/market", title: "G3 NEX 行情引擎", api: "/api/admin/market/nex/curve" },
  { id: "G4", href: "/finance-products/genesis", title: "G4 Genesis 经济", api: "/api/admin/market/nex/genesis?page=1&pageSize=10" },
  { id: "G7", href: "/finance-products/repurchase", title: "G7 复投激励", api: "/api/admin/market/nex/repurchase" },
] as const;

test.describe.configure({ mode: "serial" });

test.beforeAll(() => fs.mkdirSync(EVIDENCE, { recursive: true }));

test("G Final7: supplied actor completes normal MFA", async ({ page }) => {
  await login(page);
  expect((await page.request.get("/api/admin/auth/session")).status()).toBe(200);
  await expect(page.locator("aside")).toBeVisible();
});

test("G Final7: first-user visible sidebar, canonical reads, refresh and relogin", async ({ page }, testInfo) => {
  const diagnostics = { pageErrors: [] as string[], consoleErrors: [] as string[], requestFailures: [] as string[], unexpectedHttp: [] as string[], modules: [] as Array<Record<string, unknown>> };
  page.on("pageerror", (error) => diagnostics.pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") diagnostics.consoleErrors.push(message.text()); });
  page.on("requestfailed", (request) => diagnostics.requestFailures.push(`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`));
  page.on("response", (response) => {
    if (response.status() >= 400 && !response.url().includes("/api/admin/auth/session")) diagnostics.unexpectedHttp.push(`${response.request().method()} ${response.status()} ${response.url()}`);
  });

  const anonymous = await playwrightRequest.newContext({ baseURL: "http://127.0.0.1:3002" });
  for (const module of modules) expect((await anonymous.get(module.api)).status(), `${module.id} unauthenticated BFF must fail closed`).toBe(401);
  await anonymous.dispose();

  await login(page);
  const group = page.getByRole("button", { name: /(金融产品\s*G|G\s*金融产品)/ }).first();
  if (await group.isVisible().catch(() => false)) await group.click();
  for (const module of modules) {
    const link = page.locator(`a[href="${module.href}"]`).first();
    if (!(await link.isVisible().catch(() => false))) await group.click();
    await expect(link, `${module.id} must be discoverable in the visible sidebar`).toBeVisible();
    const apiResponse = page.waitForResponse((response) => response.url().includes(module.api.split("?")[0]) && response.request().method() === "GET");
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${module.href.replaceAll("/", "\\/")}(?:\\?.*)?$`));
    await expect(page.getByText(module.title, { exact: false }).first()).toBeVisible();
    await apiResponse;
    const response = await page.request.get(module.api);
    expect(response.status(), `${module.id} canonical overview`).toBe(200);
    const payload = await response.json();
    expect(payload.code, `${module.id} response code`).toBe(0);
    expect(payload.data?.serverCanonical, `${module.id} must declare canonical server source`).toBe(true);
    diagnostics.modules.push({ id: module.id, api: module.api, sources: payload.data?.sources ?? [], status: response.status() });
    await page.screenshot({ path: path.join(EVIDENCE, `${module.id}-visible.png`), fullPage: true });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(module.title, { exact: false }).first()).toBeVisible();
  }

  await logout(page);
  await login(page);
  if (await group.isVisible().catch(() => false)) await group.click();
  await page.locator('a[href="/finance-products/repurchase"]').first().click();
  await expect(page.getByText("G7 复投激励", { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: path.join(EVIDENCE, "G7-relogin.png"), fullPage: true });
  fs.writeFileSync(path.join(EVIDENCE, "browser-read-diagnostics.json"), JSON.stringify(diagnostics, null, 2));
  await testInfo.attach("G-final7-read-diagnostics", { body: JSON.stringify(diagnostics, null, 2), contentType: "application/json" });
  expect(diagnostics.pageErrors).toEqual([]);
  expect(diagnostics.consoleErrors.filter((entry) => !/favicon|status of 401 \(Unauthorized\)/i.test(entry))).toEqual([]);
  expect(diagnostics.requestFailures.filter((entry) => !entry.includes("net::ERR_ABORTED"))).toEqual([]);
  expect(diagnostics.unexpectedHttp).toEqual([]);
});

test("G Final7: anonymous admin fail-closed and trusted-edge App projections", async ({ request }, testInfo) => {
  const observations: Record<string, unknown> = {};
  for (const module of modules) {
    const response = await request.get(module.api);
    observations[`${module.id}AdminAnonymous`] = { status: response.status() };
    expect(response.status(), `${module.id} anonymous admin read`).toBe(401);
  }

  for (const appPath of [
    "/api/config/staking/pools",
    "/api/config/exchange/caps",
    "/api/config/market/nex",
    "/api/genesis/state",
    "/api/config/repurchase",
  ]) {
    const unresolved = await request.get(`http://127.0.0.1:8110${appPath}`);
    const unresolvedBody = await unresolved.json().catch(() => null);
    observations[`${appPath}:unresolved`] = { status: unresolved.status(), code: unresolvedBody?.code, message: unresolvedBody?.message };
    expect(unresolved.status(), `${appPath} without trusted edge`).toBe(503);
    expect(unresolvedBody?.message, `${appPath} unresolved reason`).toBe("GEO_COUNTRY_UNRESOLVED");

    const projected = await request.get(`http://127.0.0.1:8110${appPath}`, { headers: { "X-Nexion-Edge-Country": "JP" } });
    const projectedBody = await projected.json().catch(() => null);
    observations[`${appPath}:trustedEdge`] = { status: projected.status(), code: projectedBody?.code, serverCanonical: projectedBody?.data?.serverCanonical };
    expect(projected.status(), `${appPath} trusted edge`).toBe(200);
    expect(projectedBody?.code, `${appPath} envelope`).toBe(0);
    expect(projectedBody?.data?.serverCanonical, `${appPath} canonical`).toBe(true);
  }

  for (const userPath of ["/api/stakes", "/api/exchange", "/api/genesis/account", "/api/repurchase/orders"]) {
    const response = await request.get(`http://127.0.0.1:8110${userPath}`, { headers: { "X-Nexion-Edge-Country": "JP" } });
    observations[`${userPath}:anonymous`] = { status: response.status() };
    expect(response.status(), `${userPath} anonymous user command`).toBe(401);
  }
  fs.writeFileSync(path.join(EVIDENCE, "anonymous-app-boundaries.json"), JSON.stringify(observations, null, 2));
  await testInfo.attach("G-final7-anonymous-app-boundaries", { body: JSON.stringify(observations, null, 2), contentType: "application/json" });
});

test("G Final9: B1 recovery and reversible-write preflight is read-only", async ({ page }, testInfo) => {
  await login(page);
  const read = async (url: string) => {
    const response = await page.request.get(url);
    expect(response.status(), url).toBe(200);
    const payload = await response.json();
    expect(payload?.code, url).toBe(0);
    return payload.data as Record<string, any>;
  };
  const [g1, g2, g3, g4, g7] = await Promise.all([
    read("/api/admin/market/staking"),
    read("/api/admin/market/exchange"),
    read("/api/admin/market/nex/curve"),
    read("/api/admin/market/nex/genesis?page=1&pageSize=10"),
    read("/api/admin/market/nex/repurchase"),
  ]);
  const inactiveDay = g3.activeDayIndex === 0 ? 1 : 0;
  const preflight = {
    g1: {
      coverage: g1.coverage ?? null,
      minStake: g1.pools?.find((row: any) => row.tierKey === "usdt30d")?.minStake ?? null,
      recoveryRisk: "raising minStake is tightening; restoring downward may be blocked when B1 is below redline",
    },
    g2: {
      coverage: g2.coverage ?? null,
      swapEnabled: g2.swap?.enabled ?? null,
      fee: g2.caps?.find((row: any) => row.key === "fee")?.value ?? null,
      recoveryRisk: "fee tightening may be writable while restoring may be blocked when B1 is below redline",
    },
    g3: {
      activeDayIndex: g3.activeDayIndex,
      inactiveDayIndex: inactiveDay,
      volatilityPct: g3.frames?.[inactiveDay]?.volatilityPct ?? null,
      recoveryRisk: "inactive-frame volatility is reversible through expectedFrames CAS",
    },
    g4: {
      royalty: g4.params?.find((row: any) => row.key === "royalty")?.value ?? null,
      recoveryRisk: "royalty path is reversible but is not an expectedValue CAS endpoint",
    },
    g7: {
      coverage: g7.coverage ?? null,
      lockDays: g7.params?.find((row: any) => row.key === "lockDays")?.value ?? null,
      recoveryRisk: "lockDays is coverage-neutral in the service amplification predicate",
    },
  };
  fs.writeFileSync(path.join(EVIDENCE, "b1-recovery-preflight.json"), JSON.stringify(preflight, null, 2));
  await testInfo.attach("G-final9-b1-recovery-preflight", { body: JSON.stringify(preflight, null, 2), contentType: "application/json" });
});

test("G Final9: dedicated audit reader can read A2 and A4 only", async ({ page }, testInfo) => {
  await login(page, { username: AUDIT_USERNAME, password: AUDIT_PASSWORD, totpSecret: AUDIT_TOTP_SECRET });
  const observations: Record<string, unknown> = {};
  for (const url of [
    "/api/admin/platform/audit/overview?domain=G",
    "/api/admin/platform/events/overview",
  ]) {
    const response = await page.request.get(url);
    observations[url] = { status: response.status() };
    expect(response.status(), url).toBe(200);
  }
  const crossDomain = await page.request.get("/api/admin/users/overview");
  observations.crossDomain = { path: "/api/admin/users/overview", status: crossDomain.status() };
  expect(crossDomain.status()).toBe(403);
  fs.writeFileSync(path.join(EVIDENCE, "audit-reader-boundary.json"), JSON.stringify(observations, null, 2));
  await testInfo.attach("G-final9-audit-reader-boundary", { body: JSON.stringify(observations, null, 2), contentType: "application/json" });
});

test("G Final7: Murphy fail-closed probes do not mutate product state", async ({ page }, testInfo) => {
  await login(page);
  const observations: Record<string, unknown> = {};
  const probes = [
    { id: "G1", method: "PATCH", path: "/api/admin/market/staking/pools/__invalid__/params/apy", body: { value: "1", reason: "Final7 invalid key must fail closed", operator: USERNAME } },
    { id: "G2", method: "PATCH", path: "/api/admin/market/exchange/params/__invalid__", body: { value: "1", reason: "Final7 invalid key must fail closed", operator: USERNAME } },
    { id: "G3", method: "PATCH", path: "/api/admin/market/nex/curve/controls/pin", body: { value: "D9", expectedValue: "D1", reason: "Final7 invalid enum must fail closed", operator: USERNAME } },
    { id: "G4", method: "PATCH", path: "/api/admin/market/nex/genesis/params/__invalid__", body: { value: "1", reason: "Final7 invalid key must fail closed", operator: USERNAME } },
    { id: "G7", method: "PUT", path: "/api/admin/market/nex/repurchase/config/__invalid__", body: { value: "1", reason: "Final7 invalid key must fail closed", operator: USERNAME } },
  ] as const;
  for (const probe of probes) {
    const response = await page.request.fetch(probe.path, { method: probe.method, headers: { "Idempotency-Key": `g-final7-invalid-${probe.id}-${Date.now()}` }, data: probe.body });
    const body = await response.json().catch(() => null);
    observations[probe.id] = { status: response.status(), body };
    expect(response.status(), `${probe.id} invalid input must not succeed`).toBeGreaterThanOrEqual(400);
    expect(body?.code, `${probe.id} envelope must not report success`).not.toBe(0);
  }
  const unknownG7 = await page.request.get("/api/admin/market/nex/repurchase/orders?status=NOT_A_STATE");
  observations.G7UnknownOrderState = { status: unknownG7.status(), body: await unknownG7.json().catch(() => null) };
  expect(unknownG7.status()).toBeGreaterThanOrEqual(400);
  fs.writeFileSync(path.join(EVIDENCE, "murphy-readonly-probes.json"), JSON.stringify(observations, null, 2));
  await page.screenshot({ path: path.join(EVIDENCE, "murphy-after-probes.png"), fullPage: true });
  await testInfo.attach("G-final7-murphy", { body: JSON.stringify(observations, null, 2), contentType: "application/json" });
});

async function login(page: Page, account = { username: USERNAME, password: PASSWORD, totpSecret: TOTP_SECRET }) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const shell = page.locator("aside");
  const username = page.locator('input[autocomplete="username"]');
  await Promise.race([shell.waitFor({ state: "visible", timeout: 8_000 }), username.waitFor({ state: "visible", timeout: 8_000 })]).catch(() => undefined);
  if (await shell.isVisible()) return;
  await username.fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  const otp = page.locator('input[autocomplete="one-time-code"]');
  await Promise.race([
    shell.waitFor({ state: "visible", timeout: 30_000 }),
    otp.waitFor({ state: "visible", timeout: 30_000 }),
  ]);
  if (await otp.isVisible()) {
    await expect(otp).toBeVisible();
    if (!account.totpSecret) throw new Error("FINAL7_G_NORMAL_MFA_REQUIRED_BUT_ADMIN_E2E_TOTP_SECRET_IS_UNAVAILABLE");
    const verification = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/admin/auth/mfa/verify" && response.request().method() === "POST");
    await otp.fill(await freshTotp(account.totpSecret));
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    expect((await verification).status(), "normal MFA verification").toBe(200);
  }
  await expect(shell).toBeVisible({ timeout: 20_000 });
}

async function logout(page: Page) {
  await page.locator('header button[aria-haspopup="menu"]').last().click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
}

async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  const previous = lastTotpStep.get(secret) ?? -1;
  if (step <= previous) {
    await expect.poll(() => Math.floor(Date.now() / 30_000), { timeout: 35_000 }).toBeGreaterThan(previous);
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) {
    const boundary = Math.floor(Date.now() / 30_000);
    await expect.poll(() => Math.floor(Date.now() / 30_000), { timeout: 5_000 }).toBeGreaterThan(boundary);
  }
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep.set(secret, step);
  return totp(secret);
}

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.toUpperCase().replace(/=+$/g, "").replace(/\s+/g, "");
  let bits = "";
  for (const char of normalized) {
    const value = alphabet.indexOf(char);
    if (value < 0) throw new Error("ADMIN_E2E_TOTP_SECRET_INVALID");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  const input = Buffer.alloc(8);
  input.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(input).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String(((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000)).padStart(6, "0");
}
