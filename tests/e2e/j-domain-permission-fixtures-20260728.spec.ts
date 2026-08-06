import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

type FixtureAccount = { username: string; password: string; totpSecret: string };
type PermissionFixture = {
  runId: string;
  // New full-run fixtures use domain-neutral names; retain the J-local aliases
  // so that historical J-only runs remain executable.
  accounts: Partial<Record<
    "readonly" | "nowrite" | "nomenu" | "j_readonly" | "j_no_write" | "j_no_menu",
    FixtureAccount
  >>;
};
type ModuleProbe = {
  id: string;
  path: string;
  readPath: string;
  writePath: string;
  writeMethod: "PATCH" | "POST" | "PUT";
  writeBody: Record<string, unknown>;
  visibleText: RegExp;
  forbiddenButtons: RegExp;
};

const fixturePath = process.env.ADMIN_PERMISSION_FIXTURE;
if (!fixturePath) throw new Error("ADMIN_PERMISSION_FIXTURE is required");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as PermissionFixture;
const evidenceDir = process.env.J_PERMISSION_EVIDENCE_DIR;

const MODULES: ModuleProbe[] = [
  {
    id: "J1",
    path: "/emergency/kill-switch",
    readPath: "/api/admin/emergency/kill-switches",
    writePath: "/api/admin/emergency/kill-switches/trial",
    writeMethod: "PUT",
    writeBody: { enabled: "enabled", reason: "权限探针不得执行", operator: "permission-probe" },
    visibleText: /Kill-Switch/,
    forbiddenButtons: /^(关停|恢复|立即应急关停|调整|一键批量关停)$/,
  },
  {
    id: "J2",
    path: "/emergency/geo-block",
    readPath: "/api/admin/emergency/geo-block",
    writePath: "/api/admin/emergency/geo-block/countries/AQ",
    writeMethod: "PUT",
    writeBody: {
      status: "blocked",
      expectedStatus: "allowed",
      triggerBasis: "监管点名",
      reason: "权限探针不得执行",
      operator: "permission-probe",
    },
    visibleText: /Geo-block/,
    forbiddenButtons: /^(编辑黑名单|编辑受限名单|应急封锁|编辑封锁范围|切换判定源)$/,
  },
  {
    id: "J3",
    path: "/emergency/tamper",
    readPath: "/api/admin/emergency/tamper/overview?window=24h&accountPage=1&accountPageSize=5",
    writePath: "/api/admin/emergency/tamper/alert-config",
    writeMethod: "PUT",
    writeBody: {
      threshold: 10,
      feedK4: true,
      reason: "权限探针不得执行",
      operator: "permission-probe",
    },
    visibleText: /篡改防御/,
    forbiddenButtons: /^(告警阈值配置|导出 24h 报表)$/,
  },
  {
    id: "J4",
    path: "/emergency/sop",
    readPath: "/api/admin/emergency/sop/playbooks",
    writePath: "/api/admin/emergency/sop/playbooks",
    writeMethod: "POST",
    writeBody: {
      name: "权限探针不得创建",
      scene: "监管点名",
      owner: "permission-probe",
      reason: "权限探针不得执行",
      operator: "permission-probe",
    },
    visibleText: /应急 SOP|执行追溯/,
    forbiddenButtons: /^(\+ 新增剧本|编辑|演练|应急执行|执行)$/,
  },
];

