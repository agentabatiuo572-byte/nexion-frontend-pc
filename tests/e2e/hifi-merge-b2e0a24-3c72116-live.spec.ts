import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ADMIN_USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const ADMIN_PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const BACKEND_URL = process.env.NEXION_BACKEND_URL || "http://127.0.0.1:8110";
const APP_BASE_URL = process.env.NEXION_APP_BASE_URL || "http://localhost:5174/?nx_device=off";
const APP_COUNTRY_CODE = process.env.APP_E2E_COUNTRY_CODE?.trim() || "+1";
const MYSQL_EXE = process.env.HIFI_MERGE_MYSQL_EXE
  || "D:/software/MySQL/MySQL Server 8.0/bin/mysql.exe";
const DB_NAME = process.env.HIFI_MERGE_DB_NAME || "nexion";
const SMOKE_RUN = Date.now().toString(36).toUpperCase();
const SMOKE_USER_ID = 70_000_000 + Number(String(Date.now()).slice(-7));
const SMOKE_PHONE = `166${String(Date.now()).slice(-8)}`;
const SMOKE_REFERRAL = `HFSMOKE${SMOKE_RUN}`.slice(0, 32);
const SMOKE_DEVICE_ID = `hifi-smoke-${SMOKE_RUN}`.toLowerCase();
const EVIDENCE_ROOT = process.env.HIFI_MERGE_EVIDENCE_DIR
  || "D:/workspace/bug-pic/hifi-merge-20260728";

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  fs.mkdirSync(path.join(EVIDENCE_ROOT, "D1"), { recursive: true });
  fs.mkdirSync(path.join(EVIDENCE_ROOT, "B4"), { recursive: true });
  fs.mkdirSync(path.join(EVIDENCE_ROOT, "B4-App"), { recursive: true });
  fs.mkdirSync(path.join(EVIDENCE_ROOT, "M9-M10"), { recursive: true });
});

