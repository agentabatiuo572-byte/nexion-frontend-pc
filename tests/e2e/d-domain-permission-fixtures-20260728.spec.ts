import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

type FixtureAccount = {
  username: string;
  password: string;
  totpSecret: string;
};

type PermissionFixture = {
  runId: string;
  accounts: Record<string, FixtureAccount>;
  checker?: FixtureAccount;
};

type ModuleProbe = {
  id: string;
  path: string;
  readPath: string;
  writePath: string;
  writeMethod: "GET" | "PATCH" | "POST" | "PUT";
  writeBody?: Record<string, unknown>;
  visibleText: RegExp;
  forbiddenButtons: RegExp;
};

const fixturePath = process.env.ADMIN_PERMISSION_FIXTURE;
if (!fixturePath) throw new Error("ADMIN_PERMISSION_FIXTURE is required");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as PermissionFixture;
const withdrawalNo = process.env.D_PERMISSION_WITHDRAWAL_NO;
const evidenceDir = process.env.D_PERMISSION_EVIDENCE_DIR;

const MODULES: ModuleProbe[] = [
  {
    id: "D1",
    path: "/finance/recon",
    readPath: "/api/admin/finance/vietqr/overview?view=inflight&pageNum=1&pageSize=20",
    writePath: "/api/admin/finance/vietqr/config",
    writeMethod: "PATCH",
    writeBody: {
      toleranceVnd: 1000,
      graceMinutes: 30,
      perTxLimitUsd: 5000,
      trc20Confirmations: 20,
      erc20Confirmations: 12,
      bep20Confirmations: 15,
      rotationStrategy: "ROUND_ROBIN",
      expectedVersion: -1,
      reason: "权限边界探针不得执行",
      operator: "permission-probe",
    },
    visibleText: /银行转账（VietQR）对账/,
    forbiddenButtons: /最小额|费率|单笔上限|停用充值渠道|启用充值渠道|登记真实银行回单|新增 VietQR 收款账户|调整日收上限|收款账户池轮换策略调整/,
  },
  {
    id: "D2",
    path: "/finance/withdrawals",
    readPath: "/api/admin/finance/withdrawals?pageNum=1&pageSize=10",
    writePath: "/api/admin/finance/withdrawals/permission-probe-never-exists/review",
    writeMethod: "POST",
    writeBody: {
      action: "DELAY",
      operator: "permission-probe",
      reason: "权限边界探针不得执行",
      holdDays: 7,
      owner: "permission-probe",
      reviewAt: "2099-01-01T00:00",
    },
    visibleText: /提现审核队列/,
    forbiddenButtons: /^(放行|延迟|冻结|解冻|拒绝并退款|手动退款|批量执行)$/,
  },
  {
    id: "D3",
    path: "/finance/pool",
    readPath: "/api/admin/treasury/reserve",
    writePath: "/api/admin/treasury/reserve-injection",
    writeMethod: "POST",
    writeBody: {
      amount: "1",
      voucherNo: "permission-probe-never-execute",
      reason: "权限边界探针不得执行",
      operator: "permission-probe",
    },
    visibleText: /应付负债 · 9 类科目/,
    forbiddenButtons: /^(登记|保存预测配置|导出负债 CSV|导出对账 CSV)$/,
  },
  {
    id: "D4",
    path: "/finance/ledger",
    readPath: "/api/admin/bills?pageNum=1&pageSize=10",
    writePath: "/api/admin/bills/export?reason=permission-probe-never-execute",
    writeMethod: "GET",
    visibleText: /全平台账单流水/,
    forbiddenButtons: /^导出脱敏 CSV$/,
  },
  {
    id: "D5",
    path: "/finance/params",
    readPath: "/api/admin/withdraw/limits",
    writePath: "/api/admin/withdraw/limits",
    writeMethod: "PUT",
    writeBody: {
      balanceMaxRatio: 0.79,
      expectedVersion: -1,
      reason: "权限边界探针不得执行",
      operator: "permission-probe",
    },
    visibleText: /D5 自有四组参数/,
    forbiddenButtons: /^预览并提交$/,
  },
  {
    id: "D6",
    path: "/finance/fx-rate",
    readPath: "/api/admin/finance/fx-quote",
    writePath: "/api/admin/finance/fx-quote",
    writeMethod: "PATCH",
    writeBody: {
      baseRateVndPerUsdt: 26001,
      buySpreadPct: 1.5,
      lockWindowMinutes: 30,
      expectedVersion: -1,
      reason: "权限边界探针不得执行",
      operator: "permission-probe",
    },
    visibleText: /当前牌价（现场派生）/,
    forbiddenButtons: /^调整$/,
  },
];