test.describe.serial("J 域 readonly/no-write/no-menu 五层权限", () => {
  test.beforeAll(() => {
    if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });
  });

  for (const [profile, key] of [
    ["readonly", "readonly"],
    ["menu-no-write", "nowrite"],
  ] as const) {
    test(`${profile}：J1–J4 菜单、路由、按钮、接口、数据只读，刷新重登不漂移`, async ({ page }) => {
      const pageErrors = monitorPageErrors(page);
      const account = fixtureAccount(key);
      await login(page, account, key);
      await assertSession(page, true);
      await assertVisibleJMenus(page);
      const modules: Array<{ module: string; read: number; write: number }> = [];

      for (const module of MODULES) {
        await openVisibleModule(page, module);
        await expect(page.locator(".jdom")).toBeVisible();
        await expect(page.getByText(module.visibleText).first()).toBeVisible();
        await expect(page.locator(".jdom").getByRole("button", { name: module.forbiddenButtons })).toHaveCount(0);
        const read = await browserApi(page, "GET", module.readPath);
        const write = await browserApi(page, module.writeMethod, module.writePath, module.writeBody);
        expect(read.status, `${profile} ${module.id} 读取`).toBe(200);
        expect(read.hasData, `${profile} ${module.id} 必须包含服务端 data`).toBe(true);
        expect(write.status, `${profile} ${module.id} 写入必须后端拒绝`).toBe(403);
        modules.push({ module: module.id, read: read.status, write: write.status });
      }

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByText(MODULES.at(-1)!.visibleText).first()).toBeVisible();
      await logout(page);
      await login(page, account, key);
      await assertSession(page, true);
      await assertVisibleJMenus(page);
      expect((await browserApi(page, "GET", MODULES[0].readPath)).status).toBe(200);
      expect((await browserApi(page, MODULES[0].writeMethod, MODULES[0].writePath, MODULES[0].writeBody)).status).toBe(403);
      expect(pageErrors).toEqual([]);
      writeEvidence(`${profile}-five-layers.json`, {
        profile,
        modules,
        refresh: "PASS",
        logoutRelogin: { read: 200, write: 403 },
        pageErrors,
      });
    });
  }

  test("no-menu：J 菜单、直接路由、读写接口均拒绝，刷新重登不恢复", async ({ page }) => {
    const pageErrors = monitorPageErrors(page);
    const account = fixtureAccount("nomenu");
    await login(page, account, "nomenu");
    await assertSession(page, false);
    await expect(page.locator('a[href^="/emergency/"]')).toHaveCount(0);
    await page.goto(MODULES[0].path, { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/emergency\/kill-switch(?:\?.*)?$/);
    await expect(page.locator(".jdom")).toHaveCount(0);

    const modules: Array<{ module: string; read: number; write: number }> = [];
    for (const module of MODULES) {
      const read = await browserApi(page, "GET", module.readPath);
      const write = await browserApi(page, module.writeMethod, module.writePath, module.writeBody);
      expect(read.status, `no-menu ${module.id} 读取`).toBe(403);
      expect(write.status, `no-menu ${module.id} 写入`).toBe(403);
      modules.push({ module: module.id, read: read.status, write: write.status });
    }

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('a[href^="/emergency/"]')).toHaveCount(0);
    await logout(page);
    await login(page, account, "nomenu");
    await assertSession(page, false);
    await expect(page.locator('a[href^="/emergency/"]')).toHaveCount(0);
    const reloginRead = await browserApi(page, "GET", MODULES[0].readPath);
    expect(reloginRead.status).toBe(403);
    expect(pageErrors).toEqual([]);
    writeEvidence("no-menu-five-layers.json", {
      profile: "no-menu",
      modules,
      directRoute: "DENIED",
      read: "403",
      write: "403",
      refresh: "NO_MENU",
      logoutRelogin: { read: 403, write: 403, menus: "absent" },
      pageErrors,
    });
  });
});

