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
  permissionCodes: string[];
  menuIds: number[];
};
type Ticket = {
  id?: string;
  operationId?: string;
  action?: string;
  obj?: string;
  beforeValue?: string;
  afterValue?: string;
  status?: string;
};
type A2Overview = {
  operationQueue?: Ticket[];
  operationHistory?: Array<{ id?: string; st?: string; note?: string }>;
};
type AuditLog = {
  action?: string;
  resourceType?: string;
  resourceId?: string;
  bizNo?: string;
  result?: string;
  riskLevel?: string;
  createdAt?: string;
};

const RUN_ID = process.env.F_FIXTURE_RUN_ID ?? "pc-full-acceptance-20260729-114336";
const ROLE_CODE = process.env.F_CHECKER_ROLE_CODE ?? "ACC_CHECKER_114336";
const A6_RED_OPERATION_ID = process.env.F_A6_RED_OPERATION_ID ?? "WO-260729183503301-200";
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
const reviewerAccount: Account = {
  username: process.env.F_SESSION_REVOKE_REVIEWER_USERNAME ?? "",
  password: process.env.F_SESSION_REVOKE_REVIEWER_PASSWORD ?? "",
  totpSecret: process.env.F_SESSION_REVOKE_REVIEWER_TOTP_SECRET ?? "",
};

test.use({ trace: "off", video: "off", screenshot: "off" });
test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  expect(process.env.F_FIXTURE_POST_RED_CLEANUP, "F_FIXTURE_POST_RED_CLEANUP=1 is required").toBe("1");
  expect(makerAccount).toBeTruthy();
  expect(checkerAccount).toBeTruthy();
  expect(reviewerAccount.username, "independent super reviewer username is required").not.toBe("");
  expect(reviewerAccount.password, "independent super reviewer password is required").not.toBe("");
  expect(reviewerAccount.totpSecret, "independent super reviewer TOTP secret is required").not.toBe("");
  expect(A6_RED_OPERATION_ID).toMatch(/^(?:WO|OP)-/);
  mkdirSync(EVIDENCE_DIR, { recursive: true });
});

