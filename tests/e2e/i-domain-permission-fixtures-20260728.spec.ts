import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

type FixtureAccount = {
  username: string;
  password: string;
  totpSecret: string;
};

type PermissionFixture = {
  runId: string;
  accounts: {
    readonly: FixtureAccount;
    nowrite: FixtureAccount;
    nomenu: FixtureAccount;
  };
};

type ModuleProbe = {
  id: string;
  path: string;
  readPath: string;
  writePath: string;
  writeMethod: "PATCH" | "POST";
  writeBody: Record<string, unknown>;
  forbiddenButtons: RegExp;
};

const fixturePath = process.env.ADMIN_PERMISSION_FIXTURE;
if (!fixturePath) throw new Error("ADMIN_PERMISSION_FIXTURE is required");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as PermissionFixture;

const MODULES: ModuleProbe[] = [
  {
    id: "I1",
    path: "/content/copy-ab",
    readPath: "/api/admin/content/copy-ab/overview",
    writePath: "/api/admin/content/copy-ab/copies/acceptance-permission-probe/draft",
    writeMethod: "PATCH",
    writeBody: {},
    forbiddenButtons: /新增位置|新增版本|新增文案|编辑文案|创建 A\/B 实验|启动实验|弃用实验|采纳获胜/,
  },
  {
    id: "I2",
    path: "/content/nova",
    readPath: "/api/admin/content/nova/overview",
    writePath: "/api/admin/content/nova/channels/acceptance-permission-probe/status",
    writeMethod: "PATCH",
    writeBody: { enabled: false, reason: "权限探针不得执行" },
    forbiddenButtons: /新增通道|新模板|编辑全部概率|同步真实事件|保存概率|立即过期/,
  },
  {
    id: "I3",
    path: "/content/notifications",
    readPath: "/api/admin/content/campaigns/overview",
    writePath: "/api/admin/content/campaigns/acceptance-permission-probe/send-now",
    writeMethod: "POST",
    writeBody: { expectedRevision: -1, reason: "权限探针不得执行" },
    forbiddenButtons: /新建 Campaign|调度下发|立即下发|调整/,
  },
  {
    id: "I4",
    path: "/content/trust",
    readPath: "/api/admin/content/trust-disclosure/overview",
    writePath: "/api/admin/content/trust-disclosure/trust-sections/acceptance-permission-probe/archive",
    writeMethod: "POST",
    writeBody: { expectedVersion: "never", expectedStatus: "never", reason: "权限探针不得执行" },
    forbiddenButtons: /新建草稿|编辑草稿|删除草稿|发布草稿|恢复上线|回滚历史版|下架/,
  },
  {
    id: "I5",
    path: "/content/disclosures",
    readPath: "/api/admin/content/trust-disclosure/overview",
    writePath: "/api/admin/content/trust-disclosure/disclosures/acceptance-permission-probe/publish",
    writeMethod: "POST",
    writeBody: { reason: "权限探针不得执行" },
    forbiddenButtons: /新增法域|新增映射|调整映射|新建版本|编辑版本|删除草稿|受限内 · 移出|已移出 · 纳入/,
  },
  {
    id: "I6",
    path: "/content/i18n",
    readPath: "/api/admin/content/i18n-learning/overview",
    writePath: "/api/admin/content/i18n-learning/messages/acceptance-permission-probe/publish",
    writeMethod: "POST",
    writeBody: { reason: "权限探针不得执行" },
    forbiddenButtons: /重新扫描|新增词条|编辑词条|回滚到此版本|修复并复扫|新建课程/,
  },
];