async function login(page: Page, account: FixtureAccount, key: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  if (await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false)) return;
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  const loginResponse = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /继续|登录/ }).click();
  const loginPayload = await (await loginResponse).json().catch(() => null) as { code?: number; message?: string } | null;
  expect(loginPayload?.code, `${key} credential: ${loginPayload?.message ?? "no body"}`).toBe(0);

  const otp = page.getByLabel("一次性验证码");
  if (!(await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false))) {
    await expect(otp, `${key} must explicitly enter MFA or receive a shell`).toBeVisible({ timeout: 10_000 });
    const first = await submitMfa(page, otp, key, account.totpSecret);
    const final = first.accepted
      ? first
      : first.retryable
        ? await submitMfa(page, otp, key, account.totpSecret, first.step)
        : first;
    if (!final.accepted) {
      throw new Error(`${key} MFA rejected: first=${first.status}/${first.code ?? "none"}, retry=${final.status}/${final.code ?? "none"}`);
    }
  }
  if (!(await page.locator("aside").waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false))) {
    throw new Error(`${key} shell unavailable after successful authentication response`);
  }
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
    // A valid challenge survives only this code-mismatch case. Challenge replay,
    // expiry and service errors are surfaced immediately instead of blind retries.
    retryable: response.status() === 401 && payload?.message === "ADMIN_MFA_CODE_INVALID",
    status: response.status(),
    code: payload?.code,
    message: payload?.message,
    step: totp.step,
  };
}

async function logout(page: Page) {
  const direct = page.getByRole("button", { name: /^(退出登录|登出)$/ }).first();
  if (await direct.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await direct.click();
  } else {
    const account = page.locator('header button[aria-haspopup="menu"], [role="banner"] button[aria-haspopup="menu"]').first();
    await expect(account).toBeVisible();
    await account.click();
    const textLogout = page.getByText(/退出登录|登出/, { exact: true }).first();
    if (await textLogout.isVisible({ timeout: 2_000 }).catch(() => false)) await textLogout.click();
    else await page.getByRole("button", { name: /退出登录|登出/ }).first().click();
  }
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

async function assertSession(page: Page, hasJRead: boolean, hasJMenus = hasJRead) {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const payload = await response.json() as {
    data?: { session?: { authorities?: string[]; effectiveMenus?: unknown[] } };
  };
  const authorities = payload.data?.session?.authorities ?? [];
  const menus = payload.data?.session?.effectiveMenus ?? [];
  if (hasJRead) {
    for (let module = 1; module <= 4; module += 1) {
      expect(authorities).toContain(`emergency_j${module}_read`);
    }
    expect(authorities.some((permission) => permission.startsWith("emergency_j") && permission !== "emergency_j1_read"
      && permission !== "emergency_j2_read" && permission !== "emergency_j3_read"
      && permission !== "emergency_j4_read")).toBe(false);
    if (hasJMenus) expect(menus.length).toBeGreaterThan(0);
    else expect(menus).toEqual([]);
  } else {
    expect(authorities).toEqual([]);
    expect(menus).toEqual([]);
  }
}

function fixtureAccount(key: "readonly" | "nowrite" | "nomenu"): FixtureAccount {
  const legacyKey = key === "readonly" ? "j_readonly" : key === "nowrite" ? "j_no_write" : "j_no_menu";
  const account = fixture.accounts[key] ?? fixture.accounts[legacyKey];
  if (!account) throw new Error(`J permission fixture is missing ${key} or ${legacyKey}`);
  return account;
}

async function assertVisibleJMenus(page: Page) {
  const domain = CONSOLE_NAV.find((item) => item.code === "J");
  if (!domain) throw new Error("J domain missing from navigation source");
  const group = page.getByRole("button", { name: /紧急与合规控制\s+J|J\s+紧急与合规控制/ }).first();
  if (await group.isVisible({ timeout: 3_000 }).catch(() => false) && await group.getAttribute("aria-expanded") !== "true") {
    await group.click();
  }
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
        "Idempotency-Key": `j-permission-${runId}-${crypto.randomUUID()}`,
      },
      body: requestMethod === "GET" ? undefined : JSON.stringify(requestBody ?? {}),
    });
    const payload = await response.json().catch(() => null) as { data?: unknown } | null;
    return { status: response.status, hasData: payload?.data !== undefined };
  }, { requestMethod: method, apiPath: requestPath, requestBody: body, runId: fixture.runId });
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
