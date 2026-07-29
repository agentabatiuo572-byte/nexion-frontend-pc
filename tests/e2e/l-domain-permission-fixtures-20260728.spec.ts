import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

type FixtureAccount = { username: string; password: string; totpSecret: string };
type PermissionFixture = {
  runId: string;
  accounts: {
    l_readonly: FixtureAccount;
    l_no_write: FixtureAccount;
    l_no_menu: FixtureAccount;
  };
};
type ModuleProbe = {
  id: string;
  path: string;
  marker: RegExp;
  readPath: string;
  writePath: string;
  writeMethod: "GET" | "POST";
  writeBody?: Record<string, unknown>;
  writeHeaders?: Record<string, string>;
  mutationButtons: RegExp;
};

const fixturePath = process.env.L_PERMISSION_FIXTURE_PATH;
if (!fixturePath) throw new Error("L_PERMISSION_FIXTURE_PATH is required");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as PermissionFixture;
const PROBE_REASON = "L 域权限探针不得执行";
const REPORT_BODY = {
  exportType: "KPI 序列",
  timeRange: "权限探针",
  fields: "服务端权威聚合指标",
  piiLevel: "NONE",
  maskPolicy: "NONE",
  recipient: "权限探针",
  ticket: "L-PERMISSION-PROBE",
  reason: PROBE_REASON,
  operator: "permission-probe",
};
const MODULES: ModuleProbe[] = [
  {
    id: "L1",
    path: "/analytics/kpi",
    marker: /KPI 看板/,
    readPath: "/api/admin/bi/kpi?window=7d",
    writePath: "/api/admin/bi/reports",
    writeMethod: "POST",
    writeBody: REPORT_BODY,
    mutationButtons: /导出 KPI/,
  },
  {
    id: "L2",
    path: "/analytics/funnel-cohort",
    marker: /漏斗|留存/,
    readPath: "/api/admin/bi/funnel/overview",
    writePath: "/api/admin/bi/reports",
    writeMethod: "POST",
    writeBody: { ...REPORT_BODY, exportType: "漏斗序列" },
    mutationButtons: /导出漏斗/,
  },
  {
    id: "L3",
    path: "/analytics/financial",
    marker: /财务报表/,
    readPath: "/api/admin/bi/finance/overview?period=2026-07",
    writePath: "/api/admin/bi/reports",
    writeMethod: "POST",
    writeBody: { ...REPORT_BODY, exportType: "财务资金明细", piiLevel: "MASKED", maskPolicy: "MASKED" },
    mutationButtons: /导出财务|导出资金/,
  },
  {
    id: "L4",
    path: "/analytics/operations",
    marker: /历史运营报表/,
    readPath: "/api/admin/bi/operations/overview?period=week&phase=ALL",
    writePath: "/api/admin/bi/export/network?period=week&detail=tree&depth=2",
    writeMethod: "GET",
    writeHeaders: {
      "Idempotency-Key": "l-permission-network-probe",
      "X-Operation-Reason": encodeURIComponent(PROBE_REASON),
    },
    mutationButtons: /导出运营|导出网络/,
  },
  {
    id: "L5",
    path: "/analytics/export",
    marker: /导出.*监管报告|数据出境统一管控面/,
    readPath: "/api/admin/bi/export/overview",
    writePath: "/api/admin/regulatory/report",
    writeMethod: "POST",
    writeBody: {
      templateCode: "AML_REPORT",
      period: "2026-07",
      recipient: "权限探针",
      ticket: "L-PERMISSION-PROBE",
      jurisdictionCode: "CN",
      disclosureVersion: "v1",
      reason: PROBE_REASON,
      operator: "permission-probe",
    },
    mutationButtons: /发起聚合快照|生成监管报告|批准|拒绝/,
  },
  {
    id: "L6",
    path: "/analytics/behavior-heatmap",
    marker: /用户行为热力图/,
    readPath: "/api/admin/bi/behavior?window=7d&device=ALL&locale=ALL&depth=all&sort=pv",
    writePath: "/api/admin/bi/export/behavior?window=7d&device=ALL&locale=ALL&depth=all&sort=pv",
    writeMethod: "GET",
    writeHeaders: {
      "Idempotency-Key": "l-permission-behavior-probe",
      "X-Operation-Reason": encodeURIComponent(PROBE_REASON),
    },
    mutationButtons: /导出 CSV/,
  },
];

