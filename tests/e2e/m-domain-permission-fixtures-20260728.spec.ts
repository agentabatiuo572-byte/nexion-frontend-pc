import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

type FixtureAccount = { username: string; password: string; totpSecret: string };
type PermissionFixture = {
  runId: string;
  accounts: {
    m_readonly: FixtureAccount;
    m_no_write: FixtureAccount;
    m_no_menu: FixtureAccount;
  };
};
type ModuleProbe = {
  id: string;
  path: string;
  visibleText: RegExp;
  readPath: string;
  writePath: string;
  writeMethod: "PATCH" | "POST";
  writeBody: Record<string, unknown>;
};

const fixturePath = process.env.M_PERMISSION_FIXTURE_PATH;
if (!fixturePath) throw new Error("M_PERMISSION_FIXTURE_PATH is required");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as PermissionFixture;

const MODULES: ModuleProbe[] = [
  {
    id: "M1",
    path: "/service/overview",
    visibleText: /SLA 监控/,
    readPath: "/api/admin/content/tickets/load-config",
    writePath: "/api/admin/content/tickets/load-config",
    writeMethod: "PATCH",
    writeBody: { autoBalance: false, defaultCap: 8, burstCap: 12, warnPct: 80, quietHourBalance: false, overflowQueue: "权限探针", expectedVersion: -1, reason: "权限探针不得执行" },
  },
  {
    id: "M2",
    path: "/service/tickets",
    visibleText: /工单台/,
    readPath: "/api/admin/content/tickets?pageNum=1&pageSize=1",
    writePath: "/api/admin/content/tickets",
    writeMethod: "POST",
    writeBody: { category: "OTHER", priority: "NORMAL", title: "权限探针", body: "权限探针不得创建", assignedAdminId: 0, assignedAdminName: "none", reason: "权限探针不得执行" },
  },
  {
    id: "M3",
    path: "/service/sessions",
    visibleText: /会话收件箱/,
    readPath: "/api/admin/content/conversations?pageNum=1&pageSize=1",
    writePath: "/api/admin/content/conversations",
    writeMethod: "POST",
    writeBody: { conversationType: "SUPPORT", ownerAgentId: "none", ownerAgentName: "none", openingText: "权限探针不得创建", reason: "权限探针不得执行" },
  },
  {
    id: "M4",
    path: "/service/kb-sla",
    visibleText: /Help\/FAQ 内容管理/,
    readPath: "/api/admin/content/knowledge/overview",
    writePath: "/api/admin/content/knowledge/faqs",
    writeMethod: "POST",
    writeBody: { category: "other", surface: "Help Center", question: "权限探针", answer: "权限探针不得创建", status: "draft", language: "zh-CN", sortOrder: 999, reason: "权限探针不得执行" },
  },
  {
    id: "M5",
    path: "/service/scripts",
    visibleText: /会话类别/,
    readPath: "/api/admin/content/session-templates/overview",
    writePath: "/api/admin/content/session-templates/reply-templates",
    writeMethod: "POST",
    writeBody: { type: "support", text: "权限探针不得创建", status: "draft", reason: "权限探针不得执行" },
  },
];

