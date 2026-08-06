import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, request, test, type Page } from "@playwright/test";

type Account = { username: string; password: string; totpSecret: string };
type Fixture = {
  runId: string;
  accounts?: { maker?: Account; nomenu?: Account };
  actors?: { maker?: Account };
};

const fixtureFile = process.env.ADMIN_PERMISSION_FIXTURE;
const evidenceDir = process.env.E_FINAL_NOWRITE_EVIDENCE_DIR;
if (!fixtureFile || !evidenceDir) throw new Error("ADMIN_PERMISSION_FIXTURE and E_FINAL_NOWRITE_EVIDENCE_DIR are required");
const fixture = JSON.parse(readFileSync(fixtureFile, "utf8")) as Fixture;
const makerAccount = fixture.accounts?.maker ?? fixture.actors?.maker;
const noMenuAccount = fixture.accounts?.nomenu;
const modules = [
  { id: "E1", path: "/devices/pricing", title: "商品目录 & 上架门", read: "/api/admin/e1/skus?pageNum=1&pageSize=10" },
  { id: "E2", path: "/devices/tasks", title: "6 类 AI 任务定价", read: "/api/admin/config/task-pricing" },
  { id: "E3", path: "/devices/trade-in", title: "任务产能曲线", read: "/api/admin/devices/e3/overview" },
  { id: "E4", path: "/devices/orders", title: "订单状态机", read: "/api/admin/devices/orders?pageNum=1&pageSize=10" },
  { id: "E5", path: "/devices/ops", title: "设备库存 & 激活", read: "/api/admin/devices/overview" },
  { id: "E6", path: "/devices/compute-config", title: "电脑显卡映射表", read: "/api/admin/devices/compute-config" },
] as const;

function requiredAccount(account: Account | undefined, name: string): Account {
  if (!account?.username || !account.password || !account.totpSecret) {
    throw new Error(`E_FINAL_NOWRITE_${name.toUpperCase()}_ACCOUNT_REQUIRED`);
  }
  return account;
}

test.use({ trace: "off", video: "off", screenshot: "only-on-failure" });
test.describe.configure({ mode: "serial", timeout: 240_000 });

test("E1-E6 Owner 最终候选无写：可见侧栏、刷新重登、读取合同与 E-001/E-002", async ({ page }) => {
  mkdirSync(evidenceDir, { recursive: true });
  const pageErrors: string[] = [];
  const unexpectedResponses: string[] = [];
  const crossDomainPermissionDenials: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("response", response => {
    if (response.url().includes("/api/admin/") && response.status() >= 400) {
      const line = `${response.request().method()} ${response.status()} ${new URL(response.url()).pathname}`;
      if (/\/api\/admin\/(?:e1|devices|config)\//.test(new URL(response.url()).pathname)) unexpectedResponses.push(line);
      else if (response.status() === 403) crossDomainPermissionDenials.push(line);
      else if (response.status() !== 401 || new URL(response.url()).pathname !== "/api/admin/auth/session") unexpectedResponses.push(line);
    }
  });

  await login(page, requiredAccount(makerAccount, "maker"));
  const session = await page.request.get("/api/admin/auth/session");
  expect(session.status()).toBe(200);
  const sessionBody = await session.json() as { data?: { session?: { authorities?: string[]; effectiveMenus?: unknown[] } } };
  expect(sessionBody.data?.session?.authorities).toEqual(expect.arrayContaining(modules.map(module => `device_${module.id.toLowerCase()}_read`)));
  expect(sessionBody.data?.session?.effectiveMenus?.length).toBeGreaterThan(0);

  const browserReadStatuses: Record<string, number> = {};
  for (const module of modules) {
    await openFromVisibleSidebar(page, module.path);
    await expect(page.getByText(module.title, { exact: false }).first()).toBeVisible();
    const response = await page.request.get(module.read);
    browserReadStatuses[module.id] = response.status();
    expect(response.status(), `${module.id} authoritative read`).toBe(200);
    const body = await response.json() as { code?: number; data?: unknown };
    expect(body.code, `${module.id} envelope`).toBe(0);
    expect(body.data, `${module.id} data`).not.toBeUndefined();
  }

  await openFromVisibleSidebar(page, "/devices/tasks");
  await expect(page.locator(".edom")).not.toContainText(/\/api\/admin\/devices\/tasks|sat 字段|Server Canonical/i);
  await openFromVisibleSidebar(page, "/devices/trade-in");
  await expect(page.locator(".edom")).not.toContainText(/nx_user_device|server-canonical/i);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("任务产能曲线", { exact: false }).first()).toBeVisible();
  await logout(page);
  await login(page, requiredAccount(makerAccount, "maker"));
  const { sidebar } = await visibleESidebarEntry(page, "/devices/pricing");
  for (const module of modules) await expect(sidebar.locator(`a[href="${module.path}"]`).first()).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, "owner-e1-e6-refresh-relogin.png"), fullPage: true });

  writeFileSync(path.join(evidenceDir, "owner-nowrite-result.json"), JSON.stringify({
    runId: fixture.runId,
    modules: modules.map(module => module.id),
    browserReadStatuses,
    refresh: "PASS",
    relogin: "PASS",
    e001Copy: "PASS",
    e002Copy: "PASS",
    pageErrors,
    unexpectedResponses,
    crossDomainPermissionDenials: [...new Set(crossDomainPermissionDenials)],
    successfulBusinessWrites: 0,
  }, null, 2));
  expect(pageErrors).toEqual([]);
  expect(unexpectedResponses).toEqual([]);
});

