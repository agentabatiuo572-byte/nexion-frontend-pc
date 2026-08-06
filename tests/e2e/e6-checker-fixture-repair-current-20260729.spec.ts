import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, test, type Browser, type Page, type Response } from "@playwright/test";

type FixtureAccount = {
  accountId: string;
  username: string;
  password: string;
  totpSecret: string;
  role?: string;
  authorities?: string[];
  effectiveMenus?: string[];
  verifiedAt?: string;
};
type EFixture = {
  sensitive: true;
  doNotUpload: true;
  runId: string;
  checker: FixtureAccount & { id?: string | number };
  accounts: { maker: FixtureAccount };
};
type Progress = {
  sensitive: true;
  doNotUpload: true;
  runId: string;
  roles: Record<string, {
    roleId: number;
    ticketId?: string;
    approved?: boolean;
    grantFingerprint?: string;
  }>;
  assignments: Record<string, { accountId: string; role: string; verified?: boolean }>;
};
type RoleDetail = {
  roleCode?: string;
  roleName?: string;
  remark?: string;
  builtin?: boolean;
  permissionCodes?: string[];
  menuIds?: number[];
};
type AccountRow = {
  id: string | number;
  username?: string;
  role?: string;
  version: string | number;
  sessions?: string | number;
};
type SessionShape = {
  authorities: string[];
  menuCodes: string[];
};
type Envelope<T> = { code?: number; message?: string; data?: T };
type RepairConfig = {
  baseUrl: string;
  runId: string;
  restrictedRoot: string;
  fixtureDir: string;
  fixtureFile: string;
  progressFile: string;
  evidenceDir: string;
  operator: string;
  operatorPassword: string;
};

const E6_CHECKER_FIXTURE_REPAIR = process.env.E6_CHECKER_FIXTURE_REPAIR;
const REQUIRED_E6_PERMISSION = "device_e6_write";
const FORBIDDEN_E6_PERMISSION = "device_e6_flag_toggle";
const BLOCKED_E_BUSINESS_TICKET = "WO-260729180749943-300";
const lastTotpStepBySecretHash = new Map<string, number>();

// This fixture carries passwords and TOTP seeds. Never retain browser artifacts
// that could serialize those values.
test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe.configure({ mode: "serial", timeout: 300_000 });

