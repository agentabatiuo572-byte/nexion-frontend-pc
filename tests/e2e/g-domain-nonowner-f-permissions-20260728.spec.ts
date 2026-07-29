import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

type FixtureAccount = { username: string; password: string; totpSecret: string };
type PermissionFixture = {
  runId: string;
  accounts: {
    g_readonly: FixtureAccount;
    g_no_write: FixtureAccount;
    g_no_menu: FixtureAccount;
  };
};
type ModuleProbe = {
  id: "G1" | "G2" | "G3" | "G4" | "G7";
  path: string;
  marker: RegExp;
  readPath: string;
  writePath: string;
  writeMethod: "PATCH" | "POST" | "PUT";
  writeBody: Record<string, unknown>;
  mutationButtons: RegExp;
};

const RUN_ID = "pc-full-acceptance-20260728-151023";
const fixturePath = process.env.G_PERMISSION_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/G/permission-fixtures.json`;
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as PermissionFixture;
const REASON = "G 域非 Owner 权限负向探针，不得执行";
const MODULES: ModuleProbe[] = [
  {
    id: "G1",
    path: "/finance-products/staking",
    marker: /G1 Staking/,
    readPath: "/api/admin/market/staking",
    writePath: "/api/admin/market/staking/pools/usdt30d/params/apy",
    writeMethod: "PATCH",
    writeBody: { value: "5", reason: REASON, operator: "g-permission-probe" },
    mutationButtons: /调整 APY|调整罚款|调整最小额|停售|恢复销售|熔断/,
  },
  {
    id: "G2",
    path: "/finance-products/exchange",
    marker: /G2 兑换风控/,
    readPath: "/api/admin/market/exchange",
    writePath: "/api/admin/market/exchange/params/userDailyCap",
    writeMethod: "PATCH",
    writeBody: { value: "50", reason: REASON, operator: "g-permission-probe" },
    mutationButtons: /调整|处理今日批次|swap 全局熔断|提交 KYC 复审|强制取消/,
  },
  {
    id: "G3",
    path: "/finance-products/market",
    marker: /G3 NEX 行情引擎/,
    readPath: "/api/admin/market/nex/curve",
    writePath: "/api/admin/market/nex/curve/controls/pause",
    writeMethod: "PATCH",
    writeBody: { value: "true", reason: REASON, operator: "g-permission-probe" },
    mutationButtons: /调整|暂停引擎|恢复引擎|推进下一帧/,
  },
  {
    id: "G4",
    path: "/finance-products/genesis",
    marker: /G4 Genesis 经济/,
    readPath: "/api/admin/market/nex/genesis?page=1&pageSize=10",
    writePath: "/api/admin/market/nex/genesis/params/price",
    writeMethod: "PATCH",
    writeBody: { value: "9999", reason: REASON, operator: "g-permission-probe" },
    mutationButtons: /调整|市场熔断|重跑今日批次|创建虚拟成交/,
  },
  {
    id: "G7",
    path: "/finance-products/repurchase",
    marker: /G7 复投激励/,
    readPath: "/api/admin/market/nex/repurchase",
    writePath: "/api/admin/market/nex/repurchase/config/apy",
    writeMethod: "PUT",
    writeBody: { value: "35", reason: REASON, operator: "g-permission-probe", g4Ref: "" },
    mutationButtons: /编辑 年化 APY|编辑 锁仓期限|编辑 培育奖倍率|编辑 Genesis 抽奖券|编辑 早赎罚款|编辑 preset 金额档/,
  },
];

test.describe.configure({ timeout: 240_000 });

for (const key of ["g_readonly", "g_no_write"] as const) {
  test(`${key}：G1/G2/G3/G4/G7 五层权限、刷新、退出重登均失败关闭`, async ({ page }) => {
    const errors = monitorFailures(page);
    const account = fixture.accounts[key];
    await login(page, account);
    await assertVisibleGMenus(page);
    await assertSessionShape(page, true);

    const firstSnapshots = new Map<string, string>();
    for (const module of MODULES) {
      await openVisibleModule(page, module);
      await expect(page.getByText(module.marker).first()).toBeVisible({ timeout: 20_000 });
      const read = await browserApi(page, "GET", module.readPath);
      expect(read.status, `${key} ${module.id} read`).toBe(200);
      expect(read.code, `${key} ${module.id} code`).toBe(0);
      expect(read.serverCanonical, `${key} ${module.id} canonical`).toBe(true);
      firstSnapshots.set(module.id, read.identity);
      const write = await browserApi(page, module.writeMethod, module.writePath, module.writeBody);
      expect(write.status, `${key} ${module.id} write`).toBe(403);
      await expectEnabledMutationButtonCount(page, module.mutationButtons, 0, `${key} ${module.id}`);
    }

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(MODULES.at(-1)!.marker).first()).toBeVisible();
    expect((await browserApi(page, "GET", MODULES.at(-1)!.readPath)).identity).toBe(firstSnapshots.get("G7"));
    await logout(page);
    await login(page, account);
    await assertVisibleGMenus(page);
    expect((await browserApi(page, "GET", MODULES[0].readPath)).identity).toBe(firstSnapshots.get("G1"));
    expect((await browserApi(page, MODULES[0].writeMethod, MODULES[0].writePath, MODULES[0].writeBody)).status).toBe(403);
    expect(errors.pageErrors).toEqual([]);
    expect(errors.api5xx).toEqual([]);
  });
}

test("g_no_menu：菜单、直接路由、读写接口、刷新重登全部拒绝", async ({ page }) => {
  const errors = monitorFailures(page);
  const account = fixture.accounts.g_no_menu;
  await login(page, account);
  await assertSessionShape(page, false);
  await expect(page.locator('a[href^="/finance-products/"]')).toHaveCount(0);

  await page.goto("/finance-products/staking", { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/finance-products\/staking(?:\?.*)?$/);
  for (const module of MODULES) {
    expect((await browserApi(page, "GET", module.readPath)).status, `${module.id} read`).toBe(403);
    expect((await browserApi(page, module.writeMethod, module.writePath, module.writeBody)).status, `${module.id} write`).toBe(403);
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('a[href^="/finance-products/"]')).toHaveCount(0);
  await logout(page);
  await login(page, account);
  await expect(page.locator('a[href^="/finance-products/"]')).toHaveCount(0);
  expect((await browserApi(page, "GET", MODULES[0].readPath)).status).toBe(403);
  expect(errors.pageErrors).toEqual([]);
  expect(errors.api5xx).toEqual([]);
});

test("匿名管理面 401；App G1/G2/G3/G4/G7 公共投影可读、用户命令匿名拒绝", async ({ page, request }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible();
  for (const module of MODULES) {
    expect((await browserApi(page, "GET", module.readPath)).status, `${module.id} anonymous read`).toBe(401);
    expect((await browserApi(page, module.writeMethod, module.writePath, module.writeBody)).status, `${module.id} anonymous write`).toBe(401);
  }
  await assertAppProjectionBoundaries(request);
});

async function assertAppProjectionBoundaries(request: APIRequestContext) {
  const backend = "http://127.0.0.1:8110";
  for (const path of [
    "/api/config/staking/pools",
    "/api/config/exchange/caps",
    "/api/config/market/nex",
    "/api/genesis/state",
    "/api/config/repurchase",
  ]) {
    const response = await request.get(`${backend}${path}`);
    expect(response.status(), `${path} public`).toBe(200);
    const payload = await response.json() as { code?: number; data?: { serverCanonical?: boolean } };
    expect(payload.code, `${path} code`).toBe(0);
    expect(payload.data?.serverCanonical, `${path} canonical`).toBe(true);
  }
  for (const path of ["/api/stakes", "/api/exchange", "/api/genesis/account", "/api/repurchase/orders"]) {
    expect((await request.get(`${backend}${path}`)).status(), `${path} anonymous`).toBe(401);
  }
}

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
  await page.locator('header button[aria-haspopup="menu"]').last().click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
}

async function assertVisibleGMenus(page: Page) {
  const domain = CONSOLE_NAV.find((item) => item.code === "G");
  if (!domain) throw new Error("G domain missing");
  const group = page.getByRole("button", { name: /金融产品/ }).first();
  if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
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

async function assertSessionShape(page: Page, hasGRead: boolean) {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const payload = await response.json() as { data?: { session?: { authorities?: string[] } } };
  const authorities = payload.data?.session?.authorities ?? [];
  for (const module of ["g1", "g2", "g3", "g4", "g7"]) {
    if (hasGRead) {
      expect(authorities).toContain(`finprod_${module}_read`);
      expect(authorities.some((authority) =>
        authority.startsWith(`finprod_${module}_`) && authority !== `finprod_${module}_read`)).toBe(false);
    } else {
      expect(authorities).not.toContain(`finprod_${module}_read`);
    }
  }
}

async function browserApi(
  page: Page,
  method: "GET" | "PATCH" | "POST" | "PUT",
  requestPath: string,
  body?: Record<string, unknown>,
) {
  return page.evaluate(async ({ requestMethod, apiPath, requestBody, runId }) => {
    const response = await fetch(apiPath, {
      method: requestMethod,
      credentials: "same-origin",
      headers: requestMethod === "GET" ? undefined : {
        "Content-Type": "application/json",
        "Idempotency-Key": `g-nonowner-permission-${runId}-${crypto.randomUUID()}`,
      },
      body: requestMethod === "GET" ? undefined : JSON.stringify(requestBody ?? {}),
    });
    const payload = await response.json().catch(() => null) as {
      code?: number;
      data?: { domain?: string; serverCanonical?: boolean };
    } | null;
    return {
      status: response.status,
      code: payload?.code,
      serverCanonical: payload?.data?.serverCanonical,
      identity: JSON.stringify({
        domain: payload?.data?.domain,
        serverCanonical: payload?.data?.serverCanonical,
      }),
    };
  }, { requestMethod: method, apiPath: requestPath, requestBody: body, runId: fixture.runId });
}

async function expectEnabledMutationButtonCount(page: Page, name: RegExp, expected: number, label: string) {
  const count = await page.getByRole("button", { name }).evaluateAll((buttons) =>
    buttons.filter((button) => {
      const element = button as HTMLButtonElement;
      const style = window.getComputedStyle(element);
      return !element.disabled && style.visibility !== "hidden" && style.display !== "none";
    }).length);
  expect(count, `${label} enabled mutation buttons`).toBe(expected);
}

function monitorFailures(page: Page) {
  const pageErrors: string[] = [];
  const api5xx: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("response", (response) => {
    if (new URL(response.url()).pathname.startsWith("/api/admin/") && response.status() >= 500) {
      api5xx.push(`${response.status()} ${response.request().method()} ${new URL(response.url()).pathname}`);
    }
  });
  return { pageErrors, api5xx };
}

const lastTotpStep = new Map<string, number>();

async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  const previous = lastTotpStep.get(secret) ?? -1;
  if (step <= previous) {
    await expect.poll(() => Math.floor(Date.now() / 30_000), { timeout: 35_000 }).toBeGreaterThan(previous);
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) {
    const boundary = Math.floor(Date.now() / 30_000);
    await expect.poll(() => Math.floor(Date.now() / 30_000), { timeout: 5_000 }).toBeGreaterThan(boundary);
  }
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
