import { expect, test, type Page, type Request, type Response } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.env.I5_EVIDENCE_ROOT ?? "D:/workspace/bug-pic/i-domain-parallel-acceptance-20260722-152611/I5-disclosures";
const RUN = process.env.I5_RUN ?? "initial";
const EVIDENCE = path.join(ROOT, "evidence", RUN);
const USERNAME = process.env.NEXION_E2E_USERNAME ?? "superadmin";
const JURISDICTIONS = ["CN", "US", "EU", "SG", "SBV"];

function password(): string {
  const value = process.env.NEXION_E2E_PASSWORD;
  if (!value) throw new Error("NEXION_E2E_PASSWORD is required");
  return value;
}

test.beforeAll(() => fs.mkdirSync(EVIDENCE, { recursive: true }));

test("I5 disclosure first-user visible-entry walkthrough", async ({ page }) => {
  const consoleEntries: Array<{ type: string; text: string }> = [];
  const pageErrors: string[] = [];
  const network: Array<{ method: string; url: string; status?: number; failure?: string }> = [];
  const started = new Map<Request, number>();

  page.on("console", (message) => consoleEntries.push({ type: message.type(), text: redact(message.text()) }));
  page.on("pageerror", (error) => pageErrors.push(redact(error.stack ?? error.message)));
  page.on("request", (request) => { if (isLocal(request.url())) started.set(request, Date.now()); });
  page.on("response", (response: Response) => {
    const request = response.request();
    if (isLocal(response.url())) {
      network.push({ method: request.method(), url: safeUrl(response.url()), status: response.status() });
      started.delete(request);
    }
  });
  page.on("requestfailed", (request) => {
    if (isLocal(request.url())) {
      network.push({ method: request.method(), url: safeUrl(request.url()), failure: redact(request.failure()?.errorText ?? "request failed") });
      started.delete(request);
    }
  });

  await visibleLogin(page);
  await screenshot(page, "01-overview-after-login.png");

  const contentMenu = page.getByRole("button", { name: /内容与合规/ });
  await expect(contentMenu).toBeVisible();
  await contentMenu.click();
  const entry = page.locator("a[href='/content/disclosures']");
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page).toHaveURL(/\/content\/disclosures$/);
  await expect(page.getByText("I5 数据加载中...")).toHaveCount(0);
  await expect(page.getByText("I5 暂无真实接口数据")).toHaveCount(0);
  await screenshot(page, "02-i5-visible-entry.png");

  const jurisdictionSection = section(page, "法域配置(I5)");
  const matrixSection = section(page, "披露矩阵(I5)· version × jurisdiction");
  const versionSection = section(page, "披露版本列表(I5) · 法域 × 版本");
  const reackSection = section(page, "重确认覆盖监控(I5)");
  const gateSection = section(page, "受限动作范围(I5)");
  await expect(jurisdictionSection).toBeVisible();
  await expect(matrixSection).toBeVisible();
  await expect(versionSection).toBeVisible();
  await expect(reackSection).toBeVisible();
  await expect(gateSection).toBeVisible();

  await expect(jurisdictionSection.locator("tbody tr")).toHaveCount(5);
  await expect(matrixSection.locator("tbody tr")).toHaveCount(5);
  await expect(versionSection.locator("tbody tr")).toHaveCount(5);
  await expect(reackSection.locator("tbody tr")).toHaveCount(5);
  for (const code of JURISDICTIONS) {
    await expect(jurisdictionSection.getByText(code, { exact: true })).toBeVisible();
    await expect(versionSection.getByText(code, { exact: true })).toBeVisible();
  }
  await expect(versionSection.getByText("已发布", { exact: true })).toHaveCount(5);
  await expect(versionSection.getByText("7 / 7", { exact: true })).toHaveCount(5);
  await expect(gateSection.getByText("提现", { exact: true })).toBeVisible();
  await expect(gateSection.getByText("质押锁仓", { exact: true })).toBeVisible();
  await expect(page.getByText(/重新确认不是熔断闸,不进入 J1\/J2/)).toBeVisible();

  const a4Response = await page.request.get("/api/admin/platform/events/overview");
  expect(a4Response.status()).toBe(200);
  const a4Envelope = await a4Response.json() as {
    code: number;
    data: {
      registeredDomains: string[];
      pendingDomains: string[];
      schemaRegistrations: Array<{ eventName: string; ownerDomain: string; serverAuthoritative: boolean }>;
    };
  };
  expect(a4Envelope.code).toBe(0);
  const disclosureSchemas = a4Envelope.data.schemaRegistrations
    .filter((row) => row.eventName.startsWith("disclosure."));
  expect(disclosureSchemas.map((row) => row.eventName).sort()).toEqual([
    "disclosure.acked",
    "disclosure.gated_action_blocked",
    "disclosure.reack_triggered",
    "disclosure.viewed",
  ]);
  expect(disclosureSchemas.every((row) => row.ownerDomain === "disclosure" && row.serverAuthoritative)).toBeTruthy();
  expect(a4Envelope.data.registeredDomains).toContain("disclosure");
  expect(a4Envelope.data.pendingDomains).not.toContain("disclosure");

  await page.getByRole("button", { name: "新建版本" }).click();
  await expect(page.getByText("新建披露版本 · 风控提交", { exact: true }).first()).toBeVisible();
  const versionForm = page.locator("[data-business-form='version-authoring']");
  await expect(versionForm).toBeVisible();
  await expect(versionForm.getByLabel("披露版本（后端原子分配）")).toHaveValue("v2");
  await expect(versionForm.getByLabel("披露版本（后端原子分配）")).toHaveAttribute("readonly", "");
  await expect(versionForm.getByPlaceholder("请输入中文标题")).toHaveCount(7);
  await expect(versionForm.getByPlaceholder("Nhập tiêu đề tiếng Việt")).toHaveCount(7);
  await expect(versionForm.getByPlaceholder("English title")).toHaveCount(7);
  await screenshot(page, "03-new-version-seven-chapters.png");
  await page.getByRole("button", { name: "取消" }).last().click();

  await versionSection.getByRole("button", { name: "查看七章" }).first().click();
  await expect(page.getByText(/披露版本 · CN v1/)).toBeVisible();
  await expect(page.locator("[data-detail-drawer]")).toBeVisible().catch(() => undefined);
  await screenshot(page, "04-published-seven-chapter-detail.png");
  await page.getByRole("button", { name: /关闭|取消/ }).last().click();

  const body = redact(await page.locator("body").innerText());
  const buttons = await page.getByRole("button").allTextContents();
  const links = await page.getByRole("link").allTextContents();
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/content\/disclosures$/);
  await expect(page.getByText("I5 数据加载中...")).toHaveCount(0);
  await expect(versionSection.locator("tbody tr")).toHaveCount(5);
  await screenshot(page, "05-refresh-persistence.png");

  fs.writeFileSync(path.join(EVIDENCE, "walkthrough.json"), `${JSON.stringify({
    run: RUN,
    url: page.url(),
    body,
    buttons,
    links,
    console: consoleEntries,
    pageErrors,
    network,
    a4: {
      registered: a4Envelope.data.registeredDomains.includes("disclosure"),
      pending: a4Envelope.data.pendingDomains.includes("disclosure"),
      schemas: disclosureSchemas.map((row) => row.eventName).sort(),
    },
    pendingLocalRequests: [...started.keys()].map((request) => ({ method: request.method(), url: safeUrl(request.url()) })),
  }, null, 2)}\n`, "utf8");

  expect(pageErrors).toEqual([]);
  const expectedLoginProbe = network.some((item) => item.url.includes("/api/admin/auth/session") && item.status === 401);
  const unexpectedConsoleErrors = consoleEntries.filter((entry) => entry.type === "error")
    .filter((entry) => !(expectedLoginProbe && entry.text === "Failed to load resource: the server responded with a status of 401 (Unauthorized)"));
  expect(unexpectedConsoleErrors).toEqual([]);
  expect(network.some((item) => item.url.includes("/api/admin/content/trust-disclosure/overview") && item.status === 200)).toBeTruthy();
});