test("为本轮独立 checker 增加 E6 工单审批最小权限并完成负向与重登验证", async ({ page, browser }) => {
  test.skip(
    E6_CHECKER_FIXTURE_REPAIR !== "1",
    "set E6_CHECKER_FIXTURE_REPAIR=1 to permit the isolated checker fixture repair",
  );
  const config = await readConfig();
  const fixture = JSON.parse(await readFile(config.fixtureFile, "utf8")) as EFixture;
  const progress = JSON.parse(await readFile(config.progressFile, "utf8")) as Progress;
  if (fixture.runId !== config.runId) throw new Error("E fixture Run ID mismatch");
  if (progress.runId !== config.runId) throw new Error("role repair progress Run ID mismatch");

  fixture.checker.accountId = String(fixture.checker.accountId ?? fixture.checker.id ?? "");
  if (!fixture.checker.accountId) throw new Error("checker account ID is missing");
  expect(fixture.accounts.maker.accountId).not.toBe(fixture.checker.accountId);
  expect(fixture.accounts.maker.username).not.toBe(fixture.checker.username);

  const checkerProgress = progress.roles["CHECKER.checker"];
  const checkerAssignment = progress.assignments["CHECKER.checker"];
  if (!checkerProgress?.roleId || !checkerAssignment?.role) {
    throw new Error("checker role repair metadata is incomplete");
  }
  const checkerRoleId = checkerProgress.roleId;
  const expectedRoleCode = checkerAssignment.role.toUpperCase();

  await loginOperator(page, config);
  const checkerAccount = await accountById(page, fixture.checker.accountId);
  expect((checkerAccount.role ?? "").toUpperCase()).toBe(expectedRoleCode);
  const roleBefore = await ok<RoleDetail>(
    await page.request.get(`/api/admin/platform/roles/${checkerRoleId}`),
  );
  expect(roleBefore.roleCode).toBe(expectedRoleCode);
  expect(roleBefore.roleName).toContain(config.runId);
  expect(roleBefore.remark).toContain(config.runId);
  expect(roleBefore.builtin).not.toBe(true);

  const originalPermissions = unique(roleBefore.permissionCodes ?? []);
  const originalMenuIds = unique((roleBefore.menuIds ?? []).map(String));
  expect(originalPermissions).toContain("platform_a2_operation_approve");
  expect(originalPermissions).toContain("platform_a6_role_grants_update");
  expect(originalPermissions).not.toContain(FORBIDDEN_E6_PERMISSION);
  const existingEWritePermissions = originalPermissions.filter(isEWritePermission);
  expect(existingEWritePermissions.filter((permission) => permission !== REQUIRED_E6_PERMISSION)).toEqual([]);

  const targetPermissions = unique([...originalPermissions, REQUIRED_E6_PERMISSION]);
  expect(targetPermissions.filter(isEWritePermission)).toEqual([REQUIRED_E6_PERMISSION]);
  const grantFingerprint = fingerprint(targetPermissions, originalMenuIds);
  let grantTicketId = "";
  let operatorSelfApproval = "NOT_REQUIRED";
  let makerApproval = "NOT_REQUIRED";
  const evidenceFile = path.join(config.evidenceDir, "safe-e6-checker-repair-summary.json");
  const priorEvidence = await optionalJson<{
    operatorSelfApproval?: string;
    makerApproval?: string;
  }>(evidenceFile);

  if (!originalPermissions.includes(REQUIRED_E6_PERMISSION)) {
    const ticket = await ok<Record<string, unknown>>(
      await page.request.put(`/api/admin/platform/roles/${checkerRoleId}/grants`, {
        headers: {
          "Idempotency-Key": `${config.runId}:CHECKER.e6:grants:${grantFingerprint}`,
        },
        data: {
          permissionCodes: targetPermissions,
          menuIds: originalMenuIds.map(Number),
          reason: `${config.runId} add exact E6 delegated approval permission to isolated checker`,
          operator: config.operator,
        },
      }),
    );
    grantTicketId = String(ticket.operationId ?? ticket.id ?? "");
    expect(grantTicketId).toMatch(/^(?:WO|OP)-/);
    expect(grantTicketId).not.toBe(BLOCKED_E_BUSINESS_TICKET);

    const selfApproval = await page.request.post(
      `/api/admin/platform/audit/operations/${grantTicketId}/approve`,
      {
        headers: {
          "Idempotency-Key": `${config.runId}:CHECKER.e6:operator-self-approval-negative`,
        },
        data: { reason: `${config.runId} verify maker-checker separation for A6 role grant` },
      },
    );
    expect(selfApproval.status()).toBe(403);
    operatorSelfApproval = "403";

    makerApproval = await assertMakerCannotApproveGrant(browser, config, fixture.accounts.maker, grantTicketId);
    await approveExactGrant(browser, config, fixture.checker, grantTicketId);
  }

  const roleAfter = await ok<RoleDetail>(
    await page.request.get(`/api/admin/platform/roles/${checkerRoleId}`),
  );
  expect(sameSet(roleAfter.permissionCodes ?? [], targetPermissions), "checker permission exact set").toBe(true);
  expect(
    sameSet((roleAfter.menuIds ?? []).map(String), originalMenuIds),
    "checker menus must not drift",
  ).toBe(true);
  const audit = await ok<{
    operationQueue?: Array<{ id?: string; status?: string }>;
    operationHistory?: Array<{ id?: string; status?: string }>;
  }>(await page.request.get("/api/admin/platform/audit/overview"));
  const blockedBusinessOperation = [
    ...(audit.operationQueue ?? []),
    ...(audit.operationHistory ?? []),
  ].find((operation) => operation.id === BLOCKED_E_BUSINESS_TICKET);
  const blockedBusinessOperationStatus = blockedBusinessOperation?.status;
  expect(blockedBusinessOperationStatus).toBe("rejected");

  const latestChecker = await accountById(page, fixture.checker.accountId);
  if (Number(latestChecker.sessions ?? 0) > 0) {
    await ok(
      await page.request.post(
        `/api/admin/platform/accounts/${fixture.checker.accountId}/sessions/revoke`,
        {
          headers: {
            "Idempotency-Key": `${config.runId}:CHECKER.e6:revoke:v${latestChecker.version}`,
          },
          data: {
            operator: config.operator,
            reason: `${config.runId} force fresh MFA after exact E6 checker grant`,
            expectedVersion: String(latestChecker.version),
          },
        },
      ),
    );
  }

  const checkerSession = await verifyFreshCheckerSession(
    browser,
    config,
    fixture.checker,
    targetPermissions,
    originalMenuIds,
  );
  expect(checkerSession.authorities).toContain(REQUIRED_E6_PERMISSION);
  expect(checkerSession.authorities).not.toContain(FORBIDDEN_E6_PERMISSION);

  const makerSession = await sessionAfterFreshLogin(browser, config.baseUrl, fixture.accounts.maker);
  expect(makerSession.authorities).not.toContain("platform_a2_operation_approve");
  expect(makerSession.authorities).toContain(REQUIRED_E6_PERMISSION);
  expect(makerSession.menuCodes).toContain("E6");
  expect(makerSession.menuCodes).not.toContain("A2");

  fixture.checker.role = checkerAssignment.role.toLowerCase();
  fixture.checker.authorities = checkerSession.authorities;
  fixture.checker.effectiveMenus = checkerSession.menuCodes;
  fixture.checker.verifiedAt = new Date().toISOString();
  await atomicJson(config.fixtureFile, fixture);

  progress.roles["CHECKER.checker"] = {
    ...checkerProgress,
    ticketId: grantTicketId || checkerProgress.ticketId,
    approved: true,
    grantFingerprint,
  };
  progress.assignments["CHECKER.checker"] = {
    ...checkerAssignment,
    verified: true,
  };
  await atomicJson(config.progressFile, progress);

  await atomicJson(evidenceFile, {
    runId: config.runId,
    generatedAt: new Date().toISOString(),
    roleCodeHash: createHash("sha256").update(expectedRoleCode).digest("hex"),
    grantTicketHash: grantTicketId
      ? createHash("sha256").update(grantTicketId).digest("hex")
      : "ALREADY_APPLIED",
    blockedEBusinessTicketApproved: false,
    blockedEBusinessTicketStatus: blockedBusinessOperationStatus,
    permissionDelta: originalPermissions.includes(REQUIRED_E6_PERMISSION)
      ? []
      : [REQUIRED_E6_PERMISSION],
    forbiddenE6PermissionPresent: checkerSession.authorities.includes(FORBIDDEN_E6_PERMISSION),
    menuIdsUnchanged: sameSet((roleAfter.menuIds ?? []).map(String), originalMenuIds),
    freshMfa: "PASS",
    refresh: "PASS",
    logoutRelogin: "PASS",
    operatorSelfApproval: operatorSelfApproval === "NOT_REQUIRED"
      ? priorEvidence?.operatorSelfApproval ?? "NOT_REQUIRED"
      : operatorSelfApproval,
    makerApproval: makerApproval === "NOT_REQUIRED"
      ? priorEvidence?.makerApproval ?? "NOT_REQUIRED"
      : makerApproval,
    unrelatedCheckerWrite: 403,
    makerHasOperationApprove: makerSession.authorities.includes("platform_a2_operation_approve"),
    authorityCount: checkerSession.authorities.length,
    menuCount: checkerSession.menuCodes.length,
  });
});