async function loginAdmin(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const username = page.locator('input[autocomplete="username"]');
  if (await username.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await username.fill(ADMIN_USERNAME);
    await page.locator('input[autocomplete="current-password"]').fill(ADMIN_PASSWORD);
    const response = page.waitForResponse((candidate) =>
      candidate.request().method() === "POST"
      && candidate.url().endsWith("/api/admin/auth/login"));
    await page.getByRole("button", { name: /登录|继续/ }).click();
    expect((await response).status()).toBe(200);
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function openD1FromVisibleEntry(page: Page) {
  await loginAdmin(page);
  const financeGroup = page.getByRole("button", { name: /资金与财务/ });
  if ((await financeGroup.getAttribute("aria-expanded")) !== "true") await financeGroup.click();
  const entry = page.locator('aside a[href="/finance/recon"]');
  await expect(entry).toBeVisible();
  await entry.click();
  await expect(page).toHaveURL(/\/finance\/recon$/);
  await expect(page.getByText("充值渠道", { exact: true })).toBeVisible();
}

async function logoutAdmin(page: Page) {
  const accountMenu = page.locator('header button[aria-haspopup="menu"]').first();
  await expect(accountMenu).toBeVisible();
  await accountMenu.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

async function loginAppUser(page: Page) {
  const phone = process.env.APP_E2E_PHONE?.trim();
  const password = process.env.APP_E2E_PASSWORD;
  if (!phone || !password) {
    throw new Error("APP_E2E_PHONE and APP_E2E_PASSWORD are required for the real App walkthrough");
  }

  await expect(page).toHaveURL(/#\/pages\/login\/login/, { timeout: 20_000 });
  const countryButton = page.locator(".lg-phone__cc");
  await expect(countryButton).toBeVisible();
  if ((await countryButton.innerText()).trim() !== APP_COUNTRY_CODE) {
    await countryButton.click();
    const countryOption = page.getByRole("option").filter({ hasText: APP_COUNTRY_CODE }).first();
    await expect(countryOption).toBeVisible();
    await countryOption.click();
  }

  await page.locator(".lg-phone__in input").fill(phone);
  await page.locator('input[type="password"]').fill(password);
  const response = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST"
    && candidate.url().includes("/auth/users/login"));
  await page.locator(".lg-cta").click();
  expect((await response).status()).toBe(200);
  await expect(page).not.toHaveURL(/#\/pages\/login\/login/, { timeout: 20_000 });
}

function mysql(sql: string) {
  const password = process.env.HIFI_MERGE_DB_PASSWORD
    || process.env.K6_DB_PASSWORD
    || process.env.MYSQL_ROOT_PASSWORD;
  if (!password) {
    throw new Error("HIFI_MERGE_DB_PASSWORD is required for the M9/M10 live smoke fixture");
  }
  return execFileSync(MYSQL_EXE, ["-uroot", "-D", DB_NAME, "-N", "-B", "-e", sql], {
    encoding: "utf8",
    env: { ...process.env, MYSQL_PWD: password },
  });
}

function cleanupCrossDomainSmoke(sid = "") {
  const safeSid = sid.replace(/'/g, "''");
  mysql(`
    DELETE FROM nx_janus_evaluation WHERE sid='${safeSid || "__none__"}';
    DELETE FROM nx_janus_device WHERE sid='${safeSid || "__none__"}';
    DELETE FROM nx_user_session WHERE user_id IN (
      SELECT id FROM nx_user WHERE phone='${SMOKE_PHONE}' OR referral_code='${SMOKE_REFERRAL}'
    );
    DELETE FROM nx_kyc_profile WHERE user_id IN (
      SELECT id FROM nx_user WHERE phone='${SMOKE_PHONE}' OR referral_code='${SMOKE_REFERRAL}'
    ) OR user_id=${SMOKE_USER_ID};
    DELETE FROM nx_user WHERE phone='${SMOKE_PHONE}' OR referral_code='${SMOKE_REFERRAL}';
  `);
}

function createCrossDomainSmokeUser() {
  cleanupCrossDomainSmoke();
  mysql(`
    INSERT INTO nx_user(id,country_code,phone,password_hash,nickname,referral_code,status,is_deleted)
    SELECT ${SMOKE_USER_ID},'86','${SMOKE_PHONE}',password_hash,'高保真跨域验收用户','${SMOKE_REFERRAL}','ACTIVE',0
    FROM nx_admin WHERE username='superadmin' AND is_deleted=0 LIMIT 1;
  `);
  expect(Number(mysql(
    `SELECT COUNT(*) FROM nx_user WHERE id=${SMOKE_USER_ID} AND phone='${SMOKE_PHONE}' AND is_deleted=0;`,
  ).trim())).toBe(1);
}

async function loginCrossDomainAppUser(page: Page) {
  const response = await page.request.post(`${BACKEND_URL}/auth/users/login`, {
    headers: {
      "X-Nexion-Edge-Country": "JP",
      "CF-IPCountry": "JP",
    },
    data: {
      countryCode: "86",
      phone: SMOKE_PHONE,
      password: ADMIN_PASSWORD,
    },
  });
  const payload = await response.json() as {
    code?: number;
    message?: string;
    data?: { accessToken?: string };
  };
  expect(response.status(), payload.message).toBe(200);
  expect(payload.code, payload.message).toBe(0);
  expect(payload.data?.accessToken).toBeTruthy();
  return payload.data!.accessToken!;
}

function janusReportPayload() {
  const reportedAt = Date.now();
  return {
    reportId: `hifi-smoke-${SMOKE_RUN.toLowerCase()}`,
    deviceId: SMOKE_DEVICE_ID,
    reportedAt,
    firstSeenAt: reportedAt - 3 * 86_400_000,
    installAt: reportedAt - 3 * 86_400_000,
    inviteCode: null,
    channel: "official",
    cohortId: null,
    reportedStatus: "ERROR",
    activated: false,
    ua: "High-fidelity cross-domain Playwright",
    platform: "android",
    model: "Acceptance Device",
    osName: "Android 15",
    browser: "Chrome",
    maturityScore: 0,
    recommendationScore: 0,
    environmentRiskScore: 0,
    priorityScore: 0,
    maturity: {
      appOpenCount: 2,
      sessionCount: 2,
      foregroundDurationSeconds: 300,
      repeatStreakDays: 1,
      benchmarkViewed: true,
      optimizeDone: true,
      marketViewed: true,
      walletViewed: true,
    },
    environment: {
      isHeadless: false,
      automationSignalCount: 0,
      fpBlocklistHit: false,
      screenAnomaly: false,
      timezoneMismatch: false,
      languageMismatch: false,
    },
    hitStrategy: null,
    hitStrategyVersion: null,
    latestDecision: null,
    latestSession: {
      sessionId: `session-${SMOKE_RUN.toLowerCase()}`,
      startedAt: reportedAt - 60_000,
      lastSeenAt: reportedAt,
      foregroundDurationSeconds: 300,
    },
    tags: [],
  };
}

test("D1 真实入口展示五条权威充值轨，并跨刷新保留同号幂等重试", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openD1FromVisibleEntry(page);

  const channelCard = page.locator("section.l-card").filter({ hasText: "充值渠道" });
  const body = await channelCard.innerText();
  for (const label of ["TRC20", "BEP20", "ERC20", "VietQR", "国际卡"]) {
    expect(body, `missing real rail ${label}`).toContain(label);
  }
  expect(body).toMatch(/国际卡[\s\S]*最小充值 \$30(?:\.00)?[\s\S]*单笔上限 \$5,000/);
  expect(body).toMatch(/VietQR[\s\S]*单笔上限 \$5,000/);
  expect(body).not.toMatch(/\bBTC\b|\bETH\b/);

  const cardRow = channelCard.locator(".p-row").filter({ hasText: "国际卡" });
  const mutationUrl = "**/api/admin/finance/topup/channels/card/max-amount";
  const attempts: Array<{ key: string; body: string }> = [];
  await page.route(mutationUrl, async (route) => {
    attempts.push({
      key: route.request().headers()["idempotency-key"] ?? "",
      body: route.request().postData() ?? "",
    });
    if (attempts.length === 1) {
      await route.fulfill({
        status: 503,
        headers: { "X-Nexion-Upstream-Outcome": "unknown" },
        contentType: "application/json",
        body: JSON.stringify({ code: 503, message: "D1_TEST_UNKNOWN", data: null }),
      });
      return;
    }
    await route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ code: 409, message: "IDEMPOTENCY_REQUEST_IN_PROGRESS", data: null }),
    });
  });

  await cardRow.getByRole("button", { name: "单笔上限", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("目标新值").fill("4999");
  await dialog.locator("textarea").fill("高保真合并验收：未知结果必须复用原请求号");
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(page.getByTestId("d1-pending-command-panel")).toBeVisible();
  expect(attempts).toHaveLength(1);
  expect(attempts[0].key).toMatch(/^d1-channel-max-/);

  await page.reload();
  await expect(page.getByTestId("d1-pending-command-panel")).toBeVisible();
  await logoutAdmin(page);
  await openD1FromVisibleEntry(page);
  await expect(page.getByTestId("d1-pending-command-panel")).toBeVisible();
  const inProgressResponse = page.waitForResponse((response) =>
    response.url().includes("/api/admin/finance/topup/channels/card/max-amount")
    && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "核对后使用原请求号重试", exact: true }).click();
  expect((await inProgressResponse).status()).toBe(409);
  await expect.poll(() => attempts.length).toBe(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await expect(page.getByTestId("d1-pending-command-panel")).toBeVisible();

  await page.reload();
  await expect(page.getByTestId("d1-pending-command-panel")).toBeVisible();
  const subsequentResponse = page.waitForResponse((response) =>
    response.url().includes("/api/admin/finance/topup/channels/card/max-amount")
    && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "核对后使用原请求号重试", exact: true }).click();
  expect((await subsequentResponse).status()).toBe(409);
  await expect.poll(() => attempts.length).toBe(3);
  expect(attempts[2]).toEqual(attempts[0]);
  await expect(page.getByTestId("d1-pending-command-panel")).toBeVisible();
  await page.screenshot({
    path: path.join(EVIDENCE_ROOT, "D1", "01-five-rails-and-same-key-retry.png"),
    fullPage: true,
  });

  const result = {
    rails: ["trc20", "bep20", "erc20", "vietqr", "card"],
    cardMinimumUsd: 30,
    cardMaximumUsd: 5000,
    vietQrMaximumUsd: 5000,
    retrySameKey: attempts.slice(1).every((attempt) => attempt.key === attempts[0].key),
    retrySameBody: attempts.slice(1).every((attempt) => attempt.body === attempts[0].body),
    reloginPreservedPendingCommand: true,
    inProgressPreservedPendingCommand: true,
    pageErrors,
  };
  fs.writeFileSync(
    path.join(EVIDENCE_ROOT, "D1", "result.json"),
    JSON.stringify(result, null, 2),
  );
  expect(pageErrors).toEqual([]);
  await page.evaluate(() => sessionStorage.removeItem("nexgrid-admin-d1-uncertain-commands-v1"));
});

test("B4 从真实侧栏进入，刷新与退出重登后仍恢复权威节奏视图", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await loginAdmin(page);

  async function openB4FromVisibleEntry() {
    const overviewGroup = page.getByRole("button", { name: /总览驾驶舱/ });
    if ((await overviewGroup.getAttribute("aria-expanded")) !== "true") await overviewGroup.click();
    const entry = page.locator('aside a[href="/overview/rhythm"]');
    await expect(entry).toBeVisible();
    const response = page.waitForResponse((candidate) =>
      candidate.request().method() === "GET"
      && new URL(candidate.url()).pathname === "/api/admin/phase/overview");
    await entry.click();
    expect((await response).status()).toBe(200);
    await expect(page).toHaveURL(/\/overview\/rhythm$/);
    await expect(page.getByRole("heading", { name: "节奏状态" })).toBeVisible();
    await expect(page.locator("[data-testid='b4-dial-row']")).toHaveCount(8);
  }

  await openB4FromVisibleEntry();
  const refreshResponse = page.waitForResponse((candidate) =>
    candidate.request().method() === "GET"
    && new URL(candidate.url()).pathname === "/api/admin/phase/overview");
  await page.reload({ waitUntil: "domcontentloaded" });
  expect((await refreshResponse).status()).toBe(200);
  await expect(page.getByRole("heading", { name: "节奏状态" })).toBeVisible();
  await expect(page.locator("[data-testid='b4-dial-row']")).toHaveCount(8);

  await logoutAdmin(page);
  await loginAdmin(page);
  await openB4FromVisibleEntry();
  await page.screenshot({
    path: path.join(EVIDENCE_ROOT, "B4", "01-visible-entry-refresh-relogin.png"),
    fullPage: true,
  });

  fs.writeFileSync(
    path.join(EVIDENCE_ROOT, "B4", "result.json"),
    JSON.stringify({
      visibleEntry: "/overview/rhythm",
      initialOverviewStatus: 200,
      refreshOverviewStatus: 200,
      reloginOverviewStatus: 200,
      dialCount: 8,
      pageErrors,
    }, null, 2),
  );
  expect(pageErrors).toEqual([]);
});

