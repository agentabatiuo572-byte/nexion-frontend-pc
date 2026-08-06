import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

type FixtureAccount = { username: string; password: string; totpSecret: string };
type PermissionFixture = {
  runId: string;
  accounts: Partial<Record<
    "maker" | "readonly" | "nowrite" | "nomenu" | "k_maker" | "k_readonly" | "k_no_write" | "k_no_menu",
    FixtureAccount
  >>;
};
type ModuleProbe = {
  id: string;
  path: string;
  marker: RegExp;
  readPath: string;
  writePath: string;
  writeMethod: "PATCH" | "POST" | "PUT";
  writeBody: Record<string, unknown>;
  mutationButtons: RegExp;
};

const fixturePath = process.env.K_PERMISSION_FIXTURE_PATH;
if (!fixturePath) throw new Error("K_PERMISSION_FIXTURE_PATH is required");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as PermissionFixture;
const REASON = "K 域权限探针不得执行";
const MODULES: ModuleProbe[] = [
  {
    id: "K1",
    path: "/risk/multi-account",
    marker: /三层去重命中列表/,
    readPath: "/api/admin/risk/multi-account/overview",
    writePath: "/api/admin/risk/multi-account/params/sharedIpAccounts",
    writeMethod: "PATCH",
    writeBody: { value: "3", expectedVersion: -1, reason: REASON },
    mutationButtons: /调整|添加白名单|移除|标可疑|批量冻结|解除误判|判正常|保存复审/,
  },
  {
    id: "K2",
    path: "/risk/abuse",
    marker: /检测阈值/,
    readPath: "/api/admin/risk/arbitrage/overview",
    writePath: "/api/admin/risk/arbitrage/params/trial.cycleThreshold",
    writeMethod: "PATCH",
    writeBody: { value: "3 cycles / 30 days", expectedVersion: -1, reason: REASON },
    mutationButtons: /调整|联动 K1 冻结|标记套利|拦截新人礼|标记刷榜/,
  },
  {
    id: "K3",
    path: "/risk/withdrawal-rules",
    marker: /四道关 · 规则配置/,
    readPath: "/api/admin/risk/withdraw-rules/overview",
    writePath: "/api/admin/risk/withdraw-rules/dry-runs",
    writeMethod: "POST",
    writeBody: { reason: REASON },
    mutationButtons: /调整|新建规则|沙盒模拟|启用|停用|归档|编辑/,
  },
  {
    id: "K4",
    path: "/risk/scoring",
    marker: /K4 评分模型/,
    readPath: "/api/admin/risk/scoring/overview",
    writePath: "/api/admin/risk/scoring/model/draft",
    writeMethod: "PUT",
    writeBody: { expectedVersion: -1, reason: REASON },
    mutationButtons: /保存模型草稿|发布模型草稿|恢复为草稿|人工覆盖评分|重算回模型分|全部重算|标记已读/,
  },
  {
    id: "K5",
    path: "/risk/kyc-review",
    marker: /复审触发队列/,
    readPath: "/api/admin/risk/kyc-review/overview",
    writePath: "/api/admin/risk/kyc-review/subscription",
    writeMethod: "PATCH",
    writeBody: { expectedVersion: -1, alertTypes: ["large-withdrawal"], channels: ["in-app"], reason: REASON },
    mutationButtons: /调整|保存订阅|手动补触发|通过|驳回/,
  },
  {
    id: "K6",
    path: "/risk/janus-c2",
    marker: /Janus C2/,
    readPath: "/api/admin/janus/dashboard",
    writePath: "/api/admin/janus/devices/UNKNOWN/status",
    writeMethod: "POST",
    writeBody: { status: "disabled", expectedVersion: -1, reason: REASON },
    mutationButtons: /新建策略|编辑|发布|暂停|归档|回滚|复制|下发|启用|禁用|新增目标|停用目标/,
  },
];

