import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

type FixtureAccount = { username: string; password: string; totpSecret: string };
type PermissionFixture = {
  runId: string;
  accounts: {
    h_readonly: FixtureAccount;
    h_no_write: FixtureAccount;
    h_no_menu: FixtureAccount;
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
  mutationButtons: RegExp;
};

const fixturePath = process.env.H_PERMISSION_FIXTURE_PATH;
if (!fixturePath) throw new Error("H_PERMISSION_FIXTURE_PATH is required");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as PermissionFixture;

const REASON = "H 域权限探针不得执行";
const MODULES: ModuleProbe[] = [
  {
    id: "H1",
    path: "/growth/phase",
    visibleText: /节奏骨架/,
    readPath: "/api/admin/growth/phases",
    writePath: "/api/admin/growth/rhythm/phaseProgressPct",
    writeMethod: "PATCH",
    writeBody: { key: "phaseProgressPct", value: "50", reason: REASON, operator: "permission-probe" },
    mutationButtons: /改总时长|设定位置|调整|撤销/,
  },
  {
    id: "H2",
    path: "/growth/trial",
    visibleText: /四道前置闸/,
    readPath: "/api/admin/growth/trials",
    writePath: "/api/admin/growth/trials/params/trialDays",
    writeMethod: "PATCH",
    writeBody: { key: "trialDays", value: "3", reason: REASON, operator: "permission-probe" },
    mutationButtons: /调整|强制取消|强制扣款|auto-push 急停/,
  },
  {
    id: "H3",
    path: "/growth/quest",
    visibleText: /任务事件契约与归因/,
    readPath: "/api/admin/growth/quest-events/tasks",
    writePath: "/api/admin/growth/quest-events/missions",
    writeMethod: "POST",
    writeBody: {},
    mutationButtons: /改奖励|调整|\+ 新建|改基础|改倍率|改天数|改小时|改设备|改日产/,
  },
  {
    id: "H4",
    path: "/growth/events",
    visibleText: /抽奖转盘治理/,
    readPath: "/api/admin/growth/quest-events/events-overview",
    writePath: "/api/admin/growth/quest-events/events",
    writeMethod: "POST",
    writeBody: {},
    mutationButtons: /\+ 新建活动|编辑|上线|下线|主推|设为主推|保存概率|\+ 新建档位|\+ 新建护栏|删除|调整/,
  },
  {
    id: "H5",
    path: "/growth/daily",
    visibleText: /签到规则|签到/,
    readPath: "/api/admin/growth/check-in",
    writePath: "/api/admin/growth/check-in",
    writeMethod: "PATCH",
    writeBody: { key: "enabled", value: "false", reason: REASON, operator: "permission-probe" },
    mutationButtons: /调整|改奖励|检查间隔|保存/,
  },
  {
    id: "H7",
    path: "/growth/vouchers",
    visibleText: /代金券/,
    readPath: "/api/admin/growth/vouchers",
    writePath: "/api/admin/growth/vouchers",
    writeMethod: "POST",
    writeBody: {},
    mutationButtons: /\+ 新增代金券|编辑|暂停|投放|撤销未核销|删除代金券/,
  },
  {
    id: "H8",
    path: "/growth/referral-rewards",
    visibleText: /新人礼与邀请人奖励/,
    readPath: "/api/admin/growth/referral-rewards",
    writePath: "/api/admin/growth/referral-rewards/params/newUserRewardNex",
    writeMethod: "PATCH",
    writeBody: { value: "0", expectedVersion: -1, reason: REASON, operator: "permission-probe" },
    mutationButtons: /调整|执行真实结算/,
  },
];

test.describe.serial("H 域五层权限夹具验收", () => {
  for (const key of ["h_readonly", "h_no_write"] as const) {
    test(`${key}：H1/H2/H3/H4/H5/H7/H8 菜单、路由、数据可读，按钮和接口写入拒绝`, async ({ page }) => {
      const pageErrors = monitorPageErrors(page);
      await login(page, fixture.accounts[key]);
      await assertVisibleHMenus(page);
      await assertSessionShape(page, true);

      for (const module of MODULES) {
        await openVisibleModule(page, module);
        await expect(page.locator(".hdom")).toBeVisible();
        await expect(page.getByText(module.visibleText).first()).toBeVisible({ timeout: 20_000 });
        const read = await browserApi(page, "GET", module.readPath);
        expect(read.status, `${key} ${module.id} read`).toBe(200);
        expect(read.hasData, `${key} ${module.id} authoritative data`).toBe(true);
        const write = await browserApi(page, module.writeMethod, module.writePath, module.writeBody);
        expect(write.status, `${key} ${module.id} write`).toBe(403);
        await expectEnabledMutationButtonCount(page, module.mutationButtons, 0, `${key} ${module.id}`);
      }

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByText(MODULES.at(-1)!.visibleText).first()).toBeVisible();
      await logout(page);
      await login(page, fixture.accounts[key]);
      await assertVisibleHMenus(page);
      expect((await browserApi(page, "GET", MODULES[0].readPath)).status).toBe(200);
      expect((await browserApi(page, MODULES[0].writeMethod, MODULES[0].writePath, MODULES[0].writeBody)).status).toBe(403);
      expect(pageErrors).toEqual([]);
    });
  }

  test("h_no_menu：H 菜单、直接路由、读写接口均拒绝，刷新重登不能由缓存恢复", async ({ page }) => {
    const pageErrors = monitorPageErrors(page);
    await login(page, fixture.accounts.h_no_menu);
    await assertSessionShape(page, false);
    await expect(page.locator('a[href^="/growth/"]')).toHaveCount(0);

    await page.goto("/growth/phase", { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/growth\/phase(?:\?.*)?$/);
    await expect(page.locator(".hdom")).toHaveCount(0);
    for (const module of MODULES) {
      expect((await browserApi(page, "GET", module.readPath)).status, `${module.id} read`).toBe(403);
      expect((await browserApi(page, module.writeMethod, module.writePath, module.writeBody)).status, `${module.id} write`).toBe(403);
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('a[href^="/growth/"]')).toHaveCount(0);
    await logout(page);
    await login(page, fixture.accounts.h_no_menu);
    await expect(page.locator('a[href^="/growth/"]')).toHaveCount(0);
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

async function assertVisibleHMenus(page: Page) {
  const domain = CONSOLE_NAV.find((item) => item.code === "H");
  if (!domain) throw new Error("H domain missing from navigation source");
  const group = page.getByRole("button", { name: /增长与运营节奏\s+H|H\s+增长与运营节奏/ }).first();
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

async function assertSessionShape(page: Page, hasHRead: boolean) {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const payload = await response.json() as { data?: { session?: { authorities?: string[] } } };
  const authorities = payload.data?.session?.authorities ?? [];
  for (const module of ["h1", "h2", "h3", "h4", "h5", "h7", "h8"]) {
    if (hasHRead) {
      expect(authorities).toContain(`growth_${module}_read`);
      expect(authorities.some((authority) =>
        authority.startsWith(`growth_${module}_`) && authority !== `growth_${module}_read`)).toBe(false);
    } else {
      expect(authorities).not.toContain(`growth_${module}_read`);
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
        "Idempotency-Key": `h-permission-${runId}-${crypto.randomUUID()}`,
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
