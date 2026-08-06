import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";
import {
  assertLocalFCandidate,
  currentFFixturePath,
  currentFRunId,
  loginFActor,
} from "./helpers/f-acceptance-harness";

type FixtureAccount = { username: string; password: string; totpSecret: string };
type PermissionFixture = {
  runId: string;
  accounts: {
    readonly?: FixtureAccount;
    nowrite?: FixtureAccount;
    nomenu?: FixtureAccount;
    maker?: FixtureAccount;
    f_readonly?: FixtureAccount;
    f_no_write?: FixtureAccount;
    f_no_menu?: FixtureAccount;
    f_maker?: FixtureAccount;
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

const RUN_ID = currentFRunId();
const fixturePath = currentFFixturePath(RUN_ID);
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as PermissionFixture;
if (fixture.runId !== RUN_ID) {
  throw new Error(`F permission fixture Run ID mismatch: expected=${RUN_ID}, actual=${fixture.runId}`);
}
const REASON = "F 域权限探针不得执行";
const MODULES: ModuleProbe[] = [
  {
    id: "F1",
    path: "/network/v-rank",
    marker: /V-Rank 13 阶阶梯/,
    readPath: "/api/admin/teams/ranks",
    writePath: "/api/admin/teams/ranks/V99/thresholds/__acceptance_invalid__",
    writeMethod: "PATCH",
    writeBody: { value: "__NO_MUTATION__", reason: REASON, operator: "permission-probe" },
    mutationButtons: /加奖励|编辑.*奖励|移除奖励|人工晋升|回滚|不降级保护|奖品名|13 阶头衔|调整V\d/,
  },
  {
    id: "F2",
    path: "/network/royalty",
    marker: /F2 网络版税费率/,
    readPath: "/api/admin/teams/rates",
    writePath: "/api/admin/teams/commissions/config/F.__acceptance.invalid__.F2",
    writeMethod: "PATCH",
    writeBody: { value: "__NO_MUTATION__", reason: REASON, operator: "permission-probe" },
    mutationButtons: /调整|暂停管理/,
  },
  {
    id: "F3",
    path: "/network/binary",
    marker: /平衡匹配公式/,
    readPath: "/api/admin/teams/binary",
    writePath: "/api/admin/teams/commissions/config/F.__acceptance.invalid__.F3",
    writeMethod: "PATCH",
    writeBody: { value: "__NO_MUTATION__", reason: REASON, operator: "permission-probe" },
    mutationButtons: /执行结算|调整门槛|调整比例|分配策略|调整周期|暂停引擎|恢复引擎/,
  },
  {
    id: "F4",
    path: "/network/leadership-pool",
    marker: /V 级票数权重/,
    readPath: "/api/admin/teams/leadership-pool",
    writePath: "/api/admin/teams/commissions/config/F.__acceptance.invalid__.F4",
    writeMethod: "PATCH",
    writeBody: { value: "__NO_MUTATION__", reason: REASON, operator: "permission-probe" },
    mutationButtons: /提前结算|调整|结算周期|解锁等级|集中度|Pro 门槛|Rack 门槛|月库存|确认通过|驳回|暂停榜单|恢复榜单|取消资格|周期奖池/,
  },
  {
    id: "F5",
    path: "/network/commissions",
    marker: /F5 佣金事件审计/,
    readPath: "/api/admin/teams/commissions",
    writePath: "/api/admin/teams/commissions/config/F.__acceptance.invalid__.F5",
    writeMethod: "PATCH",
    writeBody: { value: "__NO_MUTATION__", reason: REASON, operator: "permission-probe" },
    mutationButtons: /批量补发|冲正|暂停奖种|调整阈值/,
  },
];

test.beforeAll(() => {
  expect(
    process.env.F_NEGATIVE_WRITE_PROBE_TOKEN,
    "F_NEGATIVE_WRITE_PROBE_TOKEN=1 is required for permission-denial probes",
  ).toBe("1");
  expect(
    process.env.F_WRITE_BYPASS,
    "F_WRITE_BYPASS=false must be explicitly confirmed by the main controller",
  ).toBe("false");
  assertLocalFCandidate();
});

for (const [profile, key, legacyKey] of [
  ["readonly", "readonly", "f_readonly"],
  ["nowrite", "nowrite", "f_no_write"],
] as const) {
  test(`${profile}：F1-F5 菜单/路由/数据可读，按钮和接口写入拒绝`, async ({ page }) => {
    const pageErrors = monitorPageErrors(page);
    const account = fixtureAccount(key, legacyKey);
    await login(page, account);
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
    await login(page, account);
    await assertVisibleFMenus(page);
    expect((await browserApi(page, "GET", MODULES[0].readPath)).status).toBe(200);
    expect((await browserApi(page, MODULES[0].writeMethod, MODULES[0].writePath, MODULES[0].writeBody)).status).toBe(403);
    expect(pageErrors).toEqual([]);
  });
}

test("maker：F1-F5 从可见菜单读取、刷新、重登均可用，本轮不执行任何业务写入", async ({ page }) => {
  const pageErrors = monitorPageErrors(page);
  const account = fixtureAccount("maker", "f_maker");
  await login(page, account);
  await assertVisibleFMenus(page);
  await assertMakerSessionShape(page);

  for (const module of MODULES) {
    await openVisibleModule(page, module);
    await expect(page.getByText(module.marker).first()).toBeVisible({ timeout: 20_000 });
    const read = await browserApi(page, "GET", module.readPath);
    expect(read.status, `maker ${module.id} read`).toBe(200);
    expect(read.hasData, `maker ${module.id} data`).toBe(true);
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.getByText(MODULES.at(-1)!.marker).first()).toBeVisible();
  await logout(page);
  await login(page, account);
  await assertVisibleFMenus(page);
  expect((await browserApi(page, "GET", MODULES[0].readPath)).status).toBe(200);
  expect(pageErrors).toEqual([]);
});

test("nomenu：unassigned session/menu 双空，F1-F5 读写均失败关闭且刷新重登不恢复", async ({ page }) => {
  const pageErrors = monitorPageErrors(page);
  const account = fixtureAccount("nomenu", "f_no_menu");
  await login(page, account);
  await assertSessionShape(page, false, false);
  await expect(page.locator('a[href^="/network/"]')).toHaveCount(0);

  await page.goto("/network/v-rank", { waitUntil: "domcontentloaded" });
  await expect(page).not.toHaveURL(/\/network\/v-rank(?:\?.*)?$/);
  await expect(page.locator(".fdom")).toHaveCount(0);
  for (const module of MODULES) {
    const read = await browserApi(page, "GET", module.readPath);
    expect(read.status, `${module.id} read`).toBe(403);
    expect((await browserApi(page, module.writeMethod, module.writePath, module.writeBody)).status, `${module.id} write`).toBe(403);
  }
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator('a[href^="/network/"]')).toHaveCount(0);
  await logout(page);
  await login(page, account);
  await assertSessionShape(page, false, false);
  await expect(page.locator('a[href^="/network/"]')).toHaveCount(0);
  const reloginRead = await browserApi(page, "GET", MODULES[0].readPath);
  expect(reloginRead.status).toBe(403);
  expect(pageErrors).toEqual([]);
});

async function login(page: Page, account: FixtureAccount) {
  await loginFActor(page, account, `f-permission-${account.username}`);
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

function fixtureAccount(preferredKey: string, legacyKey: string): FixtureAccount {
  const account = fixture.accounts[preferredKey as keyof PermissionFixture["accounts"]]
    ?? fixture.accounts[legacyKey as keyof PermissionFixture["accounts"]];
  if (!account) throw new Error(`permission fixture missing account: ${preferredKey} or ${legacyKey}`);
  return account;
}

async function assertSessionShape(page: Page, hasFRead: boolean, hasFMenus = hasFRead) {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const payload = await response.json() as {
    data?: { session?: { authorities?: string[]; effectiveMenus?: unknown[] } };
  };
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
  const menus = payload.data?.session?.effectiveMenus ?? [];
  if (hasFMenus) expect(menus.length).toBeGreaterThan(0);
  else expect(menus).toEqual([]);
}

async function assertMakerSessionShape(page: Page) {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const payload = await response.json() as {
    data?: { session?: { authorities?: string[]; effectiveMenus?: unknown[] } };
  };
  const authorities = payload.data?.session?.authorities ?? [];
  for (const module of ["f1", "f2", "f3", "f4", "f5"]) {
    expect(authorities).toContain(`network_${module}_read`);
  }
  expect(authorities.some((authority) => authority.startsWith("network_f") && authority.endsWith("_write"))).toBe(true);
  expect(payload.data?.session?.effectiveMenus?.length ?? 0).toBeGreaterThan(0);
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
