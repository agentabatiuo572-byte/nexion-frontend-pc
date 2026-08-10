import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import { expect, test, type Page, type Request } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";
import {
  evaluateModuleHealthSnapshot,
  isUnmarkedBusinessErrorText,
  type ModuleHealthSnapshot,
} from "./pc-module-health-contract";

const USERNAME = requiredEnv("ADMIN_E2E_USERNAME");
const PASSWORD = requiredEnv("ADMIN_E2E_PASSWORD");
const TOTP_SECRET = requiredEnv("ADMIN_E2E_TOTP_SECRET");
const EXPECTED_BUILD_ID = requiredEnv("PC_FINAL_BUILD_ID");
const EVIDENCE_DIR = requiredEnv("PC_FINAL_ACCEPTANCE_EVIDENCE_DIR");

const MODULES = CONSOLE_NAV.flatMap((domain) =>
  domain.l2.map((module) => ({
    ...module,
    domainCode: domain.code,
    domainName: domain.name,
  })),
);

type RuntimeEvidence = {
  pageErrors: string[];
  consoleErrors: string[];
  admin5xx: string[];
  adminHttpErrors: string[];
  adminRequestFailures: string[];
  requestFailures: string[];
  expectedNavigationAborts: string[];
  successfulAdminResponses: string[];
  successfulResponses: string[];
  expectedAnonymous401: string[];
  firstPass: string[];
  refreshed: string[];
  backPass: string[];
  reloginPass: string[];
};

test.use({ trace: "on", screenshot: "on" });
test.describe.configure({ mode: "serial" });