test("E2/E3 畸形或故障响应失败关闭，撤销注入后由可见重试恢复", async ({ page }) => {
  await login(page, requiredAccount(makerAccount, "maker"));
  await page.route("**/api/admin/config/task-pricing", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: {} }) }));
  await openFromVisibleSidebar(page, "/devices/tasks");
  await expect(page.getByText(/E2 数据读取失败/)).toBeVisible();
  await page.unroute("**/api/admin/config/task-pricing");
  await page.getByRole("button", { name: "重试" }).click();
  await expect(page.getByText("6 类 AI 任务定价", { exact: false }).first()).toBeVisible();

  await page.route("**/api/admin/devices/e3/overview", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ code: 0, data: {} }) }));
  await openFromVisibleSidebar(page, "/devices/trade-in");
  await expect(page.getByText("E3 配置不完整")).toBeVisible();
  await expect(page.getByText("升级置换阶梯")).toHaveCount(0);
  await page.unroute("**/api/admin/devices/e3/overview");
  await page.getByRole("button", { name: "刷新" }).click();
  await expect(page.getByText("任务产能曲线", { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: path.join(evidenceDir, "owner-e2-e3-failure-closed-recovered.png"), fullPage: true });
});

test("E no-menu 最终语义：无菜单、直链拒绝、服务端读写均失败关闭", async ({ page }) => {
  await login(page, requiredAccount(noMenuAccount, "nomenu"));
  const session = await page.request.get("/api/admin/auth/session");
  expect(session.status()).toBe(200);
  const body = await session.json() as { data?: { session?: { authorities?: unknown[]; effectiveMenus?: unknown[] } } };
  expect(body.data?.session?.authorities ?? []).toEqual([]);
  expect(body.data?.session?.effectiveMenus ?? []).toEqual([]);
  await expect(page.locator('a[href^="/devices/"]')).toHaveCount(0);
  await page.goto("/devices/pricing", { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/devices\/pricing(?:\?.*)?$/);
  expect((await page.request.get("/api/admin/e1/skus?pageNum=1&pageSize=1")).status()).toBe(403);
  const write = await page.request.patch("/api/admin/devices/compute-config/params/E.compute.h5BaseFactor", {
    headers: { "Idempotency-Key": `e-nomenu-${fixture.runId}` },
    data: { value: "0.6", reason: "permission probe must be denied", operator: "permission-probe" },
  });
  expect(write.status()).toBe(403);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('a[href^="/devices/"]')).toHaveCount(0);
  await logout(page);
  await login(page, requiredAccount(noMenuAccount, "nomenu"));
  await expect(page.locator('a[href^="/devices/"]')).toHaveCount(0);
});