test.describe.serial("L 域 readonly/no-write/no-menu 五层权限", () => {
  for (const key of ["l_readonly", "l_no_write"] as const) {
    test(`${key}：L1-L6 菜单、路由和权威数据可读，按钮与接口写入拒绝`, async ({ page }) => {
      const pageErrors = monitorPageErrors(page);
      await login(page, fixture.accounts[key], key);
      await assertSession(page, true);
      await assertVisibleLMenus(page);
      for (const module of MODULES) {
        await openVisibleModule(page, module);
        await expect(page.getByText(module.marker).first(), `${key} ${module.id}`).toBeVisible({ timeout: 20_000 });
        const read = await browserApi(page, "GET", module.readPath);
        const write = await browserApi(
          page,
          module.writeMethod,
          module.writePath,
          module.writeBody,
          module.writeHeaders,
        );
        expect(read.status, `${key} ${module.id} read`).toBe(200);
        expect(read.hasData, `${key} ${module.id} authoritative data`).toBe(true);
        expect(write.status, `${key} ${module.id} write`).toBe(403);
        expect(await enabledMutationCount(page, module.mutationButtons), `${key} ${module.id} enabled writes`).toBe(0);
      }
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByText(MODULES.at(-1)!.marker).first()).toBeVisible();
      await logout(page);
      await login(page, fixture.accounts[key], key);
      await assertVisibleLMenus(page);
      expect((await browserApi(page, "GET", MODULES[0].readPath)).status).toBe(200);
      expect((await browserApi(
        page,
        MODULES[0].writeMethod,
        MODULES[0].writePath,
        MODULES[0].writeBody,
      )).status).toBe(403);
      expect(pageErrors).toEqual([]);
    });
  }

  test("l_no_menu：L 菜单、直接路由、读写接口均拒绝，刷新重登不从缓存恢复", async ({ page }) => {
    const pageErrors = monitorPageErrors(page);
    await login(page, fixture.accounts.l_no_menu, "l_no_menu");
    await assertSession(page, false);
    await expect(page.locator('a[href^="/analytics/"]')).toHaveCount(0);
    await page.goto(MODULES[0].path, { waitUntil: "domcontentloaded" });
    await expect(page).not.toHaveURL(/\/analytics\/kpi(?:\?.*)?$/);
    for (const module of MODULES) {
      expect((await browserApi(page, "GET", module.readPath)).status, `${module.id} read`).toBe(403);
      expect((await browserApi(
        page,
        module.writeMethod,
        module.writePath,
        module.writeBody,
        module.writeHeaders,
      )).status, `${module.id} write`).toBe(403);
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('a[href^="/analytics/"]')).toHaveCount(0);
    await logout(page);
    await login(page, fixture.accounts.l_no_menu, "l_no_menu");
    await expect(page.locator('a[href^="/analytics/"]')).toHaveCount(0);
    expect((await browserApi(page, "GET", MODULES[0].readPath)).status).toBe(403);
    expect(pageErrors).toEqual([]);
  });
});

async function login(page: Page, account: FixtureAccount, key: string) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 10_000 });
  await otp.fill(await freshTotp(key, account.totpSecret));
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function logout(page: Page) {
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  await expect(account).toBeVisible();
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

async function assertSession(page: Page, hasRead: boolean) {
  const response = await page.request.get("/api/admin/auth/session");
  expect(response.status()).toBe(200);
  const payload = await response.json() as {
    data?: { session?: { authorities?: string[]; effectiveMenus?: unknown[] } };
  };
  const authorities = payload.data?.session?.authorities ?? [];
  const menus = payload.data?.session?.effectiveMenus ?? [];
  for (let module = 1; module <= 6; module += 1) {
    if (hasRead) expect(authorities).toContain(`bi_l${module}_read`);
    else expect(authorities).not.toContain(`bi_l${module}_read`);
  }
  if (hasRead) {
    expect(authorities.some((permission) =>
      /^bi_l[1-6]_/.test(permission) && !permission.endsWith("_read"))).toBe(false);
    expect(menus.length).toBeGreaterThan(0);
  } else {
    expect(authorities).toEqual([]);
    expect(menus).toEqual([]);
  }
}

async function assertVisibleLMenus(page: Page) {
  const domain = CONSOLE_NAV.find((item) => item.code === "L");
  if (!domain) throw new Error("L domain missing");
  const group = page.getByRole("button", { name: /数据与分析 BI/ }).first();
  if (await group.getAttribute("aria-expanded") !== "true") await group.click();
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

async function browserApi(
  page: Page,
  method: ModuleProbe["writeMethod"],
  requestPath: string,
  body?: Record<string, unknown>,
  headers?: Record<string, string>,
) {
  return page.evaluate(async ({ requestMethod, apiPath, requestBody, requestHeaders, runId }) => {
    const defaultHeaders = requestMethod === "POST"
      ? {
          "Content-Type": "application/json",
          "Idempotency-Key": `l-permission-${runId}-${crypto.randomUUID()}`,
        }
      : undefined;
    const response = await fetch(apiPath, {
      method: requestMethod,
      credentials: "same-origin",
      headers: { ...defaultHeaders, ...requestHeaders },
      body: requestMethod === "POST" ? JSON.stringify(requestBody ?? {}) : undefined,
    });
    const payload = await response.json().catch(() => null) as { data?: unknown } | null;
    return { status: response.status, hasData: payload?.data !== undefined };
  }, {
    requestMethod: method,
    apiPath: requestPath,
    requestBody: body,
    requestHeaders: headers,
    runId: fixture.runId,
  });
}

async function enabledMutationCount(page: Page, name: RegExp) {
  return page.getByRole("button", { name }).evaluateAll((buttons) =>
    buttons.filter((button) => {
      const element = button as HTMLButtonElement;
      const style = window.getComputedStyle(element);
      return !element.disabled && style.visibility !== "hidden" && style.display !== "none";
    }).length);
}

function monitorPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
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
