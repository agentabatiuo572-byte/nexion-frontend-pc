import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

type FixtureAccount = {
  username: string;
  password: string;
  totpSecret: string;
};

type PermissionFixture = {
  runId: string;
  accounts: Partial<Record<
    "maker" | "readonly" | "nowrite" | "nomenu" | "c_maker" | "c_readonly" | "c_no_write" | "c_no_menu",
    FixtureAccount
  >>;
};

type ModuleProbe = {
  id: string;
  path: string;
  title: string;
  readyText?: string;
  readPath: string;
  writePath: string;
  writeMethod: "POST" | "PATCH";
  writeBody: Record<string, unknown>;
  errorText: RegExp;
};

const USERNAME = process.env.ADMIN_E2E_USERNAME?.trim() || "superadmin";
const PASSWORD = process.env.ADMIN_E2E_PASSWORD || "Admin@123456";
const USER_ID = process.env.C_NONOWNER_USER_ID || "990000151023";
const USER_NO = process.env.C_NONOWNER_USER_NO || "U990000151023";
const EVIDENCE_DIR = process.env.C_NONOWNER_EVIDENCE_DIR;
const fixturePath = process.env.ADMIN_PERMISSION_FIXTURE;
if (!fixturePath) throw new Error("ADMIN_PERMISSION_FIXTURE is required");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as PermissionFixture;
const makerAccount = requiredFixtureAccount(fixture.accounts, "maker", "c_maker");
const readonlyAccount = requiredFixtureAccount(fixture.accounts, "readonly", "c_readonly");
const noWriteAccount = requiredFixtureAccount(fixture.accounts, "nowrite", "c_no_write");
const noMenuAccount = requiredFixtureAccount(fixture.accounts, "nomenu", "c_no_menu");

const MODULES: ModuleProbe[] = [
  {
    id: "C1",
    path: "/users/search",
    title: "检索 & 画像",
    readPath: "/api/admin/users/overview",
    writePath: "/api/admin/users/profiles/export",
    writeMethod: "POST",
    writeBody: { keyword: USER_NO, operator: "superadmin" },
    errorText: /C1 统计加载失败/,
  },
  {
    id: "C2",
    path: "/users/actions",
    title: "账户操作",
    readPath: "/api/admin/users/account-actions/overview",
    writePath: `/api/admin/users/profiles/${USER_ID}/status`,
    writeMethod: "PATCH",
    writeBody: {
      status: "FROZEN",
      reasonCode: "PERMISSION_PROBE",
      reason: "C 域权限篡改探针不得执行",
      operator: "superadmin",
    },
    errorText: /C2 数据加载失败/,
  },
  {
    id: "C3",
    path: "/users/assets",
    title: "余额 & 资产调整",
    readPath: "/api/admin/users/asset-adjustments/overview",
    writePath: `/api/admin/users/profiles/${USER_ID}/asset-adjustments`,
    writeMethod: "POST",
    writeBody: {
      asset: "USDT",
      direction: "DEBIT",
      amount: "0.01",
      reasonCode: "PERMISSION_PROBE",
      reason: "C 域权限篡改探针不得执行",
      operator: "superadmin",
    },
    errorText: /余额调整数据加载失败/,
  },
  {
    id: "C5",
    path: "/users/security",
    title: "安全 & 会话",
    readyText: "凭证与会话参数",
    readPath: "/api/admin/users/security/overview?pageNum=1&pageSize=10",
    writePath: `/api/admin/users/profiles/${USER_ID}/security/sessions/revoke-all`,
    writeMethod: "POST",
    writeBody: {
      reason: "C 域权限篡改探针不得执行",
      operator: "superadmin",
    },
    errorText: /C5 数据加载失败/,
  },
  {
    id: "C6",
    path: "/users/reg-risk",
    title: "注册/登录风控",
    readPath: "/api/admin/users/registration-risk/overview",
    writePath: "/api/admin/users/registration-risk/params/lockShort",
    writeMethod: "PATCH",
    writeBody: {
      value: "5 次 / 30 分钟",
      reason: "C 域权限篡改探针不得执行",
      operator: "superadmin",
      expectedVersion: -1,
    },
    errorText: /C6 数据加载失败/,
  },
];