test.describe.serial("D 域 A 夹具五层权限与 maker/checker 验收", () => {
  test.beforeAll(() => {
    if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });
  });

  for (const [profile, accountKey, legacyAccountKey] of [
    ["readonly", "readonly", "d_readonly"],
    ["menu-no-write", "nowrite", "d_no_write"],
  ] as const) {
    test(`${profile}：D1–D6 菜单、路由、按钮、接口、数据均为只读，刷新重登不漂移`, async ({ page }) => {
      const errors = monitorPageErrors(page);
      const account = fixtureAccount(accountKey, legacyAccountKey);
      await login(page, account, accountKey);
      await assertSessionShape(page, { hasDRead: true });
      await assertVisibleDMenus(page);

      const moduleResults: Array<{ module: string; read: number; write: number }> = [];
      for (const module of MODULES) {
        await openVisibleModule(page, module);
        await assertReadableModule(page, module);
        await expect(page.locator(".ddom").getByRole("button", { name: module.forbiddenButtons })).toHaveCount(0);

        const read = await browserApi(page, "GET", module.readPath);
        expect(read.status, `${profile} ${module.id} 读取接口`).toBe(200);
        expect(read.hasData, `${profile} ${module.id} 必须读取服务端权威 data`).toBe(true);

        const write = await browserApi(page, module.writeMethod, module.writePath, module.writeBody);
        expect(write.status, `${profile} ${module.id} 写接口必须由后端拒绝`).toBe(403);
        moduleResults.push({ module: module.id, read: read.status, write: write.status });
      }

      await page.reload({ waitUntil: "domcontentloaded" });
      await assertReadableModule(page, MODULES.at(-1)!);
      await logout(page);
      await login(page, account, accountKey);
      await assertSessionShape(page, { hasDRead: true });
      await assertVisibleDMenus(page);
      const reloginRead = await browserApi(page, "GET", MODULES[0].readPath);
      const reloginWrite = await browserApi(page, MODULES[0].writeMethod, MODULES[0].writePath, MODULES[0].writeBody);
      expect(reloginRead.status).toBe(200);
      expect(reloginWrite.status).toBe(403);
      expect(errors).toEqual([]);
      writeEvidence(`${profile}-five-layers.json`, {
        profile,
        modules: moduleResults,
        refresh: "PASS",
        logoutRelogin: { read: reloginRead.status, write: reloginWrite.status },
        pageErrors: errors.length,
      });
    });
  }

  test("no-menu：D 菜单和直接路由不可见，D1–D6 读写均拒绝，刷新重登不被缓存恢复", async ({ page }) => {
    const errors = monitorPageErrors(page);
    const account = fixtureAccount("nomenu", "d_no_menu");
    await login(page, account, "nomenu");
    await assertSessionShape(page, { hasDRead: false, hasDMenus: false });
    await expect(page.locator('a[href^="/finance/"]')).toHaveCount(0);

    await page.goto(MODULES[0].path, { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/finance\/recon(?:\?.*)?$/);
    await expect(page.locator(".ddom")).toHaveCount(0);

    const moduleResults: Array<{ module: string; read: number; write: number }> = [];
    for (const module of MODULES) {
      const read = await browserApi(page, "GET", module.readPath);
      const write = await browserApi(page, module.writeMethod, module.writePath, module.writeBody);
      expect(read.status, `no-menu ${module.id} 读接口`).toBe(403);
      expect(write.status, `no-menu ${module.id} 写接口`).toBe(403);
      moduleResults.push({ module: module.id, read: read.status, write: write.status });
    }

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('a[href^="/finance/"]')).toHaveCount(0);
    await expect(page.locator(".ddom")).toHaveCount(0);
    await logout(page);
    await login(page, account, "nomenu");
    await assertSessionShape(page, { hasDRead: false, hasDMenus: false });
    await expect(page.locator('a[href^="/finance/"]')).toHaveCount(0);
    const reloginRead = await browserApi(page, "GET", MODULES[0].readPath);
    const reloginWrite = await browserApi(page, MODULES[0].writeMethod, MODULES[0].writePath, MODULES[0].writeBody);
    expect(reloginRead.status).toBe(403);
    expect(reloginWrite.status).toBe(403);
    expect(errors).toEqual([]);
    writeEvidence("no-menu-five-layers.json", {
      profile: "no-menu",
      modules: moduleResults,
      directRoute: "DENIED",
      refresh: "DENIED",
      logoutRelogin: { menu: "DENIED", read: reloginRead.status, write: reloginWrite.status },
      pageErrors: errors.length,
    });
  });

  test("独立 maker/checker：maker 从侧栏延迟隔离提现，checker 新上下文核对并攻击陈旧动作", async ({ browser }) => {
    test.skip(!withdrawalNo, "D_PERMISSION_WITHDRAWAL_NO is required");
    const maker = await browser.newContext();
    const checker = await browser.newContext();
    const makerPage = await maker.newPage();
    const checkerPage = await checker.newPage();
    const makerErrors = monitorPageErrors(makerPage);
    const checkerErrors = monitorPageErrors(checkerPage);

    try {
      const makerAccount = fixtureAccount("maker", "d_maker");
      const checkerAccount = fixtureChecker();
      expect(checkerAccount.username, "maker/checker must be separate identities").not.toBe(makerAccount.username);
      await login(makerPage, makerAccount, "maker");
      await assertVisibleDMenus(makerPage);
      await openVisibleModule(makerPage, MODULES[1]);
      await searchWithdrawal(makerPage, withdrawalNo!);
      const makerRow = makerPage.locator("tbody tr").filter({ hasText: withdrawalNo! }).first();
      await expect(makerRow).toBeVisible();
      await expect(makerRow.getByRole("button", { name: "延迟", exact: true })).toBeVisible();
      // The D maker fixture intentionally owns the freeze authority as part of
      // the operational maker role. State-inapplicable actions must still stay
      // hidden, while DELAY and FREEZE are both valid from REVIEW_PENDING.
      await expect(makerRow.getByRole("button", { name: /^(解冻|手动退款)$/ })).toHaveCount(0);

      await makerRow.getByRole("button", { name: "延迟", exact: true }).click();
      const dialog = makerPage.getByRole("dialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("持有天数")).toHaveValue("7");
      await dialog.getByLabel(/操作理由/).fill(`${fixture.runId} maker 隔离提现延迟处置`);
      const delayed = makerPage.waitForResponse((response) =>
        response.url().includes(`/api/admin/finance/withdrawals/${encodeURIComponent(withdrawalNo!)}/review`)
        && response.request().method() === "POST");
      await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
      expect((await delayed).status()).toBe(200);
      await searchWithdrawal(makerPage, withdrawalNo!);
      await expect(makerPage.locator("tbody tr").filter({ hasText: withdrawalNo! }).first()).toContainText(/延长持有/);

      await login(checkerPage, checkerAccount, "checker");
      await assertVisibleDMenus(checkerPage);
      await openVisibleModule(checkerPage, MODULES[1]);
      await searchWithdrawal(checkerPage, withdrawalNo!);
      const checkerRow = checkerPage.locator("tbody tr").filter({ hasText: withdrawalNo! }).first();
      await expect(checkerRow).toContainText(/延长持有/);
      await checkerRow.getByRole("button", { name: withdrawalNo!, exact: true }).click();
      await expect(checkerPage.getByRole("region", { name: "D2 单笔详情" })).toContainText(/延长持有/);

      const checkerForbidden = await browserApi(
        checkerPage,
        "POST",
        `/api/admin/finance/withdrawals/${encodeURIComponent(withdrawalNo!)}/review`,
        {
          action: "DELAY",
          operator: "checker",
          reason: `${fixture.runId} checker 陈旧并发动作`,
          holdDays: 7,
          owner: "checker",
          reviewAt: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 16),
        },
      );
      expect(checkerForbidden.status).toBe(403);

      const stale = await browserApi(
        makerPage,
        "POST",
        `/api/admin/finance/withdrawals/${encodeURIComponent(withdrawalNo!)}/review`,
        {
          action: "DELAY",
          operator: "maker",
          reason: `${fixture.runId} maker 陈旧并发动作`,
          holdDays: 7,
          owner: "maker",
          reviewAt: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 16),
        },
      );
      expect(stale.status).toBe(409);

      const detail = await browserApi(
        checkerPage,
        "GET",
        `/api/admin/finance/withdrawals/${encodeURIComponent(withdrawalNo!)}`,
      );
      expect(detail.status).toBe(200);
      const audit = await browserApi(
        checkerPage,
        "GET",
        `/api/admin/platform/audit/logs?keyword=${encodeURIComponent(withdrawalNo!)}&limit=200`,
      );
      const events = await browserApi(checkerPage, "GET", "/api/admin/platform/events/overview");
      expect(audit.status).toBe(200);
      expect(events.status).toBe(200);
      expect(makerErrors).toEqual([]);
      expect(checkerErrors).toEqual([]);

      writeEvidence("maker-checker.json", {
        profile: "independent-maker-checker",
        makerAction: "DELAY",
        resultingStatus: "EXTENDED_HOLD",
        checkerFreshContext: true,
        checkerUnauthorizedAction: checkerForbidden.status,
        staleAction: stale.status,
        detailRead: detail.status,
        a2Read: audit.status,
        a4Read: events.status,
        pageErrors: makerErrors.length + checkerErrors.length,
      });
    } finally {
      await maker.close();
      await checker.close();
    }
  });
});

