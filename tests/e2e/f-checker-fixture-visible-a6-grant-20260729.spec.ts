import { createHash, createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type APIResponse, type Page, type Response } from "@playwright/test";

type Account = { username: string; password: string; totpSecret: string };
type Envelope<T = unknown> = { code?: number; message?: string; data?: T };
type SessionData = {
  session?: {
    roleCode?: string;
    authorities?: string[];
    effectiveMenus?: Array<string | { code?: string }>;
  };
};
type RoleDetail = {
  id: number;
  roleCode: string;
  roleName: string;
  permissionCodes: string[];
  menuIds: number[];
};
type Ticket = { id?: string; operationId?: string; status?: string };

const RUN_ID = process.env.F_FIXTURE_RUN_ID ?? "pc-full-acceptance-20260729-114336";
const ROLE_CODE = process.env.F_CHECKER_ROLE_CODE ?? "ACC_CHECKER_114336";
const TARGET_PERMISSION = "network_f1_write";
const FIXTURE_PATH = process.env.F_CHECKER_FIXTURE_PATH
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/A/domain-permission-fixtures/A.json`;
const EVIDENCE_DIR = process.env.F_FIXTURE_EVIDENCE_DIR
  ?? `D:/workspace/bug-pic/.restricted/${RUN_ID}/F/final-ODaNTve/fixture-lock-checker-f1-write`;
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
  checker?: Account;
  accounts?: { maker?: Account };
};
const makerAccount = fixture.accounts?.maker;
const checkerAccount = fixture.checker;

test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  expect(process.env.F_FIXTURE_GRANT, "F_FIXTURE_GRANT=1 is required for the authorized fixture mutation").toBe("1");
  expect(makerAccount, "A-domain maker fixture is required").toBeTruthy();
  expect(checkerAccount, "RunID checker fixture is required").toBeTruthy();
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("visible A6/A2 grants only network_f1_write to the RunID checker role", async ({ browser }) => {
  test.setTimeout(240_000);
  const makerContext = await browser.newContext();
  const checkerContext = await browser.newContext();
  const superContext = await browser.newContext();
  const maker = await makerContext.newPage();
  const checker = await checkerContext.newPage();
  const superadmin = await superContext.newPage();
  const evidence: Record<string, unknown> = {
    runId: RUN_ID,
    roleCode: ROLE_CODE,
    targetPermission: TARGET_PERMISSION,
    mutationCarrier: "visible A6 drawer -> visible confirmation -> visible superadmin A2 decision",
    productBusinessWrites: 0,
  };
  const pageErrors: Record<string, string[]> = { maker: [], checker: [], superadmin: [] };
  maker.on("pageerror", (error) => pageErrors.maker.push(error.message));
  checker.on("pageerror", (error) => pageErrors.checker.push(error.message));
  superadmin.on("pageerror", (error) => pageErrors.superadmin.push(error.message));

  let operationId = "";
  let grantApproved = false;
  try {
    await loginMfa(maker, makerAccount!, "a-maker");
    await loginMfa(checker, checkerAccount!, "run-checker");
    await loginSuperadmin(superadmin);

    const makerSession = await session(maker);
    const checkerBefore = await session(checker);
    expect(makerSession.authorities).toEqual(expect.arrayContaining([
      "platform_a6_read",
      "platform_a6_role_grants_update",
      "platform_a2_proposal_create",
    ]));
    expect(checkerBefore.roleCode).toBe(ROLE_CODE);
    expect(checkerBefore.authorities).toEqual(expect.arrayContaining([
      "platform_a2_read",
      "platform_a2_operation_approve",
    ]));
    expect(checkerBefore.authorities).not.toContain(TARGET_PERMISSION);

    await navigatePlatform(maker, "角色管理 A6", /\/platform\/roles$/);
    const roleCodeCell = maker.getByText(ROLE_CODE, { exact: true }).first();
    await expect(roleCodeCell).toBeVisible();
    const beforeDetailResponse = maker.waitForResponse((candidate) =>
      candidate.request().method() === "GET"
      && /\/api\/admin\/platform\/roles\/\d+$/.test(new URL(candidate.url()).pathname));
    await roleCodeCell.click();
    const beforeDetail = await success<RoleDetail>(await beforeDetailResponse, "visible A6 role detail before");
    expect(beforeDetail.roleCode).toBe(ROLE_CODE);
    expect(beforeDetail.permissionCodes).toEqual(expect.arrayContaining([
      "platform_a2_read",
      "platform_a2_operation_approve",
    ]));
    expect(beforeDetail.permissionCodes).not.toContain(TARGET_PERMISSION);

    await expect(maker.getByRole("button", { name: "编辑授权（权限/菜单）", exact: true })).toBeEnabled();
    await maker.getByRole("button", { name: "编辑授权（权限/菜单）", exact: true }).click();
    const grantDrawer = maker.getByRole("dialog")
      .filter({ has: maker.getByRole("button", { name: "保存授权（需确认）", exact: true }) });
    await expect(grantDrawer).toBeVisible();
    await grantDrawer.getByLabel("权限搜索").fill(TARGET_PERMISSION);
    const targetCheckbox = grantDrawer.locator(`label[title="${TARGET_PERMISSION}"] input[type="checkbox"]`);
    await expect(targetCheckbox).toHaveCount(1);
    await expect(targetCheckbox).not.toBeChecked();
    await maker.screenshot({ path: path.join(EVIDENCE_DIR, "01-visible-a6-before.png"), fullPage: true });
    await targetCheckbox.check();
    await expect(targetCheckbox).toBeChecked();
    await grantDrawer.getByRole("button", { name: "保存授权（需确认）", exact: true }).click();

    const reason = `${RUN_ID} F checker 最小增加 F1 写权限并保留原授权`;
    const grantResponsePromise = maker.waitForResponse((candidate) =>
      candidate.request().method() === "PUT"
      && candidate.url().endsWith(`/api/admin/platform/roles/${beforeDetail.id}/grants`));
    await confirmDialog(maker, reason);
    const grantResponse = await grantResponsePromise;
    const proposal = await success<Ticket>(grantResponse, "visible A6 role-grant proposal");
    operationId = String(proposal.id ?? proposal.operationId ?? "");
    expect(operationId).toMatch(/^(?:WO|OP)-/);
    const requestBody = grantResponse.request().postDataJSON() as {
      permissionCodes?: string[];
      menuIds?: number[];
    };
    const expectedPermissions = [...beforeDetail.permissionCodes, TARGET_PERMISSION].sort();
    expect([...(requestBody.permissionCodes ?? [])].sort()).toEqual(expectedPermissions);
    expect([...(requestBody.menuIds ?? [])].sort((a, b) => a - b))
      .toEqual([...beforeDetail.menuIds].sort((a, b) => a - b));
    await maker.screenshot({ path: path.join(EVIDENCE_DIR, "02-visible-a6-pending.png"), fullPage: true });

    const makerSelfApprove = await maker.request.post(
      `/api/admin/platform/audit/operations/${encodeURIComponent(operationId)}/approve`,
      {
        headers: { "Idempotency-Key": `${RUN_ID}-f-fixture-maker-self-approve` },
        data: { reason: `${RUN_ID} A6 proposal maker 不得自批` },
      },
    );
    const makerSelfApproveBody = await body(makerSelfApprove);
    expect(makerSelfApprove.status() === 403 || makerSelfApproveBody.code === 403).toBe(true);

    const checkerCrossDomain = await checker.request.post(
      `/api/admin/platform/audit/operations/${encodeURIComponent(operationId)}/approve`,
      {
        headers: { "Idempotency-Key": `${RUN_ID}-f-fixture-checker-cross-domain` },
        data: { reason: `${RUN_ID} F checker 不得批准 A6 跨域授权` },
      },
    );
    const checkerCrossDomainBody = await body(checkerCrossDomain);
    expect(checkerCrossDomainBody.code).toBe(403);

    const unknownOperationId = "WO-000000000000000-404";
    const checkerUnknown = await checker.request.post(
      `/api/admin/platform/audit/operations/${unknownOperationId}/approve`,
      {
        headers: { "Idempotency-Key": `${RUN_ID}-f-fixture-checker-unknown-id` },
        data: { reason: `${RUN_ID} F checker 未知 operationId 必须失败关闭` },
      },
    );
    const checkerUnknownBody = await body(checkerUnknown);
    expect(checkerUnknownBody.code).toBe(422);
    expect(checkerUnknownBody.message).toBe("A2_OPERATION_NOT_FOUND");

    const logoutResponse = await logoutThroughUi(checker);
    expect(logoutResponse.status()).toBe(200);
    const oldSessionProbe = await checker.request.get("/api/admin/auth/session");
    expect(oldSessionProbe.status()).toBe(401);

    await approveThroughVisibleA2(
      superadmin,
      operationId,
      `${RUN_ID} superadmin 核对 F checker 最小授权差量后批准`,
    );
    grantApproved = true;
    await superadmin.screenshot({ path: path.join(EVIDENCE_DIR, "03-visible-a2-approved.png"), fullPage: true });

    await maker.reload({ waitUntil: "domcontentloaded" });
    await expect(maker).toHaveURL(/\/platform\/roles$/);
    const afterRoleCell = maker.getByText(ROLE_CODE, { exact: true }).first();
    await expect(afterRoleCell).toBeVisible();
    const afterDetailResponse = maker.waitForResponse((candidate) =>
      candidate.request().method() === "GET"
      && candidate.url().endsWith(`/api/admin/platform/roles/${beforeDetail.id}`));
    await afterRoleCell.click();
    const afterDetail = await success<RoleDetail>(await afterDetailResponse, "visible A6 role detail after");
    expect([...afterDetail.permissionCodes].sort()).toEqual(expectedPermissions);
    expect([...afterDetail.menuIds].sort((a, b) => a - b))
      .toEqual([...beforeDetail.menuIds].sort((a, b) => a - b));

    await maker.getByRole("button", { name: "编辑授权（权限/菜单）", exact: true }).click();
    const afterDrawer = maker.getByRole("dialog")
      .filter({ has: maker.getByRole("button", { name: "保存授权（需确认）", exact: true }) });
    await afterDrawer.getByLabel("权限搜索").fill(TARGET_PERMISSION);
    await expect(afterDrawer.locator(`label[title="${TARGET_PERMISSION}"] input[type="checkbox"]`)).toBeChecked();
    await maker.screenshot({ path: path.join(EVIDENCE_DIR, "04-visible-a6-after.png"), fullPage: true });
    await afterDrawer.getByRole("button", { name: "关闭", exact: true }).click();

    await loginMfa(checker, checkerAccount!, "run-checker-relogin");
    const checkerAfterRelogin = await session(checker);
    const expectedSessionAuthorities = [...checkerBefore.authorities, TARGET_PERMISSION].sort();
    expect(checkerAfterRelogin.roleCode).toBe(ROLE_CODE);
    expect([...checkerAfterRelogin.authorities].sort()).toEqual(expectedSessionAuthorities);
    expect(checkerAfterRelogin.authorities.filter((code) => code.startsWith("network_f")))
      .toEqual([...checkerBefore.authorities.filter((code) => code.startsWith("network_f")), TARGET_PERMISSION]);
    expect(checkerAfterRelogin.authorities).toEqual(expect.arrayContaining([
      "platform_a2_read",
      "platform_a2_operation_approve",
    ]));

    await checker.reload({ waitUntil: "domcontentloaded" });
    const checkerAfterRefresh = await session(checker);
    expect([...checkerAfterRefresh.authorities].sort()).toEqual(expectedSessionAuthorities);
    await navigatePlatform(checker, "审计 & 操作确认 A2", /\/platform\/audit$/);
    await expect(checker.getByRole("heading", { name: "审计 & 操作确认" })).toBeVisible();
    await checker.screenshot({ path: path.join(EVIDENCE_DIR, "05-checker-refresh-relogin.png"), fullPage: true });

    evidence.roleId = beforeDetail.id;
    evidence.operationId = operationId;
    evidence.before = permissionEvidence(beforeDetail.permissionCodes, beforeDetail.menuIds);
    evidence.submitted = {
      permissionCodesExact: requestBody.permissionCodes,
      menuIdsExact: requestBody.menuIds,
      onlyPermissionAdded: TARGET_PERMISSION,
    };
    evidence.negative = {
      makerSelfApprove: responseEvidence(makerSelfApprove, makerSelfApproveBody),
      checkerCrossDomain: responseEvidence(checkerCrossDomain, checkerCrossDomainBody),
      checkerUnknownId: responseEvidence(checkerUnknown, checkerUnknownBody),
    };
    evidence.oldSession = { uiLogoutHttp: logoutResponse.status(), sessionAfterLogoutHttp: oldSessionProbe.status() };
    evidence.after = permissionEvidence(afterDetail.permissionCodes, afterDetail.menuIds);
    evidence.checkerSession = {
      roleCode: checkerAfterRelogin.roleCode,
      authoritiesExact: checkerAfterRelogin.authorities,
      authoritiesHash: digest(checkerAfterRelogin.authorities),
      refreshStable: digest(checkerAfterRefresh.authorities) === digest(checkerAfterRelogin.authorities),
      a2ReadPreserved: checkerAfterRelogin.authorities.includes("platform_a2_read"),
      a2ApprovePreserved: checkerAfterRelogin.authorities.includes("platform_a2_operation_approve"),
      fAuthoritiesExact: checkerAfterRelogin.authorities.filter((code) => code.startsWith("network_f")),
    };
    evidence.deferredUntilSharedJarRestart = [
      "same-domain F operation list visibility",
      "operation-detail decision-scope positive",
      "all F business approvals",
    ];
    evidence.pageErrors = pageErrors;
    evidence.status = "passed";
    writeFileSync(path.join(EVIDENCE_DIR, "fixture-grant-evidence.json"), JSON.stringify(evidence, null, 2));
  } finally {
    if (operationId && !grantApproved) {
      await rejectPendingThroughVisibleA2(superadmin, operationId)
        .catch((error) => {
          evidence.emergencyCleanup = error instanceof Error ? error.message : String(error);
        });
    }
    if (evidence.status !== "passed") {
      evidence.pageErrors = pageErrors;
      evidence.status = "failed";
      writeFileSync(path.join(EVIDENCE_DIR, "fixture-grant-evidence.json"), JSON.stringify(evidence, null, 2));
    }
    await makerContext.close();
    await checkerContext.close();
    await superContext.close();
  }
});

function permissionEvidence(permissionCodes: string[], menuIds: number[]) {
  return {
    permissionCodesExact: permissionCodes,
    permissionCount: permissionCodes.length,
    permissionHash: digest(permissionCodes),
    menuIdsExact: menuIds,
    menuCount: menuIds.length,
    menuHash: digest(menuIds),
    a2Read: permissionCodes.includes("platform_a2_read"),
    a2Approve: permissionCodes.includes("platform_a2_operation_approve"),
    fAuthoritiesExact: permissionCodes.filter((code) => code.startsWith("network_f")),
  };
}

function responseEvidence(response: APIResponse, payload: Envelope) {
  return { http: response.status(), code: payload.code, message: payload.message };
}

function digest(values: unknown[]) {
  return createHash("sha256").update(JSON.stringify([...values].sort())).digest("hex").toUpperCase();
}

async function loginSuperadmin(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(process.env.ADMIN_E2E_USERNAME ?? "superadmin");
  await page.locator('input[autocomplete="current-password"]').fill((process.env.ADMIN_E2E_PASSWORD || (() => { throw new Error("ADMIN_E2E_PASSWORD is required for authenticated acceptance"); })()));
  await page.getByRole("button", { name: /继续|登录/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 20_000 });
}

async function loginMfa(page: Page, account: Account, key: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    if (await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false)) return;
    await page.locator('input[autocomplete="username"]').fill(account.username);
    await page.locator('input[autocomplete="current-password"]').fill(account.password);
    await page.getByRole("button", { name: /继续|登录/ }).click();
    const otp = page.getByLabel("一次性验证码");
    await otp.waitFor({ state: "visible", timeout: 8_000 }).catch(() => undefined);
    if (await otp.isVisible().catch(() => false)) {
      await otp.fill(await freshTotp(key, account.totpSecret));
      await page.getByRole("button", { name: "验证并进入", exact: true }).click();
    }
    if (await page.locator("aside").waitFor({ state: "visible", timeout: 15_000 })
      .then(() => true).catch(() => false)) return;
  }
  throw new Error(`${key} login failed`);
}

async function logoutThroughUi(page: Page) {
  const responsePromise = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST"
    && new URL(candidate.url()).pathname === "/api/admin/auth/logout");
  const account = page.locator('header button[aria-haspopup="menu"]').last();
  await account.click();
  await page.getByRole("button", { name: "退出登录", exact: true }).click();
  const response = await responsePromise;
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
  return response;
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
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "执行", exact: true }).click();
  const responsePromise = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST"
    && new URL(candidate.url()).pathname.endsWith(`/operations/${operationId}/approve`));
  await confirmDialog(page, reason);
  await success(await responsePromise, `visible A2 approve ${operationId}`);
  await expect(row).toHaveCount(0);
}

async function rejectPendingThroughVisibleA2(page: Page, operationId: string) {
  if (!(await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false))) {
    await loginSuperadmin(page);
  }
  await navigatePlatform(page, "审计 & 操作确认 A2", /\/platform\/audit$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  const row = page.locator("tbody tr").filter({ hasText: operationId }).first();
  if (!(await row.isVisible().catch(() => false))) return;
  await row.getByRole("button", { name: "驳回", exact: true }).click();
  const responsePromise = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST"
    && new URL(candidate.url()).pathname.endsWith(`/operations/${operationId}/reject`));
  await confirmDialog(page, `${RUN_ID} fixture 失败清理待确认 A6 提案`);
  await success(await responsePromise, `visible A2 reject ${operationId}`);
}

async function success<T>(response: APIResponse | Response, label: string) {
  const payload = await response.json() as Envelope<T>;
  expect(response.status(), `${label}: ${JSON.stringify(payload)}`).toBe(200);
  expect(payload.code, `${label}: ${JSON.stringify(payload)}`).toBe(0);
  return payload.data as T;
}

async function body(response: APIResponse) {
  return await response.json() as Envelope;
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
