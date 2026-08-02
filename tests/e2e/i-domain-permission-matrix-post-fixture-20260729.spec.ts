import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { expect, test, type Page, type TestInfo } from "@playwright/test";
import { CONSOLE_NAV } from "../../lib/nav/console-nav";

type FixtureAccount = { username: string; password: string; totpSecret: string };
type Role = "maker" | "readonly" | "nowrite" | "nomenu";
type PermissionFixture = { runId: string; accounts: Record<Role, FixtureAccount> };
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
const fixtureGeneratedAt = process.env.I_PERMISSION_FIXTURE_GENERATED_AT;
if (!fixtureGeneratedAt) throw new Error("I_PERMISSION_FIXTURE_GENERATED_AT is required");

const MODULES: ModuleProbe[] = [
  { id: "I1", path: "/content/copy-ab", readPath: "/api/admin/content/copy-ab/overview", writePath: "/api/admin/content/copy-ab/copies/acceptance-permission-probe/draft", writeMethod: "PATCH", writeBody: {}, forbiddenButtons: /新增位置|新增版本|新增文案|编辑文案|创建 A\/B 实验|启动实验|弃用实验|采纳获胜/ },
  { id: "I2", path: "/content/nova", readPath: "/api/admin/content/nova/overview", writePath: "/api/admin/content/nova/channels/acceptance-permission-probe/status", writeMethod: "PATCH", writeBody: { enabled: false, reason: "权限探针不得执行" }, forbiddenButtons: /新增通道|新模板|编辑全部概率|同步真实事件|保存概率|立即过期/ },
  { id: "I3", path: "/content/notifications", readPath: "/api/admin/content/campaigns/overview", writePath: "/api/admin/content/campaigns/acceptance-permission-probe/send-now", writeMethod: "POST", writeBody: { expectedRevision: -1, reason: "权限探针不得执行" }, forbiddenButtons: /新建 Campaign|调度下发|立即下发|调整/ },
  { id: "I4", path: "/content/trust", readPath: "/api/admin/content/trust-disclosure/overview", writePath: "/api/admin/content/trust-disclosure/trust-sections/acceptance-permission-probe/archive", writeMethod: "POST", writeBody: { expectedVersion: "never", expectedStatus: "never", reason: "权限探针不得执行" }, forbiddenButtons: /新建草稿|编辑草稿|删除草稿|发布草稿|恢复上线|回滚历史版|下架/ },
  { id: "I5", path: "/content/disclosures", readPath: "/api/admin/content/trust-disclosure/overview", writePath: "/api/admin/content/trust-disclosure/disclosures/acceptance-permission-probe/publish", writeMethod: "POST", writeBody: { reason: "权限探针不得执行" }, forbiddenButtons: /新增法域|新增映射|调整映射|新建版本|编辑版本|删除草稿|受限内 · 移出|已移出 · 纳入/ },
  { id: "I6", path: "/content/i18n", readPath: "/api/admin/content/i18n-learning/overview", writePath: "/api/admin/content/i18n-learning/messages/acceptance-permission-probe/publish", writeMethod: "POST", writeBody: { reason: "权限探针不得执行" }, forbiddenButtons: /重新扫描|新增词条|编辑词条|回滚到此版本|修复并复扫|新建课程/ },
];

test.describe.serial("I 域当前权限夹具全角色矩阵", () => {
  for (const role of ["maker", "readonly", "nowrite", "nomenu"] as const) {
    test(`${role}：I1-I6 侧栏、直链和 API 矩阵在刷新重登后保持权限边界`, async ({ page }, testInfo) => {
      const pageErrors = monitorPageErrors(page);
      await login(page, fixture.accounts[role]);

      if (role === "nomenu") {
        await verifyNoMenuMatrix(page, role);
      } else {
        await verifyVisibleMatrix(page, role);
      }

      await page.screenshot({ path: testInfo.outputPath(`${role}-i1-i6.png`), fullPage: true });
      await page.reload({ waitUntil: "domcontentloaded" });
      if (role === "nomenu") await expect(page.locator('a[href^="/content/"]')).toHaveCount(0);
      else await assertVisibleIMenus(page);
      await logout(page);
      await login(page, fixture.accounts[role]);
      if (role === "nomenu") await expect(page.locator('a[href^="/content/"]')).toHaveCount(0);
      else await assertVisibleIMenus(page);
      expect(pageErrors, `${role} 不得发生 pageerror`).toEqual([]);
      await writeEvidence(testInfo, role);
    });
  }
});