async function login(page: Page, account: FixtureAccount, accountKey: string) {
  let lastVerificationCode: number | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    if (await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false)) break;
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
    await page.locator('input[autocomplete="username"]').fill(account.username);
    await page.locator('input[autocomplete="current-password"]').fill(account.password);
    const loginResponse = page.waitForResponse((response) =>
      response.url().includes("/api/admin/auth/login")
      && response.request().method() === "POST");
    await page.getByRole("button", { name: /继续|登录/ }).click();
    const loginPayload = await (await loginResponse).json().catch(() => null) as { code?: number; message?: string } | null;
    if (loginPayload?.code !== 0) {
      throw new Error(`${accountKey} credential stage failed code=${loginPayload?.code ?? "none"} message=${loginPayload?.message ?? "none"}`);
    }

    const otp = page.getByLabel("一次性验证码");
    if (!(await otp.isVisible({ timeout: 5_000 }).catch(() => false))) break;
    await otp.fill(await freshTotp(accountKey, account.totpSecret));
    const verification = page.waitForResponse((response) =>
      response.url().includes("/api/admin/auth/mfa/verify")
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const response = await verification;
    const result = await response.json().catch(() => null) as { code?: number } | null;
    lastVerificationCode = result?.code;
    const hasSessionCookie = (await page.context().cookies()).some((cookie) => cookie.name === "nexion_admin_token");
    if (response.status() === 200 && (result?.code === 0 || hasSessionCookie)) {
      // Successful MFA already makes the shell navigate. Starting a competing
      // goto here intermittently interrupts that real browser navigation.
      const shellReady = await page.locator("aside")
        .waitFor({ state: "visible", timeout: 10_000 })
        .then(() => true)
        .catch(() => false);
      if (!shellReady) await page.reload({ waitUntil: "domcontentloaded" });
      break;
    }
    if (attempt === 2) throw new Error(`${accountKey} MFA verification failed after isolated retries`);
  }
  if (!(await page.locator("aside").waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false))) {
    const heading = await page.getByRole("heading").first().textContent().catch(() => null);
    const hasSessionCookie = (await page.context().cookies()).some((cookie) => cookie.name === "nexion_admin_token");
    throw new Error(`${accountKey} shell unavailable after MFA code=${lastVerificationCode ?? "none"} cookie=${hasSessionCookie} heading=${heading ?? "none"}`);
  }
}