const CROSS_DOMAIN_READS = {
  D: "/api/admin/bills?pageNum=1&pageSize=10",
  G: "/api/admin/market/exchange",
  K: "/api/admin/risk/scoring/overview",
  M: "/api/admin/content/tickets?pageNum=1&pageSize=1",
};

function selectedModuleSlice() {
  const requested = process.env.C_NONOWNER_MODULES
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!requested?.length) return MODULES;
  const selected = MODULES.filter((module) => requested.includes(module.id));
  if (!selected.length) throw new Error(`C_NONOWNER_MODULES selects no C module: ${requested.join(",")}`);
  return selected;
}

test.describe.serial("C 域非 Owner B：C1–C6 完整复审", () => {
  test.beforeAll(() => {
    if (EVIDENCE_DIR) mkdirSync(EVIDENCE_DIR, { recursive: true });
  });

  test("匿名 401、登录可见侧栏、六模块真实读取、刷新返回重登与跨域事实一致", async ({ page }) => {
    const anonymous: number[] = [];
    for (const module of MODULES) {
      anonymous.push((await page.request.get(module.readPath)).status());
    }
    expect(anonymous).toEqual([401, 401, 401, 401, 401, 401]);

    const runtime = monitorRuntime(page);
    await loginSuperadmin(page);
    await assertVisibleCMenus(page);

    const moduleReads: Array<{ module: string; status: number; refresh: number }> = [];
    let c6RestoredValue = "";
    for (const module of MODULES) {
      const first = await openVisibleModule(page, module);
      expect(first.status()).toBe(200);
      await expectModuleReady(page, module);
      await expect(page.locator(".cdom")).toBeVisible();
      await expect(page.locator("body")).not.toContainText(module.errorText);

      const refresh = page.waitForResponse((response) =>
        new URL(response.url()).pathname === new URL(module.readPath, "http://local").pathname
        && response.request().method() === "GET");
      await page.reload({ waitUntil: "domcontentloaded" });
      const refreshResponse = await refresh;
      expect(refreshResponse.status()).toBe(200);
      await expectModuleReady(page, module);
      if (module.id === "C6") {
        const lockShortValue = page.locator(".p-row").filter({ hasText: "短锁" }).first().locator(".v");
        await expect(lockShortValue).toContainText("5 次 / 30 分钟");
        c6RestoredValue = (await lockShortValue.innerText()).trim();
      }
      moduleReads.push({ module: module.id, status: first.status(), refresh: refreshResponse.status() });
    }

    await openVisibleModule(page, MODULES[0]);
    await openVisibleModule(page, MODULES[1]);
    await page.goBack({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/users\/search$/);
    await page.goForward({ waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/users\/actions$/);

    const c1 = await browserApi(page, "GET", `/api/admin/users/profiles/${USER_ID}/360`);
    const c2 = await browserApi(page, "GET", `/api/admin/users/account-actions/accounts/${USER_NO}`);
    const c3 = await browserApi(page, "GET", `/api/admin/users/asset-adjustments?keyword=${USER_NO}&pageNum=1&pageSize=50`);
    const d4 = await browserApi(page, "GET", `/api/admin/bills?keyword=${USER_NO}&pageNum=1&pageSize=100`);
    const k4 = await browserApi(page, "GET", "/api/admin/risk/scoring/overview");
    const l5 = await browserApi(page, "GET", "/api/admin/bi/export/overview");
    const g2 = await browserApi(page, "GET", CROSS_DOMAIN_READS.G);
    const m2 = await browserApi(page, "GET", `/api/admin/content/tickets?keyword=${encodeURIComponent(USER_NO)}&pageNum=1&pageSize=10`);
    // The C maker has the C1–C3/C5/C6 read grants (including C1HUB), but deliberately
    // has no D/K/L/G/M grant.  Treat every cross-domain response as an RBAC
    // boundary check instead of accidentally testing this least-privilege user
    // as if it were the global superadmin.
    for (const [label, result] of Object.entries({ c1, c2, c3 })) {
      expect(result.status, label).toBe(200);
    }
    for (const [label, result] of Object.entries({ d4, k4, l5, g2, m2 })) {
      expect(result.status, label).toBe(403);
    }
    expect(JSON.stringify(c1.data)).toContain(USER_NO);
    expect(JSON.stringify(c2.data)).toContain(USER_NO);
    expect(String(findKey(c2.data, "status")).toUpperCase()).toBe("ACTIVE");
    expect(JSON.stringify(c3.data)).toContain(USER_NO);
    assertMaskedPhoneFields(c1.data);

    expect((await page.request.get("/api/admin/users/not-a-real-route")).status()).toBe(404);
    await logout(page);
    await loginSuperadmin(page);
    await assertVisibleCMenus(page);
    expect((await openVisibleModule(page, MODULES[5])).status()).toBe(200);
    expect((await openVisibleModule(page, MODULES[0])).status()).toBe(200);
    const emptyKeyword = `C_EMPTY_${fixture.runId.replace(/[^A-Za-z0-9]/g, "").slice(-12)}`;
    const emptyResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/admin/users/profiles"
      && response.request().method() === "GET"
      && response.url().includes(encodeURIComponent(emptyKeyword)));
    await page.locator('input[placeholder="用户编码 / 昵称 / 推荐码 / 脱敏手机号 / 手机哈希"]').fill(emptyKeyword);
    expect((await emptyResponse).status()).toBe(200);
    await expect(page.getByText("无匹配用户 · 换个检索词或分组试试", { exact: true })).toBeVisible();
    await expect(page.locator("tbody tr.click")).toHaveCount(0);
    expect(runtime.pageErrors).toEqual([]);
    expect(runtime.admin5xx).toEqual([]);
    expect(runtime.consoleErrors).toEqual([]);

    writeEvidence("superadmin-read-cross-domain.json", {
      anonymous,
      moduleReads,
      relogin: "PASS",
      user: USER_NO,
      c2Status: findKey(c2.data, "status"),
      c6RestoredValue,
      c1EmptyState: "PASS",
      crossDomain: {
        C3_D4: [c3.status, d4.status],
        K4_L5: [k4.status, l5.status],
        C_G_M: [g2.status, m2.status],
      },
      pageErrors: runtime.pageErrors,
      admin5xx: runtime.admin5xx,
      consoleErrors: runtime.consoleErrors,
    });
  });

  for (const [profile, account, accountKey] of [
    ["readonly", readonlyAccount, "readonly"],
    ["menu-no-write", noWriteAccount, "nowrite"],
  ] as const) {
    test(`${profile} 五层权限：C1–C6 只读、写篡改 403、刷新重登不漂移`, async ({ page }) => {
      const selectedModules = selectedModuleSlice();
      const runtime = monitorRuntime(page);
      await loginFixture(page, account, accountKey);
      await assertSessionShape(page, { hasCRead: true });
      await assertVisibleCMenus(page);

      const matrix: Array<{ module: string; read: number; write: number }> = [];
      for (const module of selectedModules) {
        expect((await openVisibleModule(page, module)).status()).toBe(200);
        await expectModuleReady(page, module);
        await assertNoEnabledDangerousButton(page, module.id);
        const read = await browserApi(page, "GET", module.readPath);
        const write = await browserApi(page, module.writeMethod, module.writePath, module.writeBody);
        expect(read.status, `${profile} ${module.id} read`).toBe(200);
        expect(write.status, `${profile} ${module.id} forged write`).toBe(403);
        matrix.push({ module: module.id, read: read.status, write: write.status });
      }

      await page.reload({ waitUntil: "domcontentloaded" });
      await assertNoEnabledDangerousButton(page, selectedModules.at(-1)?.id ?? MODULES[5].id);
      await logout(page);
      await loginFixture(page, account, accountKey);
      await assertSessionShape(page, { hasCRead: true });
      expect((await browserApi(page, "GET", selectedModules[0].readPath)).status).toBe(200);
      expect((await browserApi(page, selectedModules.at(-1)?.writeMethod ?? "PATCH", selectedModules.at(-1)?.writePath ?? MODULES[5].writePath, selectedModules.at(-1)?.writeBody ?? MODULES[5].writeBody)).status).toBe(403);
      expect(runtime.pageErrors).toEqual([]);
      expect(runtime.admin5xx).toEqual([]);
      writeEvidence(`${profile}-permissions.json`, { matrix, refresh: "PASS", relogin: "PASS" });
    });
  }

  test("no-menu 五层权限：菜单/路由/读写接口拒绝，刷新重登不被缓存放大", async ({ page }) => {
    const account = noMenuAccount;
    await loginFixture(page, account, "nomenu");
    await assertSessionShape(page, { hasCRead: false, hasMenu: false });
    await expect(page.locator('aside a[href^="/users/"]')).toHaveCount(0);

    await page.goto(MODULES[0].path, { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/users\/search(?:\?.*)?$/);
    await expect(page.locator(".cdom")).toHaveCount(0);

    const matrix: Array<{ module: string; read: number; write: number }> = [];
    for (const module of MODULES) {
      const read = await browserApi(page, "GET", module.readPath);
      const write = await browserApi(page, module.writeMethod, module.writePath, module.writeBody);
      expect(read.status, `no-menu ${module.id} read`).toBe(403);
      expect(write.status).toBe(403);
      matrix.push({ module: module.id, read: read.status, write: write.status });
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('aside a[href^="/users/"]')).toHaveCount(0);
    await logout(page);
    await loginFixture(page, account, "nomenu");
    await assertSessionShape(page, { hasCRead: false, hasMenu: false });
    expect((await browserApi(page, "GET", MODULES[0].readPath)).status).toBe(403);
    writeEvidence("no-menu-permissions.json", { matrix, directRoute: "DENIED", readApi: "DENIED", refresh: "DENIED", relogin: "DENIED" });
  });

  test("maker 无写探针：真实登录、C1–C6 菜单/路由/读取及刷新重登；记录职责分离越权", async ({ page }) => {
    await loginFixture(page, makerAccount, "maker");
    await assertSessionShape(page, { hasCRead: true });
    await assertVisibleCMenus(page);

    const reads: Array<{ module: string; status: number; refresh: number }> = [];
    for (const module of MODULES) {
      expect((await openVisibleModule(page, module)).status()).toBe(200);
      await expectModuleReady(page, module);
      const refresh = page.waitForResponse((response) =>
        new URL(response.url()).pathname === new URL(module.readPath, "http://local").pathname
        && response.request().method() === "GET");
      await page.reload({ waitUntil: "domcontentloaded" });
      expect((await refresh).status()).toBe(200);
      reads.push({ module: module.id, status: 200, refresh: 200 });
    }
    const session = await browserApi(page, "GET", "/api/admin/auth/session");
    const authorities = collectStrings(findKey(session.data, "authorities"));
    const forbidden = authorities.filter((authority) =>
      /(?:approve|decrypt|rbac_grants|role_grants)/i.test(authority)
      || /^(?:overview_b|finance_d|device_e|network_f|finprod_g|growth_h|content_i|emergency_j|risk_k|bi_l|service_m)/.test(authority),
    );
    await logout(page);
    await loginFixture(page, makerAccount, "maker");
    expect((await browserApi(page, "GET", MODULES[0].readPath)).status).toBe(200);
    writeEvidence("maker-no-write-scope.json", {
      reads,
      refresh: "PASS",
      relogin: "PASS",
      successfulBusinessWrites: 0,
      forbiddenAuthorities: forbidden,
    });
    expect(forbidden, "maker 不得携带 checker/approve/decrypt/RBAC 或跨域业务权限").toEqual([]);
  });

  test("C1–C6 畸形 200 全部模块内失败关闭，503/超时可恢复", async ({ page }) => {
    await loginSuperadmin(page);
    const results: Array<{ module: string; malformed: string; recovered: number }> = [];
    for (const module of MODULES) {
      const pattern = exactApiPattern(module.readPath);
      await page.route(pattern, (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, message: "OK", data: { malformed: true } }),
      }));
      await openVisibleModule(page, module);
      await expect(page.getByText(module.errorText).first()).toBeVisible();
      if (module.id !== "C1") {
        await assertNoEnabledDangerousButton(page, module.id);
      }
      await page.unroute(pattern);
      const recovered = page.waitForResponse((response) =>
        new URL(response.url()).pathname === new URL(module.readPath, "http://local").pathname
        && response.request().method() === "GET");
      await page.reload({ waitUntil: "domcontentloaded" });
      const response = await recovered;
      expect(response.status()).toBe(200);
      await expect(page.getByText(module.errorText)).toHaveCount(0);
      results.push({ module: module.id, malformed: "FAIL_CLOSED", recovered: response.status() });
    }

    await page.route(exactApiPattern(MODULES[2].readPath), (route) => route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ code: 503, message: "C3_ACCEPTANCE_INJECTED_FAILURE", data: null }),
    }));
    await openVisibleModule(page, MODULES[2]);
    await expect(page.getByText(MODULES[2].errorText).first()).toBeVisible();
    await page.unroute(exactApiPattern(MODULES[2].readPath));

    await page.route(exactApiPattern(MODULES[4].readPath), (route) => route.abort("timedout"));
    await openVisibleModuleWithRequestFailure(page, MODULES[4]);
    await expect(page.getByText(MODULES[4].errorText).first()).toBeVisible();
    await expect(page.getByText(MODULES[4].errorText).first()).toBeVisible();
    await page.unroute(exactApiPattern(MODULES[4].readPath));
    const recovery = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/admin/users/security/overview"
      && response.request().method() === "GET");
    await page.reload({ waitUntil: "domcontentloaded" });
    expect((await recovery).status()).toBe(200);
    await expect(page.getByText(MODULES[4].errorText)).toHaveCount(0);

    writeEvidence("malformed-timeout-recovery.json", { results, c3_503: "FAIL_CLOSED", c5_timeout: "FAIL_CLOSED_RECOVERED" });
  });

  test("C6 未知结果同载荷重试复用 key，修改理由生成新 key，且不触碰真实配置", async ({ page }) => {
    await loginSuperadmin(page);
    expect((await openVisibleModule(page, MODULES[5])).status()).toBe(200);
    const keys: string[] = [];
    await page.route("**/api/admin/users/registration-risk/params/*", async (route) => {
      keys.push(route.request().headers()["idempotency-key"] ?? "");
      await route.fulfill({
        status: 503,
        headers: { "X-Nexion-Upstream-Outcome": "unknown" },
        contentType: "application/json",
        body: JSON.stringify({ code: 503, message: "UPSTREAM_OUTCOME_UNKNOWN", data: null }),
      });
    });

    await page.getByRole("button", { name: "调整", exact: true }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.getByLabel(/操作理由/).fill("C6 非Owner未知结果同键重试验证");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = page.waitForResponse((candidate) =>
        new URL(candidate.url()).pathname.includes("/api/admin/users/registration-risk/params/")
        && candidate.request().method() === "PATCH");
      await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
      expect((await response).status()).toBe(503);
      await expect(dialog).toBeVisible();
      await expect(page.getByText(/结果未知|结果暂不确定/).first()).toBeVisible();
    }
    await dialog.getByLabel(/操作理由/).fill("C6 非Owner未知结果修改载荷生成新键");
    const changed = page.waitForResponse((candidate) =>
      new URL(candidate.url()).pathname.includes("/api/admin/users/registration-risk/params/")
      && candidate.request().method() === "PATCH");
    await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
    expect((await changed).status()).toBe(503);
    expect(keys).toHaveLength(3);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    await page.unroute("**/api/admin/users/registration-risk/params/*");
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    const real = await browserApi(page, "GET", MODULES[5].readPath);
    expect(real.status).toBe(200);
    writeEvidence("c6-unknown-idempotency.json", { attempts: 3, samePayloadSameKey: true, changedPayloadNewKey: true, realWrite: false });
  });
});

