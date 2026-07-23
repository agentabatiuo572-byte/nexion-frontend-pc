import { expect, test, type Page, type Request, type Response } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.env.I2_EVIDENCE_ROOT ?? "D:/workspace/bug-pic/i-domain-parallel-acceptance-20260722-152611/I2-nova";
const RUN = process.env.I2_RUN ?? "initial";
const EVIDENCE = path.join(ROOT, "evidence", RUN);
const USERNAME = process.env.NEXION_E2E_USERNAME ?? "superadmin";
const CANONICAL_CHANNELS = [
  "welcome", "market", "upgrade", "dailySummary", "tradein",
  "social", "eventClaim", "wrapped", "taskLockMonthly", "quest",
];
const EVENT_DRIVEN_CHANNELS = ["risk-alert", "team_event", "staking_event", "market_event", "weekly-quest-refresh"];

function password(): string {
  const value = process.env.NEXION_E2E_PASSWORD;
  if (!value) throw new Error("NEXION_E2E_PASSWORD is required");
  return value;
}

test.beforeAll(() => fs.mkdirSync(EVIDENCE, { recursive: true }));

test("I2 Nova first-user visible-entry walkthrough", async ({ page }) => {
  const consoleEntries: Array<{ type: string; text: string }> = [];
  const pageErrors: string[] = [];
  const network: Array<{ method: string; url: string; status?: number; failure?: string }> = [];
  const started = new Map<Request, number>();

  page.on("console", (message) => consoleEntries.push({ type: message.type(), text: redact(message.text()) }));
  page.on("pageerror", (error) => pageErrors.push(redact(error.stack ?? error.message)));
  page.on("request", (request) => {
    if (isLocal(request.url())) started.set(request, Date.now());
  });
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
  const novaEntry = page.locator("a[href='/content/nova']");
  await expect(novaEntry).toBeVisible();
  await novaEntry.click();
  await expect(page).toHaveURL(/\/content\/nova$/);
  await expect(page.getByText("I2 数据加载中...")).toHaveCount(0);
  await expect(page.getByText("I2 暂无真实接口数据")).toHaveCount(0);
  await screenshot(page, "02-nova-visible-entry.png");

  const cadenceSection = page.getByText("可调通道节奏表", { exact: true }).locator("xpath=ancestor::section[1]");
  await expect(cadenceSection.locator("tbody tr")).toHaveCount(10);
  for (const key of CANONICAL_CHANNELS) {
    await expect(cadenceSection.getByText(key, { exact: true })).toBeVisible();
  }
  await expect(cadenceSection.getByRole("button", { name: "H1 节奏只读" })).toHaveCount(2);

  const eventDrivenSection = page.getByText("不在 10 频道里的推送(口径闭合)", { exact: true }).locator("xpath=ancestor::section[1]");
  await expect(eventDrivenSection.locator("tbody tr")).toHaveCount(5);
  for (const key of EVENT_DRIVEN_CHANNELS) {
    await expect(eventDrivenSection.getByText(key, { exact: true })).toBeVisible();
  }

  const templateSection = page.getByText("推送模板池(b)", { exact: true }).locator("xpath=ancestor::section[1]");
  await expect(templateSection.locator("tbody tr")).toHaveCount(10);
  await expect(templateSection.getByText("已发布", { exact: true })).toHaveCount(10);
  await expect(page.getByText(/当前合计 100%/)).toBeVisible();
  await expect(page.getByText(/只有「Nova 整体作为一种能力要平台级停掉」才轮到 J 域出手/)).toBeVisible();
  await expect(page.getByText(/阶段由节奏调度页\(H1\)说了算,这页只读跟随/)).toBeVisible();

  const body = await page.locator("body").innerText();
  const buttons = await page.getByRole("button").allTextContents();
  const links = await page.getByRole("link").allTextContents();

  const addChannel = page.getByRole("button", { name: "+ 新增通道" });
  await expect(addChannel).toBeVisible();
  await addChannel.click();
  await expect(page.getByText("新增 Nova 推送通道")).toBeVisible();
  await screenshot(page, "03-new-channel-drawer.png");
  await page.getByRole("button", { name: "取消" }).last().click();

  const editProbability = page.getByRole("button", { name: "编辑全部概率" });
  await expect(editProbability).toBeVisible();
  await editProbability.click();
  await expect(page.getByText(/当前合计：100%/)).toBeVisible();
  await screenshot(page, "04-probability-drawer.png");
  await page.getByRole("button", { name: "取消" }).last().click();

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/content\/nova$/);
  await expect(page.getByText("I2 数据加载中...")).toHaveCount(0);
  await screenshot(page, "05-refresh-persistence.png");

  fs.writeFileSync(path.join(EVIDENCE, "walkthrough.json"), `${JSON.stringify({
    run: RUN,
    url: page.url(),
    body: redact(body),
    buttons,
    links,
    console: consoleEntries,
    pageErrors,
    network,
    pendingLocalRequests: [...started.keys()].map((request) => ({ method: request.method(), url: safeUrl(request.url()) })),
  }, null, 2)}\n`, "utf8");

  expect(pageErrors).toEqual([]);
  const expectedLoginProbe = network.some((entry) => entry.url.includes("/api/admin/auth/session") && entry.status === 401);
  const unexpectedConsoleErrors = consoleEntries.filter((entry) => entry.type === "error")
    .filter((entry) => !(expectedLoginProbe && entry.text === "Failed to load resource: the server responded with a status of 401 (Unauthorized)"));
  expect(unexpectedConsoleErrors).toEqual([]);
  expect(network.some((entry) => entry.url.includes("/api/admin/content/nova/overview") && entry.status === 200)).toBeTruthy();
});

async function visibleLogin(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const username = page.getByLabel("账号", { exact: true });
  if (await username.isVisible().catch(() => false)) {
    const passwordInput = page.getByLabel("密码", { exact: true });
    await expect(username).toBeEditable();
    await expect(passwordInput).toBeEditable();
    await username.click();
    await username.pressSequentially(USERNAME);
    await passwordInput.click();
    await passwordInput.pressSequentially(password());
    await expect(username).toHaveValue(USERNAME);
    await expect(passwordInput).toHaveValue(password());
    await page.getByRole("button", { name: /继续/ }).click();
  }
  await expect(page.getByRole("heading", { name: "运营总览" })).toBeVisible();
}

async function screenshot(page: Page, fileName: string) {
  await page.screenshot({ path: path.join(EVIDENCE, fileName), fullPage: true, caret: "initial" });
}

function isLocal(urlText: string) {
  try {
    return ["127.0.0.1", "localhost"].includes(new URL(urlText).hostname);
  } catch {
    return false;
  }
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
