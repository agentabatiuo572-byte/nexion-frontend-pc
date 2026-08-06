import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

type FixtureAccount = { username: string; password: string; totpSecret: string };
type Fixture = { runId: string; accounts?: { maker?: FixtureAccount; g_maker?: FixtureAccount } };

const RUN_ID = process.env.G_NONOWNER_RUN_ID ?? "pc-full-acceptance-20260729-114336";
const FIXTURE_PATH = process.env.G_PERMISSION_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/domain-permission-fixtures/G.json`;
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;
const maker = fixture.accounts?.maker ?? fixture.accounts?.g_maker;
if (!maker) throw new Error("G fixture must provide accounts.maker or accounts.g_maker");

const ALL_CASES = [
  {
    id: "G1",
    path: "/finance-products/staking",
    endpoint: "/api/admin/market/staking/pools/usdt30d/params/apy",
    openEditor: async (page: Page) => {
      await page.getByRole("button", { name: "调整 APY", exact: true }).first().click();
    },
  },
  {
    id: "G2",
    path: "/finance-products/exchange",
    endpoint: "/api/admin/market/exchange/params/fee",
    openEditor: async (page: Page) => {
      await page.getByRole("button", { name: "调整 兑换手续费率", exact: true }).click();
    },
  },
  {
    id: "G3",
    path: "/finance-products/market",
    endpoint: "/api/admin/market/nex/overrides/deviationPct",
    openEditor: async (page: Page) => {
      const row = page.locator(".p-row").filter({ hasText: "偏离告警阈值" }).first();
      await row.getByRole("button", { name: /调整/ }).click();
    },
  },
  {
    id: "G4",
    path: "/finance-products/genesis",
    endpoint: "/api/admin/market/nex/genesis/params/price",
    openEditor: async (page: Page) => {
      const row = page.locator(".p-row").filter({ hasText: "一级单价" }).first();
      await row.getByRole("button", { name: "调整", exact: true }).click();
    },
  },
  {
    id: "G7",
    path: "/finance-products/repurchase",
    endpoint: "/api/admin/market/nex/repurchase/config/apy",
    openEditor: async (page: Page) => {
      await page.getByRole("button", { name: "编辑 年化 APY", exact: true }).click();
    },
  },
] as const;
const selectedModules = (process.env.G_UNKNOWN_MODULES ?? "")
  .split(",")
  .map((value) => value.trim().toUpperCase())
  .filter(Boolean);
const CASES = selectedModules.length === 0
  ? ALL_CASES
  : ALL_CASES.filter((scenario) => selectedModules.includes(scenario.id));

test.describe.configure({ timeout: 120_000 });
test.beforeAll(() => {
  expect(fixture.runId, "fixture Run ID").toBe(RUN_ID);
  expect(CASES.length, "G_UNKNOWN_MODULES must select at least one known G module").toBeGreaterThan(0);
});
test.afterEach(async ({ page }) => {
  await page.request.post("/api/admin/auth/logout").catch(() => undefined);
});

for (const scenario of CASES) {
  test(`${scenario.id} 结果未知必须保留表单并以同一幂等键重试`, async ({ page }) => {
    await login(page, maker);
    await openFromSidebar(page, scenario.path);

    const commandKeys: string[] = [];
    await page.route(`**${scenario.endpoint}`, async (route) => {
      commandKeys.push(route.request().headers()["idempotency-key"] ?? "");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, message: "OK", data: {} }),
      });
    });

    await scenario.openEditor(page);
    const dialog = page.locator('[role="dialog"]:visible').last();
    const target = dialog.getByLabel("目标新值");
    const current = Number((await target.getAttribute("placeholder"))?.match(/当前\s*([\d.]+)/)?.[1] ?? "0");
    const next = current >= 1 ? String(current - 0.01) : String(current + 0.01);
    const reason = `${scenario.id} 网络结果未知必须保留同一命令键复验`;
    await target.fill(next);
    await dialog.getByLabel(/操作理由/).fill(reason);

    await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(target).toHaveValue(next);
    await expect(dialog.getByLabel(/操作理由/)).toHaveValue(reason);

    await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
    await expect.poll(() => commandKeys.length).toBe(2);
    expect(commandKeys[0]).not.toBe("");
    expect(commandKeys[1]).toBe(commandKeys[0]);
    await expect(dialog).toBeVisible();
  });

  test(`${scenario.id} 确定性拒绝必须释放幂等键`, async ({ page }) => {
    await login(page, maker);
    await openFromSidebar(page, scenario.path);

    const commandKeys: string[] = [];
    await page.route(`**${scenario.endpoint}`, async (route) => {
      commandKeys.push(route.request().headers()["idempotency-key"] ?? "");
      if (commandKeys.length === 1) {
        await route.fulfill({
          status: 422,
          contentType: "application/json",
          body: JSON.stringify({ code: 422, message: "NONOWNER_DETERMINISTIC_REJECTION", data: null }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ code: 0, message: "OK", data: {} }),
      });
    });

    await scenario.openEditor(page);
    const dialog = page.locator('[role="dialog"]:visible').last();
    const target = dialog.getByLabel("目标新值");
    const current = Number((await target.getAttribute("placeholder"))?.match(/当前\s*([\d.]+)/)?.[1] ?? "0");
    const next = current >= 1 ? String(current - 0.01) : String(current + 0.01);
    const reason = `${scenario.id} 确定性拒绝必须释放命令键复验`;
    await target.fill(next);
    await dialog.getByLabel(/操作理由/).fill(reason);

    await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(target).toHaveValue(next);
    await expect(dialog.getByLabel(/操作理由/)).toHaveValue(reason);

    await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
    await expect.poll(() => commandKeys.length).toBe(2);
    expect(commandKeys[0]).not.toBe("");
    expect(commandKeys[1]).not.toBe(commandKeys[0]);
    await expect(dialog).toBeVisible();
  });
}

async function login(page: Page, account: FixtureAccount) {
  await page.goto("/", { waitUntil: "load" });
  const shell = page.locator("aside");
  const username = page.locator('input[autocomplete="username"]');
  await expect(username).toBeVisible({ timeout: 8_000 });
  await username.fill(account.username);
  const password = page.locator('input[autocomplete="current-password"]');
  await password.fill(account.password);
  await expect(username).toHaveValue(account.username);
  await expect(password).toHaveValue(account.password);
  const submit = page.getByRole("button", { name: /继续|登录/ });
  await expect(submit).toBeEnabled();
  await submit.click();
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 8_000 });
  await otp.fill(await freshTotp(account.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(shell).toBeVisible({ timeout: 20_000 });
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

async function openFromSidebar(page: Page, href: string) {
  const group = page.getByRole("button", { name: /金融产品/ }).first();
  const link = page.locator(`aside a[href="${href}"]`).first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(new RegExp(`${href.replaceAll("/", "\\/")}$`));
}