test.describe.serial("K 域 readonly/no-write/no-menu 五层权限", () => {
  for (const key of ["readonly", "nowrite"] as const) {
    test(`${key}：K1-K6 菜单/路由/数据可读，按钮和接口写入拒绝`, async ({ page }) => {
      const pageErrors = monitorPageErrors(page);
      await login(page, fixtureAccount(key), key);
      await assertSession(page, true);
      await assertVisibleKMenus(page);
      for (const module of MODULES) {
        await openVisibleModule(page, module);
        await expect(page.getByText(module.marker).first(), `${key} ${module.id}`).toBeVisible({ timeout: 20_000 });
        const read = await browserApi(page, "GET", module.readPath);
        const write = await browserApi(page, module.writeMethod, module.writePath, module.writeBody);
        expect(read.status, `${key} ${module.id} read`).toBe(200);
        expect(read.hasData, `${key} ${module.id} data`).toBe(true);
        expect(write.status, `${key} ${module.id} write`).toBe(403);
        expect(await enabledMutationCount(page, module.mutationButtons), `${key} ${module.id} enabled writes`).toBe(0);
      }
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByText(MODULES.at(-1)!.marker).first()).toBeVisible();
      await logout(page);
      await login(page, fixtureAccount(key), key);
      await assertVisibleKMenus(page);
      expect((await browserApi(page, "GET", MODULES[0].readPath)).status).toBe(200);
      expect((await browserApi(page, MODULES[0].writeMethod, MODULES[0].writePath, MODULES[0].writeBody)).status).toBe(403);
      expect(pageErrors).toEqual([]);
    });
  }

  test("maker：K1-K6 菜单与只读数据可达，刷新重登不漂移且不执行业务写", async ({ page }) => {
    const pageErrors = monitorPageErrors(page);
    const account = fixtureAccount("maker");
    await login(page, account, "maker");
    await assertMakerSession(page);
    await assertVisibleKMenus(page);
    for (const module of MODULES) {
      await openVisibleModule(page, module);
      await expect(page.getByText(module.marker).first(), `maker ${module.id}`).toBeVisible({ timeout: 20_000 });
      const read = await browserApi(page, "GET", module.readPath);
      expect(read.status, `maker ${module.id} read`).toBe(200);
      expect(read.hasData, `maker ${module.id} data`).toBe(true);
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(MODULES.at(-1)!.marker).first()).toBeVisible();
    await logout(page);
    await login(page, account, "maker");
    await assertMakerSession(page);
    await assertVisibleKMenus(page);
    const reloginRead = await browserApi(page, "GET", MODULES[0].readPath);
    expect(reloginRead.status).toBe(200);
    expect(reloginRead.hasData).toBe(true);
    expect(pageErrors).toEqual([]);
  });

  test("nomenu：K 菜单、直接路由、读写接口均拒绝，刷新重登不恢复", async ({ page }) => {
    const pageErrors = monitorPageErrors(page);
    const account = fixtureAccount("nomenu");
    await login(page, account, "nomenu");
    await assertSession(page, false);
    await expect(page.locator('a[href^="/risk/"]')).toHaveCount(0);
    await page.goto(MODULES[0].path, { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/risk\/multi-account(?:\?.*)?$/);
    for (const module of MODULES) {
      const read = await browserApi(page, "GET", module.readPath);
      expect(read.status, `${module.id} read`).toBe(403);
      expect((await browserApi(page, module.writeMethod, module.writePath, module.writeBody)).status, `${module.id} write`).toBe(403);
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('a[href^="/risk/"]')).toHaveCount(0);
    await logout(page);
    await login(page, account, "nomenu");
    await assertSession(page, false);
    await expect(page.locator('a[href^="/risk/"]')).toHaveCount(0);
    const reloginRead = await browserApi(page, "GET", MODULES[0].readPath);
    expect(reloginRead.status).toBe(403);
    expect(pageErrors).toEqual([]);
  });
});

async function login(page: Page, account: FixtureAccount, key: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  if (await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false)) return;
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
  const usernameInput = page.locator('input[autocomplete="username"]');
  const passwordInput = page.locator('input[autocomplete="current-password"]');
  await usernameInput.fill(account.username);
  await passwordInput.fill(account.password);
  // React's login form can remount while a shared candidate is under load; prove
  // the visible form still owns the intended credentials before submitting.
  await page.waitForTimeout(150);
  if (await usernameInput.inputValue() !== account.username) await usernameInput.fill(account.username);
  if (await passwordInput.inputValue() !== account.password) await passwordInput.fill(account.password);
  await expect(usernameInput).toHaveValue(account.username);
  await expect(passwordInput).toHaveValue(account.password);
  const loginResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const loginPayload = await (await loginResponse).json().catch(() => null) as { code?: number; message?: string } | null;
  expect(loginPayload?.code, `${key} credentials: ${loginPayload?.message ?? "no body"}`).toBe(0);
  const otp = page.getByLabel("一次性验证码");
  if (!(await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false))) {
    await expect(otp, `${key} must enter MFA or receive shell`).toBeVisible({ timeout: 10_000 });
    const first = await submitMfa(page, otp, key, account.totpSecret);
    const final = first.accepted
      ? first
      : first.retryable
        ? await submitMfa(page, otp, key, account.totpSecret, first.step)
        : first;
    if (!final.accepted) {
      throw new Error(`${key} MFA rejected: first=${first.status}/${first.message ?? "none"}, final=${final.status}/${final.message ?? "none"}`);
    }
  }
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function submitMfa(
  page: Page,
  otp: ReturnType<Page["getByLabel"]>,
  key: string,
  secret: string,
  afterStep = -1,
) {
  const totp = await freshTotp(key, secret, afterStep);
  await otp.fill(totp.code);
  const verification = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  const response = await verification;
  const payload = await response.json().catch(() => null) as { code?: number; message?: string } | null;
  const hasCookie = (await page.context().cookies()).some((cookie) => cookie.name === "nexion_admin_token");
  return {
    accepted: response.status() === 200 && (payload?.code === 0 || hasCookie),
    retryable: response.status() === 401 && payload?.message === "ADMIN_MFA_CODE_INVALID",
    status: response.status(),
    message: payload?.message,
    step: totp.step,
  };
}

