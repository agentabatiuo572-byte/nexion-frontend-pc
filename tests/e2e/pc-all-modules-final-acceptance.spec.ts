import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const EXPECTED_BUILD_ID = process.env.PC_FINAL_BUILD_ID?.trim();
const EVIDENCE_DIR =
  process.env.PC_FINAL_ACCEPTANCE_EVIDENCE_DIR
  ?? "D:/workspace/bug-pic/.restricted/pc-full-acceptance-20260728-151023/final-75";

const MODULES = CONSOLE_NAV.flatMap((domain) =>
  domain.l2.map((module) => ({
    ...module,
    domainCode: domain.code,
    domainName: domain.name,
  })),
);

const fatalTextPatterns = [
  /数据加载失败/i,
  /加载失败 ·/i,
  /Handler dispatch failed/i,
  /NoSuchMethodError/i,
  /SQLSyntaxErrorException/i,
  /BACKEND_UNAVAILABLE/i,
  /Cannot read properties/i,
  /ReferenceError/i,
  /TypeError/i,
  /接口读取失败/i,
  /真实接口不可用/i,
  /暂时不可用/i,
  /同步失败/i,
  /协议错误/i,
  /一致性校验未通过/i,
  /mock 用户详情/i,
  /localStorage/i,
];

type RuntimeEvidence = {
  pageErrors: string[];
  consoleErrors: string[];
  admin5xx: string[];
  adminHttpErrors: string[];
  adminRequestFailures: string[];
  expectedNavigationAborts: string[];
  expectedAnonymous401: string[];
  firstPass: string[];
  refreshed: string[];
  reloginPass: string[];
};

test.describe.configure({ mode: "serial" });

test("75 个模块统一锁定：侧栏首轮、逐页刷新、退出重登后复跑", async ({ page }) => {
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
    expectedNavigationAborts: [],
    expectedAnonymous401: [],
    firstPass: [],
    refreshed: [],
    reloginPass: [],
  };
  let currentModule = "login";
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
    if (isIdleTrackedAdminRequest(request.url())) {
      const detail =
        `${currentModule}: ${request.method()} ${pathOf(request.url())} ${request.failure()?.errorText ?? "REQUEST_FAILED"}`;
      if (request.failure()?.errorText === "net::ERR_ABORTED") {
        evidence.expectedNavigationAborts.push(detail);
      } else {
        evidence.adminRequestFailures.push(detail);
      }
    }
    finishRequest(request.url());
  });
  page.on("response", async (response) => {
    if (!response.url().includes("/api/admin/")) return;
    const responsePath = pathOf(response.url());
    const detail = `${currentModule}: ${response.request().method()} ${response.status()} ${responsePath}`;
    if (
      response.status() === 401
      && responsePath === "/api/admin/auth/session"
      && (currentModule === "login" || currentModule === "relogin")
    ) {
      evidence.expectedAnonymous401.push(detail);
      return;
    }
    if (response.status() >= 500) evidence.admin5xx.push(detail);
    else if (response.status() >= 400) evidence.adminHttpErrors.push(detail);
  });

  try {
    await loginFromVisibleEntry(page);
    await waitForAdminQuiet(() => ({ pendingAdminRequests, lastAdminActivityAt }), "初次登录后的全局请求");

    for (const module of MODULES) {
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
    expect(evidence.reloginPass).toEqual(MODULES.map((module) => module.id));
    expect(evidence.pageErrors, "全候选期间不允许 pageerror").toEqual([]);
    expect(evidence.consoleErrors, "全候选期间不允许控制台 error").toEqual([]);
    expect(evidence.admin5xx, "全候选期间 /api/admin/* 不允许 5xx").toEqual([]);
    expect(evidence.adminHttpErrors, "只读统一锁定期间 /api/admin/* 不允许非预期 4xx").toEqual([]);
    expect(evidence.adminRequestFailures, "全候选期间 /api/admin/* 不允许网络失败").toEqual([]);
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
  for (const pattern of fatalTextPatterns) {
    await expect(main.getByText(pattern), `${module.id} 主内容不应展示失败/mock/localStorage 兜底文案`).toHaveCount(0);
  }
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