test("M9/M10 通过真实 App API、后端与 PC 可见入口完成跨域 smoke", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  let janusSid = "";
  createCrossDomainSmokeUser();

  try {
    await loginAdmin(page);

    const riskGroup = page.getByRole("button", { name: /风控与反作弊/ });
    if ((await riskGroup.getAttribute("aria-expanded")) !== "true") await riskGroup.click();
    const janusEntry = page.locator('aside a[href="/risk/janus-c2"]');
    await expect(janusEntry).toBeVisible();
    const dashboardResponse = page.waitForResponse((candidate) =>
      candidate.request().method() === "GET"
      && new URL(candidate.url()).pathname === "/api/admin/janus/dashboard");
    await janusEntry.click();
    const dashboardHttp = await dashboardResponse;
    const dashboardPayload = await dashboardHttp.json() as { code?: number; message?: string };
    expect(dashboardHttp.status(), dashboardPayload.message).toBe(200);
    expect(dashboardPayload.code, dashboardPayload.message).toBe(0);
    await expect(page).toHaveURL(/\/risk\/janus-c2$/);
    await expect(page.getByRole("navigation", { name: "C2 控制台模块" })).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_ROOT, "M9-M10", "01-m9-janus-pc-live.png"),
      fullPage: true,
    });

    const appToken = await loginCrossDomainAppUser(page);
    const appHeaders = {
      Authorization: `Bearer ${appToken}`,
      "X-Nexion-Edge-Country": "JP",
      "CF-IPCountry": "JP",
    };
    const reportResponse = await page.request.post(`${BACKEND_URL}/api/app/janus/reports`, {
      headers: appHeaders,
      data: janusReportPayload(),
    });
    const reportPayload = await reportResponse.json() as {
      code?: number;
      message?: string;
      data?: { sid?: string; status?: string };
    };
    expect(reportResponse.status(), reportPayload.message).toBe(200);
    expect(reportPayload.code, reportPayload.message).toBe(0);
    expect(reportPayload.data?.sid).toMatch(/^J-[A-F0-9]{32}$/);
    expect(reportPayload.data?.status).toBeTruthy();
    janusSid = reportPayload.data!.sid!;

    const pendingResponse = await page.request.get(
      `${BACKEND_URL}/api/app/janus/commands/pending?deviceId=${encodeURIComponent(SMOKE_DEVICE_ID)}`,
      { headers: appHeaders },
    );
    const pendingPayload = await pendingResponse.json() as { code?: number; message?: string };
    expect(pendingResponse.status(), pendingPayload.message).toBe(200);
    expect(pendingPayload.code, pendingPayload.message).toBe(0);

    const securityResponse = await page.request.get(`${BACKEND_URL}/api/app/security`, {
      headers: appHeaders,
    });
    const securityPayload = await securityResponse.json() as {
      code?: number;
      message?: string;
      data?: { sessions?: unknown[] };
    };
    expect(securityResponse.status(), securityPayload.message).toBe(200);
    expect(securityPayload.code, securityPayload.message).toBe(0);
    expect(Array.isArray(securityPayload.data?.sessions)).toBe(true);

    const kycResponse = await page.request.get(`${BACKEND_URL}/api/kyc/status`, {
      headers: appHeaders,
    });
    const kycPayload = await kycResponse.json() as {
      code?: number;
      message?: string;
      data?: { status?: string; walletPaired?: boolean; source?: string };
    };
    expect(kycResponse.status(), kycPayload.message).toBe(200);
    expect(kycPayload.code, kycPayload.message).toBe(0);
    expect(typeof kycPayload.data?.status).toBe("string");
    expect(typeof kycPayload.data?.walletPaired).toBe("boolean");
    expect(kycPayload.data?.source).toBeTruthy();

    const usersGroup = page.getByRole("button", { name: /用户与账户/ });
    if ((await usersGroup.getAttribute("aria-expanded")) !== "true") await usersGroup.click();
    const securityEntry = page.locator('aside a[href="/users/security"]');
    await expect(securityEntry).toBeVisible();
    const adminSecurityResponse = page.waitForResponse((candidate) =>
      candidate.request().method() === "GET"
      && new URL(candidate.url()).pathname === "/api/admin/users/security/overview");
    await securityEntry.click();
    const adminSecurityHttp = await adminSecurityResponse;
    const adminSecurityPayload = await adminSecurityHttp.json() as { code?: number; message?: string };
    expect(adminSecurityHttp.status(), adminSecurityPayload.message).toBe(200);
    expect(adminSecurityPayload.code, adminSecurityPayload.message).toBe(0);
    await expect(page).toHaveURL(/\/users\/security$/);
    await expect(page.getByText("凭证与会话参数", { exact: true })).toBeVisible();
    await page.screenshot({
      path: path.join(EVIDENCE_ROOT, "M9-M10", "02-m10-security-pc-live.png"),
      fullPage: true,
    });

    fs.writeFileSync(
      path.join(EVIDENCE_ROOT, "M9-M10", "result.json"),
      JSON.stringify({
        m9: {
          pcVisibleEntry: "/risk/janus-c2",
          adminDashboardStatus: dashboardHttp.status(),
          appReportStatus: reportResponse.status(),
          appPendingStatus: pendingResponse.status(),
          serverStatus: reportPayload.data?.status,
        },
        m10: {
          appSecurityStatus: securityResponse.status(),
          appKycStatus: kycResponse.status(),
          pcVisibleEntry: "/users/security",
          adminSecurityStatus: adminSecurityHttp.status(),
        },
        mockSuccessResponses: 0,
        pageErrors,
      }, null, 2),
    );
    expect(pageErrors).toEqual([]);
  } finally {
    cleanupCrossDomainSmoke(janusSid);
  }
});