async function loginSuperadmin(page: Page) {
  // The locked Final13 runtime requires normal MFA.  Reuse the same visible
  // login state machine as the restricted C maker rather than treating the
  // password-login challenge as an authenticated console session.
  await loginFixture(page, makerAccount, "maker");
  const session = await browserApi(page, "GET", "/api/admin/auth/session");
  expect(session.status).toBe(200);
  expect(JSON.stringify(session.data)).toContain("user_c1hub_read");
}

function requiredFixtureAccount(
  accounts: PermissionFixture["accounts"],
  canonical: keyof PermissionFixture["accounts"],
  legacy: keyof PermissionFixture["accounts"],
) {
  const account = accounts[canonical] ?? accounts[legacy];
  if (!account?.username || !account.password || !account.totpSecret) {
    throw new Error(`permission fixture account is required: ${String(canonical)} or ${String(legacy)}`);
  }
  return account;
}

async function loginFixture(page: Page, account: FixtureAccount, accountKey: string) {
  let lastCode: number | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const shell = page.locator("aside");
    const username = page.locator('input[autocomplete="username"]');
    await expect.poll(
      async () => (await shell.isVisible()) || (await username.isVisible()),
      { timeout: 20_000, intervals: [250] },
    ).toBe(true);
    if (await shell.isVisible()) break;
    try {
      await username.fill(account.username, { timeout: 5_000 });
    } catch (error) {
      if (await shell.isVisible()) break;
      throw error;
    }
    if (await shell.isVisible()) break;
    try {
      await page.locator('input[autocomplete="current-password"]').fill(account.password, { timeout: 5_000 });
    } catch (error) {
      if (await shell.isVisible()) break;
      throw error;
    }
    if (await shell.isVisible()) break;
    const loginButton = page.getByRole("button", { name: /继续|登录/ });
    await expect.poll(
      async () => (await shell.isVisible()) || (await loginButton.isVisible()),
      { timeout: 20_000, intervals: [100, 250] },
    ).toBe(true);
    if (await shell.isVisible()) break;
    const loginResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/admin/auth/login"
      && response.request().method() === "POST");
    try {
      await loginButton.click({ timeout: 5_000 });
    } catch (error) {
      if (await shell.isVisible()) break;
      throw error;
    }
    const loginOutcome = await Promise.race([
      loginResponse.then((response) => ({ kind: "response" as const, response })),
      shell.waitFor({ state: "visible", timeout: 20_000 }).then(() => ({ kind: "shell" as const })),
    ]);
    if (loginOutcome.kind === "shell") break;
    const loginPayload = await loginOutcome.response.json().catch(() => null) as { code?: number; message?: string } | null;
    if (loginPayload?.code !== 0) {
      throw new Error(`${accountKey} credential failed code=${loginPayload?.code ?? "none"} message=${loginPayload?.message ?? "none"}`);
    }
    const otp = page.getByLabel("一次性验证码");
    if (!(await otp.isVisible({ timeout: 5_000 }).catch(() => false))) {
      if (await shell.isVisible().catch(() => false)) break;
      continue;
    }
    const code = await freshTotp(accountKey, account.totpSecret);
    // A successful MFA transition can render the console between the visibility
    // probe and fill. Treat that terminal shell as success instead of retrying
    // against a vanished OTP input.
    if (await shell.isVisible().catch(() => false)) break;
    if (!(await otp.isVisible({ timeout: 1_000 }).catch(() => false))) continue;
    await otp.fill(code);
    const verification = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/admin/auth/mfa/verify"
      && response.request().method() === "POST");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const verified = await verification;
    const result = await verified.json().catch(() => null) as { code?: number } | null;
    lastCode = result?.code;
    if (verified.status() === 200 && result?.code === 0) {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      break;
    }
    if (attempt === 2) throw new Error(`${accountKey} MFA failed code=${lastCode ?? "none"}`);
  }
  await expect(page.locator("aside"), `${accountKey} shell code=${lastCode ?? "none"}`).toBeVisible({ timeout: 20_000 });
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