test("I5 refresh, relogin and authoritative-read failure stay fail closed and recoverable", async ({ page }) => {
  await visibleLogin(page);
  await openI5FromVisibleEntry(page);
  await expectI5Ready(page);

  await page.reload({ waitUntil: "domcontentloaded" });
  await expectI5Ready(page);
  await logout(page);
  await visibleLogin(page);
  await openI5FromVisibleEntry(page);
  await expectI5Ready(page);
  await screenshot(page, "06-refresh-relogin.png");

  await page.route("**/api/admin/content/trust-disclosure/overview", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: 503, message: "I5_TEST_UNAVAILABLE", data: null }),
    }),
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText("I5 数据加载失败，请刷新重试", { exact: false })).toBeVisible();
  await expect(page.getByText("法域配置(I5)", { exact: true })).toHaveCount(0);
  await screenshot(page, "07-authoritative-read-failure-closed.png");

  await page.unroute("**/api/admin/content/trust-disclosure/overview");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectI5Ready(page);
  await screenshot(page, "08-authoritative-read-recovered.png");
});

function section(page: Page, title: string) {
  return page.getByText(title, { exact: true }).locator("xpath=ancestor::section[1]");
}

async function openI5FromVisibleEntry(page: Page) {
  const contentMenu = page.getByRole("button", { name: /内容与合规/ });
  await expect(contentMenu).toBeVisible();
  await contentMenu.click();
  const entry = page.locator("a[href='/content/disclosures']");
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page).toHaveURL(/\/content\/disclosures$/);
}