async function verifyVisibleMatrix(page: Page, role: Exclude<Role, "nomenu">) {
  await assertVisibleIMenus(page);
  for (const module of MODULES) {
    await openVisibleModule(page, module);
    await assertReadableModule(page, module);
    const read = await browserApi(page, "GET", module.readPath);
    expect(read.status, `${role}/${module.id} 读取接口`).toBe(200);
    expect(read.hasData, `${role}/${module.id} 读取接口必须返回权威 data`).toBe(true);

    await page.goto(module.path, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(new RegExp(`${escapeRegExp(module.path)}(?:\\?.*)?$`));
    await assertReadableModule(page, module);
    if (role !== "maker") {
      await expect(page.locator(".idom").getByRole("button", { name: module.forbiddenButtons })).toHaveCount(0);
      const write = await browserApi(page, module.writeMethod, module.writePath, module.writeBody);
      expect(write.status, `${role}/${module.id} 写接口必须被拒绝`).toBe(403);
    }
  }
}

async function verifyNoMenuMatrix(page: Page, role: "nomenu") {
  await expect(page.locator('a[href^="/content/"]')).toHaveCount(0);
  for (const module of MODULES) {
    await page.goto(module.path, { waitUntil: "domcontentloaded" });
    await expect(page, `${role}/${module.id} 直链不能进入`).not.toHaveURL(new RegExp(`${escapeRegExp(module.path)}(?:\\?.*)?$`));
    await expect(page.locator(".idom")).toHaveCount(0);
    const read = await browserApi(page, "GET", module.readPath);
    expect(read.status, `${role}/${module.id} 无菜单读取接口必须拒绝`).toBe(403);
    const write = await browserApi(page, module.writeMethod, module.writePath, module.writeBody);
    expect(write.status, `${role}/${module.id} 写接口必须被拒绝`).toBe(403);
  }
}

async function login(page: Page, account: FixtureAccount) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  const loginPending = page.waitForResponse((response) =>
    response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/login");
  await page.getByRole("button", { name: /继续|登录/ }).click();
  expect((await loginPending).status(), "密码登录必须由真实 BFF 确认").toBe(200);
  const otp = page.getByLabel("一次性验证码");
  const shell = page.locator("aside");
  await Promise.race([otp.waitFor({ state: "visible", timeout: 10_000 }), shell.waitFor({ state: "visible", timeout: 10_000 })]);
  if (await otp.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await otp.fill(await freshTotp(account.totpSecret));
    const verifyPending = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    expect((await verifyPending).status(), "MFA 必须由真实 BFF 确认").toBe(200);
  }
  await expect(shell).toBeVisible({ timeout: 20_000 });
  const session = await browserApi(page, "GET", "/api/admin/auth/session");
  expect(session.status, "登录 UI 已挂载后会话必须可用").toBe(200);
}

async function logout(page: Page) {
  const direct = page.getByRole("button", { name: /^(退出登录|登出)$/ }).first();
  if (await direct.isVisible({ timeout: 2_000 }).catch(() => false)) await direct.click();
  else {
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
  if (await group.isVisible({ timeout: 3_000 }).catch(() => false)) {
    if ((await group.getAttribute("aria-expanded")) !== "true") await group.click();
    // After a full reload the persisted expanded marker can briefly say true
    // while its lazily rendered child links are absent. Reconcile that visual
    // state through the same visible group control a user has, never a URL or
    // DOM authority shortcut.
    if (!await page.locator('a[href="/content/copy-ab"]').first().isVisible().catch(() => false)) {
      await group.click();
      await page.waitForTimeout(150);
      await group.click();
      await page.waitForTimeout(150);
    }
  }
  for (const module of domain.l2) await expect(page.locator(`a[href="${module.path}"]`).first(), `${module.id} 菜单必须可见`).toBeVisible();
}

async function openVisibleModule(page: Page, module: ModuleProbe) {
  // Route navigation collapses the sidebar group; reopen it before each next
  // human-visible menu selection rather than treating the UI preference as a
  // missing menu grant.
  await assertVisibleIMenus(page);
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

async function browserApi(page: Page, method: "GET" | "PATCH" | "POST", path: string, body?: Record<string, unknown>) {
  return page.evaluate(async ({ method: requestMethod, path: requestPath, body: requestBody, runId }) => {
    const response = await fetch(requestPath, {
      method: requestMethod,
      credentials: "same-origin",
      headers: requestMethod === "GET" ? undefined : { "Content-Type": "application/json", "Idempotency-Key": `i-permission-${runId}-${crypto.randomUUID()}` },
      body: requestMethod === "GET" ? undefined : JSON.stringify(requestBody ?? {}),
    });
    const payload = await response.json().catch(() => null) as { data?: unknown } | null;
    return { status: response.status, hasData: payload?.data !== undefined };
  }, { method, path, body, runId: fixture.runId });
}

async function writeEvidence(testInfo: TestInfo, role: Role) {
  await writeFile(testInfo.outputPath(`${role}-matrix.json`), JSON.stringify({
    runId: fixture.runId,
    fixturePath,
    fixtureGeneratedAt,
    role,
    modules: MODULES.map(({ id, path, readPath }) => ({ id, path, readPath })),
    checkedAt: new Date().toISOString(),
    writes: role === "maker" ? "none attempted" : "all six attempted writes were required to be 403",
  }, null, 2));
}

function monitorPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

const usedTotpSteps = new Map<string, number>();
async function freshTotp(secret: string) {
  const secretKey = createHash("sha256").update(secret).digest("hex");
  let step = Math.floor(Date.now() / 30_000);
  const remaining = 30_000 - Date.now() % 30_000;
  if (step <= (usedTotpSteps.get(secretKey) ?? -1) || remaining < 4_000) {
    await expect.poll(() => Math.floor(Date.now() / 30_000), { timeout: 35_000 }).toBeGreaterThan(step);
    step = Math.floor(Date.now() / 30_000);
  }
  step = Math.floor(Date.now() / 30_000);
  usedTotpSteps.set(secretKey, step);
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
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff);
  return String(binary % 1_000_000).padStart(6, "0");
}

function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
