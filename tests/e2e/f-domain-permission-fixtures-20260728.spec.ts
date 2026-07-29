import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

type FixtureAccount = { username: string; password: string; totpSecret: string };
type PermissionFixture = {
  runId: string;
  accounts: {
    f_readonly: FixtureAccount;
    f_no_write: FixtureAccount;
    f_no_menu: FixtureAccount;
    f_maker: FixtureAccount;
  };
};
type ModuleProbe = {
  id: string;
  path: string;
  marker: RegExp;
  readPath: string;
  writePath: string;
  writeMethod: "PATCH" | "POST";
  writeBody: Record<string, unknown>;
  mutationButtons: RegExp;
};

const fixturePath = process.env.F_PERMISSION_FIXTURE_PATH;
if (!fixturePath) throw new Error("F_PERMISSION_FIXTURE_PATH is required");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as PermissionFixture;
const REASON = "F 域权限探针不得执行";
const MODULES: ModuleProbe[] = [
  {
    id: "F1",
    path: "/network/v-rank",
    marker: /V-Rank 13 阶阶梯/,
    readPath: "/api/admin/teams/ranks",
    writePath: "/api/admin/teams/ranks/V1/thresholds/selfBuy",
    writeMethod: "PATCH",
    writeBody: { value: "$299", reason: REASON, operator: "permission-probe" },
    mutationButtons: /加奖励|编辑.*奖励|移除奖励|人工晋升|回滚|不降级保护|奖品名|13 阶头衔|调整V\d/,
  },
  {
    id: "F2",
    path: "/network/royalty",
    marker: /F2 网络版税费率/,
    readPath: "/api/admin/teams/rates",
    writePath: "/api/admin/teams/commissions/config/F.unilevel.L1",
    writeMethod: "PATCH",
    writeBody: { value: "10%", reason: REASON, operator: "permission-probe" },
    mutationButtons: /调整|暂停管理/,
  },
  {
    id: "F3",
    path: "/network/binary",
    marker: /平衡匹配公式/,
    readPath: "/api/admin/teams/binary",
    writePath: "/api/admin/teams/binary/settlements",
    writeMethod: "POST",
    writeBody: { ownerUserId: 1, settlementDate: "2026-07-28", reason: REASON },
    mutationButtons: /执行结算|调整门槛|调整比例|分配策略|调整周期|暂停引擎|恢复引擎/,
  },
  {
    id: "F4",
    path: "/network/leadership-pool",
    marker: /V 级票数权重/,
    readPath: "/api/admin/teams/leadership-pool",
    writePath: "/api/admin/teams/leadership-pool/settle",
    writeMethod: "POST",
    writeBody: { reason: REASON },
    mutationButtons: /提前结算|调整|结算周期|解锁等级|集中度|Pro 门槛|Rack 门槛|月库存|确认通过|驳回|暂停榜单|恢复榜单|取消资格|周期奖池/,
  },
  {
    id: "F5",
    path: "/network/commissions",
    marker: /F5 佣金事件审计/,
    readPath: "/api/admin/teams/commissions",
    writePath: "/api/admin/teams/commissions/reissue",
    writeMethod: "POST",
    writeBody: { commissionIds: ["CM-DOES-NOT-EXIST"], reason: REASON },
    mutationButtons: /批量补发|冲正|暂停奖种|调整阈值/,
  },
];

for (const key of ["f_readonly", "f_no_write"] as const) {
  test(`${key}：F1-F5 菜单/路由/数据可读，按钮和接口写入拒绝`, async ({ page }) => {
    const pageErrors = monitorPageErrors(page);
    await login(page, fixture.accounts[key]);
    await assertVisibleFMenus(page);
    await assertSessionShape(page, true);

    for (const module of MODULES) {
      await openVisibleModule(page, module);
      await expect(page.getByText(module.marker).first()).toBeVisible({ timeout: 20_000 });
      const read = await browserApi(page, "GET", module.readPath);
      expect(read.status, `${key} ${module.id} read`).toBe(200);
      expect(read.hasData, `${key} ${module.id} data`).toBe(true);
      const write = await browserApi(page, module.writeMethod, module.writePath, module.writeBody);
      expect(write.status, `${key} ${module.id} write`).toBe(403);
      await expectEnabledMutationButtonCount(page, module.mutationButtons, 0, `${key} ${module.id}`);
    }

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText(MODULES.at(-1)!.marker).first()).toBeVisible();
    await logout(page);
    await login(page, fixture.accounts[key]);
    await assertVisibleFMenus(page);
    expect((await browserApi(page, "GET", MODULES[0].readPath)).status).toBe(200);
    expect((await browserApi(page, MODULES[0].writeMethod, MODULES[0].writePath, MODULES[0].writeBody)).status).toBe(403);
    expect(pageErrors).toEqual([]);
  });
}

test("f_no_menu：F 菜单、直接路由、读写接口均拒绝，刷新重登不能由缓存恢复", async ({ page }) => {
  const pageErrors = monitorPageErrors(page);
  await login(page, fixture.accounts.f_no_menu);
  await assertSessionShape(page, false);
  await expect(page.locator('a[href^="/network/"]')).toHaveCount(0);

  await page.goto("/network/v-rank", { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/network\/v-rank(?:\?.*)?$/);
  await expect(page.locator(".fdom")).toHaveCount(0);
  for (const module of MODULES) {
    expect((await browserApi(page, "GET", module.readPath)).status, `${module.id} read`).toBe(403);
    expect((await browserApi(page, module.writeMethod, module.writePath, module.writeBody)).status, `${module.id} write`).toBe(403);
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('a[href^="/network/"]')).toHaveCount(0);
  await logout(page);
  await login(page, fixture.accounts.f_no_menu);
  await expect(page.locator('a[href^="/network/"]')).toHaveCount(0);
  expect((await browserApi(page, "GET", MODULES[0].readPath)).status).toBe(403);
  expect(pageErrors).toEqual([]);
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
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
}

async function assertVisibleFMenus(page: Page) {
  const domain = CONSOLE_NAV.find((item) => item.code === "F");
  if (!domain) throw new Error("F domain missing");
  const group = page.getByRole("button", { name: /分销与团队/ }).first();
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

async function assertSessionShape(page: Page, hasFRead: boolean) {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const payload = await response.json() as { data?: { session?: { authorities?: string[] } } };
  const authorities = payload.data?.session?.authorities ?? [];
  for (const module of ["f1", "f2", "f3", "f4", "f5"]) {
    if (hasFRead) {
      expect(authorities).toContain(`network_${module}_read`);
      expect(authorities.some((authority) =>
        authority.startsWith(`network_${module}_`) && authority !== `network_${module}_read`)).toBe(false);
    } else {
      expect(authorities).not.toContain(`network_${module}_read`);
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
        "Idempotency-Key": `f-permission-${runId}-${crypto.randomUUID()}`,
      },
      body: requestMethod === "GET" ? undefined : JSON.stringify(requestBody ?? {}),
    });
    const payload = await response.json().catch(() => null) as { data?: unknown } | null;
    return { status: response.status, hasData: payload?.data !== undefined };
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