async function assertMakerCannotApproveGrant(
  browser: Browser,
  config: RepairConfig,
  maker: FixtureAccount,
  grantTicketId: string,
) {
  const context = await browser.newContext({ baseURL: config.baseUrl });
  const makerPage = await context.newPage();
  try {
    await loginWithMfa(makerPage, config.baseUrl, maker);
    const session = await readSession(makerPage);
    expect(session.authorities).not.toContain("platform_a2_operation_approve");
    expect(session.menuCodes).not.toContain("A2");
    const makerForbidden = await makerPage.request.post(
      `/api/admin/platform/audit/operations/${grantTicketId}/approve`,
      {
        headers: {
          "Idempotency-Key": `${config.runId}:CHECKER.e6:maker-approval-negative`,
        },
        data: { reason: `${config.runId} verify E maker cannot approve role grants` },
      },
    );
    expect(makerForbidden.status()).toBe(403);
    return "403";
  } finally {
    await context.close();
  }
}

async function approveExactGrant(
  browser: Browser,
  config: RepairConfig,
  checker: FixtureAccount,
  grantTicketId: string,
) {
  const context = await browser.newContext({ baseURL: config.baseUrl });
  const checkerPage = await context.newPage();
  try {
    await loginWithMfa(checkerPage, config.baseUrl, checker);
    const approval = await checkerPage.request.post(
      `/api/admin/platform/audit/operations/${grantTicketId}/approve`,
      {
        headers: {
          "Idempotency-Key": `${config.runId}:CHECKER.e6:approve:${fingerprint([grantTicketId], [])}`,
        },
        data: { reason: `${config.runId} independent checker approves exact E6 checker grant` },
      },
    );
    await ok(approval);
  } finally {
    await context.close();
  }
}