test("revoke old checker sessions and verify the intended fixture state after the old-JAR red", async ({ browser }) => {
  test.setTimeout(240_000);
  const makerContext = await browser.newContext();
  const checkerContext = await browser.newContext();
  const superContext = await browser.newContext();
  const reviewerContext = await browser.newContext();
  const maker = await makerContext.newPage();
  const checker = await checkerContext.newPage();
  const superadmin = await superContext.newPage();
  const reviewer = await reviewerContext.newPage();
  const evidence: Record<string, unknown> = {
    runId: RUN_ID,
    roleCode: ROLE_CODE,
    targetPermission: TARGET_PERMISSION,
    a6RedOperationId: A6_RED_OPERATION_ID,
    authorizationConclusion: "RED_NOT_A_COMPLIANT_GRANT",
    productBusinessWrites: 0,
  };
  let sessionRevokeOperationId = "";
  let sessionRevokeApproved = false;
  try {
    await loginMfa(maker, makerAccount!, "a-maker-cleanup");
    await loginMfa(checker, checkerAccount!, "run-checker-before-revoke");
    await loginSuperadmin(superadmin);
    await loginMfa(reviewer, reviewerAccount, "independent-super-reviewer");

    const checkerBeforeRevoke = await session(checker);
    expect(checkerBeforeRevoke.roleCode).toBe(ROLE_CODE);
    expect(checkerBeforeRevoke.authorities).toEqual(expect.arrayContaining([
      "platform_a2_read",
      "platform_a2_operation_approve",
      TARGET_PERMISSION,
    ]));
    expect(checkerBeforeRevoke.authorities.filter((code) => code === TARGET_PERMISSION)).toHaveLength(1);

    const makerSelfApprove = await maker.request.post(
      `/api/admin/platform/audit/operations/${encodeURIComponent(A6_RED_OPERATION_ID)}/approve`,
      {
        headers: { "Idempotency-Key": `${RUN_ID}-f-fixture-maker-self-approve-post-red` },
        data: { reason: `${RUN_ID} A6 maker 自批继续必须拒绝` },
      },
    );
    const makerSelfApproveBody = await payload(makerSelfApprove);
    expect(makerSelfApprove.status() === 403 || makerSelfApproveBody.code === 403).toBe(true);

    const unknownOperation = await checker.request.post(
      "/api/admin/platform/audit/operations/WO-000000000000000-404/approve",
      {
        headers: { "Idempotency-Key": `${RUN_ID}-f-fixture-unknown-post-red` },
        data: { reason: `${RUN_ID} 旧运行时未知 operationId 必须无副作用失败` },
      },
    );
    const unknownBody = await payload(unknownOperation);
    expect(unknownBody.code).toBe(422);
    expect(unknownBody.message).toBe("A2_OPERATION_NOT_FOUND");

    await navigatePlatform(superadmin, "运营账号 & RBAC A1", /\/platform\/rbac$/);
    const checkerRowBefore = await findAccountRow(superadmin, checkerAccount!.username);
    const sessionCountBefore = await accountSessionCount(checkerRowBefore);
    expect(sessionCountBefore).toBeGreaterThan(0);
    await checkerRowBefore.getByRole("button", { name: "强制登出", exact: true }).click();
    const revokeProposalResponse = superadmin.waitForResponse((candidate) =>
      candidate.request().method() === "POST"
      && new URL(candidate.url()).pathname === "/api/admin/platform/audit/operations");
    await confirmDialog(superadmin, `${RUN_ID} 撤销 RunID F checker 全部旧会话后重登核权`);
    const revokeTicket = await success<Ticket>(await revokeProposalResponse, "visible A1 session-revoke proposal");
    sessionRevokeOperationId = String(revokeTicket.id ?? revokeTicket.operationId ?? "");
    expect(sessionRevokeOperationId).toMatch(/^(?:WO|OP)-/);
    await superadmin.screenshot({ path: path.join(EVIDENCE_DIR, "06-visible-a1-session-revoke-pending.png"), fullPage: true });

    await approveThroughVisibleA2(
      reviewer,
      sessionRevokeOperationId,
      `${RUN_ID} 独立超管核对 checker 旧会话撤销后批准`,
    );
    sessionRevokeApproved = true;
    await reviewer.screenshot({ path: path.join(EVIDENCE_DIR, "07-visible-a2-session-revoke-approved.png"), fullPage: true });

    const revokedSessionProbe = await checker.request.get("/api/admin/auth/session");
    expect(revokedSessionProbe.status()).toBe(401);
    await checker.reload({ waitUntil: "domcontentloaded" });
    await expect(checker.locator('input[autocomplete="username"]')).toBeVisible({ timeout: 15_000 });

    await superadmin.reload({ waitUntil: "domcontentloaded" });
    const checkerRowAfter = await findAccountRow(superadmin, checkerAccount!.username);
    expect(await accountSessionCount(checkerRowAfter)).toBe(0);
    await superadmin.screenshot({ path: path.join(EVIDENCE_DIR, "08-visible-a1-sessions-zero.png"), fullPage: true });

    await navigatePlatform(maker, "角色管理 A6", /\/platform\/roles$/);
    const roleCell = maker.getByText(ROLE_CODE, { exact: true }).first();
    await expect(roleCell).toBeVisible();
    const roleDetailResponse = maker.waitForResponse((candidate) =>
      candidate.request().method() === "GET"
      && /\/api\/admin\/platform\/roles\/\d+$/.test(new URL(candidate.url()).pathname));
    await roleCell.click();
    const roleDetail = await success<RoleDetail>(await roleDetailResponse, "visible A6 post-red role detail");
    expect(roleDetail.roleCode).toBe(ROLE_CODE);
    expect(roleDetail.permissionCodes).toEqual(expect.arrayContaining([
      "platform_a2_read",
      "platform_a2_operation_approve",
      TARGET_PERMISSION,
    ]));
    expect(roleDetail.permissionCodes.filter((code) => code === TARGET_PERMISSION)).toHaveLength(1);
    expect(roleDetail.permissionCodes).toHaveLength(84);
    expect(roleDetail.menuIds).toHaveLength(88);
    await maker.getByRole("button", { name: "编辑授权（权限/菜单）", exact: true }).click();
    const grantDrawer = maker.getByRole("dialog")
      .filter({ has: maker.getByRole("button", { name: "保存授权（需确认）", exact: true }) });
    await grantDrawer.getByLabel("权限搜索").fill(TARGET_PERMISSION);
    await expect(grantDrawer.locator(`label[title="${TARGET_PERMISSION}"] input[type="checkbox"]`)).toBeChecked();
    await maker.screenshot({ path: path.join(EVIDENCE_DIR, "09-visible-a6-target-checked.png"), fullPage: true });
    await grantDrawer.getByRole("button", { name: "关闭", exact: true }).click();

    await loginMfa(checker, checkerAccount!, "run-checker-after-revoke");
    const afterRelogin = await session(checker);
    expect(afterRelogin.roleCode).toBe(ROLE_CODE);
    expect([...afterRelogin.authorities].sort()).toEqual([...roleDetail.permissionCodes].sort());
    expect(afterRelogin.authorities.filter((code) => code === TARGET_PERMISSION)).toHaveLength(1);
    expect(afterRelogin.authorities).toEqual(expect.arrayContaining([
      "platform_a2_read",
      "platform_a2_operation_approve",
    ]));
    await checker.reload({ waitUntil: "domcontentloaded" });
    const afterRefresh = await session(checker);
    expect([...afterRefresh.authorities].sort()).toEqual([...afterRelogin.authorities].sort());
    await navigatePlatform(checker, "审计 & 操作确认 A2", /\/platform\/audit$/);
    await expect(checker.getByRole("heading", { name: "审计 & 操作确认" })).toBeVisible();
    await checker.screenshot({ path: path.join(EVIDENCE_DIR, "10-checker-refresh-relogin-stable.png"), fullPage: true });

    const a2Overview = await success<A2Overview>(
      await superadmin.request.get(
        `/api/admin/platform/audit/overview?object=${encodeURIComponent(ROLE_CODE)}`,
      ),
      "A2 role-operation overview",
    );
    const redTicket = (a2Overview.operationQueue ?? []).find((row) => row.id === A6_RED_OPERATION_ID);
    expect(redTicket, "old-JAR red operation must remain auditable").toBeTruthy();
    expect(redTicket?.status).toBe("approved");
    const a2Logs = await success<AuditLog[]>(
      await superadmin.request.get(
        `/api/admin/platform/audit/logs?object=${encodeURIComponent(A6_RED_OPERATION_ID)}&limit=50`,
      ),
      "A2 red-operation logs",
    );
    expect(a2Logs.length).toBeGreaterThanOrEqual(2);
    const a4Overview = await success<unknown>(
      await superadmin.request.get("/api/admin/platform/events/overview"),
      "A4 overview",
    );
    const a4Serialized = JSON.stringify(a4Overview);

    evidence.a6RedOperation = {
      operationId: A6_RED_OPERATION_ID,
      status: redTicket?.status,
      action: redTicket?.action,
      object: redTicket?.obj,
      a2Logs: a2Logs.map(safeAudit),
      processClassification: "target F checker cross-domain approval unexpectedly returned code=0 on old JAR",
    };
    evidence.negative = {
      makerSelfApprove: responseEvidence(makerSelfApprove, makerSelfApproveBody),
      unknownOperationId: responseEvidence(unknownOperation, unknownBody),
    };
    evidence.sessionRevocation = {
      operationId: sessionRevokeOperationId,
      before: sessionCountBefore,
      revokedSessionProbeHttp: revokedSessionProbe.status(),
      afterVisibleA1: await accountSessionCount(checkerRowAfter),
    };
    evidence.fixtureState = {
      permissionCount: roleDetail.permissionCodes.length,
      permissionCodesExact: roleDetail.permissionCodes,
      permissionHash: hash(roleDetail.permissionCodes),
      menuCount: roleDetail.menuIds.length,
      menuIdsExact: roleDetail.menuIds,
      menuHash: hash(roleDetail.menuIds),
      a2ReadPreserved: roleDetail.permissionCodes.includes("platform_a2_read"),
      a2ApprovePreserved: roleDetail.permissionCodes.includes("platform_a2_operation_approve"),
      targetPermissionCount: roleDetail.permissionCodes.filter((code) => code === TARGET_PERMISSION).length,
      fAuthoritiesExact: roleDetail.permissionCodes.filter((code) => code.startsWith("network_f")),
      sessionMatchesRole: hash(afterRelogin.authorities) === hash(roleDetail.permissionCodes),
      refreshStable: hash(afterRefresh.authorities) === hash(afterRelogin.authorities),
    };
    evidence.a4 = {
      overviewHttp: 200,
      containsA6OperationId: a4Serialized.includes(A6_RED_OPERATION_ID),
      containsRoleCode: a4Serialized.includes(ROLE_CODE),
      note: "A6_ROLE_GRANTS_CHANGED is A2 audit-bound; no A4 event is asserted when the event center has no matching record.",
    };
    evidence.deferredUntilSharedJarRestart = [
      "compliant A6 checker approval GREEN",
      "F checker A6 proposal/cross-domain/unknown-ID all 403",
      "same-domain F list visibility and operation-detail decision scope",
      "all F business approvals",
    ];
    evidence.status = "passed_with_old_jar_red";
    writeFileSync(path.join(EVIDENCE_DIR, "post-red-cleanup-evidence.json"), JSON.stringify(evidence, null, 2));
  } finally {
    if (sessionRevokeOperationId && !sessionRevokeApproved) {
      await rejectPendingThroughVisibleA2(reviewer, sessionRevokeOperationId, reviewerAccount)
        .catch(() => undefined);
    }
    if (!evidence.status) {
      evidence.status = "failed";
      writeFileSync(path.join(EVIDENCE_DIR, "post-red-cleanup-evidence.json"), JSON.stringify(evidence, null, 2));
    }
    await makerContext.close();
    await checkerContext.close();
    await superContext.close();
    await reviewerContext.close();
  }
});