test("75 个模块统一锁定：侧栏首轮、逐页刷新、浏览器返回、退出重登后复跑", async ({ page }) => {
  test.setTimeout(3_600_000);
  expect(MODULES, "lib/nav/console-nav.ts 必须仍是 75 模块唯一真源").toHaveLength(75);
  expect(CONSOLE_NAV, "导航必须仍为 A–M 共 13 个域").toHaveLength(13);
  expect(new Set(MODULES.map((module) => module.id)).size, "模块编号不允许重复").toBe(75);
  expect(new Set(MODULES.map((module) => module.path)).size, "模块路径不允许重复").toBe(75);
  expect(EXPECTED_BUILD_ID, "PC_FINAL_BUILD_ID 必须绑定锁定候选").toBeTruthy();
  expect(fs.readFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim(), "本地候选 Build ID 必须匹配锁定值")
    .toBe(EXPECTED_BUILD_ID);
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

  const evidence: RuntimeEvidence = {
    pageErrors: [],
    consoleErrors: [],
    admin5xx: [],
    adminHttpErrors: [],
    adminRequestFailures: [],
    requestFailures: [],
    expectedNavigationAborts: [],
    successfulAdminResponses: [],
    successfulResponses: [],
    expectedAnonymous401: [],
    firstPass: [],
    refreshed: [],
    backPass: [],
    reloginPass: [],
  };
  let currentModule = "login";
  const requestOrigins = new WeakMap<Request, string>();
  let pendingAdminRequests = 0;
  let lastAdminActivityAt = Date.now();

  page.on("pageerror", (error) => {
    evidence.pageErrors.push(`${currentModule}: ${error.message}`);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      if (
        (currentModule === "login" || currentModule === "relogin")
        && /^Failed to load resource: the server responded with a status of 401 \(Unauthorized\)$/i.test(message.text())
      ) {
        return;
      }
      evidence.consoleErrors.push(`${currentModule}: ${message.text()}`);
    }
  });
  page.on("request", (request) => {
    requestOrigins.set(request, currentModule);
    if (isIdleTrackedAdminRequest(request.url())) {
      pendingAdminRequests += 1;
      lastAdminActivityAt = Date.now();
    }
  });
  const finishRequest = (url: string) => {
    if (isIdleTrackedAdminRequest(url)) {
      pendingAdminRequests = Math.max(0, pendingAdminRequests - 1);
      lastAdminActivityAt = Date.now();
    }
  };
  page.on("requestfinished", (request) => finishRequest(request.url()));
  page.on("requestfailed", (request) => {
    const originModule = requestOrigins.get(request) ?? "unattributed";
    const detail =
      `${originModule}: ${request.method()} ${pathOf(request.url())} ${request.failure()?.errorText ?? "REQUEST_FAILED"}`;
    if (request.failure()?.errorText === "net::ERR_ABORTED") {
      evidence.expectedNavigationAborts.push(detail);
    } else {
      evidence.requestFailures.push(detail);
      if (isIdleTrackedAdminRequest(request.url())) evidence.adminRequestFailures.push(detail);
    }
    finishRequest(request.url());
  });
  page.on("response", async (response) => {
    const originModule = requestOrigins.get(response.request()) ?? "unattributed";
    const responsePath = pathOf(response.url());
    const detail = `${originModule}: ${response.request().method()} ${response.status()} ${responsePath}`;
    if (response.status() < 400) {
      evidence.successfulResponses.push(
        `${originModule}: ${response.request().method()} ${responsePath} ${response.status()}`,
      );
    }
    if (!response.url().includes("/api/admin/")) return;
    if (
      response.status() === 401
      && responsePath === "/api/admin/auth/session"
      && (originModule === "login" || originModule === "relogin")
    ) {
      evidence.expectedAnonymous401.push(detail);
      return;
    }
    if (response.status() >= 500) evidence.admin5xx.push(detail);
    else if (response.status() >= 400) evidence.adminHttpErrors.push(detail);
    else {
      evidence.successfulAdminResponses.push(
        `${originModule}: ${response.request().method()} ${responsePath} ${response.status()}`,
      );
    }
  });

  try {
    await loginFromVisibleEntry(page);
    await waitForAdminQuiet(() => ({ pendingAdminRequests, lastAdminActivityAt }), "初次登录后的全局请求");

    for (const [moduleIndex, module] of MODULES.entries()) {
      currentModule = `${module.id}-first`;
      await test.step(`${module.id} 首轮侧栏进入`, async () => {
        await openFromVisibleSidebar(page, module);
        await expectHealthyModule(page, module, () => ({ pendingAdminRequests, lastAdminActivityAt }));
        evidence.firstPass.push(module.id);
      });

      currentModule = `${module.id}-refresh`;
      await test.step(`${module.id} 刷新保持`, async () => {
        await page.reload({ waitUntil: "domcontentloaded" });
        await expect(page).toHaveURL(new RegExp(`${escapeRegExp(module.path)}(?:\\?.*)?$`));
        await expectHealthyModule(page, module, () => ({ pendingAdminRequests, lastAdminActivityAt }));
        evidence.refreshed.push(module.id);
      });

      const nextModule = MODULES[(moduleIndex + 1) % MODULES.length];
      currentModule = `${module.id}-back-setup`;
      await test.step(`${module.id} 浏览器返回准备`, async () => {
        await openFromVisibleSidebar(page, nextModule);
        await expectHealthyModule(page, nextModule, () => ({ pendingAdminRequests, lastAdminActivityAt }));
      });
      currentModule = `${module.id}-back`;
      await test.step(`${module.id} 浏览器返回保持`, async () => {
        await page.goBack({ waitUntil: "domcontentloaded" });
        await expect(page).toHaveURL(new RegExp(`${escapeRegExp(module.path)}(?:\\?.*)?$`));
        await expectHealthyModule(page, module, () => ({ pendingAdminRequests, lastAdminActivityAt }));
        evidence.backPass.push(module.id);
      });
    }

    currentModule = "logout";
    await logoutFromVisibleControl(page);
    currentModule = "relogin";
    await loginFromVisibleEntry(page);
    await waitForAdminQuiet(() => ({ pendingAdminRequests, lastAdminActivityAt }), "重登后的全局请求");

    for (const module of MODULES) {
      currentModule = `${module.id}-relogin`;
      await test.step(`${module.id} 重登后侧栏复跑`, async () => {
        await openFromVisibleSidebar(page, module);
        await expectHealthyModule(page, module, () => ({ pendingAdminRequests, lastAdminActivityAt }));
        evidence.reloginPass.push(module.id);
      });
    }

    expect(evidence.firstPass).toEqual(MODULES.map((module) => module.id));
    expect(evidence.refreshed).toEqual(MODULES.map((module) => module.id));
    expect(evidence.backPass).toEqual(MODULES.map((module) => module.id));
    expect(evidence.reloginPass).toEqual(MODULES.map((module) => module.id));
    expect(evidence.pageErrors, "全候选期间不允许 pageerror").toEqual([]);
    expect(evidence.consoleErrors, "全候选期间不允许控制台 error").toEqual([]);
    expect(evidence.admin5xx, "全候选期间 /api/admin/* 不允许 5xx").toEqual([]);
    expect(evidence.adminHttpErrors, "只读统一锁定期间 /api/admin/* 不允许非预期 4xx").toEqual([]);
    expect(evidence.adminRequestFailures, "全候选期间 /api/admin/* 不允许网络失败").toEqual([]);
    expect(evidence.requestFailures, "全候选期间不允许真实网络失败").toEqual([]);
    const unpairedNavigationAborts = evidence.expectedNavigationAborts.filter((abort) => {
      const signature = abort.replace(/\s+net::ERR_ABORTED$/, "");
      return !evidence.successfulResponses.some((success) => success.startsWith(`${signature} `));
    });
    expect(
      unpairedNavigationAborts,
      "导航取消仅在同模块、同方法、同路径出现替代成功响应时才允许豁免",
    ).toEqual([]);
    expect(evidence.expectedAnonymous401.length, "首次从匿名登录页恢复会话时必须得到预期 401").toBeGreaterThanOrEqual(1);
  } finally {
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, "final-75-runtime.json"),
      JSON.stringify(
        {
          buildId: process.env.PC_FINAL_BUILD_ID ?? "unknown",
          completedAt: new Date().toISOString(),
          ...evidence,
        },
        null,
        2,
      ),
      "utf8",
    );
  }
});