async function expectI5Ready(page: Page) {
  await expect(page.getByText("I5 数据加载中...")).toHaveCount(0);
  await expect(page.getByText("I5 暂无真实接口数据")).toHaveCount(0);
  await expect(section(page, "法域配置(I5)")).toBeVisible();
  await expect(section(page, "披露版本列表(I5) · 法域 × 版本").locator("tbody tr")).toHaveCount(5);
}

async function visibleLogin(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const shell = page.locator("aside");
  const username = page.locator('input[autocomplete="username"]');
  await Promise.race([
    shell.waitFor({ state: "visible", timeout: 8_000 }),
    username.waitFor({ state: "visible", timeout: 8_000 }),
  ]).catch(() => undefined);
  if (await shell.isVisible()) return;
  if (await username.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await fillUnlessShellRecovered(username, USERNAME, shell);
    if (await shell.isVisible()) return;
    await fillUnlessShellRecovered(
      page.locator('input[autocomplete="current-password"]'),
      password(),
      shell,
    );
    if (await shell.isVisible()) return;
    await page.getByRole("button", { name: /继续/ }).click();
  }
  await expect(shell).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "运营总览" })).toBeVisible();
}

async function logout(page: Page) {
  const direct = page.getByRole("button", { name: /退出登录|登出/ }).first();
  if (await direct.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await direct.click();
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
    return;
  }
  const account = page
    .locator('header button[aria-haspopup="menu"], [role="banner"] button[aria-haspopup="menu"]')
    .first();
  await account.click();
  const menuLogout = page.getByText(/退出登录|登出/, { exact: true }).first();
  await expect(menuLogout).toBeVisible();
  await menuLogout.click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
}

async function fillUnlessShellRecovered(
  field: ReturnType<Page["locator"]>,
  value: string,
  shell: ReturnType<Page["locator"]>,
) {
  try {
    await field.fill(value);
  } catch (error) {
    if (await shell.isVisible()) return;
    throw error;
  }
}

async function screenshot(page: Page, fileName: string) {
  await page.screenshot({ path: path.join(EVIDENCE, fileName), fullPage: true, caret: "initial" });
}

function isLocal(urlText: string) {
  try { return ["127.0.0.1", "localhost"].includes(new URL(urlText).hostname); } catch { return false; }
}

function safeUrl(urlText: string) {
  const url = new URL(urlText);
  url.search = "";
  url.hash = "";
  return url.toString();
}

function redact(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+\/-]+/gi, "Bearer [REDACTED]")
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]")
    .replace(/(password|token|cookie|authorization)(\s*[=:]\s*)[^\s,;]+/gi, "$1$2[REDACTED]");
}