test.describe.serial("I 域 A 夹具五层权限验收", () => {
  test("readonly：菜单、路由、数据、按钮和接口均遵守只读边界，刷新重登不漂移", async ({ page }) => {
    const errors = monitorPageErrors(page);
    const account = fixture.accounts.readonly;
    await login(page, account);
    await assertVisibleIMenus(page);

    for (const module of MODULES) {
      await openVisibleModule(page, module);
      await assertReadableModule(page, module);
      await expect(page.locator(".idom").getByRole("button", { name: module.forbiddenButtons })).toHaveCount(0);

      const read = await browserApi(page, "GET", module.readPath);
      expect(read.status, `${module.id} 读取接口`).toBe(200);
      expect(read.hasData, `${module.id} 读取接口必须返回权威 data`).toBe(true);

      const write = await browserApi(page, module.writeMethod, module.writePath, module.writeBody);
      expect(write.status, `${module.id} 写接口必须由后端拒绝`).toBe(403);
    }

    await page.reload({ waitUntil: "domcontentloaded" });
    await assertReadableModule(page, MODULES.at(-1)!);
    await logout(page);
    await login(page, account);
    await assertVisibleIMenus(page);
    await openVisibleModule(page, MODULES[0]);
    await assertReadableModule(page, MODULES[0]);
    expect(errors).toEqual([]);
  });

  test("有菜单无写：I3 不渲染写按钮，后端写接口仍为 403", async ({ page }) => {
    const errors = monitorPageErrors(page);
    const account = fixture.accounts.nowrite;
    await login(page, account);
    await assertVisibleIMenus(page);
    const module = MODULES.find((item) => item.id === "I3")!;
    await openVisibleModule(page, module);
    await assertReadableModule(page, module);
    await expect(page.locator(".idom").getByRole("button", { name: module.forbiddenButtons })).toHaveCount(0);
    const write = await browserApi(page, module.writeMethod, module.writePath, module.writeBody);
    expect(write.status).toBe(403);
    expect(errors).toEqual([]);
  });

  test("无菜单：侧栏和直接路由均拒绝，纯读接口可用、写接口为 403，刷新后不能由缓存恢复", async ({ page }) => {
    const errors = monitorPageErrors(page);
    const account = fixture.accounts.nomenu;
    await login(page, account);
    await expect(page.locator('a[href^="/content/"]')).toHaveCount(0);

    await page.goto("/content/copy-ab", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/content\/copy-ab(?:\?.*)?$/);
    await expect(page.locator(".idom")).toHaveCount(0);

    const read = await browserApi(page, "GET", MODULES[0].readPath);
    const write = await browserApi(page, MODULES[0].writeMethod, MODULES[0].writePath, MODULES[0].writeBody);
    expect(read.status).toBe(200);
    expect(read.hasData).toBe(true);
    expect(write.status).toBe(403);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('a[href^="/content/"]')).toHaveCount(0);
    await expect(page.locator(".idom")).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

async function login(page: Page, account: FixtureAccount) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /继续|登录/ }).click();

  const otp = page.getByLabel("一次性验证码");
  const shell = page.locator("aside");
  await Promise.race([
    otp.waitFor({ state: "visible", timeout: 10_000 }),
    shell.waitFor({ state: "visible", timeout: 10_000 }),
  ]);
  if (await otp.isVisible()) {
    await otp.fill(await freshTotp(account.totpSecret));
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  }
  await expect(shell).toBeVisible({ timeout: 20_000 });
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

async function assertVisibleIMenus(page: Page) {
  const domain = CONSOLE_NAV.find((item) => item.code === "I");
  if (!domain) throw new Error("I domain missing from navigation source");
  const group = page.getByRole("button", { name: /内容与合规 CMS\s+I|I\s+内容与合规 CMS/ }).first();
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
  await expect(page.locator(".idom")).toBeVisible();
  await expect(page.getByText(new RegExp(`\\b${module.id}\\b`)).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/数据加载失败|暂无真实接口数据|Cannot read properties|ReferenceError|TypeError/i);
  await expect.poll(async () => page.locator(".idom table tbody tr").count()).toBeGreaterThan(0);
}

async function browserApi(
  page: Page,
  method: "GET" | "PATCH" | "POST",
  path: string,
  body?: Record<string, unknown>,
) {
  return page.evaluate(async ({ method: requestMethod, path: requestPath, body: requestBody, runId }) => {
    const response = await fetch(requestPath, {
      method: requestMethod,
      credentials: "same-origin",
      headers: requestMethod === "GET"
        ? undefined
        : {
            "Content-Type": "application/json",
            "Idempotency-Key": `i-permission-${runId}-${crypto.randomUUID()}`,
          },
      body: requestMethod === "GET" ? undefined : JSON.stringify(requestBody ?? {}),
    });
    const payload = await response.json().catch(() => null) as { data?: unknown } | null;
    return { status: response.status, hasData: payload?.data !== undefined };
  }, { method, path, body, runId: fixture.runId });
}

function monitorPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

let lastTotpStep = -1;

async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  if (step <= lastTotpStep) {
    await new Promise((resolve) => setTimeout(resolve, ((lastTotpStep + 1) * 30_000) - Date.now() + 500));
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  step = Math.floor(Date.now() / 30_000);
  lastTotpStep = step;
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