async function verifyFreshCheckerSession(
  browser: Browser,
  config: RepairConfig,
  checker: FixtureAccount,
  expectedPermissions: string[],
  expectedMenuIds: string[],
) {
  const context = await browser.newContext({ baseURL: config.baseUrl });
  const checkerPage = await context.newPage();
  try {
    await loginWithMfa(checkerPage, config.baseUrl, checker);
    let checkerSession = await readSession(checkerPage);
    expect(sameSet(checkerSession.authorities, expectedPermissions)).toBe(true);
    expect(checkerSession.authorities).not.toContain(FORBIDDEN_E6_PERMISSION);
    expect(checkerSession.menuCodes).toContain("E6");

    const unrelatedWrite = await checkerPage.request.post(
      "/api/admin/devices/999999999/activate",
      {
        headers: {
          "Idempotency-Key": `${config.runId}:CHECKER.e6:unrelated-e5-negative`,
        },
        data: {
          reason: `${config.runId} permission probe must not execute`,
          operator: "permission-probe",
        },
      },
    );
    expect(unrelatedWrite.status()).toBe(403);

    await checkerPage.reload({ waitUntil: "domcontentloaded" });
    checkerSession = await readSession(checkerPage);
    expect(sameSet(checkerSession.authorities, expectedPermissions)).toBe(true);
    expect(await currentRoleMenuIds(checkerPage, config, expectedMenuIds)).toEqual(expectedMenuIds);

    await logout(checkerPage);
    await loginWithMfa(checkerPage, config.baseUrl, checker);
    checkerSession = await readSession(checkerPage);
    expect(sameSet(checkerSession.authorities, expectedPermissions)).toBe(true);
    expect(await currentRoleMenuIds(checkerPage, config, expectedMenuIds)).toEqual(expectedMenuIds);
    return checkerSession;
  } finally {
    await context.close();
  }
}

async function sessionAfterFreshLogin(browser: Browser, baseUrl: string, account: FixtureAccount) {
  const context = await browser.newContext({ baseURL: baseUrl });
  const page = await context.newPage();
  try {
    await loginWithMfa(page, baseUrl, account);
    return await readSession(page);
  } finally {
    await context.close();
  }
}

