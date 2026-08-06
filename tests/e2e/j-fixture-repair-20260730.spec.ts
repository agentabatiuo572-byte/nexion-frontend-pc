import { expect, test, type APIResponse, type Page, type Response } from "@playwright/test";
import { createHash, createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type Account = { username: string; password: string; totpSecret: string };
type Fixture = { accounts: { maker: Account }; checker: Account };
type Envelope<T = unknown> = { code?: number; message?: string; data?: T };
type RoleDetail = {
  id: number;
  roleCode: string;
  permissionCodes: string[];
  menuIds: number[];
};
type SessionData = {
  session?: {
    roleCode?: string;
    authorities?: string[];
    effectiveMenus?: Array<string | { code?: string }>;
  };
};
type RepairState = {
  runId: string;
  roleId: number;
  roleCode: string;
  targetPermission: string;
  beforePermissionCodes: string[];
  beforeMenuIds: number[];
  rejectedOperationId: string;
  grantOperationId: string;
  grantedAt: string;
  restored?: boolean;
  restoreOperationId?: string;
  restoredAt?: string;
};

const RUN_ID = process.env.J_CHILD_RUN_ID ?? "pc-full-acceptance-20260729-114336-J-D-child";
const MODE = process.env.J_FIXTURE_REPAIR_MODE ?? "";
const TARGET_PERMISSION = "emergency_j4_playbook_execute";
const TARGET_ROLE_CODE = "ACC_CHECKER_114336";
const PENDING_OPERATION_ID = process.env.J_FIXTURE_PENDING_OPERATION_ID ?? "";
const FIXTURE_PATH = required("J_A_FIXTURE_PATH");
const STATE_PATH = required("J_FIXTURE_REPAIR_STATE_PATH");
const EVIDENCE_DIR = required("J_FIXTURE_REPAIR_EVIDENCE_DIR");
const REPAIR_TOKEN = process.env.J_FIXTURE_REPAIR_TOKEN ?? "";
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as Fixture;

test.describe.configure({ mode: "serial", timeout: 240_000 });
test.beforeAll(() => {
  expect(REPAIR_TOKEN, "root-issued J fixture repair token is required in process memory").not.toBe("");
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("close failed J4 ticket and add the checker business permission through visible A6/A2", async ({ browser }) => {
  test.skip(MODE !== "grant", "grant phase only");
  expect(PENDING_OPERATION_ID).toMatch(/^(?:WO|OP)-/);
  expect(fixture.accounts.maker.username).not.toBe(fixture.checker.username);

  const makerContext = await browser.newContext();
  const checkerContext = await browser.newContext();
  const maker = await makerContext.newPage();
  const checker = await checkerContext.newPage();
  try {
    await loginMfa(checker, fixture.checker, "j-fixture-checker-reject");
    await rejectThroughVisibleA2(
      checker,
      PENDING_OPERATION_ID,
      `${RUN_ID} reject the failed J4 fixture ticket before exact checker grant repair`,
    );
    await checker.screenshot({ path: path.join(EVIDENCE_DIR, "01-old-j4-ticket-rejected.png"), fullPage: true });
    await logoutIfAuthenticated(checker);

    await loginMfa(maker, fixture.accounts.maker, "j-fixture-a-maker");
    const makerSession = await session(maker);
    expect(makerSession.authorities).toEqual(expect.arrayContaining([
      "platform_a6_read",
      "platform_a6_role_grants_update",
      "platform_a2_proposal_create",
    ]));
    await navigatePlatform(maker, "角色管理 A6", /\/platform\/roles$/);
    const beforeDetail = await openRole(maker, TARGET_ROLE_CODE);
    expect(beforeDetail.permissionCodes).not.toContain(TARGET_PERMISSION);

    await maker.getByRole("button", { name: "编辑授权（权限/菜单）", exact: true }).click();
    const drawer = maker.getByRole("dialog")
      .filter({ has: maker.getByRole("button", { name: "保存授权（需确认）", exact: true }) });
    await expect(drawer).toBeVisible();
    await drawer.getByLabel("权限搜索").fill(TARGET_PERMISSION);
    const checkbox = drawer.locator(`label[title="${TARGET_PERMISSION}"] input[type="checkbox"]`);
    await expect(checkbox).toHaveCount(1);
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await drawer.getByRole("button", { name: "保存授权（需确认）", exact: true }).click();
    const responsePromise = maker.waitForResponse((candidate) =>
      candidate.request().method() === "PUT"
      && candidate.url().endsWith(`/api/admin/platform/roles/${beforeDetail.id}/grants`));
    await confirmDialog(maker, `${RUN_ID} add only ${TARGET_PERMISSION} to the independent J4 checker`);
    const proposal = await success<{ id?: string; operationId?: string }>(
      await responsePromise,
      "visible A6 checker grant proposal",
    );
    const grantOperationId = String(proposal.id ?? proposal.operationId ?? "");
    expect(grantOperationId).toMatch(/^(?:WO|OP)-/);
    const submitted = responsePromise.then(() => undefined);
    await submitted;
    await maker.screenshot({ path: path.join(EVIDENCE_DIR, "02-exact-grant-pending.png"), fullPage: true });

    await loginMfa(checker, fixture.checker, "j-fixture-checker-approve");
    const checkerBefore = await session(checker);
    expect(checkerBefore.authorities).toEqual(expect.arrayContaining([
      "platform_a2_read",
      "platform_a2_operation_approve",
      "platform_a6_role_grants_update",
    ]));
    expect(checkerBefore.authorities).not.toContain(TARGET_PERMISSION);
    await approveThroughVisibleA2(
      checker,
      grantOperationId,
      `${RUN_ID} independently approve the exact J4 checker business permission`,
    );

    await checkerContext.clearCookies();
    await loginMfa(checker, fixture.checker, "j-fixture-checker-relogin");
    const checkerAfter = await session(checker);
    expect(checkerAfter.roleCode).toBe(TARGET_ROLE_CODE);
    expect(checkerAfter.authorities).toContain(TARGET_PERMISSION);
    expect([...checkerAfter.authorities].sort()).toEqual(
      [...checkerBefore.authorities, TARGET_PERMISSION].sort(),
    );
    await openJ4FromVisibleSidebar(checker);
    await checker.screenshot({ path: path.join(EVIDENCE_DIR, "03-checker-relogin-j4-visible.png"), fullPage: true });

    const state: RepairState = {
      runId: RUN_ID,
      roleId: beforeDetail.id,
      roleCode: beforeDetail.roleCode,
      targetPermission: TARGET_PERMISSION,
      beforePermissionCodes: [...beforeDetail.permissionCodes].sort(),
      beforeMenuIds: [...beforeDetail.menuIds].sort((a, b) => a - b),
      rejectedOperationId: PENDING_OPERATION_ID,
      grantOperationId,
      grantedAt: new Date().toISOString(),
      restored: false,
    };
    writeFileSync(STATE_PATH, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    writeFileSync(path.join(EVIDENCE_DIR, "grant-summary.json"), `${JSON.stringify({
      runId: RUN_ID,
      roleId: state.roleId,
      roleCode: state.roleCode,
      rejectedOperationId: state.rejectedOperationId,
      grantOperationId,
      exactAddedPermission: TARGET_PERMISSION,
      beforePermissionHash: hash(state.beforePermissionCodes),
      afterPermissionHash: hash(checkerAfter.authorities),
      forcedReloginVerified: true,
      tokenPersisted: false,
      sqlPermissionMutation: false,
    }, null, 2)}\n`, "utf8");
  } finally {
    await makerContext.close();
    await checkerContext.close();
  }
});

test("remove the temporary checker permission through visible A6/A2 and verify exact restoration", async ({ browser }) => {
  test.skip(MODE !== "restore", "restore phase only");
  const before = JSON.parse(readFileSync(STATE_PATH, "utf8")) as RepairState;
  expect(before.runId).toBe(RUN_ID);
  expect(before.restored).toBe(false);

  const makerContext = await browser.newContext();
  const checkerContext = await browser.newContext();
  const maker = await makerContext.newPage();
  const checker = await checkerContext.newPage();
  try {
    await loginMfa(maker, fixture.accounts.maker, "j-fixture-a-maker-restore");
    await navigatePlatform(maker, "角色管理 A6", /\/platform\/roles$/);
    const current = await openRole(maker, before.roleCode);
    expect(current.id).toBe(before.roleId);
    expect(current.permissionCodes).toContain(TARGET_PERMISSION);
    expect(current.permissionCodes.filter((code) => code !== TARGET_PERMISSION).sort())
      .toEqual(before.beforePermissionCodes);
    expect([...current.menuIds].sort((a, b) => a - b)).toEqual(before.beforeMenuIds);

    await maker.getByRole("button", { name: "编辑授权（权限/菜单）", exact: true }).click();
    const drawer = maker.getByRole("dialog")
      .filter({ has: maker.getByRole("button", { name: "保存授权（需确认）", exact: true }) });
    await drawer.getByLabel("权限搜索").fill(TARGET_PERMISSION);
    const checkbox = drawer.locator(`label[title="${TARGET_PERMISSION}"] input[type="checkbox"]`);
    await expect(checkbox).toBeChecked();
    await checkbox.uncheck();
    await drawer.getByRole("button", { name: "保存授权（需确认）", exact: true }).click();
    const responsePromise = maker.waitForResponse((candidate) =>
      candidate.request().method() === "PUT"
      && candidate.url().endsWith(`/api/admin/platform/roles/${before.roleId}/grants`));
    await confirmDialog(maker, `${RUN_ID} remove only the temporary J4 checker business permission`);
    const proposal = await success<{ id?: string; operationId?: string }>(
      await responsePromise,
      "visible A6 checker grant restore proposal",
    );
    const restoreOperationId = String(proposal.id ?? proposal.operationId ?? "");
    expect(restoreOperationId).toMatch(/^(?:WO|OP)-/);

    await loginMfa(checker, fixture.checker, "j-fixture-checker-restore-approve");
    await approveThroughVisibleA2(
      checker,
      restoreOperationId,
      `${RUN_ID} independently approve exact restoration of the J checker role`,
    );
    await checkerContext.clearCookies();
    await loginMfa(checker, fixture.checker, "j-fixture-checker-restored-relogin");
    const restoredSession = await session(checker);
    expect(restoredSession.authorities).not.toContain(TARGET_PERMISSION);

    await maker.reload({ waitUntil: "domcontentloaded" });
    const restoredDetail = await openRole(maker, before.roleCode);
    expect([...restoredDetail.permissionCodes].sort()).toEqual(before.beforePermissionCodes);
    expect([...restoredDetail.menuIds].sort((a, b) => a - b)).toEqual(before.beforeMenuIds);
    await maker.screenshot({ path: path.join(EVIDENCE_DIR, "04-exact-role-restored.png"), fullPage: true });

    const restored: RepairState = {
      ...before,
      restored: true,
      restoreOperationId,
      restoredAt: new Date().toISOString(),
    };
    writeFileSync(STATE_PATH, `${JSON.stringify(restored, null, 2)}\n`, "utf8");
    writeFileSync(path.join(EVIDENCE_DIR, "restore-summary.json"), `${JSON.stringify({
      runId: RUN_ID,
      roleId: before.roleId,
      roleCode: before.roleCode,
      restoreOperationId,
      exactRemovedPermission: TARGET_PERMISSION,
      restoredPermissionHash: hash(restoredDetail.permissionCodes),
      expectedPermissionHash: hash(before.beforePermissionCodes),
      restoredMenuHash: hash(restoredDetail.menuIds),
      expectedMenuHash: hash(before.beforeMenuIds),
      forcedReloginVerified: true,
      tokenPersisted: false,
      sqlPermissionMutation: false,
    }, null, 2)}\n`, "utf8");
  } finally {
    await makerContext.close();
    await checkerContext.close();
  }
});

async function loginMfa(page: Page, account: Account, key: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.context().clearCookies();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const shell = page.locator("aside").first();
    if (await shell.isVisible({ timeout: 2_000 }).catch(() => false)) return;
    await page.locator('input[autocomplete="username"]').fill(account.username);
    await page.locator('input[autocomplete="current-password"]').fill(account.password);
    await page.getByRole("button", { name: /继续|登录/ }).click();
    const otp = page.getByLabel("一次性验证码");
    await shell.or(otp).first().waitFor({ state: "visible", timeout: 30_000 });
    if (await shell.isVisible().catch(() => false)) return;
    await otp.fill(await freshTotp(key, account.totpSecret));
    const verification = page.waitForResponse((candidate) =>
      candidate.request().method() === "POST"
      && new URL(candidate.url()).pathname === "/api/admin/auth/mfa/verify");
    await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    const response = await verification;
    const payload = await response.json().catch(() => null) as Envelope | null;
    const hasCookie = (await page.context().cookies()).some((cookie) => cookie.name === "nexion_admin_token");
    if (response.status() === 200 && (payload?.code === 0 || hasCookie)) {
      await page.goto("/", { waitUntil: "domcontentloaded" });
      expect((await page.request.get("/api/admin/auth/session")).status()).toBe(200);
      await expect(shell).toBeVisible({ timeout: 30_000 });
      return;
    }
    if (attempt < 2 && ["ADMIN_MFA_CODE_REPLAYED", "ADMIN_MFA_CODE_INVALID"].includes(payload?.message ?? "")) {
      await page.waitForTimeout(30_000 - (Date.now() % 30_000) + 500);
      continue;
    }
    throw new Error(`${key} MFA failed: HTTP ${response.status()} ${payload?.message ?? "unknown"}`);
  }
  throw new Error(`${key} login failed`);
}

async function logoutIfAuthenticated(page: Page) {
  if (!(await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false))) return;
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
}

async function session(page: Page) {
  const data = await success<SessionData>(await page.request.get("/api/admin/auth/session"), "current session");
  return {
    roleCode: data.session?.roleCode ?? "",
    authorities: data.session?.authorities ?? [],
    menuCodes: (data.session?.effectiveMenus ?? []).map((item) =>
      typeof item === "string" ? item : item.code ?? ""),
  };
}

async function navigatePlatform(page: Page, linkName: string, url: RegExp) {
  const sidebar = page.locator("aside");
  const platformButton = sidebar.getByRole("button", { name: /平台基础.*A|A.*平台基础/ }).first();
  const link = sidebar.getByRole("link", { name: linkName, exact: true }).first();
  if (!(await link.isVisible().catch(() => false))) {
    await platformButton.click();
    await expect(link).toBeVisible();
  }
  await link.click();
  await expect(page).toHaveURL(url);
}

async function openRole(page: Page, roleCode: string) {
  const roleCodeCell = page.getByText(roleCode, { exact: true }).first();
  await expect(roleCodeCell).toBeVisible({ timeout: 30_000 });
  const responsePromise = page.waitForResponse((candidate) =>
    candidate.request().method() === "GET"
    && /\/api\/admin\/platform\/roles\/\d+$/.test(new URL(candidate.url()).pathname));
  await roleCodeCell.click();
  return await success<RoleDetail>(await responsePromise, `visible A6 role ${roleCode}`);
}

async function confirmDialog(page: Page, reason: string) {
  const dialog = page.getByRole("dialog").filter({ has: page.getByLabel(/操作理由/) });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(/操作理由/).fill(reason);
  await dialog.getByRole("button", { name: "确认提交", exact: true }).click();
}

async function approveThroughVisibleA2(page: Page, operationId: string, reason: string) {
  await navigatePlatform(page, "审计 & 操作确认 A2", /\/platform\/audit$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  const row = page.locator("tbody tr").filter({ hasText: operationId }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole("button", { name: "执行", exact: true }).click();
  const responsePromise = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST"
    && new URL(candidate.url()).pathname.endsWith(`/operations/${operationId}/approve`));
  await confirmDialog(page, reason);
  await success(await responsePromise, `visible A2 approve ${operationId}`);
}

async function rejectThroughVisibleA2(page: Page, operationId: string, reason: string) {
  await navigatePlatform(page, "审计 & 操作确认 A2", /\/platform\/audit$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  const row = page.locator("tbody tr").filter({ hasText: operationId }).first();
  await expect(row).toBeVisible({ timeout: 30_000 });
  await row.getByRole("button", { name: "取消", exact: true }).click();
  const responsePromise = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST"
    && new URL(candidate.url()).pathname.endsWith(`/operations/${operationId}/reject`));
  await confirmDialog(page, reason);
  await success(await responsePromise, `visible A2 reject ${operationId}`);
}

async function openJ4FromVisibleSidebar(page: Page) {
  const sidebar = page.locator("aside");
  const group = sidebar.getByRole("button", { name: /紧急与合规控制.*J|J.*紧急与合规控制/ }).first();
  const link = sidebar.locator('a[href="/emergency/sop"]').first();
  if (!(await link.isVisible().catch(() => false))) await group.click();
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/emergency\/sop$/);
  await expect(page.getByText(/实战先进入 A2 双人复核/)).toBeVisible();
}

async function success<T>(response: APIResponse | Response, label: string) {
  const payload = await response.json() as Envelope<T>;
  expect(response.status(), `${label}: ${JSON.stringify(payload)}`).toBe(200);
  expect(payload.code, `${label}: ${JSON.stringify(payload)}`).toBe(0);
  return payload.data as T;
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function hash(values: Array<string | number>) {
  return createHash("sha256").update(JSON.stringify([...values].sort())).digest("hex").toUpperCase();
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