test("App 真实远程模式从首页进入充值与提现，Card 与地址换绑均失败关闭", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto(`${APP_BASE_URL}#/pages/index/index`, { waitUntil: "domcontentloaded" });
  await loginAppUser(page);
  await expect(page.locator('[role="tab"][aria-label="Me"]')).toBeVisible({ timeout: 20_000 });
  await page.locator('[role="tab"][aria-label="Me"]').click();
  await expect(page).toHaveURL(/#\/pages\/me\/me/);

  await page.getByText("Top-up", { exact: true }).click();
  await expect(page).toHaveURL(/#\/pages\/me\/wallet-topup/);
  await page.locator(".nx-topup-seg-crypto").click();
  await page.locator(".nx-dep-net-trc20").click();
  await expect(page.getByText("Send via TRC20", { exact: false })).toBeVisible();
  await expect(page.locator(".nx-dep-copy-address-cta")).toBeVisible();

  const beforeCard = await page.evaluate(() => {
    const uni = (
      window as Window & {
        uni?: { getStorageSync?: (key: string) => unknown };
      }
    ).uni;
    return {
      bills: uni?.getStorageSync?.("nexgrid-bills-accounts-v1") ?? null,
      account: uni?.getStorageSync?.("nexgrid-account-cloud-v1") ?? null,
    };
  });
  await page.locator(".nx-topup-seg-card").click();
  await expect(page.locator(".nx-card-remote-unavailable")).toBeVisible();
  await expect(page.getByText("Visa / Mastercard", { exact: true })).toHaveCount(0);
  const afterCard = await page.evaluate(() => {
    const uni = (
      window as Window & {
        uni?: { getStorageSync?: (key: string) => unknown };
      }
    ).uni;
    return {
      bills: uni?.getStorageSync?.("nexgrid-bills-accounts-v1") ?? null,
      account: uni?.getStorageSync?.("nexgrid-account-cloud-v1") ?? null,
    };
  });
  expect(afterCard).toEqual(beforeCard);
  await page.screenshot({
    path: path.join(EVIDENCE_ROOT, "B4-App", "01-remote-card-fail-closed.png"),
    fullPage: true,
  });

  await page.locator(".spv-back").click();
  await expect(page).toHaveURL(/#\/pages\/me\/me/);
  await page.getByText("Withdraw", { exact: true }).click();
  await expect(page).toHaveURL(/#\/pages\/me\/wallet-withdraw/);
  await expect(page.locator(".nx-withdraw-address-input")).toHaveCount(0);
  await expect(page.locator(".nx-withdraw-rebind-entry")).toBeVisible();
  await expect(page.locator(".nx-withdraw-rebind-entry")).toHaveAttribute("aria-disabled", "true");
  await page.locator(".nx-withdraw-rebind-entry").dispatchEvent("click");
  await expect(page).toHaveURL(/#\/pages\/me\/wallet-withdraw/);
  await page.reload();
  await loginAppUser(page);
  await expect(page.locator('[role="tab"][aria-label="Me"]')).toBeVisible();
  await page.locator('[role="tab"][aria-label="Me"]').click();
  await page.getByText("Withdraw", { exact: true }).click();
  await expect(page).toHaveURL(/#\/pages\/me\/wallet-withdraw/);
  await expect(page.locator(".nx-withdraw-address-input")).toHaveCount(0);
  await expect(page.locator(".nx-withdraw-rebind-entry")).toBeVisible();
  await expect(page.locator(".nx-withdraw-rebind-entry")).toHaveAttribute("aria-disabled", "true");
  await page.locator(".nx-withdraw-rebind-entry").dispatchEvent("click");
  await expect(page).toHaveURL(/#\/pages\/me\/wallet-withdraw/);
  await page.goto(`${APP_BASE_URL}#/pages/me/wallet-address-rebind`, {
    waitUntil: "domcontentloaded",
  });
  await expect(page).toHaveURL(/#\/pages\/me\/wallet-address-rebind/);
  await expect(page.locator(".nx-rebind-remote-unavailable")).toBeVisible();
  await expect(page.locator(".nx-rebind-address-input")).toHaveCount(0);
  await expect(page.locator(".nx-rebind-net-trc20")).toHaveCount(0);
  await expect(page.locator(".nx-rebind-net-erc20")).toHaveCount(0);
  await page.screenshot({
    path: path.join(EVIDENCE_ROOT, "B4-App", "02-withdraw-rebind-disabled.png"),
    fullPage: true,
  });

  fs.writeFileSync(
    path.join(EVIDENCE_ROOT, "B4-App", "result.json"),
    JSON.stringify({
      visiblePath: "Home -> Me -> Top-up/Withdraw",
      trc20Selector: true,
      remoteCardFailedClosed: true,
      localBusinessStateUnchanged: true,
      withdrawAddressInputCount: 0,
      refreshPreservedReadonlyContract: true,
      rebindEntryDisabled: true,
      rebindClickStayedOnWithdraw: true,
      directOpenRebindUnavailable: true,
      remoteRebindNetworkSelectorCount: 0,
      pageErrors,
    }, null, 2),
  );
  expect(pageErrors).toEqual([]);
});