async function assertVisibleCMenus(page: Page) {
  const domain = CONSOLE_NAV.find((item) => item.code === "C");
  if (!domain) throw new Error("C domain missing from nav source");
  const group = page.locator("aside button").filter({ hasText: /用户与账户/ }).first();
  if (!(await page.locator(`aside a[href="${domain.l2[0].path}"]`).first().isVisible({ timeout: 2_000 }).catch(() => false))) {
    await group.click();
  }
  for (const module of domain.l2) {
    await expect(page.locator(`aside a[href="${module.path}"]`).first()).toBeVisible();
  }
}

async function openVisibleModule(page: Page, module: ModuleProbe) {
  await assertVisibleCMenus(page);
  const link = page.locator(`aside a[href="${module.path}"]`).first();
  const expectedPath = new URL(module.readPath, "http://local").pathname;
  const response = page.waitForResponse((candidate) =>
    new URL(candidate.url()).pathname === expectedPath
    && candidate.request().method() === "GET");
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(module.path)}(?:\\?.*)?$`));
  return response;
}

async function expectModuleReady(page: Page, module: ModuleProbe) {
  const ready = module.readyText
    ? page.getByText(module.readyText, { exact: true })
    : page.getByRole("heading", { name: module.title, exact: true });
  await expect(ready).toBeVisible();
}

async function openVisibleModuleWithRequestFailure(page: Page, module: ModuleProbe) {
  await assertVisibleCMenus(page);
  const link = page.locator(`aside a[href="${module.path}"]`).first();
  const expectedPath = new URL(module.readPath, "http://local").pathname;
  const failed = page.waitForEvent("requestfailed", {
    predicate: (request) =>
      new URL(request.url()).pathname === expectedPath
      && request.method() === "GET",
  });
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(module.path)}(?:\\?.*)?$`));
  return failed;
}