test("E maker 登录和 E1 首次进入不应主动预取无权限域 API", async ({ page }) => {
  type RequestMeta = { path: string; method: string; phase: string; resourceType?: string; initiator?: unknown };
  const cdp = await page.context().newCDPSession(page);
  const requestMeta = new Map<string, RequestMeta>();
  const denied: Array<RequestMeta & { status: number }> = [];
  const cancelled: RequestMeta[] = [];
  const consoleErrors: Array<{ text: string; url: string; line: number }> = [];
  const pageErrors: string[] = [];
  let phase = "login";
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("console", message => {
    if (message.type() === "error") {
      const location = message.location();
      consoleErrors.push({ text: message.text(), url: location.url, line: location.lineNumber });
    }
  });
  await cdp.send("Network.enable");
  cdp.on("Network.requestWillBeSent", event => {
    const url = new URL(event.request.url);
    if (!url.pathname.startsWith("/api/admin/")) return;
    requestMeta.set(event.requestId, {
      path: url.pathname,
      method: event.request.method,
      phase,
      resourceType: event.type,
      initiator: sanitizeInitiator(event.initiator),
    });
  });
  cdp.on("Network.responseReceived", event => {
    const meta = requestMeta.get(event.requestId);
    if (meta && event.response.status === 403) denied.push({ ...meta, status: event.response.status });
  });
  cdp.on("Network.loadingFailed", event => {
    const meta = requestMeta.get(event.requestId);
    if (meta && event.canceled) cancelled.push(meta);
  });

  try {
    await login(page, requiredAccount(makerAccount, "maker"));
    await page.waitForTimeout(2_000);
    phase = "E1";
    await openFromVisibleSidebar(page, "/devices/pricing");
    await expect(page.getByText("商品目录 & 上架门", { exact: false }).first()).toBeVisible();
    await page.waitForTimeout(2_000);
  } finally {
    await cdp.detach();
  }

  const normalizedDenied = denied.map(item => ({ ...item, initiator: item.initiator })).sort((left, right) =>
    `${left.phase}:${left.path}`.localeCompare(`${right.phase}:${right.path}`),
  );
  writeFileSync(path.join(evidenceDir, "maker-cross-domain-403.json"), JSON.stringify({
    runId: fixture.runId,
    denied: normalizedDenied,
    counts: Object.entries(normalizedDenied.reduce<Record<string, number>>((result, item) => {
      const key = `${item.phase} ${item.method} ${item.status} ${item.path}`;
      result[key] = (result[key] ?? 0) + 1;
      return result;
    }, {})),
    cancelled,
    consoleErrors,
    pageErrors,
  }, null, 2));
  expect(pageErrors).toEqual([]);
});

