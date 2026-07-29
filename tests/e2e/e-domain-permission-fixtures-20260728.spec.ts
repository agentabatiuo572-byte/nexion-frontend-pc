import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

type FixtureAccount = { username: string; password: string; totpSecret: string };
type PermissionFixture = {
  runId: string;
  accounts: {
    e_readonly: FixtureAccount;
    e_no_write: FixtureAccount;
    e_no_menu: FixtureAccount;
  };
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
const evidenceDir = process.env.E_PERMISSION_EVIDENCE_DIR;

const MODULES: ModuleProbe[] = [
  {
    id: "E1",
    path: "/devices/pricing",
    readPath: "/api/admin/e1/skus?pageNum=1&pageSize=10",
    writePath: "/api/admin/e1/skus/permission-probe/status",
    writeMethod: "PATCH",
    writeBody: { status: "off", reason: "权限探针不得执行", operator: "permission-probe" },
    visibleText: /阶段配置/,
    forbiddenButtons: /^(\+ 新增 SKU|\+ 新增阶段|\+ 新增上架门|编辑|下架|上架)$/,
  },
  {
    id: "E2",
    path: "/devices/tasks",
    readPath: "/api/admin/config/task-pricing",
    writePath: "/api/admin/config/task-pricing",
    writeMethod: "PUT",
    writeBody: {
      nexPriceUsd: 0.1,
      usdtPriceUsd: 0.1,
      reason: "权限探针不得执行",
      operator: "permission-probe",
    },
    visibleText: /任务类型/,
    forbiddenButtons: /^(\+ 新增任务|调整|Kill|恢复|编辑|删除)$/,
  },
  {
    id: "E3",
    path: "/devices/trade-in",
    readPath: "/api/admin/devices/e3/overview",
    writePath: "/api/admin/devices/e3/config",
    writeMethod: "PATCH",
    writeBody: {
      key: "E.tradein.promoMultiplier",
      value: "1",
      reason: "权限探针不得执行",
      operator: "permission-probe",
    },
    visibleText: /Trade-in/,
    forbiddenButtons: /^(调整|保存|提交|降级|回收)$/,
  },
  {
    id: "E4",
    path: "/devices/orders",
    readPath: "/api/admin/devices/orders?pageNum=1&pageSize=10",
    writePath: "/api/admin/devices/orders/permission-probe/cancel",
    writeMethod: "PATCH",
    writeBody: { reason: "权限探针不得执行", operator: "permission-probe" },
    visibleText: /订单状态机/,
    forbiddenButtons: /^(取消订单|退款|推进|终态|保存状态)$/,
  },
  {
    id: "E5",
    path: "/devices/ops",
    readPath: "/api/admin/devices/overview",
    writePath: "/api/admin/devices/999999999/activate",
    writeMethod: "POST",
    writeBody: { reason: "权限探针不得执行", operator: "permission-probe" },
    visibleText: /设备库存 & 激活/,
    forbiddenButtons: /^(\+ 新增数据中心|激活|强制激活|停用|解绑|暂停派单|恢复派单|编辑|删除)$/,
  },
  {
    id: "E6",
    path: "/devices/compute-config",
    readPath: "/api/admin/devices/compute-config",
    writePath: "/api/admin/devices/compute-config/params/E.compute.h5BaseFactor",
    writeMethod: "PATCH",
    writeBody: { value: "0.6", reason: "权限探针不得执行", operator: "permission-probe" },
    visibleText: /电脑显卡映射表/,
    forbiddenButtons: /^(调整|编辑档位|新增识别词|编辑地址|清空地址|编辑双语文案|启用|停用)$/,
  },
];

test.describe.serial("E 域 readonly/no-write/no-menu 五层权限", () => {
  test.beforeAll(() => {
    if (evidenceDir) mkdirSync(evidenceDir, { recursive: true });
  });

  for (const [profile, key] of [
    ["readonly", "e_readonly"],
    ["menu-no-write", "e_no_write"],
  ] as const) {
    test(`${profile}：E1–E6 菜单、路由、按钮、接口、数据只读，刷新重登不漂移`, async ({ page }) => {
      const pageErrors = monitorPageErrors(page);
      const account = fixture.accounts[key];
      await login(page, account, key);
      await assertSession(page, true);
      await assertVisibleEMenus(page);
      const modules: Array<{ module: string; read: number; write: number }> = [];

      for (const module of MODULES) {
        await openVisibleModule(page, module);
        await expect(page.locator(".edom")).toBeVisible();
        await expect(page.getByText(module.visibleText).first()).toBeVisible();
        await expect(page.locator(".edom").getByRole("button", { name: module.forbiddenButtons })).toHaveCount(0);
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
      await assertVisibleEMenus(page);
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

  test("no-menu：E 菜单与直接路由不可达，E1–E6 读写均 403，刷新重登不恢复", async ({ page }) => {
    const pageErrors = monitorPageErrors(page);
    const account = fixture.accounts.e_no_menu;
    await login(page, account, "e_no_menu");
    await assertSession(page, false);
    await expect(page.locator('a[href^="/devices/"]')).toHaveCount(0);
    await page.goto(MODULES[0].path, { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/devices\/pricing(?:\?.*)?$/);
    await expect(page.locator(".edom")).toHaveCount(0);

    const modules: Array<{ module: string; read: number; write: number }> = [];
    for (const module of MODULES) {
      const read = await browserApi(page, "GET", module.readPath);
      const write = await browserApi(page, module.writeMethod, module.writePath, module.writeBody);
      expect(read.status, `no-menu ${module.id} 读取`).toBe(403);
      expect(write.status, `no-menu ${module.id} 写入`).toBe(403);
      modules.push({ module: module.id, read: read.status, write: write.status });
    }

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('a[href^="/devices/"]')).toHaveCount(0);
    await logout(page);
    await login(page, account, "e_no_menu");
    await assertSession(page, false);
    await expect(page.locator('a[href^="/devices/"]')).toHaveCount(0);
    expect((await browserApi(page, "GET", MODULES[0].readPath)).status).toBe(403);
    expect(pageErrors).toEqual([]);
    writeEvidence("no-menu-five-layers.json", {
      profile: "no-menu",
      modules,
      directRoute: "DENIED",
      refresh: "DENIED",
      logoutRelogin: "DENIED",
      pageErrors,
    });
  });
});

async function login(page: Page, account: FixtureAccount, key: string) {
  let lastCode: number | undefined;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    if (await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false)) break;
    await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
    await page.locator('input[autocomplete="username"]').fill(account.username);
    await page.locator('input[autocomplete="current-password"]').fill(account.password);
    const loginResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/login");
    await page.getByRole("button", { name: /继续|登录/ }).click();
    const payload = await (await loginResponse).json().catch(() => null) as { code?: number; message?: string } | null;
    expect(payload?.code, `${key} credential: ${payload?.message ?? "no body"}`).toBe(0);

    const otp = page.getByLabel("一次性验证码");
    await otp.waitFor({ state: "visible", timeout: 5_000 }).catch(() => undefined);
    if (!(await otp.isVisible().catch(() => false))) break;
    await otp.fill(await freshTotp(key, account.totpSecret));
    const verification = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const response = await verification;
    const result = await response.json().catch(() => null) as { code?: number } | null;
    lastCode = result?.code;
    const hasCookie = (await page.context().cookies()).some((cookie) => cookie.name === "nexion_admin_token");
    if (response.status() === 200 && (result?.code === 0 || hasCookie)) {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      break;
    }
  }
  if (!(await page.locator("aside").waitFor({ state: "visible", timeout: 20_000 }).then(() => true).catch(() => false))) {
    throw new Error(`${key} shell unavailable after MFA code=${lastCode ?? "none"}`);
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
    const textLogout = page.getByText(/退出登录|登出/, { exact: true }).first();
    if (await textLogout.isVisible({ timeout: 2_000 }).catch(() => false)) await textLogout.click();
    else await page.getByRole("button", { name: /退出登录|登出/ }).first().click();
  }
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

async function assertSession(page: Page, hasERead: boolean) {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const payload = await response.json() as {
    data?: { session?: { authorities?: string[]; effectiveMenus?: unknown[] } };
  };
  const authorities = payload.data?.session?.authorities ?? [];
  const menus = payload.data?.session?.effectiveMenus ?? [];
  if (hasERead) {
    for (let module = 1; module <= 6; module += 1) {
      expect(authorities).toContain(`device_e${module}_read`);
    }
    expect(authorities.some((permission) => permission.startsWith("device_e") && permission !== "device_e1_read"
      && permission !== "device_e2_read" && permission !== "device_e3_read" && permission !== "device_e4_read"
      && permission !== "device_e5_read" && permission !== "device_e6_read")).toBe(false);
    expect(menus.length).toBeGreaterThan(0);
  } else {
    expect(authorities).toEqual([]);
    expect(menus).toEqual([]);
  }
}

async function assertVisibleEMenus(page: Page) {
  const domain = CONSOLE_NAV.find((item) => item.code === "E");
  if (!domain) throw new Error("E domain missing from navigation source");
  const group = page.getByRole("button", { name: /设备与商城\s+E|E\s+设备与商城/ }).first();
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
        "Idempotency-Key": `e-permission-${runId}-${crypto.randomUUID()}`,
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

async function freshTotp(key: string, secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  const previous = lastTotpStep.get(key) ?? -1;
  if (step <= previous) {
    await new Promise((resolve) => setTimeout(resolve, ((previous + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep.set(key, step);
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