async function logout(page: Page) {
  const direct = page.getByRole("button", { name: /^(退出登录|登出)$/ }).first();
  if (await direct.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await direct.click();
  } else {
    const account = page.locator('header button[aria-haspopup="menu"], [role="banner"] button[aria-haspopup="menu"]').first();
    await expect(account).toBeVisible();
    await account.click();
    await page.getByText(/退出登录|登出/, { exact: true }).first().click();
  }
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

function fixtureAccount(preferredKey: string, legacyKey: string): FixtureAccount {
  const account = fixture.accounts[preferredKey] ?? fixture.accounts[legacyKey];
  if (!account) throw new Error(`permission fixture missing account: ${preferredKey} or ${legacyKey}`);
  return account;
}

function fixtureChecker(): FixtureAccount {
  const account = fixture.checker ?? fixture.accounts.d_checker;
  if (!account) throw new Error("permission fixture missing independent checker");
  return account;
}

async function assertSessionShape(page: Page, expected: { hasDRead: boolean; hasDMenus?: boolean }) {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const payload = await response.json() as {
    data?: {
      session?: {
        authorities?: string[];
        menuCodes?: string[];
        effectiveMenus?: unknown[];
      };
    };
  };
  const session = payload.data?.session;
  const authorities = session?.authorities ?? [];
  const menus = session?.menuCodes ?? session?.effectiveMenus ?? [];
  const hasDMenus = expected.hasDMenus ?? expected.hasDRead;
  if (expected.hasDRead) {
    for (const authority of ["finance_d1_read", "finance_d2_read", "finance_d3_read", "finance_d4_read", "finance_d5_read", "finance_d6_read"]) {
      expect(authorities).toContain(authority);
    }
    if (hasDMenus) {
      expect(menus.length).toBeGreaterThan(0);
    } else {
      expect(menus).toEqual([]);
      expect(session?.effectiveMenus ?? []).toEqual([]);
    }
  } else {
    expect(authorities).toEqual([]);
    expect(menus).toEqual([]);
    expect(session?.effectiveMenus ?? []).toEqual([]);
  }
}

async function assertVisibleDMenus(page: Page) {
  const domain = CONSOLE_NAV.find((item) => item.code === "D");
  if (!domain) throw new Error("D domain missing from navigation source");
  const group = page.getByRole("button", { name: /资金与财务\s+D|D\s+资金与财务/ }).first();
  if (await group.isVisible({ timeout: 3_000 }).catch(() => false)) await group.click();
  for (const module of domain.l2) {
    await expect(page.locator(`a[href="${module.path}"]`).first(), `${module.id} 菜单必须可见`).toBeVisible();
  }
}

async function openVisibleModule(page: Page, module: ModuleProbe) {
  const link = page.locator(`a[href="${module.path}"]`).first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(module.path)}(?:\\?.*)?$`));
}

async function assertReadableModule(page: Page, module: ModuleProbe) {
  await expect(page.locator(".ddom")).toBeVisible();
  await expect(page.getByText(module.visibleText).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/数据加载失败|已停止展示旧数据|Cannot read properties|ReferenceError|TypeError/i);
}

async function searchWithdrawal(page: Page, value: string) {
  await page.getByLabel("提现单 / 用户").fill(value);
  const response = page.waitForResponse((candidate) =>
    candidate.url().includes("/api/admin/finance/withdrawals")
    && new URL(candidate.url()).searchParams.get("keyword") === value);
  await page.getByRole("button", { name: "查询", exact: true }).click();
  expect((await response).status()).toBe(200);
}

async function browserApi(
  page: Page,
  method: ModuleProbe["writeMethod"],
  requestPath: string,
  body?: Record<string, unknown>,
) {
  return page.evaluate(async ({ method: requestMethod, path: apiPath, requestBody, runId }) => {
    const response = await fetch(apiPath, {
      method: requestMethod,
      credentials: "same-origin",
      headers: requestMethod === "GET"
        ? undefined
        : {
            "Content-Type": "application/json",
            "Idempotency-Key": `d-permission-${runId}-${crypto.randomUUID()}`,
          },
      body: requestMethod === "GET" ? undefined : JSON.stringify(requestBody ?? {}),
    });
    const payload = await response.json().catch(() => null) as { data?: unknown } | null;
    return { status: response.status, hasData: payload?.data !== undefined };
  }, { method, path: requestPath, body, requestBody: body, runId: fixture.runId });
}

function monitorPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

function writeEvidence(name: string, value: unknown) {
  if (!evidenceDir) return;
  writeFileSync(path.join(evidenceDir, name), JSON.stringify(value, null, 2));
}

const lastTotpStep = new Map<string, number>();

async function freshTotp(accountKey: string, secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  const previous = lastTotpStep.get(accountKey) ?? -1;
  if (step <= previous) {
    await new Promise((resolve) => setTimeout(resolve, ((previous + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep.set(accountKey, step);
  return currentTotp(secret);
}

function currentTotp(secret: string) {
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
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = ((digest[offset] & 0x7f) << 24)
    | ((digest[offset + 1] & 0xff) << 16)
    | ((digest[offset + 2] & 0xff) << 8)
    | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