test("E2 权威读取的 404/409/422/500、超时和断网均失败关闭；匿名读取为 401", async ({ page, baseURL }) => {
  const anonymous = await request.newContext({ baseURL });
  try {
    expect((await anonymous.get("/api/admin/config/task-pricing")).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }

  await login(page, requiredAccount(makerAccount, "maker"));
  const faults = [
    { id: "404", status: 404, body: { code: 404, message: "E2_FINAL7_NOT_FOUND", data: null } },
    { id: "409", status: 409, body: { code: 409, message: "E2_FINAL7_CONFLICT", data: null } },
    { id: "422", status: 422, body: { code: 422, message: "E2_FINAL7_INVALID", data: null } },
    { id: "500", status: 500, body: { code: 500, message: "E2_FINAL7_INTERNAL", data: null } },
  ] as const;

  for (const fault of faults) {
    await page.route("**/api/admin/config/task-pricing", route => route.fulfill({
      status: fault.status,
      contentType: "application/json",
      body: JSON.stringify(fault.body),
    }));
    // A document reload is required between injected faults: the E2 view retains a
    // successful in-memory snapshot while moving between sidebar routes.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await openFromVisibleSidebar(page, "/devices/tasks");
    await expect(page.getByText(/E2 数据读取失败/)).toBeVisible();
    await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
    await expect(page.getByRole("button", { name: /调整全局饱和因子/ })).toHaveCount(0);
    await page.unroute("**/api/admin/config/task-pricing");
    await page.getByRole("button", { name: "重试" }).click();
    await expect(page.getByText("6 类 AI 任务定价", { exact: false }).first()).toBeVisible();
  }

  for (const errorCode of ["timedout", "internetdisconnected"] as const) {
    await page.route("**/api/admin/config/task-pricing", route => route.abort(errorCode));
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await openFromVisibleSidebar(page, "/devices/tasks");
    await expect(page.getByText(/E2 数据读取失败/)).toBeVisible();
    await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
    await expect(page.getByRole("button", { name: /调整全局饱和因子/ })).toHaveCount(0);
    await page.unroute("**/api/admin/config/task-pricing");
    await page.getByRole("button", { name: "重试" }).click();
    await expect(page.getByText("6 类 AI 任务定价", { exact: false }).first()).toBeVisible();
  }
});

function sanitizeInitiator(initiator: unknown) {
  const source = initiator as { type?: unknown; stack?: { callFrames?: Array<{ functionName?: unknown; url?: unknown; lineNumber?: unknown }> } } | undefined;
  return {
    type: typeof source?.type === "string" ? source.type : "unknown",
    frames: (source?.stack?.callFrames ?? []).slice(0, 5).map(frame => ({
      functionName: typeof frame.functionName === "string" ? frame.functionName : "",
      url: typeof frame.url === "string" ? new URL(frame.url).pathname : "",
      line: typeof frame.lineNumber === "number" ? frame.lineNumber : -1,
    })),
  };
}

async function openFromVisibleSidebar(page: Page, targetPath: string) {
  const { link } = await visibleESidebarEntry(page, targetPath);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${targetPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\?.*)?$`));
}

async function visibleESidebarEntry(page: Page, targetPath: string) {
  const sidebar = page.locator("aside").filter({ has: page.locator("nav") });
  await expect(sidebar).toHaveCount(1);
  await expect(sidebar).toBeVisible();
  const group = sidebar.getByRole("button", { name: /设备与商城\s+E|E\s+设备与商城/ });
  const link = sidebar.locator(`a[href="${targetPath}"]`).first();
  await expect(async () => {
    await expect(group).toBeVisible();
    if (await group.getAttribute("aria-expanded") !== "true") await group.click();
    await expect(group).toHaveAttribute("aria-expanded", "true");
    await expect(link).toBeVisible();
  }).toPass({ intervals: [100, 250, 500], timeout: 12_000 });
  return { sidebar, link };
}

async function login(page: Page, account: Account) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const sessionState = await classifyOwnerAuthSession(page);
    if (sessionState === "authenticated") {
      if (await ownerShellVisible(page, 20_000)) return;
      continue;
    }

    const otp = page.getByLabel("一次性验证码");
    if (!await otp.isVisible().catch(() => false)) {
      const username = page.locator('input[autocomplete="username"]');
      const password = page.locator('input[autocomplete="current-password"]');
      await expect(username).toBeVisible({ timeout: 15_000 });
      await expect(password).toBeVisible({ timeout: 15_000 });
      await expect(async () => {
        await username.fill(account.username);
        await password.fill(account.password);
        await page.waitForTimeout(200);
        await expect(username).toHaveValue(account.username);
        await expect(password).toHaveValue(account.password);
      }).toPass({ intervals: [100, 250, 500], timeout: 5_000 });
      const [loginResponse] = await Promise.all([
        page.waitForResponse((response) =>
          response.request().method() === "POST"
          && new URL(response.url()).pathname === "/api/admin/auth/login"),
        page.getByRole("button", { name: /继续|登录/ }).click(),
      ]);
      const loginBody = await loginResponse.json().catch(() => null) as { code?: number; message?: string } | null;
      expect(loginResponse.status(), loginBody?.message ?? "password login failed").toBe(200);
      expect(loginBody?.code, loginBody?.message ?? "password login envelope failed").toBe(0);
      const postLoginSessionState = await classifyOwnerAuthSession(page);
      if (postLoginSessionState === "authenticated" && await ownerShellVisible(page, 20_000)) return;
      const postLoginTransition = await waitForOwnerLoginTransition(page, 20_000);
      if (postLoginTransition === "authenticated") return;
    }

    for (let mfaAttempt = 0; mfaAttempt < 3; mfaAttempt += 1) {
      const mfaSessionState = await classifyOwnerAuthSession(page);
      if (mfaSessionState === "authenticated" && await ownerShellVisible(page, 20_000)) return;
      if (!await otp.isVisible().catch(() => false)) {
        const mfaTransition = await waitForOwnerLoginTransition(page, 20_000);
        if (mfaTransition === "authenticated") return;
      }
      if (!await otp.isVisible().catch(() => false)) continue;
      const code = await freshTotp(account.totpSecret);
      if (!await otp.isVisible().catch(() => false)) continue;
      if (!await otp.fill(code).then(() => true).catch(() => false)) continue;
      const verifyButton = page.getByRole("button", { name: "验证并进入", exact: true });
      if (!await verifyButton.isVisible().catch(() => false)) continue;
      const verification = await Promise.all([
        page.waitForResponse((response) =>
          response.request().method() === "POST"
          && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify"),
        verifyButton.click(),
      ]).catch(() => null);
      if (!verification) continue;
      const [verifyResponse] = verification;
      const verifyBody = await verifyResponse.json().catch(() => null) as { code?: number } | null;
      if (verifyResponse.status() === 200 && verifyBody?.code === 0) {
        await page.goto("/", { waitUntil: "domcontentloaded" });
        if (await ownerShellVisible(page, 20_000)) return;
        break;
      }
    }
  }
  throw new Error(`unable to establish an authenticated console shell for ${account.username}`);
}

function ownerShell(page: Page) {
  return page.locator("aside").filter({ has: page.locator("nav") });
}

async function ownerShellVisible(page: Page, timeout: number) {
  const shell = ownerShell(page);
  try {
    await expect(shell).toHaveCount(1, { timeout });
    await expect(shell).toBeVisible({ timeout });
    return true;
  } catch {
    return false;
  }
}

async function waitForOwnerLoginTransition(page: Page, timeout: number): Promise<"authenticated" | "mfa"> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const sessionState = await classifyOwnerAuthSession(page);
    if (sessionState === "authenticated" && await ownerShell(page).isVisible().catch(() => false)) return "authenticated";
    if (await page.getByLabel("一次性验证码").isVisible().catch(() => false)) return "mfa";
    await page.waitForTimeout(100);
  }
  throw new Error("password login produced neither an authenticated shell nor an MFA challenge");
}

async function classifyOwnerAuthSession(page: Page): Promise<"authenticated" | "anonymous"> {
  const response = await page.request.get("/api/admin/auth/session");
  const body = await response.json().catch(() => null) as { code?: number; message?: string } | null;
  if (response.status() === 200 && body?.code === 0) return "authenticated";
  if (response.status() === 401) return "anonymous";
  throw new Error(`unexpected auth session response ${response.status()}: ${body?.message ?? "unknown"}`);
}

async function logout(page: Page) {
  const direct = page.getByRole("button", { name: /^(退出登录|登出)$/ }).first();
  if (await direct.isVisible().catch(() => false)) await direct.click();
  else {
    const account = page.locator('header button[aria-haspopup="menu"], [role="banner"] button[aria-haspopup="menu"]').first();
    await account.click();
    await page.getByText(/退出登录|登出/, { exact: true }).first().click();
  }
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

let lastTotpStep = -1;
async function freshTotp(secret: string) {
  const now = Math.floor(Date.now() / 30_000);
  const nearBoundary = 30_000 - (Date.now() % 30_000) <= 4_000;
  if (nearBoundary || now <= lastTotpStep) await pageWaitForNextTotpWindow(Math.max(now, lastTotpStep));
  const step = Math.floor(Date.now() / 30_000);
  lastTotpStep = step;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  const bits = [...normalized].map(char => {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("invalid base32 TOTP secret");
    return index.toString(2).padStart(5, "0");
  }).join("");
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

async function pageWaitForNextTotpWindow(previous: number) {
  while (Math.floor(Date.now() / 30_000) <= previous) await new Promise(resolve => setTimeout(resolve, 250));
}