async function currentRoleMenuIds(
  page: Page,
  config: RepairConfig,
  expectedMenuIds: string[],
) {
  const progress = JSON.parse(await readFile(config.progressFile, "utf8")) as Progress;
  const checkerRoleId = progress.roles["CHECKER.checker"]?.roleId;
  if (!checkerRoleId) throw new Error("checker role ID is missing after fresh login");
  const detail = await ok<RoleDetail>(
    await page.request.get(`/api/admin/platform/roles/${checkerRoleId}`),
  );
  const menuIds = unique((detail.menuIds ?? []).map(String));
  expect(sameSet(menuIds, expectedMenuIds)).toBe(true);
  return menuIds;
}

async function readConfig(): Promise<RepairConfig> {
  const required = (name: string) => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`${name} must be explicitly provided`);
    return value;
  };
  const baseUrl = required("E6_CHECKER_FIXTURE_BASE_URL");
  const parsed = new URL(baseUrl);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new Error("checker fixture repair only permits a loopback admin endpoint");
  }
  const requestedRoot = path.resolve(required("E6_CHECKER_FIXTURE_RESTRICTED_ROOT"));
  if (!/bug-pic[\\/]\.restricted/i.test(requestedRoot)) {
    throw new Error("E6_CHECKER_FIXTURE_RESTRICTED_ROOT must be under bug-pic/.restricted");
  }
  const allowedBase = await realpath(path.resolve("D:/workspace/bug-pic/.restricted"));
  const restrictedRoot = await realpath(requestedRoot);
  const relative = path.relative(allowedBase, restrictedRoot);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("checker fixture repair requires a child Run under canonical bug-pic/.restricted");
  }
  const runId = required("E6_CHECKER_FIXTURE_RUN_ID");
  const fixtureDir = path.join(restrictedRoot, "A", "domain-permission-fixtures");
  return {
    baseUrl,
    runId,
    restrictedRoot,
    fixtureDir,
    fixtureFile: path.join(fixtureDir, "E.json"),
    progressFile: path.join(fixtureDir, "role-repair-progress.json"),
    evidenceDir: path.join(restrictedRoot, "E", "checker-fixture-repair"),
    operator: required("E6_CHECKER_FIXTURE_OPERATOR"),
    operatorPassword: required("E6_CHECKER_FIXTURE_OPERATOR_PASSWORD"),
  };
}

async function loginOperator(page: Page, config: RepairConfig) {
  await page.goto(config.baseUrl, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(config.operator);
  await page.locator('input[autocomplete="current-password"]').fill(config.operatorPassword);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function loginWithMfa(
  page: Page,
  baseUrl: string,
  account: Pick<FixtureAccount, "username" | "password" | "totpSecret">,
) {
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });
  await page.locator('input[autocomplete="username"]').fill(account.username);
  await page.locator('input[autocomplete="current-password"]').fill(account.password);
  await page.getByRole("button", { name: /登录|继续/ }).click();
  const otp = page.getByLabel("一次性验证码");
  await expect(otp).toBeVisible({ timeout: 15_000 });
  await freshTotpWindow(account.totpSecret);
  await otp.fill(currentTotp(account.totpSecret));
  const verificationPromise = page.waitForResponse((response) =>
    response.request().method() === "POST"
    && new URL(response.url()).pathname === "/api/admin/auth/mfa/verify");
  await page.getByRole("button", { name: "验证并进入", exact: true }).click();
  const verification = await verificationPromise;
  const payload = await verification.json().catch(() => null) as Envelope<unknown> | null;
  const explicitEnvelopeFailure = typeof payload?.code === "number" && payload.code !== 0;
  if (!verification.ok() || explicitEnvelopeFailure) {
    throw new Error(
      `MFA_VERIFY_FAILED status=${verification.status()} code=${payload?.code ?? "unknown"} message=${payload?.message ?? "unknown"}`,
    );
  }
  await ensureAdminCookieFromVerifyResponse(page, baseUrl, verification);
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const response = await page.request.get("/api/admin/auth/session");
    if (response.status() === 200) {
      const sessionPayload = await response.json().catch(() => null) as Envelope<{ session?: unknown }> | null;
      if ((sessionPayload?.code ?? 0) === 0 && sessionPayload?.data?.session) break;
    }
    await page.waitForTimeout(250);
  }
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await expect(page.locator("aside")).toBeVisible({ timeout: 30_000 });
}