async function assertSessionShape(page: Page, expected: { hasCRead: boolean; hasMenu?: boolean }) {
  const session = await browserApi(page, "GET", "/api/admin/auth/session");
  expect(session.status).toBe(200);
  const authorities = collectStrings(findKey(session.data, "authorities"));
  const menus = collectStrings(findKey(session.data, "menuCodes") ?? findKey(session.data, "effectiveMenus"));
  if (expected.hasCRead) {
    for (const authority of ["user_c1_read", "user_c2_read", "user_c3_read", "user_c5_read", "user_c6_read"]) {
      expect(authorities).toContain(authority);
    }
    if (expected.hasMenu !== false) expect(menus.length).toBeGreaterThan(0);
    else expect(menus).toEqual([]);
  } else {
    expect(authorities).toEqual([]);
    expect(menus).toEqual([]);
  }
}

async function assertNoEnabledDangerousButton(page: Page, moduleId: string) {
  const pattern = {
    C1: /导出/,
    C2: /^(冻结|恢复|强制登出|发起模拟登录|\+ 加入信任名单|\+ 加入禁入名单)$/,
    C3: /发起调整|冲正|批准|拒绝|重新放行/,
    C5: /踢线|关闭 2FA|密码重置|解锁|调整/,
    C6: /^(调整|立即恢复|紧急关闭)$/,
  }[moduleId] ?? /$^/;
  const dangerous = page.locator(".cdom button:not([disabled])").filter({
    hasText: pattern,
  });
  await expect(dangerous).toHaveCount(0);
}