function safeAudit(log: AuditLog) {
  return {
    action: log.action,
    resourceType: log.resourceType,
    resourceId: log.resourceId,
    bizNo: log.bizNo,
    result: log.result,
    riskLevel: log.riskLevel,
    createdAt: log.createdAt,
  };
}

function responseEvidence(response: APIResponse, value: Envelope) {
  return { http: response.status(), code: value.code, message: value.message };
}

function hash(values: unknown[]) {
  return createHash("sha256").update(JSON.stringify([...values].sort())).digest("hex").toUpperCase();
}

async function findAccountRow(page: Page, username: string) {
  const pageSize = page.locator("select.pager-size");
  const tableBody = page.locator("table tbody");
  await expect(tableBody).toBeVisible();
  if (await pageSize.isVisible().catch(() => false)) {
    await pageSize.selectOption("50");
    await expect(page.locator(".pager-info")).toBeVisible();
  }
  for (let index = 0; index < 20; index += 1) {
    const row = page.locator("tbody tr").filter({ hasText: username }).first();
    if (await row.isVisible().catch(() => false)) return row;
    const next = page.getByRole("button", { name: "›", exact: true });
    if (await next.isDisabled()) break;
    const before = await tableBody.innerText();
    await next.click();
    await expect.poll(async () => await tableBody.innerText()).not.toBe(before);
  }
  throw new Error("RunID checker account row is not visible in A1 pagination");
}