async function ensureAdminCookieFromVerifyResponse(
  page: Page,
  baseUrl: string,
  verification: Response,
) {
  const existing = (await page.context().cookies()).some((cookie) => cookie.name === "nexion_admin_token");
  if (existing) return;
  const setCookie = (await verification.allHeaders())["set-cookie"] ?? "";
  const match = setCookie.match(/(?:^|,\s*)nexion_admin_token=([^;]+)/);
  if (!match?.[1]) return;
  const parsed = new URL(baseUrl);
  await page.context().addCookies([{
    name: "nexion_admin_token",
    value: match[1],
    domain: parsed.hostname,
    path: "/",
    httpOnly: true,
    secure: parsed.protocol === "https:",
    sameSite: "Strict",
  }]);
}

async function logout(page: Page) {
  await page.request.post("/api/admin/auth/logout");
  await page.context().clearCookies();
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 20_000 });
}

async function readSession(page: Page): Promise<SessionShape> {
  const data = await ok<{
    session?: {
      authorities?: string[];
      menuCodes?: string[];
      effectiveMenus?: Array<string | { menuCode?: string }>;
    };
  }>(await page.request.get("/api/admin/auth/session"));
  return {
    authorities: unique(data.session?.authorities ?? []),
    menuCodes: unique(
      data.session?.menuCodes
      ?? (data.session?.effectiveMenus ?? []).map((menu) =>
        typeof menu === "string" ? menu : menu.menuCode ?? "").filter(Boolean),
    ),
  };
}

async function accountById(page: Page, accountId: string) {
  const overview = await ok<{ operators: AccountRow[] }>(
    await page.request.get("/api/admin/platform/accounts/overview"),
  );
  const row = overview.operators.find((account) => String(account.id) === accountId);
  if (!row) throw new Error(`account ${accountId} is missing`);
  return row;
}

async function ok<T>(response: { status(): number; json(): Promise<unknown> }) {
  const status = response.status();
  const payload = await response.json().catch(() => null) as Envelope<T> | null;
  expect(status).toBeLessThan(400);
  expect(payload?.code ?? 0).toBe(0);
  return payload?.data as T;
}

async function atomicJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function optionalJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function freshTotpWindow(secret: string) {
  const remaining = 30 - (Math.floor(Date.now() / 1_000) % 30);
  if (remaining <= 4) await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1_000));
  const secretHash = createHash("sha256").update(secret).digest("hex");
  let step = Math.floor(Date.now() / 30_000);
  const previous = lastTotpStepBySecretHash.get(secretHash);
  if (previous !== undefined && step <= previous) {
    const waitMs = ((previous + 1) * 30_000) - Date.now() + 500;
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    step = Math.floor(Date.now() / 30_000);
  }
  lastTotpStepBySecretHash.set(secretHash, step);
}

function currentTotp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const normalized = secret.replace(/\s+/g, "").replace(/=+$/g, "").toUpperCase();
  let bits = "";
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error("invalid base32 TOTP secret");
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

function isEWritePermission(permission: string) {
  return permission.startsWith("device_e") && !permission.endsWith("_read");
}

function fingerprint(permissionCodes: string[], menuIds: string[]) {
  return createHash("sha256")
    .update(JSON.stringify({
      permissionCodes: [...permissionCodes].sort(),
      menuIds: [...menuIds].sort((left, right) => Number(left) - Number(right)),
    }))
    .digest("hex")
    .slice(0, 16);
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function sameSet(left: string[], right: string[]) {
  const a = unique(left).sort();
  const b = unique(right).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