async function browserApi(
  page: Page,
  method: "GET" | "POST" | "PATCH",
  requestPath: string,
  body?: Record<string, unknown>,
) {
  return page.evaluate(async ({ requestMethod, apiPath, requestBody, runId }) => {
    const response = await fetch(apiPath, {
      method: requestMethod,
      credentials: "same-origin",
      headers: requestMethod === "GET"
        ? undefined
        : {
            "Content-Type": "application/json",
            "Idempotency-Key": `c-nonowner-b-${runId}-${crypto.randomUUID()}`,
          },
      body: requestMethod === "GET" ? undefined : JSON.stringify(requestBody ?? {}),
    });
    const payload = await response.json().catch(() => null) as { code?: number; data?: unknown } | null;
    return { status: response.status, code: payload?.code, data: payload?.data };
  }, { requestMethod: method, apiPath: requestPath, requestBody: body, runId: fixture.runId });
}

function exactApiPattern(endpoint: string) {
  const pathname = new URL(endpoint, "http://local").pathname;
  return `**${pathname}*`;
}

function monitorRuntime(page: Page) {
  const pageErrors: string[] = [];
  const admin5xx: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    const pathname = new URL(response.url()).pathname;
    if (pathname.startsWith("/api/admin/") && response.status() >= 500) {
      admin5xx.push(`${response.status()} ${pathname}`);
    }
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Failed to load resource.*(?:401|403)/i.test(text)) return;
    consoleErrors.push(text);
  });
  return { pageErrors, admin5xx, consoleErrors };
}