async function accountSessionCount(row: ReturnType<Page["locator"]>) {
  const value = (await row.locator("td").nth(5).textContent())?.trim() ?? "";
  expect(value).toMatch(/^\d+$/);
  return Number(value);
}

async function loginSuperadmin(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill(process.env.ADMIN_E2E_USERNAME ?? "superadmin");
  await page.locator('input[autocomplete="current-password"]').fill(process.env.ADMIN_E2E_PASSWORD ?? "Admin@123456");
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
  await page.reload({ waitUntil: "domcontentloaded" });
  const completedRow = page.locator("tbody tr").filter({ hasText: operationId }).first();
  await expect(completedRow).toBeVisible();
  await expect(completedRow.getByRole("button", { name: "执行", exact: true })).toHaveCount(0);
}

async function rejectPendingThroughVisibleA2(page: Page, operationId: string, account?: Account) {
  if (!(await page.locator("aside").isVisible({ timeout: 2_000 }).catch(() => false))) {
    if (account) await loginMfa(page, account, "independent-super-reviewer-cleanup");
    else await loginSuperadmin(page);
  }
  await navigatePlatform(page, "审计 & 操作确认 A2", /\/platform\/audit$/);
  await page.reload({ waitUntil: "domcontentloaded" });
  const row = page.locator("tbody tr").filter({ hasText: operationId }).first();
  if (!(await row.isVisible().catch(() => false))) return;
  await row.getByRole("button", { name: "驳回", exact: true }).click();
  const responsePromise = page.waitForResponse((candidate) =>
    candidate.request().method() === "POST"
    && new URL(candidate.url()).pathname.endsWith(`/operations/${operationId}/reject`));
  await confirmDialog(page, `${RUN_ID} fixture 失败清理 A1 会话撤销提案`);
  await success(await responsePromise, `visible A2 reject ${operationId}`);
}

async function success<T>(response: APIResponse | Response, label: string) {
  const value = await response.json() as Envelope<T>;
  expect(response.status(), `${label}: ${JSON.stringify(value)}`).toBe(200);
  expect(value.code, `${label}: ${JSON.stringify(value)}`).toBe(0);
  return value.data as T;
}

async function payload(response: APIResponse) {
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
