import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

type FixtureAccount = {
  username: string;
  password: string;
  totpSecret: string;
  authorities?: string[];
  effectiveMenus?: Array<string | { menuCode?: string }>;
};
type PermissionFixture = {
  runId: string;
  accounts: Partial<Record<
    "g_readonly" | "g_no_write" | "g_no_menu" | "readonly" | "nowrite" | "nomenu",
    FixtureAccount
  >>;
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

const RUN_ID = process.env.G_NONOWNER_RUN_ID ?? "pc-full-acceptance-20260729-114336";
const fixturePath = process.env.G_PERMISSION_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/domain-permission-fixtures/G.json`;
const sharedFixture = JSON.parse(readFileSync(fixturePath, "utf8")) as PermissionFixture;
const fixture = {
  runId: sharedFixture.runId,
  accounts: {
    g_readonly: requiredAccount(sharedFixture.accounts.g_readonly ?? sharedFixture.accounts.readonly, "readonly"),
    g_no_write: requiredAccount(sharedFixture.accounts.g_no_write ?? sharedFixture.accounts.nowrite, "nowrite"),
    g_no_menu: requiredAccount(sharedFixture.accounts.g_no_menu ?? sharedFixture.accounts.nomenu, "nomenu"),
  },
};
const REASON = "G 域非 Owner 权限负向探针，不得执行";
const ALL_MODULES: ModuleProbe[] = [
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
    mutationButtons: /调整|处理今日批次|swap 全局熔断|强制取消/,
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
const selectedModules = (process.env.G_PERMISSION_MODULES ?? "")
  .split(",")
  .map((value) => value.trim().toUpperCase())
  .filter(Boolean);
const MODULES = selectedModules.length === 0
  ? ALL_MODULES
  : ALL_MODULES.filter((module) => selectedModules.includes(module.id));

test.describe.configure({ timeout: 240_000 });
test.beforeAll(() => {
  expect(process.env.G_NONOWNER_PROBE_TOKEN, "G_NONOWNER_PROBE_TOKEN is required").toBe("1");
  expect(fixture.runId, "fixture Run ID").toBe(RUN_ID);
  expect(MODULES.length, "G_PERMISSION_MODULES must select at least one known module").toBeGreaterThan(0);
});
test.afterEach(async ({ page }) => {
  await page.request.post("/api/admin/auth/logout").catch(() => undefined);
});

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

    const lastModule = MODULES.at(-1)!;
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(lastModule.marker).first()).toBeVisible();
    expect((await browserApi(page, "GET", lastModule.readPath)).identity).toBe(firstSnapshots.get(lastModule.id));
    await logout(page);
    await login(page, account);
    await assertVisibleGMenus(page);
    expect((await browserApi(page, "GET", MODULES[0].readPath)).identity).toBe(firstSnapshots.get(MODULES[0].id));
    expect((await browserApi(page, MODULES[0].writeMethod, MODULES[0].writePath, MODULES[0].writeBody)).status).toBe(403);
    expect(errors.pageErrors).toEqual([]);
    expect(errors.api5xx).toEqual([]);
  });
}

test("g_no_menu：菜单和直接路由拒绝，数据 API 严格按夹具 read authority 失败关闭", async ({ page }) => {
  const errors = monitorFailures(page);
  const account = fixture.accounts.g_no_menu;
  await login(page, account);
  // A no-menu fixture may either retain data read authority (shared matrix) or
  // carry none (dedicated matrix). The expected API boundary follows the
  // fixture's explicit authority set, never a UI-only assumption.
  const hasGRead = (account.authorities ?? []).some((authority) =>
    ["g1", "g2", "g3", "g4", "g7"].some((module) => authority === `finprod_${module}_read`));
  await assertSessionShape(page, hasGRead);
  await expect(page.locator('a[href^="/finance-products/"]')).toHaveCount(0);

  await page.goto("/finance-products/staking", { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/finance-products\/staking(?:\?.*)?$/);
  for (const module of MODULES) {
    const read = await browserApi(page, "GET", module.readPath);
    expect(read.status, `${module.id} read`).toBe(hasGRead ? 200 : 403);
    if (hasGRead) {
      expect(read.code, `${module.id} read code`).toBe(0);
      expect(read.serverCanonical, `${module.id} read canonical`).toBe(true);
    }
    expect((await browserApi(page, module.writeMethod, module.writePath, module.writeBody)).status, `${module.id} write`).toBe(403);
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('a[href^="/finance-products/"]')).toHaveCount(0);
  await logout(page);
  await login(page, account);
  await expect(page.locator('a[href^="/finance-products/"]')).toHaveCount(0);
  expect((await browserApi(page, "GET", MODULES[0].readPath)).status).toBe(hasGRead ? 200 : 403);
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
  // This request context is the local trusted-edge carrier. The App itself must
  // never manufacture these headers; production injection belongs to the gateway.
  const trustedEdgeHeaders = { "X-Nexion-Edge-Country": "JP" };
  for (const path of [
    "/api/config/staking/pools",
    "/api/config/exchange/caps",
    "/api/config/market/nex",
    "/api/genesis/state",
    "/api/config/repurchase",
  ]) {
    const unresolved = await request.get(`${backend}${path}`);
    expect(unresolved.status(), `${path} missing trusted edge country`).toBe(503);
    const unresolvedPayload = await unresolved.json() as { code?: number; message?: string };
    expect(unresolvedPayload.code, `${path} unresolved code`).toBe(503);
    expect(unresolvedPayload.message, `${path} unresolved message`).toBe("GEO_COUNTRY_UNRESOLVED");
    const response = await request.get(`${backend}${path}`, { headers: trustedEdgeHeaders });
    expect(response.status(), `${path} public`).toBe(200);
    const payload = await response.json() as { code?: number; data?: { serverCanonical?: boolean } };
    expect(payload.code, `${path} code`).toBe(0);
    expect(payload.data?.serverCanonical, `${path} canonical`).toBe(true);
  }
  for (const path of ["/api/stakes", "/api/exchange", "/api/genesis/account", "/api/repurchase/orders"]) {
    expect((await request.get(`${backend}${path}`, { headers: trustedEdgeHeaders })).status(), `${path} anonymous`).toBe(401);
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
  await expect(page.getByRole("complementary")).toBeVisible({ timeout: 20_000 });
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
    // The console's authenticated fetch wrapper deliberately rejects an anonymous
    // 401 as an auth-epoch change before exposing its HTTP status. This probe is
    // specifically a browser-network authorization boundary check, so use XHR to
    // observe the server response without weakening the real UI auth behavior.
    const response = await new Promise<{ status: number; text: string }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(requestMethod, apiPath, true);
      xhr.withCredentials = true;
      if (requestMethod !== "GET") {
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.setRequestHeader("Idempotency-Key", `g-nonowner-permission-${runId}-${crypto.randomUUID()}`);
      }
      xhr.onload = () => resolve({ status: xhr.status, text: xhr.responseText });
      xhr.onerror = () => reject(new Error(`XHR failed for ${requestMethod} ${apiPath}`));
      xhr.send(requestMethod === "GET" ? null : JSON.stringify(requestBody ?? {}));
    });
    const payload = JSON.parse(response.text || "null") as {
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

function requiredAccount(account: FixtureAccount | undefined, key: string) {
  if (!account) throw new Error(`G permission fixture lacks ${key} account`);
  return account;
}