function assertMaskedPhoneFields(value: unknown) {
  const phones: string[] = [];
  collectKeyValues(value, "phoneMasked", phones);
  for (const phone of phones) {
    expect(phone).toMatch(/^(?:\+\d{1,3}[- ]?)?\d{0,3}\*{3,}\d{2,4}$/);
  }
}

function collectKeyValues(value: unknown, key: string, target: string[]) {
  if (!value || typeof value !== "object") return;
  if (!Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    if (typeof record[key] === "string") target.push(record[key]);
  }
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  for (const child of children) collectKeyValues(child, key, target);
}

function findKey(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined;
  if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, key)) {
    return (value as Record<string, unknown>)[key];
  }
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  for (const child of children) {
    const found = findKey(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function collectStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [item];
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      return [record.code, record.menuCode].filter((entry): entry is string => typeof entry === "string");
    }
    return [];
  });
}

function writeEvidence(name: string, value: unknown) {
  if (!EVIDENCE_DIR) return;
  writeFileSync(path.join(EVIDENCE_DIR, name), JSON.stringify(value, null, 2));
}

const lastTotpStep = new Map<string, number>();

async function freshTotp(accountKey: string, secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  const previous = lastTotpStep.get(accountKey) ?? -1;
  if (step <= previous) {
    await expect.poll(() => Math.floor(Date.now() / 30_000), {
      timeout: 35_000,
      intervals: [500],
      message: `${accountKey} waits for a fresh MFA counter`,
    }).toBeGreaterThan(previous);
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) {
    const current = Math.floor(Date.now() / 30_000);
    await expect.poll(() => Math.floor(Date.now() / 30_000), {
      timeout: 5_000,
      intervals: [250],
    }).toBeGreaterThan(current);
  }
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