async function logout(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

async function assertSession(page: Page, hasRead: boolean, hasMenus = hasRead) {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const payload = await response.json() as {
    data?: { session?: { authorities?: string[]; effectiveMenus?: unknown[] } };
  };
  const authorities = payload.data?.session?.authorities ?? [];
  const menus = payload.data?.session?.effectiveMenus ?? [];
  for (let module = 1; module <= 6; module += 1) {
    if (hasRead) expect(authorities).toContain(`risk_k${module}_read`);
    else expect(authorities).not.toContain(`risk_k${module}_read`);
  }
  if (hasRead) {
    expect(authorities.some((permission) =>
      /^risk_k[1-6]_/.test(permission) && !permission.endsWith("_read"))).toBe(false);
    if (hasMenus) expect(menus.length).toBeGreaterThan(0);
    else expect(menus).toEqual([]);
  } else {
    expect(authorities).toEqual([]);
    expect(menus).toEqual([]);
  }
}

async function assertMakerSession(page: Page) {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const payload = await response.json() as {
    data?: { session?: { authorities?: string[]; effectiveMenus?: unknown[] } };
  };
  const authorities = payload.data?.session?.authorities ?? [];
  const menus = payload.data?.session?.effectiveMenus ?? [];
  for (let module = 1; module <= 6; module += 1) {
    expect(authorities).toContain(`risk_k${module}_read`);
  }
  expect(authorities).toContain("risk_k1_write");
  expect(authorities).toContain("risk_k4_write");
  expect(authorities).toContain("risk_k6_write");
  expect(menus.length).toBeGreaterThan(0);
}

function fixtureAccount(key: "maker" | "readonly" | "nowrite" | "nomenu"): FixtureAccount {
  const legacyKey = key === "maker" ? "k_maker" : key === "readonly" ? "k_readonly" : key === "nowrite" ? "k_no_write" : "k_no_menu";
  const account = fixture.accounts[key] ?? fixture.accounts[legacyKey];
  if (!account) throw new Error(`K permission fixture is missing ${key} or ${legacyKey}`);
  return account;
}

async function assertVisibleKMenus(page: Page) {
  const domain = CONSOLE_NAV.find((item) => item.code === "K");
  if (!domain) throw new Error("K domain missing");
  const group = page.getByRole("button", { name: /风控与反作弊/ }).first();
  if (await group.getAttribute("aria-expanded") !== "true") await group.click();
  for (const module of domain.l2) {
    await expect(page.locator(`a[href="${module.path}"]`).first(), `${module.id} menu`).toBeVisible();
  }
}

async function openVisibleModule(page: Page, module: ModuleProbe) {
  const link = page.locator(`a[href="${module.path}"]`).first();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(module.path)}(?:\\?.*)?$`));
}

async function browserApi(
  page: Page,
  method: "GET" | ModuleProbe["writeMethod"],
  requestPath: string,
  body?: Record<string, unknown>,
) {
  return page.evaluate(async ({ requestMethod, apiPath, requestBody, runId }) => {
    const response = await fetch(apiPath, {
      method: requestMethod,
      credentials: "same-origin",
      headers: requestMethod === "GET" ? undefined : {
        "Content-Type": "application/json",
        "Idempotency-Key": `k-permission-${runId}-${crypto.randomUUID()}`,
      },
      body: requestMethod === "GET" ? undefined : JSON.stringify(requestBody ?? {}),
    });
    const payload = await response.json().catch(() => null) as { data?: unknown } | null;
    return { status: response.status, hasData: payload?.data !== undefined };
  }, { requestMethod: method, apiPath: requestPath, requestBody: body, runId: fixture.runId });
}

async function enabledMutationCount(page: Page, name: RegExp) {
  return page.getByRole("button", { name }).evaluateAll((buttons) =>
    buttons.filter((button) => {
      const element = button as HTMLButtonElement;
      const style = window.getComputedStyle(element);
      return !element.disabled && style.visibility !== "hidden" && style.display !== "none";
    }).length);
}

function monitorPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

const lastTotpStep = new Map<string, number>();

async function freshTotp(key: string, secret: string, afterStep = -1) {
  let step = Math.floor(Date.now() / 30_000);
  const previous = Math.max(lastTotpStep.get(key) ?? -1, afterStep);
  if (step <= previous) {
    await new Promise((resolve) => setTimeout(resolve, ((previous + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep.set(key, step);
  return { code: currentTotp(secret), step };
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
