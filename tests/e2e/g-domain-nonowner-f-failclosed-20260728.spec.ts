import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page, type Route } from "@playwright/test";

type FixtureAccount = { username: string; password: string; totpSecret: string };
type Fixture = { runId: string; accounts?: { maker?: FixtureAccount; g_maker?: FixtureAccount } };

const RUN_ID = process.env.G_NONOWNER_RUN_ID ?? "pc-full-acceptance-20260729-114336";
const FIXTURE_PATH = process.env.G_PERMISSION_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/domain-permission-fixtures/G.json`;
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
const maker = fixture.accounts?.maker ?? fixture.accounts?.g_maker;
if (!maker) throw new Error("G fixture must provide accounts.maker or accounts.g_maker");

const MODULES = [
  {
    id: "G1",
    path: "/finance-products/staking",
    endpoint: "/api/admin/market/staking",
    marker: /G1 Staking/,
  },
  {
    id: "G2",
    path: "/finance-products/exchange",
    endpoint: "/api/admin/market/exchange",
    marker: /G2 兑换风控/,
  },
  {
    id: "G3",
    path: "/finance-products/market",
    endpoint: "/api/admin/market/nex/curve",
    marker: /G3 NEX 行情引擎/,
  },
  {
    id: "G4",
    path: "/finance-products/genesis",
    endpoint: "/api/admin/market/nex/genesis",
    marker: /G4 Genesis 经济/,
  },
  {
    id: "G7",
    path: "/finance-products/repurchase",
    endpoint: "/api/admin/market/nex/repurchase",
    marker: /G7 复投激励/,
  },
] as const;

test.describe.configure({ timeout: 180_000 });
test.beforeAll(() => {
  expect(fixture.runId, "fixture Run ID").toBe(RUN_ID);
});

for (const module of MODULES) {
  test(`${module.id} 畸形 HTTP 200 必须失败关闭并由真实上游恢复`, async ({ page }) => {
    await login(page, maker);
    await interceptExactGet(page, module.endpoint, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, message: "OK", data: {} }),
      });
    });

    await openFromSidebar(page, module.path);
    await expect(page.getByText(new RegExp(`${module.id} 数据加载失败`)).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "重新加载", exact: true })).toBeVisible();
    await expect(page.getByRole("button", {
      name: /调整|编辑|暂停|恢复|熔断|重跑|处理今日批次|创建虚拟成交/,
    })).toHaveCount(0);

    await page.unroute("**/api/admin/**");
    const response = page.waitForResponse((candidate) =>
      candidate.request().method() === "GET"
      && new URL(candidate.url()).pathname === module.endpoint
      && candidate.status() === 200);
    await page.getByRole("button", { name: "重新加载", exact: true }).click();
    await response;
    await expect(page.getByText(new RegExp(`${module.id} 数据加载失败`))).toHaveCount(0);
    await expect(page.getByText(module.marker).first()).toBeVisible();
  });
}

test("G7 HTTP 500 与 G3 超时/结果未知均失败关闭且真实刷新恢复", async ({ page }) => {
  await login(page, maker);

  await interceptExactGet(page, "/api/admin/market/nex/repurchase", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ code: 500, message: "NONOWNER_INJECTED_500", data: null }),
    });
  });
  await openFromSidebar(page, "/finance-products/repurchase");
  await expect(page.getByText(/G7 数据加载失败/)).toBeVisible();
  await page.unroute("**/api/admin/**");

  await interceptExactGet(page, "/api/admin/market/nex/curve", async (route) => {
    await route.abort("timedout");
  });
  await openFromSidebar(page, "/finance-products/market");
  await expect(page.getByText(/G3 数据加载失败/)).toBeVisible();
  await page.unroute("**/api/admin/**");

  const recovered = page.waitForResponse((candidate) =>
    candidate.request().method() === "GET"
    && new URL(candidate.url()).pathname === "/api/admin/market/nex/curve"
    && candidate.status() === 200);
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await recovered;
  await expect(page.getByText(/G3 数据加载失败/)).toHaveCount(0);
  await expect(page.getByText(/G3 NEX 行情引擎/).first()).toBeVisible();
});

async function interceptExactGet(
  page: Page,
  pathname: string,
  handler: (route: Route) => Promise<void>,
) {
  await page.route("**/api/admin/**", async (route) => {
    const request = route.request();
    if (request.method() === "GET" && new URL(request.url()).pathname === pathname) {
      await handler(route);
      return;
    }
    await route.continue();
  });
}

async function openFromSidebar(page: Page, href: string) {
  const group = page.getByRole("button", { name: /金融产品\s+G|G\s+金融产品/ }).first();
  const link = page.locator(`aside a[href="${href}"]`).first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href.replaceAll("/", "\\/")}$`));
}

async function login(page: Page, account: FixtureAccount) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const username = page.locator('input[autocomplete="username"]');
  await expect(username).toBeVisible({ timeout: 15_000 });
  await username.fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /继续|登录/ }).click();
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 10_000 });
  await otp.fill(await freshTotp(account.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

const lastTotpStep = new Map<string, number>();

async function freshTotp(secret: string) {
  let step = Math.floor(Date.now() / 30_000);
  const previous = lastTotpStep.get(secret) ?? -1;
  if (step <= previous) {
    await expect.poll(() => Math.floor(Date.now() / 30_000), { timeout: 35_000 })
      .toBeGreaterThan(previous);
  }
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 3) {
    const boundary = Math.floor(Date.now() / 30_000);
    await expect.poll(() => Math.floor(Date.now() / 30_000), { timeout: 5_000 })
      .toBeGreaterThan(boundary);
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