async function loginFromVisibleEntry(page: Page) {
  const username = page.locator('input[autocomplete="username"]');
  if (!(await username.isVisible().catch(() => false))) {
    const anonymousSessionPromise = page.waitForResponse(
      (response) =>
        pathOf(response.url()) === "/api/admin/auth/session"
        && response.request().method() === "GET",
      { timeout: 20_000 },
    );
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const anonymousSession = await anonymousSessionPromise;
    expect(anonymousSession.status(), "首次进入登录页必须完成匿名会话探测").toBe(401);
  }
  await expect(username, "必须从可见登录页进入").toBeVisible({ timeout: 20_000 });
  await username.fill(USERNAME);
  await page.locator('input[autocomplete="current-password"]').fill(PASSWORD);
  const loginResponsePromise = page.waitForResponse(
    (response) =>
      pathOf(response.url()) === "/api/admin/auth/login"
      && response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await page.getByRole("button", { name: /^(登录|继续)$/ }).click();
  const loginResponse = await loginResponsePromise;
  expect(loginResponse.status(), "登录 POST 必须成功").toBeLessThan(400);
  const otp = page.getByLabel("一次性验证码");
  if (await otp.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await otp.fill(await freshTotp(TOTP_SECRET));
    const verifyResponsePromise = page.waitForResponse(
      (response) =>
        pathOf(response.url()) === "/api/admin/auth/mfa/verify"
        && response.request().method() === "POST",
      { timeout: 20_000 },
    );
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const verifyResponse = await verifyResponsePromise;
    expect(verifyResponse.status(), "MFA 验证必须成功").toBeLessThan(400);
  }
  await expect(page.locator("aside"), "登录后必须显示侧栏").toBeVisible({ timeout: 20_000 });
}

async function logoutFromVisibleControl(page: Page) {
  const accountMenu = page.locator('header button[aria-haspopup="menu"]').first();
  await expect(accountMenu, "顶栏当前账号菜单必须可见").toBeVisible();
  await accountMenu.click();
  const logout = page.getByRole("button", { name: "退出登录", exact: true });
  await expect(logout, "退出登录必须是可见控件").toBeVisible();
  const logoutResponsePromise = page.waitForResponse(
    (response) =>
      pathOf(response.url()) === "/api/admin/auth/logout"
      && response.request().method() === "POST",
    { timeout: 20_000 },
  );
  await logout.click();
  const logoutResponse = await logoutResponsePromise;
  expect(logoutResponse.status(), "退出 POST 必须成功").toBeLessThan(400);
  await expect(page.locator('input[autocomplete="username"]'), "退出后必须回到登录页").toBeVisible({
    timeout: 20_000,
  });
}

async function openFromVisibleSidebar(
  page: Page,
  module: (typeof MODULES)[number],
) {
  const link = page.locator(`aside a[href="${module.path}"]`).first();
  if (!(await link.isVisible().catch(() => false))) {
    const domainButton = page
      .locator("aside")
      .getByRole("button", {
        name: new RegExp(
          `(${escapeRegExp(module.domainName)}\\s+${escapeRegExp(module.domainCode)}`
          + `|${escapeRegExp(module.domainCode)}\\s+${escapeRegExp(module.domainName)})`,
        ),
      })
      .first();
    await expect(domainButton, `${module.domainCode} 域侧栏分组必须可见`).toBeVisible();
    await domainButton.click();
  }
  await expect(link, `${module.id} 侧栏入口必须可见`).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(module.path)}(?:\\?.*)?$`), {
    timeout: 20_000,
  });
}

async function expectHealthyModule(
  page: Page,
  module: (typeof MODULES)[number],
  requestState: () => { pendingAdminRequests: number; lastAdminActivityAt: number },
) {
  const main = page.locator("main");
  await expect(main.getByRole("heading", { name: module.name, exact: true }).first(), `${module.id} 主内容页头必须匹配模块名称`)
    .toBeVisible({ timeout: 20_000 });
  await expect(main.getByText(new RegExp(`\\b${escapeRegExp(module.id)}\\b`)).first(), `${module.id} 主内容页面标识必须可见`)
    .toBeVisible({ timeout: 20_000 });
  await waitForAdminQuiet(requestState, `${module.id} 的后台请求`);
  await waitForModuleMediaQuiet(page, module);
  await expect.poll(async () => (await collectModuleHealthSnapshot(main)).visibleLoadingCount, {
    message: `${module.id} 不允许持续 loading/skeleton/aria-busy 假装页面已完成`,
    timeout: 20_000,
    intervals: [100, 250, 500, 1_000],
  }).toBe(0);
  const healthSnapshot = await collectModuleHealthSnapshot(main);
  expect(
    evaluateModuleHealthSnapshot(module.id, healthSnapshot),
    `${module.id} 必须有实质内容，且不能用已处理错误卡或未批准 role=alert 报绿`,
  ).toEqual([]);
}

async function collectModuleHealthSnapshot(main: ReturnType<Page["locator"]>): Promise<ModuleHealthSnapshot> {
  const loadingSelectors = main.locator(
    '[aria-busy="true"], [data-loading="true"], [data-testid*="skeleton" i], [class*="skeleton" i], .animate-pulse',
  );
  const loadingText = main.getByText(/^(?:加载中|正在加载|Loading)(?:…|\.\.\.)?$/i);
  const visibleCount = (locator: typeof loadingSelectors) => locator.evaluateAll((elements) =>
    elements.filter((element) => {
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    }).length);

  const semanticErrorSnapshot = await main.evaluate((mainElement) => {
    const markerSelector = '[data-module-health-state="error"], [data-module-health="error"], [data-state="error"]';
    const excludedSelector = '[role="alert"], [data-module-health-state], [data-module-health], [data-module-health-exempt="guidance"]';
    const candidateSelector = "p, div, span, li, td, th, pre";
    const isVisible = (element: Element) => {
      const style = window.getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
    };
    const normalize = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
    const markers = Array.from(mainElement.querySelectorAll(markerSelector)).filter(isVisible);
    const candidates = Array.from(mainElement.querySelectorAll(candidateSelector))
      .filter(isVisible)
      .filter((element) => !element.closest(excludedSelector))
      .filter((element) => !Array.from(element.children).some((child) => isVisible(child) && normalize(child.textContent).length > 0))
      .map((element) => normalize(element.textContent))
      .filter((value) => value.length > 0 && value.length <= 300);

    return {
      terminalErrorMarkerCount: markers.length,
      candidateTexts: Array.from(new Set(candidates)),
    };
  });

  return {
    text: await main.innerText(),
    headingCount: await main.locator("h1, h2").count(),
    landmarkCount: await main.locator('section, table, form, [role="region"]').count(),
    controlCount: await main.locator("button, input, select, textarea, a").count(),
    visibleLoadingCount: await visibleCount(loadingSelectors) + await visibleCount(loadingText),
    alertTexts: await main.locator('[role="alert"]').allTextContents(),
    semanticErrorScanComplete: true,
    terminalErrorMarkerCount: semanticErrorSnapshot.terminalErrorMarkerCount,
    unmarkedBusinessErrorTexts: semanticErrorSnapshot.candidateTexts.filter(isUnmarkedBusinessErrorText),
  };
}

async function waitForModuleMediaQuiet(
  page: Page,
  module: (typeof MODULES)[number],
) {
  if (module.id !== "M1") return;
  await expect.poll(() => page.evaluate(() => {
    const images = Array.from(document.querySelectorAll<HTMLImageElement>("main img"));
    return images.length > 0 && images.every((image) => image.complete);
  }), {
    message: "M1 客服头像应完成加载后再按真实用户节奏离开页面",
    timeout: 20_000,
    intervals: [100, 250, 500, 1_000],
  }).toBe(true);
  await page.waitForTimeout(250);
}

async function waitForAdminQuiet(
  requestState: () => { pendingAdminRequests: number; lastAdminActivityAt: number },
  label: string,
) {
  await expect.poll(() => {
    const state = requestState();
    return state.pendingAdminRequests === 0 && Date.now() - state.lastAdminActivityAt >= 750;
  }, {
    message: `${label}应完成并保持 750ms 静默，不允许靠初始零值跳过`,
    timeout: 20_000,
    intervals: [100, 250, 500, 1_000],
  }).toBe(true);
}

function isIdleTrackedAdminRequest(url: string) {
  if (!url.includes("/api/admin/")) return false;
  try {
    return !new URL(url).pathname.endsWith("/stream");
  } catch {
    return !url.split("?", 1)[0].endsWith("/stream");
  }
}

function pathOf(url: string) {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

let lastTotpStep = -1;

async function freshTotp(secret: string) {
  const currentStep = Math.floor(Date.now() / 30_000);
  const millisecondsRemaining = 30_000 - (Date.now() % 30_000);
  if (currentStep <= lastTotpStep || millisecondsRemaining <= 5_000) {
    await expect.poll(() => Math.floor(Date.now() / 30_000), {
      timeout: 35_000,
      intervals: [250],
    }).toBeGreaterThan(currentStep <= lastTotpStep ? lastTotpStep : currentStep);
  }
  lastTotpStep = Math.floor(Date.now() / 30_000);
  return totp(secret);
}

function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("Invalid base32 TOTP secret");
    bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value =
    ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(value % 1_000_000).padStart(6, "0");
}

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