test.describe.serial("M 域五层权限夹具验收", () => {
  for (const key of ["m_readonly", "m_no_write"] as const) {
    test(`${key}：M1-M5 菜单/路由/数据可读，按钮和接口写入均被拒绝，刷新重登不漂移`, async ({ page }) => {
      const pageErrors = monitorPageErrors(page);
      await login(page, fixture.accounts[key]);
      await assertVisibleMMenus(page);
      await assertSessionShape(page, true);

      for (const module of MODULES) {
        await openVisibleModule(page, module);
        await expect(page.locator(".mdom")).toBeVisible();
        await expect(page.getByText(module.visibleText).first()).toBeVisible({ timeout: 20_000 });
        const read = await browserApi(page, "GET", module.readPath);
        expect(read.status, `${key} ${module.id} read`).toBe(200);
        expect(read.hasData, `${key} ${module.id} authoritative data`).toBe(true);
        const write = await browserApi(page, module.writeMethod, module.writePath, module.writeBody);
        expect(write.status, `${key} ${module.id} write`).toBe(403);
      }

      await openVisibleModule(page, MODULES[0]);
      await expect(page.getByRole("button", { name: "调整负载", exact: true })).toBeDisabled();
      await expect(page.locator('[role="dialog"]:visible')).toHaveCount(0);
      await openVisibleModule(page, MODULES[1]);
      await expect(page.locator('[data-proof="support-ticket-create"]')).toHaveCount(0);
      await openVisibleModule(page, MODULES[2]);
      await expect(page.locator('[data-proof="session-initiate"]')).toHaveCount(0);
      await openVisibleModule(page, MODULES[3]);
      await expect(page.getByRole("button", { name: "新增文章", exact: true })).toHaveCount(0);
      await openVisibleModule(page, MODULES[4]);
      await expect(page.locator('[data-proof="session-script-new"], [data-proof="session-tpl-new"]')).toHaveCount(0);

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByText(MODULES[4].visibleText).first()).toBeVisible();
      await logout(page);
      await login(page, fixture.accounts[key]);
      await assertVisibleMMenus(page);
      expect((await browserApi(page, "GET", MODULES[0].readPath)).status).toBe(200);
      expect((await browserApi(page, MODULES[0].writeMethod, MODULES[0].writePath, MODULES[0].writeBody)).status).toBe(403);
      expect(pageErrors).toEqual([]);
    });
  }

  test("m_no_menu：M 菜单、直接路由、读写接口均拒绝，刷新重登不能由缓存恢复", async ({ page }) => {
    const pageErrors = monitorPageErrors(page);
    await login(page, fixture.accounts.m_no_menu);
    await assertSessionShape(page, false);
    await expect(page.locator('a[href^="/service/"]')).toHaveCount(0);

    await page.goto("/service/overview", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/service\/overview(?:\?.*)?$/);
    await expect(page.locator(".mdom")).toHaveCount(0);
    for (const module of MODULES) {
      expect((await browserApi(page, "GET", module.readPath)).status, `${module.id} read`).toBe(403);
      expect((await browserApi(page, module.writeMethod, module.writePath, module.writeBody)).status, `${module.id} write`).toBe(403);
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('a[href^="/service/"]')).toHaveCount(0);
    await logout(page);
    await login(page, fixture.accounts.m_no_menu);
    await expect(page.locator('a[href^="/service/"]')).toHaveCount(0);
    expect((await browserApi(page, "GET", MODULES[0].readPath)).status).toBe(403);
    expect(pageErrors).toEqual([]);
  });
});

async function login(page: Page, account: FixtureAccount) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 10_000 });
  await otp.fill(await freshTotp(account.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function logout(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  await expect(account).toBeVisible();
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
}

async function assertVisibleMMenus(page: Page) {
  const domain = CONSOLE_NAV.find((item) => item.code === "M");
  if (!domain) throw new Error("M domain missing from navigation source");
  const group = page.getByRole("button", { name: /客服中心\s+M|M\s+客服中心/ }).first();
  if (await group.isVisible({ timeout: 3_000 }).catch(() => false)) await group.click();
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

async function assertSessionShape(page: Page, hasMRead: boolean) {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const payload = await response.json() as { data?: { session?: { authorities?: string[] } } };
  const authorities = payload.data?.session?.authorities ?? [];
  for (const module of ["m1", "m2", "m3", "m4", "m5"]) {
    if (hasMRead) {
      expect(authorities).toContain(`service_${module}_read`);
      expect(authorities).not.toContain(`service_${module}_write`);
    } else {
      expect(authorities).not.toContain(`service_${module}_read`);
      expect(authorities).not.toContain(`service_${module}_write`);
    }
  }
}

async function browserApi(
  page: Page,
  method: "GET" | "PATCH" | "POST",
  requestPath: string,
  body?: Record<string, unknown>,
) {
  return page.evaluate(async ({ requestMethod, apiPath, requestBody, runId }) => {
    const response = await fetch(apiPath, {
      method: requestMethod,
      credentials: "same-origin",
      headers: requestMethod === "GET" ? undefined : {
        "Content-Type": "application/json",
        "Idempotency-Key": `m-permission-${runId}-${crypto.randomUUID()}`,
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

const lastTotpStep = new Map<string, number>();

async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  const previous = lastTotpStep.get(secret) ?? -1;
  if (step <= previous) {
    await new Promise((resolve) => setTimeout(resolve, ((previous + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep.set(secret, step);
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
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
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
